/**
 * True Sender Extractor
 *
 * Extracts the actual sender from emails that may be forwarded
 * through Google Groups, mailing lists, or other intermediaries.
 */

import { extractDomain, isIntogloDomain, isCarrierDomain } from './domain-classifier';

export interface TrueSenderResult {
  trueSender: string;
  trueSenderDomain: string;
  method: 'x_original_sender' | 'via_pattern' | 'reply_to' | 'return_path' | 'sender_email';
  confidence: number;
}

/**
 * Known via pattern mappings
 * Maps display names in "via" patterns to known email domains
 */
const VIA_PATTERN_MAPPINGS: Record<string, string> = {
  'cma cgm website': 'website-noreply@cma-cgm.com',
  'cma cgm': 'noreply@cma-cgm.com',
  'coscon': 'noreply@coscon.com',
  'oocl': 'noreply@oocl.com',
  'maersk': 'noreply@maersk.com',
  'hapag-lloyd': 'noreply@hapag-lloyd.com',
  'one line': 'noreply@one-line.com',
  'msc': 'noreply@msc.com',
  'cenfactnorepl': 'centfact@maersk.com',
  'iris': 'iris@coscon.com',
};

/**
 * Extract true sender from email
 *
 * Priority:
 * 1. X-Original-Sender header (Google Groups)
 * 2. Via pattern in sender name
 * 3. Reply-To header (if external)
 * 4. Return-Path header (if external)
 * 5. Fall back to sender email
 */
export function extractTrueSender(
  senderEmail: string,
  senderName?: string,
  headers?: Record<string, string>
): TrueSenderResult {
  const normalizedHeaders = normalizeHeaders(headers);

  // Priority 1: X-Original-Sender header
  const xOriginalSender = normalizedHeaders['x-original-sender'];
  if (xOriginalSender && isValidEmail(xOriginalSender)) {
    return {
      trueSender: xOriginalSender.toLowerCase(),
      trueSenderDomain: extractDomain(xOriginalSender),
      method: 'x_original_sender',
      confidence: 0.99,
    };
  }

  // Priority 2: Parse "via" pattern in sender email/name
  const viaResult = parseViaPattern(senderEmail, senderName);
  if (viaResult) {
    return viaResult;
  }

  // Priority 3: Reply-To header (if different from sender and external)
  const replyTo = normalizedHeaders['reply-to'];
  if (replyTo && isValidEmail(replyTo)) {
    const replyToDomain = extractDomain(replyTo);
    if (!isIntogloDomain(replyToDomain) && replyToDomain !== extractDomain(senderEmail)) {
      return {
        trueSender: extractEmailFromHeader(replyTo).toLowerCase(),
        trueSenderDomain: replyToDomain,
        method: 'reply_to',
        confidence: 0.85,
      };
    }
  }

  // Priority 4: Return-Path header (if external)
  const returnPath = normalizedHeaders['return-path'];
  if (returnPath && isValidEmail(returnPath)) {
    const returnPathDomain = extractDomain(returnPath);
    if (!isIntogloDomain(returnPathDomain) && returnPathDomain !== extractDomain(senderEmail)) {
      return {
        trueSender: extractEmailFromHeader(returnPath).toLowerCase(),
        trueSenderDomain: returnPathDomain,
        method: 'return_path',
        confidence: 0.75,
      };
    }
  }

  // Default: use sender email
  return {
    trueSender: extractEmailFromHeader(senderEmail).toLowerCase(),
    trueSenderDomain: extractDomain(senderEmail),
    method: 'sender_email',
    confidence: 1.0,
  };
}

/**
 * Parse "Name via Group" pattern
 *
 * Examples:
 * - "'CMA CGM Website' via pricing" <pricing@intoglo.com>
 * - "coscon via Operations Intoglo" <ops@intoglo.com>
 * - "'NUR KHAN' via Operations Intoglo" <ops@intoglo.com>
 */
function parseViaPattern(senderEmail: string, senderName?: string): TrueSenderResult | null {
  // Try to find "via" pattern in sender email string (includes display name)
  // Pattern: "Name via GroupName" or "'Name' via GroupName"
  const viaRegex = /['"]?([^'"<>]+?)['"]?\s+via\s+/i;

  // Check in sender email (might contain display name)
  let match = senderEmail.match(viaRegex);

  // Also check sender name if provided
  if (!match && senderName) {
    match = senderName.match(viaRegex);
  }

  if (!match) return null;

  const originalName = match[1].trim().toLowerCase();

  // Check if we have a known mapping for this name
  for (const [pattern, email] of Object.entries(VIA_PATTERN_MAPPINGS)) {
    if (originalName.includes(pattern)) {
      return {
        trueSender: email,
        trueSenderDomain: extractDomain(email),
        method: 'via_pattern',
        confidence: 0.9,
      };
    }
  }

  // Try to extract email from the name itself (some names include email)
  const emailInName = originalName.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailInName) {
    return {
      trueSender: emailInName[1].toLowerCase(),
      trueSenderDomain: extractDomain(emailInName[1]),
      method: 'via_pattern',
      confidence: 0.95,
    };
  }

  // For unknown via patterns, try to identify if it's a carrier by name
  const carrierPatterns = [
    { pattern: /maersk/i, domain: 'maersk.com' },
    { pattern: /hapag|hlag/i, domain: 'hapag-lloyd.com' },
    { pattern: /cma\s*cgm/i, domain: 'cma-cgm.com' },
    { pattern: /cosco|coscon/i, domain: 'coscon.com' },
    { pattern: /oocl/i, domain: 'oocl.com' },
    { pattern: /msc\b/i, domain: 'msc.com' },
    { pattern: /evergreen/i, domain: 'evergreen-line.com' },
    { pattern: /one\s*line/i, domain: 'one-line.com' },
    { pattern: /yang\s*ming/i, domain: 'yangming.com' },
    { pattern: /zim\b/i, domain: 'zim.com' },
  ];

  for (const { pattern, domain } of carrierPatterns) {
    if (pattern.test(originalName)) {
      return {
        trueSender: `noreply@${domain}`,
        trueSenderDomain: domain,
        method: 'via_pattern',
        confidence: 0.8,
      };
    }
  }

  // Unknown via pattern - return the original name as a marker
  // This indicates a forwarded email but we don't know the true sender
  return {
    trueSender: `unknown-via:${originalName}`,
    trueSenderDomain: 'unknown',
    method: 'via_pattern',
    confidence: 0.5,
  };
}

/**
 * Normalize headers to lowercase keys
 */
function normalizeHeaders(headers?: Record<string, string>): Record<string, string> {
  if (!headers) return {};

  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalized[key.toLowerCase()] = value;
  }
  return normalized;
}

/**
 * Extract email address from header value
 * Handles: "Name <email@domain.com>" or just "email@domain.com"
 */
function extractEmailFromHeader(header: string): string {
  const match = header.match(/<([^>]+)>/);
  if (match) return match[1];

  // If no angle brackets, try to find email pattern
  const emailMatch = header.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch) return emailMatch[1];

  return header;
}

/**
 * Check if string looks like a valid email
 */
function isValidEmail(str: string): boolean {
  const email = extractEmailFromHeader(str);
  return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email);
}
