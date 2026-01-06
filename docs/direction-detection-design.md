# Standalone Direction Detection Service - Design

## Problem Statement

Current direction detection has 26% mismatch rate between email and document directions:
- `email_direction` computed from `sender_email` (wrong)
- `document_direction` computed from `true_sender_email` (correct but inconsistent)
- `true_sender_email` not populated for "via" pattern emails

## Requirements

1. **Single source of truth** - One service determines direction for both emails AND documents
2. **Deep thread navigation** - Handle reply chains, forwards, Google Groups
3. **True sender extraction** - Parse "Name via Group" patterns
4. **Retroactive fix** - Can re-process existing emails

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                  DirectionDetectionService                   │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────────────┐    ┌──────────────────┐               │
│  │ TrueSenderExtractor│    │ DomainClassifier │               │
│  │                    │    │                  │               │
│  │ - parseViaPattern  │    │ - isIntogloDomain│               │
│  │ - parseForwardHeader│   │ - isCarrierDomain│               │
│  │ - parseReplyChain  │    │ - isClientDomain │               │
│  └────────┬───────────┘    └────────┬─────────┘               │
│           │                         │                         │
│           ▼                         ▼                         │
│  ┌──────────────────────────────────────────────┐            │
│  │           DirectionResolver                   │            │
│  │                                               │            │
│  │ Input: email headers, sender, subject         │            │
│  │ Output: {                                     │            │
│  │   direction: 'inbound' | 'outbound',          │            │
│  │   trueSender: string,                         │            │
│  │   confidence: number,                         │            │
│  │   reasoning: string                           │            │
│  │ }                                             │            │
│  └───────────────────────────────────────────────┘            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Direction Rules (Priority Order)

### 1. True Sender Extraction (First)

```typescript
function extractTrueSender(email: Email): string {
  // Priority 1: X-Original-Sender header (Google Groups)
  if (email.headers['X-Original-Sender']) {
    return email.headers['X-Original-Sender'];
  }

  // Priority 2: Parse "Name via Group" pattern
  // "'CMA CGM Website' via pricing" <pricing@intoglo.com>
  const viaMatch = email.senderEmail.match(/['"]?([^'"]+)['"]?\s+via\s+/i);
  if (viaMatch) {
    // Try to find email in the name part or use domain heuristics
    return extractEmailFromName(viaMatch[1]) || email.senderEmail;
  }

  // Priority 3: Reply-To header (often has original sender)
  if (email.headers['Reply-To'] && !isIntogloDomain(email.headers['Reply-To'])) {
    return email.headers['Reply-To'];
  }

  // Priority 4: Return-Path header
  if (email.headers['Return-Path'] && !isIntogloDomain(email.headers['Return-Path'])) {
    return email.headers['Return-Path'];
  }

  // Default: use sender_email
  return email.senderEmail;
}
```

### 2. Direction Classification

```typescript
function detectDirection(trueSender: string, subject: string): DirectionResult {
  const domain = extractDomain(trueSender);

  // Rule 1: Intoglo domain = OUTBOUND
  if (isIntogloDomain(domain)) {
    // Exception: Check if it's a forwarded carrier email by subject
    if (isCarrierSubjectPattern(subject) && !isReply(subject)) {
      return { direction: 'inbound', confidence: 0.8, reasoning: 'Carrier pattern in subject' };
    }
    return { direction: 'outbound', confidence: 0.95, reasoning: 'Intoglo sender domain' };
  }

  // Rule 2: Known carrier domain = INBOUND
  if (isCarrierDomain(domain)) {
    return { direction: 'inbound', confidence: 0.99, reasoning: 'Carrier sender domain' };
  }

  // Rule 3: Everything else = INBOUND (external party)
  return { direction: 'inbound', confidence: 0.9, reasoning: 'External sender domain' };
}
```

### 3. Thread-Aware Direction

For threaded conversations:
- Original email in thread determines base direction
- Replies flip direction (if we sent original, replies are inbound)
- Forwards maintain original sender's direction

