/**
 * Link Emails by Thread
 *
 * For emails that aren't linked but are in a thread where other emails ARE linked,
 * link them to the same shipment.
 *
 * This fixes the gap where entry/duty emails don't have booking numbers but
 * are in threads with booking confirmations that ARE linked.
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
  thread_id: string | null;
  subject: string;
  sender_email: string | null;
}

interface Doc {
  id: string;
  email_id: string;
  shipment_id: string;
  document_type: string;
}

// Classification patterns for new document types
const DOC_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  // Draft Entry
  { pattern: /\bdraft\s+entry/i, type: 'draft_entry' },
  { pattern: /\bentry\s+draft/i, type: 'draft_entry' },
  { pattern: /\bentry\s+for\s+(review|approval)/i, type: 'draft_entry' },
  { pattern: /\bentry\s+approval\s+required/i, type: 'draft_entry' },
  { pattern: /\bentry\s+\d*[A-Z]{2,3}[- ]?\d+.*pre-?alert/i, type: 'draft_entry' },

  // Entry Summary
  { pattern: /\bentry\s+summary/i, type: 'entry_summary' },
  { pattern: /\d+-\d+-\d+-7501\b/, type: 'entry_summary' },
  { pattern: /\b\d{3}-\d{7}-\d-7501\b/, type: 'entry_summary' },

  // Duty Invoice
  { pattern: /\bduty\s+invoice/i, type: 'duty_invoice' },
  { pattern: /\bduty\s+(payment|statement|summary)/i, type: 'duty_invoice' },
  { pattern: /\bduty\s+bill\b/i, type: 'duty_invoice' },
  { pattern: /\brequest\s+for\s+duty/i, type: 'duty_invoice' },

  // Checklist
  { pattern: /\bchecklist\s+(attached|for|ready)/i, type: 'checklist' },
  { pattern: /\bexport\s+checklist/i, type: 'checklist' },
  { pattern: /\bchecklist\s+for\s+approval/i, type: 'checklist' },

  // Shipping Bill / LEO
  { pattern: /\bshipping\s+bill/i, type: 'shipping_bill' },
  { pattern: /\bLEO\s+(copy|attached)/i, type: 'leo_copy' },
];

function classifySubject(subject: string): string | null {
  for (const { pattern, type } of DOC_PATTERNS) {
    if (pattern.test(subject)) {
      return type;
    }
  }
  return null;
}

function getDirection(senderEmail: string | null): 'inbound' | 'outbound' {
  const sender = (senderEmail || '').toLowerCase();
  if (sender.includes('@intoglo.com') || sender.includes('@intoglo.in')) {
    return 'outbound';
  }
  return 'inbound';
}

async function run() {
  console.log('=== LINK EMAILS BY THREAD ===\n');

  // Load data
  console.log('Loading data...');
  const [emails, docs] = await Promise.all([
    getAllRows<Email>(supabase, 'raw_emails', 'id, thread_id, subject, sender_email'),
    getAllRows<Doc>(supabase, 'shipment_documents', 'id, email_id, shipment_id, document_type'),
  ]);

  console.log(`  Emails: ${emails.length}`);
  console.log(`  Documents: ${docs.length}\n`);

  // Build index: email_id -> shipment_id
  const emailToShipment = new Map<string, string>();
  for (const doc of docs) {
    emailToShipment.set(doc.email_id, doc.shipment_id);
  }

  // Build index: thread_id -> shipment_id (from linked emails)
  const threadToShipment = new Map<string, string>();
  for (const email of emails) {
    if (email.thread_id && emailToShipment.has(email.id)) {
      threadToShipment.set(email.thread_id, emailToShipment.get(email.id)!);
    }
  }

  console.log(`Threads with linked emails: ${threadToShipment.size}\n`);

  // Find unlinked emails that are in linked threads
  const toLink: Array<{
    emailId: string;
    shipmentId: string;
    documentType: string;
    subject: string;
    direction: 'inbound' | 'outbound';
  }> = [];

  for (const email of emails) {
    // Skip if already linked
    if (emailToShipment.has(email.id)) continue;

    // Skip if no thread
    if (!email.thread_id) continue;

    // Check if thread has a linked shipment
    const shipmentId = threadToShipment.get(email.thread_id);
    if (!shipmentId) continue;

    // Classify the email
    const documentType = classifySubject(email.subject || '');
    if (!documentType) continue; // Only link if we know the document type

    toLink.push({
      emailId: email.id,
      shipmentId,
      documentType,
      subject: email.subject?.substring(0, 60) || '',
      direction: getDirection(email.sender_email),
    });
  }

  console.log(`Found ${toLink.length} emails to link by thread\n`);

  if (toLink.length === 0) {
    console.log('No emails to link.');
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
    console.log(`  ${item.documentType} (${item.direction}): "${item.subject}..."`);
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
        link_confidence_score: 75, // Thread-based linking confidence
        link_method: 'ai', // Using 'ai' as it's the only valid value in DB constraint
      });

    if (error) {
      // Might be duplicate
      if (error.code === '23505') {
        // Already exists, skip
      } else {
        errors++;
        console.error(`  Error linking ${item.emailId}: ${error.message}`);
      }
    } else {
      created++;
    }
  }

  console.log(`\nCreated: ${created}`);
  console.log(`Errors: ${errors}`);

  // Show final document type counts
  console.log('\n=== FINAL DOCUMENT TYPE DISTRIBUTION ===\n');
  const { data: finalDocs } = await supabase
    .from('shipment_documents')
    .select('document_type');

  const typeCounts: Record<string, number> = {};
  finalDocs?.forEach(d => {
    typeCounts[d.document_type] = (typeCounts[d.document_type] || 0) + 1;
  });

  const newTypes = ['checklist', 'shipping_bill', 'leo_copy', 'draft_entry', 'entry_summary', 'duty_invoice'];
  console.log('New Document Types:');
  for (const t of newTypes) {
    console.log(`  ${t.padEnd(20)} ${(typeCounts[t] || 0).toString().padStart(4)} documents`);
  }
}

run().catch(console.error);
