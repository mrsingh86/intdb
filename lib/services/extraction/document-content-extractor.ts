/**
 * Document Content Extractor
 *
 * Specialized extractor for PDF attachment content.
 * Uses different strategies than email extraction:
 * - Layout-aware extraction (header, cargo section, party section)
 * - Table parsing for structured data
 * - Section-based confidence (header data more reliable)
 * - Page-aware extraction for multi-page documents
 *
 * Single Responsibility: Extract entities from PDF document content only.
 */

import {
  RegexExtractor,
  ExtractionResult,
  DateExtractionResult,
  CutoffExtractionResult,
} from './regex-extractors';
import { CONFIDENCE_THRESHOLDS } from './pattern-definitions';

// ============================================================================
// Types
// ============================================================================

export interface DocumentExtractionInput {
  attachmentId: string;
  emailId: string;
  pdfContent: string;
  documentType: string;
  carrier?: string;
  pageCount?: number;
}

export interface DocumentExtraction {
  entityType: string;
  entityValue: string;
  entityNormalized?: string;
  confidenceScore: number;
  extractionMethod: DocumentExtractionMethod;
  documentType: string;
  pageNumber?: number;
  sectionName?: DocumentSection;
  tableName?: string;
  tableRow?: number;
  tableColumn?: string;
  bboxX1?: number;
  bboxY1?: number;
  bboxX2?: number;
  bboxY2?: number;
}

export type DocumentSection =
  | 'header'
  | 'routing'
  | 'party_section'
  | 'cargo_details'
  | 'cutoff_section'
  | 'charges'
  | 'footer'
  | 'unknown';

export type DocumentExtractionMethod =
  | 'regex'
  | 'table_parser'
  | 'ocr_pattern'
  | 'form_field'
  | 'ai_vision'
  | 'layout_analysis'
  | 'schema';

export interface DocumentExtractionResult {
  success: boolean;
  extractions: DocumentExtraction[];
  metadata: {
    documentType: string;
    pageCount: number;
    sectionsDetected: DocumentSection[];
    tablesDetected: number;
    totalConfidence: number;
    processingTimeMs: number;
  };
}

// ============================================================================
// Constants
// ============================================================================

// Section markers for layout analysis
const SECTION_MARKERS: Record<DocumentSection, RegExp[]> = {
  header: [
    /BOOKING\s+CONFIRMATION/i,
    /BILL\s+OF\s+LADING/i,
    /ARRIVAL\s+NOTICE/i,
    /COMMERCIAL\s+INVOICE/i,
    /SHIPPING\s+INSTRUCTION/i,
  ],
  routing: [
    /PORT\s+OF\s+LOADING/i,
    /PORT\s+OF\s+DISCHARGE/i,
    /PLACE\s+OF\s+RECEIPT/i,
    /PLACE\s+OF\s+DELIVERY/i,
    /ROUTING/i,
    /VESSEL.*VOYAGE/i,
  ],
  party_section: [
    /SHIPPER/i,
    /CONSIGNEE/i,
    /NOTIFY\s+PARTY/i,
    /EXPORTER/i,
    /IMPORTER/i,
  ],
  cargo_details: [
    /CARGO\s+DETAILS/i,
    /CONTAINER\s+DETAILS/i,
    /PACKAGE.*DESCRIPTION/i,
    /COMMODITY/i,
    /GROSS\s+WEIGHT/i,
    /MEASUREMENT/i,
  ],
  cutoff_section: [
    /CUT\s*-?\s*OFF/i,
    /DEADLINE/i,
    /CLOSING\s+DATE/i,
    /SI\s+CUTOFF/i,
    /VGM\s+CUTOFF/i,
  ],
  charges: [
    /FREIGHT\s+CHARGES/i,
    /CHARGES/i,
    /AMOUNT/i,
    /TOTAL/i,
    /INVOICE\s+AMOUNT/i,
  ],
  footer: [
    /TERMS\s+AND\s+CONDITIONS/i,
    /DISCLAIMER/i,
    /SIGNATURE/i,
  ],
  unknown: [],
};

// Section-based confidence adjustments
const SECTION_CONFIDENCE_BOOST: Record<DocumentSection, number> = {
  header: 15, // Header data is most reliable
  routing: 10, // Routing section well-structured
  party_section: 5,
  cargo_details: 10,
  cutoff_section: 10,
  charges: 5,
  footer: -10, // Footer data often less reliable
  unknown: 0,
};

