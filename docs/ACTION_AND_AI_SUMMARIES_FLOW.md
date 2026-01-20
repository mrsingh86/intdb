# Action Logic & AI Summaries Flow

Comprehensive documentation of how actions are determined from emails and how AI summaries are generated for shipments.

---

## 1. ACTION LOGIC FLOW

### Overview

```
EMAIL ARRIVES
      │
      ▼
CHRONICLE SERVICE: processEmail()
      │
      ▼
STEP 1: CLASSIFICATION
  ├─ Pattern Matching (85%+ confidence) → Fast
  └─ AI Analysis (fallback) → Haiku extraction
      │
      ▼
STEP 2: ACTION DETERMINATION (3 Sources)
      │
      ▼
STEP 3: PRIORITY CALCULATION (6 Factors)
      │
      ▼
STEP 4: STORE IN DATABASE
      │
      ▼
STEP 5: AUTO-RESOLUTION CHECK
```

---

### Step 1: Classification

```
┌──────────────────────────────────────────────────────────────┐
│                     CLASSIFICATION                            │
│                                                               │
│  ┌──────────────────────┐    ┌──────────────────────┐        │
│  │ Pattern Matching     │ OR │ AI Analysis (Haiku)  │        │
│  │ (85%+ confidence)    │    │ (fallback)           │        │
│  │ Fast & cheap         │    │ Full extraction      │        │
│  └──────────────────────┘    └──────────────────────┘        │
│                                                               │
│  Location: lib/chronicle/pattern-matcher.ts                   │
│            lib/chronicle/ai-analyzer.ts                       │
└──────────────────────────────────────────────────────────────┘
```

---

### Step 2: Action Determination (3 Sources)

**Location:** `lib/chronicle/unified-action-service.ts`

#### Source 1: Document Receipt Rules

**Table:** `document_action_rules`

```
Key Columns:
├─ document_type: 'draft_bl', 'checklist', 'invoice', etc.
├─ from_party: 'ocean_carrier', 'customs_broker', 'customer'
├─ is_reply: boolean (part of thread?)
├─ has_action: boolean (does this trigger action?)
├─ action_verb: 'share', 'review', 'submit', 'pay', 'investigate'
├─ to_party: 'customer', 'carrier', 'customs_broker', null
├─ action_owner: 'operations', 'customer', 'carrier'
├─ action_description: template with {placeholders}
├─ requires_response: boolean (needs confirmation back?)
├─ expected_response_type: 'approval', 'corrections', 'confirmation'
├─ default_deadline_hours: 24, 48, 72, etc.
└─ urgency: 'critical', 'high', 'normal', 'low'
```

**Example Rules:**

| When | Action | Owner | Deadline |
|------|--------|-------|----------|
| draft_bl from ocean_carrier, not reply | Share with customer for approval | operations | 24 hours |
| checklist from customs_broker | Share with customer | operations | 24 hours |
| booking_confirmation from carrier | NO action (informational) | - | - |

#### Source 2: Flip Keywords (Override Default)

```
Document type sets DEFAULT action, keywords OVERRIDE it

Example: booking_confirmation
├─ Default: NO ACTION (confirmations are informational)
├─ flip_to_action_keywords: ["missing", "required", "please provide"]
│
│  If email contains "missing VGM":
│  → Override: ACTION REQUIRED
│  → Reason: "Confirmation normally no action, but 'missing' requires attention"

Example: shipping_instructions
├─ Default: ACTION REQUIRED (SI must be submitted)
├─ flip_to_no_action_keywords: ["submitted", "received", "confirmed"]
│
│  If email contains "SI confirmed":
│  → Override: NO ACTION
│  → Reason: "SI normally needs submission, but 'confirmed' means it's done"
```

#### Source 3: Time-Based Rules

**Table:** `time_based_action_rules`

```
Trigger Events:
├─ si_cutoff: Shipping Instructions deadline
├─ vgm_cutoff: Verified Gross Mass deadline
├─ cargo_cutoff: Cargo gate-in deadline
├─ etd: Estimated Time of Departure
└─ eta: Estimated Time of Arrival

Example Rules:
┌──────────────────────────────────────────────────┐
│ Event: si_cutoff                                 │
│ Offset: -48 hours (2 days before cutoff)         │
│ Condition: if si_submitted = FALSE               │
│ Action: Remind customer to submit SI             │
│ Urgency: high                                    │
└──────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────┐
│ Event: eta                                       │
│ Offset: +24 hours (24 hours after arrival)       │
│ Condition: if container_picked_up = FALSE        │
│ Action: Remind about demurrage risk              │
└──────────────────────────────────────────────────┘
```

