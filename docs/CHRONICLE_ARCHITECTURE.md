# Chronicle System - Visual Architecture

## 1. High-Level System Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            CHRONICLE SYSTEM                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐       │
│  │   Gmail     │    │   Claude    │    │  Supabase   │    │   Vercel    │       │
│  │    API      │    │     AI      │    │  Database   │    │   Crons     │       │
│  └──────┬──────┘    └──────┬──────┘    └──────┬──────┘    └──────┬──────┘       │
│         │                  │                  │                  │              │
│         └──────────────────┴──────────────────┴──────────────────┘              │
│                                    │                                             │
│                                    ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                        CHRONICLE V1 (Processing)                          │   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        │   │
│  │  │  Gmail  │→ │   PDF   │→ │   AI    │→ │  Repo   │→ │ Linking │        │   │
│  │  │ Service │  │Extractor│  │Analyzer │  │  Save   │  │ Service │        │   │
│  │  └─────────┘  └─────────┘  └─────────┘  └─────────┘  └─────────┘        │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                    │                                             │
│                                    ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                      CHRONICLE V2 (Intelligence)                          │   │
│  │  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐             │   │
│  │  │ Narrative │  │Stakeholder│  │  Story    │  │ Attention │             │   │
│  │  │  Chains   │  │ Analysis  │  │ Assembly  │  │  Scoring  │             │   │
│  │  └───────────┘  └───────────┘  └───────────┘  └───────────┘             │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                    │                                             │
│                                    ▼                                             │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                              UI LAYER                                     │   │
│  │        Dashboard  →  Shipment List  →  Detail View  →  Documents         │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Email Processing Pipeline (V1)

