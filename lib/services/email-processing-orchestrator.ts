/**
 * Email Processing Orchestrator
 *
 * Unified pipeline for processing shipping emails:
 * 1. Classification → Determine document type
 * 2. Entity Extraction → Extract booking numbers, dates, ports, etc.
 * 3. Shipment Linking → Create/update shipments from booking confirmations
 * 4. Document Lifecycle → Track document status
 * 5. Notification Generation → Create notifications for exceptions
 *
 * This orchestrator ensures all stages flow automatically.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { StakeholderExtractionService, DocumentEntity, ShipmentDirection } from './stakeholder-extraction-service';
import { DocumentLifecycleService } from './document-lifecycle-service';
import { BackfillService } from './shipment-linking/backfill-service';
import { UnifiedClassificationService, ClassificationResult } from './unified-classification-service';
import { ShipmentExtractionService, ShipmentData } from './shipment-extraction-service';

// ============================================================================
// Configuration
// ============================================================================

/**
 * Minimum confidence required to auto-create a shipment from booking confirmation.
 * Classifications below this threshold require manual review.
 *
 * - 70%+ → Auto-create shipment
 * - 50-69% → Flag for manual review, don't create shipment
 * - <50% → Skip processing entirely
 */
const MINIMUM_CONFIDENCE_FOR_SHIPMENT_CREATION = 70;

/**
 * Minimum confidence to proceed with any processing (extraction, linking).
 * Below this, the email is marked as needing manual review.
 */
const MINIMUM_CONFIDENCE_FOR_PROCESSING = 50;

// Types
interface ProcessingResult {
  emailId: string;
  success: boolean;
  stage: 'classification' | 'extraction' | 'linking' | 'lifecycle' | 'notification';
  shipmentId?: string;
  error?: string;
  fieldsExtracted?: number;
}

interface ExtractedBookingData {
  carrier?: string;
  booking_number?: string;
  vessel_name?: string;
  voyage_number?: string;
  etd?: string;
  eta?: string;
  port_of_loading?: string;
  port_of_loading_code?: string;
  port_of_discharge?: string;
  port_of_discharge_code?: string;
  final_destination?: string;
  si_cutoff?: string;
  vgm_cutoff?: string;
  cargo_cutoff?: string;
  gate_cutoff?: string;
  doc_cutoff?: string;
  shipper_name?: string;
  shipper_address?: string;
  consignee_name?: string;
  consignee_address?: string;
  notify_party_name?: string;
  notify_party_address?: string;
  container_number?: string;
}

// Fallback carrier domains - used when database config is not available
// These should be moved to carrier_configs.email_sender_patterns in production
const FALLBACK_CARRIER_DOMAINS = [
  'service.hlag.com', 'hapag-lloyd.com',
  'maersk.com',
  'msc.com',
  'cma-cgm.com',
  'evergreen-line.com', 'evergreen-marine.com',
  'oocl.com',
  'cosco.com', 'coscoshipping.com',
  'yangming.com',
  'one-line.com',
  'zim.com',
  'hmm21.com',
  'pilship.com',
  'wanhai.com',
  'sitc.com',
];

// NOTE: CARRIER_PROMPTS and EXTRACTION_PROMPT_TEMPLATE moved to ShipmentExtractionService
// This consolidation ensures single extraction path for both cron and API

export class EmailProcessingOrchestrator {
  private supabase: SupabaseClient;
  private carrierIdMap: Map<string, string> = new Map();
  private carrierDomains: string[] = []; // Loaded from carrier_configs.email_sender_patterns
  private stakeholderService: StakeholderExtractionService;
  private lifecycleService: DocumentLifecycleService;
  private backfillService: BackfillService;
  private classificationService: UnifiedClassificationService;
  private extractionService: ShipmentExtractionService;

  constructor(supabaseUrl: string, supabaseKey: string, anthropicKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.stakeholderService = new StakeholderExtractionService(this.supabase);
    this.lifecycleService = new DocumentLifecycleService(this.supabase);
    this.backfillService = new BackfillService(this.supabase);
    this.classificationService = new UnifiedClassificationService(this.supabase, {
      useAiFallback: true,
      aiModel: 'claude-3-5-haiku-20241022',
    });
    // Use ShipmentExtractionService with Haiku model for cost-effective cron processing
    this.extractionService = new ShipmentExtractionService(
      this.supabase,
      anthropicKey,
      { useAdvancedModel: false } // Use Haiku for cron (Sonnet available via API path)
    );
  }

  /**
   * Check if email is from a direct carrier (source of truth)
   * Only direct carrier emails should CREATE shipments
   *
   * IMPORTANT: Must check true_sender_email because:
   * - Emails often arrive via ops group (sender_email = ops@intoglo.com)
   * - The actual carrier domain is in true_sender_email
   * - Example: sender_email=ops@intoglo.com, true_sender_email=digital-business@hlag.com
   *
   * Uses carrier domains loaded from carrier_configs.email_sender_patterns
   * Falls back to hardcoded list if database config is empty
   */
  private isDirectCarrierEmail(trueSenderEmail: string | null, senderEmail: string): boolean {
    // Use database-loaded domains, fallback to hardcoded list
    const domains = this.carrierDomains.length > 0 ? this.carrierDomains : FALLBACK_CARRIER_DOMAINS;

    // First check true_sender_email (preferred - actual sender before forwarding)
    if (trueSenderEmail) {
      const domain = trueSenderEmail.toLowerCase().split('@')[1] || '';
      if (domains.some(d => domain.includes(d))) {
        return true;
      }
    }
    // Fallback to sender_email for direct sends
    if (senderEmail) {
      const domain = senderEmail.toLowerCase().split('@')[1] || '';
      return domains.some(d => domain.includes(d));
    }
    return false;
  }

