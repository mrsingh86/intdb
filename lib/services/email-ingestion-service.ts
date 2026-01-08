/**
 * Email Ingestion Service
 *
 * Comprehensive service for processing shipping emails through the full pipeline:
 * 1. Fetch raw email from Gmail/Database
 * 2. Check idempotency (skip if already processed)
 * 3. Classify document type (with sub-classification and multi-label)
 * 4. Extract all entities (comprehensive)
 * 5. Link to existing shipment or create new
 * 5a. Check document prerequisites & create alerts for missing docs
 * 6. Extract and link stakeholders (shipper/consignee to parties table)
 * 7. Create document lifecycle entry (track status & quality)
 * 8. Update processing status
 *
 * Principles:
 * - Deep Module: Simple ingestEmail() interface, complex implementation
 * - Single Responsibility: Orchestrates pipeline, delegates to specialized services
 * - Fail Fast: Validates at each stage
 * - Database-Driven: Stores all data for audit trail
 * - Idempotent: Safe to run multiple times on same email
 */

import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { ShipmentExtractionService, ShipmentData } from './shipment-extraction-service';
import { PdfExtractorFactory } from './enhanced-pdf-extractor';
import { DocumentLifecycleService } from './document-lifecycle-service';
import { StakeholderExtractionService, DocumentEntity, ShipmentDirection } from './stakeholder-extraction-service';
import { parseEntityDate } from '../utils/date-parser';
import {
  ClassificationOrchestrator,
  createClassificationOrchestrator,
  ClassificationOutput,
} from './classification';
import { ShipmentRepository } from '@/lib/repositories';

// ============================================================================
// Types
// ============================================================================

export interface RawEmail {
  id: string;
  gmail_message_id: string;
  thread_id: string;
  subject: string;
  sender_email: string;
  body_text: string;
  body_html?: string;
  snippet: string;
  received_at: string;
  has_attachments: boolean;
  attachment_count?: number;
}

export interface Classification {
  document_type: DocumentType;
  sub_type?: DocumentSubType;
  confidence_score: number;
  labels: string[]; // Multi-label support
  carrier_detected: string | null;
  is_automated: boolean;
  classification_reason: string;
}

export type DocumentType =
  | 'booking_confirmation'
  | 'booking_amendment'
  | 'arrival_notice'
  | 'bill_of_lading'
  | 'shipping_instruction'
  | 'invoice'
  | 'delivery_order'
  | 'cargo_manifest'
  | 'customs_document'
  | 'rate_confirmation'
  | 'vessel_schedule'
  | 'container_release'
  | 'freight_invoice'
  | 'vgm_submission'
  | 'si_submission'
  | 'unknown'
  | 'not_shipping';

export type DocumentSubType =
  | 'original'
  | 'amendment'
  | 'update'
  | 'cancellation'
  | 'draft'
  | 'final'
  | 'copy';

export interface Entity {
  type: string;
  value: string;
  confidence: number;
  source: 'email_body' | 'pdf_attachment' | 'subject';
}

export interface IngestResult {
  success: boolean;
  emailId: string;
  classification?: Classification;
  entities: Entity[];
  shipmentId?: string;
  shipmentAction?: 'created' | 'updated' | 'linked' | 'none';
  fieldsExtracted: number;
  processingTime: number;
  error?: string;
}

export interface ProcessingOptions {
  skipClassification?: boolean;
  skipEntityExtraction?: boolean;
  skipShipmentLinking?: boolean;
  forceReprocess?: boolean;
  useAdvancedModel?: boolean;
}

// ============================================================================
// Main Service
// ============================================================================

export class EmailIngestionService {
  private supabase: SupabaseClient;
  private anthropic: Anthropic;
  private extractionService: ShipmentExtractionService;
  private pdfExtractor: PdfExtractorFactory;
  private documentLifecycleService: DocumentLifecycleService;
  private stakeholderService: StakeholderExtractionService;
  private classificationOrchestrator: ClassificationOrchestrator;
  private shipmentRepository: ShipmentRepository;

