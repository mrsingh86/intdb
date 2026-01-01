#!/usr/bin/env npx tsx
/**
 * Investigate CMA CGM "Booking confirmation available" email MIME structure
 *
 * This script fetches the raw Gmail message and inspects every part of its
 * MIME structure to understand why attachments are not being detected.
 */

import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials');
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface MimePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: {
    attachmentId?: string;
    size?: number;
    data?: string;
  };
  parts?: MimePart[];
}

function inspectMimePart(part: MimePart, depth = 0): void {
  const indent = '  '.repeat(depth);
  const prefix = `${indent}[${part.partId || 'root'}]`;

  console.log(`${prefix} mimeType: ${part.mimeType || 'NONE'}`);
  console.log(`${prefix} filename: ${part.filename || 'NONE'}`);

  if (part.body) {
    console.log(`${prefix} body.attachmentId: ${part.body.attachmentId ? part.body.attachmentId.substring(0, 40) + '...' : 'NONE'}`);
    console.log(`${prefix} body.size: ${part.body.size || 0}`);
    console.log(`${prefix} body.data: ${part.body.data ? `${part.body.data.length} chars` : 'NONE'}`);
  }

  // Check Content-Disposition header
  const contentDisposition = part.headers?.find(h =>
    h.name?.toLowerCase() === 'content-disposition'
  )?.value;
  if (contentDisposition) {
    console.log(`${prefix} Content-Disposition: ${contentDisposition}`);
  }

  // Check Content-Type header for name parameter
  const contentType = part.headers?.find(h =>
    h.name?.toLowerCase() === 'content-type'
  )?.value;
  if (contentType) {
    console.log(`${prefix} Content-Type: ${contentType}`);
  }

  console.log(`${prefix} ---`);

  // Recurse into sub-parts
  if (part.parts && part.parts.length > 0) {
    console.log(`${prefix} ${part.parts.length} sub-parts:`);
    for (const subPart of part.parts) {
      inspectMimePart(subPart, depth + 1);
    }
  }
}

async function main() {
  console.log('=' .repeat(80));
  console.log('CMA CGM "Booking confirmation available" Email MIME Structure Investigation');
  console.log('=' .repeat(80));
  console.log();

  // Find CMA CGM "Booking confirmation available" email
  const { data: emails, error: dbError } = await supabase
    .from('raw_emails')
    .select('id, gmail_message_id, subject, sender_email, has_attachments, received_at')
    .ilike('subject', '%Booking confirmation available%')
    .ilike('sender_email', '%CMA CGM%')
    .order('received_at', { ascending: false })
    .limit(5);

  if (dbError) {
    console.error('Database error:', dbError.message);
    return;
  }

  if (!emails || emails.length === 0) {
    console.log('No CMA CGM "Booking confirmation available" emails found in database');
    console.log('Trying broader search...');

    // Try broader search
    const { data: broaderEmails } = await supabase
      .from('raw_emails')
      .select('id, gmail_message_id, subject, sender_email, has_attachments, received_at')
      .or('subject.ilike.%CMA CGM%,sender_email.ilike.%CMA CGM%')
      .ilike('subject', '%Booking%')
      .order('received_at', { ascending: false })
      .limit(10);

    console.log('\nBroader search results:');
    for (const e of broaderEmails || []) {
      console.log(`  - ${e.subject?.substring(0, 60)}`);
      console.log(`    Sender: ${e.sender_email?.substring(0, 50)}`);
      console.log(`    has_attachments: ${e.has_attachments}`);
    }
    return;
  }

  console.log(`Found ${emails.length} CMA CGM booking confirmation emails\n`);

  // Set up Gmail API
  const oauth2Client = new OAuth2Client(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN
  });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Analyze each email
  for (const email of emails) {
    console.log('-'.repeat(80));
    console.log(`EMAIL: ${email.subject}`);
    console.log(`Gmail ID: ${email.gmail_message_id}`);
    console.log(`Sender: ${email.sender_email}`);
    console.log(`has_attachments in DB: ${email.has_attachments}`);
    console.log('-'.repeat(80));

    // Check what we have in raw_attachments
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('filename, mime_type, size_bytes')
      .eq('email_id', email.id);

    console.log(`Attachments in raw_attachments table: ${attachments?.length || 0}`);
    if (attachments && attachments.length > 0) {
      for (const att of attachments) {
        console.log(`  - ${att.filename} (${att.mime_type}, ${att.size_bytes} bytes)`);
      }
    }
    console.log();

    // Fetch from Gmail API
    try {
      console.log('Fetching from Gmail API...');
      const response = await gmail.users.messages.get({
        userId: 'me',
        id: email.gmail_message_id,
        format: 'full',
      });

      const payload = response.data.payload;
      if (!payload) {
        console.log('No payload in Gmail response!');
        continue;
      }

      console.log('\nMIME STRUCTURE:');
      console.log('='.repeat(40));
      inspectMimePart(payload as MimePart);

      // Additional analysis: find ALL parts with potential attachment indicators
      console.log('\n\nANALYSIS: Parts that might be attachments');
      console.log('='.repeat(40));

      function findPotentialAttachments(part: MimePart, results: string[], path = 'root'): void {
        const hasFilename = part.filename && part.filename.length > 0;
        const hasAttachmentId = !!part.body?.attachmentId;
        const hasData = !!part.body?.data;
        const hasSize = (part.body?.size || 0) > 0;

        // Check Content-Disposition
        const contentDisposition = part.headers?.find(h =>
          h.name?.toLowerCase() === 'content-disposition'
        )?.value || '';
        const isAttachmentDisposition = contentDisposition.toLowerCase().includes('attachment');

        // Check Content-Type for name parameter
        const contentType = part.headers?.find(h =>
          h.name?.toLowerCase() === 'content-type'
        )?.value || '';
        const hasNameInContentType = contentType.toLowerCase().includes('name=');

        // Check if it's a PDF or known document type
        const isPdfMime = part.mimeType?.toLowerCase().includes('pdf');
        const isOctetStream = part.mimeType === 'application/octet-stream';

        if (hasFilename || hasAttachmentId || isAttachmentDisposition || hasNameInContentType || isPdfMime || isOctetStream) {
          results.push(`
Path: ${path}
  mimeType: ${part.mimeType}
  filename: ${part.filename || 'EMPTY'}
  Content-Disposition: ${contentDisposition || 'NONE'}
  Content-Type name param: ${hasNameInContentType ? 'YES' : 'NO'}
  body.attachmentId: ${hasAttachmentId ? 'YES' : 'NO'}
  body.data: ${hasData ? 'YES' : 'NO'}
  body.size: ${part.body?.size || 0}
  DETECTION ISSUES:
    - filename check (current): ${hasFilename ? 'WOULD DETECT' : 'WOULD MISS'}
    - attachmentId present: ${hasAttachmentId}
    - Content-Disposition=attachment: ${isAttachmentDisposition}
`);
        }

        if (part.parts) {
          for (let i = 0; i < part.parts.length; i++) {
            findPotentialAttachments(part.parts[i], results, `${path}/parts[${i}]`);
          }
        }
      }

      const potentialAttachments: string[] = [];
      findPotentialAttachments(payload as MimePart, potentialAttachments);

      if (potentialAttachments.length > 0) {
        for (const att of potentialAttachments) {
          console.log(att);
        }
      } else {
        console.log('No potential attachments found in MIME structure!');
        console.log('This might indicate the attachment is embedded differently.');
      }

    } catch (gmailError) {
      console.error('Gmail API error:', gmailError);
    }

    console.log('\n');
  }
}

main().catch(console.error);
