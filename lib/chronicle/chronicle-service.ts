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
} from './interfaces';
import { ChronicleGmailService } from './gmail-service';
import { PdfExtractor } from './pdf-extractor';
import { AiAnalyzer } from './ai-analyzer';
import { ChronicleRepository } from './chronicle-repository';
import { AI_CONFIG } from './prompts/freight-forwarder.prompt';
import { ChronicleLogger } from './chronicle-logger';
import { ChronicleDataMapper, ConfidenceData } from './chronicle-data-mapper';
import { ShipmentLinker } from './shipment-linker';
import { AttachmentExtractor } from './attachment-extractor';
import {
  PatternMatcherService,
  IPatternMatcherService,
  PatternMatchResult,
  emailToPatternInput,
} from './pattern-matcher';
import {
  UnifiedActionService,
  createUnifiedActionService,
  ActionRecommendation,
} from './unified-action-service';
import {
  ActionAutoResolveService,
  createActionAutoResolveService,
} from './action-auto-resolve-service';
import {
  ObjectiveConfidenceService,
  createObjectiveConfidenceService,
  ConfidenceResult,
  ConfidenceInput,
} from './objective-confidence-service';
import {
  SemanticContextService,
  createSemanticContextService,
  ISemanticContextService,
} from './semantic-context-service';
import {
  EmbeddingService,
  createEmbeddingService,
  IEmbeddingService,
} from './embedding-service';
import {
  createMemoryService,
  IMemoryService,
  buildMemoryContextForAI,
  updateMemoryAfterProcessing,
  AiContextOptions,
} from '../memory';

// ============================================================================
// SERVICE IMPLEMENTATION
// ============================================================================

export class ChronicleService implements IChronicleService {
  private supabase: SupabaseClient;
  private gmailService: IGmailService;
  private pdfExtractor: IPdfExtractor;
  private aiAnalyzer: IAiAnalyzer;
  private patternMatcher: IPatternMatcherService;
  private unifiedActionService: UnifiedActionService;
  private actionAutoResolveService: ActionAutoResolveService;
  private confidenceService: ObjectiveConfidenceService;
  private semanticContextService: ISemanticContextService | null = null;
  private embeddingService: IEmbeddingService | null = null;
  private memoryService: IMemoryService | null = null;
  private repository: IChronicleRepository;
  private logger: ChronicleLogger | null = null;

  // Extracted services (P2-15 God class decomposition)
  private shipmentLinker: ShipmentLinker;
  private attachmentExtractor: AttachmentExtractor;

  // Metrics for pattern matching performance
  private patternMatchStats = { matched: 0, aiNeeded: 0 };
  // Metrics for action determination
  private actionStats = { ruleDefault: 0, ruleFlipped: 0, aiFallback: 0 };
  // Metrics for confidence-based escalation
  private confidenceStats = { accepted: 0, flagged: 0, escalatedSonnet: 0, escalatedOpus: 0 };
  // Metrics for semantic context usage
  private semanticContextStats = { used: 0, skipped: 0, errors: 0 };
  // Metrics for memory context usage
  private memoryContextStats = { used: 0, skipped: 0, errors: 0, tokensSaved: 0 };

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
    this.unifiedActionService = createUnifiedActionService(supabase);
    this.actionAutoResolveService = createActionAutoResolveService(supabase);
    this.confidenceService = createObjectiveConfidenceService(supabase);
    this.repository = new ChronicleRepository(supabase);
    this.logger = logger || null;

    // Extracted services (P2-15 decomposition)
    this.shipmentLinker = new ShipmentLinker(supabase, this.repository, this.actionAutoResolveService, this.logger);
    this.attachmentExtractor = new AttachmentExtractor(this.gmailService, this.pdfExtractor, this.logger);

    // Initialize semantic context service (uses embeddings for AI context enrichment)
    this.initializeSemanticContext(supabase);

