/**
 * Link Emails by Reference Numbers in Subject
 *
 * For entry/duty emails that reference HBL numbers, booking numbers,
 * or internal reference codes, try to match them to shipments.
 */
import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface Email {
  id: string;
  subject: string;
  sender_email: string | null;
}

interface Doc {
  email_id: string;
  shipment_id: string;
}

interface Shipment {
  id: string;
  booking_number: string | null;
  bl_number: string | null;
}

// Classification patterns
const DOC_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  // Draft Entry
  { pattern: /\bentry\s+\d*[A-Z]{2,3}[- ]?\d+.*pre-?alert/i, type: 'draft_entry' },
  { pattern: /\bentry\s+approval\s+required/i, type: 'draft_entry' },
  { pattern: /\bentry\s+for\s+(review|approval)/i, type: 'draft_entry' },

  // Duty Invoice
  { pattern: /\bduty\s+bill\b/i, type: 'duty_invoice' },
  { pattern: /\brequest\s+for\s+duty/i, type: 'duty_invoice' },
  { pattern: /\bduty\s+summary\s+approval/i, type: 'duty_invoice' },
];

// Extract reference patterns from subject
const REF_PATTERNS = [
  // HBL patterns: LUDSE0313, SWLLUD000344
  { pattern: /\bHBL[:\s]+([A-Z]{2,6}\d{4,10})/i, extract: 1 },
  { pattern: /\b([A-Z]{3,6}\d{6,10})\b/, extract: 0 }, // Generic HBL-like

  // Maersk booking: 8-9 digit numbers
  { pattern: /\b(\d{8,9})\b/, extract: 0 },

  // SSE reference codes
  { pattern: /\b(SSE\d{10})/i, extract: 0 },
  { pattern: /\b(SE\d{10})/i, extract: 0 },

  // Container numbers
  { pattern: /\b([A-Z]{4}\d{7})\b/, extract: 0 },
];

function classifySubject(subject: string): string | null {
  for (const { pattern, type } of DOC_PATTERNS) {
    if (pattern.test(subject)) {
      return type;
    }
  }
  return null;
}

function extractReferences(subject: string): string[] {
  const refs: string[] = [];
  for (const { pattern } of REF_PATTERNS) {
    const matches = subject.match(pattern);
    if (matches) {
      refs.push(matches[1] || matches[0]);
    }
  }
  // Also try to find booking numbers directly
  const bookingMatch = subject.match(/\b(\d{8,9})\b/g);
  if (bookingMatch) {
    refs.push(...bookingMatch);
  }
  return [...new Set(refs)]; // Unique
}

function getDirection(senderEmail: string | null): 'inbound' | 'outbound' {
  const sender = (senderEmail || '').toLowerCase();
  if (sender.includes('@intoglo.com') || sender.includes('@intoglo.in')) {
    return 'outbound';
  }
  return 'inbound';
}

async function run() {
  console.log('=== LINK EMAILS BY REFERENCE ===\n');

  // Load data
  console.log('Loading data...');
  const [emails, docs, shipments] = await Promise.all([
    getAllRows<Email>(supabase, 'raw_emails', 'id, subject, sender_email'),
    getAllRows<Doc>(supabase, 'shipment_documents', 'email_id, shipment_id'),
    getAllRows<Shipment>(supabase, 'shipments', 'id, booking_number, bl_number'),
  ]);

  console.log(`  Emails: ${emails.length}`);
  console.log(`  Documents: ${docs.length}`);
  console.log(`  Shipments: ${shipments.length}\n`);

  // Build indexes
  const linkedEmailIds = new Set(docs.map(d => d.email_id));

  // Booking number -> shipment
  const bookingToShipment = new Map<string, string>();
  const blToShipment = new Map<string, string>();
  for (const s of shipments) {
    if (s.booking_number) {
      bookingToShipment.set(s.booking_number.toLowerCase(), s.id);
    }
    if (s.bl_number) {
      blToShipment.set(s.bl_number.toLowerCase(), s.id);
    }
  }

  // Find matchable emails
  const toLink: Array<{
    emailId: string;
    shipmentId: string;
    documentType: string;
    subject: string;
    matchedRef: string;
    direction: 'inbound' | 'outbound';
  }> = [];

  let checkedCount = 0;
  let classifiedCount = 0;

  for (const email of emails) {
    // Skip if already linked
    if (linkedEmailIds.has(email.id)) continue;

    // Classify the email
    const documentType = classifySubject(email.subject || '');
    if (!documentType) continue;

    classifiedCount++;

    // Extract references
    const refs = extractReferences(email.subject || '');
    if (refs.length === 0) continue;

    checkedCount++;

    // Try to match
    let shipmentId: string | null = null;
    let matchedRef = '';

    for (const ref of refs) {
      const refLower = ref.toLowerCase();

      // Try booking number match
      if (bookingToShipment.has(refLower)) {
        shipmentId = bookingToShipment.get(refLower)!;
        matchedRef = ref;
        break;
      }

      // Try BL number match
      if (blToShipment.has(refLower)) {
        shipmentId = blToShipment.get(refLower)!;
        matchedRef = ref;
        break;
      }
    }

    if (shipmentId) {
      toLink.push({
        emailId: email.id,
        shipmentId,
        documentType,
        subject: email.subject?.substring(0, 60) || '',
        matchedRef,
        direction: getDirection(email.sender_email),
      });
    }
  }

  console.log(`Classified as entry/duty: ${classifiedCount}`);
  console.log(`With extractable refs: ${checkedCount}`);
  console.log(`Matched to shipments: ${toLink.length}\n`);

  if (toLink.length === 0) {
    console.log('No emails could be matched to shipments.');

    // Show sample of unlinked classified emails
    console.log('\nSample unlinked entry/duty emails:');
    let count = 0;
    for (const email of emails) {
      if (linkedEmailIds.has(email.id)) continue;
      const documentType = classifySubject(email.subject || '');
      if (!documentType) continue;
      console.log(`  ${documentType}: "${email.subject?.substring(0, 70)}..."`);
      console.log(`    Refs found: ${extractReferences(email.subject || '').join(', ') || 'none'}`);
      if (++count >= 10) break;
    }
    return;
  }

  // Group by document type
  const byType: Record<string, number> = {};
  for (const item of toLink) {
    byType[item.documentType] = (byType[item.documentType] || 0) + 1;
  }

  console.log('By document type:');
  Object.entries(byType).forEach(([type, count]) => {
    console.log(`  ${type}: ${count}`);
  });
  console.log('');

  // Show samples
  console.log('Sample links (first 10):');
  toLink.slice(0, 10).forEach(item => {
    console.log(`  ${item.documentType}: matched ref "${item.matchedRef}"`);
    console.log(`    Subject: "${item.subject}..."`);
  });
  console.log('');

  // Create shipment_documents records
  console.log('Creating document links...');
  let created = 0;
  let errors = 0;

  for (const item of toLink) {
    const { error } = await supabase
      .from('shipment_documents')
      .insert({
        shipment_id: item.shipmentId,
        email_id: item.emailId,
        document_type: item.documentType,
        link_confidence_score: 70, // Reference-based linking
        link_method: 'ai',
      });

    if (error) {
      if (error.code !== '23505') { // Not duplicate
        errors++;
        console.error(`  Error: ${error.message}`);
      }
    } else {
      created++;
    }
  }

  console.log(`\nCreated: ${created}`);
  console.log(`Errors: ${errors}`);
}

run().catch(console.error);
