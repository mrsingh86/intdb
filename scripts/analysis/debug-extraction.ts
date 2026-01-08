/**
 * Debug Extraction Issues
 *
 * Investigates why certain values are being extracted despite not appearing in source.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import {
  createSenderAwareExtractor,
} from '../../lib/services/extraction';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function debugExtraction() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  DEBUG: Extraction Source Verification');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const extractor = createSenderAwareExtractor(supabase);

  // Get a few emails from different failing categories
  const testCases = [
    { category: 'hapag', limit: 3 },
    { category: 'trucking', limit: 3 },
    { category: 'arrival_notice', limit: 3 },
  ];

  for (const tc of testCases) {
    console.log(`\n─── Testing ${tc.category} ───\n`);

    let query;
    if (tc.category === 'arrival_notice') {
      query = supabase
        .from('raw_emails')
        .select('id, sender_email, true_sender_email, subject, body_text')
        .not('body_text', 'is', null)
        .ilike('subject', '%arrival notice%')
        .limit(tc.limit);
    } else {
      query = supabase
        .from('raw_emails')
        .select('id, sender_email, true_sender_email, subject, body_text')
        .not('body_text', 'is', null)
        .or(`true_sender_email.ilike.%${tc.category}%,sender_email.ilike.%${tc.category}%,subject.ilike.%${tc.category}%`)
        .limit(tc.limit);
    }

    const { data: emails, error } = await query;
    if (error || !emails?.length) {
      console.log(`  No emails found for ${tc.category}`);
      continue;
    }

    for (const email of emails) {
      const sourceText = `${email.subject}\n${email.body_text}`;

      console.log(`Subject: ${(email.subject || '').slice(0, 60)}...`);

      const result = await extractor.extract({
        emailId: email.id,
        senderEmail: email.sender_email || '',
        trueSenderEmail: email.true_sender_email,
        subject: email.subject || '',
        bodyText: (email.body_text || '').slice(0, 8000),
        sourceType: 'email',
      });

      console.log(`Extractions: ${result.extractions.length}`);

      // Check each extraction against source
      for (const ext of result.extractions.slice(0, 5)) {
        const inSource = sourceText.toLowerCase().includes(ext.entityValue.toLowerCase());
        const normalized = sourceText.toLowerCase().replace(/[\s-]/g, '').includes(
          ext.entityValue.toLowerCase().replace(/[\s-]/g, '')
        );

        const status = inSource ? '✓' : normalized ? '~' : '✗';
        console.log(`  ${status} ${ext.entityType.padEnd(20)} "${ext.entityValue}" ${inSource ? 'IN SOURCE' : normalized ? 'NORMALIZED MATCH' : 'NOT FOUND'}`);

        if (!inSource && !normalized) {
          // Show context around potential matches
          const searchTerm = ext.entityValue.slice(0, 6).toLowerCase();
          const idx = sourceText.toLowerCase().indexOf(searchTerm);
          if (idx >= 0) {
            console.log(`    Partial match at: "${sourceText.slice(Math.max(0, idx - 20), idx + 40)}"`);
          }
        }
      }
      console.log('');
    }
  }
}

debugExtraction().catch(console.error);
