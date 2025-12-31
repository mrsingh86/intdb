import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function check() {
  // Get all document types
  const { data: docs } = await supabase
    .from('document_classifications')
    .select('document_type, document_subtype');

  if (!docs || docs.length === 0) {
    console.log('No document classifications found');
    return;
  }

  const counts: Record<string, number> = {};
  docs.forEach(d => {
    const key = (d.document_type || '(none)') + (d.document_subtype ? ' / ' + d.document_subtype : '');
    counts[key] = (counts[key] || 0) + 1;
  });

  console.log(`\nDocument Types (${docs.length} total):`);
  Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, v]) => {
      console.log(`  ${v}x ${k}`);
    });

  // Check what emails have booking_confirmation or arrival_notice type
  const { data: bookingEmails } = await supabase
    .from('document_classifications')
    .select('email_id, document_type, document_subtype')
    .in('document_type', ['booking_confirmation', 'arrival_notice']);

  console.log(`\nEmails with booking_confirmation or arrival_notice: ${bookingEmails?.length || 0}`);

  // Get sample email subjects
  if (bookingEmails && bookingEmails.length > 0) {
    const emailIds = bookingEmails.slice(0, 5).map(e => e.email_id);
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, subject')
      .in('id', emailIds);

    console.log('\nSample emails:');
    emails?.forEach(e => {
      console.log(`  - ${e.subject?.substring(0, 70)}`);
    });
  }
}

check().catch(console.error);
