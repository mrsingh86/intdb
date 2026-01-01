#!/usr/bin/env npx tsx
/**
 * Backfill missing attachments for CMA CGM emails
 *
 * This script re-processes CMA CGM emails that have has_attachments=true
 * but no records in raw_attachments table.
 */

import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

interface MimePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  body?: {
    attachmentId?: string;
    size?: number;
    data?: string;
  };
  parts?: MimePart[];
}

// Recursive attachment finder (same as in fetch-emails route)
function findAttachments(part: MimePart, depth = 0): MimePart[] {
  const attachments: MimePart[] = [];
  if (part.filename && part.filename.length > 0) {
    if (part.body?.attachmentId || part.body?.data || (part.body?.size || 0) > 0) {
      attachments.push(part);
    }
  }
  if (part.parts) {
    for (const subPart of part.parts) {
      attachments.push(...findAttachments(subPart, depth + 1));
    }
  }
  return attachments;
}

async function main() {
  console.log('=' .repeat(70));
  console.log('Backfilling Missing CMA CGM Attachments');
  console.log('=' .repeat(70));

  // Find CMA CGM emails with has_attachments=true but no attachments stored
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, gmail_message_id, subject, sender_email')
    .ilike('sender_email', '%CMA CGM%')
    .eq('has_attachments', true)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Database error:', error.message);
    return;
  }

  console.log(`Found ${emails?.length || 0} CMA CGM emails with has_attachments=true`);

  // Filter to those without attachments
  const emailsToProcess: typeof emails = [];
  for (const email of emails || []) {
    const { count } = await supabase
      .from('raw_attachments')
      .select('*', { count: 'exact', head: true })
      .eq('email_id', email.id);

    if (!count || count === 0) {
      emailsToProcess.push(email);
    }
  }

  console.log(`${emailsToProcess.length} emails need attachment backfill\n`);

  if (emailsToProcess.length === 0) {
    console.log('No emails need processing.');
    return;
  }

  // Set up Gmail API
  const oauth2Client = new OAuth2Client(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN
  });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  let totalStored = 0;
  let totalErrors = 0;

  for (const email of emailsToProcess) {
    console.log('-'.repeat(60));
    console.log(`Processing: ${email.subject?.substring(0, 60)}`);
    console.log(`Gmail ID: ${email.gmail_message_id}`);

    try {
      // Fetch email from Gmail
      const response = await gmail.users.messages.get({
        userId: 'me',
        id: email.gmail_message_id,
        format: 'full',
      });

      const payload = response.data.payload;
      if (!payload) {
        console.log('  No payload found');
        continue;
      }

      // Find attachments
      const allAttachments = findAttachments(payload as MimePart);
      console.log(`  Found ${allAttachments.length} attachments`);

      let storedCount = 0;
      for (const part of allAttachments) {
        const gmailAttachmentId = part.body?.attachmentId;

        if (!gmailAttachmentId) {
          console.log(`  Skipping (no attachmentId): ${part.filename}`);
          continue;
        }

        // Check if already exists
        const { data: existing } = await supabase
          .from('raw_attachments')
          .select('id')
          .eq('email_id', email.id)
          .eq('filename', part.filename)
          .single();

        if (existing) {
          console.log(`  Already exists: ${part.filename}`);
          continue;
        }

        // Store reference (truncated to fit VARCHAR(200))
        // Note: PDF extraction re-fetches by filename, so truncation is acceptable
        const storagePath = `gmail://${gmailAttachmentId}`.substring(0, 200);

        // Generate a short attachment ID for display
        const shortAttachmentId = `${email.id.substring(0, 8)}-${storedCount + 1}`;

        const { error: insertError } = await supabase.from('raw_attachments').insert({
          email_id: email.id,
          filename: part.filename,
          mime_type: part.mimeType || 'application/octet-stream',
          size_bytes: part.body?.size || 0,
          storage_path: storagePath,
          attachment_id: shortAttachmentId,
          extraction_status: 'pending',
        });

        if (insertError) {
          console.log(`  ERROR storing ${part.filename}: ${insertError.message}`);
          totalErrors++;
        } else {
          const isPdf = part.filename?.toLowerCase().endsWith('.pdf');
          console.log(`  ${isPdf ? '[PDF]' : '[IMG]'} Stored: ${part.filename}`);
          storedCount++;
          totalStored++;
        }
      }

      console.log(`  Stored ${storedCount} attachments`);
    } catch (gmailError: any) {
      console.log(`  Gmail API error: ${gmailError.message}`);
      totalErrors++;
    }
  }

  console.log('\n' + '=' .repeat(70));
  console.log('BACKFILL COMPLETE');
  console.log('=' .repeat(70));
  console.log(`Total attachments stored: ${totalStored}`);
  console.log(`Total errors: ${totalErrors}`);
}

main().catch(console.error);
