# Entity Extraction Architecture Analysis

Generated: 2026-01-06T17:34:40.776Z
Model: Claude Opus 4.5

---

# Entity Extraction Architecture Analysis & Recommendations

## Executive Summary

**Yes, entity extraction should be separated** into email content extraction and document content extraction. This separation aligns with the fundamental differences in content structure, extraction patterns, and business usage of these two data sources.

## 1. Should Extraction Be Separated?

### ✅ **Recommendation: Separate Extraction**

### Pros:
- **Different Content Structures**: Emails contain conversational text; PDFs have structured layouts
- **Different Extraction Methods**: Emails benefit from NLP; PDFs need OCR + layout analysis
- **Performance Optimization**: Can parallelize email/PDF processing
- **Cleaner Data Model**: Avoids nullable columns for PDF-specific fields
- **Better Accuracy**: Specialized extractors for each content type
- **Easier Debugging**: Clear separation of extraction failures

### Cons:
- **Query Complexity**: Need joins to get complete shipment picture
- **Duplicate Logic**: Some patterns (booking numbers) appear in both
- **Data Reconciliation**: Must merge/deduplicate entities from both sources

### Typical Entity Distribution:

**Email Content (Subject/Body)**:
- Booking confirmations (brief)
- Status updates
- Cutoff reminders
- Vessel/voyage changes
- Quick references (booking/container numbers)

**PDF Attachments**:
- Complete booking details
- Commercial invoices
- Bills of lading
- Arrival notices with charges
- Shipping instructions
- Customs documents

## 2. Proposed Data Model

```sql
-- ============================================================================
-- Email Extractions (from subject/body text)
-- ============================================================================
CREATE TABLE email_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id UUID NOT NULL REFERENCES emails(id),
  
  -- Entity Information
  entity_type TEXT NOT NULL, -- booking_number, vessel_name, etc.
  entity_value TEXT NOT NULL,
  entity_normalized TEXT, -- Standardized format
  
  -- Extraction Metadata
  confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  extraction_method TEXT NOT NULL, -- regex_subject, regex_body, ai_nlp
  source_field TEXT NOT NULL, -- subject, body_text, body_html
  
  -- Position/Context (for debugging/highlighting)
  context_snippet TEXT, -- 50 chars before/after
  position_start INTEGER,
  position_end INTEGER,
  
  -- Validation
  is_valid BOOLEAN DEFAULT true,
  validation_errors JSONB,
  
  -- Timestamps
  extracted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Indexes
  CONSTRAINT email_extractions_unique UNIQUE (email_id, entity_type, entity_value)
);

CREATE INDEX idx_email_extractions_email_id ON email_extractions(email_id);
CREATE INDEX idx_email_extractions_entity_type ON email_extractions(entity_type);
CREATE INDEX idx_email_extractions_confidence ON email_extractions(confidence_score);

-- ============================================================================
-- Document Extractions (from PDF/attachment content)
-- ============================================================================
CREATE TABLE document_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id UUID NOT NULL REFERENCES attachments(id),
  email_id UUID NOT NULL REFERENCES emails(id), -- Denormalized for queries
  
  -- Entity Information
  entity_type TEXT NOT NULL,
  entity_value TEXT NOT NULL,
  entity_normalized TEXT,
  
  -- Document Context
  page_number INTEGER, -- Which page in PDF
  section_name TEXT, -- "header", "cargo_details", "party_section", etc.
  table_name TEXT, -- If extracted from a table
  table_row INTEGER, -- Row number in table
  table_column TEXT, -- Column name in table
  
  -- Visual Context (for PDF layout)
  bbox_x1 FLOAT, -- Bounding box coordinates
  bbox_y1 FLOAT,
  bbox_x2 FLOAT,
  bbox_y2 FLOAT,
  
  -- Extraction Metadata
  confidence_score INTEGER NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  extraction_method TEXT NOT NULL, -- ocr_pattern, table_parser, ai_vision, form_field
  
  -- Validation
  is_valid BOOLEAN DEFAULT true,
  validation_errors JSONB,
  
  -- Document Metadata
  document_type TEXT NOT NULL, -- booking_confirmation, invoice, etc.
  document_revision INTEGER DEFAULT 1,
  is_latest_revision BOOLEAN DEFAULT true,
  
  -- Timestamps
  extracted_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Indexes
  CONSTRAINT document_extractions_unique UNIQUE (attachment_id, entity_type, entity_value, page_number)
);

CREATE INDEX idx_document_extractions_attachment_id ON document_extractions(attachment_id);
CREATE INDEX idx_document_extractions_email_id ON document_extractions(email_id);
CREATE INDEX idx_document_extractions_entity_type ON document_extractions(entity_type);
CREATE INDEX idx_document_extractions_document_type ON document_extractions(document_type);

-- ============================================================================
-- Unified View for Queries
-- ============================================================================
CREATE VIEW unified_extractions AS
SELECT 
  e.id,
  e.email_id,
  NULL::UUID as attachment_id,
  e.entity_type,
  e.entity_value,
  e.entity_normalized,
  e.confidence_score,
  e.extraction_method,
  'email' as source_type,
  e.source_field as source_detail,
  e.is_valid,
  e.extracted_at
FROM email_extractions e

UNION ALL

SELECT 
  d.id,
  d.email_id,
  d.attachment_id,
  d.entity_type,
  d.entity_value,
  d.entity_normalized,
  d.confidence_score,
  d.extraction_method,
  'document' as source_type,
  COALESCE(d.section_name, 'page_' || d.page_number::TEXT) as source_detail,
  d.is_valid,
  d.extracted_at
FROM document_extractions d;

-- ============================================================================
-- Aggregated Shipment View (Best entity values across sources)
-- ============================================================================
CREATE VIEW shipment_entities AS
WITH ranked_entities AS (
  SELECT 
    email_id,
    entity_type,
    entity_value,
    entity_normalized,
    confidence_score,
    source_type,
    ROW_NUMBER() OVER (
      PARTITION BY email_id, entity_type 
      ORDER BY confidence_score DESC, 
               CASE source_type WHEN 'document' THEN 1 ELSE 2 END
    ) as rank
  FROM unified_extractions
  WHERE is_valid = true
)
SELECT * FROM ranked_entities WHERE rank = 1;
```

