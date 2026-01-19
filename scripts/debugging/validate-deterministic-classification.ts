#!/usr/bin/env npx tsx
/**
 * Validate deterministic classification patterns against actual emails
 */

import { createClient } from '@supabase/supabase-js';
import { classifyEmail, DocumentType, ALL_CARRIER_CONFIGS } from '../lib/config/shipping-line-patterns';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface ClassificationStats {
  total: number;
  byType: Record<DocumentType | 'unclassified', number>;
  samples: { subject: string; type: DocumentType | 'unclassified'; pattern: string }[];
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║      VALIDATE DETERMINISTIC CLASSIFICATION PATTERNS                            ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  // Get all emails with attachments info
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email');

  // Get attachments
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('email_id, filename');

  // Group attachments by email
  const attByEmail = new Map<string, string[]>();
  for (const a of attachments || []) {
    const list = attByEmail.get(a.email_id) || [];
    list.push(a.filename);
    attByEmail.set(a.email_id, list);
  }

  const stats: Record<string, ClassificationStats> = {};

  for (const config of ALL_CARRIER_CONFIGS) {
    stats[config.carrierId] = {
      total: 0,
      byType: {
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
      },
      samples: [],
    };
  }

  for (const e of emails || []) {
    const sender = (e.true_sender_email || e.sender_email || '').toLowerCase();
    const attachmentNames = attByEmail.get(e.id) || [];

    const result = classifyEmail(e.subject || '', sender, attachmentNames);

    if (result) {
      stats[result.carrierId].total++;
      stats[result.carrierId].byType[result.documentType]++;

      // Keep samples for each type (max 3)
      const existingSamples = stats[result.carrierId].samples.filter(s => s.type === result.documentType);
      if (existingSamples.length < 3) {
        stats[result.carrierId].samples.push({
          subject: (e.subject || '').substring(0, 70),
          type: result.documentType,
          pattern: result.matchedPattern,
        });
      }
    }
  }

  // Display results
  for (const [carrierId, data] of Object.entries(stats)) {
    if (data.total === 0) continue;

    const config = ALL_CARRIER_CONFIGS.find(c => c.carrierId === carrierId);
    console.log('\n' + '═'.repeat(80));
    console.log('📧 ' + (config?.carrierName || carrierId).toUpperCase() + ' (' + data.total + ' emails)');
    console.log('═'.repeat(80));

    // Show breakdown by type
    console.log('\nCLASSIFICATION BREAKDOWN:');
    console.log('─'.repeat(60));

    const types: (DocumentType | 'unclassified')[] = [
      'booking_confirmation',
      'booking_amendment',
      'booking_cancellation',
      'arrival_notice',
      'shipment_notice',
      'bill_of_lading',
      'shipping_instruction',
      'invoice',
      'vgm_confirmation',
      'vgm_reminder',
      'pickup_notification',
      'cutoff_advisory',
      'general_correspondence',
    ];

    for (const type of types) {
      const count = data.byType[type];
      if (count === 0) continue;

      const pct = Math.round((count / data.total) * 100);
      const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
      const typeLabel = type.replace(/_/g, ' ').padEnd(22);
      console.log(typeLabel + ' ' + bar + ' ' + String(count).padStart(3) + ' (' + pct + '%)');
    }

    // Show samples for important types
    console.log('\nSAMPLES:');
    console.log('─'.repeat(60));

    const importantTypes: DocumentType[] = ['booking_confirmation', 'arrival_notice', 'bill_of_lading', 'invoice'];
    for (const type of importantTypes) {
      const samples = data.samples.filter(s => s.type === type);
      if (samples.length === 0) continue;

      console.log('\n[' + type.replace(/_/g, ' ').toUpperCase() + ']');
      for (const s of samples.slice(0, 2)) {
        console.log('  • ' + s.subject);
        console.log('    Pattern: ' + s.pattern);
      }
    }
  }

  // Summary table
  console.log('\n\n' + '═'.repeat(80));
  console.log('📋 SUMMARY TABLE');
  console.log('═'.repeat(80));

  console.log('\nCarrier'.padEnd(16) + '│ Total │ BC   │ Amend│ Arriv│ BL   │ SI   │ Inv  │ Corr │');
  console.log('─'.repeat(80));

  for (const [carrierId, data] of Object.entries(stats)) {
    if (data.total === 0) continue;

    const config = ALL_CARRIER_CONFIGS.find(c => c.carrierId === carrierId);
    const name = (config?.carrierName || carrierId).substring(0, 15).padEnd(15);

    const bc = String(data.byType.booking_confirmation).padStart(4);
    const amend = String(data.byType.booking_amendment).padStart(4);
    const arriv = String(data.byType.arrival_notice + data.byType.shipment_notice).padStart(4);
    const bl = String(data.byType.bill_of_lading).padStart(4);
    const si = String(data.byType.shipping_instruction).padStart(4);
    const inv = String(data.byType.invoice).padStart(4);
    const corr = String(data.byType.general_correspondence).padStart(4);

    console.log(name + ' │' + String(data.total).padStart(5) + ' │' + bc + ' │' + amend + '│' + arriv + '│' + bl + ' │' + si + ' │' + inv + ' │' + corr + ' │');
  }

  // Coverage assessment
  console.log('\n\n' + '═'.repeat(80));
  console.log('📊 CLASSIFICATION COVERAGE ASSESSMENT');
  console.log('═'.repeat(80));

  let totalEmails = 0;
  let classifiedEmails = 0;
  let bcEmails = 0;
  let arrivalEmails = 0;
  let blEmails = 0;

  for (const data of Object.values(stats)) {
    totalEmails += data.total;
    classifiedEmails += data.total - data.byType.general_correspondence;
    bcEmails += data.byType.booking_confirmation;
    arrivalEmails += data.byType.arrival_notice + data.byType.shipment_notice;
    blEmails += data.byType.bill_of_lading;
  }

  const classifiedPct = totalEmails > 0 ? Math.round((classifiedEmails / totalEmails) * 100) : 0;

  console.log('\nTotal shipping line emails: ' + totalEmails);
  console.log('Successfully classified:    ' + classifiedEmails + ' (' + classifiedPct + '%)');
  console.log('General correspondence:     ' + (totalEmails - classifiedEmails) + ' (RE:/Re: threads, operational)');
  console.log('\nKey document types:');
  console.log('  • Booking Confirmations: ' + bcEmails);
  console.log('  • Arrival Notices:       ' + arrivalEmails);
  console.log('  • Bills of Lading:       ' + blEmails);
}

main().catch(console.error);
