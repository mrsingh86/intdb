import { google } from 'googleapis';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function fetchBookingEmails() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oauth2Client.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  console.log('=== FETCHING BOOKING CONFIRMATION EMAILS ===\n');

  // Search Gmail for booking confirmations
  const search = await gmail.users.messages.list({
    userId: 'me',
    q: 'subject:"Booking Confirmation" newer_than:7d',
    maxResults: 20
  });

  console.log('Found in Gmail:', search.data.messages?.length || 0, '\n');

  let stored = 0;
  let skipped = 0;

  for (const msg of search.data.messages || []) {
    // Check if in DB
    const { data: existing } = await supabase
      .from('raw_emails')
      .select('id')
      .eq('gmail_message_id', msg.id)
      .single();

    if (existing) {
      skipped++;
      continue;
    }

    // Get email details
    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id!,
      format: 'full'
    });

    const headers = detail.data.payload?.headers || [];
    const getHeader = (name: string) =>
      headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

    const subject = getHeader('Subject');
    const from = getHeader('From');
    const date = getHeader('Date');

    console.log('NEW:', subject.substring(0, 50));
    console.log('  From:', from.substring(0, 50));
    console.log('  Date:', date);

    // Store it
    const emailRecord = {
      gmail_message_id: msg.id,
      thread_id: detail.data.threadId,
      subject: subject,
      sender_email: from,
      sender_name: from.split('<')[0]?.trim().replace(/['"]/g, '') || null,
      received_at: new Date(parseInt(detail.data.internalDate || '0')).toISOString(),
      body_text: getBodyText(detail.data.payload),
      body_html: getBodyHtml(detail.data.payload),
      has_attachments: hasAttachments(detail.data.payload),
      processing_status: 'pending',
    };

    const { error } = await supabase
      .from('raw_emails')
      .insert(emailRecord);

    if (error) {
      console.log('  ERROR:', error.message);
    } else {
      stored++;
      console.log('  STORED!\n');

      // Store attachments
      await storeAttachments(gmail, msg.id!, emailRecord.gmail_message_id!, detail.data.payload);
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log('New emails stored:', stored);
  console.log('Already in DB:', skipped);
}

function getBodyText(payload: any): string {
  if (!payload) return '';

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const text = getBodyText(part);
      if (text) return text;
    }
  }

  return '';
}

function getBodyHtml(payload: any): string {
  if (!payload) return '';

  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      const html = getBodyHtml(part);
      if (html) return html;
    }
  }

  return '';
}

function hasAttachments(payload: any): boolean {
  if (!payload) return false;
  if (payload.filename && payload.body?.attachmentId) return true;
  if (payload.parts) {
    return payload.parts.some((p: any) => hasAttachments(p));
  }
  return false;
}

async function storeAttachments(gmail: any, messageId: string, gmailMessageId: string, payload: any) {
  if (!payload) return;

  // Get email ID from DB
  const { data: email } = await supabase
    .from('raw_emails')
    .select('id')
    .eq('gmail_message_id', gmailMessageId)
    .single();

  if (!email) return;

  const attachments = findAttachments(payload);

  for (const att of attachments) {
    if (!att.body?.attachmentId) continue;

    // Get attachment data
    const attData = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: messageId,
      id: att.body.attachmentId
    });

    const { error } = await supabase
      .from('raw_attachments')
      .insert({
        email_id: email.id,
        filename: att.filename || 'attachment',
        mime_type: att.mimeType || 'application/octet-stream',
        size_bytes: att.body.size || 0,
        storage_path: `gmail://${messageId}/${att.body.attachmentId}`,
        attachment_id: att.body.attachmentId.substring(0, 10),
      });

    if (error) {
      console.log('  Attachment error:', error.message);
    } else {
      console.log('  Attachment stored:', att.filename);
    }
  }
}

function findAttachments(payload: any): any[] {
  const attachments: any[] = [];

  if (payload.filename && payload.body?.attachmentId) {
    attachments.push(payload);
  }

  if (payload.parts) {
    for (const part of payload.parts) {
      attachments.push(...findAttachments(part));
    }
  }

  return attachments;
}

fetchBookingEmails().catch(console.error);
