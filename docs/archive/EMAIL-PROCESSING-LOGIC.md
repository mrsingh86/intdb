# Email Processing Logic: Classification, Direction & Workflow State

## Overview Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EMAIL ARRIVES                                      │
│                    (Gmail → raw_emails table)                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: DIRECTION DETECTION                                                  │
│ File: lib/utils/direction-detector.ts                                        │
│                                                                              │
│  Input: sender_email, subject                                                │
│  Output: 'inbound' | 'outbound'                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: DOCUMENT CLASSIFICATION                                              │
│ File: lib/services/unified-classification-service.ts                         │
│                                                                              │
│  Input: subject, body, attachments, sender                                   │
│  Output: document_type (e.g., 'booking_confirmation', 'arrival_notice')     │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 3: WORKFLOW STATE MAPPING                                               │
│ File: lib/services/workflow-state-service.ts                                 │
│                                                                              │
│  Input: document_type + direction                                            │
│  Output: workflow_state (e.g., 'booking_confirmation_received')             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## STEP 1: Direction Detection

### Decision Tree

```
                    ┌──────────────────┐
                    │  sender_email    │
                    └────────┬─────────┘
                             │
              ┌──────────────┴──────────────┐
              │ Contains " via " ?          │
              └──────────────┬──────────────┘
                    ┌────────┴────────┐
                   YES               NO
                    │                 │
                    ▼                 ▼
              ┌─────────┐    ┌───────────────────────┐
              │ INBOUND │    │ Is @intoglo.com/.in?  │
              └─────────┘    └───────────┬───────────┘
                                ┌────────┴────────┐
                               YES               NO
                                │                 │
                                ▼                 ▼
                    ┌───────────────────┐   ┌─────────┐
                    │ Check Subject     │   │ INBOUND │
                    │ Patterns          │   │ (carrier│
                    └─────────┬─────────┘   │  client)│
                              │             └─────────┘
              ┌───────────────┴───────────────┐
              │ Is Reply? (Re:/Fwd:)          │
              └───────────────┬───────────────┘
                     ┌────────┴────────┐
                    YES               NO
                     │                 │
                     ▼                 ▼
              ┌──────────┐   ┌─────────────────────────┐
              │ OUTBOUND │   │ Check Carrier BC        │
              │ (Intoglo │   │ Subject Patterns        │
              │  reply)  │   └────────────┬────────────┘
              └──────────┘                │
                              ┌───────────┴───────────┐
                              │ Matches Carrier BC?   │
                              └───────────┬───────────┘
                                 ┌────────┴────────┐
                                YES               NO
                                 │                 │
                                 ▼                 ▼
                           ┌─────────┐      ┌──────────┐
                           │ INBOUND │      │ OUTBOUND │
                           │ (carrier│      │ (Intoglo │
                           │  forward)│     │  sent)   │
                           └─────────┘      └──────────┘
```

### Carrier BC Subject Patterns (mark as INBOUND even from ops@intoglo.com)

| Pattern | Example | Carrier |
|---------|---------|---------|
| `/^booking\s+(confirmation\|amendment)\s*:/i` | "Booking Confirmation : 263825330" | Maersk |
| `/^cosco\s+shipping\s+line\s+booking\s+confirmation/i` | "Cosco Shipping Line Booking Confirmation - COSU..." | COSCO |
| `/^cma\s*cgm\s*-\s*booking\s+confirmation\s+available/i` | "CMA CGM - Booking confirmation available" | CMA CGM |

### NOT a Carrier BC Pattern (stays OUTBOUND)

| Pattern | Example | Document Type |
|---------|---------|---------------|
| "Price overview - booking confirmation" | "Price overview - booking confirmation : 263561496" | **rate_quote** (NOT BC) |

### Other INBOUND Patterns from Intoglo Senders

| Pattern | Sender | Example |
|---------|--------|---------|
| `/iris/i` in sender + `/booking\s*confirm/i` in subject | COSCO IRIS system | iris@intoglo.com |
| `/\bODeX:/i` in subject | ODeX platform | Any sender |

### Carrier Sender Domains (always INBOUND)

```
maersk.com, sealand.com, hapag-lloyd.com, hlag.com, hlag.cloud,
cma-cgm.com, apl.com, coscon.com, oocl.com, msc.com,
evergreen-line.com, one-line.com, yangming.com, zim.com
```

---

