/**
 * Pattern Matcher Service
 *
 * Deterministic classification using database patterns.
 * No AI needed for high-confidence matches.
 *
 * Following CLAUDE.md principles:
 * - Configuration Over Code (Principle #5) - patterns from database
 * - Single Responsibility (Principle #3) - only pattern matching
 * - Interface-Based Design (Principle #6)
 * - Small Functions < 20 lines (Principle #17)
 * - Never Return Null (Principle #20) - use empty arrays
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { ProcessedEmail } from './types';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Pattern stored in detection_patterns table
 */
export interface DetectionPattern {
  id: string;
  carrierId: string;
  patternType: 'subject' | 'sender' | 'body';
  documentType: string;
  pattern: string;
  patternFlags: string;
  priority: number;
  confidenceBase: number;
  requiresAttachment: boolean;
  minThreadPosition: number | null;
  maxThreadPosition: number | null;
  notes: string | null;
}

/**
 * Result of pattern matching
 */
export interface PatternMatchResult {
  matched: boolean;
  documentType: string | null;
  carrierId: string | null;
  confidence: number;
  patternId: string | null;
  matchedPattern: string | null;
  matchSource: 'subject' | 'sender' | 'body' | null;
  requiresAiFallback: boolean;
}

/**
 * Email context for pattern matching
 */
export interface PatternMatchInput {
  subject: string;
  senderEmail: string;
  bodyText: string;
  hasAttachment: boolean;
  threadPosition: number; // 1-indexed position in thread
}

/**
 * Configuration for pattern matcher
 */
export interface PatternMatcherConfig {
  minConfidenceThreshold: number; // Below this, use AI
  cacheExpiryMs: number;          // How long to cache patterns
  enableHitTracking: boolean;     // Track pattern hits
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: PatternMatcherConfig = {
  minConfidenceThreshold: 85,
  cacheExpiryMs: 5 * 60 * 1000, // 5 minutes
  enableHitTracking: true,
};

// ============================================================================
// INTERFACE
// ============================================================================

export interface IPatternMatcherService {
  /**
   * Match email against patterns
   * Returns match result with confidence score
   */
  match(input: PatternMatchInput): Promise<PatternMatchResult>;

  /**
   * Reload patterns from database (invalidate cache)
   */
  reloadPatterns(): Promise<void>;

  /**
   * Get all loaded patterns (for debugging)
   */
  getLoadedPatterns(): DetectionPattern[];

  /**
   * Record a hit for learning (increments hit_count)
   */
  recordHit(patternId: string): Promise<void>;

  /**
   * Record a false positive for learning
   */
  recordFalsePositive(patternId: string): Promise<void>;
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

export class PatternMatcherService implements IPatternMatcherService {
  private patterns: DetectionPattern[] = [];
  private patternsLoadedAt: Date | null = null;
  private compiledPatterns: Map<string, RegExp> = new Map();
  private config: PatternMatcherConfig;

