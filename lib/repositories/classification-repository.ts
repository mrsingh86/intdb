/**
 * Classification Repository
 *
 * Abstracts all database access for document classifications.
 * Hides Supabase implementation details from business logic.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { DocumentClassification } from '@/types/email-intelligence';

export class ClassificationRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Find classifications by email IDs
   */
  async findByEmailIds(emailIds: string[]): Promise<DocumentClassification[]> {
    if (emailIds.length === 0) return [];

    const { data, error } = await this.supabase
      .from('document_classifications')
      .select('*')
      .in('email_id', emailIds);

    if (error) {
      throw new Error(`Failed to fetch classifications: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Find classification for a single email
   */
  async findByEmailId(emailId: string): Promise<DocumentClassification | null> {
    const { data, error } = await this.supabase
      .from('document_classifications')
      .select('*')
      .eq('email_id', emailId)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  /**
   * Create a new classification
   */
  async create(classification: Partial<DocumentClassification>): Promise<DocumentClassification> {
    const { data, error } = await this.supabase
      .from('document_classifications')
      .insert(classification)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create classification: ${error?.message}`);
    }

    return data;
  }

  /**
   * Update existing classification
   */
  async update(
    id: string,
    updates: Partial<DocumentClassification>
  ): Promise<DocumentClassification> {
    const { data, error } = await this.supabase
      .from('document_classifications')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to update classification: ${error?.message}`);
    }

    return data;
  }
}
