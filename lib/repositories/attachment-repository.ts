/**
 * Attachment Repository
 *
 * Handles database operations for raw attachments (PDFs, images, etc).
 * Part of the CORE layer alongside EmailRepository.
 *
 * Architecture:
 * - raw_emails: Email-level (EmailRepository)
 * - raw_attachments: Attachment-level (this)
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

export interface RawAttachment {
  id: string;
  email_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  attachment_id?: string;
  extracted_text?: string;
  extraction_status?: 'pending' | 'completed' | 'failed';
  extraction_error?: string;
  extracted_at?: string;
  created_at: string;
}

export interface AttachmentQueryFilters {
  email_id?: string;
  mime_type?: string;
  extraction_status?: string;
  has_extracted_text?: boolean;
  filename_contains?: string;
}

export class AttachmentNotFoundError extends Error {
  constructor(public attachmentId: string) {
    super(`Attachment not found: ${attachmentId}`);
    this.name = 'AttachmentNotFoundError';
  }
}

// ============================================================================
// Repository
// ============================================================================

export class AttachmentRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Find attachment by ID
   */
  async findById(id: string): Promise<RawAttachment> {
    const { data, error } = await this.supabase
      .from('raw_attachments')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new AttachmentNotFoundError(id);
    }

    return data;
  }

  /**
   * Find attachment by ID (returns null if not found)
   */
  async findByIdOrNull(id: string): Promise<RawAttachment | null> {
    const { data } = await this.supabase
      .from('raw_attachments')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    return data;
  }

  /**
   * Find all attachments for an email
   */
  async findByEmailId(emailId: string): Promise<RawAttachment[]> {
    const { data, error } = await this.supabase
      .from('raw_attachments')
      .select('*')
      .eq('email_id', emailId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to find attachments: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Find attachments with filters
   */
  async findAll(filters: AttachmentQueryFilters = {}): Promise<RawAttachment[]> {
    let query = this.supabase.from('raw_attachments').select('*');

    if (filters.email_id) {
      query = query.eq('email_id', filters.email_id);
    }
    if (filters.mime_type) {
      query = query.eq('mime_type', filters.mime_type);
    }
    if (filters.extraction_status) {
      query = query.eq('extraction_status', filters.extraction_status);
    }
    if (filters.has_extracted_text === true) {
      query = query.not('extracted_text', 'is', null);
    }
    if (filters.has_extracted_text === false) {
      query = query.is('extracted_text', null);
    }
    if (filters.filename_contains) {
      query = query.ilike('filename', `%${filters.filename_contains}%`);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to query attachments: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Find PDF attachments for an email
   */
  async findPdfsByEmailId(emailId: string): Promise<RawAttachment[]> {
    const { data, error } = await this.supabase
      .from('raw_attachments')
      .select('*')
      .eq('email_id', emailId)
      .eq('mime_type', 'application/pdf')
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to find PDF attachments: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Find attachments pending extraction
   */
  async findPendingExtraction(limit: number = 100): Promise<RawAttachment[]> {
    const { data, error } = await this.supabase
      .from('raw_attachments')
      .select('*')
      .or('extraction_status.is.null,extraction_status.eq.pending')
      .eq('mime_type', 'application/pdf')
      .limit(limit)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to find pending attachments: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Update extraction status and text
   */
  async updateExtraction(
    id: string,
    extractedText: string,
    status: 'completed' | 'failed' = 'completed',
    error?: string
  ): Promise<RawAttachment> {
    const { data, error: updateError } = await this.supabase
      .from('raw_attachments')
      .update({
        extracted_text: extractedText,
        extraction_status: status,
        extraction_error: error,
        extracted_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError || !data) {
      throw new Error(`Failed to update extraction: ${updateError?.message}`);
    }

    return data;
  }

  /**
   * Mark extraction as failed
   */
  async markExtractionFailed(id: string, error: string): Promise<void> {
    await this.supabase
      .from('raw_attachments')
      .update({
        extraction_status: 'failed',
        extraction_error: error,
        extracted_at: new Date().toISOString(),
      })
      .eq('id', id);
  }

  /**
   * Get attachment count for an email
   */
  async getCountByEmailId(emailId: string): Promise<number> {
    const { count } = await this.supabase
      .from('raw_attachments')
      .select('id', { count: 'exact', head: true })
      .eq('email_id', emailId);

    return count || 0;
  }

  /**
   * Check if attachment exists
   */
  async exists(id: string): Promise<boolean> {
    const { count } = await this.supabase
      .from('raw_attachments')
      .select('id', { count: 'exact', head: true })
      .eq('id', id);

    return (count || 0) > 0;
  }

  /**
   * Get extracted text for an attachment
   */
  async getExtractedText(id: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('raw_attachments')
      .select('extracted_text')
      .eq('id', id)
      .maybeSingle();

    return data?.extracted_text || null;
  }

  /**
   * Check if attachment has been extracted
   */
  async hasExtractedText(id: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('raw_attachments')
      .select('extracted_text')
      .eq('id', id)
      .maybeSingle();

    return !!data?.extracted_text;
  }

  /**
   * Get attachments with email details
   */
  async findByEmailIdWithEmail(emailId: string): Promise<(RawAttachment & {
    email_subject?: string;
    email_from?: string;
  })[]> {
    const { data, error } = await this.supabase
      .from('raw_attachments')
      .select(`
        *,
        raw_emails!inner(subject, from_address)
      `)
      .eq('email_id', emailId);

    if (error) {
      throw new Error(`Failed to find attachments with email: ${error.message}`);
    }

    return (data || []).map((row: any) => ({
      ...row,
      email_subject: row.raw_emails?.subject,
      email_from: row.raw_emails?.from_address,
      raw_emails: undefined,
    }));
  }
}
