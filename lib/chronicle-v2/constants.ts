/**
 * Chronicle V2 Constants
 *
 * Score weights, phase mappings, and theme configuration.
 * Configuration over code - easy to tune without changing logic.
 */

import type { Phase, SignalTier } from './types';

// =============================================================================
// ATTENTION SCORE WEIGHTS
// =============================================================================

export const SCORE_WEIGHTS = {
  // Issues - highest priority
  ACTIVE_ISSUE: 100,
  ISSUE_DELAY: 50,
  ISSUE_ROLLOVER: 60,
  ISSUE_HOLD: 40,
  ISSUE_DOCUMENTATION: 30,
  ISSUE_CUSTOMS: 35,
  ISSUE_DAMAGE: 45,

  // Actions
  PENDING_ACTION: 10,
  OVERDUE_ACTION: 40,
  ACTION_PRIORITY_CRITICAL: 80,
  ACTION_PRIORITY_HIGH: 40,
  ACTION_PRIORITY_MEDIUM: 20,
  ACTION_PRIORITY_LOW: 5,

  // ETD urgency
  ETD_WITHIN_1_DAY: 75,
  ETD_WITHIN_3_DAYS: 50,
  ETD_WITHIN_7_DAYS: 25,

  // Cutoff urgency
  CUTOFF_OVERDUE: 100,
  CUTOFF_WITHIN_1_DAY: 60,
  CUTOFF_WITHIN_3_DAYS: 30,

  // Activity decay (negative = lower priority)
  STALE_3_DAYS: -20,
  STALE_7_DAYS: -40,

  // Phase adjustments
  PHASE_COMPLETED: -50,
} as const;

// =============================================================================
// SIGNAL TIER THRESHOLDS
// =============================================================================

export const SIGNAL_THRESHOLDS = {
  STRONG: 60, // 60+ = strong signal, needs immediate attention
  MEDIUM: 35, // 35-59 = medium signal, main view
  WEAK: 15, // 15-34 = weak signal, watchlist
  NOISE: 0, // <15 = noise, hidden by default
} as const;

export function getSignalTier(score: number): SignalTier {
  if (score >= SIGNAL_THRESHOLDS.STRONG) return 'strong';
  if (score >= SIGNAL_THRESHOLDS.MEDIUM) return 'medium';
  if (score >= SIGNAL_THRESHOLDS.WEAK) return 'weak';
  return 'noise';
}

// =============================================================================
// PHASE MAPPINGS
// =============================================================================

// Map database stages to UI phases
export const STAGE_TO_PHASE: Record<string, Phase> = {
  // Origin phase (pre-departure)
  PENDING: 'origin',
  REQUESTED: 'origin',
  BOOKED: 'origin',
  SI_STAGE: 'origin',
  DRAFT_BL: 'origin',

  // In transit
  BL_ISSUED: 'in_transit',
  DEPARTED: 'in_transit',
  IN_TRANSIT: 'in_transit',

  // Destination (post-arrival)
  ARRIVED: 'destination',
  CUSTOMS: 'destination',
  CLEARED: 'destination',

  // Completed
  DELIVERED: 'completed',
};

