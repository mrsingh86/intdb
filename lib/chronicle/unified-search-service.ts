/**
 * Unified Search Service
 *
 * Single entry point for all search operations.
 * Routes queries to keyword, semantic, or hybrid based on classification.
 * Uses RRF (Reciprocal Rank Fusion) to merge hybrid results.
 *
 * Following CLAUDE.md principles:
 * - Deep Modules (Principle #8) - simple interface, complex internals
 * - Single Responsibility (Principle #3) - only search orchestration
 * - Interface-Based Design (Principle #6)
 * - Never Return Null (Principle #20) - return empty arrays
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { IEmbeddingService } from './embedding-service';
import {
  classifyQuery,
  ClassifiedQuery,
  QueryType,
  SearchStrategy,
  getSearchFields,
} from './query-classifier';

// ============================================================================
// TYPES
// ============================================================================

export interface SearchResult {
  id: string;
  chronicleId: string;
  gmailMessageId: string | null;
  bookingNumber: string | null;
  mblNumber: string | null;
  documentType: string | null;
  subject: string;
  summary: string | null;
  fromAddress: string | null;
  fromParty: string | null;
  occurredAt: string | null;
  score: number;
  matchType: 'keyword' | 'semantic' | 'both';
  matchedFields?: string[];
}

export interface SearchOptions {
  limit?: number;
  minSimilarity?: number;  // For semantic search (0-1)
  includeFields?: string[];
  excludeIds?: string[];
}

export interface SearchResponse {
  results: SearchResult[];
  query: ClassifiedQuery;
  totalFound: number;
  searchTime: number;
  strategy: SearchStrategy;
}

export interface IUnifiedSearchService {
  /**
   * Main search method - classifies query and routes to appropriate search
   */
  search(query: string, options?: SearchOptions): Promise<SearchResponse>;

  /**
   * Force keyword-only search (for identifiers)
   */
  keywordSearch(query: string, fields: string[], options?: SearchOptions): Promise<SearchResult[]>;

  /**
   * Force semantic-only search (for concepts)
   */
  semanticSearch(query: string, options?: SearchOptions): Promise<SearchResult[]>;

  /**
   * Hybrid search with RRF merge
   */
  hybridSearch(query: string, fields: string[], options?: SearchOptions): Promise<SearchResult[]>;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_OPTIONS: Required<SearchOptions> = {
  limit: 50,
  minSimilarity: 0.70,
  includeFields: [],
  excludeIds: [],
};

const RRF_K = 60; // Standard RRF constant

// ============================================================================
// IMPLEMENTATION
// ============================================================================

export class UnifiedSearchService implements IUnifiedSearchService {
  constructor(
    private supabase: SupabaseClient,
    private embeddingService: IEmbeddingService | null
  ) {}

  // ==========================================================================
  // MAIN SEARCH METHOD
  // ==========================================================================

  async search(query: string, options?: SearchOptions): Promise<SearchResponse> {
    const startTime = Date.now();
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const classified = classifyQuery(query);

    let results: SearchResult[];

    switch (classified.searchStrategy) {
      case 'keyword':
        results = await this.keywordSearch(
          classified.normalizedQuery,
          getSearchFields(classified.queryType),
          opts
        );
        break;

      case 'semantic':
        results = await this.semanticSearch(classified.normalizedQuery, opts);
        break;

      case 'hybrid':
        results = await this.hybridSearch(
          classified.normalizedQuery,
          getSearchFields(classified.queryType),
          opts
        );
        break;

      default:
        results = [];
    }

    return {
      results: results.slice(0, opts.limit),
      query: classified,
      totalFound: results.length,
      searchTime: Date.now() - startTime,
      strategy: classified.searchStrategy,
    };
  }

  // ==========================================================================
  // KEYWORD SEARCH
  // ==========================================================================

  async keywordSearch(
    query: string,
    fields: string[],
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    try {
      // Build OR conditions for ILIKE search
      const pattern = `%${query}%`;
      const orConditions = fields
        .map(field => {
          if (field === 'container_numbers') {
            return `container_numbers.cs.{${query}}`;
          }
          return `${field}.ilike.${pattern}`;
        })
        .join(',');

      let queryBuilder = this.supabase
        .from('chronicle')
        .select(`
          id,
          gmail_message_id,
          booking_number,
          mbl_number,
          document_type,
          subject,
          summary,
          from_address,
          from_party,
          occurred_at
        `)
        .or(orConditions)
        .order('occurred_at', { ascending: false })
        .limit(opts.limit);

      // Exclude specific IDs if provided
      if (opts.excludeIds && opts.excludeIds.length > 0) {
        queryBuilder = queryBuilder.not('id', 'in', `(${opts.excludeIds.join(',')})`);
      }

      const { data, error } = await queryBuilder;

      if (error) {
        console.error('[UnifiedSearch] Keyword search error:', error);
        return [];
      }

      return this.mapToResults(data || [], 'keyword', fields);
    } catch (error) {
      console.error('[UnifiedSearch] Keyword search exception:', error);
      return [];
    }
  }

