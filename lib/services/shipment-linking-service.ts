/**
 * Shipment Linking Service
 *
 * Core Layer 3 logic: Links emails to shipments based on extracted entities.
 *
 * Principles:
 * - Deep Module: Simple interface (processEmail), complex implementation
 * - Configuration Over Code: Uses CONFIDENCE_THRESHOLDS
 * - Single Responsibility: Only email-to-shipment linking
 * - Fail Fast: Validates entities before processing
 * - Database-Driven: Creates audit trail for all linking decisions
 */

import { ShipmentRepository } from '../repositories/shipment-repository';
import { ShipmentLinkCandidateRepository } from '../repositories/shipment-link-candidate-repository';
import {
  EmailRepository,
  EmailExtractionRepository,
  AttachmentExtractionRepository,
  EmailShipmentLinkRepository,
  AttachmentShipmentLinkRepository,
  EmailClassificationRepository,
  AttachmentClassificationRepository,
} from '../repositories';
import { SupabaseClient } from '@supabase/supabase-js';
import { MilestoneTrackingService } from './milestone-tracking-service';
import { WorkflowStateService } from './workflow-state-service';
import { EnhancedWorkflowStateService, WorkflowTransitionInput } from './enhanced-workflow-state-service';
import { EmailType, SenderCategory } from '@/lib/config/email-type-config';
import { CONFIDENCE_THRESHOLDS } from '../constants/confidence-levels';
import { EntityExtraction, EntityType, DocumentType } from '@/types/email-intelligence';
import { Shipment, LinkingKeys, LinkingResult, LinkType, ShipmentStatus } from '@/types/shipment';
import { parseEntityDate } from '../utils/date-parser';
import { linkConfidenceCalculator } from './shipment-linking/link-confidence-calculator';
import { EmailAuthority, IdentifierType, DIRECT_CARRIER_DOMAINS } from './shipment-linking/types';

// Document type to milestone mapping
const DOC_TYPE_TO_MILESTONE: Record<string, string> = {
  'booking_confirmation': 'booking_confirmed',
  'booking_amendment': 'booking_confirmed',
  'vgm_confirmation': 'vgm_submitted',
  'si_confirmation': 'si_submitted',
  'shipping_instruction': 'si_submitted',
  'house_bl': 'hbl_released',
  'bill_of_lading': 'hbl_released',
  'arrival_notice': 'vessel_arrived',
  'delivery_order': 'cargo_released',  // DO = cargo released, not delivered
  'proof_of_delivery': 'delivered',
  'pod_confirmation': 'delivered',
};

/**
 * Determines shipment status based on document type and dates
 *
 * Status hierarchy (highest to lowest):
 * - delivered: Delivery confirmed
 * - arrived: Vessel arrived at destination
 * - in_transit: Cargo departed, on the way
 * - booked: Booking confirmed
 * - draft: Initial/unknown state
 */
function determineShipmentStatus(
  documentType?: DocumentType,
  etd?: string | null,
  eta?: string | null,
  currentStatus?: ShipmentStatus
): ShipmentStatus {
  const now = new Date();
  const etdDate = etd ? new Date(etd) : null;
  const etaDate = eta ? new Date(eta) : null;

  // Helper: Check if vessel has likely arrived (ETA passed or no ETA set)
  const hasEtaPassed = etaDate ? etaDate < now : false;

  // Document type based status (from highest to lowest priority)
  if (documentType) {
    switch (documentType) {
      case 'proof_of_delivery':
      case 'pod_confirmation':
        // POD is definitive proof of delivery - trust it regardless of dates
        return 'delivered';
      case 'delivery_order':
      case 'arrival_notice':
      case 'container_release':
        // These documents indicate arrival, but ONLY trust them if:
        // 1. ETA has passed, OR
        // 2. No ETA set (can't validate)
        // This prevents misclassified documents from incorrectly marking as arrived
        if (hasEtaPassed) return 'arrived';
        if (!etaDate) return 'arrived'; // No ETA to validate against
        // ETA is in future - document might be misclassified, stay in_transit
        return 'in_transit';
      case 'bill_of_lading':
      case 'cargo_manifest':
        // BL issued means cargo is ready/in transit
        if (etdDate && etdDate < now) return 'in_transit';
        return 'booked';
      case 'booking_confirmation':
      case 'booking_amendment':
      case 'shipping_instruction':
      case 'rate_confirmation':
        return 'booked';
    }
  }

  // Date-based fallback (only upgrade status, never downgrade)
  const statusPriority: Record<ShipmentStatus, number> = {
    draft: 0,
    booked: 1,
    in_transit: 2,
    arrived: 3,
    delivered: 4,
    cancelled: -1
  };

  let inferredStatus: ShipmentStatus = 'draft';

  // If ETD has passed, likely in transit
  if (etdDate && etdDate < now) {
    inferredStatus = 'in_transit';
  }

  // If ETA has passed, likely arrived
  if (etaDate && etaDate < now) {
    inferredStatus = 'arrived';
  }

  // Don't downgrade existing status
  if (currentStatus && statusPriority[currentStatus] > statusPriority[inferredStatus]) {
    return currentStatus;
  }

  return inferredStatus;
}

export interface LinkingConfig {
  auto_link_threshold: number; // >= 85: Auto-link without review
  suggestion_threshold: number; // >= 60: Create suggestion for review
  require_review_threshold: number; // < 85: Flag for manual review
}

const DEFAULT_LINKING_CONFIG: LinkingConfig = {
  auto_link_threshold: CONFIDENCE_THRESHOLDS.HIGH,
  suggestion_threshold: CONFIDENCE_THRESHOLDS.MEDIUM,
  require_review_threshold: CONFIDENCE_THRESHOLDS.REVIEW,
};