  constructor(
    supabase: SupabaseClient,
    anthropicApiKey: string,
    options: { useAdvancedModel?: boolean } = {}
  ) {
    this.supabase = supabase;
    this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
    this.shipmentRepository = new ShipmentRepository(supabase);
    this.extractionService = new ShipmentExtractionService(
      supabase,
      anthropicApiKey,
      options
    );
    this.pdfExtractor = new PdfExtractorFactory();
    this.documentLifecycleService = new DocumentLifecycleService(supabase);
    this.stakeholderService = new StakeholderExtractionService(supabase);
    // Use new classification orchestrator (parallel document + email type classification)
    this.classificationOrchestrator = createClassificationOrchestrator();
  }

  /**
   * Full ingestion pipeline for an email
   * Deep module: Simple interface, complex implementation
   *
   * PIPELINE ORDER (CRITICAL):
   * 1. Fetch email
   * 2. Check idempotency
   * 3. Extract PDF text from attachments (MUST happen before classification!)
   * 4. Classify using email + attachment content
   * 5. Extract entities from email + attachment content
   * 6. Link/create shipment
   * 7. Create document lifecycle
   * 8. Update status
   */
  async ingestEmail(
    emailId: string,
    options: ProcessingOptions = {}
  ): Promise<IngestResult> {
    const startTime = Date.now();

    try {
      // 1. Get email from database
      const email = await this.getEmail(emailId);
      if (!email) {
        return this.errorResult(emailId, 'Email not found', startTime);
      }

      // 2. Check if already processed (idempotency)
      if (!options.forceReprocess) {
        const existing = await this.checkExistingProcessing(emailId);
        if (existing) {
          // Ensure processing_status is marked as processed
          await this.updateProcessingStatus(emailId, 'processed');
          return {
            success: true,
            emailId,
            classification: existing.classification,
            entities: [],
            shipmentId: existing.shipmentId,
            shipmentAction: 'none',
            fieldsExtracted: 0,
            processingTime: Date.now() - startTime,
            error: 'Already processed'
          };
        }
      }

      // 3. Extract PDF text from attachments (CRITICAL - must happen before classification)
      const attachmentContent = await this.ensurePdfExtraction(emailId);

      // 4. Classify document using ClassificationOrchestrator
      // Parallel classification: document type + email type + sentiment
      let classification: Classification | undefined;
      let classificationOutput: ClassificationOutput | undefined;
      if (!options.skipClassification) {
        // Get attachment filenames
        const { data: attachments } = await this.supabase
          .from('raw_attachments')
          .select('filename')
          .eq('email_id', emailId);
        const attachmentFilenames = attachments?.map(a => a.filename).filter(Boolean) || [];

        // Check thread context - get existing document types from this thread
        const { data: threadEmails } = await this.supabase
          .from('raw_emails')
          .select('id, is_response, document_classifications(document_type)')
          .eq('thread_id', email.thread_id)
          .neq('id', emailId)
          .order('received_at', { ascending: true });

        const existingDocTypesInThread = threadEmails
          ?.flatMap((e: any) => e.document_classifications?.map((c: any) => c.document_type))
          .filter(Boolean) || [];

        // Get is_response flag from email
        const { data: emailMeta } = await this.supabase
          .from('raw_emails')
          .select('is_response, clean_subject')
          .eq('id', emailId)
          .single();

        const isResponse = emailMeta?.is_response || false;

        // Run classification with AI fallback for low-confidence results
        classificationOutput = await this.classificationOrchestrator.classifyWithAI({
          subject: email.subject || '',
          senderEmail: email.sender_email || '',
          bodyText: email.body_text || '',
          attachmentFilenames,
          pdfContent: attachmentContent || undefined,
          isResponse,
          existingDocTypesInThread,
        });

        // Save classification to database
        await this.saveClassification(email.id, classificationOutput);

        // Map to internal Classification type
        classification = this.mapClassificationOutput(classificationOutput);
      }

      // 4. Extract entities (comprehensive)
      let entities: Entity[] = [];
      let shipmentData: ShipmentData | null = null;
      let fieldsExtracted = 0;

      if (!options.skipEntityExtraction) {
        const extractionResult = await this.extractionService.extractFromEmail(emailId);
        if (extractionResult.success && extractionResult.data) {
          shipmentData = extractionResult.data;
          entities = this.shipmentDataToEntities(shipmentData);
          fieldsExtracted = shipmentData.fields_extracted.length;

          // Save entities to database
          await this.saveEntities(emailId, shipmentData);
        }
      }

      // 5. Link to or create shipment
      let shipmentId: string | undefined;
      let shipmentAction: 'created' | 'updated' | 'linked' | 'none' = 'none';

      if (!options.skipShipmentLinking && shipmentData) {
        const linkResult = await this.processForShipment(
          emailId,
          shipmentData,
          classification?.document_type
        );
        shipmentId = linkResult.shipmentId;
        shipmentAction = linkResult.action;

        // 5a. Check prerequisites and create alerts for missing documents
        if (shipmentId && classification?.document_type) {
          await this.checkPrerequisitesAndAlert(
            shipmentId,
            classification.document_type
          );
        }

        // 6. Extract and link stakeholders (shipper/consignee)
        if (shipmentId && shipmentData) {
          await this.extractAndLinkStakeholders(
            shipmentId,
            shipmentData,
            classification?.document_type
          );
        }

        // 7. Create document lifecycle entry
        if (shipmentId && classification?.document_type) {
          await this.createDocumentLifecycle(
            shipmentId,
            classification.document_type,
            shipmentData
          );
        }
      }

      // 8. Update processing status
      await this.updateProcessingStatus(emailId, 'processed');

      return {
        success: true,
        emailId,
        classification,
        entities,
        shipmentId,
        shipmentAction,
        fieldsExtracted,
        processingTime: Date.now() - startTime
      };

    } catch (error: any) {
      // Update status to failed
      await this.updateProcessingStatus(emailId, 'failed', error.message);

      return this.errorResult(emailId, error.message, startTime);
    }
  }

