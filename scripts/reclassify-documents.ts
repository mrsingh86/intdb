/**
 * Re-classify Documents with New Patterns
 *
 * Scans existing emails and updates document_type in shipment_documents
 * for documents matching new classification patterns (checklist, entry, etc.)
 */

import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// New classification patterns
const NEW_PATTERNS: Array<{ pattern: RegExp; type: string; priority: number }> = [
  // India Export - CHA Documents
  { pattern: /\bchecklist\s+(attached|for|ready)/i, type: 'checklist', priority: 1 },
  { pattern: /\bexport\s+checklist/i, type: 'checklist', priority: 1 },
  { pattern: /\bCHA\s+checklist/i, type: 'checklist', priority: 1 },
  { pattern: /\bshipment\s+checklist/i, type: 'checklist', priority: 2 },
  { pattern: /\bdocument\s+checklist/i, type: 'checklist', priority: 3 },

  { pattern: /\bshipping\s+bill\s+(copy|number|attached)/i, type: 'shipping_bill', priority: 1 },
  { pattern: /\bSB\s+(copy|no\.?|number)/i, type: 'shipping_bill', priority: 2 },
  { pattern: /\bLEO\s+(copy|attached|received)/i, type: 'leo_copy', priority: 1 },
  { pattern: /\blet\s+export\s+order/i, type: 'leo_copy', priority: 1 },
  { pattern: /\bexport\s+clearance/i, type: 'shipping_bill', priority: 3 },

  // US Import - Customs Broker Documents
  { pattern: /\bdraft\s+entry/i, type: 'draft_entry', priority: 1 },
  { pattern: /\bentry\s+draft/i, type: 'draft_entry', priority: 1 },
  { pattern: /\b7501\s+draft/i, type: 'draft_entry', priority: 1 },
  { pattern: /\bcustoms\s+entry\s+(draft|for\s+review)/i, type: 'draft_entry', priority: 2 },
  { pattern: /\bentry\s+for\s+(review|approval)/i, type: 'draft_entry', priority: 2 },

  { pattern: /\bentry\s+summary/i, type: 'entry_summary', priority: 1 },
  { pattern: /\b7501\s+(filed|submitted|summary)/i, type: 'entry_summary', priority: 1 },
  { pattern: /\bfiled\s+entry/i, type: 'entry_summary', priority: 2 },
  { pattern: /\bcustoms\s+entry\s+(filed|released)/i, type: 'entry_summary', priority: 2 },

  { pattern: /\bduty\s+invoice/i, type: 'duty_invoice', priority: 1 },
  { pattern: /\bduty\s+(payment|statement|summary)/i, type: 'duty_invoice', priority: 2 },
  { pattern: /\bcustoms\s+duty/i, type: 'duty_invoice', priority: 3 },
  { pattern: /\bimport\s+duty/i, type: 'duty_invoice', priority: 3 },
];

interface Email {
  id: string;
  subject: string;
}

interface ShipmentDoc {
  id: string;
  shipment_id: string;
  email_id: string;
  document_type: string;
}

function classifySubject(subject: string): { type: string; priority: number } | null {
  for (const { pattern, type, priority } of NEW_PATTERNS) {
    if (pattern.test(subject)) {
      return { type, priority };
    }
  }
  return null;
}

async function reclassifyDocuments() {
  console.log('=== RE-CLASSIFY DOCUMENTS WITH NEW PATTERNS ===\n');

  // Load data
  console.log('Loading data...');
  const [emails, docs] = await Promise.all([
    getAllRows<Email>(supabase, 'raw_emails', 'id, subject'),
    getAllRows<ShipmentDoc>(supabase, 'shipment_documents', 'id, shipment_id, email_id, document_type'),
  ]);

  console.log(`  Emails: ${emails.length}`);
  console.log(`  Documents: ${docs.length}\n`);

  const emailMap = new Map(emails.map(e => [e.id, e]));

  // Find documents to reclassify
  const toUpdate: Array<{ docId: string; emailId: string; oldType: string; newType: string; subject: string }> = [];

  for (const doc of docs) {
    const email = emailMap.get(doc.email_id);
    if (!email) continue;

    const classification = classifySubject(email.subject);
    if (classification && classification.type !== doc.document_type) {
      // Only update if new type is different and more specific
      const generalTypes = ['general_correspondence', 'customs_document', 'unknown'];
      if (generalTypes.includes(doc.document_type) || classification.priority === 1) {
        toUpdate.push({
          docId: doc.id,
          emailId: doc.email_id,
          oldType: doc.document_type,
          newType: classification.type,
          subject: email.subject.substring(0, 60),
        });
      }
    }
  }

  console.log(`Found ${toUpdate.length} documents to reclassify\n`);

  if (toUpdate.length === 0) {
    console.log('No documents need reclassification.');
    return;
  }

  // Group by new type for summary
  const byNewType: Record<string, number> = {};
  toUpdate.forEach(u => {
    byNewType[u.newType] = (byNewType[u.newType] || 0) + 1;
  });

  console.log('Reclassification summary:');
  Object.entries(byNewType)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`  ${type}: ${count}`);
    });
  console.log('');

  // Show sample updates
  console.log('Sample updates (first 10):');
  toUpdate.slice(0, 10).forEach(u => {
    console.log(`  ${u.oldType} → ${u.newType}: "${u.subject}..."`);
  });
  console.log('');

  // Apply updates
  console.log('Applying updates...');
  let updated = 0;
  let errors = 0;

  for (const u of toUpdate) {
    const { error } = await supabase
      .from('shipment_documents')
      .update({ document_type: u.newType })
      .eq('id', u.docId);

    if (error) {
      errors++;
      console.error(`  Error updating ${u.docId}: ${error.message}`);
    } else {
      updated++;
    }
  }

  console.log(`\nUpdated: ${updated}`);
  console.log(`Errors: ${errors}`);

  // Show final distribution
  console.log('\n=== FINAL DOCUMENT TYPE DISTRIBUTION ===\n');
  const { data: finalDocs } = await supabase
    .from('shipment_documents')
    .select('document_type');

  const typeCounts: Record<string, number> = {};
  finalDocs?.forEach(d => {
    typeCounts[d.document_type] = (typeCounts[d.document_type] || 0) + 1;
  });

  Object.entries(typeCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(`  ${count.toString().padStart(4)} ${type}`);
    });
}

reclassifyDocuments().catch(console.error);
