/**
 * Chronicle V2 Types
 *
 * Type definitions for the attention-first shipment dashboard.
 * Supports progressive disclosure: List → Detail → Document → Attachment
 */

// =============================================================================
// FILTER TYPES
// =============================================================================

export type Direction = 'all' | 'export' | 'import';

export type Phase = 'all' | 'origin' | 'in_transit' | 'destination' | 'completed';

export type TimeWindow = 'today' | '3days' | '7days' | 'all';

export type SignalTier = 'strong' | 'medium' | 'weak' | 'noise';

// =============================================================================
// ATTENTION SCORING
// =============================================================================

export interface AttentionComponents {
  hasActiveIssue: boolean;
  issueTypes: string[];
  pendingActions: number;
  overdueActions: number;
  maxActionPriority: 'low' | 'medium' | 'high' | 'critical' | null;
  daysSinceActivity: number;
  daysToEtd: number | null;
  cutoffStatus: 'safe' | 'warning' | 'urgent' | 'overdue' | null;
  nearestCutoffDays: number | null;
}

// =============================================================================
// LEVEL 1: SHIPMENT LIST ITEM
// =============================================================================

export interface ShipmentListItem {
  id: string;
  bookingNumber: string | null;
  mblNumber: string | null;
  hblNumber: string | null;

  // Route
  route: {
    origin: string; // POL code (e.g., "INNSA")
    destination: string; // POD code (e.g., "USNYC")
    originFull: string; // Full port name
    destinationFull: string;
  };

  // Parties (actual shipper/consignee from HBL, not forwarder)
  shipper: string | null;
  consignee: string | null;

  // Schedule
  etd: string | null;
  eta: string | null;
  vessel: string | null;
  voyage: string | null;
  carrier: string | null;

  // Status
  stage: string;
  phase: Phase;
  direction: 'export' | 'import';

  // Attention scoring
  attentionScore: number;
  signalTier: SignalTier;

  // Aggregated signals
  issues: {
    count: number;
    types: string[];
    mostSevere: string | null;
    latestSummary: string | null; // Most recent issue description
  };

  actions: {
    pending: number;
    overdue: number;
    nextDeadline: string | null;
    topActions: Array<{
      description: string;
      daysRemaining: number | null;
      isOverdue: boolean;
    }>; // Top 2 most urgent actions
  };

  cutoffs: {
    nearest: {
      type: string;
      date: string;
      daysRemaining: number;
    } | null;
    overdueCount: number;
  };

  // Activity
  documents: {
    total: number;
    recent24h: number;
  };

  lastActivity: string | null;

  // Journey progress
  journey: {
    stage: string;
    stageLabel: string;
    progress: number; // 0-100 percentage
    nextMilestone: string | null;
    nextMilestoneDate: string | null;
    summary: string | null; // One-liner: "Arrived Houston, awaiting customs clearance"
  };

  // Smart action recommendation based on current state
  recommendation: {
    action: string; // What to do: "Follow up with trucker for pickup ETA"
    priority: 'critical' | 'high' | 'medium' | 'low';
    reason: string; // Why: "Container released 4 days ago, no pickup scheduled"
  } | null;

  // Stakeholders involved (external parties from email communications)
  // We are NVOCC, so stakeholders are: Shipping Line, Trucking, Customs Broker, Warehouse, Terminal
  stakeholders: Array<{
    type: 'carrier' | 'trucker' | 'customs_broker' | 'warehouse' | 'terminal' | 'other';
    label: string;
    name: string | null;
    lastContact: string | null;
  }>;

  // AI-powered summary (from Claude Haiku)
  aiSummary: {
    // New tight format (V2)
    narrative: string | null; // Tight one-paragraph intelligence
    owner: string | null; // Exact party who needs to act
    ownerType: 'shipper' | 'consignee' | 'carrier' | 'intoglo' | null;
    keyDeadline: string | null; // Critical date (e.g., "Jan 14 ETD")
    keyInsight: string | null; // Most important intelligence (e.g., "61% SI late rate")

    // Legacy format (V1) - kept for backwards compatibility
    story: string; // 2-3 sentence narrative
    currentBlocker: string | null; // What's stopping progress
    blockerOwner: string | null; // Who needs to act
    nextAction: string | null; // Specific action needed
    actionOwner: string | null; // Who should do it
    actionPriority: 'critical' | 'high' | 'medium' | 'low' | null;
    financialImpact: string | null; // Costs incurred or at risk
    customerImpact: string | null; // How customer is affected
    riskLevel: 'red' | 'amber' | 'green'; // Overall risk
    riskReason: string | null; // Why this risk level
  } | null;
}

// =============================================================================
// LEVEL 2: SHIPMENT DETAIL
// =============================================================================

export interface CutoffDetail {
  type: 'si' | 'vgm' | 'cargo' | 'doc' | 'lfd';
  label: string;
  date: string | null;
  daysRemaining: number | null;
  status: 'safe' | 'warning' | 'urgent' | 'overdue' | 'submitted' | 'unknown';
}

export interface IssueItem {
  id: string;
  type: string;
  description: string;
  documentId: string;
  documentSubject: string;
  occurredAt: string;
  resolved: boolean;
}