// Stages that belong to each phase (for filtering)
// "origin" = Departure (pre-sailing), "destination" = Arrival (post-sailing)
export const PHASE_STAGES: Record<Phase, string[]> = {
  all: [],
  // Departure: shipments at origin, haven't sailed yet
  origin: ['PENDING', 'REQUESTED', 'BOOKED', 'SI_SUBMITTED', 'SI_CONFIRMED', 'BL_DRAFT', 'BL_ISSUED'],
  // In Transit (not used in UI but kept for backward compatibility)
  in_transit: ['DEPARTED', 'IN_TRANSIT'],
  // Arrival: shipments that have sailed or arrived
  destination: ['DEPARTED', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS_CLEARED', 'DELIVERED', 'COMPLETED'],
  completed: ['DELIVERED', 'COMPLETED'],
};

// Human-readable phase labels
export const PHASE_LABELS: Record<Phase, string> = {
  all: 'All',
  origin: 'Origin',
  in_transit: 'In Transit',
  destination: 'Destination',
  completed: 'Completed',
};

// =============================================================================
// DIRECTION DETECTION
// =============================================================================

// Indian port codes (common export origins)
export const INDIAN_PORT_CODES = [
  'INNSA', // Nhava Sheva
  'INMUN', // Mundra
  'INCHE', // Chennai
  'INKOL', // Kolkata
  'INCCU', // Cochin
  'INTUT', // Tuticorin
  'INBLR', // Bangalore (ICD)
  'INDEL', // Delhi (ICD)
  'INPNQ', // Pune (ICD)
  'INHYD', // Hyderabad (ICD)
  'INBOM', // Mumbai (old code)
  'INMAA', // Chennai (IATA)
  'INVTZ', // Visakhapatnam
  'INKRI', // Krishnapatnam
  'INGOI', // Goa
  'INKTP', // Kakinada
];

export function detectDirection(
  polCode: string | null,
  podCode: string | null
): 'export' | 'import' {
  // If POL is Indian port, it's export
  if (polCode && INDIAN_PORT_CODES.some((code) => polCode.toUpperCase().startsWith(code.slice(0, 2)))) {
    return 'export';
  }
  // If POD is Indian port, it's import
  if (podCode && INDIAN_PORT_CODES.some((code) => podCode.toUpperCase().startsWith(code.slice(0, 2)))) {
    return 'import';
  }
  // Default to export (most common for Indian forwarder)
  return 'export';
}

// =============================================================================
// CUTOFF CONFIGURATION
// =============================================================================

export const CUTOFF_CONFIG = {
  si: { label: 'SI Cutoff', priority: 1 },
  vgm: { label: 'VGM Cutoff', priority: 2 },
  cargo: { label: 'Cargo Cutoff', priority: 3 },
  doc: { label: 'Doc Cutoff', priority: 4 },
  lfd: { label: 'Last Free Day', priority: 5 },
} as const;

export type CutoffType = keyof typeof CUTOFF_CONFIG;

// =============================================================================
// ISSUE TYPE CONFIGURATION
// =============================================================================

export const ISSUE_TYPES = {
  delay: { label: 'Delay', severity: 'high', icon: 'clock' },
  rollover: { label: 'Rollover', severity: 'high', icon: 'rotate-ccw' },
  hold: { label: 'Hold', severity: 'high', icon: 'pause-circle' },
  documentation: { label: 'Documentation', severity: 'medium', icon: 'file-x' },
  customs: { label: 'Customs', severity: 'medium', icon: 'shield-alert' },
  damage: { label: 'Damage', severity: 'high', icon: 'alert-triangle' },
  shortage: { label: 'Shortage', severity: 'medium', icon: 'package-minus' },
  detention: { label: 'Detention', severity: 'medium', icon: 'timer' },
  demurrage: { label: 'Demurrage', severity: 'medium', icon: 'dollar-sign' },
  other: { label: 'Other', severity: 'low', icon: 'info' },
} as const;

// =============================================================================
// DOCUMENT TYPE LABELS
// =============================================================================

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  // Booking stage
  rate_request: 'Rate Request',
  quotation: 'Quotation',
  booking_request: 'Booking Request',
  booking_confirmation: 'Booking Confirmation',
  booking_amendment: 'Booking Amendment',
  forwarding_note: 'Forwarding Note',
  // Documentation stage
  shipping_instructions: 'Shipping Instructions',
  si_confirmation: 'SI Confirmation',
  vgm_confirmation: 'VGM Confirmation',
  draft_bl: 'Draft B/L',
  final_bl: 'Final B/L',
  house_bl: 'House B/L',
  sea_waybill: 'Sea Waybill',
  air_waybill: 'Air Waybill',
  sob_confirmation: 'SOB Confirmation',
  telex_release: 'Telex Release',
  // Arrival & Delivery
  arrival_notice: 'Arrival Notice',
  delivery_order: 'Delivery Order',
  release_order: 'Release Order',
  gate_pass: 'Gate Pass',
  container_release: 'Container Release',
  freight_release: 'Freight Release',
  pod_proof_of_delivery: 'Proof of Delivery',
  // Trucking
  dispatch_order: 'Dispatch Order',
  work_order: 'Work Order',
  rate_confirmation: 'Rate Confirmation',
  bol_truck: 'Truck BOL',
  // Compliance
  customs_entry: 'Customs Entry',
  entry_summary: 'Entry Summary',
  isf_filing: 'ISF Filing',
  duty_invoice: 'Duty Invoice',
  shipping_bill: 'Shipping Bill',
  leo_copy: 'LEO Copy',
  checklist: 'Checklist',
  // Financial
  invoice: 'Invoice',
  debit_note: 'Debit Note',
  credit_note: 'Credit Note',
  payment_receipt: 'Payment Receipt',
  statement: 'Statement',
  // Updates & Notifications
  schedule_update: 'Schedule Update',
  tracking_update: 'Tracking Update',
  exception_notice: 'Exception Notice',
  // Communication types
  approval: 'Approval',
  request: 'Request',
  escalation: 'Escalation',
  acknowledgement: 'Acknowledgement',
  notification: 'Notification',
  internal_notification: 'Internal',
  system_notification: 'System',
  general_correspondence: 'General',
  internal_communication: 'Internal Comm',
  unknown: 'Unknown',
};

export function getDocumentTypeLabel(type: string): string {
  return DOCUMENT_TYPE_LABELS[type] || type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// =============================================================================
// PARTY TYPE LABELS
// =============================================================================

export const PARTY_TYPE_LABELS: Record<string, string> = {
  ocean_carrier: 'Carrier',
  nvocc: 'NVOCC',
  customs_broker: 'Customs Broker',
  trucker: 'Trucker',
  freight_forwarder: 'Forwarder',
  shipper: 'Shipper',
  consignee: 'Consignee',
  port_terminal: 'Terminal',
  warehouse: 'Warehouse',
  internal: 'Internal',
  customer: 'Customer',
  agent: 'Agent',
};

// =============================================================================
// TIME WINDOW CONFIGURATION
// =============================================================================

export const TIME_WINDOW_CONFIG = {
  today: {
    label: 'Today',
    description: 'Today + Overdue',
    daysBack: 0,
    daysForward: 0,
    includeOverdue: true,
  },
  '3days': {
    label: '3 Days',
    description: 'Next 3 days',
    daysBack: 0,
    daysForward: 3,
    includeOverdue: true,
  },
  '7days': {
    label: 'Week',
    description: 'This week',
    daysBack: 0,
    daysForward: 7,
    includeOverdue: true,
  },
  all: {
    label: 'All',
    description: 'All time',
    daysBack: 365,
    daysForward: 365,
    includeOverdue: true,
  },
} as const;

// =============================================================================
// PAGINATION DEFAULTS
// =============================================================================

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 50,
  MAX_PAGE_SIZE: 200,
} as const;
