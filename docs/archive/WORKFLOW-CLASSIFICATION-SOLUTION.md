# Complete Workflow Classification Solution

## Overview

Multi-signal classification system for mapping emails to workflow states.

**Priority Order:**
1. Attachment filename (95% confidence)
2. Body content indicators (90% confidence)
3. Subject patterns (90-100% confidence)
4. AI fallback (80%+ confidence)

---

## Part 1: Direction Detection

```typescript
function detectDirection(senderEmail: string): 'inbound' | 'outbound' {
  const sender = senderEmail.toLowerCase();
  if (sender.includes('@intoglo.com') || sender.includes('@intoglo.in')) {
    return 'outbound';
  }
  return 'inbound';
}
```

| Sender | Direction |
|--------|-----------|
| `@maersk.com`, `@coscon.com` | INBOUND |
| `@client.com`, `@cha-agent.com` | INBOUND |
| `ops-group@intoglo.com` | INBOUND (group forwarding) |
| `rahul@intoglo.com` | OUTBOUND |

---

## Part 2: Attachment Filename Patterns

**Priority 1 - Strongest signal**

```typescript
const ATTACHMENT_PATTERNS: Array<{ pattern: RegExp; type: string }> = [
  // SI
  { pattern: /^SI[_\-\s]/i, type: 'si_draft' },
  { pattern: /Shipping[_\-\s]?Instruction/i, type: 'si_draft' },

  // Invoice
  { pattern: /^Invoice/i, type: 'invoice' },
  { pattern: /^INV[_\-]/i, type: 'invoice' },
  { pattern: /Freight[_\-\s]?Invoice/i, type: 'invoice' },
  { pattern: /Duty[_\-\s]?Invoice/i, type: 'duty_invoice' },

  // POD
  { pattern: /^POD/i, type: 'proof_of_delivery' },
  { pattern: /Proof[_\-\s]?of[_\-\s]?Delivery/i, type: 'proof_of_delivery' },

  // Packing List
  { pattern: /Packing[_\-\s]?List/i, type: 'packing_list' },
  { pattern: /^PL[_\-]/i, type: 'packing_list' },

  // Commercial Invoice
  { pattern: /Commercial[_\-\s]?Invoice/i, type: 'commercial_invoice' },
  { pattern: /^CI[_\-]/i, type: 'commercial_invoice' },

  // BL
  { pattern: /^HBL/i, type: 'hbl_draft' },
  { pattern: /^MBL/i, type: 'bill_of_lading' },
  { pattern: /Draft[_\-\s]?BL/i, type: 'hbl_draft' },
  { pattern: /Bill[_\-\s]?of[_\-\s]?Lading/i, type: 'bill_of_lading' },

  // Booking
  { pattern: /^BC[_\-]/i, type: 'booking_confirmation' },
  { pattern: /Booking[_\-\s]?Confirm/i, type: 'booking_confirmation' },

  // Arrival Notice
  { pattern: /^AN[_\-]/i, type: 'arrival_notice' },
  { pattern: /Arrival[_\-\s]?Notice/i, type: 'arrival_notice' },

  // Customs - India
  { pattern: /Shipping[_\-\s]?Bill/i, type: 'shipping_bill' },
  { pattern: /^SB[_\-]/i, type: 'shipping_bill' },
  { pattern: /LEO/i, type: 'leo_copy' },
  { pattern: /Bill[_\-\s]?of[_\-\s]?Entry/i, type: 'bill_of_entry' },
  { pattern: /^BOE/i, type: 'bill_of_entry' },

  // Customs - US
  { pattern: /Entry[_\-\s]?Summary/i, type: 'entry_summary' },
  { pattern: /^7501/i, type: 'entry_summary' },  // CBP Form 7501
  { pattern: /Draft[_\-\s]?Entry/i, type: 'draft_entry' },
  { pattern: /ISF/i, type: 'isf_filing' },

  // Checklist
  { pattern: /Checklist/i, type: 'checklist' },
  { pattern: /Doc[_\-\s]?List/i, type: 'checklist' },

  // Certificates
  { pattern: /^COO/i, type: 'certificate' },
  { pattern: /Certificate/i, type: 'certificate' },
];
```