```
                                 GMAIL INBOX
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              FETCH EMAILS CRON                                   │
│                         /api/cron/fetch-emails                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
              ┌──────────┐     ┌──────────┐     ┌──────────┐
              │ Email 1  │     │ Email 2  │     │ Email N  │
              └────┬─────┘     └────┬─────┘     └────┬─────┘
                   │                │                │
                   └────────────────┼────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           PROCESS EMAILS CRON                                    │
│                        /api/cron/process-emails                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                    ChronicleService.processBatch()                         │ │
│  │                        (5 concurrent workers)                              │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        ChronicleService.processEmail()                           │
│                                                                                  │
│  ┌─────────────┐                                                                │
│  │ 1. Check    │──── Already exists? ────▶ SKIP (idempotent)                   │
│  │ Idempotency │                                                                │
│  └──────┬──────┘                                                                │
│         │ New email                                                              │
│         ▼                                                                        │
│  ┌─────────────┐     ┌─────────────┐                                            │
│  │ 2. Extract  │────▶│ PDF Text    │──── OCR if needed                         │
│  │ Attachments │     │ Extraction  │                                            │
│  └──────┬──────┘     └─────────────┘                                            │
│         │                                                                        │
│         ▼                                                                        │
│  ┌─────────────┐     ┌─────────────┐                                            │
│  │ 3. Get      │────▶│ Previous    │──── Thread context for AI                 │
│  │ Thread Ctx  │     │ Messages    │                                            │
│  └──────┬──────┘     └─────────────┘                                            │
│         │                                                                        │
│         ▼                                                                        │
│  ┌─────────────┐     ┌─────────────────────────────────────────┐                │
│  │ 4. AI       │────▶│           CLAUDE AI                     │                │
│  │ Analysis    │     │  ┌───────────────────────────────────┐  │                │
│  └──────┬──────┘     │  │ freight-forwarder.prompt.ts       │  │                │
│         │            │  │ + Zod Schema (90+ fields)         │  │                │
│         │            │  └───────────────────────────────────┘  │                │
│         │            └─────────────────────────────────────────┘                │
│         ▼                                                                        │
│  ┌─────────────┐     ┌─────────────────────────────────────────┐                │
│  │ 5. Save to  │────▶│         SUPABASE                        │                │
│  │ Database    │     │  chronicle table                        │                │
│  └──────┬──────┘     └─────────────────────────────────────────┘                │
│         │                                                                        │
│         ▼                                                                        │
│  ┌─────────────┐     ┌─────────────────────────────────────────┐                │
│  │ 6. Link to  │────▶│ RPC: link_chronicle_to_shipment         │                │
│  │ Shipment    │     │ - Find by booking#/MBL#                 │                │
│  └──────┬──────┘     │ - Create if not exists                  │                │
│         │            └─────────────────────────────────────────┘                │
│         ▼                                                                        │
│  ┌─────────────┐                                                                │
│  │ 7. Update   │──── Stage: PENDING → BOOKED → SI → BL → ARRIVED               │
│  │ Stage       │                                                                │
│  └─────────────┘                                                                │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Intelligence Layer (V2)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CHRONICLE TABLE                                     │
│                         (Raw processed emails)                                   │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
          ▼                         ▼                         ▼
┌─────────────────────┐  ┌─────────────────────┐  ┌─────────────────────┐
│  NARRATIVE CHAIN    │  │    STAKEHOLDER      │  │   ATTENTION         │
│     SERVICE         │  │  ANALYSIS SERVICE   │  │   SCORING           │
├─────────────────────┤  ├─────────────────────┤  ├─────────────────────┤
│                     │  │                     │  │                     │
│ Detect patterns:    │  │ Analyze parties:    │  │ Calculate score:    │
│                     │  │                     │  │                     │
│ ┌─────────────────┐ │  │ • Communication     │  │ • Active issues     │
│ │ Issue→Action    │ │  │   stats             │  │ • Pending actions   │
│ │ Chain           │ │  │ • Response times    │  │ • Overdue actions   │
│ └─────────────────┘ │  │ • Sentiment         │  │ • ETD urgency       │
│         │           │  │ • Behavior pattern  │  │ • Cutoff urgency    │
│         ▼           │  │                     │  │ • Activity decay    │
│ ┌─────────────────┐ │  │ Patterns:           │  │                     │
│ │ Communication   │ │  │ ┌─────────────────┐ │  │ Signal Tiers:       │
│ │ Chain           │ │  │ │ Excellent       │ │  │ ┌─────────────────┐ │
│ └─────────────────┘ │  │ │ Responsive      │ │  │ │ Strong (60+)    │ │
│         │           │  │ │ Standard        │ │  │ │ Medium (35-59)  │ │
│         ▼           │  │ │ Slow            │ │  │ │ Weak (15-34)    │ │
│ ┌─────────────────┐ │  │ │ Problematic     │ │  │ │ Noise (<15)     │ │
│ │ Delay Chain     │ │  │ └─────────────────┘ │  │ └─────────────────┘ │
│ └─────────────────┘ │  │                     │  │                     │
│                     │  │                     │  │                     │
└──────────┬──────────┘  └──────────┬──────────┘  └──────────┬──────────┘
           │                        │                        │
           └────────────────────────┼────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         SHIPMENT STORY SERVICE                                   │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  Inputs:                          Outputs:                                       │
│  ┌───────────────────┐            ┌───────────────────────────────────────┐     │
│  │ Narrative Chains  │───────────▶│ ShipmentStory                         │     │
│  ├───────────────────┤            │ ├── headline                          │     │
│  │ Stakeholder Data  │───────────▶│ ├── situation                         │     │
│  ├───────────────────┤            │ ├── activeChains[]                    │     │
│  │ Chronicle Records │───────────▶│ ├── stakeholders[]                    │     │
│  ├───────────────────┤            │ ├── storyEvents[]                     │     │
│  │ Shipment Context  │───────────▶│ ├── recommendations[]                 │     │
│  └───────────────────┘            │ └── draftReplyContext                 │     │
│                                   └───────────────────────────────────────┘     │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Narrative Chain Detection

```
                              EMAIL TIMELINE
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━▶

    ┌─────────┐         ┌─────────┐         ┌─────────┐         ┌─────────┐
    │ Issue   │         │ Action  │         │ Follow  │         │ Resolved│
    │ Raised  │────────▶│Required │────────▶│ Up      │────────▶│         │
    │         │         │         │         │         │         │         │
    │ "Cargo  │         │"Contact │         │"Still   │         │"Hold    │
    │  on hold│         │ customs"│         │ waiting"│         │ cleared"│
    └─────────┘         └─────────┘         └─────────┘         └─────────┘
         │                   │                   │                   │
         │                   │                   │                   │
         ▼                   ▼                   ▼                   ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                     ISSUE_TO_ACTION CHAIN                           │
    │  ┌───────────────────────────────────────────────────────────────┐  │
    │  │ trigger: "Cargo on hold"           status: RESOLVED           │  │
    │  │ events: [action_required, follow_up, resolution]              │  │
    │  │ confidence: 85%                    days_to_resolve: 3         │  │
    │  └───────────────────────────────────────────────────────────────┘  │
    └─────────────────────────────────────────────────────────────────────┘


    ┌─────────┐                                                 ┌─────────┐
    │ Inbound │─────────────── ? days waiting ─────────────────▶│Response │
    │ Message │                                                 │ Needed  │
    │         │                                                 │         │
    │"Request │                                                 │"Still   │
    │ for SI" │                                                 │ pending"│
    └─────────┘                                                 └─────────┘
         │                                                           │
         ▼                                                           ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                    COMMUNICATION_CHAIN                              │
    │  ┌───────────────────────────────────────────────────────────────┐  │
    │  │ trigger: "Request for SI"          status: ACTIVE             │  │
    │  │ awaiting_response_from: "shipper"  days_waiting: 5            │  │
    │  │ confidence: 75%                                               │  │
    │  └───────────────────────────────────────────────────────────────┘  │
    └─────────────────────────────────────────────────────────────────────┘


    ┌─────────┐         ┌─────────┐                             ┌─────────┐
    │ Delay   │         │ Impact  │                             │ New     │
    │ Notice  │────────▶│ Notify  │─────────── ? ──────────────▶│Schedule │
    │         │         │         │                             │         │
    │"Vessel  │         │"ETD now │                             │ TBD     │
    │ rolled" │         │ Jan 20" │                             │         │
    └─────────┘         └─────────┘                             └─────────┘
         │                   │                                       │
         ▼                   ▼                                       ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                       DELAY_CHAIN                                   │
    │  ┌───────────────────────────────────────────────────────────────┐  │
    │  │ trigger: "Vessel rolled"           status: ACTIVE             │  │
    │  │ impact: 7 days delay               awaiting: "new schedule"   │  │
    │  │ confidence: 80%                                               │  │
    │  └───────────────────────────────────────────────────────────────┘  │
    └─────────────────────────────────────────────────────────────────────┘
