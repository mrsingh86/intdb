/**
 * Thread Context Service
 *
 * System-level service that analyzes email thread structure.
 * Called FIRST in the classification pipeline to provide clean inputs
 * to all other classification services.
 *
 * Single Responsibility: Extract thread context from raw email data.
 * - Parses RE:/FW: chains from subject
 * - Extracts fresh body content (removes quoted text)
 * - Identifies forward chains
 * - Calculates thread depth
 *
 * Deep Module: Simple interface, complex parsing logic hidden.
 * Input: Raw email subject, body, headers
 * Output: ThreadContext with clean, usable data for downstream services
 */

// =============================================================================
// TYPES
// =============================================================================

export interface ThreadContextInput {
  subject: string;
  bodyText?: string;
  senderEmail: string;
  senderName?: string;
  headers?: Record<string, string>;
}

export interface ThreadContext {
  // Thread structure
  isThread: boolean;           // Has RE:/FW: prefix
  isReply: boolean;            // RE: pattern
  isForward: boolean;          // FW:/FWD: pattern
  threadDepth: number;         // Count of RE:/FW: prefixes

  // Clean content (for classification)
  cleanSubject: string;        // Subject without RE:/FW: prefixes
  freshBody: string;           // Body without quoted content
  quotedBody: string;          // Extracted quoted content

  // Forward chain analysis
  forwardChain: ForwardInfo[]; // List of forwarders detected
  hasNestedForwards: boolean;  // Multiple FW: levels

  // Original sender (if detectable from forward headers)
  originalSender: string | null;
}

export interface ForwardInfo {
  email: string;
  name?: string;
  index: number;               // Position in forward chain (0 = first forwarder)
}

// =============================================================================
// CONSTANTS
// =============================================================================

// Subject prefix patterns
const RE_PATTERN = /^RE:\s*/i;
const FW_PATTERN = /^(?:FW|FWD):\s*/i;
const THREAD_PREFIX_PATTERN = /^(?:RE|FW|FWD):\s*/i;

// Quoted content patterns
const QUOTE_PATTERNS = {
  // Gmail/Outlook "On ... wrote:" pattern
  onWrote: /^On\s+.+\s+wrote:\s*$/im,
  // "From: ... Sent: ... Subject:" forward headers
  forwardHeader: /^-{2,}\s*(?:Original Message|Forwarded message)\s*-{2,}/im,
  fromSentSubject: /^From:\s*.+\nSent:\s*.+\nTo:\s*.+\nSubject:/im,
  // Line quote markers
  quoteLine: /^>\s*/gm,
  // French/German patterns
  leWrote: /^Le\s+.+\s+a\s+écrit\s*:/im,
  amWrote: /^Am\s+.+\s+schrieb\s+.+:/im,
};

// Forward header extraction patterns
const FORWARD_FROM_PATTERN = /^From:\s*(.+?)(?:\s*<(.+?)>)?$/im;
const FORWARD_DATE_PATTERN = /^(?:Sent|Date):\s*(.+)$/im;

// =============================================================================
// SERVICE
// =============================================================================

export class ThreadContextService {
  /**
   * Extract thread context from email.
   *
   * @param input - Raw email data
   * @returns Structured thread context for downstream services
   */
  extract(input: ThreadContextInput): ThreadContext {
    const threadInfo = this.analyzeSubject(input.subject);
    const bodyAnalysis = this.analyzeBody(input.bodyText);
    const forwardChain = this.extractForwardChain(input.bodyText, input.headers);

    return {
      // Thread structure
      isThread: threadInfo.isThread,
      isReply: threadInfo.isReply,
      isForward: threadInfo.isForward,
      threadDepth: threadInfo.depth,

      // Clean content
      cleanSubject: threadInfo.cleanSubject,
      freshBody: bodyAnalysis.freshBody,
      quotedBody: bodyAnalysis.quotedBody,

      // Forward analysis
      forwardChain,
      hasNestedForwards: threadInfo.forwardCount > 1,

      // Original sender
      originalSender: this.findOriginalSender(forwardChain, input.headers),
    };
  }

  /**
   * Analyze subject line for thread markers.
   */
  private analyzeSubject(subject: string): {
    isThread: boolean;
    isReply: boolean;
    isForward: boolean;
    depth: number;
    forwardCount: number;
    cleanSubject: string;
  } {
    let current = subject.trim();
    let replyCount = 0;
    let forwardCount = 0;

    // Strip all RE:/FW:/FWD: prefixes
    while (THREAD_PREFIX_PATTERN.test(current)) {
      if (RE_PATTERN.test(current)) {
        replyCount++;
        current = current.replace(RE_PATTERN, '');
      } else if (FW_PATTERN.test(current)) {
        forwardCount++;
        current = current.replace(FW_PATTERN, '');
      }
    }

    const totalDepth = replyCount + forwardCount;

    return {
      isThread: totalDepth > 0,
      isReply: replyCount > 0,
      isForward: forwardCount > 0,
      depth: totalDepth,
      forwardCount,
      cleanSubject: current.trim(),
    };
  }

