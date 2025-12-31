/**
 * Insight Synthesizer
 *
 * Stage 4 of the Insight Engine pipeline.
 * Combines rule-based and AI-generated insights into a unified result.
 *
 * Responsibilities:
 * - Deduplicate overlapping insights (prefer rules for overlap)
 * - Rank insights by severity and confidence
 * - Calculate total priority boost
 * - Build boost reason explanations
 *
 * Principles:
 * - Single Responsibility: Only synthesis and ranking
 * - Fail Gracefully: Works with rules-only if AI fails
 * - Pure Functions: No side effects, no database calls
 */

import {
  DetectedPattern,
  AIInsight,
  AIInsightResult,
  Insight,
  InsightSeverity,
  InsightType,
  InsightAction,
} from '@/types/insight';

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_PRIORITY_BOOST = 50;
const MAX_INSIGHTS_OUTPUT = 5;

// Severity weights for ranking
const SEVERITY_WEIGHTS: Record<InsightSeverity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// Boost per severity level
const SEVERITY_BOOST: Record<InsightSeverity, number> = {
  critical: 15,
  high: 8,
  medium: 3,
  low: 1,
};

// ============================================================================
// TYPES
// ============================================================================

export interface SynthesizedInsight {
  id: string;
  type: InsightType;
  severity: InsightSeverity;
  title: string;
  description: string;
  // Structured action for CommunicationExecutorService
  action: InsightAction | null;
  // Human-readable action text (from AI or generated)
  action_text: string | null;
  confidence: number;
  source: 'rules' | 'ai' | 'hybrid';
  pattern_code: string | null;
  supporting_data: Record<string, unknown>;
  priority_boost: number;
}

export interface SynthesizedResult {
  insights: SynthesizedInsight[];
  priority_boost: number;
  priority_boost_reasons: string[];
}

// ============================================================================
// INSIGHT SYNTHESIZER SERVICE
// ============================================================================

export class InsightSynthesizer {
  /**
   * Synthesize rule-based and AI insights into unified result
   */
  synthesize(
    rulesInsights: DetectedPattern[],
    aiResult: AIInsightResult | null
  ): SynthesizedResult {
    // Convert rules insights to synthesized format
    const rulesConverted = rulesInsights.map((r) =>
      this.convertRulesInsight(r)
    );

    // Convert AI insights to synthesized format
    const aiConverted = aiResult
      ? aiResult.insights.map((a) => this.convertAIInsight(a))
      : [];

    // Combine all insights
    const allInsights = [...rulesConverted, ...aiConverted];

    // Deduplicate (prefer rules for overlapping insights)
    const deduplicated = this.deduplicateInsights(allInsights);

    // Rank by severity and confidence
    const ranked = this.rankInsights(deduplicated);

    // Take top insights
    const topInsights = ranked.slice(0, MAX_INSIGHTS_OUTPUT);

    // Calculate total priority boost
    const priorityBoost = this.calculatePriorityBoost(
      topInsights,
      aiResult?.priority_boost || 0
    );

    // Build boost reasons
    const boostReasons = this.buildBoostReasons(
      topInsights,
      aiResult?.priority_boost_reason || ''
    );

    return {
      insights: topInsights,
      priority_boost: priorityBoost,
      priority_boost_reasons: boostReasons,
    };
  }

