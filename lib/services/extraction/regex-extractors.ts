/**
 * Regex Extractors Service
 *
 * Deterministic extraction using pattern matching with confidence scores.
 * These extractors run FIRST before AI, providing high-confidence baseline data.
 *
 * Design: Single Responsibility - Each extractor handles one entity category.
 */

import {
  PatternDefinition,
  DatePatternDefinition,
  CutoffKeywordDefinition,
  BOOKING_NUMBER_PATTERNS,
  CONTAINER_NUMBER_PATTERNS,
  BL_NUMBER_PATTERNS,
  ENTRY_NUMBER_PATTERNS,
  DATE_PATTERNS,
  CUTOFF_KEYWORDS,
  PORT_PATTERNS,
  VESSEL_PATTERNS,
  VOYAGE_PATTERNS,
  CARRIER_DETECTION_PATTERNS,
  CONFIDENCE_THRESHOLDS,
} from './pattern-definitions';

// ============================================================================
// Types
// ============================================================================

export interface ExtractionResult {
  value: string;
  confidence: number;
  method: 'regex' | 'regex_subject';
  pattern?: string;
  position?: number;
  context?: string;
}

export interface DateExtractionResult extends ExtractionResult {
  parsedDate: string; // ISO format
  hasTime: boolean;
}

export interface CutoffExtractionResult extends DateExtractionResult {
  cutoffType: 'si_cutoff' | 'vgm_cutoff' | 'cargo_cutoff' | 'gate_cutoff' | 'doc_cutoff' | 'port_cutoff';
}

export interface ExtractorInput {
  subject: string;
  bodyText: string;
  carrier?: string | null;
}

// ============================================================================
// Carrier Detector (Context Builder)
// ============================================================================

export class CarrierDetector {
  /**
   * Detect carrier from email content for pattern selection
   */
  detect(input: ExtractorInput): string | null {
    const text = `${input.subject} ${input.bodyText}`.toLowerCase();

    for (const [carrier, patterns] of Object.entries(CARRIER_DETECTION_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          return carrier;
        }
      }
    }

    return null;
  }

  /**
   * Get all detected carriers (some emails mention multiple)
   */
  detectAll(input: ExtractorInput): string[] {
    const text = `${input.subject} ${input.bodyText}`.toLowerCase();
    const carriers: string[] = [];

    for (const [carrier, patterns] of Object.entries(CARRIER_DETECTION_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(text)) {
          carriers.push(carrier);
          break;
        }
      }
    }

    return carriers;
  }
}

// ============================================================================
// Identifier Extractor (Booking, Container, BL, Entry Numbers)
// ============================================================================

export class IdentifierExtractor {
  private carrierDetector = new CarrierDetector();

