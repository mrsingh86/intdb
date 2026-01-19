#!/usr/bin/env npx tsx
/**
 * Check CMA CGM email body content
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get CMA CGM booking confirmation emails
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('subject, body_text, body_html')
    .ilike('subject', '%CMA CGM - Booking confirmation%')
    .limit(3);

  for (const email of emails || []) {
    console.log('\n' + '═'.repeat(70));
    console.log('Subject:', email.subject);
    console.log('═'.repeat(70));

    if (email.body_text && email.body_text.length > 0) {
      console.log('\n═══ BODY TEXT ═══');
      console.log(email.body_text.substring(0, 2000));
    } else if (email.body_html && email.body_html.length > 0) {
      console.log('\n═══ BODY HTML (no text, showing HTML) ═══');
      // Extract text from HTML roughly
      const text = email.body_html
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      console.log(text.substring(0, 2000));
    } else {
      console.log('NO CONTENT');
    }
  }
}

main().catch(console.error);
