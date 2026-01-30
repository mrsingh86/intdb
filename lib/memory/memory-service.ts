/**
 * Memory Service
 *
 * Business logic layer for AI memory operations.
 * Orchestrates embedding generation and memory storage.
 *
 * Following CLAUDE.md principles:
 * - Deep Modules (Principle #8) - simple interface, complex internals
 * - Interface-Based Design (Principle #6)
 * - Single Responsibility (Principle #3)
 * - Fail Fast (Principle #12) - validate early with Zod
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { MemoryRepository } from './memory-repository';
import { EmbeddingService, EmbeddingResult } from '../chronicle/embedding-service';
import {
  Memory,
  MemoryScope,
  MemorySearchResult,
  MemoryStats,
  AddMemoryInput,
  SearchMemoryInput,
  UpdateMemoryInput,
  addMemorySchema,
  searchMemorySchema,
  updateMemorySchema,
} from './types';

// ============================================================================
// INTERFACE
// ============================================================================

export interface IMemoryService {
  /**
   * Add a new memory with automatic embedding generation
   */
  add(input: AddMemoryInput): Promise<Memory>;

  /**
   * Search memories using semantic similarity
   */
  search(input: SearchMemoryInput): Promise<MemorySearchResult>;

  /**
   * Get all memories for a specific scope
   */
  getByScope(scope: MemoryScope, scopeId: string): Promise<Memory[]>;

  /**
   * Get a single memory by ID
   */
  getById(memoryId: string): Promise<Memory>;

  /**
   * Update an existing memory
   */
  update(input: UpdateMemoryInput): Promise<Memory>;

  /**
   * Delete a memory by ID
   */
  delete(memoryId: string): Promise<void>;

  /**
   * Delete all memories for a scope
   */
  deleteByScope(scope: MemoryScope, scopeId: string): Promise<number>;

  /**
   * Build a prompt section from memories for AI injection
   */
  buildPromptSection(memories: Memory[]): string;

  /**
   * Clean up expired memories
   */
  cleanupExpired(): Promise<number>;

  /**
   * Get memory statistics
   */
  getStats(): Promise<MemoryStats[]>;
}

// ============================================================================
// SERVICE IMPLEMENTATION
// ============================================================================

export class MemoryService implements IMemoryService {
  private repository: MemoryRepository;
  private embeddingService: EmbeddingService;

  constructor(supabase: SupabaseClient) {
    this.repository = new MemoryRepository(supabase);
    this.embeddingService = new EmbeddingService(supabase);
  }

  // --------------------------------------------------------------------------
  // ADD MEMORY
  // --------------------------------------------------------------------------

  async add(input: AddMemoryInput): Promise<Memory> {
    // Validate input (fail fast)
    const validated = addMemorySchema.parse(input);

    // Generate embedding for semantic search
    const embeddingResult = await this.generateEmbedding(validated.content);

    // Store memory with embedding
    return await this.repository.upsert({
      scope: validated.scope,
      scopeId: validated.scopeId,
      content: validated.content,
      summary: validated.summary,
      embedding: embeddingResult,
      metadata: validated.metadata,
      tags: validated.tags,
      ttlDays: validated.ttlDays,
      source: validated.source,
      sourceReference: validated.sourceReference,
    });
  }

  // --------------------------------------------------------------------------
  // SEARCH MEMORIES
  // --------------------------------------------------------------------------

  async search(input: SearchMemoryInput): Promise<MemorySearchResult> {
    // Validate input
    const validated = searchMemorySchema.parse(input);

    // Generate query embedding
    const queryEmbedding = await this.generateEmbedding(validated.query);

    if (!queryEmbedding) {
      // Fallback to empty results if embedding fails
      console.warn('[MemoryService] Failed to generate query embedding');
      return {
        memories: [],
        query: validated.query,
        scope: validated.scope,
        scopeId: validated.scopeId,
        totalFound: 0,
      };
    }

    // Semantic search
    const memories = await this.repository.searchSemantic(queryEmbedding, {
      scope: validated.scope,
      scopeId: validated.scopeId,
      tags: validated.tags,
      limit: validated.limit,
      threshold: validated.threshold,
    });

    return {
      memories,
      query: validated.query,
      scope: validated.scope,
      scopeId: validated.scopeId,
      totalFound: memories.length,
    };
  }

  // --------------------------------------------------------------------------
  // GET OPERATIONS
  // --------------------------------------------------------------------------

  async getByScope(scope: MemoryScope, scopeId: string): Promise<Memory[]> {
    return await this.repository.findByScope(scope, scopeId);
  }

