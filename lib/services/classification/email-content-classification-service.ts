/**
 * Email Content Classification Service
 *
 * Classifies emails by attachment filenames, body, and subject.
 * Uses ThreadContext for clean inputs (no RE:/FW: prefixes, no quoted content).
 *
 * CRITICAL: Subject patterns are ONLY used for ORIGINAL emails.
 * RE:/FW: emails inherit the original subject, which doesn't reflect
 * the current email's content. Using subject for replies causes
 * misclassification (e.g., "Re: Arrival Notice" classified as arrival_notice
 * when it's just a reply discussing the arrival notice).
 *
 * Priority order:
 * 1. Attachment filename patterns (highest priority - always used)
 * 2. For ORIGINAL emails: Subject patterns, then body patterns
 * 3. For RE:/FW: emails: Body patterns ONLY (no subject)
 *
 * Single Responsibility: Classify by email metadata only.
 * Deep Module: Simple interface, complex pattern matching hidden.
 */

import { ThreadContext } from './thread-context-service';
import { matchAttachmentPatterns } from '../../config/attachment-patterns';
import { matchBodyIndicator } from '../../config/body-indicators';

// =============================================================================
// TYPES
// =============================================================================

export interface EmailContentInput {
  threadContext: ThreadContext;
  attachmentFilenames?: string[];
}

