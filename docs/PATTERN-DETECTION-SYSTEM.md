# Exhaustive Pattern Detection & Classification System

## Overview

This document describes the database-driven pattern detection system for email/document classification in INTDB.

**Philosophy:** Configuration Over Code - patterns stored in database, not hardcoded.

---

## Architecture

```
Email Input
    ↓
┌─────────────────────────────────────────────────────────────────┐
│                  DatabasePatternClassifier                       │
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────┐ │
│  │   Subject   │  │ Attachment  │  │ PDF Content │  │  Body  │ │
│  │  Patterns   │  │  Patterns   │  │  Patterns   │  │Patterns│ │
│  │ (Priority)  │  │ (Filename)  │  │ (Headers)   │  │(Backup)│ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └───┬────┘ │
│         │                │                │              │      │
│         └────────────────┼────────────────┼──────────────┘      │
│                          ▼                                      │
│                 Multi-Signal Scoring                            │
│                          │                                      │
│         ┌────────────────┼────────────────┐                    │
│         ▼                ▼                ▼                    │
│    ≥85% AUTO       70-84% REVIEW     <70% FALLBACK            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Pattern Types

| Type | Description | Confidence | When Used |
|------|-------------|------------|-----------|
| `subject` | Email subject line regex | 85-98% | First pass |
| `attachment` | Filename patterns | 88-98% | When attachments exist |
| `pdf_content` | PDF text markers | 95-99% | Most reliable |
| `body` | Email body keywords | 70-90% | Fallback |
| `sender` | Sender domain/patterns | N/A | Carrier detection |

---

## Database Tables

### `detection_patterns`
Main pattern storage with confidence scoring and analytics.

```sql
id                      UUID PRIMARY KEY
carrier_id              VARCHAR(50)         -- NULL for generic
pattern_type            VARCHAR(30)         -- subject, attachment, etc.
document_type           VARCHAR(100)        -- booking_confirmation, etc.
pattern                 TEXT                -- Regex pattern
pattern_flags           VARCHAR(10)         -- 'i' for case-insensitive
priority                INT                 -- Higher = checked first
confidence_base         INT                 -- Base score (0-100)
requires_pdf            BOOLEAN             -- Must have PDF attachment
requires_carrier_match  BOOLEAN             -- Carrier must match
exclude_patterns        TEXT[]              -- Skip if any match
require_all_patterns    TEXT[]              -- Must also match
example_matches         TEXT[]              -- Documentation
notes                   TEXT                -- Pattern notes
source                  VARCHAR(50)         -- carrier_docs, email_analysis
enabled                 BOOLEAN             -- Active flag
hit_count               INT                 -- Usage analytics
false_positive_count    INT                 -- Quality tracking
last_matched_at         TIMESTAMPTZ         -- Recent usage
```

### `sender_patterns`
Sender category detection for email direction and party type.

### `content_markers`
PDF content markers for document classification.

---

## Carrier-Specific Patterns

### Maersk (`@maersk.com`)
| Document Type | Subject Pattern | Example | Confidence |
|--------------|-----------------|---------|------------|
| booking_confirmation | `^Booking Confirmation\s*:\s*\d{9}` | Booking Confirmation : 263522431 | 96% |
| booking_amendment | `^Booking Amendment\s*:\s*\d{9}` | Booking Amendment : 262266445 | 93% |
| booking_cancellation | `^Booking Cancellation\s*:\s*\d{9}` | Booking Cancellation : 263625133 | 95% |
| arrival_notice | `^Arrival notice\s+\d{9}` | Arrival notice 261736030 | 95% |
| si_confirmation | `^SI submitted\s+\d{9}` | SI submitted 262874542-27Dec2025 | 94% |
| invoice | `^New invoice\s+[A-Z]{2}\d{2}IN\d+` | New invoice GJ26IN2500375201 | 92% |

### Hapag-Lloyd (`@hlag.com`, `@hapag-lloyd.com`)
| Document Type | Subject Pattern | Example | Confidence |
|--------------|-----------------|---------|------------|
| booking_confirmation | `^HL-\d{8}\s+[A-Z]{5}\s+[A-Z]` | HL-22970937 USNYC NORTHP | 95% |
| booking_amendment | `^\[Update\]\s+Booking\s+\d{8}` | [Update] Booking 22970937 | 93% |
| si_confirmation | `^Shipping Instruction Submitted\s*Sh#\d+` | Shipping Instruction Submitted Sh#19207547 | 94% |
| bill_of_lading | `^BL HLCL Sh#\s*\d+\s*Doc#\s*HL[A-Z0-9]+` | BL HLCL Sh#19207547 Doc#HLCUDE1251233590 | 92% |
| arrival_notice | `^ALERT\s*-\s*Bill of lading.*POD` | ALERT - Bill of lading HLCUBO... POD | 93% |

