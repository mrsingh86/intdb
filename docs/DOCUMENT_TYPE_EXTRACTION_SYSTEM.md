# Document-Type-Aware Extraction System

## Current State Analysis

### What We Have (Working)
| Component | Status | Description |
|-----------|--------|-------------|
| Document Classification | ✅ 40+ types | `content-classification-config.ts` |
| PDF Text Extraction | ✅ Working | `deep-pdf-extractor.ts` (text + tables + OCR) |
| Basic Entity Extraction | ✅ Working | booking#, container#, BL#, dates, ports |
| Stakeholder Service | ✅ Exists | Can process shipper/consignee IF provided |
| Attachment Extraction | ✅ Working | PDF, Excel, Word, Images |

### What's MISSING
| Gap | Impact |
|-----|--------|
| Document-type-specific extraction | BL draft extracted but no shipper/consignee |
| Invoice table extraction | Invoices classified but no line items |
| Party address parsing | Notify party exists but no structured address |
| Freight terms extraction | Prepaid/Collect not extracted |

---

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         EXTRACTION PIPELINE                              │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 1: Document Classification                                         │
│  Input: PDF text, filename                                               │
│  Output: document_type = "draft_mbl"                                     │
│  Source: content-classification-config.ts (existing)                     │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 2: Get Extraction Schema for Document Type                         │
│  Input: document_type                                                    │
│  Output: { required: [...], optional: [...], sections: [...] }          │
│  Source: DOCUMENT_EXTRACTION_SCHEMAS (NEW)                               │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 3: Section-Aware Extraction                                        │
│  For each section in document:                                           │
│    - Identify section (SHIPPER, CONSIGNEE, CARGO, etc.)                 │
│    - Apply section-specific patterns                                     │
│    - Extract structured data                                             │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 4: Validation & Normalization                                      │
│  - Validate extracted values                                             │
│  - Normalize addresses, names, dates                                     │
│  - Calculate confidence scores                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Document Extraction Schemas

### Schema Definition

```typescript
interface DocumentExtractionSchema {
  documentType: string;
  displayName: string;

  // Required fields - extraction fails without these
  requiredFields: EntityField[];

  // Optional fields - extract if present
  optionalFields: EntityField[];

  // Section markers - where to find data
  sections: SectionDefinition[];

  // Table extraction rules
  tables?: TableExtractionRule[];
}

interface EntityField {
  name: string;
  type: 'string' | 'date' | 'number' | 'address' | 'party' | 'amount';
  patterns?: RegExp[];
  labelPatterns?: RegExp[];  // "Shipper:", "SHIPPER", etc.
  validation?: (value: string) => boolean;
}

interface SectionDefinition {
  name: string;
  startMarkers: RegExp[];
  endMarkers?: RegExp[];
  fields: string[];  // Which fields to look for in this section
}

interface TableExtractionRule {
  name: string;
  headerPatterns: RegExp[];
  columns: { name: string; patterns: RegExp[] }[];
}
```

---

## Extraction Schemas by Document Type

### 1. Bill of Lading (MBL/HBL/Draft)

