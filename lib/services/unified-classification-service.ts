/**
 * Unified Classification Service (Consolidated)
 *
 * SINGLE source of truth for email classification.
 *
 * Architecture:
 * 1. FIRST: Try deterministic patterns (fast, free, 100% consistent)
 *    - Uses shipping-line-patterns.ts for carrier-specific matching
 *    - Validates attachment content (e.g., BC must have "BOOKING CONFIRMATION" heading)
 *
 * 2. FALLBACK: Use AI with structured tool_use for reliability
 *    - Claude Haiku for speed/cost efficiency
 *    - Structured output via tool_use (no regex parsing)
 *
 * Principles:
 * - Single Responsibility: Only classification logic
 * - Deep Module: Simple classify() interface, complex implementation
 * - Configuration Over Code: Patterns in shipping-line-patterns.ts
 * - Fail Fast: Returns unknown with low confidence rather than guessing
 *
 * This service REPLACES:
 * - AdvancedClassificationService (deprecated)
 * - ComprehensiveClassificationService (deprecated)
 * - EnhancedClassificationService (deprecated)
 */

import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import {
  classifyEmail as classifyCarrierEmail,
  isShippingLineEmail,
  DocumentType,
  ClassificationResult as DeterministicResult,
} from '../config/shipping-line-patterns';
import { detectDirection, EmailDirection } from '../utils/direction-detector';
import { matchAttachmentPatterns } from '../config/attachment-patterns';
import { matchBodyIndicator } from '../config/body-indicators';
import { matchPartnerPattern } from '../config/partner-patterns';
import { matchIntogloPattern } from '../config/intoglo-patterns';

// ============================================================================
// Types
// ============================================================================

export interface ClassificationInput {
  emailId: string;
  subject: string;
  senderEmail: string;
  trueSenderEmail?: string;
  bodyText?: string;
  snippet?: string;
  hasAttachments: boolean;
  attachmentFilenames?: string[];
  attachmentContent?: string; // Extracted PDF text for content validation
}

export interface ClassificationResult {
  documentType: DocumentType | string;
  subType: DocumentSubType | null;
  carrierId: string | null;
  carrierName: string | null;
  confidence: number;
  method: 'deterministic' | 'ai';
  matchedPattern?: string;
  labels: string[];
  needsManualReview: boolean;
  classificationReason: string;
  // NEW: Direction and workflow state
  direction: EmailDirection;
  workflowState: string | null;
  classificationSource?: 'attachment' | 'body' | 'subject' | 'carrier' | 'intoglo' | 'partner' | 'ai';
}

export type DocumentSubType =
  | 'original'
  | 'amendment'
  | 'update'
  | 'cancellation'
  | 'draft'
  | 'final'
  | 'copy'
  | '1st_update'
  | '2nd_update'
  | '3rd_update'
  | null;

// Standard document types (aligned with database enum)
const STANDARD_DOCUMENT_TYPES = [
  'booking_confirmation',
  'booking_amendment',
  'booking_cancellation',
  'arrival_notice',
  'shipment_notice',
  'bill_of_lading',
  'house_bl',
  'hbl_draft',
  'shipping_instruction',
  'si_draft',
  'si_submission',
  'invoice',
  'freight_invoice',
  'vgm_confirmation',
  'vgm_reminder',
  'vgm_submission',
  'vessel_schedule',
  'pickup_notification',
  'cutoff_advisory',
  'delivery_order',
  'customs_clearance',
  'customs_document',
  'rate_quote',
  'general_correspondence',
  'sob_confirmation',
  // India Export - CHA
  'checklist',
  'shipping_bill',
  'leo_copy',
  // US Import - Customs Broker
  'draft_entry',
  'entry_summary',
  'duty_invoice',
  'isf_submission',
  // Trucking / Delivery
  'work_order',
  'pickup_confirmation',
  'delivery_appointment',
  'proof_of_delivery',
  'empty_return',
  'container_release',
] as const;

// Labels for multi-label classification
const CLASSIFICATION_LABELS = [
  'contains_cutoffs',
  'contains_schedule',
  'contains_routing',
  'contains_rates',
  'contains_cargo_details',
  'urgent',
  'requires_action',
  'amendment_notice',
  'schedule_change',
  'vessel_change',
] as const;