// Document type specific entity expectations
const DOCUMENT_TYPE_ENTITIES: Record<string, string[]> = {
  booking_confirmation: [
    'booking_number',
    'vessel_name',
    'voyage_number',
    'port_of_loading',
    'port_of_discharge',
    'etd',
    'eta',
    'si_cutoff',
    'vgm_cutoff',
    'container_type',
  ],
  arrival_notice: [
    'bl_number',
    'vessel_name',
    'eta',
    'ata',
    'port_of_discharge',
    'container_number',
    'free_time_expires',
    'freight_amount',
  ],
  invoice: [
    'invoice_number',
    'bl_number',
    'total_amount',
    'currency',
  ],
  bill_of_lading: [
    'bl_number',
    'booking_number',
    'vessel_name',
    'voyage_number',
    'shipper',
    'consignee',
    'notify_party',
    'port_of_loading',
    'port_of_discharge',
    'container_number',
    'weight_kg',
    'commodity',
  ],
  shipping_instruction: [
    'booking_number',
    'shipper',
    'consignee',
    'notify_party',
    'port_of_loading',
    'port_of_discharge',
    'commodity',
    'weight_kg',
    'container_type',
  ],
};

// ============================================================================
// Document Content Extractor
// ============================================================================

export class DocumentContentExtractor {
  private regexExtractor: RegexExtractor;

  constructor() {
    this.regexExtractor = new RegexExtractor();
  }

  /**
   * Extract entities from PDF document content.
   * Uses section-aware extraction for better accuracy.
   */
  async extract(input: DocumentExtractionInput): Promise<DocumentExtractionResult> {
    const startTime = Date.now();
    const extractions: DocumentExtraction[] = [];

    // Detect sections in the document
    const sections = this.detectSections(input.pdfContent);
    const expectedEntities = DOCUMENT_TYPE_ENTITIES[input.documentType] || [];

    // 1. Extract from full document with regex
    const regexExtractions = await this.extractWithRegex(
      input.pdfContent,
      input.documentType,
      sections
    );
    extractions.push(...regexExtractions);

    // 2. Extract section-specific data
    for (const section of sections) {
      const sectionContent = this.extractSectionContent(input.pdfContent, section);
      if (sectionContent) {
        const sectionExtractions = await this.extractFromSection(
          sectionContent,
          section,
          input.documentType
        );
        extractions.push(...sectionExtractions);
      }
    }

    // 3. Detect and extract from tables
    const tableCount = this.detectTables(input.pdfContent);
    if (tableCount > 0) {
      const tableExtractions = await this.extractFromTables(
        input.pdfContent,
        input.documentType
      );
      extractions.push(...tableExtractions);
    }

    // Deduplicate and add document metadata
    const mergedExtractions = this.deduplicateExtractions(extractions).map(
      (e) => ({
        ...e,
        documentType: input.documentType,
      })
    );

    // Calculate completeness based on expected entities
    const foundTypes = new Set(mergedExtractions.map((e) => e.entityType));
    const completeness = expectedEntities.length > 0
      ? (expectedEntities.filter((e) => foundTypes.has(e)).length /
          expectedEntities.length) *
        100
      : 0;

    return {
      success: true,
      extractions: mergedExtractions,
      metadata: {
        documentType: input.documentType,
        pageCount: input.pageCount || 1,
        sectionsDetected: sections,
        tablesDetected: tableCount,
        totalConfidence: this.calculateAverageConfidence(mergedExtractions),
        processingTimeMs: Date.now() - startTime,
      },
    };
  }

