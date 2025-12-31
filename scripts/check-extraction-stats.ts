import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function checkStats() {
  console.log('='.repeat(60));
  console.log('EXTRACTION STATS AUDIT (ACCURATE COUNTS)');
  console.log('='.repeat(60));

  // Use count queries to bypass pagination
  console.log('\n📎 RAW_ATTACHMENTS:');
  const { count: totalAtt } = await supabase.from('raw_attachments').select('*', { count: 'exact', head: true });
  console.log(`   Total: ${totalAtt}`);

  const { count: attWithText } = await supabase.from('raw_attachments').select('*', { count: 'exact', head: true }).not('extracted_text', 'is', null);
  console.log(`   With extracted_text: ${attWithText}`);

  const { count: attCompleted } = await supabase.from('raw_attachments').select('*', { count: 'exact', head: true }).eq('extraction_status', 'completed');
  const { count: attFailed } = await supabase.from('raw_attachments').select('*', { count: 'exact', head: true }).eq('extraction_status', 'failed');
  const { count: attPending } = await supabase.from('raw_attachments').select('*', { count: 'exact', head: true }).eq('extraction_status', 'pending');
  const { count: attNoStatus } = await supabase.from('raw_attachments').select('*', { count: 'exact', head: true }).is('extraction_status', null);
  console.log(`   Status: completed=${attCompleted}, failed=${attFailed}, pending=${attPending}, null=${attNoStatus}`);

  const { count: pdfCount } = await supabase.from('raw_attachments').select('*', { count: 'exact', head: true }).eq('mime_type', 'application/pdf');
  console.log(`   PDF attachments: ${pdfCount}`);

  console.log('\n📧 RAW_EMAILS:');
  const { count: totalEmails } = await supabase.from('raw_emails').select('*', { count: 'exact', head: true });
  console.log(`   Total: ${totalEmails}`);

  const { count: emailsWithAtt } = await supabase.from('raw_emails').select('*', { count: 'exact', head: true }).eq('has_attachments', true);
  console.log(`   With has_attachments=true: ${emailsWithAtt}`);

  console.log('\n📋 DOCUMENT_CLASSIFICATIONS:');
  const { count: totalClass } = await supabase.from('document_classifications').select('*', { count: 'exact', head: true });
  console.log(`   Total: ${totalClass}`);

  console.log('\n📄 SHIPMENT_DOCUMENTS:');
  const { count: totalShipDocs } = await supabase.from('shipment_documents').select('*', { count: 'exact', head: true });
  console.log(`   Total: ${totalShipDocs}`);

  console.log('\n🚢 SHIPMENTS:');
  const { count: totalShipments } = await supabase.from('shipments').select('*', { count: 'exact', head: true });
  console.log(`   Total: ${totalShipments}`);

  // Check for entities table - try different names
  console.log('\n🏷️  ENTITY TABLES CHECK:');

  const tablesToCheck = ['entity_extractions', 'extracted_entities', 'entities', 'email_entities', 'document_entities'];
  for (const tableName of tablesToCheck) {
    const { count, error } = await supabase.from(tableName).select('*', { count: 'exact', head: true });
    if (!error) {
      console.log(`   ✅ ${tableName}: ${count} rows`);
    } else {
      console.log(`   ❌ ${tableName}: ${error.message}`);
    }
  }

  // Check the email_attachments table (different from raw_attachments?)
  console.log('\n📎 EMAIL_ATTACHMENTS (alternative table?):');
  const { count: emailAttCount, error: emailAttError } = await supabase.from('email_attachments').select('*', { count: 'exact', head: true });
  if (!emailAttError) {
    console.log(`   Total: ${emailAttCount}`);
  } else {
    console.log(`   Error: ${emailAttError.message}`);
  }

  // Get sample of PDFs to check extraction
  console.log('\n📝 PDF EXTRACTION SAMPLE:');
  const { data: pdfSample } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename, extraction_status, extracted_text')
    .eq('mime_type', 'application/pdf')
    .limit(5);

  pdfSample?.forEach((pdf, i) => {
    const textLen = pdf.extracted_text ? pdf.extracted_text.length : 0;
    console.log(`   ${i + 1}. ${pdf.filename}`);
    console.log(`      Status: ${pdf.extraction_status || 'NULL'}, Text: ${textLen} chars`);
  });

  // Check linkage between tables
  console.log('\n🔗 LINKAGE CHECK:');

  // How many raw_emails have entries in raw_attachments?
  const { data: attEmailIds } = await supabase.from('raw_attachments').select('email_id');
  const uniqueAttEmailIds = new Set(attEmailIds?.map(a => a.email_id));
  console.log(`   Emails with raw_attachments records: ${uniqueAttEmailIds.size}`);

  // How many classifications link to emails?
  const { data: classEmailIds } = await supabase.from('document_classifications').select('email_id');
  const uniqueClassEmailIds = new Set(classEmailIds?.map(c => c.email_id));
  console.log(`   Emails with classification records: ${uniqueClassEmailIds.size}`);

  console.log('\n' + '='.repeat(60));
}

checkStats().catch(console.error);