```

---

## 5. Attention Score Calculation

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          ATTENTION SCORE FORMULA                                 │
└─────────────────────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────────────┐
                    │        SHIPMENT DATA            │
                    └─────────────────┬───────────────┘
                                      │
        ┌─────────────────────────────┼─────────────────────────────┐
        │                             │                             │
        ▼                             ▼                             ▼
┌───────────────┐           ┌───────────────┐           ┌───────────────┐
│    ISSUES     │           │    ACTIONS    │           │   URGENCY     │
├───────────────┤           ├───────────────┤           ├───────────────┤
│               │           │               │           │               │
│ Active: +100  │           │ Pending: +10  │           │ ETD ≤1d: +75  │
│ Delay:  +50   │           │ Overdue: +40  │           │ ETD ≤3d: +50  │
│ Roll:   +60   │           │               │           │ ETD ≤7d: +25  │
│ Hold:   +40   │           │ Priority:     │           │               │
│ Damage: +45   │           │ Critical: +80 │           │ Cutoff:       │
│               │           │ High:     +40 │           │ Overdue: +100 │
│               │           │ Medium:   +20 │           │ ≤1d:     +60  │
│               │           │ Low:       +5 │           │ ≤3d:     +30  │
│               │           │               │           │               │
└───────┬───────┘           └───────┬───────┘           └───────┬───────┘
        │                           │                           │
        └───────────────────────────┼───────────────────────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   ACTIVITY DECAY    │
                         ├─────────────────────┤
                         │ >7 days stale: -40  │
                         │ >3 days stale: -20  │
                         └──────────┬──────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │      FINAL SCORE (0-300+)     │
                    └───────────────┬───────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            │                       │                       │
            ▼                       ▼                       ▼
    ┌───────────────┐       ┌───────────────┐       ┌───────────────┐
    │    STRONG     │       │    MEDIUM     │       │  WEAK/NOISE   │
    │    (60+)      │       │   (35-59)     │       │    (<35)      │
    ├───────────────┤       ├───────────────┤       ├───────────────┤
    │  RED          │       │  YELLOW       │       │  GRAY         │
    │  Immediate    │       │  Main View    │       │  Watchlist/   │
    │  Attention    │       │               │       │  Hidden       │
    └───────────────┘       └───────────────┘       └───────────────┘
```