  /**
   * Map ClassificationOutput to internal Classification type
   */
  private mapClassificationOutput(result: ClassificationOutput): Classification {
    // Build classification reason from available data
    const reasons: string[] = [];
    if (result.documentMatchedMarkers?.length) {
      reasons.push(`[Content-First] Matched markers: ${result.documentMatchedMarkers.join(', ')}`);
    }
    if (result.documentMatchedPattern) {
      reasons.push(`Pattern: ${result.documentMatchedPattern}`);
    }
    if (result.emailMatchedPatterns?.length) {
      reasons.push(`Email patterns: ${result.emailMatchedPatterns.join(', ')}`);
    }
    if (result.usedAIFallback && result.aiReasoning) {
      reasons.push(`[AI] ${result.aiReasoning}`);
    }

    return {
      document_type: result.documentType as DocumentType,
      sub_type: undefined, // New orchestrator doesn't track sub_type yet
      confidence_score: result.documentConfidence,
      labels: [result.emailType, result.emailCategory, result.sentiment].filter(Boolean),
      carrier_detected: result.senderCategory === 'carrier' ? 'detected' : null,
      is_automated: true,
      classification_reason: reasons.join(' | ') || 'Classification completed',
    };
  }

  /**
   * Save classification result to database
   */
  private async saveClassification(emailId: string, result: ClassificationOutput): Promise<void> {
    // Delete existing classification if any
    await this.supabase
      .from('document_classifications')
      .delete()
      .eq('email_id', emailId);

    // Determine model version based on classification method
    let modelVersion: string;
    if (result.usedAIFallback) {
      modelVersion = 'v3|ai-fallback';
    } else if (result.documentMethod === 'pdf_content') {
      modelVersion = 'v3|content-first';
    } else {
      modelVersion = 'v3|pattern';
    }

    // Build classification reason
    const reasons: string[] = [];
    reasons.push(`Document: ${result.documentType} (${result.documentConfidence}%)`);
    reasons.push(`Email: ${result.emailType} (${result.emailTypeConfidence}%)`);
    reasons.push(`Sender: ${result.senderCategory}`);
    reasons.push(`Sentiment: ${result.sentiment}`);
    if (result.usedAIFallback) {
      reasons.push(`AI: ${result.aiReasoning}`);
    }

    const { error } = await this.supabase
      .from('document_classifications')
      .insert({
        email_id: emailId,
        document_type: result.documentType,
        revision_type: null, // Could be derived from email type if needed
        confidence_score: Math.max(result.documentConfidence, result.emailTypeConfidence),
        model_name: result.usedAIFallback ? 'ai-fallback' : 'classification-orchestrator',
        model_version: modelVersion,
        classification_reason: reasons.join(' | '),
        is_manual_review: result.needsManualReview,
        document_direction: result.direction,
        workflow_state: result.documentWorkflowState,
        classified_at: new Date().toISOString(),
        // New fields for enhanced classification
        email_type: result.emailType,
        email_category: result.emailCategory,
        email_type_confidence: result.emailTypeConfidence,
        sender_category: result.senderCategory,
        sentiment: result.sentiment,
        sentiment_score: result.sentimentScore,
      });

    if (error) {
      console.warn(`[Classification] Failed to save: ${error.message}`);
      // Don't throw - classification save failure shouldn't stop the pipeline
    }
  }

