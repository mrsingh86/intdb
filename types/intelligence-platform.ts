// Intelligence Platform Types - Based on Migrations 016-019

// ============================================================================
// STAKEHOLDER TYPES (Migration 016)
// ============================================================================

export type PartyType =
  | 'shipper'
  | 'consignee'
  | 'notify_party'
  | 'freight_forwarder'
  | 'forwarder'
  | 'customs_broker'
  | 'custom_broker'
  | 'cha'
  | 'trucker'
  | 'shipping_line'
  | 'warehouse'
  | 'agent'
  | 'intoglo'
  | 'unknown'

export type CustomerRelationship = 'paying_customer' | 'shipper_customer' | 'consignee_customer'

export type MetricPeriod = 'monthly' | 'quarterly' | 'yearly'

export type Sentiment = 'positive' | 'neutral' | 'negative' | 'urgent'

export type ExtractionStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'skipped'

export type RelationshipType = 'shipper_consignee' | 'customer_agent' | 'regular_trading_partner'

export type PriorityTier = 'platinum' | 'gold' | 'silver' | 'bronze'

export interface Party {
  id: string
  party_name: string
  party_type: PartyType
  address?: string
  city?: string
  country?: string
  postal_code?: string
  contact_email?: string
  contact_phone?: string
  tax_id?: string
  // Stakeholder Intelligence fields
  is_customer: boolean
  customer_relationship?: CustomerRelationship
  reliability_score?: number
  response_time_avg_hours?: number
  documentation_quality_score?: number
  total_shipments: number
  total_revenue: number
  total_cost: number
  common_routes: RouteInfo[]
  email_domains?: string[]
  created_at: string
  updated_at: string
}

export interface RouteInfo {
  origin: string
  destination: string
  count: number
}

export interface StakeholderBehaviorMetrics {
  id: string
  party_id: string
  metric_period: MetricPeriod
  period_start: string
  period_end: string
  shipment_count: number
  container_count: number
  on_time_rate?: number
  amendment_count: number
  avg_response_time_hours?: number
  revenue: number
  cost: number
  email_count: number
  avg_sentiment_score?: number
  calculated_at: string
  created_at: string
}

export interface StakeholderSentimentLog {
  id: string
  party_id: string
  source_email_id?: string
  sentiment: Sentiment
  sentiment_score: number
  confidence?: number
  topic_category?: string
  key_topics?: string[]
  email_snippet?: string
  analyzed_at: string
  created_at: string
}

export interface StakeholderExtractionQueue {
  id: string
  email_id: string
  extraction_status: ExtractionStatus
  extracted_parties: ExtractedParty[]
  matched_party_ids?: string[]
  created_party_ids?: string[]
  error_message?: string
  retry_count: number
  queued_at: string
  processed_at?: string
  created_at: string
}

export interface ExtractedParty {
  name: string
  type: PartyType
  email?: string
  confidence: number
}

export interface StakeholderRelationship {
  id: string
  party_a_id: string
  party_b_id: string
  relationship_type: RelationshipType
  shipment_count: number
  first_shipment_date?: string
  last_shipment_date?: string
  created_at: string
  updated_at: string
}

// ============================================================================
// DOCUMENT LIFECYCLE TYPES (Migration 017)
// ============================================================================

export type LifecycleStatus = 'draft' | 'review' | 'approved' | 'sent' | 'acknowledged' | 'superseded'
export type DocumentLifecycleStatus = LifecycleStatus  // Alias for compatibility

export type ComparisonType = 'exact' | 'fuzzy' | 'numeric' | 'date' | 'contains' | 'case_insensitive'

export type DiscrepancySeverity = 'critical' | 'warning' | 'info'

export type ComparisonStatus = 'matches' | 'discrepancies_found' | 'pending' | 'not_applicable'
export type DocumentComparisonStatus = ComparisonStatus  // Alias for compatibility

export type AlertStatus = 'pending' | 'due_soon' | 'overdue' | 'reminded' | 'resolved' | 'waived'
export type MissingDocumentAlertStatus = AlertStatus  // Alias for compatibility

export interface DocumentLifecycle {
  id: string
  shipment_id: string
  document_type: string
  lifecycle_status: LifecycleStatus
  status_history: StatusHistoryEntry[]
  quality_score?: number
  missing_fields?: string[]
  validation_errors?: string[]
  due_date?: string
  received_at?: string
  approved_at?: string
  sent_at?: string
  current_revision_id?: string
  revision_count: number
  created_at: string
  updated_at: string
  // Registry integration fields (links lifecycle to document registry)
  document_id?: string           // FK to documents table (document registry)
  source_email_id?: string       // Email that triggered this lifecycle
  source_attachment_id?: string  // Attachment that triggered this lifecycle
}

