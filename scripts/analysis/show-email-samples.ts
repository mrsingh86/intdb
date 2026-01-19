#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

function htmlToText(html: string | null): string {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  // Amendment samples
  console.log('═'.repeat(80));
  console.log('AMENDMENT EMAILS (without PDF):');
  console.log('═'.repeat(80));

  const { data: amendments } = await supabase
    .from('raw_emails')
    .select('subject, body_text, body_html')
    .ilike('subject', 'Booking Amendment%')
    .or('sender_email.ilike.%maersk%,true_sender_email.ilike.%maersk%')
    .limit(2);

  for (const e of amendments || []) {
    console.log('\nSUBJECT:', e.subject);
    console.log('BODY:');
    const text = e.body_text || htmlToText(e.body_html);
    console.log(text.substring(0, 500) + '...');
    console.log('─'.repeat(80));
  }

  // Arrival samples
  console.log('\n' + '═'.repeat(80));
  console.log('ARRIVAL NOTICE EMAILS (without PDF):');
  console.log('═'.repeat(80));

  const { data: arrivals } = await supabase
    .from('raw_emails')
    .select('subject, body_text, body_html')
    .or('subject.ilike.Arrival notice%,subject.ilike.Arrival Notice%')
    .or('sender_email.ilike.%maersk%,true_sender_email.ilike.%maersk%')
    .limit(2);

  for (const e of arrivals || []) {
    console.log('\nSUBJECT:', e.subject);
    console.log('BODY:');
    const text = e.body_text || htmlToText(e.body_html);
    console.log(text.substring(0, 500) + '...');
    console.log('─'.repeat(80));
  }

  // Invoice samples
  console.log('\n' + '═'.repeat(80));
  console.log('INVOICE EMAILS (without PDF):');
  console.log('═'.repeat(80));

  const { data: invoices } = await supabase
    .from('raw_emails')
    .select('subject, body_text, body_html')
    .ilike('subject', 'New invoice%')
    .or('sender_email.ilike.%maersk%,true_sender_email.ilike.%maersk%')
    .limit(2);

  for (const e of invoices || []) {
    console.log('\nSUBJECT:', e.subject);
    console.log('BODY:');
    const text = e.body_text || htmlToText(e.body_html);
    console.log(text.substring(0, 500) + '...');
    console.log('─'.repeat(80));
  }
}

main().catch(console.error);
