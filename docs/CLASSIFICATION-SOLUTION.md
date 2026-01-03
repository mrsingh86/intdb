# Comprehensive Document Classification Solution

## Current State Analysis

### What Works Well
1. **Deterministic patterns** (`lib/config/shipping-line-patterns.ts`) - Only for carrier emails
2. **Carrier detection** via sender domains (maersk.com, hapag-lloyd.com, etc.)
3. **PDF content validation** for booking confirmations

### Core Problems Identified

| Problem | Root Cause | Impact |
|---------|-----------|--------|
| **Direction detection fails on forwarded emails** | `ops@intoglo.com` forwards carrier emails → detected as OUTBOUND | BC from Maersk shows as "shared" not "received" |
| **Proforma BL classified wrong** | `bill_of_lading` type used for both draft and final | Proforma BL → `hbl_released` instead of `mbl_draft_received` |
| **Thread navigation confusion** | RE:/FW: prefixes treated as correspondence | Important forwarded docs ignored |
| **Simple isIntoglo() check** | Only checks sender domain, ignores content | Forwarded carrier emails misclassified |

---

## Architecture: Three-Layer Classification

```
┌─────────────────────────────────────────────────────────────────────────┐
│ LAYER 1: SENDER-BASED ROUTING                                           │
│ ─────────────────────────────────────────────────────────────────────── │
│ Question: "Is this FROM a shipping carrier?"                            │
│                                                                         │
│ Check Order:                                                            │
│ 1. Direct carrier sender (from @maersk.com, @hapag-lloyd.com)          │
│ 2. Forwarded carrier email (ops@intoglo.com + carrier content)         │
│ 3. Reply thread with carrier (check thread history)                     │
│                                                                         │
│ Output: { isCarrierEmail: boolean, carrier: string, direction: string } │
└─────────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ LAYER 2: DETERMINISTIC PATTERN MATCHING                                 │
│ ─────────────────────────────────────────────────────────────────────── │
│ ONLY for verified carrier emails (from Layer 1)                         │
│                                                                         │
│ Patterns by carrier (shipping-line-patterns.ts):                        │
│ • Subject line patterns with regex                                      │
│ • PDF filename patterns                                                 │
│ • PDF content patterns (BOOKING CONFIRMATION heading)                   │
│                                                                         │
│ Output: { documentType, confidence: 100, verified: true }               │
└─────────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ LAYER 3: AI CLASSIFICATION (Fallback)                                   │
│ ─────────────────────────────────────────────────────────────────────── │
│ For non-carrier emails OR unmatched carrier patterns                    │
│                                                                         │
│ Model: Claude Sonnet 4 with structured output                           │
│ Few-shot examples per document type                                     │
│ Confidence threshold: 80%+                                              │
│                                                                         │
│ Output: { documentType, confidence, reasoning }                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Solution 1: Enhanced Direction Detection

### Problem
Current `isIntoglo(sender)` check is too simple. When `ops@intoglo.com` forwards a Maersk email, it's marked OUTBOUND but should be INBOUND.

### Solution: Content-Based Direction Detection

```typescript
/**
 * Enhanced direction detection for freight emails
 *
 * RULES:
 * 1. If sender is carrier domain → INBOUND (always)
 * 2. If sender is @intoglo.com → check content:
 *    a. Body starts with "---------- Forwarded message" → check original sender
 *    b. Body contains carrier signature → INBOUND (forwarded carrier email)
 *    c. Subject matches carrier pattern → INBOUND
 *    d. Otherwise → OUTBOUND
 * 3. If sender is client/shipper → INBOUND
 */

interface DirectionResult {
  direction: 'inbound' | 'outbound';
  originalSender?: string;      // For forwarded emails
  isForwarded: boolean;
  carrierDetected?: string;
  confidence: number;           // 0-100
  method: 'sender_domain' | 'content_analysis' | 'header_extraction' | 'default';
}

