/**
 * AI Analysis Extractor
 *
 * Uses Claude API to extract high-level semantic information:
 * - Sentiment: Email tone (positive/negative/neutral/urgent)
 * - Urgency Level: Action priority (critical/high/medium/low)
 * - Conversation Summary: Brief context of the email thread
 * - Action Items: Required actions extracted from the email
 *
 * Single Responsibility: Extract semantic/contextual information using AI.
 */

import Anthropic from '@anthropic-ai/sdk';

// ============================================================================
// Types
// ============================================================================

export type Sentiment = 'positive' | 'negative' | 'neutral' | 'urgent' | 'concerned';
export type UrgencyLevel = 'critical' | 'high' | 'medium' | 'low';

export interface AIAnalysisResult {
  sentiment: {
    value: Sentiment;
    confidence: number;
    reasoning: string;
  };
  urgencyLevel: {
    value: UrgencyLevel;
    confidence: number;
    triggers: string[];
  };
  conversationSummary: {
    summary: string;
    keyPoints: string[];
    context: string;
  };
  actionItems: {
    items: ActionItem[];
    hasDeadline: boolean;
  };
  processingTimeMs: number;
}

export interface ActionItem {
  action: string;
  owner: 'sender' | 'recipient' | 'unknown';
  deadline?: string;
  priority: 'high' | 'medium' | 'low';
}

export interface AIAnalysisInput {
  subject: string;
  bodyText: string;
  senderEmail: string;
  senderCategory?: string;
  documentType?: string;
  // Extracted entities for context-aware analysis
  entities?: {
    booking_number?: string | null;
    bl_number?: string | null;
    container_numbers?: string[];
    vessel_name?: string | null;
    voyage_number?: string | null;
    etd?: string | null;
    eta?: string | null;
    pol?: string | null;
    pod?: string | null;
    shipper?: string | null;
    consignee?: string | null;
  };
}

// ============================================================================
// AI Analysis Extractor
// ============================================================================

export class AIAnalysisExtractor {
  private anthropic: Anthropic;
  private modelId: string = 'claude-3-5-haiku-20241022';

  constructor(modelId?: string) {
    this.anthropic = new Anthropic();
    if (modelId) {
      this.modelId = modelId;
    }
  }

  /**
   * Extract AI analysis from email content.
   */
  async analyze(input: AIAnalysisInput): Promise<AIAnalysisResult> {
    const startTime = Date.now();

    const prompt = this.buildPrompt(input);

    try {
      const response = await this.anthropic.messages.create({
        model: this.modelId,
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        return this.getDefaultResult(Date.now() - startTime);
      }

      const result = this.parseResponse(content.text);
      result.processingTimeMs = Date.now() - startTime;
      return result;

    } catch (error) {
      console.error('[AIAnalysisExtractor] Error:', error);
      return this.getDefaultResult(Date.now() - startTime);
    }
  }

  /**
   * Build the analysis prompt.
   */
  private buildPrompt(input: AIAnalysisInput): string {
    const context = input.senderCategory
      ? `This email is from a ${input.senderCategory} regarding ${input.documentType || 'shipping matters'}.`
      : '';

    // Build entity context if available
    const entityContext = this.buildEntityContext(input.entities);

    return `Analyze this shipping/logistics email and extract the following information.

${context}
${entityContext}

SUBJECT: ${input.subject}

EMAIL BODY (first 3000 chars):
${input.bodyText.slice(0, 3000)}

Provide analysis in JSON format:

{
  "sentiment": {
    "value": "positive|negative|neutral|urgent|concerned",
    "confidence": 0-100,
    "reasoning": "brief explanation"
  },
  "urgencyLevel": {
    "value": "critical|high|medium|low",
    "confidence": 0-100,
    "triggers": ["deadline mentioned", "issue reported", etc]
  },
  "conversationSummary": {
    "summary": "1-2 sentence summary of the email",
    "keyPoints": ["point 1", "point 2", "point 3"],
    "context": "brief context of what this email is about"
  },
  "actionItems": {
    "items": [
      {
        "action": "what needs to be done",
        "owner": "sender|recipient|unknown",
        "deadline": "date if mentioned",
        "priority": "high|medium|low"
      }
    ],
    "hasDeadline": true|false
  }
}

Focus on:
- Sentiment: Is the sender happy, frustrated, neutral, or expressing urgency?
- Urgency: Are there time-sensitive matters, deadlines, or issues?
- Summary: What is the main point of this email?
- Actions: What needs to happen next?

IMPORTANT: If booking numbers, BL numbers, or container numbers are provided above, reference them specifically in your summary and action items. For example: "Submit SI for BKG 12345678" instead of just "Submit SI".

Return ONLY the JSON, no other text.`;
  }

  /**
   * Build entity context string for the prompt.
   */
  private buildEntityContext(entities?: AIAnalysisInput['entities']): string {
    if (!entities) return '';

    const parts: string[] = [];

    if (entities.booking_number) {
      parts.push(`Booking Number: ${entities.booking_number}`);
    }
    if (entities.bl_number) {
      parts.push(`BL Number: ${entities.bl_number}`);
    }
    if (entities.container_numbers && entities.container_numbers.length > 0) {
      parts.push(`Container(s): ${entities.container_numbers.slice(0, 5).join(', ')}`);
    }
    if (entities.vessel_name) {
      parts.push(`Vessel: ${entities.vessel_name}${entities.voyage_number ? ` / ${entities.voyage_number}` : ''}`);
    }
    if (entities.etd) {
      parts.push(`ETD: ${entities.etd}`);
    }
    if (entities.eta) {
      parts.push(`ETA: ${entities.eta}`);
    }
    if (entities.pol) {
      parts.push(`Port of Loading: ${entities.pol}`);
    }
    if (entities.pod) {
      parts.push(`Port of Discharge: ${entities.pod}`);
    }
    if (entities.shipper) {
      parts.push(`Shipper: ${entities.shipper}`);
    }
    if (entities.consignee) {
      parts.push(`Consignee: ${entities.consignee}`);
    }

    if (parts.length === 0) return '';

    return `
EXTRACTED SHIPMENT DATA (use these specific identifiers in your response):
${parts.map(p => `  - ${p}`).join('\n')}
`;
  }

  /**
   * Parse the AI response.
   */
  private parseResponse(text: string): AIAnalysisResult {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return this.getDefaultResult(0);
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        sentiment: {
          value: this.validateSentiment(parsed.sentiment?.value),
          confidence: parsed.sentiment?.confidence || 70,
          reasoning: parsed.sentiment?.reasoning || '',
        },
        urgencyLevel: {
          value: this.validateUrgency(parsed.urgencyLevel?.value),
          confidence: parsed.urgencyLevel?.confidence || 70,
          triggers: parsed.urgencyLevel?.triggers || [],
        },
        conversationSummary: {
          summary: parsed.conversationSummary?.summary || '',
          keyPoints: parsed.conversationSummary?.keyPoints || [],
          context: parsed.conversationSummary?.context || '',
        },
        actionItems: {
          items: this.validateActionItems(parsed.actionItems?.items || []),
          hasDeadline: parsed.actionItems?.hasDeadline || false,
        },
        processingTimeMs: 0,
      };

    } catch (error) {
      console.error('[AIAnalysisExtractor] Parse error:', error);
      return this.getDefaultResult(0);
    }
  }

  /**
   * Validate sentiment value.
   */
  private validateSentiment(value: string): Sentiment {
    const valid: Sentiment[] = ['positive', 'negative', 'neutral', 'urgent', 'concerned'];
    return valid.includes(value as Sentiment) ? (value as Sentiment) : 'neutral';
  }

  /**
   * Validate urgency value.
   */
  private validateUrgency(value: string): UrgencyLevel {
    const valid: UrgencyLevel[] = ['critical', 'high', 'medium', 'low'];
    return valid.includes(value as UrgencyLevel) ? (value as UrgencyLevel) : 'medium';
  }

  /**
   * Validate action items.
   */
  private validateActionItems(items: any[]): ActionItem[] {
    if (!Array.isArray(items)) return [];

    return items.slice(0, 5).map(item => ({
      action: item.action || 'Unknown action',
      owner: ['sender', 'recipient', 'unknown'].includes(item.owner) ? item.owner : 'unknown',
      deadline: item.deadline,
      priority: ['high', 'medium', 'low'].includes(item.priority) ? item.priority : 'medium',
    }));
  }

  /**
   * Get default result for errors.
   */
  private getDefaultResult(processingTimeMs: number): AIAnalysisResult {
    return {
      sentiment: { value: 'neutral', confidence: 50, reasoning: 'Unable to analyze' },
      urgencyLevel: { value: 'medium', confidence: 50, triggers: [] },
      conversationSummary: { summary: '', keyPoints: [], context: '' },
      actionItems: { items: [], hasDeadline: false },
      processingTimeMs,
    };
  }
}

