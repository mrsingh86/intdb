/**
 * Classification Orchestrator
 *
 * Composes all classification services into a single pipeline.
 * Implements the Deep Module pattern: simple interface, complex composition hidden.
 *
 * PARALLEL Classification Architecture:
 *
 *                    ThreadContext
 *                         │
 *           ┌─────────────┼─────────────┐
 *           ▼             ▼             ▼
 *      Direction    Document        Email Type
 *      Detection    Classification  Classification
 *           │             │             │
 *           ▼             ▼             ▼
 *      inbound/     booking_conf,   approval_request,
 *      outbound     invoice, etc.   status_update, etc.
 *           │             │             │
 *           └─────────────┴─────────────┘
 *                         │
 *                         ▼
 *              Unified Classification Output
 *              (Document + Email Type + Direction)
 *
 * Document type answers: "What document is attached/referenced?"
 * Email type answers: "What is the sender trying to communicate/achieve?"
 * Both contribute to shipment intelligence and workflow state.
 */

import {
  ThreadContextService,
  createThreadContextService,
  ThreadContext,
} from './thread-context-service';
import {
  DocumentContentClassificationService,
  createDocumentContentClassificationService,
  DocumentContentResult,
} from './document-content-classification-service';
import {
  EmailContentClassificationService,
  createEmailContentClassificationService,
} from './email-content-classification-service';
import {
  EmailTypeClassificationService,
  createEmailTypeClassificationService,
  EmailTypeResult,
} from './email-type-classification-service';
import {
  DirectionDetectionService,
  DirectionResult,
} from '../direction-detection';
import {
  getWorkflowStateForDocument,
  isCarrierSender,
} from '../workflow-state-service';
import {
  EmailType,
  EmailCategory,
  SenderCategory,
  EmailSentiment,
  detectSentiment,
} from '../../config/email-type-config';
import {
  AIClassificationService,
  getAIClassificationService,
  AIClassificationResult,
} from './ai-classification-service';

// =============================================================================
// TYPES
// =============================================================================

export interface ClassificationInput {
  // Email metadata
  subject: string;
  senderEmail: string;
  senderName?: string;
  trueSenderEmail?: string | null;
  headers?: Record<string, string>;

  // Content
  bodyText?: string;
  attachmentFilenames?: string[];

  // PDF content (if available)
  pdfContent?: string;
}

export interface ClassificationOutput {
  // Document classification (from PDF content or email patterns)
  documentType: string;
  documentConfidence: number;
  documentMethod: 'pdf_content' | 'email_content' | 'fallback';
  documentSource: 'pdf' | 'attachment' | 'subject' | 'body' | 'unknown';
  documentMatchedMarkers?: string[];
  documentMatchedPattern?: string;

  // Email type classification (parallel to document)
  emailType: EmailType;
  emailCategory: EmailCategory;
  emailTypeConfidence: number;
  emailMatchedPatterns?: string[];

  // Sentiment analysis
  sentiment: EmailSentiment;
  sentimentScore: number;
  sentimentPatterns?: string[];

  // Sender
  senderCategory: SenderCategory;

  // Direction
  direction: 'inbound' | 'outbound';
  trueSender: string;
  directionConfidence: number;

  // Workflow (from document type - email workflow to be added later)
  documentWorkflowState: string | null;
  // emailWorkflowState: string | null;  // TODO: Add email workflow states

  // Thread context
  threadContext: ThreadContext;

  // Flags
  needsManualReview: boolean;
  isThreadReply: boolean;
  isUrgent: boolean;

  // AI fallback (when pattern matching has low confidence)
  usedAIFallback?: boolean;
  aiReasoning?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const MIN_CONFIDENCE_THRESHOLD = 70;
const UNKNOWN_DOCUMENT_TYPE = 'unknown';
const UNKNOWN_EMAIL_TYPE: EmailType = 'unknown';

// =============================================================================
// ORCHESTRATOR
// =============================================================================

export class ClassificationOrchestrator {
  private readonly threadContextService: ThreadContextService;
  private readonly documentClassifier: DocumentContentClassificationService;
  private readonly emailContentClassifier: EmailContentClassificationService;
  private readonly emailTypeClassifier: EmailTypeClassificationService;
  private readonly directionService: DirectionDetectionService;
  private readonly aiClassifier: AIClassificationService;