  /**
   * Extract booking numbers with carrier-aware confidence
   */
  extractBookingNumbers(input: ExtractorInput): ExtractionResult[] {
    const carrier = input.carrier || this.carrierDetector.detect(input);
    const results: ExtractionResult[] = [];
    const seen = new Set<string>();

    // First pass: Subject (higher confidence for subject matches)
    for (const patternDef of BOOKING_NUMBER_PATTERNS) {
      if (patternDef.carrier && carrier && patternDef.carrier !== carrier) {
        continue; // Skip carrier-specific patterns that don't match
      }

      const subjectMatches = this.extractWithPattern(input.subject, patternDef, 'regex_subject');
      for (const match of subjectMatches) {
        if (!seen.has(match.value)) {
          // Boost confidence for subject matches
          match.confidence = Math.min(match.confidence + 3, 99);
          results.push(match);
          seen.add(match.value);
        }
      }
    }

    // Second pass: Body
    for (const patternDef of BOOKING_NUMBER_PATTERNS) {
      if (patternDef.carrier && carrier && patternDef.carrier !== carrier) {
        continue;
      }

      // Boost confidence when carrier context matches
      let confidenceBoost = 0;
      if (patternDef.carrier && patternDef.carrier === carrier) {
        confidenceBoost = 3;
      }

      const bodyMatches = this.extractWithPattern(input.bodyText, patternDef, 'regex');
      for (const match of bodyMatches) {
        if (!seen.has(match.value)) {
          match.confidence = Math.min(match.confidence + confidenceBoost, 99);
          results.push(match);
          seen.add(match.value);
        }
      }
    }

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Extract container numbers (ISO 6346 validation)
   */
  extractContainerNumbers(input: ExtractorInput): ExtractionResult[] {
    const carrier = input.carrier || this.carrierDetector.detect(input);
    const results: ExtractionResult[] = [];
    const seen = new Set<string>();

    for (const patternDef of CONTAINER_NUMBER_PATTERNS) {
      // Try carrier-specific patterns first for higher confidence
      if (patternDef.carrier && carrier && patternDef.carrier !== carrier) {
        continue;
      }

      // Extract from both subject and body
      const allText = `${input.subject}\n${input.bodyText}`;
      const matches = this.extractWithPattern(allText, patternDef, 'regex');

      for (const match of matches) {
        const normalized = match.value.toUpperCase();
        if (!seen.has(normalized) && this.isValidContainerNumber(normalized)) {
          match.value = normalized;
          results.push(match);
          seen.add(normalized);
        }
      }
    }

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Extract BL numbers (MBL, HBL)
   */
  extractBLNumbers(input: ExtractorInput): ExtractionResult[] {
    const carrier = input.carrier || this.carrierDetector.detect(input);
    const results: ExtractionResult[] = [];
    const seen = new Set<string>();

    for (const patternDef of BL_NUMBER_PATTERNS) {
      if (patternDef.carrier && carrier && patternDef.carrier !== carrier) {
        continue;
      }

      const allText = `${input.subject}\n${input.bodyText}`;
      const matches = this.extractWithPattern(allText, patternDef, 'regex');

      for (const match of matches) {
        const normalized = match.value.toUpperCase();
        if (!seen.has(normalized)) {
          match.value = normalized;
          results.push(match);
          seen.add(normalized);
        }
      }
    }

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Extract entry numbers (US Customs)
   */
  extractEntryNumbers(input: ExtractorInput): ExtractionResult[] {
    const results: ExtractionResult[] = [];
    const seen = new Set<string>();

    for (const patternDef of ENTRY_NUMBER_PATTERNS) {
      const allText = `${input.subject}\n${input.bodyText}`;
      const matches = this.extractWithPattern(allText, patternDef, 'regex');

      for (const match of matches) {
        if (!seen.has(match.value)) {
          results.push(match);
          seen.add(match.value);
        }
      }
    }

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Validate container number using ISO 6346 check digit
   */
  private isValidContainerNumber(containerNumber: string): boolean {
    if (!/^[A-Z]{4}\d{7}$/.test(containerNumber)) {
      return false;
    }

    // ISO 6346 check digit calculation
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const values: number[] = [];

    // First 4 letters: A=10, B=12, C=13... (skip 11, 22, 33, 44)
    for (let i = 0; i < 4; i++) {
      const idx = alphabet.indexOf(containerNumber[i]);
      let value = idx + 10;
      // Skip multiples of 11
      value += Math.floor((idx + 10) / 11);
      values.push(value);
    }

    // Next 6 digits: face value
    for (let i = 4; i < 10; i++) {
      values.push(parseInt(containerNumber[i], 10));
    }

    // Calculate weighted sum
    let sum = 0;
    for (let i = 0; i < 10; i++) {
      sum += values[i] * Math.pow(2, i);
    }

    // Check digit
    const checkDigit = sum % 11 % 10;
    return checkDigit === parseInt(containerNumber[10], 10);
  }

  /**
   * Core pattern extraction method
   */
  private extractWithPattern(
    text: string,
    patternDef: PatternDefinition,
    method: 'regex' | 'regex_subject'
  ): ExtractionResult[] {
    const results: ExtractionResult[] = [];
    // Reset regex lastIndex
    patternDef.pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = patternDef.pattern.exec(text)) !== null) {
      const captureGroup = patternDef.captureGroup ?? 1;
      const value = match[captureGroup] ?? match[0];

      results.push({
        value: value.trim(),
        confidence: patternDef.confidence,
        method,
        pattern: patternDef.description,
        position: match.index,
        context: this.getContext(text, match.index, 50),
      });

      // Prevent infinite loop for zero-length matches
      if (match[0].length === 0) {
        patternDef.pattern.lastIndex++;
      }
    }

    return results;
  }

  /**
   * Get surrounding context for debugging
   */
  private getContext(text: string, position: number, radius: number): string {
    const start = Math.max(0, position - radius);
    const end = Math.min(text.length, position + radius);
    return text.slice(start, end).replace(/\s+/g, ' ').trim();
  }
}

// ============================================================================
// Date Extractor (ETD, ETA, general dates)
// ============================================================================

export class DateExtractor {
  private months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  /**
   * Extract all dates from text
   */
  extractDates(input: ExtractorInput): DateExtractionResult[] {
    const results: DateExtractionResult[] = [];
    const seen = new Set<string>();
    const allText = `${input.subject}\n${input.bodyText}`;

    for (const patternDef of DATE_PATTERNS) {
      const matches = this.extractDateWithPattern(allText, patternDef);
      for (const match of matches) {
        if (!seen.has(match.parsedDate)) {
          results.push(match);
          seen.add(match.parsedDate);
        }
      }
    }

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Extract ETD (look for context keywords)
   */
  extractETD(input: ExtractorInput): DateExtractionResult | null {
    const etdPatterns = [
      /ETD\s*:?\s*/gi,
      /Estimated\s+Time\s+of\s+Departure\s*:?\s*/gi,
      /Departure\s+Date\s*:?\s*/gi,
      /Sailing\s+Date\s*:?\s*/gi,
    ];

    return this.extractDateWithContext(input, etdPatterns);
  }

  /**
   * Extract ETA (look for context keywords)
   */
  extractETA(input: ExtractorInput): DateExtractionResult | null {
    const etaPatterns = [
      /ETA\s*:?\s*/gi,
      /Estimated\s+Time\s+of\s+Arrival\s*:?\s*/gi,
      /Arrival\s+Date\s*:?\s*/gi,
    ];

    return this.extractDateWithContext(input, etaPatterns);
  }

  /**
   * Extract date following a context keyword
   */
  private extractDateWithContext(
    input: ExtractorInput,
    contextPatterns: RegExp[]
  ): DateExtractionResult | null {
    const allText = `${input.subject}\n${input.bodyText}`;

    for (const contextPattern of contextPatterns) {
      contextPattern.lastIndex = 0;
      const contextMatch = contextPattern.exec(allText);

      if (contextMatch) {
        // Look for date immediately after context keyword
        const afterContext = allText.slice(contextMatch.index + contextMatch[0].length);

        for (const datePattern of DATE_PATTERNS) {
          const dateMatches = this.extractDateWithPattern(afterContext.slice(0, 100), datePattern);
          if (dateMatches.length > 0) {
            // Boost confidence for dates found with context
            const result = dateMatches[0];
            result.confidence = Math.min(result.confidence + 5, 99);
            return result;
          }
        }
      }
    }

    return null;
  }

  /**
   * Extract dates using a specific pattern
   */
  private extractDateWithPattern(
    text: string,
    patternDef: DatePatternDefinition
  ): DateExtractionResult[] {
    const results: DateExtractionResult[] = [];
    patternDef.pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = patternDef.pattern.exec(text)) !== null) {
      const parsed = this.parseDate(match, patternDef.format);
      if (parsed) {
        results.push({
          value: match[0],
          confidence: patternDef.confidence,
          method: 'regex',
          pattern: patternDef.description,
          position: match.index,
          parsedDate: parsed,
          hasTime: patternDef.hasTime ?? false,
        });
      }

      // Prevent infinite loop
      if (match[0].length === 0) {
        patternDef.pattern.lastIndex++;
      }
    }

    return results;
  }

  /**
   * Parse date match to ISO format
   */
  private parseDate(
    match: RegExpExecArray,
    format: DatePatternDefinition['format']
  ): string | null {
    try {
      let year: number, month: number, day: number;

      switch (format) {
        case 'iso':
          return match[1]; // Already ISO format

        case 'dmy':
          day = parseInt(match[1], 10);
          month = parseInt(match[2], 10) - 1;
          year = parseInt(match[3], 10);
          break;

        case 'mdy':
          month = parseInt(match[1], 10) - 1;
          day = parseInt(match[2], 10);
          year = parseInt(match[3], 10);
          break;

        case 'dmy_text':
          day = parseInt(match[1], 10);
          month = this.months[match[2].toLowerCase().slice(0, 3)];
          year = parseInt(match[3], 10);
          break;

        case 'mdy_text':
          month = this.months[match[1].toLowerCase().slice(0, 3)];
          day = parseInt(match[2], 10);
          year = parseInt(match[3], 10);
          break;

        default:
          return null;
      }

      // Validate
      if (year < 2020 || year > 2030) return null;
      if (month < 0 || month > 11) return null;
      if (day < 1 || day > 31) return null;

      const date = new Date(year, month, day);
      return date.toISOString().split('T')[0];
    } catch {
      return null;
    }
  }
}

// ============================================================================
// Cutoff Extractor (SI, VGM, Cargo, Gate cutoffs)
// ============================================================================

export class CutoffExtractor {
  private dateExtractor = new DateExtractor();

