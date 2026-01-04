/**
 * Fix Arrival Notice Direction
 *
 * Updates document_direction for arrival_notice emails where
 * true_sender_email is from a shipping line (should be inbound, not outbound)
 */
import { createClient } from '@supabase/supabase-js';
import { detectDirection, isCarrierSender } from '../lib/utils/direction-detector';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function fixArrivalNoticeDirection() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('              FIX ARRIVAL NOTICE DIRECTION');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Get all arrival_notice classifications
  const { data: classifications, error: classError } = await supabase
    .from('document_classifications')
    .select('id, email_id, document_direction')
    .eq('document_type', 'arrival_notice');

  if (classError) {
    console.error('Error fetching classifications:', classError);
    return;
  }

  console.log(`Found ${classifications?.length || 0} arrival_notice classifications\n`);

  if (!classifications || classifications.length === 0) return;

  // Get email details for these
  const emailIds = classifications.map(c => c.email_id);
  const { data: emails, error: emailError } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email')
    .in('id', emailIds);

  if (emailError) {
    console.error('Error fetching emails:', emailError);
    return;
  }

  const emailMap = new Map(emails?.map(e => [e.id, e]) || []);

  // Check and fix direction
  let fixed = 0;
  let alreadyCorrect = 0;
  const changes: Array<{ subject: string; oldDir: string; newDir: string; reason: string }> = [];

  for (const c of classifications) {
    const email = emailMap.get(c.email_id);
    if (!email) continue;

    // Use true_sender_email if available, otherwise sender_email
    const effectiveSender = email.true_sender_email || email.sender_email;
    const newDirection = detectDirection(effectiveSender, email.subject);
    const oldDirection = c.document_direction;

    if (oldDirection !== newDirection) {
      // Update direction
      const { error } = await supabase
        .from('document_classifications')
        .update({
          document_direction: newDirection,
          classification_reason: `Direction fixed: ${effectiveSender} → ${newDirection}`,
        })
        .eq('id', c.id);

      if (!error) {
        fixed++;
        let reason = 'unknown';
        if (isCarrierSender(effectiveSender)) {
          reason = `carrier domain: ${effectiveSender}`;
        } else if (effectiveSender?.includes(' via ')) {
          reason = 'forwarded via group';
        }
        changes.push({
          subject: (email.subject || '').substring(0, 60),
          oldDir: oldDirection || 'null',
          newDir: newDirection,
          reason,
        });
      }
    } else {
      alreadyCorrect++;
    }
  }

  console.log('Results:');
  console.log('─'.repeat(60));
  console.log(`  Direction Fixed: ${fixed}`);
  console.log(`  Already Correct: ${alreadyCorrect}`);
  console.log('');

  if (changes.length > 0) {
    console.log('Changes made:');
    console.log('─'.repeat(60));

    // Group by direction change
    const outToIn = changes.filter(c => c.oldDir === 'outbound' && c.newDir === 'inbound');
    const inToOut = changes.filter(c => c.oldDir === 'inbound' && c.newDir === 'outbound');

    console.log(`\noutbound → inbound: ${outToIn.length}`);
    outToIn.slice(0, 10).forEach(c => {
      console.log(`  "${c.subject}..."`);
      console.log(`    Reason: ${c.reason}`);
    });

    if (inToOut.length > 0) {
      console.log(`\ninbound → outbound: ${inToOut.length}`);
      inToOut.slice(0, 5).forEach(c => {
        console.log(`  "${c.subject}..."`);
      });
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
}

fixArrivalNoticeDirection().catch(console.error);