---

### Step 3: Priority Calculation

```
Priority Calculation Components (Score 0-100):

Base Priority: 50 (neutral)

Factor 1: Deadline Urgency (35% weight) — HIGHEST
├─ Overdue: +35 points
├─ Due within 24h: +30 points
├─ Due within 48h: +25 points
├─ Due within 7 days: +15 points
└─ Due later: +5 points

Factor 2: Financial Impact (20% weight)
├─ Platinum customer: +20
├─ Gold: +15
├─ Silver: +10
└─ Bronze: +5

Factor 3: Notification Severity (15% weight)
├─ rollover/customs_hold/vessel_omission: +15
├─ cargo_cutoff: +12
├─ vessel_delay: +10
└─ equipment_shortage: +8

Factor 4: Stakeholder Importance (15% weight)
├─ Highly reliable (≥90%): +15
├─ Good reliability (70-89%): +10
└─ Below average: +5

Factor 5: Historical Pattern (10% weight)
├─ Has past delays: +10
└─ No delay history: +0

Factor 6: Document Criticality (5% weight)
├─ Critical docs (BL, invoice, customs): +5
└─ Standard: +0

Result:
├─ 0-49: LOW
├─ 50-69: MEDIUM
├─ 70-84: HIGH
└─ 85+: CRITICAL
```

---

### Step 4: Database Storage

**Chronicle Table Action Fields:**

```sql
chronicle table:
├─ has_action: BOOLEAN
├─ action_description: TEXT
├─ action_owner: VARCHAR ('operations'|'customer'|'carrier')
├─ action_deadline: DATE
├─ action_priority: VARCHAR ('CRITICAL'|'HIGH'|'MEDIUM'|'LOW')
├─ action_completed_at: TIMESTAMP (NULL = pending)
├─ action_completed_by: VARCHAR (user_email | 'auto_resolve' | 'api')
├─ action_resolution_note: TEXT
└─ action_auto_resolve_on: JSON ARRAY
   └─ e.g., ["vgm_confirmation", "final_bl"]
```

**Audit Trail:**

```sql
action_trigger_log table:
├─ trigger_source, rule_id
├─ chronicle_id, shipment_id
├─ action_created_at, action_completed_at
└─ was_correct, feedback_notes
```

---

### Step 5: Auto-Resolution

**Location:** `lib/chronicle/action-auto-resolve-service.ts`

```
ACTION CREATED:
├─ has_action = true
├─ action_completed_at = NULL
├─ action_auto_resolve_on = ['vgm_confirmation', 'final_bl']

NEW EMAIL ARRIVES (e.g., vgm_confirmation):
      │
      ▼
Query pending actions for this shipment
WHERE has_action = true
AND action_completed_at IS NULL
AND 'vgm_confirmation' = ANY(auto_resolve_on)
      │
      ▼
If match found → UPDATE SET
├─ action_completed_at = NOW()
├─ action_completed_by = 'auto_resolve'
└─ action_resolution_note = 'Auto-resolved by vgm_confirmation'
```

**Auto-Resolve Chains:**

| Action | Auto-resolves when | Reason |
|--------|-------------------|--------|
| Submit VGM | vgm_confirmation | Carrier confirms VGM, task complete |
| Review Draft BL | final_bl, telex_release | Final BL issued, draft review done |
| Submit SI | si_confirmation | SI accepted by carrier |

---

### Action Completion Paths

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ PATH A: MANUAL  │  │ PATH B: AUTO    │  │ PATH C: API     │
│                 │  │                 │  │                 │
│ User marks done │  │ Trigger doc     │  │ External system │
│ in dashboard    │  │ received        │  │ marks complete  │
│                 │  │                 │  │                 │
│ completed_by:   │  │ completed_by:   │  │ completed_by:   │
│ "user@email"    │  │ "auto_resolve"  │  │ "api"           │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## 2. AI SUMMARIES FLOW

### Overview