  /**
   * Extract entities using regex patterns.
   */
  private async extractWithRegex(
    content: string,
    documentType: string,
    sections: DocumentSection[]
  ): Promise<DocumentExtraction[]> {
    const extractions: DocumentExtraction[] = [];

    const regexResults = this.regexExtractor.extract({
      subject: '',
      bodyText: content,
    });

    // Identifiers
    for (const result of regexResults.bookingNumbers) {
      extractions.push(
        this.createExtraction('booking_number', result, documentType, 'header')
      );
    }

    for (const result of regexResults.containerNumbers) {
      extractions.push(
        this.createExtraction(
          'container_number',
          result,
          documentType,
          'cargo_details'
        )
      );
    }

    for (const result of regexResults.blNumbers) {
      extractions.push(
        this.createExtraction('bl_number', result, documentType, 'header')
      );
    }

    for (const result of regexResults.entryNumbers) {
      extractions.push(
        this.createExtraction('entry_number', result, documentType, 'header')
      );
    }

    // Dates
    if (regexResults.etd) {
      extractions.push(
        this.createDateExtraction('etd', regexResults.etd, documentType, 'routing')
      );
    }

    if (regexResults.eta) {
      extractions.push(
        this.createDateExtraction('eta', regexResults.eta, documentType, 'routing')
      );
    }

    // Cutoffs
    for (const cutoff of regexResults.cutoffs) {
      extractions.push(
        this.createCutoffExtraction(cutoff, documentType, 'cutoff_section')
      );
    }

    // Ports
    if (regexResults.portOfLoading) {
      extractions.push(
        this.createExtraction(
          'port_of_loading',
          regexResults.portOfLoading,
          documentType,
          'routing'
        )
      );
    }

    if (regexResults.portOfDischarge) {
      extractions.push(
        this.createExtraction(
          'port_of_discharge',
          regexResults.portOfDischarge,
          documentType,
          'routing'
        )
      );
    }

    // Vessel/Voyage
    if (regexResults.vessel) {
      extractions.push(
        this.createExtraction(
          'vessel_name',
          regexResults.vessel,
          documentType,
          'routing'
        )
      );
    }

    if (regexResults.voyage) {
      extractions.push(
        this.createExtraction(
          'voyage_number',
          regexResults.voyage,
          documentType,
          'routing'
        )
      );
    }

    // Carrier
    if (regexResults.carrier) {
      extractions.push({
        entityType: 'carrier',
        entityValue: regexResults.carrier,
        confidenceScore: this.adjustConfidenceForSection(85, 'header'),
        extractionMethod: 'regex',
        documentType,
        sectionName: 'header',
      });
    }

    return extractions;
  }

  /**
   * Extract entities from a specific section.
   */
  private async extractFromSection(
    sectionContent: string,
    section: DocumentSection,
    documentType: string
  ): Promise<DocumentExtraction[]> {
    const extractions: DocumentExtraction[] = [];

    // Section-specific patterns
    switch (section) {
      case 'party_section':
        extractions.push(
          ...this.extractParties(sectionContent, documentType, section)
        );
        break;
      case 'cargo_details':
        extractions.push(
          ...this.extractCargoDetails(sectionContent, documentType, section)
        );
        break;
      case 'charges':
        extractions.push(
          ...this.extractCharges(sectionContent, documentType, section)
        );
        break;
    }

    return extractions;
  }

  /**
   * Extract party information (shipper, consignee, notify party).
   */
  private extractParties(
    content: string,
    documentType: string,
    section: DocumentSection
  ): DocumentExtraction[] {
    const extractions: DocumentExtraction[] = [];

    // Shipper pattern
    const shipperMatch = content.match(
      /SHIPPER[:\s]*\n?([A-Z][A-Za-z0-9\s\.,&-]+?)(?:\n|$)/i
    );
    if (shipperMatch) {
      extractions.push({
        entityType: 'shipper',
        entityValue: shipperMatch[1].trim(),
        confidenceScore: this.adjustConfidenceForSection(75, section),
        extractionMethod: 'regex',
        documentType,
        sectionName: section,
      });
    }

    // Consignee pattern
    const consigneeMatch = content.match(
      /CONSIGNEE[:\s]*\n?([A-Z][A-Za-z0-9\s\.,&-]+?)(?:\n|$)/i
    );
    if (consigneeMatch) {
      extractions.push({
        entityType: 'consignee',
        entityValue: consigneeMatch[1].trim(),
        confidenceScore: this.adjustConfidenceForSection(75, section),
        extractionMethod: 'regex',
        documentType,
        sectionName: section,
      });
    }

    // Notify party pattern
    const notifyMatch = content.match(
      /NOTIFY\s*PARTY[:\s]*\n?([A-Z][A-Za-z0-9\s\.,&-]+?)(?:\n|$)/i
    );
    if (notifyMatch) {
      extractions.push({
        entityType: 'notify_party',
        entityValue: notifyMatch[1].trim(),
        confidenceScore: this.adjustConfidenceForSection(70, section),
        extractionMethod: 'regex',
        documentType,
        sectionName: section,
      });
    }

    return extractions;
  }

  /**
   * Extract cargo details (weight, volume, commodity).
   */
  private extractCargoDetails(
    content: string,
    documentType: string,
    section: DocumentSection
  ): DocumentExtraction[] {
    const extractions: DocumentExtraction[] = [];

    // Weight pattern
    const weightMatch = content.match(
      /(?:GROSS\s*WEIGHT|G\.W\.|WEIGHT)[:\s]*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:KGS?|KG)/i
    );
    if (weightMatch) {
      extractions.push({
        entityType: 'weight_kg',
        entityValue: weightMatch[1].replace(/,/g, ''),
        confidenceScore: this.adjustConfidenceForSection(85, section),
        extractionMethod: 'regex',
        documentType,
        sectionName: section,
      });
    }

