/**
 * Shipment Registry Service
 *
 * CONVERGENCE POINT: Receives inputs from all upstream registries and creates
 * the final shipment record with all links.
 *
 * Inputs from:
 * - Email Registry: emailId, senderId, threadId
 * - Document Registry: documentId, documentVersionId
 * - Stakeholder Registry: shipperId, consigneeId, notifyPartyId
 * - Extraction: booking_number, bl_number, containers, ports, dates, vessel
 *
 * Responsibilities:
 * - Find or create shipment by booking_number (deduplication)
 * - Handle amendments as versions (track amendment_number)
 * - Link all inputs to the shipment
 * - Track which emails and documents belong to each shipment
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

export interface ShipmentRegistryInput {
  // From Extraction (required)
  bookingNumber: string;

  // From Extraction (optional)
  blNumber?: string;
  containerNumbers?: string[];
  ports?: {
    pol?: string;
    polName?: string;
    pod?: string;
    podName?: string;
  };
  dates?: {
    etd?: string;
    eta?: string;
    atd?: string;
    ata?: string;
  };
  vessel?: {
    name?: string;
    voyage?: string;
    imo?: string;
  };
  carrier?: {
    id?: string;
    name?: string;
    scac?: string;
  };

  // From Email Registry
  emailId: string;
  threadId?: string;
  senderId?: string;

  // From Document Registry
  documentId?: string;
  documentVersionId?: string;
  documentType?: string;

  // From Stakeholder Registry
  shipperId?: string;
  consigneeId?: string;
  notifyPartyId?: string;

  // Context
  direction: 'inbound' | 'outbound';
  isAmendment?: boolean;
  amendmentNumber?: number;
}

export interface ShipmentRegistryResult {
  success: boolean;
  shipmentId: string;
  isNewShipment: boolean;
  isAmendment: boolean;
  amendmentNumber?: number;
  linkedEmailId: string;
  linkedDocumentId?: string;
  linkedStakeholders: {
    shipperId?: string;
    consigneeId?: string;
    notifyPartyId?: string;
  };
  fieldsUpdated: string[];
  error?: string;
}

interface ShipmentRecord {
  id: string;
  booking_number: string;
  bl_number?: string;
  status: string;
  shipper_id?: string;
  consignee_id?: string;
  notify_party_id?: string;
  carrier_id?: string;
  amendment_number?: number;
}

// ============================================================================
// SERVICE
// ============================================================================

export class ShipmentRegistryService {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Register a shipment - find existing or create new, then link all inputs
   */
  async register(input: ShipmentRegistryInput): Promise<ShipmentRegistryResult> {
    if (!input.bookingNumber) {
      return {
        success: false,
        shipmentId: '',
        isNewShipment: false,
        isAmendment: false,
        linkedEmailId: input.emailId,
        linkedStakeholders: {},
        fieldsUpdated: [],
        error: 'Booking number is required',
      };
    }

    try {
      // 1. Find or create shipment
      const shipmentResult = await this.findOrCreateShipment(input);

      // 2. Link email to shipment
      await this.linkEmailToShipment(
        shipmentResult.id,
        input.emailId,
        shipmentResult.isNew ? 'primary' : input.isAmendment ? 'amendment' : 'related'
      );

      // 3. Link document to shipment (if provided)
      if (input.documentId) {
        await this.linkDocumentToShipment(
          shipmentResult.id,
          input.documentId,
          input.documentVersionId,
          input.documentType
        );
      }

      // 4. Update stakeholder links on shipment
      const stakeholderUpdates = await this.updateStakeholderLinks(
        shipmentResult.id,
        input.shipperId,
        input.consigneeId,
        input.notifyPartyId
      );

      // 5. Update shipment fields from extraction
      const fieldsUpdated = await this.updateShipmentFields(shipmentResult.id, input);

      return {
        success: true,
        shipmentId: shipmentResult.id,
        isNewShipment: shipmentResult.isNew,
        isAmendment: shipmentResult.isAmendment,
        amendmentNumber: shipmentResult.amendmentNumber,
        linkedEmailId: input.emailId,
        linkedDocumentId: input.documentId,
        linkedStakeholders: stakeholderUpdates,
        fieldsUpdated,
      };
    } catch (error) {
      console.error('[ShipmentRegistry] Error:', error);
      return {
        success: false,
        shipmentId: '',
        isNewShipment: false,
        isAmendment: false,
        linkedEmailId: input.emailId,
        linkedStakeholders: {},
        fieldsUpdated: [],
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Find existing shipment by booking number or create new
   */
  private async findOrCreateShipment(
    input: ShipmentRegistryInput
  ): Promise<{ id: string; isNew: boolean; isAmendment: boolean; amendmentNumber?: number }> {
    const normalizedBooking = input.bookingNumber.trim().toUpperCase();

    // Try to find existing shipment
    const { data: existing } = await this.supabase
      .from('shipments')
      .select('id, booking_number, amendment_number, status')
      .eq('booking_number', normalizedBooking)
      .single();

    if (existing) {
      // Check if this is an amendment
      const isAmendment = input.isAmendment || false;
      let amendmentNumber = existing.amendment_number || 0;

      if (isAmendment) {
        amendmentNumber = (input.amendmentNumber || amendmentNumber) + 1;
        await this.supabase
          .from('shipments')
          .update({
            amendment_number: amendmentNumber,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      }

      return {
        id: existing.id,
        isNew: false,
        isAmendment,
        amendmentNumber,
      };
    }

    // Create new shipment
    const { data: newShipment, error } = await this.supabase
      .from('shipments')
      .insert({
        booking_number: normalizedBooking,
        bl_number: input.blNumber,
        status: 'draft',
        carrier_id: input.carrier?.id,
        carrier_name: input.carrier?.name,
        carrier_scac: input.carrier?.scac,
        shipper_id: input.shipperId,
        consignee_id: input.consigneeId,
        notify_party_id: input.notifyPartyId,
        port_of_loading_code: input.ports?.pol,
        port_of_loading_name: input.ports?.polName,
        port_of_discharge_code: input.ports?.pod,
        port_of_discharge_name: input.ports?.podName,
        etd: input.dates?.etd,
        eta: input.dates?.eta,
        atd: input.dates?.atd,
        ata: input.dates?.ata,
        vessel_name: input.vessel?.name,
        voyage_number: input.vessel?.voyage,
        vessel_imo: input.vessel?.imo,
        container_numbers: input.containerNumbers || [],
        amendment_number: 0,
        direction: input.direction,
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to create shipment: ${error.message}`);
    }

    return {
      id: newShipment.id,
      isNew: true,
      isAmendment: false,
      amendmentNumber: 0,
    };
  }

  /**
   * Link email to shipment
   */
  private async linkEmailToShipment(
    shipmentId: string,
    emailId: string,
    linkType: 'primary' | 'related' | 'amendment'
  ): Promise<void> {
    await this.supabase.from('shipment_emails').upsert(
      {
        shipment_id: shipmentId,
        email_id: emailId,
        link_type: linkType,
        linked_at: new Date().toISOString(),
      },
      { onConflict: 'shipment_id,email_id' }
    );
  }

  /**
   * Link document to shipment
   */
  private async linkDocumentToShipment(
    shipmentId: string,
    documentId: string,
    documentVersionId?: string,
    documentType?: string
  ): Promise<void> {
    // Check if link already exists
    const { data: existing } = await this.supabase
      .from('shipment_documents')
      .select('id')
      .eq('shipment_id', shipmentId)
      .eq('document_id', documentId)
      .single();

    if (!existing) {
      await this.supabase.from('shipment_documents').insert({
        shipment_id: shipmentId,
        document_id: documentId,
        document_version_id: documentVersionId,
        document_type: documentType,
        linked_at: new Date().toISOString(),
      });
    }
  }

  /**
   * Update stakeholder links on shipment
   */
  private async updateStakeholderLinks(
    shipmentId: string,
    shipperId?: string,
    consigneeId?: string,
    notifyPartyId?: string
  ): Promise<{ shipperId?: string; consigneeId?: string; notifyPartyId?: string }> {
    const updates: Record<string, string | undefined> = {};

    // Only update if provided and not already set
    const { data: current } = await this.supabase
      .from('shipments')
      .select('shipper_id, consignee_id, notify_party_id')
      .eq('id', shipmentId)
      .single();

    if (shipperId && !current?.shipper_id) {
      updates.shipper_id = shipperId;
    }
    if (consigneeId && !current?.consignee_id) {
      updates.consignee_id = consigneeId;
    }
    if (notifyPartyId && !current?.notify_party_id) {
      updates.notify_party_id = notifyPartyId;
    }

    if (Object.keys(updates).length > 0) {
      await this.supabase
        .from('shipments')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', shipmentId);
    }

    return {
      shipperId: updates.shipper_id || current?.shipper_id,
      consigneeId: updates.consignee_id || current?.consignee_id,
      notifyPartyId: updates.notify_party_id || current?.notify_party_id,
    };
  }

  /**
   * Update shipment fields from extraction data
   */
  private async updateShipmentFields(
    shipmentId: string,
    input: ShipmentRegistryInput
  ): Promise<string[]> {
    const updates: Record<string, unknown> = {};
    const fieldsUpdated: string[] = [];

    // Get current shipment data
    const { data: current } = await this.supabase
      .from('shipments')
      .select('*')
      .eq('id', shipmentId)
      .single();

    if (!current) return [];

    // Update fields only if not already set or if this is an amendment
    const shouldUpdate = (field: string, value: unknown) => {
      if (value === undefined || value === null) return false;
      if (input.isAmendment) return true;
      return current[field] === null || current[field] === undefined;
    };

    if (shouldUpdate('bl_number', input.blNumber)) {
      updates.bl_number = input.blNumber;
      fieldsUpdated.push('bl_number');
    }

    if (shouldUpdate('port_of_loading_code', input.ports?.pol)) {
      updates.port_of_loading_code = input.ports?.pol;
      updates.port_of_loading_name = input.ports?.polName;
      fieldsUpdated.push('port_of_loading');
    }

    if (shouldUpdate('port_of_discharge_code', input.ports?.pod)) {
      updates.port_of_discharge_code = input.ports?.pod;
      updates.port_of_discharge_name = input.ports?.podName;
      fieldsUpdated.push('port_of_discharge');
    }

    if (shouldUpdate('etd', input.dates?.etd)) {
      updates.etd = input.dates?.etd;
      fieldsUpdated.push('etd');
    }

    if (shouldUpdate('eta', input.dates?.eta)) {
      updates.eta = input.dates?.eta;
      fieldsUpdated.push('eta');
    }

    if (shouldUpdate('vessel_name', input.vessel?.name)) {
      updates.vessel_name = input.vessel?.name;
      updates.voyage_number = input.vessel?.voyage;
      fieldsUpdated.push('vessel');
    }

    if (input.containerNumbers && input.containerNumbers.length > 0) {
      const existingContainers = current.container_numbers || [];
      const newContainers = [...new Set([...existingContainers, ...input.containerNumbers])];
      if (newContainers.length > existingContainers.length) {
        updates.container_numbers = newContainers;
        fieldsUpdated.push('container_numbers');
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      await this.supabase.from('shipments').update(updates).eq('id', shipmentId);
    }

    return fieldsUpdated;
  }

  /**
   * Get shipment by booking number
   */
  async getByBookingNumber(bookingNumber: string): Promise<ShipmentRecord | null> {
    const { data } = await this.supabase
      .from('shipments')
      .select('*')
      .eq('booking_number', bookingNumber.trim().toUpperCase())
      .single();
    return data;
  }

  /**
   * Get all emails linked to a shipment
   */
  async getLinkedEmails(shipmentId: string): Promise<string[]> {
    const { data } = await this.supabase
      .from('shipment_emails')
      .select('email_id')
      .eq('shipment_id', shipmentId);
    return data?.map((e) => e.email_id) || [];
  }

  /**
   * Get all documents linked to a shipment
   */
  async getLinkedDocuments(shipmentId: string): Promise<string[]> {
    const { data } = await this.supabase
      .from('shipment_documents')
      .select('document_id')
      .eq('shipment_id', shipmentId);
    return data?.map((d) => d.document_id) || [];
  }
}

// Factory function
export function createShipmentRegistryService(supabase: SupabaseClient): ShipmentRegistryService {
  return new ShipmentRegistryService(supabase);
}
