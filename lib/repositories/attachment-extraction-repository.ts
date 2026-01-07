/**
 * Attachment Extraction Repository
 *
 * Handles database operations for attachment/document-level extractions.
 * Extracts entities from PDF attachments with positional data.
 *
 * Part of the split architecture:
 * - email_extractions: Email-level (EmailExtractionRepository)
 * - document_extractions: Attachment-level (this)
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

export interface AttachmentExtractionRecord {
  id: string;
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
  is_latest_revision: boolean;
  is_valid: boolean;
  validation_errors?: Record<string, unknown>;
  is_correct?: boolean;
  corrected_value?: string;
  feedback_by?: string;
  feedback_at?: string;
  extracted_at: string;
  created_at: string;
}

export interface AttachmentExtractionInput {
  entity_type: string;
  entity_value: string;
  entity_normalized?: string;
  confidence_score: number;
  extraction_method: string;
  document_type: string;
  page_number?: number;
  section_name?: string;
  table_name?: string;
  table_row?: number;
  table_column?: string;
  bbox_x1?: number;
  bbox_y1?: number;
  bbox_x2?: number;
  bbox_y2?: number;
}

// ============================================================================
// Repository
// ============================================================================

export class AttachmentExtractionRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Save attachment extractions (idempotent upsert)
   */
  async upsert(
    attachmentId: string,
    emailId: string,
    extractions: AttachmentExtractionInput[]
  ): Promise<{ savedCount: number; errors?: string[] }> {
    if (extractions.length === 0) {
      return { savedCount: 0 };
    }

    const records = extractions.map((e) => ({
      attachment_id: attachmentId,
      email_id: emailId,
      entity_type: e.entity_type,
      entity_value: e.entity_value,
      entity_normalized: e.entity_normalized,
      page_number: e.page_number,
      section_name: e.section_name,
      table_name: e.table_name,
      table_row: e.table_row,
      table_column: e.table_column,
      bbox_x1: e.bbox_x1,
      bbox_y1: e.bbox_y1,
      bbox_x2: e.bbox_x2,
      bbox_y2: e.bbox_y2,
      confidence_score: e.confidence_score,
      extraction_method: e.extraction_method,
      document_type: e.document_type,
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
      console.error('[AttachmentExtractionRepository] Error saving:', error);
      return { savedCount: 0, errors: [error.message] };
    }

    return { savedCount: data?.length || 0 };
  }

  /**
   * Find all extractions for an attachment
   */
  async findByAttachmentId(attachmentId: string): Promise<AttachmentExtractionRecord[]> {
    const { data, error } = await this.supabase
      .from('document_extractions')
      .select('*')
      .eq('attachment_id', attachmentId)
      .eq('is_valid', true)
      .order('confidence_score', { ascending: false });

    if (error) {
      throw new Error(`Failed to find attachment extractions: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Find all extractions for an email (across all attachments)
   */
  async findByEmailId(emailId: string): Promise<AttachmentExtractionRecord[]> {
    const { data, error } = await this.supabase
      .from('document_extractions')
      .select('*')
      .eq('email_id', emailId)
      .eq('is_valid', true)
      .order('confidence_score', { ascending: false });

    if (error) {
      throw new Error(`Failed to find document extractions: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Find extractions by entity type for an attachment
   */
  async findByAttachmentIdAndType(
    attachmentId: string,
    entityType: string
  ): Promise<AttachmentExtractionRecord[]> {
    const { data, error } = await this.supabase
      .from('document_extractions')
      .select('*')
      .eq('attachment_id', attachmentId)
      .eq('entity_type', entityType)
      .eq('is_valid', true)
      .order('confidence_score', { ascending: false });

    if (error) {
      throw new Error(`Failed to find extractions: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get best extraction value for a specific entity type
   */
  async getBestValue(
    attachmentId: string,
    entityType: string
  ): Promise<string | null> {
    const { data } = await this.supabase
      .from('document_extractions')
      .select('entity_value, entity_normalized')
      .eq('attachment_id', attachmentId)
      .eq('entity_type', entityType)
      .eq('is_valid', true)
      .order('confidence_score', { ascending: false })
      .limit(1)
      .maybeSingle();

    return data?.entity_normalized || data?.entity_value || null;
  }

  /**
   * Delete all extractions for an attachment (for re-extraction)
   */
  async deleteByAttachmentId(attachmentId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('document_extractions')
      .delete()
      .eq('attachment_id', attachmentId);

    if (error) {
      console.error('[AttachmentExtractionRepository] Error deleting:', error);
      return false;
    }

    return true;
  }

  /**
   * Delete all extractions for an email (all attachments)
   */
  async deleteByEmailId(emailId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('document_extractions')
      .delete()
      .eq('email_id', emailId);

    if (error) {
      console.error('[AttachmentExtractionRepository] Error deleting:', error);
      return false;
    }

    return true;
  }

  /**
   * Mark extraction as invalid
   */
  async invalidate(
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

    return !error;
  }

  /**
   * Add feedback to an extraction
   */
  async addFeedback(
    id: string,
    isCorrect: boolean,
    correctedValue?: string,
    userId?: string
  ): Promise<boolean> {
    const { error } = await this.supabase
      .from('document_extractions')
      .update({
        is_correct: isCorrect,
        corrected_value: correctedValue,
        feedback_by: userId,
        feedback_at: new Date().toISOString(),
      })
      .eq('id', id);

    return !error;
  }

  /**
   * Check if attachment has been extracted
   */
  async hasExtractions(attachmentId: string): Promise<boolean> {
    const { count } = await this.supabase
      .from('document_extractions')
      .select('id', { count: 'exact', head: true })
      .eq('attachment_id', attachmentId);

    return (count || 0) > 0;
  }

  /**
   * Get extraction count by attachment
   */
  async getCount(attachmentId: string): Promise<number> {
    const { count } = await this.supabase
      .from('document_extractions')
      .select('id', { count: 'exact', head: true })
      .eq('attachment_id', attachmentId)
      .eq('is_valid', true);

    return count || 0;
  }

  /**
   * Find extractions by page number
   */
  async findByPage(
    attachmentId: string,
    pageNumber: number
  ): Promise<AttachmentExtractionRecord[]> {
    const { data, error } = await this.supabase
      .from('document_extractions')
      .select('*')
      .eq('attachment_id', attachmentId)
      .eq('page_number', pageNumber)
      .eq('is_valid', true)
      .order('confidence_score', { ascending: false });

    if (error) {
      throw new Error(`Failed to find page extractions: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Find extractions for multiple email IDs
   */
  async findByEmailIds(emailIds: string[]): Promise<AttachmentExtractionRecord[]> {
    if (emailIds.length === 0) return [];

    const { data, error } = await this.supabase
      .from('document_extractions')
      .select('*')
      .in('email_id', emailIds)
      .eq('is_valid', true);

    if (error) {
      throw new Error(`Failed to find attachment extractions: ${error.message}`);
    }

    return data || [];
  }
}
