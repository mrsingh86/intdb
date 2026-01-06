/**
 * Document Type Extractor
 *
 * Extracts structured data from documents based on their classification.
 * Uses document-specific schemas to extract parties, tables, and fields.
 */

import {
  DocumentExtractionSchema,
  EntityField,
  SectionDefinition,
  TableDefinition,
  PartyInfo,
  getExtractionSchema,
  COUNTRIES,
} from './document-extraction-schemas';

// ============================================================================
// Types
// ============================================================================

export interface ExtractionResult {
  documentType: string;
  fields: Record<string, ExtractedValue>;
  parties: Record<string, PartyInfo>;
  tables: Record<string, TableRow[]>;
  confidence: number;
  extractedAt: string;
}

export interface ExtractedValue {
  value: string | number | string[];
  confidence: number;
  source: 'pattern' | 'section' | 'table';
  rawText?: string;
}

export interface TableRow {
  [column: string]: string | number | null;
}

export interface ExtractionOptions {
  extractParties?: boolean;
  extractTables?: boolean;
  minConfidence?: number;
}

const DEFAULT_OPTIONS: ExtractionOptions = {
  extractParties: true,
  extractTables: true,
  minConfidence: 0.5,
};

// ============================================================================
// Document Type Extractor
// ============================================================================

export class DocumentTypeExtractor {
  /**
   * Extract structured data from document text
   */
  extract(
    documentType: string,
    text: string,
    options: ExtractionOptions = {}
  ): ExtractionResult | null {
    const schema = getExtractionSchema(documentType);
    if (!schema) {
      console.warn(`No extraction schema for document type: ${documentType}`);
      return null;
    }

    const opts = { ...DEFAULT_OPTIONS, ...options };
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

    // Extract fields
    const fields = this.extractFields(schema.fields, text, lines);

    // Extract parties from sections
    const parties: Record<string, PartyInfo> = {};
    if (opts.extractParties && schema.sections.length > 0) {
      for (const section of schema.sections) {
        const sectionText = this.extractSection(section, text);
        if (sectionText) {
          const party = this.parseParty(sectionText);
          if (party && party.name) {
            const fieldName = section.fields[0];
            parties[fieldName] = party;
          }
        }
      }
    }

    // Extract tables
    const tables: Record<string, TableRow[]> = {};
    if (opts.extractTables && schema.tables) {
      for (const tableDef of schema.tables) {
        const tableRows = this.extractTable(tableDef, lines);
        if (tableRows.length > 0) {
          tables[tableDef.name] = tableRows;
        }
      }
    }

    // Calculate overall confidence
    const confidence = this.calculateConfidence(schema, fields, parties, tables);

    return {
      documentType: schema.documentType,
      fields,
      parties,
      tables,
      confidence,
      extractedAt: new Date().toISOString(),
    };
  }

  /**
   * Extract fields using label patterns
   */
  private extractFields(
    fieldDefs: EntityField[],
    text: string,
    lines: string[]
  ): Record<string, ExtractedValue> {
    const fields: Record<string, ExtractedValue> = {};

    for (const fieldDef of fieldDefs) {
      // Skip party fields (handled by section extraction)
      if (fieldDef.type === 'party') continue;

      const extracted = this.extractField(fieldDef, text, lines);
      if (extracted) {
        fields[fieldDef.name] = extracted;
      }
    }

    return fields;
  }

