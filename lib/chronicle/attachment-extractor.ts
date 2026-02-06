/**
 * Attachment Extractor
 *
 * Extracts text from PDF attachments in emails.
 * Extracted from ChronicleService (P2-15 God class decomposition).
 *
 * Responsibilities:
 * - Iterate email attachments and extract PDF text
 * - Truncate text to AI token limits
 * - Log extraction stages (success/failure/skip)
 *
 * Following CLAUDE.md principles:
 * - Single Responsibility (Principle #3) - only attachment extraction
 * - Small Functions < 20 lines (Principle #17)
 */

import {
  ProcessedEmail,
  ProcessedAttachment,
} from './types';
import { IGmailService, IPdfExtractor } from './interfaces';
import { ChronicleLogger } from './chronicle-logger';
import { AI_CONFIG } from './prompts/freight-forwarder.prompt';

export interface AttachmentExtractionResult {
  attachmentText: string;
  attachmentsWithText: ProcessedAttachment[];
}

export class AttachmentExtractor {
  constructor(
    private gmailService: IGmailService,
    private pdfExtractor: IPdfExtractor,
    private logger: ChronicleLogger | null = null,
  ) {}

  setLogger(logger: ChronicleLogger): void {
    this.logger = logger;
  }

  /**
   * Extract text from all PDF attachments in an email.
   * Non-PDF attachments are skipped.
   */
  async extractAttachments(email: ProcessedEmail): Promise<AttachmentExtractionResult> {
    let attachmentText = '';
    const attachmentsWithText: ProcessedAttachment[] = [];

    for (const attachment of email.attachments) {
      const result = await this.extractSingleAttachment(email.gmailMessageId, attachment);
      if (result) {
        attachmentText += result.text;
        attachmentsWithText.push(result.attachment);
      }
    }

    return { attachmentText, attachmentsWithText };
  }

  private async extractSingleAttachment(
    messageId: string,
    attachment: ProcessedAttachment
  ): Promise<{ text: string; attachment: ProcessedAttachment } | null> {
    if (attachment.mimeType !== 'application/pdf' || !attachment.attachmentId) {
      return null;
    }

    const pdfStart = this.logger?.logStageStart('pdf_extract') || 0;

    try {
      const content = await this.gmailService.fetchAttachmentContent(messageId, attachment.attachmentId);
      if (!content) {
        this.logger?.logStageSkip('pdf_extract', 'No content');
        return null;
      }

      const text = await this.pdfExtractor.extractText(content, attachment.filename);
      if (!text) {
        this.logger?.logStageSkip('pdf_extract', 'No text extracted');
        return null;
      }

      const truncatedText = text.substring(0, AI_CONFIG.maxAttachmentChars);
      const formattedText = `\n=== ${attachment.filename} ===\n${truncatedText}\n`;

      // Detect if OCR was used (heuristic: very short text from a PDF)
      const usedOcr = text.length > 0 && truncatedText.length < 500;
      this.logger?.logStageSuccess('pdf_extract', pdfStart, usedOcr ? { ocr_count: 1 } : { text_extract: 1 });

      return {
        text: formattedText,
        attachment: { ...attachment, extractedText: truncatedText },
      };
    } catch (error) {
      this.logger?.logStageFailure('pdf_extract', pdfStart, error as Error, {
        gmailMessageId: messageId,
        attachmentName: attachment.filename,
      }, true);
      console.error(`[AttachmentExtractor] PDF error ${attachment.filename}:`, error);
      return null;
    }
  }
}

export function createAttachmentExtractor(
  gmailService: IGmailService,
  pdfExtractor: IPdfExtractor,
  logger?: ChronicleLogger
): AttachmentExtractor {
  return new AttachmentExtractor(gmailService, pdfExtractor, logger || null);
}
