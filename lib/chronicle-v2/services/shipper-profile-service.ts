/**
 * ShipperProfileService - Cross-Shipment Intelligence
 *
 * Computes behavioral patterns for shippers based on historical data.
 * Enables predictive insights like "This shipper typically delays SI by 2 days".
 *
 * Data sources:
 * - Chronicle: SI submissions, document issues, communication patterns
 * - Shipments: Volume, routes, cutoffs, stages
 */

import { SupabaseClient } from '@supabase/supabase-js';

// =============================================================================
// TYPES
// =============================================================================

export interface ShipperProfile {
  shipperName: string;
  shipperNameNormalized: string;
  aliases: string[];

  // Volume
  totalShipments: number;
  shipmentsLast90Days: number;
  shipmentsLast30Days: number;
  activeShipments: number;

  // SI Behavior
  avgSiDaysBeforeCutoff: number | null;
  siLateRate: number | null;
  siAmendmentRate: number | null;

  // Documentation
  docIssueRate: number | null;
  commonDocIssues: string[];
  avgDocResolutionDays: number | null;

  // Communication
  avgResponseHours: number | null;
  escalationRate: number | null;

  // Issues
  issueRate: number | null;
  commonIssueTypes: string[];

  // Routes
  preferredCarriers: string[];
  commonRoutes: Array<{ pol: string; pod: string; count: number }>;

  // Risk
  riskScore: number;
  riskFactors: string[];

  // Relationship
  firstShipmentDate: string | null;
  lastShipmentDate: string | null;
  relationshipMonths: number;

  // Meta
  computedAt: string;
  sampleSize: number;
}

export interface ShipperInsight {
  type: 'warning' | 'info' | 'positive';
  category: 'si_behavior' | 'documentation' | 'communication' | 'volume' | 'risk';
  message: string;
  metric?: string;
  benchmark?: string;
}

// =============================================================================
// SERVICE
// =============================================================================