  /**
   * Extract a single field
   */
  private extractField(
    fieldDef: EntityField,
    text: string,
    lines: string[]
  ): ExtractedValue | null {
    // Try each label pattern
    for (const labelPattern of fieldDef.labelPatterns) {
      // Find line containing label
      const matchingLine = lines.find(line => labelPattern.test(line));
      if (!matchingLine) continue;

      // Extract value after label
      const labelMatch = matchingLine.match(labelPattern);
      if (!labelMatch) continue;

      const afterLabel = matchingLine.slice(labelMatch.index! + labelMatch[0].length).trim();

      // If we have value patterns, use them
      if (fieldDef.valuePatterns && fieldDef.valuePatterns.length > 0) {
        for (const valuePattern of fieldDef.valuePatterns) {
          const valueMatch = afterLabel.match(valuePattern) || matchingLine.match(valuePattern);
          if (valueMatch) {
            return {
              value: this.normalizeValue(valueMatch[1] || valueMatch[0], fieldDef.type),
              confidence: 0.9,
              source: 'pattern',
              rawText: matchingLine,
            };
          }
        }
      }

      // If no value patterns, use the text after label
      if (afterLabel) {
        return {
          value: this.normalizeValue(afterLabel, fieldDef.type),
          confidence: 0.7,
          source: 'pattern',
          rawText: matchingLine,
        };
      }

      // Check next line for value
      const lineIndex = lines.indexOf(matchingLine);
      if (lineIndex >= 0 && lineIndex < lines.length - 1) {
        const nextLine = lines[lineIndex + 1];
        // Skip if next line looks like another label
        if (!this.looksLikeLabel(nextLine)) {
          return {
            value: this.normalizeValue(nextLine, fieldDef.type),
            confidence: 0.6,
            source: 'pattern',
            rawText: nextLine,
          };
        }
      }
    }

    // Try global search with value patterns for container, BL numbers etc.
    if (fieldDef.valuePatterns) {
      for (const valuePattern of fieldDef.valuePatterns) {
        const globalMatch = text.match(valuePattern);
        if (globalMatch) {
          return {
            value: this.normalizeValue(globalMatch[1] || globalMatch[0], fieldDef.type),
            confidence: 0.5,
            source: 'pattern',
            rawText: globalMatch[0],
          };
        }
      }
    }

    return null;
  }

  /**
   * Extract section text between markers
   */
  private extractSection(section: SectionDefinition, text: string): string | null {
    const lines = text.split('\n');
    let startIndex = -1;
    let endIndex = lines.length;

    // Find start marker
    for (let i = 0; i < lines.length; i++) {
      if (section.startMarkers.some(m => m.test(lines[i]))) {
        startIndex = i;
        break;
      }
    }

    if (startIndex === -1) return null;

    // Find end marker (after start)
    for (let i = startIndex + 1; i < lines.length; i++) {
      if (section.endMarkers.some(m => m.test(lines[i]))) {
        endIndex = i;
        break;
      }
    }

    // Extract section (skip the header line with section name)
    const sectionLines = lines.slice(startIndex + 1, endIndex);
    return sectionLines.join('\n').trim();
  }