```typescript
{
  documentType: 'draft_mbl',
  displayName: 'Draft Master Bill of Lading',

  requiredFields: [
    { name: 'bl_number', type: 'string', patterns: [/B\/L\s*(?:NO|#)?[:\s]*([A-Z0-9]+)/i] },
    { name: 'shipper', type: 'party' },
    { name: 'consignee', type: 'party' },
  ],

  optionalFields: [
    { name: 'notify_party', type: 'party' },
    { name: 'vessel_name', type: 'string' },
    { name: 'voyage_number', type: 'string' },
    { name: 'port_of_loading', type: 'string' },
    { name: 'port_of_discharge', type: 'string' },
    { name: 'place_of_receipt', type: 'string' },
    { name: 'place_of_delivery', type: 'string' },
    { name: 'freight_terms', type: 'string', patterns: [/FREIGHT\s*(PREPAID|COLLECT)/i] },
    { name: 'container_numbers', type: 'string[]' },
    { name: 'seal_numbers', type: 'string[]' },
    { name: 'gross_weight', type: 'number' },
    { name: 'measurement', type: 'number' },
    { name: 'package_count', type: 'number' },
    { name: 'cargo_description', type: 'string' },
    { name: 'shipped_on_board_date', type: 'date' },
  ],

  sections: [
    {
      name: 'shipper_section',
      startMarkers: [/SHIPPER|EXPORTER/i],
      endMarkers: [/CONSIGNEE|NOTIFY/i],
      fields: ['shipper']
    },
    {
      name: 'consignee_section',
      startMarkers: [/CONSIGNEE|IMPORTER/i],
      endMarkers: [/NOTIFY|PORT OF LOADING/i],
      fields: ['consignee']
    },
    {
      name: 'notify_section',
      startMarkers: [/NOTIFY\s*PARTY|NOTIFY\s*ADDRESS/i],
      endMarkers: [/PORT|VESSEL|PRE-CARRIAGE/i],
      fields: ['notify_party']
    },
    {
      name: 'routing_section',
      startMarkers: [/PORT\s*OF\s*LOADING|VESSEL/i],
      endMarkers: [/CONTAINER|CARGO/i],
      fields: ['vessel_name', 'voyage_number', 'port_of_loading', 'port_of_discharge']
    },
    {
      name: 'cargo_section',
      startMarkers: [/CONTAINER|MARKS\s*AND\s*NUMBERS/i],
      endMarkers: [/FREIGHT|TOTAL|SHIPPED ON BOARD/i],
      fields: ['container_numbers', 'seal_numbers', 'cargo_description', 'gross_weight']
    }
  ]
}
```

### 2. Booking Confirmation

```typescript
{
  documentType: 'booking_confirmation',
  displayName: 'Booking Confirmation',

  requiredFields: [
    { name: 'booking_number', type: 'string' },
    { name: 'vessel_name', type: 'string' },
    { name: 'voyage_number', type: 'string' },
  ],

  optionalFields: [
    { name: 'etd', type: 'date' },
    { name: 'eta', type: 'date' },
    { name: 'port_of_loading', type: 'string' },
    { name: 'port_of_discharge', type: 'string' },
    { name: 'si_cutoff', type: 'date' },
    { name: 'vgm_cutoff', type: 'date' },
    { name: 'cargo_cutoff', type: 'date' },
    { name: 'gate_cutoff', type: 'date' },
    { name: 'container_type', type: 'string' },
    { name: 'container_count', type: 'number' },
    { name: 'commodity', type: 'string' },
    { name: 'shipper_reference', type: 'string' },
  ],

  sections: [
    {
      name: 'booking_header',
      startMarkers: [/BOOKING\s*(CONFIRMATION|NUMBER)/i],
      fields: ['booking_number']
    },
    {
      name: 'schedule_section',
      startMarkers: [/VESSEL|SCHEDULE|ROUTING/i],
      fields: ['vessel_name', 'voyage_number', 'etd', 'eta']
    },
    {
      name: 'cutoff_section',
      startMarkers: [/CUTOFF|CUT-OFF|DEADLINE/i],
      fields: ['si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff']
    }
  ]
}
```

### 3. Invoice (Freight/Duty)

```typescript
{
  documentType: 'freight_invoice',
  displayName: 'Freight Invoice',

  requiredFields: [
    { name: 'invoice_number', type: 'string' },
    { name: 'invoice_date', type: 'date' },
    { name: 'total_amount', type: 'amount' },
  ],

  optionalFields: [
    { name: 'due_date', type: 'date' },
    { name: 'currency', type: 'string' },
    { name: 'bl_number', type: 'string' },
    { name: 'booking_number', type: 'string' },
    { name: 'container_numbers', type: 'string[]' },
    { name: 'vendor_name', type: 'string' },
    { name: 'vendor_address', type: 'address' },
  ],

  tables: [
    {
      name: 'line_items',
      headerPatterns: [/DESCRIPTION|CHARGE|AMOUNT/i],
      columns: [
        { name: 'description', patterns: [/.+/] },
        { name: 'quantity', patterns: [/\d+/] },
        { name: 'rate', patterns: [/[\d,]+\.?\d*/] },
        { name: 'amount', patterns: [/[\d,]+\.\d{2}/] }
      ]
    }
  ]
}
```