export interface ActionItem {
  id: string;
  description: string;
  owner: string | null;
  deadline: string | null;
  priority: 'low' | 'medium' | 'high' | 'critical';
  documentId: string;
  documentSubject: string;
  completed: boolean;
  completedAt: string | null;
}

export interface TimelineItem {
  id: string;
  type: string;
  subject: string;
  sender: string;
  senderParty: string;
  occurredAt: string;
  hasIssue: boolean;
  hasAction: boolean;
  issueType: string | null;
  actionDescription: string | null;
  attachmentCount: number;
  summary: string;
}

export interface ShipmentDetail extends ShipmentListItem {
  // Extended parties
  shipperAddress: string | null;
  consigneeAddress: string | null;
  notifyParty: string | null;

  // Containers
  containers: string[];

  // All cutoffs with status
  cutoffDetails: CutoffDetail[];

  // Issues with full details
  issuesList: IssueItem[];

  // Actions with full details
  actionsList: ActionItem[];

  // Document timeline
  timeline: TimelineItem[];
}

// =============================================================================
// LEVEL 3: DOCUMENT DETAIL
// =============================================================================

export interface ExtractedField {
  key: string;
  label: string;
  value: string;
  category: 'identifier' | 'party' | 'location' | 'date' | 'cargo' | 'other';
}

export interface AttachmentItem {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  hasOcr: boolean;
  attachmentId?: string; // Gmail attachment ID for fetching content
}

export interface DocumentDetail {
  id: string;
  gmailMessageId: string;
  threadId: string;

  // Email metadata
  subject: string;
  sender: {
    email: string;
    party: string;
  };
  receivedAt: string;

  // Classification
  documentType: string;
  messageType: string;
  sentiment: 'positive' | 'neutral' | 'negative' | 'urgent';

  // Content
  summary: string;
  bodyPreview: string;

  // Extracted data
  extractedFields: ExtractedField[];

  // Action & Issue
  action: {
    description: string;
    owner: string | null;
    deadline: string | null;
    priority: string;
    completed: boolean;
  } | null;

  issue: {
    type: string;
    description: string;
  } | null;

  // Attachments
  attachments: AttachmentItem[];

  // Related
  shipment: {
    id: string;
    bookingNumber: string | null;
  } | null;

  // Navigation
  previousDocId: string | null;
  nextDocId: string | null;
}

// =============================================================================
// API REQUEST/RESPONSE TYPES
// =============================================================================

export interface ShipmentListRequest {
  direction?: Direction;
  phase?: Phase;
  timeWindow?: TimeWindow;
  search?: string;
  minScore?: number;
  showWatchlist?: boolean;
  page?: number;
  pageSize?: number;
}

export interface ShipmentListResponse {
  shipments: ShipmentListItem[];
  total: number;
  page: number;
  pageSize: number;
  scoreDistribution: {
    strong: number; // 60+
    medium: number; // 35-59
    weak: number; // 15-34
    noise: number; // <15
  };
}

export interface ShipmentDetailResponse {
  shipment: ShipmentDetail;
}

export interface DocumentDetailResponse {
  document: DocumentDetail;
}

// =============================================================================
// NARRATIVE CHAIN TYPES (Chain of Thought System)
// =============================================================================

/**
 * Types of narrative chains linking cause to effect.
 */
export type ChainType =
  | 'issue_to_action'       // Issue reported → Action required
  | 'action_to_resolution'  // Action taken → Resolution achieved
  | 'communication_chain'   // Message sent → Awaiting response
  | 'escalation_chain'      // Issue severity increased over time
  | 'delay_chain'           // Delay reported → Schedule impacts
  | 'document_chain';       // Document request → Document received

export type ChainStatus = 'active' | 'resolved' | 'stale' | 'superseded';

export type ChainRelation = 'caused_by' | 'resolved_by' | 'followed_by';

export type ChainRole = 'trigger' | 'effect' | 'resolution';

export type EventImportance = 'critical' | 'high' | 'normal' | 'low' | 'context';

export type BehaviorPattern = 'excellent' | 'responsive' | 'standard' | 'slow' | 'problematic' | 'unknown';

/**
 * Party role in relation to Intoglo operations.
 * - internal: Intoglo team members (ops, docs, finance)
 * - vendor: Service providers we hire (truckers, customs brokers, warehouses)
 * - customer: Parties we serve (shipper, consignee)
 * - partner: Shipping lines, terminals (operational partners)
 */
export type PartyRole = 'internal' | 'vendor' | 'customer' | 'partner';

export type OverallSentiment = 'positive' | 'neutral' | 'negative' | 'mixed';

/**
 * An event within a narrative chain.
 */
export interface ChainEvent {
  chronicleId: string;
  eventType: string;
  summary: string;
  occurredAt: string;
  party: string | null;
  relation: ChainRelation;
  daysFromTrigger: number;
}

/**
 * A narrative chain linking cause to effect.
 */
export interface NarrativeChain {
  id: string;
  shipmentId: string;
  chainType: ChainType;
  chainStatus: ChainStatus;

