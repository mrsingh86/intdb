# Migration: Split shipment_documents into email_shipment_links + attachment_shipment_links

## Overview

This migration splits the monolithic `shipment_documents` table into two tables following the classification architecture pattern:

| Old Table | New Tables |
|-----------|------------|
| `shipment_documents` | `email_shipment_links` + `attachment_shipment_links` |

This mirrors the pattern used for classification:
| Classification | Linking |
|----------------|---------|
| `email_classifications` | `email_shipment_links` |
| `attachment_classifications` | `attachment_shipment_links` |

---

## New Schema

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│  email_shipment_links   │         │  attachment_shipment_links   │
├─────────────────────────┤         ├──────────────────────────────┤
│  id (PK)                │         │  id (PK)                     │
│  email_id (FK)          │◄────────┤  email_id (FK)               │
│  shipment_id (FK)       │         │  attachment_id (FK)          │
│  thread_id              │         │  shipment_id (FK)            │
│  linking_id ────────────┼─────────┤  linking_id                  │
│  link_method            │         │  document_type               │
│  link_confidence_score  │         │  matched_booking_number      │
│  is_thread_authority    │         │  matched_bl_number           │
│  email_type             │         │  link_confidence_score       │
│  sender_category        │         │  is_primary                  │
└─────────────────────────┘         └──────────────────────────────┘
         │                                     │
         └──────────────┬──────────────────────┘
                        ▼
              ┌─────────────────────┐
              │     shipments       │
              └─────────────────────┘
```

---

## Migration Steps

### 1. Run the Migration
```bash
# Via Supabase CLI
supabase db push

# Or via SQL
psql -f supabase/migrations/20250108_split_shipment_documents.sql
```

### 2. Verify Data Migration
```sql
-- Check counts match
SELECT
  (SELECT COUNT(DISTINCT email_id) FROM shipment_documents) as old_emails,
  (SELECT COUNT(*) FROM email_shipment_links) as new_email_links,
  (SELECT COUNT(*) FROM attachment_shipment_links) as new_attachment_links;
```

### 3. Update Services (see below)

### 4. Test thoroughly

### 5. Drop old table (after verification)
```sql
-- Only after confirming everything works!
DROP TABLE shipment_documents;
```

---

## Service Updates Required

### 1. ShipmentDocumentRepository

**File:** `lib/repositories/shipment-document-repository.ts`

**Changes:**
- Split into `EmailShipmentLinkRepository` and `AttachmentShipmentLinkRepository`
- Or update existing repository to write to both tables

```typescript
// OLD
async create(data: { email_id, shipment_id, document_type }): Promise<void> {
  await this.supabase.from('shipment_documents').insert(data);
}

// NEW
async create(data: ShipmentLinkInput): Promise<void> {
  const linkingId = uuidv4();

  // 1. Always create email link
  await this.supabase.from('email_shipment_links').insert({
    email_id: data.email_id,
    shipment_id: data.shipment_id,
    linking_id: linkingId,
    link_method: data.link_method,
    // ...
  });

  // 2. Create attachment link if attachment exists
  if (data.attachment_id) {
    await this.supabase.from('attachment_shipment_links').insert({
      attachment_id: data.attachment_id,
      email_id: data.email_id,
      shipment_id: data.shipment_id,
      linking_id: linkingId,
      document_type: data.document_type,
      // ...
    });
  }
}
```

### 2. EmailProcessingOrchestrator

**File:** `lib/services/email-processing-orchestrator.ts`

**Changes:**
- Update `linkEmailToShipment()` method
- Pass `attachment_id` when linking documents

```typescript
// OLD (line ~917)
private async linkEmailToShipment(
  emailId: string,
  shipmentId: string,
  documentType: string,
): Promise<void> {
  await this.shipmentDocumentRepository.create({
    email_id: emailId,
    shipment_id: shipmentId,
    document_type: documentType,
  });
}

