/**
 * Test the updated pipeline with PDF extraction before classification
 */

import { createClient } from '@supabase/supabase-js';
import { EmailIngestionService } from '../lib/services/email-ingestion-service';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function test() {
  console.log('═'.repeat(70));
  console.log('TESTING PIPELINE WITH ATTACHMENT EXTRACTION');
  console.log('═'.repeat(70));
  console.log('');

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    console.error('Missing ANTHROPIC_API_KEY');
    process.exit(1);
  }

  const ingestionService = new EmailIngestionService(supabase, anthropicKey);

  // Get 5 emails that have attachments but haven't been fully processed
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, has_attachments')
    .eq('has_attachments', true)
    .order('received_at', { ascending: false })
    .limit(5);

  if (!emails || emails.length === 0) {
    console.log('No emails with attachments found');
    return;
  }

  console.log(`Found ${emails.length} emails with attachments to test`);
  console.log('');

  for (const email of emails) {
    console.log('─'.repeat(70));
    console.log(`Email: ${email.subject?.substring(0, 50)}...`);
    console.log(`Sender: ${email.sender_email}`);
    console.log(`ID: ${email.id}`);
    console.log('');

    // Check current state of attachments
    const { data: attachmentsBefore } = await supabase
      .from('raw_attachments')
      .select('id, filename, extracted_text')
      .eq('email_id', email.id);

    const pdfsBefore = attachmentsBefore?.filter(a =>
      a.filename?.toLowerCase().endsWith('.pdf')
    ) || [];
    const extractedBefore = pdfsBefore.filter(a => a.extracted_text).length;

    console.log(`  PDFs: ${pdfsBefore.length}`);
    console.log(`  Already extracted: ${extractedBefore}`);

    // Run the pipeline with force reprocess
    console.log('  Running pipeline...');
    const startTime = Date.now();

    try {
      const result = await ingestionService.ingestEmail(email.id, {
        forceReprocess: true
      });

      const elapsed = Date.now() - startTime;

      console.log(`  ✅ Pipeline completed in ${elapsed}ms`);
      console.log(`  Classification: ${result.classification?.document_type || 'none'}`);
      console.log(`  Confidence: ${result.classification?.confidence_score || 0}%`);
      console.log(`  Entities extracted: ${result.fieldsExtracted}`);
      console.log(`  Shipment: ${result.shipmentId || 'none'} (${result.shipmentAction})`);

      // Check attachments after
      const { data: attachmentsAfter } = await supabase
        .from('raw_attachments')
        .select('id, filename, extracted_text, extraction_method')
        .eq('email_id', email.id);

      const pdfsAfter = attachmentsAfter?.filter(a =>
        a.filename?.toLowerCase().endsWith('.pdf')
      ) || [];
      const extractedAfter = pdfsAfter.filter(a => a.extracted_text).length;

      console.log(`  PDFs extracted: ${extractedBefore} → ${extractedAfter}`);

      // Show sample of extracted text
      for (const pdf of pdfsAfter) {
        if (pdf.extracted_text) {
          console.log(`  📄 ${pdf.filename}:`);
          console.log(`     Method: ${pdf.extraction_method}`);
          console.log(`     Text: ${pdf.extracted_text.substring(0, 150).replace(/\n/g, ' ')}...`);
        }
      }

    } catch (error: any) {
      console.log(`  ❌ Error: ${error.message}`);
    }

    console.log('');
  }

  console.log('═'.repeat(70));
  console.log('TEST COMPLETE');
  console.log('═'.repeat(70));
}

test().catch(console.error);
