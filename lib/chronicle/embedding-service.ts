/**
 * Embedding Service
 *
 * Generates and manages vector embeddings for semantic search.
 * Uses Supabase's built-in gte-small model (384 dimensions).
 * No external API key required.
 *
 * Following CLAUDE.md principles:
 * - Single Responsibility (Principle #3) - only embeddings
 * - Interface-Based Design (Principle #6)
 * - Small Functions < 20 lines (Principle #17)
 * - Never Return Null (Principle #20) - use empty arrays
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result of embedding generation
 */
export interface EmbeddingResult {
  success: boolean;
  chronicleId: string;
  embedding?: number[];
  error?: string;
}

/**
 * Result of semantic search
 */
export interface SemanticSearchResult {
  id: string;
  gmailMessageId: string;
  shipmentId: string | null;
  documentType: string;
  subject: string;
  summary: string;
  occurredAt: string;
  similarity: number;
  // Additional fields for unified search
  bookingNumber?: string;
  mblNumber?: string;
  fromAddress?: string;
}

/**
 * Options for global semantic search
 */
export interface GlobalSearchOptions {
  limit?: number;
  documentType?: string;
  minSimilarity?: number;
}

/**
 * Configuration for embedding service
 */
export interface EmbeddingConfig {
  dimensions: number;
  batchSize: number;
  similarityThreshold: number;
  supabaseUrl: string;
  supabaseAnonKey: string;
}

// ============================================================================
// DEFAULT CONFIGURATION
// ============================================================================

const DEFAULT_CONFIG: Partial<EmbeddingConfig> = {
  dimensions: 384,         // gte-small produces 384-dim vectors
  batchSize: 50,           // Process 50 at a time
  similarityThreshold: 0.7,
};

// ============================================================================
// INTERFACE
// ============================================================================

export interface IEmbeddingService {
  /**
   * Generate embedding for a single chronicle record (by ID)
   */
  generateEmbedding(chronicleId: string): Promise<EmbeddingResult>;

  /**
   * Generate embedding from raw text (for intent detection, etc.)
   */
  generateEmbeddingFromText(text: string): Promise<EmbeddingResult>;

  /**
   * Generate embeddings for multiple records (batch)
   */
  generateEmbeddingsBatch(chronicleIds: string[]): Promise<EmbeddingResult[]>;

  /**
   * Search emails semantically within a shipment
   */
  searchShipmentEmails(
    query: string,
    shipmentId: string,
    limit?: number
  ): Promise<SemanticSearchResult[]>;

  /**
   * Search emails semantically across all chronicle
   */
  searchGlobal(
    query: string,
    options?: GlobalSearchOptions
  ): Promise<SemanticSearchResult[]>;

  /**
   * Get count of records without embeddings
   */
  getUnembeddedCount(): Promise<number>;

  /**
   * Backfill embeddings for records that don't have them
   */
  backfillEmbeddings(limit?: number): Promise<{ processed: number; errors: number }>;
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

export class EmbeddingService implements IEmbeddingService {
  private supabase: SupabaseClient;
  private config: EmbeddingConfig;

  constructor(
    supabase: SupabaseClient,
    config: Partial<EmbeddingConfig> = {}
  ) {
    this.supabase = supabase;

    // Get Supabase URL and key from environment
    // Service role key works best for Edge Function calls
    const supabaseUrl = config.supabaseUrl ||
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseAnonKey = config.supabaseAnonKey ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      supabaseUrl,
      supabaseAnonKey,
    } as EmbeddingConfig;
  }

