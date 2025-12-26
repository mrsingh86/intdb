#!/usr/bin/env npx tsx
import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('Connecting to:', supabaseUrl);

const supabase = createClient(supabaseUrl!, supabaseKey!);

async function debugExtraction() {
  // Get booking confirmation emails
  const { data: classifications, error: classError } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  console.log('Classifications found:', classifications?.length || 0);
  if (classError) console.log('Classification error:', classError.message);

  if (!classifications) return;

  const emailIds = classifications.map(c => c.email_id);
  console.log('Email IDs count:', emailIds.length);

  // Get emails with their content
  const { data: emails, error: emailError } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text, carrier_id')
    .in('id', emailIds)
    .order('received_at', { ascending: false });

  console.log('Emails fetched:', emails?.length || 0);
  if (emailError) console.log('Email error:', emailError.message);

  // Filter for emails with actual content (>100 chars)
  const emailsWithContent = (emails || []).filter(
    e => e.body_text && e.body_text.length > 100
  );

  console.log('Emails with content (>100 chars):', emailsWithContent.length);

  // Show sample
  if (emailsWithContent.length > 0) {
    const sample = emailsWithContent[0];
    console.log('\nFirst email sample:');
    console.log('  ID:', sample.id);
    console.log('  Subject:', sample.subject?.substring(0, 60));
    console.log('  Body length:', sample.body_text?.length);
  }
}

debugExtraction().catch(console.error);
