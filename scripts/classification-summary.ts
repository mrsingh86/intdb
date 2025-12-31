#!/usr/bin/env npx tsx
/**
 * Final Classification Summary
 */

import { createClient } from '@supabase/supabase-js';
import { classifyEmail, ALL_CARRIER_CONFIGS, DocumentType } from '../lib/config/shipping-line-patterns';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║      DETERMINISTIC CLASSIFICATION SUMMARY                                      ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  // Get all emails with attachments info (paginated to get > 1000)
  let emails: any[] = [];
  let page = 0;
  const pageSize = 1000;
  while (true) {
    const { data } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email, true_sender_email')
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (!data || data.length === 0) break;
    emails = [...emails, ...data];
    if (data.length < pageSize) break;
    page++;
  }

  let attachments: any[] = [];
  page = 0;
  while (true) {
    const { data } = await supabase
      .from('raw_attachments')
      .select('email_id, filename')
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (!data || data.length === 0) break;
    attachments = [...attachments, ...data];
    if (data.length < pageSize) break;
    page++;
  }

  const attByEmail = new Map<string, string[]>();
  for (const a of attachments || []) {
    const list = attByEmail.get(a.email_id) || [];
    list.push(a.filename);
    attByEmail.set(a.email_id, list);
  }

  // Classify all emails
  const results: Record<string, Record<DocumentType | 'unclassified' | 're_threads', number>> = {};

  for (const config of ALL_CARRIER_CONFIGS) {
    results[config.carrierId] = {
      booking_confirmation: 0,
      booking_amendment: 0,
      booking_cancellation: 0,
      arrival_notice: 0,
      shipment_notice: 0,
      bill_of_lading: 0,
      shipping_instruction: 0,
      invoice: 0,
      vgm_confirmation: 0,
      vgm_reminder: 0,
      vessel_schedule: 0,
      pickup_notification: 0,
      cutoff_advisory: 0,
      general_correspondence: 0,
      unclassified: 0,
      re_threads: 0,
    };
  }

  for (const e of emails || []) {
    const sender = (e.true_sender_email || e.sender_email || '').toLowerCase();
    const subject = e.subject || '';
    const attachmentNames = attByEmail.get(e.id) || [];

    const result = classifyEmail(subject, sender, attachmentNames);

    if (result) {
      const isReThread = /^(RE|Re|FW|Fw|FWD|Fwd):/i.test(subject);
      if (isReThread) {
        results[result.carrierId].re_threads++;
      } else {
        results[result.carrierId][result.documentType]++;
      }
    }
  }

  // Display summary table
  console.log('═'.repeat(95));
  console.log('CARRIER'.padEnd(15) + '│ BC  │ Amd │ Can │ Arr │ Ship│ BL  │ SI  │ Inv │ VGM │ Pick│ Cut │ RE  │ Corr│');
  console.log('─'.repeat(95));

  for (const [carrierId, stats] of Object.entries(results)) {
    const config = ALL_CARRIER_CONFIGS.find(c => c.carrierId === carrierId);
    const name = (config?.carrierName || carrierId).substring(0, 14).padEnd(14);

    const total = Object.values(stats).reduce((a, b) => a + b, 0);
    if (total === 0) continue;

    console.log(
      name + ' │' +
      String(stats.booking_confirmation).padStart(4) + '│' +
      String(stats.booking_amendment).padStart(4) + '│' +
      String(stats.booking_cancellation).padStart(4) + '│' +
      String(stats.arrival_notice).padStart(4) + '│' +
      String(stats.shipment_notice).padStart(4) + '│' +
      String(stats.bill_of_lading).padStart(4) + '│' +
      String(stats.shipping_instruction).padStart(4) + '│' +
      String(stats.invoice).padStart(4) + '│' +
      String(stats.vgm_confirmation + stats.vgm_reminder).padStart(4) + '│' +
      String(stats.pickup_notification).padStart(4) + '│' +
      String(stats.cutoff_advisory).padStart(4) + '│' +
      String(stats.re_threads).padStart(4) + '│' +
      String(stats.general_correspondence).padStart(4) + '│'
    );
  }

  console.log('═'.repeat(95));

  // Calculate totals
  let totalEmails = 0;
  let classifiedCore = 0; // BC, Amendment, Cancel, Arrival, BL, SI, Invoice
  let classifiedOther = 0; // VGM, Pickup, Cutoff, Shipment
  let reThreads = 0;
  let correspondence = 0;

  for (const stats of Object.values(results)) {
    totalEmails += Object.values(stats).reduce((a, b) => a + b, 0);
    classifiedCore += stats.booking_confirmation + stats.booking_amendment + stats.booking_cancellation +
                     stats.arrival_notice + stats.bill_of_lading + stats.shipping_instruction + stats.invoice;
    classifiedOther += stats.vgm_confirmation + stats.vgm_reminder + stats.pickup_notification +
                       stats.cutoff_advisory + stats.shipment_notice;
    reThreads += stats.re_threads;
    correspondence += stats.general_correspondence;
  }

  console.log('\n');
  console.log('TOTALS:');
  console.log('  Total shipping line emails: ' + totalEmails);
  console.log('  Core documents classified:  ' + classifiedCore + ' (' + Math.round(classifiedCore/totalEmails*100) + '%)');
  console.log('    - Booking Confirmations:  ' + Object.values(results).reduce((a, s) => a + s.booking_confirmation, 0));
  console.log('    - Amendments/Cancels:     ' + Object.values(results).reduce((a, s) => a + s.booking_amendment + s.booking_cancellation, 0));
  console.log('    - Arrival Notices:        ' + Object.values(results).reduce((a, s) => a + s.arrival_notice, 0));
  console.log('    - Bills of Lading:        ' + Object.values(results).reduce((a, s) => a + s.bill_of_lading, 0));
  console.log('    - Shipping Instructions:  ' + Object.values(results).reduce((a, s) => a + s.shipping_instruction, 0));
  console.log('    - Invoices:               ' + Object.values(results).reduce((a, s) => a + s.invoice, 0));
  console.log('  Other notifications:        ' + classifiedOther + ' (' + Math.round(classifiedOther/totalEmails*100) + '%)');
  console.log('  RE:/FW: threads:            ' + reThreads + ' (' + Math.round(reThreads/totalEmails*100) + '%)');
  console.log('  Unclassified/Other:         ' + correspondence + ' (' + Math.round(correspondence/totalEmails*100) + '%)');

  console.log('\n');
  console.log('CLASSIFICATION COVERAGE:');
  const totalClassified = classifiedCore + classifiedOther;
  const bar = (n: number, total: number) => {
    const pct = Math.round(n/total*100);
    return '█'.repeat(Math.floor(pct/5)) + '░'.repeat(20-Math.floor(pct/5)) + ' ' + pct + '%';
  };
  console.log('  Documents:     ' + bar(totalClassified, totalEmails));
  console.log('  + RE/FW:       ' + bar(totalClassified + reThreads, totalEmails));
}

main().catch(console.error);