---

## Part 3: Body Content Indicators

**Priority 2**

```typescript
const BODY_INDICATORS: Array<{ pattern: RegExp; type: string }> = [
  // SI
  { pattern: /please\s*find\s*(attached\s*)?(the\s*)?SI/i, type: 'si_draft' },
  { pattern: /PFA\s*(the\s*)?SI/i, type: 'si_draft' },
  { pattern: /attached\s*(is\s*)?(the\s*)?shipping\s*instruction/i, type: 'si_draft' },

  // Invoice
  { pattern: /please\s*find\s*(attached\s*)?(the\s*)?invoice/i, type: 'invoice' },
  { pattern: /PFA\s*(the\s*)?invoice/i, type: 'invoice' },
  { pattern: /kindly\s*find\s*duty\s*invoice/i, type: 'duty_invoice' },

  // POD
  { pattern: /PFA\s*(the\s*)?POD/i, type: 'proof_of_delivery' },
  { pattern: /POD\s*(is\s*)?attached/i, type: 'proof_of_delivery' },
  { pattern: /delivery\s*(has\s*been\s*)?completed/i, type: 'delivery_confirmation' },

  // Packing List
  { pattern: /please\s*find\s*(attached\s*)?(the\s*)?packing\s*list/i, type: 'packing_list' },
  { pattern: /PFA\s*(the\s*)?(PL|packing\s*list)/i, type: 'packing_list' },

  // Commercial Invoice
  { pattern: /attached\s*(is\s*)?(the\s*)?commercial\s*invoice/i, type: 'commercial_invoice' },
  { pattern: /PFA\s*(the\s*)?CI/i, type: 'commercial_invoice' },

  // HBL Draft
  { pattern: /please\s*(find|review)\s*(the\s*)?draft\s*(HBL|BL|B\/L)/i, type: 'hbl_draft' },
  { pattern: /(HBL|BL)\s*draft\s*(for\s*)?(your\s*)?(review|approval)/i, type: 'hbl_draft' },

  // Customs - India
  { pattern: /please\s*find\s*(attached\s*)?(the\s*)?shipping\s*bill/i, type: 'shipping_bill' },
  { pattern: /PFA\s*(the\s*)?SB/i, type: 'shipping_bill' },
  { pattern: /LEO\s*(copy\s*)?(attached|enclosed)/i, type: 'leo_copy' },
  { pattern: /let\s*export\s*order/i, type: 'leo_copy' },
  { pattern: /PFA\s*(the\s*)?checklist/i, type: 'checklist' },
  { pattern: /document\s*checklist\s*attached/i, type: 'checklist' },
  { pattern: /export\s*checklist/i, type: 'checklist' },

  // Customs - US
  { pattern: /entry\s*summary\s*(attached|enclosed)/i, type: 'entry_summary' },
  { pattern: /PFA\s*(the\s*)?entry\s*summary/i, type: 'entry_summary' },
  { pattern: /draft\s*entry\s*(for\s*)?(review|approval)/i, type: 'draft_entry' },
  { pattern: /please\s*review\s*(the\s*)?draft\s*entry/i, type: 'draft_entry' },
  { pattern: /duty\s*entry\s*summary/i, type: 'entry_summary' },
  { pattern: /ISF\s*(has\s*been\s*)?filed/i, type: 'isf_filing' },
  { pattern: /ISF\s*confirmation/i, type: 'isf_filing' },

  // Customs clearance
  { pattern: /customs\s*(has\s*been\s*)?cleared/i, type: 'customs_clearance' },
  { pattern: /out\s*of\s*charge/i, type: 'customs_clearance' },

  // Booking
  { pattern: /booking\s*(has\s*been\s*)?confirmed/i, type: 'booking_confirmation' },
  { pattern: /PFA\s*(the\s*)?booking\s*confirm/i, type: 'booking_confirmation' },
];
```

