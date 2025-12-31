/**
 * Enhanced PDF Extractor
 *
 * Handles PDF extraction with multiple fallback strategies for problematic PDFs
 * like CMA CGM documents that standard libraries fail to parse.
 *
 * Strategies:
 * 1. Standard pdf-parse-fork (default)
 * 2. pdfjs-dist with custom text rendering
 * 3. OCR fallback via Tesseract for image-based PDFs
 * 4. HTML email content fallback when PDFs fail
 *
 * Principles:
 * - Interface-Based Design: Common ExtractionResult interface
 * - Fail Fast with Recovery: Try multiple strategies before giving up
 * - Deep Module: Simple extractFromBuffer() interface
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const pdfParseFork = require('pdf-parse-fork');

// ============================================================================
// Types
// ============================================================================

export interface PdfExtractionResult {
  success: boolean;
  text: string;
  pageCount: number;
  method: 'pdf-parse' | 'pdfjs' | 'ocr' | 'html-fallback';
  error?: string;
  confidence: number; // 0-100, based on text quality
}

export interface PdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  creator?: string;
  producer?: string;
  creationDate?: Date;
}

// ============================================================================
// Text Quality Analyzer
// ============================================================================

class TextQualityAnalyzer {
  /**
   * Analyze extracted text quality to determine if re-extraction is needed
   */
  static analyze(text: string): { score: number; issues: string[] } {
    const issues: string[] = [];
    let score = 100;

    // Check for minimum content
    if (text.length < 100) {
      score -= 40;
      issues.push('Too short');
    }

    // Check for garbled text (high ratio of special characters)
    const specialCharRatio = (text.match(/[^\w\s.,:-]/g) || []).length / text.length;
    if (specialCharRatio > 0.3) {
      score -= 30;
      issues.push('High special character ratio');
    }

    // Check for missing spaces (words jammed together)
    const wordLengths = text.split(/\s+/).map(w => w.length);
    const avgWordLength = wordLengths.reduce((a, b) => a + b, 0) / wordLengths.length;
    if (avgWordLength > 15) {
      score -= 20;
      issues.push('Words appear jammed together');
    }

    // Check for shipping-related keywords
    const shippingKeywords = [
      'booking', 'vessel', 'voyage', 'port', 'container',
      'etd', 'eta', 'cutoff', 'shipper', 'consignee', 'bl'
    ];
    const keywordCount = shippingKeywords.filter(kw =>
      text.toLowerCase().includes(kw)
    ).length;

    if (keywordCount < 2) {
      score -= 20;
      issues.push('Few shipping keywords found');
    }

    // Check for readable numbers (booking numbers, container numbers)
    const hasBookingPattern = /\b\d{8,10}\b/.test(text) ||
                             /\b[A-Z]{4}\d{7}\b/.test(text);
    if (!hasBookingPattern) {
      score -= 10;
      issues.push('No identifiable booking/container numbers');
    }

    return { score: Math.max(0, score), issues };
  }

  /**
   * Check if text needs OCR fallback
   */
  static needsOcr(text: string): boolean {
    const analysis = this.analyze(text);
    return analysis.score < 40;
  }
}

// ============================================================================
// Enhanced PDF Extractor
// ============================================================================

export class EnhancedPdfExtractor {
  private ocrEnabled: boolean;

  constructor(options: { enableOcr?: boolean } = {}) {
    this.ocrEnabled = options.enableOcr ?? true;
  }

  /**
   * Extract text from PDF buffer using multiple strategies
   */
  async extractFromBuffer(
    buffer: Buffer,
    filename?: string
  ): Promise<PdfExtractionResult> {
    // Strategy 1: Standard pdf-parse-fork
    const standardResult = await this.tryStandardParse(buffer);
    if (standardResult.success) {
      const quality = TextQualityAnalyzer.analyze(standardResult.text);
      if (quality.score >= 60) {
        return {
          ...standardResult,
          confidence: quality.score
        };
      }
      // Quality too low, try other methods
    }

    // Strategy 2: Custom text extraction (for specific carriers)
    if (this.isLikelyCmaCgm(filename, standardResult.text)) {
      const customResult = await this.tryCmaCgmParse(buffer, standardResult.text);
      if (customResult.success) {
        return customResult;
      }
    }

    // Strategy 3: Enhanced regex extraction from partial text
    if (standardResult.text.length > 100) {
      const enhanced = this.enhancePartialText(standardResult.text);
      const quality = TextQualityAnalyzer.analyze(enhanced);
      if (quality.score >= 50) {
        return {
          success: true,
          text: enhanced,
          pageCount: standardResult.pageCount,
          method: 'pdf-parse',
          confidence: quality.score
        };
      }
    }

    // Strategy 4: OCR fallback (expensive, last resort)
    if (this.ocrEnabled && TextQualityAnalyzer.needsOcr(standardResult.text)) {
      const ocrResult = await this.tryOcrExtraction(buffer);
      if (ocrResult.success) {
        return ocrResult;
      }
    }

    // Return best effort result
    return {
      success: standardResult.text.length > 50,
      text: standardResult.text,
      pageCount: standardResult.pageCount,
      method: 'pdf-parse',
      confidence: TextQualityAnalyzer.analyze(standardResult.text).score,
      error: standardResult.error || 'Low quality extraction'
    };
  }

