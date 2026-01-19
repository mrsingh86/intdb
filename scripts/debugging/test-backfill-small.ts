#!/usr/bin/env npx tsx
/**
 * Test backfill on small batch
 */

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing Supabase credentials');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const oauth2Client = new OAuth2Client(
  process.env.GMAIL_CLIENT_ID,
  process.env.GMAIL_CLIENT_SECRET
);

oauth2Client.setCredentials({
  refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

async function main() {
  console.log('Testing backfill on 5 emails...\n');

  // Get emails with has_attachments=true but no raw_attachments record
  const { data: withFlag } = await supabase
    .from('raw_emails')
    .select('id, gmail_message_id, subject')
    .eq('has_attachments', true)
    .limit(100);

  const { data: withRecord } = await supabase
    .from('raw_attachments')
    .select('email_id');

  const recordSet = new Set((withRecord || []).map(r => r.email_id));
  const toUpdate = (withFlag || []).filter(e => recordSet.has(e.id) === false);

  console.log(`Found ${toUpdate.length} emails to process`);

  // Process first 5
  for (let i = 0; i < Math.min(5, toUpdate.length); i++) {
    const email = toUpdate[i];
    console.log(`\n${i + 1}. ${email.subject?.substring(0, 50)}`);
    console.log(`   Gmail ID: ${email.gmail_message_id}`);

    try {
      // Fetch from Gmail
      const response = await gmail.users.messages.get({
        userId: 'me',
        id: email.gmail_message_id,
        format: 'full',
      });

      const parts = response.data.payload?.parts || [];
      console.log(`   Parts found: ${parts.length}`);

      // Check for attachments
      const attachments = extractAttachments(parts, []);
      console.log(`   Attachments: ${attachments.length}`);

      if (attachments.length === 0) {
        // Update
        const { data, error } = await supabase
          .from('raw_emails')
          .update({ has_attachments: false, attachment_count: 0 })
          .eq('id', email.id)
          .select('id, has_attachments');

        if (error) {
          console.log(`   Update ERROR: ${error.message}`);
        } else {
          console.log(`   Updated: has_attachments=${data?.[0]?.has_attachments}`);
        }
      } else {
        console.log(`   Has ${attachments.length} attachments - would save to raw_attachments`);
        for (const att of attachments) {
          console.log(`     - ${att.filename} (${att.mimeType})`);
        }
      }
    } catch (err: any) {
      console.log(`   Error: ${err.message}`);
    }
  }

  // Check final count
  console.log('\n---');
  const { count } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true })
    .eq('has_attachments', true);
  console.log(`Current has_attachments=true count: ${count}`);
}

interface AttachmentInfo {
  filename: string;
  mimeType: string;
  size: number;
  attachmentId: string;
}

function extractAttachments(parts: any[], collected: AttachmentInfo[]): AttachmentInfo[] {
  for (const part of parts) {
    if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
      collected.push({
        filename: part.filename,
        mimeType: part.mimeType || 'application/octet-stream',
        size: part.body.size || 0,
        attachmentId: part.body.attachmentId,
      });
    }
    if (part.parts) {
      extractAttachments(part.parts, collected);
    }
  }
  return collected;
}

main().catch(console.error);