export interface EmailContentResult {
  documentType: string;
  confidence: number;
  source: 'attachment' | 'subject' | 'body';
  matchedPattern: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const MIN_CONFIDENCE_THRESHOLD = 70;

/**
 * Subject patterns for classification.
 * Extracted from unified-classification-service.ts.
 * Order matters: more specific patterns first.
 */
const SUBJECT_PATTERNS: Array<{ pattern: RegExp; type: string; confidence: number }> = [
  // ===== SOB / SHIPPED ON BOARD (CRITICAL - often misclassified) =====
  { pattern: /\bSOB\s+CONFIRM/i, type: 'sob_confirmation', confidence: 95 },
  { pattern: /\bSOB\s+for\b/i, type: 'sob_confirmation', confidence: 95 },
  { pattern: /\bshipped\s+on\s+board/i, type: 'sob_confirmation', confidence: 95 },
  { pattern: /\bcontainer.*loaded/i, type: 'sob_confirmation', confidence: 85 },
  { pattern: /\bon\s*board\s+confirm/i, type: 'sob_confirmation', confidence: 90 },

  // ===== ARRIVAL NOTICE =====
  { pattern: /\barrival\s+notice\b/i, type: 'arrival_notice', confidence: 95 },
  { pattern: /\bnotice\s+of\s+arrival\b/i, type: 'arrival_notice', confidence: 95 },
  { pattern: /^Arrival Notice\s*\(BL#:/i, type: 'arrival_notice', confidence: 98 },
  { pattern: /^COSCO Arrival Notice/i, type: 'arrival_notice', confidence: 98 },
  { pattern: /^CMA CGM - Arrival notice available/i, type: 'arrival_notice', confidence: 98 },
  { pattern: /^OOCL Arrival Notice/i, type: 'arrival_notice', confidence: 98 },
  { pattern: /^Arrival notice\s+\d{9}/i, type: 'arrival_notice', confidence: 97 },
  { pattern: /^SMIL Arrival Notice\s*\|/i, type: 'arrival_notice', confidence: 97 },

  // ===== HBL DRAFT =====
  { pattern: /\bBL\s+DRAFT\s+FOR\b/i, type: 'hbl_draft', confidence: 95 },
  { pattern: /\bHBL\s+DRAFT/i, type: 'hbl_draft', confidence: 95 },
  { pattern: /\bdraft\s+(HBL|B\/?L)\b/i, type: 'hbl_draft', confidence: 95 },
  { pattern: /\bARRANGE\s+BL\s+DRAFT/i, type: 'hbl_draft', confidence: 95 },
  { pattern: /\bBL\s+for\s+(your\s+)?(approval|review)/i, type: 'hbl_draft', confidence: 90 },
  { pattern: /\bmodification.*draft\s+BL/i, type: 'hbl_draft', confidence: 90 },

  // ===== SI DRAFT =====
  { pattern: /\bSI\s+draft/i, type: 'si_draft', confidence: 95 },
  { pattern: /\bdraft\s+SI\b/i, type: 'si_draft', confidence: 95 },
  { pattern: /\bchecklist\s+(for\s+)?(approval|review)/i, type: 'si_draft', confidence: 95 },
  { pattern: /\bSIL\s*&\s*VGM/i, type: 'si_draft', confidence: 95 },
  { pattern: /\bSI\s+for\s+(your\s+)?(approval|review)/i, type: 'si_draft', confidence: 90 },

  // ===== BILL OF LADING =====
  { pattern: /\bfinal\s*B\/?L\b/i, type: 'bill_of_lading', confidence: 90 },
  { pattern: /\bbill\s+of\s+lading\b/i, type: 'bill_of_lading', confidence: 95 },
  { pattern: /\bsea\s*waybill\b/i, type: 'bill_of_lading', confidence: 90 },
  { pattern: /\bhouse\s*b\/?l\b/i, type: 'bill_of_lading', confidence: 90 },
  { pattern: /\bmaster\s*b\/?l\b/i, type: 'bill_of_lading', confidence: 90 },
  { pattern: /\bHBL\s*#/i, type: 'bill_of_lading', confidence: 85 },
  { pattern: /\bMBL\s*#/i, type: 'bill_of_lading', confidence: 85 },
  { pattern: /\bHBL\s*:/i, type: 'bill_of_lading', confidence: 85 },
  { pattern: /\bMBL\s*:/i, type: 'bill_of_lading', confidence: 85 },

  // ===== BOOKING CANCELLATION =====
  { pattern: /\bbooking.*cancel/i, type: 'booking_cancellation', confidence: 95 },
  { pattern: /\bcancel.*booking/i, type: 'booking_cancellation', confidence: 95 },
  { pattern: /\bcancellation\s+notice/i, type: 'booking_cancellation', confidence: 90 },

  // ===== BOOKING AMENDMENT =====
  { pattern: /\b(1st|2nd|3rd|\d+th)\s+UPDATE\b/i, type: 'booking_amendment', confidence: 95 },
  { pattern: /\bamendment\s+to\s+booking/i, type: 'booking_amendment', confidence: 95 },
  { pattern: /\bbooking.*amendment/i, type: 'booking_amendment', confidence: 90 },
  { pattern: /\brollover\b/i, type: 'booking_amendment', confidence: 85 },

  // ===== DELIVERY ORDER =====
  { pattern: /\bdelivery\s+order\b/i, type: 'delivery_order', confidence: 95 },
  { pattern: /\bD\/?O\s+(release|issued)/i, type: 'delivery_order', confidence: 90 },
  { pattern: /\brelease\s+order\b/i, type: 'delivery_order', confidence: 85 },

  // ===== SHIPPING INSTRUCTIONS =====
  { pattern: /\bSI\s+(submission|confirm|draft)/i, type: 'shipping_instruction', confidence: 90 },
  { pattern: /\bshipping\s+instruction/i, type: 'shipping_instruction', confidence: 90 },
  { pattern: /\bSI\s+CUT\s*OFF/i, type: 'cutoff_advisory', confidence: 85 },

  // ===== VGM =====
  { pattern: /\bVGM\s+(confirm|submit|accept|receiv)/i, type: 'vgm_confirmation', confidence: 95 },
  { pattern: /\bverified\s+gross\s+mass/i, type: 'vgm_confirmation', confidence: 90 },
  { pattern: /\bVGM\s+(remind|deadline|cutoff)/i, type: 'vgm_reminder', confidence: 90 },

  // ===== BOOKING CONFIRMATION =====
  { pattern: /^Booking\s+Confirmation\s*:/i, type: 'booking_confirmation', confidence: 90 },
  { pattern: /CMA\s*CGM.*Booking\s+confirmation/i, type: 'booking_confirmation', confidence: 90 },
  { pattern: /\[Hapag.*Booking\s+Confirmation/i, type: 'booking_confirmation', confidence: 90 },

  // ===== INVOICE =====
  { pattern: /\bfreight\s+invoice\b/i, type: 'invoice', confidence: 90 },
  { pattern: /\binvoice\s*#\s*[A-Z0-9-]+/i, type: 'invoice', confidence: 90 },
  { pattern: /\binvoice\s+\d+/i, type: 'invoice', confidence: 85 },
  { pattern: /\bcommercial\s+invoice/i, type: 'invoice', confidence: 85 },
  { pattern: /\bproforma\s+invoice/i, type: 'invoice', confidence: 85 },

  // ===== CUSTOMS GENERAL =====
  { pattern: /\bcustoms\s+clear(ance|ed)?/i, type: 'customs_clearance', confidence: 90 },
  { pattern: /\bISF\s+(fil|confirm|submit)/i, type: 'isf_submission', confidence: 90 },

  // ===== INDIA EXPORT - CHA DOCUMENTS =====
  { pattern: /\bchecklist\s+(attached|for|ready)/i, type: 'checklist', confidence: 95 },
  { pattern: /\bexport\s+checklist/i, type: 'checklist', confidence: 95 },
  { pattern: /\bCHA\s+checklist/i, type: 'checklist', confidence: 95 },
  { pattern: /\bshipment\s+checklist/i, type: 'checklist', confidence: 90 },
  { pattern: /\bdocument\s+checklist/i, type: 'checklist', confidence: 85 },

  // Shipping Bill / LEO
  { pattern: /\bshipping\s+bill\s+(copy|number|attached)/i, type: 'shipping_bill', confidence: 95 },
  { pattern: /\bSB\s+(copy|no\.?|number)/i, type: 'shipping_bill', confidence: 90 },
  { pattern: /\bLEO\s+(copy|attached|received)/i, type: 'leo_copy', confidence: 95 },
  { pattern: /\blet\s+export\s+order/i, type: 'leo_copy', confidence: 95 },
  { pattern: /\bexport\s+clearance/i, type: 'shipping_bill', confidence: 85 },

  // ===== US IMPORT - CUSTOMS BROKER DOCUMENTS =====
  { pattern: /\bdraft\s+entry/i, type: 'draft_entry', confidence: 95 },
  { pattern: /\bentry\s+draft/i, type: 'draft_entry', confidence: 95 },
  { pattern: /\b7501\s+draft/i, type: 'draft_entry', confidence: 95 },
  { pattern: /\bcustoms\s+entry\s+(draft|for\s+review)/i, type: 'draft_entry', confidence: 90 },
  { pattern: /\bentry\s+for\s+(review|approval)/i, type: 'draft_entry', confidence: 90 },
  { pattern: /\bentry\s+approval\s+required/i, type: 'draft_entry', confidence: 90 },
  { pattern: /\bentry\s+\d*[A-Z]{2,3}[- ]?\d+.*pre-?alert/i, type: 'draft_entry', confidence: 90 },
  { pattern: /\d{3}-\d{7}-\d-3461\b/, type: 'draft_entry', confidence: 95 },

  // Entry Summary
  { pattern: /\bentry\s+summary/i, type: 'entry_summary', confidence: 95 },
  { pattern: /\b7501\s+(filed|submitted|summary)/i, type: 'entry_summary', confidence: 95 },
  { pattern: /\bfiled\s+entry/i, type: 'entry_summary', confidence: 90 },
  { pattern: /\bcustoms\s+entry\s+(filed|released)/i, type: 'entry_summary', confidence: 90 },
  { pattern: /\bentry\s+release/i, type: 'entry_summary', confidence: 85 },
  { pattern: /\d+-\d+-\d+-7501\b/, type: 'entry_summary', confidence: 90 },
  { pattern: /\b\d{3}-\d{7}-\d-7501\b/, type: 'entry_summary', confidence: 95 },
  { pattern: /\b7501\b/, type: 'entry_summary', confidence: 85 },

  // Duty Invoice
  { pattern: /\bduty\s+invoice/i, type: 'duty_invoice', confidence: 95 },
  { pattern: /\bduty\s+(payment|statement|summary)/i, type: 'duty_invoice', confidence: 90 },
  { pattern: /\bduty\s+bill\b/i, type: 'duty_invoice', confidence: 90 },
  { pattern: /\brequest\s+for\s+duty/i, type: 'duty_invoice', confidence: 90 },
  { pattern: /\bcustoms\s+duty/i, type: 'duty_invoice', confidence: 85 },
  { pattern: /\bimport\s+duty/i, type: 'duty_invoice', confidence: 85 },
  { pattern: /\bInvoice-\d{6,}/i, type: 'duty_invoice', confidence: 95 },

  // Cargo/Customs Release
  { pattern: /Cargo\s+Release\s+Update/i, type: 'customs_clearance', confidence: 95 },
  { pattern: /ACE\s+RELEASE/i, type: 'customs_clearance', confidence: 95 },
  { pattern: /\bDAD\b.*release/i, type: 'customs_clearance', confidence: 90 },

  // ===== TRUCKING COMPANY DOCUMENTS =====
  { pattern: /Work\s+Order\s*:/i, type: 'work_order', confidence: 90 },
  { pattern: /Dray(age)?\s+Order/i, type: 'work_order', confidence: 90 },

  // Pickup/Container Out
  { pattern: /Container\s+(is\s+)?out\b/i, type: 'pickup_confirmation', confidence: 95 },
  { pattern: /\bpicked\s+up\b/i, type: 'pickup_confirmation', confidence: 90 },
  { pattern: /\bpickup\s+complete/i, type: 'pickup_confirmation', confidence: 95 },

  // Delivery Appointment
  { pattern: /Appointment\s+(ID|#|confirmed|scheduled)/i, type: 'delivery_appointment', confidence: 90 },
  { pattern: /delivery\s+appointment/i, type: 'delivery_appointment', confidence: 90 },

  // POD / Proof of Delivery
  { pattern: /\bPOD\b\s*(attached|confirm|received)?/i, type: 'proof_of_delivery', confidence: 95 },
  { pattern: /Proof\s+of\s+Delivery/i, type: 'proof_of_delivery', confidence: 95 },
  { pattern: /Signed\s+(POD|delivery|BOL)/i, type: 'proof_of_delivery', confidence: 95 },
  { pattern: /Delivery\s+Confirmation/i, type: 'proof_of_delivery', confidence: 90 },
  { pattern: /Successfully\s+Delivered/i, type: 'proof_of_delivery', confidence: 90 },

  // Empty Return
  { pattern: /Empty\s+Return/i, type: 'empty_return', confidence: 95 },
  { pattern: /Container\s+Returned/i, type: 'empty_return', confidence: 90 },
  { pattern: /MTY\s+Return/i, type: 'empty_return', confidence: 95 },

  // ===== RATE QUOTE =====
  { pattern: /\bprice\s+overview\b/i, type: 'rate_quote', confidence: 90 },
  { pattern: /\brate\s+quot/i, type: 'rate_quote', confidence: 90 },
  { pattern: /\bfreight\s+quot/i, type: 'rate_quote', confidence: 90 },

  // ===== VESSEL SCHEDULE =====
  { pattern: /\bvessel\s+schedule\b/i, type: 'vessel_schedule', confidence: 90 },
  { pattern: /\bsailing\s+schedule\b/i, type: 'vessel_schedule', confidence: 90 },
  { pattern: /\bETD.*ETA\b/i, type: 'vessel_schedule', confidence: 80 },

  // ===== SHIPMENT NOTICE =====
  { pattern: /\bFMC\s+filing\b/i, type: 'shipment_notice', confidence: 90 },
  { pattern: /\bshipment\s+notice\b/i, type: 'shipment_notice', confidence: 90 },

  // ===== PICKUP =====
  { pattern: /\bpickup\s+(notice|notif|ready)/i, type: 'pickup_notification', confidence: 90 },
  { pattern: /\bcontainer\s+release/i, type: 'pickup_notification', confidence: 85 },

  // ===== CUTOFF =====
  { pattern: /\bcut\s*-?\s*off\s+(advis|change|update)/i, type: 'cutoff_advisory', confidence: 90 },
  { pattern: /\bdeadline\s+(change|extend)/i, type: 'cutoff_advisory', confidence: 85 },
];

// =============================================================================
// SERVICE
// =============================================================================

export class EmailContentClassificationService {
  /**
   * Classify email by content (subject, body, attachments).
   *
   * For thread replies: Prioritize body content over inherited subject.
   * The subject in replies often contains the original thread topic,
   * not the current email's actual content.
   *
   * @param input - Email content with ThreadContext
   * @returns Classification result or null if no confident match
   */
  classify(input: EmailContentInput): EmailContentResult | null {
    const { threadContext, attachmentFilenames } = input;

    // Priority 1: Attachment filename patterns (strongest signal - always first)
    if (attachmentFilenames && attachmentFilenames.length > 0) {
      const attachmentResult = this.classifyByAttachment(attachmentFilenames);
      if (attachmentResult) {
        return attachmentResult;
      }
    }

    // For thread replies: ONLY use body patterns, SKIP subject entirely
    // Subject in RE:/FW: emails is inherited from original - doesn't reflect current content
    if (threadContext.isReply || threadContext.isForward) {
      // Only use body patterns for replies
      if (threadContext.freshBody) {
        const bodyResult = this.classifyByBody(threadContext.freshBody);
        if (bodyResult) {
          return bodyResult;
        }
      }

      // NO subject fallback for replies - subject is inherited, not meaningful
      return null;
    } else {
      // For original emails (not replies): Subject is reliable
      // Priority 2B: Subject patterns (using clean subject)
      const subjectResult = this.classifyBySubject(threadContext.cleanSubject);
      if (subjectResult) {
        return subjectResult;
      }

      // Priority 3B: Body patterns
      if (threadContext.freshBody) {
        const bodyResult = this.classifyByBody(threadContext.freshBody);
        if (bodyResult) {
          return bodyResult;
        }
      }
    }

    // No confident match
    return null;
  }

  /**
   * Classify by attachment filenames.
   */
  private classifyByAttachment(filenames: string[]): EmailContentResult | null {
    const match = matchAttachmentPatterns(filenames);

    if (match) {
      return {
        documentType: match.type,
        confidence: 95, // Attachment patterns are high confidence
        source: 'attachment',
        matchedPattern: `Filename: ${match.filename}`,
      };
    }

    return null;
  }

  /**
   * Classify by subject line patterns.
   */
  private classifyBySubject(cleanSubject: string): EmailContentResult | null {
    for (const { pattern, type, confidence } of SUBJECT_PATTERNS) {
      if (pattern.test(cleanSubject)) {
        if (confidence >= MIN_CONFIDENCE_THRESHOLD) {
          return {
            documentType: type,
            confidence,
            source: 'subject',
            matchedPattern: pattern.source,
          };
        }
      }
    }

    return null;
  }

  /**
   * Classify by body content patterns.
   */
  private classifyByBody(freshBody: string): EmailContentResult | null {
    const match = matchBodyIndicator(freshBody);

    if (match) {
      return {
        documentType: match.type,
        confidence: 85, // Body patterns slightly lower confidence
        source: 'body',
        matchedPattern: match.pattern,
      };
    }

    return null;
  }

  /**
   * Check if this is a thread reply that should skip classification.
   *
   * Thread replies with inherited subjects (RE: Booking Confirmation...)
   * from non-carrier senders should not be classified based on subject.
   */
  shouldSkipThreadReply(
    threadContext: ThreadContext,
    isCarrierSender: boolean,
    documentType: string
  ): boolean {
    // Only skip if:
    // 1. It's a reply (RE:)
    // 2. Not from a carrier
    // 3. The detected type is booking-related (inherited subject)
    const isBookingType = ['booking_confirmation', 'booking_amendment'].includes(documentType);

    return threadContext.isReply && !isCarrierSender && isBookingType;
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create a new EmailContentClassificationService instance.
 */
export function createEmailContentClassificationService(): EmailContentClassificationService {
  return new EmailContentClassificationService();
}