```
TRIGGER: Cron Job (every 6 hours) or Manual API
      │
      ▼
FIND SHIPMENTS NEEDING SUMMARY (Priority ordered)
      │
      ▼
8-LAYER DATA GATHERING (Per Shipment)
      │
      ▼
ANTI-HALLUCINATION LAYER (P0-P3)
      │
      ▼
AI GENERATION (Claude Haiku)
      │
      ▼
SAVE TO DATABASE (UPSERT)
```

**Location:** `lib/chronicle-v2/services/haiku-summary-service.ts`

---

### Shipment Priority Selection

```
Priority Order for Summary Generation:

P0: Stale summaries (new data since last summary)
P1: ETD today or next 7 days (urgent)
P2: ETD past 7 days (recent)
P3: No ETD but recent activity
P4: Older shipments (lowest priority)
```

---

### 8-Layer Data Gathering

#### Layer 1: Shipment Context (RPC)
```typescript
interface ShipmentContext {
  id, booking_number, mbl_number, hbl_number
  port_of_loading, port_of_discharge
  vessel_name, voyage_number, carrier_name
  etd, eta, atd, ata (dates)
  si_cutoff, vgm_cutoff, cargo_cutoff
  stage, status
  shipper_name, consignee_name
  containers[]
}
```

#### Layer 2: Key Milestones (All-time)
- Confirmations, amendments, issues, stage changes
- Includes checkmarks showing completed steps

#### Layer 3: Recent Communications (Last 7 days)
- Messages, sentiment, actions, issues
- Fallback to ANY chronicles for older shipments

#### Layer 3.5: Financial Summary
```typescript
interface FinancialSummary {
  totalDocumentedCharges: number
  chargeBreakdown: [{type, amount, currency}]
  detentionDays, demurrageDays
  lastFreeDay, estimatedExposure
}
```

#### Layer 4: Date-Derived Urgency
- Days to SI/VGM/Cargo cutoffs
- ETD proximity
- ETA risk assessment

#### Layers 4.5-4.7: Intelligence
- Data quality warnings
- Escalation counts
- Rule-based action triggers

#### Layers 5-8: Cross-Shipment Profiles (Parallel)
- Shipper risk profile
- Consignee patterns
- Carrier reliability
- Route performance

---

### Anti-Hallucination Layer (P0-P3)

**Location:** `lib/chronicle-v2/services/shipment-intelligence-service.ts`

Pre-computed facts that override AI guessing:

#### P0: SLA Status (Highest Priority)
```typescript
interface SlaStatus {
  slaStatus: 'OK' | 'AT_RISK' | 'CRITICAL' | 'BREACHED' | 'NO_CONTACT'
  hoursSinceCustomerUpdate: number | null
  responsePending: boolean
  unansweredCustomerEmails: number
  nextSlaDeadline: string | null
}
```

#### P1: Escalation Level
```typescript
interface EscalationInfo {
  escalationLevel: 'L1' | 'L2' | 'L3'
  escalateTo: string
  escalationReason: string
  daysOverdue: number | null
  estimatedExposureUsd: number
}
```

#### P2: Root Cause
```typescript
interface RootCause {
  category: 'CARRIER' | 'PORT' | 'CUSTOMS' | 'CUSTOMER' | 'LOGISTICS' | 'INTOGLO'
  subcategory: string
  typicalResolutionDays: number
  requiresCustomerAction: boolean
}
```

#### P3: Data Completeness Score
- Used to set `recommendationConfidence`

---

### AI Generation

```
PROMPT BUILD:
├─ System prompt with rules (lines 255-469)
├─ All 8 layers of data
├─ Pre-computed P0-P3 facts (anti-hallucination)
├─ Blocker vs Task distinction rules
└─ Financial quantification formulas

API CALL:
├─ Model: claude-3-5-haiku-20241022
├─ Max tokens: 1500
└─ Cost: ~$0.0006 per shipment

OUTPUT: JSON with 40+ fields
├─ narrative, owner, ownerType, keyDeadline, keyInsight
├─ story, currentBlocker, blockerOwner, nextAction
├─ riskLevel, riskReason, daysOverdue
├─ predictedRisks, proactiveRecommendations
└─ slaStatus, escalationLevel, rootCauseCategory
```

---

### AI Summary Output Structure

