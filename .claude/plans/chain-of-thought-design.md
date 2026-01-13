# Chain of Thought System Design for Chronicle V2

## Executive Summary

This design document outlines a comprehensive "Chain of Thought" system for Chronicle V2 that transforms disconnected data points (issues, actions, communications) into a coherent narrative that provides actionable insights without requiring users to dig through email trails.

---

## 1. Current State Analysis

### 1.1 The Problem

The current Chronicle V2 implementation shows **disconnected pieces**:
- Issues displayed separately from their causes
- Actions shown without context of why they're needed
- Timeline as flat list without causal relationships
- Stakeholder communications not aggregated
- No clear "story" of what happened

**User cannot understand**: "Why is this action urgent? What led to this issue? Who needs to respond?"

### 1.2 Data Available in Chronicle Table

```sql
-- Key fields for narrative building:
- gmail_message_id, thread_id (email threading)
- direction (inbound/outbound)
- from_party (ocean_carrier, customs_broker, trucker, terminal, etc.)
- from_address
- document_type (booking_confirmation, shipping_instructions, draft_bl, etc.)
- message_type (confirmation, request, update, action_required, issue_reported)
- sentiment (positive, neutral, negative, urgent)
- summary
- has_issue, issue_type, issue_description
- has_action, action_description, action_owner, action_deadline, action_completed_at
- occurred_at
```

### 1.3 Current Limitations

| Problem | Impact |
|---------|--------|
| No causal linking | "Issue X caused Action Y" not shown |
| No party history | Communication patterns invisible |
| Missing narrative | Why is this action urgent? |
| Flat timeline | No story arc |
| No draft reply support | Can't generate contextual responses |

---

## 2. Solution: Narrative Chains

### 2.1 Core Concept

Instead of showing disconnected events, we build **Narrative Chains** that link cause to effect:

```
TRIGGER: Shipping line reports vessel rollover (Jan 10)
    ↓
EFFECT: SI deadline extension needed (Jan 10, +0d)
    ↓
EFFECT: Shipper notification sent (Jan 11, +1d)
    ↓
AWAITING: Carrier confirmation of new schedule

Status: ACTIVE | Impact: 3 day delay | Parties: Shipper, Carrier
```

### 2.2 Chain Types

| Chain Type | Trigger | Resolution |
|------------|---------|------------|
| `issue_to_action` | Issue reported | Action completed |
| `communication_chain` | Email requiring response | Response received |
| `delay_chain` | Delay/rollover reported | New schedule confirmed |
| `escalation_chain` | Issue severity increase | Issue resolved |
| `document_chain` | Document revision | Final version confirmed |

---

## 3. Data Model

### 3.1 Table: `shipment_narrative_chains`

```sql
CREATE TABLE shipment_narrative_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  -- Chain identification
  chain_type VARCHAR(50) NOT NULL CHECK (chain_type IN (
    'issue_to_action', 'action_to_resolution', 'communication_chain',
    'escalation_chain', 'delay_chain', 'document_chain'
  )),
  chain_status VARCHAR(30) NOT NULL DEFAULT 'active' CHECK (chain_status IN (
    'active', 'resolved', 'stale', 'superseded'
  )),

  -- The trigger event
  trigger_chronicle_id UUID REFERENCES chronicle(id),
  trigger_event_type VARCHAR(100) NOT NULL,
  trigger_summary TEXT NOT NULL,
  trigger_occurred_at TIMESTAMPTZ NOT NULL,
  trigger_party VARCHAR(100),

  -- The chain events (ordered)
  chain_events JSONB NOT NULL DEFAULT '[]',
  -- Structure: [
  --   { "chronicle_id": "uuid", "event_type": "action_required",
  --     "summary": "Submit SI", "occurred_at": "...", "party": "operations",
  --     "relation": "caused_by" | "resolved_by" | "followed_by",
  --     "days_from_trigger": 1 }
  -- ]

  -- Current state
  current_state VARCHAR(100),
  days_in_current_state INTEGER,

  -- Narrative (AI-generated)
  narrative_summary TEXT,  -- One-liner for list view
  full_narrative TEXT,     -- Full story for detail view

  -- Impact assessment
  financial_impact_usd DECIMAL(12,2),
  delay_impact_days INTEGER,
  affected_parties TEXT[],

  -- Resolution tracking
  resolution_required BOOLEAN DEFAULT true,
  resolution_deadline TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolution_chronicle_id UUID REFERENCES chronicle(id),
  resolution_summary TEXT,

  -- Metadata
  auto_detected BOOLEAN DEFAULT true,
  confidence_score INTEGER CHECK (confidence_score >= 0 AND confidence_score <= 100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_narrative_chains_shipment ON shipment_narrative_chains(shipment_id);
CREATE INDEX idx_narrative_chains_active ON shipment_narrative_chains(shipment_id)
  WHERE chain_status = 'active';
```