## STEP 2: Document Classification

### Priority Order

```
┌─────────────────────────────────────────────────────────────────┐
│  PRIORITY 1: Attachment Filename Patterns (95% confidence)     │
│  ─────────────────────────────────────────────────────────────  │
│  Examples:                                                      │
│  • "BOOKING_CONFIRMATION_*.pdf" → booking_confirmation          │
│  • "*INVOICE*.pdf" → invoice                                    │
│  • "*BL*.pdf" → bill_of_lading                                  │
└─────────────────────────────────────────────────────────────────┘
                              │ No match
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PRIORITY 2: Body Content Indicators (90% confidence)           │
│  ─────────────────────────────────────────────────────────────  │
│  Examples:                                                      │
│  • "SHIPPED ON BOARD" in body → sob_confirmation                │
│  • "ARRIVAL NOTICE" in body → arrival_notice                    │
└─────────────────────────────────────────────────────────────────┘
                              │ No match
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PRIORITY 3: Subject Line Patterns (85-95% confidence)          │
│  ─────────────────────────────────────────────────────────────  │
│  See Subject Pattern Table below                                │
└─────────────────────────────────────────────────────────────────┘
                              │ No match
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PRIORITY 4: Carrier-Specific Patterns                          │
│  ─────────────────────────────────────────────────────────────  │
│  File: lib/config/shipping-line-patterns.ts                     │
│  Each carrier has unique patterns for BC, AN, BL, etc.          │
└─────────────────────────────────────────────────────────────────┘
                              │ No match
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PRIORITY 5: Intoglo/Partner Patterns                           │
│  ─────────────────────────────────────────────────────────────  │
│  • Outbound: Intoglo-specific subject patterns                  │
│  • Inbound: Partner (CHA, broker) patterns                      │
└─────────────────────────────────────────────────────────────────┘
                              │ No match
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  PRIORITY 6: AI Fallback (Claude Sonnet)                        │
│  ─────────────────────────────────────────────────────────────  │
│  Used only when deterministic patterns fail                     │
│  Uses structured tool_use for reliable output                   │
└─────────────────────────────────────────────────────────────────┘
                              │ No match
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  DEFAULT: general_correspondence                                 │
│  needsManualReview: true                                         │
└─────────────────────────────────────────────────────────────────┘
```

### Subject Pattern Table (Selected Examples)

| Pattern | Document Type | Confidence |
|---------|---------------|------------|
| `/\bSOB\s+CONFIRM/i` | sob_confirmation | 95% |
| `/\bshipped\s+on\s+board/i` | sob_confirmation | 95% |
| `/\barrival\s+notice\b/i` | arrival_notice | 95% |
| `/\bHBL\s+DRAFT/i` | hbl_draft | 95% |
| `/\bSI\s+draft/i` | si_draft | 95% |
| `/\bbill\s+of\s+lading\b/i` | bill_of_lading | 95% |
| `/\bbooking.*cancel/i` | booking_cancellation | 95% |
| `/\b(1st\|2nd\|3rd\|\d+th)\s+UPDATE\b/i` | booking_amendment | 95% |
| `/^Booking\s+Confirmation\s*:/i` | booking_confirmation | 90% |
| `/\bdelivery\s+order\b/i` | delivery_order | 95% |
| `/\bVGM\s+(confirm\|submit)/i` | vgm_confirmation | 95% |
| `/\bprice\s+overview\b/i` | **rate_quote** | 90% |
| `/\bchecklist\s+(attached\|for)/i` | checklist | 95% |
| `/\bshipping\s+bill\s+(copy\|number)/i` | shipping_bill | 95% |
| `/\bLEO\s+(copy\|attached)/i` | leo_copy | 95% |
| `/\bdraft\s+entry/i` | draft_entry | 95% |
| `/\bentry\s+summary/i` | entry_summary | 95% |
| `/\bduty\s+invoice/i` | duty_invoice | 95% |

---

## STEP 3: Workflow State Mapping

### The Formula

```
workflow_state = MAPPING[document_type + ":" + direction]
```

### Complete Mapping Table

#### PRE_DEPARTURE Phase

