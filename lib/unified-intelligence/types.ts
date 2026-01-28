/**
 * Unified Intelligence Types
 *
 * Combines INTDB (email intelligence) with Carrier APIs (live tracking)
 * for complete shipment visibility with cross-validation.
 *
 * Following CLAUDE.md principles:
 * - Interface-Based Design (Principle #6)
 * - Define Errors Out of Existence (Principle #13)
 */

// =============================================================================
// CARRIER API TYPES
// =============================================================================

export type CarrierCode = 'maersk' | 'hapag' | 'unknown';

export type ShipmentStatus =
  | 'NOT_SAILED'
  | 'ON_WATER'
  | 'ARRIVED'
  | 'INLAND_DELIVERY'
  | 'DELIVERED'
  | 'UNKNOWN';

export interface CarrierTrackingData {
  source: CarrierCode;
  containerNumber: string;
  status: ShipmentStatus;

  // Location
  currentLocation: string | null;
  originPort: string | null;
  destinationPort: string | null;

  // Vessel
  vesselName: string | null;
  voyageNumber: string | null;
  vesselImo: string | null;

  // Dates (ISO 8601)
  etd: string | null;  // Estimated Time of Departure
  atd: string | null;  // Actual Time of Departure
  eta: string | null;  // Estimated Time of Arrival
  ata: string | null;  // Actual Time of Arrival

  // Events
  totalEvents: number;
  recentEvents: CarrierEvent[];

  // Metadata
  lastSyncAt: string;
  apiSuccess: boolean;
  apiError: string | null;
}

export interface CarrierEvent {
  eventDateTime: string;
  eventType: 'TRANSPORT' | 'EQUIPMENT' | 'SHIPMENT';
  eventCode: string;
  eventClassifier: 'ACT' | 'PLN' | 'EST';
  location: string | null;
  description: string;
}

export interface CarrierDeadlines {
  bookingNumber: string;
  carrier: CarrierCode;
  deadlines: Deadline[];
  terminal: string | null;
  lastSyncAt: string;
}

export interface Deadline {
  type: 'SI_CUTOFF' | 'VGM_CUTOFF' | 'CARGO_CUTOFF' | 'DOC_CUTOFF' | 'AMS_CUTOFF';
  dateTime: string;
  status: 'COMPLETED' | 'UPCOMING' | 'OVERDUE';
  completedAt: string | null;
}

export interface CarrierCharges {
  containerNumber: string;
  carrier: CarrierCode;
  port: string;
  portCode: string;

  // Free time
  portFreeDays: number;
  detentionFreeDays: number;
  lastFreeDay: string | null;

  // Current charges
  demurrageCharges: number;
  detentionCharges: number;
  totalCharges: number;
  currency: string;
  chargeableDays: number;

  // Rate schedule
  rateSchedule: RateTier[];

  isFinalCharge: boolean;
  lastSyncAt: string;
}

export interface RateTier {
  dayStart: number;
  dayEnd: number | null;
  ratePerDay: number;
  currency: string;
}

// =============================================================================
// INTDB TYPES
// =============================================================================

export interface IntdbShipmentData {
  // Identifiers
  bookingNumber: string | null;
  mblNumber: string | null;
  hblNumber: string | null;
  containerNumbers: string[];

  // Parties
  shipperName: string | null;
  shipperAddress: string | null;
  consigneeName: string | null;
  consigneeAddress: string | null;
  notifyPartyName: string | null;

  // Routing
  polLocation: string | null;
  podLocation: string | null;

  // Vessel (from emails)
  vesselName: string | null;
  voyageNumber: string | null;

  // Dates (from emails)
  etd: string | null;
  eta: string | null;
  lastFreeDay: string | null;

  // Documents
  documentsReceived: DocumentStatus[];
  documentsPending: string[];
  documentCompletionRate: number;  // 0-100

  // Actions
  pendingActions: PendingAction[];
  overdueActions: PendingAction[];

  // Communication
  emailCount: number;
  lastEmailDate: string | null;
  lastEmailSummary: string | null;
  hasUrgentEmails: boolean;
  hasIssues: boolean;
  issueDescriptions: string[];

  // Metadata
  firstEmailDate: string | null;
  dataSource: 'intdb';
}

export interface DocumentStatus {
  type: string;
  displayName: string;
  receivedAt: string;
  status: 'RECEIVED' | 'PENDING' | 'ACTION_REQUIRED';
}

export interface PendingAction {
  id: string;
  description: string;
  documentType: string;
  owner: string | null;
  deadline: string | null;
  priority: 'low' | 'medium' | 'high' | 'critical';
  createdAt: string;
  bookingNumber: string | null;
  isOverdue: boolean;
}

// =============================================================================
// UNIFIED TYPES
// =============================================================================

export interface UnifiedShipmentStatus {
  // Primary identifiers
  containerNumber: string | null;
  bookingNumber: string | null;
  mblNumber: string | null;

  // Carrier data (live)
  carrier: CarrierTrackingData | null;

  // INTDB data (email intelligence)
  intdb: IntdbShipmentData | null;

  // Cross-validation results
  validation: ValidationResult;

  // Merged/best values
  merged: MergedShipmentData;

  // Metadata
  queriedAt: string;
  queryReference: string;
}

export interface MergedShipmentData {
  // Use carrier API as source of truth for live data
  status: ShipmentStatus;
  currentLocation: string | null;
  vesselName: string | null;

  // Dates: prefer carrier API, fallback to INTDB
  etd: string | null;
  etdSource: 'carrier' | 'intdb' | null;
  eta: string | null;
  etaSource: 'carrier' | 'intdb' | null;

  // Routing: merge both sources
  originPort: string | null;
  destinationPort: string | null;

  // Parties: from INTDB only
  shipperName: string | null;
  consigneeName: string | null;

  // Progress
  journeyProgressPercent: number | null;
  daysToEta: number | null;

  // Document status
  documentCompletionRate: number;
  pendingActionCount: number;
  overdueActionCount: number;
}

export interface ValidationResult {
  isValid: boolean;

  // Date validation
  etaMatch: boolean;
  etaMismatchDays: number | null;
  etdMatch: boolean;
  etdMismatchDays: number | null;

  // Vessel validation
  vesselMatch: boolean;
  vesselMismatchDetails: string | null;

  // Data completeness
  missingInCarrier: boolean;
  missingInIntdb: boolean;

  // Alerts
  alerts: ValidationAlert[];
}

export interface ValidationAlert {
  severity: 'info' | 'warning' | 'critical';
  type: 'ETA_MISMATCH' | 'ETD_MISMATCH' | 'VESSEL_CHANGE' | 'MISSING_DATA' | 'DELAY_DETECTED' | 'OVERDUE_ACTION';
  message: string;
  details: string | null;
}

// =============================================================================
// COMMAND TYPES
// =============================================================================

export type BotCommand =
  | 'status'
  | 'track'
  | 'timeline'
  | 'docs'
  | 'pending'
  | 'deadlines'
  | 'charges'
  | 'mismatch'
  | 'customer'
  | 'urgent'
  | 'today'
  | 'dashboard'
  | 'risk'
  | 'blockers'
  | 'cutoffs'
  | 'help';

export interface CommandResult {
  success: boolean;
  command: BotCommand;
  message: string;
  buttons?: CommandButton[];
  error?: string;
}

export interface CommandButton {
  label: string;
  callback: string;
}

// =============================================================================
// API RESPONSE TYPES
// =============================================================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