  /**
   * Extract all cutoff dates from text
   */
  extractCutoffs(input: ExtractorInput): CutoffExtractionResult[] {
    const results: CutoffExtractionResult[] = [];
    const allText = `${input.subject}\n${input.bodyText}`;

    for (const cutoffDef of CUTOFF_KEYWORDS) {
      for (const keyword of cutoffDef.keywords) {
        keyword.lastIndex = 0;
        const keywordMatch = keyword.exec(allText);

        if (keywordMatch) {
          // Look for date near the keyword (within 100 chars)
          const afterKeyword = allText.slice(
            keywordMatch.index + keywordMatch[0].length
          );
          const beforeKeyword = allText.slice(
            Math.max(0, keywordMatch.index - 100),
            keywordMatch.index
          );

          // Try finding date after keyword first (more common)
          const dateAfter = this.findFirstDate(afterKeyword.slice(0, 100));
          if (dateAfter) {
            results.push({
              ...dateAfter,
              cutoffType: cutoffDef.fieldName,
              confidence: Math.min(
                (dateAfter.confidence + cutoffDef.confidence) / 2 + 5,
                99
              ),
            });
            continue;
          }

          // Try finding date before keyword
          const dateBefore = this.findFirstDate(beforeKeyword);
          if (dateBefore) {
            results.push({
              ...dateBefore,
              cutoffType: cutoffDef.fieldName,
              confidence: Math.min(
                (dateBefore.confidence + cutoffDef.confidence) / 2,
                95
              ),
            });
          }
        }
      }
    }

    // Deduplicate by cutoff type (keep highest confidence)
    const byType = new Map<string, CutoffExtractionResult>();
    for (const result of results) {
      const existing = byType.get(result.cutoffType);
      if (!existing || result.confidence > existing.confidence) {
        byType.set(result.cutoffType, result);
      }
    }

    return Array.from(byType.values());
  }