export class ShipmentLinkingService {
  private milestoneService?: MilestoneTrackingService;
  private workflowService?: WorkflowStateService;
  private enhancedWorkflowService?: EnhancedWorkflowStateService;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly shipmentRepo: ShipmentRepository,
    private readonly linkCandidateRepo: ShipmentLinkCandidateRepository,
    private readonly emailExtractionRepo: EmailExtractionRepository,
    private readonly attachmentExtractionRepo: AttachmentExtractionRepository,
    private readonly emailLinkRepo: EmailShipmentLinkRepository,
    private readonly attachmentLinkRepo: AttachmentShipmentLinkRepository,
    private readonly emailClassificationRepo?: EmailClassificationRepository,
    private readonly attachmentClassificationRepo?: AttachmentClassificationRepository,
    private readonly config: LinkingConfig = DEFAULT_LINKING_CONFIG
  ) {}

  /**
   * Set milestone service for auto-recording (optional dependency)
   */
  setMilestoneService(service: MilestoneTrackingService): void {
    this.milestoneService = service;
  }

  /**
   * Set workflow state service for auto-transitioning (optional dependency)
   * When documents are linked, this service auto-updates workflow_state
   * @deprecated Use setEnhancedWorkflowService() for dual-trigger workflow support
   */
  setWorkflowService(service: WorkflowStateService): void {
    this.workflowService = service;
  }

  /**
   * Set enhanced workflow service for dual-trigger workflow transitions
   * Preferred over setWorkflowService() - supports both document type AND email type triggers
   */
  setEnhancedWorkflowService(service: EnhancedWorkflowStateService): void {
    this.enhancedWorkflowService = service;
  }

  /**
   * Helper: Get all extractions for an email (combines email + attachment extractions)
   * Maps to EntityExtraction interface for backward compatibility
   */
  private async getAllExtractionsForEmail(emailId: string): Promise<EntityExtraction[]> {
    const [emailExtractions, attachmentExtractions] = await Promise.all([
      this.emailExtractionRepo.findByEmailId(emailId),
      this.attachmentExtractionRepo.findByEmailId(emailId),
    ]);

    // Map to EntityExtraction format (use normalized value if available)
    const mapToEntityExtraction = (e: any): EntityExtraction => ({
      id: e.id,
      email_id: e.email_id || emailId,
      entity_type: e.entity_type as EntityType,
      entity_value: e.entity_normalized || e.entity_value,
      confidence_score: e.confidence_score || 0,
      extraction_method: e.extraction_method || 'unknown',
      is_verified: e.is_correct ?? false,
      created_at: e.created_at || e.extracted_at || new Date().toISOString(),
    });

    return [
      ...emailExtractions.map(mapToEntityExtraction),
      ...attachmentExtractions.map(mapToEntityExtraction),
    ];
  }

  /**
   * Helper: Get classification for an email (checks both email and attachment classifications)
   * Email classifications have email_type, attachment classifications have document_type
   */
  private async getClassificationForEmail(emailId: string): Promise<{ document_type?: string } | null> {
    // Check attachment classifications first (they have actual document_type from PDF)
    if (this.attachmentClassificationRepo) {
      const attachClasses = await this.attachmentClassificationRepo.findByEmailId(emailId);
      if (attachClasses.length > 0 && attachClasses[0].document_type) {
        return { document_type: attachClasses[0].document_type };
      }
    }
    // Fall back to email classification (use email_type as document_type)
    if (this.emailClassificationRepo) {
      const emailClass = await this.emailClassificationRepo.findByEmailId(emailId);
      if (emailClass?.email_type) {
        return { document_type: emailClass.email_type };
      }
    }
    return null;
  }

  /**
   * Helper: Get email metadata by ID from raw_emails
   */
  private async getEmailById(emailId: string): Promise<{
    sender_email?: string;
    true_sender_email?: string;
    received_at?: string;
  } | null> {
    const { data } = await this.supabase
      .from('raw_emails')
      .select('sender_email, true_sender_email, received_at')
      .eq('id', emailId)
      .single();
    return data;
  }

  /**
   * Helper: Find emails that have identifier entities
   */
  private async findEmailsWithIdentifiers(limit: number, offset: number): Promise<{ email_id: string }[]> {
    const identifierTypes = ['booking_number', 'bl_number', 'container_number'];

    const { data } = await this.supabase
      .from('email_extractions')
      .select('email_id')
      .in('entity_type', identifierTypes)
      .not('entity_value', 'is', null)
      .range(offset, offset + limit - 1);

    const uniqueEmailIds = [...new Set((data || []).map((e: any) => e.email_id))];
    return uniqueEmailIds.map(email_id => ({ email_id }));
  }

  /**
   * Helper: Create email-shipment link
   */
  private async createEmailShipmentLink(params: {
    shipment_id: string;
    email_id: string;
    classification_id?: string;
    document_type: string;
    link_confidence_score: number;
    link_method: string;
    matched_booking_number?: string | null;
    matched_bl_number?: string | null;
    matched_container_number?: string | null;
  }): Promise<void> {
    await this.emailLinkRepo.upsert({
      email_id: params.email_id,
      shipment_id: params.shipment_id,
      link_method: params.link_method,
      link_confidence_score: params.link_confidence_score,
      link_identifier_type: params.matched_booking_number ? 'booking_number' :
                           params.matched_bl_number ? 'bl_number' :
                           params.matched_container_number ? 'container_number' : undefined,
      link_identifier_value: params.matched_booking_number || params.matched_bl_number || params.matched_container_number || undefined,
    });
  }

  /**
   * Helper: Find documents by shipment ID
   */
  private async findDocumentsByShipmentId(shipmentId: string): Promise<any[]> {
    return this.emailLinkRepo.findByShipmentId(shipmentId);
  }

  /**
   * Helper: Check if email is already linked
   */
  private async isEmailLinked(emailId: string): Promise<boolean> {
    return this.emailLinkRepo.isEmailLinked(emailId);
  }

  /**
   * Process email: Extract keys, find existing shipment, link email
   *
   * Deep module: Hides complexity of multi-step linking logic
   *
   * ARCHITECTURE NOTE:
   * This method ONLY links emails to EXISTING shipments.
   * Shipments are created ONLY by email-processing-orchestrator.ts
   * when a direct carrier booking confirmation is received.
   */
  async processEmail(emailId: string, classificationId?: string): Promise<LinkingResult> {
    // Step 1: Extract linking keys from entities
    const linkingKeys = await this.extractLinkingKeys(emailId);

    // Check if email has any identifiers
    if (!this.hasValidIdentifiers(linkingKeys)) {
      return {
        matched: false,
        confidence_score: 0,
        link_type: 'entity_match',
        reasoning: 'No linking keys found (booking #, BL #, or container #)',
      };
    }

    // Step 2: Find existing shipment (NEVER creates)
    const shipment = await this.findExistingShipment(linkingKeys, emailId);

    if (!shipment) {
      // No existing shipment - entities are stored, waiting for direct carrier email
      return {
        matched: false,
        confidence_score: 0,
        link_type: 'entity_match',
        reasoning: `Has identifiers (${this.formatIdentifiers(linkingKeys)}) but no matching shipment exists. Waiting for direct carrier booking confirmation.`,
      };
    }

    // Step 3: Link email to shipment
    const linkResult = await this.linkEmailToShipment(
      emailId,
      shipment.id,
      linkingKeys,
      classificationId
    );

    return linkResult;
  }

  /**
   * Format identifiers for logging/reasoning
   */
  private formatIdentifiers(keys: LinkingKeys): string {
    const parts: string[] = [];
    if (keys.booking_numbers.length > 0) parts.push(`booking: ${keys.booking_numbers[0]}`);
    if (keys.bl_numbers.length > 0) parts.push(`BL: ${keys.bl_numbers[0]}`);
    if (keys.container_numbers.length > 0) parts.push(`container: ${keys.container_numbers[0]}`);
    return parts.join(', ') || 'unknown';
  }

  /**
   * Extract linking keys from entity extractions
   */
  private async extractLinkingKeys(emailId: string): Promise<LinkingKeys> {
    const entities = await this.getAllExtractionsForEmail(emailId);

    return {
      booking_numbers: this.extractByType(entities, 'booking_number'),
      bl_numbers: this.extractByType(entities, 'bl_number'),
      container_numbers: this.extractByType(entities, 'container_number'),
      invoice_numbers: this.extractByType(entities, 'reference_number'), // May contain invoices
      vessel_name: entities.find(e => e.entity_type === 'vessel_name')?.entity_value,
      voyage_number: entities.find(e => e.entity_type === 'voyage_number')?.entity_value,
    };
  }

  /**
   * Extract entity values by type
   */
  private extractByType(entities: EntityExtraction[], type: EntityType): string[] {
    return entities
      .filter(e => e.entity_type === type && e.entity_value)
      .map(e => e.entity_value);
  }

  /**
   * Build complete shipment data from all extracted entities
   */
  private async buildShipmentDataFromEntities(
    emailId: string,
    existingStatus?: ShipmentStatus
  ): Promise<Partial<Shipment>> {
    const entities = await this.getAllExtractionsForEmail(emailId);

    const findEntity = (type: string) => entities.find(e => e.entity_type === type)?.entity_value;

    // Helper to find entity with fallback types
    const findEntityWithFallback = (primaryType: string, fallbackType: string) => {
      return findEntity(primaryType) || findEntity(fallbackType);
    };

    // Get dates for status determination
    const etd = parseEntityDate(findEntityWithFallback('etd', 'estimated_departure_date'));
    const eta = parseEntityDate(findEntityWithFallback('eta', 'estimated_arrival_date'));

    // Get document type from classification for status determination
    let documentType: DocumentType | undefined;
    const classification = await this.getClassificationForEmail(emailId);
    if (classification) {
      documentType = classification.document_type as DocumentType;
    }

    // Determine status based on document type and dates
    const status = determineShipmentStatus(documentType, etd, eta, existingStatus);

    return {
      // Identifiers
      booking_number: findEntity('booking_number'),
      bl_number: findEntity('bl_number'),
      container_number_primary: findEntity('container_number'),

      // Vessel & Voyage
      vessel_name: findEntity('vessel_name'),
      voyage_number: findEntity('voyage_number'),

      // Ports & Places
      port_of_loading: findEntity('port_of_loading'),
      port_of_loading_code: findEntity('port_of_loading_code'),
      port_of_discharge: findEntity('port_of_discharge'),
      port_of_discharge_code: findEntity('port_of_discharge_code'),
      place_of_receipt: findEntity('place_of_receipt'),
      place_of_delivery: findEntity('place_of_delivery'),

      // Dates (parse from natural language to ISO format)
      // Convert null to undefined for type compatibility
      etd: etd ?? undefined,
      eta: eta ?? undefined,
      atd: parseEntityDate(findEntity('atd')) ?? undefined,
      ata: parseEntityDate(findEntity('ata')) ?? undefined,

      // Cutoff dates
      si_cutoff: parseEntityDate(findEntity('si_cutoff')) ?? undefined,
      vgm_cutoff: parseEntityDate(findEntity('vgm_cutoff')) ?? undefined,
      cargo_cutoff: parseEntityDate(findEntity('cargo_cutoff')) ?? undefined,
      gate_cutoff: parseEntityDate(findEntity('gate_cutoff')) ?? undefined,

      // Cargo
      commodity_description: findEntity('commodity') || findEntity('commodity_description'),
      total_weight: findEntity('weight') ? parseFloat(findEntity('weight')!) : undefined,
      total_volume: findEntity('volume') ? parseFloat(findEntity('volume')!) : undefined,
      weight_unit: (findEntity('weight_unit') as 'KG' | 'LB' | 'MT') || 'KG',
      volume_unit: (findEntity('volume_unit') as 'CBM' | 'CFT') || 'CBM',

      // Commercial
      incoterms: findEntity('incoterms'),
      freight_terms: findEntity('freight_terms'),

      // Metadata - intelligent status
      status,
      created_from_email_id: emailId,
    };
  }

  /**
   * Find existing shipment by linking keys using ALL identifiers
   *
   * IMPORTANT: This method ONLY finds existing shipments.
   * Shipments are ONLY created by email-processing-orchestrator.ts
   * when a booking confirmation is received from a DIRECT CARRIER.
   *
   * Multi-identifier matching:
   * - Checks ALL identifiers (booking#, BL#, container#)
   * - If all point to same shipment → high confidence
   * - If different shipments → conflict (returns null, logs warning)
   */
  private async findExistingShipment(
    keys: LinkingKeys,
    emailId: string
  ): Promise<Shipment | null> {
    // Collect all shipment matches from ALL identifiers
    const matches = new Map<string, { shipment: Shipment; matchedBy: string[] }>();

    // Try ALL booking numbers
    for (const bookingNumber of keys.booking_numbers) {
      const shipment = await this.shipmentRepo.findByBookingNumber(bookingNumber);
      if (shipment) {
        const existing = matches.get(shipment.id);
        if (existing) {
          existing.matchedBy.push(`booking:${bookingNumber}`);
        } else {
          matches.set(shipment.id, { shipment, matchedBy: [`booking:${bookingNumber}`] });
        }
      }
    }

    // Try ALL BL numbers
    for (const blNumber of keys.bl_numbers) {
      const shipment = await this.shipmentRepo.findByBlNumber(blNumber);
      if (shipment) {
        const existing = matches.get(shipment.id);
        if (existing) {
          existing.matchedBy.push(`bl:${blNumber}`);
        } else {
          matches.set(shipment.id, { shipment, matchedBy: [`bl:${blNumber}`] });
        }
      }
    }

    // Try ALL container numbers (now checks shipment_containers table too)
    for (const containerNumber of keys.container_numbers) {
      const shipment = await this.shipmentRepo.findByContainerNumber(containerNumber);
      if (shipment) {
        const existing = matches.get(shipment.id);
        if (existing) {
          existing.matchedBy.push(`container:${containerNumber}`);
        } else {
          matches.set(shipment.id, { shipment, matchedBy: [`container:${containerNumber}`] });
        }
      }
    }

    // Handle results
    if (matches.size === 0) {
      // No existing shipment found - DO NOT CREATE
      return null;
    }

    if (matches.size === 1) {
      // Single shipment matched (possibly by multiple identifiers) → success
      const entry = [...matches.values()][0];
      console.log(`[Linking] Email ${emailId} matched shipment ${entry.shipment.id} via: ${entry.matchedBy.join(', ')}`);
      await this.updateShipmentWithNewEntities(entry.shipment, emailId);
      return entry.shipment;
    }

    // Multiple DIFFERENT shipments matched → conflict
    const conflictInfo = [...matches.entries()].map(([id, { matchedBy }]) =>
      `${id} (via ${matchedBy.join(', ')})`
    ).join(' vs ');
    console.warn(`[Linking] CONFLICT: Email ${emailId} matches multiple shipments: ${conflictInfo}`);

    // Return the first match (by booking priority) but log the conflict
    // In future, could create a link_conflict record for manual review
    const firstMatch = [...matches.values()][0];
    await this.updateShipmentWithNewEntities(firstMatch.shipment, emailId);
    return firstMatch.shipment;
  }

  /**
   * Check if linking keys contain at least one valid identifier
   */
  private hasValidIdentifiers(keys: LinkingKeys): boolean {
    return (
      keys.booking_numbers.length > 0 ||
      keys.bl_numbers.length > 0 ||
      keys.container_numbers.length > 0
    );
  }

  // NOTE: createNewShipment() was REMOVED
  // Shipments are ONLY created by email-processing-orchestrator.ts
  // when a booking confirmation is received from a DIRECT CARRIER
  // This enforces the single source of truth architecture

  /**
   * Update existing shipment with new entity data
   * Only updates fields that are currently null/empty
   */
  private async updateShipmentWithNewEntities(
    existingShipment: Shipment,
    emailId: string
  ): Promise<void> {
    // Get entity data from the new email, passing existing status for upgrade logic
    const newData = await this.buildShipmentDataFromEntities(
      emailId,
      existingShipment.status as ShipmentStatus
    );

    // Build update object - only include fields that:
    // 1. Have values in the new data
    // 2. Are currently null/empty in the existing shipment
    const updates: Partial<Shipment> = {};

    // Status can only be upgraded (never downgraded)
    if (newData.status && newData.status !== existingShipment.status) {
      const statusPriority: Record<string, number> = {
        draft: 0, booked: 1, in_transit: 2, arrived: 3, delivered: 4, cancelled: -1
      };
      if (statusPriority[newData.status] > statusPriority[existingShipment.status || 'draft']) {
        updates.status = newData.status;
      }
    }

    // Update missing dates
    if (!existingShipment.etd && newData.etd) {
      updates.etd = newData.etd;
    }
    if (!existingShipment.eta && newData.eta) {
      updates.eta = newData.eta;
    }
    if (!existingShipment.atd && newData.atd) {
      updates.atd = newData.atd;
    }
    if (!existingShipment.ata && newData.ata) {
      updates.ata = newData.ata;
    }

    // Update missing cutoff dates
    if (!existingShipment.si_cutoff && newData.si_cutoff) {
      updates.si_cutoff = newData.si_cutoff;
    }
    if (!existingShipment.vgm_cutoff && newData.vgm_cutoff) {
      updates.vgm_cutoff = newData.vgm_cutoff;
    }
    if (!existingShipment.cargo_cutoff && newData.cargo_cutoff) {
      updates.cargo_cutoff = newData.cargo_cutoff;
    }
    if (!existingShipment.gate_cutoff && newData.gate_cutoff) {
      updates.gate_cutoff = newData.gate_cutoff;
    }

    // Update missing ports
    if (!existingShipment.port_of_loading && newData.port_of_loading) {
      updates.port_of_loading = newData.port_of_loading;
    }
    if (!existingShipment.port_of_loading_code && newData.port_of_loading_code) {
      updates.port_of_loading_code = newData.port_of_loading_code;
    }
    if (!existingShipment.port_of_discharge && newData.port_of_discharge) {
      updates.port_of_discharge = newData.port_of_discharge;
    }
    if (!existingShipment.port_of_discharge_code && newData.port_of_discharge_code) {
      updates.port_of_discharge_code = newData.port_of_discharge_code;
    }

    // Update missing vessel info
    if (!existingShipment.vessel_name && newData.vessel_name) {
      updates.vessel_name = newData.vessel_name;
    }
    if (!existingShipment.voyage_number && newData.voyage_number) {
      updates.voyage_number = newData.voyage_number;
    }

    // Update missing BL number if not set
    if (!existingShipment.bl_number && newData.bl_number) {
      updates.bl_number = newData.bl_number;
    }

    // Update missing commodity info
    if (!existingShipment.commodity_description && newData.commodity_description) {
      updates.commodity_description = newData.commodity_description;
    }

    // Update missing weight/volume
    if (!existingShipment.total_weight && newData.total_weight) {
      updates.total_weight = newData.total_weight;
      updates.weight_unit = newData.weight_unit;
    }
    if (!existingShipment.total_volume && newData.total_volume) {
      updates.total_volume = newData.total_volume;
      updates.volume_unit = newData.volume_unit;
    }

    // Update missing commercial terms
    if (!existingShipment.incoterms && newData.incoterms) {
      updates.incoterms = newData.incoterms;
    }
    if (!existingShipment.freight_terms && newData.freight_terms) {
      updates.freight_terms = newData.freight_terms;
    }

    // Only update if there are changes
    if (Object.keys(updates).length > 0) {
      console.log(`Updating shipment ${existingShipment.id} with ${Object.keys(updates).length} new fields from email ${emailId}`);
      await this.shipmentRepo.update(existingShipment.id, updates);
    }
  }

  /**
   * Link email to shipment with confidence scoring
   * Uses sophisticated LinkConfidenceCalculator with authority/time factors
   */
  private async linkEmailToShipment(
    emailId: string,
    shipmentId: string,
    keys: LinkingKeys,
    classificationId?: string
  ): Promise<LinkingResult> {
    // Get email and shipment data for confidence calculation
    const email = await this.getEmailById(emailId);
    let shipment: Shipment | null = null;
    try {
      shipment = await this.shipmentRepo.findById(shipmentId);
    } catch {
      // Shipment may not exist yet
    }

    // Get document type from classification
    let documentType: DocumentType = 'booking_confirmation';
    const classification = await this.getClassificationForEmail(emailId);
    if (classification?.document_type) {
      documentType = classification.document_type as DocumentType;
    }

    // Calculate confidence with sophisticated calculator
    const { linkType, matchedValue, confidence } = this.calculateLinkConfidence(keys, {
      senderEmail: email?.sender_email || email?.true_sender_email,
      documentType,
      emailReceivedAt: email?.received_at,
      shipmentCreatedAt: shipment?.created_at,
    });

    // High confidence: Auto-link
    if (confidence >= this.config.auto_link_threshold) {
      await this.createEmailShipmentLink({
        shipment_id: shipmentId,
        email_id: emailId,
        classification_id: classificationId,
        document_type: documentType,
        link_confidence_score: confidence,
        link_method: 'ai',
        // Store matched identifiers for traceability
        matched_booking_number: keys.booking_numbers[0] || null,
        matched_bl_number: keys.bl_numbers[0] || null,
        matched_container_number: keys.container_numbers[0] || null,
      });

      // Propagate cutoff dates from entity_extractions to shipments table
      await this.propagateCutoffsToShipment(emailId, shipmentId);

      // Auto-record milestone if service is available
      await this.autoRecordMilestone(shipmentId, documentType, emailId);

      // Auto-update shipment status based on document type
      await this.updateShipmentStatusFromDocument(shipmentId, documentType);

      // Auto-transition workflow state based on document type
      // This updates shipments.workflow_state and creates audit trail
      await this.autoTransitionWorkflowState(shipmentId, documentType, emailId);

      return {
        matched: true,
        shipment_id: shipmentId,
        confidence_score: confidence,
        link_type: linkType,
        matched_value: matchedValue,
        reasoning: `Auto-linked with ${confidence}% confidence via ${linkType}`,
      };
    }

    // Medium confidence: Create suggestion for review
    if (confidence >= this.config.suggestion_threshold) {
      await this.linkCandidateRepo.create({
        email_id: emailId,
        shipment_id: shipmentId,
        link_type: linkType,
        matched_value: matchedValue,
        confidence_score: confidence,
        match_reasoning: `Matched on ${linkType}: ${matchedValue}`,
      });

      return {
        matched: false,
        shipment_id: shipmentId,
        confidence_score: confidence,
        link_type: linkType,
        matched_value: matchedValue,
        reasoning: `Created link suggestion (${confidence}% confidence) - requires manual review`,
      };
    }

    // Low confidence: No action
    return {
      matched: false,
      confidence_score: confidence,
      link_type: linkType,
      reasoning: `Confidence too low (${confidence}%) - no link created`,
    };
  }

  /**
   * Calculate link confidence using sophisticated LinkConfidenceCalculator
   * Factors: identifier type, email authority, document type, time proximity
   */
  private calculateLinkConfidence(
    keys: LinkingKeys,
    options?: {
      senderEmail?: string;
      documentType?: string;
      emailReceivedAt?: string;
      shipmentCreatedAt?: string;
    }
  ): {
    linkType: LinkType;
    matchedValue: string;
    confidence: number;
  } {
    // Determine identifier type and value
    let identifierType: IdentifierType;
    let matchedValue: string;
    let linkType: LinkType;

    if (keys.booking_numbers.length > 0) {
      identifierType = 'booking_number';
      matchedValue = keys.booking_numbers[0];
      linkType = 'booking_number';
    } else if (keys.bl_numbers.length > 0) {
      identifierType = 'bl_number';
      matchedValue = keys.bl_numbers[0];
      linkType = 'bl_number';
    } else if (keys.container_numbers.length > 0) {
      identifierType = 'container_number';
      matchedValue = keys.container_numbers[0];
      linkType = 'container_number';
    } else {
      return { linkType: 'entity_match', matchedValue: '', confidence: 0 };
    }

    // Determine email authority
    const emailAuthority = this.determineEmailAuthority(options?.senderEmail);

    // Calculate time proximity in days
    let timeProximityDays: number | undefined;
    if (options?.emailReceivedAt && options?.shipmentCreatedAt) {
      const emailDate = new Date(options.emailReceivedAt);
      const shipmentDate = new Date(options.shipmentCreatedAt);
      timeProximityDays = Math.abs(
        Math.floor((emailDate.getTime() - shipmentDate.getTime()) / (1000 * 60 * 60 * 24))
      );
    }

    // Use sophisticated calculator
    const result = linkConfidenceCalculator.calculate({
      identifier_type: identifierType,
      identifier_value: matchedValue,
      email_authority: emailAuthority,
      document_type: options?.documentType,
      time_proximity_days: timeProximityDays,
    });

    return {
      linkType,
      matchedValue,
      confidence: result.score,
    };
  }

  /**
   * Determine email authority based on sender domain
   */
  private determineEmailAuthority(senderEmail?: string): EmailAuthority {
    if (!senderEmail) return EmailAuthority.THIRD_PARTY;

    const domain = senderEmail.split('@')[1]?.toLowerCase();
    if (!domain) return EmailAuthority.THIRD_PARTY;

    // Check if direct carrier
    if (DIRECT_CARRIER_DOMAINS.some(d => domain.includes(d))) {
      return EmailAuthority.DIRECT_CARRIER;
    }

    // Check if internal (intoglo)
    if (domain.includes('intoglo')) {
      return EmailAuthority.INTERNAL;
    }

    return EmailAuthority.THIRD_PARTY;
  }

  /**
   * Process all unlinked emails in batch
   */
  async processUnlinkedEmails(options?: {
    batchSize?: number;
    maxEmails?: number;
  }): Promise<{
    processed: number;
    linked: number;
    candidates_created: number;
    errors: number;
  }> {
    const batchSize = options?.batchSize || 50;
    const maxEmails = options?.maxEmails || 5000;

    let processed = 0;
    let linked = 0;
    let candidates_created = 0;
    let errors = 0;

    // Get unlinked emails in batches
    let offset = 0;
    let hasMore = true;

    while (hasMore && processed < maxEmails) {
      // Find emails without links
      const unlinkedEmails = await this.findUnlinkedEmailsWithEntities(
        batchSize,
        offset
      );

      if (unlinkedEmails.length === 0) {
        hasMore = false;
        break;
      }

      // Process each email
      for (const email of unlinkedEmails) {
        if (processed >= maxEmails) break;

        try {
          const result = await this.processEmail(email.id);
          processed++;

          if (result.matched) {
            linked++;
          } else if (result.confidence_score >= this.config.suggestion_threshold) {
            candidates_created++;
          }
        } catch (error) {
          errors++;
          console.error(`Error linking email ${email.id}:`, error);
        }
      }

      offset += batchSize;

      // Log progress
      if (processed % 100 === 0) {
        console.log(`Linkage progress: ${processed} processed, ${linked} linked`);
      }
    }

    return { processed, linked, candidates_created, errors };
  }

  /**
   * Find emails that have entities but no shipment links
   */
  private async findUnlinkedEmailsWithEntities(
    limit: number,
    offset: number
  ): Promise<{ id: string }[]> {
    // Get emails with entity extractions that have identifiers
    const emails = await this.findEmailsWithIdentifiers(limit, offset);

    // Filter out already linked emails
    const unlinked: { id: string }[] = [];
    for (const email of emails) {
      const isLinked = await this.isEmailLinked(email.email_id);
      if (!isLinked) {
        unlinked.push({ id: email.email_id });
      }
    }

    return unlinked;
  }

  /**
   * Resync shipment fields from linked email entities
   * Use when shipments exist but have missing data that exists in entity extractions
   */
  async resyncShipmentFromLinkedEmails(shipmentId: string): Promise<{
    updated: boolean;
    updatedFields: string[];
  }> {
    // Get shipment
    const shipment = await this.shipmentRepo.findById(shipmentId);

    // Get all linked documents for this shipment
    const documents = await this.findDocumentsByShipmentId(shipmentId);
    if (documents.length === 0) {
      return { updated: false, updatedFields: [] };
    }

    // Aggregate entity data from all linked emails
    const updates: Partial<Shipment> = {};
    const updatedFields: string[] = [];

    for (const doc of documents) {
      const entities = await this.getAllExtractionsForEmail(doc.email_id);

      // Helper to set field if currently empty
      const setIfEmpty = (
        field: keyof Shipment,
        entityType: string,
        transform?: (value: string) => any
      ) => {
        if (!shipment[field] && !updates[field]) {
          const entity = entities.find(e => e.entity_type === entityType);
          if (entity?.entity_value) {
            (updates as any)[field] = transform
              ? transform(entity.entity_value)
              : entity.entity_value;
            updatedFields.push(field);
          }
        }
      };

      // Identifiers
      setIfEmpty('booking_number', 'booking_number');
      setIfEmpty('bl_number', 'bl_number');
      setIfEmpty('container_number_primary', 'container_number');

      // Vessel & Voyage
      setIfEmpty('vessel_name', 'vessel_name');
      setIfEmpty('voyage_number', 'voyage_number');

      // Ports
      setIfEmpty('port_of_loading', 'port_of_loading');
      setIfEmpty('port_of_loading_code', 'port_of_loading_code');
      setIfEmpty('port_of_discharge', 'port_of_discharge');
      setIfEmpty('port_of_discharge_code', 'port_of_discharge_code');
      setIfEmpty('place_of_receipt', 'place_of_receipt');
      setIfEmpty('place_of_delivery', 'place_of_delivery');

      // Dates
      setIfEmpty('etd', 'etd', parseEntityDate);
      setIfEmpty('eta', 'eta', parseEntityDate);
      setIfEmpty('atd', 'atd', parseEntityDate);
      setIfEmpty('ata', 'ata', parseEntityDate);

      // Cutoffs
      setIfEmpty('si_cutoff', 'si_cutoff', parseEntityDate);
      setIfEmpty('vgm_cutoff', 'vgm_cutoff', parseEntityDate);
      setIfEmpty('cargo_cutoff', 'cargo_cutoff', parseEntityDate);
      setIfEmpty('gate_cutoff', 'gate_cutoff', parseEntityDate);

      // Cargo
      setIfEmpty('commodity_description', 'commodity');
      if (!shipment.total_weight && !updates.total_weight) {
        const weightEntity = entities.find(e => e.entity_type === 'weight');
        if (weightEntity?.entity_value) {
          updates.total_weight = parseFloat(weightEntity.entity_value);
          updatedFields.push('total_weight');
        }
      }
      if (!shipment.total_volume && !updates.total_volume) {
        const volumeEntity = entities.find(e => e.entity_type === 'volume');
        if (volumeEntity?.entity_value) {
          updates.total_volume = parseFloat(volumeEntity.entity_value);
          updatedFields.push('total_volume');
        }
      }

      // Commercial
      setIfEmpty('incoterms', 'incoterms');
      setIfEmpty('freight_terms', 'freight_terms');

      // Get document type for status determination
      const classification = await this.getClassificationForEmail(doc.email_id);
      if (classification?.document_type) {
          // Determine status from document type and dates
          const effectiveEtd = (updates.etd || shipment.etd) as string | null;
          const effectiveEta = (updates.eta || shipment.eta) as string | null;
          const newStatus = determineShipmentStatus(
            classification.document_type as DocumentType,
            effectiveEtd,
            effectiveEta,
            shipment.status as ShipmentStatus
          );

          // Only upgrade status (never downgrade)
          const statusPriority: Record<string, number> = {
            draft: 0, booked: 1, in_transit: 2, arrived: 3, delivered: 4, cancelled: -1
          };
          const currentStatus = (updates.status || shipment.status) as string;
          if (statusPriority[newStatus] > statusPriority[currentStatus || 'draft']) {
            updates.status = newStatus;
            if (!updatedFields.includes('status')) {
              updatedFields.push('status');
            }
          }
        }
    }

    // If no status update from documents, try date-based fallback
    if (!updates.status && shipment.status === 'draft') {
      const effectiveEtd = (updates.etd || shipment.etd) as string | null;
      const effectiveEta = (updates.eta || shipment.eta) as string | null;
      const inferredStatus = determineShipmentStatus(undefined, effectiveEtd, effectiveEta, 'draft');
      if (inferredStatus !== 'draft') {
        updates.status = inferredStatus;
        updatedFields.push('status');
      }
    }

    // Apply updates if any
    if (Object.keys(updates).length > 0) {
      await this.shipmentRepo.update(shipmentId, updates);
      console.log(`Resynced shipment ${shipmentId}: updated ${updatedFields.join(', ')}`);
      return { updated: true, updatedFields };
    }

    return { updated: false, updatedFields: [] };
  }

  /**
   * Resync ALL shipments from their linked emails
   */
  async resyncAllShipments(): Promise<{
    processed: number;
    updated: number;
    fieldsUpdated: Record<string, number>;
  }> {
    // Get all shipments
    const result = await this.shipmentRepo.findAll({}, { page: 1, limit: 1000 });
    const shipments = result.data;

    let processed = 0;
    let updated = 0;
    const fieldsUpdated: Record<string, number> = {};

    for (const shipment of shipments) {
      processed++;
      const syncResult = await this.resyncShipmentFromLinkedEmails(shipment.id);

      if (syncResult.updated) {
        updated++;
        for (const field of syncResult.updatedFields) {
          fieldsUpdated[field] = (fieldsUpdated[field] || 0) + 1;
        }
      }
    }

    return { processed, updated, fieldsUpdated };
  }

  /**
   * Auto-record milestone when document is linked
   * Initializes milestones if needed, then records the appropriate one
   */
  private async autoRecordMilestone(
    shipmentId: string,
    documentType: string,
    emailId: string
  ): Promise<void> {
    if (!this.milestoneService) return;

    try {
      // Get the milestone code for this document type
      const milestoneCode = DOC_TYPE_TO_MILESTONE[documentType];
      if (!milestoneCode) return;

      // Get shipment dates for milestone initialization
      const shipment = await this.shipmentRepo.findById(shipmentId);

      // Check if milestones are initialized for this shipment
      const existingMilestones = await this.milestoneService.getMilestoneProgress(shipmentId);
      if (existingMilestones.total_milestones === 0) {
        // Initialize milestones
        await this.milestoneService.initializeMilestones(
          shipmentId,
          shipment.etd || null,
          shipment.eta || null
        );
      }

      // Record the milestone as achieved
      await this.milestoneService.recordMilestone(shipmentId, milestoneCode, {
        triggered_by_email_id: emailId,
        notes: `Auto-recorded from ${documentType}`,
      });

      console.log(`Milestone ${milestoneCode} recorded for shipment ${shipmentId}`);
    } catch (error) {
      // Log but don't fail - milestones are supplementary
      console.warn(`Failed to record milestone for shipment ${shipmentId}:`, error);
    }
  }

  /**
   * Auto-transition workflow state based on received document type
   * Uses EnhancedWorkflowStateService when available (preferred - dual-trigger support)
   * Falls back to WorkflowStateService for backward compatibility
   */
  private async autoTransitionWorkflowState(
    shipmentId: string,
    documentType: string,
    emailId: string
  ): Promise<void> {
    // Try enhanced workflow service first (preferred - dual-trigger support)
    if (this.enhancedWorkflowService) {
      try {
        // Get document type from classification (prefer attachment, fall back to email)
        let effectiveDocumentType = documentType;
        let emailType: EmailType = 'unknown';
        let senderCategory: SenderCategory = 'unknown';

        // Try attachment classification first (has document_type)
        if (this.attachmentClassificationRepo) {
          const attachClasses = await this.attachmentClassificationRepo.findByEmailId(emailId);
          if (attachClasses.length > 0 && attachClasses[0].document_type) {
            effectiveDocumentType = attachClasses[0].document_type;
            senderCategory = (attachClasses[0].sender_category as SenderCategory) || 'unknown';
          }
        }

        // Get email classification for email_type
        if (this.emailClassificationRepo) {
          const emailClass = await this.emailClassificationRepo.findByEmailId(emailId);
          if (emailClass) {
            emailType = (emailClass.email_type as EmailType) || 'general_notification';
            if (!senderCategory || senderCategory === 'unknown') {
              senderCategory = (emailClass.sender_category as SenderCategory) || 'unknown';
            }
          }
        }

        // Build transition input
        const transitionInput: WorkflowTransitionInput = {
          shipmentId,
          documentType: effectiveDocumentType,
          emailType,
          direction: 'inbound', // Default to inbound
          senderCategory,
          emailId,
          subject: '', // Not needed for transition logic
        };

        const result = await this.enhancedWorkflowService.transitionFromClassification(transitionInput);

        if (result.success) {
          console.log(
            `[Workflow] Enhanced: ${shipmentId}: ${result.previousState || 'none'} -> ${result.newState} (triggered by: ${result.triggeredBy})`
          );
        } else if (result.skippedReason) {
          console.log(`[Workflow] Skipped for ${shipmentId}: ${result.skippedReason}`);
        }
        return;
      } catch (error) {
        // Fall through to legacy service
        console.warn(`[Workflow] Enhanced service failed, falling back to legacy:`, error);
      }
    }

    // Fallback to legacy workflow service (deprecated)
    if (!this.workflowService) return;

    try {
      const result = await this.workflowService.autoTransitionFromDocument(
        shipmentId,
        documentType,
        emailId
      );

      if (result?.success) {
        console.log(
          `[Workflow] Legacy: ${shipmentId}: ${result.from_state || 'none'} -> ${result.to_state} (from ${documentType})`
        );
      }
    } catch (error) {
      // Log but don't fail - workflow updates are supplementary to core linking
      console.warn(`[Workflow] Failed to transition state for shipment ${shipmentId}:`, error);
    }
  }

  /**
   * Propagate cutoff dates from entity_extractions to shipments table
   * Only updates shipment fields that are currently null
   */
  private async propagateCutoffsToShipment(
    emailId: string,
    shipmentId: string
  ): Promise<void> {
    try {
      // Get entities for this email
      const entities = await this.getAllExtractionsForEmail(emailId);

      // Get current shipment to check which fields are empty
      const shipment = await this.shipmentRepo.findById(shipmentId);

      // Build updates for cutoff fields that are currently null
      const updates: Partial<Shipment> = {};
      const cutoffFields = ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff', 'etd', 'eta'] as const;

      for (const field of cutoffFields) {
        // Only update if shipment field is null
        if (shipment[field] === null || shipment[field] === undefined) {
          const entity = entities.find(e => e.entity_type === field);
          if (entity?.entity_value) {
            // Parse the date value
            const parsedDate = parseEntityDate(entity.entity_value);
            if (parsedDate) {
              updates[field] = parsedDate;
            }
          }
        }
      }

      // Apply updates if any
      if (Object.keys(updates).length > 0) {
        await this.shipmentRepo.update(shipmentId, updates);
        console.log(`[Linking] Propagated ${Object.keys(updates).join(', ')} to shipment ${shipmentId}`);
      }
    } catch (error) {
      // Log but don't fail - cutoff propagation is supplementary
      console.warn(`[Linking] Failed to propagate cutoffs for shipment ${shipmentId}:`, error);
    }
  }

  /**
   * Update shipment status based on linked document type
   * Only upgrades status (never downgrades)
   *
   * Status hierarchy: draft -> booked -> in_transit -> arrived -> delivered
   */
  async updateShipmentStatusFromDocument(
    shipmentId: string,
    documentType: DocumentType
  ): Promise<{ updated: boolean; newStatus?: ShipmentStatus }> {
    try {
      const shipment = await this.shipmentRepo.findById(shipmentId);
      const currentStatus = shipment.status as ShipmentStatus;

      // Determine new status based on document type and dates
      const newStatus = determineShipmentStatus(
        documentType,
        shipment.etd,
        shipment.eta,
        currentStatus
      );

      // Status priority for comparison
      const statusPriority: Record<ShipmentStatus, number> = {
        draft: 0,
        booked: 1,
        in_transit: 2,
        arrived: 3,
        delivered: 4,
        cancelled: -1,
      };

      // Only upgrade status (never downgrade)
      if (statusPriority[newStatus] > statusPriority[currentStatus]) {
        await this.shipmentRepo.update(shipmentId, { status: newStatus });
        console.log(`[Linking] Updated shipment ${shipmentId} status: ${currentStatus} -> ${newStatus} (from ${documentType})`);
        return { updated: true, newStatus };
      }

      return { updated: false };
    } catch (error) {
      console.warn(`[Linking] Failed to update status for shipment ${shipmentId}:`, error);
      return { updated: false };
    }
  }
}
