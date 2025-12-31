/**
 * Shipment Document Repository
 *
 * Manages linking between emails/documents and shipments.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { ShipmentDocument } from '@/types/shipment';

export class ShipmentDocumentRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Find all documents for a shipment
   */
  async findByShipmentId(shipmentId: string): Promise<ShipmentDocument[]> {
    const { data, error } = await this.supabase
      .from('shipment_documents')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('document_date', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch shipment documents: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Find all documents for a shipment with classification and email data
   * Includes true_sender_email for deduplication of group forwards
   */
  async findByShipmentIdWithClassification(shipmentId: string): Promise<(ShipmentDocument & {
    classification?: any;
    gmail_message_id?: string;
    true_sender_email?: string;
    sender_email?: string;
    received_at?: string;
  })[]> {
    const { data: documents, error: docError } = await this.supabase
      .from('shipment_documents')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('document_date', { ascending: false });

    if (docError) {
      throw new Error(`Failed to fetch shipment documents: ${docError.message}`);
    }

    if (!documents || documents.length === 0) {
      return [];
    }

    // Fetch email IDs
    const emailIds = documents.map(d => d.email_id).filter(Boolean);

    if (emailIds.length === 0) {
      return documents;
    }

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

    // Merge all data into documents
    return documents.map(doc => {
      const emailData = emailMap.get(doc.email_id) || {};
      return {
        ...doc,
        ...emailData,
        classification: classificationMap.get(doc.email_id) || null,
      };
    });
  }

  /**
   * Find document by email ID
   */
  async findByEmailId(emailId: string): Promise<ShipmentDocument | null> {
    const { data, error } = await this.supabase
      .from('shipment_documents')
      .select('*')
      .eq('email_id', emailId)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  /**
   * Link email to shipment (BULLETPROOF IDEMPOTENT)
   * Works with or without unique constraint. Safe to call multiple times.
   *
   * Strategy:
   * 1. Check if link already exists
   * 2. If exists → update metadata
   * 3. If not exists → insert new
   */
  async create(document: Partial<ShipmentDocument>): Promise<ShipmentDocument> {
    if (!document.email_id || !document.shipment_id) {
      throw new Error('email_id and shipment_id are required');
    }

    // Step 1: Check if link already exists (handles case without unique constraint)
    const { data: existing } = await this.supabase
      .from('shipment_documents')
      .select('id')
      .eq('email_id', document.email_id)
      .eq('shipment_id', document.shipment_id)
      .maybeSingle();

    if (existing) {
      // Step 2a: Update existing link
      const { data, error } = await this.supabase
        .from('shipment_documents')
        .update(document)
        .eq('id', existing.id)
        .select()
        .single();

      if (error || !data) {
        throw new Error(`Failed to update link: ${error?.message}`);
      }

      return data;
    }

    // Step 2b: Insert new link (no duplicate possible after check)
    const { data, error } = await this.supabase
      .from('shipment_documents')
      .insert(document)
      .select()
      .single();

    if (error || !data) {
      // Handle race condition: another process inserted between check and insert
      if (error?.code === '23505') { // Unique violation
        return this.create(document); // Retry (will update)
      }
      throw new Error(`Failed to create link: ${error?.message}`);
    }

    return data;
  }

  /**
   * Link email to shipment with full linking data (production-ready)
   * IDEMPOTENT: Safe to call multiple times, never creates duplicates
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
  }): Promise<ShipmentDocument> {
    const document: Partial<ShipmentDocument> = {
      email_id: params.emailId,
      shipment_id: params.shipmentId,
      document_type: params.documentType,
      link_method: params.linkMethod,
      document_number: params.documentNumber,
      link_confidence_score: params.linkConfidenceScore ?? 0,
      document_date: params.documentDate || new Date().toISOString(),
      subject: params.subject,
    };

    return this.create(document);
  }

  /**
   * Check if email is already linked to a shipment
   */
  async isEmailLinked(emailId: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('shipment_documents')
      .select('*', { count: 'exact', head: true })
      .eq('email_id', emailId);

    return !error && (count ?? 0) > 0;
  }

  /**
   * Check if email is linked to a specific shipment
   */
  async isEmailLinkedToShipment(emailId: string, shipmentId: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('shipment_documents')
      .select('*', { count: 'exact', head: true })
      .eq('email_id', emailId)
      .eq('shipment_id', shipmentId);

    return !error && (count ?? 0) > 0;
  }

  /**
   * Unlink document from shipment
   */
  async delete(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('shipment_documents')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to unlink document: ${error.message}`);
    }
  }

  /**
   * Update document metadata
   */
  async update(id: string, updates: Partial<ShipmentDocument>): Promise<ShipmentDocument> {
    const { data, error } = await this.supabase
      .from('shipment_documents')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to update document: ${error?.message}`);
    }

    return data;
  }
}
