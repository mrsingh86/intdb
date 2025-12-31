/**
 * ATTACHMENT EXTRACTION SERVICE
 *
 * Unified service for extracting content from all attachment types.
 * Follows Single Responsibility Principle and Deep Modules pattern.
 *
 * Supports:
 * - PDFs (text extraction)
 * - Excel files (.xlsx → CSV)
 * - Word docs (.docx → text)
 * - Text files (.txt)
 * - Images (OCR)
 */

import { createRequire } from 'module';
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import Tesseract from 'tesseract.js';

const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse-fork');

export interface ExtractionResult {
  success: boolean;
  extractedText: string;
  error?: string;
}

export interface AttachmentExtractor {
  canHandle(mimeType: string): boolean;
  extract(buffer: Buffer): Promise<ExtractionResult>;
  getType(): string;
}

/**
 * PDF Text Extractor
 */
export class PdfExtractor implements AttachmentExtractor {
  canHandle(mimeType: string): boolean {
    return mimeType === 'application/pdf';
  }

  async extract(buffer: Buffer): Promise<ExtractionResult> {
    try {
      const pdfData = await pdfParse(buffer);
      const text = pdfData.text.trim();
      return {
        success: text.length > 0,
        extractedText: text,
        error: text.length === 0 ? 'PDF contains no extractable text' : undefined
      };
    } catch (error: any) {
      return {
        success: false,
        extractedText: '',
        error: error.message
      };
    }
  }

  getType(): string {
    return 'PDF';
  }
}

/**
 * Excel Extractor
 */
export class ExcelExtractor implements AttachmentExtractor {
  canHandle(mimeType: string): boolean {
    return mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  }

  async extract(buffer: Buffer): Promise<ExtractionResult> {
    try {
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const sheets: string[] = [];

      workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName];
        const csv = XLSX.utils.sheet_to_csv(worksheet);
        if (csv.trim().length > 0) {
          sheets.push(`=== Sheet: ${sheetName} ===\n${csv}`);
        }
      });

      const text = sheets.join('\n\n');
      return {
        success: text.length > 0,
        extractedText: text,
        error: text.length === 0 ? 'Excel file contains no data' : undefined
      };
    } catch (error: any) {
      return {
        success: false,
        extractedText: '',
        error: error.message
      };
    }
  }

  getType(): string {
    return 'Excel';
  }
}

/**
 * Word Document Extractor
 */
export class WordExtractor implements AttachmentExtractor {
  canHandle(mimeType: string): boolean {
    return mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }

  async extract(buffer: Buffer): Promise<ExtractionResult> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      const text = result.value.trim();
      return {
        success: text.length > 0,
        extractedText: text,
        error: text.length === 0 ? 'Word document contains no text' : undefined
      };
    } catch (error: any) {
      return {
        success: false,
        extractedText: '',
        error: error.message
      };
    }
  }

  getType(): string {
    return 'Word';
  }
}

/**
 * Text File Extractor
 */
export class TextExtractor implements AttachmentExtractor {
  canHandle(mimeType: string): boolean {
    return mimeType === 'text/plain';
  }

  async extract(buffer: Buffer): Promise<ExtractionResult> {
    try {
      const text = buffer.toString('utf-8').trim();
      return {
        success: text.length > 0,
        extractedText: text,
        error: text.length === 0 ? 'Text file is empty' : undefined
      };
    } catch (error: any) {
      return {
        success: false,
        extractedText: '',
        error: error.message
      };
    }
  }

  getType(): string {
    return 'Text';
  }
}

/**
 * Image OCR Extractor
 */
export class ImageExtractor implements AttachmentExtractor {
  canHandle(mimeType: string): boolean {
    return mimeType.startsWith('image/');
  }

  async extract(buffer: Buffer): Promise<ExtractionResult> {
    try {
      const result = await Tesseract.recognize(buffer, 'eng', {
        logger: () => {} // Suppress tesseract logs
      });
      const text = result.data.text.trim();
      return {
        success: text.length > 0,
        extractedText: text,
        error: text.length === 0 ? 'No text detected in image' : undefined
      };
    } catch (error: any) {
      return {
        success: false,
        extractedText: '',
        error: error.message
      };
    }
  }

  getType(): string {
    return 'Image (OCR)';
  }
}

/**
 * Unified Attachment Extraction Service
 *
 * Deep module with simple interface:
 * - extractFromBuffer(buffer, mimeType, filename)
 *
 * Internally handles all supported types via strategy pattern.
 */
export class AttachmentExtractionService {
  private extractors: AttachmentExtractor[];

  constructor() {
    this.extractors = [
      new PdfExtractor(),
      new ExcelExtractor(),
      new WordExtractor(),
      new TextExtractor(),
      new ImageExtractor()
    ];
  }

  /**
   * Extract text from attachment buffer
   *
   * @param buffer - File buffer
   * @param mimeType - MIME type of file
   * @param filename - Original filename
   * @returns Extraction result with success status and extracted text
   */
  async extractFromBuffer(
    buffer: Buffer,
    mimeType: string,
    filename: string
  ): Promise<ExtractionResult> {
    // Find appropriate extractor
    const extractor = this.extractors.find(e => e.canHandle(mimeType));

    if (!extractor) {
      return {
        success: false,
        extractedText: '',
        error: `Unsupported file type: ${mimeType}`
      };
    }

    // Extract content
    const result = await extractor.extract(buffer);

    return result;
  }

  /**
   * Check if a MIME type is supported
   */
  isSupported(mimeType: string): boolean {
    return this.extractors.some(e => e.canHandle(mimeType));
  }

  /**
   * Get list of supported MIME types
   */
  getSupportedTypes(): string[] {
    return [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'image/png',
      'image/jpeg',
      'image/gif'
    ];
  }

  /**
   * Format extracted content for email body
   */
  formatForEmail(filename: string, extractedText: string): string {
    return `=== ${filename} ===\n\n${extractedText}`;
  }
}

// Export singleton instance
export const attachmentExtractionService = new AttachmentExtractionService();
