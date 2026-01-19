/**
 * Compute All Intelligence Profiles
 *
 * Builds behavior/performance profiles for:
 * - Shippers (SI patterns, documentation quality) - from chronicle.shipper_name
 * - Consignees (pickup patterns, customs, detention risk) - from shipments.consignee_name
 * - Carriers (schedule reliability, rollover rate) - from shipments.carrier_name
 * - Routes (transit time variance, best carriers) - from shipments port fields
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================================================
// SHIPPER PROFILES (from chronicle.shipper_name - HBL data)
// ============================================================================

async function computeShipperProfiles() {
  console.log('\n📦 COMPUTING SHIPPER PROFILES...');

  // Get top shippers from HBL documents in chronicle
  const { data: topShippers } = await supabase
    .from('chronicle')
    .select('shipper_name')
    .not('shipper_name', 'is', null)
    .not('shipper_name', 'ilike', '%intoglo%')
    .in('document_type', ['house_bl', 'draft_bl', 'shipping_instructions', 'booking_confirmation']);

  const counts = (topShippers || []).reduce((acc, { shipper_name }) => {
    acc[shipper_name] = (acc[shipper_name] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const sortedShippers = Object.entries(counts)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 20);

  console.log(`  Found ${sortedShippers.length} top shippers`);

  for (const [shipperName] of sortedShippers) {
    try {
      const profile = await computeShipperProfile(shipperName);
      await saveShipperProfile(profile);
      console.log(`  ✓ ${shipperName.slice(0, 40)}: ${profile.totalShipments} shipments, SI late ${profile.siLateRate || 0}%, risk ${profile.riskScore}/100`);
    } catch (err) {
      console.log(`  ✗ ${shipperName}: ${err}`);
    }
  }
}

async function computeShipperProfile(shipperName: string) {
  const normalized = shipperName.toLowerCase().trim().replace(/\s+/g, ' ')
    .replace(/pvt\.?\s*ltd\.?/gi, 'private limited')
    .replace(/[.,]/g, '');

  const { data: chronicleData } = await supabase
    .from('chronicle')
    .select('shipment_id, document_type, occurred_at, has_issue, issue_type, carrier_name')
    .ilike('shipper_name', `%${shipperName}%`)
    .not('shipment_id', 'is', null);

  const shipmentIds = [...new Set((chronicleData || []).map(d => d.shipment_id))];

  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, carrier_name, si_cutoff, stage, status, created_at')
    .in('id', shipmentIds.length > 0 ? shipmentIds : ['none']);

  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // SI metrics
  const { data: siDocs } = await supabase
    .from('chronicle')
    .select('shipment_id, occurred_at, document_type')
    .in('shipment_id', shipmentIds)
    .in('document_type', ['shipping_instructions', 'si_confirmation']);

  const { data: siShipments } = await supabase
    .from('shipments')
    .select('id, si_cutoff')
    .in('id', shipmentIds)
    .not('si_cutoff', 'is', null);

  const cutoffMap = new Map((siShipments || []).map(s => [s.id, new Date(s.si_cutoff)]));
  const daysBeforeCutoff: number[] = [];
  let lateCount = 0;

  for (const doc of (siDocs || []).filter(d => d.document_type === 'shipping_instructions')) {
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

  // Issue metrics
  const shipmentsWithIssues = new Set((chronicleData || []).filter(d => d.has_issue).map(d => d.shipment_id));
  const issueRate = shipmentIds.length > 0 ? Math.round(shipmentsWithIssues.size / shipmentIds.length * 100) : null;

  const docIssueTypes = ['documentation', 'missing_docs', 'wrong_weight'];
  const shipmentsWithDocIssues = new Set(
    (chronicleData || []).filter(d => d.has_issue && docIssueTypes.includes(d.issue_type)).map(d => d.shipment_id)
  );
  const docIssueRate = shipmentIds.length > 0 ? Math.round(shipmentsWithDocIssues.size / shipmentIds.length * 100) : null;

  // Risk score
  let riskScore = 0;
  const riskFactors: string[] = [];
  if (siLateRate !== null && siLateRate > 25) {
    riskScore += siLateRate > 50 ? 30 : 20;
    riskFactors.push('late_si_submission');
  }
  if (docIssueRate !== null && docIssueRate > 20) {
    riskScore += docIssueRate > 40 ? 25 : 15;
    riskFactors.push('documentation_issues');
  }
  if ((shipments?.length || 0) < 5) {
    riskScore += 15;
    riskFactors.push('limited_history');
  }

  return {
    shipperName,
    shipperNameNormalized: normalized,
    totalShipments: shipments?.length || 0,
    shipmentsLast90Days: shipments?.filter(s => new Date(s.created_at) >= ninetyDaysAgo).length || 0,
    avgSiDaysBeforeCutoff,
    siLateRate,
    docIssueRate,
    issueRate,
    riskScore: Math.min(100, riskScore),
    riskFactors,
  };
}

async function saveShipperProfile(profile: any) {
  await supabase.from('shipper_profiles').upsert({
    shipper_name: profile.shipperName,
    shipper_name_normalized: profile.shipperNameNormalized,
    total_shipments: profile.totalShipments,
    shipments_last_90_days: profile.shipmentsLast90Days,
    avg_si_days_before_cutoff: profile.avgSiDaysBeforeCutoff,
    si_late_rate: profile.siLateRate,
    doc_issue_rate: profile.docIssueRate,
    issue_rate: profile.issueRate,
    risk_score: profile.riskScore,
    risk_factors: profile.riskFactors,
    computed_at: new Date().toISOString(),
  }, { onConflict: 'shipper_name_normalized' });
}

// ============================================================================
// CONSIGNEE PROFILES (from shipments.consignee_name)
// ============================================================================

async function computeConsigneeProfiles() {
  console.log('\n📥 COMPUTING CONSIGNEE PROFILES...');

  // Get consignees from SHIPMENTS table (not chronicle)
  const { data: consignees } = await supabase
    .from('shipments')
    .select('consignee_name')
    .not('consignee_name', 'is', null)
    .not('consignee_name', 'ilike', '%intoglo%')
    .not('consignee_name', 'eq', '');

  const counts = (consignees || []).reduce((acc, { consignee_name }) => {
    if (consignee_name && consignee_name.trim()) {
      acc[consignee_name.trim()] = (acc[consignee_name.trim()] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  const sortedConsignees = Object.entries(counts)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 20);

  console.log(`  Found ${sortedConsignees.length} top consignees`);

  for (const [consigneeName] of sortedConsignees) {
    try {
      const profile = await computeConsigneeProfile(consigneeName);
      if (profile.totalShipments > 0) {
        await saveConsigneeProfile(profile);
        console.log(`  ✓ ${consigneeName.slice(0, 40)}: ${profile.totalShipments} shipments, detention ${profile.detentionRate || 0}%, risk ${profile.riskScore}/100`);
      }
    } catch (err) {
      console.log(`  ✗ ${consigneeName}: ${err}`);
    }
  }
}

async function computeConsigneeProfile(consigneeName: string) {
  const normalized = consigneeName.toLowerCase().trim().replace(/\s+/g, ' ')
    .replace(/pvt\.?\s*ltd\.?/gi, 'private limited')
    .replace(/inc\.?$/gi, 'inc')
    .replace(/llc\.?$/gi, 'llc')
    .replace(/[.,]/g, '');

  // Get shipments for this consignee (fuzzy match)
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, carrier_name, port_of_discharge_code, port_of_discharge, status, created_at')
    .ilike('consignee_name', `%${consigneeName}%`);

  const shipmentIds = (shipments || []).map(s => s.id);

  // Get chronicle data for these shipments to find issues
  const { data: chronicleData } = await supabase
    .from('chronicle')
    .select('shipment_id, has_issue, issue_type')
    .in('shipment_id', shipmentIds.length > 0 ? shipmentIds : ['none']);

  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // Detention/demurrage metrics from chronicle issues
  const detentionIssues = (chronicleData || []).filter(d =>
    d.has_issue && ['detention', 'container_detention'].includes(d.issue_type?.toLowerCase())
  );
  const demurrageIssues = (chronicleData || []).filter(d =>
    d.has_issue && ['demurrage', 'port_storage'].includes(d.issue_type?.toLowerCase())
  );
  const customsIssues = (chronicleData || []).filter(d =>
    d.has_issue && ['customs', 'customs_hold', 'hold'].includes(d.issue_type?.toLowerCase())
  );

  const detentionRate = shipmentIds.length > 0
    ? Math.round(new Set(detentionIssues.map(d => d.shipment_id)).size / shipmentIds.length * 100)
    : null;
  const demurrageRate = shipmentIds.length > 0
    ? Math.round(new Set(demurrageIssues.map(d => d.shipment_id)).size / shipmentIds.length * 100)
    : null;
  const customsIssueRate = shipmentIds.length > 0
    ? Math.round(new Set(customsIssues.map(d => d.shipment_id)).size / shipmentIds.length * 100)
    : null;

  // Risk score
  let riskScore = 0;
  const riskFactors: string[] = [];
  if (detentionRate !== null && detentionRate > 15) {
    riskScore += detentionRate > 30 ? 30 : 20;
    riskFactors.push('detention_risk');
  }
  if (demurrageRate !== null && demurrageRate > 15) {
    riskScore += demurrageRate > 30 ? 25 : 15;
    riskFactors.push('demurrage_risk');
  }
  if (customsIssueRate !== null && customsIssueRate > 20) {
    riskScore += customsIssueRate > 40 ? 25 : 15;
    riskFactors.push('customs_issues');
  }
  if ((shipments?.length || 0) < 5) {
    riskScore += 10;
    riskFactors.push('limited_history');
  }

  return {
    consigneeName,
    consigneeNameNormalized: normalized,
    totalShipments: shipments?.length || 0,
    shipmentsLast90Days: shipments?.filter(s => new Date(s.created_at) >= ninetyDaysAgo).length || 0,
    detentionRate,
    demurrageRate,
    customsIssueRate,
    riskScore: Math.min(100, riskScore),
    riskFactors,
  };
}

async function saveConsigneeProfile(profile: any) {
  // Note: Using only columns that exist in the table
  const { error } = await supabase.from('consignee_profiles').upsert({
    consignee_name: profile.consigneeName,
    consignee_name_normalized: profile.consigneeNameNormalized,
    total_shipments: profile.totalShipments,
    detention_rate: profile.detentionRate,
    demurrage_rate: profile.demurrageRate,
    risk_score: profile.riskScore,
    computed_at: new Date().toISOString(),
  }, { onConflict: 'consignee_name_normalized' });

  if (error) {
    console.log(`    DB Error: ${error.message}`);
  }
}

// ============================================================================
// CARRIER PROFILES
// ============================================================================

async function computeCarrierProfiles() {
  console.log('\n🚢 COMPUTING CARRIER PROFILES...');

  const { data: carriers } = await supabase
    .from('shipments')
    .select('carrier_name')
    .not('carrier_name', 'is', null);

  const counts = (carriers || []).reduce((acc, { carrier_name }) => {
    acc[carrier_name] = (acc[carrier_name] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const sortedCarriers = Object.entries(counts)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 15);

  console.log(`  Found ${sortedCarriers.length} carriers`);

  for (const [carrierName] of sortedCarriers) {
    try {
      const profile = await computeCarrierProfile(carrierName);
      await saveCarrierProfile(profile);
      console.log(`  ✓ ${carrierName}: ${profile.totalShipments} shipments, rollover ${profile.rolloverRate || 0}%, score ${profile.performanceScore}/100`);
    } catch (err) {
      console.log(`  ✗ ${carrierName}: ${err}`);
    }
  }
}

async function computeCarrierProfile(carrierName: string) {
  const normalized = carrierName.toLowerCase().trim().replace(/\s+/g, ' ');

  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, etd, eta, atd, ata, status, created_at')
    .ilike('carrier_name', `%${carrierName}%`);

  const shipmentIds = (shipments || []).map(s => s.id);

  const { data: chronicleData } = await supabase
    .from('chronicle')
    .select('shipment_id, document_type, has_issue, issue_type')
    .in('shipment_id', shipmentIds.length > 0 ? shipmentIds : ['none']);

  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // Schedule reliability
  let onTimeDepartures = 0, departuresWithData = 0;
  let onTimeArrivals = 0, arrivalsWithData = 0;

  for (const s of shipments || []) {
    if (s.etd && s.atd) {
      departuresWithData++;
      const delayDays = (new Date(s.atd).getTime() - new Date(s.etd).getTime()) / (24 * 60 * 60 * 1000);
      if (delayDays <= 1) onTimeDepartures++;
    }
    if (s.eta && s.ata) {
      arrivalsWithData++;
      const delayDays = (new Date(s.ata).getTime() - new Date(s.eta).getTime()) / (24 * 60 * 60 * 1000);
      if (delayDays <= 2) onTimeArrivals++;
    }
  }

  const onTimeDepartureRate = departuresWithData > 0 ? Math.round(onTimeDepartures / departuresWithData * 100) : null;
  const onTimeArrivalRate = arrivalsWithData > 0 ? Math.round(onTimeArrivals / arrivalsWithData * 100) : null;

  // Rollover rate
  const rolloverIssues = (chronicleData || []).filter(d =>
    d.has_issue && ['rollover', 'rolled', 'vessel_change'].includes(d.issue_type?.toLowerCase())
  );
  const rolloverRate = shipmentIds.length > 0
    ? Math.round(new Set(rolloverIssues.map(d => d.shipment_id)).size / shipmentIds.length * 100)
    : null;

  // Performance score
  let performanceScore = 50;
  const performanceFactors: string[] = [];

  if (onTimeDepartureRate !== null) {
    if (onTimeDepartureRate >= 90) { performanceScore += 25; performanceFactors.push('excellent_departure'); }
    else if (onTimeDepartureRate >= 75) { performanceScore += 15; performanceFactors.push('good_departure'); }
    else if (onTimeDepartureRate < 60) { performanceScore -= 20; performanceFactors.push('poor_departure'); }
  }
  if (onTimeArrivalRate !== null) {
    if (onTimeArrivalRate >= 85) { performanceScore += 25; performanceFactors.push('excellent_arrival'); }
    else if (onTimeArrivalRate >= 70) { performanceScore += 15; performanceFactors.push('good_arrival'); }
    else if (onTimeArrivalRate < 50) { performanceScore -= 20; performanceFactors.push('poor_arrival'); }
  }
  if (rolloverRate !== null && rolloverRate > 10) {
    performanceScore -= rolloverRate > 25 ? 20 : 10;
    performanceFactors.push('rollover_risk');
  }

  return {
    carrierName,
    carrierNameNormalized: normalized,
    totalShipments: shipments?.length || 0,
    shipmentsLast90Days: shipments?.filter(s => new Date(s.created_at) >= ninetyDaysAgo).length || 0,
    onTimeDepartureRate,
    onTimeArrivalRate,
    rolloverRate,
    performanceScore: Math.max(0, Math.min(100, performanceScore)),
    performanceFactors,
  };
}

async function saveCarrierProfile(profile: any) {
  await supabase.from('carrier_profiles').upsert({
    carrier_name: profile.carrierName,
    carrier_name_normalized: profile.carrierNameNormalized,
    total_shipments: profile.totalShipments,
    shipments_last_90_days: profile.shipmentsLast90Days,
    on_time_departure_rate: profile.onTimeDepartureRate,
    on_time_arrival_rate: profile.onTimeArrivalRate,
    rollover_rate: profile.rolloverRate,
    performance_score: profile.performanceScore,
    performance_factors: profile.performanceFactors,
    computed_at: new Date().toISOString(),
  }, { onConflict: 'carrier_name_normalized' });
}

// ============================================================================
// ROUTE PROFILES (using port names with fuzzy normalization)
// ============================================================================

async function computeRouteProfiles() {
  console.log('\n🗺️  COMPUTING ROUTE PROFILES...');

  // Get routes from both port codes AND port names (fuzzy)
  const { data: shipmentRoutes } = await supabase
    .from('shipments')
    .select('port_of_loading, port_of_loading_code, port_of_discharge, port_of_discharge_code')
    .or('port_of_loading.not.is.null,port_of_loading_code.not.is.null');

  // Normalize port names to create route keys
  const normalizePort = (portName: string | null, portCode: string | null): string | null => {
    if (portCode && portCode.length >= 3) return portCode.toUpperCase();
    if (!portName) return null;
    // Extract port code from name like "NHAVA SHEVA (INNSA)" or just use first 5 chars
    const codeMatch = portName.match(/\(([A-Z]{5})\)/);
    if (codeMatch) return codeMatch[1];
    // Common port name normalizations
    const normalized = portName.toUpperCase()
      .replace(/NHAVA SHEVA|JAWAHARLAL NEHRU|JNPT/gi, 'INNSA')
      .replace(/MUNDRA/gi, 'INMUN')
      .replace(/CHENNAI|MADRAS/gi, 'INCHE')
      .replace(/LOS ANGELES|LA/gi, 'USLAX')
      .replace(/NEW YORK|NEWARK/gi, 'USNYC')
      .replace(/SAVANNAH/gi, 'USSAV')
      .replace(/HOUSTON/gi, 'USHOU')
      .replace(/CHICAGO/gi, 'USCHI')
      .replace(/HAZIRA/gi, 'INHZA');
    return normalized.slice(0, 10);
  };

  const routeCounts: Record<string, { pol: string; pod: string; count: number }> = {};

  for (const r of shipmentRoutes || []) {
    const pol = normalizePort(r.port_of_loading, r.port_of_loading_code);
    const pod = normalizePort(r.port_of_discharge, r.port_of_discharge_code);
    if (pol && pod && pol !== pod) {
      const key = `${pol}-${pod}`;
      if (!routeCounts[key]) {
        routeCounts[key] = { pol, pod, count: 0 };
      }
      routeCounts[key].count++;
    }
  }

  const sortedRoutes = Object.values(routeCounts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  console.log(`  Found ${sortedRoutes.length} top routes`);

  for (const route of sortedRoutes) {
    try {
      const profile = await computeRouteProfile(route.pol, route.pod);
      if (profile.totalShipments > 0) {
        await saveRouteProfile(profile);
        const variance = profile.transitVarianceDays !== null ? `${profile.transitVarianceDays > 0 ? '+' : ''}${profile.transitVarianceDays}d` : 'N/A';
        console.log(`  ✓ ${route.pol} → ${route.pod}: ${profile.totalShipments} shipments, variance ${variance}`);
      }
    } catch (err) {
      console.log(`  ✗ ${route.pol} → ${route.pod}: ${err}`);
    }
  }
}

async function computeRouteProfile(polCode: string, podCode: string) {
  // Get shipments matching this route (fuzzy - check both code and name fields)
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, carrier_name, port_of_loading, port_of_discharge, etd, eta, atd, ata, created_at')
    .or(`port_of_loading_code.eq.${polCode},port_of_loading.ilike.%${polCode}%`)
    .or(`port_of_discharge_code.eq.${podCode},port_of_discharge.ilike.%${podCode}%`);

  // Filter to only matching routes
  const matchingShipments = (shipments || []).filter(s => {
    const polMatch = s.port_of_loading?.toUpperCase().includes(polCode) ||
      s.port_of_loading?.toUpperCase().includes(polCode.slice(0, 3));
    const podMatch = s.port_of_discharge?.toUpperCase().includes(podCode) ||
      s.port_of_discharge?.toUpperCase().includes(podCode.slice(0, 3));
    return polMatch || podMatch;
  });

  const shipmentIds = matchingShipments.map(s => s.id);

  const { data: chronicleData } = await supabase
    .from('chronicle')
    .select('shipment_id, has_issue, issue_type')
    .in('shipment_id', shipmentIds.length > 0 ? shipmentIds : ['none']);

  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  // Transit metrics
  const scheduledTransits: number[] = [];
  const actualTransits: number[] = [];
  let onTimeCount = 0, shipmentsWithData = 0;

  for (const s of matchingShipments) {
    if (s.etd && s.eta) {
      const scheduled = (new Date(s.eta).getTime() - new Date(s.etd).getTime()) / (24 * 60 * 60 * 1000);
      if (scheduled > 0 && scheduled < 100) scheduledTransits.push(scheduled);
    }
    if (s.atd && s.ata) {
      shipmentsWithData++;
      const actual = (new Date(s.ata).getTime() - new Date(s.atd).getTime()) / (24 * 60 * 60 * 1000);
      if (actual > 0 && actual < 100) actualTransits.push(actual);

      if (s.eta) {
        const delayDays = (new Date(s.ata).getTime() - new Date(s.eta).getTime()) / (24 * 60 * 60 * 1000);
        if (delayDays <= 2) onTimeCount++;
      }
    }
  }

  const scheduledAvg = scheduledTransits.length > 0 ? scheduledTransits.reduce((a, b) => a + b, 0) / scheduledTransits.length : null;
  const actualAvg = actualTransits.length > 0 ? actualTransits.reduce((a, b) => a + b, 0) / actualTransits.length : null;

  // Carrier rankings
  const carrierStats: Record<string, { total: number; onTime: number }> = {};
  for (const s of matchingShipments) {
    if (!s.carrier_name) continue;
    if (!carrierStats[s.carrier_name]) carrierStats[s.carrier_name] = { total: 0, onTime: 0 };
    if (s.eta && s.ata) {
      carrierStats[s.carrier_name].total++;
      const delayDays = (new Date(s.ata).getTime() - new Date(s.eta).getTime()) / (24 * 60 * 60 * 1000);
      if (delayDays <= 2) carrierStats[s.carrier_name].onTime++;
    }
  }

  const carrierRankings = Object.entries(carrierStats)
    .filter(([_, stats]) => stats.total >= 2)
    .map(([carrier, stats]) => ({
      carrier,
      onTimeRate: stats.total > 0 ? Math.round(stats.onTime / stats.total * 100) : 0,
      shipments: stats.total,
    }))
    .sort((a, b) => b.onTimeRate - a.onTimeRate)
    .slice(0, 5);

  return {
    polCode,
    podCode,
    polName: matchingShipments[0]?.port_of_loading || null,
    podName: matchingShipments[0]?.port_of_discharge || null,
    totalShipments: matchingShipments.length,
    shipmentsLast90Days: matchingShipments.filter(s => new Date(s.created_at) >= ninetyDaysAgo).length,
    scheduledTransitDays: scheduledAvg !== null ? Math.round(scheduledAvg * 10) / 10 : null,
    actualAvgTransitDays: actualAvg !== null ? Math.round(actualAvg * 10) / 10 : null,
    transitVarianceDays: (scheduledAvg !== null && actualAvg !== null) ? Math.round((actualAvg - scheduledAvg) * 10) / 10 : null,
    onTimeRate: shipmentsWithData > 0 ? Math.round(onTimeCount / shipmentsWithData * 100) : null,
    carrierRankings,
    bestCarrier: carrierRankings[0]?.carrier || null,
  };
}

async function saveRouteProfile(profile: any) {
  await supabase.from('route_profiles').upsert({
    pol_code: profile.polCode,
    pod_code: profile.podCode,
    pol_name: profile.polName,
    pod_name: profile.podName,
    total_shipments: profile.totalShipments,
    shipments_last_90_days: profile.shipmentsLast90Days,
    scheduled_transit_days: profile.scheduledTransitDays,
    actual_avg_transit_days: profile.actualAvgTransitDays,
    transit_variance_days: profile.transitVarianceDays,
    on_time_rate: profile.onTimeRate,
    carrier_rankings: profile.carrierRankings,
    best_carrier: profile.bestCarrier,
    computed_at: new Date().toISOString(),
  }, { onConflict: 'pol_code,pod_code' });
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('═'.repeat(70));
  console.log('COMPUTING ALL INTELLIGENCE PROFILES');
  console.log('═'.repeat(70));

  await computeShipperProfiles();
  await computeConsigneeProfiles();
  await computeCarrierProfiles();
  await computeRouteProfiles();

  // Summary
  const { count: shipperCount } = await supabase.from('shipper_profiles').select('*', { count: 'exact', head: true });
  const { count: consigneeCount } = await supabase.from('consignee_profiles').select('*', { count: 'exact', head: true });
  const { count: carrierCount } = await supabase.from('carrier_profiles').select('*', { count: 'exact', head: true });
  const { count: routeCount } = await supabase.from('route_profiles').select('*', { count: 'exact', head: true });

  console.log('\n' + '═'.repeat(70));
  console.log('PROFILE SUMMARY:');
  console.log(`  Shippers:   ${shipperCount} profiles`);
  console.log(`  Consignees: ${consigneeCount} profiles`);
  console.log(`  Carriers:   ${carrierCount} profiles`);
  console.log(`  Routes:     ${routeCount} profiles`);
  console.log('═'.repeat(70));
}

main().catch(console.error);
