/**
 * Test Extraction on Carrier-Specific Emails
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import {
  createSenderAwareExtractor,
  createSenderCategoryDetector,
} from '../../lib/services/extraction';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function getCarrierEmails() {
  // Get emails from known carrier domains
  const { data, error } = await supabase
    .from('raw_emails')
    .select(`
      id,
      gmail_message_id,
      sender_email,
      true_sender_email,
      subject,
      body_text,
      has_attachments
    `)
    .not('body_text', 'is', null)
    .or(`
      true_sender_email.ilike.%maersk%,
      true_sender_email.ilike.%hapag%,
      true_sender_email.ilike.%cma-cgm%,
      true_sender_email.ilike.%cosco%,
      true_sender_email.ilike.%one-line%,
      true_sender_email.ilike.%expeditors%,
      true_sender_email.ilike.%abordeaux%,
      sender_email.ilike.%maersk%,
      sender_email.ilike.%hapag%,
      sender_email.ilike.%cma-cgm%
    `)
    .order('received_at', { ascending: false })
    .limit(30);

  if (error) {
    console.error('Error fetching carrier emails:', error);
    return [];
  }

  return data || [];
}

async function getAllSenderDomains() {
  // Get unique sender domains to understand the data
  const { data, error } = await supabase
    .from('raw_emails')
    .select('sender_email, true_sender_email')
    .limit(500);

  if (error) return [];

  const domains = new Map<string, number>();
  for (const row of data || []) {
    const email = row.true_sender_email || row.sender_email || '';
    const domain = email.split('@')[1]?.toLowerCase() || 'unknown';
    domains.set(domain, (domains.get(domain) || 0) + 1);
  }

  return Array.from(domains.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  CARRIER EMAIL EXTRACTION TEST');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // First, show what domains we have
  console.log('Top Sender Domains in Database:\n');
  const domains = await getAllSenderDomains();
  for (const [domain, count] of domains) {
    console.log(`  ${domain.padEnd(35)} ${count}`);
  }
  console.log('');

  const detector = createSenderCategoryDetector();
  const extractor = createSenderAwareExtractor(supabase);

  // Test detector on domains
  console.log('Sender Category Detection:\n');
  for (const [domain, count] of domains.slice(0, 15)) {
    const category = detector.detect(`test@${domain}`);
    console.log(`  ${domain.padEnd(35)} → ${category}`);
  }
  console.log('');

  // Fetch carrier emails
  console.log('Fetching carrier-specific emails...\n');
  const emails = await getCarrierEmails();
  console.log(`Found ${emails.length} carrier emails\n`);

  if (emails.length === 0) {
    console.log('No carrier emails found. Testing with available emails...\n');

    // Fallback: get any emails with booking-like subjects
    const { data: fallbackEmails } = await supabase
      .from('raw_emails')
      .select('id, sender_email, true_sender_email, subject, body_text')
      .not('body_text', 'is', null)
      .or('subject.ilike.%booking%,subject.ilike.%BL%,subject.ilike.%container%')
      .limit(10);

    if (fallbackEmails && fallbackEmails.length > 0) {
      console.log(`Found ${fallbackEmails.length} emails with booking/BL/container in subject\n`);

      for (const email of fallbackEmails) {
        const sender = email.true_sender_email || email.sender_email || '';
        const category = detector.detect(sender);

        const result = await extractor.extract({
          emailId: email.id,
          senderEmail: email.sender_email || '',
          trueSenderEmail: email.true_sender_email,
          subject: email.subject || '',
          bodyText: (email.body_text || '').slice(0, 5000), // Limit body size
          sourceType: 'email',
        });

        console.log(`┌─ [${category.toUpperCase()}]`);
        console.log(`│  Subject: ${(email.subject || '').slice(0, 70)}`);
        console.log(`│  Sender: ${sender.slice(0, 50)}`);
        console.log(`│  Extractions: ${result.extractions.length}`);

        // Show high-confidence extractions only
        const goodExtractions = result.extractions.filter(e => e.confidence >= 85);
        if (goodExtractions.length > 0) {
          console.log('│  High-Confidence Entities:');
          for (const ext of goodExtractions.slice(0, 6)) {
            console.log(`│    ✓ ${ext.entityType.padEnd(20)} ${ext.entityValue.slice(0, 35).padEnd(35)} ${ext.confidence}%`);
          }
        }
        console.log('└─\n');
      }
    }
    return;
  }

  // Process carrier emails
  for (const email of emails.slice(0, 15)) {
    const sender = email.true_sender_email || email.sender_email || '';
    const category = detector.detect(sender);

    const result = await extractor.extract({
      emailId: email.id,
      senderEmail: email.sender_email || '',
      trueSenderEmail: email.true_sender_email,
      subject: email.subject || '',
      bodyText: (email.body_text || '').slice(0, 5000),
      sourceType: 'email',
    });

    console.log(`┌─ [${category.toUpperCase()}]`);
    console.log(`│  Subject: ${(email.subject || '').slice(0, 70)}`);
    console.log(`│  Sender: ${sender.slice(0, 50)}`);
    console.log(`│  Processing: ${result.metadata.processingTimeMs}ms`);
    console.log(`│  Total: ${result.extractions.length}, Critical: ${result.metadata.criticalFound}, Linkable: ${result.metadata.linkableFound}`);

    if (result.metadata.requiredMissing.length > 0) {
      console.log(`│  Missing Required: ${result.metadata.requiredMissing.slice(0, 5).join(', ')}`);
    }

    // Show high-confidence extractions
    const goodExtractions = result.extractions.filter(e => e.confidence >= 85);
    if (goodExtractions.length > 0) {
      console.log('│  Entities:');
      for (const ext of goodExtractions.slice(0, 8)) {
        const icon = ext.isCritical ? '★' : ext.isLinkable ? '◆' : '○';
        console.log(`│    ${icon} ${ext.entityType.padEnd(20)} ${ext.entityValue.slice(0, 35).padEnd(35)} ${ext.confidence}%`);
      }
    }
    console.log('└─\n');
  }
}

main().catch(console.error);
