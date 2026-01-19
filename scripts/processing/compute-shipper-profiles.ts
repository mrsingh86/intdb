/**
 * Compute Shipper Profiles
 *
 * Builds behavior intelligence profiles for top shippers.
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Inline the service since imports are tricky with ts-node
class ShipperProfileService {
  private db: typeof supabase;

  constructor(db: typeof supabase) {
    this.db = db;
  }

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

  async computeProfile(shipperName: string) {
    const normalized = this.normalizeShipperName(shipperName);

    // Get all chronicle records for this shipper
    const { data: chronicleData } = await this.db
      .from('chronicle')
      .select(`
        shipment_id,
        document_type,
        occurred_at,
        has_issue,
        issue_type,
        carrier_name,
        pol_location,
        pod_location
      `)
      .or(`shipper_name.ilike.%${shipperName}%`)
      .not('shipment_id', 'is', null);

    const shipmentIds = [...new Set((chronicleData || []).map(d => d.shipment_id))];

    // Get shipment details
    const { data: shipments } = await this.db
      .from('shipments')
      .select(`
        id, booking_number, carrier_name,
        port_of_loading_code, port_of_discharge_code,
        etd, eta, si_cutoff, stage, status,
        created_at
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

    // SI Behavior
    const siMetrics = await this.computeSiMetrics(shipmentIds);

    // Issue metrics
    const issueMetrics = this.computeIssueMetrics(chronicleData || []);

    // Route preferences
    const routeMetrics = this.computeRouteMetrics(shipments || []);

    // Risk score
    const { riskScore, riskFactors } = this.computeRiskScore({
      siLateRate: siMetrics.siLateRate,
      docIssueRate: issueMetrics.docIssueRate,
      issueRate: issueMetrics.issueRate,
      totalShipments,
    });

    // Relationship
    const dates = (shipments || []).map(s => new Date(s.created_at)).sort((a, b) => a.getTime() - b.getTime());
    const firstShipmentDate = dates[0]?.toISOString().split('T')[0] || null;
    const lastShipmentDate = dates[dates.length - 1]?.toISOString().split('T')[0] || null;
    const relationshipMonths = firstShipmentDate
      ? Math.floor((now.getTime() - new Date(firstShipmentDate).getTime()) / (30 * 24 * 60 * 60 * 1000))
      : 0;

    return {
      shipperName,
      shipperNameNormalized: normalized,
      totalShipments,
      shipmentsLast90Days,
      shipmentsLast30Days,
      activeShipments,
      ...siMetrics,
      ...issueMetrics,
      ...routeMetrics,
      riskScore,
      riskFactors,
      firstShipmentDate,
      lastShipmentDate,
      relationshipMonths,
    };
  }

  private async computeSiMetrics(shipmentIds: string[]) {
    if (shipmentIds.length === 0) {
      return { avgSiDaysBeforeCutoff: null, siLateRate: null, siAmendmentRate: null };
    }

    const { data: siDocs } = await this.db
      .from('chronicle')
      .select('shipment_id, occurred_at, document_type')
      .in('shipment_id', shipmentIds)
      .in('document_type', ['shipping_instructions', 'si_confirmation']);

    const { data: shipments } = await this.db
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

    return {
      avgSiDaysBeforeCutoff: daysBeforeCutoff.length > 0
        ? Math.round(daysBeforeCutoff.reduce((a, b) => a + b, 0) / daysBeforeCutoff.length * 10) / 10
        : null,
      siLateRate: daysBeforeCutoff.length > 0
        ? Math.round(lateCount / daysBeforeCutoff.length * 100)
        : null,
      siAmendmentRate: null,
    };
  }

  private computeIssueMetrics(data: any[]) {
    const shipmentIds = [...new Set(data.map(d => d.shipment_id))];
    if (shipmentIds.length === 0) {
      return { docIssueRate: null, issueRate: null, commonIssueTypes: [] };
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

    const docIssueTypes = ['documentation', 'missing_docs', 'wrong_weight'];
    const shipmentsWithDocIssues = new Set(
      data.filter(d => d.has_issue && docIssueTypes.includes(d.issue_type)).map(d => d.shipment_id)
    );
    const docIssueRate = Math.round(shipmentsWithDocIssues.size / shipmentIds.length * 100);

    return { docIssueRate, issueRate, commonIssueTypes };
  }

  private computeRouteMetrics(shipments: any[]) {
    const carrierCounts = shipments.reduce((acc, s) => {
      if (s.carrier_name) acc[s.carrier_name] = (acc[s.carrier_name] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    const preferredCarriers = Object.entries(carrierCounts)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 3)
      .map(([carrier]) => carrier);

    const routeCounts = shipments.reduce((acc, s) => {
      if (s.port_of_loading_code && s.port_of_discharge_code) {
        const key = `${s.port_of_loading_code} → ${s.port_of_discharge_code}`;
        acc[key] = (acc[key] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);
    const commonRoutes = Object.entries(routeCounts)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .slice(0, 3) as [string, number][];

    return { preferredCarriers, commonRoutes };
  }

  private computeRiskScore(metrics: any) {
    let score = 0;
    const factors: string[] = [];

    if (metrics.siLateRate !== null && metrics.siLateRate > 25) {
      score += metrics.siLateRate > 50 ? 30 : 20;
      factors.push('late_si_submission');
    }
    if (metrics.docIssueRate !== null && metrics.docIssueRate > 20) {
      score += metrics.docIssueRate > 40 ? 25 : 15;
      factors.push('documentation_issues');
    }
    if (metrics.issueRate !== null && metrics.issueRate > 30) {
      score += metrics.issueRate > 50 ? 25 : 15;
      factors.push('high_issue_rate');
    }
    if (metrics.totalShipments < 5) {
      score += 15;
      factors.push('limited_history');
    }

    return { riskScore: Math.min(100, score), riskFactors: factors };
  }

  generateInsights(profile: any): string[] {
    const insights: string[] = [];

    if (profile.avgSiDaysBeforeCutoff !== null) {
      if (profile.avgSiDaysBeforeCutoff < 0) {
        insights.push(`⚠️ SI RISK: Typically submits ${Math.abs(profile.avgSiDaysBeforeCutoff).toFixed(1)} days AFTER cutoff (${profile.siLateRate}% late rate)`);
      } else if (profile.avgSiDaysBeforeCutoff < 1) {
        insights.push(`⚠️ SI RISK: Submits very close to cutoff (avg ${profile.avgSiDaysBeforeCutoff.toFixed(1)} days before)`);
      } else if (profile.avgSiDaysBeforeCutoff > 3) {
        insights.push(`✅ Reliable SI submission (avg ${profile.avgSiDaysBeforeCutoff.toFixed(1)} days before cutoff)`);
      }
    }

    if (profile.docIssueRate !== null && profile.docIssueRate > 20) {
      insights.push(`⚠️ DOC RISK: ${profile.docIssueRate}% of shipments have documentation issues`);
    }

    if (profile.issueRate !== null && profile.issueRate > 30) {
      insights.push(`⚠️ ISSUE RISK: ${profile.issueRate}% of shipments have issues`);
    }

    if (profile.totalShipments >= 20) {
      insights.push(`📊 Established: ${profile.totalShipments} shipments over ${profile.relationshipMonths} months`);
    } else if (profile.totalShipments < 5) {
      insights.push(`📊 New shipper: Only ${profile.totalShipments} shipments in history`);
    }

    if (profile.activeShipments > 3) {
      insights.push(`🔥 Active: ${profile.activeShipments} shipments currently in progress`);
    }

    if (profile.riskScore >= 50) {
      insights.push(`🔴 HIGH RISK: Score ${profile.riskScore}/100 (${profile.riskFactors.join(', ')})`);
    } else if (profile.riskScore >= 25) {
      insights.push(`🟡 MODERATE RISK: Score ${profile.riskScore}/100`);
    } else {
      insights.push(`🟢 LOW RISK: Score ${profile.riskScore}/100`);
    }

    return insights;
  }

  async saveProfile(profile: any) {
    await this.db.from('shipper_profiles').upsert(
      {
        shipper_name: profile.shipperName,
        shipper_name_normalized: profile.shipperNameNormalized,
        total_shipments: profile.totalShipments,
        shipments_last_90_days: profile.shipmentsLast90Days,
        shipments_last_30_days: profile.shipmentsLast30Days,
        active_shipments: profile.activeShipments,
        avg_si_days_before_cutoff: profile.avgSiDaysBeforeCutoff,
        si_late_rate: profile.siLateRate,
        doc_issue_rate: profile.docIssueRate,
        issue_rate: profile.issueRate,
        common_issue_types: profile.commonIssueTypes,
        preferred_carriers: profile.preferredCarriers,
        common_routes: profile.commonRoutes.map(([route, count]: [string, number]) => ({ route, count })),
        risk_score: profile.riskScore,
        risk_factors: profile.riskFactors,
        first_shipment_date: profile.firstShipmentDate,
        last_shipment_date: profile.lastShipmentDate,
        relationship_months: profile.relationshipMonths,
        computed_at: new Date().toISOString(),
        sample_size: profile.totalShipments,
      },
      { onConflict: 'shipper_name_normalized' }
    );
  }
}

async function main() {
  console.log('═'.repeat(70));
  console.log('SHIPPER BEHAVIOR PROFILES');
  console.log('═'.repeat(70));

  // Get top shippers from HBL documents
  const { data: topShippers } = await supabase
    .from('chronicle')
    .select('shipper_name')
    .not('shipper_name', 'is', null)
    .not('shipper_name', 'ilike', '%intoglo%')
    .in('document_type', ['house_bl', 'draft_bl', 'shipping_instructions', 'booking_confirmation']);

  // Count and sort
  const counts = (topShippers || []).reduce((acc, { shipper_name }) => {
    acc[shipper_name] = (acc[shipper_name] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const sortedShippers = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const service = new ShipperProfileService(supabase);

  for (const [shipperName, docCount] of sortedShippers) {
    console.log('\n' + '─'.repeat(70));
    console.log(`SHIPPER: ${shipperName}`);
    console.log('─'.repeat(70));

    const profile = await service.computeProfile(shipperName);

    console.log(`\nVolume:`);
    console.log(`  Total shipments: ${profile.totalShipments}`);
    console.log(`  Last 90 days: ${profile.shipmentsLast90Days}`);
    console.log(`  Active now: ${profile.activeShipments}`);

    console.log(`\nSI Behavior:`);
    console.log(`  Avg days before cutoff: ${profile.avgSiDaysBeforeCutoff ?? 'N/A'}`);
    console.log(`  Late rate: ${profile.siLateRate ?? 'N/A'}%`);

    console.log(`\nIssues:`);
    console.log(`  Issue rate: ${profile.issueRate ?? 'N/A'}%`);
    console.log(`  Doc issue rate: ${profile.docIssueRate ?? 'N/A'}%`);
    console.log(`  Common issues: ${profile.commonIssueTypes.join(', ') || 'None'}`);

    console.log(`\nPreferences:`);
    console.log(`  Carriers: ${profile.preferredCarriers.join(', ') || 'N/A'}`);
    console.log(`  Routes: ${profile.commonRoutes.map(([r]) => r).join(', ') || 'N/A'}`);

    console.log(`\nRisk Score: ${profile.riskScore}/100`);
    if (profile.riskFactors.length > 0) {
      console.log(`  Factors: ${profile.riskFactors.join(', ')}`);
    }

    console.log(`\n📌 INSIGHTS:`);
    const insights = service.generateInsights(profile);
    for (const insight of insights) {
      console.log(`  ${insight}`);
    }

    // Save to database
    await service.saveProfile(profile);
    console.log(`\n  ✓ Saved to database`);
  }

  console.log('\n' + '═'.repeat(70));
  console.log('Done! Processed', sortedShippers.length, 'shippers');
}

main().catch(console.error);
