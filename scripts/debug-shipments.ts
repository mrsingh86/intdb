import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function debug() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║           SHIPMENT CREATION DEBUG                                  ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  // Check 1: Any booking_confirmation document types?
  console.log('=== CHECK 1: BOOKING_CONFIRMATION DOCUMENT TYPES ===');
  const { data: bcDocs, count: bcCount } = await supabase
    .from('attachment_classifications')
    .select('*', { count: 'exact' })
    .eq('document_type', 'booking_confirmation');
  console.log('attachment_classifications with document_type=booking_confirmation: ' + (bcCount || 0));
  if (bcDocs && bcDocs.length > 0) {
    bcDocs.slice(0, 3).forEach(d => {
      console.log('  Confidence: ' + (d.confidence || 0) + '%, Method: ' + d.classification_method);
    });
  }

  // Check 2: Any booking_confirmation email types?
  console.log('\n=== CHECK 2: BOOKING_CONFIRMATION EMAIL TYPES ===');
  const { data: bcEmails, count: beCount } = await supabase
    .from('email_classifications')
    .select('*', { count: 'exact' })
    .eq('email_type', 'booking_confirmation');
  console.log('email_classifications with email_type=booking_confirmation: ' + (beCount || 0));
  if (bcEmails && bcEmails.length > 0) {
    bcEmails.slice(0, 3).forEach(e => {
      console.log('  Confidence: ' + (e.confidence || 0) + '%, Category: ' + e.email_category);
    });
  }

  // Check 3: What are the actual document types?
  console.log('\n=== CHECK 3: ALL DOCUMENT TYPES IN attachment_classifications ===');
  const { data: allDocs } = await supabase
    .from('attachment_classifications')
    .select('document_type, confidence');
  const typeCounts: Record<string, { count: number; avgConf: number }> = {};
  allDocs?.forEach(d => {
    const key = d.document_type || 'null';
    if (typeCounts[key] === undefined) {
      typeCounts[key] = { count: 0, avgConf: 0 };
    }
    typeCounts[key].count++;
    typeCounts[key].avgConf += (d.confidence || 0);
  });
  Object.entries(typeCounts).forEach(([k, v]) => {
    const avg = (v.avgConf / v.count).toFixed(0);
    console.log('  ' + k + ': ' + v.count + ' (avg conf: ' + avg + '%)');
  });

  // Check 4: Sample email subjects that might be booking confirmations
  console.log('\n=== CHECK 4: EMAILS CONTAINING BOOKING KEYWORDS ===');
  const { data: subjects } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email')
    .or('subject.ilike.%booking confirmation%,subject.ilike.%booking number%,subject.ilike.%BCN%,subject.ilike.%BKCNF%')
    .limit(10);

  console.log('Emails with booking keywords in subject: ' + (subjects?.length || 0));
  subjects?.forEach(s => {
    console.log('  Subject: ' + (s.subject?.substring(0, 70) || '') + '...');
    console.log('  From: ' + (s.sender_email || '').substring(0, 50));
    console.log('');
  });

  // Check 5: What senders could send booking confirmations?
  console.log('=== CHECK 5: SHIPPING LINE SENDERS ===');
  const { data: senders } = await supabase
    .from('raw_emails')
    .select('sender_email')
    .or('sender_email.ilike.%maersk%,sender_email.ilike.%hapag%,sender_email.ilike.%cma%,sender_email.ilike.%msc%,sender_email.ilike.%cosco%,sender_email.ilike.%evergreen%,sender_email.ilike.%one-line%')
    .limit(20);

  console.log('Emails from shipping lines: ' + (senders?.length || 0));
  const uniqSenders = [...new Set(senders?.map(s => s.sender_email))];
  uniqSenders.forEach(s => console.log('  ' + s));

  // Check 6: Emails that were classified but not processed
  console.log('\n=== CHECK 6: EMAILS MARKED FOR MANUAL REVIEW ===');
  const { data: manualReview, count: mrCount } = await supabase
    .from('raw_emails')
    .select('id, subject, processing_status', { count: 'exact' })
    .eq('processing_status', 'manual_review')
    .limit(5);
  console.log('Emails in manual_review: ' + (mrCount || 0));
  manualReview?.forEach(e => {
    console.log('  ' + (e.subject?.substring(0, 60) || '') + '...');
  });

  // Check 7: Unique sender domains
  console.log('\n=== CHECK 7: TOP SENDER DOMAINS ===');
  const { data: allSenders } = await supabase
    .from('raw_emails')
    .select('sender_email');
  const domains: Record<string, number> = {};
  allSenders?.forEach(s => {
    const email = s.sender_email || '';
    const match = email.match(/@([a-zA-Z0-9.-]+)/);
    if (match) {
      const domain = match[1];
      domains[domain] = (domains[domain] || 0) + 1;
    }
  });
  Object.entries(domains)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([domain, count]) => {
      console.log('  ' + domain + ': ' + count);
    });

  // CONCLUSION
  console.log('\n╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                     ROOT CAUSE ANALYSIS                            ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');

  if ((bcCount || 0) === 0 && (beCount || 0) === 0) {
    console.log('ISSUE: No booking_confirmation documents/emails found in the dataset.');
    console.log('');
    console.log('REASON: Shipments are only created from booking_confirmation type emails');
    console.log('which typically come from shipping lines (Maersk, Hapag, etc.).');
    console.log('');
    console.log('Current dataset appears to be mostly:');
    console.log('- Internal Intoglo operational emails (delivery, pickup scheduling)');
    console.log('- Invoices and payment receipts');
    console.log('- General correspondence');
    console.log('');
    console.log('TO CREATE SHIPMENTS, need emails from shipping lines like:');
    console.log('- maersk.com - Booking Confirmation BCN###');
    console.log('- hapag-lloyd.com - Booking Confirmation');
    console.log('- cma-cgm.com - Booking Number###');
  }
}

debug().catch(console.error);
