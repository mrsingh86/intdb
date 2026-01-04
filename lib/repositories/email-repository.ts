/**
 * Email Repository
 *
 * Abstracts all database access for raw emails.
 * Hides Supabase implementation details from business logic.
 *
 * Principles:
 * - Information Hiding: Routes don't know database schema
 * - Single Responsibility: Only database access, no business logic
 * - No Null Returns: Throw exceptions or return empty arrays
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { RawEmail } from '@/types/email-intelligence';
import { PaginationOptions, PaginatedResult } from '@/lib/types/repository-filters';
import { detectDirection } from '@/lib/utils/direction-detector';

export interface EmailQueryFilters {
  threadId?: string;
  hasAttachments?: boolean;
  search?: string;
}

export class EmailNotFoundError extends Error {
  constructor(public emailId: string) {
    super(`Email not found: ${emailId}`);
    this.name = 'EmailNotFoundError';
  }
}

export class EmailRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Find all emails with optional filters and pagination
   */
  async findAll(
    filters: EmailQueryFilters,
    pagination: PaginationOptions
  ): Promise<PaginatedResult<RawEmail>> {
    const offset = (pagination.page - 1) * pagination.limit;

    let query = this.supabase
      .from('raw_emails')
      .select('*', { count: 'exact' })
      .order('received_at', { ascending: false })
      .range(offset, offset + pagination.limit - 1);

    // Apply filters
    if (filters.threadId) {
      query = query.eq('thread_id', filters.threadId);
    }

    if (filters.hasAttachments !== undefined) {
      query = query.eq('has_attachments', filters.hasAttachments);
    }

    if (filters.search) {
      query = query.or(
        `subject.ilike.%${filters.search}%,body_text.ilike.%${filters.search}%,sender_email.ilike.%${filters.search}%`
      );
    }

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch emails: ${error.message}`);
    }

    return {
      data: data || [],
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pagination.limit),
      },
    };
  }

  /**
   * Find email by ID
   * @throws EmailNotFoundError if not found
   */
  async findById(id: string): Promise<RawEmail> {
    const { data, error } = await this.supabase
      .from('raw_emails')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new EmailNotFoundError(id);
    }

    return data;
  }

  /**
   * Find emails by Gmail message ID (for duplicate checking)
   */
  async findByGmailMessageId(gmailMessageId: string): Promise<RawEmail | null> {
    const { data, error } = await this.supabase
      .from('raw_emails')
      .select('*')
      .eq('gmail_message_id', gmailMessageId)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  /**
   * Find multiple emails by IDs
   */
  async findByIds(ids: string[]): Promise<RawEmail[]> {
    if (ids.length === 0) return [];

    const { data, error } = await this.supabase
      .from('raw_emails')
      .select('*')
      .in('id', ids);

    if (error) {
      throw new Error(`Failed to fetch emails by IDs: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Create a new email
   * @throws Error if insertion fails
   */
  async create(email: Partial<RawEmail>): Promise<RawEmail> {
    // Auto-detect email direction based on sender and subject
    const emailWithDirection = {
      ...email,
      email_direction: email.email_direction || detectDirection(email.sender_email, email.subject),
    };

    const { data, error } = await this.supabase
      .from('raw_emails')
      .insert(emailWithDirection)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create email: ${error?.message}`);
    }

    return data;
  }

  /**
   * Count total emails
   */
  async count(filters?: EmailQueryFilters): Promise<number> {
    let query = this.supabase
      .from('raw_emails')
      .select('id', { count: 'exact', head: true });

    if (filters?.threadId) {
      query = query.eq('thread_id', filters.threadId);
    }

    if (filters?.hasAttachments !== undefined) {
      query = query.eq('has_attachments', filters.hasAttachments);
    }

    const { count, error } = await query;

    if (error) {
      throw new Error(`Failed to count emails: ${error.message}`);
    }

    return count || 0;
  }
}