// ============================================================================
// Quick Analysis (Without Full AI Call)
// ============================================================================

/**
 * Quick sentiment detection using keyword matching.
 * Use this for high-volume processing when full AI analysis is too slow.
 */
export function quickSentimentAnalysis(subject: string, body: string): {
  sentiment: Sentiment;
  urgency: UrgencyLevel;
  confidence: number;
} {
  const text = `${subject} ${body}`.toLowerCase();

  // Urgency keywords
  const urgentKeywords = ['urgent', 'asap', 'immediately', 'critical', 'emergency', 'deadline'];
  const concernedKeywords = ['issue', 'problem', 'delay', 'missing', 'error', 'failed', 'rejected'];
  const positiveKeywords = ['confirmed', 'approved', 'completed', 'success', 'thank you', 'received'];
  const negativeKeywords = ['cancelled', 'rejected', 'denied', 'refused', 'complaint'];

  // Count matches
  const urgentCount = urgentKeywords.filter(kw => text.includes(kw)).length;
  const concernedCount = concernedKeywords.filter(kw => text.includes(kw)).length;
  const positiveCount = positiveKeywords.filter(kw => text.includes(kw)).length;
  const negativeCount = negativeKeywords.filter(kw => text.includes(kw)).length;

  // Determine sentiment
  let sentiment: Sentiment = 'neutral';
  let confidence = 60;

  if (urgentCount >= 2) {
    sentiment = 'urgent';
    confidence = 85;
  } else if (concernedCount >= 2) {
    sentiment = 'concerned';
    confidence = 75;
  } else if (negativeCount >= 1) {
    sentiment = 'negative';
    confidence = 70;
  } else if (positiveCount >= 2) {
    sentiment = 'positive';
    confidence = 75;
  }

  // Determine urgency
  let urgency: UrgencyLevel = 'medium';
  if (urgentCount >= 2 || text.includes('critical')) {
    urgency = 'critical';
  } else if (urgentCount >= 1 || text.includes('asap') || text.includes('urgent')) {
    urgency = 'high';
  } else if (text.includes('when you can') || text.includes('no rush')) {
    urgency = 'low';
  }

  return { sentiment, urgency, confidence };
}

// ============================================================================
// Factory
// ============================================================================

export function createAIAnalysisExtractor(): AIAnalysisExtractor {
  return new AIAnalysisExtractor();
}
