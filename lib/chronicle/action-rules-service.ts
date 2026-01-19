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
  source: 'rule_default' | 'rule_flipped' | 'ai_fallback' | 'keyword_legacy' | 'lookup_table';
  documentType: string;
  defaultWasUsed: boolean;
  flipKeyword: string | null;
  reason: string;
}

export interface ActionLookupEntry {
  document_type: string;
  from_party: string;
  is_reply: boolean;
  has_action: boolean;
  action_description: string | null;
  confidence: number;
}

export class ActionRulesService {
  private rulesCache: Map<string, ActionRule> = new Map();
  private lookupCache: Map<string, ActionLookupEntry> = new Map();
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Main entry point: Determine has_action for a classified document
   * Priority: action_lookup (3-column) → document_type_action_rules → legacy keywords → AI fallback
   */
  async determineAction(
    documentType: string,
    subject: string,
    body: string,
    aiHasAction?: boolean,
    aiConfidence?: number,
    fromParty?: string
  ): Promise<ActionDetermination> {
    await this.ensureCacheLoaded();

    // Check if subject indicates this is a reply
    const isReply = /^(re:|fwd:|fw:)/i.test(subject.trim());

    // PRIORITY 1: Check action_lookup table (most specific: document_type + from_party + is_reply)
    if (fromParty) {
      const lookupResult = this.checkLookupTable(documentType, fromParty, isReply);
      if (lookupResult) {
        return lookupResult;
      }
    }

    // PRIORITY 2: Check document_type_action_rules (document_type + keywords)
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
   * Check action_lookup table for specific document_type + from_party + is_reply combination
   * This is the most specific rule and takes priority
   */
  private checkLookupTable(
    documentType: string,
    fromParty: string,
    isReply: boolean
  ): ActionDetermination | null {
    // Try exact match first
    const exactKey = `${documentType}|${fromParty}|${isReply}`;
    let entry = this.lookupCache.get(exactKey);

    // If no exact match, try with is_reply=false (non-reply rules apply to replies too)
    if (!entry && isReply) {
      const nonReplyKey = `${documentType}|${fromParty}|false`;
      entry = this.lookupCache.get(nonReplyKey);
    }

    if (!entry) {
      return null;
    }

    return {
      hasAction: entry.has_action,
      confidence: entry.confidence || 85,
      source: 'lookup_table',
      documentType,
      defaultWasUsed: true,
      flipKeyword: null,
      reason: entry.action_description || `${documentType} from ${fromParty}: has_action=${entry.has_action}`,
    };
  }

  /**
   * Load rules from database with caching
   */
  private async ensureCacheLoaded(): Promise<void> {
    if (Date.now() < this.cacheExpiry && this.rulesCache.size > 0) {
      return;
    }

    // Load document_type_action_rules
    const { data: rules, error } = await this.supabase
      .from('document_type_action_rules')
      .select('*')
      .eq('enabled', true);

    if (error) {
      console.error('[ActionRulesService] Failed to load rules:', error.message);
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

    // Load action_lookup table (more specific rules)
    const { data: lookups, error: lookupError } = await this.supabase
      .from('action_lookup')
      .select('*');

    if (lookupError) {
      console.error('[ActionRulesService] Failed to load action_lookup:', lookupError.message);
    }

    this.lookupCache.clear();
    for (const lookup of lookups || []) {
      const key = `${lookup.document_type}|${lookup.from_party}|${lookup.is_reply}`;
      this.lookupCache.set(key, {
        document_type: lookup.document_type,
        from_party: lookup.from_party,
        is_reply: lookup.is_reply,
        has_action: lookup.has_action,
        action_description: lookup.action_description,
        confidence: lookup.confidence || 85,
      });
    }

    this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
    console.log(`[ActionRulesService] Loaded ${this.rulesCache.size} action rules, ${this.lookupCache.size} lookup entries`);
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
    this.lookupCache.clear();
  }

  /**
   * Get all lookup entries (for admin UI)
   */
  async getAllLookupEntries(): Promise<ActionLookupEntry[]> {
    await this.ensureCacheLoaded();
    return Array.from(this.lookupCache.values());
  }
}