  /**
   * Find first date in text
   */
  private findFirstDate(text: string): DateExtractionResult | null {
    const dates = this.dateExtractor.extractDates({ subject: '', bodyText: text });
    return dates.length > 0 ? dates[0] : null;
  }
}

// ============================================================================
// Port Extractor (POL, POD, Place of Receipt, Place of Delivery)
// ============================================================================

export class PortExtractor {
  /**
   * Extract port of loading
   */
  extractPOL(input: ExtractorInput): ExtractionResult | null {
    return this.extractPortWithContext(input, [
      /Port\s+of\s+Loading\s*:?\s*/gi,
      /POL\s*:?\s*/gi,
      /Load(?:ing)?\s+Port\s*:?\s*/gi,
      /Origin\s+Port\s*:?\s*/gi,
    ]);
  }

  /**
   * Extract port of discharge
   */
  extractPOD(input: ExtractorInput): ExtractionResult | null {
    return this.extractPortWithContext(input, [
      /Port\s+of\s+Discharge\s*:?\s*/gi,
      /POD\s*:?\s*/gi,
      /Discharge\s+Port\s*:?\s*/gi,
      /Destination\s+Port\s*:?\s*/gi,
    ]);
  }

  /**
   * Extract place of receipt
   */
  extractPlaceOfReceipt(input: ExtractorInput): ExtractionResult | null {
    return this.extractPortWithContext(input, [
      /Place\s+of\s+Receipt\s*:?\s*/gi,
      /Receipt\s+Place\s*:?\s*/gi,
      /POR\s*:?\s*/gi,
    ]);
  }

