/**
 * Chronicle Service
 *
 * Main intelligence processing service with freight forwarder expertise.
 * Orchestrates email fetching, AI analysis, and storage.
 *
 * Following CLAUDE.md principles:
 * - Deep Modules / Simple Interface (Principle #8)
 * - Single Responsibility (Principle #3) - via composition
 * - Small Functions < 20 lines (Principle #17)
 * - Interface-Based Design (Principle #6)
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  ProcessedEmail,
  ProcessedAttachment,
  ShippingAnalysis,
  ChronicleProcessResult,
  ChronicleBatchResult,
  detectPartyType,
  extractTrueSender,
} from './types';
import {
  IChronicleService,
  IGmailService,
  IPdfExtractor,
  IAiAnalyzer,
  IChronicleRepository,
  ChronicleInsertData,
} from './interfaces';
import { ChronicleGmailService } from './gmail-service';
import { PdfExtractor } from './pdf-extractor';
import { AiAnalyzer } from './ai-analyzer';
import { ChronicleRepository } from './chronicle-repository';
import { AI_CONFIG } from './prompts/freight-forwarder.prompt';
import { ChronicleLogger, ShipmentStage } from './chronicle-logger';

// ============================================================================
// SERVICE IMPLEMENTATION
// ============================================================================

export class ChronicleService implements IChronicleService {
  private supabase: SupabaseClient;
  private gmailService: IGmailService;
  private pdfExtractor: IPdfExtractor;
  private aiAnalyzer: IAiAnalyzer;
  private repository: IChronicleRepository;
  private logger: ChronicleLogger | null = null;

  constructor(
    supabase: SupabaseClient,
    gmailService: ChronicleGmailService,
    logger?: ChronicleLogger
  ) {
    this.supabase = supabase;
    this.gmailService = gmailService;
    this.pdfExtractor = new PdfExtractor();
    this.aiAnalyzer = new AiAnalyzer();
    this.repository = new ChronicleRepository(supabase);
    this.logger = logger || null;
  }

  /**
   * Set logger for this service (can be set after construction)
   */
  setLogger(logger: ChronicleLogger): void {
    this.logger = logger;
  }

  /**
   * Fetch and process emails - Deep module interface
   */
  async fetchAndProcess(options: {
    after?: Date;
    before?: Date;
    maxResults?: number;
    query?: string;
  }): Promise<ChronicleBatchResult> {
    const emails = await this.gmailService.fetchEmailsByTimestamp(options);
    return this.processBatch(emails, options.after, options.maxResults);
  }

  /**
   * Process a batch of emails with full logging lifecycle
   */
  async processBatch(
    emails: ProcessedEmail[],
    queryAfter?: Date,
    maxResults?: number
  ): Promise<ChronicleBatchResult> {
    const startTime = Date.now();

    // Start logging run if logger is present
    if (this.logger) {
      await this.logger.startRun({
        queryAfter,
        maxResults,
        emailsTotal: emails.length,
      });
    }

    try {
      const results = await this.processEmailsSequentially(emails);
      const batchResult = this.aggregateBatchResults(emails.length, results, startTime);

      // End logging run
      if (this.logger) {
        await this.logger.checkAndReportProgress(true);
        await this.logger.endRun('completed');
      }

      return batchResult;
    } catch (error) {
      if (this.logger) {
        await this.logger.endRun('failed');
      }
      throw error;
    }
  }

  /**
   * Process a single email - Main orchestration method
   */
  async processEmail(email: ProcessedEmail): Promise<ChronicleProcessResult> {
    // Step 1: Check idempotency
    const existing = await this.checkIfAlreadyProcessed(email.gmailMessageId);
    if (existing) {
      this.logger?.logEmailProcessed(true, true); // skipped
      return existing;
    }

    // Step 2: Extract attachments (with logging)
    const { attachmentText, attachmentsWithText } = await this.extractAttachments(email);

    // Step 3: Analyze with AI (with logging)
    const aiStart = this.logger?.logStageStart('ai_analysis') || 0;
    let analysis: ShippingAnalysis;
    try {
      analysis = await this.aiAnalyzer.analyze(email, attachmentText);
      this.logger?.logStageSuccess('ai_analysis', aiStart);
    } catch (error) {
      this.logger?.logStageFailure('ai_analysis', aiStart, error as Error, {
        gmailMessageId: email.gmailMessageId,
        subject: email.subject,
      }, true);
      this.logger?.logEmailProcessed(false);
      throw error;
    }

    // Step 4: Save to database (with logging)
    const dbStart = this.logger?.logStageStart('db_save') || 0;
    let chronicleId: string;
    try {
      chronicleId = await this.saveToDatabase(email, analysis, attachmentsWithText);
      this.logger?.logStageSuccess('db_save', dbStart);
    } catch (error) {
      this.logger?.logStageFailure('db_save', dbStart, error as Error, {
        gmailMessageId: email.gmailMessageId,
      }, false);
      this.logger?.logEmailProcessed(false);
      throw error;
    }

    // Step 5: Link to shipment and track stage (with logging)
    const { shipmentId, linkedBy } = await this.linkAndTrackShipment(
      chronicleId,
      analysis,
      email
    );

    this.logger?.logEmailProcessed(true);
    return this.createSuccessResult(email.gmailMessageId, chronicleId, shipmentId, linkedBy);
  }

  // ==========================================================================
  // PRIVATE - PROCESSING STEPS (Each < 20 lines)
  // ==========================================================================

  private async checkIfAlreadyProcessed(
    gmailMessageId: string
  ): Promise<ChronicleProcessResult | null> {
    const existing = await this.repository.findByGmailMessageId(gmailMessageId);
    if (!existing) return null;

    return {
      success: true,
      gmailMessageId,
      chronicleId: existing.id,
      error: 'Already processed',
    };
  }

  private async extractAttachments(email: ProcessedEmail): Promise<{
    attachmentText: string;
    attachmentsWithText: ProcessedAttachment[];
  }> {
    let attachmentText = '';
    const attachmentsWithText: ProcessedAttachment[] = [];

    for (const attachment of email.attachments) {
      const result = await this.extractSingleAttachment(email.gmailMessageId, attachment);
      if (result) {
        attachmentText += result.text;
        attachmentsWithText.push(result.attachment);
      }
    }

    return { attachmentText, attachmentsWithText };
  }

  private async extractSingleAttachment(
    messageId: string,
    attachment: ProcessedAttachment
  ): Promise<{ text: string; attachment: ProcessedAttachment } | null> {
    if (attachment.mimeType !== 'application/pdf' || !attachment.attachmentId) {
      return null;
    }

    const pdfStart = this.logger?.logStageStart('pdf_extract') || 0;

    try {
      const content = await this.gmailService.fetchAttachmentContent(messageId, attachment.attachmentId);
      if (!content) {
        this.logger?.logStageSkip('pdf_extract', 'No content');
        return null;
      }

      const text = await this.pdfExtractor.extractText(content, attachment.filename);
      if (!text) {
        this.logger?.logStageSkip('pdf_extract', 'No text extracted');
        return null;
      }

      const truncatedText = text.substring(0, AI_CONFIG.maxAttachmentChars);
      const formattedText = `\n=== ${attachment.filename} ===\n${truncatedText}\n`;

      // Detect if OCR was used (PdfExtractor sets this internally)
      const usedOcr = text.length > 0 && truncatedText.length < 500;
      this.logger?.logStageSuccess('pdf_extract', pdfStart, usedOcr ? { ocr_count: 1 } : { text_extract: 1 });

      return {
        text: formattedText,
        attachment: { ...attachment, extractedText: truncatedText },
      };
    } catch (error) {
      this.logger?.logStageFailure('pdf_extract', pdfStart, error as Error, {
        gmailMessageId: messageId,
        attachmentName: attachment.filename,
      }, true);
      console.error(`[Chronicle] PDF error ${attachment.filename}:`, error);
      return null;
    }
  }

  private async saveToDatabase(
    email: ProcessedEmail,
    analysis: ShippingAnalysis,
    attachmentsWithText: ProcessedAttachment[]
  ): Promise<string> {
    const trueSender = extractTrueSender(email);
    const fromParty = analysis.from_party || detectPartyType(trueSender);
    const insertData = this.buildInsertData(email, analysis, fromParty, attachmentsWithText);
    const { id } = await this.repository.insert(insertData);
    return id;
  }

  /**
   * Link chronicle to shipment and track stage progression
   */
  private async linkAndTrackShipment(
    chronicleId: string,
    analysis: ShippingAnalysis,
    email: ProcessedEmail
  ): Promise<{ shipmentId?: string; linkedBy?: string }> {
    const linkStart = this.logger?.logStageStart('linking') || 0;

    try {
      // Try to link to existing shipment
      const { shipmentId, linkedBy } = await this.repository.linkToShipment(chronicleId);

      if (shipmentId) {
        this.logger?.logEmailLinked(shipmentId);

        // Check for stage progression
        await this.checkAndUpdateShipmentStage(shipmentId, chronicleId, analysis, email);
      } else if (this.hasIdentifiers(analysis)) {
        // Create new shipment if we have identifiers
        const newShipment = await this.createShipmentFromAnalysis(analysis, email);
        if (newShipment) {
          await this.linkChronicleToShipment(chronicleId, newShipment.id);
          this.logger?.logEmailLinked(newShipment.id);
          this.logger?.logShipmentCreated(
            newShipment.id,
            chronicleId,
            analysis.document_type,
            email.receivedAt
          );
          this.logger?.logStageSuccess('linking', linkStart);
          return { shipmentId: newShipment.id, linkedBy: 'created' };
        }
      }

      // Log actions and issues
      if (shipmentId) {
        await this.logActionsAndIssues(shipmentId, chronicleId, analysis, email);
      }

      this.logger?.logStageSuccess('linking', linkStart);
      return { shipmentId, linkedBy };
    } catch (error) {
      this.logger?.logStageFailure('linking', linkStart, error as Error, {
        gmailMessageId: email.gmailMessageId,
      }, true);
      return {};
    }
  }

  private hasIdentifiers(analysis: ShippingAnalysis): boolean {
    return !!(analysis.booking_number || analysis.mbl_number || analysis.work_order_number);
  }

  private async checkAndUpdateShipmentStage(
    shipmentId: string,
    chronicleId: string,
    analysis: ShippingAnalysis,
    email: ProcessedEmail
  ): Promise<void> {
    const { data: shipment } = await this.supabase
      .from('shipments')
      .select('stage')
      .eq('id', shipmentId)
      .single();

    if (!shipment) return;

    const currentStage = (shipment.stage as ShipmentStage) || 'PENDING';
    const newStage = ChronicleLogger.detectShipmentStage(analysis.document_type);

    if (ChronicleLogger.isStageProgression(currentStage, newStage)) {
      await this.supabase
        .from('shipments')
        .update({ stage: newStage, stage_updated_at: new Date().toISOString() })
        .eq('id', shipmentId);

      this.logger?.logStageChange(
        shipmentId,
        chronicleId,
        currentStage,
        newStage,
        analysis.document_type,
        email.receivedAt
      );
    }
  }

  private async createShipmentFromAnalysis(
    analysis: ShippingAnalysis,
    email: ProcessedEmail
  ): Promise<{ id: string } | null> {
    const stage = ChronicleLogger.detectShipmentStage(analysis.document_type);

    const { data, error } = await this.supabase
      .from('shipments')
      .insert({
        booking_number: analysis.booking_number || null,
        mbl_number: analysis.mbl_number || null,
        bl_number: analysis.mbl_number || null,
        intoglo_reference: analysis.work_order_number || null,
        container_number_primary: analysis.container_numbers?.[0] || null,
        vessel_name: analysis.vessel_name || null,
        voyage_number: analysis.voyage_number || null,
        carrier_name: analysis.carrier_name || null,
        etd: analysis.etd || null,
        eta: analysis.eta || null,
        stage,
        stage_updated_at: new Date().toISOString(),
        status: 'draft',
      })
      .select('id')
      .single();

    if (error) {
      console.error('[Chronicle] Shipment create error:', error.message);
      return null;
    }
    return data;
  }

  private async linkChronicleToShipment(chronicleId: string, shipmentId: string): Promise<void> {
    await this.supabase
      .from('chronicle')
      .update({
        shipment_id: shipmentId,
        linked_by: 'created',
        linked_at: new Date().toISOString(),
      })
      .eq('id', chronicleId);
  }

  private async logActionsAndIssues(
    shipmentId: string,
    chronicleId: string,
    analysis: ShippingAnalysis,
    email: ProcessedEmail
  ): Promise<void> {
    if (analysis.has_action && analysis.action_description) {
      this.logger?.logActionDetected(
        shipmentId,
        chronicleId,
        analysis.action_owner || null,
        analysis.action_deadline || null,
        analysis.action_priority || null,
        analysis.action_description,
        analysis.document_type,
        email.receivedAt
      );
    }

    if (analysis.has_issue && analysis.issue_type) {
      this.logger?.logIssueDetected(
        shipmentId,
        chronicleId,
        analysis.issue_type,
        analysis.issue_description || '',
        analysis.document_type,
        email.receivedAt
      );
    }
  }

  private buildInsertData(
    email: ProcessedEmail,
    analysis: ShippingAnalysis,
    fromParty: string,
    attachmentsWithText: ProcessedAttachment[]
  ): ChronicleInsertData {
    return {
      gmail_message_id: email.gmailMessageId,
      thread_id: email.threadId,
      direction: email.direction,
      from_party: fromParty,
      from_address: email.senderEmail,
      transport_mode: analysis.transport_mode,

      // Identifiers
      booking_number: analysis.booking_number || null,
      mbl_number: analysis.mbl_number || null,
      hbl_number: analysis.hbl_number || null,
      container_numbers: analysis.container_numbers || [],
      mawb_number: analysis.mawb_number || null,
      hawb_number: analysis.hawb_number || null,
      work_order_number: analysis.work_order_number || null,
      pro_number: analysis.pro_number || null,
      reference_numbers: analysis.reference_numbers || [],
      identifier_source: analysis.identifier_source,
      document_type: analysis.document_type,

      // 4-Point Routing
      por_location: analysis.por_location || null,
      por_type: analysis.por_type || null,
      pol_location: analysis.pol_location || null,
      pol_type: analysis.pol_type || null,
      pod_location: analysis.pod_location || null,
      pod_type: analysis.pod_type || null,
      pofd_location: analysis.pofd_location || null,
      pofd_type: analysis.pofd_type || null,

      // Vessel/Carrier
      vessel_name: analysis.vessel_name || null,
      voyage_number: analysis.voyage_number || null,
      flight_number: analysis.flight_number || null,
      carrier_name: analysis.carrier_name || null,

      // Dates
      etd: analysis.etd || null,
      atd: analysis.atd || null,
      eta: analysis.eta || null,
      ata: analysis.ata || null,
      pickup_date: analysis.pickup_date || null,
      delivery_date: analysis.delivery_date || null,

      // Cutoffs
      si_cutoff: analysis.si_cutoff || null,
      vgm_cutoff: analysis.vgm_cutoff || null,
      cargo_cutoff: analysis.cargo_cutoff || null,
      doc_cutoff: analysis.doc_cutoff || null,

      // Demurrage/Detention
      last_free_day: analysis.last_free_day || null,
      empty_return_date: analysis.empty_return_date || null,

      // POD
      pod_delivery_date: analysis.pod_delivery_date || null,
      pod_signed_by: analysis.pod_signed_by || null,

      // Cargo
      container_type: analysis.container_type || null,
      weight: analysis.weight || null,
      pieces: analysis.pieces || null,
      commodity: analysis.commodity || null,

      // Stakeholders
      shipper_name: analysis.shipper_name || null,
      shipper_address: analysis.shipper_address || null,
      shipper_contact: analysis.shipper_contact || null,
      consignee_name: analysis.consignee_name || null,
      consignee_address: analysis.consignee_address || null,
      consignee_contact: analysis.consignee_contact || null,
      notify_party_name: analysis.notify_party_name || null,
      notify_party_address: analysis.notify_party_address || null,
      notify_party_contact: analysis.notify_party_contact || null,

      // Financial
      invoice_number: analysis.invoice_number || null,
      amount: analysis.amount || null,
      currency: analysis.currency || null,

      // Intelligence
      message_type: analysis.message_type,
      sentiment: analysis.sentiment,
      summary: analysis.summary,
      has_action: analysis.has_action,
      action_description: analysis.action_description || null,
      action_owner: analysis.action_owner || null,
      action_deadline: analysis.action_deadline || null,
      action_priority: analysis.action_priority || null,
      has_issue: analysis.has_issue || false,
      issue_type: analysis.issue_type || null,
      issue_description: analysis.issue_description || null,

      // Raw content
      subject: email.subject,
      snippet: email.snippet,
      body_preview: email.bodyText.substring(0, 1000),
      attachments: attachmentsWithText,
      ai_response: analysis,
      ai_model: AI_CONFIG.model,
      occurred_at: email.receivedAt.toISOString(),
    };
  }

  // ==========================================================================
  // PRIVATE - BATCH HELPERS (Each < 20 lines)
  // ==========================================================================

  private async processEmailsSequentially(
    emails: ProcessedEmail[]
  ): Promise<ChronicleProcessResult[]> {
    const results: ChronicleProcessResult[] = [];
    const total = emails.length;
    let processed = 0;

    for (const email of emails) {
      const result = await this.processSingleEmailSafely(email);
      results.push(result);
      processed++;

      // Progress logging
      if (processed % 25 === 0 || processed === total) {
        const succeeded = results.filter(r => r.success && !r.error?.includes('Already')).length;
        const skipped = results.filter(r => r.error?.includes('Already')).length;
        console.log(`[Chronicle] Processed ${processed}/${total} (${Math.round(processed/total*100)}%) - New: ${succeeded}, Skipped: ${skipped}`);
      }

      // Check for 5-minute progress report
      if (this.logger) {
        await this.logger.checkAndReportProgress();
      }
    }
    return results;
  }

  private async processSingleEmailSafely(email: ProcessedEmail): Promise<ChronicleProcessResult> {
    try {
      return await this.processEmail(email);
    } catch (error) {
      return this.createErrorResult(email.gmailMessageId, error);
    }
  }

  private aggregateBatchResults(
    total: number,
    results: ChronicleProcessResult[],
    startTime: number
  ): ChronicleBatchResult {
    const succeeded = results.filter(r => r.success && !r.error?.includes('Already')).length;
    const failed = results.filter(r => !r.success).length;
    const linked = results.filter(r => r.shipmentId).length;

    return {
      processed: total,
      succeeded,
      failed,
      linked,
      totalTimeMs: Date.now() - startTime,
      results,
    };
  }

  // ==========================================================================
  // PRIVATE - RESULT BUILDERS (Each < 20 lines)
  // ==========================================================================

  private createSuccessResult(
    gmailMessageId: string,
    chronicleId: string,
    shipmentId?: string,
    linkedBy?: string
  ): ChronicleProcessResult {
    return {
      success: true,
      gmailMessageId,
      chronicleId,
      shipmentId,
      linkedBy,
    };
  }

  private createErrorResult(gmailMessageId: string, error: unknown): ChronicleProcessResult {
    return {
      success: false,
      gmailMessageId,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createChronicleService(
  supabase: SupabaseClient,
  gmailService: ChronicleGmailService,
  logger?: ChronicleLogger
): ChronicleService {
  return new ChronicleService(supabase, gmailService, logger);
}
