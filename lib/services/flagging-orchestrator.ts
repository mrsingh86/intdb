/**
 * Flagging Orchestrator
 *
 * Coordinates parallel flagging of emails and attachments.
 * This is the first step in the production pipeline, before classification.
 *
 * PIPELINE ORDER:
 * 1. FLAGGING (this service) → Computes email flags + attachment flags
 * 2. CLASSIFICATION → Uses is_business_document to focus on relevant attachments
 * 3. EXTRACTION → Uses documentType from classification
 * 4. DOCUMENT REGISTRY → Uses classification + extraction for quality
 * 5. SHIPMENT LINKING → Uses extracted identifiers
 *
 * EMAIL FLAGS (computed in parallel):
 * - is_response: Is this a reply/forward?
 * - clean_subject: Subject without RE:/FW:
 * - email_direction: inbound/outbound
 * - true_sender_email: Actual sender (from forwarded headers)
 * - thread_position: Position in thread
 * - responds_to_email_id: Which email this responds to
 * - revision_type: update/amendment/original
 * - content_hash: For reference tracking
 *
 * ATTACHMENT FLAGS (computed in parallel):
 * - is_signature_image: Filter out email signatures
 * - is_business_document: PDFs, Excel, Word docs
 * - flagged_at: When flagging happened
 *
 * NOTE: Duplicate detection is handled by Document Registry (content_hash based),
 * not at the email/attachment flagging level.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  EmailFlaggingService,
  EmailFlags,
  createEmailFlaggingService,
} from './email-flagging-service';
import {
  AttachmentFlaggingService,
  AttachmentFlags,
  AttachmentData,
  createAttachmentFlaggingService,
} from './attachment-flagging-service';

// =============================================================================
// TYPES
// =============================================================================

export interface FlaggingInput {
  emailId: string;
}

export interface FlaggingOutput {
  emailId: string;
  success: boolean;
  emailFlags?: EmailFlags;
  attachmentFlags?: Array<{
    attachmentId: string;
    flags: AttachmentFlags;
  }>;
  businessAttachmentIds: string[];
  signatureImageIds: string[];
  error?: string;
}

export interface BatchFlaggingResult {
  processed: number;
  success: number;
  failed: number;
  businessAttachmentsFound: number;
  signatureImagesFiltered: number;
  results: FlaggingOutput[];
}

// =============================================================================
// SERVICE
// =============================================================================

export class FlaggingOrchestrator {
  private emailFlaggingService: EmailFlaggingService;
  private attachmentFlaggingService: AttachmentFlaggingService;

  constructor(private readonly supabase: SupabaseClient) {
    this.emailFlaggingService = createEmailFlaggingService(supabase);
    this.attachmentFlaggingService = createAttachmentFlaggingService(supabase);
  }

  /**
   * Flag a single email and all its attachments.
   * Runs email and attachment flagging in parallel.
   */
  async flagEmail(input: FlaggingInput): Promise<FlaggingOutput> {
    const { emailId } = input;

    try {
      // Fetch email and attachments in parallel
      const [emailResult, attachmentsResult] = await Promise.all([
        this.supabase
          .from('raw_emails')
          .select('id, gmail_message_id, thread_id, subject, sender_email, sender_name, body_text, headers, received_at, in_reply_to_message_id')
          .eq('id', emailId)
          .single(),
        this.supabase
          .from('raw_attachments')
          .select('id, email_id, filename, mime_type, size_bytes, storage_path')
          .eq('email_id', emailId),
      ]);

      if (emailResult.error || !emailResult.data) {
        return {
          emailId,
          success: false,
          businessAttachmentIds: [],
          signatureImageIds: [],
          error: `Email not found: ${emailResult.error?.message}`,
        };
      }

      const email = emailResult.data;
      const attachments = attachmentsResult.data || [];

      // Run flagging in parallel
      const [emailFlags, attachmentFlagsResults] = await Promise.all([
        this.emailFlaggingService.computeFlags(email),
        this.flagAttachments(attachments),
      ]);

      // Update email flags in database
      const { error: emailUpdateError } = await this.supabase
        .from('raw_emails')
        .update({
          is_response: emailFlags.is_response,
          clean_subject: emailFlags.clean_subject,
          email_direction: emailFlags.email_direction,
          true_sender_email: emailFlags.true_sender_email,
          has_attachments: emailFlags.has_attachments,
          attachment_count: emailFlags.attachment_count,
          thread_position: emailFlags.thread_position,
          responds_to_email_id: emailFlags.responds_to_email_id,
          response_time_hours: emailFlags.response_time_hours,
          revision_type: emailFlags.revision_type,
          content_hash: emailFlags.content_hash,
          updated_at: new Date().toISOString(),
        })
        .eq('id', emailId);

      if (emailUpdateError) {
        console.warn(`[FlaggingOrchestrator] Failed to update email flags: ${emailUpdateError.message}`);
      }

      // Categorize attachments
      const businessAttachmentIds: string[] = [];
      const signatureImageIds: string[] = [];

      for (const result of attachmentFlagsResults) {
        if (result.flags.is_business_document) {
          businessAttachmentIds.push(result.attachmentId);
        }
        if (result.flags.is_signature_image) {
          signatureImageIds.push(result.attachmentId);
        }
      }

      // Update business_attachment_count on email
      await this.supabase
        .from('raw_emails')
        .update({ business_attachment_count: businessAttachmentIds.length })
        .eq('id', emailId);

      return {
        emailId,
        success: true,
        emailFlags,
        attachmentFlags: attachmentFlagsResults,
        businessAttachmentIds,
        signatureImageIds,
      };
    } catch (error) {
      return {
        emailId,
        success: false,
        businessAttachmentIds: [],
        signatureImageIds: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Flag multiple attachments and update database.
   */
  private async flagAttachments(
    attachments: AttachmentData[]
  ): Promise<Array<{ attachmentId: string; flags: AttachmentFlags }>> {
    const results: Array<{ attachmentId: string; flags: AttachmentFlags }> = [];

    for (const attachment of attachments) {
      const flags = this.attachmentFlaggingService.classifyAttachment(attachment);

      // Update database
      await this.supabase
        .from('raw_attachments')
        .update({
          is_signature_image: flags.is_signature_image,
          is_business_document: flags.is_business_document,
          flagged_at: new Date().toISOString(),
        })
        .eq('id', attachment.id);

      results.push({ attachmentId: attachment.id, flags });
    }

    return results;
  }

  /**
   * Flag multiple emails in batch.
   */
  async flagBatch(
    emailIds: string[],
    onProgress?: (processed: number, total: number) => void
  ): Promise<BatchFlaggingResult> {
    const results: FlaggingOutput[] = [];
    let success = 0;
    let failed = 0;
    let businessAttachmentsFound = 0;
    let signatureImagesFiltered = 0;

    for (let i = 0; i < emailIds.length; i++) {
      const result = await this.flagEmail({ emailId: emailIds[i] });
      results.push(result);

      if (result.success) {
        success++;
        businessAttachmentsFound += result.businessAttachmentIds.length;
        signatureImagesFiltered += result.signatureImageIds.length;
      } else {
        failed++;
      }

      if (onProgress) {
        onProgress(i + 1, emailIds.length);
      }

      // Rate limiting every 50 emails
      if (i > 0 && i % 50 === 0) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    return {
      processed: emailIds.length,
      success,
      failed,
      businessAttachmentsFound,
      signatureImagesFiltered,
      results,
    };
  }

  /**
   * Flag emails that haven't been flagged yet.
   * Used for catch-up processing of accumulated data.
   */
  async flagUnflagged(limit: number = 100): Promise<BatchFlaggingResult> {
    // Find emails without flags set
    const { data: unflaggedEmails, error } = await this.supabase
      .from('raw_emails')
      .select('id')
      .is('clean_subject', null) // clean_subject is set by flagging
      .limit(limit);

    if (error || !unflaggedEmails) {
      return {
        processed: 0,
        success: 0,
        failed: 0,
        businessAttachmentsFound: 0,
        signatureImagesFiltered: 0,
        results: [],
      };
    }

    const emailIds = unflaggedEmails.map((e) => e.id);
    return this.flagBatch(emailIds);
  }

  /**
   * Get flagging statistics.
   */
  async getStatistics(): Promise<{
    totalEmails: number;
    flaggedEmails: number;
    unflaggedEmails: number;
    totalAttachments: number;
    businessDocuments: number;
    signatureImages: number;
    otherAttachments: number;
  }> {
    // Get counts in parallel
    const [
      totalEmailsResult,
      flaggedEmailsResult,
      totalAttResult,
      businessResult,
      signatureResult,
    ] = await Promise.all([
      this.supabase.from('raw_emails').select('*', { count: 'exact', head: true }),
      this.supabase.from('raw_emails').select('*', { count: 'exact', head: true }).not('clean_subject', 'is', null),
      this.supabase.from('raw_attachments').select('*', { count: 'exact', head: true }),
      this.supabase.from('raw_attachments').select('*', { count: 'exact', head: true }).eq('is_business_document', true),
      this.supabase.from('raw_attachments').select('*', { count: 'exact', head: true }).eq('is_signature_image', true),
    ]);

    const totalEmails = totalEmailsResult.count || 0;
    const flaggedEmails = flaggedEmailsResult.count || 0;
    const totalAttachments = totalAttResult.count || 0;
    const businessDocuments = businessResult.count || 0;
    const signatureImages = signatureResult.count || 0;

    return {
      totalEmails,
      flaggedEmails,
      unflaggedEmails: totalEmails - flaggedEmails,
      totalAttachments,
      businessDocuments,
      signatureImages,
      otherAttachments: totalAttachments - businessDocuments - signatureImages,
    };
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createFlaggingOrchestrator(supabase: SupabaseClient): FlaggingOrchestrator {
  return new FlaggingOrchestrator(supabase);
}