### 4. Arrival Notice

```typescript
{
  documentType: 'arrival_notice',
  displayName: 'Arrival Notice',

  requiredFields: [
    { name: 'bl_number', type: 'string' },
    { name: 'vessel_name', type: 'string' },
    { name: 'eta', type: 'date' },
  ],

  optionalFields: [
    { name: 'consignee', type: 'party' },
    { name: 'notify_party', type: 'party' },
    { name: 'port_of_discharge', type: 'string' },
    { name: 'container_numbers', type: 'string[]' },
    { name: 'last_free_day', type: 'date' },
    { name: 'free_time_days', type: 'number' },
    { name: 'demurrage_rate', type: 'amount' },
    { name: 'storage_rate', type: 'amount' },
    { name: 'freight_status', type: 'string', patterns: [/FREIGHT\s*(PREPAID|COLLECT)/i] },
    { name: 'pickup_location', type: 'string' },
  ],

  sections: [
    {
      name: 'arrival_header',
      startMarkers: [/ARRIVAL\s*NOTICE/i],
      fields: ['bl_number', 'vessel_name', 'eta']
    },
    {
      name: 'demurrage_section',
      startMarkers: [/FREE\s*TIME|DEMURRAGE|STORAGE/i],
      fields: ['last_free_day', 'free_time_days', 'demurrage_rate']
    }
  ]
}
```

### 5. Commercial Invoice

```typescript
{
  documentType: 'commercial_invoice',
  displayName: 'Commercial Invoice',

  requiredFields: [
    { name: 'invoice_number', type: 'string' },
    { name: 'invoice_date', type: 'date' },
    { name: 'exporter', type: 'party' },
    { name: 'importer', type: 'party' },
    { name: 'total_value', type: 'amount' },
  ],

  optionalFields: [
    { name: 'currency', type: 'string' },
    { name: 'incoterms', type: 'string', patterns: [/\b(FOB|CIF|CFR|EXW|DDP|DAP|FCA)\b/] },
    { name: 'country_of_origin', type: 'string' },
    { name: 'hs_codes', type: 'string[]' },
    { name: 'po_number', type: 'string' },
  ],

  tables: [
    {
      name: 'line_items',
      headerPatterns: [/DESCRIPTION|HS\s*CODE|QUANTITY|VALUE/i],
      columns: [
        { name: 'description', patterns: [/.+/] },
        { name: 'hs_code', patterns: [/\d{4,10}/] },
        { name: 'quantity', patterns: [/\d+/] },
        { name: 'unit_price', patterns: [/[\d,]+\.?\d*/] },
        { name: 'total_value', patterns: [/[\d,]+\.\d{2}/] }
      ]
    }
  ]
}
```

### 6. Packing List

```typescript
{
  documentType: 'packing_list',
  displayName: 'Packing List',

  requiredFields: [
    { name: 'total_packages', type: 'number' },
    { name: 'gross_weight', type: 'number' },
  ],

  optionalFields: [
    { name: 'net_weight', type: 'number' },
    { name: 'total_volume', type: 'number' },
    { name: 'container_numbers', type: 'string[]' },
    { name: 'exporter', type: 'party' },
    { name: 'importer', type: 'party' },
  ],

  tables: [
    {
      name: 'package_details',
      headerPatterns: [/MARKS|PACKAGE|WEIGHT|DIMENSION/i],
      columns: [
        { name: 'marks', patterns: [/.+/] },
        { name: 'package_type', patterns: [/CARTON|PALLET|CRATE|BOX/i] },
        { name: 'quantity', patterns: [/\d+/] },
        { name: 'gross_weight', patterns: [/[\d,]+\.?\d*\s*(KG|KGS)?/i] },
        { name: 'dimensions', patterns: [/\d+\s*[xX×]\s*\d+\s*[xX×]\s*\d+/] },
        { name: 'volume', patterns: [/[\d,]+\.?\d*\s*(CBM|M3)?/i] }
      ]
    }
  ]
}
```

