/**
 * ActionRulesService
 *
 * Determines has_action based on document_type + content, not just keywords.
 * Philosophy: Document type determines DEFAULT action, with exception keywords that flip it.
 *
 * Example:
 * - booking_confirmation → default NO action (it's a confirmation)
 * - BUT if body contains "missing VGM" → FLIP to action required
 *
 * Phase 2 Enhancement: Semantic keyword matching
 * When exact keyword match fails, uses vector similarity to detect intent.
 * E.g., "please respond" semantically matches "action required" intent.
 *
 * Phase 3 Enhancement: Learning from similar past emails
 * Finds semantically similar past emails and checks what actions were taken.
 * Provides confidence-weighted recommendations based on historical patterns.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { IEmbeddingService } from './embedding-service';

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

/**
 * Result from learning from similar past emails
 */
export interface SimilarActionPattern {
  chronicleId: string;
  similarity: number;
  hasAction: boolean;
  actionCompleted: boolean;
  documentType: string;
  subject: string;
}

/**
 * Vector-based intent detection result
 */
export interface VectorIntentResult {
  matched: boolean;
  requiresAction: boolean;
  confidence: number;
  source: 'vector_intent' | 'similar_emails' | 'none';
  reasoning: string;
}

/**
 * Semantic action intent phrases - pre-defined groups for fast matching
 * These are common phrases that indicate action required or completion
 */
const ACTION_REQUIRED_PHRASES = [
  'please respond', 'please reply', 'kindly revert', 'awaiting your',
  'need your response', 'requires attention', 'action needed', 'urgent attention',
  'please confirm', 'please advise', 'let us know', 'waiting for',
  'pending your', 'require your', 'need to know', 'please provide',
  'missing information', 'incomplete', 'not received', 'still pending',
];

const ACTION_COMPLETED_PHRASES = [
  'completed', 'confirmed', 'approved', 'processed', 'submitted',
  'received thank', 'noted with thanks', 'acknowledged', 'done',
  'no action required', 'for your records', 'fyi only', 'for information',
  'already submitted', 'has been sent', 'was submitted', 'successfully',
];

/**
 * Intent anchor texts for vector similarity comparison
 * These represent canonical examples of action-required vs no-action emails
 */
const ACTION_REQUIRED_ANCHORS = [
  'Please respond to this request urgently. We need your confirmation.',
  'Action required: Please submit the missing documents immediately.',
  'Awaiting your response regarding the shipment details.',
  'Kindly revert with the updated information at your earliest.',
  'This requires your immediate attention and approval.',
];

const NO_ACTION_ANCHORS = [
  'This is for your information only. No action required.',
  'Booking has been confirmed. This is just a notification.',
  'Thank you, we have received your submission successfully.',
  'This is an automated confirmation. No response needed.',
  'For your records only. The process is complete.',
];

// Minimum similarity threshold for vector intent matching
const VECTOR_INTENT_MIN_SIMILARITY = 0.75;

// Minimum similarity for learning from past emails
const SIMILAR_EMAIL_MIN_SIMILARITY = 0.80;

// Number of similar past emails to consider
const SIMILAR_EMAIL_LIMIT = 5;

export class ActionRulesService {
  private rulesCache: Map<string, ActionRule> = new Map();
  private lookupCache: Map<string, ActionLookupEntry> = new Map();
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private embeddingService: IEmbeddingService | null = null;
  private semanticMatchEnabled: boolean = true;
  private vectorIntentEnabled: boolean = true;
  private learnFromSimilarEnabled: boolean = true;

  // Cache for intent anchor embeddings (computed once)
  private actionRequiredEmbeddings: number[][] | null = null;
  private noActionEmbeddings: number[][] | null = null;
  private intentEmbeddingsLoading: boolean = false;

  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Enable semantic matching with embedding service
   */
  setEmbeddingService(embeddingService: IEmbeddingService): void {
    this.embeddingService = embeddingService;
    console.log('[ActionRulesService] Semantic matching enabled');
  }

  /**
   * Toggle semantic matching (for testing/performance)
   */
  setSemanticMatchEnabled(enabled: boolean): void {
    this.semanticMatchEnabled = enabled;
  }

  /**
   * Toggle vector-based intent detection
   */
  setVectorIntentEnabled(enabled: boolean): void {
    this.vectorIntentEnabled = enabled;
  }

