/**
 * Test classification patterns against actual email subjects
 */
import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// New patterns (same as unified-classification-service.ts)
const PATTERNS = [
  // Draft Entry
  { pattern: /\bdraft\s+entry/i, type: 'draft_entry' },
  { pattern: /\bentry\s+draft/i, type: 'draft_entry' },
  { pattern: /\b7501\s+draft/i, type: 'draft_entry' },
  { pattern: /\bcustoms\s+entry\s+(draft|for\s+review)/i, type: 'draft_entry' },
  { pattern: /\bentry\s+for\s+(review|approval)/i, type: 'draft_entry' },
  { pattern: /\bentry\s+approval\s+required/i, type: 'draft_entry' },
  { pattern: /\bentry\s+\d*[A-Z]{2,3}[- ]?\d+.*pre-?alert/i, type: 'draft_entry' },

  // Entry Summary
  { pattern: /\bentry\s+summary/i, type: 'entry_summary' },
  { pattern: /\b7501\s+(filed|submitted|summary)/i, type: 'entry_summary' },
  { pattern: /\bfiled\s+entry/i, type: 'entry_summary' },
  { pattern: /\bcustoms\s+entry\s+(filed|released)/i, type: 'entry_summary' },
  { pattern: /\bentry\s+release/i, type: 'entry_summary' },
  { pattern: /\d+-\d+-\d+-7501\b/, type: 'entry_summary' },
  { pattern: /\b\d{3}-\d{7}-\d-7501\b/, type: 'entry_summary' },

  // Duty Invoice
  { pattern: /\bduty\s+invoice/i, type: 'duty_invoice' },
  { pattern: /\bduty\s+(payment|statement|summary)/i, type: 'duty_invoice' },
  { pattern: /\bduty\s+bill\b/i, type: 'duty_invoice' },
  { pattern: /\brequest\s+for\s+duty/i, type: 'duty_invoice' },
  { pattern: /\bcustoms\s+duty/i, type: 'duty_invoice' },
  { pattern: /\bimport\s+duty/i, type: 'duty_invoice' },
];

function classifySubject(subject: string): string | null {
  for (const { pattern, type } of PATTERNS) {
    if (pattern.test(subject)) {
      return type;
    }
  }
  return null;
}

interface Email {
  id: string;
  subject: string;
  sender_email: string | null;
}

interface Doc {
  email_id: string;
}

async function run() {
  console.log('=== TEST NEW CLASSIFICATION PATTERNS ===\n');

  const [emails, docs] = await Promise.all([
    getAllRows<Email>(supabase, 'raw_emails', 'id, subject, sender_email'),
    getAllRows<Doc>(supabase, 'shipment_documents', 'email_id'),
  ]);

  const linkedIds = new Set(docs.map(d => d.email_id));

  // Test patterns
  const counts: Record<string, { linked: number; unlinked: number }> = {
    'draft_entry': { linked: 0, unlinked: 0 },
    'entry_summary': { linked: 0, unlinked: 0 },
    'duty_invoice': { linked: 0, unlinked: 0 },
  };

  const examples: Record<string, string[]> = {
    'draft_entry': [],
    'entry_summary': [],
    'duty_invoice': [],
  };

  for (const email of emails) {
    const type = classifySubject(email.subject || '');
    if (type && counts[type]) {
      if (linkedIds.has(email.id)) {
        counts[type].linked++;
      } else {
        counts[type].unlinked++;
        if (examples[type].length < 5) {
          examples[type].push(email.subject?.substring(0, 70) || '');
        }
      }
    }
  }

  console.log('Pattern Match Results:\n');
  console.log('Document Type        Linked   Unlinked   Total');
  console.log('─'.repeat(55));
  for (const [type, c] of Object.entries(counts)) {
    const total = c.linked + c.unlinked;
    console.log(`${type.padEnd(20)} ${c.linked.toString().padStart(6)}   ${c.unlinked.toString().padStart(8)}   ${total.toString().padStart(5)}`);
  }

  console.log('\n=== SAMPLE UNLINKED MATCHES ===\n');
  for (const [type, exs] of Object.entries(examples)) {
    if (exs.length > 0) {
      console.log(`${type}:`);
      exs.forEach(e => console.log(`  - "${e}..."`));
      console.log('');
    }
  }
}

run().catch(console.error);