function detectDirection(email: {
  senderEmail: string;
  subject: string;
  bodyText: string;
  headers?: Record<string, string>;
}): DirectionResult {
  const sender = email.senderEmail.toLowerCase();

  // 1. Direct carrier sender
  if (isCarrierDomain(sender)) {
    return {
      direction: 'inbound',
      isForwarded: false,
      carrierDetected: detectCarrier(sender),
      confidence: 100,
      method: 'sender_domain'
    };
  }

  // 2. Intoglo sender - need content analysis
  if (isIntogloDomain(sender)) {
    // 2a. Check for forwarded message markers
    const forwardedMatch = email.bodyText.match(
      /---------- Forwarded message ---------\s*From:\s*([^\n]+)/i
    );
    if (forwardedMatch) {
      const originalSender = extractEmail(forwardedMatch[1]);
      if (isCarrierDomain(originalSender)) {
        return {
          direction: 'inbound',
          originalSender,
          isForwarded: true,
          carrierDetected: detectCarrier(originalSender),
          confidence: 95,
          method: 'content_analysis'
        };
      }
    }

    // 2b. Check body for carrier signatures
    const carrierSignature = detectCarrierSignature(email.bodyText);
    if (carrierSignature) {
      return {
        direction: 'inbound',
        isForwarded: true,
        carrierDetected: carrierSignature,
        confidence: 85,
        method: 'content_analysis'
      };
    }

    // 2c. Check subject for carrier patterns
    if (isCarrierSubjectPattern(email.subject)) {
      return {
        direction: 'inbound',
        isForwarded: true,
        confidence: 80,
        method: 'content_analysis'
      };
    }

    // 2d. Default: Intoglo sender = OUTBOUND
    return {
      direction: 'outbound',
      isForwarded: false,
      confidence: 90,
      method: 'sender_domain'
    };
  }

  // 3. External sender (client/shipper) = INBOUND
  return {
    direction: 'inbound',
    isForwarded: false,
    confidence: 90,
    method: 'sender_domain'
  };
}

// Carrier signature patterns in email body
const CARRIER_BODY_SIGNATURES = [
  /MAERSK\s+LINE/i,
  /HAPAG-LLOYD/i,
  /CMA\s+CGM/i,
  /COSCO\s+SHIPPING/i,
  /MSC\s+MEDITERRANEAN/i,
  /ONE\s+LINE|Ocean\s+Network\s+Express/i,
  /EVERGREEN\s+LINE/i,
  /YANG\s+MING/i,
  /www\.maersk\.com/i,
  /www\.hapag-lloyd\.com/i,
  /www\.cma-cgm\.com/i,
];

function detectCarrierSignature(bodyText: string): string | null {
  for (const [pattern, carrier] of [
    [/MAERSK/i, 'maersk'],
    [/HAPAG-LLOYD|HLAG/i, 'hapag-lloyd'],
    [/CMA\s*CGM/i, 'cma-cgm'],
    [/COSCO|COSCON/i, 'cosco'],
    [/MSC\s+MEDITERRANEAN/i, 'msc'],
  ]) {
    if ((pattern as RegExp).test(bodyText)) {
      return carrier as string;
    }
  }
  return null;
}
```

---

## Solution 2: MBL Draft vs HBL Draft Distinction

### Problem
"Proforma Bill of Lading" from COSCO is classified as `bill_of_lading` → maps to wrong workflow state.

### Document Type Clarification

| Term | What It Is | Who Sends | Document Type | Workflow State |
|------|-----------|-----------|---------------|----------------|
| **Proforma BL** | Draft MBL for review | Carrier → FF | `mbl_draft` | `mbl_draft_received` |
| **Copy BL** | Final MBL | Carrier → FF | `bill_of_lading` | `mbl_received` |
| **Draft HBL** | House BL for shipper approval | FF → Shipper | `hbl_draft` | `hbl_draft_shared` |
| **HBL Release** | Final House BL | FF → Shipper | `bill_of_lading` | `hbl_released` |

### Pattern Updates Required

```typescript
// COSCO - Split Proforma from Copy
{
  documentType: 'mbl_draft',  // NEW: Changed from bill_of_lading
  subjectPatterns: [
    /^COSCON\s*-\s*Proforma Bill of Lading/i,
  ],
  senderPatterns: [/coscon\.com/i],
  requiresPdf: true,
  priority: 86,
  notes: 'Draft MBL from carrier for review - NOT final BL',
},
{
  documentType: 'bill_of_lading',  // Final/Copy BL
  subjectPatterns: [
    /^COSCON\s*-\s*Copy Bill of Lading/i,
    /^COSCON\s*-\s*Bill of Lading/i,  // Without Proforma/Copy prefix
  ],
  senderPatterns: [/coscon\.com/i],
  requiresPdf: true,
  priority: 85,
  notes: 'Final BL from carrier',
},
```

### Workflow State Mapping Updates

```typescript
// Add to DIRECTION_WORKFLOW_MAPPING
'mbl_draft:inbound': 'mbl_draft_received',      // Carrier sends draft MBL
'mbl_draft:outbound': 'mbl_draft_shared',       // FF shares with shipper (rare)
'hbl_draft:inbound': 'hbl_draft_received',      // Shipper returns approved draft
'hbl_draft:outbound': 'hbl_draft_shared',       // FF sends HBL for approval
```

---

## Solution 3: Thread Navigation for Forwarded Emails

### Problem
`RE:` and `FW:` prefixes are stripped and emails classified as `general_correspondence`.

### Solution: Original Subject Extraction

```typescript
/**
 * Extract original subject from forwarded/reply emails
 *
 * Input: "FW: RE: Booking Confirmation : 263522431"
 * Output: "Booking Confirmation : 263522431"
 */
