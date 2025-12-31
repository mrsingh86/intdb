/**
 * Analyze Maersk and MSC Email Formats
 *
 * Deep dive into the content to find ETA/ETD/deadline patterns
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function analyzeEmails() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         ANALYZE MAERSK & MSC EMAIL CONTENT                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get Maersk emails
  console.log('MAERSK EMAILS:\n');
  const { data: maerskEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, body_text')
    .ilike('sender_email', '%maersk%');

  for (const email of maerskEmails || []) {
    console.log('═'.repeat(70));
    console.log(`Subject: ${email.subject}`);
    console.log(`From: ${email.sender_email}`);
    console.log('\nFULL BODY TEXT:');
    console.log('─'.repeat(70));
    console.log(email.body_text || 'No body');
    console.log('─'.repeat(70));

    // Get existing entities
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', email.id);

    console.log('\nExisting entities:', entities?.length || 0);
    entities?.forEach(e => console.log(`  ${e.entity_type}: ${e.entity_value}`));
    console.log('\n');
  }

  // Get MSC emails
  console.log('\n\nMSC EMAILS:\n');
  const { data: mscEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, body_text')
    .or('sender_email.ilike.%msc%,sender_email.ilike.%medlog%');

  for (const email of mscEmails || []) {
    console.log('═'.repeat(70));
    console.log(`Subject: ${email.subject}`);
    console.log(`From: ${email.sender_email}`);
    console.log('\nFULL BODY TEXT:');
    console.log('─'.repeat(70));
    console.log(email.body_text?.substring(0, 5000) || 'No body');
    console.log('─'.repeat(70));

    // Get existing entities
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', email.id);

    console.log('\nExisting entities:', entities?.length || 0);
    entities?.forEach(e => console.log(`  ${e.entity_type}: ${e.entity_value}`));
    console.log('\n');
  }
}

analyzeEmails().catch(console.error);
