#!/usr/bin/env npx tsx
/**
 * Complete Database Stats Report
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    COMPLETE DATABASE STATISTICS                                ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  // ============================================================================
  // EMAIL STATS
  // ============================================================================
  console.log('═'.repeat(80));
  console.log('1. EMAIL OVERVIEW');
  console.log('═'.repeat(80));

  const { count: totalEmails } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true });

  const { count: withAttachments } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true })
    .eq('has_attachments', true);

  const { count: totalAttachments } = await supabase
    .from('raw_attachments')
    .select('*', { count: 'exact', head: true });

  const { count: classified } = await supabase
    .from('document_classifications')
    .select('*', { count: 'exact', head: true });

  console.log(`  Total Emails:           ${totalEmails}`);
  console.log(`  With Attachments:       ${withAttachments} (${Math.round((withAttachments || 0) / (totalEmails || 1) * 100)}%)`);
  console.log(`  Total Attachment Files: ${totalAttachments}`);
  console.log(`  Classified:             ${classified}`);
  console.log('');

  // ============================================================================
  // SHIPPING LINE BREAKDOWN
  // ============================================================================
  console.log('═'.repeat(80));
  console.log('2. SHIPPING LINE BREAKDOWN');
  console.log('═'.repeat(80));

  // Get all emails with sender info
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('sender_email, true_sender_email');

  const carrierDomains: Record<string, { pattern: RegExp; name: string }> = {
    maersk: { pattern: /maersk\.com|sealand\.com/i, name: 'Maersk Line' },
    'hapag-lloyd': { pattern: /hapag-lloyd\.com|hlag\.com|hlag\.cloud/i, name: 'Hapag-Lloyd' },
    'cma-cgm': { pattern: /cma-cgm\.com|apl\.com/i, name: 'CMA CGM' },
    cosco: { pattern: /coscon\.com|oocl\.com/i, name: 'COSCO Shipping' },
    msc: { pattern: /msc\.com/i, name: 'MSC' },
    evergreen: { pattern: /evergreen-line\.com|evergreen-marine\.com/i, name: 'Evergreen' },
    one: { pattern: /one-line\.com/i, name: 'ONE (Ocean Network Express)' },
    yangming: { pattern: /yangming\.com/i, name: 'Yang Ming' },
  };

  const carrierCounts: Record<string, number> = {};
  let shippingLineEmails = 0;
  let nonShippingLineEmails = 0;

  for (const email of emails || []) {
    const sender = (email.true_sender_email || email.sender_email || '').toLowerCase();
    let matched = false;

    for (const [carrierId, config] of Object.entries(carrierDomains)) {
      if (config.pattern.test(sender)) {
        carrierCounts[carrierId] = (carrierCounts[carrierId] || 0) + 1;
        shippingLineEmails++;
        matched = true;
        break;
      }
    }

    if (!matched) {
      nonShippingLineEmails++;
    }
  }

  console.log(`  From Shipping Lines:    ${shippingLineEmails} (${Math.round(shippingLineEmails / (totalEmails || 1) * 100)}%)`);
  console.log(`  Non-Shipping Lines:     ${nonShippingLineEmails} (${Math.round(nonShippingLineEmails / (totalEmails || 1) * 100)}%)`);
  console.log('');
  console.log('  BY CARRIER:');
  console.log('  ' + '─'.repeat(50));

  const sortedCarriers = Object.entries(carrierCounts).sort((a, b) => b[1] - a[1]);
  for (const [carrierId, count] of sortedCarriers) {
    const name = carrierDomains[carrierId]?.name || carrierId;
    const pct = Math.round(count / shippingLineEmails * 100);
    const bar = '█'.repeat(Math.min(30, Math.round(count / 20)));
    console.log(`  ${name.padEnd(25)} ${String(count).padStart(5)} (${String(pct).padStart(2)}%) ${bar}`);
  }
  console.log('');

  // ============================================================================
  // DOCUMENT TYPE DISTRIBUTION
  // ============================================================================
  console.log('═'.repeat(80));
  console.log('3. DOCUMENT TYPE DISTRIBUTION');
  console.log('═'.repeat(80));

  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('document_type');

  const docTypeCounts: Record<string, number> = {};
  for (const cls of classifications || []) {
    const type = cls.document_type || 'unknown';
    docTypeCounts[type] = (docTypeCounts[type] || 0) + 1;
  }

  const sortedDocTypes = Object.entries(docTypeCounts).sort((a, b) => b[1] - a[1]);
  console.log('  DOCUMENT TYPE                    COUNT    %');
  console.log('  ' + '─'.repeat(55));

  for (const [type, count] of sortedDocTypes) {
    const pct = Math.round(count / (classified || 1) * 100);
    const bar = '█'.repeat(Math.min(25, Math.round(count / 20)));
    console.log(`  ${type.padEnd(30)} ${String(count).padStart(5)} (${String(pct).padStart(2)}%) ${bar}`);
  }
  console.log('');

  // ============================================================================
  // DOCUMENT TYPE BY CARRIER
  // ============================================================================
  console.log('═'.repeat(80));
  console.log('4. DOCUMENT TYPES BY SHIPPING LINE');
  console.log('═'.repeat(80));

  // Get classifications with email sender info
  const { data: clsWithEmail } = await supabase
    .from('document_classifications')
    .select(`
      document_type,
      raw_emails!inner(sender_email, true_sender_email)
    `);

  const carrierDocTypes: Record<string, Record<string, number>> = {};

  for (const cls of clsWithEmail || []) {
    const email = (cls as any).raw_emails;
    const sender = (email?.true_sender_email || email?.sender_email || '').toLowerCase();
    const docType = cls.document_type;

    let carrierId = 'other';
    for (const [cId, config] of Object.entries(carrierDomains)) {
      if (config.pattern.test(sender)) {
        carrierId = cId;
        break;
      }
    }

    if (!carrierDocTypes[carrierId]) carrierDocTypes[carrierId] = {};
    carrierDocTypes[carrierId][docType] = (carrierDocTypes[carrierId][docType] || 0) + 1;
  }

  // Show top carriers
  for (const carrierId of ['maersk', 'hapag-lloyd', 'cma-cgm', 'cosco']) {
    const types = carrierDocTypes[carrierId];
    if (!types) continue;

    const carrierName = carrierDomains[carrierId]?.name || carrierId;
    const total = Object.values(types).reduce((a, b) => a + b, 0);

    console.log(`\n  ${carrierName} (${total} emails):`);
    console.log('  ' + '─'.repeat(50));

    const sorted = Object.entries(types).sort((a, b) => b[1] - a[1]);
    for (const [type, count] of sorted.slice(0, 10)) {
      console.log(`    ${type.padEnd(28)} ${String(count).padStart(4)}`);
    }
  }

  // ============================================================================
  // SHIPMENT & ENTITY STATS
  // ============================================================================
  console.log('');
  console.log('═'.repeat(80));
  console.log('5. SHIPMENT & ENTITY EXTRACTION');
  console.log('═'.repeat(80));

  const { count: shipments } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  const { count: entities } = await supabase
    .from('entity_extractions')
    .select('*', { count: 'exact', head: true });

  const { count: parties } = await supabase
    .from('parties')
    .select('*', { count: 'exact', head: true });

  const { count: notifications } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true });

  const { count: tasks } = await supabase
    .from('action_tasks')
    .select('*', { count: 'exact', head: true });

  const { count: docLifecycle } = await supabase
    .from('document_lifecycle')
    .select('*', { count: 'exact', head: true });

  console.log(`  Shipments Created:      ${shipments}`);
  console.log(`  Entity Extractions:     ${entities}`);
  console.log(`  Parties:                ${parties}`);
  console.log(`  Document Lifecycle:     ${docLifecycle}`);
  console.log(`  Notifications:          ${notifications}`);
  console.log(`  Action Tasks:           ${tasks}`);
  console.log('');

  // Entity type breakdown
  const { data: entityTypes } = await supabase
    .from('entity_extractions')
    .select('entity_type');

  const entityTypeCounts: Record<string, number> = {};
  for (const e of entityTypes || []) {
    entityTypeCounts[e.entity_type] = (entityTypeCounts[e.entity_type] || 0) + 1;
  }

  console.log('  ENTITY TYPES EXTRACTED:');
  console.log('  ' + '─'.repeat(40));
  const sortedEntityTypes = Object.entries(entityTypeCounts).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedEntityTypes.slice(0, 15)) {
    console.log(`    ${type.padEnd(25)} ${count}`);
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('');
  console.log('═'.repeat(80));
  console.log('SUMMARY');
  console.log('═'.repeat(80));
  console.log(`
  ┌────────────────────────────────────────────────────────────────┐
  │  TOTAL EMAILS:          ${String(totalEmails).padStart(6)}                              │
  │  ├─ Shipping Lines:     ${String(shippingLineEmails).padStart(6)} (${String(Math.round(shippingLineEmails / (totalEmails || 1) * 100)).padStart(2)}%)                        │
  │  └─ Other:              ${String(nonShippingLineEmails).padStart(6)} (${String(Math.round(nonShippingLineEmails / (totalEmails || 1) * 100)).padStart(2)}%)                        │
  │                                                                │
  │  ATTACHMENTS:           ${String(totalAttachments).padStart(6)}                              │
  │  SHIPMENTS:             ${String(shipments).padStart(6)}                              │
  │  ENTITY EXTRACTIONS:    ${String(entities).padStart(6)}                              │
  └────────────────────────────────────────────────────────────────┘
`);
}

main().catch(console.error);