---

## Party (Address) Extraction

For shipper, consignee, notify_party:

```typescript
interface PartyExtraction {
  name: string;           // Company name (first line usually)
  address_line1: string;  // Street address
  address_line2?: string;
  city: string;
  state?: string;
  postal_code?: string;
  country: string;
  phone?: string;
  email?: string;
  contact_person?: string;
}

// Section-based extraction
function extractParty(sectionText: string): PartyExtraction {
  const lines = sectionText.split('\n').map(l => l.trim()).filter(Boolean);

  // First non-label line is usually company name
  const name = lines.find(l => !isLabel(l) && l.length > 3);

  // Look for country (last line often)
  const country = lines.find(l => isCountryName(l));

  // Look for phone/email
  const phone = extractPhone(sectionText);
  const email = extractEmail(sectionText);

  // Address is everything between name and country
  // ... parsing logic

  return { name, address_line1, city, country, phone, email };
}
```

---

## Implementation Plan

### Phase 1: Core Schema System
1. Create `document-extraction-schemas.ts` with all schemas
2. Add schema lookup by document type
3. Create section parser utility

### Phase 2: Section-Aware Extraction
1. Implement section boundary detection
2. Add field extraction within sections
3. Handle multi-line party addresses

### Phase 3: Table Extraction
1. Detect table boundaries
2. Parse column headers
3. Extract row data

### Phase 4: Integration
1. Hook into document classification pipeline
2. Store extracted entities in database
3. Feed to stakeholder service

---

## Database Schema Updates

```sql
-- Document-type-aware extractions
CREATE TABLE document_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id UUID REFERENCES raw_attachments(id),
  document_type VARCHAR(50) NOT NULL,
  extraction_schema_version VARCHAR(10),

  -- Structured extraction result
  extracted_data JSONB NOT NULL,

  -- Quality metrics
  required_fields_found INTEGER,
  required_fields_total INTEGER,
  optional_fields_found INTEGER,
  confidence_score INTEGER,

  -- Processing info
  extraction_method VARCHAR(20), -- 'regex' | 'ai' | 'hybrid'
  processing_time_ms INTEGER,

  created_at TIMESTAMP DEFAULT NOW()
);

-- Party extractions (normalized)
CREATE TABLE extracted_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_extraction_id UUID REFERENCES document_extractions(id),
  party_type VARCHAR(20), -- shipper, consignee, notify_party, exporter, importer

  name VARCHAR(255),
  address_line1 VARCHAR(255),
  address_line2 VARCHAR(255),
  city VARCHAR(100),
  state VARCHAR(100),
  postal_code VARCHAR(20),
  country VARCHAR(100),
  phone VARCHAR(50),
  email VARCHAR(255),

  confidence_score INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Invoice line items
CREATE TABLE extracted_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_extraction_id UUID REFERENCES document_extractions(id),
  line_number INTEGER,

  description TEXT,
  hs_code VARCHAR(20),
  quantity DECIMAL(10,2),
  unit VARCHAR(20),
  unit_price DECIMAL(12,2),
  total_amount DECIMAL(12,2),
  currency VARCHAR(3),

  created_at TIMESTAMP DEFAULT NOW()
);
```

---

## Summary

| Document Type | Key Entities to Extract |
|---------------|------------------------|
| **MBL/HBL** | shipper, consignee, notify_party, place_of_delivery, freight_terms |
| **Booking Confirmation** | cutoffs, vessel/voyage, container details |
| **Invoice** | line_items, totals, due_date, currency |
| **Arrival Notice** | demurrage dates, free_time, pickup_location |
| **Commercial Invoice** | exporter, importer, hs_codes, incoterms, line_items |
| **Packing List** | package_details, weights, volumes, dimensions |

This document-type-aware extraction system will ensure:
1. **Right entities for right documents** - BL gets shipper/consignee, invoice gets line items
2. **Section-aware parsing** - Find shipper section, extract address
3. **Table extraction** - Parse invoice line items properly
4. **Validation** - Required fields must be present
