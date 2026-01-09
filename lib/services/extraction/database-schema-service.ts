/**
 * Database Schema Service
 *
 * Bridges the SchemaRepository (database) with DocumentTypeExtractor (code).
 * Loads extraction schemas from database and compiles regex patterns.
 *
 * Features:
 * - Loads schemas from database with caching
 * - Compiles string regex patterns to RegExp objects
 * - Falls back to hardcoded schemas if DB unavailable
 *
 * Usage:
 *   const schemaService = new DatabaseSchemaService(supabase);
 *   const schema = await schemaService.getSchema('booking_confirmation');
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { SchemaRepository, ExtractionSchema, FieldDefinition } from '../../repositories';
import {
  DocumentExtractionSchema,
  EntityField,
  SectionDefinition,
  TableDefinition,
  getExtractionSchema as getHardcodedSchema,
} from './document-extraction-schemas';

// ============================================================================
// Types
// ============================================================================

interface CompiledSchema extends DocumentExtractionSchema {
  fromDatabase: boolean;
}

interface SchemaCache {
  schemas: Map<string, CompiledSchema>;
  loadedAt: number;
  ttlMs: number;
}

// ============================================================================
// Database Schema Service
// ============================================================================

export class DatabaseSchemaService {
  private supabase: SupabaseClient;
  private schemaRepo: SchemaRepository;
  private cache: SchemaCache | null = null;
  private readonly DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.schemaRepo = new SchemaRepository(supabase);
  }

  // ==========================================================================
  // Public Methods
  // ==========================================================================

  /**
   * Get compiled schema for a document type
   * First tries database, then falls back to hardcoded
   */
  async getSchema(documentType: string, carrierId?: string): Promise<DocumentExtractionSchema | null> {
    await this.ensureCache();

    const cacheKey = carrierId ? `${documentType}:${carrierId}` : documentType;

    // Check cache first
    if (this.cache!.schemas.has(cacheKey)) {
      return this.cache!.schemas.get(cacheKey)!;
    }

    // Try database
    const dbSchema = await this.schemaRepo.getSchema(documentType, carrierId);
    if (dbSchema) {
      const compiled = this.compileSchema(dbSchema);
      this.cache!.schemas.set(cacheKey, compiled);
      return compiled;
    }

    // Fall back to hardcoded
    const hardcoded = getHardcodedSchema(documentType);
    if (hardcoded) {
      const withFlag: CompiledSchema = { ...hardcoded, fromDatabase: false };
      this.cache!.schemas.set(cacheKey, withFlag);
      return withFlag;
    }

    return null;
  }

  /**
   * Get all supported document types (from both DB and hardcoded)
   */
  async getSupportedDocumentTypes(): Promise<string[]> {
    await this.ensureCache();

    const dbTypes = await this.schemaRepo.getDocumentTypes();

    // Import hardcoded types
    const { getSupportedDocumentTypes } = await import('./document-extraction-schemas');
    const hardcodedTypes = getSupportedDocumentTypes();

    // Merge and dedupe
    const allTypes = new Set([...dbTypes, ...hardcodedTypes]);
    return Array.from(allTypes);
  }

  /**
   * Check if a document type has a schema
   */
  async hasSchema(documentType: string): Promise<boolean> {
    const schema = await this.getSchema(documentType);
    return schema !== null;
  }

  /**
   * Invalidate cache (force reload from DB)
   */
  invalidateCache(): void {
    this.cache = null;
    this.schemaRepo.invalidateCache();
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async ensureCache(): Promise<void> {
    if (this.cache && Date.now() - this.cache.loadedAt < this.cache.ttlMs) {
      return;
    }

    this.cache = {
      schemas: new Map(),
      loadedAt: Date.now(),
      ttlMs: this.DEFAULT_TTL_MS,
    };
  }

  /**
   * Compile a database schema to a DocumentExtractionSchema with RegExp objects
   */
  private compileSchema(dbSchema: ExtractionSchema): CompiledSchema {
    const fields = this.compileFields(dbSchema.fields || []);
    const sections = this.compileSections(dbSchema.sections || []);
    const tables = this.compileTables(dbSchema.tables_config || []);

    return {
      documentType: dbSchema.document_type,
      displayName: dbSchema.document_type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      category: 'documentation',
      fields,
      sections,
      tables: tables.length > 0 ? tables : undefined,
      fromDatabase: true,
    };
  }

  /**
   * Compile field definitions with regex patterns
   */
  private compileFields(fields: FieldDefinition[]): EntityField[] {
    return fields.map(field => ({
      name: field.name,
      type: field.type as EntityField['type'],
      required: field.required,
      labelPatterns: this.compilePatterns(field.labelPatterns),
      valuePatterns: field.valuePatterns ? this.compilePatterns(field.valuePatterns) : undefined,
    }));
  }

  /**
   * Compile section definitions with regex patterns
   */
  private compileSections(sections: Array<{
    name: string;
    startMarkers: string[];
    endMarkers: string[];
    fields: string[];
  }>): SectionDefinition[] {
    return sections.map(section => ({
      name: section.name,
      startMarkers: this.compilePatterns(section.startMarkers),
      endMarkers: this.compilePatterns(section.endMarkers),
      fields: section.fields,
    }));
  }

  /**
   * Compile table definitions with regex patterns
   */
  private compileTables(tables: Array<{
    name: string;
    headerPatterns: string[];
    columns: Array<{
      name: string;
      headerPatterns: string[];
      type: string;
    }>;
    rowPattern?: string;
  }>): TableDefinition[] {
    return tables.map(table => {
      const rowPattern = table.rowPattern ? this.compilePattern(table.rowPattern) : undefined;
      return {
        name: table.name,
        headerPatterns: this.compilePatterns(table.headerPatterns),
        columns: table.columns.map(col => ({
          name: col.name,
          headerPatterns: this.compilePatterns(col.headerPatterns),
          type: col.type as EntityField['type'],
        })),
        rowPattern: rowPattern || undefined,
      };
    });
  }

  /**
   * Compile an array of pattern strings to RegExp objects
   */
  private compilePatterns(patterns: string[]): RegExp[] {
    return patterns
      .map(p => this.compilePattern(p))
      .filter((r): r is RegExp => r !== null);
  }

  /**
   * Compile a single pattern string to RegExp
   */
  private compilePattern(pattern: string): RegExp | null {
    try {
      // Pattern might be stored with flags like "/pattern/i"
      const match = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
      if (match) {
        return new RegExp(match[1], match[2] || 'i');
      }
      // Plain string, add case-insensitive flag
      return new RegExp(pattern, 'i');
    } catch (err) {
      console.error(`Invalid regex pattern: ${pattern}`, err);
      return null;
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

let instance: DatabaseSchemaService | null = null;

export function createDatabaseSchemaService(supabase: SupabaseClient): DatabaseSchemaService {
  if (!instance) {
    instance = new DatabaseSchemaService(supabase);
  }
  return instance;
}

export function getDatabaseSchemaService(): DatabaseSchemaService | null {
  return instance;
}

export default DatabaseSchemaService;
