/**
 * Insight Engine Types
 *
 * Types for the proactive intelligence system that discovers
 * hidden patterns, risks, and opportunities.
 */

// ============================================================================
// Enums and Constants
// ============================================================================

export type InsightSeverity = 'critical' | 'high' | 'medium' | 'low';

export type InsightType =
  | 'rule_detected'   // From pattern detector
  | 'risk'            // AI-discovered risk
  | 'pattern'         // AI-discovered pattern
  | 'prediction'      // AI prediction based on history
  | 'recommendation'; // AI-suggested action

export type InsightSource = 'rules' | 'ai' | 'hybrid';

export type InsightStatus = 'active' | 'acknowledged' | 'resolved' | 'dismissed' | 'expired';

export type PatternCategory =
  | 'timeline'        // Cutoff conflicts, schedule issues
  | 'stakeholder'     // Shipper/consignee/carrier behavior
  | 'cross_shipment'  // Multi-shipment risks
  | 'document'        // Document quality/missing
  | 'financial'       // Payment, demurrage, cost risks
  | 'blocker';        // Active blockers from journey tracking

export type FeedbackType =
  | 'helpful'
  | 'not_helpful'
  | 'false_positive'
  | 'saved_money'
  | 'saved_time'
  | 'prevented_issue';

// Action types for insights that trigger communications
export type InsightActionType = 'email' | 'call' | 'task' | 'escalate';
export type InsightActionTarget = 'shipper' | 'consignee' | 'carrier' | 'internal' | 'customs';
export type InsightActionUrgency = 'immediate' | 'today' | 'soon';

/**
 * Structured action for insights that require communication.
 * Used by CommunicationExecutorService to generate drafts.
 */
export interface InsightAction {
  type: InsightActionType;
  target: InsightActionTarget;
  template?: string;        // Template code for CommunicationExecutorService
  urgency: InsightActionUrgency;
  subject_hint?: string;    // Hint for email subject line
}

// ============================================================================
// Context Types (Input to Insight Engine)
// ============================================================================

export interface ShipmentDates {
  etd: Date | null;
  eta: Date | null;
  atd: Date | null;
  ata: Date | null;
  si_cutoff: Date | null;
  vgm_cutoff: Date | null;
  cargo_cutoff: Date | null;
  gate_cutoff: Date | null;
  cargo_ready_date: Date | null;
}

export interface ShipmentParties {
  shipper_id: string | null;
  consignee_id: string | null;
  carrier_id: string | null;
  notify_party_id: string | null;
}

export interface ShipmentFinancials {
  estimated_value: number | null;
  customer_tier: string | null;
  total_invoiced: number | null;
  total_paid: number | null;
}

export interface ShipmentContext {
  id: string;
  booking_number: string | null;
  bl_number: string | null;
  status: string;
  workflow_state: string | null;
  workflow_phase: string | null;
  dates: ShipmentDates;
  parties: ShipmentParties;
  financials: ShipmentFinancials;
  port_of_loading: string | null;
  port_of_loading_code: string | null;
  port_of_discharge: string | null;
  port_of_discharge_code: string | null;
  carrier_name: string | null;
  vessel_name: string | null;
}

export interface DocumentInfo {
  document_type: string;
  lifecycle_status: string;
  quality_score: number | null;
  received_at: Date | null;
  missing_fields: string[];
  // Acknowledgment tracking (for journey integration)
  acknowledged?: boolean;
  acknowledgment_due_date?: Date | null;
}

export interface QualityIssue {
  document_type: string;
  field: string;
  severity: InsightSeverity;
  description: string;
}

export interface Amendment {
  document_type: string;
  amended_at: Date;
  changed_fields: string[];
}

export interface DocumentContext {
  received: DocumentInfo[];
  missing: string[];
  quality_issues: QualityIssue[];
  recent_amendments: Amendment[];
}

export interface StakeholderProfile {
  id: string;
  name: string;
  party_type: string;
  reliability_score: number | null;
  response_time_avg_hours: number | null;
  documentation_quality_score: number | null;
  total_shipments: number;
  total_revenue: number | null;
  is_customer: boolean;
  customer_tier: string | null;
  recent_issues: string[];
}

export interface CarrierProfile {
  id: string;
  name: string;
  rollover_rate_30d: number | null;
  on_time_rate: number | null;
  total_bookings_30d: number;
}

export interface StakeholderContext {
  shipper: StakeholderProfile | null;
  consignee: StakeholderProfile | null;
  carrier: CarrierProfile | null;
  notify_party: StakeholderProfile | null;
}

export interface ShipmentSummary {
  id: string;
  booking_number: string | null;
  status: string;
  etd: Date | null;
  eta: Date | null;
  value: number | null;
  port_of_discharge: string | null;
}

export interface RelatedShipmentsContext {
  same_shipper_active: ShipmentSummary[];
  same_consignee_active: ShipmentSummary[];
  same_route_recent: ShipmentSummary[];
  same_carrier_recent: ShipmentSummary[];
  same_week_arrivals: ShipmentSummary[];
}

export interface HistoricalPatterns {
  shipper_avg_si_delay_days: number | null;
  shipper_amendment_rate: number | null;
  carrier_rollover_rate_30d: number | null;
  route_avg_delay_days: number | null;
  consignee_rejection_rate: number | null;
}

export interface NotificationInfo {
  id: string;
  notification_type: string;
  priority: string;
  title: string;
  status: string;
  received_at: Date;
}

