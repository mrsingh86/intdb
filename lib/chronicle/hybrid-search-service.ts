/**
 * Hybrid Search Service
 *
 * Combines keyword search with semantic fallback for better recall.
 * Philosophy: Try fast keyword search first, fall back to vector search.
 *
 * Following CLAUDE.md principles:
 * - Deep Modules (Principle #8) - simple interface hiding complexity
 * - Interface-Based Design (Principle #6)
 * - Small Functions < 20 lines (Principle #17)
 * - Never Return Null (Principle #20) - return empty arrays
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { IEmbeddingService } from './embedding-service';

// ============================================================================
// TYPES
// ============================================================================

export interface HybridSearchResult {
  id: string;
  gmailMessageId: string;
  bookingNumber: string | null;
  mblNumber: string | null;
  documentType: string;
  subject: string;
  summary: string | null;
  fromAddress: string;
  occurredAt: string;
  similarity?: number;  // Only for semantic results
  matchSource: 'keyword' | 'semantic';
}

export interface HybridSearchConfig {
  keywordLimit: number;
  semanticLimit: number;
  semanticMinSimilarity: number;
  enableSemanticFallback: boolean;
}

export interface IHybridSearchService {
  /**
   * Search for emails by reference (booking, MBL, container)
   * Falls back to semantic search if keyword search returns no results
   */
  searchByReference(reference: string): Promise<HybridSearchResult[]>;

  /**
   * Search for emails by customer name (shipper/consignee)
   * Falls back to semantic search if keyword search returns no results
   */
  searchByCustomer(customerName: string): Promise<HybridSearchResult[]>;

  /**
   * Search for emails by free-text query
   * Uses hybrid: keyword first, then semantic to boost recall
   */
  searchByQuery(query: string): Promise<HybridSearchResult[]>;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: HybridSearchConfig = {
  keywordLimit: 50,
  semanticLimit: 20,
  semanticMinSimilarity: 0.70,
  enableSemanticFallback: true,
};

// ============================================================================
// IMPLEMENTATION
// ============================================================================

export class HybridSearchService implements IHybridSearchService {
  private config: HybridSearchConfig;

