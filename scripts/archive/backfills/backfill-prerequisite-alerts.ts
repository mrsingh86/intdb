#!/usr/bin/env npx tsx
/**
 * Backfill Prerequisite Alerts
 *
 * Scans all existing shipments and creates missing document alerts
 * for any documents that arrived out of order (e.g., BL without SI)
 */

import { createClient } from '@supabase/supabase-js';
import { DocumentLifecycleService } from '../lib/services/document-lifecycle-service';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const lifecycleService = new DocumentLifecycleService(supabase);

async function backfillAlerts() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('BACKFILL PREREQUISITE ALERTS');
  console.log('════════════════════════════════════════════════════════════════');
  console.log('');

  console.log('Running prerequisite check on all shipments...');
  console.log('');

  const result = await lifecycleService.backfillPrerequisiteAlerts();

  console.log('RESULTS:');
  console.log('─'.repeat(60));
  console.log(`  Shipments checked: ${result.shipmentsChecked}`);
  console.log(`  Alerts created: ${result.alertsCreated}`);
  console.log(`  Violations found: ${result.violations.length}`);
  console.log('');

  if (result.violations.length > 0) {
    console.log('VIOLATIONS BY DOCUMENT TYPE:');
    console.log('─'.repeat(60));

    // Group violations by document type
    const byDocType: Record<string, { count: number; missing: Set<string> }> = {};

    for (const v of result.violations) {
      if (!byDocType[v.documentType]) {
        byDocType[v.documentType] = { count: 0, missing: new Set() };
      }
      byDocType[v.documentType].count++;
      v.missing.forEach(m => byDocType[v.documentType].missing.add(m));
    }

    for (const [docType, info] of Object.entries(byDocType).sort((a, b) => b[1].count - a[1].count)) {
      console.log(`  ${docType}: ${info.count} shipments`);
      console.log(`    Missing: ${Array.from(info.missing).join(', ')}`);
    }

    console.log('');
    console.log('SAMPLE VIOLATIONS (first 10):');
    console.log('─'.repeat(60));

    for (const v of result.violations.slice(0, 10)) {
      // Get shipment booking number
      const { data: shipment } = await supabase
        .from('shipments')
        .select('booking_number')
        .eq('id', v.shipmentId)
        .single();

      const bookingNum = shipment?.booking_number || 'N/A';
      console.log(`  ${bookingNum.substring(0, 20).padEnd(22)} │ ${v.documentType} received without ${v.missing.join(', ')}`);
    }
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════════════');

  // Show current alerts in database
  const { count: alertCount } = await supabase
    .from('missing_document_alerts')
    .select('*', { count: 'exact', head: true });

  console.log(`Total alerts in database: ${alertCount}`);
  console.log('════════════════════════════════════════════════════════════════');
}

backfillAlerts().catch(console.error);
