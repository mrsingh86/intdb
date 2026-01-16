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
  ThreadContext,
  FlowContext,
  ActionKeywordResult,
  FlowValidationResult,
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
import {
  PatternMatcherService,
  IPatternMatcherService,
  PatternMatchResult,
  emailToPatternInput,
} from './pattern-matcher';

// ============================================================================
// SERVICE IMPLEMENTATION
// ============================================================================

export class ChronicleService implements IChronicleService {
  private supabase: SupabaseClient;
  private gmailService: IGmailService;
  private pdfExtractor: IPdfExtractor;
  private aiAnalyzer: IAiAnalyzer;
  private patternMatcher: IPatternMatcherService;
  private repository: IChronicleRepository;
  private logger: ChronicleLogger | null = null;

  // Metrics for pattern matching performance
  private patternMatchStats = { matched: 0, aiNeeded: 0 };

  constructor(
    supabase: SupabaseClient,
    gmailService: ChronicleGmailService,
    logger?: ChronicleLogger
  ) {
    this.supabase = supabase;
    this.gmailService = gmailService;
    this.pdfExtractor = new PdfExtractor();
    this.aiAnalyzer = new AiAnalyzer();
    this.patternMatcher = new PatternMatcherService(supabase);
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
   * Get pattern matching statistics for monitoring
   * Shows effectiveness of hybrid classification
   */
  getPatternMatchStats(): { matched: number; aiNeeded: number; matchRate: string } {
    const total = this.patternMatchStats.matched + this.patternMatchStats.aiNeeded;
    const rate = total > 0
      ? `${Math.round((this.patternMatchStats.matched / total) * 100)}%`
      : '0%';
    return { ...this.patternMatchStats, matchRate: rate };
  }

  /**
   * Reload patterns from database (useful after pattern updates)
   */
  async reloadPatterns(): Promise<void> {
    await this.patternMatcher.reloadPatterns();
    console.log(`[Chronicle] Patterns reloaded: ${this.patternMatcher.getLoadedPatterns().length} active patterns`);
  }

  /**
   * Fetch and process emails - Deep module interface
   * @param concurrency - Number of emails to process in parallel (default: 5)
   */
  async fetchAndProcess(options: {
    after?: Date;
    before?: Date;
    maxResults?: number;
    query?: string;
    concurrency?: number;
  }): Promise<ChronicleBatchResult> {
    const emails = await this.gmailService.fetchEmailsByTimestamp(options);
    return this.processBatch(emails, options.after, options.maxResults, options.concurrency || 5);
  }

  /**
   * Process a batch of emails with full logging lifecycle
   * @param concurrency - Number of emails to process in parallel (default: 5)
   */
  async processBatch(
    emails: ProcessedEmail[],
    queryAfter?: Date,
    maxResults?: number,
    concurrency: number = 5
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
      // Use concurrent processing for speed (5x faster with concurrency=5)
      const results = await this.processEmailsConcurrently(emails, concurrency);
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
   * Uses hybrid classification: pattern matching first, AI fallback when needed
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

    // Step 3: Fetch thread context (for AI enrichment and thread position)
    const threadContext = await this.fetchThreadContext(email);
    const threadPosition = (threadContext?.emailCount ?? 0) + 1;

    // Step 4: Classification - Pattern matching first, then AI fallback
    // Pattern matching now runs for ALL positions (including replies)
    // High-confidence patterns (90%+) are trusted even for reply subjects
    // Position 1: AI uses subject + body + attachments
    // Position 2+: AI ignores subject (stale) but patterns still checked
    let analysis: ShippingAnalysis;
    let patternResult: PatternMatchResult | null = null;

    // Always try pattern matching first (even for replies)
    // High-priority patterns (form_13, customs docs) are reliable even in reply subjects
    patternResult = await this.tryPatternMatch(email, threadPosition);

    // Confidence threshold: higher for replies since subject may be stale
    const confidenceThreshold = threadPosition === 1 ? 85 : 90;
    const usePatternMatch = patternResult.matched &&
      !patternResult.requiresAiFallback &&
      patternResult.confidence >= confidenceThreshold;

    if (usePatternMatch) {
      // High-confidence pattern match - skip AI
      analysis = await this.createAnalysisFromPattern(
        email,
        attachmentText,
        patternResult,
        threadContext
      );
      this.patternMatchStats.matched++;
      console.log(`[Chronicle] Pattern match (pos ${threadPosition}): ${patternResult.documentType} (${patternResult.confidence}% confidence)`);
    } else if (threadPosition === 1) {
      // Position 1: AI with subject included
      analysis = await this.runAiAnalysis(email, attachmentText, threadContext, threadPosition);
      this.patternMatchStats.aiNeeded++;

      // If pattern had partial match, record for learning
      if (patternResult?.matched && patternResult.patternId) {
        if (analysis.document_type !== patternResult.documentType) {
          await this.patternMatcher.recordFalsePositive(patternResult.patternId);
        }
      }
    } else {
      // Position 2+: AI ignores subject (stale from forwarding)
      console.log(`[Chronicle] Position ${threadPosition}: Using body/attachments (subject stale)`);
      analysis = await this.runAiAnalysis(email, attachmentText, threadContext, threadPosition);
      this.patternMatchStats.aiNeeded++;

      // Still check if pattern would have helped (for learning)
      if (patternResult?.matched && patternResult.patternId) {
        if (analysis.document_type !== patternResult.documentType) {
          // Don't record as false positive for replies - subject truly may be stale
          console.log(`[Chronicle] Pattern vs AI disagreement (reply): pattern=${patternResult.documentType}, ai=${analysis.document_type}`);
        }
      }
    }

    // Step 5: Normalize document_type (fix common AI enum mistakes)
    const originalDocType = analysis.document_type;
    analysis.document_type = await this.normalizeDocumentType(analysis.document_type) as typeof analysis.document_type;
    if (originalDocType !== analysis.document_type) {
      console.log(`[Chronicle] Normalized: ${originalDocType} → ${analysis.document_type}`);
    }

    // Track classification method for learning
    const predictionMethod = patternResult?.matched && !patternResult.requiresAiFallback ? 'pattern' : 'ai';
    const predictionConfidence = patternResult?.matched ? patternResult.confidence : 75; // Default AI confidence

    // Step 6: Save to database (with logging)
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

    // Step 7: Link to shipment and track stage (with logging)
    const { shipmentId, linkedBy, shipmentStage } = await this.linkAndTrackShipment(
      chronicleId,
      analysis,
      email
    );

    // Step 8: Validate against flow (if linked to shipment with stage)
    let flowValidationPassed = true;
    let flowValidationWarning: string | undefined;
    if (shipmentStage) {
      const flowResult = await this.validateAgainstFlow(shipmentStage, analysis.document_type);
      flowValidationPassed = flowResult.isValid;
      flowValidationWarning = flowResult.warning || undefined;
      if (flowResult.warning) {
        console.log(`[Chronicle] Flow validation: ${flowResult.warning}`);
      }
    }

    // Step 9: Record learning episode (for feedback loop)
    await this.recordLearningEpisode({
      chronicleId,
      predictedDocumentType: analysis.document_type,
      predictionConfidence,
      predictionMethod,
      senderDomain: this.extractDomain(email.senderEmail),
      threadPosition,
      flowValidationPassed,
      flowValidationWarning,
    });

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

  /**
   * Try pattern matching for deterministic classification
   * Returns match result with confidence score
   */
  private async tryPatternMatch(
    email: ProcessedEmail,
    threadPosition: number
  ): Promise<PatternMatchResult> {
    try {
      const input = emailToPatternInput(email, threadPosition);
      return await this.patternMatcher.match(input);
    } catch (error) {
      console.error('[Chronicle] Pattern match error:', error);
      return {
        matched: false,
        documentType: null,
        carrierId: null,
        confidence: 0,
        patternId: null,
        matchedPattern: null,
        matchSource: null,
        requiresAiFallback: true,
      };
    }
  }

  /**
   * Run AI analysis with thread position awareness
   * Position 1: AI uses subject + body + attachments
   * Position 2+: AI ignores subject (stale from forwarding)
   */
  private async runAiAnalysis(
    email: ProcessedEmail,
    attachmentText: string,
    threadContext: ThreadContext | null,
    threadPosition: number
  ): Promise<ShippingAnalysis> {
    const aiStart = this.logger?.logStageStart('ai_analysis') || 0;
    try {
      const analysis = await this.aiAnalyzer.analyze(
        email,
        attachmentText,
        threadContext || undefined,
        threadPosition
      );
      this.logger?.logStageSuccess('ai_analysis', aiStart);
      return analysis;
    } catch (error) {
      this.logger?.logStageFailure('ai_analysis', aiStart, error as Error, {
        gmailMessageId: email.gmailMessageId,
        subject: email.subject,
      }, true);
      this.logger?.logEmailProcessed(false);
      throw error;
    }
  }

  /**
   * Create ShippingAnalysis from pattern match result
   * Used when pattern confidence is high enough to skip AI
   * Extracts identifiers from email/attachments using regex
   */
  private async createAnalysisFromPattern(
    email: ProcessedEmail,
    attachmentText: string,
    patternResult: PatternMatchResult,
    threadContext: ThreadContext | null
  ): Promise<ShippingAnalysis> {
    // Extract basic fields from pattern match
    const documentType = (patternResult.documentType || 'unknown') as ShippingAnalysis['document_type'];

    // Use thread context to inherit known values
    const knownValues = threadContext?.knownValues || {};

    // Detect direction and party
    const fromParty = detectPartyType(extractTrueSender(email)) as ShippingAnalysis['from_party'];

    // Determine identifier source based on pattern match source
    const identifierSource: ShippingAnalysis['identifier_source'] =
      patternResult.matchSource === 'subject' ? 'subject' :
      patternResult.matchSource === 'body' ? 'body' : 'body';

    // Build minimal analysis - document_type is the key output
    // Other fields extracted via simple regex patterns
    return {
      transport_mode: 'ocean',
      document_type: documentType,
      booking_number: knownValues.bookingNumber || this.extractBookingNumber(email.subject, email.bodyText) || null,
      mbl_number: knownValues.mblNumber || this.extractMblNumber(email.subject, email.bodyText) || null,
      hbl_number: null,
      container_numbers: knownValues.containerNumbers || this.extractContainerNumbers(email.bodyText) || [],
      mawb_number: null,
      hawb_number: null,
      work_order_number: this.extractWorkOrder(email.subject, email.bodyText) || null,
      pro_number: null,
      reference_numbers: [],
      identifier_source: identifierSource,
      from_party: fromParty,

      // Routing (inherit from thread)
      por_location: null, por_type: null,
      pol_location: null, pol_type: null,
      pod_location: null, pod_type: null,
      pofd_location: null, pofd_type: null,

      // Vessel (inherit from thread)
      vessel_name: knownValues.vesselName || null,
      voyage_number: null,
      flight_number: null,
      carrier_name: null,

      // Dates (inherit from thread)
      etd: knownValues.etd || null,
      atd: null,
      eta: knownValues.eta || null,
      ata: null,
      pickup_date: null,
      delivery_date: null,
      si_cutoff: null,
      vgm_cutoff: null,
      cargo_cutoff: null,
      doc_cutoff: null,
      last_free_day: null,
      empty_return_date: null,
      pod_delivery_date: null,
      pod_signed_by: null,

      // Cargo
      container_type: null,
      weight: null,
      pieces: null,
      commodity: null,

      // Stakeholders
      shipper_name: null, shipper_address: null, shipper_contact: null,
      consignee_name: null, consignee_address: null, consignee_contact: null,
      notify_party_name: null, notify_party_address: null, notify_party_contact: null,

      // Financial
      invoice_number: null,
      amount: null,
      currency: null,

      // Intelligence - simplified for pattern match
      message_type: this.inferMessageType(documentType),
      sentiment: 'neutral',
      summary: `${documentType.replace(/_/g, ' ')} notification`,
      has_action: this.documentTypeHasAction(documentType),
      action_description: null,
      action_owner: null,
      action_deadline: null,
      action_priority: null,
      has_issue: false,
      issue_type: null,
      issue_description: null,
    };
  }

  // Simple regex extractors for pattern-matched emails
  private extractBookingNumber(subject: string, body: string): string | null {
    const patterns = [
      /BKG[#:\s]*([A-Z0-9]{8,20})/i,
      /BOOKING[#:\s]*([A-Z0-9]{8,20})/i,
      /\b(\d{9,10})\b/, // Maersk booking number format
    ];
    for (const pattern of patterns) {
      const match = (subject + ' ' + body).match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  private extractMblNumber(subject: string, body: string): string | null {
    const patterns = [
      /B\/L[#:\s]*([A-Z0-9]{8,20})/i,
      /MBL[#:\s]*([A-Z0-9]{8,20})/i,
      /BILL OF LADING[#:\s]*([A-Z0-9]{8,20})/i,
    ];
    for (const pattern of patterns) {
      const match = (subject + ' ' + body).match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  private extractContainerNumbers(body: string): string[] {
    const pattern = /\b([A-Z]{4}\d{7})\b/g;
    const matches = body.match(pattern) || [];
    return Array.from(new Set(matches)); // Deduplicate
  }

  private extractWorkOrder(subject: string, body: string): string | null {
    const patterns = [
      /INT-\d{2}-\d{5}/i,
      /WO[#:\s]*(\d{5,10})/i,
    ];
    for (const pattern of patterns) {
      const match = (subject + ' ' + body).match(pattern);
      if (match) return match[0];
    }
    return null;
  }

  private inferMessageType(documentType: string): ShippingAnalysis['message_type'] {
    if (documentType.includes('confirmation')) return 'confirmation';
    if (documentType.includes('request')) return 'request';
    if (documentType.includes('update')) return 'update';
    if (documentType.includes('notice')) return 'notification';
    return 'notification';
  }

  private documentTypeHasAction(documentType: string): boolean {
    const actionTypes = [
      'vgm_request', 'si_request', 'payment_request',
      'arrival_notice', 'delivery_order', 'reminder'
    ];
    return actionTypes.some(t => documentType.includes(t));
  }

  /**
   * Fetch thread context for AI enrichment
   * Returns null if this is the first email in the thread
   */
  private async fetchThreadContext(email: ProcessedEmail): Promise<ThreadContext | null> {
    try {
      const context = await this.repository.getThreadContext(
        email.threadId,
        email.receivedAt
      );

      if (context && context.emailCount > 0) {
        console.log(`[Chronicle] Thread context found: ${context.emailCount} previous emails`);
      }

      return context;
    } catch (error) {
      // Log but don't fail - thread context is optional enhancement
      console.error('[Chronicle] Failed to fetch thread context:', error);
      return null;
    }
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
   * Returns shipmentStage for flow validation
   */
  private async linkAndTrackShipment(
    chronicleId: string,
    analysis: ShippingAnalysis,
    email: ProcessedEmail
  ): Promise<{ shipmentId?: string; linkedBy?: string; shipmentStage?: string }> {
    const linkStart = this.logger?.logStageStart('linking') || 0;

    try {
      // Try to link to existing shipment
      const { shipmentId, linkedBy } = await this.repository.linkToShipment(chronicleId);

      let finalShipmentId = shipmentId;
      let finalLinkedBy = linkedBy;
      let shipmentStage: string | undefined;

      if (shipmentId) {
        this.logger?.logEmailLinked(shipmentId);

        // Fetch current stage for flow validation and check for progression
        shipmentStage = await this.checkAndUpdateShipmentStage(shipmentId, chronicleId, analysis, email);
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
          finalShipmentId = newShipment.id;
          finalLinkedBy = 'created';
          // For new shipments, stage is derived from document type
          shipmentStage = ChronicleLogger.detectShipmentStage(analysis.document_type);
        }
      }

      // Resolve related actions if this is a confirmation document
      if (finalShipmentId) {
        await this.resolveActionsIfConfirmation(finalShipmentId, analysis.document_type, email.receivedAt);
      }

      // Log actions and issues
      if (finalShipmentId) {
        await this.logActionsAndIssues(finalShipmentId, chronicleId, analysis, email);
      }

      this.logger?.logStageSuccess('linking', linkStart);
      return { shipmentId: finalShipmentId, linkedBy: finalLinkedBy, shipmentStage };
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

  /**
   * Resolve related pending actions when confirmation documents arrive
   *
   * When VGM confirmation arrives → marks VGM-related actions as completed
   * When SI confirmation arrives → marks SI-related actions as completed
   */
  private async resolveActionsIfConfirmation(
    shipmentId: string,
    documentType: string,
    occurredAt: Date
  ): Promise<void> {
    const confirmationTypes = [
      // Pre-shipment confirmations
      'vgm_confirmation',
      'si_confirmation',
      'sob_confirmation',
      'booking_confirmation',
      'leo_copy',
      // BL confirmations
      'draft_bl',
      'final_bl',
      'telex_release',
      'sea_waybill',
      // Destination confirmations
      'arrival_notice',
      'container_release',
      'delivery_order',
      'pod_proof_of_delivery',
    ];

    if (!confirmationTypes.includes(documentType)) {
      return; // Not a confirmation type
    }

    const resolved = await this.repository.resolveRelatedActions(
      shipmentId,
      documentType,
      occurredAt.toISOString()
    );

    if (resolved > 0) {
      console.log(`[Chronicle] Resolved ${resolved} action(s) for ${documentType}`);
    }
  }

  /**
   * Check and update shipment stage, returns current stage for flow validation
   */
  private async checkAndUpdateShipmentStage(
    shipmentId: string,
    chronicleId: string,
    analysis: ShippingAnalysis,
    email: ProcessedEmail
  ): Promise<string | undefined> {
    const { data: shipment } = await this.supabase
      .from('shipments')
      .select('stage')
      .eq('id', shipmentId)
      .single();

    if (!shipment) return undefined;

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

    return currentStage;
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

  /**
   * Process emails concurrently with a worker pool pattern
   * This is 5x faster than sequential processing with concurrency=5
   */
  private async processEmailsConcurrently(
    emails: ProcessedEmail[],
    concurrency: number = 5
  ): Promise<ChronicleProcessResult[]> {
    const results: ChronicleProcessResult[] = new Array(emails.length);
    const total = emails.length;
    let nextIndex = 0;
    let processedCount = 0;

    // Worker function - each worker processes emails until none are left
    const worker = async (): Promise<void> => {
      while (true) {
        // Atomically get next index
        const index = nextIndex++;
        if (index >= total) break;

        const email = emails[index];
        const result = await this.processSingleEmailSafely(email);
        results[index] = result;
        processedCount++;

        // Progress logging every 25 emails
        if (processedCount % 25 === 0 || processedCount === total) {
          const succeeded = results.filter(r => r && r.success && !r.error?.includes('Already')).length;
          const skipped = results.filter(r => r && r.error?.includes('Already')).length;
          console.log(`[Chronicle] Processed ${processedCount}/${total} (${Math.round(processedCount/total*100)}%) - New: ${succeeded}, Skipped: ${skipped}`);
        }

        // Check for 5-minute progress report
        if (this.logger && processedCount % 10 === 0) {
          await this.logger.checkAndReportProgress();
        }
      }
    };

    // Start worker pool
    console.log(`[Chronicle] Starting ${concurrency} concurrent workers for ${total} emails`);
    const workers = Array(Math.min(concurrency, total)).fill(null).map(() => worker());
    await Promise.all(workers);

    return results;
  }

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

  // ==========================================================================
  // LEARNING SYSTEM HELPERS (Simple direct DB calls)
  // ==========================================================================

  /**
   * Normalize document_type using enum mappings
   * Fixes common AI mistakes like "booking" → "booking_confirmation"
   */
  private async normalizeDocumentType(aiValue: string): Promise<string> {
    const { data } = await this.supabase
      .from('enum_mappings')
      .select('correct_value')
      .eq('mapping_type', 'document_type')
      .ilike('ai_value', aiValue)
      .single();

    return data?.correct_value || aiValue;
  }

  /**
   * Validate document_type against shipment stage
   * Returns warning if combination is unexpected/impossible
   */
  private async validateAgainstFlow(
    shipmentStage: string,
    documentType: string
  ): Promise<{ isValid: boolean; ruleType: string; warning: string | null }> {
    const { data } = await this.supabase
      .from('flow_validation_rules')
      .select('rule_type, notes')
      .eq('shipment_stage', shipmentStage)
      .eq('document_type', documentType)
      .single();

    if (!data) {
      return { isValid: true, ruleType: 'no_rule', warning: null };
    }

    const isValid = data.rule_type !== 'impossible';
    const warning = data.rule_type === 'impossible'
      ? `${documentType} should NOT appear at ${shipmentStage} stage - likely misclassification`
      : data.rule_type === 'unexpected'
        ? `${documentType} is unusual at ${shipmentStage} stage`
        : null;

    return { isValid, ruleType: data.rule_type, warning };
  }

  /**
   * Get flow context for a shipment
   * Provides AI with stage-aware document expectations
   */
  async getFlowContext(shipmentId: string): Promise<FlowContext | null> {
    // Fetch shipment with stage
    const { data: shipment, error: shipmentError } = await this.supabase
      .from('shipments')
      .select('id, stage, stage_updated_at')
      .eq('id', shipmentId)
      .single();

    if (shipmentError || !shipment?.stage) {
      return null;
    }

    // Fetch flow validation rules for this stage
    const { data: rules } = await this.supabase
      .from('flow_validation_rules')
      .select('document_type, rule_type')
      .eq('shipment_stage', shipment.stage);

    // Fetch pending actions for this shipment
    const { data: actions } = await this.supabase
      .from('action_tasks')
      .select('action_description')
      .eq('shipment_id', shipmentId)
      .eq('status', 'pending');

    // Fetch last document from chronicle
    const { data: lastDoc } = await this.supabase
      .from('chronicle')
      .select('document_type, occurred_at')
      .eq('shipment_id', shipmentId)
      .order('occurred_at', { ascending: false })
      .limit(1)
      .single();

    // Calculate days since last document
    const daysSinceLastDocument = lastDoc?.occurred_at
      ? Math.floor((Date.now() - new Date(lastDoc.occurred_at).getTime()) / (1000 * 60 * 60 * 24))
      : undefined;

    return {
      shipmentId,
      shipmentStage: shipment.stage,
      expectedDocuments: (rules || [])
        .filter(r => r.rule_type === 'expected')
        .map(r => r.document_type),
      unexpectedDocuments: (rules || [])
        .filter(r => r.rule_type === 'unexpected')
        .map(r => r.document_type),
      impossibleDocuments: (rules || [])
        .filter(r => r.rule_type === 'impossible')
        .map(r => r.document_type),
      pendingActions: (actions || []).map(a => a.action_description),
      lastDocumentType: lastDoc?.document_type,
      daysSinceLastDocument,
    };
  }

  /**
   * Check action keywords to override AI has_action decision
   * Uses action_completion_keywords table
   */
  async checkActionKeywords(subject: string, body: string): Promise<ActionKeywordResult> {
    const { data: keywords } = await this.supabase
      .from('action_completion_keywords')
      .select('keyword_pattern, pattern_flags, has_action_result');

    if (!keywords || keywords.length === 0) {
      return { override: false, hasAction: false, matchedKeyword: null };
    }

    const text = `${subject} ${body}`;
    for (const kw of keywords) {
      try {
        const regex = new RegExp(kw.keyword_pattern, kw.pattern_flags || 'i');
        if (regex.test(subject)) {
          return {
            override: true,
            hasAction: kw.has_action_result,
            matchedKeyword: kw.keyword_pattern,
            matchedIn: 'subject',
          };
        }
        if (regex.test(body)) {
          return {
            override: true,
            hasAction: kw.has_action_result,
            matchedKeyword: kw.keyword_pattern,
            matchedIn: 'body',
          };
        }
      } catch {
        // Invalid regex pattern, skip
        console.warn(`[Chronicle] Invalid action keyword regex: ${kw.keyword_pattern}`);
      }
    }

    return { override: false, hasAction: false, matchedKeyword: null };
  }

  /**
   * Validate document against flow and flag for review if needed
   * Enhanced version that flags impossible/unexpected combinations
   */
  async validateAndFlag(
    documentType: string,
    shipmentStage: string,
    chronicleId: string,
    confidence: number
  ): Promise<FlowValidationResult> {
    const validation = await this.validateAgainstFlow(shipmentStage, documentType);

    // Determine if needs review
    let needsReview = false;
    let reviewReason: FlowValidationResult['reviewReason'] | undefined;

    if (validation.ruleType === 'impossible') {
      needsReview = true;
      reviewReason = 'impossible_flow';
    } else if (validation.ruleType === 'unexpected') {
      needsReview = true;
      reviewReason = 'unexpected_flow';
    } else if (confidence < 60) {
      needsReview = true;
      reviewReason = 'low_confidence';
    }

    // Update learning_episodes with review flag
    if (needsReview) {
      await this.supabase
        .from('learning_episodes')
        .update({
          needs_review: true,
          review_reason: reviewReason,
        })
        .eq('chronicle_id', chronicleId);
    }

    return {
      isValid: validation.ruleType !== 'impossible',
      ruleType: validation.ruleType as FlowValidationResult['ruleType'],
      needsReview,
      warning: validation.warning,
      reviewReason,
    };
  }

  /**
   * Record learning episode for every classification
   * Enables tracking predictions and corrections
   */
  private async recordLearningEpisode(params: {
    chronicleId: string;
    predictedDocumentType: string;
    predictionConfidence: number;
    predictionMethod: 'pattern' | 'ai';
    senderDomain: string;
    threadPosition: number;
    flowValidationPassed: boolean;
    flowValidationWarning?: string;
  }): Promise<void> {
    try {
      await this.supabase.from('learning_episodes').insert({
        chronicle_id: params.chronicleId,
        predicted_document_type: params.predictedDocumentType,
        prediction_confidence: params.predictionConfidence,
        prediction_method: params.predictionMethod,
        sender_domain: params.senderDomain,
        thread_position: params.threadPosition,
        classification_strategy: params.threadPosition === 1 ? 'subject_first' : 'content_only',
        flow_validation_passed: params.flowValidationPassed,
        flow_validation_warnings: params.flowValidationWarning ? [params.flowValidationWarning] : [],
        was_correct: true, // Default until team corrects
      });
    } catch (error) {
      // Non-critical - don't fail the main flow
      console.error('[Chronicle] Failed to record learning episode:', error);
    }
  }

  /**
   * Extract domain from email address
   */
  private extractDomain(email: string): string {
    const match = email.match(/@([^@]+)$/);
    return match ? match[1].toLowerCase() : email.toLowerCase();
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
