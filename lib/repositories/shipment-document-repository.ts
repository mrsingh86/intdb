/**
 * Shipment Document Repository
 *
 * UPDATED: Now uses split tables (email_shipment_links + attachment_shipment_links)
 * Maintains backward-compatible interface for existing code.
 *
 * Architecture:
 * - email_shipment_links: Email-level association (thread tracking)
 * - attachment_shipment_links: Document-level linking (actual proof)
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { ShipmentDocument } from '@/types/shipment';
import { v4 as uuidv4 } from 'uuid';
import {
  EmailShipmentLinkRepository,
  EmailShipmentLinkInput,
} from './email-shipment-link-repository';
import {
  AttachmentShipmentLinkRepository,
  AttachmentShipmentLinkInput,
} from './attachment-shipment-link-repository';

// ============================================================================
// Types
// ============================================================================

export interface LinkDocumentInput {
  emailId: string;
  shipmentId: string;
  documentType: string;
  attachmentId?: string;
  linkMethod?: string;
  linkSource?: string;
  linkConfidenceScore?: number;
  linkIdentifierType?: string;
  linkIdentifierValue?: string;
  matchedBookingNumber?: string;
  matchedBlNumber?: string;
  matchedContainerNumber?: string;
  documentDate?: string;
  documentNumber?: string;
  isPrimary?: boolean;
  threadId?: string;
  isThreadAuthority?: boolean;
  emailType?: string;
  senderCategory?: string;
}

export interface CreateOrphanInput {
  emailId: string;
  documentType: string;
  attachmentId?: string;
  bookingNumberExtracted?: string;
  blNumberExtracted?: string;
  containerNumberExtracted?: string;
  threadId?: string;
}

// ============================================================================
// Repository
// ============================================================================

export class ShipmentDocumentRepository {
  private emailLinkRepo: EmailShipmentLinkRepository;
  private attachmentLinkRepo: AttachmentShipmentLinkRepository;

  constructor(private readonly supabase: SupabaseClient) {
    this.emailLinkRepo = new EmailShipmentLinkRepository(supabase);
    this.attachmentLinkRepo = new AttachmentShipmentLinkRepository(supabase);
  }

  /**
   * Find all documents for a shipment (from attachment_shipment_links)
   */
  async findByShipmentId(shipmentId: string): Promise<ShipmentDocument[]> {
    const attachmentLinks = await this.attachmentLinkRepo.findByShipmentId(shipmentId);

    // Map to ShipmentDocument format for backward compatibility
    return attachmentLinks.map(link => ({
      id: link.id,
      email_id: link.email_id,
      shipment_id: link.shipment_id,
      document_type: link.document_type,
      document_date: link.document_date,
      document_number: link.document_number,
      is_primary: link.is_primary,
      link_confidence_score: link.link_confidence_score,
      link_method: link.link_method,
      link_source: link.link_source,
      link_identifier_type: link.link_identifier_type,
      link_identifier_value: link.link_identifier_value,
      matched_booking_number: link.matched_booking_number,
      matched_bl_number: link.matched_bl_number,
      matched_container_number: link.matched_container_number,
      status: link.status,
      linked_at: link.linked_at,
      created_at: link.created_at,
      // New fields
      attachment_id: link.attachment_id,
      linking_id: link.linking_id,
    } as ShipmentDocument));
  }

  /**
   * Find all documents for a shipment with classification and email data
   */
  async findByShipmentIdWithClassification(shipmentId: string): Promise<(ShipmentDocument & {
    classification?: any;
    gmail_message_id?: string;
    true_sender_email?: string;
    sender_email?: string;
    received_at?: string;
    filename?: string;
  })[]> {
    // Get attachment links with attachment details
    const attachmentLinks = await this.attachmentLinkRepo.findByShipmentIdWithAttachments(shipmentId);

    if (attachmentLinks.length === 0) {
      return [];
    }

    // Get email IDs for additional data
    const emailIds = [...new Set(attachmentLinks.map(l => l.email_id))];

    // Fetch classifications and raw_emails data in parallel
    const [classificationsResult, emailsResult] = await Promise.all([
      this.supabase
        .from('document_classifications')
        .select(`
          email_id,
          document_direction,
          sender_party_type,
          receiver_party_type,
          workflow_state,
          requires_approval_from,
          revision_type,
          revision_number
        `)
        .in('email_id', emailIds),
      this.supabase
        .from('raw_emails')
        .select('id, gmail_message_id, sender_email, true_sender_email, received_at')
        .in('id', emailIds),
    ]);

    const classifications = classificationsResult.data || [];
    const emails = emailsResult.data || [];

    // Create maps for quick lookup
    const classificationMap = new Map(
      classifications.map(c => [c.email_id, {
        document_direction: c.document_direction,
        sender_party_type: c.sender_party_type,
        receiver_party_type: c.receiver_party_type,
        workflow_state: c.workflow_state,
        requires_approval_from: c.requires_approval_from,
        revision_type: c.revision_type,
        revision_number: c.revision_number,
      }])
    );

    const emailMap = new Map(
      emails.map(e => [e.id, {
        gmail_message_id: e.gmail_message_id,
        sender_email: e.sender_email,
        true_sender_email: e.true_sender_email,
        received_at: e.received_at,
      }])
    );

    // Merge all data
    return attachmentLinks.map(link => {
      const emailData = emailMap.get(link.email_id) || {};
      return {
        id: link.id,
        email_id: link.email_id,
        shipment_id: link.shipment_id,
        document_type: link.document_type,
        document_date: link.document_date,
        document_number: link.document_number,
        is_primary: link.is_primary,
        link_confidence_score: link.link_confidence_score,
        link_method: link.link_method,
        matched_booking_number: link.matched_booking_number,
        matched_bl_number: link.matched_bl_number,
        matched_container_number: link.matched_container_number,
        status: link.status,
        linked_at: link.linked_at,
        created_at: link.created_at,
        attachment_id: link.attachment_id,
        linking_id: link.linking_id,
        filename: link.filename,
        ...emailData,
        classification: classificationMap.get(link.email_id) || null,
      } as ShipmentDocument & {
        classification?: any;
        gmail_message_id?: string;
        true_sender_email?: string;
        sender_email?: string;
        received_at?: string;
        filename?: string;
      };
    });
  }

  /**
   * Find document by email ID
   */
  async findByEmailId(emailId: string): Promise<ShipmentDocument | null> {
    // First check attachment links
    const attachmentLinks = await this.attachmentLinkRepo.findByEmailId(emailId);
    if (attachmentLinks.length > 0) {
      const link = attachmentLinks[0];
      return {
        id: link.id,
        email_id: link.email_id,
        shipment_id: link.shipment_id,
        document_type: link.document_type,
        attachment_id: link.attachment_id,
      } as ShipmentDocument;
    }

    // Fall back to email links
    const emailLink = await this.emailLinkRepo.findByEmailId(emailId);
    if (emailLink) {
      return {
        id: emailLink.id,
        email_id: emailLink.email_id,
        shipment_id: emailLink.shipment_id,
        document_type: 'email',
      } as ShipmentDocument;
    }

    return null;
  }

  /**
   * Link email/document to shipment (MAIN METHOD)
   * Creates both email_shipment_link and attachment_shipment_link if attachment exists
   */
  async create(document: Partial<ShipmentDocument>): Promise<ShipmentDocument> {
    return this.linkDocument({
      emailId: document.email_id!,
      shipmentId: document.shipment_id!,
      documentType: document.document_type || 'unknown',
      attachmentId: (document as any).attachment_id,
      linkMethod: document.link_method ?? undefined,
      linkConfidenceScore: document.link_confidence_score ?? undefined,
      matchedBookingNumber: document.matched_booking_number ?? undefined,
      matchedBlNumber: document.matched_bl_number ?? undefined,
      matchedContainerNumber: document.matched_container_number ?? undefined,
    });
  }

  /**
   * Link document to shipment with full data
   */
  async linkDocument(input: LinkDocumentInput): Promise<ShipmentDocument> {
    const linkingId = uuidv4();

    // 1. Always create email-level link
    const emailLinkInput: EmailShipmentLinkInput = {
      email_id: input.emailId,
      shipment_id: input.shipmentId,
      thread_id: input.threadId,
      linking_id: linkingId,
      link_method: input.linkMethod,
      link_source: input.linkSource,
      link_confidence_score: input.linkConfidenceScore,
      link_identifier_type: input.linkIdentifierType,
      link_identifier_value: input.linkIdentifierValue,
      is_thread_authority: input.isThreadAuthority,
      email_type: input.emailType,
      sender_category: input.senderCategory,
    };

    const emailLink = await this.emailLinkRepo.upsert(emailLinkInput);

    // 2. Create attachment-level link if attachment exists
    if (input.attachmentId) {
      const attachmentLinkInput: AttachmentShipmentLinkInput = {
        attachment_id: input.attachmentId,
        email_id: input.emailId,
        shipment_id: input.shipmentId,
        thread_id: input.threadId,
        linking_id: linkingId,
        link_method: input.linkMethod,
        link_source: input.linkSource,
        link_confidence_score: input.linkConfidenceScore,
        link_identifier_type: input.linkIdentifierType,
        link_identifier_value: input.linkIdentifierValue,
        matched_booking_number: input.matchedBookingNumber,
        matched_bl_number: input.matchedBlNumber,
        matched_container_number: input.matchedContainerNumber,
        document_type: input.documentType,
        document_date: input.documentDate,
        document_number: input.documentNumber,
        is_primary: input.isPrimary,
      };

      const attachmentLink = await this.attachmentLinkRepo.upsert(attachmentLinkInput);

      return {
        id: attachmentLink.id,
        email_id: attachmentLink.email_id,
        shipment_id: attachmentLink.shipment_id,
        document_type: attachmentLink.document_type,
        attachment_id: attachmentLink.attachment_id,
        linking_id: attachmentLink.linking_id,
        link_confidence_score: attachmentLink.link_confidence_score,
        link_method: attachmentLink.link_method,
        matched_booking_number: attachmentLink.matched_booking_number,
        matched_bl_number: attachmentLink.matched_bl_number,
        matched_container_number: attachmentLink.matched_container_number,
      } as ShipmentDocument;
    }

    // Return email link if no attachment
    return {
      id: emailLink.id,
      email_id: emailLink.email_id,
      shipment_id: emailLink.shipment_id,
      document_type: input.documentType,
      linking_id: emailLink.linking_id,
      link_confidence_score: emailLink.link_confidence_score,
      link_method: emailLink.link_method,
    } as ShipmentDocument;
  }

  /**
   * Link email to shipment (backward compatible)
   */
  async linkEmailToShipment(params: {
    emailId: string;
    shipmentId: string;
    documentType: string;
    linkMethod: 'regex' | 'ai' | 'bl_number' | 'container_number' | 'booking_number' | 'manual';
    documentNumber?: string;
    linkConfidenceScore?: number;
    documentDate?: string;
    subject?: string;
    attachmentId?: string;
  }): Promise<ShipmentDocument> {
    return this.linkDocument({
      emailId: params.emailId,
      shipmentId: params.shipmentId,
      documentType: params.documentType,
      attachmentId: params.attachmentId,
      linkMethod: params.linkMethod,
      linkConfidenceScore: params.linkConfidenceScore,
      documentDate: params.documentDate,
      documentNumber: params.documentNumber,
    });
  }

  /**
   * Check if email is already linked to a shipment
   */
  async isEmailLinked(emailId: string): Promise<boolean> {
    return this.emailLinkRepo.isEmailLinked(emailId);
  }

  /**
   * Check if email is linked to a specific shipment
   */
  async isEmailLinkedToShipment(emailId: string, shipmentId: string): Promise<boolean> {
    const link = await this.emailLinkRepo.findByEmailId(emailId);
    return link?.shipment_id === shipmentId;
  }

  /**
   * Create orphan document (no shipment linked yet)
   */
  async createOrphan(params: CreateOrphanInput): Promise<ShipmentDocument> {
    const linkingId = uuidv4();

    // Create email link as orphan
    await this.emailLinkRepo.upsert({
      email_id: params.emailId,
      shipment_id: null,
      thread_id: params.threadId,
      linking_id: linkingId,
      status: 'orphan',
    });

    // Create attachment link as orphan if attachment exists
    if (params.attachmentId) {
      const attachmentLink = await this.attachmentLinkRepo.upsert({
        attachment_id: params.attachmentId,
        email_id: params.emailId,
        shipment_id: null,
        thread_id: params.threadId,
        linking_id: linkingId,
        document_type: params.documentType,
        matched_booking_number: params.bookingNumberExtracted,
        matched_bl_number: params.blNumberExtracted,
        matched_container_number: params.containerNumberExtracted,
        status: 'orphan',
      });

      return {
        id: attachmentLink.id,
        email_id: attachmentLink.email_id,
        shipment_id: null,
        document_type: attachmentLink.document_type,
        attachment_id: attachmentLink.attachment_id,
        status: 'orphan',
      } as ShipmentDocument;
    }

    return {
      id: linkingId,
      email_id: params.emailId,
      shipment_id: null,
      document_type: params.documentType,
      status: 'orphan',
    } as ShipmentDocument;
  }

  /**
   * Find orphan documents by identifier
   */
  async findOrphansByIdentifier(
    identifierType: 'booking_number' | 'bl_number' | 'container_number',
    identifierValue: string
  ): Promise<ShipmentDocument[]> {
    const orphans = await this.attachmentLinkRepo.findOrphansByIdentifier(
      identifierType,
      identifierValue
    );

    return orphans.map(link => ({
      id: link.id,
      email_id: link.email_id,
      shipment_id: link.shipment_id,
      document_type: link.document_type,
      attachment_id: link.attachment_id,
      matched_booking_number: link.matched_booking_number,
      matched_bl_number: link.matched_bl_number,
      matched_container_number: link.matched_container_number,
    } as ShipmentDocument));
  }

  /**
   * Link orphan documents to a shipment
   */
  async linkOrphansToShipment(
    shipmentId: string,
    orphanIds: string[]
  ): Promise<number> {
    return this.attachmentLinkRepo.linkOrphansToShipment(shipmentId, orphanIds);
  }

  /**
   * Delete document link
   */
  async delete(id: string): Promise<void> {
    // Try to delete from attachment_shipment_links first
    const { error: attachmentError } = await this.supabase
      .from('attachment_shipment_links')
      .delete()
      .eq('id', id);

    if (!attachmentError) return;

    // If not found, try email_shipment_links
    const { error: emailError } = await this.supabase
      .from('email_shipment_links')
      .delete()
      .eq('id', id);

    if (emailError) {
      throw new Error(`Failed to delete link: ${emailError.message}`);
    }
  }

  /**
   * Update document metadata
   */
  async update(id: string, updates: Partial<ShipmentDocument>): Promise<ShipmentDocument> {
    // Try attachment_shipment_links first
    const { data: attachmentData, error: attachmentError } = await this.supabase
      .from('attachment_shipment_links')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (attachmentData) return attachmentData as ShipmentDocument;

    // Fall back to email_shipment_links
    const { data: emailData, error: emailError } = await this.supabase
      .from('email_shipment_links')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (emailError || !emailData) {
      throw new Error(`Failed to update link: ${emailError?.message || attachmentError?.message}`);
    }

    return emailData as ShipmentDocument;
  }

  // ============================================================================
  // Direct access to sub-repositories (for advanced use cases)
  // ============================================================================

  get emailLinks(): EmailShipmentLinkRepository {
    return this.emailLinkRepo;
  }

  get attachmentLinks(): AttachmentShipmentLinkRepository {
    return this.attachmentLinkRepo;
  }
}
