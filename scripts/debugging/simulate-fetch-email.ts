#!/usr/bin/env npx tsx
/**
 * Simulate the exact fetch-emails route process for a specific email
 * to understand why attachments aren't being stored
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

async function main() {
  const messageId = '19b745259578ba0c'; // CMA CGM Booking confirmation available

  console.log('='.repeat(70));
  console.log('Simulating fetch-emails route for:', messageId);
  console.log('='.repeat(70));

  // Step 1: Check if email exists (as fetch-emails does)
  console.log('\n1. Checking if email exists in raw_emails...');
  const { data: existing } = await supabase
    .from('raw_emails')
    .select('id, has_attachments, created_at')
    .eq('gmail_message_id', messageId)
    .single();

  if (existing) {
    console.log('   Email ALREADY EXISTS:', existing.id);
    console.log('   has_attachments:', existing.has_attachments);
    console.log('   created_at:', existing.created_at);
    console.log('\n   >>> In production, the route would SKIP this email (duplicate) <<<');
    console.log('\n   This might be the issue - email was already stored before');
    console.log('   the attachment extraction loop runs.');
  } else {
    console.log('   Email does not exist (would be processed)');
  }

  // Step 2: Check what's in raw_attachments for this email
  console.log('\n2. Checking raw_attachments for this email...');
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('*')
    .eq('email_id', existing?.id);

  console.log('   Attachments found:', attachments?.length || 0);
  if (attachments && attachments.length > 0) {
    for (const att of attachments) {
      console.log(`   - ${att.filename} (${att.size_bytes} bytes)`);
    }
  }

  // Step 3: Fetch from Gmail and run the EXACT logic
  console.log('\n3. Fetching from Gmail API...');
  const oauth2Client = new OAuth2Client(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN
  });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const emailResponse = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const emailData = emailResponse.data;
  const payload = emailData.payload;

  // Run the EXACT findAttachments function from route.ts
  const findAttachments = (part: any, depth = 0): any[] => {
    const attachments: any[] = [];
    if (part.filename && part.filename.length > 0) {
      console.log(`   [findAttachments] depth=${depth} file="${part.filename}" hasId=${!!part.body?.attachmentId}`);
      if (part.body?.attachmentId || part.body?.data || part.body?.size > 0) {
        attachments.push(part);
      }
    }
    if (part.parts) {
      for (const subPart of part.parts) {
        attachments.push(...findAttachments(subPart, depth + 1));
      }
    }
    return attachments;
  };

  const allAttachments = payload ? findAttachments(payload) : [];
  const hasAttachments = allAttachments.length > 0;

  console.log(`\n   findAttachments result: ${allAttachments.length} attachments`);
  console.log(`   hasAttachments would be set to: ${hasAttachments}`);

  // Step 4: Show what WOULD be stored
  console.log('\n4. Attachments that WOULD be stored:');
  for (const part of allAttachments) {
    const isPdf = part.filename?.toLowerCase().endsWith('.pdf');
    console.log(`   ${isPdf ? '[PDF]' : '[IMG]'} ${part.filename} - ${part.body?.size || 0} bytes`);
  }

  // Step 5: Try to actually store attachments (if email exists)
  if (existing && allAttachments.length > 0) {
    console.log('\n5. ATTEMPTING TO STORE ATTACHMENTS NOW...');
    console.log('   (This is what the fetch-emails route SHOULD have done)');

    let storedCount = 0;
    for (const part of allAttachments) {
      try {
        let attachmentData: string | null = null;

        if (part.body?.attachmentId) {
          console.log(`   Fetching ${part.filename} via attachmentId...`);
          const attachmentResponse = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: messageId,
            id: part.body.attachmentId,
          });
          attachmentData = attachmentResponse.data.data || null;
          console.log(`   Got ${attachmentData?.length || 0} chars of base64 data`);
        } else if (part.body?.data) {
          attachmentData = part.body.data;
        }

        if (attachmentData) {
          // Check if already exists
          const { data: existingAtt } = await supabase
            .from('raw_attachments')
            .select('id')
            .eq('email_id', existing.id)
            .eq('filename', part.filename)
            .single();

          if (existingAtt) {
            console.log(`   SKIP: ${part.filename} already exists`);
            continue;
          }

          const { error: insertError } = await supabase.from('raw_attachments').insert({
            email_id: existing.id,
            filename: part.filename,
            mime_type: part.mimeType || 'application/octet-stream',
            size_bytes: part.body?.size || 0,
            content_base64: attachmentData,
          });

          if (insertError) {
            console.log(`   ERROR storing ${part.filename}:`, insertError.message);
          } else {
            console.log(`   STORED: ${part.filename}`);
            storedCount++;
          }
        }
      } catch (err: any) {
        console.log(`   ERROR: ${part.filename} - ${err.message}`);
      }
    }
    console.log(`\n   Total attachments stored: ${storedCount}`);
  }

  // Step 6: Verify final state
  console.log('\n6. Final verification - raw_attachments:');
  const { data: finalAtts } = await supabase
    .from('raw_attachments')
    .select('filename, mime_type, size_bytes')
    .eq('email_id', existing?.id);

  console.log('   Attachments in DB:', finalAtts?.length || 0);
  for (const att of finalAtts || []) {
    console.log(`   - ${att.filename} (${att.mime_type}, ${att.size_bytes} bytes)`);
  }
}

main().catch(console.error);