## 3. Extraction Logic Differences

### Email Extraction Patterns

```typescript
// lib/services/extraction/email-content-extractor.ts

export class EmailContentExtractor {
  /**
   * Email-specific extraction strategies:
   * 1. Subject line has highest signal (booking confirmations)
   * 2. Email body often has conversational wrappers
   * 3. Signatures and disclaimers create noise
   */
  
  async extract(email: EmailData): Promise<EmailExtraction[]> {
    const extractions: EmailExtraction[] = [];
    
    // Strategy 1: Subject Line Patterns (High Confidence)
    // Subject lines are curated by senders for key info
    const subjectPatterns = {
      booking_number: [
        /Booking\s+(?:Confirmation|Confirmed).*?(\d{9,10})/i,
        /BKG\s*#?\s*(\d{9,10})/i,
        /Reference:\s*(\w+\d{7,10})/i,
      ],
      vessel_voyage: [
        /MV\s+([A-Z][A-Z\s]+)\s+V\.?\s*(\d{3,4}[A-Z]?)/i,
        /Vessel:\s*([^,]+),?\s*Voyage:\s*(\S+)/i,
      ],
      container_number: [
        /Container:\s*([A-Z]{4}\d{7})/i,
        /CNTR\s*#?\s*([A-Z]{4}\d{7})/i,
      ],
    };
    
    // Strategy 2: Email Body Patterns (Medium Confidence)
    // Must handle conversational context
    const bodyPatterns = {
      cutoff_dates: [
        // Email-specific: often in reminder format
        /(?:Please\s+note|Kindly\s+note|Reminder).*?SI\s+Cut-?off:?\s*(\d{1,2}[-/]\w{3}[-/]\d{2,4})/i,
        /VGM\s+deadline:?\s*(\d{1,2}[-/]\w{3}[-/]\d{2,4}\s+\d{1,2}:\d{2})/i,
      ],
      status_updates: [
        /Your\s+shipment.*?is\s+now\s+(confirmed|rolled|cancelled)/i,
        /Booking\s+status.*?:\s*(\w+)/i,
      ],
    };
    
    // Strategy 3: Signature Removal
    const cleanedBody = this.removeEmailSignature(email.bodyText);
    
    // Strategy 4: Thread Context
    // Later emails in thread may reference earlier bookings
    if (email.inReplyTo) {
      extractions.push(...await this.extractFromThreadContext(email));
    }
    
    return extractions;
  }
  
  private removeEmailSignature(text: string): string {
    // Remove common signature patterns
    const signatureMarkers = [
      /^--\s*$/m,
      /^Best\s+regards,?$/mi,
      /^Sincerely,?$/mi,
      /^Thanks,?$/mi,
      /^Sent\s+from\s+my/mi,
    ];
    
    let cutoffIndex = text.length;
    for (const marker of signatureMarkers) {
      const match = text.match(marker);
      if (match && match.index) {
        cutoffIndex = Math.min(cutoffIndex, match.index);
      }
    }
    
    return text.substring(0, cutoffIndex);
  }
}
```

