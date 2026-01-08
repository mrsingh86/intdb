import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  const { data: allShipments } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state, workflow_phase, created_from_email_id, created_at');

  const { data: allDocs } = await supabase
    .from('shipment_documents')
    .select('shipment_id');

  const shipmentWithDocs = new Set((allDocs || []).map(d => d.shipment_id));
  const noDocShipments = (allShipments || []).filter(s => !shipmentWithDocs.has(s.id));

  console.log('SHIPMENTS WITH NO LINKED DOCUMENTS:', noDocShipments.length);
  console.log('='.repeat(70));

  // Group by workflow_state
  const byState: Record<string, number> = {};
  for (const s of noDocShipments) {
    const key = s.workflow_state + ' / ' + s.workflow_phase;
    byState[key] = (byState[key] || 0) + 1;
  }

  console.log('\nBy workflow state:');
  for (const [state, count] of Object.entries(byState).sort((a, b) => b[1] - a[1])) {
    console.log('  ' + state + ': ' + count);
  }

  // Check if they have created_from_email_id
  const withEmail = noDocShipments.filter(s => s.created_from_email_id);
  const withoutEmail = noDocShipments.filter(s => !s.created_from_email_id);

  console.log('\nHas created_from_email_id:', withEmail.length);
  console.log('No created_from_email_id:', withoutEmail.length);

  // For those with email, check if email exists
  if (withEmail.length > 0) {
    console.log('\nChecking if source emails exist...');
    const emailIds = withEmail.map(s => s.created_from_email_id);
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, subject')
      .in('id', emailIds);

    const foundEmails = new Set((emails || []).map(e => e.id));
    const missingEmails = withEmail.filter(s => !foundEmails.has(s.created_from_email_id));

    console.log('Source emails found:', foundEmails.size);
    console.log('Source emails missing:', missingEmails.length);

    // Show examples where email exists but no doc link
    console.log('\nExamples (email exists, no doc link):');
    for (const s of withEmail.filter(sh => foundEmails.has(sh.created_from_email_id)).slice(0, 5)) {
      const email = emails?.find(e => e.id === s.created_from_email_id);
      console.log('  ' + s.booking_number);
      console.log('    Email: ' + (email?.subject || '').substring(0, 50));
    }
  }

  // Show examples without email
  console.log('\nExamples (no source email):');
  for (const s of withoutEmail.slice(0, 10)) {
    console.log('  ' + s.booking_number + ' | ' + s.workflow_state + ' | created: ' + s.created_at?.split('T')[0]);
  }
}

main().catch(console.error);