  constructor(
    threadContextService?: ThreadContextService,
    documentClassifier?: DocumentContentClassificationService,
    emailContentClassifier?: EmailContentClassificationService,
    emailTypeClassifier?: EmailTypeClassificationService,
    directionService?: DirectionDetectionService,
    aiClassifier?: AIClassificationService
  ) {
    this.threadContextService = threadContextService ?? createThreadContextService();
    this.documentClassifier = documentClassifier ?? createDocumentContentClassificationService();
    this.emailContentClassifier = emailContentClassifier ?? createEmailContentClassificationService();
    this.emailTypeClassifier = emailTypeClassifier ?? createEmailTypeClassificationService();
    this.directionService = directionService ?? new DirectionDetectionService();
    this.aiClassifier = aiClassifier ?? getAIClassificationService();
  }

  /**
   * Classify an email with full parallel pipeline.
   *
   * @param input - Email data to classify
   * @returns Complete classification output with document type AND email type
   */
  classify(input: ClassificationInput): ClassificationOutput {
    // Step 1: Extract thread context (FIRST - provides clean inputs for all services)
    const threadContext = this.threadContextService.extract({
      subject: input.subject,
      bodyText: input.bodyText,
      senderEmail: input.senderEmail,
      senderName: input.senderName,
      headers: input.headers,
    });

    // Step 2: Detect direction
    const directionResult = this.directionService.detectDirection({
      senderEmail: input.senderEmail,
      senderName: input.senderName,
      trueSenderEmail: input.trueSenderEmail,
      subject: input.subject,
      headers: input.headers,
    });

    // =========================================================================
    // PARALLEL CLASSIFICATION
    // =========================================================================

    // Step 3A: Document classification (PDF content → email content fallback)
    const documentResult = this.classifyDocument(input, threadContext, directionResult);

    // Step 3B: Email type classification (parallel, not fallback)
    const emailTypeResult = this.classifyEmailType(input, threadContext);

    // Step 3C: Sentiment analysis (parallel)
    const sentimentResult = detectSentiment(input.subject, input.bodyText);

    // Step 4: Map to workflow states
    const documentWorkflowState = getWorkflowStateForDocument(
      documentResult.documentType,
      directionResult.direction
    );

    // Determine if urgent (sentiment-based or email type-based)
    const isUrgent = sentimentResult.sentiment === 'urgent' ||
                     sentimentResult.sentiment === 'escalated' ||
                     emailTypeResult.emailType === 'urgent_action' ||
                     emailTypeResult.emailType === 'escalation';

    // Build unified output
    return {
      // Document classification
      documentType: documentResult.documentType,
      documentConfidence: documentResult.confidence,
      documentMethod: documentResult.method,
      documentSource: documentResult.source,
      documentMatchedMarkers: documentResult.matchedMarkers,
      documentMatchedPattern: documentResult.matchedPattern,

      // Email type classification
      emailType: emailTypeResult.emailType,
      emailCategory: emailTypeResult.category,
      emailTypeConfidence: emailTypeResult.confidence,
      emailMatchedPatterns: emailTypeResult.matchedPatterns,

      // Sentiment analysis
      sentiment: sentimentResult.sentiment,
      sentimentScore: sentimentResult.score,
      sentimentPatterns: sentimentResult.matchedPatterns,

      // Sender
      senderCategory: emailTypeResult.senderCategory,

      // Direction
      direction: directionResult.direction,
      trueSender: directionResult.trueSender,
      directionConfidence: directionResult.confidence,

      // Workflow
      documentWorkflowState,

      // Thread context
      threadContext,

      // Flags
      needsManualReview: this.needsManualReview(documentResult, emailTypeResult),
      isThreadReply: threadContext.isReply,
      isUrgent,
    };
  }

