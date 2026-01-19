#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get ALL Hapag subjects
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('subject')
    .or('sender_email.ilike.%hlag%,sender_email.ilike.%hapag%,true_sender_email.ilike.%hlag%,true_sender_email.ilike.%hapag%');

  console.log('ALL UNIQUE HAPAG SUBJECT PREFIXES (non-RE/FW):');
  const prefixes = new Map<string, number>();

  for (const e of emails || []) {
    if (e.subject) {
      const isReFw = /^(RE|Re|FW|Fw|FWD|Fwd):/i.test(e.subject);
      if (isReFw) continue;

      const prefix = e.subject.substring(0, 40);
      prefixes.set(prefix, (prefixes.get(prefix) || 0) + 1);
    }
  }

  // Sort by count
  const sorted = Array.from(prefixes.entries()).sort((a, b) => b[1] - a[1]);
  for (const [p, count] of sorted) {
    console.log(`  [${count}x] ${p}`);
  }
}

main().catch(console.error);