  /**
   * Initialize carrier ID mapping and load carrier domains from database
   * Configuration Over Code: Carrier patterns loaded from carrier_configs table
   */
  async initialize(): Promise<void> {
    // Load carrier ID mapping
    const { data: carriers } = await this.supabase.from('carriers').select('id, carrier_name');
    carriers?.forEach(c => {
      const lower = c.carrier_name.toLowerCase();
      this.carrierIdMap.set(lower, c.id);
      // Add common variations
      if (lower.includes('hapag')) this.carrierIdMap.set('hapag-lloyd', c.id);
      if (lower.includes('maersk')) this.carrierIdMap.set('maersk', c.id);
      if (lower.includes('cma')) this.carrierIdMap.set('cma cgm', c.id);
      if (lower.includes('cosco')) this.carrierIdMap.set('cosco', c.id);
      if (lower.includes('msc')) this.carrierIdMap.set('msc', c.id);
    });

    // Load carrier email domains from carrier_configs (database-driven)
    const { data: carrierConfigs } = await this.supabase
      .from('carrier_configs')
      .select('email_sender_patterns')
      .eq('enabled', true);

    if (carrierConfigs) {
      // Flatten all email_sender_patterns arrays into a single list of domains
      this.carrierDomains = carrierConfigs
        .flatMap(c => c.email_sender_patterns || [])
        .map(pattern => pattern.toLowerCase())
        .filter((domain, index, self) => self.indexOf(domain) === index); // Dedupe

      console.log(`[EmailProcessingOrchestrator] Loaded ${this.carrierDomains.length} carrier domains from database`);
    }
  }

  /**
   * Process a single email through the entire pipeline
   *
   * Pipeline order:
   * 1. Fetch email (with optional existing classification)
   * 2. Get PDF content from attachments
   * 3. Classify if no classification exists (CRITICAL - was missing before)
   * 4. Detect carrier from content
   * 5. Extract entities with AI
   * 6. Process based on document type (create/update/link shipment)
   * 7. Extract stakeholders
   * 8. Create document lifecycle
   * 9. Update processing status
   */
  async processEmail(emailId: string): Promise<ProcessingResult> {
    try {
      // 1. Get email with classification
      const { data: email } = await this.supabase
        .from('raw_emails')
        .select('*, document_classifications(*)')
        .eq('id', emailId)
        .single();

      if (!email) {
        return { emailId, success: false, stage: 'classification', error: 'Email not found' };
      }

      // 2. Get email content including PDF attachments (needed for classification)
      const content = await this.getFullContent(emailId, email);

      // 3. Get or CREATE classification
      // CRITICAL FIX: If no classification exists, we must classify the email first
      let classification = email.document_classifications?.[0];
      let documentType = classification?.document_type;
      let classificationConfidence = classification?.confidence_score || 0;

      if (!classification) {
        console.log(`[Orchestrator] No classification for email ${emailId.substring(0, 8)}... - classifying now`);

        // Get attachment filenames for classification
        const { data: attachments } = await this.supabase
          .from('raw_attachments')
          .select('filename, extracted_text')
          .eq('email_id', emailId);

        const attachmentFilenames = attachments?.map(a => a.filename).filter(Boolean) || [];
        const attachmentContent = attachments
          ?.filter(a => a.extracted_text && a.extracted_text.length > 50)
          .map(a => a.extracted_text)
          .join('\n\n') || '';

        // Classify using UnifiedClassificationService
        const classificationResult = await this.classificationService.classifyAndSave({
          emailId: email.id,
          subject: email.subject || '',
          senderEmail: email.sender_email || '',
          trueSenderEmail: email.true_sender_email || undefined,
          bodyText: email.body_text || '',
          snippet: email.snippet || '',
          hasAttachments: email.has_attachments || false,
          attachmentFilenames,
          attachmentContent,
        });

        documentType = classificationResult.documentType;
        classificationConfidence = classificationResult.confidence;
        console.log(`[Orchestrator] Classified as: ${documentType} (confidence: ${classificationConfidence})`);

        // Check minimum confidence for processing
        if (classificationConfidence < MINIMUM_CONFIDENCE_FOR_PROCESSING) {
          console.log(`[Orchestrator] Confidence ${classificationConfidence}% below minimum ${MINIMUM_CONFIDENCE_FOR_PROCESSING}% - marking for manual review`);
          await this.supabase
            .from('raw_emails')
            .update({ processing_status: 'manual_review' })
            .eq('id', emailId);
          return { emailId, success: false, stage: 'classification', error: `Low confidence (${classificationConfidence}%) - requires manual review` };
        }
      }

      // 4. Detect carrier from sender/content (prefer true_sender_email for forwarded emails)
      const carrier = this.detectCarrier(email.true_sender_email || email.sender_email, content);

      // 5. Extract data using CONSOLIDATED ShipmentExtractionService
      // This ensures single extraction path for both cron and API
      // Pass documentType for document-specific extraction hints (e.g., HBL party extraction)
      const pdfContent = await this.getPdfContent(emailId);
      const extractionResult = await this.extractionService.extractFromContent({
        emailId,
        subject: email.subject || '',
        bodyText: email.body_text || '',
        pdfContent,
        carrier,
        documentType,  // HBL/SI docs get special prompts to extract shipper/consignee/notify_party
      });

      if (!extractionResult.success || !extractionResult.data) {
        return { emailId, success: false, stage: 'extraction', error: extractionResult.error || 'AI extraction failed' };
      }

      // Map ShipmentData to ExtractedBookingData for downstream processing
      const extractedData = this.mapToExtractedBookingData(extractionResult.data);

      // Store extracted entities with subject line fallback for missing identifiers
      await this.storeExtractedEntities(emailId, extractedData, email.subject);

      // 6. Process based on document type
      let shipmentId: string | undefined;
      let fieldsExtracted = 0;

      if (documentType === 'booking_confirmation') {
        // CHECK: Only create shipments if confidence is above threshold
        if (classificationConfidence < MINIMUM_CONFIDENCE_FOR_SHIPMENT_CREATION) {
          console.log(`[Orchestrator] Booking confirmation confidence ${classificationConfidence}% below ${MINIMUM_CONFIDENCE_FOR_SHIPMENT_CREATION}% threshold - skipping shipment creation`);
          // Mark for manual review but don't create shipment
          await this.supabase
            .from('raw_emails')
            .update({ processing_status: 'needs_review' })
            .eq('id', emailId);
          // Still store entities for reference
          return {
            emailId,
            success: true,
            stage: 'linking',
            error: `Confidence ${classificationConfidence}% below threshold - shipment not created`,
            fieldsExtracted: 0,
          };
        }

        // CREATE shipment only from DIRECT carrier emails, otherwise LINK
        // For forwarded emails (like CMA CGM via pricing@intoglo.com), detect carrier from content
        const carrierFromContent = this.detectCarrier(email.true_sender_email || email.sender_email, content);
        const isCarrierEmail = this.isDirectCarrierEmail(email.true_sender_email, email.sender_email) ||
                               this.isKnownCarrierDisplayName(email.sender_email) ||
                               this.isCarrierContentBasedEmail(content, carrierFromContent, email.subject);

        const result = await this.processBookingConfirmation(
          emailId,
          extractedData,
          carrier,
          email.true_sender_email,  // Actual sender before forwarding
          email.sender_email,
          isCarrierEmail  // Pass content-based detection result
        );
        shipmentId = result.shipmentId;
        fieldsExtracted = result.fieldsUpdated;
      } else if (documentType === 'booking_amendment') {
        // UPDATE existing shipment
        const result = await this.processAmendment(emailId, extractedData);
        shipmentId = result.shipmentId;
        fieldsExtracted = result.fieldsUpdated;
      } else {
        // LINK to existing shipment and update stakeholders from HBL/SI
        const result = await this.linkToExistingShipment(emailId, extractedData, documentType);
        shipmentId = result.shipmentId;
      }

      // 7. Extract and link stakeholders (shipper_id, consignee_id)
      if (shipmentId && extractedData) {
        await this.extractAndLinkStakeholders(shipmentId, extractedData, documentType);
      }

      // 8. Create document lifecycle record
      if (shipmentId && documentType) {
        await this.createDocumentLifecycle(shipmentId, documentType, extractedData);
      }

      // 9. Update processing status
      await this.supabase
        .from('raw_emails')
        .update({ processing_status: 'processed' })
        .eq('id', emailId);

      return {
        emailId,
        success: true,
        stage: 'lifecycle',
        shipmentId,
        fieldsExtracted
      };

    } catch (error: any) {
      console.error(`[Orchestrator] Error processing email ${emailId}:`, error);
      return { emailId, success: false, stage: 'extraction', error: error.message };
    }
  }

