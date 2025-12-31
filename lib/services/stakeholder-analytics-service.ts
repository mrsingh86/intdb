/**
 * Stakeholder Analytics Service
 *
 * Calculates metrics and analytics for stakeholders:
 * - Reliability scores
 * - On-time performance
 * - Response times
 * - Revenue/cost tracking
 * - Behavior patterns
 *
 * Principles:
 * - Single Responsibility: Only analytics calculations
 * - Database-Driven: Store snapshots for historical analysis
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { StakeholderRepository } from '../repositories/stakeholder-repository';
import {
  Party,
  StakeholderBehaviorMetrics,
  MetricPeriod,
  RouteInfo,
} from '@/types/intelligence-platform';

// ============================================================================
// TYPES
// ============================================================================

export interface ReliabilityFactors {
  onTimeRate: number;       // Weight: 40%
  documentQuality: number;  // Weight: 25%
  responseTime: number;     // Weight: 20%
  amendmentRate: number;    // Weight: 15%
}

export interface StakeholderDashboard {
  topCustomers: Party[];
  atRiskRelationships: Party[];
  recentActivity: {
    newStakeholders: number;
    shipmentsByCustomer: Record<string, number>;
  };
  performanceOverview: {
    avgReliability: number;
    avgResponseTime: number;
    totalRevenue: number;
  };
}

export interface PeriodBounds {
  start: Date;
  end: Date;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const RELIABILITY_WEIGHTS = {
  onTimeRate: 0.40,
  documentQuality: 0.25,
  responseTime: 0.20,
  amendmentRate: 0.15,
};

// Response time scoring (hours to score)
const RESPONSE_TIME_SCORING = [
  { maxHours: 4, score: 100 },
  { maxHours: 12, score: 90 },
  { maxHours: 24, score: 75 },
  { maxHours: 48, score: 50 },
  { maxHours: 72, score: 25 },
  { maxHours: Infinity, score: 10 },
];

// ============================================================================
// SERVICE CLASS
// ============================================================================

export class StakeholderAnalyticsService {
  private repository: StakeholderRepository;

  constructor(private readonly supabase: SupabaseClient) {
    this.repository = new StakeholderRepository(supabase);
  }

  // --------------------------------------------------------------------------
  // RELIABILITY SCORE CALCULATION
  // --------------------------------------------------------------------------

  /**
   * Calculate reliability score for a stakeholder
   */
  async calculateReliabilityScore(partyId: string): Promise<number> {
    const factors = await this.getReliabilityFactors(partyId);
    return this.computeReliabilityScore(factors);
  }

  /**
   * Get individual reliability factors
   */
  async getReliabilityFactors(partyId: string): Promise<ReliabilityFactors> {
    const party = await this.repository.findById(partyId);

    // Get shipment performance
    const shipmentStats = await this.getShipmentPerformance(partyId);

    // Calculate each factor (0-100 scale)
    const onTimeRate = shipmentStats.onTimeRate;
    const documentQuality = party.documentation_quality_score || 70; // Default if not set
    const responseTime = this.scoreResponseTime(party.response_time_avg_hours || 24);
    const amendmentRate = this.scoreAmendmentRate(shipmentStats.amendmentRate);

    return {
      onTimeRate,
      documentQuality,
      responseTime,
      amendmentRate,
    };
  }

  /**
   * Compute weighted reliability score from factors
   */
  private computeReliabilityScore(factors: ReliabilityFactors): number {
    const score =
      factors.onTimeRate * RELIABILITY_WEIGHTS.onTimeRate +
      factors.documentQuality * RELIABILITY_WEIGHTS.documentQuality +
      factors.responseTime * RELIABILITY_WEIGHTS.responseTime +
      factors.amendmentRate * RELIABILITY_WEIGHTS.amendmentRate;

    return Math.round(score * 100) / 100;
  }

  /**
   * Score response time (lower is better)
   */
  private scoreResponseTime(hours: number): number {
    for (const tier of RESPONSE_TIME_SCORING) {
      if (hours <= tier.maxHours) {
        return tier.score;
      }
    }
    return 10;
  }

  /**
   * Score amendment rate (lower is better)
   */
  private scoreAmendmentRate(rate: number): number {
    // 0% amendments = 100, 50%+ amendments = 0
    return Math.max(0, 100 - rate * 2);
  }

  // --------------------------------------------------------------------------
  // SHIPMENT PERFORMANCE
  // --------------------------------------------------------------------------

  /**
   * Get shipment performance statistics for a stakeholder
   */
  async getShipmentPerformance(partyId: string): Promise<{
    total: number;
    onTime: number;
    delayed: number;
    onTimeRate: number;
    amendments: number;
    amendmentRate: number;
  }> {
    // Get shipments where this party is shipper or consignee
    const { data: shipments, error } = await this.supabase
      .from('shipments')
      .select('id, etd, atd, eta, ata, status')
      .or(`shipper_id.eq.${partyId},consignee_id.eq.${partyId}`);

    if (error) {
      throw new Error(`Failed to fetch shipments: ${error.message}`);
    }

    const total = shipments?.length || 0;
    let onTime = 0;
    let delayed = 0;

    for (const shipment of shipments || []) {
      if (shipment.atd && shipment.etd) {
        const actualDeparture = new Date(shipment.atd);
        const expectedDeparture = new Date(shipment.etd);
        if (actualDeparture <= expectedDeparture) {
          onTime++;
        } else {
          delayed++;
        }
      }
    }

    // Get amendment count
    const { count: amendments } = await this.supabase
      .from('document_revisions')
      .select('id', { count: 'exact', head: true })
      .in('shipment_id', shipments?.map(s => s.id) || [])
      .gt('revision_number', 1);

    return {
      total,
      onTime,
      delayed,
      onTimeRate: total > 0 ? (onTime / total) * 100 : 100,
      amendments: amendments || 0,
      amendmentRate: total > 0 ? ((amendments || 0) / total) * 100 : 0,
    };
  }

  // --------------------------------------------------------------------------
  // ROUTE ANALYSIS
  // --------------------------------------------------------------------------

  /**
   * Calculate common routes for a stakeholder
   */
  async calculateCommonRoutes(partyId: string): Promise<RouteInfo[]> {
    const { data: shipments, error } = await this.supabase
      .from('shipments')
      .select('port_of_loading_code, port_of_discharge_code')
      .or(`shipper_id.eq.${partyId},consignee_id.eq.${partyId}`)
      .not('port_of_loading_code', 'is', null)
      .not('port_of_discharge_code', 'is', null);

    if (error) {
      throw new Error(`Failed to fetch routes: ${error.message}`);
    }

    // Count route occurrences
    const routeCounts: Record<string, RouteInfo> = {};

    for (const shipment of shipments || []) {
      const key = `${shipment.port_of_loading_code}-${shipment.port_of_discharge_code}`;
      if (!routeCounts[key]) {
        routeCounts[key] = {
          origin: shipment.port_of_loading_code,
          destination: shipment.port_of_discharge_code,
          count: 0,
        };
      }
      routeCounts[key].count++;
    }

    // Sort by count and return top routes
    return Object.values(routeCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  // --------------------------------------------------------------------------
  // BEHAVIOR METRICS SNAPSHOTS
  // --------------------------------------------------------------------------

  /**
   * Calculate and save behavior metrics for a period
   */
  async calculatePeriodMetrics(
    partyId: string,
    period: MetricPeriod
  ): Promise<StakeholderBehaviorMetrics> {
    const bounds = this.getPeriodBounds(period);

    // Get shipments in period
    const { data: shipments } = await this.supabase
      .from('shipments')
      .select('id, etd, atd, status')
      .or(`shipper_id.eq.${partyId},consignee_id.eq.${partyId}`)
      .gte('created_at', bounds.start.toISOString())
      .lte('created_at', bounds.end.toISOString());

    const shipmentCount = shipments?.length || 0;

    // Calculate on-time rate for period
    let onTimeCount = 0;
    for (const s of shipments || []) {
      if (s.atd && s.etd && new Date(s.atd) <= new Date(s.etd)) {
        onTimeCount++;
      }
    }
    const onTimeRate = shipmentCount > 0 ? (onTimeCount / shipmentCount) * 100 : undefined;

    // Get amendment count for period
    const { count: amendments } = await this.supabase
      .from('document_revisions')
      .select('id', { count: 'exact', head: true })
      .in('shipment_id', shipments?.map(s => s.id) || [])
      .gt('revision_number', 1)
      .gte('created_at', bounds.start.toISOString())
      .lte('created_at', bounds.end.toISOString());

    // Get average sentiment for period
    const avgSentiment = await this.getAverageSentimentForPeriod(partyId, bounds);

    // Get email count for period
    const { count: emailCount } = await this.supabase
      .from('stakeholder_sentiment_log')
      .select('id', { count: 'exact', head: true })
      .eq('party_id', partyId)
      .gte('analyzed_at', bounds.start.toISOString())
      .lte('analyzed_at', bounds.end.toISOString());

    // Save metrics
    const metrics = await this.repository.saveBehaviorMetrics({
      party_id: partyId,
      metric_period: period,
      period_start: bounds.start.toISOString().split('T')[0],
      period_end: bounds.end.toISOString().split('T')[0],
      shipment_count: shipmentCount,
      container_count: 0, // TODO: Calculate from shipment_containers
      on_time_rate: onTimeRate,
      amendment_count: amendments || 0,
      avg_response_time_hours: undefined, // TODO: Calculate from email response times
      revenue: 0, // TODO: Calculate from shipment_financials
      cost: 0,
      email_count: emailCount || 0,
      avg_sentiment_score: avgSentiment ?? undefined,
      calculated_at: new Date().toISOString(),
    });

    return metrics;
  }

  /**
   * Get period start/end dates
   */
  private getPeriodBounds(period: MetricPeriod): PeriodBounds {
    const now = new Date();
    let start: Date;
    let end: Date = new Date(now);

    switch (period) {
      case 'monthly':
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case 'quarterly':
        const quarter = Math.floor(now.getMonth() / 3);
        start = new Date(now.getFullYear(), (quarter - 1) * 3, 1);
        end = new Date(now.getFullYear(), quarter * 3, 0);
        break;
      case 'yearly':
        start = new Date(now.getFullYear() - 1, 0, 1);
        end = new Date(now.getFullYear() - 1, 11, 31);
        break;
    }

    return { start, end };
  }

  /**
   * Get average sentiment for a period
   */
  private async getAverageSentimentForPeriod(
    partyId: string,
    bounds: PeriodBounds
  ): Promise<number | null> {
    const { data } = await this.supabase
      .from('stakeholder_sentiment_log')
      .select('sentiment_score')
      .eq('party_id', partyId)
      .gte('analyzed_at', bounds.start.toISOString())
      .lte('analyzed_at', bounds.end.toISOString());

    if (!data || data.length === 0) return null;

    const sum = data.reduce((acc, log) => acc + log.sentiment_score, 0);
    return sum / data.length;
  }

  // --------------------------------------------------------------------------
  // DASHBOARD ANALYTICS
  // --------------------------------------------------------------------------

  /**
   * Get stakeholder dashboard data
   */
  async getDashboardData(): Promise<StakeholderDashboard> {
    // Top customers by shipment count (more reliable than revenue)
    const { data: topCustomers } = await this.supabase
      .from('parties')
      .select('*')
      .or('is_customer.eq.true,total_shipments.gt.0')
      .order('total_shipments', { ascending: false, nullsFirst: false })
      .limit(10);

    // At-risk relationships (low reliability score)
    const { data: atRisk } = await this.supabase
      .from('parties')
      .select('*')
      .or('is_customer.eq.true,total_shipments.gt.0')
      .lt('reliability_score', 60)
      .not('reliability_score', 'is', null)
      .order('reliability_score', { ascending: true })
      .limit(5);

    // Recent new stakeholders (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { count: newStakeholders } = await this.supabase
      .from('parties')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', thirtyDaysAgo.toISOString());

    // Performance overview
    const { data: allParties } = await this.supabase
      .from('parties')
      .select('reliability_score, response_time_avg_hours, total_revenue');

    let avgReliability = 0;
    let avgResponseTime = 0;
    let totalRevenue = 0;
    let reliabilityCount = 0;
    let responseCount = 0;

    for (const party of allParties || []) {
      if (party.reliability_score !== null) {
        avgReliability += party.reliability_score;
        reliabilityCount++;
      }
      if (party.response_time_avg_hours !== null) {
        avgResponseTime += party.response_time_avg_hours;
        responseCount++;
      }
      totalRevenue += party.total_revenue || 0;
    }

    return {
      topCustomers: topCustomers || [],
      atRiskRelationships: atRisk || [],
      recentActivity: {
        newStakeholders: newStakeholders || 0,
        shipmentsByCustomer: {}, // TODO: Calculate
      },
      performanceOverview: {
        avgReliability: reliabilityCount > 0 ? avgReliability / reliabilityCount : 0,
        avgResponseTime: responseCount > 0 ? avgResponseTime / responseCount : 0,
        totalRevenue,
      },
    };
  }

  // --------------------------------------------------------------------------
  // BATCH UPDATES
  // --------------------------------------------------------------------------

  /**
   * Recalculate reliability scores for all stakeholders
   */
  async recalculateAllReliabilityScores(): Promise<{
    updated: number;
    failed: number;
  }> {
    const { data: parties } = await this.supabase
      .from('parties')
      .select('id')
      .gt('total_shipments', 0);

    let updated = 0;
    let failed = 0;

    for (const party of parties || []) {
      try {
        const score = await this.calculateReliabilityScore(party.id);
        await this.repository.update(party.id, { reliability_score: score });
        updated++;
      } catch {
        failed++;
      }
    }

    return { updated, failed };
  }

  /**
   * Update common routes for all stakeholders
   */
  async updateAllCommonRoutes(): Promise<number> {
    const { data: parties } = await this.supabase
      .from('parties')
      .select('id')
      .gt('total_shipments', 0);

    let updated = 0;

    for (const party of parties || []) {
      try {
        const routes = await this.calculateCommonRoutes(party.id);
        await this.repository.update(party.id, { common_routes: routes });
        updated++;
      } catch {
        // Continue on error
      }
    }

    return updated;
  }
}
