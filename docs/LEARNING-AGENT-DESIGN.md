# Learning Agent Design: Simple, Beautiful, Brilliant

> A self-improving freight intelligence system that learns from team behavior

---

## Executive Summary

After deep analysis of 26,000+ chronicle records, 4,300+ errors, and existing profile services, I've identified why the current system doesn't learn:

**The Problem:** All infrastructure for learning exists, but nothing connects them.

| What Exists | Current State | Learning Gap |
|-------------|---------------|--------------|
| `ai_confidence` column | Always NULL | No confidence tracking |
| `needs_reanalysis` flag | Never set | No feedback trigger |
| Shipper/Carrier Profiles | Compute stats, unused | Not informing classification |
| Sender patterns | 90%+ predictable | Not leveraged |
| Chronicle errors | 4,339 tracked | Never analyzed for patterns |

**The Solution:** A thin "Learning Layer" that connects existing systems.

---

## Key Discoveries from Data Analysis

### 1. Sender Patterns Are Highly Predictable

```
service.hlag.com     → 56.8% booking_confirmation
csd.hlag.com         → 89.2% invoice
transjetcargo.com    → 68.8% work_order
trucker@intoglo.com  → 60.2% work_order
```

**Insight:** If sender domain predicts document type with 60-90% accuracy, we should use this BEFORE AI classification to provide hints and validate outputs.

### 2. Action Classification Is Wrong 20% of Time

```
vgm_confirmation: 80% has_action=false (correct - action done)
                  20% has_action=true  (WRONG - VGM already submitted)

shipping_instructions: 44% has_action=false
                       56% has_action=true (many are SI confirmations!)
```

**Insight:** The AI doesn't distinguish "VGM submitted" (action complete) from "VGM required" (action needed). The subject line patterns are clear: "VGM submitted", "SI submitted" = no action.

### 3. 46% of Errors Are Enum Mismatches

```
AI returns:  "amendment", "hbl_draft", "seaway_bill", "broker"
Schema has:  "booking_amendment", "house_bl", "sea_waybill", etc.
```

**Insight:** The AI understands the content but uses slightly wrong enum values. A simple mapping layer would fix 46% of errors instantly.

### 4. Profile Services Exist But Don't Inform Classification

The `ShipperProfileService` computes:
- SI late rate, amendment rate
- Risk scores
- Preferred carriers

But this data is NEVER used to adjust AI behavior or set confidence levels.

---

## The Design: Learning Memory Layer

### Core Principle: Memory = Context Before Classification

```
                    ┌─────────────────────┐
                    │   LEARNING LAYER    │
                    │                     │
 Email arrives ──▶  │  1. Pattern Lookup  │ ──▶ Hints to AI
                    │  2. Profile Context │
                    │  3. Recent Errors   │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   AI CLASSIFIER     │
                    │   (Claude Haiku)    │ ──▶ Classification
                    │   + Confidence      │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │  VALIDATION LAYER   │
                    │                     │
                    │  1. Enum Mapping    │ ──▶ Corrected Output
                    │  2. Pattern Check   │
                    │  3. Confidence Flag │
                    └──────────┬──────────┘
                               │
              Team Correction ─┴──▶ Learning Episode Stored
```

### Database Design (2 New Tables)