  /**
   * Toggle learning from similar past emails
   */
  setLearnFromSimilarEnabled(enabled: boolean): void {
    this.learnFromSimilarEnabled = enabled;
  }

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

    // No exact keyword flip - try phrase-based semantic intent detection
    const semanticIntent = this.findSemanticActionIntent(searchText);
    if (semanticIntent.matched) {
      const shouldFlip = semanticIntent.requiresAction !== rule.default_has_action;
      if (shouldFlip) {
        return {
          hasAction: semanticIntent.requiresAction,
          confidence: 80 + rule.confidence_boost,
          source: 'rule_flipped',
          documentType,
          defaultWasUsed: false,
          flipKeyword: `[semantic: ${semanticIntent.phrase}]`,
          reason: `Semantic match "${semanticIntent.phrase}" indicates ${semanticIntent.requiresAction ? 'action required' : 'no action'}`,
        };
      }
    }

    // Try vector-based intent detection (Phase 3)
    const vectorIntent = await this.detectIntentWithVector(searchText);
    if (vectorIntent.matched) {
      const shouldFlip = vectorIntent.requiresAction !== rule.default_has_action;
      if (shouldFlip) {
        return {
          hasAction: vectorIntent.requiresAction,
          confidence: Math.min(vectorIntent.confidence, 85) + rule.confidence_boost,
          source: 'rule_flipped',
          documentType,
          defaultWasUsed: false,
          flipKeyword: `[vector_intent]`,
          reason: vectorIntent.reasoning,
        };
      }
    }