  /**
   * Extract place of delivery
   */
  extractPlaceOfDelivery(input: ExtractorInput): ExtractionResult | null {
    return this.extractPortWithContext(input, [
      /Place\s+of\s+Delivery\s*:?\s*/gi,
      /Delivery\s+Place\s*:?\s*/gi,
      /Final\s+Destination\s*:?\s*/gi,
    ]);
  }

  /**
   * Extract UN/LOCODE port codes
   */
  extractPortCodes(input: ExtractorInput): ExtractionResult[] {
    const results: ExtractionResult[] = [];
    const seen = new Set<string>();
    const allText = `${input.subject}\n${input.bodyText}`;

    for (const patternDef of PORT_PATTERNS) {
      // Only use code patterns (5 characters)
      if (!patternDef.description?.includes('code')) continue;

      patternDef.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = patternDef.pattern.exec(allText)) !== null) {
        const code = match[1] ?? match[0];
        if (!seen.has(code)) {
          results.push({
            value: code.toUpperCase(),
            confidence: patternDef.confidence,
            method: 'regex',
            pattern: patternDef.description,
            position: match.index,
          });
          seen.add(code);
        }

        if (match[0].length === 0) {
          patternDef.pattern.lastIndex++;
        }
      }
    }

    return results;
  }

  /**
   * Extract port/place following a context keyword
   */
  private extractPortWithContext(
    input: ExtractorInput,
    contextPatterns: RegExp[]
  ): ExtractionResult | null {
    const allText = `${input.subject}\n${input.bodyText}`;

    for (const contextPattern of contextPatterns) {
      contextPattern.lastIndex = 0;
      const contextMatch = contextPattern.exec(allText);

      if (contextMatch) {
        const afterContext = allText.slice(
          contextMatch.index + contextMatch[0].length
        );

        // Try UN/LOCODE first (highest confidence)
        const locodeMatch = afterContext.match(/^([A-Z]{2}[A-Z0-9]{3})\b/);
        if (locodeMatch) {
          return {
            value: locodeMatch[1],
            confidence: 92,
            method: 'regex',
            pattern: 'UN/LOCODE with context',
            position: contextMatch.index + contextMatch[0].length,
          };
        }

        // Try port name (take until comma, newline, or next label)
        const nameMatch = afterContext.match(/^([A-Za-z][A-Za-z\s,]+?)(?:\s*[-–|]|\s*\n|\s*[A-Z]{2,}:)/);
        if (nameMatch) {
          return {
            value: nameMatch[1].trim(),
            confidence: 78,
            method: 'regex',
            pattern: 'Port name with context',
            position: contextMatch.index + contextMatch[0].length,
          };
        }
      }
    }

    return null;
  }
}

// ============================================================================
// Vessel & Voyage Extractor
// ============================================================================

export class VesselVoyageExtractor {
  /**
   * Extract vessel name
   */
  extractVessel(input: ExtractorInput): ExtractionResult | null {
    const allText = `${input.subject}\n${input.bodyText}`;

    for (const patternDef of VESSEL_PATTERNS) {
      patternDef.pattern.lastIndex = 0;
      const match = patternDef.pattern.exec(allText);

      if (match) {
        const captureGroup = patternDef.captureGroup ?? 1;
        const value = (match[captureGroup] ?? match[0]).trim();

        // Skip if too short or too long
        if (value.length < 3 || value.length > 50) continue;

        return {
          value,
          confidence: patternDef.confidence,
          method: 'regex',
          pattern: patternDef.description,
          position: match.index,
        };
      }
    }

    return null;
  }

  /**
   * Extract voyage number
   */
  extractVoyage(input: ExtractorInput): ExtractionResult | null {
    const allText = `${input.subject}\n${input.bodyText}`;

    for (const patternDef of VOYAGE_PATTERNS) {
      patternDef.pattern.lastIndex = 0;
      const match = patternDef.pattern.exec(allText);

      if (match) {
        const captureGroup = patternDef.captureGroup ?? 1;
        const value = (match[captureGroup] ?? match[0]).trim();

        return {
          value,
          confidence: patternDef.confidence,
          method: 'regex',
          pattern: patternDef.description,
          position: match.index,
        };
      }
    }

    return null;
  }
}

// ============================================================================
// Unified Regex Extractor (Facade)
// ============================================================================

