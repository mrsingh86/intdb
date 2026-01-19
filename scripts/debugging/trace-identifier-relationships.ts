/**
 * Trace how identifiers are related to each other
 * Shows the transitive relationship: booking → shipment ← container/BL/MBL
 */

import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('TRACING IDENTIFIER RELATIONSHIPS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // Pick a sample shipment with multiple identifiers
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number, mbl_number, container_number_primary')
    .not('container_number_primary', 'is', null)
    .not('bl_number', 'is', null)
    .limit(3);

  for (const shipment of shipments || []) {
    console.log('\n┌─────────────────────────────────────────────────────────────────────────────┐');
    console.log(`│ SHIPMENT: ${shipment.booking_number}`.padEnd(77) + '│');
    console.log('└─────────────────────────────────────────────────────────────────────────────┘');

    console.log('\n   IDENTIFIERS IN SHIPMENTS TABLE:');
    console.log(`   - booking_number: ${shipment.booking_number}`);
    console.log(`   - bl_number: ${shipment.bl_number || 'NULL'}`);
    console.log(`   - mbl_number: ${shipment.mbl_number || 'NULL'}`);
    console.log(`   - container_number_primary: ${shipment.container_number_primary || 'NULL'}`);

    // Get linked documents
    const { data: links } = await supabase
      .from('shipment_documents')
      .select('email_id, document_type')
      .eq('shipment_id', shipment.id);

    console.log(`\n   LINKED DOCUMENTS: ${links?.length || 0}`);

    // For each linked document, show what identifiers it has
    for (const link of (links || []).slice(0, 5)) {
      const { data: entities } = await supabase
        .from('entity_extractions')
        .select('entity_type, entity_value')
        .eq('email_id', link.email_id)
        .in('entity_type', ['booking_number', 'bl_number', 'mbl_number', 'container_number']);

      const { data: email } = await supabase
        .from('raw_emails')
        .select('subject')
        .eq('id', link.email_id)
        .single();

      const identifiers = entities?.map(e => `${e.entity_type}:${e.entity_value}`).join(', ') || 'none';
      console.log(`\n   📧 ${link.document_type}`);
      console.log(`      Subject: ${(email?.subject || '').substring(0, 50)}...`);
      console.log(`      Identifiers: ${identifiers}`);
    }
  }

  // Show emails that ONLY have secondary identifiers (no booking)
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('EMAILS LINKED VIA SECONDARY IDENTIFIERS (no booking number)');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // Get emails with container but no booking
  const { data: containerOnlyEmails } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_value')
    .eq('entity_type', 'container_number')
    .limit(100);

  const emailsWithContainer = new Set(containerOnlyEmails?.map(e => e.email_id) || []);

  const { data: bookingEmails } = await supabase
    .from('entity_extractions')
    .select('email_id')
    .eq('entity_type', 'booking_number')
    .in('email_id', [...emailsWithContainer]);

  const emailsWithBooking = new Set(bookingEmails?.map(e => e.email_id) || []);

  // Find emails with container but NO booking
  let containerOnlyCount = 0;
  const containerOnlyExamples: { emailId: string; container: string }[] = [];

  for (const e of containerOnlyEmails || []) {
    if (!emailsWithBooking.has(e.email_id)) {
      containerOnlyCount++;
      if (containerOnlyExamples.length < 5) {
        containerOnlyExamples.push({ emailId: e.email_id, container: e.entity_value });
      }
    }
  }

  console.log(`\n   Emails with container but NO booking number: ${containerOnlyCount}`);

  for (const ex of containerOnlyExamples) {
    // Check if this email is linked
    const { data: link } = await supabase
      .from('shipment_documents')
      .select('shipment_id')
      .eq('email_id', ex.emailId)
      .single();

    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject')
      .eq('id', ex.emailId)
      .single();

    if (link) {
      // Get the shipment's booking number
      const { data: shipment } = await supabase
        .from('shipments')
        .select('booking_number')
        .eq('id', link.shipment_id)
        .single();

      console.log(`\n   ✅ LINKED via container: ${ex.container}`);
      console.log(`      Subject: ${(email?.subject || '').substring(0, 50)}...`);
      console.log(`      → Shipment booking: ${shipment?.booking_number}`);
    } else {
      console.log(`\n   ❌ NOT LINKED: ${ex.container}`);
      console.log(`      Subject: ${(email?.subject || '').substring(0, 50)}...`);
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('HOW THE MATCHING WORKS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  console.log(`
   STEP 1: Email with booking_number arrives
   ┌────────────────────────────────────┐
   │ Email A                            │
   │ booking: 263805268                 │
   │ container: MSKU1234567             │──────┐
   │ bl: SE1125002929                   │      │
   └────────────────────────────────────┘      │ linked via
                                               │ booking_number
   STEP 2: Shipment created/updated            ↓
   ┌────────────────────────────────────┐
   │ Shipment S                         │
   │ booking_number: 263805268          │
   │ container_number_primary: NULL     │◄─── backfill copies
   │ bl_number: NULL                    │     container & BL
   └────────────────────────────────────┘

   STEP 3: Backfill runs (we just did this)
   ┌────────────────────────────────────┐
   │ Shipment S                         │
   │ booking_number: 263805268          │
   │ container_number_primary: MSKU1234567 │
   │ bl_number: SE1125002929            │
   └────────────────────────────────────┘

   STEP 4: New email with only container arrives
   ┌────────────────────────────────────┐
   │ Email B (arrival notice)           │
   │ booking: NULL                      │
   │ container: MSKU1234567             │──────┐
   └────────────────────────────────────┘      │ lookup by
                                               │ container_number
                                               ↓
   ┌────────────────────────────────────┐
   │ Shipment S                         │
   │ container_number_primary: MSKU1234567 │◄── MATCH!
   └────────────────────────────────────┘
`);

  console.log('   ⚠️  LIMITATION: If container/BL was never in a linked email,');
  console.log('      the shipment won\'t have it, and fallback linking won\'t work.');
}

main().catch(console.error);
