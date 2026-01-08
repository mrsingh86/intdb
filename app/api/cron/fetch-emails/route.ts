/**
 * Cron Job: Fetch Emails from Gmail
 *
 * Uses Gmail historyId for efficient incremental sync.
 * Falls back to time-based sync on first run or historyId expiration.
 *
 * Schedule: Every 5 minutes (via Vercel cron)
 *
 * Sync Modes:
 * - Default: historyId incremental sync (efficient, only new emails)
 * - ?mode=time: Force time-based sync (fallback)
 * - ?days=N: Initial backfill for N days
 *
 * Principles:
 * - Idempotent (duplicate check by gmail_message_id)
 * - Fail Gracefully (continue on individual failures)
 * - Weekly full sync as safety net
 */

import { NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { google, gmail_v1 } from 'googleapis';

// Configuration
const MAX_EMAILS_PER_RUN = 50;
const INITIAL_SYNC_DAYS = 7;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

interface SyncStats {
  sync_mode: 'history' | 'time' | 'initial' | 'weekly_full';
  emails_fetched: number;
  emails_stored: number;
  duplicates_skipped: number;
  attachments_stored: number;
  errors: number;
  first_error: string | null;
  history_id_before: string | null;
  history_id_after: string | null;
}

interface GmailSyncState {
  id: string;
  account_email: string;
  last_history_id: number | null;
  last_sync_at: string | null;
  last_full_sync_at: string | null;
  sync_status: string;
  consecutive_failures: number;
  emails_synced_total: number;
}

export async function GET(request: Request) {
  const startTime = Date.now();
  const stats: SyncStats = {
    sync_mode: 'history',
    emails_fetched: 0,
    emails_stored: 0,
    duplicates_skipped: 0,
    attachments_stored: 0,
    errors: 0,
    first_error: null,
    history_id_before: null,
    history_id_after: null,
  };

  const url = new URL(request.url);
  const forceTimeMode = url.searchParams.get('mode') === 'time';
  const backfillDays = parseInt(url.searchParams.get('days') || '0');
  const emailLimit = Math.min(
    parseInt(url.searchParams.get('limit') || String(MAX_EMAILS_PER_RUN)),
    500
  );
  const customQuery = url.searchParams.get('q');

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
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // Get sync state
    const { data: syncState } = await supabase
      .from('gmail_sync_state')
      .select('*')
      .eq('account_email', 'me')
      .single();

    stats.history_id_before = syncState?.last_history_id?.toString() || null;

    // Determine sync strategy
    let messageIds: string[] = [];
    let newHistoryId: string | null = null;

    // Force time-based sync if requested
    if (forceTimeMode || backfillDays > 0) {
      stats.sync_mode = backfillDays > 0 ? 'initial' : 'time';
      const result = await doTimeBasedSync(
        gmail,
        backfillDays > 0 ? backfillDays * 24 * 60 : 15,
        emailLimit,
        customQuery
      );
      messageIds = result.messageIds;
      newHistoryId = result.historyId;
    }
    // Initial sync (no historyId yet)
    else if (!syncState?.last_history_id) {
      stats.sync_mode = 'initial';
      console.log('[Cron:FetchEmails] No historyId found, doing initial sync');
      const result = await doTimeBasedSync(
        gmail,
        INITIAL_SYNC_DAYS * 24 * 60,
        emailLimit,
        customQuery
      );
      messageIds = result.messageIds;
      newHistoryId = result.historyId;
    }
    // Weekly full sync (safety net)
    else if (needsWeeklyFullSync(syncState)) {
      stats.sync_mode = 'weekly_full';
      console.log('[Cron:FetchEmails] Weekly full sync triggered');
      const result = await doTimeBasedSync(
        gmail,
        INITIAL_SYNC_DAYS * 24 * 60,
        emailLimit,
        customQuery
      );
      messageIds = result.messageIds;
      newHistoryId = result.historyId;
    }
    // Incremental historyId sync (normal case)
    else {
      stats.sync_mode = 'history';
      try {
        const result = await doHistorySync(
          gmail,
          syncState.last_history_id.toString(),
          emailLimit
        );
        messageIds = result.messageIds;
        newHistoryId = result.historyId;
      } catch (error: any) {
        // Handle historyId expiration (404 or specific error)
        if (error.code === 404 || error.message?.includes('historyId') || error.message?.includes('Start history id')) {
          console.log('[Cron:FetchEmails] historyId expired, falling back to time-based sync');
          stats.sync_mode = 'initial';
          const result = await doTimeBasedSync(
            gmail,
            INITIAL_SYNC_DAYS * 24 * 60,
            emailLimit,
            customQuery
          );
          messageIds = result.messageIds;
          newHistoryId = result.historyId;
        } else {
          throw error;
        }
      }
    }

    stats.emails_fetched = messageIds.length;
    stats.history_id_after = newHistoryId;

    if (messageIds.length === 0) {
      // Update sync state even with no new emails
      await updateSyncState(supabase, newHistoryId, stats.sync_mode === 'weekly_full' || stats.sync_mode === 'initial', 0);

      console.log(`[Cron:FetchEmails] No new emails (mode: ${stats.sync_mode})`);
      return NextResponse.json({
        success: true,
        message: 'No new emails to fetch',
        duration_ms: Date.now() - startTime,
        stats,
      });
    }

    console.log(`[Cron:FetchEmails] Found ${messageIds.length} emails to process (mode: ${stats.sync_mode})`);

    // Process each email
    for (const messageId of messageIds) {
      try {
        const result = await processEmail(gmail, supabase, messageId, stats);
        if (result === 'stored') stats.emails_stored++;
        else if (result === 'duplicate') stats.duplicates_skipped++;
      } catch (emailErr) {
        console.error(`[Cron:FetchEmails] Error processing email ${messageId}:`, emailErr);
        stats.errors++;
        if (!stats.first_error) {
          stats.first_error = emailErr instanceof Error ? emailErr.message : 'Unknown error';
        }
      }
    }

    // Update sync state
    await updateSyncState(
      supabase,
      newHistoryId,
      stats.sync_mode === 'weekly_full' || stats.sync_mode === 'initial',
      stats.emails_stored
    );

    const duration = Date.now() - startTime;
    console.log(`[Cron:FetchEmails] Completed in ${duration}ms:`, stats);

    return NextResponse.json({
      success: true,
      duration_ms: duration,
      stats,
    });
  } catch (error) {
    console.error('[Cron:FetchEmails] Fatal error:', error);

    // Update failure count
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey);
        await supabase
          .from('gmail_sync_state')
          .update({
            sync_status: 'error',
            sync_error_message: error instanceof Error ? error.message : 'Unknown error',
            consecutive_failures: (await supabase.from('gmail_sync_state').select('consecutive_failures').eq('account_email', 'me').single()).data?.consecutive_failures + 1 || 1,
            updated_at: new Date().toISOString(),
          })
          .eq('account_email', 'me');
      }
    } catch {}

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