    // Volume pattern
    const volumeMatch = content.match(
      /(?:MEASUREMENT|VOLUME|CBM)[:\s]*(\d+(?:\.\d+)?)\s*(?:CBM|M3)/i
    );
    if (volumeMatch) {
      extractions.push({
        entityType: 'volume_cbm',
        entityValue: volumeMatch[1],
        confidenceScore: this.adjustConfidenceForSection(85, section),
        extractionMethod: 'regex',
        documentType,
        sectionName: section,
      });
    }

    // Package count pattern
    const packageMatch = content.match(
      /(?:PACKAGES?|PKGS?|NO\.\s*OF\s*PACKAGES?)[:\s]*(\d+)/i
    );
    if (packageMatch) {
      extractions.push({
        entityType: 'package_count',
        entityValue: packageMatch[1],
        confidenceScore: this.adjustConfidenceForSection(80, section),
        extractionMethod: 'regex',
        documentType,
        sectionName: section,
      });
    }

    // Container type pattern
    const containerTypeMatch = content.match(
      /\b(20'?\s*(?:GP|DC|HC|RF|OT|FR|TK)|40'?\s*(?:GP|DC|HC|RF|OT|FR|TK)|45'?\s*HC)\b/i
    );
    if (containerTypeMatch) {
      extractions.push({
        entityType: 'container_type',
        entityValue: containerTypeMatch[1].toUpperCase(),
        confidenceScore: this.adjustConfidenceForSection(90, section),
        extractionMethod: 'regex',
        documentType,
        sectionName: section,
      });
    }

    return extractions;
  }

  /**
   * Extract charge/financial information.
   */
  private extractCharges(
    content: string,
    documentType: string,
    section: DocumentSection
  ): DocumentExtraction[] {
    const extractions: DocumentExtraction[] = [];

    // Total amount pattern
    const totalMatch = content.match(
      /(?:TOTAL|GRAND\s*TOTAL|AMOUNT\s*DUE)[:\s]*(?:USD|EUR|INR|\$|€|₹)?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i
    );
    if (totalMatch) {
      extractions.push({
        entityType: 'total_amount',
        entityValue: totalMatch[1].replace(/,/g, ''),
        confidenceScore: this.adjustConfidenceForSection(80, section),
        extractionMethod: 'regex',
        documentType,
        sectionName: section,
      });
    }

    // Currency pattern
    const currencyMatch = content.match(
      /\b(USD|EUR|INR|GBP|CNY|JPY|AED|SGD)\b/i
    );
    if (currencyMatch) {
      extractions.push({
        entityType: 'currency',
        entityValue: currencyMatch[1].toUpperCase(),
        confidenceScore: this.adjustConfidenceForSection(85, section),
        extractionMethod: 'regex',
        documentType,
        sectionName: section,
      });
    }

    // Freight amount pattern
    const freightMatch = content.match(
      /(?:FREIGHT|OCEAN\s*FREIGHT)[:\s]*(?:USD|EUR|INR|\$|€|₹)?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)/i
    );
    if (freightMatch) {
      extractions.push({
        entityType: 'freight_amount',
        entityValue: freightMatch[1].replace(/,/g, ''),
        confidenceScore: this.adjustConfidenceForSection(80, section),
        extractionMethod: 'regex',
        documentType,
        sectionName: section,
      });
    }

