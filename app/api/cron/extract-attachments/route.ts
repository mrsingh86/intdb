/**
 * Cron Job: Extract Attachment Text
 *
 * Fetches PDF content from Gmail and extracts text for classification.
 * Schedule: Every 5 minutes (via Vercel cron)
 *
 * Pipeline:
 * 1. Get attachments with extraction_status = 'pending'
 * 2. Re-fetch email from Gmail to get fresh attachment IDs
 * 3. Extract text using pdf-parse
 * 4. Update raw_attachments.extracted_text
 *
 * Principles:
 * - Idempotent (only processes pending)
 * - Re-fetches messages (attachment IDs expire quickly)
 * - Fail Gracefully (continue on individual failures)
 * - Batch processing with limits
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse-fork');

const MAX_PER_RUN = 50;

interface GmailPart {
  partId: string;
  mimeType: string;
  filename: string;
  body: {
    attachmentId?: string;
    size: number;
    data?: string;
  };
  parts?: GmailPart[];
}

function findAttachmentPart(parts: GmailPart[] | undefined, filename: string): GmailPart | null {
  if (!parts) return null;

  for (const part of parts) {
    if (part.filename === filename && part.body?.attachmentId) {
      return part;
    }
    if (part.parts) {
      const found = findAttachmentPart(part.parts, filename);
      if (found) return found;
    }
  }
  return null;
}

export async function GET(request: Request) {
  const startTime = Date.now();
  const stats = {
    pending_found: 0,
    extracted: 0,
    failed: 0,
    skipped: 0,
    errors: [] as string[],
  };

  try {
    // Validate environment
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!clientId || !clientSecret || !refreshToken) {
      return NextResponse.json({ error: 'Gmail credentials not configured' }, { status: 500 });
    }
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    // Initialize clients
    const supabase = createClient(supabaseUrl, supabaseKey);
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get pending PDF attachments
    const { data: pending, error: fetchError } = await supabase
      .from('raw_attachments')
      .select(`
        id,
        email_id,
        filename,
        mime_type,
        storage_path,
        raw_emails!inner (
          gmail_message_id
        )
      `)
      .eq('extraction_status', 'pending')
      .or('mime_type.eq.application/pdf,filename.ilike.%.pdf')
      .limit(MAX_PER_RUN);

    if (fetchError) {
      console.error('[Extract] Error fetching pending:', fetchError);
      return NextResponse.json({ error: fetchError.message }, { status: 500 });
    }

    stats.pending_found = pending?.length || 0;
    console.log(`[Extract] Found ${stats.pending_found} pending attachments`);

    if (!pending || pending.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No pending attachments',
        duration_ms: Date.now() - startTime,
        stats,
      });
    }

    // Group by gmail_message_id to minimize API calls
    const byMessageId = new Map<string, typeof pending>();
    for (const att of pending) {
      const rawEmail = Array.isArray(att.raw_emails) ? att.raw_emails[0] : att.raw_emails;
      const msgId = rawEmail?.gmail_message_id;
      if (!msgId) continue;

      if (!byMessageId.has(msgId)) byMessageId.set(msgId, []);
      byMessageId.get(msgId)!.push(att);
    }

    console.log(`[Extract] Processing ${byMessageId.size} unique emails`);

    // Process each message
    for (const [messageId, attachments] of byMessageId) {
      try {
        // Fetch fresh message to get current attachment IDs
        const message = await gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'full',
        });

        const parts = message.data.payload?.parts;

        for (const attachment of attachments) {
          try {
            console.log(`[Extract] Processing: ${attachment.filename}`);

            // Find matching attachment part by filename
            const part = findAttachmentPart(parts, attachment.filename);
            if (!part || !part.body?.attachmentId) {
              console.log(`[Extract] Attachment not found: ${attachment.filename}`);
              stats.skipped++;
              await updateStatus(supabase, attachment.id, 'skipped', null, 'Attachment not found in message');
              continue;
            }

            // Fetch attachment with fresh ID
            const gmailResponse = await gmail.users.messages.attachments.get({
              userId: 'me',
              messageId: messageId,
              id: part.body.attachmentId,
            });

            const base64Data = gmailResponse.data.data;
            if (!base64Data) {
              console.log(`[Extract] No data: ${attachment.filename}`);
              stats.failed++;
              await updateStatus(supabase, attachment.id, 'failed', null, 'No data from Gmail');
              continue;
            }

            // Convert and extract
            const pdfBuffer = Buffer.from(base64Data, 'base64url');

            let extractedText = '';
            try {
              const pdfData = await pdfParse(pdfBuffer);
              extractedText = pdfData.text?.trim() || '';
            } catch (pdfErr: any) {
              console.error(`[Extract] PDF parse error for ${attachment.filename}:`, pdfErr.message);
              stats.failed++;
              await updateStatus(supabase, attachment.id, 'failed', null, `PDF parse error: ${pdfErr.message}`);
              continue;
            }

            if (extractedText.length === 0) {
              console.log(`[Extract] Empty PDF: ${attachment.filename}`);
              stats.failed++;
              await updateStatus(supabase, attachment.id, 'failed', null, 'PDF contains no extractable text');
              continue;
            }

            // Success
            await updateStatus(supabase, attachment.id, 'completed', extractedText, null);
            stats.extracted++;
            console.log(`[Extract] Success: ${attachment.filename} (${extractedText.length} chars)`);

          } catch (err: any) {
            console.error(`[Extract] Error processing ${attachment.filename}:`, err.message);
            stats.failed++;
            stats.errors.push(`${attachment.filename}: ${err.message}`);
            await updateStatus(supabase, attachment.id, 'failed', null, err.message);
          }
        }
      } catch (msgErr: any) {
        console.log(`[Extract] Message ${messageId}: ${msgErr.message}`);
        // Mark all attachments for this message as failed
        for (const att of attachments) {
          stats.failed++;
          await updateStatus(supabase, att.id, 'failed', null, `Message fetch error: ${msgErr.message}`);
        }
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Extract] Completed in ${duration}ms:`, stats);

    return NextResponse.json({
      success: true,
      duration_ms: duration,
      stats,
    });

  } catch (error) {
    console.error('[Extract] Fatal error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error', stats },
      { status: 500 }
    );
  }
}

async function updateStatus(
  supabase: any,
  attachmentId: string,
  status: string,
  extractedText: string | null,
  error: string | null
) {
  await supabase
    .from('raw_attachments')
    .update({
      extraction_status: status,
      extracted_text: extractedText,
      extraction_error: error,
      extracted_at: new Date().toISOString(),
    })
    .eq('id', attachmentId);
}

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max