### 3.2 Table: `stakeholder_interaction_summary`

Pre-computed party behavior for instant access.

```sql
CREATE TABLE stakeholder_interaction_summary (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  party_type VARCHAR(50) NOT NULL,
  party_identifier VARCHAR(255), -- Email domain or carrier name
  party_display_name VARCHAR(255),

  -- Communication stats
  total_emails INTEGER DEFAULT 0,
  inbound_count INTEGER DEFAULT 0,
  outbound_count INTEGER DEFAULT 0,
  first_contact TIMESTAMPTZ,
  last_contact TIMESTAMPTZ,
  days_since_last_contact INTEGER,

  -- Response behavior
  avg_response_time_hours DECIMAL(10,2),
  unanswered_count INTEGER DEFAULT 0,
  behavior_pattern VARCHAR(20), -- 'responsive', 'slow', 'problematic', 'excellent'

  -- Sentiment tracking
  positive_count INTEGER DEFAULT 0,
  neutral_count INTEGER DEFAULT 0,
  negative_count INTEGER DEFAULT 0,
  urgent_count INTEGER DEFAULT 0,
  overall_sentiment VARCHAR(20),

  -- Issue involvement
  issues_raised INTEGER DEFAULT 0,
  issues_resolved INTEGER DEFAULT 0,
  issue_types TEXT[],

  -- Recent communications (last 5)
  recent_communications JSONB DEFAULT '[]',
  -- [{ "date": "...", "direction": "inbound", "type": "...",
  --    "summary": "...", "sentiment": "...", "chronicle_id": "..." }]

  last_computed TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(shipment_id, party_type, party_identifier)
);
```

### 3.3 Table: `shipment_story_events`

Unified timeline with narrative context.

```sql
CREATE TABLE shipment_story_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  -- Source
  source_type VARCHAR(30) NOT NULL, -- 'chronicle', 'milestone', 'system'
  source_id UUID,

  -- Event details
  event_category VARCHAR(50) NOT NULL, -- 'communication', 'document', 'issue', 'action', 'milestone'
  event_type VARCHAR(100) NOT NULL,
  event_headline TEXT NOT NULL, -- "Shipping Line reported delay"
  event_detail TEXT,

  -- Parties
  from_party VARCHAR(100),
  to_party VARCHAR(100),
  party_display_name VARCHAR(255),

  -- Narrative importance
  importance VARCHAR(20) DEFAULT 'normal', -- 'critical', 'high', 'normal', 'low'
  is_key_moment BOOLEAN DEFAULT false,

  -- Chain linking
  narrative_chain_id UUID REFERENCES shipment_narrative_chains(id),
  chain_position INTEGER,
  chain_role VARCHAR(30), -- 'trigger', 'effect', 'resolution'

  -- Timing
  occurred_at TIMESTAMPTZ NOT NULL,
  days_ago INTEGER,

  -- Response tracking
  requires_response BOOLEAN DEFAULT false,
  response_received BOOLEAN DEFAULT false,
  response_deadline TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_story_events_shipment ON shipment_story_events(shipment_id, occurred_at DESC);
CREATE INDEX idx_story_events_key ON shipment_story_events(shipment_id) WHERE is_key_moment = true;
```

---

## 4. TypeScript Types