### CMA CGM (`@cma-cgm.com`)
| Document Type | Subject Pattern | Example | Confidence |
|--------------|-----------------|---------|------------|
| booking_confirmation | `^CMA CGM - Booking confirmation available` | CMA CGM - Booking confirmation available – CEI0329370 | 96% |
| si_confirmation | `^CMA CGM - Shipping instruction submitted` | CMA CGM - Shipping instruction submitted - AMC2475643 | 94% |
| arrival_notice | `^CMA CGM - Arrival notice available` | CMA CGM - Arrival notice available - AMC2459902 | 95% |

### COSCO (`@coscon.com`)
| Document Type | Subject Pattern | Example | Confidence |
|--------------|-----------------|---------|------------|
| booking_confirmation | `^Cosco Shipping Line Booking Confirmation\s*-\s*COSU\d{10}` | Cosco Shipping Line Booking Confirmation - COSU6439083630 | 96% |
| arrival_notice | `^COSCO Arrival Notice` | COSCO Arrival Notice with Freight COSU6435548630 | 95% |
| mbl_draft | `^COSCON\s*-\s*Proforma Bill of Lading` | COSCON - Proforma Bill of Lading for COSU6436834960 | 92% |

---

## Booking Number Formats

| Carrier | Format | Regex | Example |
|---------|--------|-------|---------|
| Maersk | 9 digits starting with 26 | `26\d{7}` | 263522431 |
| Hapag-Lloyd | HL- + 8 digits | `HL-\d{8}` | HL-22970937 |
| CMA CGM | CEI/AMC/CAD + 7 digits | `(CEI\|AMC\|CAD)\d{7}` | CEI0329370 |
| COSCO | COSU + 10 digits | `COSU\d{10}` | COSU6439083630 |
| MSC | Various | `MSCA[A-Z0-9]+` | MSCA123456 |

---

## BL Number Formats

| Carrier | Format | Regex | Example |
|---------|--------|-------|---------|
| Maersk | MAEU + 10-14 chars | `MAEU[A-Z0-9]{10,14}` | MAEU123456789012 |
| Hapag-Lloyd | HLCU + 10-14 chars | `HLCU[A-Z0-9]{10,14}` | HLCUDE1251233590 |
| CMA CGM | CMAU + 10-14 chars | `CMAU[A-Z0-9]{10,14}` | CMAU123456789012 |
| COSCO | COAU + 10-14 chars | `COAU[A-Z0-9]{10,14}` | COAU123456789012 |
| Intoglo HBL | SE + 10+ chars | `SE[A-Z0-9]{10,}` | SEIGL123456789 |

---

## Container Number Validation (ISO 6346)

Format: `[A-Z]{4}[0-9]{7}` (4 letters + 7 digits including check digit)

### Owner Codes by Carrier
| Carrier | Prefixes |
|---------|----------|
| Maersk | MAEU, MSKU |
| Hapag-Lloyd | HLCU, HLXU |
| CMA CGM | CMAU |
| COSCO | COSU |
| MSC | MSCU, MEDU |
| Leasing | TCLU, TRLU |

### Check Digit Algorithm
```typescript
function isValidContainerNumber(container: string): boolean {
  if (!/^[A-Z]{4}\d{7}$/.test(container)) return false;

  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const values: number[] = [];

  // Letters: value = (index + 10) + floor((index + 10) / 11)
  for (let i = 0; i < 4; i++) {
    const idx = alphabet.indexOf(container[i]);
    let value = idx + 10;
    value += Math.floor((idx + 10) / 11);
    values.push(value);
  }

  // Digits: face value
  for (let i = 4; i < 10; i++) {
    values.push(parseInt(container[i], 10));
  }

  // Weighted sum with powers of 2
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += values[i] * Math.pow(2, i);
  }

  // Check digit
  const checkDigit = sum % 11 % 10;
  return checkDigit === parseInt(container[10], 10);
}
```

---

## Confidence Scoring

### Base Confidence by Source
| Source | Confidence Range |
|--------|-----------------|
| PDF Content | 95-99% |
| Carrier-specific subject | 92-98% |
| Attachment filename | 90-96% |
| Generic subject | 70-85% |
| Body keywords | 60-90% |

### Confidence Boosts
| Condition | Boost |
|-----------|-------|
| Carrier matches pattern carrier | +3 |
| Carrier-specific pattern (vs generic) | +2 |
| PDF content matched | +3 |
| Multiple pattern types matched | +5 (2 types), +8 (3 types) |

### Decision Thresholds
| Confidence | Action |
|------------|--------|
| ≥85% | Auto-accept |
| 70-84% | Accept with review flag |
| <70% | Fallback to AI |

---

## API Usage