---

## 6. Database Schema Relationships

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              DATABASE SCHEMA                                     │
└─────────────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│    shipments     │         │    chronicle     │         │  email_accounts  │
├──────────────────┤         ├──────────────────┤         ├──────────────────┤
│ id (PK)          │◀────────│ shipment_id (FK) │         │ id (PK)          │
│ booking_number   │         │ gmail_message_id │         │ email_address    │
│ mbl_number       │         │ thread_id        │────────▶│ last_history_id  │
│ stage            │         │ document_type    │         └──────────────────┘
│ direction        │         │ message_type     │
│ etd, eta         │         │ sentiment        │
│ si_cutoff        │         │ summary          │
│ vgm_cutoff       │         │ has_action       │
│ pol, pod         │         │ has_issue        │
│ vessel_name      │         │ ai_response      │
└────────┬─────────┘         └────────┬─────────┘
         │                            │
         │         ┌──────────────────┘
         │         │
         ▼         ▼
┌──────────────────────────────────┐
│   shipment_narrative_chains      │
├──────────────────────────────────┤
│ id (PK)                          │
│ shipment_id (FK)                 │
│ trigger_chronicle_id (FK)        │◀────┐
│ chain_type                       │     │
│ chain_status                     │     │
│ chain_events (JSONB)             │─────┼──── Contains chronicle IDs
│ narrative_headline               │     │
│ confidence_score                 │     │
│ resolution_deadline              │     │
└──────────────────────────────────┘     │
                                         │
┌──────────────────────────────────┐     │
│ stakeholder_interaction_summary  │     │
├──────────────────────────────────┤     │
│ id (PK)                          │     │
│ shipment_id (FK)                 │     │
│ party_type                       │     │
│ party_display_name               │     │
│ total_emails                     │     │
│ avg_response_time_hours          │     │
│ behavior_pattern                 │     │
│ recent_communications (JSONB)    │─────┘
└──────────────────────────────────┘

