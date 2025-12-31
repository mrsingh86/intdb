# Email Thread Handling - Gap Analysis & Recommendations

## Current State

### Database Schema
```sql
raw_emails:
  - gmail_message_id (unique per email)
  - thread_id (links emails in conversation)
  - subject
  - body_text
  - received_at

document_classifications:
  - email_id (1:1 with raw_email)
  - document_type
  - confidence_score

entity_extractions:
  - email_id (many:1 with raw_email)
  - entity_type
  - entity_value
```

### AI Agent Behavior
- **Treats each email independently** - no thread context
- **No awareness** of "ORIGINAL → 1ST UPDATE → 2ND UPDATE" progression
- **Cannot detect** duplicate emails in thread
- **No cross-referencing** of entities across thread messages

---

## Problems Identified from Real Thread Analysis

### Thread: HL-35897776 (4 emails)
```
Message 1: ORIGINAL booking (8:58 AM)  → ❌ Not classified
Message 2: ORIGINAL (duplicate)        → ❌ Not classified
Message 3: 1ST UPDATE (12:48 PM)       → ❌ Not classified
Message 4: 1ST UPDATE (duplicate)      → ✅ Classified as shipping_instruction
```

### Issues:
1. **75% unclassified** - pipeline only processed 1 out of 4 messages
2. **No duplicate detection** - both recipients stored separately
3. **No update tracking** - can't tell Message 3 is an update to Message 1
4. **Lost context** - can't track what changed between ORIGINAL and UPDATE
5. **Redundant storage** - duplicates consume database space and AI tokens

---

## Do We Need Upgrades?

### SHORT ANSWER: **YES - Database & AI upgrades needed**

### Justification:

#### ❌ **Current System Cannot:**
1. Track "ORIGINAL → 1ST UPDATE → 2ND UPDATE → 3RD UPDATE" sequences
2. Detect duplicate emails sent to multiple recipients
3. Show what fields changed between updates (ETD, vessel, port, etc.)
4. Group related emails in a thread for unified classification
5. Prevent wasting AI tokens on duplicates
6. Maintain booking revision history

#### ✅ **Upgraded System Should:**
1. Recognize email sequences and updates
2. De-duplicate identical content sent to multiple recipients
3. Track field-level changes across updates
4. Use thread context for better AI classification
5. Create revision history for bookings
6. Reduce AI costs by skipping duplicates

---

## Recommended Upgrades

### 1. DATABASE SCHEMA ENHANCEMENTS

#### A. Add to `raw_emails` table:
```sql
ALTER TABLE raw_emails ADD COLUMN revision_type VARCHAR(20);
-- Values: 'original', '1st_update', '2nd_update', '3rd_update', 'amendment', 'cancellation'

ALTER TABLE raw_emails ADD COLUMN is_duplicate BOOLEAN DEFAULT false;
-- Mark if email is duplicate of another in thread

ALTER TABLE raw_emails ADD COLUMN duplicate_of_email_id UUID;
-- Links to the original email if this is a duplicate

ALTER TABLE raw_emails ADD COLUMN thread_position INTEGER;
-- Position in thread (1, 2, 3, 4...)

ALTER TABLE raw_emails ADD COLUMN content_hash TEXT;
-- Hash of body_text to detect duplicates
```