| Document Type | Direction | Workflow State |
|--------------|-----------|----------------|
| booking_confirmation | inbound | `booking_confirmation_received` |
| booking_confirmation | outbound | `booking_confirmation_shared` |
| booking_amendment | inbound | `booking_confirmation_received` |
| booking_amendment | outbound | `booking_confirmation_shared` |
| booking_cancellation | inbound | `booking_cancelled` |
| invoice | inbound | `commercial_invoice_received` |
| commercial_invoice | inbound | `commercial_invoice_received` |
| packing_list | inbound | `packing_list_received` |
| si_draft | inbound | `si_draft_received` |
| si_draft | outbound | `si_draft_sent` |
| shipping_instruction | inbound | `si_draft_received` |
| shipping_instruction | outbound | `si_draft_sent` |
| si_submission | inbound/outbound | `si_confirmed` |
| si_confirmation | inbound/outbound | `si_confirmed` |
| checklist | inbound | `checklist_received` |
| checklist | outbound | `checklist_shared` |
| shipping_bill | inbound | `shipping_bill_received` |
| leo_copy | inbound | `shipping_bill_received` |
| vgm_submission | inbound | `vgm_confirmed` |
| vgm_submission | outbound | `vgm_submitted` |
| vgm_confirmation | inbound | `vgm_confirmed` |
| vgm_reminder | inbound | `vgm_pending` |
| gate_in_confirmation | inbound | `container_gated_in` |
| sob_confirmation | inbound | `sob_received` |
| departure_notice | inbound | `vessel_departed` |

#### IN_TRANSIT Phase

| Document Type | Direction | Workflow State |
|--------------|-----------|----------------|
| isf_submission | outbound | `isf_filed` |
| isf_confirmation | inbound | `isf_confirmed` |
| mbl_draft | inbound | `mbl_draft_received` |
| bill_of_lading | inbound | `bl_received` |
| bill_of_lading | outbound | `hbl_shared` |
| hbl_draft | outbound | `hbl_draft_sent` |
| hbl_release | outbound | `hbl_released` |
| house_bl | outbound | `hbl_released` |
| freight_invoice | outbound | `invoice_sent` |
| invoice | outbound | `invoice_sent` |
| payment_confirmation | inbound | `invoice_paid` |

#### PRE_ARRIVAL Phase (US Customs)

| Document Type | Direction | Workflow State |
|--------------|-----------|----------------|
| draft_entry | inbound | `entry_draft_received` |
| draft_entry | outbound | `entry_draft_shared` |
| entry_summary | inbound | `entry_summary_received` |
| entry_summary | outbound | `entry_summary_shared` |

#### ARRIVAL Phase

| Document Type | Direction | Workflow State |
|--------------|-----------|----------------|
| arrival_notice | inbound | `arrival_notice_received` |
| arrival_notice | outbound | `arrival_notice_shared` |
| shipment_notice | inbound | `arrival_notice_received` |
| customs_clearance | inbound/outbound | `customs_cleared` |
| customs_document | inbound | `duty_invoice_received` |
| duty_invoice | inbound | `duty_invoice_received` |
| duty_invoice | outbound | `duty_summary_shared` |
| customs_document | outbound | `duty_summary_shared` |
| exam_notice | inbound | `customs_hold` |
| delivery_order | inbound | `delivery_order_received` |
| delivery_order | outbound | `delivery_order_shared` |

#### DELIVERY Phase

| Document Type | Direction | Workflow State |
|--------------|-----------|----------------|
| container_release | inbound | `container_released` |
| dispatch_notice | inbound | `out_for_delivery` |
| delivery_confirmation | inbound | `delivered` |
| pod | inbound | `pod_received` |
| proof_of_delivery | inbound | `pod_received` |
| empty_return | inbound | `empty_returned` |

---

