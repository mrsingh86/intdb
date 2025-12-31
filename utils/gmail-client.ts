/**
 * Gmail client wrapper with rate limiting and retry logic
 */

import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import pLimit from 'p-limit';
import Logger from './logger';
import { GmailCredentials, EmailData, AttachmentData, GmailMessage } from '../types/gmail.types';

export class GmailClient {
  private gmail: gmail_v1.Gmail;
  private oauth2Client: OAuth2Client;
  private logger: Logger;
  private rateLimiter: ReturnType<typeof pLimit>;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(credentials: GmailCredentials) {
    this.logger = new Logger('GmailClient');

    // Initialize OAuth2 client
    this.oauth2Client = new google.auth.OAuth2(
      credentials.client_id,
      credentials.client_secret,
      credentials.redirect_uri
    );

    this.oauth2Client.setCredentials({
      refresh_token: credentials.refresh_token
    });

    // Initialize Gmail API
    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });

    // Rate limiting (Gmail API quota: 250 quota units per user per second)
    const quotaPerSecond = parseInt(process.env.GMAIL_QUOTA_PER_SECOND || '10');
    this.rateLimiter = pLimit(quotaPerSecond);

    // Retry configuration
    this.maxRetries = parseInt(process.env.RETRY_MAX_ATTEMPTS || '3');
    this.retryDelayMs = parseInt(process.env.RETRY_INITIAL_DELAY_MS || '1000');
  }

  /**
   * List messages matching the query
   */
  public async listMessages(
    query: string,
    maxResults: number = 50,
    pageToken?: string
  ): Promise<{ messages: string[]; nextPageToken?: string }> {
    return this.rateLimiter(async () => {
      return this.withRetry(async () => {
        const response = await this.gmail.users.messages.list({
          userId: 'me',
          q: query,
          maxResults,
          pageToken,
          includeSpamTrash: false
        });

        const messages = response.data.messages?.map(m => m.id!) || [];

        this.logger.info(`Listed ${messages.length} messages`, {
          query,
          maxResults,
          hasMore: !!response.data.nextPageToken
        });

        return {
          messages,
          nextPageToken: response.data.nextPageToken || undefined
        };
      });
    });
  }

  /**
   * Get full message details including attachments
   */
  public async getMessage(messageId: string): Promise<EmailData> {
    return this.rateLimiter(async () => {
      return this.withRetry(async () => {
        const response = await this.gmail.users.messages.get({
          userId: 'me',
          id: messageId,
          format: 'full'
        });

        return this.parseMessage(response.data);
      });
    });
  }

  /**
   * Get attachment data
   */
  public async getAttachment(
    messageId: string,
    attachmentId: string
  ): Promise<Buffer> {
    return this.rateLimiter(async () => {
      return this.withRetry(async () => {
        const response = await this.gmail.users.messages.attachments.get({
          userId: 'me',
          messageId,
          id: attachmentId
        });

        if (!response.data.data) {
          throw new Error(`No data found for attachment ${attachmentId}`);
        }

        // Decode base64url to Buffer
        const data = response.data.data.replace(/-/g, '+').replace(/_/g, '/');
        return Buffer.from(data, 'base64');
      });
    });
  }

  /**
   * Parse Gmail message into EmailData
   */
  private parseMessage(message: GmailMessage): EmailData {
    const headers = this.parseHeaders(message.payload?.headers || []);
    const { bodyText, bodyHtml } = this.parseBody(message.payload);
    const attachments = this.parseAttachments(message.payload);

    // Extract sender information
    const fromHeader = headers['from'] || '';
    const senderMatch = fromHeader.match(/^(.+?)\s*<(.+?)>$/);
    const senderEmail = senderMatch ? senderMatch[2] : fromHeader;
    const senderName = senderMatch ? senderMatch[1].replace(/"/g, '') : undefined;

    // Extract true sender (for forwarded emails)
    const trueSenderEmail = headers['x-original-sender'] ||
                           headers['x-forwarded-from'] ||
                           undefined;

    // Extract recipients
    const recipientEmails: string[] = [];
    if (headers['to']) {
      recipientEmails.push(...this.extractEmails(headers['to']));
    }
    if (headers['cc']) {
      recipientEmails.push(...this.extractEmails(headers['cc']));
    }

    // Parse received date
    const receivedAt = message.internalDate
      ? new Date(parseInt(message.internalDate))
      : new Date();

    return {
      gmailMessageId: message.id!,
      threadId: message.threadId || undefined,
      senderEmail,
      senderName,
      trueSenderEmail,
      recipientEmails,
      subject: headers['subject'] || '(no subject)',
      bodyText,
      bodyHtml,
      snippet: message.snippet || undefined,
      headers,
      hasAttachments: attachments.length > 0,
      attachmentCount: attachments.length,
      labels: message.labelIds || [],
      receivedAt,
      attachments
    };
  }

  /**
   * Parse message headers into key-value pairs
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
   * Extract body text and HTML from message payload
   */
  private parseBody(
    payload?: gmail_v1.Schema$MessagePart
  ): { bodyText?: string; bodyHtml?: string } {
    if (!payload) return {};

    let bodyText: string | undefined;
    let bodyHtml: string | undefined;

    const extractFromParts = (part: gmail_v1.Schema$MessagePart) => {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        bodyText = this.decodeBase64(part.body.data);
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        bodyHtml = this.decodeBase64(part.body.data);
      }

      if (part.parts) {
        for (const subPart of part.parts) {
          extractFromParts(subPart);
        }
      }
    };

    extractFromParts(payload);

    return { bodyText, bodyHtml };
  }

  /**
   * Parse attachments from message payload
   */
  private parseAttachments(
    payload?: gmail_v1.Schema$MessagePart
  ): AttachmentData[] {
    if (!payload) return [];

    const attachments: AttachmentData[] = [];

    const extractAttachments = (part: gmail_v1.Schema$MessagePart) => {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType || 'application/octet-stream',
          sizeBytes: part.body.size || 0,
          attachmentId: part.body.attachmentId
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
   * Extract email addresses from header value
   */
  private extractEmails(headerValue: string): string[] {
    const emails: string[] = [];
    const emailRegex = /[\w.-]+@[\w.-]+\.\w+/g;
    const matches = headerValue.match(emailRegex);

    if (matches) {
      emails.push(...matches);
    }

    return emails;
  }

  /**
   * Decode base64url encoded string
   */
  private decodeBase64(data: string): string {
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(normalized, 'base64').toString('utf-8');
  }

  /**
   * Retry logic for API calls
   */
  private async withRetry<T>(
    operation: () => Promise<T>,
    attempt: number = 1
  ): Promise<T> {
    try {
      return await operation();
    } catch (error: any) {
      const isRetryable = this.isRetryableError(error);

      if (attempt >= this.maxRetries || !isRetryable) {
        this.logger.error(`Operation failed after ${attempt} attempts`, error);
        throw error;
      }

      const delay = this.retryDelayMs * Math.pow(2, attempt - 1);
      this.logger.warn(`Retrying operation (attempt ${attempt + 1}/${this.maxRetries})`, {
        error: error.message,
        delay
      });

      await this.sleep(delay);
      return this.withRetry(operation, attempt + 1);
    }
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: any): boolean {
    if (!error.code) return false;

    // Retryable HTTP status codes
    const retryableCodes = [429, 500, 502, 503, 504];

    if (error.response?.status && retryableCodes.includes(error.response.status)) {
      return true;
    }

    // Retryable error codes
    const retryableErrorCodes = ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND'];

    return retryableErrorCodes.includes(error.code);
  }

  /**
   * Sleep helper
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Test Gmail connection
   */
  public async testConnection(): Promise<boolean> {
    try {
      await this.gmail.users.getProfile({ userId: 'me' });
      this.logger.info('Gmail connection successful');
      return true;
    } catch (error) {
      this.logger.error('Gmail connection failed', error);
      return false;
    }
  }
}

export default GmailClient;