┌──────────────────────────────────┐
│     shipment_story_events        │
├──────────────────────────────────┤
│ id (PK)                          │
│ shipment_id (FK)                 │
│ source_type                      │
│ source_id (FK to chronicle)      │
│ narrative_chain_id (FK)          │
│ event_category                   │
│ event_headline                   │
│ importance                       │
│ is_key_moment                    │
└──────────────────────────────────┘
```

---

## 7. UI Progressive Disclosure

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                            LEVEL 1: SHIPMENT LIST                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │ [!] 85  MSKU123456789  │  Shanghai → Los Angeles  │  ETD: Jan 15       │    │
│  │        MBL: 987654321 │  COSCO SHIPPING VENUS    │  3 issues, 2 actions│    │
│  │        ──────────────────────────────────────────────────────────────── │    │
│  │        AI: "Cargo on hold at customs. SI deadline tomorrow."           │    │
│  │        → Recommend: Escalate to customs broker immediately             │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│                                      │                                           │
│                                      │ Click                                     │
│                                      ▼                                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                          LEVEL 2: SHIPMENT DETAIL                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─ PARTIES ────────────────────┐  ┌─ SCHEDULE ─────────────────────────────┐  │
│  │ Shipper: ABC Trading Co      │  │ ETD: Jan 15, 2025                      │  │
│  │ Consignee: XYZ Imports       │  │ ETA: Feb 02, 2025                      │  │
│  │ Notify: Customs Broker Inc   │  │ SI Cutoff: Jan 13 [!] OVERDUE         │  │
│  └──────────────────────────────┘  │ VGM Cutoff: Jan 14                     │  │
│                                     └────────────────────────────────────────┘  │
│  ┌─ ISSUES ─────────────────────┐  ┌─ ACTIONS ──────────────────────────────┐  │
│  │ [!] Cargo Hold - Customs     │  │ [ ] Submit SI - Due Jan 13 (OVERDUE)   │  │
│  │ [~] Documentation Missing    │  │ [ ] VGM Declaration - Due Jan 14       │  │
│  │ [~] Rollover Risk            │  │ [x] Booking Confirmed - Jan 10         │  │
│  └──────────────────────────────┘  └─────────────────────────────────────────┘  │
│                                                                                  │
│  ┌─ DOCUMENT TIMELINE ──────────────────────────────────────────────────────┐   │
│  │  Jan 10      Jan 11      Jan 12      Jan 13                              │   │
│  │    │           │           │           │                                 │   │
│  │    ●───────────●───────────●───────────●                                 │   │
│  │ Booking    SI Request   Hold Notice  Follow-up                           │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                      │                                           │
│                                      │ Click document                            │
│                                      ▼                                           │
├─────────────────────────────────────────────────────────────────────────────────┤
│                          LEVEL 3: DOCUMENT DETAIL                               │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌─ EMAIL ──────────────────────────────────────────────────────────────────┐   │
│  │ From: customs@broker.com                                                 │   │
│  │ Subject: RE: MSKU123456789 - Cargo Hold Notice                          │   │
│  │ Date: Jan 12, 2025 14:32                                                 │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
│  ┌─ CLASSIFICATION ───────────────┐  ┌─ EXTRACTED FIELDS ──────────────────┐   │
│  │ Document: Hold Notice          │  │ Container: MSKU1234567              │   │
│  │ Message: Issue Notification    │  │ Hold Reason: Missing Documentation  │   │
│  │ Sentiment: Negative            │  │ Required Action: Submit Form 7501   │   │
│  │ Direction: Inbound             │  │ Deadline: Jan 14, 2025              │   │
│  └────────────────────────────────┘  └──────────────────────────────────────┘   │
│                                                                                  │
│  ┌─ ATTACHMENTS ────────────────────────────────────────────────────────────┐   │
│  │ [pdf] hold_notice.pdf (OCR extracted)              [Download]            │   │
│  └──────────────────────────────────────────────────────────────────────────┘   │
│                                                                                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. Shipment Lifecycle Stages

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          SHIPMENT LIFECYCLE                                      │
└─────────────────────────────────────────────────────────────────────────────────┘

    ORIGIN PHASE                    IN-TRANSIT PHASE              DESTINATION PHASE
    ════════════                    ════════════════              ═════════════════

┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
│ PENDING │──▶│ BOOKED  │──▶│SI_SUBMIT│──▶│BL_ISSUED│──▶│ DEPARTED│──▶│ ARRIVED │
└─────────┘   └─────────┘   └─────────┘   └─────────┘   └─────────┘   └─────────┘
     │             │             │             │             │             │
     │             │             │             │             │             │
     ▼             ▼             ▼             ▼             ▼             ▼
┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐
│ Inquiry │   │Booking  │   │   SI    │   │   BL    │   │ Vessel  │   │ Arrival │
│ Email   │   │Confirm  │   │Document │   │Document │   │Departed │   │ Notice  │
└─────────┘   └─────────┘   └─────────┘   └─────────┘   └─────────┘   └─────────┘


    Document Types by Stage:
    ┌─────────────────────────────────────────────────────────────────────────┐
    │ ORIGIN         │ booking_confirmation, si_request, vgm_declaration     │
    │ IN-TRANSIT     │ bill_of_lading, departure_notice, vessel_schedule     │
    │ DESTINATION    │ arrival_notice, delivery_order, customs_release       │
    └─────────────────────────────────────────────────────────────────────────┘


    AI Summary Stage-Awareness:
    ┌─────────────────────────────────────────────────────────────────────────┐
    │ Stage: PENDING/BOOKED  │ Show: SI patterns, cutoff risks               │
    │ Stage: SI_SUBMITTED    │ Show: BL risks, amendment patterns            │
    │ Stage: BL_ISSUED       │ Hide: SI issues (already past)                │
    │ Stage: DEPARTED        │ Show: ETA changes, rollover history           │
    │ Stage: ARRIVED         │ Show: Detention, demurrage, customs           │
    └─────────────────────────────────────────────────────────────────────────┘
```

