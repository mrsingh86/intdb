#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Get one email with has_attachments=true that has no raw_attachments record
  const { data: withFlag } = await supabase
    .from('raw_emails')
    .select('id')
    .eq('has_attachments', true)
    .limit(1000);

  const { data: withRecord } = await supabase
    .from('raw_attachments')
    .select('email_id');

  const recordSet = new Set((withRecord || []).map(r => r.email_id));
  const toUpdate = (withFlag || []).filter(e => recordSet.has(e.id) === false);

  console.log('Found', toUpdate.length, 'emails to potentially update');

  if (toUpdate.length > 0) {
    const testEmail = toUpdate[0];
    console.log('Testing update on email:', testEmail.id);

    // Check current state
    const { data: before } = await supabase
      .from('raw_emails')
      .select('has_attachments')
      .eq('id', testEmail.id)
      .single();
    console.log('Before update:', before);

    // Perform update
    const { data, error } = await supabase
      .from('raw_emails')
      .update({ has_attachments: false })
      .eq('id', testEmail.id)
      .select('id, has_attachments');

    if (error) {
      console.log('Update ERROR:', error);
    } else {
      console.log('Update returned:', data);
    }

    // Verify
    const { data: after } = await supabase
      .from('raw_emails')
      .select('has_attachments')
      .eq('id', testEmail.id)
      .single();
    console.log('After update:', after);
  }
}

main().catch(console.error);