  /**
   * Synthesize rules-only (when AI is skipped or fails)
   */
  synthesizeRulesOnly(rulesInsights: DetectedPattern[]): SynthesizedResult {
    return this.synthesize(rulesInsights, null);
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  private convertRulesInsight(pattern: DetectedPattern): SynthesizedInsight {
    // Generate human-readable action text from structured action
    const actionText = pattern.action
      ? this.generateActionText(pattern.action)
      : null;

    return {
      id: this.generateId(),
      type: 'rule_detected',
      severity: pattern.severity,
      title: pattern.title,
      description: pattern.insight,
      action: pattern.action ?? null,
      action_text: actionText,
      confidence: pattern.confidence,
      source: 'rules',
      pattern_code: pattern.pattern_code,
      supporting_data: {
        ...pattern.supporting_data,
        pattern_code: pattern.pattern_code,
        pattern_id: pattern.pattern_id,
        // Store action in supporting_data for DB storage
        action: pattern.action ?? null,
      },
      priority_boost: pattern.priority_boost,
    };
  }

  /**
   * Generate human-readable action text from structured InsightAction
   */
  private generateActionText(action: InsightAction): string {
    const targetName = {
      shipper: 'shipper',
      consignee: 'consignee',
      carrier: 'carrier',
      internal: 'internal team',
      customs: 'customs broker',
    }[action.target];

    const urgencyText = {
      immediate: 'immediately',
      today: 'today',
      soon: 'when convenient',
    }[action.urgency];

    if (action.type === 'email') {
      return `Send email to ${targetName} ${urgencyText}`;
    } else if (action.type === 'call') {
      return `Call ${targetName} ${urgencyText}`;
    } else if (action.type === 'task') {
      return `Create task for ${targetName}`;
    } else if (action.type === 'escalate') {
      return `Escalate to ${targetName} ${urgencyText}`;
    }
    return `Contact ${targetName}`;
  }

  private convertAIInsight(insight: AIInsight): SynthesizedInsight {
    return {
      id: this.generateId(),
      type: insight.type,
      severity: insight.severity,
      title: insight.title,
      description: insight.description,
      action: null,  // AI insights don't have structured actions yet
      action_text: insight.action,  // AI returns action as text
      confidence: insight.confidence,
      source: 'ai',
      pattern_code: null,
      supporting_data: insight.supporting_data,
      priority_boost: SEVERITY_BOOST[insight.severity],
    };
  }

  private deduplicateInsights(
    insights: SynthesizedInsight[]
  ): SynthesizedInsight[] {
    const seen = new Map<string, SynthesizedInsight>();

    for (const insight of insights) {
      // Create similarity key based on title and severity
      const key = this.createSimilarityKey(insight);

      if (!seen.has(key)) {
        seen.set(key, insight);
      } else {
        // Prefer rules over AI for overlapping insights
        const existing = seen.get(key)!;
        if (insight.source === 'rules' && existing.source === 'ai') {
          // Mark as hybrid since both detected it
          seen.set(key, {
            ...insight,
            source: 'hybrid',
            confidence: Math.max(insight.confidence, existing.confidence),
          });
        } else if (insight.source === 'ai' && existing.source === 'rules') {
          // Mark existing as hybrid
          seen.set(key, {
            ...existing,
            source: 'hybrid',
            confidence: Math.max(insight.confidence, existing.confidence),
          });
        }
        // If both same source, keep first (higher priority from rules)
      }
    }

    return Array.from(seen.values());
  }

  private createSimilarityKey(insight: SynthesizedInsight): string {
    // Normalize title for comparison
    const normalizedTitle = insight.title
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 30);

    return `${insight.severity}:${normalizedTitle}`;
  }

  private rankInsights(insights: SynthesizedInsight[]): SynthesizedInsight[] {
    return [...insights].sort((a, b) => {
      // Primary: Severity (critical > high > medium > low)
      const severityDiff =
        SEVERITY_WEIGHTS[b.severity] - SEVERITY_WEIGHTS[a.severity];
      if (severityDiff !== 0) return severityDiff;

      // Secondary: Confidence
      const confidenceDiff = b.confidence - a.confidence;
      if (Math.abs(confidenceDiff) > 0.1) return confidenceDiff;

      // Tertiary: Prefer rules over AI (more reliable)
      if (a.source === 'rules' && b.source !== 'rules') return -1;
      if (b.source === 'rules' && a.source !== 'rules') return 1;

      // Quaternary: Priority boost
      return b.priority_boost - a.priority_boost;
    });
  }

  private calculatePriorityBoost(
    insights: SynthesizedInsight[],
    aiBoost: number
  ): number {
    if (insights.length === 0) return 0;

    // Sum individual boosts from insights
    let boost = insights.reduce((sum, i) => sum + i.priority_boost, 0);

    // Add AI's recommended boost (capped at 30)
    boost += Math.min(aiBoost, 30);

    // Cap total at MAX_PRIORITY_BOOST
    return Math.min(boost, MAX_PRIORITY_BOOST);
  }

  private buildBoostReasons(
    insights: SynthesizedInsight[],
    aiReason: string
  ): string[] {
    const reasons: string[] = [];

    // Group by severity
    const critical = insights.filter((i) => i.severity === 'critical');
    const high = insights.filter((i) => i.severity === 'high');
    const medium = insights.filter((i) => i.severity === 'medium');

    if (critical.length > 0) {
      const boost = critical.reduce((s, i) => s + i.priority_boost, 0);
      reasons.push(`Critical: ${critical.map((i) => i.title).join(', ')} (+${boost})`);
    }

    if (high.length > 0) {
      const boost = high.reduce((s, i) => s + i.priority_boost, 0);
      reasons.push(`High: ${high.map((i) => i.title).join(', ')} (+${boost})`);
    }

    if (medium.length > 0) {
      const boost = medium.reduce((s, i) => s + i.priority_boost, 0);
      reasons.push(`Medium: ${medium.length} issue(s) (+${boost})`);
    }

    // Add AI reason if present
    if (aiReason && aiReason.trim().length > 0) {
      reasons.push(`AI: ${aiReason}`);
    }

    return reasons;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createInsightSynthesizer(): InsightSynthesizer {
  return new InsightSynthesizer();
}
