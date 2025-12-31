/**
 * Insight Repository
 *
 * Data access layer for insight management including:
 * - Insight patterns (configurable rules)
 * - Shipment insights (generated results)
 * - Insight feedback (for ML improvement)
 * - Generation logs (for debugging)
 *
 * Principles:
 * - Information Hiding: Hides Supabase implementation
 * - Single Responsibility: Only database access
 * - No Null Returns: Throws exceptions or returns empty arrays
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  Insight,
  InsightStatus,
  InsightSeverity,
  InsightType,
  InsightSource,
  PatternCategory,
  InsightFeedback,
  FeedbackType,
  PatternDefinition,
} from '@/types/insight';

// ============================================================================
// INTERFACES
// ============================================================================

export interface InsightFilters {
  shipmentId?: string;
  taskId?: string;
  status?: InsightStatus | InsightStatus[];
  severity?: InsightSeverity | InsightSeverity[];
  source?: InsightSource;
  insightType?: InsightType;
  patternId?: string;
  generatedAfter?: string;
  activeOnly?: boolean;
}

export interface InsightCreateInput {
  shipment_id: string;
  task_id?: string;
  insight_type: InsightType;
  severity: InsightSeverity;
  title: string;
  description: string;
  recommended_action?: string;
  source: InsightSource;
  pattern_id?: string;
  confidence: number;
  supporting_data?: Record<string, unknown>;
  priority_boost?: number;
  boost_reason?: string;
  expires_at?: string;
}

export interface GenerationLogInput {
  shipment_id: string;
  generation_type: 'scheduled' | 'on_demand' | 'task_view';
  rules_patterns_checked: number;
  rules_patterns_matched: number;
  ai_analysis_ran: boolean;
  ai_insights_generated: number;
  total_insights_generated: number;
  priority_boost_applied: number;
  duration_ms: number;
  error_message?: string;
}

export interface PaginationOptions {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ============================================================================
// ERRORS
// ============================================================================

export class InsightNotFoundError extends Error {
  constructor(public insightId: string) {
    super(`Insight not found: ${insightId}`);
    this.name = 'InsightNotFoundError';
  }
}

export class PatternNotFoundError extends Error {
  constructor(public patternCode: string) {
    super(`Pattern not found: ${patternCode}`);
    this.name = 'PatternNotFoundError';
  }
}

// ============================================================================
// REPOSITORY CLASS
// ============================================================================

export class InsightRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  // --------------------------------------------------------------------------
  // PATTERN DEFINITIONS
  // --------------------------------------------------------------------------

  /**
   * Get all pattern definitions
   */
  async getPatterns(enabledOnly: boolean = true): Promise<PatternDefinition[]> {
    let query = this.supabase
      .from('insight_patterns')
      .select('*')
      .order('category')
      .order('severity');

    if (enabledOnly) {
      query = query.eq('enabled', true);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch patterns: ${error.message}`);
    }

    return (data || []).map(this.mapPatternFromDb);
  }

  /**
   * Get pattern by code
   */
  async getPatternByCode(patternCode: string): Promise<PatternDefinition> {
    const { data, error } = await this.supabase
      .from('insight_patterns')
      .select('*')
      .eq('pattern_code', patternCode)
      .single();

    if (error || !data) {
      throw new PatternNotFoundError(patternCode);
    }

    return this.mapPatternFromDb(data);
  }

  /**
   * Get patterns by category
   */
  async getPatternsByCategory(category: PatternCategory): Promise<PatternDefinition[]> {
    const { data, error } = await this.supabase
      .from('insight_patterns')
      .select('*')
      .eq('category', category)
      .eq('enabled', true)
      .order('severity');

    if (error) {
      throw new Error(`Failed to fetch patterns: ${error.message}`);
    }

    return (data || []).map(this.mapPatternFromDb);
  }

  /**
   * Enable/disable a pattern
   */
  async setPatternEnabled(patternId: string, enabled: boolean): Promise<void> {
    const { error } = await this.supabase
      .from('insight_patterns')
      .update({ enabled, updated_at: new Date().toISOString() })
      .eq('id', patternId);

    if (error) {
      throw new Error(`Failed to update pattern: ${error.message}`);
    }
  }

  // --------------------------------------------------------------------------
  // SHIPMENT INSIGHTS CRUD
  // --------------------------------------------------------------------------

  /**
   * Find insight by ID
   */
  async findById(id: string): Promise<Insight> {
    const { data, error } = await this.supabase
      .from('shipment_insights')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new InsightNotFoundError(id);
    }

    return this.mapInsightFromDb(data);
  }

  /**
   * Find all insights with filters
   */
  async findAll(
    filters: InsightFilters = {},
    pagination?: PaginationOptions
  ): Promise<PaginatedResult<Insight>> {
    let query = this.supabase
      .from('shipment_insights')
      .select('*', { count: 'exact' });

    // Apply filters
    if (filters.shipmentId) {
      query = query.eq('shipment_id', filters.shipmentId);
    }

    if (filters.taskId) {
      query = query.eq('task_id', filters.taskId);
    }

    if (filters.status) {
      if (Array.isArray(filters.status)) {
        query = query.in('status', filters.status);
      } else {
        query = query.eq('status', filters.status);
      }
    }

    if (filters.severity) {
      if (Array.isArray(filters.severity)) {
        query = query.in('severity', filters.severity);
      } else {
        query = query.eq('severity', filters.severity);
      }
    }

    if (filters.source) {
      query = query.eq('source', filters.source);
    }

    if (filters.insightType) {
      query = query.eq('insight_type', filters.insightType);
    }

    if (filters.patternId) {
      query = query.eq('pattern_id', filters.patternId);
    }

    if (filters.generatedAfter) {
      query = query.gte('generated_at', filters.generatedAfter);
    }

    if (filters.activeOnly) {
      query = query.eq('status', 'active');
    }

    // Order by severity and generated_at
    query = query
      .order('generated_at', { ascending: false });

    // Apply pagination
    if (pagination) {
      const offset = (pagination.page - 1) * pagination.limit;
      query = query.range(offset, offset + pagination.limit - 1);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch insights: ${error.message}`);
    }

    const totalPages = pagination
      ? Math.ceil((count || 0) / pagination.limit)
      : 1;

    return {
      data: (data || []).map(this.mapInsightFromDb),
      pagination: {
        page: pagination?.page || 1,
        limit: pagination?.limit || (count || 0),
        total: count || 0,
        totalPages,
      },
    };
  }

  /**
   * Find insights for a shipment
   */
  async findByShipmentId(
    shipmentId: string,
    activeOnly: boolean = true
  ): Promise<Insight[]> {
    const result = await this.findAll({
      shipmentId,
      activeOnly,
    });
    return result.data;
  }

  /**
   * Find insights for a task
   */
  async findByTaskId(taskId: string, activeOnly: boolean = true): Promise<Insight[]> {
    const result = await this.findAll({
      taskId,
      activeOnly,
    });
    return result.data;
  }

  /**
   * Create a new insight
   */
  async create(input: InsightCreateInput): Promise<Insight> {
    const { data, error } = await this.supabase
      .from('shipment_insights')
      .insert({
        shipment_id: input.shipment_id,
        task_id: input.task_id || null,
        insight_type: input.insight_type,
        severity: input.severity,
        title: input.title,
        description: input.description,
        recommended_action: input.recommended_action || null,
        source: input.source,
        pattern_id: input.pattern_id || null,
        confidence: input.confidence,
        supporting_data: input.supporting_data || {},
        priority_boost: input.priority_boost || 0,
        boost_reason: input.boost_reason || null,
        status: 'active',
        generated_at: new Date().toISOString(),
        expires_at: input.expires_at || null,
      })
      .select()
      .single();

    if (error) {
      // Handle unique constraint (one per pattern per day)
      if (error.code === '23505') {
        // Return existing insight
        const existing = await this.findExistingInsight(
          input.shipment_id,
          input.pattern_id || null
        );
        if (existing) return existing;
      }
      throw new Error(`Failed to create insight: ${error.message}`);
    }

    return this.mapInsightFromDb(data);
  }

  /**
   * Create multiple insights in batch
   */
  async createBatch(inputs: InsightCreateInput[]): Promise<Insight[]> {
    if (inputs.length === 0) return [];

    const records = inputs.map((input) => ({
      shipment_id: input.shipment_id,
      task_id: input.task_id || null,
      insight_type: input.insight_type,
      severity: input.severity,
      title: input.title,
      description: input.description,
      recommended_action: input.recommended_action || null,
      source: input.source,
      pattern_id: input.pattern_id || null,
      confidence: input.confidence,
      supporting_data: input.supporting_data || {},
      priority_boost: input.priority_boost || 0,
      boost_reason: input.boost_reason || null,
      status: 'active',
      generated_at: new Date().toISOString(),
      expires_at: input.expires_at || null,
    }));

    const { data, error } = await this.supabase
      .from('shipment_insights')
      .insert(records)
      .select();

    if (error) {
      throw new Error(`Failed to create insights: ${error.message}`);
    }

    return (data || []).map(this.mapInsightFromDb);
  }

  /**
   * Update insight status
   */
  async updateStatus(
    id: string,
    status: InsightStatus,
    userId?: string
  ): Promise<Insight> {
    const updates: Record<string, unknown> = { status };

    if (status === 'acknowledged') {
      updates.acknowledged_at = new Date().toISOString();
      if (userId) updates.acknowledged_by = userId;
    } else if (status === 'resolved') {
      updates.resolved_at = new Date().toISOString();
    }

    const { data, error } = await this.supabase
      .from('shipment_insights')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update insight: ${error.message}`);
    }

    return this.mapInsightFromDb(data);
  }

  /**
   * Expire old insights
   */
  async expireOldInsights(): Promise<number> {
    const { data, error } = await this.supabase
      .from('shipment_insights')
      .update({ status: 'expired' })
      .eq('status', 'active')
      .lt('expires_at', new Date().toISOString())
      .select('id');

    if (error) {
      throw new Error(`Failed to expire insights: ${error.message}`);
    }

    return data?.length || 0;
  }

  // --------------------------------------------------------------------------
  // INSIGHT FEEDBACK
  // --------------------------------------------------------------------------

  /**
   * Create feedback for an insight
   */
  async createFeedback(
    insightId: string,
    feedbackType: FeedbackType,
    feedbackValue?: Record<string, unknown>,
    notes?: string,
    userId?: string
  ): Promise<InsightFeedback> {
    const { data, error } = await this.supabase
      .from('insight_feedback')
      .insert({
        insight_id: insightId,
        feedback_type: feedbackType,
        feedback_value: feedbackValue || {},
        notes: notes || null,
        created_by: userId || null,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create feedback: ${error.message}`);
    }

    return this.mapFeedbackFromDb(data);
  }

  /**
   * Get feedback for an insight
   */
  async getFeedback(insightId: string): Promise<InsightFeedback[]> {
    const { data, error } = await this.supabase
      .from('insight_feedback')
      .select('*')
      .eq('insight_id', insightId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch feedback: ${error.message}`);
    }

    return (data || []).map(this.mapFeedbackFromDb);
  }

  /**
   * Get feedback statistics for a pattern
   */
  async getPatternFeedbackStats(
    patternId: string
  ): Promise<{ total: number; helpful: number; notHelpful: number; falsePositive: number }> {
    const { data: insights } = await this.supabase
      .from('shipment_insights')
      .select('id')
      .eq('pattern_id', patternId);

    if (!insights || insights.length === 0) {
      return { total: 0, helpful: 0, notHelpful: 0, falsePositive: 0 };
    }

    const insightIds = insights.map((i) => i.id);

    const { data: feedback } = await this.supabase
      .from('insight_feedback')
      .select('feedback_type')
      .in('insight_id', insightIds);

    const stats = {
      total: feedback?.length || 0,
      helpful: feedback?.filter((f) => f.feedback_type === 'helpful').length || 0,
      notHelpful: feedback?.filter((f) => f.feedback_type === 'not_helpful').length || 0,
      falsePositive: feedback?.filter((f) => f.feedback_type === 'false_positive').length || 0,
    };

    return stats;
  }

  // --------------------------------------------------------------------------
  // GENERATION LOGS
  // --------------------------------------------------------------------------

  /**
   * Log insight generation run
   */
  async logGeneration(input: GenerationLogInput): Promise<void> {
    const { error } = await this.supabase.from('insight_generation_log').insert({
      shipment_id: input.shipment_id,
      generation_type: input.generation_type,
      rules_patterns_checked: input.rules_patterns_checked,
      rules_patterns_matched: input.rules_patterns_matched,
      ai_analysis_ran: input.ai_analysis_ran,
      ai_insights_generated: input.ai_insights_generated,
      total_insights_generated: input.total_insights_generated,
      priority_boost_applied: input.priority_boost_applied,
      duration_ms: input.duration_ms,
      error_message: input.error_message || null,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
    });

    if (error) {
      console.error('Failed to log generation:', error);
      // Don't throw - logging shouldn't break insight generation
    }
  }

  /**
   * Get generation statistics
   */
  async getGenerationStats(
    shipmentId?: string,
    days: number = 7
  ): Promise<{
    totalRuns: number;
    avgDurationMs: number;
    avgInsightsPerRun: number;
    errorRate: number;
  }> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    let query = this.supabase
      .from('insight_generation_log')
      .select('*')
      .gte('started_at', since.toISOString());

    if (shipmentId) {
      query = query.eq('shipment_id', shipmentId);
    }

    const { data } = await query;

    if (!data || data.length === 0) {
      return { totalRuns: 0, avgDurationMs: 0, avgInsightsPerRun: 0, errorRate: 0 };
    }

    const totalRuns = data.length;
    const avgDurationMs = data.reduce((sum, d) => sum + (d.duration_ms || 0), 0) / totalRuns;
    const avgInsightsPerRun =
      data.reduce((sum, d) => sum + (d.total_insights_generated || 0), 0) / totalRuns;
    const errorRate = data.filter((d) => d.error_message).length / totalRuns;

    return { totalRuns, avgDurationMs, avgInsightsPerRun, errorRate };
  }

  // --------------------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------------------

  private async findExistingInsight(
    shipmentId: string,
    patternId: string | null
  ): Promise<Insight | null> {
    const today = new Date().toISOString().split('T')[0];

    let query = this.supabase
      .from('shipment_insights')
      .select('*')
      .eq('shipment_id', shipmentId)
      .gte('generated_at', today)
      .lt('generated_at', today + 'T23:59:59.999Z');

    if (patternId) {
      query = query.eq('pattern_id', patternId);
    }

    const { data } = await query.single();

    return data ? this.mapInsightFromDb(data) : null;
  }

  private mapPatternFromDb(row: Record<string, unknown>): PatternDefinition {
    return {
      id: row.id as string,
      pattern_code: row.pattern_code as string,
      category: row.category as PatternCategory,
      name: row.name as string,
      description: row.description as string,
      severity: row.severity as InsightSeverity,
      priority_boost: row.priority_boost as number,
      enabled: row.enabled as boolean,
    };
  }

  private mapInsightFromDb(row: Record<string, unknown>): Insight {
    return {
      id: row.id as string,
      shipment_id: row.shipment_id as string,
      task_id: row.task_id as string | null,
      insight_type: row.insight_type as InsightType,
      severity: row.severity as InsightSeverity,
      title: row.title as string,
      description: row.description as string,
      recommended_action: row.recommended_action as string | null,
      source: row.source as InsightSource,
      pattern_id: row.pattern_id as string | null,
      confidence: row.confidence as number,
      supporting_data: (row.supporting_data || {}) as Record<string, unknown>,
      priority_boost: row.priority_boost as number,
      boost_reason: row.boost_reason as string | null,
      status: row.status as InsightStatus,
      acknowledged_at: row.acknowledged_at
        ? new Date(row.acknowledged_at as string)
        : null,
      resolved_at: row.resolved_at ? new Date(row.resolved_at as string) : null,
      generated_at: new Date(row.generated_at as string),
      expires_at: row.expires_at ? new Date(row.expires_at as string) : null,
    };
  }

  private mapFeedbackFromDb(row: Record<string, unknown>): InsightFeedback {
    return {
      id: row.id as string,
      insight_id: row.insight_id as string,
      feedback_type: row.feedback_type as FeedbackType,
      feedback_value: (row.feedback_value || {}) as InsightFeedback['feedback_value'],
      notes: row.notes as string | null,
      created_at: new Date(row.created_at as string),
      created_by: row.created_by as string | null,
    };
  }
}