export interface StatusHistoryEntry {
  status: LifecycleStatus
  changed_at: string
  changed_by?: string
  reason?: string
}

export interface DocumentComparisonField {
  id: string
  source_document_type: string
  target_document_type: string
  field_name: string
  field_display_name?: string
  comparison_type: ComparisonType
  severity: DiscrepancySeverity
  is_active: boolean
  created_at: string
}

export interface DocumentComparison {
  id: string
  shipment_id: string
  source_document_type: string
  target_document_type: string
  source_revision_id?: string
  target_revision_id?: string
  comparison_status: ComparisonStatus
  field_comparisons: Record<string, FieldComparisonResult>
  total_fields_compared: number
  matching_fields: number
  discrepancy_count: number
  critical_discrepancies: number
  is_resolved: boolean
  resolved_by?: string
  resolved_at?: string
  resolution_notes?: string
  compared_at: string
  created_at: string
  updated_at: string
}

export interface FieldComparisonResult {
  fieldName: string
  displayName: string
  sourceValue: unknown
  targetValue: unknown
  matches: boolean
  severity: DiscrepancySeverity
  comparisonType: string
  message?: string
  // Legacy aliases
  source?: string
  target?: string
}

export interface MissingDocumentAlert {
  id: string
  shipment_id: string
  document_type: string
  document_description?: string
  expected_by: string
  alert_status: AlertStatus
  reminder_count: number
  last_reminder_at?: string
  next_reminder_at?: string
  resolved_at?: string
  resolved_by?: string
  resolution_notes?: string
  created_at: string
  updated_at: string
}

export interface DocumentTypeRequirement {
  id: string
  document_type: string
  document_description?: string
  required_at_stage?: string
  due_days_offset?: number
  expected_from?: string
  expected_sender_patterns?: string[]
  is_critical: boolean
  blocking_downstream?: string[]
  is_active: boolean
  created_at: string
}

// ============================================================================
// NOTIFICATION TYPES (Migration 018)
// ============================================================================

export type NotificationCategory =
  | 'deadline'
  | 'rate'
  | 'vessel'
  | 'operational'
  | 'customs'
  | 'carrier'
  | 'financial'
  | 'general'

export type NotificationPriority = 'critical' | 'high' | 'medium' | 'low'

export type NotificationStatus = 'unread' | 'read' | 'acknowledged' | 'actioned' | 'dismissed'

export type NotificationActionType =
  | 'acknowledged'
  | 'task_created'
  | 'email_sent'
  | 'escalated'
  | 'resolved'
  | 'dismissed'
  | 'commented'

