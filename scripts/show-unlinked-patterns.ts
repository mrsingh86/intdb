/**
 * Show patterns in unlinked emails for new document types
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
}

async function run() {
  const [emails, docs] = await Promise.all([
    getAllRows<Email>(supabase, 'raw_emails', 'id, subject, sender_email'),
    getAllRows<Doc>(supabase, 'shipment_documents', 'email_id'),
  ]);

  const linkedIds = new Set(docs.map(d => d.email_id));

  console.log('=== ENTRY-RELATED EMAIL SUBJECTS (sample) ===\n');
  const entryEmails = emails.filter(e =>
    (e.subject?.toLowerCase().includes('entry') || e.subject?.includes('7501')) &&
    !linkedIds.has(e.id)
  );
  console.log(`Found ${entryEmails.length} unlinked entry emails\n`);
  entryEmails.slice(0, 20).forEach(e => {
    console.log(`  "${e.subject?.substring(0, 80)}"`);
    console.log(`    From: ${e.sender_email}\n`);
  });

  console.log('\n=== DUTY-RELATED EMAIL SUBJECTS (sample) ===\n');
  const dutyEmails = emails.filter(e =>
    e.subject?.toLowerCase().includes('duty') &&
    !linkedIds.has(e.id)
  );
  console.log(`Found ${dutyEmails.length} unlinked duty emails\n`);
  dutyEmails.slice(0, 20).forEach(e => {
    console.log(`  "${e.subject?.substring(0, 80)}"`);
    console.log(`    From: ${e.sender_email}\n`);
  });

  console.log('\n=== CHECKLIST UNLINKED (sample) ===\n');
  const checklistUnlinked = emails.filter(e =>
    e.subject?.toLowerCase().includes('checklist') &&
    !linkedIds.has(e.id)
  );
  console.log(`Found ${checklistUnlinked.length} unlinked checklist emails\n`);
  checklistUnlinked.slice(0, 10).forEach(e => {
    console.log(`  "${e.subject?.substring(0, 80)}"`);
    console.log(`    From: ${e.sender_email}\n`);
  });
}

run().catch(console.error);