#### B. New table: `email_thread_metadata`
```sql
CREATE TABLE email_thread_metadata (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id VARCHAR(200) UNIQUE NOT NULL,
  first_email_id UUID REFERENCES raw_emails(id),
  latest_email_id UUID REFERENCES raw_emails(id),
  email_count INTEGER DEFAULT 0,
  unique_email_count INTEGER DEFAULT 0,  -- Excluding duplicates
  duplicate_count INTEGER DEFAULT 0,
  thread_subject VARCHAR(500),
  thread_type VARCHAR(50),  -- booking_sequence, amendment_sequence, misc
  primary_booking_number VARCHAR(50),
  primary_bl_number VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### C. New table: `booking_revisions`
```sql
CREATE TABLE booking_revisions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_number VARCHAR(50) NOT NULL,
  revision_number INTEGER NOT NULL,
  revision_type VARCHAR(20),  -- original, 1st_update, 2nd_update
  source_email_id UUID REFERENCES raw_emails(id),
  changed_fields JSONB,  -- {"etd": {"old": "2025-01-01", "new": "2025-01-05"}}
  vessel_name VARCHAR(200),
  voyage_number VARCHAR(50),
  etd DATE,
  eta DATE,
  port_of_loading VARCHAR(100),
  port_of_discharge VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(booking_number, revision_number)
);
```

---

### 2. AI AGENT ENHANCEMENTS

#### A. Thread-Aware Classification
```typescript
async function classifyEmailWithThreadContext(email: Email, thread: Email[]) {
  const prompt = `
  You are classifying email ${thread.indexOf(email) + 1} of ${thread.length} in a thread.

  THREAD CONTEXT:
  ${thread.map((e, i) => `
    Email ${i + 1}:
    Subject: ${e.subject}
    Snippet: ${e.snippet}
    Sent: ${e.received_at}
  `).join('\n')}

  CURRENT EMAIL TO CLASSIFY:
  Subject: ${email.subject}
  Body: ${email.body_text}

  Questions:
  1. What type of document is this?
  2. Is this an UPDATE/AMENDMENT to a previous email in thread?
  3. Which email number is it updating? (if applicable)
  4. What revision is this? (ORIGINAL, 1ST UPDATE, 2ND UPDATE, etc.)

  Respond in JSON:
  {
    "document_type": "...",
    "confidence_score": 0-100,
    "is_update": true/false,
    "updates_email_index": 0,  // if is_update=true
    "revision_type": "original | 1st_update | 2nd_update | ...",
    "reasoning": "..."
  }
  `;

  // Send to Claude with thread context
  const response = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    messages: [{ role: 'user', content: prompt }]
  });

  return parseResponse(response);
}
```

#### B. Duplicate Detection
```typescript
async function detectDuplicates(threadEmails: Email[]) {
  // Hash email bodies
  const hashes = threadEmails.map(e => ({
    email_id: e.id,
    content_hash: crypto.createHash('sha256').update(e.body_text || '').digest('hex')
  }));

  // Find duplicates
  const duplicates = hashes.filter((h, i) =>
    hashes.findIndex(x => x.content_hash === h.content_hash) !== i
  );

  // Mark duplicates in database
  for (const dup of duplicates) {
    const original = hashes.find(h => h.content_hash === dup.content_hash);
    await supabase
      .from('raw_emails')
      .update({
        is_duplicate: true,
        duplicate_of_email_id: original.email_id
      })
      .eq('id', dup.email_id);
  }
}
```

#### C. Revision Tracking
```typescript
async function trackRevisions(email: Email, classificationResult: any) {
  if (classificationResult.revision_type !== 'original') {
    // This is an update - extract what changed
    const prompt = `
    Compare this email with the ORIGINAL booking and extract what changed:

    CURRENT EMAIL (${classificationResult.revision_type}):
    ${email.body_text}

    Extract changes:
    {
      "changed_fields": [
        {"field": "etd", "old_value": "...", "new_value": "..."},
        {"field": "vessel_name", "old_value": "...", "new_value": "..."}
      ]
    }
    `;

    const changes = await extractChanges(prompt);

    // Save to booking_revisions table
    await supabase.from('booking_revisions').insert({
      booking_number: extractedBookingNumber,
      revision_number: parseRevisionNumber(classificationResult.revision_type),
      revision_type: classificationResult.revision_type,
      source_email_id: email.id,
      changed_fields: changes.changed_fields
    });
  }
}
```

---

## Implementation Priority

### Phase 1: CRITICAL (Do Now)
1. ✅ Add `revision_type` to raw_emails
2. ✅ Add `is_duplicate` flag to raw_emails
3. ✅ Create `email_thread_metadata` table
4. ✅ Update AI agent to detect revision type from subject/snippet
5. ✅ Implement duplicate detection logic

### Phase 2: IMPORTANT (Next Week)
1. Create `booking_revisions` table
2. Implement thread-aware AI classification
3. Extract field-level changes between updates
4. Add UI to show revision history

### Phase 3: ENHANCEMENT (Future)
1. Cross-thread entity linking (same booking# across threads)
2. Automated duplicate cleanup
3. Thread-level analytics

---

## Cost-Benefit Analysis

### WITHOUT Upgrades:
- ❌ Process 4 duplicate emails = 4x AI cost
- ❌ Store duplicates = wasted database space
- ❌ No revision tracking = can't track booking changes
- ❌ 75% unclassified = missed intelligence

### WITH Upgrades:
- ✅ Process 1 unique email per content = 75% cost reduction
- ✅ Mark duplicates, skip processing = storage savings
- ✅ Track revisions = complete booking history
- ✅ Thread context = better classification accuracy

### ROI Calculation:
- Current: 4 emails/thread × $0.0015/email = **$0.006 per thread**
- Upgraded: 1 unique email + 3 duplicates skipped = **$0.0015 per thread**
- **Savings: 75% reduction in AI costs**

---

## Recommendation

### ✅ **YES - Upgrade Both Database & AI Agent**

**Reasons:**
1. **Cost Savings**: 75% reduction in AI processing costs
2. **Data Quality**: Track booking revision history properly
3. **User Experience**: Show "what changed" in updates
4. **Accuracy**: Thread context improves AI classification
5. **Scalability**: Handle 60K emails/year efficiently

**Next Steps:**
1. Run database migration (add new fields/tables)
2. Update AI classification agent with thread awareness
3. Build UI to show revision history and thread view
4. Test with real Hapag-Lloyd booking sequences

**Timeline:**
- Database migration: 1 day
- AI agent updates: 2 days
- UI for review: 3 days
- Testing: 1 day

**Total: ~1 week to production**