    // Initialize memory service (DIY memory layer - replaces Mem0)
    this.initializeMemoryService(supabase);
  }

  /**
   * Initialize semantic context service
   * Gracefully handles missing config - feature will be disabled if unavailable
   */
  private initializeSemanticContext(supabase: SupabaseClient): void {
    try {
      this.embeddingService = createEmbeddingService(supabase);
      this.semanticContextService = createSemanticContextService(supabase, this.embeddingService);
      console.log('[Chronicle] Semantic context + embedding services initialized');
    } catch (error) {
      console.warn('[Chronicle] Semantic context service unavailable:', error);
      this.semanticContextService = null;
      this.embeddingService = null;
    }
  }

  /**
   * Initialize memory service (DIY memory layer)
   * Replaces Mem0 Cloud with self-hosted solution ($0/month vs $249/month)
   */
  private initializeMemoryService(supabase: SupabaseClient): void {
    try {
      this.memoryService = createMemoryService(supabase);
      console.log('[Chronicle] Memory service initialized (DIY layer)');
    } catch (error) {
      console.warn('[Chronicle] Memory service unavailable:', error);
      this.memoryService = null;
    }
  }

  /**
   * Set logger for this service (can be set after construction)
   */
  setLogger(logger: ChronicleLogger): void {
    this.logger = logger;
    this.shipmentLinker.setLogger(logger);
    this.attachmentExtractor.setLogger(logger);
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
   * Get confidence-based escalation statistics
   * Shows cost optimization effectiveness
   */
  getConfidenceStats(): {
    accepted: number;
    flagged: number;
    escalatedSonnet: number;
    escalatedOpus: number;
    escalationRate: string;
  } {
    const total = this.confidenceStats.accepted + this.confidenceStats.flagged +
      this.confidenceStats.escalatedSonnet + this.confidenceStats.escalatedOpus;
    const escalated = this.confidenceStats.escalatedSonnet + this.confidenceStats.escalatedOpus;
    const rate = total > 0 ? `${Math.round((escalated / total) * 100)}%` : '0%';
    return { ...this.confidenceStats, escalationRate: rate };
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
    // Step 0: Check retry cap - skip emails that have failed 3+ times
    const MAX_RETRIES = 3;
    const retryCount = await this.getErrorCount(email.gmailMessageId);
    if (retryCount >= MAX_RETRIES) {
      console.log(`[Chronicle] Skipping ${email.gmailMessageId}: ${retryCount} prior failures (max ${MAX_RETRIES})`);
      this.logger?.logEmailProcessed(true, true); // skipped
      return {
        success: false,
        gmailMessageId: email.gmailMessageId,
        error: `Skipped: exceeded max retries (${retryCount}/${MAX_RETRIES})`,
      };
    }

    // Step 1: Check idempotency
    const existing = await this.checkIfAlreadyProcessed(email.gmailMessageId);
    if (existing) {
      this.logger?.logEmailProcessed(true, true); // skipped
      return existing;
    }

    // Step 2: Extract attachments (with logging)
    const { attachmentText, attachmentsWithText } = await this.attachmentExtractor.extractAttachments(email);

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

    // Step 5b: Get action recommendation from UnifiedActionService
    // Uses action_rules table for all action determination (replaces ActionRulesService + PreciseActionService)
    const isReply = threadPosition > 1;
    const shipmentContext = await this.shipmentLinker.getShipmentContextByIdentifiers(analysis);
    const actionRecommendation = await this.unifiedActionService.getRecommendation(
      analysis.document_type,
      analysis.from_party || 'unknown',
      isReply,
      email.subject,
      email.bodyText,
      email.receivedAt,
      shipmentContext || undefined
    );

    // Apply action recommendation to analysis
    analysis.has_action = actionRecommendation.hasAction;
    analysis.action_description = actionRecommendation.actionDescription;
    analysis.action_owner = actionRecommendation.owner as typeof analysis.action_owner;
    analysis.action_deadline = actionRecommendation.deadline
      ? actionRecommendation.deadline.toISOString().split('T')[0]
      : null;
    analysis.action_priority = this.mapPriorityLabel(actionRecommendation.priorityLabel);

    // Track action stats
    this.trackActionStatsUnified(actionRecommendation);

    // Log action determination
    if (actionRecommendation.hasAction) {
      console.log(`[Chronicle] Action: ${actionRecommendation.actionVerb} (${actionRecommendation.priorityLabel}, owner: ${actionRecommendation.owner}, source: ${actionRecommendation.source})`);
    }
    if (actionRecommendation.wasFlipped) {
      console.log(`[Chronicle] Action flipped by keyword: "${actionRecommendation.flipKeyword}"`);
    }

    // Track classification method for learning
    const predictionMethod = patternResult?.matched && !patternResult.requiresAiFallback ? 'pattern' : 'ai';
    let predictionConfidence = patternResult?.matched ? patternResult.confidence : 75; // Default AI confidence

    // Step 5c: Calculate objective confidence and escalate if needed
    // Only for AI-analyzed emails (pattern matches are already high confidence)
    let confidenceResult: ConfidenceResult | null = null;
    let confidenceSource: 'pattern' | 'haiku' | 'sonnet' | 'opus' = usePatternMatch ? 'pattern' : 'haiku';
    let escalatedTo: string | null = null;
    let escalationReason: string | null = null;

    // Skip confidence calculation for very short emails (< 50 chars) - nothing to re-extract
    const hasSubstantialContent = (email.bodyText?.length || 0) + (attachmentText?.length || 0) > 50;

    if (!usePatternMatch && hasSubstantialContent) {
      confidenceResult = await this.calculateConfidenceAndEscalate(
        email,
        analysis,
        attachmentText,
        threadContext,
        threadPosition,
        patternResult
      );

      // If escalation occurred, analysis was updated in place
      if (confidenceResult.recommendation === 'escalate_sonnet') {
        confidenceSource = 'sonnet';
        escalatedTo = 'sonnet';
        escalationReason = confidenceResult.reasoning.join('; ');
        this.confidenceStats.escalatedSonnet++;
      } else if (confidenceResult.recommendation === 'escalate_opus') {
        confidenceSource = 'opus';
        escalatedTo = 'opus';
        escalationReason = confidenceResult.reasoning.join('; ');
        this.confidenceStats.escalatedOpus++;
      } else if (confidenceResult.recommendation === 'flag_review') {
        this.confidenceStats.flagged++;
      } else {
        this.confidenceStats.accepted++;
      }

      predictionConfidence = confidenceResult.overallScore;
      console.log(`[Chronicle] Confidence: ${confidenceResult.overallScore}% → ${confidenceResult.recommendation}`);
    } else if (!usePatternMatch) {
      // Short email - accept Haiku result, no escalation (nothing to re-extract)
      console.log(`[Chronicle] Skipping confidence (short email: ${email.bodyText?.length || 0} chars)`);
      this.confidenceStats.accepted++;
    } else {
      // Pattern match - high confidence, no escalation needed
      this.confidenceStats.accepted++;
    }

    // Step 6: Save to database (with logging)
    const dbStart = this.logger?.logStageStart('db_save') || 0;
    let chronicleId: string;
    try {
      chronicleId = await this.saveToDatabase(
        email,
        analysis,
        attachmentsWithText,
        actionRecommendation,
        {
          confidenceSource,
          confidenceSignals: confidenceResult?.signals || null,
          escalatedTo,
          escalationReason,
        }
      );
      this.logger?.logStageSuccess('db_save', dbStart);
    } catch (error) {
      this.logger?.logStageFailure('db_save', dbStart, error as Error, {
        gmailMessageId: email.gmailMessageId,
      }, false);
      this.logger?.logEmailProcessed(false);
      throw error;
    }

    // Step 7: Link to shipment and track stage (with logging)
    const { shipmentId, linkedBy, shipmentStage } = await this.shipmentLinker.linkAndTrackShipment(
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

    // Step 10: Update memory layer (for continuous learning)
    await this.updateMemoryAfterSuccess(email, analysis, predictionConfidence, usePatternMatch);

    this.logger?.logEmailProcessed(true);
    return this.createSuccessResult(email.gmailMessageId, chronicleId, shipmentId, linkedBy);
  }

  /**
   * Update memory layer after successful processing
   * Learns sender profiles, shipment context, and new patterns
   */
  private async updateMemoryAfterSuccess(
    email: ProcessedEmail,
    analysis: ShippingAnalysis,
    confidence: number,
    patternMatched: boolean
  ): Promise<void> {
    if (!this.memoryService) return;

    try {
      const result = await updateMemoryAfterProcessing(this.memoryService, {
        email: {
          subject: email.subject,
          senderEmail: email.senderEmail,
          senderDomain: this.extractDomain(email.senderEmail),
          bodyPreview: email.bodyText.substring(0, 500),
        },
        analysis: {
          document_type: analysis.document_type,
          booking_number: analysis.booking_number || undefined,
          mbl_number: analysis.mbl_number || undefined,
          etd: analysis.etd || undefined,
          eta: analysis.eta || undefined,
          vessel_name: analysis.vessel_name || undefined,
          summary: analysis.summary || undefined,
          from_party: analysis.from_party || undefined,
        },
        confidence,
        processingTime: 0, // Not tracked at this level
        patternMatched,
      });

      if (result.updated.length > 0) {
        console.log(`[Chronicle] Memory updated: ${result.updated.join(', ')}`);
      }
    } catch (error) {
      // Non-critical - don't fail the main flow
      console.warn('[Chronicle] Memory update failed:', error);
    }
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
   * Run AI analysis with thread position awareness and memory context
   * Position 1: AI uses subject + body + attachments
   * Position 2+: AI ignores subject (stale from forwarding)
   * Memory context: Sender profiles, shipment context, error patterns (77% fewer tokens)
   */
  private async runAiAnalysis(
    email: ProcessedEmail,
    attachmentText: string,
    threadContext: ThreadContext | null,
    threadPosition: number
  ): Promise<ShippingAnalysis> {
    const aiStart = this.logger?.logStageStart('ai_analysis') || 0;
    try {
      // Prefer memory context (77% token savings) over semantic context
      // Memory context: ~1.8K tokens vs Semantic context: ~8K tokens
      let contextSection = await this.getMemoryContextSection(email);

      // Fallback to semantic context if memory context unavailable
      if (!contextSection && this.semanticContextService) {
        contextSection = await this.getSemanticContextSection(email);
      }

      const analysis = await this.aiAnalyzer.analyze(
        email,
        attachmentText,
        threadContext || undefined,
        threadPosition,
        undefined, // modelOverride
        contextSection
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
   * Get semantic context section for AI prompt
   * Returns empty string if semantic context service is unavailable or fails
   */
  private async getSemanticContextSection(email: ProcessedEmail): Promise<string> {
    if (!this.semanticContextService) {
      this.semanticContextStats.skipped++;
      return '';
    }

    try {
      // Extract booking/MBL from subject for related docs lookup
      const { bookingNumber, mblNumber } = this.extractIdentifiersFromSubject(email.subject);

      const context = await this.semanticContextService.getContextForNewEmail(
        email.subject,
        email.bodyText.substring(0, 500),
        email.senderEmail,
        bookingNumber,
        mblNumber
      );

      // Only include if we found meaningful context
      const hasContext = context.similarEmails.length > 0 ||
        context.senderHistory !== null ||
        context.relatedDocs.length > 0;

      if (hasContext) {
        this.semanticContextStats.used++;
        return this.semanticContextService.buildPromptSection(context);
      }

      this.semanticContextStats.skipped++;
      return '';
    } catch (error) {
      console.warn('[Chronicle] Semantic context fetch failed:', error);
      this.semanticContextStats.errors++;
      return ''; // Graceful degradation - continue without semantic context
    }
  }

  /**
   * Get memory context section for AI prompt
   * Uses DIY memory layer instead of semantic context
   * Token savings: ~8K → ~1.8K (77% reduction)
   */
  private async getMemoryContextSection(email: ProcessedEmail): Promise<string> {
    if (!this.memoryService) {
      this.memoryContextStats.skipped++;
      return '';
    }

    try {
      const senderDomain = this.extractDomain(email.senderEmail);
      const { bookingNumber } = this.extractIdentifiersFromSubject(email.subject);

      const options: AiContextOptions = {
        email: {
          subject: email.subject,
          bodyPreview: email.bodyText.substring(0, 500),
          senderEmail: email.senderEmail,
          senderDomain,
        },
        bookingNumber: bookingNumber || undefined,
        carrier: this.detectCarrierFromDomain(senderDomain),
      };

      const result = await buildMemoryContextForAI(this.memoryService, options);

      if (result.memories.length > 0) {
        this.memoryContextStats.used++;
        // Track estimated token savings (semantic ~8K vs memory ~1.8K)
        this.memoryContextStats.tokensSaved += Math.max(0, 8000 - result.tokenEstimate);
        console.log(`[Chronicle] Memory context: ${result.memories.length} memories, ~${result.tokenEstimate} tokens`);
        return result.context;
      }

      this.memoryContextStats.skipped++;
      return '';
    } catch (error) {
      console.warn('[Chronicle] Memory context fetch failed:', error);
      this.memoryContextStats.errors++;
      return '';
    }
  }

  /**
   * Detect carrier from sender domain
   */
  private detectCarrierFromDomain(domain: string): string | undefined {
    const carrierDomains: Record<string, string> = {
      'maersk.com': 'maersk',
      'hapag-lloyd.com': 'hapag',
      'hlag.com': 'hapag',
      'cma-cgm.com': 'cma',
      'msc.com': 'msc',
      'one-line.com': 'one',
      'evergreen-marine.com': 'evergreen',
      'cosco.com': 'cosco',
      'oocl.com': 'oocl',
    };

    for (const [d, carrier] of Object.entries(carrierDomains)) {
      if (domain.includes(d)) return carrier;
    }
    return undefined;
  }

  /**
   * Get memory context stats for monitoring
   */
  getMemoryContextStats(): { used: number; skipped: number; errors: number; tokensSaved: number } {
    return { ...this.memoryContextStats };
  }

  /**
   * Extract booking number and MBL from subject line for context lookup
   * Quick regex extraction - not full parsing
   */
  private extractIdentifiersFromSubject(subject: string): { bookingNumber: string | null; mblNumber: string | null } {
    // Common booking number patterns (pure numeric 9-10 digits)
    const bookingMatch = subject.match(/\b(\d{9,10})\b/);
    // MBL patterns (carrier prefix + digits)
    const mblMatch = subject.match(/\b(MAEU|HLCU|COSU|OOLU|CMDU|MEDU|ONEY|ZIMU|MSCU|EGLV)\d{6,12}\b/i);

    return {
      bookingNumber: bookingMatch ? bookingMatch[1] : null,
      mblNumber: mblMatch ? mblMatch[0].toUpperCase() : null,
    };
  }

  /**
   * Calculate objective confidence and escalate to stronger model if needed
   * Returns confidence result (analysis may be updated in place if escalated)
   */
  // Document types where escalation to Sonnet/Opus would NOT improve extraction
  // These are communication types with no structured shipping data to extract
  private static readonly NON_SHIPPING_DOC_TYPES = new Set([
    'general_correspondence', 'notification',
    'internal_notification', 'approval',
    'approval', 'request', 'escalation', 'unknown',
  ]);

  private async calculateConfidenceAndEscalate(
    email: ProcessedEmail,
    analysis: ShippingAnalysis,
    attachmentText: string,
    threadContext: ThreadContext | null,
    threadPosition: number,
    patternResult: PatternMatchResult | null
  ): Promise<ConfidenceResult> {
    // Build confidence input from current analysis
    const confidenceInput: ConfidenceInput = {
      chronicleId: '', // Will be set after save
      documentType: analysis.document_type,
      extractedFields: this.buildExtractedFields(analysis),
      senderEmail: email.senderEmail,
      patternId: patternResult?.patternId || undefined,
      patternConfidence: patternResult?.confidence,
      shipmentId: undefined, // Not linked yet
    };

    const confidence = await this.confidenceService.calculateConfidence(confidenceInput);

    // Skip escalation for non-shipping document types (saves ~50% of wasted escalations)
    // Sonnet/Opus won't extract better data from "OK, noted" or "Please see attached" emails
    if (ChronicleService.NON_SHIPPING_DOC_TYPES.has(analysis.document_type)) {
      if (confidence.recommendation === 'escalate_sonnet' || confidence.recommendation === 'escalate_opus') {
        console.log(`[Chronicle] Skipping escalation for non-shipping type: ${analysis.document_type}`);
        confidence.recommendation = 'accept';
      }
    }

    // Get semantic context for escalation (reuse the same context for stronger model)
    const semanticContextSection = await this.getSemanticContextSection(email);

    // Escalate if confidence is too low
    if (confidence.recommendation === 'escalate_sonnet') {
      console.log(`[Chronicle] Escalating to Sonnet (confidence: ${confidence.overallScore}%)`);
      const reanalysis = await this.aiAnalyzer.analyze(
        email,
        attachmentText,
        threadContext || undefined,
        threadPosition,
        'claude-sonnet-4-20250514', // Sonnet model
        semanticContextSection
      );
      Object.assign(analysis, reanalysis);
    } else if (confidence.recommendation === 'escalate_opus') {
      console.log(`[Chronicle] Escalating to Opus (confidence: ${confidence.overallScore}%)`);
      const reanalysis = await this.aiAnalyzer.analyze(
        email,
        attachmentText,
        threadContext || undefined,
        threadPosition,
        'claude-opus-4-20250514', // Opus model
        semanticContextSection
      );
      Object.assign(analysis, reanalysis);
    }

    return confidence;
  }

  /**
   * Build extracted fields object for confidence calculation
   */
  private buildExtractedFields(analysis: ShippingAnalysis): Record<string, unknown> {
    return {
      // Core shipping identifiers
      booking_number: analysis.booking_number,
      mbl_number: analysis.mbl_number,
      hbl_number: analysis.hbl_number,
      vessel_name: analysis.vessel_name,
      voyage_number: analysis.voyage_number,
      // Dates
      etd: analysis.etd,
      eta: analysis.eta,
      // Routing
      pol_location: analysis.pol_location,
      pod_location: analysis.pod_location,
      carrier_name: analysis.carrier_name,
      // Cargo
      container_numbers: analysis.container_numbers,
      // Parties
      shipper_name: analysis.shipper_name,
      consignee_name: analysis.consignee_name,
      // Cutoffs
      si_cutoff: analysis.si_cutoff,
      vgm_cutoff: analysis.vgm_cutoff,
      cargo_cutoff: analysis.cargo_cutoff,
      doc_cutoff: analysis.doc_cutoff,
      // Non-shipping fields (for general_correspondence, invoice, etc.)
      summary: analysis.summary,
      invoice_number: analysis.invoice_number,
      work_order_number: analysis.work_order_number,
      pod_delivery_date: analysis.pod_delivery_date,
      pod_signed_by: analysis.pod_signed_by,
    };
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
    const analysis: ShippingAnalysis = {
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

      // Intelligence - defaults, will be updated by UnifiedActionService in processEmail
      message_type: this.inferMessageType(documentType),
      sentiment: 'neutral',
      summary: `${documentType.replace(/_/g, ' ')} notification`,
      has_action: false,  // Will be set by UnifiedActionService
      action_description: null,
      action_owner: null,
      action_deadline: null,
      action_priority: null,
      has_issue: false,
      issue_type: null,
      issue_description: null,
    };

    // Action determination is now handled by UnifiedActionService in processEmail
    // after both pattern matching and AI classification
    return analysis;
  }

  /**
   * Track action determination statistics (unified service)
   */
  private trackActionStatsUnified(action: ActionRecommendation): void {
    if (action.source === 'rule') this.actionStats.ruleDefault++;
    else if (action.source === 'rule_flipped') this.actionStats.ruleFlipped++;
    else this.actionStats.aiFallback++;
  }

  /**
   * Get action determination statistics for monitoring
   */
  getActionStats(): { ruleDefault: number; ruleFlipped: number; aiFallback: number } {
    return { ...this.actionStats };
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

  /**
   * Map priority label to ShippingAnalysis action_priority enum
   * URGENT → critical, HIGH → high, MEDIUM → medium, LOW → low
   */
  private mapPriorityLabel(label: string): ShippingAnalysis['action_priority'] {
    switch (label.toUpperCase()) {
      case 'URGENT': return 'critical';
      case 'HIGH': return 'high';
      case 'MEDIUM': return 'medium';
      case 'LOW': return 'low';
      default: return 'medium';
    }
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

  private async saveToDatabase(
    email: ProcessedEmail,
    analysis: ShippingAnalysis,
    attachmentsWithText: ProcessedAttachment[],
    actionRecommendation?: ActionRecommendation,
    confidenceData?: ConfidenceData
  ): Promise<string> {
    const insertData = ChronicleDataMapper.buildInsertData(
      email, analysis, attachmentsWithText, actionRecommendation, confidenceData
    );
    const { id } = await this.repository.insert(insertData);

    // Generate embedding for semantic search (non-blocking)
    if (this.embeddingService) {
      this.embeddingService.generateEmbedding(id).catch(err => {
        console.warn(`[Chronicle] Failed to generate embedding for ${id}:`, err.message);
      });
    }

    return id;
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
  // PRIVATE - RETRY CAP
  // ==========================================================================

  /**
   * Count how many times this email has failed (in chronicle_errors table)
   * Used to enforce max-retry cap and avoid infinite reprocessing
   */
  private async getErrorCount(gmailMessageId: string): Promise<number> {
    try {
      const { count } = await this.supabase
        .from('chronicle_errors')
        .select('*', { count: 'exact', head: true })
        .eq('gmail_message_id', gmailMessageId);
      return count ?? 0;
    } catch {
      return 0; // If error check fails, allow processing
    }
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
