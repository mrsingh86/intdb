/**
 * PDF Text Extractor Service
 *
 * Extracts text from PDFs using multiple strategies:
 * 1. Standard pdf-parse for text-based PDFs
 * 2. OCR (Tesseract + pdftocairo) for scanned/image PDFs
 *
 * Following CLAUDE.md principles:
 * - Single Responsibility (Principle #3)
 * - Small Functions < 20 lines (Principle #17)
 * - Interface-Based Design (Principle #6)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { promisify } from 'util';
import { exec } from 'child_process';
import { IPdfExtractor } from './interfaces';

// ============================================================================
// CONSTANTS
// ============================================================================

const MIN_MEANINGFUL_LENGTH = 50;
const MIN_MEANINGFUL_KEYWORDS = 2;
const OCR_DPI = 200;
const OCR_MAX_PAGES = 3;

const SHIPPING_KEYWORDS = [
  'container', 'delivery', 'pickup', 'invoice', 'pod', 'proof',
  'booking', 'shipment', 'freight', 'carrier', 'driver', 'bill',
  'load', 'terminal', 'port', 'vessel', 'shipper', 'consignee',
  'weight', 'pieces', 'date', 'address', 'received', 'delivered',
];

const GARBAGE_PATTERNS = [
  /https?:\/\/outlook\.office/i,
  /AAkALgAAAAAAHYQD/i,
  /^[\s\n]*$/,
  /[^\x20-\x7E\n\r\t]{20,}/,
];

// Promisified functions
const execAsync = promisify(exec);
const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);
const readdirAsync = promisify(fs.readdir);

// ============================================================================
// PDF EXTRACTOR IMPLEMENTATION
// ============================================================================

export class PdfExtractor implements IPdfExtractor {
  /**
   * Extract text from PDF using best available strategy
   */
  async extractText(buffer: Buffer, filename?: string): Promise<string> {
    try {
      const standardText = await this.extractWithPdfParse(buffer);

      if (this.isTextMeaningful(standardText) && standardText.length > 100) {
        return standardText;
      }

      console.log(`[Chronicle] PDF needs OCR for ${filename || 'unknown'}`);
      return await this.extractWithOcr(buffer);
    } catch (error) {
      console.error('[Chronicle] PDF parse error:', error);
      return this.tryOcrFallback(buffer);
    }
  }

  /**
   * Check if extracted text is meaningful (not garbage/screenshots)
   */
  isTextMeaningful(text: string): boolean {
    if (!text || text.trim().length < MIN_MEANINGFUL_LENGTH) return false;
    if (this.containsGarbagePatterns(text)) return false;
    return this.countShippingKeywords(text) >= MIN_MEANINGFUL_KEYWORDS;
  }

  // ==========================================================================
  // PRIVATE HELPERS - Each < 20 lines
  // ==========================================================================

  private async extractWithPdfParse(buffer: Buffer): Promise<string> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require('pdf-parse-fork');
    const data = await pdfParse(buffer);
    return data.text || '';
  }

  private containsGarbagePatterns(text: string): boolean {
    return GARBAGE_PATTERNS.some(pattern => pattern.test(text));
  }

  private countShippingKeywords(text: string): number {
    const lower = text.toLowerCase();
    return SHIPPING_KEYWORDS.filter(kw => lower.includes(kw)).length;
  }

  private async tryOcrFallback(buffer: Buffer): Promise<string> {
    try {
      return await this.extractWithOcr(buffer);
    } catch (ocrError) {
      console.error('[Chronicle] OCR fallback error:', ocrError);
      return '';
    }
  }

  private async extractWithOcr(buffer: Buffer): Promise<string> {
    const tempDir = this.createTempDirectory();
    try {
      const pdfPath = await this.writeTempPdf(tempDir, buffer);
      const imageFiles = await this.convertPdfToImages(tempDir, pdfPath);
      const texts = await this.ocrImages(tempDir, imageFiles);
      return texts.join('\n\n--- PAGE BREAK ---\n\n');
    } finally {
      this.cleanupTempDirectory(tempDir);
    }
  }

  private createTempDirectory(): string {
    const tempDir = path.join(os.tmpdir(), `chronicle-ocr-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    return tempDir;
  }

  private async writeTempPdf(tempDir: string, buffer: Buffer): Promise<string> {
    const pdfPath = path.join(tempDir, 'input.pdf');
    await writeFileAsync(pdfPath, buffer);
    return pdfPath;
  }

  private async convertPdfToImages(tempDir: string, pdfPath: string): Promise<string[]> {
    const outputPrefix = path.join(tempDir, 'page');
    await execAsync(`pdftocairo -png -r ${OCR_DPI} -l ${OCR_MAX_PAGES} "${pdfPath}" "${outputPrefix}"`);

    const files = await readdirAsync(tempDir);
    return files.filter((f: string) => f.endsWith('.png')).sort();
  }

  private async ocrImages(tempDir: string, imageFiles: string[]): Promise<string[]> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Tesseract = require('tesseract.js');

    const texts: string[] = [];
    for (const imageFile of imageFiles) {
      const imagePath = path.join(tempDir, imageFile);
      const imageBuffer = await readFileAsync(imagePath);
      const result = await Tesseract.recognize(imageBuffer, 'eng', { logger: () => {} });
      if (result.data.text) texts.push(result.data.text);
    }

    console.log(`[Chronicle] OCR extracted ${texts.join('').length} chars from ${imageFiles.length} pages`);
    return texts;
  }

  private cleanupTempDirectory(tempDir: string): void {
    try {
      const files = fs.readdirSync(tempDir);
      for (const file of files) {
        fs.unlinkSync(path.join(tempDir, file));
      }
      fs.rmdirSync(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createPdfExtractor(): IPdfExtractor {
  return new PdfExtractor();
}
