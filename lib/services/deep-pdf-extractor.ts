/**
 * Deep PDF Extractor
 *
 * Multi-strategy PDF extraction with:
 * 1. Standard text extraction (pdf-parse-fork)
 * 2. Table extraction (pdf-table-extractor)
 * 3. OCR for scanned/image PDFs (Tesseract.js)
 * 4. Carrier-specific enhancements
 *
 * Principles:
 * - Deep Module: Simple interface, complex internals
 * - Strategy Pattern: Multiple extraction methods
 * - Fail Fast with Recovery: Try all methods before giving up
 */

import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createWorker, Worker } from 'tesseract.js';

const require = createRequire(import.meta.url);
const pdfParseFork = require('pdf-parse-fork');

// ============================================================================
// Types
// ============================================================================

export interface DeepExtractionResult {
  success: boolean;
  text: string;
  tables: ExtractedTable[];
  pageCount: number;
  method: 'pdf-parse' | 'ocr' | 'table' | 'combined';
  ocrUsed: boolean;
  confidence: number;
  error?: string;
  metadata: {
    hasImages: boolean;
    tableCount: number;
    textLength: number;
    extractionTimeMs: number;
  };
}

export interface ExtractedTable {
  pageNumber: number;
  rows: string[][];
  headers?: string[];
  rawText: string;
}

interface ExtractionOptions {
  enableOcr?: boolean;
  enableTables?: boolean;
  ocrLanguage?: string;
  maxPages?: number;
}

// ============================================================================
// Text Quality Analyzer
// ============================================================================

class TextQualityAnalyzer {
  static analyze(text: string): { score: number; issues: string[]; needsOcr: boolean } {
    const issues: string[] = [];
    let score = 100;

    if (!text || text.length < 50) {
      return { score: 0, issues: ['No text extracted'], needsOcr: true };
    }

    // Check for minimum content
    if (text.length < 200) {
      score -= 30;
      issues.push('Very short text');
    }

    // Check for garbled text (high ratio of special characters)
    const alphanumericRatio = (text.match(/[a-zA-Z0-9]/g) || []).length / text.length;
    if (alphanumericRatio < 0.5) {
      score -= 40;
      issues.push('Low alphanumeric ratio - possibly garbled');
    }

    // Check for shipping-related keywords
    const shippingKeywords = [
      'booking', 'vessel', 'voyage', 'port', 'container',
      'etd', 'eta', 'cutoff', 'shipper', 'consignee', 'bl',
      'invoice', 'cargo', 'freight', 'delivery'
    ];
    const keywordCount = shippingKeywords.filter(kw =>
      text.toLowerCase().includes(kw)
    ).length;

    if (keywordCount < 2) {
      score -= 20;
      issues.push('Few shipping keywords found');
    }

    // Check for identifiable patterns
    const hasBooking = /\b\d{8,12}\b/.test(text) || /\b[A-Z]{4}\d{7}\b/.test(text);
    const hasDate = /\d{1,2}[-/]\w{3}[-/]\d{2,4}|\d{4}-\d{2}-\d{2}/.test(text);

    if (!hasBooking && !hasDate) {
      score -= 15;
      issues.push('No identifiable booking numbers or dates');
    }

    const needsOcr = score < 40;
    return { score: Math.max(0, score), issues, needsOcr };
  }
}

// ============================================================================
// Deep PDF Extractor
// ============================================================================

export class DeepPdfExtractor {
  private tesseractWorker: Worker | null = null;
  private options: ExtractionOptions;

  constructor(options: ExtractionOptions = {}) {
    this.options = {
      enableOcr: options.enableOcr ?? true,
      enableTables: options.enableTables ?? true,
      ocrLanguage: options.ocrLanguage ?? 'eng',
      maxPages: options.maxPages ?? 10
    };
  }

