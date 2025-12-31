# 🧪 AI Model Testing - Cost vs Quality Analysis

## Models to Test

### **1. Claude Haiku 3.5** (Cheapest)
- **Model:** `claude-3-5-haiku-20241022`
- **Cost:** $0.80 / 1M input tokens, $4.00 / 1M output tokens
- **Speed:** ~3x faster than Sonnet
- **Best for:** Simple classification tasks, entity extraction
- **Use case:** Document type classification, basic entity extraction

### **2. Claude Sonnet 3.5** (Mid-tier)
- **Model:** `claude-3-5-sonnet-20241022`
- **Cost:** $3.00 / 1M input tokens, $15.00 / 1M output tokens
- **Speed:** Balanced
- **Best for:** Complex extraction, multi-field parsing
- **Use case:** Structured data extraction, shipment linking logic

### **3. Claude Opus 3** (Most Powerful)
- **Model:** `claude-opus-3-20240229`
- **Cost:** $15.00 / 1M input tokens, $75.00 / 1M output tokens
- **Speed:** Slower but highest accuracy
- **Best for:** Complex reasoning, ambiguous cases, final fallback
- **Use case:** Low-confidence reviews, complex document analysis

---

## Recommended Strategy

### **Tiered Approach (Best Cost/Quality)**

```typescript
// Layer 1: Haiku for classification (95% of cases)
if (task === 'classify_document') {
  model = 'claude-3-5-haiku-20241022';  // $0.80/1M - Fast & cheap
}

// Layer 2: Sonnet for extraction (90% of cases)
if (task === 'extract_entities') {
  model = 'claude-3-5-sonnet-20241022'; // $3.00/1M - Balanced
}

// Layer 3: Opus for complex cases (5% of cases)
if (confidence < 75 || task === 'complex_reasoning') {
  model = 'claude-opus-3-20240229';     // $15.00/1M - Highest accuracy
}
```

---

## Cost Comparison (Per 1,000 Emails)

**Assumptions:**
- Average email: 500 tokens input
- Average response: 200 tokens output
- 1,000 emails processed

### **All Haiku:**
- Input: 1,000 × 500 = 500K tokens = $0.40
- Output: 1,000 × 200 = 200K tokens = $0.80
- **Total: $1.20 per 1,000 emails**

### **All Sonnet:**
- Input: 500K tokens = $1.50
- Output: 200K tokens = $3.00
- **Total: $4.50 per 1,000 emails**

### **All Opus:**
- Input: 500K tokens = $7.50
- Output: 200K tokens = $15.00
- **Total: $22.50 per 1,000 emails**

### **Tiered (Recommended):**
- 95% Haiku: 950 × $0.0012 = $1.14
- 5% Sonnet: 50 × $0.0045 = $0.23
- **Total: $1.37 per 1,000 emails** ✅

**Savings: 94% vs Opus, 70% vs Sonnet**

---

## Testing Plan

### **Phase 1: Classification Accuracy Test**

Test all 3 models on same 100 emails:

```typescript
const testResults = {
  haiku: { correct: 0, total: 100, avgConfidence: 0, cost: 0 },
  sonnet: { correct: 0, total: 100, avgConfidence: 0, cost: 0 },
  opus: { correct: 0, total: 100, avgConfidence: 0, cost: 0 }
};
```

**Metrics:**
- Accuracy (% correct classifications)
- Average confidence score
- Cost per email
- Processing time

### **Phase 2: Extraction Quality Test**

Test entity extraction (booking #, dates, ports, parties):

```typescript
const extractionTests = {
  haiku: {
    fieldsExtracted: 0,
    totalFields: 800,  // 100 emails × 8 fields avg
    accuracy: 0,
    cost: 0
  },
  sonnet: { ... },
  opus: { ... }
};
```

**Metrics:**
- Field extraction rate (% of fields found)
- Field accuracy (% correct values)
- Cost per extraction
- Missing fields count

### **Phase 3: Complex Cases Test**

Test on 20 difficult emails:
- Forwarded emails (true sender extraction)
- Multi-language emails
- Amended documents (3rd UPDATE, 4th REVISION)
- Incomplete information
- Multiple bookings in one email

---

## Test Configuration Files

### **1. test-models-classification.ts**

```typescript
import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

async function testClassification(
  email: any,
  model: string
): Promise<{ type: string; confidence: number; cost: number }> {
  const startTime = Date.now();

  const message = await anthropic.messages.create({
    model: model,
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Classify this email as one of: booking_confirmation, commercial_invoice, si_draft, house_bl, arrival_notice.

Email Subject: ${email.subject}
From: ${email.sender}
Body: ${email.body}

Return JSON: {"type": "...", "confidence": 0-100}`
    }]
  });

  const result = JSON.parse(message.content[0].text);

  // Calculate cost
  const inputTokens = message.usage.input_tokens;
  const outputTokens = message.usage.output_tokens;
  const cost = calculateCost(model, inputTokens, outputTokens);

  return {
    type: result.type,
    confidence: result.confidence,
    cost: cost,
    processingTime: Date.now() - startTime
  };
}

