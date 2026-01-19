#!/usr/bin/env npx tsx
/**
 * Check what document types have no extractions
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function check() {
  // Get all email IDs with extractions
  const { data: extractions } = await supabase
    .from('entity_extractions')
    .select('email_id');

  const extractedIds = new Set(extractions?.map(e => e.email_id) || []);
  console.log(`Emails WITH extractions: ${extractedIds.size}`);

  // Get all classifications
  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('email_id, document_type');

  // Count by document type - extracted vs not
  const withExtraction: Record<string, number> = {};
  const withoutExtraction: Record<string, number> = {};

  for (const c of classifications || []) {
    if (extractedIds.has(c.email_id)) {
      withExtraction[c.document_type] = (withExtraction[c.document_type] || 0) + 1;
    } else {
      withoutExtraction[c.document_type] = (withoutExtraction[c.document_type] || 0) + 1;
    }
  }

  console.log('');
  console.log('DOCUMENT TYPES WITHOUT EXTRACTIONS (top 20):');
  console.log('─'.repeat(60));
  console.log('These emails were classified but entity extraction was skipped.');
  console.log('');

  const sorted = Object.entries(withoutExtraction).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sorted.slice(0, 20)) {
    const withCount = withExtraction[type] || 0;
    const total = count + withCount;
    const pct = Math.round(count / total * 100);
    console.log(`  ${type.padEnd(35)} ${String(count).padStart(4)} / ${total} (${pct}% unextracted)`);
  }

  // Show types that SHOULD have extraction (booking-related)
  console.log('');
  console.log('SHIPPING DOCUMENT TYPES - EXTRACTION GAP:');
  console.log('─'.repeat(60));

  const shippingTypes = [
    'booking_confirmation', 'booking_amendment', 'bill_of_lading',
    'shipping_instruction', 'arrival_notice', 'cargo_release',
    'delivery_order', 'isf_filing', 'vgm_submission'
  ];

  for (const type of shippingTypes) {
    const without = withoutExtraction[type] || 0;
    const withE = withExtraction[type] || 0;
    const total = without + withE;
    if (total > 0) {
      const pct = Math.round(without / total * 100);
      console.log(`  ${type.padEnd(35)} ${without} / ${total} missing extraction (${pct}%)`);
    }
  }

  // Total linkable potential
  console.log('');
  console.log('SUMMARY:');
  console.log('─'.repeat(60));

  let shippingWithout = 0;
  let shippingWith = 0;
  for (const type of shippingTypes) {
    shippingWithout += withoutExtraction[type] || 0;
    shippingWith += withExtraction[type] || 0;
  }

  console.log(`  Shipping docs with extraction:    ${shippingWith}`);
  console.log(`  Shipping docs WITHOUT extraction: ${shippingWithout}`);
  console.log(`  Non-shipping docs (no link needed): ${Object.values(withoutExtraction).reduce((a, b) => a + b, 0) - shippingWithout}`);
}

check().catch(console.error);