```sql
-- Table 1: Learning Episodes (corrections + outcomes)
CREATE TABLE learning_episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What was predicted
  chronicle_id UUID REFERENCES chronicle(id),
  predicted_document_type TEXT NOT NULL,
  predicted_has_action BOOLEAN,
  prediction_confidence INTEGER,

  -- What was corrected (if any)
  corrected_document_type TEXT,
  corrected_has_action BOOLEAN,
  corrected_by UUID REFERENCES auth.users(id),
  corrected_at TIMESTAMPTZ,

  -- Context for learning
  sender_domain TEXT,
  sender_party TEXT,
  subject_keywords TEXT[],
  has_attachment BOOLEAN,
  attachment_types TEXT[],

  -- Outcome
  was_correct BOOLEAN DEFAULT true,
  correction_reason TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table 2: Pattern Memory (aggregated learnings)
CREATE TABLE pattern_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Pattern signature
  pattern_type TEXT NOT NULL, -- 'sender_domain', 'subject_keyword', 'party_doctype'
  pattern_key TEXT NOT NULL,  -- e.g., 'service.hlag.com', 'VGM submitted'

  -- Learned associations
  document_type_stats JSONB NOT NULL,
  -- e.g., {"booking_confirmation": 0.57, "invoice": 0.12, ...}

  action_required_rate NUMERIC,
  total_observations INTEGER DEFAULT 0,
  correct_observations INTEGER DEFAULT 0,

  -- Confidence
  accuracy_rate NUMERIC GENERATED ALWAYS AS (
    CASE WHEN total_observations > 0
    THEN correct_observations::numeric / total_observations
    ELSE 0 END
  ) STORED,

  last_updated TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(pattern_type, pattern_key)
);

-- Indexes for fast lookup
CREATE INDEX idx_pattern_memory_lookup ON pattern_memory(pattern_type, pattern_key);
CREATE INDEX idx_learning_episodes_sender ON learning_episodes(sender_domain);
CREATE INDEX idx_learning_episodes_corrected ON learning_episodes(corrected_at)
  WHERE corrected_at IS NOT NULL;
```

### Service Design (3 New Services)

#### 1. PatternMemoryService - The "Long-Term Memory"

```typescript
/**
 * PatternMemoryService - Aggregated Learning from Historical Data
 *
 * Stores and retrieves learned patterns from corrections and outcomes.
 * Acts as "long-term memory" for the classification system.
 */
export class PatternMemoryService {

  /**
   * Get classification hints before AI runs
   */
  async getClassificationHints(email: {
    senderDomain: string;
    senderParty: string;
    subject: string;
    hasAttachment: boolean;
  }): Promise<ClassificationHint[]> {
    const hints: ClassificationHint[] = [];

    // 1. Sender domain pattern
    const domainPattern = await this.lookupPattern('sender_domain', email.senderDomain);
    if (domainPattern && domainPattern.accuracy_rate > 0.7) {
      hints.push({
        source: 'sender_domain',
        suggestedType: this.topDocType(domainPattern.document_type_stats),
        confidence: domainPattern.accuracy_rate,
        reason: `${email.senderDomain} is ${(domainPattern.accuracy_rate * 100).toFixed(0)}% ${this.topDocType(domainPattern.document_type_stats)}`
      });
    }

    // 2. Subject keyword patterns
    const keywords = this.extractKeywords(email.subject);
    for (const keyword of keywords) {
      const keywordPattern = await this.lookupPattern('subject_keyword', keyword);
      if (keywordPattern && keywordPattern.accuracy_rate > 0.8) {
        hints.push({
          source: 'subject_keyword',
          suggestedType: this.topDocType(keywordPattern.document_type_stats),
          confidence: keywordPattern.accuracy_rate,
          reason: `"${keyword}" in subject indicates ${this.topDocType(keywordPattern.document_type_stats)}`
        });
      }
    }

    // 3. Action completion patterns
    if (this.hasActionCompletionKeyword(email.subject)) {
      hints.push({
        source: 'action_pattern',
        suggestedHasAction: false,
        confidence: 0.95,
        reason: 'Subject indicates action already completed (submitted/confirmed/verified)'
      });
    }

    return hints;
  }

  /**
   * Update pattern memory after classification outcome is known
   */
  async recordOutcome(episode: LearningEpisode): Promise<void> {
    // Update sender domain pattern
    await this.updatePattern('sender_domain', episode.senderDomain, {
      documentType: episode.finalDocumentType,
      wasCorrect: episode.wasCorrect
    });

    // Update keyword patterns
    for (const keyword of episode.subjectKeywords) {
      await this.updatePattern('subject_keyword', keyword, {
        documentType: episode.finalDocumentType,
        wasCorrect: episode.wasCorrect
      });
    }
  }

  /**
   * Keywords that indicate action is already complete (not required)
   */
  private hasActionCompletionKeyword(subject: string): boolean {
    const completionPatterns = [
      /SI submitted/i,
      /VGM submitted/i,
      /VGM verified/i,
      /eVGM is verified/i,
      /Shipping Instruction Submitted/i,
      /Amendment submitted/i,
      /booking confirmed/i,
      /confirmed successfully/i
    ];
    return completionPatterns.some(p => p.test(subject));
  }
}
```