---

## Part 4: Carrier Subject Patterns (INBOUND)

**Priority 3 - For carrier emails**

### Maersk

```typescript
const MAERSK_PATTERNS = [
  { pattern: /^Booking Confirmation\s*[:\-]\s*\d+/i, type: 'booking_confirmation' },
  { pattern: /^Booking Amendment\s*:\s*\d+/i, type: 'booking_amendment' },
  { pattern: /^Booking Cancellation\s*:\s*\d+/i, type: 'booking_cancellation' },
  { pattern: /^Arrival notice\s+\d+/i, type: 'arrival_notice' },
  { pattern: /^Arrival Notice\s*:/i, type: 'arrival_notice' },
  { pattern: /^New invoice\s+[A-Z0-9]+/i, type: 'invoice' },
  { pattern: /^SI submitted\s+\d+/i, type: 'shipping_instruction' },
  { pattern: /^Amendment submitted\s+\d+/i, type: 'booking_amendment' },
  { pattern: /TPDoc.*sea\s?waybill/i, type: 'bill_of_lading' },
  { pattern: /draft sea\s?way\s?bill/i, type: 'mbl_draft' },
  { pattern: /VGM.*confirm/i, type: 'vgm_confirmation' },
  { pattern: /Maersk Last Free Day/i, type: 'cutoff_advisory' },
];
```

### Hapag-Lloyd

```typescript
const HAPAG_PATTERNS = [
  { pattern: /^HL-\d+\s+[A-Z]{5}\s+[A-Z]/i, type: 'booking_confirmation' },
  { pattern: /^\[Update\]\s+Booking\s+\d+/i, type: 'booking_amendment' },
  { pattern: /^Shipping Instruction Submitted\s*Sh#\d+/i, type: 'shipping_instruction' },
  { pattern: /^BL HLCL Sh#/i, type: 'bill_of_lading' },
  { pattern: /^HLCL Sh#\s*\d+\s*Doc#/i, type: 'bill_of_lading' },
  { pattern: /^SW HLCL Sh#/i, type: 'bill_of_lading' },
  { pattern: /^\d+\s+INTOG[LO]\s+001\s+HL/i, type: 'invoice' },
  { pattern: /^VGM ACC\s+[A-Z]{4}\d+/i, type: 'vgm_confirmation' },
  { pattern: /VGM REMINDER/i, type: 'vgm_reminder' },
  { pattern: /^ALERT\s*-\s*Bill of lading.*POD/i, type: 'arrival_notice' },
];
```

### Cosco

```typescript
const COSCO_PATTERNS = [
  { pattern: /^Cosco Shipping Line Booking Confirmation/i, type: 'booking_confirmation' },
  { pattern: /^COSCON\s*-\s*Proforma Bill of Lading/i, type: 'mbl_draft' },  // Draft MBL
  { pattern: /^COSCON\s*-\s*Copy Bill of Lading/i, type: 'bill_of_lading' },
  { pattern: /^COSCON\s*-\s*Bill of Lading/i, type: 'bill_of_lading' },
  { pattern: /^COSCO Arrival Notice/i, type: 'arrival_notice' },
  { pattern: /^Cosco Shipping Line\s*-Shipment Notice:/i, type: 'shipment_notice' },
  { pattern: /^PROD_Invoice\s+INTOGLO/i, type: 'invoice' },
];
```

### CMA CGM