  constructor(
    private supabase: SupabaseClient,
    private embeddingService: IEmbeddingService | null,
    config: Partial<HybridSearchConfig> = {}
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async searchByReference(reference: string): Promise<HybridSearchResult[]> {
    const normalizedRef = reference.trim().toUpperCase();

    // Try keyword search first
    const keywordResults = await this.keywordSearchByReference(normalizedRef);

    if (keywordResults.length > 0) {
      return keywordResults;
    }

    // Fall back to semantic search
    if (this.config.enableSemanticFallback && this.embeddingService) {
      return this.semanticSearch(`shipment ${reference} booking`);
    }

    return [];
  }

  async searchByCustomer(customerName: string): Promise<HybridSearchResult[]> {
    // Try keyword search first
    const keywordResults = await this.keywordSearchByCustomer(customerName);

    if (keywordResults.length > 0) {
      return keywordResults;
    }

    // Fall back to semantic search
    if (this.config.enableSemanticFallback && this.embeddingService) {
      return this.semanticSearch(`shipment customer ${customerName}`);
    }

    return [];
  }

  async searchByQuery(query: string): Promise<HybridSearchResult[]> {
    // For free-text queries, run both keyword and semantic in parallel
    const [keywordResults, semanticResults] = await Promise.all([
      this.keywordSearchByText(query),
      this.semanticSearch(query),
    ]);

    // Merge and deduplicate, preferring keyword matches
    return this.mergeResults(keywordResults, semanticResults);
  }

  // ==========================================================================
  // KEYWORD SEARCH METHODS
  // ==========================================================================

  private async keywordSearchByReference(reference: string): Promise<HybridSearchResult[]> {
    const { data, error } = await this.supabase
      .from('chronicle')
      .select('id, gmail_message_id, booking_number, mbl_number, document_type, subject, summary, from_address, occurred_at')
      .or(`booking_number.ilike.%${reference}%,mbl_number.ilike.%${reference}%,container_numbers.cs.{${reference}}`)
      .order('occurred_at', { ascending: false })
      .limit(this.config.keywordLimit);

    if (error) {
      console.error('[HybridSearch] Keyword search error:', error);
      return [];
    }

    return this.mapToResults(data || [], 'keyword');
  }

  private async keywordSearchByCustomer(customerName: string): Promise<HybridSearchResult[]> {
    const { data, error } = await this.supabase
      .from('chronicle')
      .select('id, gmail_message_id, booking_number, mbl_number, document_type, subject, summary, from_address, occurred_at')
      .or(`shipper_name.ilike.%${customerName}%,consignee_name.ilike.%${customerName}%`)
      .order('occurred_at', { ascending: false })
      .limit(this.config.keywordLimit);

    if (error) {
      console.error('[HybridSearch] Customer search error:', error);
      return [];
    }

    return this.mapToResults(data || [], 'keyword');
  }

  private async keywordSearchByText(query: string): Promise<HybridSearchResult[]> {
    // Search across subject and summary fields
    const { data, error } = await this.supabase
      .from('chronicle')
      .select('id, gmail_message_id, booking_number, mbl_number, document_type, subject, summary, from_address, occurred_at')
      .or(`subject.ilike.%${query}%,summary.ilike.%${query}%`)
      .order('occurred_at', { ascending: false })
      .limit(this.config.keywordLimit);

    if (error) {
      console.error('[HybridSearch] Text search error:', error);
      return [];
    }

    return this.mapToResults(data || [], 'keyword');
  }

  // ==========================================================================
  // SEMANTIC SEARCH
  // ==========================================================================

  private async semanticSearch(query: string): Promise<HybridSearchResult[]> {
    if (!this.embeddingService) {
      return [];
    }

    try {
      const results = await this.embeddingService.searchGlobal(query, {
        limit: this.config.semanticLimit,
        minSimilarity: this.config.semanticMinSimilarity,
      });

      return results.map(r => ({
        id: r.id,
        gmailMessageId: r.gmailMessageId || '',
        bookingNumber: r.bookingNumber || null,
        mblNumber: r.mblNumber || null,
        documentType: r.documentType || 'unknown',
        subject: r.subject || '',
        summary: r.summary || null,
        fromAddress: r.fromAddress || '',
        occurredAt: r.occurredAt || '',
        similarity: r.similarity,
        matchSource: 'semantic' as const,
      }));
    } catch (error) {
      console.error('[HybridSearch] Semantic search error:', error);
      return [];
    }
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private mapToResults(rows: any[], source: 'keyword' | 'semantic'): HybridSearchResult[] {
    return rows.map(row => ({
      id: row.id,
      gmailMessageId: row.gmail_message_id,
      bookingNumber: row.booking_number,
      mblNumber: row.mbl_number,
      documentType: row.document_type || 'unknown',
      subject: row.subject || '',
      summary: row.summary,
      fromAddress: row.from_address || '',
      occurredAt: row.occurred_at || '',
      matchSource: source,
    }));
  }

  private mergeResults(
    keywordResults: HybridSearchResult[],
    semanticResults: HybridSearchResult[]
  ): HybridSearchResult[] {
    const seen = new Set<string>();
    const merged: HybridSearchResult[] = [];

    // Add keyword results first (higher priority)
    for (const result of keywordResults) {
      seen.add(result.id);
      merged.push(result);
    }

    // Add semantic results not already seen
    for (const result of semanticResults) {
      if (!seen.has(result.id)) {
        seen.add(result.id);
        merged.push(result);
      }
    }

    return merged;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createHybridSearchService(
  supabase: SupabaseClient,
  embeddingService: IEmbeddingService | null,
  config?: Partial<HybridSearchConfig>
): IHybridSearchService {
  return new HybridSearchService(supabase, embeddingService, config);
}
