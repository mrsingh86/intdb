/**
 * Gmail API type definitions
 */

import { gmail_v1 } from 'googleapis';

export type GmailMessage = gmail_v1.Schema$Message;
export type GmailMessagePart = gmail_v1.Schema$MessagePart;
export type GmailAttachment = gmail_v1.Schema$MessagePartBody;
export type GmailHeader = gmail_v1.Schema$MessagePartHeader;

export interface GmailCredentials {
  client_id: string;
  client_secret: string;
  redirect_uri: string;
  refresh_token: string;
}

export interface EmailData {
  gmailMessageId: string;
  threadId?: string;
  senderEmail: string;
  senderName?: string;
  trueSenderEmail?: string;
  recipientEmails: string[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  snippet?: string;
  headers: Record<string, string>;
  hasAttachments: boolean;
  attachmentCount: number;
  labels: string[];
  receivedAt: Date;
  attachments?: AttachmentData[];
}

export interface AttachmentData {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  attachmentId: string;
  data?: Buffer;
}

export interface GmailQueryOptions {
  query: string;
  maxResults?: number;
  pageToken?: string;
  includeSpamTrash?: boolean;
  labelIds?: string[];
}

export interface ProcessingResult {
  success: boolean;
  emailId?: string;
  error?: string;
  retryable?: boolean;
}