---

## 9. Cron Job Schedule

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              CRON SCHEDULE                                       │
└─────────────────────────────────────────────────────────────────────────────────┘

    TIME  │  0min     5min    15min    30min    45min    60min
    ──────┼──────────────────────────────────────────────────────
          │
    FETCH │  ●─────────●─────────●─────────●─────────●─────────●
    EMAILS│  └─ Every 5-15 minutes ─┘
          │
          │
  PROCESS │  ●───────────────────────────────●───────────────────
   EMAILS │  └─ Every 30 minutes ─┘
          │
          │
  EXTRACT │  ●───────────────────────────────────────────────────●
   ATTACH │  └─ Every 60 minutes ─┘
          │
          │
       AI │  ●───────────────────────────────────────────────────────────────●
 SUMMARIES│  └─ Every 120 minutes ─┘
          │

    ┌─────────────────────────────────────────────────────────────────────────┐
    │ CRON                          │ PURPOSE                                 │
    ├─────────────────────────────────────────────────────────────────────────┤
    │ /api/cron/fetch-emails        │ Ingest new emails from Gmail           │
    │ /api/cron/process-emails      │ AI analysis + shipment linking         │
    │ /api/cron/extract-attachments │ PDF text extraction                    │
    │ /api/cron/generate-ai-summaries│ Haiku narrative summaries             │
    └─────────────────────────────────────────────────────────────────────────┘
```

---

## 10. API Request Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           API REQUEST FLOW                                       │
└─────────────────────────────────────────────────────────────────────────────────┘

    Browser                    Next.js API                    Services
    ═══════                    ══════════                    ════════

       │                           │                            │
       │  GET /shipments?          │                            │
       │  direction=export&        │                            │
       │  phase=origin             │                            │
       │ ─────────────────────────▶│                            │
       │                           │                            │
       │                           │  buildAttentionComponents()│
       │                           │ ──────────────────────────▶│
       │                           │                            │
       │                           │◀─ AttentionComponents ─────│
       │                           │                            │
       │                           │  calculateAttentionScore() │
       │                           │ ──────────────────────────▶│
       │                           │                            │
       │                           │◀─ Score + SignalTier ──────│
       │                           │                            │
       │                           │  Query Supabase            │
       │                           │ ──────────────────────────▶│ DB
       │                           │                            │
       │                           │◀─ Shipment rows ───────────│
       │                           │                            │
       │◀─ ShipmentListItem[] ─────│                            │
       │                           │                            │


       │                           │                            │
       │  GET /shipments/:id/story │                            │
       │ ─────────────────────────▶│                            │
       │                           │                            │
       │                           │  ShipmentStoryService      │
       │                           │  .getShipmentStory()       │
       │                           │ ──────────────────────────▶│
       │                           │                            │
       │                           │    ┌─ NarrativeChains      │
       │                           │    ├─ Stakeholders         │
       │                           │    ├─ StoryEvents          │
       │                           │    └─ Recommendations      │
       │                           │                            │
       │                           │◀─ ShipmentStory ───────────│
       │                           │                            │
       │◀─ Full story response ────│                            │
       │                           │                            │
```