  /**
   * Parse party information from section text
   */
  private parseParty(sectionText: string): PartyInfo | null {
    const lines = sectionText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;

    const party: PartyInfo = { name: '' };

    // First line is usually the company name
    party.name = this.cleanPartyName(lines[0]);

    // Parse remaining lines for address components
    const remainingLines = lines.slice(1);
    const addressLines: string[] = [];

    for (const line of remainingLines) {
      // Check for email
      const emailMatch = line.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
      if (emailMatch) {
        party.email = emailMatch[1].toLowerCase();
        continue;
      }

      // Check for phone
      const phoneMatch = line.match(/(?:TEL|PHONE|PH)?[:\s]*([+\d\s\-()]{10,20})/i);
      if (phoneMatch && !line.includes('@')) {
        party.phone = phoneMatch[1].replace(/\s+/g, '');
        continue;
      }

      // Check for tax ID (GST, VAT, etc.)
      const taxMatch = line.match(/(?:GSTIN?|VAT|TAX\s*ID)[:\s#]*([A-Z0-9]{10,20})/i);
      if (taxMatch) {
        party.taxId = taxMatch[1];
        continue;
      }

      // Check for country (last line often)
      const upperLine = line.toUpperCase();
      const foundCountry = COUNTRIES.find(c => upperLine.includes(c));
      if (foundCountry) {
        party.country = foundCountry;
        // Extract postal code if present
        const postalMatch = line.match(/\b(\d{5,6})\b/);
        if (postalMatch) {
          party.postalCode = postalMatch[1];
        }
        continue;
      }

      // City/State line detection
      const cityStateMatch = line.match(/^([A-Z][a-zA-Z\s]+),?\s*([A-Z]{2})?\s*(\d{5,6})?/);
      if (cityStateMatch && !line.includes('ATTENTION')) {
        party.city = cityStateMatch[1].trim();
        if (cityStateMatch[2]) party.state = cityStateMatch[2];
        if (cityStateMatch[3]) party.postalCode = cityStateMatch[3];
        continue;
      }

      // Otherwise treat as address line
      if (line.length > 0 && !line.toUpperCase().startsWith('ATTENTION')) {
        addressLines.push(line);
      }
    }

    // Assign address lines
    if (addressLines.length > 0) {
      party.addressLine1 = addressLines[0];
      if (addressLines.length > 1) {
        party.addressLine2 = addressLines.slice(1).join(', ');
      }
    }

    return party.name ? party : null;
  }

  /**
   * Clean party name (remove common suffixes that shouldn't be in name)
   */
  private cleanPartyName(name: string): string {
    return name
      .replace(/\s*[-:]\s*$/, '')  // Remove trailing colon/dash
      .replace(/ATTN[:\s].*/i, '') // Remove ATTN:
      .replace(/ATTENTION[:\s].*/i, '')
      .trim();
  }

  /**
   * Extract table data
   */
  private extractTable(tableDef: TableDefinition, lines: string[]): TableRow[] {
    const rows: TableRow[] = [];

    // Find header row
    let headerIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (tableDef.headerPatterns.some(p => p.test(lines[i]))) {
        headerIndex = i;
        break;
      }
    }

    if (headerIndex === -1) return rows;

    // Detect column positions from header
    const headerLine = lines[headerIndex];
    const columnPositions = this.detectColumnPositions(headerLine, tableDef.columns);

    // Extract data rows (until we hit a non-data row)
    for (let i = headerIndex + 1; i < lines.length; i++) {
      const line = lines[i];

      // Stop at summary/total lines
      if (/^\s*(TOTAL|SUBTOTAL|GRAND\s*TOTAL|NET\s*AMOUNT)/i.test(line)) break;
      if (line.length < 10) continue;  // Skip short lines

      // Parse row using detected columns
      const row = this.parseTableRow(line, tableDef.columns, columnPositions);
      if (row && Object.values(row).some(v => v !== null)) {
        rows.push(row);
      }
    }

    return rows;
  }

  /**
   * Detect column positions from header line
   */
  private detectColumnPositions(
    headerLine: string,
    columns: { name: string; headerPatterns: RegExp[] }[]
  ): Map<string, { start: number; end: number }> {
    const positions = new Map<string, { start: number; end: number }>();
    const upperHeader = headerLine.toUpperCase();

    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      for (const pattern of col.headerPatterns) {
        const match = upperHeader.match(pattern);
        if (match && match.index !== undefined) {
          const start = match.index;
          // End is either next column start or end of line
          const nextCol = columns[i + 1];
          let end = headerLine.length;

          if (nextCol) {
            for (const nextPattern of nextCol.headerPatterns) {
              const nextMatch = upperHeader.match(nextPattern);
              if (nextMatch && nextMatch.index !== undefined) {
                end = nextMatch.index;
                break;
              }
            }
          }

          positions.set(col.name, { start, end });
          break;
        }
      }
    }

    return positions;
  }

  /**
   * Parse a table row using column positions
   */
  private parseTableRow(
    line: string,
    columns: { name: string; type: string }[],
    positions: Map<string, { start: number; end: number }>
  ): TableRow {
    const row: TableRow = {};

    // Try position-based extraction
    for (const col of columns) {
      const pos = positions.get(col.name);
      if (pos) {
        const value = line.slice(pos.start, pos.end).trim();
        row[col.name] = this.parseTableValue(value, col.type);
      } else {
        row[col.name] = null;
      }
    }

    // If position-based failed, try splitting by whitespace
    if (Object.values(row).every(v => v === null || v === '')) {
      const parts = line.split(/\s{2,}/).map(p => p.trim()).filter(Boolean);
      for (let i = 0; i < Math.min(parts.length, columns.length); i++) {
        row[columns[i].name] = this.parseTableValue(parts[i], columns[i].type);
      }
    }

    return row;
  }

  /**
   * Parse table cell value based on type
   */
  private parseTableValue(value: string, type: string): string | number | null {
    if (!value || value === '-' || value === 'N/A') return null;

    switch (type) {
      case 'number':
        const num = parseFloat(value.replace(/,/g, ''));
        return isNaN(num) ? null : num;

      case 'amount':
        // Remove currency symbols and parse
        const amount = parseFloat(value.replace(/[^0-9.-]/g, ''));
        return isNaN(amount) ? null : amount;

      case 'weight':
        // Extract numeric part
        const weightMatch = value.match(/([\d,]+\.?\d*)/);
        if (weightMatch) {
          return parseFloat(weightMatch[1].replace(/,/g, ''));
        }
        return null;

      default:
        return value;
    }
  }

