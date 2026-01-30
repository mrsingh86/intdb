/**
 * Memory Repository
 *
 * Data access layer for ai_memories table.
 * Handles all database operations with proper error handling.
 *
 * Following CLAUDE.md principles:
 * - Single Responsibility (Principle #3) - only data access
 * - Never Return Null (Principle #20) - throw exceptions or return empty arrays
 * - Information Hiding (Principle #10) - hide Supabase implementation details
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  Memory,
  MemoryScope,
  MemoryStats,
  DEFAULT_TTL,
  calculateExpiresAt,
} from './types';

// ============================================================================
// CUSTOM ERRORS
// ============================================================================

export class MemoryNotFoundError extends Error {
  constructor(public memoryId: string) {
    super(`Memory not found: ${memoryId}`);
    this.name = 'MemoryNotFoundError';
  }
}

export class DuplicateMemoryError extends Error {
  constructor(scope: string, scopeId: string) {
    super(`Memory already exists for ${scope}:${scopeId}`);
    this.name = 'DuplicateMemoryError';
  }
}

export class MemoryRepositoryError extends Error {
  constructor(
    message: string,
    public operation: string
  ) {
    super(`${operation}: ${message}`);
    this.name = 'MemoryRepositoryError';
  }
}

// ============================================================================
// TYPES
// ============================================================================

export interface CreateMemoryInput {
  scope: MemoryScope;
  scopeId: string;
  content: string;
  summary?: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
  tags?: string[];
  ttlDays?: number;
  source?: string;
  sourceReference?: string;
  createdBy?: string;
}

export interface UpdateMemoryInput {
  content?: string;
  summary?: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
  tags?: string[];
}

// ============================================================================
// REPOSITORY
// ============================================================================

export class MemoryRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  // --------------------------------------------------------------------------
  // CREATE OPERATIONS
  // --------------------------------------------------------------------------

  /**
   * Create a new memory (fails if duplicate)
   */
  async create(input: CreateMemoryInput): Promise<Memory> {
    const expiresAt = calculateExpiresAt(input.scope, input.ttlDays);

    const { data, error } = await this.supabase
      .from('ai_memories')
      .insert({
        scope: input.scope,
        scope_id: input.scopeId,
        content: input.content,
        summary: input.summary || null,
        embedding: input.embedding || null,
        metadata: input.metadata || {},
        tags: input.tags || [],
        expires_at: expiresAt?.toISOString() || null,
        source: input.source || null,
        source_reference: input.sourceReference || null,
        created_by: input.createdBy || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        // Unique constraint violation
        throw new DuplicateMemoryError(input.scope, input.scopeId);
      }
      throw new MemoryRepositoryError(error.message, 'create');
    }

    return this.mapToMemory(data);
  }

  /**
   * Create or update a memory (upsert)
   */
  async upsert(input: CreateMemoryInput): Promise<Memory> {
    const expiresAt = calculateExpiresAt(input.scope, input.ttlDays);

    const { data, error } = await this.supabase
      .from('ai_memories')
      .upsert(
        {
          scope: input.scope,
          scope_id: input.scopeId,
          content: input.content,
          summary: input.summary || null,
          embedding: input.embedding || null,
          metadata: input.metadata || {},
          tags: input.tags || [],
          expires_at: expiresAt?.toISOString() || null,
          source: input.source || null,
          source_reference: input.sourceReference || null,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'scope,scope_id,content',
        }
      )
      .select()
      .single();

    if (error) {
      throw new MemoryRepositoryError(error.message, 'upsert');
    }

    return this.mapToMemory(data);
  }

  // --------------------------------------------------------------------------
  // READ OPERATIONS
  // --------------------------------------------------------------------------

  /**
   * Find memory by ID (throws if not found)
   */
  async findById(memoryId: string): Promise<Memory> {
    const { data, error } = await this.supabase
      .from('ai_memories')
      .select('*')
      .eq('id', memoryId)
      .eq('is_active', true)
      .single();

    if (error || !data) {
      throw new MemoryNotFoundError(memoryId);
    }

    return this.mapToMemory(data);
  }

  /**
   * Find all memories for a scope (returns empty array if none)
   */
  async findByScope(scope: MemoryScope, scopeId: string): Promise<Memory[]> {
    const { data, error } = await this.supabase
      .from('ai_memories')
      .select('*')
      .eq('scope', scope)
      .eq('scope_id', scopeId)
      .eq('is_active', true)
      .or('expires_at.is.null,expires_at.gt.now()')
      .order('created_at', { ascending: false });

    if (error) {
      throw new MemoryRepositoryError(error.message, 'findByScope');
    }

    return (data || []).map(this.mapToMemory);
  }

  /**
   * Find memories by tags (returns empty array if none)
   */
  async findByTags(tags: string[], limit = 10): Promise<Memory[]> {
    const { data, error } = await this.supabase
      .from('ai_memories')
      .select('*')
      .eq('is_active', true)
      .or('expires_at.is.null,expires_at.gt.now()')
      .contains('tags', tags)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new MemoryRepositoryError(error.message, 'findByTags');
    }

    return (data || []).map(this.mapToMemory);
  }

  /**
   * Semantic search using vector similarity
   */
  async searchSemantic(
    queryEmbedding: number[],
    options: {
      scope?: MemoryScope;
      scopeId?: string;
      tags?: string[];
      limit?: number;
      threshold?: number;
    } = {}
  ): Promise<Memory[]> {
    const { data, error } = await this.supabase.rpc('search_memories_semantic', {
      query_embedding: queryEmbedding,
      p_scope: options.scope || null,
      p_scope_id: options.scopeId || null,
      p_tags: options.tags || null,
      match_count: options.limit || 5,
      similarity_threshold: options.threshold || 0.5,
    });

    if (error) {
      throw new MemoryRepositoryError(error.message, 'searchSemantic');
    }

    return (data || []).map((row: any) => ({
      ...this.mapToMemory(row),
      similarity: row.similarity,
    }));
  }

  // --------------------------------------------------------------------------
  // UPDATE OPERATIONS
  // --------------------------------------------------------------------------

  /**
   * Update an existing memory
   */
  async update(memoryId: string, input: UpdateMemoryInput): Promise<Memory> {
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (input.content !== undefined) updateData.content = input.content;
    if (input.summary !== undefined) updateData.summary = input.summary;
    if (input.embedding !== undefined) updateData.embedding = input.embedding;
    if (input.metadata !== undefined) updateData.metadata = input.metadata;
    if (input.tags !== undefined) updateData.tags = input.tags;

    // Increment version
    const { data: current } = await this.supabase
      .from('ai_memories')
      .select('version')
      .eq('id', memoryId)
      .single();

    updateData.version = (current?.version || 1) + 1;

    const { data, error } = await this.supabase
      .from('ai_memories')
      .update(updateData)
      .eq('id', memoryId)
      .eq('is_active', true)
      .select()
      .single();

    if (error || !data) {
      throw new MemoryNotFoundError(memoryId);
    }

    return this.mapToMemory(data);
  }

  // --------------------------------------------------------------------------
  // DELETE OPERATIONS
  // --------------------------------------------------------------------------

  /**
   * Soft delete a memory by ID
   */
  async delete(memoryId: string): Promise<void> {
    const { error } = await this.supabase
      .from('ai_memories')
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', memoryId);

    if (error) {
      throw new MemoryRepositoryError(error.message, 'delete');
    }
  }

  /**
   * Soft delete all memories for a scope
   */
  async deleteByScope(scope: MemoryScope, scopeId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('ai_memories')
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('scope', scope)
      .eq('scope_id', scopeId)
      .eq('is_active', true)
      .select('id');

    if (error) {
      throw new MemoryRepositoryError(error.message, 'deleteByScope');
    }

    return data?.length || 0;
  }

  // --------------------------------------------------------------------------
  // MAINTENANCE OPERATIONS
  // --------------------------------------------------------------------------

  /**
   * Clean up expired memories (soft delete)
   */
  async cleanupExpired(): Promise<number> {
    const { data, error } = await this.supabase.rpc('cleanup_expired_memories');

    if (error) {
      throw new MemoryRepositoryError(error.message, 'cleanupExpired');
    }

    return data || 0;
  }

  /**
   * Get memory statistics by scope
   */
  async getStats(): Promise<MemoryStats[]> {
    const { data, error } = await this.supabase.rpc('get_memory_stats');

    if (error) {
      throw new MemoryRepositoryError(error.message, 'getStats');
    }

    return (data || []).map((row: any) => ({
      scope: row.scope as MemoryScope,
      totalCount: parseInt(row.total_count, 10),
      activeCount: parseInt(row.active_count, 10),
      avgContentLength: parseFloat(row.avg_content_length) || 0,
      oldestMemory: row.oldest_memory ? new Date(row.oldest_memory) : null,
      newestMemory: row.newest_memory ? new Date(row.newest_memory) : null,
    }));
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  /**
   * Map database row to Memory type
   */
  private mapToMemory(row: any): Memory {
    return {
      id: row.id,
      scope: row.scope as MemoryScope,
      scopeId: row.scope_id,
      content: row.content,
      summary: row.summary,
      metadata: row.metadata || {},
      tags: row.tags || [],
      version: row.version || 1,
      expiresAt: row.expires_at ? new Date(row.expires_at) : null,
      isActive: row.is_active,
      source: row.source,
      sourceReference: row.source_reference,
      similarity: row.similarity,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