  /**
   * Check if email content or subject indicates it's from a carrier (for forwarded emails)
   * Example: CMA CGM emails forwarded through pricing@intoglo.com
   * The PDF content contains "BOOKING CONFIRMATION" from CMA CGM
   *
   * ENHANCED: Also checks subject line patterns that are carrier-specific
   */
  private isCarrierContentBasedEmail(content: string, detectedCarrier: string, subject?: string): boolean {
    // If we detected a carrier from content, and the content has booking confirmation markers
    if (detectedCarrier !== 'default') {
      const hasBookingConfirmation = /BOOKING CONFIRMATION/i.test(content);
      const hasCarrierBranding = /CMA CGM|MAERSK|HAPAG|MSC|COSCO|EVERGREEN|ONE|YANG MING/i.test(content);
      if (hasBookingConfirmation && hasCarrierBranding) {
        return true;
      }
    }

    // Subject-based detection for known carrier patterns
    if (subject) {
      // Maersk: "Booking Confirmation : 263xxxxxx" (9-digit booking number starting with 26)
      if (/^Booking Confirmation\s*:\s*26\d{7}$/i.test(subject.trim())) {
        return true;
      }
      // Hapag-Lloyd: Subject contains HLCU or HL booking patterns
      if (/HLCU\d{7}|HL-?\d{8}/i.test(subject)) {
        return true;
      }
      // CMA CGM: "CMA CGM - Booking confirmation available"
      if (/CMA CGM.*Booking confirmation/i.test(subject)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if sender display name matches known carrier patterns
   * Example: "'in.export via Operations Intoglo'" contains "in.export" which is Maersk
   */
  private isKnownCarrierDisplayName(senderEmail: string): boolean {
    const senderLower = senderEmail.toLowerCase();

    // Known Maersk display name patterns
    const maerskPatterns = [
      'in.export',
      'maersk line export',
      'donotreply.*maersk',
      'customer service.*maersk',
    ];
    for (const pattern of maerskPatterns) {
      if (new RegExp(pattern, 'i').test(senderLower)) {
        return true;
      }
    }

    // Known Hapag-Lloyd patterns
    if (/india@service\.hlag|hapag|hlcu/i.test(senderLower)) {
      return true;
    }

    // Known CMA CGM patterns (display name only, no domain)
    if (/cma cgm website|cma cgm.*noreply/i.test(senderLower)) {
      return true;
    }

    return false;
  }

  /**
   * Extract linking identifiers from email subject using regex patterns
   * This is a FALLBACK when AI extraction misses identifiers
   *
   * Extracts: booking_number, container_number, bl_number
   *
   * Pattern sources:
   * - Maersk: 9-digit booking (263xxxxxx), MSKU/MAEU container prefixes
   * - Hapag: HL-XXXXXXXX or HLCU prefix
   * - CMA CGM: CAD/CEI/AMC + 7 digits
   * - COSCO: COSU + 10 digits
   * - Container: 4 letters + 7 digits (ISO 6346)
   * - BL: SE + 10+ digits, carrier prefix + digits
   */
  private extractIdentifiersFromSubject(subject: string): {
    booking_number?: string;
    container_number?: string;
    bl_number?: string;
    mbl_number?: string;
    hbl_number?: string;
  } {
    const result: {
      booking_number?: string;
      container_number?: string;
      bl_number?: string;
      mbl_number?: string;
      hbl_number?: string;
    } = {};

    // Booking number patterns by carrier
    const bookingPatterns = [
      /\b(26\d{7})\b/,                           // Maersk: 9-digit starting with 26
      /\b(\d{9})\b/,                             // Generic 9-digit
      /\b(HL-?\d{8})\b/i,                        // Hapag: HL-XXXXXXXX
      /\b(HLCU\d{7,10})\b/i,                     // Hapag: HLCU prefix
      /\b((?:CEI|AMC|CAD)\d{7})\b/i,             // CMA CGM: CAD/CEI/AMC + 7 digits
      /\b(COSU\d{10})\b/i,                       // COSCO: COSU + 10 digits
      /\b(MAEU\d{9})\b/i,                        // Maersk: MAEU prefix
      /\b([A-Z]{3}\d{7,10})\b/,                  // Generic carrier prefix + digits
    ];

    // Try booking patterns in priority order
    for (const pattern of bookingPatterns) {
      const match = subject.match(pattern);
      if (match && match[1]) {
        result.booking_number = match[1].toUpperCase();
        break;
      }
    }

    // Container number: 4 letters + 7 digits (ISO 6346 format)
    // Common prefixes: MSKU, MAEU, TEMU, TCLU, HLCU, CMAU, etc.
    const containerMatch = subject.match(/\b([A-Z]{4}\d{7})\b/);
    if (containerMatch && containerMatch[1]) {
      result.container_number = containerMatch[1].toUpperCase();
    }

    // BL number patterns
    const blPatterns = [
      /\b(SE\d{10,})\b/i,                        // SE + 10+ digits
      /\b(MAEU\d{9,}[A-Z0-9]*)\b/i,              // Maersk BL
      /\b(HLCU[A-Z0-9]{10,})\b/i,                // Hapag BL
      /\b(CMAU\d{9,})\b/i,                       // CMA CGM BL
      /\b(COSU\d{10,})\b/i,                      // COSCO BL
      /\b(MEDU\d{9,})\b/i,                       // MSC BL
      /\b(OOLU\d{9,})\b/i,                       // OOCL BL
    ];

    for (const pattern of blPatterns) {
      const match = subject.match(pattern);
      if (match && match[1]) {
        // Determine if MBL or HBL based on pattern/length
        const blNumber = match[1].toUpperCase();
        // Most carrier-prefixed BLs are MBLs
        result.bl_number = blNumber;
        result.mbl_number = blNumber;
        break;
      }
    }

    // HBL patterns (typically shorter, may have different format)
    // HBLs often have alphanumeric format like INTOGLO-2024-001
    const hblMatch = subject.match(/\b(INTOGLO[-/]?[A-Z0-9]{4,})\b/i);
    if (hblMatch && hblMatch[1]) {
      result.hbl_number = hblMatch[1].toUpperCase();
    }

    return result;
  }

  /**
   * Store extracted entities to entity_extractions table
   * Now includes regex fallback for subject line extraction
   */
  private async storeExtractedEntities(emailId: string, data: ExtractedBookingData, subject?: string): Promise<void> {
    const entities: { email_id: string; entity_type: string; entity_value: string; confidence_score: number; extraction_method: string }[] = [];

    // REGEX FALLBACK: If AI missed identifiers, extract from subject line
    let subjectExtracted: ReturnType<typeof this.extractIdentifiersFromSubject> = {};
    if (subject) {
      subjectExtracted = this.extractIdentifiersFromSubject(subject);
    }

    // Use AI extraction first, fallback to regex for missing identifiers
    const bookingNumber = data.booking_number || subjectExtracted.booking_number;
    const containerNumber = data.container_number || subjectExtracted.container_number;
    const blNumber = subjectExtracted.bl_number;  // AI uses different field name
    const mblNumber = subjectExtracted.mbl_number;
    const hblNumber = subjectExtracted.hbl_number;

    // Determine extraction method for booking number
    const bookingMethod = data.booking_number ? 'ai' : 'regex_subject';

    if (bookingNumber) {
      const confidence = data.booking_number ? 90 : 80; // Lower confidence for regex extraction
      entities.push({ email_id: emailId, entity_type: 'booking_number', entity_value: bookingNumber, confidence_score: confidence, extraction_method: bookingMethod });
    }
    if (data.carrier) {
      entities.push({ email_id: emailId, entity_type: 'carrier', entity_value: data.carrier, confidence_score: 85, extraction_method: 'ai' });
    }
    if (data.vessel_name) {
      entities.push({ email_id: emailId, entity_type: 'vessel_name', entity_value: data.vessel_name, confidence_score: 85, extraction_method: 'ai' });
    }
    if (data.voyage_number) {
      entities.push({ email_id: emailId, entity_type: 'voyage_number', entity_value: data.voyage_number, confidence_score: 85, extraction_method: 'ai' });
    }
    if (data.etd) {
      entities.push({ email_id: emailId, entity_type: 'etd', entity_value: data.etd, confidence_score: 85, extraction_method: 'ai' });
    }
    if (data.eta) {
      entities.push({ email_id: emailId, entity_type: 'eta', entity_value: data.eta, confidence_score: 85, extraction_method: 'ai' });
    }
    if (data.port_of_loading) {
      entities.push({ email_id: emailId, entity_type: 'port_of_loading', entity_value: data.port_of_loading, confidence_score: 85, extraction_method: 'ai' });
    }
    if (data.port_of_discharge) {
      entities.push({ email_id: emailId, entity_type: 'port_of_discharge', entity_value: data.port_of_discharge, confidence_score: 85, extraction_method: 'ai' });
    }
    if (data.si_cutoff) {
      entities.push({ email_id: emailId, entity_type: 'si_cutoff', entity_value: data.si_cutoff, confidence_score: 80, extraction_method: 'ai' });
    }
    if (data.vgm_cutoff) {
      entities.push({ email_id: emailId, entity_type: 'vgm_cutoff', entity_value: data.vgm_cutoff, confidence_score: 80, extraction_method: 'ai' });
    }
    if (data.cargo_cutoff) {
      entities.push({ email_id: emailId, entity_type: 'cargo_cutoff', entity_value: data.cargo_cutoff, confidence_score: 80, extraction_method: 'ai' });
    }
    // Container number: AI first, fallback to regex
    if (containerNumber) {
      const confidence = data.container_number ? 85 : 75;
      const method = data.container_number ? 'ai' : 'regex_subject';
      entities.push({ email_id: emailId, entity_type: 'container_number', entity_value: containerNumber, confidence_score: confidence, extraction_method: method });
    }

    // BL/MBL/HBL numbers from subject (fallback identifiers for linking)
    if (blNumber) {
      entities.push({ email_id: emailId, entity_type: 'bl_number', entity_value: blNumber, confidence_score: 75, extraction_method: 'regex_subject' });
    }
    if (mblNumber) {
      entities.push({ email_id: emailId, entity_type: 'mbl_number', entity_value: mblNumber, confidence_score: 75, extraction_method: 'regex_subject' });
    }
    if (hblNumber) {
      entities.push({ email_id: emailId, entity_type: 'hbl_number', entity_value: hblNumber, confidence_score: 75, extraction_method: 'regex_subject' });
    }

    // Stakeholders (shipper/consignee/notify) - extracted from HBL/SI documents
    if (data.shipper_name) {
      entities.push({ email_id: emailId, entity_type: 'shipper_name', entity_value: data.shipper_name, confidence_score: 85, extraction_method: 'ai' });
    }
    if (data.consignee_name) {
      entities.push({ email_id: emailId, entity_type: 'consignee_name', entity_value: data.consignee_name, confidence_score: 85, extraction_method: 'ai' });
    }
    if (data.notify_party_name) {
      entities.push({ email_id: emailId, entity_type: 'notify_party', entity_value: data.notify_party_name, confidence_score: 85, extraction_method: 'ai' });
    }

    if (entities.length > 0) {
      // Delete existing entities for this email to avoid duplicates on reprocess
      await this.supabase
        .from('entity_extractions')
        .delete()
        .eq('email_id', emailId);

      // Insert new entities
      await this.supabase
        .from('entity_extractions')
        .insert(entities);

      console.log(`[Orchestrator] Stored ${entities.length} entities for email ${emailId.substring(0, 8)}...`);
    }
  }

  /**
   * Get full content including email body and PDF attachments
   */
  private async getFullContent(emailId: string, email: any): Promise<string> {
    let content = `Subject: ${email.subject || ''}\n\nBody:\n${email.body_text || ''}`;

    // Get PDF attachments with extracted text
    const { data: attachments } = await this.supabase
      .from('raw_attachments')
      .select('filename, extracted_text, mime_type')
      .eq('email_id', emailId);

    for (const att of attachments || []) {
      // Check for PDF by mime_type OR filename extension (some attachments have generic mime_type)
      const isPdf = att.mime_type?.includes('pdf') || att.filename?.toLowerCase().endsWith('.pdf');
      if (att.extracted_text && isPdf) {
        content += `\n\n--- PDF ATTACHMENT: ${att.filename} ---\n${att.extracted_text}`;
      }
    }

    return content;
  }

  /**
   * Get PDF content only (for extraction service)
   */
  private async getPdfContent(emailId: string): Promise<string> {
    const { data: attachments } = await this.supabase
      .from('raw_attachments')
      .select('filename, extracted_text, mime_type')
      .eq('email_id', emailId);

    let pdfContent = '';
    for (const att of attachments || []) {
      // Check for PDF by mime_type OR filename extension (some attachments have generic mime_type)
      const isPdf = att.mime_type?.includes('pdf') || att.filename?.toLowerCase().endsWith('.pdf');
      if (att.extracted_text && isPdf) {
        pdfContent += `\n--- ${att.filename} ---\n${att.extracted_text}\n`;
      }
    }

    return pdfContent;
  }

  /**
   * Map ShipmentData (from extraction service) to ExtractedBookingData (for orchestrator)
   * This mapping ensures backward compatibility with existing downstream code
   */
  private mapToExtractedBookingData(data: ShipmentData): ExtractedBookingData {
    return {
      carrier: data.carrier_name ?? undefined,
      booking_number: data.booking_number ?? undefined,
      vessel_name: data.vessel_name ?? undefined,
      voyage_number: data.voyage_number ?? undefined,
      etd: data.etd ?? undefined,
      eta: data.eta ?? undefined,
      port_of_loading: data.port_of_loading ?? undefined,
      port_of_loading_code: data.port_of_loading_code ?? undefined,
      port_of_discharge: data.port_of_discharge ?? undefined,
      port_of_discharge_code: data.port_of_discharge_code ?? undefined,
      final_destination: data.place_of_delivery ?? undefined,
      si_cutoff: data.si_cutoff ?? undefined,
      vgm_cutoff: data.vgm_cutoff ?? undefined,
      cargo_cutoff: data.cargo_cutoff ?? undefined,
      gate_cutoff: data.gate_cutoff ?? undefined,
      doc_cutoff: data.doc_cutoff ?? undefined,
      shipper_name: data.shipper_name ?? undefined,
      shipper_address: data.shipper_address ?? undefined,
      consignee_name: data.consignee_name ?? undefined,
      consignee_address: data.consignee_address ?? undefined,
      notify_party_name: data.notify_party ?? undefined,
      container_number: data.container_numbers?.[0] ?? undefined,
    };
  }

  /**
   * Detect carrier from sender email and content
   */
  private detectCarrier(senderEmail: string, content: string): string {
    const combined = `${senderEmail} ${content}`.toLowerCase();

    if (combined.includes('hapag') || combined.includes('hlag') || combined.includes('hlcu')) {
      return 'hapag-lloyd';
    }
    if (combined.includes('maersk') || combined.includes('maeu') || combined.includes('msku')) {
      return 'maersk';
    }
    if (combined.includes('cma-cgm') || combined.includes('cma cgm') || combined.includes('cmau')) {
      return 'cma-cgm';
    }
    if (combined.includes('msc') && !combined.includes('misc')) {
      return 'msc';
    }
    if (combined.includes('cosco') || combined.includes('cosu')) {
      return 'cosco';
    }

    return 'default';
  }

  // NOTE: extractWithAI method REMOVED - now using ShipmentExtractionService.extractFromContent()
  // This consolidates extraction logic into a single service for both cron and API paths

  /**
   * Process booking confirmation - CREATE or UPDATE shipment
   *
   * IMPORTANT: Only DIRECT carrier emails can CREATE new shipments.
   * However, forwarded emails with clear carrier branding (e.g., CMA CGM via pricing@intoglo.com)
   * can also create shipments if the PDF content confirms carrier origin.
   *
   * NOTE: Uses true_sender_email to detect carrier for emails via ops group
   * NOTE: Also accepts isCarrierEmail override for content-based detection
   */
  private async processBookingConfirmation(
    emailId: string,
    data: ExtractedBookingData,
    carrier: string,
    trueSenderEmail: string | null,
    senderEmail: string,
    isCarrierEmailOverride?: boolean
  ): Promise<{ shipmentId?: string; fieldsUpdated: number }> {
    const bookingNumber = data.booking_number;
    if (!bookingNumber) {
      return { fieldsUpdated: 0 };
    }

    // Use override if provided, otherwise check sender domains
    const isDirectCarrier = isCarrierEmailOverride !== undefined
      ? isCarrierEmailOverride
      : this.isDirectCarrierEmail(trueSenderEmail, senderEmail);

    // Check if shipment exists
    const { data: existing } = await this.supabase
      .from('shipments')
      .select('id')
      .eq('booking_number', bookingNumber)
      .single();

    const carrierId = this.carrierIdMap.get(carrier) || this.carrierIdMap.get(data.carrier?.toLowerCase() || '');

    const shipmentData: Record<string, any> = {};
    let fieldsUpdated = 0;

    // Build update/insert data
    if (carrierId) { shipmentData.carrier_id = carrierId; fieldsUpdated++; }
    if (data.vessel_name) { shipmentData.vessel_name = data.vessel_name; fieldsUpdated++; }
    if (data.voyage_number) { shipmentData.voyage_number = data.voyage_number; fieldsUpdated++; }
    if (data.etd) { shipmentData.etd = data.etd; fieldsUpdated++; }
    if (data.eta) { shipmentData.eta = data.eta; fieldsUpdated++; }
    if (data.port_of_loading) { shipmentData.port_of_loading = data.port_of_loading; fieldsUpdated++; }
    if (data.port_of_loading_code) { shipmentData.port_of_loading_code = data.port_of_loading_code; }
    if (data.port_of_discharge) { shipmentData.port_of_discharge = data.port_of_discharge; fieldsUpdated++; }
    if (data.port_of_discharge_code) { shipmentData.port_of_discharge_code = data.port_of_discharge_code; }
    if (data.final_destination) { shipmentData.final_destination = data.final_destination; }
    if (data.si_cutoff) { shipmentData.si_cutoff = data.si_cutoff; fieldsUpdated++; }
    if (data.vgm_cutoff) { shipmentData.vgm_cutoff = data.vgm_cutoff; fieldsUpdated++; }
    if (data.cargo_cutoff) { shipmentData.cargo_cutoff = data.cargo_cutoff; fieldsUpdated++; }
    if (data.gate_cutoff) { shipmentData.gate_cutoff = data.gate_cutoff; fieldsUpdated++; }
    if (data.doc_cutoff) { shipmentData.doc_cutoff = data.doc_cutoff; fieldsUpdated++; }
    // NOTE: Do NOT set shipper_name/consignee_name from booking_confirmation
    // Booking confirmations (MBL level) have Intoglo as shipper
    // Real customer stakeholders come from HBL/SI documents
    if (data.container_number) { shipmentData.container_number_primary = data.container_number; }

    shipmentData.updated_at = new Date().toISOString();

    if (existing) {
      // UPDATE existing shipment (both direct and forwarded can update)
      await this.supabase
        .from('shipments')
        .update(shipmentData)
        .eq('id', existing.id);

      // Link email to shipment
      await this.linkEmailToShipment(emailId, existing.id, 'booking_confirmation');

      return { shipmentId: existing.id, fieldsUpdated };
    } else if (isDirectCarrier) {
      // CREATE new shipment - from direct carrier emails OR forwarded emails with carrier content
      console.log(`[Orchestrator] Creating new shipment for booking ${bookingNumber} from ${carrier}`);
      shipmentData.booking_number = bookingNumber;
      shipmentData.created_from_email_id = emailId;
      shipmentData.workflow_state = 'booking_confirmed';
      shipmentData.workflow_phase = 'pre_carriage';
      shipmentData.is_direct_carrier_confirmed = true; // Mark as confirmed for dashboard visibility

      const { data: newShipment, error } = await this.supabase
        .from('shipments')
        .insert(shipmentData)
        .select('id')
        .single();

      if (error) {
        console.error(`[Orchestrator] Failed to create shipment for ${bookingNumber}:`, error);
        return { fieldsUpdated: 0 };
      }

      if (newShipment) {
        console.log(`[Orchestrator] Created shipment ${newShipment.id} for booking ${bookingNumber}`);
        // Link email to newly created shipment
        await this.linkEmailToShipment(emailId, newShipment.id, 'booking_confirmation');

        // AUTO-BACKFILL: Link any related emails that arrived before this shipment was created
        // This finds forwarded emails with matching booking#, BL#, or container# and links them
        try {
          const backfillResult = await this.backfillService.linkRelatedEmails(newShipment.id);
          if (backfillResult.emails_linked > 0) {
            console.log(`[Orchestrator] Auto-backfill: Linked ${backfillResult.emails_linked} related emails to new shipment ${newShipment.id}`);
          }
        } catch (backfillError) {
          // Don't fail the whole process if backfill fails
          console.error(`[Orchestrator] Auto-backfill failed for shipment ${newShipment.id}:`, backfillError);
        }
      }

      return { shipmentId: newShipment?.id, fieldsUpdated };
    } else {
      // NOT direct carrier and no existing shipment - just store entities, don't create
      // The direct carrier email may arrive later and create the shipment
      console.log(`[Orchestrator] Booking ${bookingNumber} from forward - no shipment created (waiting for direct carrier email)`);
      await this.storeEntitiesForLaterLinking(emailId, data);
      return { fieldsUpdated: 0 };
    }
  }

  /**
   * Link email to shipment via shipment_documents table
   */
  private async linkEmailToShipment(
    emailId: string,
    shipmentId: string,
    documentType: string
  ): Promise<void> {
    // Upsert to avoid duplicates
    await this.supabase
      .from('shipment_documents')
      .upsert({
        email_id: emailId,
        shipment_id: shipmentId,
        document_type: documentType,
        created_at: new Date().toISOString()
      }, { onConflict: 'email_id,shipment_id' });
  }

  /**
   * Store entities for forwarded emails that arrive before direct carrier email
   * These can be linked later when the direct carrier email creates the shipment
   */
  private async storeEntitiesForLaterLinking(
    emailId: string,
    data: ExtractedBookingData
  ): Promise<void> {
    const entities: { email_id: string; entity_type: string; entity_value: string; confidence_score: number }[] = [];

    if (data.booking_number) {
      entities.push({ email_id: emailId, entity_type: 'booking_number', entity_value: data.booking_number, confidence_score: 90 });
    }
    if (data.vessel_name) {
      entities.push({ email_id: emailId, entity_type: 'vessel_name', entity_value: data.vessel_name, confidence_score: 85 });
    }
    if (data.voyage_number) {
      entities.push({ email_id: emailId, entity_type: 'voyage_number', entity_value: data.voyage_number, confidence_score: 85 });
    }
    if (data.etd) {
      entities.push({ email_id: emailId, entity_type: 'etd', entity_value: data.etd, confidence_score: 85 });
    }
    if (data.eta) {
      entities.push({ email_id: emailId, entity_type: 'eta', entity_value: data.eta, confidence_score: 85 });
    }
    if (data.port_of_loading) {
      entities.push({ email_id: emailId, entity_type: 'port_of_loading', entity_value: data.port_of_loading, confidence_score: 85 });
    }
    if (data.port_of_discharge) {
      entities.push({ email_id: emailId, entity_type: 'port_of_discharge', entity_value: data.port_of_discharge, confidence_score: 85 });
    }

    if (entities.length > 0) {
      await this.supabase
        .from('entity_extractions')
        .upsert(entities, { onConflict: 'email_id,entity_type' });
    }
  }

  /**
   * Process booking amendment - UPDATE existing shipment
   */
  private async processAmendment(
    emailId: string,
    data: ExtractedBookingData
  ): Promise<{ shipmentId?: string; fieldsUpdated: number }> {
    const bookingNumber = data.booking_number;
    if (!bookingNumber) {
      return { fieldsUpdated: 0 };
    }

    const { data: existing } = await this.supabase
      .from('shipments')
      .select('*')
      .eq('booking_number', bookingNumber)
      .single();

    if (!existing) {
      return { fieldsUpdated: 0 };
    }

    // Track changes for revision
    const changedFields: Record<string, { old: any; new: any }> = {};
    const updates: Record<string, any> = {};

    const fieldsToCheck = [
      'vessel_name', 'voyage_number', 'etd', 'eta',
      'port_of_loading', 'port_of_discharge',
      'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff'
    ];

    for (const field of fieldsToCheck) {
      const newValue = (data as any)[field];
      const oldValue = existing[field];
      if (newValue && newValue !== oldValue) {
        changedFields[field] = { old: oldValue, new: newValue };
        updates[field] = newValue;
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      updates.booking_revision_count = (existing.booking_revision_count || 0) + 1;

      // Update shipment
      await this.supabase
        .from('shipments')
        .update(updates)
        .eq('id', existing.id);

      // Create revision record
      await this.supabase.from('booking_revisions').insert({
        shipment_id: existing.id,
        revision_number: updates.booking_revision_count,
        changed_fields: changedFields,
        source_email_id: emailId,
        created_at: new Date().toISOString()
      });
    }

    return { shipmentId: existing.id, fieldsUpdated: Object.keys(updates).length };
  }

  /**
   * Link email to existing shipment (for non-booking documents)
   */
  private async linkToExistingShipment(
    emailId: string,
    data: ExtractedBookingData,
    documentType?: string
  ): Promise<{ shipmentId?: string }> {
    // Try multiple identifier types: booking → MBL → HBL → container
    let shipment: { id: string } | null = null;
    let matchedBy: string | null = null;

    // 1. Try booking number first (from extraction)
    if (data.booking_number) {
      const { data: match } = await this.supabase
        .from('shipments')
        .select('id')
        .eq('booking_number', data.booking_number)
        .single();
      if (match) {
        shipment = match;
        matchedBy = `booking:${data.booking_number}`;
      }
    }

    // 2. If no match, get entities from database for this email
    if (!shipment) {
      const { data: entities } = await this.supabase
        .from('entity_extractions')
        .select('entity_type, entity_value')
        .eq('email_id', emailId);

      if (entities && entities.length > 0) {
        // Try MBL/BL number
        const blEntities = entities.filter(e =>
          e.entity_type === 'mbl_number' || e.entity_type === 'bl_number'
        );
        for (const e of blEntities) {
          if (!e.entity_value) continue;
          const { data: match } = await this.supabase
            .from('shipments')
            .select('id')
            .eq('mbl_number', e.entity_value.toUpperCase())
            .single();
          if (match) {
            shipment = match;
            matchedBy = `mbl:${e.entity_value}`;
            break;
          }
        }

        // Try HBL number
        if (!shipment) {
          const hblEntities = entities.filter(e => e.entity_type === 'hbl_number');
          for (const e of hblEntities) {
            if (!e.entity_value) continue;
            const { data: match } = await this.supabase
              .from('shipments')
              .select('id')
              .eq('hbl_number', e.entity_value.toUpperCase())
              .single();
            if (match) {
              shipment = match;
              matchedBy = `hbl:${e.entity_value}`;
              break;
            }
          }
        }

        // Try container number
        if (!shipment) {
          const containerEntities = entities.filter(e => e.entity_type === 'container_number');
          for (const e of containerEntities) {
            if (!e.entity_value) continue;
            // Check container_numbers array
            const { data: match } = await this.supabase
              .from('shipments')
              .select('id')
              .contains('container_numbers', [e.entity_value.toUpperCase()])
              .limit(1);
            if (match && match.length > 0) {
              shipment = match[0];
              matchedBy = `container:${e.entity_value}`;
              break;
            }
          }
        }
      }
    }

    // No shipment found
    if (!shipment) {
      return {};
    }

    const existing = shipment;
    if (matchedBy) {
      console.log(`[Orchestrator] Matched email ${emailId.substring(0, 8)} via ${matchedBy}`);
    }

    if (existing) {
      // Update stakeholders ONLY from HBL and SI Draft (these have real customer info)
      // NOT from: bill_of_lading (MBL), bl_draft, shipping_instruction, si_submission
      const stakeholderDocTypes = ['si_draft', 'hbl_draft', 'hbl'];
      if (documentType && stakeholderDocTypes.includes(documentType)) {
        const updateData: Record<string, string> = {};

        if (data.shipper_name) {
          updateData.shipper_name = data.shipper_name;
        }
        if (data.consignee_name) {
          updateData.consignee_name = data.consignee_name;
        }
        if (data.shipper_address) {
          updateData.shipper_address = data.shipper_address;
        }
        if (data.consignee_address) {
          updateData.consignee_address = data.consignee_address;
        }
        if (data.notify_party_name) {
          updateData.notify_party_name = data.notify_party_name;
        }
        if (data.notify_party_address) {
          updateData.notify_party_address = data.notify_party_address;
        }

        if (Object.keys(updateData).length > 0) {
          updateData.updated_at = new Date().toISOString();
          await this.supabase
            .from('shipments')
            .update(updateData)
            .eq('id', existing.id);

          console.log(`[Orchestrator] Updated stakeholders from ${documentType} for shipment ${existing.id}`);
        }
      }

      // CRITICAL: Link email to shipment in shipment_documents table
      // This was missing - documents were found but not linked!
      if (documentType) {
        await this.linkEmailToShipment(emailId, existing.id, documentType);
        console.log(`[Orchestrator] Linked ${documentType} email to shipment ${existing.id}`);
      }

      return { shipmentId: existing.id };
    }

    return {};
  }

  /**
   * Extract stakeholders and link to shipment (shipper_id, consignee_id)
   */
  private async extractAndLinkStakeholders(
    shipmentId: string,
    data: ExtractedBookingData,
    documentType?: string
  ): Promise<void> {
    // Build document entities from extracted data
    const entities: DocumentEntity = {};

    if (data.shipper_name) {
      entities.shipper = { name: data.shipper_name };
    }
    if (data.consignee_name) {
      entities.consignee = { name: data.consignee_name };
    }

    // Skip if no shipper or consignee found
    if (!entities.shipper && !entities.consignee) {
      return;
    }

    // Get shipment to determine direction
    const { data: shipment } = await this.supabase
      .from('shipments')
      .select('port_of_loading_code')
      .eq('id', shipmentId)
      .single();

    // Determine direction: if POL is in India, it's export
    const direction: ShipmentDirection =
      shipment?.port_of_loading_code?.startsWith('IN') ? 'export' : 'import';

    // Map to stakeholder document type
    const docType = this.mapToStakeholderDocType(documentType);

    // Extract stakeholders using service
    const result = await this.stakeholderService.extractFromDocument(
      entities,
      docType,
      direction,
      shipmentId
    );

    // Link extracted parties to shipment
    const allParties = [...result.created, ...result.matched];
    for (const party of allParties) {
      if (party.party_type === 'shipper') {
        await this.supabase
          .from('shipments')
          .update({ shipper_id: party.id })
          .eq('id', shipmentId);
      } else if (party.party_type === 'consignee') {
        await this.supabase
          .from('shipments')
          .update({ consignee_id: party.id })
          .eq('id', shipmentId);
      }
    }
  }

  /**
   * Map document type to stakeholder document type
   */
  private mapToStakeholderDocType(docType?: string): 'booking_confirmation' | 'hbl' | 'si_draft' | 'arrival_notice' {
    switch (docType) {
      case 'booking_confirmation':
      case 'booking_amendment':
        return 'booking_confirmation';
      case 'bill_of_lading':
      case 'bl_draft':
      case 'hbl_draft':
        return 'hbl';
      case 'shipping_instruction':
      case 'si_draft':
      case 'si_submission':
        return 'si_draft';
      case 'arrival_notice':
        return 'arrival_notice';
      default:
        return 'booking_confirmation';
    }
  }

  /**
   * Create document lifecycle record for tracking
   */
  private async createDocumentLifecycle(
    shipmentId: string,
    documentType: string,
    data: ExtractedBookingData | null
  ): Promise<void> {
    // Build extracted fields for quality scoring
    const extractedFields: Record<string, unknown> = {};

    if (data) {
      if (data.booking_number) extractedFields.booking_number = data.booking_number;
      if (data.vessel_name) extractedFields.vessel_name = data.vessel_name;
      if (data.voyage_number) extractedFields.voyage_number = data.voyage_number;
      if (data.port_of_loading) extractedFields.port_of_loading = data.port_of_loading;
      if (data.port_of_discharge) extractedFields.port_of_discharge = data.port_of_discharge;
      if (data.etd) extractedFields.etd = data.etd;
      if (data.eta) extractedFields.eta = data.eta;
      if (data.shipper_name) extractedFields.shipper_name = data.shipper_name;
      if (data.consignee_name) extractedFields.consignee_name = data.consignee_name;
      if (data.container_number) extractedFields.container_numbers = [data.container_number];
    }

    // Create lifecycle record
    await this.lifecycleService.createLifecycleForDocument(
      shipmentId,
      documentType,
      { extractedFields }
    );
  }

  /**
   * Process batch of emails
   */
  async processBatch(emailIds: string[], onProgress?: (processed: number, total: number) => void): Promise<ProcessingResult[]> {
    const results: ProcessingResult[] = [];

    for (let i = 0; i < emailIds.length; i++) {
      const result = await this.processEmail(emailIds[i]);
      results.push(result);

      if (onProgress) {
        onProgress(i + 1, emailIds.length);
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, 200));
    }

    return results;
  }

  /**
   * Get emails needing processing (classified but not extracted)
   */
  async getEmailsNeedingProcessing(limit: number = 100): Promise<string[]> {
    const { data } = await this.supabase
      .from('raw_emails')
      .select('id')
      .in('processing_status', ['classified', 'pending'])
      .limit(limit);

    return data?.map(e => e.id) || [];
  }
}

export default EmailProcessingOrchestrator;