### Document Extraction Patterns

```typescript
// lib/services/extraction/document-content-extractor.ts

export class DocumentContentExtractor {
  /**
   * PDF-specific extraction strategies:
   * 1. Layout analysis for structured data
   * 2. Table extraction for cargo details
   * 3. Form field detection
   * 4. Multi-page context preservation
   */
  
  async extract(attachment: AttachmentData): Promise<DocumentExtraction[]> {
    const extractions: DocumentExtraction[] = [];
    
    // Strategy 1: Document Type Detection
    const docType = await this.detectDocumentType(attachment);
    
    // Strategy 2: Layout-Based Extraction
    switch (docType) {
      case 'booking_confirmation':
        extractions.push(...await this.extractBookingConfirmation(attachment));
        break;
      case 'invoice':
        extractions.push(...await this.extractInvoice(attachment));
        break;
      case 'bill_of_lading':
        extractions.push(...await this.extractBillOfLading(attachment));
        break;
    }
    
    return extractions;
  }
  
  private async extractBookingConfirmation(attachment: AttachmentData) {
    // PDF-specific: Structured sections
    const sections = {
      header: {
        bbox: { x1: 0, y1: 0, x2: 1, y2: 0.2 }, // Top 20% of page
        entities: ['booking_number', 'booking_date', 'carrier_reference'],
      },
      voyage_section: {
        bbox: { x1: 0, y1: 0.2, x2: 1, y2: 0.4 },
        entities: ['vessel_name', 'voyage_number', 'service_name'],
      },
      routing_table: {
        // Tables need special handling
        tableHeaders: ['Port', 'Terminal', 'Date', 'Time'],
        entities: ['port_of_loading', 'port_of_discharge', 'etd', 'eta'],
      },
      cargo_details: {
        // Multi-row tables
        tableHeaders: ['Container', 'Type', 'Weight', 'Volume'],
        entities: ['container_numbers', 'container_type', 'weight_kg', 'volume_cbm'],
      },
      cutoff_section: {
        // Often in a highlighted box
        visualCues: ['highlighted', 'bordered'],
        entities: ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff'],
      },
    };
    
    // Extract using layout analysis
    const extractions = [];
    for (const [sectionName, config] of Object.entries(sections)) {
      const sectionExtractions = await this.extractFromSection(
        attachment,
        sectionName,
        config
      );
      extractions.push(...sectionExtractions);
    }
    
    return extractions;
  }
  
  private async extractFromTable(
    pdfContent: string,
    tableConfig: TableConfig
  ): Promise<DocumentExtraction[]> {
    // PDF tables require special parsing
    const tableData = await this.parseTable(pdfContent, tableConfig);
    
    // Convert table rows to entities
    const extractions = [];
    for (const [rowIndex, row] of tableData.entries()) {
      for (const [colName, value] of Object.entries(row)) {
        if (value && this.isRelevantColumn(colName, tableConfig)) {
          extractions.push({
            entity_type: this.mapColumnToEntityType(colName),
            entity_value: value,
            table_name: tableConfig.name,
            table_row: rowIndex,
            table_column: colName,
            confidence_score: 90, // High confidence for structured data
            extraction_method: 'table_parser',
          });
        }
      }
    }
    
    return extractions;
  }
}
```

