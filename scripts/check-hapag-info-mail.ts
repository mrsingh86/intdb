/**
 * Check Hapag-Lloyd Info Mail
 *
 * These emails have entities but no dates - let's see why
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function checkHapagInfoMail() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         CHECK HAPAG-LLOYD INFO MAIL                               ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get emails with "Hapag-Lloyd Info Mail" subject
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, body_text')
    .eq('subject', 'Hapag-Lloyd Info Mail');

  if (!emails || emails.length === 0) {
    console.log('No "Hapag-Lloyd Info Mail" emails found');
    return;
  }

  console.log(`Found ${emails.length} "Hapag-Lloyd Info Mail" emails\n`);

  for (const email of emails) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`From: ${email.sender_email}`);
    console.log(`\nBody sample (first 1500 chars):`);
    console.log(email.body_text?.substring(0, 1500) || 'No body');

    // Check if there's deadline content
    const bodyLower = (email.body_text || '').toLowerCase();
    const hasDeadline = bodyLower.includes('deadline') || bodyLower.includes('cut-off') || bodyLower.includes('cutoff');
    console.log(`\nHas deadline content: ${hasDeadline ? 'YES' : 'NO'}`);

    // Get entities
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', email.id);

    console.log(`Entities: ${entities?.length || 0}`);
    if (entities) {
      for (const e of entities) {
        console.log(`  - ${e.entity_type}: ${e.entity_value}`);
      }
    }
  }

  // Check duplicate shipments
  console.log('\n\n' + '═'.repeat(70));
  console.log('CHECKING DUPLICATE SHIPMENTS');
  console.log('═'.repeat(70));

  const { data: allShipments } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, eta');

  if (allShipments) {
    // Find duplicates by similar booking numbers
    const byNumber: Record<string, any[]> = {};
    allShipments.forEach(s => {
      const cleanNum = (s.booking_number || '').replace(/^HL-/, '');
      if (cleanNum) {
        if (!byNumber[cleanNum]) byNumber[cleanNum] = [];
        byNumber[cleanNum].push(s);
      }
    });

    const duplicates = Object.entries(byNumber).filter(([_, ships]) => ships.length > 1);
    console.log(`\nFound ${duplicates.length} potential duplicates:`);

    for (const [num, ships] of duplicates) {
      console.log(`\n  ${num}:`);
      for (const s of ships) {
        console.log(`    - ${s.booking_number}: ETD=${s.etd || 'NULL'}, ETA=${s.eta || 'NULL'}`);
      }
    }
  }
}

checkHapagInfoMail().catch(console.error);