export interface RegexExtractionResults {
  carrier: string | null;
  bookingNumbers: ExtractionResult[];
  containerNumbers: ExtractionResult[];
  blNumbers: ExtractionResult[];
  entryNumbers: ExtractionResult[];
  etd: DateExtractionResult | null;
  eta: DateExtractionResult | null;
  cutoffs: CutoffExtractionResult[];
  portOfLoading: ExtractionResult | null;
  portOfLoadingCode: ExtractionResult | null;
  portOfDischarge: ExtractionResult | null;
  portOfDischargeCode: ExtractionResult | null;
  placeOfReceipt: ExtractionResult | null;
  placeOfDelivery: ExtractionResult | null;
  vessel: ExtractionResult | null;
  voyage: ExtractionResult | null;
}

export class RegexExtractor {
  private carrierDetector = new CarrierDetector();
  private identifierExtractor = new IdentifierExtractor();
  private dateExtractor = new DateExtractor();
  private cutoffExtractor = new CutoffExtractor();
  private portExtractor = new PortExtractor();
  private vesselVoyageExtractor = new VesselVoyageExtractor();

  /**
   * Run all regex extractors and return comprehensive results
   */
  extract(input: ExtractorInput): RegexExtractionResults {
    const carrier = input.carrier || this.carrierDetector.detect(input);
    const inputWithCarrier = { ...input, carrier };

    // Extract port codes separately to identify POL/POD codes
    const portCodes = this.portExtractor.extractPortCodes(inputWithCarrier);

    return {
      carrier,
      bookingNumbers: this.identifierExtractor.extractBookingNumbers(inputWithCarrier),
      containerNumbers: this.identifierExtractor.extractContainerNumbers(inputWithCarrier),
      blNumbers: this.identifierExtractor.extractBLNumbers(inputWithCarrier),
      entryNumbers: this.identifierExtractor.extractEntryNumbers(inputWithCarrier),
      etd: this.dateExtractor.extractETD(inputWithCarrier),
      eta: this.dateExtractor.extractETA(inputWithCarrier),
      cutoffs: this.cutoffExtractor.extractCutoffs(inputWithCarrier),
      portOfLoading: this.portExtractor.extractPOL(inputWithCarrier),
      portOfLoadingCode: portCodes.find(p => p.value.startsWith('IN')) ?? null,
      portOfDischarge: this.portExtractor.extractPOD(inputWithCarrier),
      portOfDischargeCode: portCodes.find(p => p.value.startsWith('US')) ?? null,
      placeOfReceipt: this.portExtractor.extractPlaceOfReceipt(inputWithCarrier),
      placeOfDelivery: this.portExtractor.extractPlaceOfDelivery(inputWithCarrier),
      vessel: this.vesselVoyageExtractor.extractVessel(inputWithCarrier),
      voyage: this.vesselVoyageExtractor.extractVoyage(inputWithCarrier),
    };
  }

  /**
   * Extract only critical fields (for quick validation)
   */
  extractCritical(input: ExtractorInput): Pick<
    RegexExtractionResults,
    'carrier' | 'bookingNumbers' | 'containerNumbers' | 'blNumbers' | 'etd' | 'eta' | 'portOfLoading' | 'portOfDischarge'
  > {
    const carrier = input.carrier || this.carrierDetector.detect(input);
    const inputWithCarrier = { ...input, carrier };

    return {
      carrier,
      bookingNumbers: this.identifierExtractor.extractBookingNumbers(inputWithCarrier),
      containerNumbers: this.identifierExtractor.extractContainerNumbers(inputWithCarrier),
      blNumbers: this.identifierExtractor.extractBLNumbers(inputWithCarrier),
      etd: this.dateExtractor.extractETD(inputWithCarrier),
      eta: this.dateExtractor.extractETA(inputWithCarrier),
      portOfLoading: this.portExtractor.extractPOL(inputWithCarrier),
      portOfDischarge: this.portExtractor.extractPOD(inputWithCarrier),
    };
  }
}

// Export singleton instances for convenience
export const carrierDetector = new CarrierDetector();
export const identifierExtractor = new IdentifierExtractor();
export const dateExtractor = new DateExtractor();
export const cutoffExtractor = new CutoffExtractor();
export const portExtractor = new PortExtractor();
export const vesselVoyageExtractor = new VesselVoyageExtractor();
export const regexExtractor = new RegexExtractor();