## 4. Document Type Specific Considerations

### Booking Confirmation

**Email Content**:
- Subject: Booking number, status (confirmed/amended)
- Body: Brief confirmation, cutoff reminders, action items

**PDF Content**:
- Complete booking details (all parties, cargo, routing)
- Detailed cutoff schedule
- Terms and conditions
- Container allocation

### Arrival Notice

**Email Content**:
- Subject: Vessel arrival, container numbers
- Body: Brief arrival info, pickup instructions

**PDF Content**:
- Detailed charge breakdown
- Free time details
- Terminal information
- Customs status
- Complete container list with charges

### Invoice

**Email Content**:
- Subject: Invoice number, amount
- Body: Payment instructions, due date

**PDF Content**:
- Line items with HS codes
- Tax breakdown
- Bank details
- Packing list reference

## 5. Recommended Architecture

### Service Structure

```
lib/services/extraction/
├── orchestrator/
│   ├── extraction-orchestrator.ts      # Main coordinator
│   └── extraction-queue.ts             # Async processing
├── email/
│   ├── email-content-extractor.ts      # Email-specific logic
│   ├── email-pattern-matcher.ts       # Regex patterns
│   └── email-nlp-extractor.ts         # AI/NLP extraction
├── document/
│   ├── document-content-extractor.ts   # PDF-specific logic
│   ├── document-layout-analyzer.ts    # Layout analysis
│   ├── document-table-parser.ts       # Table extraction
│   └── document-ocr-service.ts        # OCR integration
├── common/
│   ├── entity-validator.ts            # Shared validation
│   ├── entity-normalizer.ts           # Standardization
│   └── confidence-calculator.ts       # Scoring logic
└── storage/
    ├── extraction-repository.ts        # Database operations
    └── extraction-cache.ts             # Redis caching
```

### Data Flow Diagram

```
┌─────────────────┐
│  Email Arrives  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Orchestrator  │
└────────┬────────┘
         │
         ├─────────────────┬─────────────────┐
         ▼                 ▼                 ▼
┌─────────────────┐ ┌─────────────┐ ┌──────────────┐
│ Email Extractor │ │ Attachment  │ │   Document   │
│                 │ │  Detector   │ │  Classifier  │
└────────┬────────┘ └──────┬──────┘ └──────┬───────┘
         │                 │                │
         ▼                 ▼                ▼
┌─────────────────┐ ┌─────────────┐ ┌──────────────┐
│ Email Patterns  │ │   PDF?      │ │   Doc Type   │
│ Email NLP       │ │   Image?    │ │   Router     │
└────────┬────────┘ └──────┬──────┘ └──────┬───────┘
         │                 │                │
         ▼                 ▼                ▼
┌─────────────────┐ ┌─────────────────────────────┐
│Email Extractions│ │   Document Extractors       │
│   Repository    │ │ ├─ Booking Confirmation    │
└─────────────────┘ │ ├─ Invoice                 │
                    │ ├─ Bill of Lading          │
                    │ └─ Arrival Notice          │
                    └──────────┬──────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │Document Extractions  │
                    │    Repository        │
                    └──────────────────────┘
                               │
                               ▼
                    ┌──────────────────────┐
                    │  Unified View API    │
                    │  (GraphQL/REST)      │
                    └──────────────────────┘
```

### Implementation Example