```typescript
// /lib/chronicle-v2/types/narrative.ts

/**
 * A narrative chain linking cause to effect
 */
export interface NarrativeChain {
  id: string;
  chainType: 'issue_to_action' | 'communication_chain' | 'delay_chain' | 'escalation_chain';
  chainStatus: 'active' | 'resolved' | 'stale';

  // Trigger event
  trigger: {
    chronicleId: string;
    eventType: string;
    summary: string;
    occurredAt: string;
    party: string | null;
    daysAgo: number;
  };

  // Chain of effects
  events: Array<{
    chronicleId: string;
    eventType: string;
    summary: string;
    occurredAt: string;
    party: string | null;
    relation: 'caused_by' | 'resolved_by' | 'followed_by';
    daysFromTrigger: number;
  }>;

  // Current state
  currentState: string;
  daysInCurrentState: number;
  awaitingFrom: string | null; // "Carrier", "Shipper", etc.

  // Narrative
  narrativeSummary: string; // "Delay reported by carrier led to SI deadline extension"

  // Impact
  impact: {
    delayDays: number | null;
    affectedParties: string[];
  };

  // Resolution
  resolution: {
    required: boolean;
    deadline: string | null;
    resolvedAt: string | null;
  };
}

/**
 * Pre-computed stakeholder behavior
 */
export interface StakeholderSummary {
  partyType: string;
  displayName: string;

  // Communication stats
  stats: {
    totalEmails: number;
    lastContact: string | null;
    daysSinceLastContact: number | null;
  };

  // Behavior
  responsiveness: {
    avgResponseHours: number | null;
    behaviorPattern: 'responsive' | 'slow' | 'problematic' | 'excellent' | 'unknown';
  };

  // Sentiment
  sentiment: {
    overall: 'positive' | 'neutral' | 'negative' | 'mixed' | null;
    urgentCount: number;
  };

  // Recent communications
  recentCommunications: Array<{
    date: string;
    direction: 'inbound' | 'outbound';
    summary: string;
    chronicleId: string;
  }>;
}

/**
 * A unified story event
 */
export interface StoryEvent {
  id: string;
  category: 'communication' | 'document' | 'issue' | 'action' | 'milestone';
  headline: string;
  detail: string | null;

  fromParty: string | null;
  partyDisplayName: string | null;

  importance: 'critical' | 'high' | 'normal' | 'low';
  isKeyMoment: boolean;

  // Chain context
  chainId: string | null;
  chainRole: 'trigger' | 'effect' | 'resolution' | null;

  occurredAt: string;
  daysAgo: number;

  requiresResponse: boolean;
  responseReceived: boolean;
}

/**
 * Complete shipment story
 */
export interface ShipmentStory {
  shipmentId: string;
  bookingNumber: string | null;

  // Current state summary
  headline: string; // "Vessel rollover - awaiting new schedule from carrier"
  currentSituation: string; // Full explanation

  // Active chains needing attention
  activeChains: NarrativeChain[];

  // Stakeholder summaries
  stakeholders: StakeholderSummary[];

  // Timeline
  timeline: StoryEvent[];
  keyMoments: StoryEvent[];

  // Smart recommendation with full context
  recommendation: {
    action: string;
    priority: 'critical' | 'high' | 'medium' | 'low';
    reason: string;
    chainOfThought: string; // Full reasoning: "1. Carrier reported rollover on Jan 10..."
    suggestedRecipients: string[];
  } | null;

  // Draft reply context (for future)
  draftReplyContext: {
    lastMessageFrom: string | null;
    lastMessageSubject: string | null;
    suggestedTone: 'formal' | 'urgent' | 'friendly';
    keyPointsToAddress: string[];
  } | null;
}
```

---

## 5. Chain Detection Logic

### 5.1 Issue-to-Action Chain

