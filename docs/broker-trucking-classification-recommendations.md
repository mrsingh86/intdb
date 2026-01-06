# Broker & Trucking Email Classification Recommendations

## Executive Summary

Analysis of **8 Portside customs broker emails** and **31 trucking emails** reveals that:
1. **Classification is working** - Emails ARE classified correctly (entry_summary, invoice, customs_clearance)
2. **Entity extraction fails** - Booking numbers NOT extracted from broker format
3. **No shipment linkage** - Documents not created in `shipment_documents`

---

## Current State

### Portside Customs Broker (8 emails)
| Document Type | Count | Confidence |
|--------------|-------|------------|
| entry_summary | 4 | 85% |
| invoice | 2 | 90-95% |
| customs_clearance | 2 | 85-90% |

**Status:** ✅ Classified, ❌ Not in `shipment_documents`

### Trucking Companies (31 emails)
| Company | Emails | Classified | In Documents |
|---------|--------|------------|--------------|
| Transjet | 23 | 0 | 0 |
| Wolverine | 3 | 0 | 0 |
| Kiswani | 2 | 0 | 0 |
| Others | 3 | 0 | 0 |

**Status:** ❌ Not classified, ❌ Not in `shipment_documents`

---

## Root Cause Analysis

### Issue 1: Booking Number Extraction Fails for Broker Format

**Portside Subject Format:**
```
165-0625612-8-7501, Cust. Ref. SEINUS26112502782_I
```

**Current Extraction:** Looking for carrier booking numbers (e.g., `263522431`)
**Result:** `booking_number: undefined`

**The Reference Numbers:**
- `165-0625612-8` = CBP Entry Number
- `SEINUS26112502782_I` = Intoglo Deal ID (this IS the booking reference!)

### Issue 2: Trucking Emails Not Classified

**Transjet Subject Format:**
```
RE: Work Order : SEINUS25082502326_I // 1 X 20 SD // Houston to OKLAHOMA
```

**Problem:** No patterns match "Work Order" as a document type
**The Reference:** `SEINUS25082502326_I` is the Intoglo Deal ID

### Issue 3: No Shipment to Link

Even when booking# extracted, the shipment may not exist:
- `SECNUS08122502815_I` → No shipment found
- `SEINUS26112502782_I` → No shipment found

---

## Recommended Production Code Changes

### 1. Add Portside Broker Subject Patterns

**File:** `lib/services/unified-classification-service.ts`

Add to `SUBJECT_PATTERNS` array:

```typescript
// ===== US CUSTOMS BROKER - PORTSIDE SPECIFIC =====
// Entry Number format: XXX-XXXXXXX-X-7501 (CBP Entry + 7501)
{ pattern: /\d{3}-\d{7}-\d-7501/i, type: 'entry_summary', confidence: 95 },

// Entry Number format: XXX-XXXXXXX-X-3461 (Immediate Delivery)
{ pattern: /\d{3}-\d{7}-\d-3461/i, type: 'draft_entry', confidence: 95 },

// Cargo Release Update
{ pattern: /\d{3}-\d{7}-\d.*Cargo Release/i, type: 'customs_clearance', confidence: 95 },

// Broker Invoice format: Invoice-XXXXXX
{ pattern: /Invoice[- ]?\d{6,}/i, type: 'duty_invoice', confidence: 90 },
```

### 2. Add Trucking Company Patterns

**File:** `lib/config/partner-patterns.ts`

Add to `TRUCKER_PATTERNS`:

```typescript
// Work Order (trucking dispatch/status)
{ pattern: /Work\s*Order\s*:/i, type: 'work_order', priority: 85, category: 'trucker' },

// Container out/picked up
{ pattern: /Container\s+(is\s+)?out/i, type: 'pickup_confirmation', priority: 90, category: 'trucker' },

// Appointment confirmation
{ pattern: /Appointment\s*(ID|#|confirmed)/i, type: 'delivery_appointment', priority: 85, category: 'trucker' },

// Drayage pricing (operational, not document)
{ pattern: /Drayage\s*pric/i, type: 'rate_quote', priority: 70, category: 'trucker' },

// Statement of Account
{ pattern: /\bSOA\b|Statement\s+of\s+Account/i, type: 'statement', priority: 75, category: 'trucker' },
```

### 3. Add New Document Types

**File:** Add to standard document types:

```typescript
// In unified-classification-service.ts STANDARD_DOCUMENT_TYPES
'work_order',           // Trucking dispatch order
'pickup_confirmation',  // Container picked up / out
'delivery_appointment', // Scheduled delivery appointment
'empty_return',         // Empty container returned
'statement',            // Statement of account
```

### 4. Extract Booking Number from Subject

**File:** `lib/services/email-processing-orchestrator.ts`

Update `storeExtractedEntities()` to extract booking# from subject:

