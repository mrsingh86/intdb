/**
 * Thread-Aware Linking Service
 *
 * Links emails to shipments using thread-first strategy:
 * 1. If email is part of a thread, use thread authority's identifier
 * 2. If standalone email, use direct extraction
 *
 * This solves the cross-linking problem where RE:/FW: emails quote
 * content from different shipments and get linked incorrectly.
 *
 * Single Responsibility: Thread-aware shipment linking only.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { ThreadSummaryService } from './thread-summary-service';
import {
  IdentifierType,
  LinkMetadata,
  LinkSource,
  EmailAuthority,
  DIRECT_CARRIER_DOMAINS,
} from './types';

// ============================================================================
// Types
// ============================================================================

export interface ThreadAwareLinkResult {
  linked: boolean;
  shipment_id?: string;
  link_metadata?: LinkMetadata;
  link_strategy: 'thread_authority' | 'direct_extraction' | 'no_identifier';
  authority_email_id?: string;
  error?: string;
}

export interface ThreadAwareLinkInput {
  email_id: string;
  document_type?: string;
  sender_email?: string;
  true_sender_email?: string;
}

// ============================================================================
// Service
// ============================================================================

export class ThreadAwareLinkingService {
  private threadSummaryService: ThreadSummaryService;

  constructor(private supabase: SupabaseClient) {
    this.threadSummaryService = new ThreadSummaryService(supabase);
  }

  /**
   * Link an email to a shipment using thread-aware strategy.
   *
   * Strategy:
   * 1. Get identifier from thread authority (if email is in a thread)
   * 2. Fall back to direct extraction (if standalone or no authority)
   * 3. Find matching shipment
   * 4. Create shipment_documents record
   */
  async linkEmail(input: ThreadAwareLinkInput): Promise<ThreadAwareLinkResult> {
    // Get identifier to use for linking
    const identifierResult = await this.threadSummaryService.getIdentifierForLinking(
      input.email_id
    );

    if (!identifierResult) {
      return {
        linked: false,
        link_strategy: 'no_identifier',
        error: 'No shipment identifier found in email or thread',
      };
    }

    const linkStrategy =
      identifierResult.source === 'thread_authority'
        ? 'thread_authority'
        : 'direct_extraction';

    // Find shipment by identifier
    const shipment = await this.findShipmentByIdentifier(
      identifierResult.identifier_type,
      identifierResult.identifier_value
    );

    if (!shipment) {
      return {
        linked: false,
        link_strategy: linkStrategy,
        authority_email_id: identifierResult.authority_email_id,
        error: `No shipment found for ${identifierResult.identifier_type}: ${identifierResult.identifier_value}`,
      };
    }

    // Check if already linked
    const existingLink = await this.getExistingLink(input.email_id, shipment.id);
    if (existingLink) {
      return {
        linked: true,
        shipment_id: shipment.id,
        link_strategy: linkStrategy,
        authority_email_id: identifierResult.authority_email_id,
        link_metadata: {
          link_source: existingLink.link_source || LinkSource.REALTIME,
          link_identifier_type:
            existingLink.link_identifier_type || identifierResult.identifier_type,
          link_identifier_value:
            existingLink.link_identifier_value || identifierResult.identifier_value,
          link_confidence_score: existingLink.link_confidence_score || identifierResult.confidence_score,
          email_authority: existingLink.email_authority || EmailAuthority.INTERNAL,
          linked_at: existingLink.created_at,
        },
      };
    }

    // Determine email authority
    const emailAuthority = this.determineEmailAuthority(
      input.sender_email,
      input.true_sender_email
    );

    // Calculate confidence score
    const confidenceScore = this.calculateConfidence(
      identifierResult.identifier_type,
      identifierResult.confidence_score,
      emailAuthority,
      linkStrategy
    );

    // Create the link
    const linkMetadata: LinkMetadata = {
      link_source: LinkSource.REALTIME,
      link_identifier_type: identifierResult.identifier_type,
      link_identifier_value: identifierResult.identifier_value,
      link_confidence_score: confidenceScore,
      email_authority: emailAuthority,
      linked_at: new Date().toISOString(),
    };

    const createResult = await this.createLink(
      input.email_id,
      shipment.id,
      input.document_type,
      linkMetadata,
      identifierResult.authority_email_id
    );

    if (!createResult.success) {
      return {
        linked: false,
        link_strategy: linkStrategy,
        authority_email_id: identifierResult.authority_email_id,
        error: createResult.error,
      };
    }

    // Update thread authority with shipment_id (for future lookups)
    if (identifierResult.source === 'thread_authority') {
      await this.updateThreadAuthorityShipment(
        identifierResult.authority_email_id!,
        shipment.id
      );
    }

    return {
      linked: true,
      shipment_id: shipment.id,
      link_strategy: linkStrategy,
      authority_email_id: identifierResult.authority_email_id,
      link_metadata: linkMetadata,
    };
  }

  /**
   * Batch link emails in a thread.
   * Links all emails to the same shipment as the thread authority.
   */
  async linkThread(threadId: string): Promise<{
    success: boolean;
    emails_linked: number;
    emails_skipped: number;
    shipment_id?: string;
    error?: string;
  }> {
    // Get thread authority
    const authority = await this.threadSummaryService.getThreadAuthority(threadId);
    if (!authority) {
      return {
        success: false,
        emails_linked: 0,
        emails_skipped: 0,
        error: 'No thread authority found - no valid identifier in thread',
      };
    }

    // Find shipment
    const shipment = await this.findShipmentByIdentifier(
      authority.primary_identifier_type,
      authority.primary_identifier_value
    );

    if (!shipment) {
      return {
        success: false,
        emails_linked: 0,
        emails_skipped: 0,
        error: `No shipment found for ${authority.primary_identifier_type}: ${authority.primary_identifier_value}`,
      };
    }

    // Get all thread emails
    const { data: emails } = await this.supabase
      .from('raw_emails')
      .select('id, sender_email, true_sender_email')
      .eq('thread_id', threadId);

    let linked = 0;
    let skipped = 0;

    for (const email of emails || []) {
      // Get document classification for this email
      const { data: classification } = await this.supabase
        .from('document_classifications')
        .select('document_type')
        .eq('email_id', email.id)
        .single();

      const result = await this.linkEmail({
        email_id: email.id,
        document_type: classification?.document_type,
        sender_email: email.sender_email,
        true_sender_email: email.true_sender_email,
      });

      if (result.linked) {
        linked++;
      } else {
        skipped++;
      }
    }

    return {
      success: true,
      emails_linked: linked,
      emails_skipped: skipped,
      shipment_id: shipment.id,
    };
  }

  /**
   * Repair cross-linked emails.
   * Finds emails linked to wrong shipments and re-links them using thread authority.
   */
  async repairCrossLinks(
    options: { dryRun?: boolean; limit?: number } = {}
  ): Promise<{
    total_checked: number;
    cross_links_found: number;
    repaired: number;
    details: Array<{
      email_id: string;
      old_shipment_id: string;
      new_shipment_id: string;
      reason: string;
    }>;
  }> {
    const { dryRun = true, limit = 100 } = options;

    // Get emails linked to shipments where the identifier doesn't match
    const { data: linkedEmails } = await this.supabase
      .from('shipment_documents')
      .select(`
        id,
        email_id,
        shipment_id,
        document_type,
        shipments(booking_number, bl_number),
        raw_emails!inner(thread_id, is_response, subject)
      `)
      .not('raw_emails.thread_id', 'is', null)
      .eq('raw_emails.is_response', true)
      .limit(limit);

    let crossLinksFound = 0;
    let repaired = 0;
    const details: Array<{
      email_id: string;
      old_shipment_id: string;
      new_shipment_id: string;
      reason: string;
    }> = [];

    for (const doc of linkedEmails || []) {
      const email = (doc as any).raw_emails;
      const shipment = (doc as any).shipments;

      // Get thread authority
      const authority = await this.threadSummaryService.getThreadAuthority(email.thread_id);
      if (!authority) continue;

      // Find correct shipment
      const correctShipment = await this.findShipmentByIdentifier(
        authority.primary_identifier_type,
        authority.primary_identifier_value
      );

      if (!correctShipment) continue;

      // Check if it's cross-linked
      if (correctShipment.id !== doc.shipment_id) {
        crossLinksFound++;

        if (!dryRun) {
          // Delete old link
          await this.supabase
            .from('shipment_documents')
            .delete()
            .eq('id', doc.id);

          // Create new link
          await this.createLink(
            doc.email_id,
            correctShipment.id,
            doc.document_type,
            {
              link_source: LinkSource.MIGRATION,
              link_identifier_type: authority.primary_identifier_type,
              link_identifier_value: authority.primary_identifier_value,
              link_confidence_score: authority.confidence_score,
              email_authority: EmailAuthority.INTERNAL,
              linked_at: new Date().toISOString(),
            },
            authority.authority_email_id
          );

          repaired++;
        }

        details.push({
          email_id: doc.email_id,
          old_shipment_id: doc.shipment_id,
          new_shipment_id: correctShipment.id,
          reason: `Thread authority (${authority.primary_identifier_type}: ${authority.primary_identifier_value}) links to different shipment`,
        });
      }
    }

    return {
      total_checked: linkedEmails?.length || 0,
      cross_links_found: crossLinksFound,
      repaired: dryRun ? 0 : repaired,
      details,
    };
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Find shipment by any identifier type.
   */
  private async findShipmentByIdentifier(
    identifierType: IdentifierType,
    identifierValue: string
  ): Promise<{ id: string; booking_number?: string; bl_number?: string } | null> {
    switch (identifierType) {
      case 'booking_number': {
        const { data } = await this.supabase
          .from('shipments')
          .select('id, booking_number, bl_number')
          .eq('booking_number', identifierValue)
          .single();
        return data;
      }
      case 'bl_number': {
        const { data } = await this.supabase
          .from('shipments')
          .select('id, booking_number, bl_number')
          .eq('bl_number', identifierValue)
          .single();
        return data;
      }
      case 'container_number': {
        // Container can match multiple shipments - get the most recent
        const { data } = await this.supabase
          .from('shipment_containers')
          .select('shipment_id, shipments!inner(id, booking_number, bl_number)')
          .eq('container_number', identifierValue)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (data) {
          const shipment = (data as any).shipments;
          return {
            id: shipment.id,
            booking_number: shipment.booking_number,
            bl_number: shipment.bl_number,
          };
        }
        return null;
      }
      default:
        return null;
    }
  }

  /**
   * Get existing link between email and shipment.
   */
  private async getExistingLink(
    emailId: string,
    shipmentId: string
  ): Promise<any | null> {
    const { data } = await this.supabase
      .from('shipment_documents')
      .select('*')
      .eq('email_id', emailId)
      .eq('shipment_id', shipmentId)
      .single();

    return data;
  }

  /**
   * Create link in shipment_documents.
   */
  private async createLink(
    emailId: string,
    shipmentId: string,
    documentType?: string,
    linkMetadata?: LinkMetadata,
    authorityEmailId?: string
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    const { data, error } = await this.supabase
      .from('shipment_documents')
      .insert({
        email_id: emailId,
        shipment_id: shipmentId,
        document_type: documentType || 'unknown',
        link_source: linkMetadata?.link_source || LinkSource.REALTIME,
        link_identifier_type: linkMetadata?.link_identifier_type,
        link_identifier_value: linkMetadata?.link_identifier_value,
        link_confidence_score: linkMetadata?.link_confidence_score,
        email_authority: linkMetadata?.email_authority,
        authority_email_id: authorityEmailId,
      })
      .select('id')
      .single();

    if (error) {
      // Handle duplicate gracefully
      if (error.code === '23505') {
        return { success: true };
      }
      return { success: false, error: error.message };
    }

    return { success: true, id: data?.id };
  }

  /**
   * Determine email authority based on sender.
   */
  private determineEmailAuthority(
    senderEmail?: string,
    trueSenderEmail?: string
  ): EmailAuthority {
    const emailToCheck = trueSenderEmail || senderEmail;
    if (!emailToCheck) return EmailAuthority.INTERNAL;

    const domain = emailToCheck.split('@')[1]?.toLowerCase();
    if (!domain) return EmailAuthority.INTERNAL;

    // Direct carrier email
    if (DIRECT_CARRIER_DOMAINS.some((d) => domain.includes(d))) {
      return trueSenderEmail && trueSenderEmail !== senderEmail
        ? EmailAuthority.FORWARDED_CARRIER
        : EmailAuthority.DIRECT_CARRIER;
    }

    // Internal (intoglo) email
    if (domain.includes('intoglo')) {
      return EmailAuthority.INTERNAL;
    }

    return EmailAuthority.THIRD_PARTY;
  }

  /**
   * Calculate confidence score for linking.
   */
  private calculateConfidence(
    identifierType: IdentifierType,
    extractionConfidence: number,
    emailAuthority: EmailAuthority,
    linkStrategy: 'thread_authority' | 'direct_extraction'
  ): number {
    let score = extractionConfidence;

    // Boost for thread authority (more reliable than direct extraction)
    if (linkStrategy === 'thread_authority') {
      score = Math.min(100, score + 10);
    }

    // Identifier type weights
    const identifierWeights: Record<string, number> = {
      booking_number: 1.0,
      bl_number: 0.95,
      container_number: 0.85,
      reference_number: 0.7,
    };
    score *= identifierWeights[identifierType] || 0.8;

    // Authority weights
    const authorityWeights: Record<EmailAuthority, number> = {
      [EmailAuthority.DIRECT_CARRIER]: 1.0,
      [EmailAuthority.FORWARDED_CARRIER]: 0.95,
      [EmailAuthority.INTERNAL]: 0.85,
      [EmailAuthority.THIRD_PARTY]: 0.7,
    };
    score *= authorityWeights[emailAuthority];

    return Math.round(score);
  }

  /**
   * Update thread authority with shipment_id.
   */
  private async updateThreadAuthorityShipment(
    authorityEmailId: string,
    shipmentId: string
  ): Promise<void> {
    // Get thread_id from email
    const { data: email } = await this.supabase
      .from('raw_emails')
      .select('thread_id')
      .eq('id', authorityEmailId)
      .single();

    if (!email?.thread_id) return;

    await this.supabase
      .from('email_thread_summaries')
      .update({ shipment_id: shipmentId, updated_at: new Date().toISOString() })
      .eq('thread_id', email.thread_id);
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createThreadAwareLinkingService(
  supabase: SupabaseClient
): ThreadAwareLinkingService {
  return new ThreadAwareLinkingService(supabase);
}