  /**
   * Deep extraction from PDF buffer
   */
  async extract(buffer: Buffer, filename?: string): Promise<DeepExtractionResult> {
    const startTime = Date.now();
    let text = '';
    let tables: ExtractedTable[] = [];
    let pageCount = 0;
    let ocrUsed = false;
    let method: DeepExtractionResult['method'] = 'pdf-parse';

    try {
      // Step 1: Standard text extraction
      const standardResult = await this.extractStandardText(buffer);
      text = standardResult.text;
      pageCount = standardResult.pageCount;

      // Step 2: Analyze quality
      const quality = TextQualityAnalyzer.analyze(text);

      // Step 3: Table extraction (if enabled)
      if (this.options.enableTables) {
        try {
          tables = await this.extractTables(buffer);
          if (tables.length > 0) {
            // Append table text
            const tableText = tables.map(t =>
              `\n--- TABLE (Page ${t.pageNumber}) ---\n${t.rawText}`
            ).join('\n');
            text += tableText;
            method = 'combined';
          }
        } catch (tableError) {
          // Table extraction failed, continue without
          console.warn('[DeepPDF] Table extraction failed:', tableError);
        }
      }

      // Step 4: OCR if needed and enabled
      if (quality.needsOcr && this.options.enableOcr) {
        try {
          const ocrResult = await this.extractWithOcr(buffer);
          if (ocrResult.text.length > text.length) {
            text = ocrResult.text;
            ocrUsed = true;
            method = 'ocr';
          }
        } catch (ocrError) {
          console.warn('[DeepPDF] OCR extraction failed:', ocrError);
        }
      }

      // Step 5: Carrier-specific enhancement
      text = this.enhanceWithCarrierPatterns(text, filename);

      const finalQuality = TextQualityAnalyzer.analyze(text);

      return {
        success: text.length > 50,
        text,
        tables,
        pageCount,
        method,
        ocrUsed,
        confidence: finalQuality.score,
        metadata: {
          hasImages: ocrUsed,
          tableCount: tables.length,
          textLength: text.length,
          extractionTimeMs: Date.now() - startTime
        }
      };

    } catch (error: any) {
      return {
        success: false,
        text: '',
        tables: [],
        pageCount: 0,
        method: 'pdf-parse',
        ocrUsed: false,
        confidence: 0,
        error: error.message,
        metadata: {
          hasImages: false,
          tableCount: 0,
          textLength: 0,
          extractionTimeMs: Date.now() - startTime
        }
      };
    }
  }

  /**
   * Standard pdf-parse extraction
   */
  private async extractStandardText(buffer: Buffer): Promise<{ text: string; pageCount: number }> {
    try {
      const data = await pdfParseFork(buffer, {
        max: this.options.maxPages
      });
      return {
        text: data.text || '',
        pageCount: data.numpages || 0
      };
    } catch (error) {
      return { text: '', pageCount: 0 };
    }
  }

  /**
   * Table extraction using pdf-table-extractor
   */
  private async extractTables(buffer: Buffer): Promise<ExtractedTable[]> {
    return new Promise((resolve) => {
      try {
        const pdfTableExtractor = require('pdf-table-extractor');

        // Write buffer to temp file (library needs file path)
        const tempPath = path.join(os.tmpdir(), `pdf-${Date.now()}.pdf`);
        fs.writeFileSync(tempPath, buffer);

        pdfTableExtractor(tempPath, (result: any) => {
          // Clean up temp file
          try { fs.unlinkSync(tempPath); } catch {}

          if (!result || !result.pageTables) {
            resolve([]);
            return;
          }

          const tables: ExtractedTable[] = [];

          for (const pageTable of result.pageTables) {
            if (pageTable.tables && pageTable.tables.length > 0) {
              for (const table of pageTable.tables) {
                if (table.length > 1) { // At least 2 rows
                  const rows = table.map((row: any[]) =>
                    row.map((cell: any) => String(cell || '').trim())
                  );

                  // Convert to text representation
                  const rawText = rows.map((row: string[]) => row.join(' | ')).join('\n');

                  tables.push({
                    pageNumber: pageTable.page,
                    rows,
                    headers: rows[0],
                    rawText
                  });
                }
              }
            }
          }

          resolve(tables);
        }, (error: any) => {
          // Clean up temp file on error
          try { fs.unlinkSync(tempPath); } catch {}
          resolve([]);
        });

      } catch (error) {
        resolve([]);
      }
    });
  }

