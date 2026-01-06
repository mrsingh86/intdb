/**
 * Direction Detection Service
 *
 * Standalone service for determining email direction (inbound/outbound)
 * with support for deep thread navigation and true sender extraction.
 */

import { extractTrueSender, TrueSenderResult } from './true-sender-extractor';
import {
  extractDomain,
  isIntogloDomain,
  isCarrierDomain,
  classifyDomain,
} from './domain-classifier';
import {
  DirectionResult,
  EmailDirection,
  EmailInput,
  ThreadEmail,
  ThreadAnalysis,
  DetectionMethod,
} from './types';

/**
 * Carrier subject patterns that indicate inbound even from Intoglo addresses
 * (forwarded carrier emails)
 */
const CARRIER_SUBJECT_PATTERNS = [
  /^booking\s+(confirmation|amendment)\s*:/i,
  /^cosco\s+shipping\s+line\s+booking/i,
  /^cma\s*cgm\s*-\s*booking\s+confirmation/i,
  /^arrival\s+notice\s+\d{9}/i,
  /^cosco\s+arrival\s+notice/i,
  /^cma\s*cgm\s*-\s*arrival\s+notice/i,
  /^oocl\s+arrival\s+notice/i,
  /^smil\s+arrival\s+notice/i,
  /^arrival\s+notice\s*\(bl#:/i,
  /^sw\s+hlcl\s+sh#/i, // Hapag-Lloyd shipping notifications
  /\bODeX:/i, // ODeX platform notifications
];

/**
 * Patterns indicating a reply (not an original carrier email)
 */
const REPLY_PATTERNS = [/^re:/i, /^fw:/i, /^fwd:/i];

export class DirectionDetectionService {
  /**
   * Detect direction for a single email
   */
  detectDirection(email: EmailInput): DirectionResult {
    // Step 1: Extract true sender
    const trueSenderResult = extractTrueSender(
      email.senderEmail,
      email.senderName,
      email.headers
    );

    // If we already have true_sender_email from DB, use it
    const effectiveTrueSender =
      email.trueSenderEmail && email.trueSenderEmail.toLowerCase() !== email.senderEmail.toLowerCase()
        ? email.trueSenderEmail
        : trueSenderResult.trueSender;

    const trueSenderDomain = extractDomain(effectiveTrueSender);

    // Step 2: Determine direction based on true sender
    return this.resolveDirection(
      effectiveTrueSender,
      trueSenderDomain,
      email.subject,
      trueSenderResult.method === 'sender_email' ? undefined : trueSenderResult.method
    );
  }

  /**
   * Resolve direction based on true sender and subject
   */
  private resolveDirection(
    trueSender: string,
    trueSenderDomain: string,
    subject: string,
    extractionMethod?: string
  ): DirectionResult {
    const isReply = REPLY_PATTERNS.some((p) => p.test(subject));
    const hasCarrierPattern = CARRIER_SUBJECT_PATTERNS.some((p) => p.test(subject));

    // Rule 1: Unknown via pattern - likely external (inbound)
    if (trueSender.startsWith('unknown-via:')) {
      // Check if subject suggests carrier
      if (hasCarrierPattern && !isReply) {
        return {
          direction: 'inbound',
          trueSender,
          trueSenderDomain,
          confidence: 0.8,
          reasoning: 'Unknown via pattern but carrier subject detected',
          method: 'carrier_subject_pattern',
        };
      }
      // Default to inbound for unknown via patterns (external party forwarded)
      return {
        direction: 'inbound',
        trueSender,
        trueSenderDomain,
        confidence: 0.6,
        reasoning: 'Unknown via pattern, assuming external sender',
        method: 'via_pattern',
      };
    }

    // Rule 2: Carrier domain = INBOUND (always)
    if (isCarrierDomain(trueSenderDomain)) {
      return {
        direction: 'inbound',
        trueSender,
        trueSenderDomain,
        confidence: 0.99,
        reasoning: `Carrier domain detected: ${trueSenderDomain}`,
        method: 'carrier_domain',
      };
    }

    // Rule 3: Intoglo domain
    if (isIntogloDomain(trueSenderDomain)) {
      // Exception: Carrier subject pattern + not a reply = forwarded carrier email
      if (hasCarrierPattern && !isReply) {
        return {
          direction: 'inbound',
          trueSender,
          trueSenderDomain,
          confidence: 0.85,
          reasoning: 'Intoglo sender but carrier pattern in subject (forwarded)',
          method: 'carrier_subject_pattern',
        };
      }

      return {
        direction: 'outbound',
        trueSender,
        trueSenderDomain,
        confidence: 0.95,
        reasoning: 'Intoglo sender domain',
        method: 'intoglo_domain',
      };
    }

    // Rule 4: External domain = INBOUND
    return {
      direction: 'inbound',
      trueSender,
      trueSenderDomain,
      confidence: 0.9,
      reasoning: `External sender domain: ${trueSenderDomain}`,
      method: 'external_domain',
    };
  }

  /**
   * Detect direction considering thread context
   */
  detectThreadDirection(
    email: EmailInput,
    thread: ThreadEmail[]
  ): DirectionResult {
    // First, get base direction for this email
    const baseResult = this.detectDirection(email);

    // If this is a reply, consider thread context
    if (email.inReplyToMessageId) {
      const parentEmail = thread.find(
        (e) => e.messageId === email.inReplyToMessageId
      );

      if (parentEmail && parentEmail.direction) {
        // Reply logic:
        // - If parent was INBOUND (they sent to us), our reply is OUTBOUND
        // - If parent was OUTBOUND (we sent to them), their reply is INBOUND
        const isFromIntoglo = isIntogloDomain(extractDomain(email.senderEmail));

        if (isFromIntoglo && parentEmail.direction === 'inbound') {
          return {
            ...baseResult,
            direction: 'outbound',
            confidence: Math.max(baseResult.confidence, 0.9),
            reasoning: `Reply to inbound email from Intoglo = outbound`,
            method: 'thread_analysis',
          };
        }

        if (!isFromIntoglo && parentEmail.direction === 'outbound') {
          return {
            ...baseResult,
            direction: 'inbound',
            confidence: Math.max(baseResult.confidence, 0.9),
            reasoning: `External reply to outbound email = inbound`,
            method: 'thread_analysis',
          };
        }
      }
    }

    return baseResult;
  }

  /**
   * Analyze entire thread and determine directions for all emails
   */
  analyzeThread(thread: ThreadEmail[]): ThreadAnalysis {
    if (thread.length === 0) {
      throw new Error('Thread cannot be empty');
    }

    // Sort by some ordering (assuming first is oldest)
    const sortedThread = [...thread];

    const results: ThreadAnalysis['emails'] = [];
    let inboundCount = 0;
    let outboundCount = 0;

    // Process in order, using previous results for context
    for (const email of sortedThread) {
      // Build thread with known directions so far
      const processedThread = results.map((r, i) => ({
        ...sortedThread[i],
        direction: r.direction.direction,
      }));

      const direction = this.detectThreadDirection(email, processedThread as ThreadEmail[]);
      results.push({
        messageId: email.messageId,
        direction,
      });

      if (direction.direction === 'inbound') inboundCount++;
      else outboundCount++;
    }

    // Determine thread initiator
    const firstEmail = results[0];
    const initiator: 'intoglo' | 'external' =
      firstEmail.direction.direction === 'outbound' ? 'intoglo' : 'external';

    return {
      threadId: sortedThread[0].threadId || sortedThread[0].messageId,
      emails: results,
      summary: {
        inboundCount,
        outboundCount,
        initiator,
      },
    };
  }

  /**
   * Compare new detection with existing values
   */
  compareWithExisting(
    email: EmailInput,
    existingEmailDirection: EmailDirection | null,
    existingDocDirection: EmailDirection | null
  ): {
    newDirection: DirectionResult;
    emailMismatch: boolean;
    docMismatch: boolean;
    recommendation: string;
  } {
    const newDirection = this.detectDirection(email);

    const emailMismatch =
      existingEmailDirection !== null &&
      existingEmailDirection !== newDirection.direction;

    const docMismatch =
      existingDocDirection !== null &&
      existingDocDirection !== newDirection.direction;

    let recommendation = 'No changes needed';
    if (emailMismatch && docMismatch) {
      recommendation = `Update both email and doc direction to ${newDirection.direction}`;
    } else if (emailMismatch) {
      recommendation = `Update email direction to ${newDirection.direction}`;
    } else if (docMismatch) {
      recommendation = `Update doc direction to ${newDirection.direction}`;
    }

    return {
      newDirection,
      emailMismatch,
      docMismatch,
      recommendation,
    };
  }
}

// Singleton instance
export const directionDetectionService = new DirectionDetectionService();