  // Trigger event (what started this chain)
  trigger: {
    chronicleId: string | null;
    eventType: string;
    summary: string;
    occurredAt: string;
    party: string | null;
    daysAgo: number;
  };

  // Chain of effects (ordered list of linked events)
  events: ChainEvent[];

  // Current state
  currentState: string;
  currentStateParty: string | null; // Who needs to act: "Hapag-Lloyd"
  daysInCurrentState: number;

  // Narrative summaries
  narrativeHeadline: string | null;  // Short: "Vessel Rollover"
  narrativeSummary: string | null;   // Medium: "Delay reported, awaiting new schedule"
  fullNarrative: string | null;      // Full story for detail view

  // Impact assessment
  impact: {
    delayDays: number | null;
    financialUsd: number | null;
    affectedParties: string[];
  };

  // Resolution tracking
  resolution: {
    required: boolean;
    deadline: string | null;
    resolvedAt: string | null;
    resolvedBy: string | null; // chronicle_id that resolved it
    summary: string | null;
  };

  // Metadata
  autoDetected: boolean;
  confidenceScore: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Pre-computed stakeholder behavior for a shipment.
 */
export interface StakeholderSummary {
  id: string;
  shipmentId: string;
  partyType: string;
  partyIdentifier: string | null;
  displayName: string;

  // Party role classification
  partyRole: PartyRole;
  companyName: string | null;  // Actual company name (e.g., "Carmel Transport")
  contactEmail: string | null; // Primary contact email for drafting

  // Communication statistics
  stats: {
    totalEmails: number;
    inboundCount: number;
    outboundCount: number;
    firstContact: string | null;
    lastContact: string | null;
    daysSinceLastContact: number | null;
  };

  // Response behavior
  responsiveness: {
    avgResponseHours: number | null;
    fastestResponseHours: number | null;
    slowestResponseHours: number | null;
    unansweredCount: number;
    behaviorPattern: BehaviorPattern;
    behaviorNotes: string | null;
  };

  // Sentiment tracking
  sentiment: {
    positiveCount: number;
    neutralCount: number;
    negativeCount: number;
    urgentCount: number;
    overall: OverallSentiment | null;
  };

  // Issue involvement
  issues: {
    raised: number;
    resolved: number;
    types: string[];
  };

  // Action involvement
  actions: {
    requested: number;
    completed: number;
  };

  // Recent communications (cached for quick display)
  recentCommunications: Array<{
    date: string;
    direction: 'inbound' | 'outbound';
    type: string;
    summary: string;
    sentiment: string;
    chronicleId: string;
    hasPendingAction: boolean;
  }>;

  lastComputed: string;
}

/**
 * A unified story event with narrative context.
 */
export interface StoryEvent {
  id: string;
  shipmentId: string;

  // Source tracking
  sourceType: 'chronicle' | 'milestone' | 'blocker' | 'insight' | 'system' | 'manual';
  sourceId: string | null;

  // Event classification
  category: 'communication' | 'document' | 'issue' | 'action' | 'milestone' | 'status';
  eventType: string;

  // Display content
  headline: string;
  detail: string | null;

  // Parties involved
  fromParty: string | null;
  toParty: string | null;
  partyDisplayName: string | null;

  // Narrative importance
  importance: EventImportance;
  isKeyMoment: boolean;

  // Chain linking
  chainId: string | null;
  chainPosition: number | null;
  chainRole: ChainRole | null;

  // Related entities
  relatedIssueType: string | null;
  relatedActionId: string | null;

  // Timing
  occurredAt: string;
  daysAgo: number;

  // Response tracking
  requiresResponse: boolean;
  responseReceived: boolean;
  responseDeadline: string | null;
}

/**
 * Smart recommendation with full chain-of-thought reasoning.
 */
export interface ChainOfThoughtRecommendation {
  action: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
  chainOfThought: string; // Full reasoning: "1. Carrier reported rollover on Jan 10..."
  suggestedRecipients: string[];
  relatedChainId: string | null;
}

/**
 * Context for generating draft replies.
 */
export interface DraftReplyContext {
  lastMessageFrom: string | null;
  lastMessageSubject: string | null;
  lastMessageChronicleId: string | null;
  suggestedTone: 'formal' | 'urgent' | 'friendly';
  keyPointsToAddress: string[];
  chainContext: {
    chainType: ChainType;
    triggerSummary: string;
    currentState: string;
  } | null;
}

/**
 * Complete shipment story with all narrative components.
 */
export interface ShipmentStory {
  shipmentId: string;
  bookingNumber: string | null;

  // Current state summary
  headline: string;
  currentSituation: string;

  // Active chains needing attention
  activeChains: NarrativeChain[];
  resolvedChains: NarrativeChain[];

  // Stakeholder summaries
  stakeholders: StakeholderSummary[];

  // Timeline
  timeline: StoryEvent[];
  keyMoments: StoryEvent[];

  // Smart recommendations
  recommendations: ChainOfThoughtRecommendation[];
  primaryRecommendation: ChainOfThoughtRecommendation | null;

  // Draft reply context
  draftReplyContext: DraftReplyContext | null;

  // Metadata
  lastUpdated: string;
}