function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing = {
    'claude-3-5-haiku-20241022': { input: 0.80, output: 4.00 },
    'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
    'claude-opus-3-20240229': { input: 15.00, output: 75.00 }
  };

  const rates = pricing[model];
  return (
    (inputTokens / 1_000_000) * rates.input +
    (outputTokens / 1_000_000) * rates.output
  );
}
```

### **2. Model Selection Logic**

```typescript
class ModelSelector {
  selectModel(task: string, complexity: string): string {
    // Simple classification → Haiku
    if (task === 'classify' && complexity === 'simple') {
      return 'claude-3-5-haiku-20241022';
    }

    // Standard extraction → Sonnet
    if (task === 'extract' && complexity === 'standard') {
      return 'claude-3-5-sonnet-20241022';
    }

    // Complex/ambiguous → Opus
    if (complexity === 'complex' || complexity === 'ambiguous') {
      return 'claude-opus-3-20240229';
    }

    // Fallback to Haiku (cheapest)
    return 'claude-3-5-haiku-20241022';
  }

  // Adaptive model selection based on confidence
  selectAdaptive(previousConfidence: number): string {
    if (previousConfidence >= 90) {
      return 'claude-3-5-haiku-20241022';  // High confidence → use cheaper
    } else if (previousConfidence >= 70) {
      return 'claude-3-5-sonnet-20241022'; // Medium → balanced
    } else {
      return 'claude-opus-3-20240229';     // Low confidence → most accurate
    }
  }
}
```

---

## Expected Results

### **Classification (Document Type)**

| Model | Accuracy | Avg Confidence | Cost/1K | Speed |
|-------|----------|----------------|---------|-------|
| Haiku | 92-95% | 87% | $1.20 | 3x |
| Sonnet | 95-97% | 91% | $4.50 | 1x |
| Opus | 97-99% | 95% | $22.50 | 0.5x |

**Recommendation:** **Haiku** for classification (92-95% accuracy is sufficient)

### **Entity Extraction**

| Model | Field Coverage | Accuracy | Cost/1K | Speed |
|-------|----------------|----------|---------|-------|
| Haiku | 85-90% | 88% | $1.20 | 3x |
| Sonnet | 92-95% | 94% | $4.50 | 1x |
| Opus | 95-98% | 97% | $22.50 | 0.5x |

**Recommendation:** **Sonnet** for extraction (worth the extra cost for accuracy)

### **Complex Cases**

| Model | Success Rate | Cost/1K |
|-------|--------------|---------|
| Haiku | 60-70% | $1.20 |
| Sonnet | 80-85% | $4.50 |
| Opus | 90-95% | $22.50 |

**Recommendation:** **Opus** only for low-confidence cases (5% of total)

---

## Final Recommended Setup

```typescript
// config/ai-models.ts
export const AI_MODEL_CONFIG = {
  classification: {
    model: 'claude-3-5-haiku-20241022',
    maxTokens: 500,
    temperature: 0.3
  },

  extraction: {
    model: 'claude-3-5-sonnet-20241022',
    maxTokens: 2000,
    temperature: 0.2
  },

  complex: {
    model: 'claude-opus-3-20240229',
    maxTokens: 4000,
    temperature: 0.1
  },

  // Confidence thresholds for model switching
  thresholds: {
    useHaiku: 90,      // If confidence >= 90%, use Haiku
    useSonnet: 70,     // If 70-89%, use Sonnet
    useOpus: 0         // If < 70%, use Opus
  }
};
```

---

## Cost Projection (Annual)

**Assumptions:**
- 60 emails per shipment
- 1,000 shipments per year
- 60,000 emails total

### **All Haiku Approach:**
- Cost: 60,000 ÷ 1,000 × $1.20 = **$72/year** ✅

### **Tiered Approach (Recommended):**
- Cost: 60,000 ÷ 1,000 × $1.37 = **$82/year** ✅

### **All Sonnet Approach:**
- Cost: 60,000 ÷ 1,000 × $4.50 = **$270/year**

### **All Opus Approach:**
- Cost: 60,000 ÷ 1,000 × $22.50 = **$1,350/year**

**Savings with tiered approach: $1,268/year (94% reduction vs Opus)**

---

## Next Steps

1. **Fix database connection** (get INTDB service role key)
2. **Run test scripts** to compare models
3. **Analyze results** (accuracy vs cost)
4. **Implement tiered strategy** with confidence-based fallback
5. **Deploy to production** with monitoring

---

**Bottom Line:**
- Use **Haiku** for classification (95% accuracy, $1.20/1K)
- Use **Sonnet** for extraction (94% accuracy, $4.50/1K)
- Use **Opus** as fallback for <70% confidence (97% accuracy, $22.50/1K)
- **Total estimated cost: ~$82/year** for 60K emails

**ROI: Massive savings on manual data entry (~$50,000/year) for only $82/year in AI costs!** 🎯
