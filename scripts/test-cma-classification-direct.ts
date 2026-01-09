import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// Import classification orchestrator
import { createClassificationOrchestrator } from '../lib/services/classification';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function test() {
  const emailId = 'cf4f8650-89d2-4a8a-90cb-6c11d27de757';

  // Get email
  const { data: email } = await supabase
    .from('raw_emails')
    .select('*')
    .eq('id', emailId)
    .single();

  if (!email) {
    console.log('Email not found');
    return;
  }

  // Get attachments with extracted text
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('id, filename, extracted_text')
    .eq('email_id', emailId);

  const pdfContent = attachments
    ?.filter(a => a.extracted_text && a.extracted_text.length > 50)
    .map(a => a.extracted_text)
    .join('\n\n') || '';

  console.log('Email subject:', email.subject);
  console.log('PDF content length:', pdfContent.length);
  console.log('PDF snippet:', pdfContent.substring(0, 300));
  console.log('');

  // Run classification
  const orchestrator = createClassificationOrchestrator();
  const result = orchestrator.classify({
    subject: email.subject || '',
    senderEmail: email.sender_email || '',
    senderName: email.sender_name || undefined,
    trueSenderEmail: email.true_sender_email || null,
    bodyText: email.body_text || '',
    attachmentFilenames: attachments?.map(a => a.filename).filter(Boolean) || [],
    pdfContent: pdfContent || undefined,
  });

  console.log('Classification result:');
  console.log('  documentType:', result.documentType);
  console.log('  documentConfidence:', result.documentConfidence);
  console.log('  documentMethod:', result.documentMethod);
  console.log('  documentSource:', result.documentSource);
  console.log('  documentMatchedMarkers:', result.documentMatchedMarkers);
  console.log('');
  console.log('  emailType:', result.emailType);
  console.log('  emailTypeConfidence:', result.emailTypeConfidence);
  console.log('  senderCategory:', result.senderCategory);
}

test().catch(console.error);