  async getById(memoryId: string): Promise<Memory> {
    return await this.repository.findById(memoryId);
  }

  // --------------------------------------------------------------------------
  // UPDATE MEMORY
  // --------------------------------------------------------------------------

  async update(input: UpdateMemoryInput): Promise<Memory> {
    // Validate input
    const validated = updateMemorySchema.parse(input);

    // If content changed, regenerate embedding
    let embedding: number[] | undefined;
    if (validated.content) {
      embedding = await this.generateEmbedding(validated.content);
    }

    return await this.repository.update(validated.memoryId, {
      content: validated.content,
      summary: validated.summary,
      embedding,
      metadata: validated.metadata,
      tags: validated.tags,
    });
  }

  // --------------------------------------------------------------------------
  // DELETE OPERATIONS
  // --------------------------------------------------------------------------

  async delete(memoryId: string): Promise<void> {
    await this.repository.delete(memoryId);
  }

  async deleteByScope(scope: MemoryScope, scopeId: string): Promise<number> {
    return await this.repository.deleteByScope(scope, scopeId);
  }

  // --------------------------------------------------------------------------
  // MAINTENANCE
  // --------------------------------------------------------------------------

  async cleanupExpired(): Promise<number> {
    return await this.repository.cleanupExpired();
  }

  async getStats(): Promise<MemoryStats[]> {
    return await this.repository.getStats();
  }

  // --------------------------------------------------------------------------
  // PROMPT BUILDING
  // --------------------------------------------------------------------------

  /**
   * Build a formatted prompt section for AI injection
   * Groups memories by scope for clarity
   */
  buildPromptSection(memories: Memory[]): string {
    if (memories.length === 0) {
      return '';
    }

    const lines: string[] = ['=== MEMORY CONTEXT ==='];

    // Group memories by scope
    const byScope = this.groupByScope(memories);

    // Format each scope group
    for (const [scope, mems] of Object.entries(byScope)) {
      lines.push(`\n${this.getScopeEmoji(scope as MemoryScope)} ${scope.toUpperCase()} MEMORIES:`);

      for (const mem of mems) {
        const similarity = mem.similarity
          ? ` (${Math.round(mem.similarity * 100)}% relevant)`
          : '';
        const content = this.truncateContent(mem.content, 200);
        lines.push(`  - ${content}${similarity}`);
      }
    }

    lines.push('\n=== END MEMORY CONTEXT ===\n');
    return lines.join('\n');
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  /**
   * Generate embedding from text using EmbeddingService
   */
  private async generateEmbedding(text: string): Promise<number[] | undefined> {
    try {
      const result: EmbeddingResult =
        await this.embeddingService.generateEmbeddingFromText(text);

      if (!result.success || !result.embedding) {
        console.warn(
          '[MemoryService] Embedding generation failed:',
          result.error
        );
        return undefined;
      }

      return result.embedding;
    } catch (error) {
      console.error('[MemoryService] Embedding error:', error);
      return undefined;
    }
  }

  /**
   * Group memories by scope
   */
  private groupByScope(memories: Memory[]): Record<string, Memory[]> {
    return memories.reduce(
      (acc, mem) => {
        if (!acc[mem.scope]) {
          acc[mem.scope] = [];
        }
        acc[mem.scope].push(mem);
        return acc;
      },
      {} as Record<string, Memory[]>
    );
  }

  /**
   * Get emoji for scope (for prompt formatting)
   */
  private getScopeEmoji(scope: MemoryScope): string {
    const emojis: Record<MemoryScope, string> = {
      global: '\u{1F30D}',     // Globe
      project: '\u{1F4C1}',    // Folder
      agent: '\u{1F916}',      // Robot
      shipment: '\u{1F6A2}',   // Ship
      customer: '\u{1F464}',   // Person
      sender: '\u{1F4E7}',     // Email
      pattern: '\u{1F50D}',    // Magnifying glass
      error: '\u{26A0}',       // Warning
      session: '\u{23F0}',     // Clock
    };
    return emojis[scope] || '\u{1F4DD}'; // Default: memo
  }

  /**
   * Truncate content for prompt display
   */
  private truncateContent(content: string, maxLength: number): string {
    if (content.length <= maxLength) {
      return content;
    }
    return content.substring(0, maxLength - 3) + '...';
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a MemoryService instance
 */
export function createMemoryService(supabase: SupabaseClient): IMemoryService {
  return new MemoryService(supabase);
}
