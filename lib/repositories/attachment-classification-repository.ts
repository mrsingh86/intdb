/**
 * Attachment Classification Repository
 *
 * Handles CRUD operations for the attachment_classifications table.
 * One record per attachment - tracks document type from PDF content ONLY.
 *
 * SEPARATION OF CONCERNS:
 * - Attachment classification answers: "What document is attached?"
 * - Email classification (separate) answers: "What is the sender's intent?"
 *
 * KEY RULES:
 * - classification_method = 'content' ONLY (no fallback)
 * - Only created when email has attachments
 * - linking_id connects to email_classifications
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface AttachmentClassificationRecord {
  id: string;
  email_id: string;
  attachment_id: string;
  thread_id: string | null;
  linking_id: string | null;
  document_type: string | null;
  document_category: string | null;
  sender_category: string | null;
  classification_method: string | null;
  classification_status: string | null;
  confidence: number | null;
  matched_markers: Record<string, unknown> | null;
  document_workflow_state: string | null;
  received_at: string;
  classified_at: string | null;
}

export interface AttachmentClassificationInput {
  email_id: string;
  attachment_id: string;
  thread_id?: string | null;
  linking_id?: string | null;
  document_type?: string | null;
  document_category?: string | null;
  sender_category?: string | null;
  classification_method?: string;
  classification_status?: string | null;
  confidence?: number | null;
  matched_markers?: Record<string, unknown> | null;
  document_workflow_state?: string | null;
  received_at: string;
}

export class AttachmentClassificationRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Find classification by attachment ID
   */
  async findByAttachmentId(attachmentId: string): Promise<AttachmentClassificationRecord | null> {
    const { data, error } = await this.supabase
      .from('attachment_classifications')
      .select('*')
      .eq('attachment_id', attachmentId)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  /**
   * Find classifications by email ID
   */
  async findByEmailId(emailId: string): Promise<AttachmentClassificationRecord[]> {
    const { data, error } = await this.supabase
      .from('attachment_classifications')
      .select('*')
      .eq('email_id', emailId);

    if (error) {
      throw new Error(`Failed to fetch attachment classifications: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Find classifications by email IDs
   */
  async findByEmailIds(emailIds: string[]): Promise<AttachmentClassificationRecord[]> {
    if (emailIds.length === 0) return [];

    const { data, error } = await this.supabase
      .from('attachment_classifications')
      .select('*')
      .in('email_id', emailIds);

    if (error) {
      throw new Error(`Failed to fetch attachment classifications: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Find classifications by thread ID
   */
  async findByThreadId(threadId: string): Promise<AttachmentClassificationRecord[]> {
    const { data, error } = await this.supabase
      .from('attachment_classifications')
      .select('*')
      .eq('thread_id', threadId)
      .order('received_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch thread attachment classifications: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Find classification by linking ID
   */
  async findByLinkingId(linkingId: string): Promise<AttachmentClassificationRecord | null> {
    const { data, error } = await this.supabase
      .from('attachment_classifications')
      .select('*')
      .eq('linking_id', linkingId)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  /**
   * Create a new attachment classification
   * ENFORCES: classification_method = 'content' (no fallback)
   */
  async create(input: AttachmentClassificationInput): Promise<AttachmentClassificationRecord> {
    const { data, error } = await this.supabase
      .from('attachment_classifications')
      .insert({
        ...input,
        classification_method: 'content', // ENFORCED: Only content-based
        classified_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create attachment classification: ${error?.message}`);
    }

    return data;
  }

  /**
   * Upsert attachment classification (create or update by attachment_id)
   * Idempotent: safe to call multiple times for same attachment
   * ENFORCES: classification_method = 'content' (no fallback)
   */
  async upsert(input: AttachmentClassificationInput): Promise<AttachmentClassificationRecord> {
    const { data, error } = await this.supabase
      .from('attachment_classifications')
      .upsert(
        {
          ...input,
          classification_method: 'content', // ENFORCED: Only content-based
          classified_at: new Date().toISOString(),
        },
        { onConflict: 'attachment_id' }
      )
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to upsert attachment classification: ${error?.message}`);
    }

    return data;
  }

  /**
   * Update existing classification
   */
  async update(
    id: string,
    updates: Partial<AttachmentClassificationInput>
  ): Promise<AttachmentClassificationRecord> {
    // Ensure classification_method cannot be changed from 'content'
    const safeUpdates = { ...updates };
    delete safeUpdates.classification_method;

    const { data, error } = await this.supabase
      .from('attachment_classifications')
      .update(safeUpdates)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to update attachment classification: ${error?.message}`);
    }

    return data;
  }

  /**
   * Delete classification by attachment ID
   */
  async deleteByAttachmentId(attachmentId: string): Promise<void> {
    const { error } = await this.supabase
      .from('attachment_classifications')
      .delete()
      .eq('attachment_id', attachmentId);

    if (error) {
      throw new Error(`Failed to delete attachment classification: ${error.message}`);
    }
  }

  /**
   * Get document types with counts
   */
  async getDocumentTypeCounts(): Promise<Record<string, number>> {
    const { data, error } = await this.supabase
      .from('attachment_classifications')
      .select('document_type');

    if (error) {
      throw new Error(`Failed to fetch document type counts: ${error.message}`);
    }

    const counts: Record<string, number> = {};
    for (const row of data || []) {
      const type = row.document_type || 'unknown';
      counts[type] = (counts[type] || 0) + 1;
    }

    return counts;
  }

  /**
   * Find workflow documents (not general_correspondence)
   */
  async findWorkflowDocuments(limit: number = 100): Promise<AttachmentClassificationRecord[]> {
    const { data, error } = await this.supabase
      .from('attachment_classifications')
      .select('*')
      .not('document_type', 'in', '(general_correspondence,unknown)')
      .not('document_type', 'is', null)
      .order('received_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch workflow documents: ${error.message}`);
    }

    return data || [];
  }
}