  /**
   * Generate embedding for a single chronicle record
   */
  async generateEmbedding(chronicleId: string): Promise<EmbeddingResult> {
    try {
      const text = await this.getTextForEmbedding(chronicleId);
      if (!text) {
        return { success: false, chronicleId, error: 'No text found for embedding' };
      }

      const embedding = await this.createEmbedding(text);
      await this.storeEmbedding(chronicleId, embedding);

      return { success: true, chronicleId, embedding };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[EmbeddingService] Error for ${chronicleId}:`, message);
      return { success: false, chronicleId, error: message };
    }
  }

  /**
   * Generate embedding from raw text (for intent detection, etc.)
   * Does not store in database - just returns the embedding
   */
  async generateEmbeddingFromText(text: string): Promise<EmbeddingResult> {
    if (!text || text.trim().length === 0) {
      return { success: false, chronicleId: 'raw-text', error: 'Empty text provided' };
    }

    try {
      const embedding = await this.createEmbedding(text.trim());
      return { success: true, chronicleId: 'raw-text', embedding };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error('[EmbeddingService] Error generating from text:', message);
      return { success: false, chronicleId: 'raw-text', error: message };
    }
  }

  /**
   * Generate embeddings for multiple records (batch)
   */
  async generateEmbeddingsBatch(chronicleIds: string[]): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];

    // Process in chunks
    for (let i = 0; i < chronicleIds.length; i += this.config.batchSize) {
      const chunk = chronicleIds.slice(i, i + this.config.batchSize);
      const chunkResults = await this.processChunk(chunk);
      results.push(...chunkResults);

      // Small delay between batches
      if (i + this.config.batchSize < chronicleIds.length) {
        await this.delay(100);
      }
    }

    return results;
  }

  /**
   * Search emails semantically within a shipment
   */
  async searchShipmentEmails(
    query: string,
    shipmentId: string,
    limit: number = 5
  ): Promise<SemanticSearchResult[]> {
    const queryEmbedding = await this.createEmbedding(query);

    const { data, error } = await this.supabase.rpc('search_shipment_emails_semantic', {
      query_embedding: queryEmbedding,
      p_shipment_id: shipmentId,
      match_count: limit,
      similarity_threshold: this.config.similarityThreshold,
    });

    if (error) {
      console.error('[EmbeddingService] Search error:', error);
      return [];
    }

    return this.mapSearchResults(data || []);
  }

  /**
   * Search emails semantically across all chronicle
   */
  async searchGlobal(
    query: string,
    options: GlobalSearchOptions = {}
  ): Promise<SemanticSearchResult[]> {
    const limit = options.limit ?? 10;
    const minSimilarity = options.minSimilarity ?? this.config.similarityThreshold;
    const documentType = options.documentType ?? null;

    const queryEmbedding = await this.createEmbedding(query);

    const { data, error } = await this.supabase.rpc('search_chronicle_semantic', {
      query_embedding: queryEmbedding,
      match_count: limit,
      similarity_threshold: minSimilarity,
      p_document_type: documentType,
    });

    if (error) {
      console.error('[EmbeddingService] Global search error:', error);
      return [];
    }

    return this.mapSearchResults(data || []);
  }

  /**
   * Get count of records without embeddings
   */
  async getUnembeddedCount(): Promise<number> {
    const { count, error } = await this.supabase
      .from('chronicle')
      .select('*', { count: 'exact', head: true })
      .is('embedding', null);

    if (error) {
      console.error('[EmbeddingService] Count error:', error);
      return 0;
    }

    return count || 0;
  }

  /**
   * Backfill embeddings for records that don't have them
   */
  async backfillEmbeddings(limit: number = 100): Promise<{ processed: number; errors: number }> {
    const { data: records, error } = await this.supabase
      .from('chronicle')
      .select('id')
      .is('embedding', null)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !records) {
      console.error('[EmbeddingService] Backfill fetch error:', error);
      return { processed: 0, errors: 1 };
    }

    const ids = records.map(r => r.id);
    const results = await this.generateEmbeddingsBatch(ids);

    const processed = results.filter(r => r.success).length;
    const errors = results.filter(r => !r.success).length;

    console.log(`[EmbeddingService] Backfill complete: ${processed} processed, ${errors} errors`);
    return { processed, errors };
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private async getTextForEmbedding(chronicleId: string): Promise<string | null> {
    const { data, error } = await this.supabase
      .from('chronicle')
      .select(`
        subject, summary, body_preview, document_type, attachments,
        container_numbers, mbl_number, hbl_number, vessel_name,
        shipper_name, consignee_name, origin_location, destination_location,
        issue_description, action_description, commodity
      `)
      .eq('id', chronicleId)
      .single();

    if (error || !data) return null;

    // Combine fields for DEEP embedding
    const parts: string[] = [];

    // Document type context
    if (data.document_type) parts.push(`[${data.document_type}]`);

    // Core content
    if (data.subject) parts.push(data.subject);
    if (data.summary) parts.push(data.summary);
    if (data.body_preview) parts.push(data.body_preview.substring(0, 500));

    // Key identifiers (help with semantic matching)
    if (data.container_numbers?.length) parts.push(`containers: ${data.container_numbers.join(', ')}`);
    if (data.mbl_number) parts.push(`MBL: ${data.mbl_number}`);
    if (data.hbl_number) parts.push(`HBL: ${data.hbl_number}`);
    if (data.vessel_name) parts.push(`vessel: ${data.vessel_name}`);

    // Parties
    if (data.shipper_name) parts.push(`shipper: ${data.shipper_name}`);
    if (data.consignee_name) parts.push(`consignee: ${data.consignee_name}`);

    // Locations
    if (data.origin_location) parts.push(`origin: ${data.origin_location}`);
    if (data.destination_location) parts.push(`destination: ${data.destination_location}`);

    // Issues & Actions
    if (data.issue_description) parts.push(`issue: ${data.issue_description}`);
    if (data.action_description) parts.push(`action: ${data.action_description}`);

    // Commodity
    if (data.commodity) parts.push(`commodity: ${data.commodity}`);

    // Attachment text (first 1000 chars from first attachment)
    if (data.attachments && Array.isArray(data.attachments)) {
      for (const att of data.attachments) {
        const extractedText = att.extractedText || att.extracted_text || '';
        if (extractedText) {
          parts.push(`attachment: ${extractedText.substring(0, 1000)}`);
          break; // Only include first attachment to stay within limits
        }
      }
    }

    return parts.filter(Boolean).join(' | ');
  }

  /**
   * Call Supabase Edge Function to generate embedding
   */
  private async createEmbedding(text: string): Promise<number[]> {
    const response = await fetch(
      `${this.config.supabaseUrl}/functions/v1/generate-embedding`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.supabaseAnonKey}`,
        },
        body: JSON.stringify({ text }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Edge function error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.embedding;
  }

  /**
   * Call Supabase Edge Function to generate embeddings in batch
   */
  private async createEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(
      `${this.config.supabaseUrl}/functions/v1/generate-embedding`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.supabaseAnonKey}`,
        },
        body: JSON.stringify({ texts }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Edge function error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.embeddings;
  }

  private async storeEmbedding(chronicleId: string, embedding: number[]): Promise<void> {
    const { error } = await this.supabase
      .from('chronicle')
      .update({
        embedding: embedding,
        embedding_generated_at: new Date().toISOString(),
      })
      .eq('id', chronicleId);

    if (error) {
      throw new Error(`Failed to store embedding: ${error.message}`);
    }
  }

  private async processChunk(chronicleIds: string[]): Promise<EmbeddingResult[]> {
    // Get texts for all IDs in chunk - DEEP fields
    const { data: records, error } = await this.supabase
      .from('chronicle')
      .select(`
        id, subject, summary, body_preview, document_type, attachments,
        container_numbers, mbl_number, hbl_number, vessel_name,
        shipper_name, consignee_name, origin_location, destination_location,
        issue_description, action_description, commodity
      `)
      .in('id', chronicleIds);

    if (error || !records) {
      return chronicleIds.map(id => ({
        success: false,
        chronicleId: id,
        error: 'Failed to fetch record',
      }));
    }

    // Build DEEP texts
    const textsWithIds = records.map(r => {
      const parts: string[] = [];

      // Document type context
      if (r.document_type) parts.push(`[${r.document_type}]`);

      // Core content
      if (r.subject) parts.push(r.subject);
      if (r.summary) parts.push(r.summary);
      if (r.body_preview) parts.push(r.body_preview.substring(0, 500));

      // Key identifiers
      if (r.container_numbers?.length) parts.push(`containers: ${r.container_numbers.join(', ')}`);
      if (r.mbl_number) parts.push(`MBL: ${r.mbl_number}`);
      if (r.hbl_number) parts.push(`HBL: ${r.hbl_number}`);
      if (r.vessel_name) parts.push(`vessel: ${r.vessel_name}`);

      // Parties
      if (r.shipper_name) parts.push(`shipper: ${r.shipper_name}`);
      if (r.consignee_name) parts.push(`consignee: ${r.consignee_name}`);

      // Locations
      if (r.origin_location) parts.push(`origin: ${r.origin_location}`);
      if (r.destination_location) parts.push(`destination: ${r.destination_location}`);

      // Issues & Actions
      if (r.issue_description) parts.push(`issue: ${r.issue_description}`);
      if (r.action_description) parts.push(`action: ${r.action_description}`);

      // Commodity
      if (r.commodity) parts.push(`commodity: ${r.commodity}`);

      // Attachment text (first 1000 chars from first attachment)
      if (r.attachments && Array.isArray(r.attachments)) {
        for (const att of r.attachments) {
          const extractedText = att.extractedText || att.extracted_text || '';
          if (extractedText) {
            parts.push(`attachment: ${extractedText.substring(0, 1000)}`);
            break;
          }
        }
      }

      return { id: r.id, text: parts.filter(Boolean).join(' | ') };
    });

    // Generate embeddings one at a time (Edge Function has limits on batch)
    const results: EmbeddingResult[] = [];
    for (const { id, text } of textsWithIds) {
      try {
        const embedding = await this.createEmbedding(text);
        await this.storeEmbedding(id, embedding);
        results.push({ success: true, chronicleId: id, embedding });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'API error';
        results.push({ success: false, chronicleId: id, error: message });
      }
    }

    return results;
  }

  private mapSearchResults(data: any[]): SemanticSearchResult[] {
    return data.map(row => ({
      id: row.id,
      gmailMessageId: row.gmail_message_id,
      shipmentId: row.shipment_id || null,
      documentType: row.document_type,
      subject: row.subject,
      summary: row.summary,
      occurredAt: row.occurred_at,
      similarity: row.similarity,
      bookingNumber: row.booking_number || undefined,
      mblNumber: row.mbl_number || undefined,
      fromAddress: row.from_address || undefined,
    }));
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createEmbeddingService(
  supabase: SupabaseClient,
  config?: Partial<EmbeddingConfig>
): IEmbeddingService {
  return new EmbeddingService(supabase, config);
}
