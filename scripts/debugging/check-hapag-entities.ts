/**
 * Check Hapag-Lloyd Entity Extraction
 *
 * Investigates why some Hapag-Lloyd emails have entities but no dates.
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function checkHapagEntities() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         CHECK HAPAG-LLOYD ENTITY EXTRACTION                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get Hapag-Lloyd emails
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email')
    .or('sender_email.ilike.%hlag%,sender_email.ilike.%hapag%');

  if (!emails || emails.length === 0) {
    console.log('No Hapag-Lloyd emails found');
    return;
  }

  console.log(`Found ${emails.length} Hapag-Lloyd emails\n`);

  for (const email of emails) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`Subject: ${email.subject?.substring(0, 60)}`);
    console.log(`From: ${email.sender_email}`);

    // Get classification
    const { data: classification } = await supabase
      .from('document_classifications')
      .select('document_type')
      .eq('email_id', email.id)
      .single();

    console.log(`Type: ${classification?.document_type || 'N/A'}`);

    // Get entities
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', email.id);

    if (entities && entities.length > 0) {
      console.log(`Entities (${entities.length}):`);
      for (const e of entities) {
        const isDateType = ['etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff'].includes(e.entity_type);
        const prefix = isDateType ? '  📅 ' : '     ';
        console.log(`${prefix}${e.entity_type}: ${e.entity_value?.substring(0, 50)}`);
      }
    } else {
      console.log('  ⚠️  No entities extracted');
    }
  }
}

checkHapagEntities().catch(console.error);