```typescript
const CMA_CGM_PATTERNS = [
  { pattern: /^CMA CGM - Booking confirmation available/i, type: 'booking_confirmation' },
  { pattern: /^CMA CGM - Shipping instruction submitted/i, type: 'shipping_instruction' },
  { pattern: /^CMA CGM - Arrival notice available/i, type: 'arrival_notice' },
  { pattern: /^Modification requested on draft BL/i, type: 'mbl_draft' },
  { pattern: /^B\/L Draft:/i, type: 'mbl_draft' },
  { pattern: /^CMA-CGM Freight Invoice/i, type: 'invoice' },
];
```

### MSC

```typescript
const MSC_PATTERNS = [
  { pattern: /INTOGLO.*\/.*AMM\s*#\s*\d+/i, type: 'booking_amendment' },
  { pattern: /MSC.*Booking Confirm/i, type: 'booking_confirmation' },
];
```

---

## Part 5: Partner Patterns (INBOUND)

### India CHA (Customs House Agent)

```typescript
const INDIA_CHA_PATTERNS = [
  // Checklist
  { pattern: /Checklist/i, type: 'checklist' },
  { pattern: /Document\s*Checklist/i, type: 'checklist' },
  { pattern: /Export\s*Checklist/i, type: 'checklist' },
  { pattern: /Doc\s*List/i, type: 'checklist' },

  // Shipping Bill
  { pattern: /Shipping\s*Bill/i, type: 'shipping_bill' },
  { pattern: /\bSB\s*No\.?\s*\d+/i, type: 'shipping_bill' },
  { pattern: /\bSB\b.*filed/i, type: 'shipping_bill' },

  // LEO (Let Export Order)
  { pattern: /\bLEO\b/i, type: 'leo_copy' },
  { pattern: /Let\s*Export\s*Order/i, type: 'leo_copy' },

  // Bill of Entry (Import)
  { pattern: /Bill\s*of\s*Entry/i, type: 'bill_of_entry' },
  { pattern: /\bBOE\b.*\d+/i, type: 'bill_of_entry' },
  { pattern: /\bBE\s*No\.?\s*\d+/i, type: 'bill_of_entry' },

  // Duty Invoice
  { pattern: /Duty\s*Invoice/i, type: 'duty_invoice' },
  { pattern: /Customs\s*Invoice/i, type: 'duty_invoice' },
  { pattern: /IGST\s*(Payment|Invoice)/i, type: 'duty_invoice' },

  // Customs Clearance
  { pattern: /Customs\s*Clear/i, type: 'customs_clearance' },
  { pattern: /Out\s*of\s*Charge/i, type: 'customs_clearance' },
  { pattern: /\bOOC\b/i, type: 'customs_clearance' },

  // Exam/Hold
  { pattern: /Customs\s*Hold/i, type: 'exam_notice' },
  { pattern: /Exam\s*Order/i, type: 'exam_notice' },
  { pattern: /DRI\s*Notice/i, type: 'exam_notice' },
];
```

### US Customs Broker

```typescript
const US_CUSTOMS_BROKER_PATTERNS = [
  // Entry Summary (CBP Form 7501)
  { pattern: /Entry\s*Summary/i, type: 'entry_summary' },
  { pattern: /\b7501\b/i, type: 'entry_summary' },
  { pattern: /Duty\s*Entry\s*Summary/i, type: 'entry_summary' },
  { pattern: /CBP\s*Entry/i, type: 'entry_summary' },

  // Draft Entry (for review before filing)
  { pattern: /Draft\s*Entry/i, type: 'draft_entry' },
  { pattern: /Entry\s*Draft/i, type: 'draft_entry' },
  { pattern: /Entry\s*for\s*(your\s*)?(review|approval)/i, type: 'draft_entry' },
  { pattern: /Review\s*Entry/i, type: 'draft_entry' },

  // ISF (Importer Security Filing - 10+2)
  { pattern: /\bISF\b/i, type: 'isf_filing' },
  { pattern: /Importer\s*Security\s*Filing/i, type: 'isf_filing' },
  { pattern: /10\+2\s*Filing/i, type: 'isf_filing' },

  // Duty Payment
  { pattern: /Duty\s*Payment/i, type: 'duty_invoice' },
  { pattern: /ACH\s*Debit/i, type: 'duty_invoice' },
  { pattern: /CBP\s*Duty/i, type: 'duty_invoice' },

  // Release
  { pattern: /Customs\s*Release/i, type: 'customs_clearance' },
  { pattern: /CBP\s*Release/i, type: 'customs_clearance' },
  { pattern: /Entry\s*Released/i, type: 'customs_clearance' },

  // FDA/USDA Holds
  { pattern: /FDA\s*Hold/i, type: 'exam_notice' },
  { pattern: /USDA\s*Hold/i, type: 'exam_notice' },
  { pattern: /Intensive\s*Exam/i, type: 'exam_notice' },
  { pattern: /X-?Ray\s*Exam/i, type: 'exam_notice' },
];
```

