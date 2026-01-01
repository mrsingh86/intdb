import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Get all PDFs
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('id, filename, mime_type, extracted_text')
    .or('filename.ilike.%.pdf,mime_type.ilike.%pdf%');

  console.log(`Total PDFs: ${attachments?.length || 0}`);

  const noText = (attachments || []).filter(a => !a.extracted_text || a.extracted_text.length < 100);
  const withText = (attachments || []).filter(a => a.extracted_text && a.extracted_text.length >= 100);

  console.log(`With text: ${withText.length}`);
  console.log(`Without text: ${noText.length}`);

  console.log('\nPDFs without text:');
  for (const pdf of noText) {
    const textLen = pdf.extracted_text?.length || 0;
    const textType = pdf.extracted_text === null ? 'NULL' : (textLen === 0 ? 'EMPTY' : `${textLen} chars`);
    console.log(`  ${pdf.filename}: ${textType}`);
  }
}

main().catch(console.error);