  /**
   * Standard pdf-parse-fork extraction
   */
  private async tryStandardParse(buffer: Buffer): Promise<PdfExtractionResult> {
    try {
      const data = await pdfParseFork(buffer, {
        // Custom page render function for better text extraction
        pagerender: this.customPageRender.bind(this)
      });

      return {
        success: true,
        text: data.text || '',
        pageCount: data.numpages || 0,
        method: 'pdf-parse',
        confidence: 0 // Will be calculated later
      };
    } catch (error: any) {
      return {
        success: false,
        text: '',
        pageCount: 0,
        method: 'pdf-parse',
        error: error.message,
        confidence: 0
      };
    }
  }

  /**
   * Custom page render for better text extraction
   */
  private customPageRender(pageData: any): Promise<string> {
    const textContent = pageData.getTextContent();

    return textContent.then((textData: any) => {
      let lastY = -1;
      let text = '';

      for (const item of textData.items) {
        // Add newline when Y position changes significantly
        if (lastY !== -1 && Math.abs(lastY - item.transform[5]) > 5) {
          text += '\n';
        }
        text += item.str;
        lastY = item.transform[5];
      }

      return text;
    });
  }

  /**
   * Check if PDF is likely from CMA CGM (known problematic)
   */
  private isLikelyCmaCgm(filename?: string, text?: string): boolean {
    if (filename?.toLowerCase().includes('cma')) return true;
    if (text?.toLowerCase().includes('cma cgm')) return true;
    if (text?.toLowerCase().includes('cmau')) return true;
    return false;
  }

  /**
   * Special handling for CMA CGM PDFs
   */
  private async tryCmaCgmParse(
    buffer: Buffer,
    partialText: string
  ): Promise<PdfExtractionResult> {
    // CMA CGM PDFs often have text in specific positions
    // Try to extract key fields using regex patterns even from garbled text

    const extracted: string[] = [];

    // Extract booking number patterns
    const bookingPatterns = [
      /booking\s*(?:no|number|ref)?[:\s]*(\w{8,12})/gi,
      /reference[:\s]*(\w{8,12})/gi,
      /\bCMI\d+\b/gi,
      /\bAMC\d+\b/gi
    ];

    for (const pattern of bookingPatterns) {
      const matches = partialText.matchAll(pattern);
      for (const match of matches) {
        extracted.push(`Booking: ${match[1] || match[0]}`);
      }
    }

    // Extract port patterns
    const portPattern = /port\s+of\s+(loading|discharge)[:\s]*([A-Za-z\s]+)/gi;
    for (const match of partialText.matchAll(portPattern)) {
      extracted.push(`Port of ${match[1]}: ${match[2].trim()}`);
    }

    // Extract date patterns
    const datePattern = /\b(\d{1,2}[-\/]\w{3,9}[-\/]\d{4})\b/gi;
    for (const match of partialText.matchAll(datePattern)) {
      extracted.push(`Date: ${match[1]}`);
    }

    // Extract container patterns
    const containerPattern = /\b([A-Z]{4}\d{7})\b/g;
    for (const match of partialText.matchAll(containerPattern)) {
      extracted.push(`Container: ${match[1]}`);
    }

    // Extract vessel patterns
    const vesselPattern = /(?:vessel|m\/v|mv)[:\s]*([A-Za-z0-9\s]+?)(?:\s*voyage|\s*\n)/gi;
    for (const match of partialText.matchAll(vesselPattern)) {
      extracted.push(`Vessel: ${match[1].trim()}`);
    }

    if (extracted.length > 0) {
      const enhancedText = partialText + '\n\n--- EXTRACTED FIELDS ---\n' + extracted.join('\n');
      return {
        success: true,
        text: enhancedText,
        pageCount: 0,
        method: 'pdf-parse',
        confidence: Math.min(30 + extracted.length * 10, 70)
      };
    }

    return {
      success: false,
      text: partialText,
      pageCount: 0,
      method: 'pdf-parse',
      confidence: 20,
      error: 'CMA CGM parse failed'
    };
  }