// ============================================================================
// Sync Strategies
// ============================================================================

async function doHistorySync(
  gmail: gmail_v1.Gmail,
  startHistoryId: string,
  limit: number
): Promise<{ messageIds: string[]; historyId: string | null }> {
  console.log(`[Cron:FetchEmails] History sync from historyId: ${startHistoryId}`);

  const historyResponse = await gmail.users.history.list({
    userId: 'me',
    startHistoryId: startHistoryId,
    historyTypes: ['messageAdded'],
    maxResults: limit,
  });

  const history = historyResponse.data.history || [];
  const newHistoryId = historyResponse.data.historyId || null;

  // Extract unique message IDs from messagesAdded events
  const messageIds = new Set<string>();
  for (const item of history) {
    if (item.messagesAdded) {
      for (const added of item.messagesAdded) {
        if (added.message?.id) {
          messageIds.add(added.message.id);
        }
      }
    }
  }

  console.log(`[Cron:FetchEmails] History sync found ${messageIds.size} new messages`);
  return { messageIds: Array.from(messageIds), historyId: newHistoryId };
}

async function doTimeBasedSync(
  gmail: gmail_v1.Gmail,
  lookbackMinutes: number,
  limit: number,
  customQuery?: string | null
): Promise<{ messageIds: string[]; historyId: string | null }> {
  const afterDate = new Date(Date.now() - lookbackMinutes * 60 * 1000);
  const afterTimestamp = Math.floor(afterDate.getTime() / 1000);

  let gmailQuery = `after:${afterTimestamp}`;
  if (customQuery) {
    gmailQuery += ` ${customQuery}`;
  }

  console.log(`[Cron:FetchEmails] Time-based sync: ${gmailQuery}`);

  const listResponse = await gmail.users.messages.list({
    userId: 'me',
    maxResults: limit,
    q: gmailQuery,
  });

  const messages = listResponse.data.messages || [];
  const messageIds = messages.map(m => m.id!).filter(Boolean);

  // Get current historyId from profile for future incremental syncs
  const profileResponse = await gmail.users.getProfile({ userId: 'me' });
  const historyId = profileResponse.data.historyId || null;

  return { messageIds, historyId };
}