```typescript
async function detectIssueToActionChain(chronicleEntry: Chronicle): Promise<NarrativeChain | null> {
  if (!chronicleEntry.has_issue) return null;

  // Find subsequent actions related to this issue
  const relatedActions = await findActionsAfterIssue(
    chronicleEntry.shipment_id,
    chronicleEntry.occurred_at,
    chronicleEntry.issue_type
  );

  if (relatedActions.length === 0) {
    // Issue without action = needs attention
    return {
      chainType: 'issue_to_action',
      chainStatus: 'active',
      trigger: {
        chronicleId: chronicleEntry.id,
        eventType: chronicleEntry.issue_type,
        summary: chronicleEntry.issue_description,
        occurredAt: chronicleEntry.occurred_at,
        party: chronicleEntry.from_party,
      },
      events: [],
      currentState: 'Issue reported - no action taken yet',
      awaitingFrom: 'Operations',
      // ...
    };
  }

  // Build chain with actions
  return {
    chainType: 'issue_to_action',
    chainStatus: allActionsCompleted(relatedActions) ? 'resolved' : 'active',
    trigger: { /* ... */ },
    events: relatedActions.map(action => ({
      chronicleId: action.id,
      eventType: 'action_required',
      summary: action.action_description,
      occurredAt: action.occurred_at,
      relation: 'caused_by',
      daysFromTrigger: daysBetween(chronicleEntry.occurred_at, action.occurred_at),
    })),
    // ...
  };
}
```

### 5.2 Communication Chain

```typescript
async function detectCommunicationChain(chronicleEntry: Chronicle): Promise<NarrativeChain | null> {
  // Find if this is part of an ongoing thread
  const threadMessages = await getThreadMessages(chronicleEntry.thread_id);

  // Identify the initial message requiring response
  const initialMessage = threadMessages.find(m =>
    m.message_type === 'action_required' ||
    m.message_type === 'request' ||
    (m.direction === 'inbound' && needsResponse(m))
  );

  if (!initialMessage) return null;

  // Check if response was sent
  const responses = threadMessages.filter(m =>
    m.occurred_at > initialMessage.occurred_at &&
    m.direction === 'outbound'
  );

  return {
    chainType: 'communication_chain',
    chainStatus: responses.length > 0 ? 'resolved' : 'active',
    trigger: {
      summary: `${initialMessage.from_party} sent: ${initialMessage.summary}`,
      // ...
    },
    currentState: responses.length > 0
      ? 'Response sent'
      : `Awaiting response - ${daysSince(initialMessage.occurred_at)} days`,
    awaitingFrom: 'Operations',
    // ...
  };
}
```

---

## 6. UI Components

### 6.1 ShipmentStoryPanel

```
+--------------------------------------------------+
| WHAT'S HAPPENING                                  |
| Vessel rollover reported - awaiting new schedule  |
| from Hapag-Lloyd. SI deadline may need extension. |
+--------------------------------------------------+

+--------------------------------------------------+
| ACTIVE CHAINS (2)                                 |
+--------------------------------------------------+
| [!] DELAY CHAIN                          ACTIVE  |
| ------------------------------------------------ |
| Jan 10: Hapag-Lloyd reported vessel rollover     |
|     ↓                                            |
| Jan 10: SI deadline extension requested          |
|     ↓                                            |
| Jan 11: Shipper notified of delay                |
|     ↓                                            |
| [Awaiting: Carrier confirmation - 2 days]        |
| ------------------------------------------------ |
| Impact: Est. 3 day delay | Shipper, Consignee    |
+--------------------------------------------------+

+--------------------------------------------------+
| [!] COMMUNICATION CHAIN                  ACTIVE  |
| ------------------------------------------------ |
| Jan 11: Customs broker requested ISF filing info |
|     ↓                                            |
| [Awaiting: Our response - 1 day]                 |
+--------------------------------------------------+

+--------------------------------------------------+
| RECOMMENDATION                          CRITICAL |
+--------------------------------------------------+
| Follow up with Hapag-Lloyd for new schedule      |
|                                                  |
| [v] WHY THIS MATTERS                             |
| +----------------------------------------------+ |
| | Chain of Thought:                            | |
| | 1. Vessel rollover reported Jan 10 (2d ago)  | |
| | 2. Original ETD was Jan 15                   | |
| | 3. New schedule not yet confirmed            | |
| | 4. SI cutoff was Jan 12 - status unclear     | |
| | 5. Shipper waiting for updated schedule      | |
| | 6. No response from carrier in 2 days        | |
| +----------------------------------------------+ |
|                                                  |
| [Draft Reply to Hapag-Lloyd]                     |
+--------------------------------------------------+

+--------------------------------------------------+
| STAKEHOLDERS                                     |
+--------------------------------------------------+
| [Ship] Hapag-Lloyd (Shipping Line)              |
|        Last: 2d ago | Response: ~4h | Neutral   |
|        • Jan 10: Rollover notification          |
|        • Jan 8: Booking confirmation            |
| ------------------------------------------------|
| [Customs] Portside (Customs Broker)             |
|        Last: 1d ago | Response: ~8h | Neutral   |
|        • Jan 11: ISF info request [PENDING]     |
+--------------------------------------------------+
```

