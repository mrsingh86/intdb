/**
 * Route Profile Service
 *
 * Computes lane-specific intelligence (POL → POD):
 * - Transit time analysis (scheduled vs actual)
 * - Reliability metrics
 * - Carrier performance by route
 * - Common issues on lane
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

export interface RouteProfile {
  polCode: string;
  podCode: string;
  polName: string | null;
  podName: string | null;
  totalShipments: number;
  shipmentsLast90Days: number;
  shipmentsLast30Days: number;
  scheduledTransitDays: number | null;
  actualAvgTransitDays: number | null;
  transitVarianceDays: number | null;
  minTransitDays: number | null;
  maxTransitDays: number | null;
  onTimeRate: number | null;
  delayRate: number | null;
  avgDelayWhenLateDays: number | null;
  issueRate: number | null;
  commonIssueTypes: string[];
  rolloverRate: number | null;
  carrierRankings: Array<{ carrier: string; onTimeRate: number; shipments: number }>;
  bestCarrier: string | null;
  worstCarrier: string | null;
}

export interface RouteInsight {
  type: 'positive' | 'warning' | 'critical' | 'info';
  message: string;
}

// ============================================================================
// SERVICE
// ============================================================================

export class RouteProfileService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Compute profile for a specific route (POL → POD)
   */
  async computeProfile(polCode: string, podCode: string): Promise<RouteProfile> {
    // Get all shipments for this route
    const { data: shipments } = await this.supabase
      .from('shipments')
      .select(`
        id, booking_number, carrier_name,
        port_of_loading, port_of_loading_code,
        port_of_discharge, port_of_discharge_code,
        etd, eta, atd, ata,
        stage, status, created_at
      `)
      .eq('port_of_loading_code', polCode)
      .eq('port_of_discharge_code', podCode);

    const shipmentIds = (shipments || []).map(s => s.id);

    // Get chronicle data for issues
    const { data: chronicleData } = await this.supabase
      .from('chronicle')
      .select(`
        shipment_id, document_type, occurred_at,
        has_issue, issue_type
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

    // Port names
    const polName = shipments?.[0]?.port_of_loading || null;
    const podName = shipments?.[0]?.port_of_discharge || null;

    // Transit time analysis
    const transitMetrics = this.computeTransitMetrics(shipments || []);

    // Issue metrics
    const issueMetrics = this.computeIssueMetrics(chronicleData || [], shipmentIds);

    // Carrier performance on this route
    const carrierMetrics = this.computeCarrierRankings(shipments || []);

    return {
      polCode,
      podCode,
      polName,
      podName,
      totalShipments,
      shipmentsLast90Days,
      shipmentsLast30Days,
      ...transitMetrics,
      ...issueMetrics,
      ...carrierMetrics,
    };
  }

  /**
   * Compute transit time metrics
   */
  private computeTransitMetrics(shipments: any[]): {
    scheduledTransitDays: number | null;
    actualAvgTransitDays: number | null;
    transitVarianceDays: number | null;
    minTransitDays: number | null;
    maxTransitDays: number | null;
    onTimeRate: number | null;
    delayRate: number | null;
    avgDelayWhenLateDays: number | null;
  } {
    if (shipments.length === 0) {
      return {
        scheduledTransitDays: null,
        actualAvgTransitDays: null,
        transitVarianceDays: null,
        minTransitDays: null,
        maxTransitDays: null,
        onTimeRate: null,
        delayRate: null,
        avgDelayWhenLateDays: null,
      };
    }

    const scheduledTransits: number[] = [];
    const actualTransits: number[] = [];
    const delays: number[] = [];
    let onTimeCount = 0;
    let shipmentWithData = 0;

    for (const s of shipments) {
      // Scheduled transit (ETD to ETA)
      if (s.etd && s.eta) {
        const etd = new Date(s.etd);
        const eta = new Date(s.eta);
        const scheduled = (eta.getTime() - etd.getTime()) / (24 * 60 * 60 * 1000);
        if (scheduled > 0 && scheduled < 100) { // Sanity check
          scheduledTransits.push(scheduled);
        }
      }

      // Actual transit (ATD to ATA)
      if (s.atd && s.ata) {
        shipmentWithData++;
        const atd = new Date(s.atd);
        const ata = new Date(s.ata);
        const actual = (ata.getTime() - atd.getTime()) / (24 * 60 * 60 * 1000);
        if (actual > 0 && actual < 100) { // Sanity check
          actualTransits.push(actual);
        }

        // Check if on time (compare to ETA)
        if (s.eta) {
          const eta = new Date(s.eta);
          const delayDays = (ata.getTime() - eta.getTime()) / (24 * 60 * 60 * 1000);
          if (delayDays <= 2) {
            onTimeCount++;
          } else {
            delays.push(delayDays);
          }
        }
      }
    }

    const scheduledAvg = scheduledTransits.length > 0
      ? scheduledTransits.reduce((a, b) => a + b, 0) / scheduledTransits.length
      : null;

    const actualAvg = actualTransits.length > 0
      ? actualTransits.reduce((a, b) => a + b, 0) / actualTransits.length
      : null;

    return {
      scheduledTransitDays: scheduledAvg !== null ? Math.round(scheduledAvg * 10) / 10 : null,
      actualAvgTransitDays: actualAvg !== null ? Math.round(actualAvg * 10) / 10 : null,
      transitVarianceDays: (scheduledAvg !== null && actualAvg !== null)
        ? Math.round((actualAvg - scheduledAvg) * 10) / 10
        : null,
      minTransitDays: actualTransits.length > 0 ? Math.round(Math.min(...actualTransits)) : null,
      maxTransitDays: actualTransits.length > 0 ? Math.round(Math.max(...actualTransits)) : null,
      onTimeRate: shipmentWithData > 0 ? Math.round(onTimeCount / shipmentWithData * 100) : null,
      delayRate: shipmentWithData > 0 ? Math.round((shipmentWithData - onTimeCount) / shipmentWithData * 100) : null,
      avgDelayWhenLateDays: delays.length > 0
        ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length * 10) / 10
        : null,
    };
  }

  /**
   * Compute issue metrics
   */
  private computeIssueMetrics(chronicleData: any[], shipmentIds: string[]): {
    issueRate: number | null;
    commonIssueTypes: string[];
    rolloverRate: number | null;
  } {
    if (shipmentIds.length === 0) {
      return { issueRate: null, commonIssueTypes: [], rolloverRate: null };
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

    // Rollover rate
    const rolloverIssues = chronicleData.filter(d =>
      d.has_issue && ['rollover', 'rolled', 'vessel_change'].includes(d.issue_type?.toLowerCase())
    );
    const shipmentsWithRollover = new Set(rolloverIssues.map(d => d.shipment_id));
    const rolloverRate = Math.round(shipmentsWithRollover.size / shipmentIds.length * 100);

    return { issueRate, commonIssueTypes, rolloverRate };
  }

  /**
   * Compute carrier rankings on this route
   */
  private computeCarrierRankings(shipments: any[]): {
    carrierRankings: Array<{ carrier: string; onTimeRate: number; shipments: number }>;
    bestCarrier: string | null;
    worstCarrier: string | null;
  } {
    if (shipments.length === 0) {
      return { carrierRankings: [], bestCarrier: null, worstCarrier: null };
    }

    // Group by carrier
    const carrierStats: Record<string, { total: number; onTime: number }> = {};

    for (const s of shipments) {
      if (!s.carrier_name) continue;

      if (!carrierStats[s.carrier_name]) {
        carrierStats[s.carrier_name] = { total: 0, onTime: 0 };
      }

      if (s.eta && s.ata) {
        carrierStats[s.carrier_name].total++;
        const eta = new Date(s.eta);
        const ata = new Date(s.ata);
        const delayDays = (ata.getTime() - eta.getTime()) / (24 * 60 * 60 * 1000);
        if (delayDays <= 2) {
          carrierStats[s.carrier_name].onTime++;
        }
      } else {
        // Count shipments even without complete data
        carrierStats[s.carrier_name].total++;
      }
    }

    // Calculate rankings
    const rankings = Object.entries(carrierStats)
      .filter(([_, stats]) => stats.total >= 3) // Min 3 shipments for ranking
      .map(([carrier, stats]) => ({
        carrier,
        onTimeRate: stats.total > 0 ? Math.round(stats.onTime / stats.total * 100) : 0,
        shipments: stats.total,
      }))
      .sort((a, b) => b.onTimeRate - a.onTimeRate);

    return {
      carrierRankings: rankings.slice(0, 5),
      bestCarrier: rankings[0]?.carrier || null,
      worstCarrier: rankings.length > 1 ? rankings[rankings.length - 1]?.carrier : null,
    };
  }

  /**
   * Generate human-readable insights
   */
  generateInsights(profile: RouteProfile): RouteInsight[] {
    const insights: RouteInsight[] = [];

    // Transit time variance
    if (profile.transitVarianceDays !== null) {
      if (profile.transitVarianceDays > 3) {
        insights.push({
          type: 'warning',
          message: `⚠️ TRANSIT DELAY: Route typically takes ${profile.transitVarianceDays} days longer than scheduled`,
        });
      } else if (profile.transitVarianceDays < -1) {
        insights.push({
          type: 'positive',
          message: `✅ FAST ROUTE: Typically arrives ${Math.abs(profile.transitVarianceDays)} days ahead of schedule`,
        });
      }
    }

    // On-time rate
    if (profile.onTimeRate !== null) {
      if (profile.onTimeRate >= 80) {
        insights.push({
          type: 'positive',
          message: `✅ RELIABLE: ${profile.onTimeRate}% on-time arrival rate`,
        });
      } else if (profile.onTimeRate < 60) {
        insights.push({
          type: 'warning',
          message: `⚠️ DELAYS COMMON: Only ${profile.onTimeRate}% arrive on time (avg ${profile.avgDelayWhenLateDays} days late)`,
        });
      }
    }

    // Rollover risk
    if (profile.rolloverRate !== null && profile.rolloverRate > 15) {
      insights.push({
        type: 'warning',
        message: `⚠️ ROLLOVER RISK: ${profile.rolloverRate}% of bookings get rolled on this lane`,
      });
    }

    // Best carrier recommendation
    if (profile.bestCarrier && profile.carrierRankings.length > 0) {
      const best = profile.carrierRankings[0];
      insights.push({
        type: 'info',
        message: `💡 BEST CARRIER: ${best.carrier} (${best.onTimeRate}% on-time, ${best.shipments} shipments)`,
      });
    }

    // Volume context
    if (profile.totalShipments >= 20) {
      insights.push({
        type: 'info',
        message: `📊 HIGH VOLUME: ${profile.totalShipments} shipments on this lane`,
      });
    } else if (profile.totalShipments < 5) {
      insights.push({
        type: 'warning',
        message: `📊 LIMITED DATA: Only ${profile.totalShipments} shipments on record`,
      });
    }

    return insights;
  }

  /**
   * Save profile to database
   */
  async saveProfile(profile: RouteProfile): Promise<void> {
    await this.supabase.from('route_profiles').upsert(
      {
        pol_code: profile.polCode,
        pod_code: profile.podCode,
        pol_name: profile.polName,
        pod_name: profile.podName,
        total_shipments: profile.totalShipments,
        shipments_last_90_days: profile.shipmentsLast90Days,
        shipments_last_30_days: profile.shipmentsLast30Days,
        scheduled_transit_days: profile.scheduledTransitDays,
        actual_avg_transit_days: profile.actualAvgTransitDays,
        transit_variance_days: profile.transitVarianceDays,
        min_transit_days: profile.minTransitDays,
        max_transit_days: profile.maxTransitDays,
        on_time_rate: profile.onTimeRate,
        delay_rate: profile.delayRate,
        avg_delay_when_late_days: profile.avgDelayWhenLateDays,
        issue_rate: profile.issueRate,
        common_issue_types: profile.commonIssueTypes,
        rollover_rate: profile.rolloverRate,
        carrier_rankings: profile.carrierRankings,
        best_carrier: profile.bestCarrier,
        worst_carrier: profile.worstCarrier,
        computed_at: new Date().toISOString(),
        sample_size: profile.totalShipments,
      },
      { onConflict: 'pol_code,pod_code' }
    );
  }

  /**
   * Get profile for a route
   */
  async getProfile(polCode: string, podCode: string): Promise<RouteProfile | null> {
    const { data } = await this.supabase
      .from('route_profiles')
      .select('*')
      .eq('pol_code', polCode)
      .eq('pod_code', podCode)
      .single();

    if (!data) return null;

    return {
      polCode: data.pol_code,
      podCode: data.pod_code,
      polName: data.pol_name,
      podName: data.pod_name,
      totalShipments: data.total_shipments,
      shipmentsLast90Days: data.shipments_last_90_days,
      shipmentsLast30Days: data.shipments_last_30_days,
      scheduledTransitDays: data.scheduled_transit_days ? parseFloat(data.scheduled_transit_days) : null,
      actualAvgTransitDays: data.actual_avg_transit_days ? parseFloat(data.actual_avg_transit_days) : null,
      transitVarianceDays: data.transit_variance_days ? parseFloat(data.transit_variance_days) : null,
      minTransitDays: data.min_transit_days,
      maxTransitDays: data.max_transit_days,
      onTimeRate: data.on_time_rate ? parseFloat(data.on_time_rate) : null,
      delayRate: data.delay_rate ? parseFloat(data.delay_rate) : null,
      avgDelayWhenLateDays: data.avg_delay_when_late_days ? parseFloat(data.avg_delay_when_late_days) : null,
      issueRate: data.issue_rate ? parseFloat(data.issue_rate) : null,
      commonIssueTypes: data.common_issue_types || [],
      rolloverRate: data.rollover_rate ? parseFloat(data.rollover_rate) : null,
      carrierRankings: data.carrier_rankings || [],
      bestCarrier: data.best_carrier,
      worstCarrier: data.worst_carrier,
    };
  }
}