  /**
   * Classify an email with AI fallback for low-confidence results.
   *
   * Uses pattern matching first, then falls back to AI when:
   * - Sender category = 'unknown'
   * - Email type = 'unknown' or confidence < threshold
   *
   * @param input - Email data to classify
   * @returns Complete classification output, potentially enhanced by AI
   */
  async classifyWithAI(input: ClassificationInput): Promise<ClassificationOutput> {
    // First, run pattern-based classification
    const result = this.classify(input);

    // Check if AI fallback is needed
    const needsAIForSender = result.senderCategory === 'unknown';
    const needsAIForEmailType = result.emailType === 'unknown' ||
                                result.emailTypeConfidence < MIN_CONFIDENCE_THRESHOLD;

    if (!needsAIForSender && !needsAIForEmailType) {
      // Pattern matching is confident enough
      return result;
    }

    // Check if AI service is available
    if (!this.aiClassifier.isEnabled()) {
      console.warn('[ClassificationOrchestrator] AI fallback needed but service not available');
      return result;
    }

    // Call AI classification
    const aiResult = await this.aiClassifier.classify({
      subject: input.subject,
      senderEmail: input.senderEmail,
      trueSenderEmail: input.trueSenderEmail,
      bodyText: input.bodyText,
      attachmentFilenames: input.attachmentFilenames,
    });

    if (!aiResult) {
      return result;
    }

    // Merge AI results with pattern results (AI fills gaps)
    const mergedResult: ClassificationOutput = {
      ...result,
      usedAIFallback: true,
      aiReasoning: aiResult.reasoning,
    };

    // Update sender category if pattern returned unknown
    if (needsAIForSender && aiResult.senderCategory !== 'unknown') {
      mergedResult.senderCategory = aiResult.senderCategory;
    }

    // Update email type if pattern returned unknown/low confidence
    if (needsAIForEmailType && aiResult.emailType !== 'unknown') {
      mergedResult.emailType = aiResult.emailType;
      mergedResult.emailCategory = aiResult.emailCategory;
      mergedResult.emailTypeConfidence = aiResult.confidence;
    }

    // Update sentiment if AI detected urgent/escalated
    if (aiResult.sentiment === 'urgent' || aiResult.sentiment === 'escalated') {
      mergedResult.sentiment = aiResult.sentiment;
      mergedResult.isUrgent = true;
    }

    // Recalculate needsManualReview with merged results
    mergedResult.needsManualReview =
      (mergedResult.documentType === UNKNOWN_DOCUMENT_TYPE || mergedResult.documentConfidence < MIN_CONFIDENCE_THRESHOLD) &&
      (mergedResult.emailType === UNKNOWN_EMAIL_TYPE || mergedResult.emailTypeConfidence < MIN_CONFIDENCE_THRESHOLD);

    return mergedResult;
  }

  /**
   * Classify document type (PDF content → email content fallback).
   */
  private classifyDocument(
    input: ClassificationInput,
    threadContext: ThreadContext,
    directionResult: DirectionResult
  ): {
    documentType: string;
    confidence: number;
    method: 'pdf_content' | 'email_content' | 'fallback';
    source: 'pdf' | 'attachment' | 'subject' | 'body' | 'unknown';
    matchedMarkers?: string[];
    matchedPattern?: string;
  } {
    // Try PDF content classification first (primary method)
    if (input.pdfContent) {
      const pdfResult = this.documentClassifier.classify({
        pdfContent: input.pdfContent,
      });

      if (pdfResult && pdfResult.confidence >= MIN_CONFIDENCE_THRESHOLD) {
        return {
          documentType: pdfResult.documentType,
          confidence: pdfResult.confidence,
          method: 'pdf_content',
          source: 'pdf',
          matchedMarkers: pdfResult.matchedMarkers,
        };
      }
    }

    // Fallback to email content classification
    const emailResult = this.emailContentClassifier.classify({
      threadContext,
      attachmentFilenames: input.attachmentFilenames,
    });

    if (emailResult && emailResult.confidence >= MIN_CONFIDENCE_THRESHOLD) {
      // Check for thread reply issues (inherited subject from non-carrier)
      const shouldSkip = this.emailContentClassifier.shouldSkipThreadReply(
        threadContext,
        isCarrierSender(directionResult.trueSender),
        emailResult.documentType
      );

      if (!shouldSkip) {
        return {
          documentType: emailResult.documentType,
          confidence: emailResult.confidence,
          method: 'email_content',
          source: emailResult.source,
          matchedPattern: emailResult.matchedPattern,
        };
      }
    }

    // No confident classification
    return {
      documentType: UNKNOWN_DOCUMENT_TYPE,
      confidence: 0,
      method: 'fallback',
      source: 'unknown',
    };
  }

