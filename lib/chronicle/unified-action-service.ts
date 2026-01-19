/**
 * UnifiedActionService
 *
 * Single source of truth for action determination.
 * Replaces: ActionRulesService, PreciseActionService
 * Uses: action_rules table (unified)
 *
 * Features:
 * - Document type + from_party + is_reply lookup
 * - Flip keyword support (override has_action based on content)
 * - Smart deadline calculation (fixed days or cutoff-relative)
 * - Priority scoring with keyword boosts
 * - Auto-resolve configuration
 * - Caching for performance
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

export interface ActionRule {
  id: string;
  document_type: string;
  from_party: string;
  is_reply: boolean;
  applicable_stages: string[] | null;
  has_action: boolean;
  action_type: string | null;
  action_verb: string | null;
  action_description: string | null;
  to_party: string | null;
  action_owner: string | null;
  urgency: string | null;
  priority_base: number;
  priority_boost_keywords: string[] | null;
  priority_boost_amount: number;
  deadline_type: string | null;
  deadline_days: number | null;
  deadline_cutoff_field: string | null;
  deadline_cutoff_offset: number | null;
  auto_resolve_on: string[] | null;
  auto_resolve_keywords: string[] | null;
  requires_response: boolean;
  expected_response_type: string | null;
  flip_to_action_keywords: string[] | null;
  flip_to_no_action_keywords: string[] | null;
  confidence: number;
}

export interface ShipmentContext {
  shipmentId?: string;
  stage?: string;
  customerName?: string;
  bookingNumber?: string;
  siCutoff?: Date | null;
  vgmCutoff?: Date | null;
  cargoCutoff?: Date | null;
  docCutoff?: Date | null;
  eta?: Date | null;
}

export interface ActionRecommendation {
  // Core action flags
  hasAction: boolean;
  wasFlipped: boolean;
  flipKeyword: string | null;

  // Action details
  actionType: string | null;
  actionVerb: string | null;
  actionDescription: string | null;
  toParty: string | null;
  owner: string;

  // Priority
  priority: number;
  priorityLabel: 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
  urgency: string;

  // Deadline
  deadline: Date | null;
  deadlineSource: string | null;

  // Auto-resolution
  autoResolveOn: string[];
  autoResolveKeywords: string[];

  // Response tracking
  requiresResponse: boolean;
  expectedResponseType: string | null;

  // Metadata
  confidence: number;
  source: 'rule' | 'rule_flipped' | 'fallback';
  ruleId: string | null;
}

// ============================================================================
// SERVICE
// ============================================================================

export class UnifiedActionService {
  private ruleCache: Map<string, ActionRule> = new Map();
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Get action recommendation for a classified email
   * Main entry point - replaces both ActionRulesService and PreciseActionService
   */
  async getRecommendation(
    documentType: string,
    fromParty: string,
    isReply: boolean,
    subject: string,
    body: string,
    emailDate: Date,
    shipmentContext?: ShipmentContext
  ): Promise<ActionRecommendation> {
    await this.ensureCacheLoaded();

    // Find matching rule (try exact match, then wildcard from_party)
    const rule = this.findRule(documentType, fromParty, isReply);

    if (!rule) {
      return this.createFallbackRecommendation(documentType, fromParty);
    }

    // Check for flip keywords
    const { hasAction, wasFlipped, flipKeyword } = this.applyFlipKeywords(
      rule,
      subject,
      body
    );

    // Calculate priority with keyword boosts
    const { priority, priorityLabel } = this.calculatePriority(
      rule,
      subject,
      body,
      emailDate,
      shipmentContext
    );

    // Calculate deadline
    const { deadline, deadlineSource } = this.calculateDeadline(
      rule,
      emailDate,
      shipmentContext
    );

    // Build action description from template
    const actionDescription = this.renderDescription(
      rule.action_description,
      documentType,
      fromParty,
      shipmentContext
    );

    return {
      hasAction,
      wasFlipped,
      flipKeyword,
      actionType: hasAction ? rule.action_type : null,
      actionVerb: hasAction ? rule.action_verb : null,
      actionDescription: hasAction ? actionDescription : null,
      toParty: hasAction ? rule.to_party : null,
      owner: rule.action_owner || 'operations',
      priority,
      priorityLabel,
      urgency: rule.urgency || 'normal',
      deadline,
      deadlineSource,
      autoResolveOn: rule.auto_resolve_on || [],
      autoResolveKeywords: rule.auto_resolve_keywords || [],
      requiresResponse: rule.requires_response,
      expectedResponseType: rule.expected_response_type,
      confidence: rule.confidence,
      source: wasFlipped ? 'rule_flipped' : 'rule',
      ruleId: rule.id,
    };
  }

  /**
   * Simple has_action check (for backward compatibility)
   */
  async determineHasAction(
    documentType: string,
    fromParty: string,
    isReply: boolean,
    subject: string,
    body: string
  ): Promise<{ hasAction: boolean; reason: string | null; source: string }> {
    await this.ensureCacheLoaded();

    const rule = this.findRule(documentType, fromParty, isReply);

    if (!rule) {
      return {
        hasAction: this.defaultHasAction(documentType),
        reason: null,
        source: 'fallback',
      };
    }

    const { hasAction, wasFlipped, flipKeyword } = this.applyFlipKeywords(
      rule,
      subject,
      body
    );

    return {
      hasAction,
      reason: wasFlipped ? `Flipped by keyword: ${flipKeyword}` : rule.action_description,
      source: wasFlipped ? 'rule_flipped' : 'rule',
    };
  }

  // ==========================================================================
  // PRIVATE - RULE LOOKUP
  // ==========================================================================

  private findRule(
    documentType: string,
    fromParty: string,
    isReply: boolean
  ): ActionRule | null {
    // Try exact match first
    const exactKey = this.buildCacheKey(documentType, fromParty, isReply);
    if (this.ruleCache.has(exactKey)) {
      return this.ruleCache.get(exactKey)!;
    }

    // Try without is_reply flag
    const withoutReplyKey = this.buildCacheKey(documentType, fromParty, false);
    if (this.ruleCache.has(withoutReplyKey)) {
      return this.ruleCache.get(withoutReplyKey)!;
    }

    // Try wildcard from_party
    const wildcardKey = this.buildCacheKey(documentType, '*', false);
    if (this.ruleCache.has(wildcardKey)) {
      return this.ruleCache.get(wildcardKey)!;
    }

    // Try 'unknown' from_party
    const unknownKey = this.buildCacheKey(documentType, 'unknown', false);
    if (this.ruleCache.has(unknownKey)) {
      return this.ruleCache.get(unknownKey)!;
    }

    return null;
  }

  private buildCacheKey(documentType: string, fromParty: string, isReply: boolean): string {
    return `${documentType}|${fromParty}|${isReply}`;
  }

  // ==========================================================================
  // PRIVATE - FLIP KEYWORDS
  // ==========================================================================

  private applyFlipKeywords(
    rule: ActionRule,
    subject: string,
    body: string
  ): { hasAction: boolean; wasFlipped: boolean; flipKeyword: string | null } {
    const searchText = `${subject} ${body}`.toLowerCase();
    let hasAction = rule.has_action;
    let wasFlipped = false;
    let flipKeyword: string | null = null;

    // Check flip_to_action_keywords (no action → action)
    if (!hasAction && rule.flip_to_action_keywords?.length) {
      for (const keyword of rule.flip_to_action_keywords) {
        if (searchText.includes(keyword.toLowerCase())) {
          hasAction = true;
          wasFlipped = true;
          flipKeyword = keyword;
          break;
        }
      }
    }

    // Check flip_to_no_action_keywords (action → no action)
    if (hasAction && !wasFlipped && rule.flip_to_no_action_keywords?.length) {
      for (const keyword of rule.flip_to_no_action_keywords) {
        if (searchText.includes(keyword.toLowerCase())) {
          hasAction = false;
          wasFlipped = true;
          flipKeyword = keyword;
          break;
        }
      }
    }

    return { hasAction, wasFlipped, flipKeyword };
  }

  // ==========================================================================
  // PRIVATE - PRIORITY CALCULATION
  // ==========================================================================

  private calculatePriority(
    rule: ActionRule,
    subject: string,
    body: string,
    emailDate: Date,
    context?: ShipmentContext
  ): { priority: number; priorityLabel: 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW' } {
    let priority = rule.priority_base || 60;
    const searchText = `${subject} ${body}`.toLowerCase();

    // Boost for urgency keywords in rule
    if (rule.priority_boost_keywords?.length) {
      const hasBoostKeyword = rule.priority_boost_keywords.some(
        kw => searchText.includes(kw.toLowerCase())
      );
      if (hasBoostKeyword) {
        priority += rule.priority_boost_amount || 10;
      }
    }

    // Boost for common urgency terms
    const urgentTerms = ['urgent', 'asap', 'immediately', 'critical', 'deadline'];
    if (urgentTerms.some(term => searchText.includes(term))) {
      priority += 15;
    }

    // Boost if approaching cutoff
    if (context) {
      const cutoffBoost = this.getCutoffBoost(context);
      priority += cutoffBoost;
    }

    // Boost based on urgency field
    if (rule.urgency === 'critical') priority += 20;
    else if (rule.urgency === 'high') priority += 10;

    // Cap at 100
    priority = Math.min(priority, 100);

    // Determine label
    let priorityLabel: 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
    if (priority >= 85) priorityLabel = 'URGENT';
    else if (priority >= 70) priorityLabel = 'HIGH';
    else if (priority >= 50) priorityLabel = 'MEDIUM';
    else priorityLabel = 'LOW';

    return { priority, priorityLabel };
  }

  private getCutoffBoost(context: ShipmentContext): number {
    const now = new Date();
    let maxBoost = 0;

    const checkCutoff = (cutoff: Date | null | undefined, label: string) => {
      if (!cutoff) return;
      const daysUntil = this.daysBetween(now, cutoff);
      if (daysUntil <= 1) maxBoost = Math.max(maxBoost, 25);
      else if (daysUntil <= 3) maxBoost = Math.max(maxBoost, 15);
      else if (daysUntil <= 5) maxBoost = Math.max(maxBoost, 10);
    };

    checkCutoff(context.siCutoff, 'SI');
    checkCutoff(context.vgmCutoff, 'VGM');
    checkCutoff(context.cargoCutoff, 'Cargo');
    checkCutoff(context.docCutoff, 'Doc');

    return maxBoost;
  }

  // ==========================================================================
  // PRIVATE - DEADLINE CALCULATION
  // ==========================================================================

  private calculateDeadline(
    rule: ActionRule,
    emailDate: Date,
    context?: ShipmentContext
  ): { deadline: Date | null; deadlineSource: string | null } {
    if (!rule.deadline_type) {
      return { deadline: null, deadlineSource: null };
    }

    // Fixed days from email receipt
    if (rule.deadline_type === 'fixed_days' && rule.deadline_days) {
      const deadline = new Date(emailDate);
      deadline.setDate(deadline.getDate() + rule.deadline_days);
      return {
        deadline,
        deadlineSource: `${rule.deadline_days} day(s) from receipt`,
      };
    }

    // Relative to cutoff
    if (rule.deadline_type === 'cutoff_relative' && context && rule.deadline_cutoff_field) {
      const cutoffMap: Record<string, Date | null | undefined> = {
        siCutoff: context.siCutoff,
        vgmCutoff: context.vgmCutoff,
        cargoCutoff: context.cargoCutoff,
        docCutoff: context.docCutoff,
        si_cutoff: context.siCutoff,
        vgm_cutoff: context.vgmCutoff,
        cargo_cutoff: context.cargoCutoff,
        doc_cutoff: context.docCutoff,
      };

      const cutoffDate = cutoffMap[rule.deadline_cutoff_field];
      if (cutoffDate) {
        const deadline = new Date(cutoffDate);
        const offset = rule.deadline_cutoff_offset || -2;
        deadline.setDate(deadline.getDate() + offset);
        const cutoffName = rule.deadline_cutoff_field.replace('Cutoff', '').replace('_cutoff', '');
        return {
          deadline,
          deadlineSource: `${Math.abs(offset)} day(s) before ${cutoffName} cutoff`,
        };
      }
    }

    // Urgent = 24 hours
    if (rule.deadline_type === 'urgent') {
      const deadline = new Date(emailDate);
      deadline.setDate(deadline.getDate() + 1);
      return {
        deadline,
        deadlineSource: 'Urgent - within 24 hours',
      };
    }

    return { deadline: null, deadlineSource: null };
  }

  // ==========================================================================
  // PRIVATE - HELPERS
  // ==========================================================================

  private renderDescription(
    template: string | null,
    documentType: string,
    fromParty: string,
    context?: ShipmentContext
  ): string | null {
    if (!template) return null;

    let result = template;
    result = result.replace(/{document_type}/g, documentType.replace(/_/g, ' '));
    result = result.replace(/{from_party}/g, fromParty.replace(/_/g, ' '));
    result = result.replace(/{customer}/g, context?.customerName || 'customer');
    result = result.replace(/{booking}/g, context?.bookingNumber || '');

    return result;
  }

  private daysBetween(date1: Date, date2: Date): number {
    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    return Math.floor((date2.getTime() - date1.getTime()) / MS_PER_DAY);
  }

  private defaultHasAction(documentType: string): boolean {
    // Document types that typically don't need action
    const noActionTypes = [
      'tracking_update', 'schedule_update', 'acknowledgement',
      'notification', 'system_notification', 'booking_confirmation',
      'vgm_confirmation', 'si_confirmation', 'sob_confirmation',
    ];
    return !noActionTypes.some(t => documentType.includes(t));
  }

  private createFallbackRecommendation(
    documentType: string,
    fromParty: string
  ): ActionRecommendation {
    const hasAction = this.defaultHasAction(documentType);

    return {
      hasAction,
      wasFlipped: false,
      flipKeyword: null,
      actionType: hasAction ? 'review' : null,
      actionVerb: hasAction ? 'Review' : null,
      actionDescription: hasAction
        ? `Review ${documentType.replace(/_/g, ' ')} from ${fromParty.replace(/_/g, ' ')}`
        : null,
      toParty: null,
      owner: 'operations',
      priority: 50,
      priorityLabel: 'MEDIUM',
      urgency: 'normal',
      deadline: null,
      deadlineSource: null,
      autoResolveOn: [],
      autoResolveKeywords: [],
      requiresResponse: false,
      expectedResponseType: null,
      confidence: 50,
      source: 'fallback',
      ruleId: null,
    };
  }

  // ==========================================================================
  // PRIVATE - CACHE MANAGEMENT
  // ==========================================================================

  private async ensureCacheLoaded(): Promise<void> {
    if (Date.now() < this.cacheExpiry && this.ruleCache.size > 0) {
      return;
    }

    const { data: rules, error } = await this.supabase
      .from('action_rules')
      .select('*')
      .eq('enabled', true);

    if (error) {
      console.error('[UnifiedActionService] Failed to load rules:', error.message);
      return;
    }

    this.ruleCache.clear();
    for (const rule of rules || []) {
      const key = this.buildCacheKey(rule.document_type, rule.from_party, rule.is_reply);
      this.ruleCache.set(key, rule);
    }

    this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
    console.log(`[UnifiedActionService] Loaded ${this.ruleCache.size} action rules`);
  }

  /**
   * Invalidate cache (call after rule updates)
   */
  invalidateCache(): void {
    this.cacheExpiry = 0;
    this.ruleCache.clear();
  }

  /**
   * Get cache stats for monitoring
   */
  getCacheStats(): { size: number; expiresIn: number } {
    return {
      size: this.ruleCache.size,
      expiresIn: Math.max(0, this.cacheExpiry - Date.now()),
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createUnifiedActionService(supabase: SupabaseClient): UnifiedActionService {
  return new UnifiedActionService(supabase);
}
