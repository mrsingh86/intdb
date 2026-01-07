/**
 * Email Extraction Repository
 *
 * Handles database operations for email-level extractions.
 * Extracts entities from email subject and body text.
 *
 * Part of the split architecture:
 * - email_extractions: Email-level (this)
 * - document_extractions: Attachment-level (AttachmentExtractionRepository)
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

export interface EmailExtractionRecord {
  id: string;
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
  is_valid: boolean;
  validation_errors?: Record<string, unknown>;
  is_correct?: boolean;
  corrected_value?: string;
  feedback_by?: string;
  feedback_at?: string;
  extracted_at: string;
  created_at: string;
}

export interface EmailExtractionInput {
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
}

// ============================================================================
// Repository
// ============================================================================

export class EmailExtractionRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Save email extractions (idempotent upsert)
   */
  async upsert(
    emailId: string,
    extractions: EmailExtractionInput[]
  ): Promise<{ savedCount: number; errors?: string[] }> {
    if (extractions.length === 0) {
      return { savedCount: 0 };
    }

    const records = extractions.map((e) => ({
      email_id: emailId,
      entity_type: e.entity_type,
      entity_value: e.entity_value,
      entity_normalized: e.entity_normalized,
      confidence_score: e.confidence_score,
      extraction_method: e.extraction_method,
      source_field: e.source_field,
      context_snippet: e.context_snippet,
      position_start: e.position_start,
      position_end: e.position_end,
      is_from_reply: e.is_from_reply,
      thread_position: e.thread_position,
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
      console.error('[EmailExtractionRepository] Error saving:', error);
      return { savedCount: 0, errors: [error.message] };
    }

    return { savedCount: data?.length || 0 };
  }

  /**
   * Find all extractions for an email
   */
  async findByEmailId(emailId: string): Promise<EmailExtractionRecord[]> {
    const { data, error } = await this.supabase
      .from('email_extractions')
      .select('*')
      .eq('email_id', emailId)
      .eq('is_valid', true)
      .order('confidence_score', { ascending: false });

    if (error) {
      throw new Error(`Failed to find email extractions: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Find extractions by entity type for an email
   */
  async findByEmailIdAndType(
    emailId: string,
    entityType: string
  ): Promise<EmailExtractionRecord[]> {
    const { data, error } = await this.supabase
      .from('email_extractions')
      .select('*')
      .eq('email_id', emailId)
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
    emailId: string,
    entityType: string
  ): Promise<string | null> {
    const { data } = await this.supabase
      .from('email_extractions')
      .select('entity_value, entity_normalized')
      .eq('email_id', emailId)
      .eq('entity_type', entityType)
      .eq('is_valid', true)
      .order('confidence_score', { ascending: false })
      .limit(1)
      .maybeSingle();

    return data?.entity_normalized || data?.entity_value || null;
  }

  /**
   * Delete all extractions for an email (for re-extraction)
   */
  async deleteByEmailId(emailId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('email_extractions')
      .delete()
      .eq('email_id', emailId);

    if (error) {
      console.error('[EmailExtractionRepository] Error deleting:', error);
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
      .from('email_extractions')
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
      .from('email_extractions')
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
   * Check if email has been extracted
   */
  async hasExtractions(emailId: string): Promise<boolean> {
    const { count } = await this.supabase
      .from('email_extractions')
      .select('id', { count: 'exact', head: true })
      .eq('email_id', emailId);

    return (count || 0) > 0;
  }

  /**
   * Get extraction count by email
   */
  async getCount(emailId: string): Promise<number> {
    const { count } = await this.supabase
      .from('email_extractions')
      .select('id', { count: 'exact', head: true })
      .eq('email_id', emailId)
      .eq('is_valid', true);

    return count || 0;
  }

  /**
   * Find extractions for multiple email IDs
   */
  async findByEmailIds(emailIds: string[]): Promise<EmailExtractionRecord[]> {
    if (emailIds.length === 0) return [];

    const { data, error } = await this.supabase
      .from('email_extractions')
      .select('*')
      .in('email_id', emailIds)
      .eq('is_valid', true);

    if (error) {
      throw new Error(`Failed to find email extractions: ${error.message}`);
    }

    return data || [];
  }
}