  /**
   * Classify email type (intent/action).
   */
  private classifyEmailType(
    input: ClassificationInput,
    threadContext: ThreadContext
  ): {
    emailType: EmailType;
    category: EmailCategory;
    confidence: number;
    matchedPatterns?: string[];
    senderCategory: SenderCategory;
  } {
    const result = this.emailTypeClassifier.classify({
      threadContext,
      senderEmail: input.senderEmail,
      bodyText: input.bodyText,
    });

    if (result && result.confidence >= MIN_CONFIDENCE_THRESHOLD) {
      return {
        emailType: result.emailType,
        category: result.category,
        confidence: result.confidence,
        matchedPatterns: result.matchedPatterns,
        senderCategory: result.senderCategory,
      };
    }

    // No confident classification - return general_correspondence
    const senderCategory = this.emailTypeClassifier.getSenderCategory(input.senderEmail);
    return {
      emailType: threadContext.isReply ? 'general_correspondence' : UNKNOWN_EMAIL_TYPE,
      category: 'communication',
      confidence: 0,
      senderCategory,
    };
  }

  /**
   * Determine if manual review is needed.
   */
  private needsManualReview(
    documentResult: { documentType: string; confidence: number },
    emailTypeResult: { emailType: EmailType; confidence: number }
  ): boolean {
    // Needs review if both classifications are low confidence
    const lowDocConfidence = documentResult.confidence < MIN_CONFIDENCE_THRESHOLD ||
                            documentResult.documentType === UNKNOWN_DOCUMENT_TYPE;
    const lowEmailConfidence = emailTypeResult.confidence < MIN_CONFIDENCE_THRESHOLD ||
                               emailTypeResult.emailType === UNKNOWN_EMAIL_TYPE;

    // If document is unknown but email type is known, might still be ok
    // If both are unknown, definitely needs review
    return lowDocConfidence && lowEmailConfidence;
  }

  /**
   * Classify with PDF content only (for reclassification scripts).
   */
  classifyByPdfContent(pdfContent: string): DocumentContentResult | null {
    return this.documentClassifier.classify({ pdfContent });
  }

  /**
   * Classify email type only (utility method).
   */
  classifyEmailTypeOnly(input: {
    subject: string;
    senderEmail: string;
    bodyText?: string;
  }): EmailTypeResult | null {
    const threadContext = this.threadContextService.extract({
      subject: input.subject,
      bodyText: input.bodyText,
      senderEmail: input.senderEmail,
    });

    return this.emailTypeClassifier.classify({
      threadContext,
      senderEmail: input.senderEmail,
      bodyText: input.bodyText,
    });
  }

  /**
   * Extract thread context only (utility method).
   */
  extractThreadContext(input: {
    subject: string;
    bodyText?: string;
    senderEmail: string;
    senderName?: string;
    headers?: Record<string, string>;
  }): ThreadContext {
    return this.threadContextService.extract(input);
  }

  /**
   * Detect direction only (utility method).
   */
  detectDirection(input: {
    senderEmail: string;
    senderName?: string;
    trueSenderEmail?: string | null;
    subject: string;
    headers?: Record<string, string>;
  }): DirectionResult {
    return this.directionService.detectDirection(input);
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new ClassificationOrchestrator instance.
 */
export function createClassificationOrchestrator(): ClassificationOrchestrator {
  return new ClassificationOrchestrator();
}