// Workflow state mapping: document_type:direction → workflow_state
const WORKFLOW_STATE_MAP: Record<string, string> = {
  // Booking
  'booking_confirmation:inbound': 'booking_confirmation_received',
  'booking_confirmation:outbound': 'booking_confirmation_shared',
  'booking_amendment:inbound': 'booking_confirmation_received',
  'booking_amendment:outbound': 'booking_confirmation_shared',
  'booking_cancellation:inbound': 'booking_cancelled',
  'booking_cancellation:outbound': 'booking_cancelled',

  // SI
  'shipping_instruction:inbound': 'si_draft_received',
  'shipping_instruction:outbound': 'si_draft_sent',
  'si_draft:inbound': 'si_draft_received',
  'si_draft:outbound': 'si_draft_sent',
  'si_confirmation:inbound': 'si_confirmed',
  'si_confirmation:outbound': 'si_confirmed',
  'si_submission:inbound': 'si_confirmed',
  'si_submission:outbound': 'si_confirmed',

  // BL
  'mbl_draft:inbound': 'mbl_draft_received',
  'bill_of_lading:inbound': 'mbl_draft_received',
  'hbl_draft:inbound': 'hbl_draft_sent',  // Rare: carrier sends HBL draft
  'hbl_draft:outbound': 'hbl_draft_sent',
  'hbl_release:outbound': 'hbl_released',
  'bill_of_lading:outbound': 'hbl_released',

  // Invoice
  'invoice:inbound': 'commercial_invoice_received',
  'invoice:outbound': 'invoice_sent',
  'commercial_invoice:inbound': 'commercial_invoice_received',
  'commercial_invoice:outbound': 'invoice_sent',
  'freight_invoice:inbound': 'commercial_invoice_received',
  'freight_invoice:outbound': 'invoice_sent',
  'duty_invoice:inbound': 'duty_invoice_received',
  'duty_invoice:outbound': 'duty_summary_shared',
  'duty_summary:outbound': 'duty_summary_shared',

  // Arrival
  'arrival_notice:inbound': 'arrival_notice_received',
  'arrival_notice:outbound': 'arrival_notice_shared',
  // shipment_notice is FMC filing/status update - NOT arrival notice
  'shipment_notice:inbound': 'fmc_filing_received',
  'shipment_notice:outbound': 'fmc_filing_sent',

  // Customs - India
  'checklist:inbound': 'checklist_received',
  'checklist:outbound': 'checklist_shared',
  'shipping_bill:inbound': 'customs_export_filed',
  'shipping_bill:outbound': 'customs_export_filed',
  'leo_copy:inbound': 'customs_export_cleared',
  'leo_copy:outbound': 'customs_export_cleared',
  'bill_of_entry:inbound': 'customs_import_filed',
  'customs_clearance:inbound': 'cargo_released',
  'customs_clearance:outbound': 'cargo_released',
  'customs_document:inbound': 'duty_invoice_received',
  'customs_document:outbound': 'duty_summary_shared',

  // Customs - US
  'draft_entry:inbound': 'entry_draft_received',
  'draft_entry:outbound': 'entry_draft_shared',
  'entry_summary:inbound': 'entry_summary_received',
  'entry_summary:outbound': 'entry_summary_shared',
  'isf_filing:inbound': 'isf_filed',
  'isf_filing:outbound': 'isf_filed',
  'isf_submission:inbound': 'isf_filed',
  'isf_submission:outbound': 'isf_filed',
  'exam_notice:inbound': 'customs_hold',

  // Delivery & Trucking
  'delivery_order:inbound': 'delivery_order_received',
  'delivery_order:outbound': 'delivery_order_shared',
  'container_release:inbound': 'container_released',
  'container_release:outbound': 'container_released',
  'pickup_notification:inbound': 'container_released',
  'pickup_confirmation:inbound': 'container_released',
  'pickup_confirmation:outbound': 'container_released',
  'proof_of_delivery:inbound': 'pod_received',
  'proof_of_delivery:outbound': 'pod_shared',
  'delivery_confirmation:inbound': 'pod_received',
  'delivery_confirmation:outbound': 'pod_shared',
  'work_order:inbound': 'dispatch_received',
  'work_order:outbound': 'dispatch_sent',
  'delivery_appointment:inbound': 'delivery_scheduled',
  'delivery_appointment:outbound': 'delivery_scheduled',
  'empty_return:inbound': 'empty_returned',
  'empty_return:outbound': 'empty_returned',
  'gate_in_confirmation:inbound': 'gate_in_confirmed',
  'gate_in_confirmation:outbound': 'gate_in_confirmed',
  'empty_return:inbound': 'empty_returned',
  'empty_return:outbound': 'empty_returned',

  // VGM
  'vgm_confirmation:inbound': 'vgm_confirmed',
  'vgm_confirmation:outbound': 'vgm_confirmed',
  'vgm_submission:inbound': 'vgm_confirmed',
  'vgm_submission:outbound': 'vgm_submitted',
  'vgm_reminder:inbound': 'vgm_pending',

  // SOB
  'sob_confirmation:inbound': 'sob_received',
  'sob_confirmation:outbound': 'sob_received',

  // Documents
  'packing_list:inbound': 'documents_received',
  'packing_list:outbound': 'documents_received',
  'certificate:inbound': 'documents_received',
  'certificate:outbound': 'documents_received',
};

// Tool definition for structured AI output
const CLASSIFICATION_TOOL: Anthropic.Tool = {
  name: 'classify_shipping_email',
  description: 'Classify a shipping/logistics email into a document type',
  input_schema: {
    type: 'object',
    properties: {
      document_type: {
        type: 'string',
        enum: STANDARD_DOCUMENT_TYPES,
        description: 'The type of shipping document this email represents',
      },
      sub_type: {
        type: 'string',
        enum: ['original', 'amendment', 'update', 'cancellation', 'draft', 'final', 'copy', null],
        description: 'Sub-type if applicable (original, amendment, etc.)',
      },
      confidence: {
        type: 'integer',
        minimum: 0,
        maximum: 100,
        description: 'Confidence score 0-100',
      },
      labels: {
        type: 'array',
        items: { type: 'string', enum: CLASSIFICATION_LABELS },
        description: 'Applicable labels (can have multiple)',
      },
      carrier: {
        type: 'string',
        description: 'Detected carrier if identifiable (maersk, hapag-lloyd, cma-cgm, cosco, msc, etc.)',
      },
      reasoning: {
        type: 'string',
        description: 'Brief explanation of classification decision',
      },
    },
    required: ['document_type', 'confidence', 'reasoning'],
  },
};

// ============================================================================
// Unified Classification Service
// ============================================================================

export class UnifiedClassificationService {
  private supabase: SupabaseClient;
  private anthropic: Anthropic | null = null;
  private useAiFallback: boolean;
  private aiModel: string;

  constructor(
    supabase: SupabaseClient,
    options: {
      useAiFallback?: boolean;
      aiModel?: string;
    } = {}
  ) {
    this.supabase = supabase;
    this.useAiFallback = options.useAiFallback ?? true;
    // Use Sonnet for AI fallback - good accuracy at reasonable cost
    // Deterministic patterns handle ~80% of cases (free), AI only for edge cases
    this.aiModel = options.aiModel ?? 'claude-sonnet-4-20250514';

    if (this.useAiFallback && process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic();
    }
  }