```typescript
function detectThreadDirection(email: Email, thread: Email[]): DirectionResult {
  // If this is a reply
  if (email.inReplyToMessageId) {
    const parentEmail = thread.find(e => e.messageId === email.inReplyToMessageId);
    if (parentEmail) {
      const parentDirection = detectDirection(parentEmail);
      // Reply to inbound = outbound (we're responding)
      // Reply to outbound = inbound (they're responding)
      return flipDirection(parentDirection);
    }
  }

  // For original email in thread or no parent found
  return detectDirection(extractTrueSender(email), email.subject);
}
```

## Database Changes

```sql
-- Add columns to raw_emails
ALTER TABLE raw_emails ADD COLUMN IF NOT EXISTS direction_v2 VARCHAR(20);
ALTER TABLE raw_emails ADD COLUMN IF NOT EXISTS direction_confidence DECIMAL(3,2);
ALTER TABLE raw_emails ADD COLUMN IF NOT EXISTS direction_reasoning TEXT;
ALTER TABLE raw_emails ADD COLUMN IF NOT EXISTS extracted_true_sender VARCHAR(255);

-- Index for re-processing
CREATE INDEX idx_emails_direction_null ON raw_emails(id) WHERE direction_v2 IS NULL;
```

## API

```typescript
interface DirectionDetectionService {
  // Detect direction for a single email
  detectEmailDirection(emailId: string): Promise<DirectionResult>;

  // Detect direction for email + all its documents
  detectEmailAndDocumentDirection(emailId: string): Promise<{
    email: DirectionResult;
    documents: Map<string, DirectionResult>;
  }>;

  // Batch re-process emails with incorrect direction
  reprocessMismatchedEmails(limit?: number): Promise<ReprocessResult>;

  // Analyze thread and determine all directions
  analyzeThread(threadId: string): Promise<ThreadAnalysis>;
}

interface DirectionResult {
  direction: 'inbound' | 'outbound';
  trueSender: string;
  confidence: number;  // 0.0 - 1.0
  reasoning: string;
  method: 'header' | 'via_pattern' | 'domain' | 'subject_pattern' | 'thread_analysis';
}
```

## Implementation Plan

### Phase 1: Core Service
1. Create `TrueSenderExtractor` class
2. Create `DomainClassifier` class
3. Create `DirectionDetectionService` class
4. Unit tests for each component

### Phase 2: Integration
1. Hook into email processing pipeline
2. Update both `raw_emails.email_direction` AND `true_sender_email`
3. Ensure `document_classifications.document_direction` uses same source

### Phase 3: Backfill
1. Create migration script
2. Re-process existing emails with mismatched directions
3. Validate results

## Test Cases

```typescript
describe('DirectionDetectionService', () => {
  // Via pattern tests
  it('should extract true sender from via pattern', () => {
    const sender = "'CMA CGM Website' via pricing <pricing@intoglo.com>";
    expect(extractTrueSender(sender)).toBe('website-noreply@cma-cgm.com');
  });

  // Google Groups tests
  it('should use X-Original-Sender header', () => {
    const email = {
      senderEmail: 'ops@intoglo.com',
      headers: { 'X-Original-Sender': 'in.export@maersk.com' }
    };
    expect(detectDirection(email)).toEqual({
      direction: 'inbound',
      trueSender: 'in.export@maersk.com',
      confidence: 0.99
    });
  });

  // Thread tests
  it('should flip direction for replies', () => {
    const thread = [
      { messageId: '1', direction: 'outbound' },  // We sent
      { messageId: '2', inReplyTo: '1' }          // They replied
    ];
    expect(detectThreadDirection(thread[1], thread)).toBe('inbound');
  });

  // Carrier subject pattern tests
  it('should detect carrier BC from subject even with Intoglo sender', () => {
    const email = {
      senderEmail: 'ops@intoglo.com',
      subject: 'Booking Confirmation : 263825330'
    };
    expect(detectDirection(email).direction).toBe('inbound');
  });
});
```

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| email/doc direction mismatch | 26% | < 2% |
| true_sender_email populated | ~60% | > 98% |
| Direction confidence avg | N/A | > 0.9 |

## Files to Create

```
lib/
  services/
    direction-detection/
      index.ts                    # Public exports
      direction-detection-service.ts
      true-sender-extractor.ts
      domain-classifier.ts
      types.ts
    direction-detection.test.ts   # Tests
```
