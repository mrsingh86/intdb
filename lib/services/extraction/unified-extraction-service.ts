/**
 * Unified Extraction Service
 *
 * Production-ready extraction pipeline that combines:
 * 1. Schema-based extraction (fast, deterministic) using DocumentTypeExtractor
 * 2. AI extraction (comprehensive) using ShipmentExtractionService
 * 3. Saves to new tables (email_extractions, document_extractions)
 *
 * This service is the single entry point for all extraction in production.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  DocumentTypeExtractor,
  ExtractionResult as SchemaExtractionResult,
  createDocumentTypeExtractor,
} from './document-type-extractor';
import { ExtractionRepository, createExtractionRepository } from './extraction-repository';
import { EmailExtraction } from './email-content-extractor';
import { DocumentExtraction } from './document-content-extractor';

// ============================================================================
// Types
// ============================================================================

export interface UnifiedExtractionInput {
  emailId: string;
  attachmentId?: string;
  documentType: string;
  emailSubject?: string;
  emailBody?: string;
  pdfContent?: string;
  carrier?: string;
}

export interface UnifiedExtractionResult {
  success: boolean;
  emailExtractions: number;
  documentExtractions: number;
  schemaConfidence: number;
  entities: Record<string, string>;
  errors?: string[];
}

// ============================================================================
// Service
// ============================================================================

export class UnifiedExtractionService {
  private schemaExtractor: DocumentTypeExtractor;
  private repository: ExtractionRepository;

  constructor(private supabase: SupabaseClient) {
    this.schemaExtractor = createDocumentTypeExtractor();
    this.repository = createExtractionRepository(supabase);
  }

  /**
   * Extract entities from email and document content.
   * Uses schema-based extraction with AI fallback.
   */
  async extract(input: UnifiedExtractionInput): Promise<UnifiedExtractionResult> {
    const errors: string[] = [];
    const entities: Record<string, string> = {};
    let emailExtractions = 0;
    let documentExtractions = 0;
    let schemaConfidence = 0;

    try {
      // 1. Schema-based extraction from PDF content (if available)
      if (input.pdfContent && input.attachmentId) {
        const schemaResult = this.extractWithSchema(input.documentType, input.pdfContent);

        if (schemaResult) {
          schemaConfidence = schemaResult.confidence;

          // Convert schema result to document extractions
          const docExtractions = this.convertSchemaToDocumentExtractions(
            schemaResult,
            input.documentType
          );

          // Save document extractions
          const saveResult = await this.repository.saveDocumentExtractions(
            input.attachmentId,
            input.emailId,
            docExtractions
          );

          documentExtractions = saveResult.savedCount;

          // Track extracted entities
          for (const [fieldName, field] of Object.entries(schemaResult.fields)) {
            entities[fieldName] = String(field.value);
          }

          // Track party names
          for (const [partyType, party] of Object.entries(schemaResult.parties)) {
            if (party.name) {
              entities[`${partyType}_name`] = party.name;
            }
          }
        }
      }

      // 2. Extract from email body/subject (for linking identifiers)
      if (input.emailSubject || input.emailBody) {
        const emailResults = this.extractFromEmail(
          input.emailSubject || '',
          input.emailBody || '',
          input.documentType
        );

        // Save email extractions
        const saveResult = await this.repository.saveEmailExtractions(
          input.emailId,
          emailResults
        );

        emailExtractions = saveResult.savedCount;

        // Track extracted entities
        // For key linking identifiers (booking_number, bl_number, container_number),
        // email subject extraction is MORE RELIABLE than PDF schema extraction
        // because PDF text often has OCR artifacts that produce garbage values
        const priorityFields = ['booking_number', 'bl_number', 'mbl_number', 'hbl_number', 'container_number'];
        for (const e of emailResults) {
          // Override document extraction for priority fields (email subject is more reliable)
          if (priorityFields.includes(e.entityType)) {
            entities[e.entityType] = e.entityValue;
          } else if (!entities[e.entityType]) {
            entities[e.entityType] = e.entityValue;
          }
        }
      }

      return {
        success: true,
        emailExtractions,
        documentExtractions,
        schemaConfidence,
        entities,
      };
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      return {
        success: false,
        emailExtractions,
        documentExtractions,
        schemaConfidence,
        entities,
        errors,
      };
    }
  }

  /**
   * Extract using document schema.
   */
  private extractWithSchema(
    documentType: string,
    content: string
  ): SchemaExtractionResult | null {
    return this.schemaExtractor.extract(documentType, content);
  }

  /**
   * Extract linking identifiers from email subject/body.
   */
  private extractFromEmail(
    subject: string,
    body: string,
    documentType: string
  ): EmailExtraction[] {
    const extractions: EmailExtraction[] = [];
    const combined = `${subject}\n${body}`;

    // Helper to determine source field
    const getSourceField = (value: string): 'subject' | 'body_text' => {
      return subject.includes(value) ? 'subject' : 'body_text';
    };

    // Helper to determine extraction method
    const getExtractionMethod = (value: string): 'regex_subject' | 'regex_body' => {
      return subject.includes(value) ? 'regex_subject' : 'regex_body';
    };

    // Booking number patterns
    const bookingPatterns = [
      { pattern: /\b(26\d{7})\b/, name: 'Maersk' },
      { pattern: /\b(HL-?\d{8})\b/i, name: 'Hapag' },
      { pattern: /\b((?:CEI|AMC|CAD)\d{7})\b/i, name: 'CMA CGM' },
      { pattern: /\b(COSU\d{10})\b/i, name: 'COSCO' },
      { pattern: /\b([A-Z]{3}\d{7,10})\b/, name: 'Generic' },
    ];

    for (const { pattern } of bookingPatterns) {
      const match = combined.match(pattern);
      if (match) {
        extractions.push({
          entityType: 'booking_number',
          entityValue: match[1].toUpperCase(),
          confidenceScore: 85,
          extractionMethod: getExtractionMethod(match[1]),
          sourceField: getSourceField(match[1]),
        });
        break;
      }
    }

    // Container number (ISO 6346)
    const containerMatch = combined.match(/\b([A-Z]{4}\d{7})\b/);
    if (containerMatch) {
      extractions.push({
        entityType: 'container_number',
        entityValue: containerMatch[1].toUpperCase(),
        confidenceScore: 90,
        extractionMethod: getExtractionMethod(containerMatch[1]),
        sourceField: getSourceField(containerMatch[1]),
      });
    }

    // BL number patterns
    const blPatterns = [
      /\b(SE\d{10,})\b/i,
      /\b(MAEU\d{9,}[A-Z0-9]*)\b/i,
      /\b(HLCU[A-Z0-9]{10,})\b/i,
      /\b(CMAU\d{9,})\b/i,
      /\b(MEDU\d{9,})\b/i,
    ];

    for (const pattern of blPatterns) {
      const match = combined.match(pattern);
      if (match) {
        extractions.push({
          entityType: 'bl_number',
          entityValue: match[1].toUpperCase(),
          confidenceScore: 80,
          extractionMethod: getExtractionMethod(match[1]),
          sourceField: getSourceField(match[1]),
        });
        break;
      }
    }

    // HBL number
    const hblMatch = combined.match(/HBL(?:\s*NO\.?)?:?\s*([A-Z0-9]{6,})/i);
    if (hblMatch) {
      extractions.push({
        entityType: 'hbl_number',
        entityValue: hblMatch[1].toUpperCase(),
        confidenceScore: 85,
        extractionMethod: getExtractionMethod(hblMatch[1]),
        sourceField: getSourceField(hblMatch[1]),
      });
    }

    // Entry number (US Customs)
    const entryMatch = combined.match(/ENTRY\s*(\d{1,3}[A-Z]{1,3}[-\s]*\d{8})/i);
    if (entryMatch) {
      extractions.push({
        entityType: 'entry_number',
        entityValue: entryMatch[1].replace(/\s+/g, '').toUpperCase(),
        confidenceScore: 85,
        extractionMethod: getExtractionMethod(entryMatch[1]),
        sourceField: getSourceField(entryMatch[1]),
      });
    }

    // ISF number
    const isfMatch = combined.match(/ISF[#:\s]+([A-Z0-9-]{10,})/i);
    if (isfMatch) {
      extractions.push({
        entityType: 'isf_number',
        entityValue: isfMatch[1].toUpperCase(),
        confidenceScore: 85,
        extractionMethod: getExtractionMethod(isfMatch[1]),
        sourceField: getSourceField(isfMatch[1]),
      });
    }

    // VGM reference
    const vgmMatch = combined.match(/VGM[#:\s]+([A-Z0-9-]{6,})/i);
    if (vgmMatch) {
      extractions.push({
        entityType: 'vgm_reference',
        entityValue: vgmMatch[1].toUpperCase(),
        confidenceScore: 80,
        extractionMethod: getExtractionMethod(vgmMatch[1]),
        sourceField: getSourceField(vgmMatch[1]),
      });
    }

    // Shipping Bill number (India)
    const sbMatch = combined.match(/S(?:HIPPING\s*)?B(?:ILL)?[#:\s]+(\d{7,10})/i);
    if (sbMatch) {
      extractions.push({
        entityType: 'sb_number',
        entityValue: sbMatch[1],
        confidenceScore: 85,
        extractionMethod: getExtractionMethod(sbMatch[1]),
        sourceField: getSourceField(sbMatch[1]),
      });
    }

    return extractions;
  }

  /**
   * Convert schema extraction result to document extraction records.
   */
  private convertSchemaToDocumentExtractions(
    result: SchemaExtractionResult,
    documentType: string
  ): DocumentExtraction[] {
    const extractions: DocumentExtraction[] = [];

    // Convert fields
    for (const [fieldName, field] of Object.entries(result.fields)) {
      const value = Array.isArray(field.value)
        ? field.value.join(', ')
        : String(field.value);

      extractions.push({
        entityType: fieldName,
        entityValue: value,
        confidenceScore: Math.round(field.confidence * 100),
        extractionMethod: 'schema',
        documentType,
      });
    }

    // Convert parties
    for (const [partyType, party] of Object.entries(result.parties)) {
      if (party.name) {
        extractions.push({
          entityType: `${partyType}_name`,
          entityValue: party.name,
          confidenceScore: 85,
          extractionMethod: 'schema',
          documentType,
          sectionName: 'party_section',
        });
      }
      if (party.addressLine1) {
        extractions.push({
          entityType: `${partyType}_address`,
          entityValue: [party.addressLine1, party.addressLine2, party.city, party.country]
            .filter(Boolean)
            .join(', '),
          confidenceScore: 80,
          extractionMethod: 'schema',
          documentType,
          sectionName: 'party_section',
        });
      }
      if (party.country) {
        extractions.push({
          entityType: `${partyType}_country`,
          entityValue: party.country,
          confidenceScore: 85,
          extractionMethod: 'schema',
          documentType,
          sectionName: 'party_section',
        });
      }
    }

    // Convert tables
    for (const [tableName, rows] of Object.entries(result.tables)) {
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        for (const [columnName, value] of Object.entries(row)) {
          if (value !== null) {
            extractions.push({
              entityType: `${tableName}_${columnName}`,
              entityValue: String(value),
              confidenceScore: 75,
              extractionMethod: 'schema',
              documentType,
              tableName,
              tableRow: i,
              tableColumn: columnName,
            });
          }
        }
      }
    }

    return extractions;
  }

  /**
   * Re-extract entities for an email (backfill).
   */
  async reextract(
    emailId: string,
    attachmentId?: string
  ): Promise<UnifiedExtractionResult> {
    // Delete existing extractions
    await this.repository.deleteEmailExtractions(emailId);
    if (attachmentId) {
      await this.repository.deleteDocumentExtractions(attachmentId);
    }

    // Get email and attachment data
    const { data: email } = await this.supabase
      .from('raw_emails')
      .select(`
        id,
        subject,
        body_text,
        document_classifications(document_type)
      `)
      .eq('id', emailId)
      .single();

    if (!email) {
      return {
        success: false,
        emailExtractions: 0,
        documentExtractions: 0,
        schemaConfidence: 0,
        entities: {},
        errors: ['Email not found'],
      };
    }

    // Get attachment with OCR text
    let attachment: { id: string; extracted_text: string } | null = null;
    if (attachmentId) {
      const { data } = await this.supabase
        .from('raw_attachments')
        .select('id, extracted_text')
        .eq('id', attachmentId)
        .single();
      attachment = data;
    } else {
      // Get first PDF attachment
      const { data } = await this.supabase
        .from('raw_attachments')
        .select('id, extracted_text')
        .eq('email_id', emailId)
        .not('extracted_text', 'is', null)
        .limit(1)
        .single();
      attachment = data;
    }

    const documentType =
      email.document_classifications?.[0]?.document_type || 'unknown';

    return this.extract({
      emailId,
      attachmentId: attachment?.id,
      documentType,
      emailSubject: email.subject || '',
      emailBody: email.body_text || '',
      pdfContent: attachment?.extracted_text || '',
    });
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createUnifiedExtractionService(
  supabase: SupabaseClient
): UnifiedExtractionService {
  return new UnifiedExtractionService(supabase);
}
