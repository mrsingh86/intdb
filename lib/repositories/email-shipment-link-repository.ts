/**
 * Email Shipment Link Repository
 *
 * Manages email-level associations with shipments.
 * One record per email-shipment pair (for thread tracking, correspondence).
 *
 * Part of the split architecture:
 * - email_shipment_links: Email-level (this)
 * - attachment_shipment_links: Document-level
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// ============================================================================
// Types
// ============================================================================

export interface EmailShipmentLink {
  id: string;
  email_id: string;
  shipment_id: string | null;
  thread_id: string | null;
  linking_id: string | null;
  link_method: string | null;
  link_source: string | null;
  link_confidence_score: number | null;
  link_identifier_type: string | null;
  link_identifier_value: string | null;
  is_thread_authority: boolean;
  authority_email_id: string | null;
  thread_position: number | null;
  email_type: string | null;
  sender_category: string | null;
  is_inbound: boolean | null;
  status: string;
  linked_at: string | null;
  linked_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EmailShipmentLinkInput {
  email_id: string;
  shipment_id?: string | null;
  thread_id?: string | null;
  linking_id?: string;
  link_method?: string;
  link_source?: string;
  link_confidence_score?: number;
  link_identifier_type?: string;
  link_identifier_value?: string;
  is_thread_authority?: boolean;
  authority_email_id?: string;
  thread_position?: number;
  email_type?: string;
  sender_category?: string;
  is_inbound?: boolean;
  status?: string;
}

// ============================================================================
// Repository
// ============================================================================

export class EmailShipmentLinkRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Create or update email-shipment link (idempotent)
   */
  async upsert(input: EmailShipmentLinkInput): Promise<EmailShipmentLink> {
    const linkingId = input.linking_id || uuidv4();

    // Check if link exists
    const { data: existing } = await this.supabase
      .from('email_shipment_links')
      .select('id, linking_id')
      .eq('email_id', input.email_id)
      .eq('shipment_id', input.shipment_id || '')
      .maybeSingle();

    if (existing) {
      // Update existing
      const { data, error } = await this.supabase
        .from('email_shipment_links')
        .update({
          ...input,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw new Error(`Failed to update email link: ${error.message}`);
      return data;
    }

    // Insert new
    const { data, error } = await this.supabase
      .from('email_shipment_links')
      .insert({
        ...input,
        linking_id: linkingId,
        status: input.status || (input.shipment_id ? 'linked' : 'orphan'),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        // Race condition, retry
        return this.upsert(input);
      }
      throw new Error(`Failed to create email link: ${error.message}`);
    }

    return data;
  }

  /**
   * Find link by email ID
   */
  async findByEmailId(emailId: string): Promise<EmailShipmentLink | null> {
    const { data, error } = await this.supabase
      .from('email_shipment_links')
      .select('*')
      .eq('email_id', emailId)
      .maybeSingle();

    if (error) throw new Error(`Failed to find email link: ${error.message}`);
    return data;
  }

  /**
   * Find all links for a shipment
   */
  async findByShipmentId(shipmentId: string): Promise<EmailShipmentLink[]> {
    const { data, error } = await this.supabase
      .from('email_shipment_links')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to find shipment links: ${error.message}`);
    return data || [];
  }

  /**
   * Find thread authority for a thread
   */
  async findThreadAuthority(threadId: string): Promise<EmailShipmentLink | null> {
    const { data, error } = await this.supabase
      .from('email_shipment_links')
      .select('*')
      .eq('thread_id', threadId)
      .eq('is_thread_authority', true)
      .maybeSingle();

    if (error) throw new Error(`Failed to find thread authority: ${error.message}`);
    return data;
  }

  /**
   * Find orphan links (no shipment_id)
   */
  async findOrphans(limit: number = 100): Promise<EmailShipmentLink[]> {
    const { data, error } = await this.supabase
      .from('email_shipment_links')
      .select('*')
      .is('shipment_id', null)
      .eq('status', 'orphan')
      .limit(limit);

    if (error) throw new Error(`Failed to find orphan links: ${error.message}`);
    return data || [];
  }

  /**
   * Link orphan email to shipment
   */
  async linkToShipment(emailId: string, shipmentId: string): Promise<EmailShipmentLink> {
    const { data, error } = await this.supabase
      .from('email_shipment_links')
      .update({
        shipment_id: shipmentId,
        status: 'linked',
        linked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('email_id', emailId)
      .select()
      .single();

    if (error) throw new Error(`Failed to link email to shipment: ${error.message}`);
    return data;
  }

  /**
   * Check if email is linked to any shipment
   */
  async isEmailLinked(emailId: string): Promise<boolean> {
    const { count, error } = await this.supabase
      .from('email_shipment_links')
      .select('*', { count: 'exact', head: true })
      .eq('email_id', emailId)
      .not('shipment_id', 'is', null);

    return !error && (count ?? 0) > 0;
  }

  /**
   * Get linking_id for an email (to share with attachment links)
   */
  async getLinkingId(emailId: string): Promise<string | null> {
    const { data } = await this.supabase
      .from('email_shipment_links')
      .select('linking_id')
      .eq('email_id', emailId)
      .maybeSingle();

    return data?.linking_id || null;
  }

  /**
   * Find links by shipment ID with classification data
   * Joins with email_classifications to get document type
   */
  async findByShipmentIdWithClassification(shipmentId: string): Promise<any[]> {
    const { data: links, error } = await this.supabase
      .from('email_shipment_links')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to find shipment links: ${error.message}`);
    if (!links || links.length === 0) return [];

    // Get email IDs to fetch classifications
    const emailIds = links.map(l => l.email_id);

    // Fetch classifications for these emails
    const { data: classifications } = await this.supabase
      .from('email_classifications')
      .select('email_id, document_type, confidence_score, confidence_level')
      .in('email_id', emailIds);

    // Build lookup map
    const classificationMap = new Map<string, any>();
    (classifications || []).forEach(c => classificationMap.set(c.email_id, c));

    // Combine links with classification data
    return links.map(link => ({
      ...link,
      document_type: classificationMap.get(link.email_id)?.document_type || link.email_type,
      classification_confidence: classificationMap.get(link.email_id)?.confidence_score,
      classification_level: classificationMap.get(link.email_id)?.confidence_level,
    }));
  }
}