function extractOriginalSubject(subject: string): string {
  // Remove RE:/FW:/Fwd: prefixes (multiple levels)
  return subject.replace(/^(RE|Re|FW|Fw|FWD|Fwd):\s*/g, '').trim();
}

/**
 * For classification, check BOTH original subject AND forwarded content
 */
function classifyWithThreadContext(email: Email): ClassificationResult {
  const originalSubject = extractOriginalSubject(email.subject);

  // Try classification with original subject
  let result = classifyEmail(originalSubject, email.senderEmail, email.attachments);

  // If still unclassified and body contains forwarded content,
  // extract and classify forwarded email
  if (!result || result.documentType === 'general_correspondence') {
    const forwardedContent = extractForwardedContent(email.bodyText);
    if (forwardedContent) {
      result = classifyEmail(
        forwardedContent.subject,
        forwardedContent.sender,
        email.attachments
      );
    }
  }

  return result;
}

interface ForwardedContent {
  sender: string;
  subject: string;
  body: string;
}

function extractForwardedContent(bodyText: string): ForwardedContent | null {
  // Gmail forward pattern
  const gmailMatch = bodyText.match(
    /---------- Forwarded message ---------\s*From:\s*([^\n]+)\s*Date:[^\n]*\s*Subject:\s*([^\n]+)/i
  );
  if (gmailMatch) {
    return {
      sender: extractEmail(gmailMatch[1]),
      subject: gmailMatch[2].trim(),
      body: bodyText.substring(gmailMatch.index || 0)
    };
  }

  // Outlook forward pattern
  const outlookMatch = bodyText.match(
    /From:\s*([^\n]+)\s*Sent:[^\n]*\s*To:[^\n]*\s*Subject:\s*([^\n]+)/i
  );
  if (outlookMatch) {
    return {
      sender: extractEmail(outlookMatch[1]),
      subject: outlookMatch[2].trim(),
      body: bodyText.substring(outlookMatch.index || 0)
    };
  }

  return null;
}
```

---

## Solution 4: Pattern Verification Process

### Current Issue
Patterns are added without verification. User identified wrong classifications that need correction.

### Verification Workflow

```
┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 1: Pattern Analysis Script                                         │
│ ─────────────────────────────────────────────────────────────────────── │
│ Input: Real emails from database                                        │
│ Output: Pattern candidates with sample matches                          │
│                                                                         │
│ Example:                                                                │
│ Subject: "COSCON - Proforma Bill of Lading for COSU6439083510"         │
│ Current: bill_of_lading                                                 │
│ Suggested: mbl_draft (Proforma = Draft)                                │
│ Samples: [email_id_1, email_id_2, email_id_3]                          │
└─────────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 2: User Review                                                     │
│ ─────────────────────────────────────────────────────────────────────── │
│ Present samples for each pattern                                        │
│ User confirms: "Yes, Proforma BL should be mbl_draft"                  │
│ User rejects: "No, this is actually final BL"                          │
└─────────────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ STEP 3: Apply Verified Patterns                                         │
│ ─────────────────────────────────────────────────────────────────────── │
│ Update shipping-line-patterns.ts                                        │
│ Update document_classifications table                                   │
│ Update shipment_documents table                                         │
│ Recalculate workflow states                                            │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Fix Direction Detection (HIGH PRIORITY)

