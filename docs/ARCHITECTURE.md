# IntDB Freight Intelligence Platform - Complete Architecture

> **Generated:** December 2024
> **Project:** IntDB (Freight Intelligence Database)
> **Tech Stack:** Next.js 16, TypeScript, Supabase (PostgreSQL), Anthropic Claude AI, Gmail API

---

## Table of Contents

1. [High-Level System Architecture](#1-high-level-system-architecture)
2. [Database Architecture (4-Layer Design)](#2-database-architecture-4-layer-design)
3. [Stage 1: Email Ingestion](#3-stage-1-email-ingestion)
4. [Stage 2: Classification](#4-stage-2-classification)
5. [Stage 3: Entity Extraction](#5-stage-3-entity-extraction)
6. [Stage 4: Shipment Linking](#6-stage-4-shipment-linking)
7. [Stage 5a: Document Lifecycle](#7-stage-5a-document-lifecycle)
8. [Stage 5b: Stakeholder Extraction](#8-stage-5b-stakeholder-extraction)
9. [Stage 6: Notification Classification](#9-stage-6-notification-classification)
10. [Stage 7: Task Generation](#10-stage-7-task-generation)
11. [Stage 8: Priority Calculation](#11-stage-8-priority-calculation)
12. [Stage 9: Insight Generation](#12-stage-9-insight-generation)
13. [Stage 10: Action Center](#13-stage-10-action-center)
14. [Complete Pipeline Diagram](#14-complete-pipeline-diagram)
15. [Key Files Reference](#15-key-files-reference)
16. [Configuration Constants](#16-configuration-constants)

---

## 1. High-Level System Architecture

```
+============================================================================================+
|                           INTDB - FREIGHT INTELLIGENCE SYSTEM                              |
+============================================================================================+
|                                                                                            |
|  +-----------------+     +----------------+     +------------------+     +---------------+ |
|  |  Gmail Inbox    |     |  Supabase DB   |     |  Anthropic AI    |     |  Next.js UI   | |
|  |  (Email Source) |     |  (PostgreSQL)  |     |  (Claude)        |     |  (Dashboard)  | |
|  +-----------------+     +----------------+     +------------------+     +---------------+ |
|          |                      ^                      ^                       ^          |
|          v                      v                      v                       |          |
|  +-----------------------------------------------------------------------------------+    |
|  |                        EMAIL INGESTION AGENT (Cron: */15 min)                     |    |
|  +-----------------------------------------------------------------------------------+    |
|                                      |                                                    |
|                                      v                                                    |
|  +-----------------------------------------------------------------------------------+    |
|  |                          EMAIL PROCESSING PIPELINE                                 |    |
|  |   1. Classification -> 2. Entity Extraction -> 3. Shipment Linking -> 4. Lifecycle |    |
|  +-----------------------------------------------------------------------------------+    |
|                                      |                                                    |
|                                      v                                                    |
|  +-----------------------------------------------------------------------------------+    |
|  |                           API LAYER (50+ Next.js Routes)                           |    |
|  +-----------------------------------------------------------------------------------+    |
|                                      |                                                    |
|                                      v                                                    |
|  +-----------------------------------------------------------------------------------+    |
|  |                        DASHBOARD UI (Mission Control)                              |    |
|  +-----------------------------------------------------------------------------------+    |
+===========================================================================================+
```

---

## 2. Database Architecture (4-Layer Design)

```
+-----------------------------------------------------------------------------+
| LAYER 4: CONFIGURATION (carrier_configs, extraction_rules, ai_model_configs)|
+-----------------------------------------------------------------------------+
                                    |
                                    v
+-----------------------------------------------------------------------------+
| LAYER 3: DECISION SUPPORT (shipments, shipment_documents, action_tasks)     |
+-----------------------------------------------------------------------------+
                                    |
                                    v
+-----------------------------------------------------------------------------+
| LAYER 2: INTELLIGENCE (document_classifications, entity_extractions)        |
+-----------------------------------------------------------------------------+
                                    |
                                    v
+-----------------------------------------------------------------------------+
| LAYER 1: RAW DATA (raw_emails, raw_attachments) - Immutable                 |
+-----------------------------------------------------------------------------+
```

### Layer Details

| Layer | Tables | Purpose |
|-------|--------|---------|
| **Layer 1** | raw_emails, raw_attachments | Immutable source of truth |
| **Layer 2** | document_classifications, entity_extractions, shipment_insights | AI-powered intelligence |
| **Layer 3** | shipments, shipment_documents, action_tasks, parties | Business entities |
| **Layer 4** | carrier_configs, notification_type_configs, insight_patterns | Database-driven configuration |

---

## 3. Stage 1: Email Ingestion

**File:** `agents/email-ingestion-agent.ts`
**Trigger:** Cron job every 15 minutes

```
+------------------------------------------------------------------------------+
|  STAGE 1: EMAIL INGESTION                                                     |
+------------------------------------------------------------------------------+
|                                                                              |
|   +-------------------+     +-------------------+     +-------------------+   |
|   | Build Gmail Query |     | Fetch Message IDs |     | Idempotency Check |   |
|   | (carrier configs) | --> | (batch fetch)     | --> | (gmail_message_id)|   |
|   +-------------------+     +-------------------+     +-------------------+   |
|                                                              |               |
|                                                         EXISTS?              |
|                                                         YES -> Skip          |
|                                                         NO  -> Continue      |
|                                                              |               |
|                                                              v               |
|                                                   +-------------------+      |
|                                                   | Save to Database  |      |
|                                                   | (raw_emails +     |      |
|                                                   | raw_attachments)  |      |
|                                                   +-------------------+      |
+------------------------------------------------------------------------------+
```

### Gmail Query Example
```
to:ops@intoglo.com OR to:nam@intoglo.com after:2024-12-22
```

### Key Features
- **Idempotency:** Checks `gmail_message_id` uniqueness before processing
- **True Sender Extraction:** Extracts `X-Original-Sender` for forwarded emails
- **PDF Text Extraction:** Uses `pdf-parse` for attachment text extraction

---

## 4. Stage 2: Classification

**File:** `lib/services/comprehensive-classification-service.ts`

```
+------------------------------------------------------------------------------+
|  STAGE 2: CLASSIFICATION                                                      |
+------------------------------------------------------------------------------+
|                                                                              |
|   +-------------------------+          +-------------------------+           |
|   | Is Shipping Line Email? |   YES    | Pattern-Based First     |           |
|   | (check sender domain)   | -------> | (shipping-line-patterns)|           |
|   +-------------------------+          +-------------------------+           |
|            |                                    |                            |
|            | NO                                 | Confidence?                |
|            v                                    |                            |
|   +-------------------------+          +-------+-------+                     |
|   | AI Document Stage       |          |               |                     |
|   | Classification          |        >=85%           <85%                    |
|   +-------------------------+          |               |                     |
|                                        v               v                     |
|                               +-------------+  +----------------+            |
|                               | DETERMINISTIC|  | AI CLASSIFICATION|          |
|                               | (No API cost)|  | (Claude)        |          |
|                               +-------------+  +----------------+            |
+------------------------------------------------------------------------------+
```

### Document Types (30+)

| Category | Types |
|----------|-------|
| Booking | booking_confirmation, booking_amendment, booking_cancellation |
| Documentation | shipping_instruction, si_draft, bill_of_lading, house_bl |
| Operational | arrival_notice, delivery_order, customs_clearance |
| Financial | invoice, debit_note, credit_note |
| Notifications | cutoff_advisory, vessel_schedule, rollover_notice |

### Confidence Thresholds

| Level | Score | Action |
|-------|-------|--------|
| HIGH | >= 85% | Auto-approved, deterministic |
| MEDIUM | 60-84% | Acceptable, may need review |
| LOW | < 60% | Requires manual review |

---

## 5. Stage 3: Entity Extraction

**File:** `lib/services/shipment-extraction-service.ts`

```
+------------------------------------------------------------------------------+
|  STAGE 3: ENTITY EXTRACTION                                                   |
+------------------------------------------------------------------------------+
|                                                                              |
|   +-------------------------+     +-------------------------+                |
|   | Combine Content         |     | Detect Carrier          |                |
|   | (Email + PDF text)      | --> | (sender domain)         |                |
|   +-------------------------+     +-------------------------+                |
|                                            |                                 |
|                                            v                                 |
|   +---------------------------------------------------------------------+    |
|   | AI Extraction with Carrier-Specific Hints                           |    |
|   +---------------------------------------------------------------------+    |
|   | MAERSK: Booking numbers 9-10 digits, "Important Dates" section      |    |
|   | HAPAG:  "Deadline Information" section, "Shipping instruction closing"|   |
|   | CMA:    "Key Dates" section, container prefix "CMAU"                |    |
|   +---------------------------------------------------------------------+    |
+------------------------------------------------------------------------------+
```

### Entities Extracted

| Category | Fields |
|----------|--------|
| **Identifiers** | booking_number, bl_number, container_numbers[] |
| **Carrier/Voyage** | carrier_name, vessel_name, voyage_number |
| **Routing** | port_of_loading, port_of_discharge, port codes (UN/LOCODE) |
| **Dates** | etd, eta |
| **Cutoffs** | si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff |
| **Parties** | shipper_name, consignee_name, notify_party |

---

## 6. Stage 4: Shipment Linking

**File:** `lib/services/shipment-linking-service.ts`

```
+------------------------------------------------------------------------------+
|  STAGE 4: SHIPMENT LINKING                                                    |
+------------------------------------------------------------------------------+
|                                                                              |
|   SEARCH PRIORITY ORDER:                                                     |
|   +---------------------------------------------------------------------+    |
|   |  1. BOOKING NUMBER  ->  findByBookingNumber()   ->  95% confidence  |    |
|   |  2. BL NUMBER       ->  findByBlNumber()        ->  90% confidence  |    |
|   |  3. CONTAINER #     ->  findByContainerNumber() ->  75% confidence  |    |
|   +---------------------------------------------------------------------+    |
|                              |                                               |
|              +---------------+---------------+                               |
|              |                               |                               |
|         FOUND                           NOT FOUND                            |
|              |                               |                               |
|              v                               v                               |
|   +-------------------+           +-------------------+                      |
|   | UPDATE EXISTING   |           | CREATE NEW        |                      |
|   | (fill in blanks)  |           | SHIPMENT          |                      |
|   +-------------------+           +-------------------+                      |
|                                                                              |
|   CONFIDENCE-BASED ACTIONS:                                                  |
|   +---------------------------------------------------------------------+    |
|   | >= 85% HIGH   | AUTO-LINK: Insert into shipment_documents           |    |
|   | 60-84% MEDIUM | SUGGESTION: Insert into shipment_link_candidates    |    |
|   | < 60% LOW     | NO ACTION: Return "confidence too low"              |    |
|   +---------------------------------------------------------------------+    |
+------------------------------------------------------------------------------+
```

### Status Upgrade Logic (Never Downgrade)

```
cancelled  draft  booked  in_transit  arrived  delivered
    -1       0       1         2          3         4
```

---

## 7. Stage 5a: Document Lifecycle

**File:** `lib/services/document-lifecycle-service.ts`

### State Machine

```
    +-------+      +--------+      +----------+      +------+      +-------------+
    | DRAFT | ---> | REVIEW | ---> | APPROVED | ---> | SENT | ---> | ACKNOWLEDGED|
    +-------+      +--------+      +----------+      +------+      +-------------+
        |              |                |                |                |
        +------+-------+----------------+----------------+----------------+
               |
               v
        +------------+
        | SUPERSEDED |  <- Terminal state (new revision received)
        +------------+
```

### Document Prerequisites

```
BOOKING PHASE
+---------------------+
| booking_confirmation|
+----------+----------+
           |
     +-----+-----+
     |           |
     v           v
+---------+  +------------------+
| VGM     |  | SI PHASE         |
+---------+  | si_draft         |
             | si_submission    |
             +--------+---------+
                      |
                      v
             +------------------+
             | BL PHASE         |
             | bill_of_lading   |
             +--------+---------+
                      |
                      v
             +------------------+
             | arrival_notice   |
             +--------+---------+
                      |
                      v
             +------------------+
             | delivery_order   |
             +------------------+
```

---

## 8. Stage 5b: Stakeholder Extraction

**File:** `lib/services/stakeholder-extraction-service.ts`

```
+------------------------------------------------------------------------------+
|  STAKEHOLDER EXTRACTION FLOW                                                  |
+------------------------------------------------------------------------------+
|                                                                              |
|   1. NORMALIZE NAME                                                          |
|      - Trim whitespace, remove special chars, uppercase                      |
|                                                                              |
|   2. CHECK IF INTOGLO                                                        |
|      - Skip if shipper in MBL/booking (Intoglo acts as shipper)              |
|                                                                              |
|   3. MATCH EXISTING PARTY                                                    |
|      - By exact name -> By contact email -> By email domain                  |
|                                                                              |
|   4. DETERMINE CUSTOMER                                                      |
|      - Export: shipper = customer                                            |
|      - Import: consignee = customer                                          |
|      - Only from HBL/SI documents (not MBL)                                  |
|                                                                              |
|   5. CREATE RELATIONSHIPS                                                    |
|      - shipper <-> consignee (stakeholder_relationships)                     |
|                                                                              |
|   6. LINK TO SHIPMENT                                                        |
|      - shipments.shipper_id, consignee_id, customer_id                       |
+------------------------------------------------------------------------------+
```

---

## 9. Stage 6: Notification Classification

**File:** `database/migrations/018_notification_management.sql`

### Notification Types

| Type | Category | Priority | Urgency Hours | Auto-Gen Task |
|------|----------|----------|---------------|---------------|
| rollover | vessel | CRITICAL | 4 | Yes |
| vessel_omission | vessel | CRITICAL | 4 | Yes |
| customs_hold | customs | CRITICAL | 2 | Yes |
| cargo_cutoff | deadline | CRITICAL | 12 | Yes |
| si_cutoff | deadline | HIGH | 24 | Yes |
| vgm_cutoff | deadline | HIGH | 24 | Yes |
| vessel_delay | vessel | HIGH | 48 | Yes |
| detention_alert | financial | HIGH | 24 | Yes |
| arrival_notice | carrier | MEDIUM | 48 | Yes |

### Urgency Score Calculation

```
urgency_score = base_score + deadline_factor + type_factor

base_score:      critical=80, high=60, medium=40, low=20
deadline_factor: overdue=+20, <24h=+15, <48h=+10, <72h=+5
type_factor:     rollover/customs_hold/omission/cargo_cutoff = +10

MAX SCORE: 100
```

---

## 10. Stage 7: Task Generation

**File:** `lib/services/task-generation-service.ts`

### Task Triggers

| Trigger Type | Description |
|--------------|-------------|
| deadline_approaching | X days before deadline |
| deadline_passed | Deadline has passed |
| document_received | New document arrived |
| document_missing | Document not received by due date |
| notification_received | Notification needs action |
| milestone_reached | Workflow state changed |
| milestone_missed | Expected milestone not reached |

### Idempotency Check

```sql
SELECT * FROM action_tasks
WHERE template_code = X
  AND shipment_id = Y
  AND status NOT IN ('completed', 'dismissed')
```

---

## 11. Stage 8: Priority Calculation

**File:** `lib/services/task-priority-service.ts`

### Weighted Factors

| Factor | Weight | Description |
|--------|--------|-------------|
| deadline_urgency | 30% | Based on hours until due |
| financial_impact | 15% | Shipment value, demurrage risk |
| notification_severity | 15% | Critical/High/Medium/Low |
| stakeholder_importance | 10% | Customer tier |
| historical_pattern | 10% | Past issues |
| document_criticality | 5% | Blocking document? |
| insight_boost | 15% | From insight engine |
| **TOTAL** | **100%** | Max score: 100 |

### Deadline Urgency Breakdown

| Condition | Score (of 30) | % of Weight |
|-----------|---------------|-------------|
| OVERDUE | 30 | 100% |
| Due within 4 hours | 28.5 | 95% |
| Due within 24 hours | 25.5 | 85% |
| Due within 48 hours | 21 | 70% |
| Due within 72 hours | 15 | 50% |
| Due within 7 days | 9 | 30% |
| Due > 7 days | 3 | 10% |

### Priority Levels

| Level | Score Range | Visual |
|-------|-------------|--------|
| CRITICAL | 85-100 | Red |
| HIGH | 70-84 | Orange |
| MEDIUM | 50-69 | Yellow |
| LOW | 0-49 | Green |

---

## 12. Stage 9: Insight Generation

**File:** `lib/services/insight-engine.ts`
**Trigger:** Cron job every 4 hours

### 4-Stage Pipeline

```
+------------------+     +------------------+     +------------------+     +------------------+
|    STAGE 1       |     |    STAGE 2       |     |    STAGE 3       |     |    STAGE 4       |
| CONTEXT GATHERER | --> | PATTERN DETECTOR | --> |  AI ANALYZER     | --> |  SYNTHESIZER     |
+------------------+     +------------------+     +------------------+     +------------------+
| Collect:         |     | Rules-based:     |     | Runs when:       |     | Deduplicate      |
| - Shipment data  |     | - 5 categories   |     | - Critical found |     | Rank by priority |
| - Documents      |     | - 20+ patterns   |     | - Platinum cust  |     | Persist to DB    |
| - Stakeholders   |     | - No API cost    |     | - Complex case   |     | Update tasks     |
| - Related ships  |     | - Fast           |     | - Near deadline  |     |                  |
+------------------+     +------------------+     +------------------+     +------------------+
```

### Pattern Categories

| Category | Example Patterns |
|----------|-----------------|
| TIMELINE | si_cutoff_passed_no_si, cutoff_within_24h, etd_before_cutoffs |
| STAKEHOLDER | shipper_reliability_low, carrier_high_rollover |
| DOCUMENT | missing_critical_doc, document_quality_critical |
| FINANCIAL | demurrage_risk, detention_accruing |
| CROSS-SHIPMENT | consignee_capacity_risk, high_customer_exposure |

### Priority Boost

| Severity | Boost Range |
|----------|-------------|
| Critical | +15 to +25 points |
| High | +8 to +15 points |
| Medium | +3 to +8 points |
| Max Total | +50 points |

---

## 13. Stage 10: Action Center

**File:** `app/action-center/page.tsx`

The Action Center dashboard displays:
- Tasks sorted by priority_score (descending)
- Insights as proactive alerts
- Quick actions for common operations

---

## 14. Complete Pipeline Diagram

```
+=============================================================================================================+
|                          INTDB FREIGHT INTELLIGENCE PLATFORM - COMPLETE PIPELINE                            |
+=============================================================================================================+

                                              +------------------+
                                              |    GMAIL API     |
                                              +--------+---------+
                                                       |
                                                       | Cron: */15 min
                                                       v
+-------------------------------------------------------------------------------------------------------------+
|  [1] EMAIL INGESTION -> [2] CLASSIFICATION -> [3] ENTITY EXTRACTION -> [4] SHIPMENT LINKING                 |
+-------------------------------------------------------------------------------------------------------------+
                                                       |
                          +----------------------------+----------------------------+
                          |                                                         |
                          v                                                         v
               [5a] DOCUMENT LIFECYCLE                                   [5b] STAKEHOLDER EXTRACTION
               - State machine                                           - Party matching
               - Prerequisites                                           - Customer identification
               - Quality scoring                                         - Relationship creation
                          |                                                         |
                          +----------------------------+----------------------------+
                                                       |
                                                       v
+-------------------------------------------------------------------------------------------------------------+
|  [6] NOTIFICATION CLASSIFICATION -> [7] TASK GENERATION -> [8] PRIORITY CALCULATION                         |
+-------------------------------------------------------------------------------------------------------------+
                                                       |
                                                       v
                                        [9] INSIGHT GENERATION (Cron: /4 hours)
                                        - Context gathering
                                        - Pattern detection (rules)
                                        - AI analysis (conditional)
                                        - Priority boost
                                                       |
                                                       v
                                            [10] ACTION CENTER (UI)
                                            - Tasks by priority
                                            - Proactive insights
                                            - Quick actions
+=============================================================================================================+
```

---

## 15. Key Files Reference

### Email Ingestion
| Component | File |
|-----------|------|
| Cron Entry | `scripts/run-email-ingestion-cron.ts` |
| Ingestion Agent | `agents/email-ingestion-agent.ts` |
| Gmail Client | `utils/gmail-client.ts` |

### Classification & Extraction
| Component | File |
|-----------|------|
| Classification Service | `lib/services/comprehensive-classification-service.ts` |
| Pattern Config | `lib/config/shipping-line-patterns-v2.ts` |
| Extraction Service | `lib/services/shipment-extraction-service.ts` |

### Shipment Linking
| Component | File |
|-----------|------|
| Linking Service | `lib/services/shipment-linking-service.ts` |
| Shipment Repository | `lib/repositories/shipment-repository.ts` |
| Link Candidate Repo | `lib/repositories/shipment-link-candidate-repository.ts` |

### Document Lifecycle
| Component | File |
|-----------|------|
| Lifecycle Service | `lib/services/document-lifecycle-service.ts` |
| Authority Service | `lib/services/document-authority-service.ts` |
| Comparison Service | `lib/services/document-comparison-service.ts` |

### Stakeholder
| Component | File |
|-----------|------|
| Extraction Service | `lib/services/stakeholder-extraction-service.ts` |
| Analytics Service | `lib/services/stakeholder-analytics-service.ts` |

### Tasks & Insights
| Component | File |
|-----------|------|
| Task Generation | `lib/services/task-generation-service.ts` |
| Task Priority | `lib/services/task-priority-service.ts` |
| Insight Engine | `lib/services/insight-engine.ts` |
| Context Gatherer | `lib/services/insight-context-gatherer.ts` |
| Pattern Detector | `lib/services/insight-pattern-detector.ts` |
| AI Analyzer | `lib/services/insight-ai-analyzer.ts` |

### Database Migrations
| Component | File |
|-----------|------|
| Base Schema | `freight-intelligence-schema.sql` |
| Shipment Schema | `database/migrations/004_add_shipment_schema.sql` |
| Stakeholder | `database/migrations/016_stakeholder_intelligence.sql` |
| Document Lifecycle | `database/migrations/017_document_lifecycle.sql` |
| Notifications | `database/migrations/018_notification_management.sql` |
| Action Center | `database/migrations/019_action_center.sql` |
| Insight Engine | `database/migrations/020_insight_engine.sql` |

---

## 16. Configuration Constants

### Confidence Thresholds
| Constant | Value | Purpose |
|----------|-------|---------|
| HIGH | 85 | Auto-approved |
| MEDIUM | 60 | Needs review |
| LOW | 0 | Manual only |

### Linking Confidence
| Match Type | Confidence |
|------------|------------|
| Booking Number | 95% |
| BL Number | 90% |
| Container Number | 75% |

### Priority Thresholds
| Level | Score |
|-------|-------|
| CRITICAL | 85-100 |
| HIGH | 70-84 |
| MEDIUM | 50-69 |
| LOW | 0-49 |

### Insight Engine
| Constant | Value |
|----------|-------|
| MAX_PRIORITY_BOOST | 50 |
| MAX_INSIGHTS_DEFAULT | 10 |
| MAX_SHIPMENTS_PER_RUN | 50 |
| AI_TRIGGER_THRESHOLD | 1 |
| PRIORITY_UPDATE_THRESHOLD | 10 |

---

## Architecture Principles

This system follows the principles defined in CLAUDE.md:

1. **ETC (Easier to Change)** - Database-driven configuration
2. **DRY** - Single source of truth for patterns and rules
3. **Single Responsibility** - Each service has one job
4. **Deep Modules** - Simple interfaces, complex implementations
5. **Configuration Over Code** - Patterns in database, not hardcoded
6. **Interface-Based Design** - Carrier services implement common interface
7. **Idempotency** - All operations safe to run multiple times
8. **Fail Fast** - Invalid data stops immediately
9. **Audit Trail** - All changes tracked with source

---

*Generated from codebase analysis - December 2024*