### Trucker/Transporter

```typescript
const TRUCKER_PATTERNS = [
  // POD
  { pattern: /\bPOD\b/i, type: 'proof_of_delivery' },
  { pattern: /Proof\s*of\s*Delivery/i, type: 'proof_of_delivery' },
  { pattern: /Signed\s*(POD|Delivery)/i, type: 'proof_of_delivery' },

  // Delivery Confirmation
  { pattern: /Deliver(y|ed)\s*(Done|Complete|Confirm)/i, type: 'delivery_confirmation' },
  { pattern: /Successfully\s*Delivered/i, type: 'delivery_confirmation' },
  { pattern: /Cargo\s*Delivered/i, type: 'delivery_confirmation' },

  // Gate-in
  { pattern: /Gate[-\s]?in/i, type: 'gate_in_confirmation' },
  { pattern: /Container\s*reached/i, type: 'gate_in_confirmation' },
  { pattern: /Arrived\s*at\s*(CFS|ICD|Port)/i, type: 'gate_in_confirmation' },

  // Empty Return
  { pattern: /Empty\s*Return/i, type: 'empty_return' },
  { pattern: /Container\s*Returned/i, type: 'empty_return' },
];
```

### Shipper/Client

```typescript
const CLIENT_PATTERNS = [
  // SI
  { pattern: /\bSI\b\s*(attached|details|for)/i, type: 'si_draft' },
  { pattern: /Shipping\s*Instruction/i, type: 'si_draft' },

  // Commercial Invoice
  { pattern: /Commercial\s*Invoice/i, type: 'commercial_invoice' },

  // Packing List
  { pattern: /Packing\s*List/i, type: 'packing_list' },

  // Certificates
  { pattern: /Certificate\s*of\s*Origin/i, type: 'certificate' },
  { pattern: /\bCOO\b/i, type: 'certificate' },
  { pattern: /Phyto(sanitary)?\s*Certificate/i, type: 'certificate' },
];
```

---

## Part 6: Intoglo Outbound Patterns

**For emails sent by Intoglo team members**

