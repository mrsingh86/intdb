#!/usr/bin/env npx tsx
/**
 * Shipment-wise Data Completeness Report
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function shipmentCompleteness() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                    SHIPMENT-WISE DATA COMPLETENESS                             ');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number, vessel_name, voyage_number, port_of_loading, port_of_discharge, etd, eta, shipper_id, consignee_id, carrier_id, container_numbers, si_cutoff, vgm_cutoff, cargo_cutoff')
    .order('created_at', { ascending: false });

  const keyFields = [
    'booking_number', 'bl_number', 'vessel_name', 'voyage_number',
    'port_of_loading', 'port_of_discharge', 'etd', 'eta',
    'shipper_id', 'consignee_id', 'carrier_id', 'container_numbers',
    'si_cutoff', 'vgm_cutoff', 'cargo_cutoff'
  ];

  interface ShipmentInfo {
    booking: string;
    score: number;
    filled: number;
    total: number;
    missing: string[];
  }

  const shipmentScores: ShipmentInfo[] = [];
  const byScore: { excellent: ShipmentInfo[]; good: ShipmentInfo[]; fair: ShipmentInfo[]; poor: ShipmentInfo[] } = {
    excellent: [],
    good: [],
    fair: [],
    poor: []
  };

  for (const ship of shipments || []) {
    let filled = 0;
    const missing: string[] = [];

    for (const field of keyFields) {
      const value = (ship as any)[field];
      const hasValue = value !== null && value !== undefined &&
        (Array.isArray(value) ? value.length > 0 : String(value).trim() !== '');
      if (hasValue) {
        filled++;
      } else {
        missing.push(field);
      }
    }

    const score = Math.round((filled / keyFields.length) * 100);
    const shipmentInfo: ShipmentInfo = {
      booking: ship.booking_number || ship.bl_number || ship.id.substring(0, 8),
      score,
      filled,
      total: keyFields.length,
      missing
    };

    shipmentScores.push(shipmentInfo);

    if (score >= 80) byScore.excellent.push(shipmentInfo);
    else if (score >= 60) byScore.good.push(shipmentInfo);
    else if (score >= 40) byScore.fair.push(shipmentInfo);
    else byScore.poor.push(shipmentInfo);
  }

  console.log('COMPLETENESS DISTRIBUTION');
  console.log('─'.repeat(60));
  console.log(`  Excellent (80-100%):   ${byScore.excellent.length} shipments`);
  console.log(`  Good (60-79%):         ${byScore.good.length} shipments`);
  console.log(`  Fair (40-59%):         ${byScore.fair.length} shipments`);
  console.log(`  Poor (0-39%):          ${byScore.poor.length} shipments`);
  console.log('');

  const avgScore = Math.round(shipmentScores.reduce((sum, s) => sum + s.score, 0) / shipmentScores.length);
  console.log(`  AVERAGE SCORE:         ${avgScore}%`);
  console.log('');

  console.log('TOP 10 MOST COMPLETE SHIPMENTS');
  console.log('─'.repeat(60));
  const sorted = shipmentScores.sort((a, b) => b.score - a.score);
  for (const s of sorted.slice(0, 10)) {
    console.log(`  ${String(s.booking).padEnd(20)} ${s.score}% (${s.filled}/${s.total})`);
  }
  console.log('');

  console.log('BOTTOM 10 LEAST COMPLETE SHIPMENTS');
  console.log('─'.repeat(60));
  for (const s of sorted.slice(-10).reverse()) {
    console.log(`  ${String(s.booking).padEnd(20)} ${s.score}% (${s.filled}/${s.total})`);
    console.log(`    Missing: ${s.missing.slice(0, 5).join(', ')}${s.missing.length > 5 ? '...' : ''}`);
  }
  console.log('');

  console.log('FIELD COVERAGE ACROSS ALL SHIPMENTS');
  console.log('─'.repeat(60));
  const fieldStats: Record<string, number> = {};
  for (const field of keyFields) {
    fieldStats[field] = 0;
  }
  for (const ship of shipments || []) {
    for (const field of keyFields) {
      const value = (ship as any)[field];
      const hasValue = value !== null && value !== undefined &&
        (Array.isArray(value) ? value.length > 0 : String(value).trim() !== '');
      if (hasValue) fieldStats[field]++;
    }
  }

  const total = shipments?.length || 1;
  const sortedFields = Object.entries(fieldStats).sort((a, b) => b[1] - a[1]);
  for (const [field, count] of sortedFields) {
    const pct = Math.round((count / total) * 100);
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    console.log(`  ${field.padEnd(18)} ${bar} ${pct}% (${count})`);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

shipmentCompleteness().catch(console.error);