  /**
   * COMPREHENSIVE subject line patterns for deterministic classification
   * These patterns are 100% accurate and should handle 80%+ of emails.
   * Order matters: more specific patterns first.
   */
  private readonly SUBJECT_PATTERNS: Array<{ pattern: RegExp; type: string; confidence: number }> = [
    // ===== SOB / SHIPPED ON BOARD (CRITICAL - often misclassified) =====
    { pattern: /\bSOB\s+CONFIRM/i, type: 'sob_confirmation', confidence: 95 },
    { pattern: /\bSOB\s+for\b/i, type: 'sob_confirmation', confidence: 95 },
    { pattern: /\bshipped\s+on\s+board/i, type: 'sob_confirmation', confidence: 95 },
    { pattern: /\bcontainer.*loaded/i, type: 'sob_confirmation', confidence: 85 },
    { pattern: /\bon\s*board\s+confirm/i, type: 'sob_confirmation', confidence: 90 },

    // ===== ARRIVAL NOTICE (vessel arriving at destination) =====
    { pattern: /\barrival\s+notice\b/i, type: 'arrival_notice', confidence: 95 },
    { pattern: /\bnotice\s+of\s+arrival\b/i, type: 'arrival_notice', confidence: 95 },
    { pattern: /\bvessel\s+arrival\b/i, type: 'arrival_notice', confidence: 90 },
    { pattern: /\bcargo\s+arrival\b/i, type: 'arrival_notice', confidence: 90 },
    { pattern: /\barriving\s+at\s+port/i, type: 'arrival_notice', confidence: 85 },

    // ===== HBL DRAFT (Intoglo shares with shipper for approval - BEFORE general BL) =====
    { pattern: /\bBL\s+DRAFT\s+FOR\b/i, type: 'hbl_draft', confidence: 95 },
    { pattern: /\bHBL\s+DRAFT/i, type: 'hbl_draft', confidence: 95 },
    { pattern: /\bdraft\s+(HBL|B\/?L)\b/i, type: 'hbl_draft', confidence: 95 },
    { pattern: /\bARRANGE\s+BL\s+DRAFT/i, type: 'hbl_draft', confidence: 95 },
    { pattern: /\bBL\s+for\s+(your\s+)?(approval|review)/i, type: 'hbl_draft', confidence: 90 },
    { pattern: /\bmodification.*draft\s+BL/i, type: 'hbl_draft', confidence: 90 },

    // ===== SI DRAFT (Shipper sends to Intoglo for review - BEFORE general SI) =====
    { pattern: /\bSI\s+draft/i, type: 'si_draft', confidence: 95 },
    { pattern: /\bdraft\s+SI\b/i, type: 'si_draft', confidence: 95 },
    { pattern: /\bchecklist\s+(for\s+)?(approval|review)/i, type: 'si_draft', confidence: 95 },
    { pattern: /\bSIL\s*&\s*VGM/i, type: 'si_draft', confidence: 95 },
    { pattern: /\bSI\s+for\s+(your\s+)?(approval|review)/i, type: 'si_draft', confidence: 90 },

    // ===== BILL OF LADING (general - after HBL draft) =====
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

    // ===== BOOKING CONFIRMATION (original - no UPDATE/AMENDMENT keyword) =====
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
    // Checklist (from CHA to Intoglo, or Intoglo to shipper)
    { pattern: /\bchecklist\s+(attached|for|ready)/i, type: 'checklist', confidence: 95 },
    { pattern: /\bexport\s+checklist/i, type: 'checklist', confidence: 95 },
    { pattern: /\bCHA\s+checklist/i, type: 'checklist', confidence: 95 },
    { pattern: /\bshipment\s+checklist/i, type: 'checklist', confidence: 90 },
    { pattern: /\bdocument\s+checklist/i, type: 'checklist', confidence: 85 },

    // Shipping Bill / LEO (Let Export Order)
    { pattern: /\bshipping\s+bill\s+(copy|number|attached)/i, type: 'shipping_bill', confidence: 95 },
    { pattern: /\bSB\s+(copy|no\.?|number)/i, type: 'shipping_bill', confidence: 90 },
    { pattern: /\bLEO\s+(copy|attached|received)/i, type: 'leo_copy', confidence: 95 },
    { pattern: /\blet\s+export\s+order/i, type: 'leo_copy', confidence: 95 },
    { pattern: /\bexport\s+clearance/i, type: 'shipping_bill', confidence: 85 },

    // ===== US IMPORT - CUSTOMS BROKER DOCUMENTS =====
    // Draft Entry (7501 draft from broker)
    { pattern: /\bdraft\s+entry/i, type: 'draft_entry', confidence: 95 },
    { pattern: /\bentry\s+draft/i, type: 'draft_entry', confidence: 95 },
    { pattern: /\b7501\s+draft/i, type: 'draft_entry', confidence: 95 },
    { pattern: /\bcustoms\s+entry\s+(draft|for\s+review)/i, type: 'draft_entry', confidence: 90 },
    { pattern: /\bentry\s+for\s+(review|approval)/i, type: 'draft_entry', confidence: 90 },
    { pattern: /\bentry\s+approval\s+required/i, type: 'draft_entry', confidence: 90 },
    { pattern: /\bentry\s+\d*[A-Z]{2,3}[- ]?\d+.*pre-?alert/i, type: 'draft_entry', confidence: 90 },
    // Portside 3461 format: 165-0625541-9-3461 (Immediate Delivery / Entry)
    { pattern: /\d{3}-\d{7}-\d-3461\b/, type: 'draft_entry', confidence: 95 },

    // Entry Summary (7501 filed)
    { pattern: /\bentry\s+summary/i, type: 'entry_summary', confidence: 95 },
    { pattern: /\b7501\s+(filed|submitted|summary)/i, type: 'entry_summary', confidence: 95 },
    { pattern: /\bfiled\s+entry/i, type: 'entry_summary', confidence: 90 },
    { pattern: /\bcustoms\s+entry\s+(filed|released)/i, type: 'entry_summary', confidence: 90 },
    { pattern: /\bentry\s+release/i, type: 'entry_summary', confidence: 85 },
    { pattern: /\d+-\d+-\d+-7501\b/, type: 'entry_summary', confidence: 90 },
    { pattern: /\b\d{3}-\d{7}-\d-7501\b/, type: 'entry_summary', confidence: 95 },
    // Portside standalone 7501 in subject (when not part of entry number)
    { pattern: /\b7501\b/, type: 'entry_summary', confidence: 85 },

    // Duty Invoice (customs broker format)
    { pattern: /\bduty\s+invoice/i, type: 'duty_invoice', confidence: 95 },
    { pattern: /\bduty\s+(payment|statement|summary)/i, type: 'duty_invoice', confidence: 90 },
    { pattern: /\bduty\s+bill\b/i, type: 'duty_invoice', confidence: 90 },
    { pattern: /\brequest\s+for\s+duty/i, type: 'duty_invoice', confidence: 90 },
    { pattern: /\bcustoms\s+duty/i, type: 'duty_invoice', confidence: 85 },
    { pattern: /\bimport\s+duty/i, type: 'duty_invoice', confidence: 85 },
    // Portside Invoice format: Invoice-0625541 or Invoice-0625541-A (works with Re: prefix too)
    { pattern: /\bInvoice-\d{6,}/i, type: 'duty_invoice', confidence: 95 },

    // Cargo/Customs Release (from broker)
    { pattern: /Cargo\s+Release\s+Update/i, type: 'customs_clearance', confidence: 95 },
    { pattern: /ACE\s+RELEASE/i, type: 'customs_clearance', confidence: 95 },
    { pattern: /\bDAD\b.*release/i, type: 'customs_clearance', confidence: 90 },

    // ===== TRUCKING COMPANY DOCUMENTS =====
    // Work Order (trucking dispatch/status)
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

  /**
   * Pattern-based classification using comprehensive subject patterns
   * Returns classification if confident match found, null otherwise
   * Note: direction and workflowState are set by caller
   */
  private classifyBySubjectPattern(subject: string, direction: EmailDirection): ClassificationResult | null {
    for (const { pattern, type, confidence } of this.SUBJECT_PATTERNS) {
      if (pattern.test(subject)) {
        return {
          documentType: type,
          subType: this.detectSubType(subject),
          carrierId: null,
          carrierName: null,
          confidence,
          method: 'deterministic',
          matchedPattern: pattern.toString(),
          labels: [],
          needsManualReview: false,
          classificationReason: `Subject pattern match: ${pattern.toString()}`,
          direction,
          workflowState: this.getWorkflowState(type, direction),
          classificationSource: 'subject',
        };
      }
    }
    return null;
  }

  /**
   * Pre-filter for general correspondence (thread replies without document content)
   */
  private preFilterGeneralCorrespondence(subject: string): boolean {
    // Thread replies (RE:, FW:) are usually general correspondence
    // UNLESS they match a specific document pattern (already checked before this)
    if (/^(re|fw|fwd):\s/i.test(subject)) {
      const afterPrefix = subject.replace(/^(re|fw|fwd):\s*/i, '');
      // Only allow if it's an exact carrier BC pattern
      if (!/^Booking Confirmation\s*:/i.test(afterPrefix) &&
          !/CMA CGM.*Booking confirmation/i.test(afterPrefix)) {
        return true;
      }
    }

    // Internal emails starting with "Go Green for"
    if (subject.toLowerCase().startsWith('go green for')) {
      return true;
    }

    return false;
  }

  /**
   * Check if email is a thread reply (Re:/Fwd:)
   * Thread replies should NOT use subject patterns - subject is inherited and unreliable.
   */
  private isThreadReply(subject: string): boolean {
    return /^(re|fw|fwd):\s/i.test(subject);
  }

  /**
   * Content-based classification for thread replies
   * Looks at body and attachment content, NOT subject
   */
  private classifyByContent(input: ClassificationInput, direction: EmailDirection): ClassificationResult | null {
    const content = `${input.bodyText || ''} ${input.attachmentContent || ''}`.toLowerCase();

    // Content patterns - what's actually IN this message/attachment?
    // ORDER MATTERS: More specific patterns first (si_draft, hbl_draft before general types)
    const contentPatterns: Array<{ patterns: RegExp[]; type: string; confidence: number }> = [
      // SOB - look for shipped on board indicators in content
      { patterns: [/shipped\s+on\s+board/i, /on\s*board\s+date/i, /vessel.*sailed/i], type: 'sob_confirmation', confidence: 85 },
      // Arrival notice - cargo arriving
      { patterns: [/arrival\s+notice/i, /estimated\s+arrival/i, /vessel.*arriving/i], type: 'arrival_notice', confidence: 85 },
      // Invoice - has amounts, invoice number
      { patterns: [/invoice\s+(no|number|#)/i, /amount\s+due/i, /total.*usd/i], type: 'invoice', confidence: 80 },
      // SI Draft - Shipper sends to Intoglo for review (BEFORE general SI)
      {
        patterns: [
          /si\s+draft\s+attached/i,
          /shipping\s+instruction.*for\s+(your\s+)?(review|approval)/i,
          /please\s+(review|confirm).*\bsi\b/i,
          /attached.*si\s+(details|draft|checklist)/i,
          /sil\s*&\s*vgm/i,
          /checklist\s+for\s+(approval|review)/i,
        ],
        type: 'si_draft',
        confidence: 88,
      },
      // HBL Draft - Intoglo shares with shipper for approval (BEFORE general BL)
      {
        patterns: [
          /hbl\s+draft\s+attached/i,
          /draft\s+bl\s+for\s+your\s+approval/i,
          /please\s+review.*\b(hbl|b\/l|bl)\b/i,
          /kindly\s+approve\s+the\s+bl/i,
          /attached.*draft\s+(hbl|bl|b\/l)/i,
          /\b(hbl|bl)\s+draft\s+for\s+(your\s+)?(approval|review)/i,
        ],
        type: 'hbl_draft',
        confidence: 88,
      },
      // Bill of Lading - general BL content (after HBL draft)
      { patterns: [/bill\s+of\s+lading/i, /b\/l\s+(no|number)/i, /sea\s*waybill/i], type: 'bill_of_lading', confidence: 85 },
      // Delivery Order
      { patterns: [/delivery\s+order/i, /release\s+auth/i, /container\s+release/i], type: 'delivery_order', confidence: 85 },
      // VGM
      { patterns: [/verified\s+gross\s+mass/i, /vgm.*confirm/i, /container.*weight/i], type: 'vgm_confirmation', confidence: 85 },
    ];

    for (const { patterns, type, confidence } of contentPatterns) {
      if (patterns.some(p => p.test(content))) {
        return {
          documentType: type,
          subType: this.detectSubType(input.subject),
          carrierId: null,
          carrierName: null,
          confidence,
          method: 'deterministic',
          matchedPattern: 'content_pattern',
          labels: [],
          needsManualReview: false,
          classificationReason: `Content pattern match for ${type}`,
          direction,
          workflowState: this.getWorkflowState(type, direction),
          classificationSource: 'body',
        };
      }
    }
    return null;
  }

  /**
   * Get workflow state for document type and direction
   */
  private getWorkflowState(documentType: string, direction: EmailDirection): string | null {
    const key = `${documentType}:${direction}`;
    return WORKFLOW_STATE_MAP[key] || null;
  }

  /**
   * Clean subject by removing RE:/FW: prefixes
   */
  private cleanSubject(subject: string): string {
    return subject.replace(/^(RE|Re|FW|Fw|FWD|Fwd):\s*/gi, '').trim();
  }

  /**
   * Classify an email using multi-signal priority:
   *
   * 1. Detect direction (INBOUND vs OUTBOUND)
   * 2. Try attachment patterns (highest priority - 95%)
   * 3. Try body indicators (priority 2 - 90%)
   * 4. Try subject patterns:
   *    - Carrier patterns (for shipping line emails)
   *    - Intoglo patterns (for outbound emails)
   *    - Partner patterns (for inbound non-carrier)
   * 5. AI fallback (for unknowns)
   *
   * All results include direction and workflow state.
   */
  async classify(input: ClassificationInput): Promise<ClassificationResult> {
    const sender = input.trueSenderEmail || input.senderEmail;
    const direction = detectDirection(sender);
    const cleanedSubject = this.cleanSubject(input.subject);
    const isReply = this.isThreadReply(input.subject);

    // Helper to build result with direction and workflow state
    const buildResult = (
      documentType: string,
      confidence: number,
      source: 'attachment' | 'body' | 'subject' | 'carrier' | 'intoglo' | 'partner' | 'ai',
      matchedPattern: string,
      carrierId?: string,
      carrierName?: string
    ): ClassificationResult => ({
      documentType,
      subType: this.detectSubType(input.subject),
      carrierId: carrierId || null,
      carrierName: carrierName || null,
      confidence: isReply ? Math.max(confidence - 20, 50) : confidence,
      method: source === 'ai' ? 'ai' : 'deterministic',
      matchedPattern,
      labels: this.inferLabels(input),
      needsManualReview: confidence < 70,
      classificationReason: `${source} pattern match: ${matchedPattern}`,
      direction,
      workflowState: this.getWorkflowState(documentType, direction),
      classificationSource: source,
    });

    // ===== STEP 1: Attachment patterns (highest priority) =====
    if (input.attachmentFilenames && input.attachmentFilenames.length > 0) {
      const attachmentMatch = matchAttachmentPatterns(input.attachmentFilenames);
      if (attachmentMatch) {
        return buildResult(
          attachmentMatch.type,
          95,
          'attachment',
          attachmentMatch.pattern
        );
      }
    }

    // ===== STEP 2: Body indicators (priority 2) =====
    if (input.bodyText && input.bodyText.length > 20) {
      const bodyMatch = matchBodyIndicator(input.bodyText);
      if (bodyMatch) {
        return buildResult(
          bodyMatch.type,
          90,
          'body',
          bodyMatch.pattern
        );
      }
    }

    // ===== STEP 3: Subject-based classification =====

    // 3a: For thread replies, try content-based first
    if (isReply) {
      const contentResult = this.classifyByContent(input, direction);
      if (contentResult) {
        contentResult.labels = this.inferLabels(input);
        return contentResult;
      }
    }

    // 3b: Try internal subject patterns
    const subjectPatternResult = this.classifyBySubjectPattern(cleanedSubject, direction);
    if (subjectPatternResult && subjectPatternResult.confidence >= 85) {
      subjectPatternResult.labels = this.inferLabels(input);
      return subjectPatternResult;
    }

    // 3c: Carrier-specific patterns
    const carrierResult = classifyCarrierEmail(
      cleanedSubject,
      sender,
      input.attachmentFilenames,
      input.attachmentContent
    );

    if (carrierResult && carrierResult.confidence > 0) {
      return buildResult(
        carrierResult.documentType,
        carrierResult.confidence,
        'carrier',
        carrierResult.matchedPattern,
        carrierResult.carrierId,
        carrierResult.carrierName
      );
    }

    // 3d: For outbound emails, try Intoglo patterns
    if (direction === 'outbound') {
      const intogloMatch = matchIntogloPattern(cleanedSubject);
      if (intogloMatch) {
        return buildResult(
          intogloMatch.type,
          90,
          'intoglo',
          intogloMatch.pattern
        );
      }
    }

    // 3e: For inbound non-carrier, try partner patterns
    if (direction === 'inbound') {
      const partnerMatch = matchPartnerPattern(cleanedSubject);
      if (partnerMatch) {
        return buildResult(
          partnerMatch.type,
          85,
          'partner',
          partnerMatch.pattern
        );
      }
    }

    // ===== STEP 4: AI fallback =====
    if (this.useAiFallback && this.anthropic) {
      return await this.classifyWithAI(input, direction);
    }

    // ===== STEP 5: Default to unknown =====
    return {
      documentType: 'general_correspondence',
      subType: null,
      carrierId: null,
      carrierName: null,
      confidence: 0,
      method: 'deterministic',
      matchedPattern: 'no_match',
      labels: [],
      needsManualReview: true,
      classificationReason: 'No pattern matched and AI fallback disabled',
      direction,
      workflowState: null,
      classificationSource: undefined,
    };
  }

  /**
   * AI-based classification using structured tool_use
   */
  private async classifyWithAI(input: ClassificationInput, direction: EmailDirection): Promise<ClassificationResult> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized');
    }

    const prompt = this.buildAIPrompt(input);

    try {
      const response = await this.anthropic.messages.create({
        model: this.aiModel,
        max_tokens: 400,
        tools: [CLASSIFICATION_TOOL],
        tool_choice: { type: 'tool', name: 'classify_shipping_email' },
        messages: [{ role: 'user', content: prompt }],
      });

      // Extract tool use result (structured output)
      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      );

      if (toolUse && toolUse.name === 'classify_shipping_email') {
        const result = toolUse.input as {
          document_type: string;
          sub_type?: string;
          confidence: number;
          labels?: string[];
          carrier?: string;
          reasoning: string;
        };

        return {
          documentType: result.document_type,
          subType: (result.sub_type as DocumentSubType) || null,
          carrierId: result.carrier || null,
          carrierName: result.carrier ? this.getCarrierName(result.carrier) : null,
          confidence: result.confidence,
          method: 'ai',
          labels: result.labels || [],
          needsManualReview: result.confidence < 70,
          classificationReason: result.reasoning,
          direction,
          workflowState: this.getWorkflowState(result.document_type, direction),
          classificationSource: 'ai',
        };
      }
    } catch (err) {
      console.error('[UnifiedClassification] AI classification failed:', err);
    }

    // Fallback on AI failure
    return {
      documentType: 'general_correspondence',
      subType: null,
      carrierId: null,
      carrierName: null,
      confidence: 0,
      method: 'ai',
      labels: [],
      needsManualReview: true,
      classificationReason: 'AI classification failed',
      direction,
      workflowState: null,
      classificationSource: 'ai',
    };
  }

  /**
   * Build AI prompt with expert persona and few-shot examples
   */
  private buildAIPrompt(input: ClassificationInput): string {
    const bodyContent = input.bodyText || input.snippet || '';
    const truncatedBody = bodyContent.length > 3000
      ? bodyContent.substring(0, 3000) + '...'
      : bodyContent;

    const attachmentInfo = input.attachmentFilenames?.length
      ? `Attachments: ${input.attachmentFilenames.join(', ')}`
      : 'Attachments: None';

    const pdfContent = input.attachmentContent && input.attachmentContent.length > 100
      ? `\nPDF CONTENT (first 2000 chars):\n${input.attachmentContent.substring(0, 2000)}`
      : '';

    return `You are an EXPERT freight forwarding document classifier with 20+ years of experience in international shipping logistics. You work for Intoglo, a freight forwarder handling ocean freight shipments.

YOUR EXPERTISE:
- Deep knowledge of shipping document lifecycle: Booking → SI → VGM → SOB → BL → Arrival → Delivery
- Understanding of carrier-specific document formats (Maersk, Hapag-Lloyd, CMA CGM, MSC, etc.)
- Ability to distinguish between similar document types based on subtle differences

CRITICAL DISTINCTIONS (pay close attention):

1. **SOB CONFIRMATION vs ARRIVAL NOTICE** (MOST COMMON ERROR):
   - sob_confirmation = Container LOADED onto vessel, ship is DEPARTING (beginning of voyage)
   - arrival_notice = Ship is ARRIVING at destination port (end of voyage)
   - "Sailed" or "On Board" = SOB (departure), NOT arrival
   - If subject says "SOB" → ALWAYS sob_confirmation

2. **BOOKING vs INVOICE**:
   - booking_confirmation = New booking, has booking number, vessel schedule, cutoffs
   - invoice = Has invoice number, amounts due, payment terms
   - If no invoice number or amounts → NOT an invoice

3. **BOOKING CONFIRMATION vs BOOKING AMENDMENT**:
   - booking_confirmation = Original booking (often says "1ST COPY" or first issuance)
   - booking_amendment = Changes to existing booking (says "UPDATE", "AMENDMENT", "REVISED", "2ND/3RD COPY")

DOCUMENT TYPES WITH DEFINITIONS:
- booking_confirmation: Original booking from carrier (PDF has "BOOKING CONFIRMATION" heading)
- booking_amendment: Updates to existing booking (schedule change, equipment change, routing change)
- booking_cancellation: Booking cancelled by carrier or shipper
- sob_confirmation: Shipped on Board - cargo LOADED onto vessel, vessel DEPARTING
- arrival_notice: Notification that vessel is ARRIVING at destination port
- bill_of_lading: B/L document (draft, final, house, master, sea waybill)
- shipping_instruction: SI submission or confirmation
- invoice: Freight invoice with amounts and payment details
- vgm_confirmation: VGM (Verified Gross Mass) accepted/confirmed
- vgm_reminder: Reminder to submit VGM
- delivery_order: Authorization to release cargo
- customs_clearance: Customs entry, clearance, ISF filing
- rate_quote: Price quotation for freight
- vessel_schedule: Sailing schedule updates
- pickup_notification: Container ready for pickup
- cutoff_advisory: Cut-off time changes
- shipment_notice: FMC filing, shipment updates
- si_submission: SI declaration
- general_correspondence: Operational emails, replies, non-document content

FEW-SHOT EXAMPLES:

Example 1:
Subject: "SOB CONFIRMATION // Re: 262822342 : Intoglo Quote"
Classification: sob_confirmation (95% confidence)
Reasoning: Subject explicitly says "SOB CONFIRMATION" - this is Shipped on Board notification, cargo is loaded and ship is departing.

Example 2:
Subject: "Arrival Notice - Container MRSU1234567 arriving Newark"
Classification: arrival_notice (95% confidence)
Reasoning: Explicitly mentions "Arrival Notice" and cargo arriving at destination port.

Example 3:
Subject: "2ND UPDATE Booking Confirmation : 263441600"
Classification: booking_amendment (95% confidence)
Reasoning: "2ND UPDATE" indicates this is an amendment to existing booking, not original confirmation.

Example 4:
Subject: "Re: Intoglo Quote for ABC Corp | Mumbai to LA"
Classification: general_correspondence (80% confidence)
Reasoning: Thread reply (Re:) without specific document type indicator, likely operational discussion.

NOW CLASSIFY THIS EMAIL:
Subject: ${input.subject}
From: ${input.senderEmail}
${input.trueSenderEmail ? `True Sender: ${input.trueSenderEmail}` : ''}
${attachmentInfo}

Body:
${truncatedBody || '(no body content)'}
${pdfContent}

Use the classify_shipping_email tool. Be precise and confident in your classification.`;
  }

  /**
   * Detect sub-type from subject line
   */
  private detectSubType(subject: string): DocumentSubType {
    const s = subject.toLowerCase();

    // Check for revision patterns
    const revisionMatch = subject.match(/(\d+)(?:st|nd|rd|th)\s+(?:UPDATE|REVISION|AMENDMENT)/i);
    if (revisionMatch) {
      const num = parseInt(revisionMatch[1]);
      if (num === 1) return '1st_update';
      if (num === 2) return '2nd_update';
      if (num === 3) return '3rd_update';
      return 'update';
    }

    if (/draft/i.test(s)) return 'draft';
    if (/final/i.test(s)) return 'final';
    if (/amend|revis|update/i.test(s)) return 'amendment';
    if (/cancel/i.test(s)) return 'cancellation';
    if (/copy/i.test(s)) return 'copy';

    return 'original';
  }

  /**
   * Infer labels from content
   */
  private inferLabels(input: ClassificationInput): string[] {
    const labels: string[] = [];
    const content = `${input.subject} ${input.bodyText || ''} ${input.attachmentContent || ''}`.toLowerCase();

    if (/cut[-\s]?off|deadline|closing/i.test(content)) labels.push('contains_cutoffs');
    if (/etd|eta|departure|arrival|schedule/i.test(content)) labels.push('contains_schedule');
    if (/port of|pol|pod|routing|tranship/i.test(content)) labels.push('contains_routing');
    if (/rate|freight|charge|usd|eur/i.test(content)) labels.push('contains_rates');
    if (/urgent|immediate|asap|today/i.test(content)) labels.push('urgent');
    if (/please confirm|kindly.*action|required.*action/i.test(content)) labels.push('requires_action');
    if (/vessel.*change|change.*vessel/i.test(content)) labels.push('vessel_change');
    if (/schedule.*change|etd.*change|eta.*change/i.test(content)) labels.push('schedule_change');
    if (/amend|change|update|revis/i.test(content)) labels.push('amendment_notice');

    return labels;
  }

  /**
   * Get carrier display name
   */
  private getCarrierName(carrierId: string): string {
    const names: Record<string, string> = {
      maersk: 'Maersk Line',
      'hapag-lloyd': 'Hapag-Lloyd',
      'cma-cgm': 'CMA CGM',
      cosco: 'COSCO Shipping',
      msc: 'MSC',
      evergreen: 'Evergreen',
      one: 'ONE',
      'yang-ming': 'Yang Ming',
    };
    return names[carrierId.toLowerCase()] || carrierId;
  }

  // ============================================================================
  // Database Operations
  // ============================================================================

  /**
   * Save classification to database
   */
  async saveClassification(emailId: string, result: ClassificationResult): Promise<void> {
    // Delete existing classification if any, then insert new one
    await this.supabase
      .from('document_classifications')
      .delete()
      .eq('email_id', emailId);

    const { error } = await this.supabase
      .from('document_classifications')
      .insert({
        email_id: emailId,
        document_type: result.documentType,
        revision_type: result.subType,
        confidence_score: result.confidence,
        model_name: result.method === 'ai' ? this.aiModel : 'deterministic',
        model_version: result.method === 'ai' ? 'v1|ai' : 'v2|deterministic',
        classification_reason: result.classificationReason,
        is_manual_review: result.needsManualReview,
        document_direction: result.direction,
        workflow_state: result.workflowState,
        classified_at: new Date().toISOString(),
      });

    if (error) {
      throw new Error(`Failed to save classification: ${error.message}`);
    }
  }

  /**
   * Classify and save in one call
   */
  async classifyAndSave(input: ClassificationInput): Promise<ClassificationResult> {
    const result = await this.classify(input);
    await this.saveClassification(input.emailId, result);
    return result;
  }

  /**
   * Batch classify emails
   */
  async classifyBatch(inputs: ClassificationInput[]): Promise<Map<string, ClassificationResult>> {
    const results = new Map<string, ClassificationResult>();

    for (const input of inputs) {
      const result = await this.classify(input);
      results.set(input.emailId, result);
    }

    return results;
  }
}

// ============================================================================
// Factory function
// ============================================================================

export function createClassificationService(
  supabase: SupabaseClient,
  options?: { useAiFallback?: boolean; aiModel?: string }
): UnifiedClassificationService {
  return new UnifiedClassificationService(supabase, options);
}

// ============================================================================
// Standalone Functions (no Supabase/AI required)
// Synchronous classification for simple use cases
// ============================================================================

export interface EmailClassificationInput {
  subject: string;
  senderEmail: string;
  bodyText?: string;
  attachmentFilenames?: string[];
  attachmentContent?: string;
}

export interface SimpleClassificationResult {
  documentType: string;
  direction: EmailDirection;
  workflowState: string | null;
  confidence: number;
  source: 'attachment' | 'body' | 'subject' | 'carrier' | 'intoglo' | 'partner' | 'unknown';
  matchedPattern?: string;
  category?: string;
  carrierId?: string;
  carrierName?: string;
}

/**
 * Get workflow state for document type and direction (standalone function)
 */
export function getWorkflowState(documentType: string, direction: EmailDirection): string | null {
  const key = `${documentType}:${direction}`;
  return WORKFLOW_STATE_MAP[key] || null;
}

/**
 * Get all possible workflow states for a document type
 */
export function getWorkflowStatesForType(documentType: string): { inbound?: string; outbound?: string } {
  return {
    inbound: WORKFLOW_STATE_MAP[`${documentType}:inbound`],
    outbound: WORKFLOW_STATE_MAP[`${documentType}:outbound`],
  };
}

/**
 * Get all document types that lead to a specific workflow state
 */
export function getDocumentTypesForState(workflowState: string): string[] {
  const types: string[] = [];
  for (const [key, value] of Object.entries(WORKFLOW_STATE_MAP)) {
    if (value === workflowState) {
      const [docType] = key.split(':');
      if (!types.includes(docType)) {
        types.push(docType);
      }
    }
  }
  return types;
}

/**
 * Clean subject by removing RE:/FW: prefixes
 */
function cleanSubjectLine(subject: string): string {
  return subject.replace(/^(RE|Re|FW|Fw|FWD|Fwd):\s*/gi, '').trim();
}

/**
 * Synchronous document classification (no AI fallback)
 * Use this for simple classification without database/AI dependencies
 */
export function classifyDocument(input: EmailClassificationInput): SimpleClassificationResult {
  const direction = detectDirection(input.senderEmail);
  const cleanedSubject = cleanSubjectLine(input.subject);

  // Priority 1: Attachment patterns (95% confidence)
  if (input.attachmentFilenames && input.attachmentFilenames.length > 0) {
    const attachmentMatch = matchAttachmentPatterns(input.attachmentFilenames);
    if (attachmentMatch) {
      return {
        documentType: attachmentMatch.type,
        direction,
        workflowState: getWorkflowState(attachmentMatch.type, direction),
        confidence: 95,
        source: 'attachment',
        matchedPattern: attachmentMatch.pattern,
      };
    }
  }

  // Priority 2: Body indicators (90% confidence)
  if (input.bodyText && input.bodyText.length > 20) {
    const bodyMatch = matchBodyIndicator(input.bodyText);
    if (bodyMatch) {
      return {
        documentType: bodyMatch.type,
        direction,
        workflowState: getWorkflowState(bodyMatch.type, direction),
        confidence: 90,
        source: 'body',
        matchedPattern: bodyMatch.pattern,
      };
    }
  }

  // Priority 3: Carrier patterns (for shipping line emails)
  if (isShippingLineEmail(input.senderEmail)) {
    const carrierResult = classifyCarrierEmail(
      cleanedSubject,
      input.senderEmail,
      input.attachmentFilenames,
      input.attachmentContent
    );

    if (carrierResult && carrierResult.confidence > 0) {
      return {
        documentType: carrierResult.documentType,
        direction,
        workflowState: getWorkflowState(carrierResult.documentType, direction),
        confidence: carrierResult.confidence,
        source: 'carrier',
        matchedPattern: carrierResult.matchedPattern,
        carrierId: carrierResult.carrierId,
        carrierName: carrierResult.carrierName,
      };
    }
  }

  // Priority 4: Intoglo patterns (outbound emails)
  if (direction === 'outbound') {
    const intogloMatch = matchIntogloPattern(cleanedSubject);
    if (intogloMatch) {
      return {
        documentType: intogloMatch.type,
        direction,
        workflowState: getWorkflowState(intogloMatch.type, direction),
        confidence: 90,
        source: 'intoglo',
        matchedPattern: intogloMatch.pattern,
        category: intogloMatch.category,
      };
    }
  }

  // Priority 5: Partner patterns (inbound non-carrier emails)
  if (direction === 'inbound') {
    const partnerMatch = matchPartnerPattern(cleanedSubject);
    if (partnerMatch) {
      return {
        documentType: partnerMatch.type,
        direction,
        workflowState: getWorkflowState(partnerMatch.type, direction),
        confidence: 85,
        source: 'partner',
        matchedPattern: partnerMatch.pattern,
        category: partnerMatch.category,
      };
    }
  }

  // No match - return unknown
  return {
    documentType: 'unknown',
    direction,
    workflowState: null,
    confidence: 0,
    source: 'unknown',
  };
}

/**
 * Batch classify multiple emails (synchronous)
 */
export function classifyDocuments(inputs: EmailClassificationInput[]): SimpleClassificationResult[] {
  return inputs.map(classifyDocument);
}

/**
 * Check if document needs AI classification
 */
export function needsAIClassification(result: SimpleClassificationResult): boolean {
  return result.source === 'unknown' || result.confidence < 50;
}

// Re-export EmailDirection for convenience
export type { EmailDirection } from '../utils/direction-detector';
