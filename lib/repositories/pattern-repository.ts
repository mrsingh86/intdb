/**
 * Pattern Repository
 *
 * Database-driven repository for detection patterns.
 * Replaces hardcoded patterns in shipping-line-patterns.ts with database-backed configuration.
 *
 * Features:
 * - In-memory caching with TTL
 * - Pattern matching by carrier, type, document type
 * - Compiled regex caching for performance
 *
 * Usage:
 *   const patternRepo = new PatternRepository(supabase);
 *   const patterns = await patternRepo.getByCarrier('maersk');
 *   const match = patternRepo.matchSubject(subject, patterns);
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

export type PatternType = 'subject' | 'sender' | 'attachment' | 'body';

export interface DetectionPattern {
  id: string;
  carrier_id: string;
  pattern_type: PatternType;
  document_type: string;
  pattern: string;
  pattern_flags: string;
  priority: number;
  description?: string;
  example_matches?: string[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface CompiledPattern extends DetectionPattern {
  regex: RegExp;
}

export interface PatternMatchResult {
  matched: boolean;
  pattern?: DetectionPattern;
  carrierId?: string;
  documentType?: string;
  confidence?: number;
  matchedText?: string;
}

interface PatternCache {
  patterns: DetectionPattern[];
  compiledPatterns: Map<string, CompiledPattern>;
  byCarrier: Map<string, DetectionPattern[]>;
  byType: Map<PatternType, DetectionPattern[]>;
  loadedAt: number;
  ttlMs: number;
}

// ============================================================================
// Pattern Repository
// ============================================================================

export class PatternRepository {
  private supabase: SupabaseClient;
  private cache: PatternCache | null = null;
  private readonly DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  // ==========================================================================
  // Query Methods
  // ==========================================================================

  /**
   * Get all enabled patterns
   */
  async getAllEnabled(): Promise<DetectionPattern[]> {
    await this.ensureCache();
    return this.cache!.patterns;
  }

  /**
   * Get patterns for a specific carrier
   */
  async getByCarrier(carrierId: string): Promise<DetectionPattern[]> {
    await this.ensureCache();
    return this.cache!.byCarrier.get(carrierId) || [];
  }

  /**
   * Get patterns by type (subject, sender, attachment, body)
   */
  async getByPatternType(type: PatternType): Promise<DetectionPattern[]> {
    await this.ensureCache();
    return this.cache!.byType.get(type) || [];
  }

  /**
   * Get patterns for a specific carrier and type
   */
  async getByCarrierAndType(
    carrierId: string,
    type: PatternType
  ): Promise<DetectionPattern[]> {
    const patterns = await this.getByCarrier(carrierId);
    return patterns.filter(p => p.pattern_type === type);
  }

  // ==========================================================================
  // Pattern Matching Methods
  // ==========================================================================

  /**
   * Match a subject line against all subject patterns
   */
  async matchSubject(subject: string): Promise<PatternMatchResult> {
    const patterns = await this.getByPatternType('subject');
    return this.matchAgainstPatterns(subject, patterns);
  }

  /**
   * Match a sender email against all sender patterns
   */
  async matchSender(senderEmail: string): Promise<PatternMatchResult> {
    const patterns = await this.getByPatternType('sender');
    return this.matchAgainstPatterns(senderEmail, patterns);
  }

  /**
   * Match an attachment filename against all attachment patterns
   */
  async matchAttachment(filename: string): Promise<PatternMatchResult> {
    const patterns = await this.getByPatternType('attachment');
    return this.matchAgainstPatterns(filename, patterns);
  }

  /**
   * Match body content against body patterns
   */
  async matchBody(bodyText: string): Promise<PatternMatchResult> {
    const patterns = await this.getByPatternType('body');
    return this.matchAgainstPatterns(bodyText, patterns);
  }

  /**
   * Classify an email using all pattern types
   */
  async classifyEmail(params: {
    subject: string;
    senderEmail: string;
    attachmentFilenames?: string[];
    bodyText?: string;
  }): Promise<PatternMatchResult> {
    // Try subject patterns first (highest priority)
    const subjectMatch = await this.matchSubject(params.subject);
    if (subjectMatch.matched && subjectMatch.confidence && subjectMatch.confidence >= 80) {
      return subjectMatch;
    }

    // Try sender patterns
    const senderMatch = await this.matchSender(params.senderEmail);

    // Try attachment patterns
    if (params.attachmentFilenames?.length) {
      for (const filename of params.attachmentFilenames) {
        const attachMatch = await this.matchAttachment(filename);
        if (attachMatch.matched) {
          // Combine with sender match if available
          return {
            ...attachMatch,
            carrierId: attachMatch.carrierId || senderMatch.carrierId,
            confidence: Math.max(attachMatch.confidence || 0, 70),
          };
        }
      }
    }

    // Try body patterns
    if (params.bodyText) {
      const bodyMatch = await this.matchBody(params.bodyText);
      if (bodyMatch.matched) {
        return {
          ...bodyMatch,
          carrierId: bodyMatch.carrierId || senderMatch.carrierId,
          confidence: Math.max(bodyMatch.confidence || 0, 60),
        };
      }
    }

    // Return best match found
    if (subjectMatch.matched) return subjectMatch;
    if (senderMatch.matched) return senderMatch;

    return { matched: false };
  }

  // ==========================================================================
  // Cache Management
  // ==========================================================================

  /**
   * Invalidate the cache (forces reload on next access)
   */
  invalidateCache(): void {
    this.cache = null;
  }

  /**
   * Check if cache is valid
   */
  isCacheValid(): boolean {
    if (!this.cache) return false;
    return Date.now() - this.cache.loadedAt < this.cache.ttlMs;
  }

  // ==========================================================================
  // CRUD Methods
  // ==========================================================================

  /**
   * Create a new pattern
   */
  async create(pattern: Omit<DetectionPattern, 'id' | 'created_at' | 'updated_at'>): Promise<DetectionPattern> {
    const { data, error } = await this.supabase
      .from('detection_patterns')
      .insert(pattern)
      .select()
      .single();

    if (error) throw new Error(`Failed to create pattern: ${error.message}`);
    this.invalidateCache();
    return data;
  }

  /**
   * Update an existing pattern
   */
  async update(id: string, updates: Partial<DetectionPattern>): Promise<DetectionPattern> {
    const { data, error } = await this.supabase
      .from('detection_patterns')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update pattern: ${error.message}`);
    this.invalidateCache();
    return data;
  }

  /**
   * Delete a pattern
   */
  async delete(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('detection_patterns')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Failed to delete pattern: ${error.message}`);
    this.invalidateCache();
  }

  /**
   * Bulk insert patterns (for seeding)
   */
  async bulkInsert(patterns: Omit<DetectionPattern, 'id' | 'created_at' | 'updated_at'>[]): Promise<number> {
    const { data, error } = await this.supabase
      .from('detection_patterns')
      .insert(patterns)
      .select();

    if (error) throw new Error(`Failed to bulk insert patterns: ${error.message}`);
    this.invalidateCache();
    return data?.length || 0;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async ensureCache(): Promise<void> {
    if (this.isCacheValid()) return;

    const { data, error } = await this.supabase
      .from('detection_patterns')
      .select('*')
      .eq('enabled', true)
      .order('priority', { ascending: false });

    if (error) throw new Error(`Failed to load patterns: ${error.message}`);

    const patterns = (data || []) as DetectionPattern[];

    // Build indexes
    const byCarrier = new Map<string, DetectionPattern[]>();
    const byType = new Map<PatternType, DetectionPattern[]>();
    const compiledPatterns = new Map<string, CompiledPattern>();

    for (const pattern of patterns) {
      // By carrier
      const carrierPatterns = byCarrier.get(pattern.carrier_id) || [];
      carrierPatterns.push(pattern);
      byCarrier.set(pattern.carrier_id, carrierPatterns);

      // By type
      const typePatterns = byType.get(pattern.pattern_type as PatternType) || [];
      typePatterns.push(pattern);
      byType.set(pattern.pattern_type as PatternType, typePatterns);

      // Compile regex
      try {
        const regex = new RegExp(pattern.pattern, pattern.pattern_flags || 'i');
        compiledPatterns.set(pattern.id, { ...pattern, regex });
      } catch (err) {
        console.error(`Invalid regex pattern ${pattern.id}: ${pattern.pattern}`, err);
      }
    }

    this.cache = {
      patterns,
      compiledPatterns,
      byCarrier,
      byType,
      loadedAt: Date.now(),
      ttlMs: this.DEFAULT_TTL_MS,
    };
  }

  private matchAgainstPatterns(
    text: string,
    patterns: DetectionPattern[]
  ): PatternMatchResult {
    if (!text || !patterns.length) {
      return { matched: false };
    }

    // Sort by priority (highest first)
    const sorted = [...patterns].sort((a, b) => b.priority - a.priority);

    for (const pattern of sorted) {
      const compiled = this.cache?.compiledPatterns.get(pattern.id);
      if (!compiled) continue;

      const match = text.match(compiled.regex);
      if (match) {
        return {
          matched: true,
          pattern,
          carrierId: pattern.carrier_id,
          documentType: pattern.document_type,
          confidence: Math.min(100, pattern.priority + 10),
          matchedText: match[0],
        };
      }
    }

    return { matched: false };
  }
}

export default PatternRepository;
