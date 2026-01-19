/**
 * Verify Extraction Coverage
 *
 * Analyzes shipment data coverage and generates a detailed report
 * on field population rates to track progress toward 100% coverage.
 *
 * Usage:
 *   npx ts-node scripts/verify-extraction-coverage.ts
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

// ============================================================================
// Types
// ============================================================================

interface FieldCoverage {
  field: string;
  populated: number;
  total: number;
  percentage: number;
  category: string;
}

interface CoverageReport {
  totalShipments: number;
  totalEmails: number;
  totalEntities: number;
  fieldCoverage: FieldCoverage[];
  carrierBreakdown: Array<{
    carrier: string;
    count: number;
    avgCoverage: number;
  }>;
  recentShipments: Array<{
    id: string;
    booking_number: string;
    coverage: number;
    missingFields: string[];
  }>;
}

// ============================================================================
// Analysis Functions
// ============================================================================

async function analyzeShipmentCoverage(): Promise<FieldCoverage[]> {
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select('*');

  if (error || !shipments) {
    throw new Error(`Failed to fetch shipments: ${error?.message}`);
  }

  const total = shipments.length;
  if (total === 0) return [];

  // Define fields to check by category
  const fieldCategories: Record<string, string[]> = {
    'Identifiers': [
      'booking_number',
      'bl_number',
      'container_number_primary'
    ],
    'Carrier & Voyage': [
      'carrier_id',
      'vessel_name',
      'voyage_number'
    ],
    'Routing': [
      'port_of_loading',
      'port_of_loading_code',
      'port_of_discharge',
      'port_of_discharge_code',
      'place_of_receipt',
      'place_of_delivery'
    ],
    'Dates': [
      'etd',
      'eta',
      'atd',
      'ata'
    ],
    'Cutoffs (Critical)': [
      'si_cutoff',
      'vgm_cutoff',
      'cargo_cutoff',
      'gate_cutoff'
    ],
    'Cargo': [
      'commodity_description',
      'total_weight',
      'total_volume'
    ],
    'Commercial': [
      'incoterms',
      'freight_terms'
    ],
    'Parties': [
      'shipper_id',
      'consignee_id'
    ]
  };

  const coverage: FieldCoverage[] = [];

  for (const [category, fields] of Object.entries(fieldCategories)) {
    for (const field of fields) {
      const populated = shipments.filter(s =>
        s[field] !== null && s[field] !== undefined && s[field] !== ''
      ).length;

      coverage.push({
        field,
        populated,
        total,
        percentage: (populated / total) * 100,
        category
      });
    }
  }

  return coverage;
}

async function analyzeCarrierBreakdown(): Promise<CoverageReport['carrierBreakdown']> {
  const { data: shipments } = await supabase
    .from('shipments')
    .select(`
      id,
      carrier_id,
      booking_number,
      bl_number,
      vessel_name,
      etd,
      eta,
      si_cutoff,
      vgm_cutoff,
      cargo_cutoff,
      carriers (carrier_name)
    `);

  if (!shipments) return [];

  // Group by carrier
  const carrierStats = new Map<string, { count: number; totalCoverage: number }>();

  for (const shipment of shipments) {
    const carrierName = (shipment.carriers as any)?.carrier_name || 'Unknown';
    const stats = carrierStats.get(carrierName) || { count: 0, totalCoverage: 0 };

    // Calculate coverage for this shipment
    const criticalFields = [
      shipment.booking_number,
      shipment.vessel_name,
      shipment.etd,
      shipment.eta,
      shipment.si_cutoff,
      shipment.vgm_cutoff,
      shipment.cargo_cutoff
    ];
    const populated = criticalFields.filter(f => f !== null && f !== undefined).length;
    const coverage = (populated / criticalFields.length) * 100;

    stats.count++;
    stats.totalCoverage += coverage;
    carrierStats.set(carrierName, stats);
  }

  return Array.from(carrierStats.entries())
    .map(([carrier, stats]) => ({
      carrier,
      count: stats.count,
      avgCoverage: stats.totalCoverage / stats.count
    }))
    .sort((a, b) => b.count - a.count);
}

async function getRecentShipments(limit: number = 10): Promise<CoverageReport['recentShipments']> {
  const { data: shipments } = await supabase
    .from('shipments')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!shipments) return [];

  return shipments.map(shipment => {
    const criticalFields = [
      { name: 'booking_number', value: shipment.booking_number },
      { name: 'vessel_name', value: shipment.vessel_name },
      { name: 'etd', value: shipment.etd },
      { name: 'eta', value: shipment.eta },
      { name: 'port_of_loading', value: shipment.port_of_loading },
      { name: 'port_of_discharge', value: shipment.port_of_discharge },
      { name: 'si_cutoff', value: shipment.si_cutoff },
      { name: 'vgm_cutoff', value: shipment.vgm_cutoff },
      { name: 'cargo_cutoff', value: shipment.cargo_cutoff }
    ];

    const populated = criticalFields.filter(f => f.value !== null && f.value !== undefined);
    const missing = criticalFields.filter(f => f.value === null || f.value === undefined);

    return {
      id: shipment.id,
      booking_number: shipment.booking_number || 'N/A',
      coverage: (populated.length / criticalFields.length) * 100,
      missingFields: missing.map(f => f.name)
    };
  });
}

async function getEntityStats(): Promise<{ type: string; count: number }[]> {
  const { data: entities } = await supabase
    .from('entity_extractions')
    .select('entity_type');

  if (!entities) return [];

  const counts = new Map<string, number>();
  for (const entity of entities) {
    const type = entity.entity_type;
    counts.set(type, (counts.get(type) || 0) + 1);
  }

  return Array.from(counts.entries())
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count);
}

// ============================================================================
// Report Generation
// ============================================================================

function printReport(report: CoverageReport, entityStats: { type: string; count: number }[]): void {
  console.log('\n' + '='.repeat(70));
  console.log('  SHIPMENT DATA COVERAGE REPORT');
  console.log('='.repeat(70) + '\n');

  console.log('OVERVIEW:');
  console.log(`  Total Shipments:     ${report.totalShipments}`);
  console.log(`  Total Emails:        ${report.totalEmails}`);
  console.log(`  Total Entities:      ${report.totalEntities}`);
  console.log();

  // Group coverage by category
  const byCategory = new Map<string, FieldCoverage[]>();
  for (const field of report.fieldCoverage) {
    const list = byCategory.get(field.category) || [];
    list.push(field);
    byCategory.set(field.category, list);
  }

  console.log('FIELD COVERAGE BY CATEGORY:');
  console.log();

  for (const [category, fields] of byCategory) {
    const avgCoverage = fields.reduce((sum, f) => sum + f.percentage, 0) / fields.length;
    const status = avgCoverage >= 80 ? '[OK]' : avgCoverage >= 50 ? '[WARN]' : '[LOW]';

    console.log(`  ${category} ${status} (avg ${avgCoverage.toFixed(1)}%)`);

    for (const field of fields) {
      const bar = '#'.repeat(Math.floor(field.percentage / 5));
      const empty = '.'.repeat(20 - bar.length);
      const status = field.percentage >= 80 ? '' : field.percentage >= 50 ? '*' : '!!';

      console.log(
        `    ${field.field.padEnd(25)} [${bar}${empty}] ` +
        `${field.populated}/${field.total} (${field.percentage.toFixed(1)}%) ${status}`
      );
    }
    console.log();
  }

  console.log('CARRIER BREAKDOWN:');
  for (const carrier of report.carrierBreakdown) {
    console.log(
      `  ${carrier.carrier.padEnd(20)} ${String(carrier.count).padStart(5)} shipments, ` +
      `${carrier.avgCoverage.toFixed(1)}% avg coverage`
    );
  }
  console.log();

  console.log('ENTITY EXTRACTION STATS:');
  for (const entity of entityStats.slice(0, 15)) {
    console.log(`  ${entity.type.padEnd(25)} ${entity.count}`);
  }
  if (entityStats.length > 15) {
    console.log(`  ... and ${entityStats.length - 15} more entity types`);
  }
  console.log();

  console.log('RECENT SHIPMENTS (showing 10):');
  for (const shipment of report.recentShipments) {
    const status = shipment.coverage >= 80 ? '[OK]' : shipment.coverage >= 50 ? '[WARN]' : '[LOW]';
    console.log(
      `  ${shipment.booking_number.padEnd(15)} ${shipment.coverage.toFixed(0)}% ${status}`
    );
    if (shipment.missingFields.length > 0 && shipment.coverage < 80) {
      console.log(`    Missing: ${shipment.missingFields.join(', ')}`);
    }
  }
  console.log();

  // Calculate overall score
  const criticalFields = report.fieldCoverage.filter(f =>
    ['Cutoffs (Critical)', 'Dates', 'Identifiers'].includes(f.category)
  );
  const overallCritical = criticalFields.reduce((sum, f) => sum + f.percentage, 0) / criticalFields.length;

  console.log('='.repeat(70));
  console.log(`  OVERALL CRITICAL FIELD COVERAGE: ${overallCritical.toFixed(1)}%`);

  if (overallCritical >= 80) {
    console.log('  Status: GOOD - Critical fields well populated');
  } else if (overallCritical >= 60) {
    console.log('  Status: NEEDS IMPROVEMENT - Run extraction on more emails');
  } else {
    console.log('  Status: LOW - Significant extraction needed');
  }
  console.log('='.repeat(70) + '\n');
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('\nAnalyzing shipment data coverage...\n');

  try {
    // Gather all stats
    const [fieldCoverage, carrierBreakdown, recentShipments, entityStats] = await Promise.all([
      analyzeShipmentCoverage(),
      analyzeCarrierBreakdown(),
      getRecentShipments(10),
      getEntityStats()
    ]);

    // Get totals
    const { count: totalShipments } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true });

    const { count: totalEmails } = await supabase
      .from('raw_emails')
      .select('*', { count: 'exact', head: true });

    const { count: totalEntities } = await supabase
      .from('entity_extractions')
      .select('*', { count: 'exact', head: true });

    const report: CoverageReport = {
      totalShipments: totalShipments || 0,
      totalEmails: totalEmails || 0,
      totalEntities: totalEntities || 0,
      fieldCoverage,
      carrierBreakdown,
      recentShipments
    };

    printReport(report, entityStats);

  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