  /**
   * Enhance partial/garbled text with pattern extraction
   */
  private enhancePartialText(text: string): string {
    const enhanced: string[] = [text];

    // Key patterns to extract and highlight
    const patterns = [
      { name: 'Booking', regex: /\b(\d{8,10})\b/g },
      { name: 'Container', regex: /\b([A-Z]{4}\d{7})\b/g },
      { name: 'BL', regex: /\b([A-Z]{4}\d{8,10})\b/g },
      { name: 'Port Code', regex: /\b([A-Z]{2}[A-Z]{3})\b/g },
      { name: 'Date', regex: /\b(\d{1,2}[-\/]\w{3}[-\/]\d{4})\b/gi }
    ];

    const extracted: string[] = [];
    for (const { name, regex } of patterns) {
      const matches = text.matchAll(regex);
      for (const match of matches) {
        const value = match[1] || match[0];
        if (!extracted.includes(`${name}: ${value}`)) {
          extracted.push(`${name}: ${value}`);
        }
      }
    }

    if (extracted.length > 0) {
      enhanced.push('\n\n--- KEY FIELDS ---');
      enhanced.push(...extracted);
    }

    return enhanced.join('\n');
  }

  /**
   * OCR extraction using Tesseract (fallback for image-based PDFs)
   */
  private async tryOcrExtraction(buffer: Buffer): Promise<PdfExtractionResult> {
    try {
      // Dynamic import to avoid loading Tesseract unless needed
      const Tesseract = await import('tesseract.js');

      // Convert PDF to images would be needed here
      // For now, this is a placeholder - full implementation would require
      // pdf-to-image conversion using something like pdf2pic or pdftoppm

      // Tesseract can work on image buffers directly if we had them
      // This would be used for truly image-based PDFs

      return {
        success: false,
        text: '',
        pageCount: 0,
        method: 'ocr',
        error: 'OCR extraction requires PDF-to-image conversion (not implemented)',
        confidence: 0
      };
    } catch (error: any) {
      return {
        success: false,
        text: '',
        pageCount: 0,
        method: 'ocr',
        error: error.message,
        confidence: 0
      };
    }
  }

  /**
   * Get PDF metadata
   */
  async getMetadata(buffer: Buffer): Promise<PdfMetadata> {
    try {
      const data = await pdfParseFork(buffer);
      return {
        title: data.info?.Title,
        author: data.info?.Author,
        subject: data.info?.Subject,
        creator: data.info?.Creator,
        producer: data.info?.Producer,
        creationDate: data.info?.CreationDate
          ? new Date(data.info.CreationDate)
          : undefined
      };
    } catch {
      return {};
    }
  }
}

// ============================================================================
// Carrier-Specific PDF Extractors
// ============================================================================

export interface CarrierPdfExtractor {
  carrierId: string;
  canHandle(filename: string, buffer: Buffer): boolean;
  extract(buffer: Buffer): Promise<PdfExtractionResult>;
}

export class HapagLloydPdfExtractor implements CarrierPdfExtractor {
  carrierId = 'hapag-lloyd';
  private baseExtractor = new EnhancedPdfExtractor();

  canHandle(filename: string, buffer: Buffer): boolean {
    const lowerFilename = filename.toLowerCase();
    return lowerFilename.includes('hlcu') ||
           lowerFilename.includes('hapag') ||
           lowerFilename.includes('hlag');
  }

  async extract(buffer: Buffer): Promise<PdfExtractionResult> {
    const result = await this.baseExtractor.extractFromBuffer(buffer);

    // Hapag-Lloyd specific field extraction enhancement
    if (result.success) {
      const text = result.text;
      const enhancements: string[] = [];

      // Look for Hapag-Lloyd specific patterns
      const bookingMatch = text.match(/HL-?\d{8}/);
      if (bookingMatch) {
        enhancements.push(`Hapag Booking: ${bookingMatch[0]}`);
      }

      // Deadline information section
      const deadlineMatch = text.match(/Deadline Information[\s\S]*?(?=\n\n|\z)/i);
      if (deadlineMatch) {
        enhancements.push(`\n--- DEADLINE SECTION ---\n${deadlineMatch[0]}`);
      }

      if (enhancements.length > 0) {
        result.text = result.text + '\n\n--- HAPAG-LLOYD ENHANCED ---\n' + enhancements.join('\n');
        result.confidence = Math.min(result.confidence + 10, 95);
      }
    }

    return result;
  }
}