```typescript
const INTOGLO_OUTBOUND_PATTERNS = [
  // Forwarded carrier docs
  { pattern: /^(FW|Fwd):\s*Booking Confirmation/i, type: 'booking_confirmation' },
  { pattern: /^(FW|Fwd):\s*Arrival Notice/i, type: 'arrival_notice' },
  { pattern: /^(FW|Fwd):\s*Bill of Lading/i, type: 'bill_of_lading' },

  // HBL Draft
  { pattern: /HBL\s*Draft/i, type: 'hbl_draft' },
  { pattern: /Draft\s*(HBL|House\s*B\/?L)/i, type: 'hbl_draft' },
  { pattern: /BL\s*Draft\s*for\s*(your\s*)?(approval|review)/i, type: 'hbl_draft' },

  // HBL Release
  { pattern: /HBL\s*Release/i, type: 'bill_of_lading' },
  { pattern: /Final\s*HBL/i, type: 'bill_of_lading' },

  // Invoice
  { pattern: /^Invoice\s*[-:#]/i, type: 'invoice' },
  { pattern: /Freight\s*Invoice/i, type: 'invoice' },
  { pattern: /^INV[-\s]?\d+/i, type: 'invoice' },

  // Quotation
  { pattern: /^Quotation/i, type: 'quotation' },
  { pattern: /Rate\s*Quote/i, type: 'quotation' },

  // Arrival Notice (sharing)
  { pattern: /Arrival\s*Notice/i, type: 'arrival_notice' },
  { pattern: /Pre-?Alert/i, type: 'arrival_notice' },

  // Booking Confirmation (sharing)
  { pattern: /Booking\s*Confirm/i, type: 'booking_confirmation' },

  // Customs/Duty
  { pattern: /Duty\s*Summary/i, type: 'customs_document' },
  { pattern: /Entry\s*Summary/i, type: 'entry_summary' },

  // Delivery Order
  { pattern: /Delivery\s*Order/i, type: 'delivery_order' },
  { pattern: /^DO\s*[-:#]/i, type: 'delivery_order' },

  // Checklist
  { pattern: /Checklist/i, type: 'checklist' },
  { pattern: /Export\s*Docs/i, type: 'checklist' },

  // SOB
  { pattern: /SOB\s*Confirm/i, type: 'sob_confirmation' },
  { pattern: /Shipped\s*on\s*Board/i, type: 'sob_confirmation' },
];
```

---

## Part 7: Workflow State Mapping

```typescript
const WORKFLOW_STATE_MAPPING: Record<string, string> = {
  // ===== PRE_DEPARTURE =====

  // Booking
  'booking_confirmation:inbound': 'booking_confirmation_received',
  'booking_confirmation:outbound': 'booking_confirmation_shared',
  'booking_amendment:inbound': 'booking_confirmation_received',
  'booking_amendment:outbound': 'booking_confirmation_shared',
  'booking_cancellation:inbound': 'booking_cancelled',

  // Commercial docs
  'commercial_invoice:inbound': 'commercial_invoice_received',
  'packing_list:inbound': 'packing_list_received',
  'certificate:inbound': 'certificate_received',

  // SI Flow
  'si_draft:inbound': 'si_draft_received',
  'si_draft:outbound': 'si_draft_shared',
  'shipping_instruction:inbound': 'si_confirmed',
  'shipping_instruction:outbound': 'si_submitted',

  // Checklist (India Export)
  'checklist:inbound': 'checklist_received',
  'checklist:outbound': 'checklist_shared',
  'shipping_bill:inbound': 'shipping_bill_received',
  'leo_copy:inbound': 'leo_received',

  // VGM
  'vgm_confirmation:inbound': 'vgm_confirmed',
  'vgm_submission:outbound': 'vgm_submitted',

  // Gate-in & SOB
  'gate_in_confirmation:inbound': 'container_gated_in',
  'sob_confirmation:inbound': 'sob_received',
  'sob_confirmation:outbound': 'sob_shared',
  'departure_notice:inbound': 'vessel_departed',

  // ===== IN_TRANSIT =====

  // ISF (US Import)
  'isf_filing:inbound': 'isf_confirmed',
  'isf_filing:outbound': 'isf_filed',

  // MBL (from carrier)
  'mbl_draft:inbound': 'mbl_draft_received',
  'mbl_draft:outbound': 'mbl_draft_shared',
  'bill_of_lading:inbound': 'mbl_received',

  // HBL (Intoglo to shipper)
  'hbl_draft:inbound': 'hbl_draft_received',
  'hbl_draft:outbound': 'hbl_draft_shared',
  'bill_of_lading:outbound': 'hbl_released',

  // Invoice
  'invoice:inbound': 'invoice_received',
  'invoice:outbound': 'invoice_sent',

  // ===== PRE_ARRIVAL =====

  // Entry (US Import)
  'draft_entry:inbound': 'draft_entry_received',
  'draft_entry:outbound': 'draft_entry_shared',
  'entry_summary:inbound': 'entry_filed',
  'entry_summary:outbound': 'entry_shared',

  // ===== ARRIVAL =====

  // Arrival Notice
  'arrival_notice:inbound': 'arrival_notice_received',
  'arrival_notice:outbound': 'arrival_notice_shared',

  // Customs - India
  'bill_of_entry:inbound': 'bill_of_entry_received',
  'duty_invoice:inbound': 'duty_invoice_received',
  'customs_clearance:inbound': 'customs_cleared',
  'exam_notice:inbound': 'customs_hold',

  // Customs - US
  // (uses entry_summary, draft_entry above)

  // Duty sharing
  'customs_document:outbound': 'duty_summary_shared',

  // Delivery Order
  'delivery_order:inbound': 'delivery_order_received',
  'delivery_order:outbound': 'delivery_order_shared',

  // ===== DELIVERY =====

  'container_release:inbound': 'container_released',
  'proof_of_delivery:inbound': 'pod_received',
  'delivery_confirmation:inbound': 'delivered',
  'empty_return:inbound': 'empty_returned',
};
```

