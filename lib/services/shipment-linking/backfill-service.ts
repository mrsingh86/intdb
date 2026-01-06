/**
 * Backfill Service
 *
 * Finds and links emails when a shipment is created or updated.
 * Implements the "Shipment → Emails" direction of bi-directional linking.
 *
 * Principles:
 * - Deep Module: Simple interface, complex backfill logic
 * - Idempotent: Safe to run multiple times
 * - Database-Driven: Uses entity_extractions table
 * - Audit Trail: Records all link operations
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { LinkConfidenceCalculator } from './link-confidence-calculator';
import {
  BackfillResult,
  BatchBackfillResult,
  ConflictInfo,
  ConflictType,
  EmailAuthority,
  IdentifierType,
  LinkMetadata,
  LinkSource,
  ShipmentIdentifiers,
  UnlinkedEmailInfo,
  DIRECT_CARRIER_DOMAINS,
} from './types';

interface Shipment {
  id: string;
  booking_number?: string;
  bl_number?: string;
  container_number_primary?: string;
  container_numbers?: string[];
  created_at?: string;
}

interface BackfillOptions {
  batch_size?: number;
  dry_run?: boolean;
}

export class BackfillService {
  private confidenceCalculator: LinkConfidenceCalculator;

  constructor(private readonly supabase: SupabaseClient) {
    this.confidenceCalculator = new LinkConfidenceCalculator();
  }

  /**
   * Find and link all related emails for a shipment
   */
  async linkRelatedEmails(shipmentId: string): Promise<BackfillResult> {
    const result: BackfillResult = {
      emails_found: 0,
      emails_linked: 0,
      emails_skipped: 0,
      links_created: [],
      conflicts: [],
    };

    // 1. Get shipment details
    const { data: shipment, error: shipmentError } = await this.supabase
      .from('shipments')
      .select('id, booking_number, bl_number, container_number_primary, container_numbers, created_at')
      .eq('id', shipmentId)
      .single();

    if (shipmentError || !shipment) {
      console.error(`[BackfillService] Shipment not found: ${shipmentId}`);
      return result;
    }

    // 2. Get shipment identifiers
    const identifiers = this.extractIdentifiers(shipment);

    // 3. Link orphan documents FIRST (documents with shipment_id = null)
    const orphanResult = await this.linkOrphanDocuments(shipment, identifiers);
    result.emails_linked += orphanResult.linked;
    result.emails_skipped += orphanResult.skipped;

    // 4. Find unlinked emails with matching identifiers (from entity_extractions)
    const unlinkedEmails = await this.findUnlinkedEmailsByIdentifiers(
      identifiers,
      shipmentId
    );
    result.emails_found = unlinkedEmails.length + orphanResult.found;

    if (unlinkedEmails.length === 0) {
      return result;
    }

    // 5. Process each unlinked email
    for (const emailInfo of unlinkedEmails) {
      const linkResult = await this.attemptLink(emailInfo, shipment, identifiers);

      if (linkResult.linked && linkResult.metadata) {
        result.emails_linked++;
        result.links_created.push(linkResult.metadata);
      } else if (linkResult.conflict) {
        result.conflicts.push(linkResult.conflict);
      } else {
        result.emails_skipped++;
      }
    }

    return result;
  }

  /**
   * Link orphan documents (shipment_id = null) to a shipment
   * These are documents created before the shipment existed
   */
  private async linkOrphanDocuments(
    shipment: Shipment,
    identifiers: ShipmentIdentifiers
  ): Promise<{ found: number; linked: number; skipped: number }> {
    const result = { found: 0, linked: 0, skipped: 0 };

    // Find orphan documents with matching booking number
    const conditions: string[] = [];

    if (identifiers.booking_number) {
      conditions.push(`booking_number_extracted.eq.${identifiers.booking_number}`);
    }

    if (conditions.length === 0) {
      return result; // No identifiers to search by
    }

    const { data: orphans, error } = await this.supabase
      .from('shipment_documents')
      .select('id, email_id, document_type, booking_number_extracted')
      .is('shipment_id', null)
      .eq('status', 'pending_link')
      .or(conditions.join(','));

    if (error || !orphans || orphans.length === 0) {
      return result;
    }

    result.found = orphans.length;
    console.log(`[BackfillService] Found ${orphans.length} orphan documents for shipment ${shipment.id}`);

    // Link each orphan to the shipment
    for (const orphan of orphans) {
      const { error: updateError } = await this.supabase
        .from('shipment_documents')
        .update({
          shipment_id: shipment.id,
          status: 'linked',
          link_source: LinkSource.BACKFILL,
          link_identifier_type: 'booking_number',
          link_identifier_value: orphan.booking_number_extracted,
          link_confidence_score: 90, // High confidence - matched by booking number
          linked_at: new Date().toISOString(),
        })
        .eq('id', orphan.id);

      if (updateError) {
        console.error(`[BackfillService] Failed to link orphan ${orphan.id}:`, updateError.message);
        result.skipped++;
      } else {
        console.log(`[BackfillService] Linked orphan document ${orphan.document_type} (email: ${orphan.email_id?.substring(0, 8)}...) to shipment ${shipment.id}`);
        result.linked++;

        // Record in audit log
        await this.supabase.from('shipment_link_audit').insert({
          email_id: orphan.email_id,
          shipment_id: shipment.id,
          operation: 'link_orphan',
          link_source: LinkSource.BACKFILL,
          link_identifier_type: 'booking_number',
          link_identifier_value: orphan.booking_number_extracted,
          confidence_score: 90,
          notes: `Orphan document linked on shipment creation`,
        });
      }
    }

    return result;
  }

  /**
   * Find unlinked emails for a shipment (preview without linking)
   */
  async findUnlinkedEmails(shipmentId: string): Promise<UnlinkedEmailInfo[]> {
    const { data: shipment } = await this.supabase
      .from('shipments')
      .select('id, booking_number, bl_number, container_number_primary, container_numbers')
      .eq('id', shipmentId)
      .single();

    if (!shipment) return [];

    const identifiers = this.extractIdentifiers(shipment);
    return this.findUnlinkedEmailsByIdentifiers(identifiers, shipmentId);
  }

  /**
   * Batch backfill for all shipments
   */
  async backfillAll(options: BackfillOptions = {}): Promise<BatchBackfillResult> {
    const batchSize = options.batch_size || 100;
    const result: BatchBackfillResult = {
      shipments_processed: 0,
      total_emails_linked: 0,
      total_conflicts: 0,
      errors: [],
    };

    // Get all shipments with identifiers
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const { data: shipments } = await this.supabase
        .from('shipments')
        .select('id, booking_number, bl_number')
        .or('booking_number.not.is.null,bl_number.not.is.null')
        .range(offset, offset + batchSize - 1);

      if (!shipments || shipments.length === 0) {
        hasMore = false;
        break;
      }

      for (const shipment of shipments) {
        try {
          const backfillResult = await this.linkRelatedEmails(shipment.id);
          result.shipments_processed++;
          result.total_emails_linked += backfillResult.emails_linked;
          result.total_conflicts += backfillResult.conflicts.length;

          if (backfillResult.emails_linked > 0) {
            console.log(
              `[BackfillService] ${shipment.booking_number || shipment.id}: ` +
              `linked ${backfillResult.emails_linked} emails`
            );
          }
        } catch (error: any) {
          result.errors.push({
            shipment_id: shipment.id,
            error: error.message,
          });
        }
      }

      offset += batchSize;
      hasMore = shipments.length === batchSize;
    }

    return result;
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Extract all identifiers from a shipment
   */
  private extractIdentifiers(shipment: Shipment): ShipmentIdentifiers {
    const containerNumbers: string[] = [];

    if (shipment.container_number_primary) {
      containerNumbers.push(shipment.container_number_primary);
    }
    if (shipment.container_numbers) {
      for (const c of shipment.container_numbers) {
        if (!containerNumbers.includes(c)) {
          containerNumbers.push(c);
        }
      }
    }

    return {
      booking_number: shipment.booking_number || undefined,
      bl_number: shipment.bl_number || undefined,
      container_numbers: containerNumbers,
    };
  }

  /**
   * Find all unlinked emails matching any of the identifiers
   */
  private async findUnlinkedEmailsByIdentifiers(
    identifiers: ShipmentIdentifiers,
    shipmentId: string
  ): Promise<UnlinkedEmailInfo[]> {
    // Get emails already linked to THIS shipment
    const { data: existingLinks } = await this.supabase
      .from('shipment_documents')
      .select('email_id')
      .eq('shipment_id', shipmentId);

    const alreadyLinkedToThis = new Set(existingLinks?.map((l) => l.email_id) || []);

    const results: UnlinkedEmailInfo[] = [];
    const seenEmailIds = new Set<string>();

    // Search by booking number (highest priority)
    if (identifiers.booking_number) {
      const emails = await this.findEmailsByEntity(
        'booking_number',
        identifiers.booking_number
      );
      for (const email of emails) {
        if (!alreadyLinkedToThis.has(email.email_id) && !seenEmailIds.has(email.email_id)) {
          results.push(email);
          seenEmailIds.add(email.email_id);
        }
      }
    }

    // Search by BL number
    if (identifiers.bl_number) {
      const emails = await this.findEmailsByEntity('bl_number', identifiers.bl_number);
      for (const email of emails) {
        if (!alreadyLinkedToThis.has(email.email_id) && !seenEmailIds.has(email.email_id)) {
          results.push(email);
          seenEmailIds.add(email.email_id);
        }
      }
    }

    // Search by container numbers
    for (const container of identifiers.container_numbers) {
      const emails = await this.findEmailsByEntity('container_number', container);
      for (const email of emails) {
        if (!alreadyLinkedToThis.has(email.email_id) && !seenEmailIds.has(email.email_id)) {
          results.push(email);
          seenEmailIds.add(email.email_id);
        }
      }
    }

    return results;
  }

  /**
   * Find emails by entity type and value
   */
  private async findEmailsByEntity(
    entityType: string,
    entityValue: string
  ): Promise<UnlinkedEmailInfo[]> {
    const { data: entities } = await this.supabase
      .from('entity_extractions')
      .select('email_id, entity_type, entity_value, confidence_score')
      .eq('entity_type', entityType)
      .eq('entity_value', entityValue);

    if (!entities || entities.length === 0) {
      return [];
    }

    // Get email details for these
    const emailIds = entities.map((e) => e.email_id);
    const { data: emails } = await this.supabase
      .from('raw_emails')
      .select('id, subject, received_at, sender_email, true_sender_email')
      .in('id', emailIds);

    // Get classifications
    const { data: classifications } = await this.supabase
      .from('document_classifications')
      .select('email_id, document_type')
      .in('email_id', emailIds);

    const classificationMap = new Map(
      classifications?.map((c) => [c.email_id, c.document_type]) || []
    );
    const emailMap = new Map(emails?.map((e) => [e.id, e]) || []);

    return entities.map((entity) => {
      const email = emailMap.get(entity.email_id);
      return {
        email_id: entity.email_id,
        subject: email?.subject || '',
        received_at: email?.received_at || '',
        sender_email: email?.sender_email || '',
        true_sender_email: email?.true_sender_email,
        identifiers: {
          [entityType]: entity.entity_value,
          container_numbers: [],
        },
        document_type: classificationMap.get(entity.email_id),
        entity_confidence_score: entity.confidence_score,
      };
    });
  }

  /**
   * Attempt to link an email to a shipment
   */
  private async attemptLink(
    emailInfo: UnlinkedEmailInfo,
    shipment: Shipment,
    identifiers: ShipmentIdentifiers
  ): Promise<{ linked: boolean; metadata?: LinkMetadata; conflict?: ConflictInfo }> {
    // Check if already linked to a DIFFERENT shipment
    const { data: existingLink } = await this.supabase
      .from('shipment_documents')
      .select('shipment_id')
      .eq('email_id', emailInfo.email_id)
      .single();

    if (existingLink && existingLink.shipment_id !== shipment.id) {
      return {
        linked: false,
        conflict: {
          type: ConflictType.ALREADY_LINKED,
          email_id: emailInfo.email_id,
          shipment_ids: [existingLink.shipment_id, shipment.id],
          identifier_type: this.getBestIdentifierType(emailInfo, identifiers),
          identifier_value: this.getBestIdentifierValue(emailInfo, identifiers),
        },
      };
    }

    // Already linked to same shipment (idempotent)
    if (existingLink && existingLink.shipment_id === shipment.id) {
      return { linked: false };
    }

    // Determine best identifier match
    const identifierType = this.getBestIdentifierType(emailInfo, identifiers);
    const identifierValue = this.getBestIdentifierValue(emailInfo, identifiers);

    // Determine email authority
    const authority = this.determineEmailAuthority(
      emailInfo.true_sender_email || emailInfo.sender_email
    );

    // Calculate confidence
    const timeDiff = this.calculateTimeDifference(
      emailInfo.received_at,
      shipment.created_at
    );

    const confidence = this.confidenceCalculator.calculate({
      identifier_type: identifierType,
      identifier_value: identifierValue,
      email_authority: authority,
      document_type: emailInfo.document_type,
      time_proximity_days: timeDiff,
    });

    // Only auto-link if confidence is high enough
    if (!confidence.auto_link) {
      return { linked: false };
    }

    // Create the link
    const metadata: LinkMetadata = {
      link_source: LinkSource.BACKFILL,
      link_identifier_type: identifierType,
      link_identifier_value: identifierValue,
      link_confidence_score: confidence.score,
      email_authority: authority,
      linked_at: new Date().toISOString(),
    };

    const { error } = await this.supabase.from('shipment_documents').insert({
      shipment_id: shipment.id,
      email_id: emailInfo.email_id,
      document_type: emailInfo.document_type || 'unknown',
      link_source: metadata.link_source,
      link_identifier_type: metadata.link_identifier_type,
      link_identifier_value: metadata.link_identifier_value,
      link_confidence_score: metadata.link_confidence_score,
      email_authority: metadata.email_authority,
      linked_at: metadata.linked_at,
    });

    if (error) {
      console.error(`[BackfillService] Failed to link ${emailInfo.email_id}:`, error);
      return { linked: false };
    }

    // Record in audit log
    await this.supabase.from('shipment_link_audit').insert({
      email_id: emailInfo.email_id,
      shipment_id: shipment.id,
      operation: 'link',
      link_source: metadata.link_source,
      link_identifier_type: metadata.link_identifier_type,
      link_identifier_value: metadata.link_identifier_value,
      confidence_score: metadata.link_confidence_score,
      confidence_breakdown: confidence.breakdown,
      email_authority: metadata.email_authority,
      notes: `Backfilled via ${identifierType}`,
    });

    return { linked: true, metadata };
  }

  /**
   * Get the best identifier type for linking
   */
  private getBestIdentifierType(
    emailInfo: UnlinkedEmailInfo,
    identifiers: ShipmentIdentifiers
  ): IdentifierType {
    // Prefer booking_number > bl_number > container_number
    if (identifiers.booking_number && emailInfo.identifiers.booking_number) {
      return 'booking_number';
    }
    if (identifiers.bl_number && emailInfo.identifiers.bl_number) {
      return 'bl_number';
    }
    return 'container_number';
  }

  /**
   * Get the identifier value used for linking
   */
  private getBestIdentifierValue(
    emailInfo: UnlinkedEmailInfo,
    identifiers: ShipmentIdentifiers
  ): string {
    if (identifiers.booking_number && emailInfo.identifiers.booking_number) {
      return identifiers.booking_number;
    }
    if (identifiers.bl_number && emailInfo.identifiers.bl_number) {
      return identifiers.bl_number;
    }
    if (identifiers.container_numbers.length > 0) {
      return identifiers.container_numbers[0];
    }
    return '';
  }

  /**
   * Determine email authority from sender
   */
  private determineEmailAuthority(senderEmail: string): EmailAuthority {
    if (!senderEmail) return EmailAuthority.THIRD_PARTY;

    const domain = senderEmail.toLowerCase().split('@')[1] || '';

    // Check for direct carrier
    if (DIRECT_CARRIER_DOMAINS.some((d) => domain.includes(d))) {
      return EmailAuthority.DIRECT_CARRIER;
    }

    // Check for internal
    if (domain.includes('intoglo.com')) {
      return EmailAuthority.INTERNAL;
    }

    // Check for common forwarder patterns
    if (domain.includes('forwarder') || domain.includes('logistics')) {
      return EmailAuthority.THIRD_PARTY;
    }

    return EmailAuthority.THIRD_PARTY;
  }

  /**
   * Calculate time difference in days
   */
  private calculateTimeDifference(
    emailDate?: string,
    shipmentDate?: string
  ): number | undefined {
    if (!emailDate || !shipmentDate) return undefined;

    const email = new Date(emailDate);
    const shipment = new Date(shipmentDate);
    const diffMs = Math.abs(email.getTime() - shipment.getTime());
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }
}
