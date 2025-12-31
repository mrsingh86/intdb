/**
 * Insight Engine
 *
 * Main orchestrator for the proactive intelligence system.
 * Combines rule-based pattern detection with optional AI analysis
 * to discover hidden risks and opportunities.
 *
 * Pipeline:
 * 1. Context Gatherer → Collects all relevant data
 * 2. Pattern Detector → Rules-based detection (fast, deterministic)
 * 3. AI Analyzer → Claude-powered discovery (optional, deeper)
 * 4. Synthesizer → Combines and ranks insights
 *
 * Principles:
 * - Deep Module: Simple interface hiding complex orchestration
 * - Single Responsibility: Orchestration only, delegates to specialists
 * - Fail Gracefully: AI failure doesn't break rules-based insights
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { InsightContextGatherer } from './insight-context-gatherer';
import { InsightPatternDetector } from './insight-pattern-detector';
import { InsightAIAnalyzer } from './insight-ai-analyzer';
import { InsightSynthesizer, SynthesizedInsight } from './insight-synthesizer';
import { InsightRepository, InsightCreateInput } from '@/lib/repositories/insight-repository';
import {
  InsightContext,
  InsightEngineResult,
  Insight,
  DetectedPattern,
  AIInsightResult,
  InsightGenerationOptions,
  PatternCategory,
} from '@/types/insight';

// ============================================================================
// INTERFACES
// ============================================================================

interface ContextSummary {
  shipment_booking: string | null;
  days_to_etd: number | null;
  days_to_nearest_cutoff: number | null;
  active_issues_count: number;
}

interface GenerationStats {
  rules_checked: number;
  rules_matched: number;
  ai_ran: boolean;
  ai_insights: number;
  duration_ms: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MAX_PRIORITY_BOOST = 50;
const MAX_INSIGHTS_DEFAULT = 10;

// ============================================================================
// INSIGHT ENGINE SERVICE
// ============================================================================

export class InsightEngine {
  private contextGatherer: InsightContextGatherer;
  private patternDetector: InsightPatternDetector;
  private aiAnalyzer: InsightAIAnalyzer | null;
  private synthesizer: InsightSynthesizer;
  private repository: InsightRepository;

  constructor(
    private readonly supabase: SupabaseClient,
    anthropicApiKey?: string
  ) {
    this.contextGatherer = new InsightContextGatherer(supabase);
    this.patternDetector = new InsightPatternDetector();
    this.aiAnalyzer = anthropicApiKey
      ? new InsightAIAnalyzer(anthropicApiKey)
      : null;
    this.synthesizer = new InsightSynthesizer();
    this.repository = new InsightRepository(supabase);
  }

  // --------------------------------------------------------------------------
  // MAIN PUBLIC METHODS
  // --------------------------------------------------------------------------

  /**
   * Generate insights for a shipment
   * This is the main entry point for the insight engine
   */
  async generateInsights(
    shipmentId: string,
    options: InsightGenerationOptions = {}
  ): Promise<InsightEngineResult> {
    const startTime = Date.now();
    const stats: GenerationStats = {
      rules_checked: 0,
      rules_matched: 0,
      ai_ran: false,
      ai_insights: 0,
      duration_ms: 0,
    };

    try {
      // Stage 1: Gather context
      const context = await this.contextGatherer.gatherContext(shipmentId);

      // Stage 2: Detect patterns (rules-based)
      const allPatterns = this.patternDetector.getAvailablePatterns();
      stats.rules_checked = options.categories
        ? allPatterns.filter((p) => options.categories!.includes(p.category)).length
        : allPatterns.length;

      let detectedPatterns: DetectedPattern[];
      if (options.categories) {
        const categoryResults = await Promise.all(
          options.categories.map((cat) =>
            this.patternDetector.detectPatternsByCategory(context, cat)
          )
        );
        detectedPatterns = categoryResults.flat();
      } else {
        detectedPatterns = await this.patternDetector.detectPatterns(context);
      }
      stats.rules_matched = detectedPatterns.length;

      // Stage 3: AI Analysis (optional, when API key provided)
      let aiResult: AIInsightResult | null = null;
      if (!options.skipAI && this.aiAnalyzer) {
        // Only run AI if valuable (cost optimization)
        const shouldRunAI = this.aiAnalyzer.shouldRunAnalysis(
          context,
          detectedPatterns.length
        );

        if (shouldRunAI) {
          try {
            aiResult = await this.aiAnalyzer.analyzeContext(context);
            stats.ai_ran = true;
            stats.ai_insights = aiResult.insights.length;
          } catch (error) {
            console.warn('AI analysis failed, using rules only:', error);
            stats.ai_ran = false;
            stats.ai_insights = 0;
          }
        }
      }

      // Stage 4: Synthesize insights (combine rules + AI)
      const synthesized = this.synthesizer.synthesize(detectedPatterns, aiResult);

      // Limit to max insights
      const maxInsights = options.maxInsights || MAX_INSIGHTS_DEFAULT;
      const topInsights = synthesized.insights.slice(0, maxInsights);

      // Convert synthesized to storable format and persist
      const insights = await this.storeSynthesizedInsights(
        shipmentId,
        topInsights,
        options
      );

      // Use synthesized priority boost (already includes AI boost)
      const priorityBoost = synthesized.priority_boost;
      const priorityBoostReasons = synthesized.priority_boost_reasons;

      // Build context summary
      const contextSummary = this.buildContextSummary(context, topInsights.length);

      stats.duration_ms = Date.now() - startTime;

      // Log generation
      await this.logGeneration(shipmentId, stats, priorityBoost);

      return {
        insights,
        priority_boost: priorityBoost,
        priority_boost_reasons: priorityBoostReasons,
        context_summary: contextSummary,
        generation_stats: stats,
      };
    } catch (error) {
      stats.duration_ms = Date.now() - startTime;
      await this.logGeneration(shipmentId, stats, 0, error);
      throw error;
    }
  }

  /**
   * Quick insights without AI (for bulk processing)
   */
  async generateQuickInsights(shipmentId: string): Promise<InsightEngineResult> {
    return this.generateInsights(shipmentId, { skipAI: true });
  }

  /**
   * Generate insights for multiple shipments
   */
  async generateBulkInsights(
    shipmentIds: string[],
    options: InsightGenerationOptions = {}
  ): Promise<Map<string, InsightEngineResult>> {
    const results = new Map<string, InsightEngineResult>();

    for (const shipmentId of shipmentIds) {
      try {
        const result = await this.generateQuickInsights(shipmentId);
        results.set(shipmentId, result);
      } catch (error) {
        console.error(`Failed to generate insights for ${shipmentId}:`, error);
        // Continue with next shipment
      }
    }

    return results;
  }

  /**
   * Get active insights for a shipment
   */
  async getActiveInsights(shipmentId: string): Promise<Insight[]> {
    return this.repository.findByShipmentId(shipmentId, true);
  }

  /**
   * Get insights for a task
   */
  async getTaskInsights(taskId: string): Promise<Insight[]> {
    return this.repository.findByTaskId(taskId, true);
  }

  /**
   * Link insights to a task
   */
  async linkInsightsToTask(shipmentId: string, taskId: string): Promise<void> {
    const insights = await this.repository.findByShipmentId(shipmentId, true);

    for (const insight of insights) {
      if (!insight.task_id) {
        await this.supabase
          .from('shipment_insights')
          .update({ task_id: taskId })
          .eq('id', insight.id);
      }
    }
  }

  /**
   * Acknowledge an insight
   */
  async acknowledgeInsight(insightId: string, userId?: string): Promise<Insight> {
    return this.repository.updateStatus(insightId, 'acknowledged', userId);
  }

  /**
   * Resolve an insight
   */
  async resolveInsight(insightId: string): Promise<Insight> {
    return this.repository.updateStatus(insightId, 'resolved');
  }

  /**
   * Dismiss an insight
   */
  async dismissInsight(insightId: string): Promise<Insight> {
    return this.repository.updateStatus(insightId, 'dismissed');
  }

  /**
   * Submit feedback for an insight
   */
  async submitFeedback(
    insightId: string,
    feedbackType: 'helpful' | 'not_helpful' | 'false_positive' | 'saved_money' | 'saved_time' | 'prevented_issue',
    value?: Record<string, unknown>,
    notes?: string,
    userId?: string
  ): Promise<void> {
    await this.repository.createFeedback(insightId, feedbackType, value, notes, userId);
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  private async storeSynthesizedInsights(
    shipmentId: string,
    synthesizedInsights: SynthesizedInsight[],
    options: InsightGenerationOptions
  ): Promise<Insight[]> {
    if (synthesizedInsights.length === 0) {
      return [];
    }

    // Convert synthesized insights to storage format
    const inputs: InsightCreateInput[] = synthesizedInsights.map((insight) => ({
      shipment_id: shipmentId,
      insight_type: insight.type,
      severity: insight.severity,
      title: insight.title,
      description: insight.description,
      // Store human-readable action text in recommended_action column
      recommended_action: insight.action_text || undefined,
      source: insight.source,
      confidence: insight.confidence,
      // Store structured action in supporting_data for CommunicationExecutorService
      supporting_data: {
        ...insight.supporting_data,
        action: insight.action,
      },
      priority_boost: insight.priority_boost,
      boost_reason: insight.pattern_code
        ? `Pattern: ${insight.pattern_code}`
        : insight.source === 'ai'
        ? 'AI Analysis'
        : 'Hybrid Detection',
    }));

    // Store insights (with duplicate handling)
    if (!options.forceRefresh) {
      // Check for existing insights today
      const existing = await this.repository.findByShipmentId(shipmentId, true);
      const existingKeys = new Set(
        existing.map((i) => this.createInsightKey(i))
      );

      // Filter out duplicates (by title + severity combination)
      const newInputs = inputs.filter((i) => {
        const key = `${i.severity}:${i.title.toLowerCase().slice(0, 30)}`;
        return !existingKeys.has(key);
      });

      if (newInputs.length === 0) {
        return existing;
      }

      const newInsights = await this.repository.createBatch(newInputs);
      return [...existing, ...newInsights];
    }

    // Force refresh - delete old and create new
    return this.repository.createBatch(inputs);
  }

  private createInsightKey(insight: Insight): string {
    return `${insight.severity}:${insight.title.toLowerCase().slice(0, 30)}`;
  }

  private calculatePriorityBoost(patterns: DetectedPattern[]): number {
    if (patterns.length === 0) return 0;

    // Sum individual boosts, cap at MAX_PRIORITY_BOOST
    const totalBoost = patterns.reduce((sum, p) => sum + p.priority_boost, 0);
    return Math.min(totalBoost, MAX_PRIORITY_BOOST);
  }

  private buildBoostReasons(patterns: DetectedPattern[]): string[] {
    const reasons: string[] = [];

    const critical = patterns.filter((p) => p.severity === 'critical');
    if (critical.length > 0) {
      reasons.push(
        `Critical: ${critical.map((p) => p.title).join(', ')} (+${critical.reduce((s, p) => s + p.priority_boost, 0)})`
      );
    }

    const high = patterns.filter((p) => p.severity === 'high');
    if (high.length > 0) {
      reasons.push(
        `High: ${high.map((p) => p.title).join(', ')} (+${high.reduce((s, p) => s + p.priority_boost, 0)})`
      );
    }

    const medium = patterns.filter((p) => p.severity === 'medium');
    if (medium.length > 0) {
      reasons.push(
        `Medium: ${medium.length} issue(s) (+${medium.reduce((s, p) => s + p.priority_boost, 0)})`
      );
    }

    return reasons;
  }

  private buildContextSummary(
    context: InsightContext,
    activeIssuesCount: number
  ): ContextSummary {
    const now = new Date();

    // Days to ETD
    let daysToEtd: number | null = null;
    if (context.shipment.dates.etd) {
      daysToEtd = Math.round(
        (context.shipment.dates.etd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    // Days to nearest cutoff
    const cutoffs = [
      context.shipment.dates.si_cutoff,
      context.shipment.dates.vgm_cutoff,
      context.shipment.dates.cargo_cutoff,
      context.shipment.dates.gate_cutoff,
    ].filter((c) => c !== null && c.getTime() > now.getTime()) as Date[];

    let daysToNearestCutoff: number | null = null;
    if (cutoffs.length > 0) {
      cutoffs.sort((a, b) => a.getTime() - b.getTime());
      daysToNearestCutoff = Math.round(
        (cutoffs[0].getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    return {
      shipment_booking: context.shipment.booking_number,
      days_to_etd: daysToEtd,
      days_to_nearest_cutoff: daysToNearestCutoff,
      active_issues_count: activeIssuesCount,
    };
  }

  private async logGeneration(
    shipmentId: string,
    stats: GenerationStats,
    priorityBoost: number,
    error?: unknown
  ): Promise<void> {
    await this.repository.logGeneration({
      shipment_id: shipmentId,
      generation_type: 'on_demand',
      rules_patterns_checked: stats.rules_checked,
      rules_patterns_matched: stats.rules_matched,
      ai_analysis_ran: stats.ai_ran,
      ai_insights_generated: stats.ai_insights,
      total_insights_generated: stats.rules_matched + stats.ai_insights,
      priority_boost_applied: priorityBoost,
      duration_ms: stats.duration_ms,
      error_message: error ? String(error) : undefined,
    });
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create an InsightEngine instance
 * Pass anthropicApiKey to enable AI-powered insights
 */
export function createInsightEngine(
  supabase: SupabaseClient,
  anthropicApiKey?: string
): InsightEngine {
  return new InsightEngine(supabase, anthropicApiKey);
}
