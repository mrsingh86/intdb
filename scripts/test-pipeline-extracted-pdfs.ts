/**
 * Test pipeline with emails that already have extracted PDF text
 */

import { createClient } from '@supabase/supabase-js';
import { EmailIngestionService } from '../lib/services/email-ingestion-service';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function test() {
  console.log('Testing pipeline with emails that HAVE extracted PDF text');
  console.log('═'.repeat(70));

  const ingestionService = new EmailIngestionService(supabase, process.env.ANTHROPIC_API_KEY!);

  // Find emails with PDFs that have extracted_text
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('email_id, filename, extracted_text')
    .not('extracted_text', 'is', null)
    .ilike('filename', '%.pdf')
    .limit(5);

  if (!attachments || attachments.length === 0) {
    console.log('No attachments with extracted text found');
    return;
  }

  console.log(`Found ${attachments.length} emails with extracted PDF text`);
  console.log('');

  for (const att of attachments) {
    // Get email details
    const { data: email } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email')
      .eq('id', att.email_id)
      .single();

    if (!email) continue;

    console.log('─'.repeat(70));
    console.log(`Email: ${(email.subject || '').substring(0, 50)}...`);
    console.log(`PDF: ${att.filename}`);
    console.log(`Extracted text length: ${att.extracted_text.length} chars`);
    console.log(`Text preview: ${att.extracted_text.substring(0, 100).replace(/\n/g, ' ')}...`);
    console.log('');

    // Run pipeline
    console.log('Running pipeline...');
    const result = await ingestionService.ingestEmail(email.id, { forceReprocess: true });

    console.log(`  Classification: ${result.classification?.document_type || 'none'}`);
    console.log(`  Confidence: ${result.classification?.confidence_score || 0}%`);
    console.log(`  Reason: ${result.classification?.classification_reason || 'N/A'}`);
    console.log(`  Entities: ${result.fieldsExtracted}`);
    console.log(`  Shipment: ${result.shipmentId || 'none'} (${result.shipmentAction})`);
    console.log('');
  }

  console.log('═'.repeat(70));
  console.log('DONE');
}

test().catch(console.error);
