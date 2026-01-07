/**
 * Attachment Shipment Link Repository
 *
 * Manages attachment/document-level associations with shipments.
 * One record per attachment-shipment pair (for actual document proof).
 *
 * Part of the split architecture:
 * - email_shipment_links: Email-level
 * - attachment_shipment_links: Document-level (this)
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

export interface AttachmentShipmentLink {
  id: string;
  attachment_id: string;
  email_id: string;
  shipment_id: string | null;
  thread_id: string | null;
  linking_id: string | null;
  link_method: string | null;
  link_source: string | null;
  link_confidence_score: number | null;
  link_identifier_type: string | null;
  link_identifier_value: string | null;
  matched_booking_number: string | null;
  matched_bl_number: string | null;
  matched_hbl_number: string | null;
  matched_container_number: string | null;
  document_type: string;
  document_category: string | null;
  document_date: string | null;
  document_number: string | null;
  is_primary: boolean;
  extraction_id: string | null;
  status: string;
  linked_at: string | null;
  linked_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttachmentShipmentLinkInput {
  attachment_id: string;
  email_id: string;
  shipment_id?: string | null;
  thread_id?: string | null;
  linking_id?: string;
  link_method?: string;
  link_source?: string;
  link_confidence_score?: number;
  link_identifier_type?: string;
  link_identifier_value?: string;
  matched_booking_number?: string;
  matched_bl_number?: string;
  matched_hbl_number?: string;
  matched_container_number?: string;
  document_type: string;
  document_category?: string;
  document_date?: string;
  document_number?: string;
  is_primary?: boolean;
  extraction_id?: string;
  status?: string;
}

// ============================================================================
// Repository
// ============================================================================

export class AttachmentShipmentLinkRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Create or update attachment-shipment link (idempotent)
   */
  async upsert(input: AttachmentShipmentLinkInput): Promise<AttachmentShipmentLink> {
    // Check if link exists
    const { data: existing } = await this.supabase
      .from('attachment_shipment_links')
      .select('id')
      .eq('attachment_id', input.attachment_id)
      .eq('shipment_id', input.shipment_id || '')
      .maybeSingle();

    if (existing) {
      // Update existing
      const { data, error } = await this.supabase
        .from('attachment_shipment_links')
        .update({
          ...input,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw new Error(`Failed to update attachment link: ${error.message}`);
      return data;
    }

    // Insert new
    const { data, error } = await this.supabase
      .from('attachment_shipment_links')
      .insert({
        ...input,
        status: input.status || (input.shipment_id ? 'linked' : 'orphan'),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return this.upsert(input);
      }
      throw new Error(`Failed to create attachment link: ${error.message}`);
    }

    return data;
  }

  /**
   * Find link by attachment ID
   */
  async findByAttachmentId(attachmentId: string): Promise<AttachmentShipmentLink | null> {
    const { data, error } = await this.supabase
      .from('attachment_shipment_links')
      .select('*')
      .eq('attachment_id', attachmentId)
      .maybeSingle();

    if (error) throw new Error(`Failed to find attachment link: ${error.message}`);
    return data;
  }

  /**
   * Find all attachment links for an email
   */
  async findByEmailId(emailId: string): Promise<AttachmentShipmentLink[]> {
    const { data, error } = await this.supabase
      .from('attachment_shipment_links')
      .select('*')
      .eq('email_id', emailId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to find email attachment links: ${error.message}`);
    return data || [];
  }

  /**
   * Find all documents for a shipment (with attachment details)
   */
  async findByShipmentId(shipmentId: string): Promise<AttachmentShipmentLink[]> {
    const { data, error } = await this.supabase
      .from('attachment_shipment_links')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to find shipment documents: ${error.message}`);
    return data || [];
  }

  /**
   * Find documents by shipment with full attachment data
   */
  async findByShipmentIdWithAttachments(shipmentId: string): Promise<(AttachmentShipmentLink & {
    filename?: string;
    mime_type?: string;
    extracted_text?: string;
  })[]> {
    const { data: links, error: linkError } = await this.supabase
      .from('attachment_shipment_links')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('document_date', { ascending: false });

    if (linkError) throw new Error(`Failed to find shipment documents: ${linkError.message}`);
    if (!links || links.length === 0) return [];

    // Fetch attachment details
    const attachmentIds = links.map(l => l.attachment_id);
    const { data: attachments } = await this.supabase
      .from('raw_attachments')
      .select('id, filename, mime_type, extracted_text')
      .in('id', attachmentIds);

    const attachmentMap = new Map(
      (attachments || []).map(a => [a.id, a])
    );

    return links.map(link => ({
      ...link,
      ...attachmentMap.get(link.attachment_id),
    }));
  }

  /**
   * Find documents by type for a shipment
   */
  async findByShipmentAndType(
    shipmentId: string,
    documentType: string
  ): Promise<AttachmentShipmentLink[]> {
    const { data, error } = await this.supabase
      .from('attachment_shipment_links')
      .select('*')
      .eq('shipment_id', shipmentId)
      .eq('document_type', documentType)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to find documents: ${error.message}`);
    return data || [];
  }

  /**
   * Find orphan documents by extracted identifier
   */
  async findOrphansByIdentifier(
    identifierType: 'booking_number' | 'bl_number' | 'hbl_number' | 'container_number',
    identifierValue: string
  ): Promise<AttachmentShipmentLink[]> {
    const columnMap = {
      booking_number: 'matched_booking_number',
      bl_number: 'matched_bl_number',
      hbl_number: 'matched_hbl_number',
      container_number: 'matched_container_number',
    };

    const { data, error } = await this.supabase
      .from('attachment_shipment_links')
      .select('*')
      .is('shipment_id', null)
      .eq(columnMap[identifierType], identifierValue);

    if (error) throw new Error(`Failed to find orphan documents: ${error.message}`);
    return data || [];
  }

  /**
   * Link orphan documents to shipment
   */
  async linkOrphansToShipment(
    shipmentId: string,
    orphanIds: string[]
  ): Promise<number> {
    if (orphanIds.length === 0) return 0;

    const { error, count } = await this.supabase
      .from('attachment_shipment_links')
      .update({
        shipment_id: shipmentId,
        status: 'linked',
        linked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .in('id', orphanIds);

    if (error) throw new Error(`Failed to link orphan documents: ${error.message}`);
    return count ?? 0;
  }

  /**
   * Set primary document for a shipment+type
   */
  async setPrimary(id: string, shipmentId: string, documentType: string): Promise<void> {
    // Unset any existing primary
    await this.supabase
      .from('attachment_shipment_links')
      .update({ is_primary: false })
      .eq('shipment_id', shipmentId)
      .eq('document_type', documentType);

    // Set new primary
    await this.supabase
      .from('attachment_shipment_links')
      .update({ is_primary: true })
      .eq('id', id);
  }

  /**
   * Check if attachment is linked to any shipment
   */
  async isAttachmentLinked(attachmentId: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('attachment_shipment_links')
      .select('*', { count: 'exact', head: true })
      .eq('attachment_id', attachmentId)
      .not('shipment_id', 'is', null);

    return !error && (count ?? 0) > 0;
  }

  /**
   * Get shipment ID for an attachment
   */
  async getShipmentId(attachmentId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('attachment_shipment_links')
      .select('shipment_id')
      .eq('attachment_id', attachmentId)
      .not('shipment_id', 'is', null)
      .maybeSingle();

    return data?.shipment_id || null;
  }
}