  /**
   * OCR extraction using Tesseract.js
   * Note: Requires pdftoppm to be installed. If not available, returns empty.
   * Install with: brew install poppler (macOS) or apt install poppler-utils (Linux)
   */
  private async extractWithOcr(buffer: Buffer): Promise<{ text: string }> {
    try {
      // Check if pdftoppm is available
      const { execSync } = require('child_process');
      try {
        execSync('which pdftoppm', { stdio: 'ignore' });
      } catch {
        console.warn('[DeepPDF] OCR skipped: pdftoppm not installed. Install with: brew install poppler');
        return { text: '' };
      }

      // Initialize Tesseract worker if not already
      if (!this.tesseractWorker) {
        this.tesseractWorker = await createWorker(this.options.ocrLanguage || 'eng');
      }

      // Write buffer to temp file
      const tempDir = path.join(os.tmpdir(), `pdf-ocr-${Date.now()}`);
      const tempPdfPath = path.join(tempDir, 'input.pdf');

      fs.mkdirSync(tempDir, { recursive: true });
      fs.writeFileSync(tempPdfPath, buffer);

      // Convert PDF to images using pdftoppm
      try {
        execSync(`pdftoppm -png -r 150 "${tempPdfPath}" "${tempDir}/page"`, { stdio: 'ignore' });
      } catch (e) {
        console.warn('[DeepPDF] PDF to image conversion failed');
        return { text: '' };
      }

      // Find generated images
      const imageFiles = fs.readdirSync(tempDir)
        .filter(f => f.endsWith('.png'))
        .sort()
        .slice(0, this.options.maxPages || 10);

      // OCR each image
      const texts: string[] = [];

      for (const imageFile of imageFiles) {
        const imagePath = path.join(tempDir, imageFile);
        const { data: { text } } = await this.tesseractWorker.recognize(imagePath);
        texts.push(text);
      }

      // Clean up temp files
      try {
        for (const file of fs.readdirSync(tempDir)) {
          fs.unlinkSync(path.join(tempDir, file));
        }
        fs.rmdirSync(tempDir);
      } catch {}

      return { text: texts.join('\n\n--- PAGE BREAK ---\n\n') };

    } catch (error: any) {
      console.warn('[DeepPDF] OCR failed:', error.message);
      return { text: '' };
    }
  }