#### 2. LearningEpisodeService - The "Episodic Memory"

```typescript
/**
 * LearningEpisodeService - Individual Learning Moments
 *
 * Captures every prediction and its outcome.
 * Enables learning from team corrections.
 */
export class LearningEpisodeService {

  /**
   * Record a classification episode
   */
  async recordEpisode(params: {
    chronicleId: string;
    email: ProcessedEmail;
    prediction: ShippingAnalysis;
    hints: ClassificationHint[];
  }): Promise<LearningEpisode> {
    const episode = {
      chronicle_id: params.chronicleId,
      predicted_document_type: params.prediction.document_type,
      predicted_has_action: params.prediction.has_action,
      prediction_confidence: this.calculateConfidence(params.prediction, params.hints),
      sender_domain: this.extractDomain(params.email.from),
      sender_party: params.prediction.from_party,
      subject_keywords: this.extractKeywords(params.email.subject),
      has_attachment: params.email.attachments.length > 0,
      attachment_types: params.email.attachments.map(a => a.mimeType),
      was_correct: true, // Assume correct until corrected
    };

    await this.supabase.from('learning_episodes').insert(episode);
    return episode;
  }

  /**
   * Record a team correction
   */
  async recordCorrection(params: {
    chronicleId: string;
    correctedDocumentType?: string;
    correctedHasAction?: boolean;
    correctedBy: string;
    reason?: string;
  }): Promise<void> {
    // 1. Update the learning episode
    await this.supabase
      .from('learning_episodes')
      .update({
        corrected_document_type: params.correctedDocumentType,
        corrected_has_action: params.correctedHasAction,
        corrected_by: params.correctedBy,
        corrected_at: new Date().toISOString(),
        was_correct: false,
        correction_reason: params.reason
      })
      .eq('chronicle_id', params.chronicleId);

    // 2. Update the chronicle record
    await this.supabase
      .from('chronicle')
      .update({
        document_type: params.correctedDocumentType,
        has_action: params.correctedHasAction,
        needs_reanalysis: true
      })
      .eq('id', params.chronicleId);

    // 3. Trigger pattern memory update
    await this.patternMemory.recordCorrection(params);
  }

  /**
   * Calculate confidence based on AI output + pattern hints
   */
  private calculateConfidence(
    prediction: ShippingAnalysis,
    hints: ClassificationHint[]
  ): number {
    let confidence = 60; // Base confidence

    // Boost if hints agree with prediction
    const agreeingHints = hints.filter(h =>
      h.suggestedType === prediction.document_type
    );
    confidence += agreeingHints.length * 10;

    // Boost based on hint confidence
    for (const hint of agreeingHints) {
      confidence += (hint.confidence - 0.5) * 20;
    }

    // Reduce if hints disagree
    const disagreeingHints = hints.filter(h =>
      h.suggestedType && h.suggestedType !== prediction.document_type
    );
    confidence -= disagreeingHints.length * 15;

    return Math.max(20, Math.min(100, Math.round(confidence)));
  }
}
```

#### 3. EnumMappingService - The "Error Corrector"