  constructor(
    private supabase: SupabaseClient,
    config: Partial<PatternMatcherConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================

  async match(input: PatternMatchInput): Promise<PatternMatchResult> {
    await this.ensurePatternsLoaded();

    const candidates = this.findMatchingPatterns(input);
    if (candidates.length === 0) {
      return this.createNoMatchResult();
    }

    const best = this.selectBestMatch(candidates, input);
    if (this.config.enableHitTracking && best.patternId) {
      this.recordHitAsync(best.patternId);
    }

    return best;
  }

  async reloadPatterns(): Promise<void> {
    this.patterns = [];
    this.patternsLoadedAt = null;
    this.compiledPatterns.clear();
    await this.loadPatterns();
  }

  getLoadedPatterns(): DetectionPattern[] {
    return [...this.patterns];
  }

  async recordHit(patternId: string): Promise<void> {
    await this.supabase.rpc('increment_pattern_hit', { pattern_id: patternId });
  }

  async recordFalsePositive(patternId: string): Promise<void> {
    await this.supabase.rpc('increment_pattern_false_positive', { pattern_id: patternId });
  }

  // ==========================================================================
  // PATTERN LOADING
  // ==========================================================================

  private async ensurePatternsLoaded(): Promise<void> {
    if (this.shouldReloadPatterns()) {
      await this.loadPatterns();
    }
  }

  private shouldReloadPatterns(): boolean {
    if (!this.patternsLoadedAt) return true;
    const age = Date.now() - this.patternsLoadedAt.getTime();
    return age > this.config.cacheExpiryMs;
  }

  private async loadPatterns(): Promise<void> {
    const { data, error } = await this.supabase
      .from('detection_patterns')
      .select('*')
      .eq('enabled', true)
      .order('priority', { ascending: false });

    if (error) {
      console.error('[PatternMatcher] Failed to load patterns:', error);
      return;
    }

    this.patterns = (data || []).map(this.mapDbPattern);
    this.patternsLoadedAt = new Date();
    this.compileAllPatterns();
  }

  private mapDbPattern(row: any): DetectionPattern {
    return {
      id: row.id,
      carrierId: row.carrier_id,
      patternType: row.pattern_type,
      documentType: row.document_type,
      pattern: row.pattern,
      patternFlags: row.pattern_flags || 'i',
      priority: row.priority || 50,
      confidenceBase: row.confidence_base || 100,
      requiresAttachment: row.requires_attachment || false,
      minThreadPosition: row.min_thread_position,
      maxThreadPosition: row.max_thread_position,
      notes: row.notes,
    };
  }

  private compileAllPatterns(): void {
    this.compiledPatterns.clear();
    for (const pattern of this.patterns) {
      try {
        const regex = new RegExp(pattern.pattern, pattern.patternFlags);
        this.compiledPatterns.set(pattern.id, regex);
      } catch (error) {
        console.error(`[PatternMatcher] Invalid regex for pattern ${pattern.id}:`, error);
      }
    }
  }

  // ==========================================================================
  // PATTERN MATCHING
  // ==========================================================================

  private findMatchingPatterns(input: PatternMatchInput): PatternMatchCandidate[] {
    const candidates: PatternMatchCandidate[] = [];

    for (const pattern of this.patterns) {
      if (!this.isPatternApplicable(pattern, input)) continue;

      const match = this.testPattern(pattern, input);
      if (match) {
        candidates.push(match);
      }
    }

    return candidates;
  }

  private isPatternApplicable(pattern: DetectionPattern, input: PatternMatchInput): boolean {
    // Check attachment requirement
    if (pattern.requiresAttachment && !input.hasAttachment) {
      return false;
    }

    // Check thread position constraints
    if (pattern.minThreadPosition !== null && input.threadPosition < pattern.minThreadPosition) {
      return false;
    }
    if (pattern.maxThreadPosition !== null && input.threadPosition > pattern.maxThreadPosition) {
      return false;
    }

    return true;
  }

  private testPattern(pattern: DetectionPattern, input: PatternMatchInput): PatternMatchCandidate | null {
    const regex = this.compiledPatterns.get(pattern.id);
    if (!regex) return null;

    const textToMatch = this.getTextForPatternType(pattern.patternType, input);
    if (!regex.test(textToMatch)) return null;

    const confidence = this.calculateConfidence(pattern, input);
    return {
      pattern,
      confidence,
      matchSource: pattern.patternType,
    };
  }

  private getTextForPatternType(patternType: string, input: PatternMatchInput): string {
    switch (patternType) {
      case 'subject': return input.subject;
      case 'sender': return input.senderEmail;
      case 'body': return input.bodyText.substring(0, 5000); // Limit body search
      default: return '';
    }
  }

  // ==========================================================================
  // CONFIDENCE CALCULATION
  // ==========================================================================

  private calculateConfidence(pattern: DetectionPattern, input: PatternMatchInput): number {
    let confidence = pattern.confidenceBase;

    // Reduce confidence for later thread positions (subject becomes less reliable)
    if (pattern.patternType === 'subject' && input.threadPosition > 1) {
      // Decay: 100% at pos 1 → ~70% at pos 5 → ~50% at pos 10
      const decay = Math.max(0.5, 1 - (input.threadPosition - 1) * 0.1);
      confidence = Math.round(confidence * decay);
    }

    // Boost confidence if attachment matches requirement
    if (pattern.requiresAttachment && input.hasAttachment) {
      confidence = Math.min(100, confidence + 5);
    }

    return confidence;
  }

  // ==========================================================================
  // MATCH SELECTION
  // ==========================================================================

  private selectBestMatch(candidates: PatternMatchCandidate[], input: PatternMatchInput): PatternMatchResult {
    // Sort by priority first, then confidence
    candidates.sort((a, b) => {
      if (b.pattern.priority !== a.pattern.priority) {
        return b.pattern.priority - a.pattern.priority;
      }
      return b.confidence - a.confidence;
    });

    const best = candidates[0];
    const requiresAiFallback = best.confidence < this.config.minConfidenceThreshold;

    return {
      matched: true,
      documentType: best.pattern.documentType,
      carrierId: best.pattern.carrierId,
      confidence: best.confidence,
      patternId: best.pattern.id,
      matchedPattern: best.pattern.pattern,
      matchSource: best.matchSource,
      requiresAiFallback,
    };
  }

  private createNoMatchResult(): PatternMatchResult {
    return {
      matched: false,
      documentType: null,
      carrierId: null,
      confidence: 0,
      patternId: null,
      matchedPattern: null,
      matchSource: null,
      requiresAiFallback: true,
    };
  }

  // ==========================================================================
  // ASYNC HIT TRACKING (non-blocking)
  // ==========================================================================

  private recordHitAsync(patternId: string): void {
    // Fire and forget - don't block the main flow
    this.recordHit(patternId).catch(error => {
      console.error('[PatternMatcher] Failed to record hit:', error);
    });
  }
}

/**
 * Internal type for match candidates
 */
interface PatternMatchCandidate {
  pattern: DetectionPattern;
  confidence: number;
  matchSource: 'subject' | 'sender' | 'body';
}

// ============================================================================
// FACTORY
// ============================================================================

export function createPatternMatcherService(
  supabase: SupabaseClient,
  config?: Partial<PatternMatcherConfig>
): IPatternMatcherService {
  return new PatternMatcherService(supabase, config);
}

// ============================================================================
// HELPER: Convert ProcessedEmail to PatternMatchInput
// ============================================================================

export function emailToPatternInput(
  email: ProcessedEmail,
  threadPosition: number = 1
): PatternMatchInput {
  return {
    subject: email.subject,
    senderEmail: email.senderEmail,
    bodyText: email.bodyText,
    hasAttachment: email.attachments.length > 0,
    threadPosition,
  };
}
