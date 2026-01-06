/**
 * Extraction Repository
 *
 * Handles database operations for the separated extraction tables:
 * - email_extractions: Entities from email subject/body
 * - document_extractions: Entities from PDF attachments
 *
 * Provides unified query interface via views.
 *
 * Single Responsibility: Database operations for extraction storage only.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { EmailExtraction } from './email-content-extractor';
import { DocumentExtraction } from './document-content-extractor';

// ============================================================================
// Types
// ============================================================================

export interface EmailExtractionRecord {
  id?: string;
  email_id: string;
  entity_type: string;
  entity_value: string;
  entity_normalized?: string;
  confidence_score: number;
  extraction_method: string;
  source_field: string;
  context_snippet?: string;
  position_start?: number;
  position_end?: number;
  is_from_reply?: boolean;
  thread_position?: number;
  is_valid?: boolean;
  validation_errors?: Record<string, unknown>;
  extracted_at?: string;
}

export interface DocumentExtractionRecord {
  id?: string;
  attachment_id: string;
  email_id: string;
  entity_type: string;
  entity_value: string;
  entity_normalized?: string;
  page_number?: number;
  section_name?: string;
  table_name?: string;
  table_row?: number;
  table_column?: string;
  bbox_x1?: number;
  bbox_y1?: number;
  bbox_x2?: number;
  bbox_y2?: number;
  confidence_score: number;
  extraction_method: string;
  document_type: string;
  document_revision?: number;
  is_latest_revision?: boolean;
  is_valid?: boolean;
  validation_errors?: Record<string, unknown>;
  extracted_at?: string;
}

export interface UnifiedExtraction {
  id: string;
  email_id: string;
  attachment_id?: string;
  entity_type: string;
  entity_value: string;
  entity_normalized?: string;
  confidence_score: number;
  extraction_method: string;
  source_type: 'email' | 'document';
  source_detail?: string;
  document_type?: string;
  page_number?: number;
  section_name?: string;
  is_valid: boolean;
  extracted_at: string;
}

export interface ShipmentEntity {
  email_id: string;
  entity_type: string;
  entity_value: string;
  entity_normalized?: string;
  confidence_score: number;
  source_type: 'email' | 'document';
  document_type?: string;
}

export interface SaveResult {
  success: boolean;
  savedCount: number;
  skippedCount: number;
  errors?: string[];
}

// ============================================================================
// Repository
// ============================================================================

export class ExtractionRepository {
  constructor(private supabase: SupabaseClient) {}

  // ==========================================================================
  // Email Extractions
  // ==========================================================================

  /**
   * Save email extractions to the database.
   * Uses upsert to handle duplicates.
   */
  async saveEmailExtractions(
    emailId: string,
    extractions: EmailExtraction[]
  ): Promise<SaveResult> {
    if (extractions.length === 0) {
      return { success: true, savedCount: 0, skippedCount: 0 };
    }

    const records: EmailExtractionRecord[] = extractions.map((e) => ({
      email_id: emailId,
      entity_type: e.entityType,
      entity_value: e.entityValue,
      entity_normalized: e.entityNormalized,
      confidence_score: e.confidenceScore,
      extraction_method: e.extractionMethod,
      source_field: e.sourceField,
      context_snippet: e.contextSnippet,
      position_start: e.positionStart,
      position_end: e.positionEnd,
      is_from_reply: e.isFromReply,
      thread_position: e.threadPosition,
      is_valid: true,
      extracted_at: new Date().toISOString(),
    }));

    const { data, error } = await this.supabase
      .from('email_extractions')
      .upsert(records, {
        onConflict: 'email_id,entity_type,entity_value',
        ignoreDuplicates: false,
      })
      .select('id');

    if (error) {
      console.error('[ExtractionRepository] Error saving email extractions:', error);
      return {
        success: false,
        savedCount: 0,
        skippedCount: extractions.length,
        errors: [error.message],
      };
    }

    return {
      success: true,
      savedCount: data?.length || 0,
      skippedCount: extractions.length - (data?.length || 0),
    };
  }

  /**
   * Get email extractions for an email.
   */
  async getEmailExtractions(emailId: string): Promise<EmailExtractionRecord[]> {
    const { data, error } = await this.supabase
      .from('email_extractions')
      .select('*')
      .eq('email_id', emailId)
      .eq('is_valid', true)
      .order('confidence_score', { ascending: false });

    if (error) {
      console.error('[ExtractionRepository] Error fetching email extractions:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Delete email extractions for re-extraction.
   */
  async deleteEmailExtractions(emailId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('email_extractions')
      .delete()
      .eq('email_id', emailId);

    if (error) {
      console.error('[ExtractionRepository] Error deleting email extractions:', error);
      return false;
    }

    return true;
  }

  // ==========================================================================
  // Document Extractions
  // ==========================================================================

  /**
   * Save document extractions to the database.
   */
  async saveDocumentExtractions(
    attachmentId: string,
    emailId: string,
    extractions: DocumentExtraction[]
  ): Promise<SaveResult> {
    if (extractions.length === 0) {
      return { success: true, savedCount: 0, skippedCount: 0 };
    }

    const records: DocumentExtractionRecord[] = extractions.map((e) => ({
      attachment_id: attachmentId,
      email_id: emailId,
      entity_type: e.entityType,
      entity_value: e.entityValue,
      entity_normalized: e.entityNormalized,
      page_number: e.pageNumber,
      section_name: e.sectionName,
      table_name: e.tableName,
      table_row: e.tableRow,
      table_column: e.tableColumn,
      bbox_x1: e.bboxX1,
      bbox_y1: e.bboxY1,
      bbox_x2: e.bboxX2,
      bbox_y2: e.bboxY2,
      confidence_score: e.confidenceScore,
      extraction_method: e.extractionMethod,
      document_type: e.documentType,
      document_revision: 1,
      is_latest_revision: true,
      is_valid: true,
      extracted_at: new Date().toISOString(),
    }));

    const { data, error } = await this.supabase
      .from('document_extractions')
      .upsert(records, {
        onConflict: 'attachment_id,entity_type,entity_value,page_number',
        ignoreDuplicates: false,
      })
      .select('id');

    if (error) {
      console.error('[ExtractionRepository] Error saving document extractions:', error);
      return {
        success: false,
        savedCount: 0,
        skippedCount: extractions.length,
        errors: [error.message],
      };
    }

    return {
      success: true,
      savedCount: data?.length || 0,
      skippedCount: extractions.length - (data?.length || 0),
    };
  }

  /**
   * Get document extractions for an attachment.
   */
  async getDocumentExtractions(
    attachmentId: string
  ): Promise<DocumentExtractionRecord[]> {
    const { data, error } = await this.supabase
      .from('document_extractions')
      .select('*')
      .eq('attachment_id', attachmentId)
      .eq('is_valid', true)
      .order('confidence_score', { ascending: false });

    if (error) {
      console.error('[ExtractionRepository] Error fetching document extractions:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Get all document extractions for an email.
   */
  async getDocumentExtractionsForEmail(
    emailId: string
  ): Promise<DocumentExtractionRecord[]> {
    const { data, error } = await this.supabase
      .from('document_extractions')
      .select('*')
      .eq('email_id', emailId)
      .eq('is_valid', true)
      .order('confidence_score', { ascending: false });

    if (error) {
      console.error('[ExtractionRepository] Error fetching document extractions:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Delete document extractions for re-extraction.
   */
  async deleteDocumentExtractions(attachmentId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('document_extractions')
      .delete()
      .eq('attachment_id', attachmentId);

    if (error) {
      console.error('[ExtractionRepository] Error deleting document extractions:', error);
      return false;
    }

    return true;
  }

  // ==========================================================================
  // Unified Queries (via views)
  // ==========================================================================

  /**
   * Get all extractions for an email (unified view).
   */
  async getUnifiedExtractions(emailId: string): Promise<UnifiedExtraction[]> {
    const { data, error } = await this.supabase
      .from('unified_extractions')
      .select('*')
      .eq('email_id', emailId)
      .order('confidence_score', { ascending: false });

    if (error) {
      console.error('[ExtractionRepository] Error fetching unified extractions:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Get best entities per type for an email (shipment_entities view).
   */
  async getShipmentEntities(emailId: string): Promise<ShipmentEntity[]> {
    const { data, error } = await this.supabase
      .from('shipment_entities')
      .select('*')
      .eq('email_id', emailId);

    if (error) {
      console.error('[ExtractionRepository] Error fetching shipment entities:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Get all entities of a specific type across emails.
   */
  async getEntitiesByType(
    entityType: string,
    limit = 100
  ): Promise<UnifiedExtraction[]> {
    const { data, error } = await this.supabase
      .from('unified_extractions')
      .select('*')
      .eq('entity_type', entityType)
      .eq('is_valid', true)
      .order('confidence_score', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[ExtractionRepository] Error fetching entities by type:', error);
      return [];
    }

    return data || [];
  }

  /**
   * Search for entities by value pattern.
   */
  async searchEntities(
    pattern: string,
    entityTypes?: string[]
  ): Promise<UnifiedExtraction[]> {
    let query = this.supabase
      .from('unified_extractions')
      .select('*')
      .ilike('entity_value', `%${pattern}%`)
      .eq('is_valid', true)
      .order('confidence_score', { ascending: false })
      .limit(50);

    if (entityTypes && entityTypes.length > 0) {
      query = query.in('entity_type', entityTypes);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[ExtractionRepository] Error searching entities:', error);
      return [];
    }

    return data || [];
  }

  // ==========================================================================
  // Validation & Feedback
  // ==========================================================================

  /**
   * Mark an email extraction as invalid.
   */
  async invalidateEmailExtraction(
    id: string,
    errors?: Record<string, unknown>
  ): Promise<boolean> {
    const { error } = await this.supabase
      .from('email_extractions')
      .update({
        is_valid: false,
        validation_errors: errors || {},
      })
      .eq('id', id);

    if (error) {
      console.error('[ExtractionRepository] Error invalidating email extraction:', error);
      return false;
    }

    return true;
  }

  /**
   * Mark a document extraction as invalid.
   */
  async invalidateDocumentExtraction(
    id: string,
    errors?: Record<string, unknown>
  ): Promise<boolean> {
    const { error } = await this.supabase
      .from('document_extractions')
      .update({
        is_valid: false,
        validation_errors: errors || {},
      })
      .eq('id', id);

    if (error) {
      console.error('[ExtractionRepository] Error invalidating document extraction:', error);
      return false;
    }

    return true;
  }

  /**
   * Add human feedback to an extraction.
   */
  async addFeedback(
    table: 'email_extractions' | 'document_extractions',
    id: string,
    isCorrect: boolean,
    correctedValue?: string,
    userId?: string
  ): Promise<boolean> {
    const { error } = await this.supabase
      .from(table)
      .update({
        is_correct: isCorrect,
        corrected_value: correctedValue,
        feedback_by: userId,
        feedback_at: new Date().toISOString(),
      })
      .eq('id', id);

    if (error) {
      console.error(`[ExtractionRepository] Error adding feedback to ${table}:`, error);
      return false;
    }

    return true;
  }

  // ==========================================================================
  // Migration Support
  // ==========================================================================

  /**
   * Check if an email has been migrated to new tables.
   */
  async isMigrated(emailId: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('email_extractions')
      .select('id', { count: 'exact', head: true })
      .eq('email_id', emailId);

    if (error) {
      return false;
    }

    return (count || 0) > 0;
  }

  /**
   * Get extraction statistics for an email.
   */
  async getExtractionStats(emailId: string): Promise<{
    emailCount: number;
    documentCount: number;
    uniqueTypes: string[];
    avgConfidence: number;
  }> {
    const [emailExtractions, documentExtractions] = await Promise.all([
      this.getEmailExtractions(emailId),
      this.getDocumentExtractionsForEmail(emailId),
    ]);

    const allExtractions = [...emailExtractions, ...documentExtractions];
    const typesSet = new Set(allExtractions.map((e) => e.entity_type));
    const uniqueTypes = Array.from(typesSet);
    const avgConfidence =
      allExtractions.length > 0
        ? allExtractions.reduce((sum, e) => sum + e.confidence_score, 0) /
          allExtractions.length
        : 0;

    return {
      emailCount: emailExtractions.length,
      documentCount: documentExtractions.length,
      uniqueTypes,
      avgConfidence: Math.round(avgConfidence),
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createExtractionRepository(
  supabase: SupabaseClient
): ExtractionRepository {
  return new ExtractionRepository(supabase);
}