```typescript
/**
 * EnumMappingService - Fixes Common AI Mistakes
 *
 * Maps AI outputs that don't match schema to valid values.
 * Fixes 46% of current errors instantly.
 */
export class EnumMappingService {

  private static DOCUMENT_TYPE_ALIASES: Record<string, string> = {
    // Common AI mistakes → Correct values
    'amendment': 'booking_amendment',
    'booking_change': 'booking_amendment',
    'hbl_draft': 'house_bl',
    'hbl': 'house_bl',
    'mbl': 'final_bl',
    'seaway_bill': 'sea_waybill',
    'seawaybill': 'sea_waybill',
    'broker': 'general_correspondence',
    'carrier': 'general_correspondence',
    'insurance': 'general_correspondence',
    'pre-alert': 'notification',
    'pre_arrival_notice': 'arrival_notice',
    'tracking': 'tracking_update',
    'terminal': 'notification',
    'trucking': 'work_order',
    'customs': 'customs_entry',
    'inquiry': 'request',
    'quotation': 'rate_request',
    'packing_list': 'checklist',
  };

  private static PARTY_ALIASES: Record<string, string> = {
    'carrier': 'ocean_carrier',
    'customs': 'customs_broker',
    'broker': 'customs_broker',
    'truckers': 'trucker',
    'terminal': 'warehouse',
    'factory': 'shipper',
    'shipcube': 'ocean_carrier',
    'finance': 'intoglo',
    'operations': 'intoglo',
    'system': 'unknown',
  };

  /**
   * Normalize AI output to valid schema values
   */
  normalize(analysis: RawAiOutput): NormalizedAnalysis {
    return {
      ...analysis,
      document_type: this.normalizeDocumentType(analysis.document_type),
      from_party: this.normalizeParty(analysis.from_party),
      has_action: this.normalizeAction(analysis),
    };
  }

  private normalizeDocumentType(type: string): string {
    const lower = type.toLowerCase().trim();
    return EnumMappingService.DOCUMENT_TYPE_ALIASES[lower] || lower;
  }

  private normalizeParty(party: string): string {
    const lower = party.toLowerCase().trim();
    return EnumMappingService.PARTY_ALIASES[lower] || lower;
  }

  /**
   * Override has_action based on document type semantics
   */
  private normalizeAction(analysis: RawAiOutput): boolean {
    // Confirmations = action already done
    const confirmationTypes = [
      'vgm_confirmation', 'si_confirmation', 'sob_confirmation',
      'booking_confirmation', 'rate_confirmation', 'payment_receipt'
    ];

    if (confirmationTypes.includes(analysis.document_type)) {
      return false; // Action already completed
    }

    // Requests = action required
    const actionTypes = [
      'request', 'rate_request', 'booking_request', 'exception_notice',
      'draft_bl', 'escalation'
    ];

    if (actionTypes.includes(analysis.document_type)) {
      return true; // Action required
    }

    return analysis.has_action; // Use AI's judgment for others
  }
}
```

### Integration with Existing AI Analyzer

```typescript
// Modified AiAnalyzer.analyze() method
async analyze(
  email: ProcessedEmail,
  attachmentText: string,
  threadContext?: ThreadContext
): Promise<ShippingAnalysis> {

  // 1. GET MEMORY CONTEXT (NEW)
  const hints = await this.patternMemory.getClassificationHints({
    senderDomain: this.extractDomain(email.from),
    senderParty: email.fromParty,
    subject: email.subject,
    hasAttachment: email.attachments.length > 0
  });

  // 2. BUILD ENHANCED PROMPT WITH HINTS (NEW)
  const prompt = this.buildPromptWithHints(email, attachmentText, threadContext, hints);

  // 3. CALL AI
  const response = await this.callAnthropic(prompt);
  const rawAnalysis = this.parseResponse(response, email.receivedAt);

  // 4. NORMALIZE OUTPUT (NEW)
  const normalizedAnalysis = this.enumMapper.normalize(rawAnalysis);

  // 5. CALCULATE CONFIDENCE (NEW)
  const confidence = this.calculateConfidence(normalizedAnalysis, hints);

  // 6. RECORD LEARNING EPISODE (NEW)
  await this.learningEpisodes.recordEpisode({
    email,
    prediction: normalizedAnalysis,
    hints,
    confidence
  });

  return {
    ...normalizedAnalysis,
    ai_confidence: confidence
  };
}

private buildPromptWithHints(
  email: ProcessedEmail,
  attachmentText: string,
  threadContext: ThreadContext | undefined,
  hints: ClassificationHint[]
): string {
  const basePrompt = buildAnalysisPrompt(
    email.subject,
    email.bodyText.substring(0, AI_CONFIG.maxBodyChars),
    attachmentText,
    email.receivedAt,
    threadContext
  );

  if (hints.length === 0) return basePrompt;

  // Add hints section to prompt
  const hintsSection = `
