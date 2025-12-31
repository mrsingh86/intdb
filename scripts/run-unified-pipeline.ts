#!/usr/bin/env npx tsx
/**
 * Run Unified Email Processing Pipeline
 *
 * Processes all emails through the unified pipeline:
 * 1. Classification → Extraction → Shipment Linking → Document Lifecycle
 *
 * Prioritizes:
 * - Booking confirmations (create/update shipments)
 * - Booking amendments (update shipments with revisions)
 * - Other documents (link to shipments)
 */

import { EmailProcessingOrchestrator } from '../lib/services/email-processing-orchestrator';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

if (!supabaseUrl || !supabaseKey || !anthropicKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

async function main() {
  console.log('=== UNIFIED EMAIL PROCESSING PIPELINE ===\n');

  const orchestrator = new EmailProcessingOrchestrator(supabaseUrl!, supabaseKey!, anthropicKey!);
  await orchestrator.initialize();

  // Get emails needing processing
  const emailIds = await orchestrator.getEmailsNeedingProcessing(100);
  console.log('Emails to process:', emailIds.length);

  if (emailIds.length === 0) {
    console.log('No emails need processing');
    return;
  }

  // Track stats
  const stats = {
    processed: 0,
    success: 0,
    failed: 0,
    shipmentsCreated: 0,
    shipmentsUpdated: 0,
    fieldsExtracted: 0,
  };

  // Process with progress
  const results = await orchestrator.processBatch(emailIds, (processed, total) => {
    if (processed % 10 === 0) {
      console.log(`Progress: ${processed}/${total}`);
    }
  });

  // Analyze results
  for (const result of results) {
    stats.processed++;
    if (result.success) {
      stats.success++;
      if (result.shipmentId) {
        stats.shipmentsUpdated++;
      }
      stats.fieldsExtracted += result.fieldsExtracted || 0;
    } else {
      stats.failed++;
    }
  }

  console.log('\n=== RESULTS ===');
  console.log('Processed:', stats.processed);
  console.log('Success:', stats.success);
  console.log('Failed:', stats.failed);
  console.log('Shipments updated:', stats.shipmentsUpdated);
  console.log('Fields extracted:', stats.fieldsExtracted);

  // Show current coverage
  console.log('\n=== COVERAGE CHECK ===');

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl!, supabaseKey!);

  const { data: shipments } = await supabase.from('shipments').select('*');
  const total = shipments?.length || 0;

  const fields = [
    'carrier_id', 'vessel_name', 'etd', 'eta',
    'port_of_loading', 'port_of_discharge',
    'si_cutoff', 'vgm_cutoff', 'cargo_cutoff',
    'shipper_name', 'consignee_name'
  ];

  for (const field of fields) {
    const count = shipments?.filter(s => (s as any)[field]).length || 0;
    const pct = Math.round((count / total) * 100);
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    console.log(`${field.padEnd(20)} ${bar} ${pct}%`);
  }
}

main().catch(console.error);