  // ==========================================================================
  // SEMANTIC SEARCH
  // ==========================================================================

  async semanticSearch(
    query: string,
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    if (!this.embeddingService) {
      console.warn('[UnifiedSearch] Semantic search unavailable - no embedding service');
      return [];
    }

    try {
      const results = await this.embeddingService.searchGlobal(query, {
        limit: opts.limit,
        minSimilarity: opts.minSimilarity,
      });

      return results.map((r) => ({
        id: r.id,
        chronicleId: r.id,
        gmailMessageId: r.gmailMessageId || null,
        bookingNumber: r.bookingNumber || null,
        mblNumber: r.mblNumber || null,
        documentType: r.documentType || null,
        subject: r.subject || '',
        summary: r.summary || null,
        fromAddress: r.fromAddress || null,
        fromParty: null,
        occurredAt: r.occurredAt || null,
        score: r.similarity,
        matchType: 'semantic' as const,
        matchedFields: ['embedding'],
      }));
    } catch (error) {
      console.error('[UnifiedSearch] Semantic search exception:', error);
      return [];
    }
  }

  // ==========================================================================
  // HYBRID SEARCH (Keyword + Semantic + RRF Merge)
  // ==========================================================================

  async hybridSearch(
    query: string,
    fields: string[],
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Run both searches in parallel
    const [keywordResults, semanticResults] = await Promise.all([
      this.keywordSearch(query, fields, { ...opts, limit: opts.limit * 2 }),
      this.semanticSearch(query, { ...opts, limit: opts.limit * 2 }),
    ]);

    // Merge using RRF
    return this.rrfMerge(keywordResults, semanticResults, opts.limit);
  }

  // ==========================================================================
  // RRF (RECIPROCAL RANK FUSION) MERGE
  // ==========================================================================

  private rrfMerge(
    keywordResults: SearchResult[],
    semanticResults: SearchResult[],
    limit: number
  ): SearchResult[] {
    const scores = new Map<string, { score: number; result: SearchResult }>();

    // Score keyword results
    keywordResults.forEach((result, rank) => {
      const id = result.id;
      const rrfScore = 1 / (RRF_K + rank + 1);

      scores.set(id, {
        score: rrfScore,
        result: { ...result, matchType: 'keyword' },
      });
    });

    // Add/merge semantic results
    semanticResults.forEach((result, rank) => {
      const id = result.id;
      const rrfScore = 1 / (RRF_K + rank + 1);

      if (scores.has(id)) {
        // Document in BOTH results - boost score and mark as 'both'
        const existing = scores.get(id)!;
        existing.score += rrfScore;
        existing.result.matchType = 'both';
        // Keep higher similarity score
        if (result.score > existing.result.score) {
          existing.result.score = result.score;
        }
      } else {
        scores.set(id, {
          score: rrfScore,
          result: { ...result, matchType: 'semantic' },
        });
      }
    });

    // Sort by combined RRF score descending
    const merged = Array.from(scores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(x => ({ ...x.result, score: x.score }));

    return merged;
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private mapToResults(
    rows: any[],
    matchType: 'keyword' | 'semantic',
    matchedFields: string[]
  ): SearchResult[] {
    return rows.map((row, index) => ({
      id: row.id,
      chronicleId: row.id,
      gmailMessageId: row.gmail_message_id || null,
      bookingNumber: this.cleanBookingNumber(row.booking_number),
      mblNumber: row.mbl_number || null,
      documentType: row.document_type || null,
      subject: row.subject || '',
      summary: row.summary || null,
      fromAddress: row.from_address || null,
      fromParty: row.from_party || null,
      occurredAt: row.occurred_at || null,
      score: 1 - (index * 0.01), // Descending score based on order
      matchType,
      matchedFields,
    }));
  }

  /**
   * Clean booking number (handle JSON array strings)
   */
  private cleanBookingNumber(value: any): string | null {
    if (!value) return null;
    if (typeof value !== 'string') return null;

    // Handle JSON array format: ["2038256270"]
    if (value.startsWith('[') && value.endsWith(']')) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed[0];
        }
      } catch {
        // Not valid JSON, return as-is
      }
    }

    return value;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createUnifiedSearchService(
  supabase: SupabaseClient,
  embeddingService: IEmbeddingService | null
): IUnifiedSearchService {
  return new UnifiedSearchService(supabase, embeddingService);
}