PATTERN MEMORY HINTS (use these to inform your classification):
${hints.map(h => `- ${h.reason} (${(h.confidence * 100).toFixed(0)}% confidence)`).join('\n')}

If pattern hints strongly suggest a document type (>80% confidence), favor that classification unless email content clearly contradicts it.
`;

  return basePrompt.replace(
    'ANALYZE THE FOLLOWING EMAIL:',
    `${hintsSection}\nANALYZE THE FOLLOWING EMAIL:`
  );
}
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
- [ ] Create `learning_episodes` table
- [ ] Create `pattern_memory` table
- [ ] Implement `EnumMappingService` (instant 46% error reduction)
- [ ] Add `ai_confidence` population to existing flow

### Phase 2: Memory Layer (Week 3-4)
- [ ] Implement `PatternMemoryService`
- [ ] Implement `LearningEpisodeService`
- [ ] Backfill pattern memory from existing chronicle data
- [ ] Add hints to AI prompt

### Phase 3: Feedback Loop (Week 5-6)
- [ ] Build correction UI component
- [ ] Connect corrections to learning episodes
- [ ] Add confidence-based flagging for human review
- [ ] Dashboard showing learning metrics

### Phase 4: Continuous Improvement (Ongoing)
- [ ] Weekly pattern memory refresh cron job
- [ ] A/B testing: with hints vs without hints
- [ ] Accuracy tracking by document type
- [ ] Alert when accuracy drops below threshold

---

## Expected Outcomes

### Immediate (Phase 1)
- **46% error reduction** from enum mapping
- **Confidence scores** on every classification
- **Learning foundation** in place

### Short-term (Phase 2-3)
- **5-10% accuracy improvement** from pattern hints
- **Faster corrections** with one-click fix UI
- **Lower team workload** from reduced errors

### Long-term (Phase 4+)
- **Self-improving system** that gets better with use
- **Predictive insights** based on historical patterns
- **Knowledge retention** even with team turnover

---

## What Makes This "Simple, Beautiful, Brilliant"

### Simple
- Only 2 new tables
- 3 new services with clear responsibilities
- Reuses existing infrastructure (profiles, chronicle, errors)
- No new AI models or complex ML pipelines

### Beautiful
- Clean separation: Memory → AI → Validation → Learning
- Every correction improves the system
- Confidence signals enable smart routing
- Pattern hints are human-readable explanations

### Brilliant
- Learns from team behavior without explicit training
- Pattern memory is interpretable (not a black box)
- Enum mapping fixes known errors deterministically
- Hints reduce AI uncertainty, improving accuracy
- The more you use it, the smarter it gets

---

## Appendix: Data Evidence

### A. Error Distribution (4,339 total)
| Error Type | Count | % | Root Cause |
|------------|-------|---|------------|
| RATE_LIMIT | 2,268 | 52% | API throttling |
| AI_ERROR | 1,999 | 46% | Invalid enum values |
| DB_SAVE | 67 | 2% | Data format issues |

### B. Top Sender Patterns (predictable)
| Sender Domain | Top Document Type | Accuracy |
|---------------|------------------|----------|
| service.hlag.com | booking_confirmation | 57% |
| csd.hlag.com | invoice | 89% |
| transjetcargo.com | work_order | 69% |

### C. Action Misclassification
| Document Type | has_action=true (%) | Should Be |
|---------------|---------------------|-----------|
| vgm_confirmation | 20% | 0% (action done) |
| booking_confirmation | 22% | ~5% (rarely) |
| shipping_instructions | 56% | varies |

---

*Designed for Intoglo - January 2026*
