/**
 * Email Registry Service
 *
 * Tracks unique email senders, threads, and communication events.
 * Parallel to Document Registry - runs alongside, not as fallback.
 *
 * Responsibilities:
 * - Track unique senders by email address and domain
 * - Link senders to parties when matched
 * - Store email_type and sentiment from classification
 * - Track thread chains
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

export interface EmailRegistryInput {
  emailId: string;
  senderEmail: string;
  senderName?: string;
  threadId?: string;
  subject: string;
  emailType?: string;
  emailTypeConfidence?: number;
  sentiment?: string;
  sentimentScore?: number;
  direction: 'inbound' | 'outbound';
}

export interface EmailRegistryResult {
  success: boolean;
  emailId: string;
  senderId: string;
  senderDomain: string;
  threadId: string | null;
  isNewSender: boolean;
  senderPartyId: string | null;
  error?: string;
}

export interface EmailSender {
  id: string;
  email_address: string;
  domain: string;
  display_name: string | null;
  party_id: string | null;
  first_seen_at: string;
  last_seen_at: string;
  email_count: number;
}

// ============================================================================
// SERVICE
// ============================================================================

export class EmailRegistryService {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Register an email and track its sender
   */
  async registerEmail(input: EmailRegistryInput): Promise<EmailRegistryResult> {
    const domain = this.extractDomain(input.senderEmail);

    try {
      // 1. Find or create sender
      const senderResult = await this.findOrCreateSender(
        input.senderEmail,
        domain,
        input.senderName
      );

      // 2. Update raw_emails with registry info
      await this.updateEmailWithRegistryInfo(input, senderResult.id);

      return {
        success: true,
        emailId: input.emailId,
        senderId: senderResult.id,
        senderDomain: domain,
        threadId: input.threadId || null,
        isNewSender: senderResult.isNew,
        senderPartyId: senderResult.partyId,
      };
    } catch (error) {
      console.error('[EmailRegistry] Registration error:', error);
      return {
        success: false,
        emailId: input.emailId,
        senderId: '',
        senderDomain: domain,
        threadId: null,
        isNewSender: false,
        senderPartyId: null,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Find or create a sender record
   */
  private async findOrCreateSender(
    senderEmail: string,
    domain: string,
    displayName?: string
  ): Promise<{ id: string; isNew: boolean; partyId: string | null }> {
    // Parse and normalize email from "Name <email@domain.com>" format
    const normalizedEmail = this.extractEmail(senderEmail);

    // Try to find existing sender
    const { data: existing } = await this.supabase
      .from('email_senders')
      .select('id, party_id, email_count')
      .eq('email_address', normalizedEmail)
      .single();

    if (existing) {
      // Update last_seen and increment count
      await this.supabase
        .from('email_senders')
        .update({
          last_seen_at: new Date().toISOString(),
          email_count: (existing.email_count || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      return {
        id: existing.id,
        isNew: false,
        partyId: existing.party_id,
      };
    }

    // Try to match to existing party by domain
    const partyId = await this.findPartyByDomain(domain);

    // Create new sender
    const { data: newSender, error } = await this.supabase
      .from('email_senders')
      .insert({
        email_address: normalizedEmail,
        domain: domain,
        display_name: displayName || null,
        party_id: partyId,
        first_seen_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
        email_count: 1,
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to create sender: ${error.message}`);
    }

    return {
      id: newSender.id,
      isNew: true,
      partyId: partyId,
    };
  }

  /**
   * Find party by email domain
   */
  private async findPartyByDomain(domain: string): Promise<string | null> {
    // Check parties table for matching domain in email_domains array
    const { data: party } = await this.supabase
      .from('parties')
      .select('id')
      .contains('email_domains', [domain])
      .limit(1)
      .single();

    return party?.id || null;
  }

  /**
   * Update raw_emails with registry information
   */
  private async updateEmailWithRegistryInfo(
    input: EmailRegistryInput,
    senderId: string
  ): Promise<void> {
    const updates: Record<string, unknown> = {
      sender_id: senderId,
    };

    if (input.emailType) {
      updates.email_type = input.emailType;
    }
    if (input.emailTypeConfidence !== undefined) {
      updates.email_type_confidence = input.emailTypeConfidence;
    }
    if (input.sentiment) {
      updates.sentiment = input.sentiment;
    }
    if (input.sentimentScore !== undefined) {
      updates.sentiment_score = input.sentimentScore;
    }

    await this.supabase
      .from('raw_emails')
      .update(updates)
      .eq('id', input.emailId);
  }

  /**
   * Link sender to a party
   */
  async linkSenderToParty(senderId: string, partyId: string): Promise<void> {
    await this.supabase
      .from('email_senders')
      .update({
        party_id: partyId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', senderId);
  }

  /**
   * Get sender by email address
   */
  async getSenderByEmail(email: string): Promise<EmailSender | null> {
    const { data } = await this.supabase
      .from('email_senders')
      .select('*')
      .eq('email_address', email.toLowerCase().trim())
      .single();

    return data;
  }

  /**
   * Get senders by domain
   */
  async getSendersByDomain(domain: string): Promise<EmailSender[]> {
    const { data } = await this.supabase
      .from('email_senders')
      .select('*')
      .eq('domain', domain.toLowerCase());

    return data || [];
  }

  /**
   * Parse email from various formats:
   * - "name@domain.com"
   * - "Name <name@domain.com>"
   * - "<name@domain.com>"
   * Returns { email, domain }
   */
  private parseEmail(senderEmail: string): { email: string; domain: string } {
    // Handle "Name <email@domain.com>" format
    const angleMatch = senderEmail.match(/<([^>]+@[^>]+)>/);
    const rawEmail = angleMatch ? angleMatch[1] : senderEmail;

    // Clean and normalize
    const email = rawEmail.toLowerCase().trim();

    // Extract domain
    const atIndex = email.lastIndexOf('@');
    const domain = atIndex > 0 ? email.substring(atIndex + 1) : '';

    return { email, domain };
  }

  /**
   * Extract domain from email address (legacy helper)
   */
  private extractDomain(senderEmail: string): string {
    return this.parseEmail(senderEmail).domain;
  }

  /**
   * Extract clean email address from sender string
   */
  private extractEmail(senderEmail: string): string {
    return this.parseEmail(senderEmail).email;
  }

  /**
   * Get registry statistics
   */
  async getStatistics(): Promise<{
    totalSenders: number;
    linkedToParty: number;
    unlinked: number;
    topDomains: { domain: string; count: number }[];
  }> {
    const [totalResult, linkedResult, domainsResult] = await Promise.all([
      this.supabase.from('email_senders').select('*', { count: 'exact', head: true }),
      this.supabase
        .from('email_senders')
        .select('*', { count: 'exact', head: true })
        .not('party_id', 'is', null),
      this.supabase.rpc('get_top_sender_domains', { limit_count: 10 }),
    ]);

    const totalSenders = totalResult.count || 0;
    const linkedToParty = linkedResult.count || 0;

    return {
      totalSenders,
      linkedToParty,
      unlinked: totalSenders - linkedToParty,
      topDomains: domainsResult.data || [],
    };
  }
}

// Factory function
export function createEmailRegistryService(supabase: SupabaseClient): EmailRegistryService {
  return new EmailRegistryService(supabase);
}
