/**
 * Attachment Flagging Service
 *
 * Classifies attachments as signature images vs business documents.
 * Computes content hash for duplicate detection.
 *
 * SIGNATURE IMAGES (to filter out):
 * - Inline images: image001.png, image002.jpg, noname
 * - Social icons: link-32-linkedin.png, link-32-facebook.png
 * - Company logos: logo-CMA.png, intoglo*.png
 * - Outlook artifacts: ATT00001.png, Outlook-*.png
 *
 * BUSINESS DOCUMENTS (to keep):
 * - PDFs: application/pdf
 * - Excel: .xlsx, .xls
 * - Word: .docx, .doc
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';

// =============================================================================
// TYPES
// =============================================================================

export interface AttachmentData {
  id: string;
  email_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
}

export interface AttachmentFlags {
  is_signature_image: boolean;
  is_business_document: boolean;
  content_hash: string | null;
}

export interface FlaggingResult {
  attachmentId: string;
  success: boolean;
  flags?: AttachmentFlags;
  error?: string;
}

// =============================================================================
// CONSTANTS - Signature Image Detection
// =============================================================================

// Generic inline image patterns (Outlook/Gmail auto-generated)
const INLINE_IMAGE_PATTERNS = [
  /^image\d{3}\.(png|jpg|jpeg|gif)$/i,     // image001.png, image002.jpg
  /^ATT\d+\.(png|jpg|jpeg|gif)$/i,          // ATT00001.png
  /^noname$/i,                               // noname (common)
  /^Outlook-\w+\.(png|jpg|jpeg|gif)$/i,     // Outlook-xyz123.png
  /^inline\d*\.(png|jpg|jpeg|gif)$/i,       // inline1.png
  /^cid:/i,                                  // Content-ID reference
];

// Social media icons
const SOCIAL_ICON_PATTERNS = [
  /^link-\d+-\w+\.(png|jpg|jpeg|gif)$/i,    // link-32-linkedin.png
  /linkedin/i,
  /facebook/i,
  /instagram/i,
  /twitter/i,
  /youtube/i,
  /^x-icon/i,
];

// Logo patterns
const LOGO_PATTERNS = [
  /^logo[-_]/i,                              // logo-CMA.png, logo_company.png
  /[-_]logo\.(png|jpg|jpeg|gif)$/i,         // company-logo.png
  /transparent[-_]?background/i,             // intoglo transparent background.png
  /^dialog-illu/i,                           // dialog-illu.png
  /^banner/i,                                // banner.png
  /signature/i,                              // signature.png, email-signature.png
];

// Size thresholds (in bytes)
const MAX_SIGNATURE_IMAGE_SIZE = 500_000;    // 500KB - signatures rarely larger
const MIN_BUSINESS_DOC_SIZE = 1_000;         // 1KB minimum for real documents

// Business document MIME types
const BUSINESS_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',  // xlsx
  'application/vnd.ms-excel',                                            // xls
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'application/msword',                                                  // doc
  'text/csv',
  'application/vnd.ms-excel.sheet.macroEnabled.12',                     // xlsm
]);

// Image MIME types (potential signature images)
const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/bmp',
]);

// =============================================================================
// SERVICE
// =============================================================================

export class AttachmentFlaggingService {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Classify a single attachment.
   */
  classifyAttachment(attachment: AttachmentData): AttachmentFlags {
    const { filename, mime_type, size_bytes } = attachment;

    // Check if it's a business document first (takes priority)
    if (this.isBusinessDocument(mime_type, filename)) {
      return {
        is_signature_image: false,
        is_business_document: true,
        content_hash: null, // Will be computed separately if needed
      };
    }

    // Check if it's a signature image
    if (this.isSignatureImage(filename, mime_type, size_bytes)) {
      return {
        is_signature_image: true,
        is_business_document: false,
        content_hash: null,
      };
    }

    // Unknown/other - not business, not signature
    return {
      is_signature_image: false,
      is_business_document: false,
      content_hash: null,
    };
  }

  /**
   * Check if attachment is a business document.
   */
  private isBusinessDocument(mimeType: string, filename: string): boolean {
    // Check MIME type
    if (BUSINESS_MIME_TYPES.has(mimeType.toLowerCase())) {
      return true;
    }

    // Check file extension as fallback
    const ext = filename.split('.').pop()?.toLowerCase();
    const businessExtensions = ['pdf', 'xlsx', 'xls', 'docx', 'doc', 'csv'];
    if (ext && businessExtensions.includes(ext)) {
      return true;
    }

    return false;
  }

  /**
   * Check if attachment is a signature/inline image.
   */
  private isSignatureImage(
    filename: string,
    mimeType: string,
    sizeBytes: number
  ): boolean {
    // Must be an image type
    if (!IMAGE_MIME_TYPES.has(mimeType.toLowerCase())) {
      return false;
    }

    // Large images are likely not signatures
    if (sizeBytes > MAX_SIGNATURE_IMAGE_SIZE) {
      return false;
    }

    // Check filename patterns
    const lowerFilename = filename.toLowerCase();

    // Inline image patterns (strongest signal)
    for (const pattern of INLINE_IMAGE_PATTERNS) {
      if (pattern.test(filename)) {
        return true;
      }
    }

    // Social icons
    for (const pattern of SOCIAL_ICON_PATTERNS) {
      if (pattern.test(lowerFilename)) {
        return true;
      }
    }

    // Logo patterns
    for (const pattern of LOGO_PATTERNS) {
      if (pattern.test(lowerFilename)) {
        return true;
      }
    }

    // Small generic images are likely signatures
    if (sizeBytes < 100_000 && /\.(png|jpg|jpeg|gif)$/i.test(filename)) {
      // Additional heuristic: very generic filenames
      if (/^(image|img|pic|photo|icon)\d*\./i.test(filename)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Update flags for a single attachment in database.
   */
  async updateAttachmentFlags(attachmentId: string): Promise<FlaggingResult> {
    try {
      // Get attachment data
      const { data: attachment, error: fetchError } = await this.supabase
        .from('raw_attachments')
        .select('id, email_id, filename, mime_type, size_bytes, storage_path')
        .eq('id', attachmentId)
        .single();

      if (fetchError || !attachment) {
        return {
          attachmentId,
          success: false,
          error: `Attachment not found: ${fetchError?.message}`,
        };
      }

      // Classify attachment
      const flags = this.classifyAttachment(attachment);

      // Update database
      const { error: updateError } = await this.supabase
        .from('raw_attachments')
        .update({
          is_signature_image: flags.is_signature_image,
          is_business_document: flags.is_business_document,
          flagged_at: new Date().toISOString(),
        })
        .eq('id', attachmentId);

      if (updateError) {
        return {
          attachmentId,
          success: false,
          error: `Update failed: ${updateError.message}`,
        };
      }

      return { attachmentId, success: true, flags };
    } catch (error) {
      return {
        attachmentId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Update flags for multiple attachments.
   */
  async updateBatch(
    attachments: AttachmentData[],
    onProgress?: (processed: number, total: number) => void
  ): Promise<{ success: number; failed: number }> {
    let success = 0;
    let failed = 0;

    // Process in batches of 100 for bulk update
    const BATCH_SIZE = 100;
    for (let i = 0; i < attachments.length; i += BATCH_SIZE) {
      const batch = attachments.slice(i, i + BATCH_SIZE);

      // Classify all in batch
      const updates = batch.map((att) => ({
        id: att.id,
        ...this.classifyAttachment(att),
        flagged_at: new Date().toISOString(),
      }));

      // Bulk update (use individual updates for now as upsert requires PK)
      for (const update of updates) {
        const { error } = await this.supabase
          .from('raw_attachments')
          .update({
            is_signature_image: update.is_signature_image,
            is_business_document: update.is_business_document,
            flagged_at: update.flagged_at,
          })
          .eq('id', update.id);

        if (error) {
          failed++;
        } else {
          success++;
        }
      }

      if (onProgress) {
        onProgress(Math.min(i + BATCH_SIZE, attachments.length), attachments.length);
      }

      // Rate limiting
      await new Promise((r) => setTimeout(r, 50));
    }

    return { success, failed };
  }

  /**
   * Update business_attachment_count on raw_emails.
   */
  async updateEmailBusinessCount(emailId: string): Promise<number> {
    const { count, error } = await this.supabase
      .from('raw_attachments')
      .select('*', { count: 'exact', head: true })
      .eq('email_id', emailId)
      .eq('is_business_document', true);

    if (error) {
      throw new Error(`Failed to count business docs: ${error.message}`);
    }

    const businessCount = count || 0;

    await this.supabase
      .from('raw_emails')
      .update({ business_attachment_count: businessCount })
      .eq('id', emailId);

    return businessCount;
  }

  /**
   * Bulk update business_attachment_count for all emails.
   */
  async updateAllEmailBusinessCounts(): Promise<{ updated: number }> {
    // Use SQL for efficiency
    const { error } = await this.supabase.rpc('update_email_business_counts');

    if (error) {
      // Fallback: manual update if RPC doesn't exist
      const { data: emails } = await this.supabase
        .from('raw_emails')
        .select('id');

      if (!emails) return { updated: 0 };

      let updated = 0;
      for (const email of emails) {
        await this.updateEmailBusinessCount(email.id);
        updated++;
      }
      return { updated };
    }

    return { updated: -1 }; // RPC handles it
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createAttachmentFlaggingService(
  supabase: SupabaseClient
): AttachmentFlaggingService {
  return new AttachmentFlaggingService(supabase);
}
