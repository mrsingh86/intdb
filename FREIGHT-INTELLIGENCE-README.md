# Freight Forwarding Document Intelligence System

**Version:** 1.0.0
**Architecture:** 4-Layer (Raw Data → Intelligence → Decision Support → Configuration)
**Database:** PostgreSQL 14+ with JSONB support
**AI Integration:** Claude Opus 3, GPT-4 Turbo

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Quick Start](#quick-start)
3. [Layer Breakdown](#layer-breakdown)
4. [AI Agent Integration](#ai-agent-integration)
5. [Common Queries](#common-queries)
6. [Data Lifecycle](#data-lifecycle)
7. [Performance Optimization](#performance-optimization)
8. [Best Practices](#best-practices)
9. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

### **Design Philosophy**

This schema follows **"A Philosophy of Software Design"** principles:

- **Separation of Concerns:** 4 distinct layers with clear responsibilities
- **Configuration Over Code:** Change AI behavior via database config (no redeployment)
- **Database-Driven:** Store EVERYTHING with complete audit trail
- **Deep Modules:** Simple AI agent interfaces hiding complex implementation
- **Information Hiding:** Each layer abstracts implementation details

### **4-Layer Architecture**

```
┌─────────────────────────────────────────────────────────┐
│ LAYER 4: Configuration (Rules, Patterns, Metadata)     │
│ - document_type_configs, extraction_rules              │
│ - linking_rules, carrier_configs                       │
│ Purpose: Change AI behavior WITHOUT code deployment    │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ LAYER 3: Decision Support (Shipment-Centric)           │
│ - shipments, shipment_documents, shipment_events       │
│ - shipment_financials, shipment_containers             │
│ Purpose: Optimized for dashboard queries & reporting   │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ LAYER 2: Intelligence (AI Extractions & Linking)       │
│ - document_classifications, entity_extractions         │
│ - shipment_link_candidates, structured_extractions     │
│ Purpose: AI agent workspace with confidence scoring    │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ LAYER 1: Raw Data (Immutable Source of Truth)          │
│ - raw_emails, raw_attachments, raw_email_metadata      │
│ Purpose: Complete audit trail, enables re-processing   │
└─────────────────────────────────────────────────────────┘
```

---

## Quick Start

### **1. Deploy Schema**

```bash
# Connect to PostgreSQL
psql -U postgres -d freight_intelligence

# Run migration script
\i freight-intelligence-schema.sql

# Verify deployment
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

### **2. Seed Configuration Data**

The migration script includes seed data for:
- 8 common document types (booking, SI, BL, invoice, etc.)
- 4 major carriers (Maersk, Hapag, MSC, CMA CGM)
- 4 linking rules (by booking #, BL #, container #)
- 3 AI model configs (Claude Opus, GPT-4, Claude Sonnet)

**Review and customize:**

```sql
-- View document type configs
SELECT document_type, display_name, min_confidence_auto_classify
FROM document_type_configs
WHERE enabled = true;

-- Add your custom document type
INSERT INTO document_type_configs (
  document_type, display_name, document_category,
  email_subject_patterns, content_keywords,
  min_confidence_auto_classify
) VALUES (
  'packing_list', 'Packing List', 'shipping',
  ARRAY['packing list', 'PL'],
  ARRAY['packing list number', 'net weight', 'gross weight'],
  85.00
);
```

### **3. Ingest First Email**

```sql
-- Insert raw email
INSERT INTO raw_emails (
  gmail_message_id, sender_email, subject, body_text,
  received_at, has_attachments
) VALUES (
  'msg-123456789',
  'booking@maersk.com',
  'Booking Confirmation - MAEU1234567890',
  'Dear Customer, Your booking has been confirmed...',
  NOW(),
  true
);

-- Your AI agent will process this email through layers 2 → 3
```

---

## Layer Breakdown

### **Layer 1: Raw Data Capture**

**Tables:**
- `raw_emails` - Complete email data (sender, subject, body, headers)
- `raw_attachments` - PDF/Excel/image files with OCR text extraction
- `raw_email_metadata` - Threading info, SPF/DKIM, custom headers

**Key Features:**
- **Immutable:** NEVER modify after insert (append-only)
- **Complete Audit Trail:** Store ALL emails, even if processing fails
- **Re-processable:** Body retained until shipment completion
- **Idempotent:** `UNIQUE(gmail_message_id)` prevents duplicates

**Example:**

```sql
-- Fetch unprocessed emails
SELECT id, gmail_message_id, sender_email, subject, received_at
FROM raw_emails
WHERE processing_status = 'pending'
ORDER BY received_at ASC
LIMIT 100;
```

---

### **Layer 2: Intelligence Layer**

**Tables:**
- `document_classifications` - AI classification with confidence scores
- `entity_extractions` - Extracted entities (booking #, container #, dates)
- `shipment_link_candidates` - AI-suggested document-to-shipment links
- `structured_extractions` - Complete JSONB data extraction

**Key Features:**
- **Confidence Scoring:** Every prediction has 0-100 confidence score
- **Human Feedback Loop:** `is_correct`, `corrected_value` for model training
- **Model Versioning:** Track which AI model made each prediction
- **Multi-Source:** Link to email OR attachment OR both

**AI Agent Workflow:**

```sql
-- 1. Classify document
INSERT INTO document_classifications (
  email_id, document_type, confidence_score,
  model_name, model_version, classification_reason
) VALUES (
  'email-uuid', 'booking_confirmation', 92.50,
  'claude-opus-3', '2025-01-15',
  'Subject contains "Booking Confirmation", sender is @maersk.com'
);

-- 2. Extract entities
INSERT INTO entity_extractions (
  email_id, entity_type, entity_value,
  confidence_score, extraction_method
) VALUES
  ('email-uuid', 'booking_number', 'MAEU1234567890', 98.00, 'regex'),
  ('email-uuid', 'etd', '2025-02-15', 85.00, 'llm'),
  ('email-uuid', 'carrier', 'Maersk', 99.00, 'sender_domain');

-- 3. Extract structured data (JSONB)
INSERT INTO structured_extractions (
  email_id, extracted_data, confidence_score,
  model_name, model_version
) VALUES (
  'email-uuid',
  '{
    "booking_number": "MAEU1234567890",
    "etd": "2025-02-15",
    "eta": "2025-03-10",
    "port_of_loading": "INNSA",
    "port_of_discharge": "USLAX",
    "shipper": "ABC Exports Pvt Ltd",
    "consignee": "XYZ Imports Inc"
  }'::jsonb,
  88.50,
  'claude-opus-3',
  '2025-01-15'
);

-- 4. Suggest shipment link
INSERT INTO shipment_link_candidates (
  email_id, shipment_id, confidence_score,
  matching_entities, linking_reason, link_status
) VALUES (
  'email-uuid', 'shipment-uuid', 95.00,
  '{"booking_number": "MAEU1234567890"}'::jsonb,
  'Exact booking number match',
  'auto_linked'  -- confidence >= 90%, auto-link
);
```

---

### **Layer 3: Decision Support**

**Tables:**
- `shipments` - Master shipment record (booking #, dates, status, financials)
- `shipment_documents` - Document register per shipment
- `shipment_events` - Complete timeline (booking confirmed, vessel departed, etc.)
- `shipment_parties` - Stakeholders (shipper, consignee, CHA, trucker)
- `shipment_financials` - All costs, invoices, payments
- `shipment_containers` - Container-level tracking with detention/demurrage

**Key Features:**
- **Shipment-Centric:** Normalized data optimized for queries
- **Permanent Storage:** NEVER deleted (only lifecycle_stage changes)
- **Source Tracking:** Every field links back to source email/attachment
- **Version Control:** Document amendments tracked with `version_number`

**Example: Create Shipment from Email**

```sql
-- 1. Create shipment from extracted data
INSERT INTO shipments (
  shipment_number, booking_number, shipment_mode, shipment_type,
  status, carrier_id, etd, eta,
  port_of_loading_code, port_of_discharge_code,
  created_from_email_id, lifecycle_stage
)
SELECT
  'SHP-' || nextval('shipment_seq'),  -- Auto-generate shipment #
  extracted_data->>'booking_number',
  'sea',
  'FCL',
  'booked',
  'maersk',
  (extracted_data->>'etd')::date,
  (extracted_data->>'eta')::date,
  'INNSA',
  'USLAX',
  email_id,
  'active'
FROM structured_extractions
WHERE email_id = 'email-uuid';

-- 2. Link document to shipment
INSERT INTO shipment_documents (
  shipment_id, document_type, document_category, document_direction,
  document_date, source_email_id, source_classification_id,
  status, is_latest_version
) VALUES (
  'shipment-uuid', 'booking_confirmation', 'shipping', 'received',
  CURRENT_DATE, 'email-uuid', 'classification-uuid',
  'received', true
);

-- 3. Create timeline event
INSERT INTO shipment_events (
  shipment_id, event_type, event_category, event_description,
  source_type, source_email_id, event_timestamp
) VALUES (
  'shipment-uuid', 'booking_confirmed', 'milestone',
  'Booking confirmed by Maersk - MAEU1234567890',
  'email', 'email-uuid', NOW()
);
```

---

### **Layer 4: Configuration**

**Tables:**
- `document_type_configs` - Document patterns (subject, sender, keywords)
- `extraction_rules` - Field-level extraction rules per document type
- `linking_rules` - How to link documents to shipments
- `carrier_configs` - Carrier-specific patterns (Maersk, Hapag, etc.)
- `ai_model_configs` - AI model parameters and performance tracking

**Key Features:**
- **Change Behavior WITHOUT Code:** Update patterns in database, no redeployment
- **A/B Testing:** Multiple linking rules with priorities
- **Model Performance Tracking:** Auto-calculate accuracy rates
- **Carrier-Specific:** Different patterns per shipping line

**Example: Add New Document Type**

```sql
-- 1. Define document type
INSERT INTO document_type_configs (
  document_type, display_name, document_category,
  email_subject_patterns, content_keywords,
  min_confidence_auto_classify, processing_priority
) VALUES (
  'cargo_manifest', 'Cargo Manifest', 'shipping',
  ARRAY['cargo manifest', 'manifest'],
  ARRAY['cargo description', 'HS code', 'weight', 'volume'],
  85.00, 7
);

-- 2. Define extraction rules
INSERT INTO extraction_rules (
  document_type, field_name, field_type, display_name,
  extraction_patterns, is_required
) VALUES
  ('cargo_manifest', 'manifest_number', 'string', 'Manifest Number',
   '{"regex": ["MANIFEST[0-9]{8}"]}'::jsonb, true),

  ('cargo_manifest', 'total_packages', 'number', 'Total Packages',
   '{"keywords": ["total packages", "no. of packages"]}'::jsonb, true),

  ('cargo_manifest', 'gross_weight', 'number', 'Gross Weight (KG)',
   '{"keywords": ["gross weight", "total weight"]}'::jsonb, false);

-- 3. AI agent will now automatically process cargo manifests!
```

---

## AI Agent Integration

### **Agent 1: Email Ingestion Agent**

**Purpose:** Fetch emails from Gmail/Outlook and store in Layer 1.

```typescript
// TypeScript example
class EmailIngestionAgent {
  async ingestEmail(gmailMessageId: string) {
    const email = await this.gmail.fetchEmail(gmailMessageId);

    // Idempotent insert
    const { data, error } = await supabase
      .from('raw_emails')
      .insert({
        gmail_message_id: gmailMessageId,
        sender_email: email.from,
        subject: email.subject,
        body_text: email.bodyText,
        body_html: email.bodyHtml,
        received_at: email.date,
        has_attachments: email.attachments.length > 0,
        headers: email.headers,
        labels: email.labels
      })
      .onConflict('gmail_message_id')
      .ignoreDuplicates();

    // Process attachments
    for (const attachment of email.attachments) {
      await this.processAttachment(data.id, attachment);
    }

    return data;
  }
}
```

---

### **Agent 2: Classification Agent**

**Purpose:** Classify document type with confidence scoring.

```typescript
class ClassificationAgent {
  async classifyEmail(emailId: string) {
    // 1. Fetch email
    const email = await supabase
      .from('raw_emails')
      .select('subject, sender_email, body_text')
      .eq('id', emailId)
      .single();

    // 2. Fetch classification patterns
    const { data: configs } = await supabase
      .from('document_type_configs')
      .select('*')
      .eq('enabled', true);

    // 3. Match patterns (simple rule-based)
    let bestMatch = { type: null, confidence: 0, reason: '' };

    for (const config of configs) {
      let score = 0;
      const matches = [];

      // Check subject patterns
      for (const pattern of config.email_subject_patterns) {
        if (email.subject.toLowerCase().includes(pattern.toLowerCase())) {
          score += 30;
          matches.push(`subject contains "${pattern}"`);
        }
      }

      // Check sender patterns
      for (const pattern of config.email_sender_patterns) {
        if (email.sender_email.includes(pattern)) {
          score += 20;
          matches.push(`sender matches "${pattern}"`);
        }
      }

      // Check content keywords
      for (const keyword of config.content_keywords) {
        if (email.body_text?.includes(keyword)) {
          score += 10;
          matches.push(`content contains "${keyword}"`);
        }
      }

      if (score > bestMatch.confidence) {
        bestMatch = {
          type: config.document_type,
          confidence: Math.min(score, 100),
          reason: matches.join(', ')
        };
      }
    }

    // 4. OR use LLM for classification
    const llmResult = await this.classifyWithLLM(email);

    // 5. Store classification
    await supabase.from('document_classifications').insert({
      email_id: emailId,
      document_type: llmResult.type,
      confidence_score: llmResult.confidence,
      model_name: 'claude-opus-3',
      model_version: '2025-01-15',
      classification_reason: llmResult.reason,
      matched_patterns: llmResult.patterns
    });

    return llmResult;
  }

  async classifyWithLLM(email: Email) {
    const prompt = `
      Classify this email into one of these document types:
      - booking_confirmation
      - commercial_invoice
      - si_draft
      - house_bl
      - arrival_notice
      - duty_entry
      - pod
      - vendor_invoice

      Email Subject: ${email.subject}
      Sender: ${email.sender_email}
      Body: ${email.body_text.substring(0, 1000)}

      Return JSON: {"type": "...", "confidence": 0-100, "reason": "..."}
    `;

    const response = await claude.complete(prompt);
    return JSON.parse(response);
  }
}
```

---

### **Agent 3: Extraction Agent**

**Purpose:** Extract structured data from emails/PDFs.

```typescript
class ExtractionAgent {
  async extractEntities(emailId: string) {
    // 1. Get email and classification
    const email = await this.getEmail(emailId);
    const classification = await this.getClassification(emailId);

    // 2. Get extraction rules for this document type
    const rules = await supabase
      .from('extraction_rules')
      .select('*')
      .eq('document_type', classification.document_type);

    // 3. Extract using LLM
    const extractionPrompt = `
      Extract the following fields from this ${classification.document_type}:
      ${rules.map(r => `- ${r.field_name} (${r.field_type}): ${r.display_name}`).join('\n')}

      Email:
      Subject: ${email.subject}
      Body: ${email.body_text}

      Return JSON with extracted values.
    `;

    const extracted = await claude.complete(extractionPrompt);
    const data = JSON.parse(extracted);

    // 4. Store structured extraction
    await supabase.from('structured_extractions').insert({
      email_id: emailId,
      classification_id: classification.id,
      extracted_data: data,
      confidence_score: 85.00,
      model_name: 'claude-opus-3',
      model_version: '2025-01-15'
    });

    // 5. Store individual entities
    for (const [entityType, entityValue] of Object.entries(data)) {
      if (entityValue) {
        await supabase.from('entity_extractions').insert({
          email_id: emailId,
          entity_type: entityType,
          entity_value: entityValue,
          confidence_score: 90.00,
          extraction_method: 'llm'
        });
      }
    }

    return data;
  }
}
```

---

### **Agent 4: Linking Agent**

**Purpose:** Link documents to shipments automatically.

```typescript
class LinkingAgent {
  async linkToShipment(emailId: string) {
    // 1. Get extracted entities
    const entities = await supabase
      .from('entity_extractions')
      .select('*')
      .eq('email_id', emailId);

    // 2. Find matching shipments
    const candidates = await this.findMatchingShipments(entities);

    // 3. Calculate confidence for each candidate
    for (const candidate of candidates) {
      const confidence = await this.calculateConfidence(
        candidate.shipment_id,
        entities,
        candidate.match_count
      );

      // 4. Store link candidate
      await supabase.from('shipment_link_candidates').insert({
        email_id: emailId,
        shipment_id: candidate.shipment_id,
        confidence_score: confidence,
        matching_entities: entities,
        linking_reason: `Matched ${candidate.match_count} entities`,
        link_status: confidence >= 90 ? 'auto_linked' : 'candidate'
      });

      // 5. If high confidence, auto-link
      if (confidence >= 90) {
        await this.createShipmentDocument(emailId, candidate.shipment_id);
      }
    }
  }

  async findMatchingShipments(entities: Entity[]) {
    // Build dynamic query based on entities
    const bookingNumbers = entities
      .filter(e => e.entity_type === 'booking_number')
      .map(e => e.entity_value);

    const containerNumbers = entities
      .filter(e => e.entity_type === 'container_number')
      .map(e => e.entity_value);

    // Find shipments matching these entities
    const { data } = await supabase
      .from('shipments')
      .select('id, shipment_number, booking_number')
      .or(`booking_number.in.(${bookingNumbers.join(',')}),id.in.(SELECT shipment_id FROM shipment_containers WHERE container_number IN (${containerNumbers.join(',')}))`)
      .eq('lifecycle_stage', 'active');

    return data;
  }
}
```

---

## Common Queries

### **Dashboard Queries**

```sql
-- 1. Active shipments summary
SELECT
  s.shipment_number,
  s.booking_number,
  s.status,
  s.etd,
  s.eta,
  s.carrier_name,
  COUNT(DISTINCT sd.id) as document_count,
  COUNT(DISTINCT se.id) as event_count
FROM shipments s
LEFT JOIN shipment_documents sd ON sd.shipment_id = s.id
LEFT JOIN shipment_events se ON se.shipment_id = s.id
WHERE s.lifecycle_stage = 'active'
  AND s.status NOT IN ('cancelled', 'completed')
GROUP BY s.id, s.shipment_number, s.booking_number, s.status, s.etd, s.eta, s.carrier_name
ORDER BY s.etd ASC;


-- 2. Documents per shipment
SELECT
  sd.document_type,
  sd.document_date,
  sd.status,
  re.subject as email_subject,
  re.sender_email,
  re.received_at,
  dc.confidence_score
FROM shipment_documents sd
LEFT JOIN raw_emails re ON re.id = sd.source_email_id
LEFT JOIN document_classifications dc ON dc.id = sd.source_classification_id
WHERE sd.shipment_id = 'shipment-uuid'
  AND sd.is_latest_version = true
ORDER BY sd.document_date DESC;


-- 3. Shipment timeline
SELECT
  se.event_type,
  se.event_description,
  se.event_timestamp,
  se.severity,
  re.subject as source_email_subject
FROM shipment_events se
LEFT JOIN raw_emails re ON re.id = se.source_email_id
WHERE se.shipment_id = 'shipment-uuid'
ORDER BY se.event_timestamp DESC;


-- 4. Financial summary per shipment
SELECT
  sf.transaction_type,
  sf.transaction_category,
  sf.vendor_name,
  sf.invoice_number,
  sf.amount,
  sf.currency,
  sf.payment_status
FROM shipment_financials sf
WHERE sf.shipment_id = 'shipment-uuid'
ORDER BY sf.invoice_date DESC;


-- 5. Documents needing review (low confidence)
SELECT
  re.subject,
  re.sender_email,
  re.received_at,
  dc.document_type,
  dc.confidence_score,
  slc.link_status
FROM raw_emails re
JOIN document_classifications dc ON dc.email_id = re.id
LEFT JOIN shipment_link_candidates slc ON slc.email_id = re.id
WHERE dc.confidence_score < 85
  OR slc.link_status = 'candidate'
ORDER BY re.received_at DESC;
```

### **AI Agent Queries**

```sql
-- 6. Get unprocessed emails
SELECT id, gmail_message_id, subject, sender_email, received_at
FROM raw_emails
WHERE processing_status = 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM document_classifications dc WHERE dc.email_id = raw_emails.id
  )
ORDER BY received_at ASC
LIMIT 100;


-- 7. Detect ETD changes
WITH latest_etd AS (
  SELECT
    slc.shipment_id,
    (se.extracted_data->>'etd')::date as new_etd,
    se.extracted_at,
    ROW_NUMBER() OVER (PARTITION BY slc.shipment_id ORDER BY se.extracted_at DESC) as rn
  FROM structured_extractions se
  JOIN shipment_link_candidates slc ON slc.email_id = se.email_id
  WHERE se.extracted_data ? 'etd'
    AND slc.link_status = 'auto_linked'
)
SELECT
  s.shipment_number,
  s.etd as old_etd,
  le.new_etd,
  le.extracted_at,
  EXTRACT(DAY FROM (le.new_etd - s.etd)) as delay_days
FROM shipments s
JOIN latest_etd le ON le.shipment_id = s.id AND le.rn = 1
WHERE s.etd IS DISTINCT FROM le.new_etd
  AND le.extracted_at > s.updated_at;


-- 8. Model performance tracking
SELECT
  model_name,
  model_version,
  COUNT(*) as total_classifications,
  COUNT(*) FILTER (WHERE is_correct = true) as correct,
  COUNT(*) FILTER (WHERE is_correct = false) as incorrect,
  ROUND(COUNT(*) FILTER (WHERE is_correct = true)::numeric / NULLIF(COUNT(*) FILTER (WHERE is_correct IS NOT NULL), 0) * 100, 2) as accuracy_pct
FROM document_classifications
WHERE is_correct IS NOT NULL
GROUP BY model_name, model_version
ORDER BY accuracy_pct DESC;
```

---

## Data Lifecycle

### **Shipment Lifecycle States**

```
1. ACTIVE (Days 0-90)
   - All raw data retained
   - AI continuously processing new emails
   - Dashboard shows live updates

2. COMPLETED (Days 90-120)
   - Shipment delivered, POD received
   - Grace period for final invoicing
   - Raw data still retained

3. ARCHIVED (Days 120+)
   - Raw email bodies PURGED (body_text, body_html → NULL)
   - Attachment files DELETED
   - Structured data retained PERMANENTLY
   - Dashboard shows historical view
```

### **Archival Process**

```sql
-- Find shipments ready for archival (completed > 30 days ago)
SELECT * FROM shipments_ready_for_archival;

-- Archive a shipment (purges raw data)
SELECT archive_completed_shipment('shipment-uuid');

-- Result:
-- {
--   "shipment_id": "uuid",
--   "emails_purged": 45,
--   "attachments_purged": 18,
--   "archived_at": "2025-12-24T10:30:00Z"
-- }
```

### **What Gets Kept vs Purged**

| Data Type | After Archival |
|-----------|----------------|
| `raw_emails.body_text` | ❌ PURGED (NULL) |
| `raw_emails.body_html` | ❌ PURGED (NULL) |
| `raw_emails.subject` | ✅ KEPT |
| `raw_emails.sender_email` | ✅ KEPT |
| `raw_attachments` records | ❌ DELETED |
| Attachment files (S3) | ❌ DELETED |
| `structured_extractions` | ✅ KEPT (JSON data) |
| `entity_extractions` | ✅ KEPT |
| `shipments` | ✅ KEPT (all fields) |
| `shipment_documents` metadata | ✅ KEPT |
| `shipment_events` | ✅ KEPT |
| `shipment_financials` | ✅ KEPT |

---

## Performance Optimization

### **Indexes Strategy**

**Already Created:**
- All foreign keys indexed
- Common WHERE clause fields (status, lifecycle_stage, etc.)
- Date ranges (received_at DESC, event_timestamp DESC)
- JSONB fields (GIN index on extracted_data)
- Partial indexes for pending/active records only

### **Query Optimization Tips**

1. **Use Partial Indexes:**
   ```sql
   -- Only index pending emails (not all 1M+ emails)
   CREATE INDEX idx_pending_emails ON raw_emails(processing_status)
   WHERE processing_status = 'pending';
   ```

2. **JSONB Queries:**
   ```sql
   -- Efficient: Uses GIN index
   SELECT * FROM structured_extractions
   WHERE extracted_data ? 'booking_number';

   -- Inefficient: Doesn't use index
   SELECT * FROM structured_extractions
   WHERE extracted_data->>'booking_number' = 'ABC123';
   ```

3. **Batch Processing:**
   ```sql
   -- Process 100 emails at a time, not all at once
   SELECT id FROM raw_emails
   WHERE processing_status = 'pending'
   ORDER BY received_at ASC
   LIMIT 100;
   ```

### **Auto-Vacuum Configuration**

```sql
-- High-churn tables (emails come/go frequently)
ALTER TABLE raw_emails SET (
  autovacuum_vacuum_scale_factor = 0.05,
  autovacuum_analyze_scale_factor = 0.02
);

-- Update statistics for better query planning
ANALYZE raw_emails;
ANALYZE document_classifications;
ANALYZE shipments;
```

---

## Best Practices

### **1. Idempotency**

**Always use ON CONFLICT for email ingestion:**

```sql
INSERT INTO raw_emails (gmail_message_id, ...)
VALUES ('msg-123', ...)
ON CONFLICT (gmail_message_id) DO NOTHING;
```

### **2. Error Handling**

**Store errors, don't fail silently:**

```sql
UPDATE raw_emails
SET processing_status = 'failed',
    processing_error = 'PDF extraction failed: Invalid format',
    processed_at = NOW()
WHERE id = 'email-uuid';
```

### **3. Confidence Thresholds**

**Use tiered confidence levels:**

- **90-100%:** Auto-link, auto-classify
- **75-89%:** Flag for review, but show in dashboard
- **0-74%:** Manual review required

### **4. Human Feedback Loop**

**Always track corrections for model training:**

```sql
-- User corrects a misclassification
UPDATE document_classifications
SET is_correct = false,
    corrected_type = 'si_draft',  -- Was classified as 'booking_confirmation'
    feedback_by = 'user-uuid',
    feedback_at = NOW()
WHERE id = 'classification-uuid';

-- Retrain model using feedback
SELECT
  document_type as predicted,
  corrected_type as actual,
  classification_reason
FROM document_classifications
WHERE is_correct = false
  AND feedback_at > NOW() - INTERVAL '30 days';
```

### **5. Versioning**

**Track document amendments:**

```sql
-- New SI draft arrives (2nd version)
INSERT INTO shipment_documents (
  shipment_id, document_type, version_number, is_latest_version
) VALUES (
  'shipment-uuid', 'si_draft', 2, true
);

-- Mark old version as superseded
UPDATE shipment_documents
SET is_latest_version = false,
    superseded_by = 'new-doc-uuid'
WHERE shipment_id = 'shipment-uuid'
  AND document_type = 'si_draft'
  AND version_number = 1;
```

---

## Troubleshooting

### **Problem: AI classifying everything as "unknown"**

**Diagnosis:**
```sql
SELECT document_type, COUNT(*)
FROM document_classifications
WHERE classified_at > NOW() - INTERVAL '7 days'
GROUP BY document_type;
```

**Solution:** Add more patterns to `document_type_configs`:
```sql
UPDATE document_type_configs
SET email_subject_patterns = email_subject_patterns || ARRAY['new pattern']
WHERE document_type = 'booking_confirmation';
```

---

### **Problem: Documents not linking to shipments**

**Diagnosis:**
```sql
SELECT link_status, COUNT(*)
FROM shipment_link_candidates
WHERE suggested_at > NOW() - INTERVAL '7 days'
GROUP BY link_status;
```

**Solution:** Lower confidence threshold or add more linking rules:
```sql
UPDATE linking_rules
SET base_confidence = 60.00  -- Lower from 70
WHERE rule_name = 'link_by_container_number';
```

---

### **Problem: Slow queries on large shipment tables**

**Diagnosis:**
```sql
EXPLAIN ANALYZE
SELECT * FROM shipments WHERE status = 'active';
```

**Solution:** Ensure indexes are being used:
```sql
-- Check if index exists
SELECT indexname FROM pg_indexes WHERE tablename = 'shipments';

-- Create missing index
CREATE INDEX IF NOT EXISTS idx_shipments_status ON shipments(status);

-- Update statistics
ANALYZE shipments;
```

---

### **Problem: Running out of storage**

**Diagnosis:**
```sql
SELECT
  COUNT(*) as total_emails,
  COUNT(*) FILTER (WHERE body_text IS NOT NULL) as emails_with_body,
  COUNT(*) FILTER (WHERE body_text IS NULL) as emails_purged
FROM raw_emails;
```

**Solution:** Archive old shipments:
```sql
-- Archive shipments completed > 30 days ago
SELECT shipment_number, archive_completed_shipment(id)
FROM shipments_ready_for_archival;
```

---

## Next Steps

1. **Deploy Schema:** Run `freight-intelligence-schema.sql` on your database
2. **Configure Document Types:** Customize patterns for your carriers
3. **Integrate AI Agents:** Use TypeScript examples above
4. **Test with Sample Data:** Insert test emails and verify classification
5. **Set Up Archival Cron:** Schedule daily archival of completed shipments
6. **Monitor Performance:** Track model accuracy and optimize thresholds

---

## Support

**Documentation:** This README
**Schema:** freight-intelligence-schema.sql
**Architecture:** CLAUDE.md principles
**Version:** 1.0.0

---

Built with ❤️ following "A Philosophy of Software Design" principles.