function needsWeeklyFullSync(syncState: GmailSyncState): boolean {
  if (!syncState.last_full_sync_at) return true;
  const lastFullSync = new Date(syncState.last_full_sync_at).getTime();
  return Date.now() - lastFullSync > ONE_WEEK_MS;
}

// ============================================================================
// Email Processing (unchanged core logic)
// ============================================================================

async function processEmail(
  gmail: gmail_v1.Gmail,
  supabase: SupabaseClient,
  messageId: string,
  stats: SyncStats
): Promise<'stored' | 'duplicate' | 'error'> {
  // Check if already exists (idempotency)
  const { data: existing } = await supabase
    .from('raw_emails')
    .select('id')
    .eq('gmail_message_id', messageId)
    .single();

  if (existing) {
    return 'duplicate';
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

  // Detect RE:/FW: responses
  const subject = getHeader('Subject');
  const isResponse = /^(RE|Re|FW|Fw|Fwd|FWD):\s*/i.test(subject);
  const inReplyTo = getHeader('In-Reply-To');
  const cleanSubject = subject.replace(/^(RE|Re|FW|Fw|Fwd|FWD):\s*/gi, '').trim();

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

  // Find all attachments
  const findAttachments = (part: any): any[] => {
    const attachments: any[] = [];
    if (part.filename && part.filename.length > 0) {
      if (part.body?.attachmentId || part.body?.data || part.body?.size > 0) {
        attachments.push(part);
      }
    }
    if (part.parts) {
      for (const subPart of part.parts) {
        attachments.push(...findAttachments(subPart));
      }
    }
    return attachments;
  };

  const allAttachments = emailData.payload ? findAttachments(emailData.payload) : [];
  const hasAttachments = allAttachments.length > 0;

  // Store email
  const { data: newEmail, error: insertError } = await supabase
    .from('raw_emails')
    .insert({
      gmail_message_id: messageId,
      thread_id: emailData.threadId,
      subject: subject,
      sender_email: getHeader('From'),
      body_text: bodyText || emailData.snippet || '',
      body_html: bodyHtml,
      snippet: emailData.snippet || '',
      received_at: new Date(parseInt(emailData.internalDate || '0')).toISOString(),
      has_attachments: hasAttachments,
      processing_status: 'pending',
      is_response: isResponse || !!inReplyTo,
      in_reply_to_message_id: inReplyTo || null,
      clean_subject: cleanSubject,
    })
    .select()
    .single();

  if (insertError) {
    console.error(`[Cron:FetchEmails] Error storing email ${messageId}:`, insertError);
    stats.errors++;
    if (!stats.first_error) {
      stats.first_error = insertError.message || JSON.stringify(insertError);
    }
    return 'error';
  }

  // Store attachments
  for (const part of allAttachments) {
    try {
      const gmailAttachmentId = part.body?.attachmentId;
      if (!gmailAttachmentId) continue;

      const storagePath = `gmail://${gmailAttachmentId}`.substring(0, 200);
      const shortAttachmentId = `${newEmail.id.substring(0, 8)}-${stats.attachments_stored + 1}`;

      await supabase.from('raw_attachments').insert({
        email_id: newEmail.id,
        filename: part.filename,
        mime_type: part.mimeType || 'application/octet-stream',
        size_bytes: part.body?.size || 0,
        storage_path: storagePath,
        attachment_id: shortAttachmentId,
        extraction_status: 'pending',
      });
      stats.attachments_stored++;
    } catch (attachErr) {
      console.error(`[Cron:FetchEmails] Error storing attachment ${part.filename}:`, attachErr);
    }
  }

  return 'stored';
}

// ============================================================================
// Sync State Management
// ============================================================================

async function updateSyncState(
  supabase: SupabaseClient,
  historyId: string | null,
  isFullSync: boolean,
  emailsStored: number
): Promise<void> {
  const now = new Date().toISOString();
  const update: any = {
    sync_status: 'active',
    sync_error_message: null,
    consecutive_failures: 0,
    last_sync_at: now,
    updated_at: now,
  };

  if (historyId) {
    update.last_history_id = parseInt(historyId);
  }

  if (isFullSync) {
    update.last_full_sync_at = now;
  }

  // Increment total emails synced
  const { data: current } = await supabase
    .from('gmail_sync_state')
    .select('emails_synced_total')
    .eq('account_email', 'me')
    .single();

  update.emails_synced_total = (current?.emails_synced_total || 0) + emailsStored;

  await supabase
    .from('gmail_sync_state')
    .update(update)
    .eq('account_email', 'me');
}

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max
