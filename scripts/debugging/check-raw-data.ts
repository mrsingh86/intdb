import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  // 1. PDF attachments that are NOT signatures
  const { count: pdfNotSig } = await supabase
    .from('raw_attachments')
    .select('*', { count: 'exact', head: true })
    .ilike('mime_type', '%pdf%')
    .or('is_signature_image.is.null,is_signature_image.eq.false');

  console.log('PDF attachments (not signatures):', pdfNotSig);

  // Total PDFs
  const { count: totalPdf } = await supabase
    .from('raw_attachments')
    .select('*', { count: 'exact', head: true })
    .ilike('mime_type', '%pdf%');

  console.log('Total PDF attachments:', totalPdf);

  // 2. Get actual email count (not limited by default 1000)
  const { count: actualEmailCount } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true });

  console.log('\nTotal emails (actual count):', actualEmailCount);

  // 3. Unique threads - paginate to get all
  let allThreads: string[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data } = await supabase
      .from('raw_emails')
      .select('thread_id')
      .range(offset, offset + pageSize - 1);

    if (!data || data.length === 0) break;
    allThreads = allThreads.concat(data.map(t => t.thread_id));
    offset += pageSize;
    if (data.length < pageSize) break;
  }

  const uniqueThreads = new Set(allThreads);
  console.log('Unique threads:', uniqueThreads.size);
  console.log('Avg emails per thread:', (allThreads.length / uniqueThreads.size).toFixed(1));

  // 3. Earliest email
  const { data: earliest } = await supabase
    .from('raw_emails')
    .select('received_at, subject')
    .order('received_at', { ascending: true })
    .limit(1);

  if (earliest && earliest[0]) {
    console.log('\nEarliest email:', earliest[0].received_at);
    console.log('  Subject:', (earliest[0].subject || '').substring(0, 70));
  }

  // 4. Latest email
  const { data: latest } = await supabase
    .from('raw_emails')
    .select('received_at, subject')
    .order('received_at', { ascending: false })
    .limit(1);

  if (latest && latest[0]) {
    console.log('\nLatest email:', latest[0].received_at);
    console.log('  Subject:', (latest[0].subject || '').substring(0, 70));
  }

  // Date range
  if (earliest?.[0] && latest?.[0]) {
    const days = Math.round(
      (new Date(latest[0].received_at).getTime() - new Date(earliest[0].received_at).getTime()) /
      (1000 * 60 * 60 * 24)
    );
    console.log('\nDate range:', days, 'days');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
