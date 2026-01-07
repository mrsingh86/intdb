/**
 * Email Classification Repository
 *
 * Handles CRUD operations for the email_classifications table.
 * One record per email - tracks email type, category, sender, and sentiment.
 *
 * SEPARATION OF CONCERNS:
 * - Email classification answers: "What is the sender's intent?"
 * - Attachment classification (separate) answers: "What document is attached?"
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface EmailClassificationRecord {
  id: string;
  email_id: string;
  thread_id: string | null;
  linking_id: string | null;
  email_type: string | null;
  email_category: string | null;
  sender_category: string | null;
  sentiment: string | null;
  is_original: boolean;
  classification_source: string | null;
  classification_status: string | null;
  confidence: number | null;
  email_workflow_state: string | null;
  received_at: string;
  classified_at: string | null;
}

export interface EmailClassificationInput {
  email_id: string;
  thread_id?: string | null;
  linking_id?: string | null;
  email_type?: string | null;
  email_category?: string | null;
  sender_category?: string | null;
  sentiment?: string | null;
  is_original: boolean;
  classification_source?: string | null;
  classification_status?: string | null;
  confidence?: number | null;
  email_workflow_state?: string | null;
  received_at: string;
}

export class EmailClassificationRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Find classification by email ID
   */
  async findByEmailId(emailId: string): Promise<EmailClassificationRecord | null> {
    const { data, error } = await this.supabase
      .from('email_classifications')
      .select('*')
      .eq('email_id', emailId)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  /**
   * Find classifications by email IDs
   */
  async findByEmailIds(emailIds: string[]): Promise<EmailClassificationRecord[]> {
    if (emailIds.length === 0) return [];

    const { data, error } = await this.supabase
      .from('email_classifications')
      .select('*')
      .in('email_id', emailIds);

    if (error) {
      throw new Error(`Failed to fetch email classifications: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Find classifications by thread ID
   */
  async findByThreadId(threadId: string): Promise<EmailClassificationRecord[]> {
    const { data, error } = await this.supabase
      .from('email_classifications')
      .select('*')
      .eq('thread_id', threadId)
      .order('received_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch thread classifications: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Find classification by linking ID
   */
  async findByLinkingId(linkingId: string): Promise<EmailClassificationRecord | null> {
    const { data, error } = await this.supabase
      .from('email_classifications')
      .select('*')
      .eq('linking_id', linkingId)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  /**
   * Create a new email classification
   */
  async create(input: EmailClassificationInput): Promise<EmailClassificationRecord> {
    const { data, error } = await this.supabase
      .from('email_classifications')
      .insert({
        ...input,
        classified_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create email classification: ${error?.message}`);
    }

    return data;
  }

  /**
   * Upsert email classification (create or update by email_id)
   * Idempotent: safe to call multiple times for same email
   */
  async upsert(input: EmailClassificationInput): Promise<EmailClassificationRecord> {
    const { data, error } = await this.supabase
      .from('email_classifications')
      .upsert(
        {
          ...input,
          classified_at: new Date().toISOString(),
        },
        { onConflict: 'email_id' }
      )
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to upsert email classification: ${error?.message}`);
    }

    return data;
  }

  /**
   * Update existing classification
   */
  async update(
    id: string,
    updates: Partial<EmailClassificationInput>
  ): Promise<EmailClassificationRecord> {
    const { data, error } = await this.supabase
      .from('email_classifications')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to update email classification: ${error?.message}`);
    }

    return data;
  }

  /**
   * Delete classification by email ID
   */
  async deleteByEmailId(emailId: string): Promise<void> {
    const { error } = await this.supabase
      .from('email_classifications')
      .delete()
      .eq('email_id', emailId);

    if (error) {
      throw new Error(`Failed to delete email classification: ${error.message}`);
    }
  }

  /**
   * Get classification stats by status
   */
  async getStatsByStatus(): Promise<Record<string, number>> {
    const { data, error } = await this.supabase
      .from('email_classifications')
      .select('classification_status');

    if (error) {
      throw new Error(`Failed to fetch classification stats: ${error.message}`);
    }

    const stats: Record<string, number> = {};
    for (const row of data || []) {
      const status = row.classification_status || 'unknown';
      stats[status] = (stats[status] || 0) + 1;
    }

    return stats;
  }
}