  /**
   * Normalize extracted value based on type
   */
  private normalizeValue(value: string, type: string): string | number | string[] {
    value = value.trim();

    switch (type) {
      case 'date':
        return this.normalizeDate(value);

      case 'number':
        const num = parseFloat(value.replace(/,/g, ''));
        return isNaN(num) ? value : num;

      case 'amount':
        // Keep as string with currency for now
        return value;

      case 'weight':
        return value.replace(/\s+/g, ' ');

      case 'volume':
        return value.replace(/\s+/g, ' ');

      case 'container':
        // Extract all container numbers
        const containers = value.match(/[A-Z]{4}\d{7}/g);
        return containers ? (containers.length === 1 ? containers[0] : containers) : value;

      default:
        return value;
    }
  }

  /**
   * Normalize date to ISO format
   */
  private normalizeDate(dateStr: string): string {
    // Try common formats
    const formats = [
      // DD-MMM-YY
      /(\d{1,2})[-/](\w{3})[-/](\d{2,4})/i,
      // YYYY-MM-DD
      /(\d{4})-(\d{2})-(\d{2})/,
      // DD/MM/YYYY
      /(\d{1,2})\/(\d{1,2})\/(\d{4})/,
      // DD MMM YYYY
      /(\d{1,2})\s+(\w{3})\s+(\d{4})/i,
    ];

    const monthMap: Record<string, string> = {
      'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04',
      'may': '05', 'jun': '06', 'jul': '07', 'aug': '08',
      'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12',
    };

    for (const format of formats) {
      const match = dateStr.match(format);
      if (match) {
        if (format === formats[1]) {
          // Already YYYY-MM-DD
          return dateStr;
        } else if (format === formats[0] || format === formats[3]) {
          // DD-MMM-YY or DD MMM YYYY
          const day = match[1].padStart(2, '0');
          const month = monthMap[match[2].toLowerCase().slice(0, 3)] || '01';
          let year = match[3];
          if (year.length === 2) {
            year = parseInt(year) > 50 ? `19${year}` : `20${year}`;
          }
          return `${year}-${month}-${day}`;
        } else if (format === formats[2]) {
          // DD/MM/YYYY
          const [, d, m, y] = match;
          return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        }
      }
    }

    return dateStr; // Return as-is if no format matched
  }

  /**
   * Check if a line looks like a label
   */
  private looksLikeLabel(line: string): boolean {
    // Common label patterns
    return /^[A-Z][A-Z\s]+[:\s]*$/i.test(line) ||
           /^\d+\.\s+[A-Z]/i.test(line) ||
           /^(SHIPPER|CONSIGNEE|NOTIFY|VESSEL|PORT|DATE|WEIGHT|CONTAINER)/i.test(line);
  }

  /**
   * Calculate overall extraction confidence
   */
  private calculateConfidence(
    schema: DocumentExtractionSchema,
    fields: Record<string, ExtractedValue>,
    parties: Record<string, PartyInfo>,
    tables: Record<string, TableRow[]>
  ): number {
    const requiredFields = schema.fields.filter(f => f.required);
    const extractedRequired = requiredFields.filter(f =>
      fields[f.name] || parties[f.name]
    ).length;

    const fieldConfidence = requiredFields.length > 0
      ? extractedRequired / requiredFields.length
      : 1;

    // Bonus for extracted parties and tables
    const partyBonus = Object.keys(parties).length > 0 ? 0.1 : 0;
    const tableBonus = Object.keys(tables).length > 0 ? 0.1 : 0;

    return Math.min(1, fieldConfidence + partyBonus + tableBonus);
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create extractor instance
 */
export function createDocumentTypeExtractor(): DocumentTypeExtractor {
  return new DocumentTypeExtractor();
}

/**
 * Quick extraction helper
 */
export function extractFromDocument(
  documentType: string,
  text: string,
  options?: ExtractionOptions
): ExtractionResult | null {
  const extractor = new DocumentTypeExtractor();
  return extractor.extract(documentType, text, options);
}