// NEW
private async linkEmailToShipment(
  emailId: string,
  shipmentId: string,
  documentType: string,
  attachmentId?: string,  // ADD THIS
): Promise<void> {
  const linkingId = uuidv4();

  // Email-level link
  await this.emailShipmentLinkRepository.create({
    email_id: emailId,
    shipment_id: shipmentId,
    linking_id: linkingId,
    // ...
  });

  // Attachment-level link (if attachment exists)
  if (attachmentId) {
    await this.attachmentShipmentLinkRepository.create({
      attachment_id: attachmentId,
      email_id: emailId,
      shipment_id: shipmentId,
      linking_id: linkingId,
      document_type: documentType,
      // ...
    });
  }
}
```

### 3. ThreadSummaryService

**File:** `lib/services/shipment-linking/thread-summary-service.ts`

**Changes:**
- Query from new tables
- Consider both email and attachment links

```typescript
// Update queries to use new tables
async getShipmentForThread(threadId: string): Promise<string | null> {
  // First check attachment links (more specific)
  const { data: attachmentLink } = await this.supabase
    .from('attachment_shipment_links')
    .select('shipment_id')
    .eq('thread_id', threadId)
    .not('shipment_id', 'is', null)
    .order('link_confidence_score', { ascending: false })
    .limit(1)
    .single();

  if (attachmentLink) return attachmentLink.shipment_id;

  // Fall back to email links
  const { data: emailLink } = await this.supabase
    .from('email_shipment_links')
    .select('shipment_id')
    .eq('thread_id', threadId)
    .eq('is_thread_authority', true)
    .single();

  return emailLink?.shipment_id || null;
}
```

### 4. BackfillService

**File:** `lib/services/shipment-linking/backfill-service.ts`

**Changes:**
- Update to create links in both tables
- Handle orphan documents (attachment_shipment_links with null shipment_id)

### 5. API Routes

**Files:**
- `app/api/shipments/[id]/documents/route.ts`
- Any route querying shipment_documents

**Changes:**
- Use the `v_shipment_documents` view for backward compatibility
- Or update to query new tables directly

```typescript
// Option A: Use compatibility view (temporary)
const { data } = await supabase
  .from('v_shipment_documents')
  .select('*')
  .eq('shipment_id', shipmentId);

// Option B: Query new tables (preferred)
const { data: attachmentLinks } = await supabase
  .from('attachment_shipment_links')
  .select(`
    *,
    raw_attachments(filename, mime_type)
  `)
  .eq('shipment_id', shipmentId);
```

---

## Queries Comparison

### Get documents for a shipment

```sql
-- OLD
SELECT * FROM shipment_documents WHERE shipment_id = $1;

-- NEW (attachment-level documents)
SELECT asl.*, ra.filename, ra.extracted_text
FROM attachment_shipment_links asl
JOIN raw_attachments ra ON ra.id = asl.attachment_id
WHERE asl.shipment_id = $1;

-- NEW (all related emails including those without attachments)
SELECT esl.*, re.subject, re.sender_email
FROM email_shipment_links esl
JOIN raw_emails re ON re.id = esl.email_id
WHERE esl.shipment_id = $1;
```

### Get shipment for an email

```sql
-- OLD
SELECT shipment_id FROM shipment_documents WHERE email_id = $1;

-- NEW
SELECT shipment_id FROM email_shipment_links WHERE email_id = $1;
```

### Get shipment for an attachment

```sql
-- OLD (not possible!)
-- shipment_documents didn't have attachment_id

-- NEW
SELECT shipment_id FROM attachment_shipment_links WHERE attachment_id = $1;
```

### Link an email with attachment to shipment

```sql
-- OLD
INSERT INTO shipment_documents (email_id, shipment_id, document_type) VALUES ($1, $2, $3);

-- NEW
WITH link AS (
  INSERT INTO email_shipment_links (email_id, shipment_id, linking_id)
  VALUES ($1, $2, gen_random_uuid())
  RETURNING linking_id
)
INSERT INTO attachment_shipment_links (attachment_id, email_id, shipment_id, linking_id, document_type)
SELECT $4, $1, $2, linking_id, $3 FROM link;
```

---

## Testing Checklist

- [ ] Migration runs without errors
- [ ] Data counts match between old and new tables
- [ ] Email processing still links documents correctly
- [ ] Shipment detail page shows all documents
- [ ] Thread-based linking works
- [ ] Backfill service works
- [ ] Multi-attachment emails link correctly
- [ ] Orphan documents are handled

---

## Rollback Plan

If issues arise, the old `shipment_documents` table is preserved:

```sql
-- Rollback: Drop new tables and continue using shipment_documents
DROP TABLE IF EXISTS attachment_shipment_links CASCADE;
DROP TABLE IF EXISTS email_shipment_links CASCADE;
DROP VIEW IF EXISTS v_shipment_documents;

-- shipment_documents is still intact
```

---

## Timeline

1. **Phase 1:** Run migration, use compatibility view (no code changes)
2. **Phase 2:** Update repositories to write to new tables
3. **Phase 3:** Update read queries to use new tables
4. **Phase 4:** Drop old table after verification