export class ShipperProfileService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Normalize shipper name for matching
   */
  private normalizeShipperName(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/pvt\.?\s*ltd\.?/gi, 'private limited')
      .replace(/p\.?\s*ltd\.?/gi, 'private limited')
      .replace(/llp/gi, 'llp')
      .replace(/inc\.?/gi, 'inc')
      .replace(/[.,]/g, '');
  }

  /**
   * Find shipper profile by name (with fuzzy matching)
   */
  async findProfile(shipperName: string): Promise<ShipperProfile | null> {
    const normalized = this.normalizeShipperName(shipperName);

    // Try exact match first
    const { data: exact } = await this.supabase
      .from('shipper_profiles')
      .select('*')
      .eq('shipper_name_normalized', normalized)
      .single();

    if (exact) return this.mapToProfile(exact);

    // Try alias match
    const { data: alias } = await this.supabase
      .from('shipper_profiles')
      .select('*')
      .contains('shipper_aliases', [shipperName])
      .single();

    if (alias) return this.mapToProfile(alias);

    // Try partial match (for variations)
    const { data: partial } = await this.supabase
      .from('shipper_profiles')
      .select('*')
      .ilike('shipper_name_normalized', `%${normalized.split(' ')[0]}%`)
      .limit(1)
      .single();

    return partial ? this.mapToProfile(partial) : null;
  }

  /**
   * Compute profile for a shipper from raw data
   */
  async computeProfile(shipperName: string): Promise<ShipperProfile> {
    const normalized = this.normalizeShipperName(shipperName);

    // Get all shipments for this shipper (from HBL documents)
    const { data: shipmentData } = await this.supabase
      .from('chronicle')
      .select(`
        shipment_id,
        document_type,
        occurred_at,
        has_issue,
        issue_type,
        has_action,
        action_completed_at,
        carrier_name,
        pol_location,
        pod_location,
        si_cutoff
      `)
      .or(`shipper_name.ilike.%${shipperName}%,shipper_name.ilike.%${normalized}%`)
      .not('shipment_id', 'is', null);

    // Get unique shipment IDs
    const shipmentIds = [...new Set((shipmentData || []).map(d => d.shipment_id))];

    // Get shipment details
    const { data: shipments } = await this.supabase
      .from('shipments')
      .select(`
        id, booking_number, carrier_name,
        port_of_loading_code, port_of_discharge_code,
        etd, eta, si_cutoff, stage, status,
        created_at
      `)
      .in('id', shipmentIds.length > 0 ? shipmentIds : ['none']);

    // Compute metrics
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

    // SI Behavior analysis
    const siMetrics = await this.computeSiMetrics(shipmentIds);

    // Issue analysis
    const issueMetrics = this.computeIssueMetrics(shipmentData || []);

    // Route analysis
    const routeMetrics = this.computeRouteMetrics(shipments || []);

    // Risk score
    const { riskScore, riskFactors } = this.computeRiskScore({
      siLateRate: siMetrics.siLateRate,
      docIssueRate: issueMetrics.docIssueRate,
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
      shipperName,
      shipperNameNormalized: normalized,
      aliases: [],
      totalShipments,
      shipmentsLast90Days,
      shipmentsLast30Days,
      activeShipments,
      ...siMetrics,
      ...issueMetrics,
      avgResponseHours: null, // TODO: Compute from thread analysis
      escalationRate: null,
      ...routeMetrics,
      riskScore,
      riskFactors,
      firstShipmentDate,
      lastShipmentDate,
      relationshipMonths,
      computedAt: new Date().toISOString(),
      sampleSize: totalShipments,
    };
  }

  /**
   * Compute SI submission metrics
   */
  private async computeSiMetrics(shipmentIds: string[]): Promise<{
    avgSiDaysBeforeCutoff: number | null;
    siLateRate: number | null;
    siAmendmentRate: number | null;
  }> {
    if (shipmentIds.length === 0) {
      return { avgSiDaysBeforeCutoff: null, siLateRate: null, siAmendmentRate: null };
    }

    // Get SI submissions and cutoffs
    const { data: siDocs } = await this.supabase
      .from('chronicle')
      .select('shipment_id, occurred_at, document_type')
      .in('shipment_id', shipmentIds)
      .in('document_type', ['shipping_instructions', 'si_confirmation']);

    const { data: shipments } = await this.supabase
      .from('shipments')
      .select('id, si_cutoff')
      .in('id', shipmentIds)
      .not('si_cutoff', 'is', null);

    if (!siDocs || !shipments || shipments.length === 0) {
      return { avgSiDaysBeforeCutoff: null, siLateRate: null, siAmendmentRate: null };
    }

    const cutoffMap = new Map(shipments.map(s => [s.id, new Date(s.si_cutoff)]));
    const daysBeforeCutoff: number[] = [];
    let lateCount = 0;

    for (const doc of siDocs.filter(d => d.document_type === 'shipping_instructions')) {
      const cutoff = cutoffMap.get(doc.shipment_id);
      if (cutoff) {
        const siDate = new Date(doc.occurred_at);
        const daysBefore = (cutoff.getTime() - siDate.getTime()) / (24 * 60 * 60 * 1000);
        daysBeforeCutoff.push(daysBefore);
        if (daysBefore < 0) lateCount++;
      }
    }

    const avgSiDaysBeforeCutoff = daysBeforeCutoff.length > 0
      ? Math.round(daysBeforeCutoff.reduce((a, b) => a + b, 0) / daysBeforeCutoff.length * 10) / 10
      : null;

    const siLateRate = daysBeforeCutoff.length > 0
      ? Math.round(lateCount / daysBeforeCutoff.length * 100)
      : null;

    // Amendment rate (SI confirmation after SI submission)
    const siByShipment = new Map<string, Date[]>();
    for (const doc of siDocs) {
      const dates = siByShipment.get(doc.shipment_id) || [];
      dates.push(new Date(doc.occurred_at));
      siByShipment.set(doc.shipment_id, dates);
    }
    const amendmentCount = [...siByShipment.values()].filter(dates => dates.length > 1).length;
    const siAmendmentRate = siByShipment.size > 0
      ? Math.round(amendmentCount / siByShipment.size * 100)
      : null;

    return { avgSiDaysBeforeCutoff, siLateRate, siAmendmentRate };
  }

  /**
   * Compute issue metrics from chronicle data
   */
  private computeIssueMetrics(data: any[]): {
    docIssueRate: number | null;
    commonDocIssues: string[];
    avgDocResolutionDays: number | null;
    issueRate: number | null;
    commonIssueTypes: string[];
  } {
    const shipmentIds = [...new Set(data.map(d => d.shipment_id))];
    if (shipmentIds.length === 0) {
      return {
        docIssueRate: null,
        commonDocIssues: [],
        avgDocResolutionDays: null,
        issueRate: null,
        commonIssueTypes: [],
      };
    }

    // Shipments with issues
    const shipmentsWithIssues = new Set(data.filter(d => d.has_issue).map(d => d.shipment_id));
    const issueRate = Math.round(shipmentsWithIssues.size / shipmentIds.length * 100);

    // Issue types
    const issueTypes = data
      .filter(d => d.has_issue && d.issue_type)
      .map(d => d.issue_type);
    const typeCounts = issueTypes.reduce((acc, t) => {
      acc[t] = (acc[t] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const commonIssueTypes = Object.entries(typeCounts)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 3)
      .map(([type]) => type);

    // Doc issues specifically
    const docIssueTypes = ['documentation', 'missing_docs', 'wrong_weight'];
    const shipmentsWithDocIssues = new Set(
      data.filter(d => d.has_issue && docIssueTypes.includes(d.issue_type)).map(d => d.shipment_id)
    );
    const docIssueRate = Math.round(shipmentsWithDocIssues.size / shipmentIds.length * 100);

    return {
      docIssueRate,
      commonDocIssues: commonIssueTypes.filter(t => docIssueTypes.includes(t)),
      avgDocResolutionDays: null, // TODO: Compute from action resolution timestamps
      issueRate,
      commonIssueTypes,
    };
  }

  /**
   * Compute route and carrier preferences
   */
  private computeRouteMetrics(shipments: any[]): {
    preferredCarriers: string[];
    commonRoutes: Array<{ pol: string; pod: string; count: number }>;
  } {
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

    // Common routes
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

    return { preferredCarriers, commonRoutes };
  }

  /**
   * Compute risk score (0-100)
   */
  private computeRiskScore(metrics: {
    siLateRate: number | null;
    docIssueRate: number | null;
    issueRate: number | null;
    totalShipments: number;
  }): { riskScore: number; riskFactors: string[] } {
    let score = 0;
    const factors: string[] = [];

    // SI late rate (0-30 points)
    if (metrics.siLateRate !== null) {
      if (metrics.siLateRate > 50) {
        score += 30;
        factors.push('high_si_late_rate');
      } else if (metrics.siLateRate > 25) {
        score += 20;
        factors.push('moderate_si_late_rate');
      } else if (metrics.siLateRate > 10) {
        score += 10;
      }
    }

    // Doc issue rate (0-25 points)
    if (metrics.docIssueRate !== null) {
      if (metrics.docIssueRate > 40) {
        score += 25;
        factors.push('high_doc_issues');
      } else if (metrics.docIssueRate > 20) {
        score += 15;
        factors.push('moderate_doc_issues');
      } else if (metrics.docIssueRate > 10) {
        score += 5;
      }
    }

    // General issue rate (0-25 points)
    if (metrics.issueRate !== null) {
      if (metrics.issueRate > 50) {
        score += 25;
        factors.push('high_issue_rate');
      } else if (metrics.issueRate > 30) {
        score += 15;
      } else if (metrics.issueRate > 15) {
        score += 5;
      }
    }

    // New shipper penalty (0-20 points)
    if (metrics.totalShipments < 3) {
      score += 20;
      factors.push('new_shipper');
    } else if (metrics.totalShipments < 10) {
      score += 10;
      factors.push('limited_history');
    }

    return { riskScore: Math.min(100, score), riskFactors: factors };
  }

  /**
   * Generate human-readable insights for a shipper
   */
  generateInsights(profile: ShipperProfile): ShipperInsight[] {
    const insights: ShipperInsight[] = [];

    // SI behavior
    if (profile.avgSiDaysBeforeCutoff !== null) {
      if (profile.avgSiDaysBeforeCutoff < 0) {
        insights.push({
          type: 'warning',
          category: 'si_behavior',
          message: `Typically submits SI ${Math.abs(profile.avgSiDaysBeforeCutoff).toFixed(1)} days AFTER cutoff`,
          metric: `${profile.siLateRate}% late rate`,
        });
      } else if (profile.avgSiDaysBeforeCutoff < 1) {
        insights.push({
          type: 'warning',
          category: 'si_behavior',
          message: 'Submits SI very close to cutoff - proactive follow-up recommended',
          metric: `Avg ${profile.avgSiDaysBeforeCutoff.toFixed(1)} days before cutoff`,
        });
      } else if (profile.avgSiDaysBeforeCutoff > 3) {
        insights.push({
          type: 'positive',
          category: 'si_behavior',
          message: 'Reliable SI submission - usually well before cutoff',
          metric: `Avg ${profile.avgSiDaysBeforeCutoff.toFixed(1)} days before cutoff`,
        });
      }
    }

    // Documentation issues
    if (profile.docIssueRate !== null && profile.docIssueRate > 20) {
      insights.push({
        type: 'warning',
        category: 'documentation',
        message: `High documentation issue rate - verify docs carefully`,
        metric: `${profile.docIssueRate}% of shipments have doc issues`,
      });
    }

    // Volume context
    if (profile.totalShipments >= 20) {
      insights.push({
        type: 'info',
        category: 'volume',
        message: `Established shipper with ${profile.totalShipments} shipments over ${profile.relationshipMonths} months`,
      });
    } else if (profile.totalShipments < 5) {
      insights.push({
        type: 'info',
        category: 'volume',
        message: `New shipper - limited history (${profile.totalShipments} shipments)`,
      });
    }

    // Active shipments
    if (profile.activeShipments > 3) {
      insights.push({
        type: 'info',
        category: 'volume',
        message: `${profile.activeShipments} active shipments currently - high-value relationship`,
      });
    }

    // Risk
    if (profile.riskScore >= 50) {
      insights.push({
        type: 'warning',
        category: 'risk',
        message: `High-risk shipper (score: ${profile.riskScore}/100)`,
        metric: profile.riskFactors.join(', '),
      });
    }

    return insights;
  }

  /**
   * Save computed profile to database
   */
  async saveProfile(profile: ShipperProfile): Promise<void> {
    const { error } = await this.supabase.from('shipper_profiles').upsert(
      {
        shipper_name: profile.shipperName,
        shipper_name_normalized: profile.shipperNameNormalized,
        shipper_aliases: profile.aliases,
        total_shipments: profile.totalShipments,
        shipments_last_90_days: profile.shipmentsLast90Days,
        shipments_last_30_days: profile.shipmentsLast30Days,
        active_shipments: profile.activeShipments,
        avg_si_days_before_cutoff: profile.avgSiDaysBeforeCutoff,
        si_late_rate: profile.siLateRate,
        si_amendment_rate: profile.siAmendmentRate,
        doc_issue_rate: profile.docIssueRate,
        common_doc_issues: profile.commonDocIssues,
        avg_doc_resolution_days: profile.avgDocResolutionDays,
        avg_response_hours: profile.avgResponseHours,
        escalation_rate: profile.escalationRate,
        issue_rate: profile.issueRate,
        common_issue_types: profile.commonIssueTypes,
        preferred_carriers: profile.preferredCarriers,
        common_routes: profile.commonRoutes,
        risk_score: profile.riskScore,
        risk_factors: profile.riskFactors,
        first_shipment_date: profile.firstShipmentDate,
        last_shipment_date: profile.lastShipmentDate,
        relationship_months: profile.relationshipMonths,
        computed_at: profile.computedAt,
        sample_size: profile.sampleSize,
      },
      { onConflict: 'shipper_name_normalized' }
    );

    if (error) throw error;
  }

  /**
   * Get or compute profile for a shipper
   */
  async getProfile(shipperName: string, forceRecompute = false): Promise<ShipperProfile | null> {
    if (!shipperName) return null;

    // Check cache first (unless forced recompute)
    if (!forceRecompute) {
      const cached = await this.findProfile(shipperName);
      if (cached) {
        // Check if cache is fresh (< 24 hours)
        const age = Date.now() - new Date(cached.computedAt).getTime();
        if (age < 24 * 60 * 60 * 1000) {
          return cached;
        }
      }
    }

    // Compute fresh profile
    const profile = await this.computeProfile(shipperName);

    // Only save if we have meaningful data
    if (profile.totalShipments > 0) {
      await this.saveProfile(profile);
    }

    return profile;
  }

  /**
   * Map database row to ShipperProfile
   */
  private mapToProfile(row: any): ShipperProfile {
    return {
      shipperName: row.shipper_name,
      shipperNameNormalized: row.shipper_name_normalized,
      aliases: row.shipper_aliases || [],
      totalShipments: row.total_shipments,
      shipmentsLast90Days: row.shipments_last_90_days,
      shipmentsLast30Days: row.shipments_last_30_days,
      activeShipments: row.active_shipments,
      avgSiDaysBeforeCutoff: row.avg_si_days_before_cutoff,
      siLateRate: row.si_late_rate,
      siAmendmentRate: row.si_amendment_rate,
      docIssueRate: row.doc_issue_rate,
      commonDocIssues: row.common_doc_issues || [],
      avgDocResolutionDays: row.avg_doc_resolution_days,
      avgResponseHours: row.avg_response_hours,
      escalationRate: row.escalation_rate,
      issueRate: row.issue_rate,
      commonIssueTypes: row.common_issue_types || [],
      preferredCarriers: row.preferred_carriers || [],
      commonRoutes: row.common_routes || [],
      riskScore: row.risk_score,
      riskFactors: row.risk_factors || [],
      firstShipmentDate: row.first_shipment_date,
      lastShipmentDate: row.last_shipment_date,
      relationshipMonths: row.relationship_months,
      computedAt: row.computed_at,
      sampleSize: row.sample_size,
    };
  }
}
