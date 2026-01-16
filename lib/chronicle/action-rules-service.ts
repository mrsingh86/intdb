/**
 * ActionRulesService
 *
 * Determines has_action based on document_type + content, not just keywords.
 * Philosophy: Document type determines DEFAULT action, with exception keywords that flip it.
 *
 * Example:
 * - booking_confirmation → default NO action (it's a confirmation)
 * - BUT if body contains "missing VGM" → FLIP to action required
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface ActionRule {
  document_type: string;
  default_has_action: boolean;
  default_reason: string | null;
  flip_to_action_keywords: string[];
  flip_to_no_action_keywords: string[];
  confidence_boost: number;
  enabled: boolean;
}

export interface ActionDetermination {
  hasAction: boolean;
  confidence: number;
  source: 'rule_default' | 'rule_flipped' | 'ai_fallback' | 'keyword_legacy';
  documentType: string;
  defaultWasUsed: boolean;
  flipKeyword: string | null;
  reason: string;
}

export class ActionRulesService {
  private rulesCache: Map<string, ActionRule> = new Map();
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Main entry point: Determine has_action for a classified document
   */
  async determineAction(
    documentType: string,
    subject: string,
    body: string,
    aiHasAction?: boolean,
    aiConfidence?: number
  ): Promise<ActionDetermination> {
    await this.ensureCacheLoaded();

    const rule = this.rulesCache.get(documentType);

    // No rule for this document type - fall back to AI or legacy keywords
    if (!rule || !rule.enabled) {
      return this.fallbackDetermination(documentType, subject, body, aiHasAction, aiConfidence);
    }

    const searchText = `${subject} ${body}`.toLowerCase();

    // Check if we should FLIP the default
    if (rule.default_has_action) {
      // Default is ACTION REQUIRED - check if we should flip to NO action
      const flipKeyword = this.findMatchingKeyword(searchText, rule.flip_to_no_action_keywords);
      if (flipKeyword) {
        return {
          hasAction: false,
          confidence: 90 + rule.confidence_boost,
          source: 'rule_flipped',
          documentType,
          defaultWasUsed: false,
          flipKeyword,
          reason: `${documentType} normally needs action, but "${flipKeyword}" indicates completion`,
        };
      }
    } else {
      // Default is NO ACTION - check if we should flip to action required
      const flipKeyword = this.findMatchingKeyword(searchText, rule.flip_to_action_keywords);
      if (flipKeyword) {
        return {
          hasAction: true,
          confidence: 90 + rule.confidence_boost,
          source: 'rule_flipped',
          documentType,
          defaultWasUsed: false,
          flipKeyword,
          reason: `${documentType} normally needs no action, but "${flipKeyword}" requires attention`,
        };
      }
    }

    // No flip - use the default
    return {
      hasAction: rule.default_has_action,
      confidence: 85 + rule.confidence_boost,
      source: 'rule_default',
      documentType,
      defaultWasUsed: true,
      flipKeyword: null,
      reason: rule.default_reason || `${documentType} default: has_action=${rule.default_has_action}`,
    };
  }

  /**
   * Fallback when no rule exists for document type
   */
  private async fallbackDetermination(
    documentType: string,
    subject: string,
    body: string,
    aiHasAction?: boolean,
    aiConfidence?: number
  ): Promise<ActionDetermination> {
    // If AI provided a determination with good confidence, use it
    if (aiHasAction !== undefined && aiConfidence && aiConfidence >= 70) {
      return {
        hasAction: aiHasAction,
        confidence: aiConfidence,
        source: 'ai_fallback',
        documentType,
        defaultWasUsed: false,
        flipKeyword: null,
        reason: `No rule for ${documentType}, using AI determination`,
      };
    }

    // Fall back to legacy keyword check
    const keywordResult = await this.checkLegacyKeywords(subject, body);
    if (keywordResult.matched) {
      return {
        hasAction: keywordResult.hasAction,
        confidence: 75,
        source: 'keyword_legacy',
        documentType,
        defaultWasUsed: false,
        flipKeyword: keywordResult.keyword,
        reason: `Legacy keyword match: "${keywordResult.keyword}"`,
      };
    }

    // Ultimate fallback: no action for unknown types
    return {
      hasAction: false,
      confidence: 50,
      source: 'rule_default',
      documentType,
      defaultWasUsed: true,
      flipKeyword: null,
      reason: `No rule or keywords matched for ${documentType}, defaulting to no action`,
    };
  }

  /**
   * Check legacy action_completion_keywords table (for backwards compatibility)
   */
  private async checkLegacyKeywords(
    subject: string,
    body: string
  ): Promise<{ matched: boolean; hasAction: boolean; keyword: string | null }> {
    const { data: keywords } = await this.supabase
      .from('action_completion_keywords')
      .select('keyword_pattern, pattern_flags, has_action_result')
      .eq('enabled', true);

    if (!keywords || keywords.length === 0) {
      return { matched: false, hasAction: false, keyword: null };
    }

    const searchText = `${subject} ${body}`;

    for (const kw of keywords) {
      try {
        const regex = new RegExp(kw.keyword_pattern, kw.pattern_flags || 'i');
        if (regex.test(searchText)) {
          return {
            matched: true,
            hasAction: kw.has_action_result,
            keyword: kw.keyword_pattern,
          };
        }
      } catch {
        // Invalid regex, skip
        continue;
      }
    }

    return { matched: false, hasAction: false, keyword: null };
  }

  /**
   * Find first matching keyword in text
   */
  private findMatchingKeyword(text: string, keywords: string[]): string | null {
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        return keyword;
      }
    }
    return null;
  }

  /**
   * Load rules from database with caching
   */
  private async ensureCacheLoaded(): Promise<void> {
    if (Date.now() < this.cacheExpiry && this.rulesCache.size > 0) {
      return;
    }

    const { data: rules, error } = await this.supabase
      .from('document_type_action_rules')
      .select('*')
      .eq('enabled', true);

    if (error) {
      console.error('[ActionRulesService] Failed to load rules:', error.message);
      return;
    }

    this.rulesCache.clear();
    for (const rule of rules || []) {
      this.rulesCache.set(rule.document_type, {
        document_type: rule.document_type,
        default_has_action: rule.default_has_action,
        default_reason: rule.default_reason,
        flip_to_action_keywords: rule.flip_to_action_keywords || [],
        flip_to_no_action_keywords: rule.flip_to_no_action_keywords || [],
        confidence_boost: rule.confidence_boost || 0,
        enabled: rule.enabled,
      });
    }

    this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
    console.log(`[ActionRulesService] Loaded ${this.rulesCache.size} action rules`);
  }

  /**
   * Get all rules (for admin UI)
   */
  async getAllRules(): Promise<ActionRule[]> {
    await this.ensureCacheLoaded();
    return Array.from(this.rulesCache.values());
  }

  /**
   * Invalidate cache (call after rule updates)
   */
  invalidateCache(): void {
    this.cacheExpiry = 0;
    this.rulesCache.clear();
  }
}
