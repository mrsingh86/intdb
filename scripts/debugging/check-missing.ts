import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function check() {
  // Get processed emails
  const { data: processed } = await supabase
    .from('raw_emails')
    .select('id')
    .eq('processing_status', 'processed');

  console.log('Processed emails:', processed?.length);

  // Get emails with classifications
  const { data: classified } = await supabase
    .from('email_classifications')
    .select('email_id');

  const classifiedIds = new Set(classified?.map(c => c.email_id));
  console.log('Emails with classifications:', classifiedIds.size);

  // Get emails with extractions
  const { data: extracted } = await supabase
    .from('email_extractions')
    .select('email_id');

  const extractedIds = new Set(extracted?.map(e => e.email_id));
  console.log('Emails with extractions:', extractedIds.size);

  // Find processed emails missing classifications
  const processedMissingClass = processed?.filter(e => !classifiedIds.has(e.id)).length || 0;
  console.log('Processed but missing classification:', processedMissingClass);

  // Find processed emails missing extractions
  const processedMissingExt = processed?.filter(e => !extractedIds.has(e.id)).length || 0;
  console.log('Processed but missing extraction:', processedMissingExt);

  // Get emails with business attachments but no document extractions
  const { data: emailsWithBusinessDocs } = await supabase
    .from('raw_emails')
    .select('id, raw_attachments!inner(id, is_business_document, extraction_status, extracted_text)')
    .eq('raw_attachments.is_business_document', true);

  console.log('\nEmails with business attachments:', emailsWithBusinessDocs?.length);

  // Check how many have extracted text
  let withExtractedText = 0;
  let withoutExtractedText = 0;
  emailsWithBusinessDocs?.forEach(e => {
    const atts = e.raw_attachments as any[];
    atts.forEach(a => {
      if (a.extracted_text) withExtractedText++;
      else withoutExtractedText++;
    });
  });
  console.log('  - With extracted text:', withExtractedText);
  console.log('  - Without extracted text:', withoutExtractedText);

  // Check document_extractions
  const { count: docExtCount } = await supabase
    .from('document_extractions')
    .select('*', { count: 'exact', head: true });
  console.log('\ndocument_extractions count:', docExtCount);

  // Check if we need to re-process
  console.log('\n' + '='.repeat(60));
  if (processedMissingClass > 0) {
    console.log('⚠️ ISSUE: ' + processedMissingClass + ' emails processed but missing classification');
  }
  if (processedMissingExt > 0) {
    console.log('⚠️ ISSUE: ' + processedMissingExt + ' emails processed but missing extraction');
  }
  if (withoutExtractedText > 0) {
    console.log('⚠️ ISSUE: ' + withoutExtractedText + ' business docs without extracted text (need PDF extraction)');
  }
  if ((docExtCount || 0) === 0) {
    console.log('⚠️ ISSUE: document_extractions is empty (need to run extraction on PDFs)');
  }

  // Recommendation
  console.log('\n' + '='.repeat(60));
  console.log('RECOMMENDED FIXES:');
  if (withoutExtractedText > 0) {
    console.log('1. Run: curl http://localhost:3000/api/cron/extract-attachments');
    console.log('   (Extract text from ' + withoutExtractedText + ' business PDFs)');
  }
  if (processedMissingClass > 0) {
    console.log('2. Reset ' + processedMissingClass + ' emails to pending and re-process');
  }
}

check().catch(console.error);