    return extractions;
  }

  /**
   * Extract from detected tables in the document.
   */
  private async extractFromTables(
    content: string,
    documentType: string
  ): Promise<DocumentExtraction[]> {
    const extractions: DocumentExtraction[] = [];

    // Container table pattern (common in booking confirmations)
    const containerTablePattern =
      /([A-Z]{4}\d{7})\s+(\d{2}'?\s*(?:GP|DC|HC))\s+(\d+(?:\.\d+)?)\s*(?:KGS?|MT)?/gi;
    let match;
    let rowIndex = 0;

    while ((match = containerTablePattern.exec(content)) !== null) {
      // Container number
      extractions.push({
        entityType: 'container_number',
        entityValue: match[1],
        confidenceScore: 90,
        extractionMethod: 'table_parser',
        documentType,
        sectionName: 'cargo_details',
        tableName: 'container_details',
        tableRow: rowIndex,
        tableColumn: 'container_no',
      });

      // Container type
      extractions.push({
        entityType: 'container_type',
        entityValue: match[2].replace(/\s+/g, ''),
        confidenceScore: 90,
        extractionMethod: 'table_parser',
        documentType,
        sectionName: 'cargo_details',
        tableName: 'container_details',
        tableRow: rowIndex,
        tableColumn: 'container_type',
      });

      rowIndex++;
    }

    return extractions;
  }

  /**
   * Detect sections in the document content.
   */
  private detectSections(content: string): DocumentSection[] {
    const detected: DocumentSection[] = [];

    for (const [section, patterns] of Object.entries(SECTION_MARKERS)) {
      if (section === 'unknown') continue;

      for (const pattern of patterns) {
        if (pattern.test(content)) {
          detected.push(section as DocumentSection);
          break;
        }
      }
    }

    return detected;
  }

  /**
   * Extract content for a specific section.
   */
  private extractSectionContent(
    content: string,
    section: DocumentSection
  ): string | null {
    const markers = SECTION_MARKERS[section];
    if (!markers || markers.length === 0) return null;

    // Find section start
    let startIndex = -1;
    for (const pattern of markers) {
      const match = content.match(pattern);
      if (match && match.index !== undefined) {
        startIndex = match.index;
        break;
      }
    }

    if (startIndex === -1) return null;

    // Extract approximately 2000 characters from section start
    return content.substring(startIndex, startIndex + 2000);
  }

  /**
   * Detect number of tables in content.
   */
  private detectTables(content: string): number {
    // Simple heuristic: count patterns that look like table rows
    const tableRowPattern = /\n[A-Z]{4}\d{7}\s+\d{2}'?\s*[A-Z]{2}/g;
    const matches = content.match(tableRowPattern) || [];
    return matches.length > 0 ? 1 : 0;
  }

  /**
   * Create an extraction from a regex result.
   */
  private createExtraction(
    entityType: string,
    result: ExtractionResult,
    documentType: string,
    section: DocumentSection
  ): DocumentExtraction {
    return {
      entityType,
      entityValue: result.value,
      entityNormalized: result.value, // Use value as normalized (no separate field)
      confidenceScore: this.adjustConfidenceForSection(result.confidence, section),
      extractionMethod: 'regex',
      documentType,
      sectionName: section,
    };
  }

  /**
   * Create a date extraction.
   */
  private createDateExtraction(
    entityType: string,
    result: DateExtractionResult,
    documentType: string,
    section: DocumentSection
  ): DocumentExtraction {
    return {
      entityType,
      entityValue: result.value,
      entityNormalized: result.parsedDate, // Use parsedDate as normalized ISO format
      confidenceScore: this.adjustConfidenceForSection(result.confidence, section),
      extractionMethod: 'regex',
      documentType,
      sectionName: section,
    };
  }

  /**
   * Create a cutoff extraction.
   */
  private createCutoffExtraction(
    result: CutoffExtractionResult,
    documentType: string,
    section: DocumentSection
  ): DocumentExtraction {
    // CutoffExtractionResult.cutoffType is already the full type name
    return {
      entityType: result.cutoffType,
      entityValue: result.value,
      entityNormalized: result.parsedDate, // Use parsedDate as normalized ISO format
      confidenceScore: this.adjustConfidenceForSection(result.confidence, section),
      extractionMethod: 'regex',
      documentType,
      sectionName: section,
    };
  }

  /**
   * Adjust confidence based on section.
   */
  private adjustConfidenceForSection(
    baseConfidence: number,
    section: DocumentSection
  ): number {
    const boost = SECTION_CONFIDENCE_BOOST[section] || 0;
    return Math.max(0, Math.min(100, baseConfidence + boost));
  }

  /**
   * Deduplicate extractions keeping highest confidence.
   */
  private deduplicateExtractions(
    extractions: DocumentExtraction[]
  ): DocumentExtraction[] {
    const map = new Map<string, DocumentExtraction>();

    for (const extraction of extractions) {
      const key = `${extraction.entityType}:${extraction.entityValue}`;
      const existing = map.get(key);

      if (!existing || extraction.confidenceScore > existing.confidenceScore) {
        map.set(key, extraction);
      }
    }

    return Array.from(map.values());
  }

  /**
   * Calculate average confidence.
   */
  private calculateAverageConfidence(extractions: DocumentExtraction[]): number {
    if (extractions.length === 0) return 0;

    const total = extractions.reduce((sum, e) => sum + e.confidenceScore, 0);
    return Math.round(total / extractions.length);
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createDocumentContentExtractor(): DocumentContentExtractor {
  return new DocumentContentExtractor();
}
