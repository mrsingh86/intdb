/**
 * Thread Summary Service
 *
 * Identifies the "authority" email in a thread - the original email that
 * contains the primary shipment identifier. This solves the cross-linking
 * problem where RE:/FW: emails quote content from different shipments.
 *
 * Key insight: In shipping email threads, the FIRST original email (not a
 * reply/forward) contains the true shipment identifier. All subsequent
 * emails in that thread belong to the same shipment.
 *
 * Supports multiple identifier types (booking_number, bl_number, container_number)
 * to handle US emails where BL/container may come before booking number.
 *
 * Single Responsibility: Thread authority identification only.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { IdentifierType } from './types';

// ============================================================================
// Types
// ============================================================================

export interface ThreadAuthority {
  thread_id: string;
  authority_email_id: string;
  primary_identifier_type: IdentifierType;
  primary_identifier_value: string;
  shipment_id?: string;
  received_at: string;
  subject: string;
  confidence_score: number;
  created_at: string;
  updated_at: string;
}

export interface ThreadSummary {
  thread_id: string;
  email_count: number;
  original_email_count: number;
  reply_email_count: number;
  authority?: ThreadAuthority;
  all_identifiers: ThreadIdentifier[];
  first_email_date: string;
  last_email_date: string;
}

export interface ThreadIdentifier {
  email_id: string;
  identifier_type: IdentifierType;
  identifier_value: string;
  confidence_score: number;
  is_from_authority: boolean;
  source_type: 'email' | 'document';
}

interface ThreadEmail {
  id: string;
  thread_id: string;
  is_response: boolean;
  received_at: string;
  subject: string;
}

interface ExtractionRecord {
  email_id: string;
  entity_type: string;
  entity_value: string;
  confidence_score: number;
  source_type: 'email' | 'document';
}

// Priority order for identifier types (higher = better for linking)
const IDENTIFIER_PRIORITY: Record<string, number> = {
  booking_number: 100,
  bl_number: 90,
  container_number: 80,
  reference_number: 50,
};

// ============================================================================
// Service
// ============================================================================

export class ThreadSummaryService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Get or create thread summary for a thread.
   * Returns cached summary if exists, otherwise computes it.
   */
  async getThreadSummary(threadId: string): Promise<ThreadSummary | null> {
    // First check if we have a cached authority
    const cached = await this.getCachedAuthority(threadId);

    // Get thread emails
    const emails = await this.getThreadEmails(threadId);
    if (emails.length === 0) return null;

    // Get all extractions for thread emails
    const emailIds = emails.map((e) => e.id);
    const extractions = await this.getExtractionsForEmails(emailIds);

    // Build summary
    const originalEmails = emails.filter((e) => !e.is_response);
    const replyEmails = emails.filter((e) => e.is_response);

    // Compute authority if not cached
    const authority = cached || this.computeAuthority(emails, extractions);

    // Build identifier list
    const allIdentifiers = this.buildIdentifierList(
      extractions,
      authority?.authority_email_id
    );

    const sortedEmails = [...emails].sort((a, b) =>
      a.received_at.localeCompare(b.received_at)
    );

    return {
      thread_id: threadId,
      email_count: emails.length,
      original_email_count: originalEmails.length,
      reply_email_count: replyEmails.length,
      authority: authority || undefined,
      all_identifiers: allIdentifiers,
      first_email_date: sortedEmails[0]?.received_at || '',
      last_email_date: sortedEmails[sortedEmails.length - 1]?.received_at || '',
    };
  }

  /**
   * Get authority for a thread.
   * The authority is the first original email with a valid shipment identifier.
   */
  async getThreadAuthority(threadId: string): Promise<ThreadAuthority | null> {
    // Check cache first
    const cached = await this.getCachedAuthority(threadId);
    if (cached) return cached;

    // Compute authority
    const emails = await this.getThreadEmails(threadId);
    if (emails.length === 0) return null;

    const emailIds = emails.map((e) => e.id);
    const extractions = await this.getExtractionsForEmails(emailIds);

    const authority = this.computeAuthority(emails, extractions);
    if (!authority) return null;

    // Cache the authority
    await this.cacheAuthority(authority);

    return authority;
  }

  /**
   * Find authority email for a specific email by looking up its thread.
   */
  async getAuthorityForEmail(emailId: string): Promise<ThreadAuthority | null> {
    const { data: email } = await this.supabase
      .from('raw_emails')
      .select('thread_id')
      .eq('id', emailId)
      .single();

    if (!email?.thread_id) return null;

    return this.getThreadAuthority(email.thread_id);
  }

  /**
   * Get the shipment identifier to use for linking an email.
   * Returns the authority's identifier if the email belongs to a thread.
   */
  async getIdentifierForLinking(emailId: string): Promise<{
    identifier_type: IdentifierType;
    identifier_value: string;
    confidence_score: number;
    source: 'thread_authority' | 'direct_extraction';
    authority_email_id?: string;
  } | null> {
    // Get email with thread info
    const { data: email } = await this.supabase
      .from('raw_emails')
      .select('id, thread_id, is_response')
      .eq('id', emailId)
      .single();

    if (!email) return null;

    // If this email is part of a thread and is a reply, use thread authority
    if (email.thread_id && email.is_response) {
      const authority = await this.getThreadAuthority(email.thread_id);
      if (authority) {
        return {
          identifier_type: authority.primary_identifier_type,
          identifier_value: authority.primary_identifier_value,
          confidence_score: authority.confidence_score,
          source: 'thread_authority',
          authority_email_id: authority.authority_email_id,
        };
      }
    }

    // Otherwise, get identifier directly from this email's extractions
    const extractions = await this.getExtractionsForEmails([emailId]);
    const bestIdentifier = this.findBestIdentifier(extractions);

    if (!bestIdentifier) return null;

    return {
      identifier_type: bestIdentifier.entity_type as IdentifierType,
      identifier_value: bestIdentifier.entity_value,
      confidence_score: bestIdentifier.confidence_score,
      source: 'direct_extraction',
    };
  }

  /**
   * Invalidate cached authority for a thread.
   * Call this when thread emails are re-processed.
   */
  async invalidateCache(threadId: string): Promise<void> {
    await this.supabase
      .from('email_thread_summaries')
      .delete()
      .eq('thread_id', threadId);
  }

  /**
   * Batch compute authorities for multiple threads.
   * Useful for backfilling.
   */
  async computeAuthoritiesForThreads(
    threadIds: string[]
  ): Promise<Map<string, ThreadAuthority | null>> {
    const result = new Map<string, ThreadAuthority | null>();

    // Process in batches of 10
    const batchSize = 10;
    for (let i = 0; i < threadIds.length; i += batchSize) {
      const batch = threadIds.slice(i, i + batchSize);
      const promises = batch.map(async (threadId) => {
        const authority = await this.getThreadAuthority(threadId);
        result.set(threadId, authority);
      });
      await Promise.all(promises);
    }

    return result;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Get emails belonging to a thread.
   */
  private async getThreadEmails(threadId: string): Promise<ThreadEmail[]> {
    const { data, error } = await this.supabase
      .from('raw_emails')
      .select('id, thread_id, is_response, received_at, subject')
      .eq('thread_id', threadId)
      .order('received_at', { ascending: true });

    if (error) {
      console.error('[ThreadSummaryService] Error fetching thread emails:', error);
      return [];
    }

    return (data || []).map((e) => ({
      id: e.id,
      thread_id: e.thread_id,
      is_response: e.is_response || false,
      received_at: e.received_at,
      subject: e.subject || '',
    }));
  }

  /**
   * Get extractions for a set of emails.
   * Combines email_extractions and document_extractions.
   */
  private async getExtractionsForEmails(
    emailIds: string[]
  ): Promise<ExtractionRecord[]> {
    if (emailIds.length === 0) return [];

    // Get email extractions
    const { data: emailExtractions } = await this.supabase
      .from('email_extractions')
      .select('email_id, entity_type, entity_value, confidence_score')
      .in('email_id', emailIds)
      .in('entity_type', ['booking_number', 'bl_number', 'container_number', 'reference_number'])
      .eq('is_valid', true);

    // Get document extractions
    const { data: docExtractions } = await this.supabase
      .from('document_extractions')
      .select('email_id, entity_type, entity_value, confidence_score')
      .in('email_id', emailIds)
      .in('entity_type', ['booking_number', 'bl_number', 'container_number', 'reference_number'])
      .eq('is_valid', true);

    const result: ExtractionRecord[] = [];

    for (const e of emailExtractions || []) {
      result.push({
        email_id: e.email_id,
        entity_type: e.entity_type,
        entity_value: e.entity_value,
        confidence_score: e.confidence_score,
        source_type: 'email',
      });
    }

    for (const e of docExtractions || []) {
      result.push({
        email_id: e.email_id,
        entity_type: e.entity_type,
        entity_value: e.entity_value,
        confidence_score: e.confidence_score,
        source_type: 'document',
      });
    }

    return result;
  }

  /**
   * Compute the authority for a thread.
   * Priority: First original email with booking_number > bl_number > container_number
   */
  private computeAuthority(
    emails: ThreadEmail[],
    extractions: ExtractionRecord[]
  ): ThreadAuthority | null {
    // Sort emails: original first, then by date
    const sortedEmails = [...emails].sort((a, b) => {
      // Original emails first
      if (a.is_response !== b.is_response) {
        return a.is_response ? 1 : -1;
      }
      // Then by date (earliest first)
      return a.received_at.localeCompare(b.received_at);
    });

    // Group extractions by email
    const extractionsByEmail = new Map<string, ExtractionRecord[]>();
    for (const ext of extractions) {
      const existing = extractionsByEmail.get(ext.email_id) || [];
      existing.push(ext);
      extractionsByEmail.set(ext.email_id, existing);
    }

    // Find first email with a valid identifier
    for (const email of sortedEmails) {
      const emailExtractions = extractionsByEmail.get(email.id) || [];
      const bestIdentifier = this.findBestIdentifier(emailExtractions);

      if (bestIdentifier) {
        return {
          thread_id: email.thread_id,
          authority_email_id: email.id,
          primary_identifier_type: bestIdentifier.entity_type as IdentifierType,
          primary_identifier_value: bestIdentifier.entity_value,
          received_at: email.received_at,
          subject: email.subject,
          confidence_score: bestIdentifier.confidence_score,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }
    }

    return null;
  }

  /**
   * Find the best identifier from a list of extractions.
   * Uses priority: booking_number > bl_number > container_number
   */
  private findBestIdentifier(
    extractions: ExtractionRecord[]
  ): ExtractionRecord | null {
    if (extractions.length === 0) return null;

    // Sort by priority (descending) then confidence (descending)
    const sorted = [...extractions].sort((a, b) => {
      const priorityA = IDENTIFIER_PRIORITY[a.entity_type] || 0;
      const priorityB = IDENTIFIER_PRIORITY[b.entity_type] || 0;
      if (priorityA !== priorityB) {
        return priorityB - priorityA;
      }
      return b.confidence_score - a.confidence_score;
    });

    return sorted[0] || null;
  }

  /**
   * Build list of all identifiers in thread.
   */
  private buildIdentifierList(
    extractions: ExtractionRecord[],
    authorityEmailId?: string
  ): ThreadIdentifier[] {
    // Deduplicate by value
    const seen = new Set<string>();
    const result: ThreadIdentifier[] = [];

    for (const ext of extractions) {
      const key = `${ext.entity_type}:${ext.entity_value}`;
      if (seen.has(key)) continue;
      seen.add(key);

      result.push({
        email_id: ext.email_id,
        identifier_type: ext.entity_type as IdentifierType,
        identifier_value: ext.entity_value,
        confidence_score: ext.confidence_score,
        is_from_authority: ext.email_id === authorityEmailId,
        source_type: ext.source_type,
      });
    }

    return result;
  }

  /**
   * Get cached authority from database.
   */
  private async getCachedAuthority(threadId: string): Promise<ThreadAuthority | null> {
    const { data, error } = await this.supabase
      .from('email_thread_summaries')
      .select('*')
      .eq('thread_id', threadId)
      .single();

    if (error || !data) return null;

    return {
      thread_id: data.thread_id,
      authority_email_id: data.authority_email_id,
      primary_identifier_type: data.primary_identifier_type,
      primary_identifier_value: data.primary_identifier_value,
      shipment_id: data.shipment_id,
      received_at: data.received_at,
      subject: data.subject,
      confidence_score: data.confidence_score,
      created_at: data.created_at,
      updated_at: data.updated_at,
    };
  }

  /**
   * Cache authority to database.
   */
  private async cacheAuthority(authority: ThreadAuthority): Promise<void> {
    const { error } = await this.supabase
      .from('email_thread_summaries')
      .upsert(
        {
          thread_id: authority.thread_id,
          authority_email_id: authority.authority_email_id,
          primary_identifier_type: authority.primary_identifier_type,
          primary_identifier_value: authority.primary_identifier_value,
          shipment_id: authority.shipment_id,
          received_at: authority.received_at,
          subject: authority.subject,
          confidence_score: authority.confidence_score,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'thread_id' }
      );

    if (error) {
      console.error('[ThreadSummaryService] Error caching authority:', error);
    }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createThreadSummaryService(
  supabase: SupabaseClient
): ThreadSummaryService {
  return new ThreadSummaryService(supabase);
}
