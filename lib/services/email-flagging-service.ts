/**
 * Email Flagging Service
 *
 * Computes and updates all derived flags on raw_emails.
 * Single source of truth for email metadata computation.
 *
 * FLAGS COMPUTED:
 * - is_response: Is this a reply/forward? (from subject RE:/FW: pattern)
 * - clean_subject: Subject without RE:/FW: prefixes
 * - email_direction: inbound/outbound (from sender domain)
 * - true_sender_email: Actual sender (from forwarded headers)
 * - has_attachments: Does email have attachments?
 * - attachment_count: Number of attachments
 * - thread_position: Position in thread (1, 2, 3...)
 * - responds_to_email_id: Which email this is responding to
 * - response_time_hours: Time to respond
 * - is_duplicate: Is this a duplicate?
 * - revision_type: update/amendment/original
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

// =============================================================================
// TYPES
// =============================================================================

export interface EmailFlags {
  is_response: boolean;
  clean_subject: string;
  email_direction: 'inbound' | 'outbound';
  true_sender_email: string | null;
  has_attachments: boolean;
  attachment_count: number;
  thread_position: number | null;
  responds_to_email_id: string | null;
  response_time_hours: number | null;
  // NOTE: is_duplicate REMOVED - Document Registry handles duplicate detection
  // via content_hash as single source of truth. Email-level duplicate detection
  // was confusing because it used different logic than document-level.
  revision_type: string | null;
  content_hash: string;
}

export interface EmailData {
  id: string;
  gmail_message_id: string;
  thread_id: string | null;
  subject: string;
  sender_email: string;
  sender_name: string | null;
  body_text: string | null;
  headers: Record<string, string> | null;
  received_at: string;
  in_reply_to_message_id: string | null;
}

export interface FlaggingResult {
  emailId: string;
  success: boolean;
  flags?: EmailFlags;
  error?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

// Intoglo domains (outbound emails)
const INTOGLO_DOMAINS = [
  'intoglo.com',
  'intoglo.io',
];

// Known carrier domains (inbound from carriers)
const CARRIER_DOMAINS = [
  'maersk.com',
  'hapag-lloyd.com',
  'hlag.com',
  'cma-cgm.com',
  'msc.com',
  'evergreen-marine.com',
  'cosco.com',
  'one-line.com',
  'yangming.com',
  'hmm21.com',
  'zim.com',
  'pilship.com',
  'sealand.com',
];

// Reply/forward patterns
const REPLY_FORWARD_PATTERN = /^(RE|Re|FW|Fwd|FWD)\s*:\s*/i;
const MULTI_PREFIX_PATTERN = /^((RE|Re|FW|Fwd|FWD)\s*:\s*)+/i;

// Revision patterns in subject
const REVISION_PATTERNS = [
  { pattern: /\b(\d+)(?:ST|ND|RD|TH)\s+UPDATE\b/i, type: 'update' },
  { pattern: /\bAMEND(?:ED|MENT)?\b/i, type: 'amendment' },
  { pattern: /\bREVIS(?:ED|ION)?\b/i, type: 'revision' },
  { pattern: /\bCORRECT(?:ED|ION)?\b/i, type: 'correction' },
  { pattern: /\bUPDATE[D]?\b/i, type: 'update' },
  { pattern: /\bV\s*(\d+)\b/i, type: 'version' },
];

// =============================================================================
// SERVICE
// =============================================================================

export class EmailFlaggingService {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Compute all flags for a single email.
   *
   * NOTE: Duplicate detection removed - Document Registry handles this via content_hash
   * as single source of truth. This avoids confusion from having two different
   * duplicate detection mechanisms.
   */
  async computeFlags(email: EmailData): Promise<EmailFlags> {
    // 1. Response detection (from subject)
    const isResponse = this.detectIsResponse(email.subject);
    const cleanSubject = this.cleanSubject(email.subject);

    // 2. Direction detection
    const trueSenderEmail = this.extractTrueSender(email);
    const emailDirection = this.detectDirection(trueSenderEmail || email.sender_email);

    // 3. Attachment info
    const attachmentInfo = await this.getAttachmentInfo(email.id);

    // 4. Thread position
    const threadPosition = await this.computeThreadPosition(email);

    // 5. Response chain
    const responseInfo = await this.computeResponseInfo(email);

    // 6. Content hash (for reference, but NOT for duplicate detection at email level)
    const contentHash = this.computeContentHash(email);

    // 7. Revision type
    const revisionType = this.detectRevisionType(email.subject);

    return {
      is_response: isResponse,
      clean_subject: cleanSubject,
      email_direction: emailDirection,
      true_sender_email: trueSenderEmail,
      has_attachments: attachmentInfo.hasAttachments,
      attachment_count: attachmentInfo.count,
      thread_position: threadPosition,
      responds_to_email_id: responseInfo.respondsToEmailId,
      response_time_hours: responseInfo.responseTimeHours,
      revision_type: revisionType,
      content_hash: contentHash,
    };
  }