  /**
   * Enhance text with carrier-specific pattern extraction
   */
  private enhanceWithCarrierPatterns(text: string, filename?: string): string {
    const enhancements: string[] = [];
    const lowerText = text.toLowerCase();
    const lowerFilename = filename?.toLowerCase() || '';

    // Detect carrier
    let carrier = 'unknown';
    if (lowerText.includes('hapag') || lowerFilename.includes('hl') || lowerFilename.includes('hlag')) {
      carrier = 'hapag-lloyd';
    } else if (lowerText.includes('maersk') || lowerFilename.includes('maersk')) {
      carrier = 'maersk';
    } else if (lowerText.includes('cma cgm') || lowerFilename.includes('cma')) {
      carrier = 'cma-cgm';
    } else if (lowerText.includes('cosco') || lowerFilename.includes('cosco')) {
      carrier = 'cosco';
    } else if (lowerText.includes('msc') || lowerFilename.includes('msc')) {
      carrier = 'msc';
    } else if (lowerText.includes('one line') || lowerText.includes('ocean network')) {
      carrier = 'one';
    }

    // Extract key patterns
    const patterns = [
      { name: 'Booking Number', regex: /booking\s*(?:no|number|ref)?[:\s#]*([A-Z0-9]{8,15})/gi },
      { name: 'BL Number', regex: /b[\/]?l\s*(?:no|number)?[:\s#]*([A-Z0-9]{10,20})/gi },
      { name: 'Container', regex: /\b([A-Z]{4}\d{7})\b/g },
      { name: 'Vessel', regex: /(?:vessel|m\/v|mv|vsl)[:\s]+([A-Z][A-Za-z0-9\s]{3,30}?)(?:\s*voyage|\s*\d|\n)/gi },
      { name: 'Voyage', regex: /voyage[:\s#]*([A-Z0-9]{3,15})/gi },
      { name: 'POL', regex: /(?:port\s*of\s*loading|pol)[:\s]+([A-Z][A-Za-z\s,]{3,40}?)(?:\n|port|$)/gi },
      { name: 'POD', regex: /(?:port\s*of\s*discharge|pod)[:\s]+([A-Z][A-Za-z\s,]{3,40}?)(?:\n|port|$)/gi },
      { name: 'ETD', regex: /(?:etd|departure)[:\s]+(\d{1,2}[-/]\w{3}[-/]\d{2,4}|\d{4}-\d{2}-\d{2})/gi },
      { name: 'ETA', regex: /(?:eta|arrival)[:\s]+(\d{1,2}[-/]\w{3}[-/]\d{2,4}|\d{4}-\d{2}-\d{2})/gi },
      { name: 'SI Cutoff', regex: /(?:si|shipping\s*instruction)\s*(?:cut\s*off|deadline)[:\s]+(\d{1,2}[-/]\w{3}[-/]\d{2,4})/gi },
      { name: 'VGM Cutoff', regex: /vgm\s*(?:cut\s*off|deadline)[:\s]+(\d{1,2}[-/]\w{3}[-/]\d{2,4})/gi },
      { name: 'Shipper', regex: /shipper[:\s]+([A-Z][A-Za-z0-9\s,.]{5,60}?)(?:\n|consignee|notify)/gi },
      { name: 'Consignee', regex: /consignee[:\s]+([A-Z][A-Za-z0-9\s,.]{5,60}?)(?:\n|notify|shipper)/gi },
      { name: 'Weight', regex: /(?:gross|net)?\s*weight[:\s]+([0-9,.]+)\s*(?:kg|kgs|mt|lbs)/gi },
      { name: 'Amount', regex: /(?:total|amount|due)[:\s]*(?:usd|inr|eur|\$|₹)?[:\s]*([0-9,.]+)/gi }
    ];

    const extracted = new Map<string, Set<string>>();

    for (const { name, regex } of patterns) {
      for (const match of text.matchAll(regex)) {
        const value = (match[1] || match[0]).trim();
        if (value.length >= 3 && value.length <= 100) {
          if (!extracted.has(name)) {
            extracted.set(name, new Set());
          }
          extracted.get(name)!.add(value);
        }
      }
    }

    if (extracted.size > 0) {
      enhancements.push(`\n\n═══════════════════════════════════════`);
      enhancements.push(`EXTRACTED KEY FIELDS (${carrier.toUpperCase()})`);
      enhancements.push(`═══════════════════════════════════════`);

      for (const [name, values] of extracted) {
        const valueList = Array.from(values).slice(0, 5).join(', ');
        enhancements.push(`${name}: ${valueList}`);
      }
    }

    return text + enhancements.join('\n');
  }

  /**
   * Cleanup resources
   */
  async terminate(): Promise<void> {
    if (this.tesseractWorker) {
      await this.tesseractWorker.terminate();
      this.tesseractWorker = null;
    }
  }
}

// ============================================================================
// Batch Extraction Service
// ============================================================================

export class BatchPdfExtractionService {
  private extractor: DeepPdfExtractor;

  constructor(options: ExtractionOptions = {}) {
    this.extractor = new DeepPdfExtractor(options);
  }

  /**
   * Extract multiple PDFs with progress callback
   */
  async extractBatch(
    items: Array<{ id: string; buffer: Buffer; filename: string }>,
    onProgress?: (current: number, total: number, result: DeepExtractionResult) => void
  ): Promise<Map<string, DeepExtractionResult>> {
    const results = new Map<string, DeepExtractionResult>();

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const result = await this.extractor.extract(item.buffer, item.filename);
      results.set(item.id, result);

      if (onProgress) {
        onProgress(i + 1, items.length, result);
      }
    }

    await this.extractor.terminate();
    return results;
  }
}

export default DeepPdfExtractor;
