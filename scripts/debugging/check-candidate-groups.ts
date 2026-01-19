import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Get candidates with email data
  const { data: candidates } = await supabase
    .from('shipment_link_candidates')
    .select('id, link_type, matched_value, confidence_score, email_id')
    .eq('is_confirmed', false)
    .eq('is_rejected', false);

  // Get email data
  const emailIds = candidates?.map(c => c.email_id).filter(Boolean) || [];
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, gmail_message_id, sender_email, true_sender_email, subject')
    .in('id', emailIds);

  const emailMap = new Map(emails?.map(e => [e.id, e]) || []);

  // Group like the UI does
  const groups = new Map<string, { count: number; confidence: number; type: string; value: string; sender: string }>();
  const seen = new Set<string>();

  for (const c of candidates || []) {
    const email = emailMap.get(c.email_id);
    const gmailId = email?.gmail_message_id;

    // Skip duplicates by gmail_message_id
    if (gmailId && seen.has(gmailId)) continue;
    if (gmailId) seen.add(gmailId);

    const trueSender = email?.true_sender_email || email?.sender_email || 'unknown';
    const key = `${c.link_type}|${c.matched_value}|${trueSender}`;

    if (!groups.has(key)) {
      groups.set(key, { count: 0, confidence: 0, type: c.link_type, value: c.matched_value, sender: trueSender });
    }
    const g = groups.get(key)!;
    g.count++;
    g.confidence += c.confidence_score;
  }

  console.log('Raw candidates:', candidates?.length);
  console.log('Unique gmail_message_ids:', seen.size);
  console.log('Grouped candidates (what UI shows):', groups.size);
  console.log('');
  console.log('Groups:');
  let i = 1;
  for (const g of groups.values()) {
    console.log(`${i}. ${g.type}: ${g.value} (sender: ${g.sender.substring(0, 40)}...) - ${g.count} versions, avg conf: ${Math.round(g.confidence / g.count)}`);
    i++;
  }
}

main().catch(console.error);
