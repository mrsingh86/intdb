/**
 * Backfill Shipment Data from Chronicle
 *
 * Fills missing shipment fields (POL, POD, ETD, ETA, cutoffs, vessel, carrier)
 * from chronicle emails that have extracted this data.
 *
 * Strategy:
 * 1. For each field, find the MOST RECENT chronicle record with that data
 * 2. Prefer booking_confirmation document types (most authoritative)
 * 3. Fall back to any document type with the data
 * 4. Log all changes for audit trail
 *
 * Usage:
 *   npx tsx scripts/backfill/backfill-shipment-data-from-chronicle.ts [--dry-run] [--limit=100]
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Fields to backfill: shipment column -> chronicle column
const FIELD_MAPPINGS = [
  // Routing
  { shipmentField: 'port_of_loading', chronicleField: 'pol_location', label: 'POL' },
  { shipmentField: 'port_of_discharge', chronicleField: 'pod_location', label: 'POD' },
  // Schedule
  { shipmentField: 'etd', chronicleField: 'etd', label: 'ETD' },
  { shipmentField: 'eta', chronicleField: 'eta', label: 'ETA' },
  // Vessel & Carrier
  { shipmentField: 'vessel_name', chronicleField: 'vessel_name', label: 'Vessel' },
  { shipmentField: 'carrier_name', chronicleField: 'carrier_name', label: 'Carrier' },
  // Cutoffs
  { shipmentField: 'si_cutoff', chronicleField: 'si_cutoff', label: 'SI Cutoff' },
  { shipmentField: 'vgm_cutoff', chronicleField: 'vgm_cutoff', label: 'VGM Cutoff' },
  { shipmentField: 'cargo_cutoff', chronicleField: 'cargo_cutoff', label: 'Cargo Cutoff' },
  { shipmentField: 'doc_cutoff', chronicleField: 'doc_cutoff', label: 'Doc Cutoff' },
];

// Preferred document types for authoritative data (in priority order)
const PREFERRED_DOC_TYPES = [
  'booking_confirmation',
  'booking_amendment',
  'schedule_update',
  'arrival_notice',
  'shipping_instructions',
  'si_confirmation',
];

interface BackfillStats {
  field: string;
  checked: number;
  filled: number;
  skipped: number;
}

interface ShipmentUpdate {
  shipmentId: string;
  bookingNumber: string;
  field: string;
  oldValue: string | null;
  newValue: string;
  sourceChronicleId: string;
  sourceDocType: string;
}

// Date/timestamp fields that can't have empty string
const DATE_FIELDS = ['etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'doc_cutoff'];

async function backfillField(
  fieldMapping: typeof FIELD_MAPPINGS[0],
  dryRun: boolean,
  limit: number
): Promise<{ stats: BackfillStats; updates: ShipmentUpdate[] }> {
  const { shipmentField, chronicleField, label } = fieldMapping;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`Processing: ${label} (${shipmentField})`);
  console.log('='.repeat(60));

  // Find shipments missing this field
  // Date fields only check for NULL (can't be empty string)
  const isDateField = DATE_FIELDS.includes(shipmentField);
  let query = supabase
    .from('shipments')
    .select('id, booking_number')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (isDateField) {
    query = query.is(shipmentField, null);
  } else {
    query = query.or(`${shipmentField}.is.null,${shipmentField}.eq.`);
  }

  const { data: missingShipments, error: queryError } = await query;

  if (queryError) {
    console.error(`Error querying shipments:`, queryError.message);
    return { stats: { field: label, checked: 0, filled: 0, skipped: 0 }, updates: [] };
  }

  if (!missingShipments || missingShipments.length === 0) {
    console.log(`  No shipments missing ${label}`);
    return { stats: { field: label, checked: 0, filled: 0, skipped: 0 }, updates: [] };
  }

  console.log(`  Found ${missingShipments.length} shipments missing ${label}`);

  const stats: BackfillStats = { field: label, checked: missingShipments.length, filled: 0, skipped: 0 };
  const updates: ShipmentUpdate[] = [];

  for (const shipment of missingShipments) {
    // Find best chronicle record with this data
    // Priority: preferred doc types first, then most recent
    const { data: chronicleRecords } = await supabase
      .from('chronicle')
      .select(`id, document_type, ${chronicleField}, created_at`)
      .eq('shipment_id', shipment.id)
      .not(chronicleField, 'is', null)
      .neq(chronicleField, '')
      .order('created_at', { ascending: false })
      .limit(20);

    if (!chronicleRecords || chronicleRecords.length === 0) {
      stats.skipped++;
      continue;
    }

    // Pick best record: prefer authoritative doc types
    let bestRecord = chronicleRecords[0];
    for (const docType of PREFERRED_DOC_TYPES) {
      const preferred = chronicleRecords.find(r => r.document_type === docType);
      if (preferred) {
        bestRecord = preferred;
        break;
      }
    }

    const newValue = bestRecord[chronicleField as keyof typeof bestRecord] as string;

    if (!newValue || newValue.trim() === '') {
      stats.skipped++;
      continue;
    }

    updates.push({
      shipmentId: shipment.id,
      bookingNumber: shipment.booking_number || 'N/A',
      field: shipmentField,
      oldValue: null,
      newValue: newValue,
      sourceChronicleId: bestRecord.id,
      sourceDocType: bestRecord.document_type || 'unknown',
    });

    if (!dryRun) {
      const { error: updateError } = await supabase
        .from('shipments')
        .update({ [shipmentField]: newValue })
        .eq('id', shipment.id);

      if (updateError) {
        console.error(`  ❌ Failed to update ${shipment.booking_number}: ${updateError.message}`);
        stats.skipped++;
        continue;
      }
    }

    stats.filled++;
    console.log(`  ✓ ${shipment.booking_number}: ${label} = "${newValue}" (from ${bestRecord.document_type})`);
  }

  return { stats, updates };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]) : 500;

  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║     BACKFILL SHIPMENT DATA FROM CHRONICLE                      ║');
  console.log('╠════════════════════════════════════════════════════════════════╣');
  console.log(`║  Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE (will update DB)'}`.padEnd(67) + '║');
  console.log(`║  Limit: ${limit} shipments per field`.padEnd(67) + '║');
  console.log('╚════════════════════════════════════════════════════════════════╝');

  const allStats: BackfillStats[] = [];
  const allUpdates: ShipmentUpdate[] = [];

  for (const mapping of FIELD_MAPPINGS) {
    const { stats, updates } = await backfillField(mapping, dryRun, limit);
    allStats.push(stats);
    allUpdates.push(...updates);
  }

  // Summary
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║                        SUMMARY                                 ║');
  console.log('╠═══════════════════╦══════════╦══════════╦══════════════════════╣');
  console.log('║ Field             ║ Checked  ║ Filled   ║ Skipped              ║');
  console.log('╠═══════════════════╬══════════╬══════════╬══════════════════════╣');

  let totalChecked = 0, totalFilled = 0, totalSkipped = 0;
  for (const stat of allStats) {
    console.log(`║ ${stat.field.padEnd(17)} ║ ${String(stat.checked).padStart(8)} ║ ${String(stat.filled).padStart(8)} ║ ${String(stat.skipped).padStart(20)} ║`);
    totalChecked += stat.checked;
    totalFilled += stat.filled;
    totalSkipped += stat.skipped;
  }

  console.log('╠═══════════════════╬══════════╬══════════╬══════════════════════╣');
  console.log(`║ ${'TOTAL'.padEnd(17)} ║ ${String(totalChecked).padStart(8)} ║ ${String(totalFilled).padStart(8)} ║ ${String(totalSkipped).padStart(20)} ║`);
  console.log('╚═══════════════════╩══════════╩══════════╩══════════════════════╝');

  if (dryRun) {
    console.log('\n⚠️  DRY RUN - No changes made. Run without --dry-run to apply.');
  } else {
    console.log(`\n✅ Backfill complete! ${totalFilled} fields updated.`);
  }

  // Log updates for audit
  if (allUpdates.length > 0 && !dryRun) {
    console.log('\n📝 Logging changes to shipment_backfill_audit...');

    // Create audit log entries
    const auditEntries = allUpdates.map(u => ({
      shipment_id: u.shipmentId,
      field_name: u.field,
      old_value: u.oldValue,
      new_value: u.newValue,
      source_chronicle_id: u.sourceChronicleId,
      source_document_type: u.sourceDocType,
      backfill_run_at: new Date().toISOString(),
    }));

    // Try to insert audit log (table may not exist)
    const { error: auditError } = await supabase
      .from('shipment_backfill_audit')
      .insert(auditEntries);

    if (auditError) {
      console.log('  (Audit table not found - skipping audit log)');
    } else {
      console.log(`  ✓ ${auditEntries.length} audit entries logged`);
    }
  }
}

main().catch(console.error);
