/**
 * Cron Job: Fetch Emails from Gmail
 *
 * Fetches new emails from Gmail and stores them in raw_emails table.
 * Schedule: Every 5 minutes (via Vercel cron)
 *
 * Pipeline:
 * 1. Connect to Gmail API
 * 2. Fetch new emails (since last fetch)
 * 3. Store in raw_emails with status 'pending'
 * 4. Store attachments in raw_attachments
 *
 * Principles:
 * - Idempotent (duplicate check by gmail_message_id)
 * - Fail Gracefully (continue on individual failures)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';

// Configuration
const MAX_EMAILS_PER_RUN = 50;
const LOOKBACK_MINUTES = 15; // Fetch emails from last 15 min (buffer for cron delays)

export async function GET(request: Request) {
  const startTime = Date.now();
  const stats = {
    emails_fetched: 0,
    emails_stored: 0,
    duplicates_skipped: 0,
    attachments_stored: 0,
    errors: 0,
    first_error: null as string | null,
  };

  // Allow custom lookback via query param (for initial backlog)
  const url = new URL(request.url);
  const lookbackDays = parseInt(url.searchParams.get('days') || '0');
  const lookbackMinutes = lookbackDays > 0
    ? lookbackDays * 24 * 60  // Convert days to minutes
    : LOOKBACK_MINUTES;       // Default 15 min

  // Allow custom limit for backfill (default 50, max 500)
  const emailLimit = Math.min(
    parseInt(url.searchParams.get('limit') || String(MAX_EMAILS_PER_RUN)),
    500
  );

  // Optional 'before' date for targeting specific range (format: YYYY-MM-DD)
  const beforeParam = url.searchParams.get('before');

  try {
    // Validate environment
    const clientId = process.env.GMAIL_CLIENT_ID;
    const clientSecret = process.env.GMAIL_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!clientId || !clientSecret || !refreshToken) {
      return NextResponse.json(
        { error: 'Gmail credentials not configured' },
        { status: 500 }
      );
    }

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Supabase not configured' },
        { status: 500 }
      );
    }

    // Initialize clients
    const supabase = createClient(supabaseUrl, supabaseKey);

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret
    );
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Calculate time filter (last N minutes)
    const afterDate = new Date(Date.now() - lookbackMinutes * 60 * 1000);
    const afterTimestamp = Math.floor(afterDate.getTime() / 1000);

    // Build Gmail query
    let gmailQuery = `after:${afterTimestamp}`;
    if (beforeParam) {
      const beforeDate = new Date(beforeParam);
      const beforeTimestamp = Math.floor(beforeDate.getTime() / 1000);
      gmailQuery += ` before:${beforeTimestamp}`;
    }

    // Fetch email list
    console.log(`[Cron:FetchEmails] Query: ${gmailQuery}`);

    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      maxResults: emailLimit,
      q: gmailQuery,
    });

    const messages = listResponse.data.messages || [];
    stats.emails_fetched = messages.length;

    if (messages.length === 0) {
      console.log('[Cron:FetchEmails] No new emails found');
      return NextResponse.json({
        success: true,
        message: 'No new emails to fetch',
        duration_ms: Date.now() - startTime,
        stats,
      });
    }

    console.log(`[Cron:FetchEmails] Found ${messages.length} emails to process`);

    // Process each email
    for (const message of messages) {
      try {
        const messageId = message.id!;

        // Check if already exists (idempotency)
        const { data: existing } = await supabase
          .from('raw_emails')
          .select('id')
          .eq('gmail_message_id', messageId)
          .single();

        if (existing) {
          stats.duplicates_skipped++;
          continue;
        }

        // Fetch full email
        const emailResponse = await gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'full',
        });

        const emailData = emailResponse.data;
        const headers = emailData.payload?.headers || [];

        const getHeader = (name: string) =>
          headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

        // Extract email body
        let bodyText = '';
        let bodyHtml = '';

        const extractBody = (part: any) => {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            bodyText = Buffer.from(part.body.data, 'base64').toString('utf-8');
          } else if (part.mimeType === 'text/html' && part.body?.data) {
            bodyHtml = Buffer.from(part.body.data, 'base64').toString('utf-8');
          }
          if (part.parts) {
            part.parts.forEach(extractBody);
          }
        };

        if (emailData.payload) {
          extractBody(emailData.payload);
        }

        // Check for attachments
        const hasAttachments = emailData.payload?.parts?.some(
          (p: any) => p.filename && p.filename.length > 0
        ) || false;

        // Store email
        const { data: newEmail, error: insertError } = await supabase
          .from('raw_emails')
          .insert({
            gmail_message_id: messageId,
            thread_id: emailData.threadId,
            subject: getHeader('Subject'),
            sender_email: getHeader('From'),
            body_text: bodyText || emailData.snippet || '',
            body_html: bodyHtml,
            snippet: emailData.snippet || '',
            received_at: new Date(parseInt(emailData.internalDate || '0')).toISOString(),
            has_attachments: hasAttachments,
            processing_status: 'pending',
          })
          .select()
          .single();

        if (insertError) {
          console.error(`[Cron:FetchEmails] Error storing email ${messageId}:`, insertError);
          stats.errors++;
          if (!stats.first_error) {
            stats.first_error = insertError.message || JSON.stringify(insertError);
          }
          continue;
        }

        stats.emails_stored++;

        // Store attachments if any
        if (hasAttachments && emailData.payload?.parts) {
          for (const part of emailData.payload.parts) {
            if (part.filename && part.body?.attachmentId) {
              try {
                const attachmentResponse = await gmail.users.messages.attachments.get({
                  userId: 'me',
                  messageId: messageId,
                  id: part.body.attachmentId,
                });

                const attachmentData = attachmentResponse.data.data;
                if (attachmentData) {
                  await supabase.from('raw_attachments').insert({
                    email_id: newEmail.id,
                    filename: part.filename,
                    mime_type: part.mimeType || 'application/octet-stream',
                    size_bytes: part.body.size || 0,
                    content_base64: attachmentData,
                    processing_status: 'pending',
                  });
                  stats.attachments_stored++;
                }
              } catch (attachErr) {
                console.error(`[Cron:FetchEmails] Error storing attachment:`, attachErr);
              }
            }
          }
        }
      } catch (emailErr) {
        console.error(`[Cron:FetchEmails] Error processing email:`, emailErr);
        stats.errors++;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[Cron:FetchEmails] Completed in ${duration}ms:`, stats);

    return NextResponse.json({
      success: true,
      duration_ms: duration,
      stats,
    });
  } catch (error) {
    console.error('[Cron:FetchEmails] Fatal error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        stats,
      },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max