  /**
   * Get extracted text from PDF attachments.
   * Returns combined text from all PDFs that have extracted_text.
   *
   * Note: PDF text extraction happens during email ingestion via Gmail API.
   * This method retrieves already-extracted text for use in classification.
   */
  async ensurePdfExtraction(emailId: string): Promise<string> {
    // Get all PDF attachments with extracted text
    const { data: attachments } = await this.supabase
      .from('raw_attachments')
      .select('id, filename, mime_type, extracted_text')
      .eq('email_id', emailId);

    if (!attachments || attachments.length === 0) {
      return '';
    }

    const extractedTexts: string[] = [];

    for (const attachment of attachments) {
      // Only include PDFs with extracted text
      const isPdf = attachment.mime_type === 'application/pdf' ||
                    attachment.filename?.toLowerCase().endsWith('.pdf');

      if (isPdf && attachment.extracted_text && attachment.extracted_text.length > 50) {
        extractedTexts.push(attachment.extracted_text);
      }
    }

    if (extractedTexts.length > 0) {
      console.log(`[PDF] Found ${extractedTexts.length} PDF(s) with extracted text for email ${emailId.substring(0, 8)}...`);
    }

    return extractedTexts.join('\n\n---\n\n');
  }

  /**
   * Process email for shipment creation/linking
   */
  async processForShipment(
    emailId: string,
    data: ShipmentData,
    documentType?: DocumentType
  ): Promise<{ shipmentId?: string; action: 'created' | 'updated' | 'linked' | 'none' }> {
    // Need at least one identifier to process
    if (!data.booking_number && !data.bl_number && data.container_numbers.length === 0) {
      return { action: 'none' };
    }

    // Try to find existing shipment using repository
    let existingShipment = null;

    if (data.booking_number) {
      existingShipment = await this.shipmentRepository.findByBookingNumber(data.booking_number);
    }

    if (!existingShipment && data.bl_number) {
      existingShipment = await this.shipmentRepository.findByBlNumber(data.bl_number);
    }

    if (!existingShipment && data.container_numbers.length > 0) {
      existingShipment = await this.shipmentRepository.findByContainerNumber(data.container_numbers[0]);
    }

    const shipmentRecord = this.extractionService.toShipmentRecord(data);

    if (existingShipment) {
      // Update existing shipment with new data (only fill null fields)
      const updates = this.buildShipmentUpdates(existingShipment, shipmentRecord, documentType);

      if (Object.keys(updates).length > 0) {
        await this.shipmentRepository.update(existingShipment.id, {
          ...updates,
          updated_at: new Date().toISOString(),
        });

        // Link email to shipment
        await this.linkEmailToShipment(emailId, existingShipment.id, documentType);

        return { shipmentId: existingShipment.id, action: 'updated' };
      }

      // Just link without updates
      await this.linkEmailToShipment(emailId, existingShipment.id, documentType);
      return { shipmentId: existingShipment.id, action: 'linked' };
    }

    // Create new shipment ONLY from booking confirmations
    // Other document types (BL, arrival notice, etc.) can only link to existing shipments
    if (documentType === 'booking_confirmation') {
      try {
        const newShipment = await this.shipmentRepository.create({
          ...shipmentRecord,
          status: 'booked',
          created_from_email_id: emailId,
        });

        await this.linkEmailToShipment(emailId, newShipment.id, documentType);
        return { shipmentId: newShipment.id, action: 'created' };
      } catch (error) {
        console.error('[EmailIngestionService] Failed to create shipment:', error);
      }
    }

    return { action: 'none' };
  }