---

## 11. Directory Structure

```
lib/
├── chronicle/                          # V1 - Email processing
│   ├── chronicle-service.ts           # Main orchestrator (760 lines)
│   ├── chronicle-repository.ts        # Data access
│   ├── gmail-service.ts               # Gmail API
│   ├── ai-analyzer.ts                 # Claude AI
│   ├── pdf-extractor.ts               # PDF text extraction
│   ├── types.ts                       # Zod schemas
│   └── prompts/freight-forwarder.prompt.ts
│
├── chronicle-v2/                       # V2 - Intelligence dashboard
│   ├── services/
│   │   ├── narrative-chain-service.ts      # Cause-effect chains (800 lines)
│   │   ├── shipment-story-service.ts       # Story assembly (800 lines)
│   │   ├── stakeholder-analysis-service.ts # Party behavior
│   │   └── haiku-summary-service.ts        # AI summaries
│   ├── attention-score.ts             # Signal tier calculation
│   ├── types.ts                       # V2 type system
│   └── constants.ts                   # Scoring weights

app/api/
├── chronicle/                          # V1 REST API
│   ├── [id]/route.ts
│   ├── dashboard/route.ts
│   └── shipments/[id]/route.ts
│
├── chronicle-v2/                       # V2 REST API
│   ├── shipments/route.ts
│   ├── shipments/[id]/route.ts
│   ├── shipments/[id]/story/route.ts
│   ├── shipments/[id]/chains/route.ts
│   └── shipments/[id]/stakeholders/route.ts
│
└── cron/
    ├── fetch-emails/route.ts
    ├── process-emails/route.ts
    ├── extract-attachments/route.ts
    └── generate-ai-summaries/route.ts

components/
├── chronicle/                          # V1 Components
└── chronicle-v2/                       # V2 Components
    ├── ShipmentCard.tsx
    ├── ShipmentStoryPanel.tsx
    ├── NarrativeChainCard.tsx
    ├── DocumentTimeline.tsx
    └── ChainOfThoughtPanel.tsx
```

---

## 12. Key Design Patterns

| Pattern | Implementation |
|---------|----------------|
| **Deep Modules** | Simple `processEmail()` hides 6 internal responsibilities |
| **Interface-Based** | `IGmailService`, `IPdfExtractor`, `IAiAnalyzer`, `IChronicleRepository` |
| **Idempotency** | Check `gmail_message_id` before processing, UNIQUE constraint |
| **Configuration Over Code** | Weights, phases in constants, not hardcoded |
| **Fail Fast** | Zod validation, throw on missing required fields |
| **SRP** | Each service has single responsibility |
| **Layered Architecture** | API Routes → Services → Repositories → External Clients |

---

## 13. Core Tables Summary

| Table | Purpose |
|-------|---------|
| `chronicle` | Raw AI-extracted intelligence from emails |
| `shipments` | Shipment records with stage tracking |
| `shipment_narrative_chains` | Cause-effect relationships |
| `stakeholder_interaction_summary` | Party behavior metrics |
| `shipment_story_events` | Unified timeline events |
| `email_accounts` | Gmail sync state |

---

## 14. Signal Tier Summary

| Tier | Score | Color | Action |
|------|-------|-------|--------|
| Strong | 60+ | Red | Immediate attention |
| Medium | 35-59 | Yellow | Main view |
| Weak | 15-34 | Gray | Watchlist |
| Noise | <15 | Hidden | Auto-filtered |

---

*Generated: January 2025*
*Version: Chronicle V2*