```typescript
private extractBookingFromSubject(subject: string): string | null {
  // Pattern 1: Intoglo Deal ID - SEINUS26112502782_I, SECNUS08122502815_I
  const dealIdMatch = subject.match(/([A-Z]{5,7}\d{8,12}_I)/);
  if (dealIdMatch) return dealIdMatch[1];

  // Pattern 2: Cust. Ref. or CR#
  const custRefMatch = subject.match(/(?:Cust\.?\s*Ref\.?|CR#):?\s*([A-Z0-9_]+)/i);
  if (custRefMatch) return custRefMatch[1];

  // Pattern 3: Standard booking numbers (already handled by extraction)
  return null;
}
```

### 5. Add Broker/Trucker Domain Recognition

**File:** `lib/config/email-parties.ts` or new config

```typescript
export const KNOWN_BROKER_DOMAINS = [
  'portsidecustoms.com',
  'artimus',  // Add full domain when discovered
  'sevenseas', // Add full domain when discovered
];

export const KNOWN_TRUCKER_DOMAINS = [
  'transjetcargo.com',
  'armenfreight.com',
  'wolverinefreightways.com',
  'kiswanifreight.com',
  'buckland.com',
  'carmeltransport.com',
  'tadedicated.com',
  'zstransportationllc.com',
  'freedom1.com',
];
```

### 6. Update Workflow State Mapping

**File:** `lib/services/unified-classification-service.ts`

Add to `WORKFLOW_STATE_MAP`:

```typescript
// US Customs Broker - Already exists, verify these are present:
'entry_summary:inbound': 'entry_summary_received',
'draft_entry:inbound': 'entry_draft_received',
'duty_invoice:inbound': 'duty_invoice_received',
'customs_clearance:inbound': 'customs_cleared',

// Trucking - Add new mappings:
'pickup_confirmation:inbound': 'container_released',
'proof_of_delivery:inbound': 'pod_received',
'delivery_confirmation:inbound': 'delivered',
'work_order:outbound': 'dispatch_sent',
```

### 7. Create Documents Without Shipment Link

**File:** `lib/services/email-processing-orchestrator.ts`

Modify `linkToExistingShipment()` to create orphan documents:

```typescript
private async linkToExistingShipment(...): Promise<{ shipmentId?: string }> {
  // ... existing logic to find shipment ...

  // If no shipment found BUT we have a valid document type,
  // still create the document record for later linking
  if (!shipment && documentType && classification?.confidence >= 70) {
    await this.createOrphanDocument(emailId, documentType, data);
    console.log(`[Orchestrator] Created orphan document for future linking`);
  }

  return { shipmentId: shipment?.id };
}

private async createOrphanDocument(
  emailId: string,
  documentType: string,
  data: ExtractedBookingData
): Promise<void> {
  await this.supabase.from('shipment_documents').insert({
    email_id: emailId,
    document_type: documentType,
    shipment_id: null,  // Will be linked later
    booking_number_extracted: data.booking_number,
    status: 'pending_link',
    created_at: new Date().toISOString(),
  });
}
```

---

## Database Changes

### Add Columns to shipment_documents (if not exists)

```sql
ALTER TABLE shipment_documents
ADD COLUMN IF NOT EXISTS booking_number_extracted TEXT,
ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'linked';

-- Index for finding unlinked documents
CREATE INDEX IF NOT EXISTS idx_shipment_documents_unlinked
ON shipment_documents(booking_number_extracted)
WHERE shipment_id IS NULL;
```

### Add broker_configs table

```sql
CREATE TABLE IF NOT EXISTS broker_configs (
  id VARCHAR(50) PRIMARY KEY,
  broker_name VARCHAR(100) NOT NULL,
  email_sender_patterns TEXT[],
  subject_patterns JSONB,
  booking_ref_regex TEXT,
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO broker_configs VALUES
('portside', 'Portside Customs Service',
 ARRAY['portsidecustoms.com'],
 '{"7501": "entry_summary", "3461": "draft_entry", "Invoice-": "duty_invoice", "Cargo Release": "customs_clearance"}',
 '(?:Cust\\.?\\s*Ref\\.?|CR#):?\\s*([A-Z0-9_]+)',
 true, NOW());
```

---

## Implementation Priority

1. **High Priority** - Extract booking# from subject → Enables linking
2. **High Priority** - Add broker patterns → Correct document types
3. **Medium Priority** - Add trucking patterns → POD detection
4. **Medium Priority** - Create orphan documents → Better audit trail
5. **Low Priority** - Database config → Configuration over code

---

## Testing Checklist

- [ ] Portside `165-XXXXXXX-X-7501` → `entry_summary`
- [ ] Portside `Invoice-XXXXXX` → `duty_invoice`
- [ ] Portside `Cargo Release` → `customs_clearance`
- [ ] Extract `SEINUS...` from subject as booking#
- [ ] Transjet `Work Order` → `work_order`
- [ ] Transjet `Container is out` → `pickup_confirmation`
- [ ] Documents created in `shipment_documents` (even without shipment link)
- [ ] Workflow events generated with correct states

---

## Summary

The infrastructure EXISTS but needs configuration updates:
1. Subject patterns need Portside/trucking formats
2. Entity extraction needs to parse deal ID from subject
3. Documents should be created even without shipment link
4. Backfill will link them when shipment is created

**Estimated Effort:** 2-3 hours for pattern updates, 4-6 hours for full implementation with orphan documents.