```typescript
// lib/services/extraction/orchestrator/extraction-orchestrator.ts

export class ExtractionOrchestrator {
  constructor(
    private emailExtractor: EmailContentExtractor,
    private documentExtractor: DocumentContentExtractor,
    private repository: ExtractionRepository,
    private queue: ExtractionQueue
  ) {}

  async processEmail(emailId: string): Promise<ExtractionResult> {
    const email = await this.repository.getEmail(emailId);
    
    // Parallel extraction
    const [emailExtractions, attachmentResults] = await Promise.all([
      this.extractFromEmail(email),
      this.processAttachments(email.attachments),
    ]);
    
    // Store results
    await Promise.all([
      this.repository.saveEmailExtractions(emailExtractions),
      this.repository.saveDocumentExtractions(attachmentResults.flat()),
    ]);
    
    // Build unified result
    return this.buildUnifiedResult(emailId, emailExtractions, attachmentResults);
  }
  
  private async extractFromEmail(email: EmailData): Promise<EmailExtraction[]> {
    const extractions = await this.emailExtractor.extract(email);
    
    // Validate and normalize
    return extractions
      .map(e => this.validateAndNormalize(e))
      .filter(e => e.confidence_score >= CONFIDENCE_THRESHOLDS[e.entity_type]);
  }
  
  private async processAttachments(
    attachments: AttachmentData[]
  ): Promise<DocumentExtraction[][]> {
    // Process each attachment in parallel
    return Promise.all(
      attachments.map(att => this.documentExtractor.extract(att))
    );
  }
  
  private buildUnifiedResult(
    emailId: string,
    emailExtractions: EmailExtraction[],
    documentExtractions: DocumentExtraction[][]
  ): ExtractionResult {
    // Merge and deduplicate entities
    const allExtractions = [
      ...emailExtractions,
      ...documentExtractions.flat(),
    ];
    
    // Group by entity type and select best value
    const bestEntities = this.selectBestEntities(allExtractions);
    
    return {
      emailId,
      entities: bestEntities,
      metadata: {
        emailExtractionCount: emailExtractions.length,
        documentExtractionCount: documentExtractions.flat().length,
        confidence: this.calculateOverallConfidence(bestEntities),
      },
    };
  }
}
```

### Migration Strategy

1. **Phase 1: Schema Migration** (Week 1)
   - Create new tables alongside existing `entity_extractions`
   - Add migration scripts to split existing data

2. **Phase 2: Dual Write** (Week 2-3)
   - Update extraction service to write to both old and new tables
   - Validate data consistency

3. **Phase 3: Read Migration** (Week 4)
   - Update queries to use new tables
   - Create unified views for backward compatibility

4. **Phase 4: Cleanup** (Week 5)
   - Remove old table
   - Update all dependent services

```sql
-- Migration script example
INSERT INTO email_extractions (
  email_id, entity_type, entity_value, entity_normalized,
  confidence_score, extraction_method, source_field,
  context_snippet, position_start, position_end,
  is_valid, validation_errors, extracted_at
)
SELECT 
  email_id, entity_type, entity_value, entity_normalized,
  confidence_score, extraction_method, 
  CASE 
    WHEN extraction_method LIKE '%subject%' THEN 'subject'
    ELSE 'body_text'
  END as source_field,
  context_snippet, position_start, position_end,
  is_valid, validation_errors, extracted_at
FROM entity_extractions
WHERE attachment_id IS NULL;

INSERT INTO document_extractions (
  attachment_id, email_id, entity_type, entity_value, entity_normalized,
  confidence_score, extraction_method, document_type,
  is_valid, validation_errors, extracted_at
)
SELECT 
  attachment_id, email_id, entity_type, entity_value, entity_normalized,
  confidence_score, extraction_method, source_document_type,
  is_valid, validation_errors, extracted_at
FROM entity_extractions
WHERE attachment_id IS NOT NULL;
```

This architecture provides clear separation of concerns, optimized extraction for each content type, and a smooth migration path from the current system.
