/**
 * Diagnose gaps between documents and workflow states
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
  email_direction: string | null;
}

interface Doc {
  id: string;
  shipment_id: string;
  email_id: string;
  document_type: string;
}

async function run() {
  console.log('=== DIAGNOSE DOCUMENT vs STATE GAPS ===\n');

  const [emails, docs] = await Promise.all([
    getAllRows<Email>(supabase, 'raw_emails', 'id, subject, sender_email, email_direction'),
    getAllRows<Doc>(supabase, 'shipment_documents', 'id, shipment_id, email_id, document_type'),
  ]);

  console.log(`Loaded: ${emails.length} emails, ${docs.length} linked documents\n`);

  const docEmailIds = new Set(docs.map(d => d.email_id));

  // Check for emails that might be checklists but aren't linked
  console.log('=== EMAILS WITH "CHECKLIST" IN SUBJECT ===\n');
  const checklistEmails = emails.filter(e =>
    e.subject?.toLowerCase().includes('checklist')
  );
  console.log(`Found ${checklistEmails.length} emails with "checklist" in subject\n`);

  let linkedChecklist = 0;
  let unlinkedChecklist = 0;
  for (const e of checklistEmails.slice(0, 10)) {
    const isLinked = docEmailIds.has(e.id);
    const doc = docs.find(d => d.email_id === e.id);
    console.log(`  ${isLinked ? '✓ LINKED' : '✗ NOT LINKED'} | ${doc?.document_type || 'N/A'} | "${e.subject?.substring(0, 60)}..."`);
    if (isLinked) linkedChecklist++;
    else unlinkedChecklist++;
  }
  console.log(`\n  Linked: ${linkedChecklist}, Not Linked: ${unlinkedChecklist}\n`);

  // Check for shipping bill / LEO
  console.log('=== EMAILS WITH "SHIPPING BILL" OR "LEO" IN SUBJECT ===\n');
  const sbEmails = emails.filter(e =>
    e.subject?.toLowerCase().includes('shipping bill') ||
    e.subject?.toLowerCase().includes('leo')
  );
  console.log(`Found ${sbEmails.length} emails\n`);

  for (const e of sbEmails.slice(0, 10)) {
    const isLinked = docEmailIds.has(e.id);
    const doc = docs.find(d => d.email_id === e.id);
    console.log(`  ${isLinked ? '✓ LINKED' : '✗ NOT LINKED'} | ${doc?.document_type || 'N/A'} | "${e.subject?.substring(0, 60)}..."`);
  }

  // Check for entry / customs
  console.log('\n=== EMAILS WITH "ENTRY" OR "7501" IN SUBJECT ===\n');
  const entryEmails = emails.filter(e =>
    e.subject?.toLowerCase().includes('entry') ||
    e.subject?.includes('7501')
  );
  console.log(`Found ${entryEmails.length} emails\n`);

  for (const e of entryEmails.slice(0, 10)) {
    const isLinked = docEmailIds.has(e.id);
    const doc = docs.find(d => d.email_id === e.id);
    console.log(`  ${isLinked ? '✓ LINKED' : '✗ NOT LINKED'} | ${doc?.document_type || 'N/A'} | "${e.subject?.substring(0, 60)}..."`);
  }

  // Check for duty invoice
  console.log('\n=== EMAILS WITH "DUTY" IN SUBJECT ===\n');
  const dutyEmails = emails.filter(e =>
    e.subject?.toLowerCase().includes('duty')
  );
  console.log(`Found ${dutyEmails.length} emails\n`);

  for (const e of dutyEmails.slice(0, 10)) {
    const isLinked = docEmailIds.has(e.id);
    const doc = docs.find(d => d.email_id === e.id);
    console.log(`  ${isLinked ? '✓ LINKED' : '✗ NOT LINKED'} | ${doc?.document_type || 'N/A'} | "${e.subject?.substring(0, 60)}..."`);
  }

  // Summary of document types
  console.log('\n=== LINKED DOCUMENT TYPE SUMMARY ===\n');
  const typeCounts: Record<string, number> = {};
  for (const d of docs) {
    typeCounts[d.document_type] = (typeCounts[d.document_type] || 0) + 1;
  }

  const newTypes = ['checklist', 'shipping_bill', 'leo_copy', 'draft_entry', 'entry_summary', 'duty_invoice'];
  console.log('New Document Types:');
  for (const t of newTypes) {
    console.log(`  ${t.padEnd(20)} ${(typeCounts[t] || 0).toString().padStart(4)} documents`);
  }
}

run().catch(console.error);