---

## Part 8: Complete Classification Function

```typescript
interface ClassificationResult {
  documentType: string;
  direction: 'inbound' | 'outbound';
  workflowState: string | null;
  confidence: number;
  method: 'attachment' | 'body' | 'carrier_pattern' | 'partner_pattern' | 'intoglo_pattern' | 'ai' | 'default';
  signal: string;
}

async function classifyEmail(email: {
  subject: string;
  senderEmail: string;
  bodyText: string;
  attachmentFilenames: string[];
}): Promise<ClassificationResult> {

  const direction = detectDirection(email.senderEmail);

  // ================================================
  // PRIORITY 1: Attachment filename (95% confidence)
  // ================================================
  for (const filename of email.attachmentFilenames) {
    for (const { pattern, type } of ATTACHMENT_PATTERNS) {
      if (pattern.test(filename)) {
        return result(type, direction, 95, 'attachment', `Filename: ${filename}`);
      }
    }
  }

  // ================================================
  // PRIORITY 2: Body content indicators (90%)
  // ================================================
  for (const { pattern, type } of BODY_INDICATORS) {
    if (pattern.test(email.bodyText)) {
      return result(type, direction, 90, 'body', `Body: ${pattern.source}`);
    }
  }

  // ================================================
  // PRIORITY 3: Subject patterns
  // ================================================
  const cleanSubject = stripReplyForwardPrefix(email.subject);

  if (direction === 'inbound') {
    // 3a. Carrier patterns (100%)
    const carrierMatch = matchCarrierPatterns(cleanSubject);
    if (carrierMatch) {
      return result(carrierMatch.type, direction, 100, 'carrier_pattern', carrierMatch.pattern);
    }

    // 3b. Partner patterns (90%)
    const partnerMatch = matchPartnerPatterns(cleanSubject);
    if (partnerMatch) {
      return result(partnerMatch.type, direction, 90, 'partner_pattern', partnerMatch.pattern);
    }
  } else {
    // 3c. Intoglo outbound patterns (95%)
    const intogloMatch = matchIntogloPatterns(cleanSubject);
    if (intogloMatch) {
      return result(intogloMatch.type, direction, 95, 'intoglo_pattern', intogloMatch.pattern);
    }
  }

  // ================================================
  // PRIORITY 4: AI Classification (80%+)
  // ================================================
  if (direction === 'inbound') {
    const aiResult = await classifyWithAI(email);
    return result(aiResult.type, direction, aiResult.confidence, 'ai', aiResult.reasoning);
  }

  // ================================================
  // FALLBACK: General correspondence (50%)
  // ================================================
  return result('general_correspondence', direction, 50, 'default', 'No pattern matched');
}

function result(
  type: string,
  direction: 'inbound' | 'outbound',
  confidence: number,
  method: string,
  signal: string
): ClassificationResult {
  return {
    documentType: type,
    direction,
    workflowState: WORKFLOW_STATE_MAPPING[`${type}:${direction}`] || null,
    confidence,
    method: method as ClassificationResult['method'],
    signal,
  };
}

function stripReplyForwardPrefix(subject: string): string {
  return subject.replace(/^(RE|Re|FW|Fw|FWD|Fwd):\s*/g, '').trim();
}
```