### Classify an Email
```typescript
import { createDatabasePatternClassifier } from '@/lib/services';

const classifier = createDatabasePatternClassifier(supabase);

const result = await classifier.classify({
  subject: 'Booking Confirmation : 263522431',
  senderEmail: 'in.export@maersk.com',
  attachmentFilenames: ['263522431.pdf'],
  pdfContent: 'BOOKING CONFIRMATION ... ETD: 2025-01-15',
  detectedCarrier: 'maersk',
});

// Result:
// {
//   documentType: 'booking_confirmation',
//   confidence: 98,
//   matches: [...],
//   classificationMethod: 'database_pattern',
//   needsManualReview: false,
// }
```

### Report False Positive
```typescript
await classifier.reportFalsePositive(patternId);
```

### Get Pattern Statistics
```typescript
const stats = await classifier.getPatternStats();
// {
//   totalPatterns: 150,
//   byType: { subject: 80, attachment: 30, pdf_content: 25, body: 15 },
//   topHitters: [...],
//   topFalsePositives: [...],
// }
```

---

## Adding New Patterns

### Via SQL
```sql
INSERT INTO detection_patterns (
  carrier_id, pattern_type, document_type, pattern,
  priority, confidence_base, example_matches, notes, source
) VALUES (
  'maersk',
  'subject',
  'new_document_type',
  '^New Pattern\s+\d+',
  90,
  92,
  ARRAY['New Pattern 123456'],
  'Description of when this pattern matches',
  'email_analysis'
);
```

### Via API (Future)
```typescript
await patternRepository.create({
  carrierId: 'maersk',
  patternType: 'subject',
  documentType: 'new_document_type',
  pattern: '^New Pattern\\s+\\d+',
  priority: 90,
  confidenceBase: 92,
});
```

---

## Best Practices

### Pattern Design
1. **Be specific** - Anchored patterns (`^`) are more reliable
2. **Use carrier prefixes** - `^Booking Confirmation : \d{9}` not just `Booking`
3. **Document examples** - Include `example_matches` for validation
4. **Set appropriate confidence** - Carrier-specific = 90-98%, Generic = 70-85%
5. **Add exclusions** - Use `exclude_patterns` for edge cases

### Pattern Testing
```sql
-- Test a pattern
SELECT *
FROM raw_emails
WHERE subject ~ '^Booking Confirmation\s*:\s*\d{9}'
LIMIT 10;
```

### Monitoring
```sql
-- Top performing patterns
SELECT pattern, hit_count, false_positive_count,
       ROUND(false_positive_count::numeric / NULLIF(hit_count, 0) * 100, 2) as fp_rate
FROM detection_patterns
WHERE hit_count > 0
ORDER BY hit_count DESC
LIMIT 20;
```

---

## Migration Steps

1. **Apply migration:** `045_exhaustive_detection_patterns.sql`
2. **Update services:** Use `DatabasePatternClassifier` instead of hardcoded patterns
3. **Monitor:** Track `hit_count` and `false_positive_count`
4. **Iterate:** Add new patterns based on misclassifications

---

## Continuous Learning System

