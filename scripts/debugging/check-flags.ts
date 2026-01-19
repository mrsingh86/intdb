import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function checkFlags() {
  const { data } = await supabase
    .from('raw_emails')
    .select('is_response, clean_subject, email_direction, true_sender_email, has_attachments, attachment_count, thread_position, responds_to_email_id, response_time_hours, revision_type, content_hash, business_attachment_count');

  const total = data?.length || 0;
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║                    EMAIL FLAGS STATUS                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝');
  console.log('Total emails:', total);
  console.log('');

  const flags = [
    { name: 'is_response', desc: 'Reply/Forward detection' },
    { name: 'clean_subject', desc: 'Subject without RE:/FW:' },
    { name: 'email_direction', desc: 'Inbound/Outbound' },
    { name: 'true_sender_email', desc: 'Original sender (forwarded)' },
    { name: 'has_attachments', desc: 'Has attachments flag' },
    { name: 'attachment_count', desc: 'Number of attachments' },
    { name: 'thread_position', desc: 'Position in thread (1,2,3...)' },
    { name: 'responds_to_email_id', desc: 'Links to previous email' },
    { name: 'response_time_hours', desc: 'Time to respond' },
    { name: 'revision_type', desc: 'Update/Amendment/Original' },
    { name: 'content_hash', desc: 'For duplicate detection' },
    { name: 'business_attachment_count', desc: 'Count of business docs' },
  ];

  console.log('FLAG                      SET/TOTAL   %     DESCRIPTION');
  console.log('─'.repeat(70));

  for (const flag of flags) {
    const set = data?.filter(e => (e as any)[flag.name] !== null && (e as any)[flag.name] !== undefined).length || 0;
    const pct = total > 0 ? Math.round(set / total * 100) : 0;
    const status = set === total ? '✅' : set === 0 ? '❌' : '⚠️';
    console.log(
      status + ' ' +
      flag.name.padEnd(22) + ' ' +
      (set + '/' + total).padEnd(10) + ' ' +
      (pct + '%').padEnd(5) + ' ' +
      flag.desc
    );
  }

  // Show is_response breakdown
  console.log('');
  console.log('═══ RESPONSE DETECTION (is_response) ═══');
  const responses = data?.filter(e => e.is_response === true).length || 0;
  const originals = data?.filter(e => e.is_response === false).length || 0;
  console.log('  Original emails (is_response=false): ' + originals);
  console.log('  Reply/Forward (is_response=true):    ' + responses);

  // Show direction breakdown
  console.log('');
  console.log('═══ DIRECTION BREAKDOWN (email_direction) ═══');
  const inbound = data?.filter(e => e.email_direction === 'inbound').length || 0;
  const outbound = data?.filter(e => e.email_direction === 'outbound').length || 0;
  console.log('  Inbound (from external):  ' + inbound);
  console.log('  Outbound (from Intoglo):  ' + outbound);

  // Show thread position breakdown
  console.log('');
  console.log('═══ THREAD POSITION ═══');
  const pos1 = data?.filter(e => e.thread_position === 1).length || 0;
  const pos2 = data?.filter(e => e.thread_position === 2).length || 0;
  const pos3plus = data?.filter(e => e.thread_position !== null && e.thread_position >= 3).length || 0;
  const posNull = data?.filter(e => e.thread_position === null).length || 0;
  console.log('  Position 1 (thread starters): ' + pos1);
  console.log('  Position 2:                   ' + pos2);
  console.log('  Position 3+:                  ' + pos3plus);
  console.log('  No thread (null):             ' + posNull);

  // Show revision types
  console.log('');
  console.log('═══ REVISION TYPES ═══');
  const revisions: Record<string, number> = {};
  data?.forEach(e => {
    if (e.revision_type) {
      revisions[e.revision_type] = (revisions[e.revision_type] || 0) + 1;
    }
  });
  const noRevision = data?.filter(e => e.revision_type === null).length || 0;
  if (Object.keys(revisions).length === 0) {
    console.log('  No revision emails detected (all original)');
  } else {
    Object.entries(revisions).forEach(([k, v]) => console.log('  ' + k + ': ' + v));
  }
  console.log('  Original (no revision): ' + noRevision);

  // Show true_sender analysis
  console.log('');
  console.log('═══ TRUE SENDER (Forwarded Email Detection) ═══');
  const withTrueSender = data?.filter(e => e.true_sender_email !== null).length || 0;
  const withoutTrueSender = data?.filter(e => e.true_sender_email === null).length || 0;
  console.log('  Has true_sender (forwarded): ' + withTrueSender);
  console.log('  No true_sender (direct):     ' + withoutTrueSender);
}

checkFlags().catch(console.error);