## Visual Flow: Booking Confirmation Example

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ EMAIL: "Booking Confirmation : 263825330"                                    │
│ FROM: ops@intoglo.com                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: DIRECTION DETECTION                                                  │
│                                                                              │
│ Q: Is sender @intoglo.com? → YES                                            │
│ Q: Is it a reply (Re:/Fwd:)? → NO                                           │
│ Q: Does subject match carrier BC pattern?                                    │
│    Pattern: /^booking\s+(confirmation|amendment)\s*:/i                       │
│    Subject: "Booking Confirmation : 263825330" → MATCH!                      │
│                                                                              │
│ RESULT: INBOUND (carrier forward via ops@intoglo.com)                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: DOCUMENT CLASSIFICATION                                              │
│                                                                              │
│ Priority 3: Subject Pattern Match                                            │
│ Pattern: /^Booking\s+Confirmation\s*:/i                                      │
│                                                                              │
│ RESULT: document_type = 'booking_confirmation'                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 3: WORKFLOW STATE MAPPING                                               │
│                                                                              │
│ Key: "booking_confirmation:inbound"                                          │
│                                                                              │
│ RESULT: workflow_state = 'booking_confirmation_received'                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ FINAL OUTPUT                                                                 │
│                                                                              │
│ {                                                                            │
│   direction: "inbound",                                                      │
│   document_type: "booking_confirmation",                                     │
│   workflow_state: "booking_confirmation_received"                            │
│ }                                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Visual Flow: Price Overview Example (NOT a BC!)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ EMAIL: "Price overview - booking confirmation : 263561496"                   │
│ FROM: ops@intoglo.com                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: DIRECTION DETECTION                                                  │
│                                                                              │
│ Q: Is sender @intoglo.com? → YES                                            │
│ Q: Is it a reply (Re:/Fwd:)? → NO                                           │
│ Q: Does subject match carrier BC pattern?                                    │
│    Pattern: /^booking\s+(confirmation|amendment)\s*:/i                       │
│    Subject: "Price overview - booking..." → NO MATCH (starts with "Price")  │
│                                                                              │
│ RESULT: OUTBOUND (no carrier pattern match)                                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: DOCUMENT CLASSIFICATION                                              │
│                                                                              │
│ Priority 3: Subject Pattern Match                                            │
│ Pattern: /\bprice\s+overview\b/i → MATCH!                                   │
│                                                                              │
│ RESULT: document_type = 'rate_quote'                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 3: WORKFLOW STATE MAPPING                                               │
│                                                                              │
│ Key: "rate_quote:outbound" → NO MAPPING                                     │
│                                                                              │
│ RESULT: workflow_state = null (rate quotes don't trigger workflow)          │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ FINAL OUTPUT                                                                 │
│                                                                              │
│ {                                                                            │
│   direction: "outbound",                                                     │
│   document_type: "rate_quote",                                               │
│   workflow_state: null         ← Does NOT count in BC Received/Shared       │
│ }                                                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key Insights

### 1. Direction Detection Priority
```
1. " via " in sender → INBOUND (Google Groups forward)
2. Not @intoglo.com/in → INBOUND (carrier/client)
3. Reply (Re:/Fwd:) from Intoglo → OUTBOUND
4. Carrier BC pattern from ops@/pricing@ → INBOUND
5. Default for @intoglo.com → OUTBOUND
```

### 2. What Changes BC Received vs BC Shared Count?

| Email Type | Direction | Counts As |
|------------|-----------|-----------|
| Carrier BC from maersk.com | inbound | BC Received |
| Carrier BC via ops@intoglo.com (forwarded) | inbound | BC Received |
| Intoglo sharing BC with customer | outbound | BC Shared |
| Intoglo reply to BC thread | outbound | BC Shared |
| **Price overview** (rate_quote) | outbound | **Neither** |
| **Price overview** (rate_quote) | inbound | **Neither** |

### 3. Documents That DON'T Trigger Workflow States
- `rate_quote` - Pricing documents
- `general_correspondence` - General emails
- `vessel_schedule` - Schedule only, no action
- Documents without matching direction in mapping table

---

## Database Tables Involved

```
raw_emails
├── id
├── sender_email
├── subject
├── email_direction ← SET BY direction-detector.ts
└── ...

document_classifications
├── email_id
├── document_type ← SET BY unified-classification-service.ts
├── confidence_score
└── ...

shipment_documents
├── email_id
├── shipment_id
├── document_type
└── ...

shipments
├── id
├── workflow_state ← SET BY workflow-state-service.ts
├── workflow_phase
└── ...
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `lib/utils/direction-detector.ts` | Direction detection (inbound/outbound) |
| `lib/services/unified-classification-service.ts` | Document type classification |
| `lib/services/workflow-state-service.ts` | Workflow state transitions |
| `lib/config/shipping-line-patterns.ts` | Carrier-specific patterns |
| `lib/config/attachment-patterns.ts` | Attachment filename patterns |
| `lib/config/body-indicators.ts` | Body content indicators |
| `lib/config/intoglo-patterns.ts` | Outbound email patterns |
| `lib/config/partner-patterns.ts` | Partner (CHA/broker) patterns |

---

*Last Updated: January 2025*
