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
import { DocumentRevisionService } from './document-revision-service';
import { BackfillService } from './shipment-linking/backfill-service';
import {
  ClassificationOrchestrator,
  createClassificationOrchestrator,
  ClassificationOutput,
} from './classification';
// NOTE: ShipmentExtractionService (AI) DEPRECATED - now using UnifiedExtractionService (regex/schema)
// Cost savings: ~$0.002/email → $0/email
import { WorkflowStateService } from './workflow-state-service';
import {
  EnhancedWorkflowStateService,
  WorkflowTransitionInput,
} from './enhanced-workflow-state-service';
import {
  ShipmentRepository,
  EntityRepository,
  ClassificationRepository,
  ShipmentDocumentRepository,
} from '@/lib/repositories';
import { EntityType, ExtractionMethod, DocumentType } from '@/types/email-intelligence';
import { createUnifiedExtractionService, UnifiedExtractionService } from './extraction';

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
  notify_party_address?: string;  // For unified extraction mapping
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
  private documentRevisionService: DocumentRevisionService;
  private backfillService: BackfillService;
  private classificationOrchestrator: ClassificationOrchestrator;
  // NOTE: extractionService (AI) DEPRECATED - using unifiedExtractionService instead
  private workflowService: WorkflowStateService;
  private enhancedWorkflowService: EnhancedWorkflowStateService;
  private unifiedExtractionService: UnifiedExtractionService;
  // Repositories (follow repository pattern)
  private shipmentRepository: ShipmentRepository;
  private entityRepository: EntityRepository;
  private classificationRepository: ClassificationRepository;
  private shipmentDocumentRepository: ShipmentDocumentRepository;

  constructor(supabaseUrl: string, supabaseKey: string, _anthropicKey?: string) {
    // NOTE: anthropicKey no longer required - AI extraction deprecated in favor of schema/regex
    this.supabase = createClient(supabaseUrl, supabaseKey);
    // Initialize repositories
    this.shipmentRepository = new ShipmentRepository(this.supabase);
    this.entityRepository = new EntityRepository(this.supabase);
    this.classificationRepository = new ClassificationRepository(this.supabase);
    this.shipmentDocumentRepository = new ShipmentDocumentRepository(this.supabase);
    // Initialize services
    this.stakeholderService = new StakeholderExtractionService(this.supabase);
    this.lifecycleService = new DocumentLifecycleService(this.supabase);
    this.documentRevisionService = new DocumentRevisionService(this.supabase);
    this.backfillService = new BackfillService(this.supabase);
    // New parallel classification orchestrator (document type + email type)
    this.classificationOrchestrator = createClassificationOrchestrator();
    // Initialize workflow service for auto-transitioning states when documents are linked
    this.workflowService = new WorkflowStateService(this.supabase);
    // Enhanced workflow service with dual-trigger support (document type + email type)
    this.enhancedWorkflowService = new EnhancedWorkflowStateService(this.supabase);
    // Unified extraction service (schema + regex based) - $0 cost vs AI $0.002/email
    this.unifiedExtractionService = createUnifiedExtractionService(this.supabase);
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
      // Hoist classificationResult for use in workflow transitions later
      let classificationResult: ClassificationOutput | undefined;

      if (!classification) {
        console.log(`[Orchestrator] No classification for email ${emailId.substring(0, 8)}... - classifying now`);

        // Get attachment filenames and PDF content for classification
        const { data: attachments } = await this.supabase
          .from('raw_attachments')
          .select('filename, extracted_text')
          .eq('email_id', emailId);

        const attachmentFilenames = attachments?.map(a => a.filename).filter(Boolean) || [];
        const pdfContentForClassification = attachments
          ?.filter(a => a.extracted_text && a.extracted_text.length > 50)
          .map(a => a.extracted_text)
          .join('\n\n') || '';

        // Classify using new parallel ClassificationOrchestrator
        // Returns both document type AND email type in a single pass
        classificationResult = this.classificationOrchestrator.classify({
          subject: email.subject || '',
          senderEmail: email.sender_email || '',
          senderName: email.sender_name || undefined,
          trueSenderEmail: email.true_sender_email || null,
          bodyText: email.body_text || '',
          attachmentFilenames,
          pdfContent: pdfContentForClassification || undefined,
        });

        documentType = classificationResult.documentType;
        classificationConfidence = classificationResult.documentConfidence;

        // Log parallel classification results
        console.log(`[Orchestrator] Classified - Document: ${documentType} (${classificationConfidence}%), Email Type: ${classificationResult.emailType} (${classificationResult.emailTypeConfidence}%), Sentiment: ${classificationResult.sentiment}${classificationResult.isUrgent ? ' [URGENT]' : ''}`);

        // Save classification to database
        await this.saveClassificationResult(emailId, classificationResult);

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

      // 5. Extract data using UnifiedExtractionService (schema + regex based, $0 cost)
      // NOTE: AI extraction (ShipmentExtractionService) DEPRECATED for cost savings
      const pdfContent = await this.getPdfContent(emailId);

      // Get first PDF attachment ID for document extraction
      const { data: pdfAttachments } = await this.supabase
        .from('raw_attachments')
        .select('id, extracted_text')
        .eq('email_id', emailId)
        .not('extracted_text', 'is', null)
        .limit(1);

      const pdfAttachment = pdfAttachments?.[0];

      const unifiedResult = await this.unifiedExtractionService.extract({
        emailId,
        attachmentId: pdfAttachment?.id,
        documentType: documentType || 'unknown',
        emailSubject: email.subject || '',
        emailBody: email.body_text || '',
        pdfContent: pdfAttachment?.extracted_text || pdfContent,
        carrier,
      });

      console.log(`[Orchestrator] Unified extraction: ${unifiedResult.emailExtractions} email, ${unifiedResult.documentExtractions} doc entities (confidence: ${unifiedResult.schemaConfidence})`);

      // Map unified extraction results to ExtractedBookingData for downstream processing
      const extractedData = this.mapUnifiedToExtractedBookingData(unifiedResult.entities, carrier);

      // NOTE: storeExtractedEntities() REMOVED - UnifiedExtractionService already saves to
      // email_extractions and document_extractions tables. Linking now uses those tables.

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
          isCarrierEmail,  // Pass content-based detection result
          classificationResult,
          email.subject
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
        // Pass classificationResult for dual-trigger workflow transitions
        const result = await this.linkToExistingShipment(
          emailId,
          extractedData,
          documentType,
          classificationResult,
          email.subject
        );
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
    if (/cma cgm website|cma cgm.*noreply|cma.cgm/i.test(senderLower)) {
      return true;
    }

    // Known COSCO patterns
    if (/coscon|cosco/i.test(senderLower)) {
      return true;
    }

    // Known ONE patterns
    if (/one-line|ocean network express/i.test(senderLower)) {
      return true;
    }

    // Known Evergreen patterns
    if (/evergreen/i.test(senderLower)) {
      return true;
    }

    // Known MSC patterns
    if (/\bmsc\b|mediterranean shipping/i.test(senderLower)) {
      return true;
    }

    // Known Yang Ming patterns
    if (/yang\s*ming|yml/i.test(senderLower)) {
      return true;
    }

    // Known ZIM patterns
    if (/\bzim\b/i.test(senderLower)) {
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
    entry_number?: string;
  } {
    const result: {
      booking_number?: string;
      container_number?: string;
      bl_number?: string;
      mbl_number?: string;
      hbl_number?: string;
      entry_number?: string;
    } = {};

    // Booking number patterns by carrier
    const bookingPatterns = [
      // Intoglo Deal ID format: SEINUS26112502782_I, SECNUS08122502815_I
      /\b([A-Z]{5,7}\d{8,12}_I)\b/,              // Intoglo Deal ID (priority - most specific)
      // Portside/Broker customer reference: "Cust. Ref. XXXX" or "CR#: XXXX"
      /(?:Cust\.?\s*Ref\.?|CR#):?\s*([A-Z0-9_]+)/i,
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
        // Skip if it looks like just a short code (e.g., "16" from "16/2025-26")
        if (match[1].length < 5) continue;
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

    // Entry number patterns (US Customs entry numbers)
    // Artemus format: "ENTRY 9JW-04219104" or "Entry 9JW- 04219062"
    // Portside format: "165-0625612-8" (from 165-0625612-8-7501)
    const entryPatterns = [
      /ENTRY\s*(\d{1,3}[A-Z]{1,3}[-\s]*\d{8})/i,   // Artemus: 9JW-04219104
      /\b(\d{3}-\d{7}-\d)(?:-\d{4})?\b/,            // Portside: 165-0625612-8
    ];

    for (const pattern of entryPatterns) {
      const entryMatch = subject.match(pattern);
      if (entryMatch && entryMatch[1]) {
        result.entry_number = entryMatch[1].replace(/\s+/g, '').toUpperCase();
        break;
      }
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

    // HBL patterns - Multiple formats from various brokers
    // Intoglo HBL format: SE1025002852 (SE + MMYY + sequence)
    // Artemus uses "HBL: SWLLUD000344" or "HBL NO.: MEDUJS569930"
    // Others use LUDSE0313, etc.
    const hblPatterns = [
      /HBL[#:\s]+([A-Z]{2}\d{10,})/i,            // HBL# SE1025002852 (Intoglo format)
      /\b(SE\d{10,})\b/i,                         // Standalone SE1025002852 (Intoglo HBL)
      /HBL(?:\s*NO\.?)?:?\s*([A-Z0-9]{6,})/i,    // Explicit HBL: or HBL NO.: prefix (Artemus)
      /\b(SWLLUD\d{6,})\b/i,                      // SWL HBL format
      /\b(LUDSE\d{4,})\b/i,                       // LUD HBL format
    ];

    for (const pattern of hblPatterns) {
      const hblMatch = subject.match(pattern);
      if (hblMatch && hblMatch[1]) {
        result.hbl_number = hblMatch[1].toUpperCase();
        break;
      }
    }

    return result;
  }

  // NOTE: storeExtractedEntities() REMOVED - UnifiedExtractionService now handles all extraction
  // and saves directly to email_extractions and document_extractions tables.
  // Shipment linking now queries email_extractions instead of entity_extractions.

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
   * Map unified extraction entities to ExtractedBookingData for downstream processing.
   * UnifiedExtractionService returns entities as Record<string, string>.
   * This maps them to the ExtractedBookingData structure used by linking/shipment creation.
   */
  private mapUnifiedToExtractedBookingData(
    entities: Record<string, string>,
    detectedCarrier: string
  ): ExtractedBookingData {
    return {
      carrier: entities.carrier || detectedCarrier || undefined,
      booking_number: entities.booking_number || undefined,
      vessel_name: entities.vessel_name || entities.vessel || undefined,
      voyage_number: entities.voyage_number || entities.voyage || undefined,
      etd: entities.etd || entities.departure_date || undefined,
      eta: entities.eta || entities.arrival_date || undefined,
      port_of_loading: entities.port_of_loading || entities.pol_name || undefined,
      port_of_loading_code: entities.port_of_loading_code || entities.pol_code || undefined,
      port_of_discharge: entities.port_of_discharge || entities.pod_name || undefined,
      port_of_discharge_code: entities.port_of_discharge_code || entities.pod_code || undefined,
      final_destination: entities.final_destination || entities.place_of_delivery || undefined,
      si_cutoff: entities.si_cutoff || undefined,
      vgm_cutoff: entities.vgm_cutoff || undefined,
      cargo_cutoff: entities.cargo_cutoff || undefined,
      gate_cutoff: entities.gate_cutoff || undefined,
      doc_cutoff: entities.doc_cutoff || undefined,
      shipper_name: entities.shipper_name || undefined,
      shipper_address: entities.shipper_address || undefined,
      consignee_name: entities.consignee_name || undefined,
      consignee_address: entities.consignee_address || undefined,
      notify_party_name: entities.notify_party_name || entities.notify_party || undefined,
      notify_party_address: entities.notify_party_address || undefined,
      container_number: entities.container_number || undefined,
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
    isCarrierEmailOverride?: boolean,
    classificationResult?: ClassificationOutput,
    emailSubject?: string
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
      await this.shipmentRepository.update(existing.id, shipmentData);

      // Link email to shipment with enhanced workflow transition
      await this.linkEmailToShipment(emailId, existing.id, 'booking_confirmation', classificationResult, emailSubject);

      return { shipmentId: existing.id, fieldsUpdated };
    } else if (isDirectCarrier) {
      // CREATE new shipment - from direct carrier emails OR forwarded emails with carrier content
      console.log(`[Orchestrator] Creating new shipment for booking ${bookingNumber} from ${carrier}`);

      try {
        const newShipment = await this.shipmentRepository.create({
          ...shipmentData,
          booking_number: bookingNumber,
          created_from_email_id: emailId,
          workflow_state: 'booking_confirmation_received',
          workflow_phase: 'pre_departure',
          is_direct_carrier_confirmed: true, // Mark as confirmed for dashboard visibility
        });

        console.log(`[Orchestrator] Created shipment ${newShipment.id} for booking ${bookingNumber}`);

        // Link email to newly created shipment with enhanced workflow transition
        await this.linkEmailToShipment(emailId, newShipment.id, 'booking_confirmation', classificationResult, emailSubject);

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

        return { shipmentId: newShipment.id, fieldsUpdated };
      } catch (error) {
        console.error(`[Orchestrator] Failed to create shipment for ${bookingNumber}:`, error);
        return { fieldsUpdated: 0 };
      }
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
   * Also triggers workflow state transition based on document type + email type
   *
   * When classificationResult is provided, uses the enhanced dual-trigger workflow service
   * that considers both document type AND email type for state transitions.
   */
  private async linkEmailToShipment(
    emailId: string,
    shipmentId: string,
    documentType: string,
    classificationResult?: ClassificationOutput,
    emailSubject?: string
  ): Promise<void> {
    // Use ShipmentDocumentRepository (handles idempotent upsert)
    await this.shipmentDocumentRepository.create({
      email_id: emailId,
      shipment_id: shipmentId,
      document_type: documentType,
    });

    // Auto-transition workflow state
    try {
      // Use enhanced workflow service when classification result is available
      // This enables dual-trigger transitions (document type OR email type)
      if (classificationResult && emailSubject) {
        const transitionInput: WorkflowTransitionInput = {
          shipmentId,
          documentType: classificationResult.documentType,
          emailType: classificationResult.emailType,
          direction: classificationResult.direction,
          senderCategory: classificationResult.senderCategory,
          emailId,
          subject: emailSubject,
        };

        const result = await this.enhancedWorkflowService.transitionFromClassification(transitionInput);

        if (result.success) {
          console.log(`[Orchestrator] Enhanced workflow transition: ${result.previousState} → ${result.newState} (triggered by: ${result.triggeredBy})`);
        } else if (result.skippedReason) {
          console.log(`[Orchestrator] Workflow transition skipped: ${result.skippedReason}`);
        }
      } else {
        // Fallback to original document-only workflow service
        await this.workflowService.autoTransitionFromDocument(
          shipmentId,
          documentType,
          emailId
        );
      }
    } catch (error) {
      console.error(`[Orchestrator] Failed to transition workflow for ${shipmentId}:`, error);
      // Don't throw - document is still linked, workflow transition is secondary
    }
  }

  /**
   * Store entities for forwarded emails that arrive before direct carrier email
   * These can be linked later when the direct carrier email creates the shipment
   * NOW USES: email_extractions table (migrated from entity_extractions)
   */
  private async storeEntitiesForLaterLinking(
    emailId: string,
    data: ExtractedBookingData
  ): Promise<void> {
    const entities: {
      email_id: string;
      entity_type: string;
      entity_value: string;
      confidence_score: number;
      extraction_method: string;
      source_field: string;
    }[] = [];

    const addEntity = (type: string, value: string | undefined, confidence: number) => {
      if (value) {
        entities.push({
          email_id: emailId,
          entity_type: type,
          entity_value: value,
          confidence_score: confidence,
          extraction_method: 'schema',
          source_field: 'body_text',
        });
      }
    };

    addEntity('booking_number', data.booking_number, 90);
    addEntity('vessel_name', data.vessel_name, 85);
    addEntity('voyage_number', data.voyage_number, 85);
    addEntity('etd', data.etd, 85);
    addEntity('eta', data.eta, 85);
    addEntity('port_of_loading', data.port_of_loading, 85);
    addEntity('port_of_discharge', data.port_of_discharge, 85);
    addEntity('container_number', data.container_number, 85);

    if (entities.length > 0) {
      // Use email_extractions table (NEW) instead of entity_extractions (OLD)
      await this.supabase
        .from('email_extractions')
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

      // Update shipment
      await this.shipmentRepository.update(existing.id, updates);

      // Register revision using DocumentRevisionService (handles revision tracking)
      await this.documentRevisionService.registerRevision(
        existing.id,
        'booking_confirmation',
        emailId,
        {
          extracted_entities: changedFields as unknown as Record<string, string>,
        }
      );
    }

    return { shipmentId: existing.id, fieldsUpdated: Object.keys(updates).length };
  }

  /**
   * Link email to existing shipment (for non-booking documents)
   * When classificationResult is provided, enables dual-trigger workflow transitions
   */
  private async linkToExistingShipment(
    emailId: string,
    data: ExtractedBookingData,
    documentType?: string,
    classificationResult?: ClassificationOutput,
    emailSubject?: string
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

    // 2. If no match, get entities from NEW email_extractions table
    if (!shipment) {
      const { data: entities } = await this.supabase
        .from('email_extractions')
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

    // No shipment found - create orphan document for later linking
    if (!shipment) {
      if (documentType) {
        // Get the booking number from entities or extracted data for logging
        const bookingRef = data.booking_number || 'unknown';
        console.log(`[Orchestrator] No shipment found for ${documentType} (booking: ${bookingRef}) - creating orphan document`);
        await this.createOrphanDocument(emailId, documentType, data);
      }
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

        // Helper to check if value is Intoglo (our own company, not a real customer)
        const isIntoglo = (name: string | null | undefined): boolean => {
          if (!name) return false;
          const lower = name.toLowerCase();
          return lower.includes('intoglo');
        };

        if (data.shipper_name && !isIntoglo(data.shipper_name)) {
          updateData.shipper_name = data.shipper_name;
        }
        if (data.consignee_name && !isIntoglo(data.consignee_name)) {
          updateData.consignee_name = data.consignee_name;
        }
        if (data.shipper_address && !isIntoglo(data.shipper_name)) {
          updateData.shipper_address = data.shipper_address;
        }
        if (data.consignee_address && !isIntoglo(data.consignee_name)) {
          updateData.consignee_address = data.consignee_address;
        }
        if (data.notify_party_name && !isIntoglo(data.notify_party_name)) {
          updateData.notify_party_name = data.notify_party_name;
        }
        if (data.notify_party_address && !isIntoglo(data.notify_party_name)) {
          updateData.notify_party_address = data.notify_party_address;
        }

        if (Object.keys(updateData).length > 0) {
          updateData.updated_at = new Date().toISOString();
          await this.shipmentRepository.update(existing.id, updateData);

          console.log(`[Orchestrator] Updated stakeholders from ${documentType} for shipment ${existing.id}`);
        }
      }

      // CRITICAL: Link email to shipment in shipment_documents table
      // This was missing - documents were found but not linked!
      if (documentType) {
        await this.linkEmailToShipment(emailId, existing.id, documentType, classificationResult, emailSubject);
        console.log(`[Orchestrator] Linked ${documentType} email to shipment ${existing.id}`);
      }

      return { shipmentId: existing.id };
    }

    return {};
  }

  /**
   * Create orphan document for emails that don't have a matching shipment
   * These documents can be linked later when the shipment is created via backfill
   *
   * Why this matters:
   * - Broker/trucking emails often arrive before or without direct carrier booking
   * - Entry summaries, duty invoices, PODs need to be tracked even without shipment link
   * - Backfill service can later link these when shipment is found/created
   */
  private async createOrphanDocument(
    emailId: string,
    documentType: string,
    data: ExtractedBookingData
  ): Promise<void> {
    try {
      // Use ShipmentDocumentRepository for orphan document creation (handles idempotency)
      await this.shipmentDocumentRepository.createOrphan({
        emailId,
        documentType,
        bookingNumberExtracted: data.booking_number,
      });

      console.log(`[Orchestrator] Created orphan document: ${documentType} (booking: ${data.booking_number || 'none'})`);
    } catch (error) {
      // Don't fail the process, just log
      console.error(`[Orchestrator] Failed to create orphan document for ${emailId}:`, error instanceof Error ? error.message : 'Unknown error');
    }
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
        await this.shipmentRepository.update(shipmentId, { shipper_id: party.id });
      } else if (party.party_type === 'consignee') {
        await this.shipmentRepository.update(shipmentId, { consignee_id: party.id });
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
   * Save classification result to database.
   * Stores both document type and email type classification (parallel system).
   */
  private async saveClassificationResult(
    emailId: string,
    result: ClassificationOutput
  ): Promise<void> {
    // Build metadata for classification record
    const metadata: Record<string, unknown> = {
      // Document classification details
      documentMethod: result.documentMethod,
      documentSource: result.documentSource,
      documentMatchedMarkers: result.documentMatchedMarkers,
      documentMatchedPattern: result.documentMatchedPattern,

      // Email type classification (parallel)
      emailType: result.emailType,
      emailCategory: result.emailCategory,
      emailTypeConfidence: result.emailTypeConfidence,
      emailMatchedPatterns: result.emailMatchedPatterns,

      // Sender & direction
      senderCategory: result.senderCategory,
      direction: result.direction,
      trueSender: result.trueSender,
      directionConfidence: result.directionConfidence,

      // Thread context
      isThreadReply: result.isThreadReply,
      threadDepth: result.threadContext.threadDepth,
      isForward: result.threadContext.isForward,

      // Workflow state
      documentWorkflowState: result.documentWorkflowState,
    };

    // Use ClassificationRepository for idempotent upsert
    await this.classificationRepository.upsert({
      email_id: emailId,
      document_type: result.documentType as DocumentType,
      confidence_score: result.documentConfidence,
      classification_method: result.documentMethod,
      classification_metadata: metadata,
      needs_manual_review: result.needsManualReview,
      created_at: new Date().toISOString(),
    });
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