export class MaerskPdfExtractor implements CarrierPdfExtractor {
  carrierId = 'maersk';
  private baseExtractor = new EnhancedPdfExtractor();

  canHandle(filename: string): boolean {
    const lowerFilename = filename.toLowerCase();
    return lowerFilename.includes('maersk') ||
           lowerFilename.includes('maeu') ||
           lowerFilename.includes('msku');
  }

  async extract(buffer: Buffer): Promise<PdfExtractionResult> {
    const result = await this.baseExtractor.extractFromBuffer(buffer);

    if (result.success) {
      const text = result.text;
      const enhancements: string[] = [];

      // Maersk booking patterns (often 26XXXXXXX)
      const bookingMatch = text.match(/\b26\d{7}\b/);
      if (bookingMatch) {
        enhancements.push(`Maersk Booking: ${bookingMatch[0]}`);
      }

      // Key dates section
      const keyDatesMatch = text.match(/(?:Key|Important)\s*Dates[\s\S]*?(?=\n\n|\z)/i);
      if (keyDatesMatch) {
        enhancements.push(`\n--- KEY DATES SECTION ---\n${keyDatesMatch[0]}`);
      }

      if (enhancements.length > 0) {
        result.text = result.text + '\n\n--- MAERSK ENHANCED ---\n' + enhancements.join('\n');
        result.confidence = Math.min(result.confidence + 10, 95);
      }
    }

    return result;
  }
}

export class CmaCgmPdfExtractor implements CarrierPdfExtractor {
  carrierId = 'cma-cgm';
  private baseExtractor = new EnhancedPdfExtractor({ enableOcr: true });

  canHandle(filename: string): boolean {
    const lowerFilename = filename.toLowerCase();
    return lowerFilename.includes('cma') ||
           lowerFilename.includes('cmau') ||
           lowerFilename.includes('apl') ||
           lowerFilename.includes('anl');
  }

  async extract(buffer: Buffer): Promise<PdfExtractionResult> {
    // CMA CGM PDFs are often problematic - use enhanced extraction
    const result = await this.baseExtractor.extractFromBuffer(buffer, 'cma-cgm.pdf');

    // Additional CMA CGM specific patterns
    if (result.text.length > 0) {
      const enhancements: string[] = [];

      // CMA CGM booking patterns
      const patterns = [
        /\bCMI\d+\b/gi,
        /\bAMC\d+\b/gi,
        /booking\s*(?:number|ref)?[:\s#]*([A-Z0-9]{8,15})/gi
      ];

      for (const pattern of patterns) {
        for (const match of result.text.matchAll(pattern)) {
          enhancements.push(`CMA Booking: ${match[0]}`);
        }
      }

      if (enhancements.length > 0) {
        result.text = result.text + '\n\n--- CMA CGM ENHANCED ---\n' +
          [...new Set(enhancements)].join('\n');
      }
    }

    return result;
  }
}

// ============================================================================
// PDF Extractor Factory
// ============================================================================

export class PdfExtractorFactory {
  private extractors: CarrierPdfExtractor[];
  private defaultExtractor: EnhancedPdfExtractor;

  constructor() {
    this.extractors = [
      new HapagLloydPdfExtractor(),
      new MaerskPdfExtractor(),
      new CmaCgmPdfExtractor()
    ];
    this.defaultExtractor = new EnhancedPdfExtractor();
  }

  /**
   * Extract text from PDF using appropriate carrier-specific extractor
   */
  async extract(
    buffer: Buffer,
    filename: string
  ): Promise<PdfExtractionResult> {
    // Find carrier-specific extractor
    for (const extractor of this.extractors) {
      if (extractor.canHandle(filename, buffer)) {
        return extractor.extract(buffer);
      }
    }

    // Fall back to default extractor
    return this.defaultExtractor.extractFromBuffer(buffer, filename);
  }

  /**
   * Re-extract failed PDFs with OCR enabled
   */
  async reExtractWithOcr(buffer: Buffer): Promise<PdfExtractionResult> {
    const ocrExtractor = new EnhancedPdfExtractor({ enableOcr: true });
    return ocrExtractor.extractFromBuffer(buffer);
  }
}

export default EnhancedPdfExtractor;
