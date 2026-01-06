/**
 * Document Extraction Orchestrator
 *
 * Combines document classification with document-type-aware extraction.
 * Takes raw attachment text and extracts structured entities based on document type.
 *
 * Pipeline:
 * 1. Raw text from attachment → Classification (AI) → Document Type
 * 2. Document Type + Raw text → Schema-based Extraction → Structured entities
 *
 * Follows Single Responsibility and Deep Modules patterns.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  DocumentTypeExtractor,
  ExtractionResult,
  ExtractionOptions,
} from './document-type-extractor';
import { getExtractionSchema, getSupportedDocumentTypes } from './document-extraction-schemas';

// ============================================================================
// Types
// ============================================================================

export interface DocumentExtractionInput {
  attachmentId: string;
  extractedText: string;
  documentType?: string;       // If already classified
  filename?: string;
  mimeType?: string;
}

export interface OrchestrationResult {
  success: boolean;
  attachmentId: string;
  documentType?: string;
  extraction?: ExtractionResult;
  savedToDb: boolean;
  error?: string;
}

export interface DocumentEntityRecord {
  raw_attachment_id: string;
  document_type: string;
  extraction_confidence: number;
  fields: Record<string, unknown>;
  parties: Record<string, unknown>;
  tables: Record<string, unknown[]>;
  extracted_at: string;
}

// ============================================================================
// Orchestrator
// ============================================================================

export class DocumentExtractionOrchestrator {
  private extractor: DocumentTypeExtractor;
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.extractor = new DocumentTypeExtractor();
  }

  /**
   * Process a single document
   *
   * @param input - Document extraction input
   * @param options - Extraction options
   * @returns Orchestration result with extracted entities
   */
  async processDocument(
    input: DocumentExtractionInput,
    options?: ExtractionOptions
  ): Promise<OrchestrationResult> {
    try {
      // Get document type (from input or lookup from classification)
      const documentType = input.documentType || await this.lookupDocumentType(input.attachmentId);

      if (!documentType) {
        return {
          success: false,
          attachmentId: input.attachmentId,
          savedToDb: false,
          error: 'Document type not available for extraction',
        };
      }

      // Check if schema exists for this document type
      const schema = getExtractionSchema(documentType);
      if (!schema) {
        return {
          success: false,
          attachmentId: input.attachmentId,
          documentType,
          savedToDb: false,
          error: `No extraction schema for document type: ${documentType}`,
        };
      }

      // Extract entities
      const extraction = this.extractor.extract(documentType, input.extractedText, options);

      if (!extraction) {
        return {
          success: false,
          attachmentId: input.attachmentId,
          documentType,
          savedToDb: false,
          error: 'Extraction failed',
        };
      }

      // Save to database
      const saved = await this.saveExtraction(input.attachmentId, documentType, extraction);

      return {
        success: true,
        attachmentId: input.attachmentId,
        documentType,
        extraction,
        savedToDb: saved,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        attachmentId: input.attachmentId,
        savedToDb: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Process multiple documents in batch
   */
  async processBatch(
    inputs: DocumentExtractionInput[],
    options?: ExtractionOptions
  ): Promise<OrchestrationResult[]> {
    const results: OrchestrationResult[] = [];

    for (const input of inputs) {
      const result = await this.processDocument(input, options);
      results.push(result);
    }

    return results;
  }

  /**
   * Process all unprocessed attachments with known document types
   */
  async processUnextractedAttachments(limit: number = 100): Promise<{
    processed: number;
    successful: number;
    failed: number;
    results: OrchestrationResult[];
  }> {
    // Get attachments that have been classified but not extracted
    const { data: attachments, error } = await this.supabase
      .from('raw_attachments')
      .select(`
        id,
        extracted_text,
        filename,
        mime_type,
        document_classifications!inner(
          document_type
        )
      `)
      .not('extracted_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch attachments: ${error.message}`);
    }

    const results: OrchestrationResult[] = [];

    for (const attachment of attachments || []) {
      const classification = Array.isArray(attachment.document_classifications)
        ? attachment.document_classifications[0]
        : attachment.document_classifications;

      if (!classification?.document_type) continue;

      // Check if already extracted
      const { data: existing } = await this.supabase
        .from('document_entity_extractions')
        .select('id')
        .eq('raw_attachment_id', attachment.id)
        .single();

      if (existing) continue; // Skip already processed

      const result = await this.processDocument({
        attachmentId: attachment.id,
        extractedText: attachment.extracted_text,
        documentType: classification.document_type,
        filename: attachment.filename,
        mimeType: attachment.mime_type,
      });

      results.push(result);
    }

    return {
      processed: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    };
  }

  /**
   * Look up document type from classification table
   */
  private async lookupDocumentType(attachmentId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('document_classifications')
      .select('document_type')
      .eq('raw_attachment_id', attachmentId)
      .order('confidence', { ascending: false })
      .limit(1)
      .single();

    return data?.document_type || null;
  }

  /**
   * Save extraction results to database
   */
  private async saveExtraction(
    attachmentId: string,
    documentType: string,
    extraction: ExtractionResult
  ): Promise<boolean> {
    try {
      // Convert fields to plain objects
      const fieldsData: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(extraction.fields)) {
        fieldsData[key] = value.value;
      }

      const record: DocumentEntityRecord = {
        raw_attachment_id: attachmentId,
        document_type: documentType,
        extraction_confidence: extraction.confidence,
        fields: fieldsData,
        parties: extraction.parties,
        tables: extraction.tables,
        extracted_at: extraction.extractedAt,
      };

      const { error } = await this.supabase
        .from('document_entity_extractions')
        .upsert(record, {
          onConflict: 'raw_attachment_id',
        });

      if (error) {
        console.error('[DocumentExtractionOrchestrator] Save failed:', error.message);
        return false;
      }

      return true;
    } catch (err) {
      console.error('[DocumentExtractionOrchestrator] Save error:', err);
      return false;
    }
  }

  /**
   * Get extraction statistics
   */
  async getExtractionStats(): Promise<{
    totalClassified: number;
    totalExtracted: number;
    byDocumentType: Record<string, { classified: number; extracted: number }>;
  }> {
    // Get classification counts
    const { data: classifications } = await this.supabase
      .from('document_classifications')
      .select('document_type')
      .not('document_type', 'is', null);

    // Get extraction counts
    const { data: extractions } = await this.supabase
      .from('document_entity_extractions')
      .select('document_type');

    const classificationCounts = new Map<string, number>();
    const extractionCounts = new Map<string, number>();

    for (const c of classifications || []) {
      const type = c.document_type;
      classificationCounts.set(type, (classificationCounts.get(type) || 0) + 1);
    }

    for (const e of extractions || []) {
      const type = e.document_type;
      extractionCounts.set(type, (extractionCounts.get(type) || 0) + 1);
    }

    const byDocumentType: Record<string, { classified: number; extracted: number }> = {};
    const allTypes = new Set([
      ...Array.from(classificationCounts.keys()),
      ...Array.from(extractionCounts.keys())
    ]);

    Array.from(allTypes).forEach(type => {
      byDocumentType[type] = {
        classified: classificationCounts.get(type) || 0,
        extracted: extractionCounts.get(type) || 0,
      };
    });

    return {
      totalClassified: classifications?.length || 0,
      totalExtracted: extractions?.length || 0,
      byDocumentType,
    };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create orchestrator instance
 */
export function createDocumentExtractionOrchestrator(
  supabase: SupabaseClient
): DocumentExtractionOrchestrator {
  return new DocumentExtractionOrchestrator(supabase);
}

/**
 * Check if document type supports extraction
 */
export function supportsExtraction(documentType: string): boolean {
  return !!getExtractionSchema(documentType);
}

/**
 * Get list of document types that support extraction
 */
export function getExtractableDocumentTypes(): string[] {
  return getSupportedDocumentTypes();
}