### 6.2 Timeline with Chain Context

```
+--------------------------------------------------+
| SHIPMENT TIMELINE                                |
+--------------------------------------------------+
| [KEY] Jan 10 - Hapag-Lloyd                       |
| [!] Vessel rollover reported                     |
|     → Started: Delay Chain                       |
| ------------------------------------------------ |
| Jan 10 - Operations                              |
| SI deadline extension requested to carrier       |
|     → Part of: Delay Chain                       |
| ------------------------------------------------ |
| Jan 11 - Operations                              |
| Shipper notified of schedule change              |
|     → Part of: Delay Chain                       |
| ------------------------------------------------ |
| [KEY] Jan 11 - Portside (Customs Broker)         |
| [?] ISF filing information requested             |
|     → Started: Communication Chain [PENDING]    |
| ------------------------------------------------ |
| Jan 8 - Hapag-Lloyd                              |
| Booking confirmation received                    |
| ------------------------------------------------ |
| Jan 5 - Operations                               |
| Booking request sent                             |
+--------------------------------------------------+
```

---

## 7. Implementation Plan

### Phase 1: Database (Day 1)
- [ ] Create migration for `shipment_narrative_chains`
- [ ] Create migration for `stakeholder_interaction_summary`
- [ ] Create migration for `shipment_story_events`
- [ ] Add indexes

### Phase 2: Chain Detection Service (Days 2-3)
- [ ] Implement `NarrativeChainService`
- [ ] Issue-to-action chain detection
- [ ] Communication chain detection
- [ ] Delay chain detection
- [ ] Chain status updates

### Phase 3: Stakeholder Analysis (Day 3)
- [ ] Implement `StakeholderAnalysisService`
- [ ] Summary computation
- [ ] Behavior pattern detection
- [ ] Follow-up identification

### Phase 4: Story Assembly (Day 4)
- [ ] Implement `ShipmentStoryService`
- [ ] Headline generation
- [ ] Chain-of-thought recommendation
- [ ] Draft reply context

### Phase 5: API Endpoints (Day 4)
- [ ] `/api/chronicle-v2/shipments/[id]/story`
- [ ] `/api/chronicle-v2/shipments/[id]/chains`
- [ ] `/api/chronicle-v2/shipments/[id]/stakeholders`

### Phase 6: UI Components (Days 5-6)
- [ ] `ShipmentStoryPanel`
- [ ] `NarrativeChainCard`
- [ ] `StakeholderCard`
- [ ] `ChainOfThoughtPanel`
- [ ] Integration into shipment detail

### Phase 7: Backfill & Testing (Day 7)
- [ ] Backfill script for existing data
- [ ] Unit tests
- [ ] Integration tests

---

## 8. Future: Draft Reply Generation

With this structure, draft reply generation becomes straightforward:

```typescript
interface DraftReplyContext {
  // From narrative chain
  chainType: string;
  triggerSummary: string;
  currentState: string;

  // From stakeholder
  recipientName: string;
  recipientBehavior: string;
  lastCommunication: string;

  // From recommendation
  keyPoints: string[];
  suggestedTone: string;
}

// AI prompt can use this structured context to generate appropriate reply
```

---

## 9. Success Metrics

| Metric | Target |
|--------|--------|
| Time to understand shipment status | < 30 seconds |
| % of issues with clear action path | 100% |
| % of pending responses identified | 100% |
| User clicks into email trail | Reduce by 80% |
