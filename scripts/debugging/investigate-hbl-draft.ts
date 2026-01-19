/**
 * Investigate HBL draft direction - should be shared, not received
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

function isIntoglo(email: string): boolean {
  const e = (email || '').toLowerCase();
  return e.includes('@intoglo.com') || e.includes('@intoglo.in');
}

function isCarrier(email: string): boolean {
  const e = (email || '').toLowerCase();
  return e.includes('maersk') || e.includes('hlag') || e.includes('cma-cgm') ||
    e.includes('hapag') || e.includes('cosco') || e.includes('evergreen') ||
    e.includes('one-line') || e.includes('yangming') || e.includes('msc.com') ||
    e.includes('oaborea') || e.includes('odex');
}

async function main() {
  // Get all hbl_draft classified emails
  const { data: hblDrafts } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'hbl_draft');

  console.log('═'.repeat(80));
  console.log('HBL DRAFT INVESTIGATION');
  console.log('═'.repeat(80));
  console.log('\nTotal hbl_draft classified:', hblDrafts?.length || 0);

  if (!hblDrafts || hblDrafts.length === 0) {
    console.log('No hbl_draft emails found');
    return;
  }

  // Get email details
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email')
    .in('id', hblDrafts.map(d => d.email_id));

  console.log('\nHBL DRAFT emails breakdown:');
  console.log('─'.repeat(80));

  let fromIntoglo = 0;
  let fromCarrier = 0;
  let fromOther = 0;

  const intogloEmails: typeof emails = [];
  const carrierEmails: typeof emails = [];
  const otherEmails: typeof emails = [];

  emails?.forEach(e => {
    const sender = e.sender_email || e.true_sender_email || '';
    if (isIntoglo(sender)) {
      fromIntoglo++;
      intogloEmails.push(e);
    } else if (isCarrier(sender)) {
      fromCarrier++;
      carrierEmails.push(e);
    } else {
      fromOther++;
      otherEmails.push(e);
    }
  });

  console.log('From Intoglo (outbound to shipper):', fromIntoglo);
  console.log('From Carrier:', fromCarrier);
  console.log('From Other (shipper?):', fromOther);

  // Show samples from each category
  if (intogloEmails.length > 0) {
    console.log('\n\nFROM INTOGLO (correct - sharing HBL draft with shipper):');
    console.log('─'.repeat(80));
    intogloEmails.slice(0, 5).forEach(e => {
      console.log('  Sender:', e?.sender_email);
      console.log('  Subject:', (e?.subject || '').substring(0, 70));
      console.log('');
    });
  }

  if (carrierEmails.length > 0) {
    console.log('\n\nFROM CARRIER (BL draft from carrier - needs review):');
    console.log('─'.repeat(80));
    carrierEmails.slice(0, 5).forEach(e => {
      console.log('  Sender:', e?.sender_email);
      console.log('  Subject:', (e?.subject || '').substring(0, 70));
      console.log('');
    });
  }

  if (otherEmails.length > 0) {
    console.log('\n\nFROM OTHER (shipper response? - needs review):');
    console.log('─'.repeat(80));
    otherEmails.slice(0, 5).forEach(e => {
      console.log('  Sender:', e?.sender_email);
      console.log('  Subject:', (e?.subject || '').substring(0, 70));
      console.log('');
    });
  }

  // Summary
  console.log('\n═'.repeat(80));
  console.log('ANALYSIS:');
  console.log('─'.repeat(80));
  console.log('HBL Draft workflow should be:');
  console.log('  1. Carrier sends BL draft to Intoglo');
  console.log('  2. Intoglo shares HBL draft with shipper for approval');
  console.log('  3. Shipper approves/rejects');
  console.log('');
  console.log('Current classification:');
  console.log('  - From Intoglo:', fromIntoglo, '(correctly sharing with shipper)');
  console.log('  - From Carrier:', fromCarrier, '(carrier BL draft - different workflow state?)');
  console.log('  - From Other:', fromOther, '(shipper response?)');
  console.log('═'.repeat(80));
}

main().catch(console.error);
