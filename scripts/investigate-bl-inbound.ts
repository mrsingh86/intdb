/**
 * Investigate bill_of_lading inbound - what are these?
 * MBL from carrier vs HBL from Intoglo
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
    e.includes('oocl') || e.includes('zim') || e.includes('odex') ||
    e.includes('inttra') || e.includes('cargowise');
}

async function main() {
  // Get bill_of_lading classified emails
  const { data: blDocs } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'bill_of_lading');

  console.log('═'.repeat(80));
  console.log('BILL OF LADING INVESTIGATION');
  console.log('═'.repeat(80));
  console.log('\nTotal bill_of_lading classified:', blDocs?.length || 0);

  if (!blDocs || blDocs.length === 0) return;

  // Get email details
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email')
    .in('id', blDocs.map(d => d.email_id));

  let fromIntoglo = 0;
  let fromCarrier = 0;
  let fromOther = 0;

  const carrierEmails: typeof emails = [];
  const otherEmails: typeof emails = [];

  emails?.forEach(e => {
    const sender = e.sender_email || e.true_sender_email || '';
    if (isIntoglo(sender)) {
      fromIntoglo++;
    } else if (isCarrier(sender)) {
      fromCarrier++;
      carrierEmails.push(e);
    } else {
      fromOther++;
      otherEmails.push(e);
    }
  });

  console.log('\nBILL OF LADING emails by sender:');
  console.log('─'.repeat(80));
  console.log('From Intoglo (outbound - HBL shared):', fromIntoglo);
  console.log('From Carrier (inbound - MBL/OBL draft):', fromCarrier);
  console.log('From Other:', fromOther);

  // Analyze carrier BL emails
  if (carrierEmails.length > 0) {
    console.log('\n\nFROM CARRIER (MBL/OBL from shipping lines):');
    console.log('─'.repeat(80));

    // Check for draft vs release patterns
    let drafts = 0;
    let releases = 0;
    let other = 0;

    carrierEmails.forEach(e => {
      const subject = (e?.subject || '').toLowerCase();
      if (subject.includes('draft')) drafts++;
      else if (subject.includes('release') || subject.includes('surrender') || subject.includes('telex')) releases++;
      else other++;
    });

    console.log('  Contains "draft":', drafts);
    console.log('  Contains "release/surrender/telex":', releases);
    console.log('  Other:', other);

    console.log('\nSample carrier BL emails:');
    carrierEmails.slice(0, 8).forEach(e => {
      const subject = (e?.subject || '');
      const isDraft = subject.toLowerCase().includes('draft');
      const isRelease = subject.toLowerCase().includes('release') || subject.toLowerCase().includes('surrender');
      const tag = isDraft ? '[DRAFT]' : isRelease ? '[RELEASE]' : '[OTHER]';
      console.log('  ' + tag + ' ' + subject.substring(0, 60));
    });
  }

  // Analyze "other" BL emails (not Intoglo, not carrier)
  if (otherEmails.length > 0) {
    console.log('\n\nFROM OTHER (agents, shippers?):');
    console.log('─'.repeat(80));

    // Group by domain
    const domains: Record<string, number> = {};
    otherEmails.forEach(e => {
      const sender = e?.sender_email || '';
      const domain = sender.split('@')[1] || 'unknown';
      domains[domain] = (domains[domain] || 0) + 1;
    });

    console.log('Top domains:');
    Object.entries(domains)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([domain, count]) => {
        console.log('  ' + domain.padEnd(35) + count);
      });

    console.log('\nSample emails:');
    otherEmails.slice(0, 5).forEach(e => {
      console.log('  Sender:', e?.sender_email);
      console.log('  Subject:', (e?.subject || '').substring(0, 60));
      console.log('');
    });
  }

  // Summary
  console.log('\n═'.repeat(80));
  console.log('WORKFLOW STATE MAPPING SUGGESTION:');
  console.log('─'.repeat(80));
  console.log('Current: bill_of_lading:inbound → hbl_draft_received (WRONG)');
  console.log('');
  console.log('Proposed:');
  console.log('  bill_of_lading:inbound (from carrier) → mbl_draft_received OR bl_released');
  console.log('  bill_of_lading:outbound (from Intoglo) → hbl_shared');
  console.log('  hbl_draft:outbound (from Intoglo) → hbl_draft_shared');
  console.log('═'.repeat(80));
}

main().catch(console.error);