  /**
   * Analyze body to separate fresh content from quoted content.
   */
  private analyzeBody(bodyText?: string): {
    freshBody: string;
    quotedBody: string;
  } {
    if (!bodyText) {
      return { freshBody: '', quotedBody: '' };
    }

    // Find the first quote marker
    const quotePositions = this.findQuotePositions(bodyText);

    if (quotePositions.length === 0) {
      return { freshBody: bodyText.trim(), quotedBody: '' };
    }

    // Get the earliest quote position
    const firstQuotePos = Math.min(...quotePositions.filter(p => p >= 0));

    if (firstQuotePos === Infinity || firstQuotePos === 0) {
      // If quote starts at beginning, still try to extract any fresh content
      return this.extractFreshFromQuoted(bodyText);
    }

    const freshBody = bodyText.substring(0, firstQuotePos).trim();
    const quotedBody = bodyText.substring(firstQuotePos).trim();

    return { freshBody, quotedBody };
  }

  /**
   * Find positions where quoted content begins.
   */
  private findQuotePositions(bodyText: string): number[] {
    const positions: number[] = [];

    // Check each quote pattern
    for (const [, pattern] of Object.entries(QUOTE_PATTERNS)) {
      const match = bodyText.match(pattern);
      if (match && match.index !== undefined) {
        positions.push(match.index);
      }
    }

    // Also look for signature then quote pattern (common in replies)
    const signatureQuotePattern = /\n\s*--\s*\n[\s\S]*?(On\s+.+\s+wrote:|From:)/i;
    const sigMatch = bodyText.match(signatureQuotePattern);
    if (sigMatch && sigMatch.index !== undefined) {
      // Position after signature
      const afterSig = bodyText.indexOf(sigMatch[1], sigMatch.index);
      if (afterSig !== -1) {
        positions.push(afterSig);
      }
    }

    return positions;
  }

  /**
   * Extract any fresh content from a body that appears fully quoted.
   */
  private extractFreshFromQuoted(bodyText: string): {
    freshBody: string;
    quotedBody: string;
  } {
    // Handle line-quoted emails (> markers)
    const lines = bodyText.split('\n');
    const freshLines: string[] = [];
    const quotedLines: string[] = [];

    let inQuoteBlock = false;

    for (const line of lines) {
      const isQuotedLine = line.trim().startsWith('>') ||
                           line.match(/^On\s+.+\s+wrote:\s*$/i) ||
                           line.match(/^From:\s+/i);

      if (isQuotedLine) {
        inQuoteBlock = true;
        quotedLines.push(line);
      } else if (!inQuoteBlock && line.trim()) {
        freshLines.push(line);
      } else {
        quotedLines.push(line);
      }
    }

    return {
      freshBody: freshLines.join('\n').trim(),
      quotedBody: quotedLines.join('\n').trim(),
    };
  }

  /**
   * Extract forward chain from body and headers.
   */
  private extractForwardChain(
    bodyText?: string,
    headers?: Record<string, string>
  ): ForwardInfo[] {
    const chain: ForwardInfo[] = [];

    if (!bodyText) return chain;

    // Look for forwarded message headers in body
    const forwardPattern = /(?:From|De):\s*(?:"?([^"<\n]+)"?\s*)?<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/gi;
    const forwardMatches = Array.from(bodyText.matchAll(forwardPattern));

    let index = 0;
    for (const match of forwardMatches) {
      const name = match[1]?.trim();
      const email = match[2]?.toLowerCase();

      if (email && !this.isAlreadyInChain(chain, email)) {
        chain.push({
          email,
          name: name || undefined,
          index: index++,
        });
      }
    }

    return chain;
  }

  /**
   * Check if email is already in forward chain.
   */
  private isAlreadyInChain(chain: ForwardInfo[], email: string): boolean {
    return chain.some(f => f.email.toLowerCase() === email.toLowerCase());
  }

  /**
   * Find the original sender from forward chain or headers.
   */
  private findOriginalSender(
    forwardChain: ForwardInfo[],
    headers?: Record<string, string>
  ): string | null {
    // X-Original-Sender header takes precedence
    const normalizedHeaders = this.normalizeHeaders(headers);
    const xOriginalSender = normalizedHeaders['x-original-sender'];
    if (xOriginalSender) {
      const email = this.extractEmailFromHeader(xOriginalSender);
      if (email) return email;
    }

    // Return last person in forward chain (original sender)
    if (forwardChain.length > 0) {
      return forwardChain[forwardChain.length - 1].email;
    }

    return null;
  }

  /**
   * Normalize headers to lowercase keys.
   */
  private normalizeHeaders(headers?: Record<string, string>): Record<string, string> {
    if (!headers) return {};

    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      normalized[key.toLowerCase()] = value;
    }
    return normalized;
  }

  /**
   * Extract email address from header value.
   */
  private extractEmailFromHeader(header: string): string | null {
    const match = header.match(/<([^>]+)>/);
    if (match) return match[1].toLowerCase();

    const emailMatch = header.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (emailMatch) return emailMatch[1].toLowerCase();

    return null;
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new ThreadContextService instance.
 */
export function createThreadContextService(): ThreadContextService {
  return new ThreadContextService();
}
