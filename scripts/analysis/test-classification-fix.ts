/**
 * Test Classification Fix
 *
 * Verifies that thread replies are now classified by body content
 * instead of inherited subject.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { ClassificationOrchestrator } from '../../lib/services/classification';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Test cases that were previously misclassified
const TEST_CASES = [
  {
    docType: 'sob_confirmation',
    description: 'Invoice in SOB thread',
    subjectContains: 'SOB CONFIRMATION',
  },
  {
    docType: 'booking_amendment',
    description: 'TPDoc emails',
    subjectContains: 'TPDoc',
  },
  {
    docType: 'payment_receipt',
    description: 'Misclassified emails',
    subjectContains: 'Statement',
  },
];

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  TESTING CLASSIFICATION FIX');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const orchestrator = new ClassificationOrchestrator();

  for (const testCase of TEST_CASES) {
    console.log(`\n--- Testing: ${testCase.description} (${testCase.docType}) ---\n`);

    // Fetch samples that were previously misclassified
    const { data: samples } = await supabase
      .from('document_classifications')
      .select(`
        email_id,
        document_type,
        raw_emails!inner (
          subject,
          body_text,
          sender_email
        )
      `)
      .eq('document_type', testCase.docType)
      .ilike('raw_emails.subject', `%${testCase.subjectContains}%`)
      .limit(3);

    if (!samples || samples.length === 0) {
      console.log(`  No samples found`);
      continue;
    }

    for (const s of samples) {
      const email = (s as any).raw_emails;
      const subject = email?.subject || '';
      const bodyText = email?.body_text || '';
      const senderEmail = email?.sender_email || '';

      console.log(`Subject: ${subject.substring(0, 70)}...`);
      console.log(`Old classification: ${s.document_type}`);

      // Reclassify with new logic
      const result = orchestrator.classify({
        subject,
        bodyText,
        senderEmail,
      });

      console.log(`New classification: ${result.documentType} (${result.documentConfidence}%)`);
      console.log(`Method: ${result.documentMethod}, Source: ${result.documentSource}`);
      console.log(`Is Reply: ${result.threadContext.isReply}`);
      console.log(`Fresh body preview: ${result.threadContext.freshBody.substring(0, 100)}...`);
      console.log('');
    }
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  TEST COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