```typescript
interface AISummary {
  // V2 Format (Tight)
  narrative: string | null           // 1-2 tight sentences
  owner: string | null               // Exact party who must act
  ownerType: 'shipper' | 'consignee' | 'carrier' | 'intoglo' | null
  keyDeadline: string | null         // e.g., "SI Cutoff Jan 14"
  keyInsight: string | null          // e.g., "32 days overdue, $4,800"

  // V1 Format (Enhanced)
  story: string                      // 3-4 sentence narrative
  currentBlocker: string | null      // What's stopping progress
  blockerOwner: string | null
  nextAction: string | null
  actionOwner: string | null
  actionPriority: 'critical' | 'high' | 'medium' | 'low' | null

  // Financial
  documentedCharges: string | null
  estimatedDetention: string | null
  financialImpact: string | null

  // Risk Assessment
  riskLevel: 'red' | 'amber' | 'green'
  riskReason: string | null
  daysOverdue: number | null

  // Intelligence Signals
  escalationCount: number | null
  daysSinceActivity: number | null
  issueCount: number | null

  // Predictive
  predictedRisks: string[] | null
  proactiveRecommendations: string[] | null

  // Anti-Hallucination (P0-P3)
  slaStatus, escalationLevel, rootCauseCategory
  recommendationConfidence, confidenceReason
}
```

---

### Database Storage

**Table:** `shipment_ai_summaries`

```sql
shipment_ai_summaries:
├─ shipment_id (unique key)
├─ narrative, story, current_blocker, next_action
├─ risk_level, risk_reason, days_overdue
├─ sla_status, escalation_level, root_cause_category
├─ predicted_risks[], proactive_recommendations[]
├─ model_used, input_tokens, output_tokens
├─ generation_cost_usd, chronicle_count
└─ updated_at
```

**Upsert Pattern:** If `shipment_id` exists → UPDATE; else INSERT

---

## 3. DATA RELATIONSHIPS

```
chronicle table (emails)
    │
    ├─ shipment_id (FK) ───┐
    ├─ document_type       │
    ├─ has_action          │    Many emails
    ├─ has_issue           │    per shipment
    └─ summary             │
                           │
                           ▼
shipments table (master) ◄─────────────────────┐
    │                                          │
    ├─ id (PK)                                 │
    ├─ booking_number, mbl, hbl                │
    ├─ etd, eta, cutoffs                       │
    └─ stage, status                           │
           │                                   │
           │ One shipment                      │
           │ has one summary                   │
           ▼                                   │
shipment_ai_summaries ─────────────────────────┘
    │
    ├─ shipment_id (unique FK)
    ├─ narrative, risk_level
    ├─ current_blocker, next_action
    └─ updated_at
```

---

## 4. KEY FILES REFERENCE

### Action Logic

| File | Purpose |
|------|---------|
| `lib/chronicle/unified-action-service.ts` | Main action determination (lines 115-355) |
| `lib/chronicle/action-auto-resolve-service.ts` | Auto-completion logic |
| `lib/chronicle/action-rules-engine.ts` | 3-source rules system |
| `lib/chronicle/chronicle-service.ts` | Orchestrator (lines 258-300) |

### AI Summaries

| File | Purpose |
|------|---------|
| `lib/chronicle-v2/services/haiku-summary-service.ts` | Main service (lines 475-2589) |
| `lib/chronicle-v2/services/shipment-intelligence-service.ts` | Anti-hallucination (lines 147-220) |
| `app/api/cron/generate-ai-summaries/route.ts` | Cron trigger (lines 1-95) |

### Database Tables

| Table | Purpose |
|-------|---------|
| `chronicle` | Email storage with action fields |
| `document_action_rules` | Document receipt rules |
| `time_based_action_rules` | Time-triggered actions |
| `action_trigger_log` | Audit trail |
| `shipment_ai_summaries` | AI-generated intelligence |

---

## 5. KEY FEATURES

### Action System
- **3-Source Architecture:** Document rules, flip keywords, time-based triggers
- **6-Factor Priority:** Deadline, financial, severity, stakeholder, history, criticality
- **Auto-Resolution:** Documents automatically complete related actions
- **Audit Trail:** All triggers logged for feedback and learning

### AI Summaries
- **8-Layer Data:** Full context from shipment, chronicles, finances, profiles
- **Anti-Hallucination:** Pre-computed P0-P3 facts override AI guessing
- **Smart Priority:** Stale summaries first, then urgent by ETD
- **Cost-Efficient:** ~$0.0006 per shipment using Haiku
- **Idempotent:** Upsert prevents duplicates

---

*Last Updated: January 2025*