The system includes a feedback loop for continuous improvement.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    Continuous Learning Pipeline                          │
│                                                                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐               │
│  │ LLM Judge    │───▶│ Manual Review │───▶│ Pattern      │               │
│  │ (Automated)  │    │ (Human)       │    │ Discovery    │               │
│  └──────┬───────┘    └──────┬────────┘    └──────┬───────┘               │
│         │                   │                    │                       │
│         └───────────────────┼────────────────────┘                       │
│                             ▼                                            │
│                    ┌────────────────┐                                    │
│                    │ Classification  │                                    │
│                    │ Reviews Table   │                                    │
│                    └────────┬───────┘                                    │
│                             │                                            │
│         ┌───────────────────┼───────────────────┐                       │
│         ▼                   ▼                   ▼                       │
│  ┌──────────────┐  ┌──────────────┐    ┌──────────────┐                 │
│  │ Pattern      │  │ Accuracy     │    │ New Pattern  │                 │
│  │ FP Tracking  │  │ Metrics      │    │ Candidates   │                 │
│  └──────────────┘  └──────────────┘    └──────────────┘                 │
└─────────────────────────────────────────────────────────────────────────┘
```

### Database Tables

#### `classification_reviews`
Stores feedback on classification accuracy from both LLM judge and manual review.

```sql
id                      UUID PRIMARY KEY
email_id                UUID REFERENCES raw_emails(id)
original_document_type  VARCHAR(100)
original_confidence     INTEGER
correct_document_type   VARCHAR(100)
is_correct              BOOLEAN
reviewer_type           VARCHAR(30)  -- 'llm_judge', 'manual', 'auto_verified'
reviewer_notes          TEXT
suggested_pattern       TEXT
reviewed_at             TIMESTAMPTZ
```

#### `pattern_candidates`
Stores discovered pattern candidates awaiting validation.

```sql
id                      UUID PRIMARY KEY
source_type             VARCHAR(30)  -- 'llm_suggestion', 'misclassification', 'manual_submission'
carrier_id              VARCHAR(50)
pattern_type            VARCHAR(30)
document_type           VARCHAR(100)
pattern                 TEXT
suggested_confidence    INTEGER
sample_matches          TEXT[]
validation_status       VARCHAR(30)  -- 'pending', 'approved', 'rejected', 'testing'
test_match_count        INTEGER
test_false_positive_count INTEGER
```

#### `llm_judge_decisions`
Stores LLM-based classification judgments with reasoning.

```sql
id                      UUID PRIMARY KEY
email_id                UUID REFERENCES raw_emails(id)
subject                 TEXT
assessed_document_type  VARCHAR(100)
confidence_score        INTEGER
reasoning               TEXT
system_document_type    VARCHAR(100)
agrees_with_system      BOOLEAN
suggested_new_pattern   TEXT
model_used              VARCHAR(100)
```

### API Endpoints

#### GET `/api/classification-feedback`

| Action | Description |
|--------|-------------|
| `?action=metrics&days=7` | Get accuracy metrics for last N days |
| `?action=pattern-stats` | Get pattern hit counts and statistics |
| `?action=pattern-effectiveness` | Get top performers and problematic patterns |
| `?action=candidates&status=pending` | Get pattern candidates awaiting review |
| `?action=emails-for-review&limit=50` | Get emails for manual review |
| `?action=classify-test&subject=...` | Test classification with subject |

#### POST `/api/classification-feedback`

| Action | Description |
|--------|-------------|
| `submit-review` | Submit a manual classification review |
| `run-llm-judge` | Run LLM judge on a single email |
| `batch-llm-review` | Run LLM judge on batch of emails |
| `create-pattern-candidate` | Submit a new pattern candidate |
| `test-pattern-candidate` | Test a pattern against existing emails |
| `promote-pattern` | Promote a candidate to active pattern |
| `discover-patterns` | Auto-discover patterns from misclassifications |
| `report-false-positive` | Report a false positive for a pattern |

### Scheduled Jobs

#### LLM Review Cron (`/api/cron/llm-review`)

Runs daily to:
1. Review low-confidence classifications using LLM
2. Discover new patterns from misclassifications
3. Report accuracy metrics

```bash
# Manual trigger (for testing)
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://your-app.vercel.app/api/cron/llm-review
```

### Usage Examples

#### Run LLM Judge on Email
```typescript
import { createClassificationFeedbackService } from '@/lib/services';

const feedbackService = createClassificationFeedbackService(supabase, anthropicApiKey);

const decision = await feedbackService.runLLMJudge({
  id: 'email-uuid',
  subject: 'Booking Confirmation : 263522431',
  sender: 'in.export@maersk.com',
  current_classification: 'document_share',
  current_confidence: 88,
});

// Result:
// {
//   assessed_document_type: 'booking_confirmation',
//   confidence_score: 96,
//   agrees_with_system: false,
//   reasoning: 'This is a Maersk booking confirmation...',
//   suggested_new_pattern: '^Booking Confirmation\\s*:\\s*\\d{9}'
// }
```

#### Submit Manual Review
```typescript
await feedbackService.submitReview({
  email_id: 'email-uuid',
  original_document_type: 'document_share',
  original_confidence: 88,
  original_method: 'database_pattern',
  correct_document_type: 'booking_confirmation',
  is_correct: false,
  reviewer_type: 'manual',
  reviewer_notes: 'This is clearly a Maersk booking confirmation',
  reviewed_by: 'user@company.com',
});
```

#### Promote Pattern to Production
```typescript
// 1. Get pending candidates
const candidates = await feedbackService.getPatternCandidates('pending');

// 2. Test a candidate
const testResult = await feedbackService.testPatternCandidate(candidates[0].id);
console.log(`Matches: ${testResult.matches}, False positives: ${testResult.false_positives}`);

// 3. If good, promote to active pattern
const patternId = await feedbackService.promotePatternCandidate(
  candidates[0].id,
  'approver@company.com'
);
```

---

## Sources

- [UN/EDIFACT Standards](https://www.edibasics.com/edi-resources/document-standards/edifact/)
- [ISO 6346 Container Codes](https://en.wikipedia.org/wiki/ISO_6346)
- [Maersk Support FAQs](https://www.maersk.com/support/faqs)
- [Hapag-Lloyd Online Business](https://www.hapag-lloyd.com/en/online-business)
- [CMA CGM Email Protocol](https://www.cma-cgm.com/assets/public/pdf/Email%20Protocol%20CMA%20CGM.pdf)
- [NLP for Logistics Documents](https://cargodocket.com/glossary/nlp-for-logistics-documents)
