#!/usr/bin/env npx tsx
/**
 * Investigate why invoice and amendment counts are low
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║      INVOICE & AMENDMENT INVESTIGATION                                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  // INVOICES
  console.log('═'.repeat(80));
  console.log('INVOICES');
  console.log('═'.repeat(80));

  // Search for invoice-related subjects
  const invoiceKeywords = ['invoice', 'inv ', 'inv#', 'inv:', 'billing', 'payment'];

  console.log('\nEmails with "invoice" in subject (all carriers):');
  const { data: invoiceEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email')
    .or('subject.ilike.%invoice%,subject.ilike.%inv %,subject.ilike.%billing%')
    .limit(500);

  console.log(`Found: ${invoiceEmails?.length} emails\n`);

  // Group by classification
  const invoiceByClassification: Record<string, number> = {};
  for (const email of invoiceEmails || []) {
    const { data: cls } = await supabase
      .from('document_classifications')
      .select('document_type')
      .eq('email_id', email.id)
      .single();

    const docType = cls?.document_type || 'NOT_CLASSIFIED';
    invoiceByClassification[docType] = (invoiceByClassification[docType] || 0) + 1;
  }

  console.log('Classification of "invoice" emails:');
  for (const [type, count] of Object.entries(invoiceByClassification).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  // Show sample invoice subjects NOT classified as invoice
  console.log('\nSample invoice-related subjects NOT classified as "invoice":');
  let shown = 0;
  for (const email of invoiceEmails || []) {
    const { data: cls } = await supabase
      .from('document_classifications')
      .select('document_type')
      .eq('email_id', email.id)
      .single();

    if (cls?.document_type !== 'invoice' && shown < 15) {
      const isReFw = /^(RE|Re|FW|Fw):/i.test(email.subject || '');
      console.log(`  [${cls?.document_type || 'N/A'}] ${isReFw ? '[RE/FW] ' : ''}${email.subject?.substring(0, 60)}`);
      shown++;
    }
  }

  // AMENDMENTS
  console.log('\n\n' + '═'.repeat(80));
  console.log('AMENDMENTS');
  console.log('═'.repeat(80));

  // Search for amendment-related subjects
  console.log('\nEmails with amendment-related keywords in subject:');
  const { data: amendEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email')
    .or('subject.ilike.%amendment%,subject.ilike.%update%,subject.ilike.%change%,subject.ilike.%revised%,subject.ilike.%revision%')
    .limit(500);

  console.log(`Found: ${amendEmails?.length} emails\n`);

  // Group by classification
  const amendByClassification: Record<string, number> = {};
  for (const email of amendEmails || []) {
    const { data: cls } = await supabase
      .from('document_classifications')
      .select('document_type')
      .eq('email_id', email.id)
      .single();

    const docType = cls?.document_type || 'NOT_CLASSIFIED';
    amendByClassification[docType] = (amendByClassification[docType] || 0) + 1;
  }

  console.log('Classification of amendment-related emails:');
  for (const [type, count] of Object.entries(amendByClassification).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }

  // Show Maersk-specific amendment patterns
  console.log('\nMaersk amendment patterns:');
  const { data: maerskAmend } = await supabase
    .from('raw_emails')
    .select('subject')
    .or('sender_email.ilike.%maersk%,true_sender_email.ilike.%maersk%')
    .or('subject.ilike.%amendment%,subject.ilike.%update%')
    .limit(30);

  const patterns = new Set<string>();
  for (const e of maerskAmend || []) {
    if (e.subject && !/^(RE|Re|FW|Fw):/i.test(e.subject)) {
      // Normalize to find pattern
      const norm = e.subject
        .replace(/\d{7,}/g, 'NNNNNN')
        .replace(/\[.*?\]/g, '[...]')
        .substring(0, 50);
      patterns.add(norm);
    }
  }
  for (const p of Array.from(patterns).slice(0, 15)) {
    console.log(`  ${p}`);
  }

  // Show Hapag amendment patterns
  console.log('\nHapag amendment patterns:');
  const { data: hapagAmend } = await supabase
    .from('raw_emails')
    .select('subject')
    .or('sender_email.ilike.%hapag%,sender_email.ilike.%hlag%,true_sender_email.ilike.%hapag%,true_sender_email.ilike.%hlag%')
    .limit(100);

  const hapagPatterns = new Map<string, number>();
  for (const e of hapagAmend || []) {
    if (e.subject && !/^(RE|Re|FW|Fw):/i.test(e.subject)) {
      const norm = e.subject
        .replace(/\d{7,}/g, 'NNNNNN')
        .replace(/HL-\d+/g, 'HL-XXX')
        .replace(/HLCU[A-Z0-9]+/g, 'HLCUXXX')
        .substring(0, 55);
      hapagPatterns.set(norm, (hapagPatterns.get(norm) || 0) + 1);
    }
  }
  const sortedHapag = Array.from(hapagPatterns.entries()).sort((a, b) => b[1] - a[1]);
  for (const [p, count] of sortedHapag.slice(0, 15)) {
    console.log(`  [${count}x] ${p}`);
  }
}

main().catch(console.error);
