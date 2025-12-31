/**
 * Show Maersk Raw Email
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function showMaerskEmail() {
  // Get all Maersk emails
  const { data } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, received_at, body_text')
    .ilike('sender_email', '%maersk%');

  if (data && data.length > 0) {
    for (const email of data) {
      console.log('');
      console.log('═'.repeat(80));
      console.log('MAERSK EMAIL');
      console.log('═'.repeat(80));
      console.log('ID:', email.id);
      console.log('Subject:', email.subject);
      console.log('From:', email.sender_email);
      console.log('Received:', email.received_at);
      console.log('');
      console.log('─'.repeat(80));
      console.log('FULL BODY TEXT:');
      console.log('─'.repeat(80));
      console.log(email.body_text || '(empty)');
      console.log('─'.repeat(80));
    }
  } else {
    console.log('No Maersk emails found');
  }
}

showMaerskEmail();
