/**
 * Show Hapag-Lloyd email with extracted PDF content
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function showHapagWithPdf() {
  // Get a Hapag-Lloyd booking confirmation with cutoffs
  const { data: email } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, body_text')
    .eq('sender_email', 'India@service.hlag.com')
    .ilike('subject', 'HL-22970937%')
    .limit(1)
    .single();

  if (email) {
    console.log('═'.repeat(80));
    console.log('HAPAG-LLOYD BOOKING CONFIRMATION WITH EXTRACTED PDF');
    console.log('═'.repeat(80));
    console.log('Subject:', email.subject);
    console.log('From:', email.sender_email);
    console.log('');
    console.log('─'.repeat(80));
    console.log('FULL BODY TEXT (includes extracted PDF):');
    console.log('─'.repeat(80));
    console.log(email.body_text);
    console.log('─'.repeat(80));
  } else {
    console.log('Email not found');
  }
}

showHapagWithPdf();