---

## Part 9: Implementation Checklist

### Files to Create

| File | Description |
|------|-------------|
| `lib/utils/direction-detector.ts` | Direction detection |
| `lib/config/attachment-patterns.ts` | Attachment filename patterns |
| `lib/config/body-indicators.ts` | Body content patterns |
| `lib/config/carrier-patterns.ts` | Carrier subject patterns |
| `lib/config/partner-patterns.ts` | CHA, Trucker, Agent patterns |
| `lib/config/intoglo-patterns.ts` | Outbound patterns |
| `lib/services/document-classifier.ts` | Unified classifier |

### Files to Modify

| File | Changes |
|------|---------|
| `lib/config/shipping-line-patterns.ts` | Add `mbl_draft` |
| `lib/services/workflow-state-service.ts` | Update mapping |
| `types/email-intelligence.ts` | Add new document types |

### Database Changes

```sql
-- Add new document types if constrained
-- Update misclassified documents
UPDATE document_classifications
SET document_type = 'mbl_draft'
WHERE document_type = 'bill_of_lading'
AND email_id IN (
  SELECT id FROM raw_emails
  WHERE subject ILIKE '%Proforma Bill of Lading%'
);
```

### Test Cases

```typescript
const TEST_CASES = [
  // Attachment wins over subject
  { subject: 'RE: Booking Confirmation', attachment: 'SI_MAEU123.pdf', expected: 'si_draft' },

  // Body wins over subject
  { subject: 'RE: Arrival Notice', body: 'PFA the invoice', expected: 'invoice' },

  // Carrier pattern
  { subject: 'Booking Confirmation : 263522431', sender: 'maersk.com', expected: 'booking_confirmation' },

  // MBL Draft (Proforma)
  { subject: 'COSCON - Proforma Bill of Lading', sender: 'coscon.com', expected: 'mbl_draft' },

  // India CHA
  { subject: 'Checklist for booking MAEU123', sender: 'cha@agent.com', expected: 'checklist' },
  { subject: 'LEO Copy attached', sender: 'cha@agent.com', expected: 'leo_copy' },

  // US Customs Broker
  { subject: 'Draft Entry for review', sender: 'broker@us.com', expected: 'draft_entry' },
  { subject: 'Entry Summary - 7501', sender: 'broker@us.com', expected: 'entry_summary' },

  // Intoglo outbound
  { subject: 'HBL Draft for approval', sender: 'priya@intoglo.com', expected: 'hbl_draft' },
];
```

---

## Ready for Implementation

Covered:
- ✅ Direction detection
- ✅ Attachment filename patterns (Priority 1)
- ✅ Body content indicators (Priority 2)
- ✅ Carrier patterns - Maersk, Hapag, Cosco, CMA CGM, MSC
- ✅ India CHA patterns (Checklist, SB, LEO, BOE)
- ✅ US Customs Broker patterns (Draft Entry, Entry Summary, ISF)
- ✅ Trucker patterns (POD, Gate-in, Empty return)
- ✅ Client patterns (SI, CI, PL, Certificates)
- ✅ Intoglo outbound patterns
- ✅ Thread navigation (multi-signal priority)
- ✅ Workflow state mapping
- ✅ Complete classification function