  /**
   * Update flags for a single email in database.
   */
  async updateEmailFlags(emailId: string): Promise<FlaggingResult> {
    try {
      // Get email data
      const { data: email, error: fetchError } = await this.supabase
        .from('raw_emails')
        .select('id, gmail_message_id, thread_id, subject, sender_email, sender_name, body_text, headers, received_at, in_reply_to_message_id')
        .eq('id', emailId)
        .single();

      if (fetchError || !email) {
        return { emailId, success: false, error: `Email not found: ${fetchError?.message}` };
      }

      // Compute flags
      const flags = await this.computeFlags(email);

      // Update database
      // NOTE: is_duplicate and duplicate_of_email_id removed - Document Registry handles this
      const { error: updateError } = await this.supabase
        .from('raw_emails')
        .update({
          is_response: flags.is_response,
          clean_subject: flags.clean_subject,
          email_direction: flags.email_direction,
          true_sender_email: flags.true_sender_email,
          has_attachments: flags.has_attachments,
          attachment_count: flags.attachment_count,
          thread_position: flags.thread_position,
          responds_to_email_id: flags.responds_to_email_id,
          response_time_hours: flags.response_time_hours,
          revision_type: flags.revision_type,
          content_hash: flags.content_hash,
          updated_at: new Date().toISOString(),
        })
        .eq('id', emailId);

      if (updateError) {
        return { emailId, success: false, error: `Update failed: ${updateError.message}` };
      }

      return { emailId, success: true, flags };
    } catch (error) {
      return {
        emailId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Update flags for multiple emails.
   */
  async updateBatch(
    emailIds: string[],
    onProgress?: (processed: number, total: number) => void
  ): Promise<{ success: number; failed: number; results: FlaggingResult[] }> {
    const results: FlaggingResult[] = [];
    let success = 0;
    let failed = 0;

    for (let i = 0; i < emailIds.length; i++) {
      const result = await this.updateEmailFlags(emailIds[i]);
      results.push(result);

      if (result.success) {
        success++;
      } else {
        failed++;
      }

      if (onProgress) {
        onProgress(i + 1, emailIds.length);
      }

      // Rate limiting
      if (i > 0 && i % 50 === 0) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    return { success, failed, results };
  }

  // ===========================================================================
  // DETECTION METHODS
  // ===========================================================================

  /**
   * Detect if email is a reply or forward based on subject.
   */
  private detectIsResponse(subject: string): boolean {
    return REPLY_FORWARD_PATTERN.test(subject.trim());
  }

  /**
   * Clean subject by removing RE:/FW: prefixes.
   */
  private cleanSubject(subject: string): string {
    return subject.trim().replace(MULTI_PREFIX_PATTERN, '').trim();
  }

  /**
   * Extract true sender from headers (for forwarded emails).
   */
  private extractTrueSender(email: EmailData): string | null {
    const headers = email.headers || {};

    // Check various headers for original sender
    const senderHeaders = [
      'X-Original-Sender',
      'X-Original-From',
      'Reply-To',
      'Return-Path',
    ];

    for (const header of senderHeaders) {
      const value = headers[header];
      if (value) {
        const emailMatch = value.match(/[\w.-]+@[\w.-]+\.\w+/);
        if (emailMatch) {
          const extracted = emailMatch[0].toLowerCase();
          // Only use if different from sender_email
          if (extracted !== email.sender_email.toLowerCase()) {
            return extracted;
          }
        }
      }
    }

    // Check body for forwarded email patterns
    if (email.body_text) {
      const forwardedFromMatch = email.body_text.match(
        /(?:From|De|Von|送信者):\s*([^\n<]+<)?([\w.-]+@[\w.-]+\.\w+)/i
      );
      if (forwardedFromMatch) {
        const extracted = forwardedFromMatch[2].toLowerCase();
        if (extracted !== email.sender_email.toLowerCase()) {
          return extracted;
        }
      }
    }

    return null;
  }

  /**
   * Detect email direction (inbound/outbound).
   */
  private detectDirection(senderEmail: string): 'inbound' | 'outbound' {
    const domain = senderEmail.split('@')[1]?.toLowerCase() || '';

    // Outbound = from Intoglo
    if (INTOGLO_DOMAINS.some(d => domain.includes(d))) {
      return 'outbound';
    }

    // Inbound = everything else (including carriers, forwarders, etc.)
    return 'inbound';
  }

  /**
   * Detect revision type from subject.
   */
  private detectRevisionType(subject: string): string | null {
    for (const { pattern, type } of REVISION_PATTERNS) {
      if (pattern.test(subject)) {
        return type;
      }
    }
    return null;
  }

  /**
   * Compute content hash for duplicate detection.
   */
  private computeContentHash(email: EmailData): string {
    // Hash based on: clean subject + sender + first 500 chars of body
    const content = [
      this.cleanSubject(email.subject),
      email.sender_email.toLowerCase(),
      (email.body_text || '').substring(0, 500),
    ].join('|');

    return createHash('sha256').update(content).digest('hex').substring(0, 32);
  }

  // ===========================================================================
  // DATABASE LOOKUP METHODS
  // ===========================================================================

  /**
   * Get attachment info for email.
   */
  private async getAttachmentInfo(emailId: string): Promise<{ hasAttachments: boolean; count: number }> {
    const { count, error } = await this.supabase
      .from('raw_attachments')
      .select('*', { count: 'exact', head: true })
      .eq('email_id', emailId);

    if (error) {
      return { hasAttachments: false, count: 0 };
    }

    return {
      hasAttachments: (count || 0) > 0,
      count: count || 0,
    };
  }

  /**
   * Compute thread position (1 = first email in thread).
   */
  private async computeThreadPosition(email: EmailData): Promise<number | null> {
    if (!email.thread_id) return null;

    const { data, error } = await this.supabase
      .from('raw_emails')
      .select('id, received_at')
      .eq('thread_id', email.thread_id)
      .order('received_at', { ascending: true });

    if (error || !data) return null;

    const position = data.findIndex(e => e.id === email.id);
    return position >= 0 ? position + 1 : null;
  }

  /**
   * Compute response chain info.
   */
  private async computeResponseInfo(email: EmailData): Promise<{
    respondsToEmailId: string | null;
    responseTimeHours: number | null;
  }> {
    // If we have in_reply_to_message_id, look up that email
    if (email.in_reply_to_message_id) {
      const { data: replyToEmail } = await this.supabase
        .from('raw_emails')
        .select('id, received_at')
        .eq('gmail_message_id', email.in_reply_to_message_id)
        .single();

      if (replyToEmail) {
        const responseTime = this.calculateResponseTime(
          replyToEmail.received_at,
          email.received_at
        );
        return {
          respondsToEmailId: replyToEmail.id,
          responseTimeHours: responseTime,
        };
      }
    }

    // Otherwise, if this is a response in a thread, find previous email
    if (email.thread_id && this.detectIsResponse(email.subject)) {
      const { data: threadEmails } = await this.supabase
        .from('raw_emails')
        .select('id, received_at')
        .eq('thread_id', email.thread_id)
        .lt('received_at', email.received_at)
        .order('received_at', { ascending: false })
        .limit(1);

      if (threadEmails && threadEmails.length > 0) {
        const previousEmail = threadEmails[0];
        const responseTime = this.calculateResponseTime(
          previousEmail.received_at,
          email.received_at
        );
        return {
          respondsToEmailId: previousEmail.id,
          responseTimeHours: responseTime,
        };
      }
    }

    return { respondsToEmailId: null, responseTimeHours: null };
  }

  // NOTE: checkDuplicate() REMOVED
  // Document Registry now handles duplicate detection via content_hash.
  // This provides single source of truth for duplicates at the document level,
  // not email level (an email can contain multiple unique documents).

  /**
   * Calculate response time in hours.
   */
  private calculateResponseTime(fromTime: string, toTime: string): number {
    const from = new Date(fromTime).getTime();
    const to = new Date(toTime).getTime();
    const hours = (to - from) / (1000 * 60 * 60);
    return Math.round(hours * 10) / 10; // Round to 1 decimal
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createEmailFlaggingService(supabase: SupabaseClient): EmailFlaggingService {
  return new EmailFlaggingService(supabase);
}