**Files to modify:**
- `lib/services/workflow-state-service.ts` - Already has `getEmailDirection()`, enhance it
- `scripts/lib/supabase.ts` - Add `detectDirection()` helper
- `scripts/show-workflow-samples.ts` - Use enhanced direction detection

**Effort:** 2-3 hours

### Phase 2: Add MBL Draft Type (HIGH PRIORITY)

**Files to modify:**
- `lib/config/shipping-line-patterns.ts` - Add `mbl_draft` patterns for COSCO, Hapag, Maersk
- `lib/services/workflow-state-service.ts` - Add `mbl_draft` to DIRECTION_WORKFLOW_MAPPING
- `types/email-intelligence.ts` - Add `mbl_draft` to DocumentType union

**Effort:** 1-2 hours

### Phase 3: Thread Navigation (MEDIUM PRIORITY)

**Files to modify:**
- `lib/services/enhanced-classification-service.ts` - Add forwarded content extraction
- `lib/config/shipping-line-patterns.ts` - Modify `classifyEmail()` to use extracted subject

**Effort:** 2-3 hours

### Phase 4: Pattern Verification Script (MEDIUM PRIORITY)

**New files:**
- `scripts/verify-patterns.ts` - Interactive pattern verification
- `scripts/apply-verified-patterns.ts` - Apply verified changes

**Effort:** 3-4 hours

---

## Immediate Fixes Needed

Based on user feedback, these specific fixes are needed NOW:

### 1. COSCO Proforma BL

```typescript
// In shipping-line-patterns.ts, COSCO section
// CHANGE:
{
  documentType: 'bill_of_lading',
  subjectPatterns: [/^COSCON\s*-\s*(Proforma |Copy )?Bill of Lading/i],
  ...
}

// TO:
{
  documentType: 'mbl_draft',  // Proforma = Draft
  subjectPatterns: [/^COSCON\s*-\s*Proforma Bill of Lading/i],
  priority: 86,
  notes: 'Draft MBL from COSCO for review',
},
{
  documentType: 'bill_of_lading',  // Copy/Final
  subjectPatterns: [/^COSCON\s*-\s*(Copy )?Bill of Lading/i],
  priority: 85,
  notes: 'Final MBL from COSCO',
},
```

### 2. Direction Detection for Forwarded Emails

```typescript
// In scripts/lib/supabase.ts
// ADD new function:
export function detectDirection(
  senderEmail: string,
  subject: string,
  bodyText: string
): 'inbound' | 'outbound' {
  // 1. Direct carrier = INBOUND
  if (isCarrier(senderEmail)) {
    return 'inbound';
  }

  // 2. Intoglo sender with carrier subject pattern = INBOUND (forwarded)
  if (isIntoglo(senderEmail)) {
    const carrierSubjectPatterns = [
      /^Booking Confirmation/i,
      /^Arrival Notice/i,
      /^COSCON/i,
      /^CMA CGM/i,
      /^HL-\d+/i,           // Hapag booking
      /Bill of Lading/i,
      /Proforma/i,
    ];
    if (carrierSubjectPatterns.some(p => p.test(subject))) {
      return 'inbound';
    }

    // Check body for forwarded carrier content
    if (/From:.*@(maersk|hapag|cma-cgm|cosco|msc)/i.test(bodyText)) {
      return 'inbound';
    }

    return 'outbound';
  }

  // 3. External sender = INBOUND
  return 'inbound';
}
```

### 3. Arrival Notice Patterns

Need to investigate what actual arrival notices look like vs current samples.

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Workflow state mapped | 83.5% | 95%+ |
| Direction accuracy | ~70% | 98%+ |
| Pattern confidence | Variable | 90%+ verified |
| Proforma BL correct | 0% | 100% |
| Forwarded emails correct | ~50% | 95%+ |

---

## Next Steps

1. **You verify** the Proforma BL = mbl_draft assumption
2. I implement enhanced direction detection
3. I create pattern verification script for user review
4. We iteratively fix patterns based on your feedback

**Question for you:** Should I proceed with implementing the direction detection fix first? That will fix the "booking_confirmation_shared should be received" issue immediately.
