/**
 * Carrier Profile Service
 *
 * Computes shipping line performance metrics:
 * - Schedule reliability (on-time departure/arrival)
 * - Booking reliability (rollover rate)
 * - Documentation quality
 * - Issue patterns
 * - Performance scoring
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

export interface CarrierProfile {
  carrierName: string;
  carrierNameNormalized: string;
  totalShipments: number;
  shipmentsLast90Days: number;
  shipmentsLast30Days: number;
  activeShipments: number;
  onTimeDepartureRate: number | null;
  onTimeArrivalRate: number | null;
  avgDepartureDelayDays: number | null;
  avgArrivalDelayDays: number | null;
  rolloverRate: number | null;
  amendmentRate: number | null;
  issueRate: number | null;
  commonIssueTypes: string[];
  docIssueRate: number | null;
  commonRoutes: Array<{ pol: string; pod: string; count: number }>;
  performanceScore: number;
  performanceFactors: string[];
}

export interface CarrierInsight {
  type: 'positive' | 'warning' | 'critical';
  message: string;
}

// ============================================================================
// SERVICE
// ============================================================================

export class CarrierProfileService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Normalize carrier name for matching
   */
  private normalizeCarrierName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/shipping\s*(line)?/gi, '')
      .replace(/container\s*(line)?/gi, '')
      .replace(/\(.*\)/g, '') // Remove parenthetical
      .trim();
  }

  /**
   * Compute full profile for a carrier
   */
  async computeProfile(carrierName: string): Promise<CarrierProfile> {
    const normalized = this.normalizeCarrierName(carrierName);

    // Get all shipments for this carrier
    const { data: shipments } = await this.supabase
      .from('shipments')
      .select(`
        id, booking_number, carrier_name,
        port_of_loading_code, port_of_discharge_code,
        etd, eta, atd, ata,
        stage, status, created_at
      `)
      .ilike('carrier_name', `%${carrierName}%`);

    const shipmentIds = (shipments || []).map(s => s.id);

    // Get chronicle data for these shipments
    const { data: chronicleData } = await this.supabase
      .from('chronicle')
      .select(`
        shipment_id, document_type, occurred_at,
        has_issue, issue_type, issue_description
      `)
      .in('shipment_id', shipmentIds.length > 0 ? shipmentIds : ['none']);

    // Volume metrics
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const totalShipments = shipments?.length || 0;
    const shipmentsLast90Days = shipments?.filter(s =>
      new Date(s.created_at) >= ninetyDaysAgo
    ).length || 0;
    const shipmentsLast30Days = shipments?.filter(s =>
      new Date(s.created_at) >= thirtyDaysAgo
    ).length || 0;
    const activeShipments = shipments?.filter(s =>
      !['delivered', 'cancelled', 'completed'].includes(s.status?.toLowerCase() || '')
    ).length || 0;

    // Schedule reliability
    const scheduleMetrics = this.computeScheduleMetrics(shipments || []);

    // Issue metrics
    const issueMetrics = this.computeIssueMetrics(chronicleData || [], shipmentIds);

    // Booking reliability (rollovers, amendments)
    const bookingMetrics = this.computeBookingMetrics(chronicleData || [], shipmentIds);

    // Route metrics
    const routeMetrics = this.computeRouteMetrics(shipments || []);

    // Performance score (0-100, higher = better)
    const { performanceScore, performanceFactors } = this.computePerformanceScore({
      onTimeDepartureRate: scheduleMetrics.onTimeDepartureRate,
      onTimeArrivalRate: scheduleMetrics.onTimeArrivalRate,
      rolloverRate: bookingMetrics.rolloverRate,
      issueRate: issueMetrics.issueRate,
      totalShipments,
    });

    return {
      carrierName,
      carrierNameNormalized: normalized,
      totalShipments,
      shipmentsLast90Days,
      shipmentsLast30Days,
      activeShipments,
      ...scheduleMetrics,
      ...bookingMetrics,
      ...issueMetrics,
      ...routeMetrics,
      performanceScore,
      performanceFactors,
    };
  }

  /**
   * Compute schedule reliability metrics
   */
  private computeScheduleMetrics(shipments: any[]): {
    onTimeDepartureRate: number | null;
    onTimeArrivalRate: number | null;
    avgDepartureDelayDays: number | null;
    avgArrivalDelayDays: number | null;
  } {
    if (shipments.length === 0) {
      return {
        onTimeDepartureRate: null,
        onTimeArrivalRate: null,
        avgDepartureDelayDays: null,
        avgArrivalDelayDays: null,
      };
    }

    // Departure analysis (ETD vs ATD)
    const departureDelays: number[] = [];
    let onTimeDepartures = 0;
    let departuresWithData = 0;

    for (const s of shipments) {
      if (s.etd && s.atd) {
        departuresWithData++;
        const etd = new Date(s.etd);
        const atd = new Date(s.atd);
        const delayDays = (atd.getTime() - etd.getTime()) / (24 * 60 * 60 * 1000);
        departureDelays.push(delayDays);
        if (delayDays <= 1) onTimeDepartures++; // Within 1 day = on time
      }
    }

    // Arrival analysis (ETA vs ATA)
    const arrivalDelays: number[] = [];
    let onTimeArrivals = 0;
    let arrivalsWithData = 0;

    for (const s of shipments) {
      if (s.eta && s.ata) {
        arrivalsWithData++;
        const eta = new Date(s.eta);
        const ata = new Date(s.ata);
        const delayDays = (ata.getTime() - eta.getTime()) / (24 * 60 * 60 * 1000);
        arrivalDelays.push(delayDays);
        if (delayDays <= 2) onTimeArrivals++; // Within 2 days = on time
      }
    }

    return {
      onTimeDepartureRate: departuresWithData > 0
        ? Math.round(onTimeDepartures / departuresWithData * 100)
        : null,
      onTimeArrivalRate: arrivalsWithData > 0
        ? Math.round(onTimeArrivals / arrivalsWithData * 100)
        : null,
      avgDepartureDelayDays: departureDelays.length > 0
        ? Math.round(departureDelays.filter(d => d > 0).reduce((a, b) => a + b, 0) / departureDelays.filter(d => d > 0).length * 10) / 10 || 0
        : null,
      avgArrivalDelayDays: arrivalDelays.length > 0
        ? Math.round(arrivalDelays.filter(d => d > 0).reduce((a, b) => a + b, 0) / arrivalDelays.filter(d => d > 0).length * 10) / 10 || 0
        : null,
    };
  }

  /**
   * Compute booking reliability metrics
   */
  private computeBookingMetrics(chronicleData: any[], shipmentIds: string[]): {
    rolloverRate: number | null;
    amendmentRate: number | null;
  } {
    if (shipmentIds.length === 0) {
      return { rolloverRate: null, amendmentRate: null };
    }

    // Count rollovers
    const rolloverIssues = chronicleData.filter(d =>
      d.has_issue && ['rollover', 'rolled', 'vessel_change'].includes(d.issue_type?.toLowerCase())
    );
    const shipmentsWithRollover = new Set(rolloverIssues.map(d => d.shipment_id));
    const rolloverRate = Math.round(shipmentsWithRollover.size / shipmentIds.length * 100);

    // Count amendments
    const amendments = chronicleData.filter(d =>
      ['booking_amendment', 'amendment', 'schedule_change'].includes(d.document_type?.toLowerCase())
    );
    const shipmentsWithAmendment = new Set(amendments.map(d => d.shipment_id));
    const amendmentRate = Math.round(shipmentsWithAmendment.size / shipmentIds.length * 100);

    return { rolloverRate, amendmentRate };
  }

  /**
   * Compute issue metrics
   */
  private computeIssueMetrics(chronicleData: any[], shipmentIds: string[]): {
    issueRate: number | null;
    commonIssueTypes: string[];
    docIssueRate: number | null;
  } {
    if (shipmentIds.length === 0) {
      return { issueRate: null, commonIssueTypes: [], docIssueRate: null };
    }

    const shipmentsWithIssues = new Set(chronicleData.filter(d => d.has_issue).map(d => d.shipment_id));
    const issueRate = Math.round(shipmentsWithIssues.size / shipmentIds.length * 100);

    const issueTypes = chronicleData.filter(d => d.has_issue && d.issue_type).map(d => d.issue_type);
    const typeCounts = issueTypes.reduce((acc, t) => {
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const commonIssueTypes = Object.entries(typeCounts)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 3)
      .map(([type]) => type);

    // Documentation issues
    const docIssueTypes = ['documentation', 'missing_docs', 'bl_issue', 'wrong_data'];
    const shipmentsWithDocIssues = new Set(
      chronicleData.filter(d => d.has_issue && docIssueTypes.includes(d.issue_type?.toLowerCase())).map(d => d.shipment_id)
    );
    const docIssueRate = Math.round(shipmentsWithDocIssues.size / shipmentIds.length * 100);

    return { issueRate, commonIssueTypes, docIssueRate };
  }

  /**
   * Compute route metrics
   */
  private computeRouteMetrics(shipments: any[]): {
    commonRoutes: Array<{ pol: string; pod: string; count: number }>;
  } {
    const routeCounts = shipments.reduce((acc, s) => {
      if (s.port_of_loading_code && s.port_of_discharge_code) {
        const key = `${s.port_of_loading_code}-${s.port_of_discharge_code}`;
        acc[key] = acc[key] || { pol: s.port_of_loading_code, pod: s.port_of_discharge_code, count: 0 };
        acc[key].count++;
      }
      return acc;
    }, {} as Record<string, { pol: string; pod: string; count: number }>);

    const commonRoutes = (Object.values(routeCounts) as Array<{ pol: string; pod: string; count: number }>)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return { commonRoutes };
  }

  /**
   * Compute performance score (0-100, higher = better)
   */
  private computePerformanceScore(metrics: {
    onTimeDepartureRate: number | null;
    onTimeArrivalRate: number | null;
    rolloverRate: number | null;
    issueRate: number | null;
    totalShipments: number;
  }): { performanceScore: number; performanceFactors: string[] } {
    let score = 50; // Start at neutral
    const factors: string[] = [];

    // On-time departure (max +25 or -25)
    if (metrics.onTimeDepartureRate !== null) {
      if (metrics.onTimeDepartureRate >= 90) {
        score += 25;
        factors.push('excellent_departure_reliability');
      } else if (metrics.onTimeDepartureRate >= 75) {
        score += 15;
        factors.push('good_departure_reliability');
      } else if (metrics.onTimeDepartureRate < 60) {
        score -= 20;
        factors.push('poor_departure_reliability');
      }
    }

    // On-time arrival (max +25 or -25)
    if (metrics.onTimeArrivalRate !== null) {
      if (metrics.onTimeArrivalRate >= 85) {
        score += 25;
        factors.push('excellent_arrival_reliability');
      } else if (metrics.onTimeArrivalRate >= 70) {
        score += 15;
        factors.push('good_arrival_reliability');
      } else if (metrics.onTimeArrivalRate < 50) {
        score -= 20;
        factors.push('poor_arrival_reliability');
      }
    }

    // Rollover rate (penalty only)
    if (metrics.rolloverRate !== null && metrics.rolloverRate > 10) {
      score -= metrics.rolloverRate > 25 ? 20 : 10;
      factors.push('rollover_risk');
    }

    // Issue rate (penalty only)
    if (metrics.issueRate !== null && metrics.issueRate > 25) {
      score -= metrics.issueRate > 40 ? 15 : 10;
      factors.push('high_issue_rate');
    }

    // Limited data penalty
    if (metrics.totalShipments < 10) {
      factors.push('limited_data');
    }

    return { performanceScore: Math.max(0, Math.min(100, score)), performanceFactors: factors };
  }

  /**
   * Generate human-readable insights
   */
  generateInsights(profile: CarrierProfile): CarrierInsight[] {
    const insights: CarrierInsight[] = [];

    // Schedule reliability
    if (profile.onTimeDepartureRate !== null) {
      if (profile.onTimeDepartureRate >= 85) {
        insights.push({
          type: 'positive',
          message: `✅ RELIABLE DEPARTURES: ${profile.onTimeDepartureRate}% on-time`,
        });
      } else if (profile.onTimeDepartureRate < 70) {
        insights.push({
          type: 'warning',
          message: `⚠️ DEPARTURE DELAYS: Only ${profile.onTimeDepartureRate}% on-time`,
        });
      }
    }

    if (profile.onTimeArrivalRate !== null && profile.onTimeArrivalRate < 65) {
      insights.push({
        type: 'warning',
        message: `⚠️ ARRIVAL DELAYS: Only ${profile.onTimeArrivalRate}% on-time (avg ${profile.avgArrivalDelayDays} days late)`,
      });
    }

    // Rollover risk
    if (profile.rolloverRate !== null && profile.rolloverRate > 15) {
      insights.push({
        type: 'warning',
        message: `⚠️ ROLLOVER RISK: ${profile.rolloverRate}% of bookings get rolled`,
      });
    }

    // Performance score
    if (profile.performanceScore >= 75) {
      insights.push({
        type: 'positive',
        message: `🟢 HIGH PERFORMER (score ${profile.performanceScore}/100)`,
      });
    } else if (profile.performanceScore < 40) {
      insights.push({
        type: 'critical',
        message: `🔴 LOW PERFORMER (score ${profile.performanceScore}/100): ${profile.performanceFactors.join(', ')}`,
      });
    } else {
      insights.push({
        type: 'warning',
        message: `🟡 AVERAGE PERFORMER (score ${profile.performanceScore}/100)`,
      });
    }

    return insights;
  }

  /**
   * Save profile to database
   */
  async saveProfile(profile: CarrierProfile): Promise<void> {
    await this.supabase.from('carrier_profiles').upsert(
      {
        carrier_name: profile.carrierName,
        carrier_name_normalized: profile.carrierNameNormalized,
        total_shipments: profile.totalShipments,
        shipments_last_90_days: profile.shipmentsLast90Days,
        shipments_last_30_days: profile.shipmentsLast30Days,
        active_shipments: profile.activeShipments,
        on_time_departure_rate: profile.onTimeDepartureRate,
        on_time_arrival_rate: profile.onTimeArrivalRate,
        avg_departure_delay_days: profile.avgDepartureDelayDays,
        avg_arrival_delay_days: profile.avgArrivalDelayDays,
        rollover_rate: profile.rolloverRate,
        amendment_rate: profile.amendmentRate,
        issue_rate: profile.issueRate,
        common_issue_types: profile.commonIssueTypes,
        doc_issue_rate: profile.docIssueRate,
        common_routes: profile.commonRoutes,
        performance_score: profile.performanceScore,
        performance_factors: profile.performanceFactors,
        computed_at: new Date().toISOString(),
        sample_size: profile.totalShipments,
      },
      { onConflict: 'carrier_name_normalized' }
    );
  }

  /**
   * Get profile for a carrier (flexible matching)
   */
  async getProfile(carrierName: string): Promise<CarrierProfile | null> {
    const cleanName = carrierName
      .toLowerCase()
      .trim()
      .replace(/shipping\s*(line)?/gi, '')
      .replace(/container\s*(line)?/gi, '')
      .replace(/\(.*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const searchWord = cleanName.split(' ').filter(w => w.length > 2)[0];
    if (!searchWord) return null;

    const { data } = await this.supabase
      .from('carrier_profiles')
      .select('*')
      .ilike('carrier_name_normalized', `%${searchWord}%`)
      .order('total_shipments', { ascending: false })
      .limit(1);

    const profile = data?.[0];
    if (!profile) return null;

    return {
      carrierName: profile.carrier_name,
      carrierNameNormalized: profile.carrier_name_normalized,
      totalShipments: profile.total_shipments,
      shipmentsLast90Days: profile.shipments_last_90_days,
      shipmentsLast30Days: profile.shipments_last_30_days,
      activeShipments: profile.active_shipments,
      onTimeDepartureRate: profile.on_time_departure_rate ? parseFloat(profile.on_time_departure_rate) : null,
      onTimeArrivalRate: profile.on_time_arrival_rate ? parseFloat(profile.on_time_arrival_rate) : null,
      avgDepartureDelayDays: profile.avg_departure_delay_days ? parseFloat(profile.avg_departure_delay_days) : null,
      avgArrivalDelayDays: profile.avg_arrival_delay_days ? parseFloat(profile.avg_arrival_delay_days) : null,
      rolloverRate: profile.rollover_rate ? parseFloat(profile.rollover_rate) : null,
      amendmentRate: profile.amendment_rate ? parseFloat(profile.amendment_rate) : null,
      issueRate: profile.issue_rate ? parseFloat(profile.issue_rate) : null,
      commonIssueTypes: profile.common_issue_types || [],
      docIssueRate: profile.doc_issue_rate ? parseFloat(profile.doc_issue_rate) : null,
      commonRoutes: profile.common_routes || [],
      performanceScore: profile.performance_score || 50,
      performanceFactors: profile.performance_factors || [],
    };
  }
}
