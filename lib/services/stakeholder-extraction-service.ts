/**
 * Stakeholder Extraction Service
 *
 * Extracts stakeholder information from documents and emails.
 * Handles document hierarchy: HBL/SI shows real customer, MBL shows Intoglo.
 *
 * Customer Identification:
 * - Export shipments: Shipper is customer
 * - Import shipments: Consignee is customer
 * - Both: Company can be shipper AND consignee in different shipments
 *
 * Principles:
 * - Single Responsibility: Only extraction logic
 * - Interface-Based: Works with any document/email source
 * - Configuration Over Code: Patterns in database
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { StakeholderRepository } from '../repositories/stakeholder-repository';
import {
  Party,
  PartyType,
  ExtractedParty,
  CustomerRelationship,
} from '@/types/intelligence-platform';

// ============================================================================
// TYPES
// ============================================================================

export interface DocumentEntity {
  shipper?: PartyInfo;
  consignee?: PartyInfo;
  notify_party?: PartyInfo;
  shipping_line?: string;
}

export interface PartyInfo {
  name: string;
  address?: string;
  city?: string;
  country?: string;
  email?: string;
  phone?: string;
}

export interface EmailMetadata {
  gmail_message_id: string;
  sender_email: string;
  sender_name?: string;
  to_emails?: string[];
  cc_emails?: string[];
  subject: string;
}

export interface ExtractionResult {
  extracted: ExtractedParty[];
  matched: Party[];
  created: Party[];
  relationships: Array<{ partyA: string; partyB: string; type: string }>;
}

export type DocumentType =
  | 'hbl'
  | 'mbl'
  | 'si_draft'
  | 'si_final'
  | 'booking_confirmation'
  | 'arrival_notice';

export type ShipmentDirection = 'export' | 'import';

// ============================================================================
// CONSTANTS
// ============================================================================

// Intoglo identifiers to skip for customer detection
const INTOGLO_IDENTIFIERS = [
  'intoglo',
  'into glo',
  'intoglo logistics',
  'intoglo freight',
];

// Document types that show real customer (not Intoglo)
const CUSTOMER_SOURCE_DOCUMENTS: DocumentType[] = ['hbl', 'si_draft', 'si_final'];

// Document types where shipper might be Intoglo
const INTOGLO_SHIPPER_DOCUMENTS: DocumentType[] = ['mbl', 'booking_confirmation'];

// ============================================================================
// SERVICE CLASS
// ============================================================================

export class StakeholderExtractionService {
  private repository: StakeholderRepository;

  constructor(private readonly supabase: SupabaseClient) {
    this.repository = new StakeholderRepository(supabase);
  }

  // --------------------------------------------------------------------------
  // MAIN EXTRACTION METHODS
  // --------------------------------------------------------------------------

  /**
   * Extract stakeholders from a document's entities
   */
  async extractFromDocument(
    entities: DocumentEntity,
    documentType: DocumentType,
    shipmentDirection: ShipmentDirection,
    shipmentId?: string
  ): Promise<ExtractionResult> {
    const result: ExtractionResult = {
      extracted: [],
      matched: [],
      created: [],
      relationships: [],
    };

    // Process shipper
    if (entities.shipper) {
      const shipperResult = await this.processPartyEntity(
        entities.shipper,
        'shipper',
        documentType,
        shipmentDirection
      );
      if (shipperResult) {
        result.extracted.push(shipperResult.extracted);
        if (shipperResult.party) {
          if (shipperResult.isNew) {
            result.created.push(shipperResult.party);
          } else {
            result.matched.push(shipperResult.party);
          }
        }
      }
    }

    // Process consignee
    if (entities.consignee) {
      const consigneeResult = await this.processPartyEntity(
        entities.consignee,
        'consignee',
        documentType,
        shipmentDirection
      );
      if (consigneeResult) {
        result.extracted.push(consigneeResult.extracted);
        if (consigneeResult.party) {
          if (consigneeResult.isNew) {
            result.created.push(consigneeResult.party);
          } else {
            result.matched.push(consigneeResult.party);
          }
        }
      }
    }

    // Process notify party
    if (entities.notify_party) {
      const notifyResult = await this.processPartyEntity(
        entities.notify_party,
        'notify_party',
        documentType,
        shipmentDirection
      );
      if (notifyResult) {
        result.extracted.push(notifyResult.extracted);
        if (notifyResult.party) {
          if (notifyResult.isNew) {
            result.created.push(notifyResult.party);
          } else {
            result.matched.push(notifyResult.party);
          }
        }
      }
    }

    // Create shipper-consignee relationship if both exist
    const shipper = result.matched.find(p => p.party_type === 'shipper') ||
                    result.created.find(p => p.party_type === 'shipper');
    const consignee = result.matched.find(p => p.party_type === 'consignee') ||
                      result.created.find(p => p.party_type === 'consignee');

    if (shipper && consignee) {
      await this.repository.upsertRelationship(
        shipper.id,
        consignee.id,
        'shipper_consignee'
      );
      result.relationships.push({
        partyA: shipper.id,
        partyB: consignee.id,
        type: 'shipper_consignee',
      });
    }

    return result;
  }

  /**
   * Extract stakeholders from email metadata
   */
  async extractFromEmailMetadata(
    metadata: EmailMetadata
  ): Promise<ExtractionResult> {
    const result: ExtractionResult = {
      extracted: [],
      matched: [],
      created: [],
      relationships: [],
    };

    // Extract domain from sender email
    const senderDomain = this.extractDomain(metadata.sender_email);
    if (!senderDomain || this.isIntogloDomain(senderDomain)) {
      return result;
    }

    // Try to match sender to existing stakeholder by domain
    const matchedByDomain = await this.repository.findByEmailDomain(senderDomain);
    if (matchedByDomain.length > 0) {
      result.matched.push(...matchedByDomain);
      return result;
    }

    // Try to match by email
    const matchedByEmail = await this.repository.findByContactEmail(metadata.sender_email);
    if (matchedByEmail) {
      // Add domain to existing stakeholder
      await this.repository.addEmailDomain(matchedByEmail.id, senderDomain);
      result.matched.push(matchedByEmail);
      return result;
    }

    // Extract party info from sender name if available
    if (metadata.sender_name) {
      const extracted: ExtractedParty = {
        name: metadata.sender_name,
        type: 'agent', // Default type for email-only extraction
        email: metadata.sender_email,
        confidence: 0.6, // Lower confidence for email-only extraction
      };
      result.extracted.push(extracted);
    }

    return result;
  }

  /**
   * Process extraction queue item
   */
  async processQueueItem(queueId: string): Promise<ExtractionResult> {
    // Mark as processing
    await this.repository.updateExtractionStatus(queueId, 'processing');

    try {
      // Get queue item with email data
      const { data: queueItem, error } = await this.supabase
        .from('stakeholder_extraction_queue')
        .select(`
          *,
          email:raw_emails(*)
        `)
        .eq('id', queueId)
        .single();

      if (error || !queueItem) {
        throw new Error(`Queue item not found: ${queueId}`);
      }

      const email = queueItem.email;
      const metadata: EmailMetadata = {
        gmail_message_id: email.gmail_message_id,
        sender_email: email.sender_email,
        sender_name: email.sender_name,
        subject: email.subject,
      };

      const result = await this.extractFromEmailMetadata(metadata);

      // Update queue with results
      await this.repository.updateExtractionStatus(queueId, 'completed', {
        extracted_parties: result.extracted,
        matched_party_ids: result.matched.map(p => p.id),
        created_party_ids: result.created.map(p => p.id),
      });

      return result;
    } catch (error) {
      await this.repository.updateExtractionStatus(queueId, 'failed', {
        error_message: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // HELPER METHODS
  // --------------------------------------------------------------------------

  /**
   * Process a single party entity from a document
   */
  private async processPartyEntity(
    partyInfo: PartyInfo,
    role: 'shipper' | 'consignee' | 'notify_party',
    documentType: DocumentType,
    shipmentDirection: ShipmentDirection
  ): Promise<{
    extracted: ExtractedParty;
    party: Party | null;
    isNew: boolean;
  } | null> {
    // Clean and normalize name
    const cleanName = this.normalizeName(partyInfo.name);
    if (!cleanName) return null;

    // Skip if this is Intoglo (for shipper in MBL/booking)
    if (this.isIntogloParty(cleanName)) {
      // Only skip if document type typically has Intoglo as shipper
      if (role === 'shipper' && INTOGLO_SHIPPER_DOCUMENTS.includes(documentType)) {
        return null;
      }
    }

    // Determine party type based on role
    const partyType: PartyType = role;

    // Calculate confidence based on document source
    const confidence = CUSTOMER_SOURCE_DOCUMENTS.includes(documentType) ? 0.95 : 0.8;

    // Determine if this is a customer
    const isCustomer = this.determineIsCustomer(role, documentType, shipmentDirection);
    const customerRelationship = this.determineCustomerRelationship(
      role,
      shipmentDirection,
      isCustomer
    );

    const extracted: ExtractedParty = {
      name: cleanName,
      type: partyType,
      email: partyInfo.email,
      confidence,
    };

    // Try to match existing party
    let party = await this.repository.findByExactName(cleanName, partyType);
    let isNew = false;

    if (!party && partyInfo.email) {
      party = await this.repository.findByContactEmail(partyInfo.email);
    }

    if (!party) {
      // Create new party
      party = await this.repository.create({
        party_name: cleanName,
        party_type: partyType,
        address: partyInfo.address,
        city: partyInfo.city,
        country: partyInfo.country,
        contact_email: partyInfo.email,
        contact_phone: partyInfo.phone,
        is_customer: isCustomer,
        customer_relationship: customerRelationship,
        total_shipments: 1,
        email_domains: partyInfo.email ? [this.extractDomain(partyInfo.email)!] : [],
      });
      isNew = true;
    } else {
      // Update existing party
      const updates: Partial<Party> = {
        total_shipments: (party.total_shipments || 0) + 1,
      };

      // Upgrade to customer if not already
      if (isCustomer && !party.is_customer) {
        updates.is_customer = true;
        updates.customer_relationship = customerRelationship;
      }

      // Add email domain if new
      if (partyInfo.email) {
        const domain = this.extractDomain(partyInfo.email);
        if (domain && !party.email_domains?.includes(domain)) {
          updates.email_domains = [...(party.email_domains || []), domain];
        }
      }

      party = await this.repository.update(party.id, updates);
    }

    return { extracted, party, isNew };
  }

  /**
   * Determine if this party is a customer based on role and direction
   */
  private determineIsCustomer(
    role: 'shipper' | 'consignee' | 'notify_party',
    documentType: DocumentType,
    shipmentDirection: ShipmentDirection
  ): boolean {
    // Only HBL/SI documents reliably identify customers
    if (!CUSTOMER_SOURCE_DOCUMENTS.includes(documentType)) {
      return false;
    }

    // Export: Shipper is customer (they pay to export)
    if (shipmentDirection === 'export' && role === 'shipper') {
      return true;
    }

    // Import: Consignee is customer (they pay to import)
    if (shipmentDirection === 'import' && role === 'consignee') {
      return true;
    }

    return false;
  }

  /**
   * Determine customer relationship type
   */
  private determineCustomerRelationship(
    role: 'shipper' | 'consignee' | 'notify_party',
    shipmentDirection: ShipmentDirection,
    isCustomer: boolean
  ): CustomerRelationship | undefined {
    if (!isCustomer) return undefined;

    if (role === 'shipper') {
      return 'shipper_customer';
    }

    if (role === 'consignee') {
      return 'consignee_customer';
    }

    return 'paying_customer';
  }

  /**
   * Check if name belongs to Intoglo
   */
  private isIntogloParty(name: string): boolean {
    const lowerName = name.toLowerCase();
    return INTOGLO_IDENTIFIERS.some(id => lowerName.includes(id));
  }

  /**
   * Check if domain belongs to Intoglo
   */
  private isIntogloDomain(domain: string): boolean {
    return domain.includes('intoglo');
  }

  /**
   * Extract domain from email address
   */
  private extractDomain(email: string): string | null {
    const match = email.match(/@([^@]+)$/);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Normalize party name
   */
  private normalizeName(name: string): string {
    return name
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s\.\-&,]/g, '')
      .toUpperCase();
  }

  // --------------------------------------------------------------------------
  // BATCH PROCESSING
  // --------------------------------------------------------------------------

  /**
   * Process all pending extractions in queue
   */
  async processExtractionQueue(batchSize: number = 50): Promise<{
    processed: number;
    succeeded: number;
    failed: number;
  }> {
    const pending = await this.repository.getPendingExtractions(batchSize);

    let succeeded = 0;
    let failed = 0;

    for (const item of pending) {
      try {
        await this.processQueueItem(item.id);
        succeeded++;
      } catch {
        failed++;
      }
    }

    return {
      processed: pending.length,
      succeeded,
      failed,
    };
  }

  /**
   * Queue all unprocessed emails for extraction
   */
  async queueUnprocessedEmails(): Promise<number> {
    // Find emails not in extraction queue
    const { data: emails, error } = await this.supabase
      .from('raw_emails')
      .select('id')
      .not('id', 'in', this.supabase
        .from('stakeholder_extraction_queue')
        .select('email_id')
      )
      .limit(500);

    if (error || !emails) {
      throw new Error(`Failed to find unprocessed emails: ${error?.message}`);
    }

    for (const email of emails) {
      await this.repository.queueForExtraction(email.id);
    }

    return emails.length;
  }

  /**
   * Extract stakeholders from all shipment documents
   */
  async extractFromShipmentDocuments(shipmentId: string): Promise<ExtractionResult> {
    // Get all document classifications for this shipment
    const { data: docs, error } = await this.supabase
      .from('shipment_documents')
      .select(`
        document_type,
        classification:document_classifications(
          extracted_entities
        )
      `)
      .eq('shipment_id', shipmentId);

    if (error) {
      throw new Error(`Failed to fetch shipment documents: ${error.message}`);
    }

    // Get shipment direction (default to export if unknown)
    const { data: shipment } = await this.supabase
      .from('shipments')
      .select('port_of_loading_code, port_of_discharge_code')
      .eq('id', shipmentId)
      .single();

    // Simple heuristic: if POL is in India, it's export
    const direction: ShipmentDirection =
      shipment?.port_of_loading_code?.startsWith('IN') ? 'export' : 'import';

    const combinedResult: ExtractionResult = {
      extracted: [],
      matched: [],
      created: [],
      relationships: [],
    };

    // Process documents in priority order (HBL > SI > Booking)
    const priorityOrder: DocumentType[] = ['hbl', 'si_draft', 'si_final', 'booking_confirmation'];

    for (const docType of priorityOrder) {
      const doc = docs?.find(d => d.document_type === docType);
      if (!doc?.classification?.extracted_entities) continue;

      const entities = doc.classification.extracted_entities as DocumentEntity;
      const result = await this.extractFromDocument(
        entities,
        docType as DocumentType,
        direction,
        shipmentId
      );

      combinedResult.extracted.push(...result.extracted);
      combinedResult.matched.push(...result.matched);
      combinedResult.created.push(...result.created);
      combinedResult.relationships.push(...result.relationships);
    }

    return combinedResult;
  }
}