  /**
   * Batch process multiple emails
   */
  async processBatch(
    emailIds: string[],
    options: ProcessingOptions & {
      onProgress?: (processed: number, total: number, result: IngestResult) => void;
      rateLimit?: number;
    } = {}
  ): Promise<{
    processed: number;
    successful: number;
    failed: number;
    results: IngestResult[];
  }> {
    const results: IngestResult[] = [];
    let successful = 0;
    let failed = 0;

    for (let i = 0; i < emailIds.length; i++) {
      const result = await this.ingestEmail(emailIds[i], options);
      results.push(result);

      if (result.success) {
        successful++;
      } else {
        failed++;
      }

      if (options.onProgress) {
        options.onProgress(i + 1, emailIds.length, result);
      }

      // Rate limiting
      if (options.rateLimit) {
        await new Promise(r => setTimeout(r, options.rateLimit));
      } else {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    return {
      processed: emailIds.length,
      successful,
      failed,
      results
    };
  }

  /**
   * Get emails needing processing
   */
  async getUnprocessedEmails(limit: number = 100): Promise<string[]> {
    const { data } = await this.supabase
      .from('raw_emails')
      .select('id')
      .or('processing_status.is.null,processing_status.eq.pending')
      .order('received_at', { ascending: false })
      .limit(limit);

    return data?.map(e => e.id) || [];
  }

  /**
   * Get emails for reprocessing (failed or low confidence)
   */
  async getEmailsForReprocessing(limit: number = 100): Promise<string[]> {
    const { data } = await this.supabase
      .from('raw_emails')
      .select('id')
      .eq('processing_status', 'failed')
      .order('received_at', { ascending: false })
      .limit(limit);

    return data?.map(e => e.id) || [];
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private async getEmail(emailId: string): Promise<RawEmail | null> {
    const { data, error } = await this.supabase
      .from('raw_emails')
      .select('*')
      .eq('id', emailId)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  private async checkExistingProcessing(emailId: string): Promise<{
    classification?: Classification;
    shipmentId?: string;
  } | null> {
    // Check if classification exists
    const { data: classifications } = await this.supabase
      .from('document_classifications')
      .select('*')
      .eq('email_id', emailId)
      .limit(1);

    if (!classifications || classifications.length === 0) {
      return null;
    }

    // Check if linked to shipment
    const { data: docs } = await this.supabase
      .from('shipment_documents')
      .select('shipment_id')
      .eq('email_id', emailId)
      .limit(1);

    return {
      classification: {
        document_type: classifications[0].document_type,
        sub_type: classifications[0].revision_type,
        confidence_score: classifications[0].confidence_score,
        labels: [],
        carrier_detected: null,
        is_automated: true,
        classification_reason: classifications[0].classification_reason
      },
      shipmentId: docs?.[0]?.shipment_id
    };
  }

  private async saveEntities(
    emailId: string,
    data: ShipmentData
  ): Promise<void> {
    // Get classification ID for linking
    const { data: classifications } = await this.supabase
      .from('document_classifications')
      .select('id')
      .eq('email_id', emailId)
      .limit(1);

    const classificationId = classifications?.[0]?.id;

    // Convert to entity records
    const entities = this.extractionService.toEntityRecords(
      data,
      emailId,
      classificationId
    );

    if (entities.length === 0) return;

    // Delete existing entities for this email (to avoid duplicates on reprocess)
    await this.supabase
      .from('entity_extractions')
      .delete()
      .eq('email_id', emailId);

    // Insert new entities
    await this.supabase
      .from('entity_extractions')
      .insert(entities);
  }

  private shipmentDataToEntities(data: ShipmentData): Entity[] {
    const entities: Entity[] = [];

    const addEntity = (type: string, value: string | null | number, source: Entity['source'] = 'email_body') => {
      if (value !== null && value !== undefined) {
        entities.push({
          type,
          value: String(value),
          confidence: data.extraction_confidence,
          source
        });
      }
    };

    addEntity('booking_number', data.booking_number);
    addEntity('bl_number', data.bl_number);
    addEntity('carrier', data.carrier_name);
    addEntity('vessel_name', data.vessel_name);
    addEntity('voyage_number', data.voyage_number);
    addEntity('port_of_loading', data.port_of_loading);
    addEntity('port_of_discharge', data.port_of_discharge);
    addEntity('etd', data.etd);
    addEntity('eta', data.eta);
    addEntity('si_cutoff', data.si_cutoff);
    addEntity('vgm_cutoff', data.vgm_cutoff);
    addEntity('cargo_cutoff', data.cargo_cutoff);
    addEntity('shipper', data.shipper_name);
    addEntity('consignee', data.consignee_name);

    for (const container of data.container_numbers) {
      addEntity('container_number', container);
    }

    return entities;
  }

  private buildShipmentUpdates(
    existing: any,
    newData: any,
    documentType?: DocumentType
  ): Record<string, any> {
    const updates: Record<string, any> = {};

    // Fields that should only update if currently null (identifiers - don't overwrite)
    const fillOnlyFields = [
      'booking_number', 'bl_number', 'container_number_primary'
    ];

    for (const field of fillOnlyFields) {
      if (!existing[field] && newData[field]) {
        updates[field] = newData[field];
      }
    }

    // Fields that use "latest wins" - newer value overwrites existing
    // This handles amendments, rollovers, and updated information
    const latestWinsFields = [
      'vessel_name', 'voyage_number',
      'port_of_loading', 'port_of_loading_code',
      'port_of_discharge', 'port_of_discharge_code',
      'place_of_receipt', 'place_of_delivery',
      'etd', 'eta',
      'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff',
      'commodity_description',
      'shipper_name', 'consignee_name',
      'incoterms', 'freight_terms',
      'total_weight', 'total_volume'
    ];

    for (const field of latestWinsFields) {
      if (newData[field] && newData[field] !== existing[field]) {
        updates[field] = newData[field];
      }
    }

    // Status upgrade based on document type
    if (documentType) {
      const statusUpgrade = this.getStatusUpgrade(documentType, existing.status);
      if (statusUpgrade) {
        updates.status = statusUpgrade;
        updates.status_updated_at = new Date().toISOString();
      }
    }

    return updates;
  }

  private getStatusUpgrade(
    documentType: DocumentType,
    currentStatus: string
  ): string | null {
    const statusPriority: Record<string, number> = {
      draft: 0,
      booked: 1,
      in_transit: 2,
      arrived: 3,
      delivered: 4,
      cancelled: -1
    };

    const docToStatus: Record<string, string> = {
      booking_confirmation: 'booked',
      booking_amendment: 'booked',
      bill_of_lading: 'booked', // Could be in_transit if BL issued after departure
      shipping_instruction: 'booked',
      arrival_notice: 'arrived',
      delivery_order: 'delivered',
      container_release: 'arrived'
    };

    const newStatus = docToStatus[documentType];
    if (!newStatus) return null;

    const currentPriority = statusPriority[currentStatus] || 0;
    const newPriority = statusPriority[newStatus] || 0;

    return newPriority > currentPriority ? newStatus : null;
  }

  private async linkEmailToShipment(
    emailId: string,
    shipmentId: string,
    documentType?: DocumentType
  ): Promise<void> {
    // Check if link already exists
    const { data: existing } = await this.supabase
      .from('shipment_documents')
      .select('id')
      .eq('email_id', emailId)
      .eq('shipment_id', shipmentId)
      .limit(1);

    if (existing && existing.length > 0) {
      return; // Already linked
    }

    // Get email's thread_id for deduplication
    const { data: email } = await this.supabase
      .from('raw_emails')
      .select('thread_id, is_response')
      .eq('id', emailId)
      .single();

    // THREAD DEDUPLICATION: If this is a RE:/FW: email and the same document type
    // already exists from this thread for this shipment, skip linking
    if (email?.thread_id && email?.is_response && documentType) {
      const { data: existingInThread } = await this.supabase
        .from('shipment_documents')
        .select('id, email_id')
        .eq('shipment_id', shipmentId)
        .eq('document_type', documentType);

      if (existingInThread && existingInThread.length > 0) {
        // Check if any of those documents are from the same thread
        const existingEmailIds = existingInThread.map(d => d.email_id);
        const { data: threadCheck } = await this.supabase
          .from('raw_emails')
          .select('id')
          .eq('thread_id', email.thread_id)
          .in('id', existingEmailIds);

        if (threadCheck && threadCheck.length > 0) {
          console.log(
            `[LinkEmail] Skipping duplicate: ${documentType} already linked from thread ${email.thread_id.substring(0, 8)}...`
          );
          return; // Skip duplicate from same thread
        }
      }
    }

    // Get classification ID
    const { data: classifications } = await this.supabase
      .from('document_classifications')
      .select('id')
      .eq('email_id', emailId)
      .limit(1);

    await this.supabase
      .from('shipment_documents')
      .insert({
        shipment_id: shipmentId,
        email_id: emailId,
        classification_id: classifications?.[0]?.id,
        document_type: documentType || 'unknown',
        link_confidence_score: 95,
        link_method: 'ai',
        linked_at: new Date().toISOString(),
        is_primary: false
      });
  }

  private async updateProcessingStatus(
    emailId: string,
    status: 'pending' | 'processed' | 'failed',
    error?: string
  ): Promise<void> {
    const update: any = {
      processing_status: status,
      updated_at: new Date().toISOString()
    };

    if (error) {
      update.processing_error = error;
    }

    await this.supabase
      .from('raw_emails')
      .update(update)
      .eq('id', emailId);
  }

  private errorResult(
    emailId: string,
    error: string,
    startTime: number
  ): IngestResult {
    return {
      success: false,
      emailId,
      entities: [],
      fieldsExtracted: 0,
      processingTime: Date.now() - startTime,
      error
    };
  }

  /**
   * Check document prerequisites and create alerts for missing ones.
   * This ensures documents arrive in proper order (e.g., BL needs SI first).
   */
  private async checkPrerequisitesAndAlert(
    shipmentId: string,
    documentType: string
  ): Promise<void> {
    try {
      const result = await this.documentLifecycleService.checkPrerequisitesAndCreateAlerts(
        shipmentId,
        documentType
      );

      if (result.hasMissingPrerequisites) {
        console.log(
          `[Pipeline] Document ${documentType} received for shipment ${shipmentId} ` +
          `with missing prerequisites: ${result.missingDocuments.join(', ')}. ` +
          `Created ${result.alertsCreated} alert(s).`
        );
      }
    } catch (error: any) {
      // Log but don't fail the pipeline - prerequisite checking is non-critical
      console.warn(
        `[Pipeline] Failed to check prerequisites for ${documentType}: ${error.message}`
      );
    }
  }

  /**
   * Extract stakeholders from shipment data and link to parties table.
   * Updates shipment with shipper_id and consignee_id.
   */
  private async extractAndLinkStakeholders(
    shipmentId: string,
    data: ShipmentData,
    documentType?: DocumentType
  ): Promise<void> {
    try {
      // Build document entities from extracted data
      const entities: DocumentEntity = {};

      if (data.shipper_name) {
        entities.shipper = { name: data.shipper_name };
      }
      if (data.consignee_name) {
        entities.consignee = { name: data.consignee_name };
      }

      // Skip if no stakeholder info
      if (!entities.shipper && !entities.consignee) {
        return;
      }

      // Determine shipment direction from port codes
      const direction: ShipmentDirection =
        data.port_of_loading_code?.startsWith('IN') ? 'export' : 'import';

      // Map document type for stakeholder extraction
      const stakeholderDocType = this.mapToStakeholderDocType(documentType);

      // Extract and create/match stakeholders
      const result = await this.stakeholderService.extractFromDocument(
        entities,
        stakeholderDocType,
        direction,
        shipmentId
      );

      // Link stakeholders to shipment
      const allParties = [...result.created, ...result.matched];
      if (allParties.length > 0) {
        await this.linkStakeholdersToShipment(shipmentId, allParties);
        console.log(
          `[Pipeline] Linked ${allParties.length} stakeholder(s) to shipment ${shipmentId}`
        );
      }
    } catch (error: any) {
      // Log but don't fail the pipeline - stakeholder extraction is non-critical
      console.warn(
        `[Pipeline] Failed to extract stakeholders: ${error.message}`
      );
    }
  }

  /**
   * Map document type to stakeholder service document type
   */
  private mapToStakeholderDocType(
    docType?: DocumentType
  ): 'booking_confirmation' | 'hbl' | 'si_draft' | 'arrival_notice' {
    switch (docType) {
      case 'booking_confirmation':
      case 'booking_amendment':
        return 'booking_confirmation';
      case 'bill_of_lading':
        return 'hbl';
      case 'shipping_instruction':
      case 'si_submission':
        return 'si_draft';
      case 'arrival_notice':
        return 'arrival_notice';
      default:
        return 'booking_confirmation';
    }
  }

  /**
   * Link stakeholders to shipment by updating shipper_id/consignee_id
   */
  private async linkStakeholdersToShipment(
    shipmentId: string,
    parties: Array<{ id: string; party_type: string }>
  ): Promise<void> {
    const updates: Record<string, string> = {};

    for (const party of parties) {
      if (party.party_type === 'shipper') {
        updates.shipper_id = party.id;
      } else if (party.party_type === 'consignee') {
        updates.consignee_id = party.id;
      }
    }

    if (Object.keys(updates).length > 0) {
      await this.shipmentRepository.update(shipmentId, {
        ...updates,
        updated_at: new Date().toISOString(),
      });
    }
  }

  /**
   * Create document lifecycle entry for this email's document.
   * Tracks document status and quality score.
   */
  private async createDocumentLifecycle(
    shipmentId: string,
    documentType: string,
    data: ShipmentData | null
  ): Promise<void> {
    try {
      // Build extracted fields for quality scoring
      const extractedFields: Record<string, unknown> = {};

      if (data) {
        if (data.booking_number) extractedFields.booking_number = data.booking_number;
        if (data.bl_number) extractedFields.bl_number = data.bl_number;
        if (data.vessel_name) extractedFields.vessel_name = data.vessel_name;
        if (data.voyage_number) extractedFields.voyage_number = data.voyage_number;
        if (data.port_of_loading) extractedFields.port_of_loading = data.port_of_loading;
        if (data.port_of_discharge) extractedFields.port_of_discharge = data.port_of_discharge;
        if (data.etd) extractedFields.etd = data.etd;
        if (data.eta) extractedFields.eta = data.eta;
        if (data.shipper_name) extractedFields.shipper_name = data.shipper_name;
        if (data.consignee_name) extractedFields.consignee_name = data.consignee_name;
        if (data.container_numbers.length > 0) {
          extractedFields.container_numbers = data.container_numbers;
        }
        if (data.commodity_description) {
          extractedFields.commodity_description = data.commodity_description;
        }
        if (data.weight_kg) extractedFields.gross_weight = data.weight_kg;
      }

      await this.documentLifecycleService.createLifecycleForDocument(
        shipmentId,
        documentType,
        { extractedFields }
      );

      console.log(
        `[Pipeline] Created document lifecycle for ${documentType} on shipment ${shipmentId}`
      );
    } catch (error: any) {
      // Log but don't fail the pipeline - lifecycle creation is non-critical
      console.warn(
        `[Pipeline] Failed to create document lifecycle: ${error.message}`
      );
    }
  }
}

export default EmailIngestionService;
