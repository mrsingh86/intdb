/**
 * Test Gmail attachment download to debug why tokens are invalid
 */

import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function test() {
  // Get a recent email with attachment
  const { data: sample } = await supabase
    .from('raw_attachments')
    .select('id, filename, storage_path, email_id, created_at, raw_emails!inner(gmail_message_id)')
    .ilike('filename', '%.pdf')
    .is('extracted_text', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!sample) {
    console.log('No attachments found');
    return;
  }

  console.log('Testing with recent email:');
  console.log('  Filename:', sample.filename);
  console.log('  Created:', sample.created_at);
  console.log('  Gmail message ID:', (sample.raw_emails as any)?.gmail_message_id);
  console.log('  Storage path:', sample.storage_path?.substring(0, 80));
  console.log('');

  // Try to get the message from Gmail
  const oauth2Client = new OAuth2Client(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN
  });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const messageId = (sample.raw_emails as any)?.gmail_message_id;
  if (!messageId) {
    console.log('No message ID');
    return;
  }

  console.log('Fetching message from Gmail...');
  const msg = await gmail.users.messages.get({
    userId: 'me',
    id: messageId
  });

  // Find attachments in the message
  console.log('');
  console.log('Attachments in message:');

  function findAttachments(parts: any[], depth = 0): void {
    for (const part of parts || []) {
      if (part.filename && part.filename.length > 0) {
        const indent = '  '.repeat(depth);
        console.log(`${indent}- ${part.filename}`);
        console.log(`${indent}  attachmentId: ${part.body?.attachmentId?.substring(0, 60)}...`);
        console.log(`${indent}  mimeType: ${part.mimeType}`);
      }
      if (part.parts) {
        findAttachments(part.parts, depth + 1);
      }
    }
  }

  findAttachments(msg.data.payload?.parts || []);

  // Compare with our stored storage_path
  console.log('');
  console.log('Our stored attachment ID:');
  const storedId = sample.storage_path?.replace('gmail://', '');
  console.log('  ', storedId?.substring(0, 60) + '...');
}

test().catch(e => console.error('Error:', e.message));
