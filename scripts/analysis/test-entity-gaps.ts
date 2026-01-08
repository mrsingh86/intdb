/**
 * Test Entity Extraction Gaps
 *
 * Tests cutoffs, weights, amounts on emails that contain these patterns.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import { createSenderAwareExtractor } from '../../lib/services/extraction';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function testEntityType(
  extractor: ReturnType<typeof createSenderAwareExtractor>,
  pattern: string,
  entityTypes: string[]
) {
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, sender_email, true_sender_email, subject, body_text')
    .not('body_text', 'is', null)
    .ilike('body_text', `%${pattern}%`)
    .limit(3);

  if (!emails?.length) {
    console.log(`  No emails with "${pattern}" found`);
    return;
  }

  let extracted = 0;
  let total = emails.length;

  for (const email of emails) {
    const result = await extractor.extract({
      emailId: email.id,
      senderEmail: email.sender_email || '',
      trueSenderEmail: email.true_sender_email,
      subject: email.subject || '',
      bodyText: (email.body_text || '').slice(0, 10000),
      sourceType: 'email',
    });

    const found = result.extractions.filter(e =>
      entityTypes.some(t => e.entityType.includes(t))
    );

    if (found.length > 0) {
      extracted++;
      console.log(`  ✓ ${email.subject?.slice(0, 40)}...`);
      found.forEach(f => console.log(`    → ${f.entityType}: ${f.entityValue}`));
    } else {
      console.log(`  ✗ ${email.subject?.slice(0, 40)}... (not extracted)`);
      // Show what's in the source
      const regex = new RegExp(pattern + '.{0,50}', 'gi');
      const matches = email.body_text?.match(regex);
      if (matches) {
        console.log(`    Source contains: ${matches[0].slice(0, 60)}`);
      }
    }
  }

  console.log(`  Result: ${extracted}/${total} emails extracted\n`);
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ENTITY GAP TESTING');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const extractor = createSenderAwareExtractor(supabase);

  // Test cutoffs
  console.log('─── CUTOFF DATES ───');
  await testEntityType(extractor, 'cutoff', ['cutoff']);

  // Test weights
  console.log('─── WEIGHTS ───');
  await testEntityType(extractor, 'kg', ['weight']);

  // Test amounts
  console.log('─── AMOUNTS (USD) ───');
  await testEntityType(extractor, 'USD', ['amount', 'freight']);

  // Test demurrage
  console.log('─── DEMURRAGE ───');
  await testEntityType(extractor, 'demurrage', ['demurrage', 'free']);

  // Test seal numbers
  console.log('─── SEAL NUMBERS ───');
  await testEntityType(extractor, 'seal', ['seal']);

  console.log('═══════════════════════════════════════════════════════════════');
}

main().catch(console.error);