export interface NotificationTypeConfig {
  id: string
  notification_type: string
  display_name: string
  description?: string
  category: NotificationCategory
  subject_patterns?: string[]
  body_keywords?: string[]
  sender_patterns?: string[]
  default_priority: NotificationPriority
  default_urgency_hours: number
  auto_generate_task: boolean
  task_template_code?: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Notification {
  id: string
  email_id: string
  sender_email?: string
  sender_name?: string
  notification_type?: string
  classification_confidence?: number
  shipment_id?: string
  carrier_id?: string
  party_id?: string
  title: string
  summary?: string
  original_subject?: string
  extracted_data: Record<string, unknown>
  priority: NotificationPriority
  urgency_score?: number
  deadline_date?: string
  status: NotificationStatus
  status_changed_at?: string
  status_changed_by?: string
  received_at: string
  processed_at: string
  created_at: string
}

export interface NotificationAction {
  id: string
  notification_id: string
  action_type: NotificationActionType
  performed_by?: string
  performed_by_name?: string
  action_details: Record<string, unknown>
  notes?: string
  related_task_id?: string
  related_email_id?: string
  performed_at: string
}

// ============================================================================
// ACTION CENTER TYPES (Migration 019)
// ============================================================================

export type TaskCategory =
  | 'deadline'
  | 'document'
  | 'notification'
  | 'compliance'
  | 'communication'
  | 'financial'
  | 'operational'

export type TaskTriggerType =
  | 'deadline_approaching'
  | 'deadline_passed'
  | 'document_received'
  | 'document_missing'
  | 'notification_received'
  | 'email_received'  // Task triggered by email classification (email_type + sentiment)
  | 'milestone_reached'
  | 'milestone_missed'
  | 'manual'

export type TaskStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'dismissed' | 'failed'

export type UrgencyLevel = 'no_deadline' | 'overdue' | 'immediate' | 'today' | 'this_week' | 'later'

export type InsightType =
  | 'why_recommended'
  | 'risk_assessment'
  | 'historical_pattern'
  | 'stakeholder_context'
  | 'deadline_impact'
  | 'financial_impact'
  | 'suggested_action'

export type CommunicationType = 'email' | 'sms' | 'internal_note'

export type CommunicationStatus = 'draft' | 'queued' | 'sent' | 'delivered' | 'failed' | 'bounced'

export type TaskActivityType =
  | 'created'
  | 'status_changed'
  | 'priority_updated'
  | 'assigned'
  | 'unassigned'
  | 'due_date_changed'
  | 'comment_added'
  | 'email_sent'
  | 'insight_generated'
  | 'escalated'
  | 'completed'
  | 'dismissed'

export interface TaskTemplate {
  id: string
  template_code: string
  template_name: string
  template_description?: string
  template_category: TaskCategory
  default_title_template: string
  default_description_template?: string
  trigger_type: TaskTriggerType
  trigger_conditions: Record<string, unknown>
  has_email_template: boolean
  email_subject_template?: string
  email_body_template?: string
  default_recipients: RecipientConfig[]
  base_priority: NotificationPriority
  priority_boost_conditions: Record<string, number>
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface RecipientConfig {
  type?: string
  email?: string
}

export interface ActionTask {
  id: string
  task_number: number
  template_id?: string
  template_code?: string
  shipment_id?: string
  notification_id?: string
  document_lifecycle_id?: string
  stakeholder_id?: string
  title: string
  description?: string
  category: TaskCategory
  priority: NotificationPriority
  priority_score: number
  priority_factors: PriorityFactors
  due_date?: string
  assigned_to?: string
  assigned_to_name?: string
  assigned_at?: string
  status: TaskStatus
  status_notes?: string
  completed_at?: string
  completed_by?: string
  completion_notes?: string
  is_recurring: boolean
  recurrence_pattern?: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface PriorityFactors {
  deadline_urgency: PriorityFactor
  financial_impact: PriorityFactor
  notification_severity: PriorityFactor
  stakeholder_importance: PriorityFactor
  historical_pattern: PriorityFactor
  document_criticality: PriorityFactor
  insight_boost?: PriorityFactor  // AI-powered insights
  blocker_impact?: PriorityFactor // Active blockers from journey tracking
}

export interface PriorityFactor {
  score: number
  max: number
  reason: string
}

export interface TaskInsight {
  id: string
  task_id: string
  insight_type: InsightType
  title: string
  content: string
  supporting_data: Record<string, unknown>
  confidence_score?: number
  generated_at: string
  created_at: string
}

export interface CommunicationLog {
  id: string
  task_id?: string
  shipment_id?: string
  notification_id?: string
  communication_type: CommunicationType
  to_emails: string[]
  cc_emails?: string[]
  bcc_emails?: string[]
  subject: string
  body_text: string
  body_html?: string
  ai_drafted: boolean
  ai_draft_prompt?: string
  ai_model_used?: string
  human_edited: boolean
  status: CommunicationStatus
  status_details?: string
  gmail_message_id?: string
  gmail_thread_id?: string
  response_received: boolean
  response_email_id?: string
  response_received_at?: string
  sent_by?: string
  sent_by_name?: string
  sent_at?: string
  created_at: string
  updated_at: string
}

export interface TaskActivityLog {
  id: string
  task_id: string
  activity_type: TaskActivityType
  old_value?: Record<string, unknown>
  new_value?: Record<string, unknown>
  change_reason?: string
  performed_by?: string
  performed_by_name?: string
  is_system_action: boolean
  performed_at: string
}

// ============================================================================
// VIEW TYPES
// ============================================================================

export interface ActiveTask extends ActionTask {
  task_number_formatted: string
  booking_number?: string
  vessel_name?: string
  carrier_name?: string
  urgency_level: UrgencyLevel
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function formatTaskNumber(taskNumber: number): string {
  return `TASK-${String(taskNumber).padStart(4, '0')}`
}

export function calculateUrgencyLevel(dueDate: string | null | undefined): UrgencyLevel {
  if (!dueDate) return 'no_deadline'

  const now = new Date()
  const due = new Date(dueDate)
  const hoursUntilDue = (due.getTime() - now.getTime()) / (1000 * 60 * 60)

  if (hoursUntilDue < 0) return 'overdue'
  if (hoursUntilDue < 4) return 'immediate'
  if (hoursUntilDue < 24) return 'today'
  if (hoursUntilDue < 168) return 'this_week'
  return 'later'
}

export function calculateDaysOverdue(expectedBy: string): number {
  const now = new Date()
  const expected = new Date(expectedBy)
  const diffMs = now.getTime() - expected.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  return Math.max(0, diffDays)
}