export interface NotificationContext {
  pending: NotificationInfo[];
  recent_critical: NotificationInfo[];
}

export interface CommunicationContext {
  last_response_from_shipper: Date | null;
  last_response_from_consignee: Date | null;
  unanswered_emails_count: number;
  thread_sentiment: 'positive' | 'neutral' | 'negative' | 'urgent' | null;
  days_since_last_communication: number | null;
}

// ============================================================================
// Journey Tracking Context (Migration 021)
// ============================================================================

export type BlockerSeverity = 'critical' | 'high' | 'medium' | 'low';

export type BlockerType =
  | 'missing_document'
  | 'awaiting_approval'
  | 'awaiting_response'
  | 'customs_hold'
  | 'payment_pending'
  | 'milestone_missed'
  | 'task_overdue'
  | 'cutoff_passed'
  | 'discrepancy_unresolved';

export interface ShipmentBlocker {
  id: string;
  blocker_type: BlockerType;
  blocker_description: string;
  severity: BlockerSeverity;
  blocked_since: Date;
  blocking_milestone?: string;
  responsible_party_id?: string;
  is_resolved: boolean;
}

export interface JourneyEvent {
  id: string;
  event_type: string;
  event_description: string;
  occurred_at: Date;
  source_document_type?: string;
  source_email_id?: string;
}

export interface CommunicationTimelineEntry {
  id: string;
  stakeholder_id: string;
  stakeholder_name: string;
  direction: 'inbound' | 'outbound';
  communication_type: 'email' | 'document' | 'notification';
  summary: string;
  sent_at: Date;
  requires_response: boolean;
  response_received: boolean;
}

export interface JourneyContext {
  // Active blockers preventing progress
  blockers: ShipmentBlocker[];
  // Recent journey events (last 30 days)
  recent_events: JourneyEvent[];
  // Communication timeline for stakeholder tracking
  communication_timeline: CommunicationTimelineEntry[];
  // Journey statistics
  stats: {
    total_blockers_resolved: number;
    avg_blocker_resolution_hours: number | null;
    days_since_last_milestone: number | null;
    current_milestone: string | null;
  };
}

/**
 * Complete context for insight generation
 */
export interface InsightContext {
  shipment: ShipmentContext;
  documents: DocumentContext;
  stakeholders: StakeholderContext;
  related: RelatedShipmentsContext;
  history: HistoricalPatterns;
  notifications: NotificationContext;
  communications: CommunicationContext;
  // Journey tracking (Phase 2+ integration)
  journey?: JourneyContext;
}

// ============================================================================
// Pattern Detection Types
// ============================================================================

export interface PatternDefinition {
  id: string;
  pattern_code: string;
  category: PatternCategory;
  name: string;
  description: string;
  severity: InsightSeverity;
  priority_boost: number;
  enabled: boolean;
}

export interface DetectedPattern {
  pattern_id: string;
  pattern_code: string;
  severity: InsightSeverity;
  title: string;
  insight: string;
  confidence: number;
  source: 'rules';
  priority_boost: number;
  supporting_data?: Record<string, unknown>;
  // Action to take (connects to CommunicationExecutorService)
  action?: InsightAction;
}

// ============================================================================
// AI Analysis Types
// ============================================================================

export interface AIInsight {
  type: InsightType;
  severity: InsightSeverity;
  title: string;
  description: string;
  action: string | null;
  confidence: number;
  supporting_data: Record<string, unknown>;
}

export interface AIInsightResult {
  insights: AIInsight[];
  priority_boost: number;
  priority_boost_reason: string;
}

// ============================================================================
// Output Types
// ============================================================================

export interface Insight {
  id: string;
  shipment_id: string;
  task_id: string | null;

  // Core details
  insight_type: InsightType;
  severity: InsightSeverity;
  title: string;
  description: string;
  recommended_action: string | null;

  // Metadata
  source: InsightSource;
  pattern_id: string | null;
  confidence: number;
  supporting_data: Record<string, unknown>;

  // Priority impact
  priority_boost: number;
  boost_reason: string | null;

  // Status
  status: InsightStatus;
  acknowledged_at: Date | null;
  resolved_at: Date | null;

  // Timestamps
  generated_at: Date;
  expires_at: Date | null;
}

export interface InsightEngineResult {
  insights: Insight[];
  priority_boost: number;
  priority_boost_reasons: string[];
  context_summary: {
    shipment_booking: string | null;
    days_to_etd: number | null;
    days_to_nearest_cutoff: number | null;
    active_issues_count: number;
  };
  generation_stats: {
    rules_checked: number;
    rules_matched: number;
    ai_ran: boolean;
    ai_insights: number;
    duration_ms: number;
  };
}

// ============================================================================
// Feedback Types
// ============================================================================

export interface InsightFeedback {
  id: string;
  insight_id: string;
  feedback_type: FeedbackType;
  feedback_value: {
    amount_saved?: number;
    time_saved_hours?: number;
    issue_prevented?: string;
    description?: string;
  };
  notes: string | null;
  created_at: Date;
  created_by: string | null;
}

// ============================================================================
// Service Options
// ============================================================================

export interface InsightGenerationOptions {
  skipAI?: boolean;
  forceRefresh?: boolean;
  maxInsights?: number;
  categories?: PatternCategory[];
}

export interface PatternCheckFunction {
  (context: InsightContext): boolean | Promise<boolean>;
}

export interface PatternInsightGenerator {
  (context: InsightContext): string;
}
