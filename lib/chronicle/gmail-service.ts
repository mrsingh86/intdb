/**
 * Chronicle Gmail Service
 *
 * Fetches emails from Gmail API by timestamp.
 * Standalone implementation - uses OAuth credentials.
 */

import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import {
  ProcessedEmail,
  ProcessedAttachment,
  ChronicleSyncState,
  SyncResult,
  SyncMode,
  detectDirection,
} from './types';

// ============================================================================
// TYPES
// ============================================================================

interface GmailOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken: string;
}

interface FetchOptions {
  after?: Date;
  before?: Date;
  maxResults?: number;
  query?: string;
}

// ============================================================================
// SERVICE
// ============================================================================

export class ChronicleGmailService {
  private gmail: gmail_v1.Gmail;
  private oauth2Client: OAuth2Client;

  constructor(config: GmailOAuthConfig) {
    // Initialize OAuth2 client
    this.oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUri
    );

    this.oauth2Client.setCredentials({
      refresh_token: config.refreshToken
    });

    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
  }

  /**
   * Fetch emails by timestamp range
   */
  async fetchEmailsByTimestamp(options: FetchOptions): Promise<ProcessedEmail[]> {
    const { after, before, maxResults = 100, query: additionalQuery } = options;

    // Build Gmail query
    const queryParts: string[] = [];

    if (after) {
      const afterTimestamp = Math.floor(after.getTime() / 1000);
      queryParts.push(`after:${afterTimestamp}`);
    }

    if (before) {
      const beforeTimestamp = Math.floor(before.getTime() / 1000);
      queryParts.push(`before:${beforeTimestamp}`);
    }

    if (additionalQuery) {
      queryParts.push(additionalQuery);
    }

    const query = queryParts.join(' ');
    console.log(`[ChronicleGmail] Fetching with query: ${query}`);

    // List message IDs
    const messageIds = await this.listMessageIds(query, maxResults);
    console.log(`[ChronicleGmail] Found ${messageIds.length} messages`);

    // Fetch full messages with PARALLEL processing for speed
    const emails: ProcessedEmail[] = [];
    const total = messageIds.length;
    let processed = 0;
    let oldestDate: Date | null = null;
    let newestDate: Date | null = null;
    const CONCURRENCY = 10; // Fetch 10 emails in parallel

    // Process in batches for parallelization
    for (let i = 0; i < messageIds.length; i += CONCURRENCY) {
      const batch = messageIds.slice(i, i + CONCURRENCY);

      const results = await Promise.allSettled(
        batch.map(messageId => this.fetchFullMessage(messageId))
      );

      for (const result of results) {
        processed++;
        if (result.status === 'fulfilled' && result.value) {
          emails.push(result.value);
          // Track date range
          const emailDate = result.value.receivedAt;
          if (!oldestDate || emailDate < oldestDate) oldestDate = emailDate;
          if (!newestDate || emailDate > newestDate) newestDate = emailDate;
        }
      }

      // Progress logging with date range
      if (processed % 50 === 0 || processed === total) {
        const dateRange = oldestDate && newestDate
          ? `[${oldestDate.toLocaleDateString()} - ${newestDate.toLocaleDateString()}]`
          : '';
        console.log(`[ChronicleGmail] Fetched ${processed}/${total} emails (${Math.round(processed/total*100)}%) ${dateRange}`);
      }
    }

    // IMPORTANT: Process OLDEST emails first for correct shipment journey building
    // Gmail returns newest first, so we reverse to get oldest first
    console.log(`[ChronicleGmail] Reversing order to process oldest emails first`);
    return emails.reverse();
  }

  /**
   * Fetch emails by specific message IDs
   * Used for reprocessing specific emails
   */
  async fetchEmailsByMessageIds(messageIds: string[]): Promise<ProcessedEmail[]> {
    console.log(`[ChronicleGmail] Fetching ${messageIds.length} emails by message ID`);

    const emails: ProcessedEmail[] = [];
    const total = messageIds.length;
    let processed = 0;
    const CONCURRENCY = 10;

    for (let i = 0; i < messageIds.length; i += CONCURRENCY) {
      const batch = messageIds.slice(i, i + CONCURRENCY);

      const results = await Promise.allSettled(
        batch.map(messageId => this.fetchFullMessage(messageId))
      );

      for (const result of results) {
        processed++;
        if (result.status === 'fulfilled' && result.value) {
          emails.push(result.value);
        }
      }

      if (processed % 50 === 0 || processed === total) {
        console.log(`[ChronicleGmail] Fetched ${processed}/${total} emails (${Math.round(processed/total*100)}%)`);
      }
    }

    console.log(`[ChronicleGmail] Successfully fetched ${emails.length}/${messageIds.length} emails`);
    return emails;
  }

  /**
   * Hybrid fetch: Use historyId for efficiency, fall back to timestamp
   *
   * Strategy:
   * - Primary: historyId incremental sync (only new emails)
   * - Fallback: timestamp-based on historyId expiration (404) or first run
   * - Safety: Weekly full sync as safety net
   */
  async fetchEmailsHybrid(options: {
    syncState: ChronicleSyncState | null;
    maxResults?: number;
    lookbackHours?: number;
  }): Promise<SyncResult> {
    const { syncState, maxResults = 200, lookbackHours = 6 } = options;
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

    // Determine sync mode
    let syncMode: SyncMode = 'timestamp';

    // Case 1: No sync state yet - initial sync
    if (!syncState || !syncState.lastHistoryId) {
      console.log('[ChronicleGmail] No historyId found, doing initial timestamp sync');
      syncMode = 'initial';
      return this.doTimestampSync(lookbackHours * 60, maxResults, syncMode);
    }

    // Case 2: Weekly full sync needed
    const lastFullSync = syncState.lastFullSyncAt
      ? new Date(syncState.lastFullSyncAt).getTime()
      : 0;
    if (Date.now() - lastFullSync > ONE_WEEK_MS) {
      console.log('[ChronicleGmail] Weekly full sync triggered');
      syncMode = 'weekly_full';
      return this.doTimestampSync(lookbackHours * 60, maxResults, syncMode);
    }

    // Case 3: Normal incremental sync using historyId
    try {
      console.log(`[ChronicleGmail] Attempting historyId sync from ${syncState.lastHistoryId}`);
      return await this.doHistorySync(syncState.lastHistoryId, maxResults);
    } catch (error: any) {
      // Handle historyId expiration (404 or specific error)
      if (error.code === 404 ||
          error.message?.includes('historyId') ||
          error.message?.includes('Start history id')) {
        console.log('[ChronicleGmail] historyId expired, falling back to timestamp sync');
        return this.doTimestampSync(lookbackHours * 60, maxResults, 'timestamp');
      }
      throw error;
    }
  }

  /**
   * Incremental sync using Gmail historyId
   * Only returns emails added since the last historyId
   */
  private async doHistorySync(
    startHistoryId: string,
    maxResults: number
  ): Promise<SyncResult> {
    console.log(`[ChronicleGmail] History sync from historyId: ${startHistoryId}`);

    const historyResponse = await this.gmail.users.history.list({
      userId: 'me',
      startHistoryId: startHistoryId,
      historyTypes: ['messageAdded'],
      maxResults: maxResults,
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

    console.log(`[ChronicleGmail] History sync found ${messageIds.size} new messages`);

    return {
      messageIds: Array.from(messageIds),
      historyId: newHistoryId,
      syncMode: 'history',
    };
  }

  /**
   * Timestamp-based sync as fallback
   */
  private async doTimestampSync(
    lookbackMinutes: number,
    maxResults: number,
    syncMode: SyncMode
  ): Promise<SyncResult> {
    const afterDate = new Date(Date.now() - lookbackMinutes * 60 * 1000);
    const messageIds = await this.listMessageIds(
      `after:${Math.floor(afterDate.getTime() / 1000)}`,
      maxResults
    );

    // Get current historyId for future incremental syncs
    const historyId = await this.getCurrentHistoryId();

    console.log(`[ChronicleGmail] Timestamp sync found ${messageIds.length} messages`);

    return {
      messageIds,
      historyId,
      syncMode,
    };
  }

  /**
   * Get current historyId from Gmail profile
   */
  async getCurrentHistoryId(): Promise<string | null> {
    try {
      const profile = await this.gmail.users.getProfile({ userId: 'me' });
      return profile.data.historyId || null;
    } catch (error) {
      console.error('[ChronicleGmail] Failed to get historyId:', error);
      return null;
    }
  }

  /**
   * List message IDs matching query
   */
  private async listMessageIds(query: string, maxResults: number): Promise<string[]> {
    const messageIds: string[] = [];
    let pageToken: string | undefined;
    let pageCount = 0;

    console.log(`[ChronicleGmail] Listing message IDs (max: ${maxResults})...`);

    while (messageIds.length < maxResults) {
      const response = await this.gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: Math.min(500, maxResults - messageIds.length), // Use 500 per page for speed
        pageToken,
      });

      const messages = response.data.messages || [];
      for (const msg of messages) {
        if (msg.id) {
          messageIds.push(msg.id);
        }
      }

      pageCount++;
      pageToken = response.data.nextPageToken || undefined;

      // Log progress every 5 pages or when done
      if (pageCount % 5 === 0 || !pageToken || messageIds.length >= maxResults) {
        console.log(`[ChronicleGmail] Listed ${messageIds.length} message IDs (page ${pageCount})${pageToken ? '...' : ' - DONE'}`);
      }

      if (!pageToken) break;
    }

    return messageIds;
  }

  /**
   * Fetch full message with body and attachments
   */
  private async fetchFullMessage(messageId: string): Promise<ProcessedEmail | null> {
    const response = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full',
    });

    const message = response.data;
    if (!message.payload) return null;

    // Parse headers
    const headers = this.parseHeaders(message.payload.headers || []);

    // Parse sender
    const fromHeader = headers['from'] || '';
    const senderMatch = fromHeader.match(/^(.+?)\s*<(.+?)>$/) || fromHeader.match(/<(.+?)>/);
    const senderEmail = senderMatch
      ? senderMatch[senderMatch.length - 1]
      : fromHeader.replace(/[<>]/g, '');
    const senderName = senderMatch && senderMatch.length > 2
      ? senderMatch[1].replace(/"/g, '').trim()
      : undefined;

    // True sender for forwarded emails
    const trueSenderEmail = headers['x-original-sender'] || undefined;
    const effectiveSender = trueSenderEmail || senderEmail;

    // Parse recipients
    const recipientEmails = this.extractEmails(headers['to'] || '');
    if (headers['cc']) {
      recipientEmails.push(...this.extractEmails(headers['cc']));
    }

    // Parse body
    const { bodyText, bodyHtml } = this.parseBody(message.payload);

    // Parse attachments (metadata only, not content yet)
    const attachments = this.parseAttachmentMetadata(message.payload);

    // Determine direction
    const direction = detectDirection(senderEmail, trueSenderEmail);

    // Parse received date
    const receivedAt = message.internalDate
      ? new Date(parseInt(message.internalDate))
      : new Date();

    return {
      gmailMessageId: message.id!,
      threadId: message.threadId!,
      subject: headers['subject'] || '(no subject)',
      snippet: message.snippet || '',
      bodyText: bodyText || '',
      bodyHtml,
      senderEmail,
      senderName,
      recipientEmails,
      direction,
      receivedAt,
      attachments,
    };
  }

  /**
   * Fetch attachment content and extract text
   */
  async fetchAttachmentContent(
    messageId: string,
    attachmentId: string
  ): Promise<Buffer | null> {
    try {
      const response = await this.gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: attachmentId,
      });

      if (!response.data.data) return null;

      // Decode base64url
      const data = response.data.data.replace(/-/g, '+').replace(/_/g, '/');
      return Buffer.from(data, 'base64');
    } catch (error) {
      console.error(`[ChronicleGmail] Error fetching attachment:`, error);
      return null;
    }
  }

  /**
   * Parse headers into key-value map
   */
  private parseHeaders(
    headers: gmail_v1.Schema$MessagePartHeader[]
  ): Record<string, string> {
    const result: Record<string, string> = {};
    for (const header of headers) {
      if (header.name && header.value) {
        result[header.name.toLowerCase()] = header.value;
      }
    }
    return result;
  }

  /**
   * Parse body text and HTML
   */
  private parseBody(
    payload: gmail_v1.Schema$MessagePart
  ): { bodyText?: string; bodyHtml?: string } {
    let bodyText: string | undefined;
    let bodyHtml: string | undefined;

    const extractFromPart = (part: gmail_v1.Schema$MessagePart) => {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        bodyText = this.decodeBase64(part.body.data);
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        bodyHtml = this.decodeBase64(part.body.data);
      }

      if (part.parts) {
        for (const subPart of part.parts) {
          extractFromPart(subPart);
        }
      }
    };

    extractFromPart(payload);
    return { bodyText, bodyHtml };
  }

  /**
   * Parse attachment metadata (without fetching content)
   */
  private parseAttachmentMetadata(
    payload: gmail_v1.Schema$MessagePart
  ): Array<ProcessedAttachment & { attachmentId?: string }> {
    const attachments: Array<ProcessedAttachment & { attachmentId?: string }> = [];

    const extractAttachments = (part: gmail_v1.Schema$MessagePart) => {
      // Skip inline images and signatures
      if (part.filename && part.body?.attachmentId) {
        const filename = part.filename.toLowerCase();

        // Filter out signature images
        if (this.isSignatureImage(filename, part.mimeType || '')) {
          return;
        }

        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          size: part.body.size || 0,
          attachmentId: part.body.attachmentId,
        });
      }

      if (part.parts) {
        for (const subPart of part.parts) {
          extractAttachments(subPart);
        }
      }
    };

    extractAttachments(payload);
    return attachments;
  }

  /**
   * Check if attachment is likely a signature image
   */
  private isSignatureImage(filename: string, mimeType: string): boolean {
    const signaturePatterns = [
      /^image\d+\.(png|jpg|jpeg|gif)$/i,
      /^logo/i,
      /^signature/i,
      /^banner/i,
      /^footer/i,
    ];

    // Small images in email are often signatures
    if (mimeType.startsWith('image/')) {
      for (const pattern of signaturePatterns) {
        if (pattern.test(filename)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Extract email addresses from header value
   */
  private extractEmails(headerValue: string): string[] {
    const emailRegex = /[\w.-]+@[\w.-]+\.\w+/g;
    return headerValue.match(emailRegex) || [];
  }

  /**
   * Decode base64url string
   */
  private decodeBase64(data: string): string {
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64').toString('utf-8');
  }

  /**
   * Test connection
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.gmail.users.getProfile({ userId: 'me' });
      console.log('[ChronicleGmail] Connection successful');
      return true;
    } catch (error) {
      console.error('[ChronicleGmail] Connection failed:', error);
      return false;
    }
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createChronicleGmailService(): ChronicleGmailService {
  const config: GmailOAuthConfig = {
    clientId: process.env.GMAIL_CLIENT_ID || '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
    redirectUri: process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/oauth2callback',
    refreshToken: process.env.GMAIL_REFRESH_TOKEN || '',
  };

  if (!config.clientId || !config.clientSecret || !config.refreshToken) {
    throw new Error('Missing Gmail OAuth credentials: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN');
  }

  return new ChronicleGmailService(config);
}
