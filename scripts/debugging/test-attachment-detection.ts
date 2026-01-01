#!/usr/bin/env npx tsx
/**
 * Test the exact attachment detection logic used in fetch-emails route
 * against a real CMA CGM email MIME structure
 */

import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

// This is the EXACT same function from fetch-emails/route.ts
const findAttachments = (part: any, depth = 0): any[] => {
  const attachments: any[] = [];
  if (part.filename && part.filename.length > 0) {
    // Log what we find for debugging
    console.log(`[findAttachments depth=${depth}] Found: ${part.filename}, hasId: ${!!part.body?.attachmentId}, hasData: ${!!part.body?.data}, size: ${part.body?.size}`);
    // Has attachmentId OR inline data OR just has size (try to fetch anyway)
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

async function main() {
  console.log('Testing attachment detection logic against CMA CGM email');
  console.log('='.repeat(60));

  const oauth2Client = new OAuth2Client(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET
  );
  oauth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN
  });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // The problematic email
  const messageId = '19b745259578ba0c';

  console.log(`\nFetching email ${messageId}...`);
  const response = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const payload = response.data.payload;
  if (!payload) {
    console.log('No payload!');
    return;
  }

  console.log('\nRunning findAttachments (exact production code):');
  console.log('-'.repeat(60));

  const allAttachments = findAttachments(payload);

  console.log('-'.repeat(60));
  console.log(`\nTotal attachments found: ${allAttachments.length}`);

  if (allAttachments.length > 0) {
    console.log('\nAttachments that would be stored:');
    for (const att of allAttachments) {
      console.log(`  - ${att.filename} (${att.mimeType}, ${att.body?.size || 0} bytes)`);
      console.log(`    attachmentId: ${att.body?.attachmentId ? 'YES' : 'NO'}`);
    }
  } else {
    console.log('\n*** NO ATTACHMENTS FOUND - THIS IS THE BUG ***');

    // Debug: Let's manually walk the structure
    console.log('\nManual structure walk:');
    console.log(`payload.parts count: ${payload.parts?.length || 0}`);

    if (payload.parts) {
      for (let i = 0; i < payload.parts.length; i++) {
        const part = payload.parts[i];
        console.log(`\nparts[${i}]:`);
        console.log(`  mimeType: ${part.mimeType}`);
        console.log(`  filename: "${part.filename || ''}"`);
        console.log(`  filename.length: ${part.filename?.length || 0}`);
        console.log(`  body.attachmentId: ${part.body?.attachmentId ? 'YES' : 'NO'}`);
        console.log(`  body.size: ${part.body?.size || 0}`);

        if (part.parts) {
          console.log(`  nested parts: ${part.parts.length}`);
          for (let j = 0; j < part.parts.length; j++) {
            const nested = part.parts[j];
            console.log(`    parts[${i}].parts[${j}]: filename="${nested.filename || ''}", mime=${nested.mimeType}`);
          }
        }
      }
    }
  }
}

main().catch(console.error);
