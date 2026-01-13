/**
 * Consignee Profile Service
 *
 * Computes destination-side behavior patterns:
 * - Pickup/detention patterns
 * - Customs clearance speed
 * - Issue patterns at destination
 * - Risk scoring
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

export interface ConsigneeProfile {
  consigneeName: string;
  consigneeNameNormalized: string;
  totalShipments: number;
  shipmentsLast90Days: number;
  shipmentsLast30Days: number;
  activeShipments: number;
  avgDaysToPickup: number | null;
  detentionRate: number | null;
  demurrageRate: number | null;
  customsIssueRate: number | null;
  avgCustomsClearanceDays: number | null;
  issueRate: number | null;
  commonIssueTypes: string[];
  commonPorts: string[];
  preferredCarriers: string[];
  riskScore: number;
  riskFactors: string[];
  firstShipmentDate: string | null;
  lastShipmentDate: string | null;
  relationshipMonths: number;
}

export interface ConsigneeInsight {
  type: 'positive' | 'warning' | 'critical';
  message: string;
}

// ============================================================================
// SERVICE
// ============================================================================

export class ConsigneeProfileService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Normalize consignee name for matching
   */
  private normalizeConsigneeName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/pvt\.?\s*ltd\.?/gi, 'private limited')
      .replace(/p\.?\s*ltd\.?/gi, 'private limited')
      .replace(/llp/gi, 'llp')
      .replace(/inc\.?/gi, 'inc')
      .replace(/corp\.?/gi, 'corporation')
      .replace(/co\.?\s*$/gi, 'company')
      .replace(/[.,]/g, '');
  }

  /**
   * Compute full profile for a consignee
   */
  async computeProfile(consigneeName: string): Promise<ConsigneeProfile> {
    const normalized = this.normalizeConsigneeName(consigneeName);

    // Get all chronicle records for this consignee
    const { data: chronicleData } = await this.supabase
      .from('chronicle')
      .select(`
        shipment_id, document_type, occurred_at,
        has_issue, issue_type, issue_description,
        carrier_name, pod_location
      `)
      .ilike('consignee_name', `%${consigneeName}%`)
      .not('shipment_id', 'is', null);

    const shipmentIds = [...new Set((chronicleData || []).map(d => d.shipment_id))];

    // Get shipment details
    const { data: shipments } = await this.supabase
      .from('shipments')
      .select(`
        id, booking_number, carrier_name,
        port_of_discharge_code, port_of_discharge,
        eta, ata, stage, status, created_at
      `)
      .in('id', shipmentIds.length > 0 ? shipmentIds : ['none']);

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

    // Issue metrics
    const issueMetrics = this.computeIssueMetrics(chronicleData || []);

    // Destination metrics (detention, demurrage, customs)
    const destinationMetrics = await this.computeDestinationMetrics(shipmentIds, chronicleData || []);

    // Preferences
    const preferenceMetrics = this.computePreferenceMetrics(shipments || []);

    // Risk score
    const { riskScore, riskFactors } = this.computeRiskScore({
      detentionRate: destinationMetrics.detentionRate,
      demurrageRate: destinationMetrics.demurrageRate,
      customsIssueRate: destinationMetrics.customsIssueRate,
      issueRate: issueMetrics.issueRate,
      totalShipments,
    });

    // Relationship dates
    const dates = (shipments || []).map(s => new Date(s.created_at)).sort((a, b) => a.getTime() - b.getTime());
    const firstShipmentDate = dates[0]?.toISOString().split('T')[0] || null;
    const lastShipmentDate = dates[dates.length - 1]?.toISOString().split('T')[0] || null;
    const relationshipMonths = firstShipmentDate
      ? Math.floor((now.getTime() - new Date(firstShipmentDate).getTime()) / (30 * 24 * 60 * 60 * 1000))
      : 0;

    return {
      consigneeName,
      consigneeNameNormalized: normalized,
      totalShipments,
      shipmentsLast90Days,
      shipmentsLast30Days,
      activeShipments,
      ...destinationMetrics,
      ...issueMetrics,
      ...preferenceMetrics,
      riskScore,
      riskFactors,
      firstShipmentDate,
      lastShipmentDate,
      relationshipMonths,
    };
  }

  /**
   * Compute destination-specific metrics
   */
  private async computeDestinationMetrics(
    shipmentIds: string[],
    chronicleData: any[]
  ): Promise<{
    avgDaysToPickup: number | null;
    detentionRate: number | null;
    demurrageRate: number | null;
    customsIssueRate: number | null;
    avgCustomsClearanceDays: number | null;
  }> {
    if (shipmentIds.length === 0) {
      return {
        avgDaysToPickup: null,
        detentionRate: null,
        demurrageRate: null,
        customsIssueRate: null,
        avgCustomsClearanceDays: null,
      };
    }

    // Count detention/demurrage issues
    const detentionIssues = chronicleData.filter(d =>
      d.has_issue && ['detention', 'container_detention'].includes(d.issue_type?.toLowerCase())
    );
    const demurrageIssues = chronicleData.filter(d =>
      d.has_issue && ['demurrage', 'port_storage'].includes(d.issue_type?.toLowerCase())
    );
    const customsIssues = chronicleData.filter(d =>
      d.has_issue && ['customs', 'customs_hold', 'customs_clearance', 'hold'].includes(d.issue_type?.toLowerCase())
    );

    const shipmentCount = shipmentIds.length;
    const detentionRate = shipmentCount > 0
      ? Math.round(new Set(detentionIssues.map(d => d.shipment_id)).size / shipmentCount * 100)
      : null;
    const demurrageRate = shipmentCount > 0
      ? Math.round(new Set(demurrageIssues.map(d => d.shipment_id)).size / shipmentCount * 100)
      : null;
    const customsIssueRate = shipmentCount > 0
      ? Math.round(new Set(customsIssues.map(d => d.shipment_id)).size / shipmentCount * 100)
      : null;

    return {
      avgDaysToPickup: null, // Would need delivery confirmation data
      detentionRate,
      demurrageRate,
      customsIssueRate,
      avgCustomsClearanceDays: null, // Would need customs clearance timestamps
    };
  }

  /**
   * Compute issue metrics
   */
  private computeIssueMetrics(data: any[]): {
    issueRate: number | null;
    commonIssueTypes: string[];
  } {
    const shipmentIds = [...new Set(data.map(d => d.shipment_id))];
    if (shipmentIds.length === 0) {
      return { issueRate: null, commonIssueTypes: [] };
    }

    const shipmentsWithIssues = new Set(data.filter(d => d.has_issue).map(d => d.shipment_id));
    const issueRate = Math.round(shipmentsWithIssues.size / shipmentIds.length * 100);

    const issueTypes = data.filter(d => d.has_issue && d.issue_type).map(d => d.issue_type);
    const typeCounts = issueTypes.reduce((acc, t) => {
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const commonIssueTypes = Object.entries(typeCounts)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 3)
      .map(([type]) => type);

    return { issueRate, commonIssueTypes };
  }

  /**
   * Compute preference metrics
   */
  private computePreferenceMetrics(shipments: any[]): {
    commonPorts: string[];
    preferredCarriers: string[];
  } {
    // Common ports
    const portCounts = shipments.reduce((acc, s) => {
      if (s.port_of_discharge_code) {
        acc[s.port_of_discharge_code] = (acc[s.port_of_discharge_code] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);
    const commonPorts = Object.entries(portCounts)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 3)
      .map(([port]) => port);

    // Carrier preferences
    const carrierCounts = shipments.reduce((acc, s) => {
      if (s.carrier_name) {
        acc[s.carrier_name] = (acc[s.carrier_name] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);
    const preferredCarriers = Object.entries(carrierCounts)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 3)
      .map(([carrier]) => carrier);

    return { commonPorts, preferredCarriers };
  }

  /**
   * Compute risk score (0-100, higher = more risky)
   */
  private computeRiskScore(metrics: {
    detentionRate: number | null;
    demurrageRate: number | null;
    customsIssueRate: number | null;
    issueRate: number | null;
    totalShipments: number;
  }): { riskScore: number; riskFactors: string[] } {
    let score = 0;
    const factors: string[] = [];

    if (metrics.detentionRate !== null && metrics.detentionRate > 15) {
      score += metrics.detentionRate > 30 ? 30 : 20;
      factors.push('detention_risk');
    }
    if (metrics.demurrageRate !== null && metrics.demurrageRate > 15) {
      score += metrics.demurrageRate > 30 ? 25 : 15;
      factors.push('demurrage_risk');
    }
    if (metrics.customsIssueRate !== null && metrics.customsIssueRate > 20) {
      score += metrics.customsIssueRate > 40 ? 25 : 15;
      factors.push('customs_issues');
    }
    if (metrics.issueRate !== null && metrics.issueRate > 30) {
      score += metrics.issueRate > 50 ? 20 : 10;
      factors.push('high_issue_rate');
    }
    if (metrics.totalShipments < 5) {
      score += 10;
      factors.push('limited_history');
    }

    return { riskScore: Math.min(100, score), riskFactors: factors };
  }

  /**
   * Generate human-readable insights
   */
  generateInsights(profile: ConsigneeProfile): ConsigneeInsight[] {
    const insights: ConsigneeInsight[] = [];

    if (profile.detentionRate !== null && profile.detentionRate > 20) {
      insights.push({
        type: 'warning',
        message: `⚠️ DETENTION RISK: ${profile.detentionRate}% of shipments have detention charges`,
      });
    }

    if (profile.demurrageRate !== null && profile.demurrageRate > 15) {
      insights.push({
        type: 'warning',
        message: `⚠️ DEMURRAGE RISK: ${profile.demurrageRate}% of shipments incur demurrage`,
      });
    }

    if (profile.customsIssueRate !== null && profile.customsIssueRate > 20) {
      insights.push({
        type: 'warning',
        message: `⚠️ CUSTOMS RISK: ${profile.customsIssueRate}% of shipments have customs issues`,
      });
    }

    if (profile.riskScore >= 50) {
      insights.push({
        type: 'critical',
        message: `🔴 HIGH RISK CONSIGNEE (score ${profile.riskScore}/100): ${profile.riskFactors.join(', ')}`,
      });
    } else if (profile.riskScore >= 25) {
      insights.push({
        type: 'warning',
        message: `🟡 MODERATE RISK CONSIGNEE (score ${profile.riskScore}/100)`,
      });
    } else if (profile.totalShipments >= 10) {
      insights.push({
        type: 'positive',
        message: `🟢 LOW RISK CONSIGNEE (score ${profile.riskScore}/100)`,
      });
    }

    if (profile.totalShipments >= 20) {
      insights.push({
        type: 'positive',
        message: `📊 ESTABLISHED: ${profile.totalShipments} shipments over ${profile.relationshipMonths} months`,
      });
    } else if (profile.totalShipments < 5) {
      insights.push({
        type: 'warning',
        message: `📊 NEW CONSIGNEE: Only ${profile.totalShipments} shipments in history`,
      });
    }

    return insights;
  }

  /**
   * Save profile to database
   */
  async saveProfile(profile: ConsigneeProfile): Promise<void> {
    await this.supabase.from('consignee_profiles').upsert(
      {
        consignee_name: profile.consigneeName,
        consignee_name_normalized: profile.consigneeNameNormalized,
        total_shipments: profile.totalShipments,
        shipments_last_90_days: profile.shipmentsLast90Days,
        shipments_last_30_days: profile.shipmentsLast30Days,
        active_shipments: profile.activeShipments,
        avg_days_to_pickup: profile.avgDaysToPickup,
        detention_rate: profile.detentionRate,
        demurrage_rate: profile.demurrageRate,
        customs_issue_rate: profile.customsIssueRate,
        avg_customs_clearance_days: profile.avgCustomsClearanceDays,
        issue_rate: profile.issueRate,
        common_issue_types: profile.commonIssueTypes,
        common_ports: profile.commonPorts,
        preferred_carriers: profile.preferredCarriers,
        risk_score: profile.riskScore,
        risk_factors: profile.riskFactors,
        first_shipment_date: profile.firstShipmentDate,
        last_shipment_date: profile.lastShipmentDate,
        relationship_months: profile.relationshipMonths,
        computed_at: new Date().toISOString(),
        sample_size: profile.totalShipments,
      },
      { onConflict: 'consignee_name_normalized' }
    );
  }

  /**
   * Get profile for a consignee (flexible matching)
   */
  async getProfile(consigneeName: string): Promise<ConsigneeProfile | null> {
    const cleanName = consigneeName
      .toLowerCase()
      .trim()
      .replace(/pvt\.?\s*ltd\.?/gi, '')
      .replace(/p\.?\s*ltd\.?/gi, '')
      .replace(/private\s*limited/gi, '')
      .replace(/limited/gi, '')
      .replace(/llp/gi, '')
      .replace(/inc\.?/gi, '')
      .replace(/[.,]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const searchWord = cleanName.split(' ').filter(w => w.length > 2)[0];
    if (!searchWord) return null;

    const { data } = await this.supabase
      .from('consignee_profiles')
      .select('*')
      .ilike('consignee_name_normalized', `%${searchWord}%`)
      .order('total_shipments', { ascending: false })
      .limit(1);

    const profile = data?.[0];
    if (!profile) return null;

    return {
      consigneeName: profile.consignee_name,
      consigneeNameNormalized: profile.consignee_name_normalized,
      totalShipments: profile.total_shipments,
      shipmentsLast90Days: profile.shipments_last_90_days,
      shipmentsLast30Days: profile.shipments_last_30_days,
      activeShipments: profile.active_shipments,
      avgDaysToPickup: profile.avg_days_to_pickup ? parseFloat(profile.avg_days_to_pickup) : null,
      detentionRate: profile.detention_rate ? parseFloat(profile.detention_rate) : null,
      demurrageRate: profile.demurrage_rate ? parseFloat(profile.demurrage_rate) : null,
      customsIssueRate: profile.customs_issue_rate ? parseFloat(profile.customs_issue_rate) : null,
      avgCustomsClearanceDays: profile.avg_customs_clearance_days ? parseFloat(profile.avg_customs_clearance_days) : null,
      issueRate: profile.issue_rate ? parseFloat(profile.issue_rate) : null,
      commonIssueTypes: profile.common_issue_types || [],
      commonPorts: profile.common_ports || [],
      preferredCarriers: profile.preferred_carriers || [],
      riskScore: profile.risk_score || 0,
      riskFactors: profile.risk_factors || [],
      firstShipmentDate: profile.first_shipment_date,
      lastShipmentDate: profile.last_shipment_date,
      relationshipMonths: profile.relationship_months || 0,
    };
  }
}