    // Try learning from similar past emails (Phase 3) - only if rule default seems wrong
    const similarEmailsResult = await this.learnFromSimilarEmails(subject, body, documentType);
    if (similarEmailsResult.matched) {
      const shouldFlip = similarEmailsResult.requiresAction !== rule.default_has_action;
      // Only flip if similar emails strongly disagree with default AND have high confidence
      if (shouldFlip && similarEmailsResult.confidence >= 75) {
        return {
          hasAction: similarEmailsResult.requiresAction,
          confidence: Math.min(similarEmailsResult.confidence, 85) + rule.confidence_boost,
          source: 'rule_flipped',
          documentType,
          defaultWasUsed: false,
          flipKeyword: `[similar_emails]`,
          reason: similarEmailsResult.reasoning,
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
   * Uses enhanced detection: AI → Legacy Keywords → Phrase Match → Vector Intent → Similar Emails
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

    // Try phrase-based semantic intent detection
    const searchText = `${subject} ${body}`.toLowerCase();
    const semanticIntent = this.findSemanticActionIntent(searchText);
    if (semanticIntent.matched) {
      return {
        hasAction: semanticIntent.requiresAction,
        confidence: 70,
        source: 'rule_flipped',
        documentType,
        defaultWasUsed: false,
        flipKeyword: `[semantic: ${semanticIntent.phrase}]`,
        reason: `Semantic intent: "${semanticIntent.phrase}" indicates ${semanticIntent.requiresAction ? 'action required' : 'no action'}`,
      };
    }

    // Try vector-based intent detection (Phase 3)
    const vectorIntent = await this.detectIntentWithVector(searchText);
    if (vectorIntent.matched) {
      return {
        hasAction: vectorIntent.requiresAction,
        confidence: vectorIntent.confidence,
        source: 'rule_flipped',
        documentType,
        defaultWasUsed: false,
        flipKeyword: `[vector_intent]`,
        reason: vectorIntent.reasoning,
      };
    }

    // Try learning from similar past emails (Phase 3)
    const similarEmailsResult = await this.learnFromSimilarEmails(subject, body, documentType);
    if (similarEmailsResult.matched) {
      return {
        hasAction: similarEmailsResult.requiresAction,
        confidence: similarEmailsResult.confidence,
        source: 'rule_flipped',
        documentType,
        defaultWasUsed: false,
        flipKeyword: `[similar_emails]`,
        reason: similarEmailsResult.reasoning,
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
   * Enhanced with semantic phrase matching when exact match fails
   */
  private findMatchingKeyword(text: string, keywords: string[]): string | null {
    // FAST PATH: Exact keyword match
    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        return keyword;
      }
    }
    return null;
  }

  /**
   * Semantic keyword matching - checks common action intent phrases
   * Returns the matched phrase and whether it indicates action required
   */
  private findSemanticActionIntent(text: string): { matched: boolean; requiresAction: boolean; phrase: string | null } {
    if (!this.semanticMatchEnabled) {
      return { matched: false, requiresAction: false, phrase: null };
    }

    const lowerText = text.toLowerCase();

    // Check action required phrases
    for (const phrase of ACTION_REQUIRED_PHRASES) {
      if (lowerText.includes(phrase)) {
        return { matched: true, requiresAction: true, phrase };
      }
    }

    // Check action completed phrases
    for (const phrase of ACTION_COMPLETED_PHRASES) {
      if (lowerText.includes(phrase)) {
        return { matched: true, requiresAction: false, phrase };
      }
    }

    return { matched: false, requiresAction: false, phrase: null };
  }

  // ==========================================================================
  // VECTOR-BASED INTENT DETECTION (Phase 3)
  // ==========================================================================

  /**
   * Detect action intent using vector similarity
   * Compares email text against intent anchor embeddings
   */
  async detectIntentWithVector(text: string): Promise<VectorIntentResult> {
    if (!this.vectorIntentEnabled || !this.embeddingService) {
      return { matched: false, requiresAction: false, confidence: 0, source: 'none', reasoning: 'Vector intent disabled or no embedding service' };
    }

    try {
      // Ensure intent embeddings are loaded
      await this.ensureIntentEmbeddingsLoaded();

      if (!this.actionRequiredEmbeddings || !this.noActionEmbeddings) {
        return { matched: false, requiresAction: false, confidence: 0, source: 'none', reasoning: 'Intent embeddings not available' };
      }

      // Get embedding for the input text (use first 500 chars for efficiency)
      const textPreview = text.substring(0, 500);
      const result = await this.embeddingService.generateEmbeddingFromText(textPreview);

      if (!result.success || !result.embedding) {
        return { matched: false, requiresAction: false, confidence: 0, source: 'none', reasoning: 'Failed to generate embedding' };
      }

      // Compare against action required anchors
      const actionSimilarities = this.actionRequiredEmbeddings.map(anchor =>
        this.cosineSimilarity(result.embedding!, anchor)
      );
      const maxActionSimilarity = Math.max(...actionSimilarities);

      // Compare against no action anchors
      const noActionSimilarities = this.noActionEmbeddings.map(anchor =>
        this.cosineSimilarity(result.embedding!, anchor)
      );
      const maxNoActionSimilarity = Math.max(...noActionSimilarities);

      // Determine intent based on higher similarity
      const actionWins = maxActionSimilarity > maxNoActionSimilarity;
      const winningScore = actionWins ? maxActionSimilarity : maxNoActionSimilarity;
      const margin = Math.abs(maxActionSimilarity - maxNoActionSimilarity);

      // Only match if above threshold and clear winner
      if (winningScore >= VECTOR_INTENT_MIN_SIMILARITY && margin >= 0.05) {
        return {
          matched: true,
          requiresAction: actionWins,
          confidence: Math.round(winningScore * 100),
          source: 'vector_intent',
          reasoning: `Vector similarity: ${actionWins ? 'action_required' : 'no_action'} (${(winningScore * 100).toFixed(1)}% match, ${(margin * 100).toFixed(1)}% margin)`,
        };
      }

      return { matched: false, requiresAction: false, confidence: 0, source: 'none', reasoning: 'Below similarity threshold' };
    } catch (error) {
      console.error('[ActionRulesService] Vector intent detection error:', error);
      return { matched: false, requiresAction: false, confidence: 0, source: 'none', reasoning: 'Error during detection' };
    }
  }

  /**
   * Learn from similar past emails
   * Finds semantically similar emails and analyzes their action patterns
   */
  async learnFromSimilarEmails(
    subject: string,
    bodyPreview: string,
    documentType?: string
  ): Promise<VectorIntentResult> {
    if (!this.learnFromSimilarEnabled || !this.embeddingService) {
      return { matched: false, requiresAction: false, confidence: 0, source: 'none', reasoning: 'Similar email learning disabled' };
    }

    try {
      // Search for similar emails using semantic search
      const searchText = `${subject} ${bodyPreview.substring(0, 300)}`;
      const similarEmails = await this.embeddingService.searchGlobal(searchText, {
        limit: SIMILAR_EMAIL_LIMIT * 2, // Fetch more to filter
        minSimilarity: SIMILAR_EMAIL_MIN_SIMILARITY,
      });

      if (similarEmails.length === 0) {
        return { matched: false, requiresAction: false, confidence: 0, source: 'none', reasoning: 'No similar emails found' };
      }

      // Get action data for similar emails
      const similarIds = similarEmails.map(e => e.id);
      const { data: actionData, error } = await this.supabase
        .from('chronicle')
        .select('id, has_action, action_completed_at, document_type, subject')
        .in('id', similarIds);

      if (error || !actionData || actionData.length === 0) {
        return { matched: false, requiresAction: false, confidence: 0, source: 'none', reasoning: 'Could not fetch action data' };
      }

      // Build pattern analysis
      const patterns: SimilarActionPattern[] = actionData.map(row => {
        const similarEmail = similarEmails.find(e => e.id === row.id);
        return {
          chronicleId: row.id,
          similarity: similarEmail?.similarity || 0,
          hasAction: row.has_action || false,
          actionCompleted: !!row.action_completed_at,
          documentType: row.document_type || 'unknown',
          subject: row.subject || '',
        };
      });

      // Filter by document type if provided (optional constraint)
      const relevantPatterns = documentType
        ? patterns.filter(p => p.documentType === documentType || p.similarity > 0.90)
        : patterns;

      if (relevantPatterns.length === 0) {
        return { matched: false, requiresAction: false, confidence: 0, source: 'none', reasoning: 'No relevant patterns after filtering' };
      }

      // Weighted vote based on similarity
      let actionVotes = 0;
      let noActionVotes = 0;
      let totalWeight = 0;

      for (const pattern of relevantPatterns) {
        const weight = pattern.similarity;
        totalWeight += weight;
        if (pattern.hasAction) {
          actionVotes += weight;
        } else {
          noActionVotes += weight;
        }
      }

      // Calculate confidence based on consistency
      const actionRatio = actionVotes / totalWeight;
      const consistency = Math.abs(actionRatio - 0.5) * 2; // 0 = split, 1 = unanimous
      const confidence = Math.round((0.6 + consistency * 0.35) * 100); // 60-95% range

      const requiresAction = actionVotes > noActionVotes;
      const voteDetails = `${relevantPatterns.length} similar emails: ${Math.round(actionRatio * 100)}% had actions`;

      // Only use if we have enough consistency
      if (consistency >= 0.4 && relevantPatterns.length >= 2) {
        return {
          matched: true,
          requiresAction,
          confidence,
          source: 'similar_emails',
          reasoning: `Learned from ${voteDetails}`,
        };
      }

      return { matched: false, requiresAction: false, confidence: 0, source: 'none', reasoning: `Inconclusive: ${voteDetails}` };
    } catch (error) {
      console.error('[ActionRulesService] Learn from similar emails error:', error);
      return { matched: false, requiresAction: false, confidence: 0, source: 'none', reasoning: 'Error during learning' };
    }
  }

  /**
   * Load intent anchor embeddings (lazy, cached)
   */
  private async ensureIntentEmbeddingsLoaded(): Promise<void> {
    if (this.actionRequiredEmbeddings && this.noActionEmbeddings) {
      return; // Already loaded
    }

    if (this.intentEmbeddingsLoading) {
      // Wait for loading to complete
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.ensureIntentEmbeddingsLoaded();
    }

    if (!this.embeddingService) {
      return;
    }

    this.intentEmbeddingsLoading = true;

    try {
      // Generate embeddings for action required anchors
      const actionEmbeddings: number[][] = [];
      for (const anchor of ACTION_REQUIRED_ANCHORS) {
        const result = await this.embeddingService.generateEmbeddingFromText(anchor);
        if (result.success && result.embedding) {
          actionEmbeddings.push(result.embedding);
        }
      }

      // Generate embeddings for no action anchors
      const noActionEmbeddings: number[][] = [];
      for (const anchor of NO_ACTION_ANCHORS) {
        const result = await this.embeddingService.generateEmbeddingFromText(anchor);
        if (result.success && result.embedding) {
          noActionEmbeddings.push(result.embedding);
        }
      }

      this.actionRequiredEmbeddings = actionEmbeddings;
      this.noActionEmbeddings = noActionEmbeddings;

      console.log(`[ActionRulesService] Loaded ${actionEmbeddings.length} action + ${noActionEmbeddings.length} no-action intent embeddings`);
    } catch (error) {
      console.error('[ActionRulesService] Failed to load intent embeddings:', error);
    } finally {
      this.intentEmbeddingsLoading = false;
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
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
