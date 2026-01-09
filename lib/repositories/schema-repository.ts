/**
 * Schema Repository
 *
 * Database-driven repository for document extraction schemas.
 * Replaces hardcoded schemas in document-extraction-schemas.ts with database-backed configuration.
 *
 * Features:
 * - In-memory caching with TTL
 * - Carrier-specific schema overrides
 * - Version support for schema evolution
 * - Field validation and normalization config
 *
 * Usage:
 *   const schemaRepo = new SchemaRepository(supabase);
 *   const schema = await schemaRepo.getSchema('booking_confirmation', 'maersk');
 *   const fields = schema.fields.filter(f => f.required);
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

export type FieldType =
  | 'string'
  | 'date'
  | 'number'
  | 'amount'
  | 'party'
  | 'address'
  | 'container'
  | 'weight'
  | 'volume'
  | 'port'
  | 'vessel';

export interface FieldDefinition {
  name: string;
  type: FieldType;
  required: boolean;
  labelPatterns: string[];
  valuePatterns?: string[];
  validationRegex?: string;
  normalizer?: string; // Name of normalizer function to apply
  defaultValue?: string | number | null;
  aliases?: string[]; // Alternative field names
  description?: string;
}

export interface SectionDefinition {
  name: string;
  startMarkers: string[];
  endMarkers: string[];
  fields: string[]; // Field names to extract in this section
}

export interface TableDefinition {
  name: string;
  headerPatterns: string[];
  columns: {
    name: string;
    headerPatterns: string[];
    type: FieldType;
  }[];
  rowPattern?: string;
}

export interface ExtractionSchema {
  id: string;
  document_type: string;
  carrier_id: string | null;
  version: number;
  fields: FieldDefinition[];
  sections?: SectionDefinition[];
  tables_config?: TableDefinition[];
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface SchemaCache {
  schemas: ExtractionSchema[];
  byDocType: Map<string, ExtractionSchema[]>;
  byDocTypeAndCarrier: Map<string, ExtractionSchema>;
  loadedAt: number;
  ttlMs: number;
}

// ============================================================================
// Schema Repository
// ============================================================================

export class SchemaRepository {
  private supabase: SupabaseClient;
  private cache: SchemaCache | null = null;
  private readonly DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  // ==========================================================================
  // Query Methods
  // ==========================================================================

  /**
   * Get schema for a document type, optionally carrier-specific
   * Falls back to generic schema if carrier-specific not found
   */
  async getSchema(documentType: string, carrierId?: string): Promise<ExtractionSchema | null> {
    await this.ensureCache();

    // Try carrier-specific first
    if (carrierId) {
      const key = `${documentType}:${carrierId}`;
      const carrierSchema = this.cache!.byDocTypeAndCarrier.get(key);
      if (carrierSchema) return carrierSchema;
    }

    // Fall back to generic (carrier_id = null)
    const genericKey = `${documentType}:null`;
    return this.cache!.byDocTypeAndCarrier.get(genericKey) || null;
  }

  /**
   * Get all schemas for a document type (all carrier variants)
   */
  async getSchemasByDocType(documentType: string): Promise<ExtractionSchema[]> {
    await this.ensureCache();
    return this.cache!.byDocType.get(documentType) || [];
  }

  /**
   * Get all enabled schemas
   */
  async getAllSchemas(): Promise<ExtractionSchema[]> {
    await this.ensureCache();
    return this.cache!.schemas;
  }

  /**
   * Get all unique document types that have schemas
   */
  async getDocumentTypes(): Promise<string[]> {
    await this.ensureCache();
    return Array.from(this.cache!.byDocType.keys());
  }

  /**
   * Get fields for a document type
   */
  async getFields(documentType: string, carrierId?: string): Promise<FieldDefinition[]> {
    const schema = await this.getSchema(documentType, carrierId);
    return schema?.fields || [];
  }

  /**
   * Get required fields for a document type
   */
  async getRequiredFields(documentType: string, carrierId?: string): Promise<FieldDefinition[]> {
    const fields = await this.getFields(documentType, carrierId);
    return fields.filter(f => f.required);
  }

  // ==========================================================================
  // Cache Management
  // ==========================================================================

  /**
   * Invalidate the cache
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
   * Create a new schema
   */
  async create(schema: Omit<ExtractionSchema, 'id' | 'created_at' | 'updated_at'>): Promise<ExtractionSchema> {
    const { data, error } = await this.supabase
      .from('extraction_schemas')
      .insert(schema)
      .select()
      .single();

    if (error) throw new Error(`Failed to create schema: ${error.message}`);
    this.invalidateCache();
    return data;
  }

  /**
   * Update an existing schema
   */
  async update(id: string, updates: Partial<ExtractionSchema>): Promise<ExtractionSchema> {
    const { data, error } = await this.supabase
      .from('extraction_schemas')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update schema: ${error.message}`);
    this.invalidateCache();
    return data;
  }

  /**
   * Add a field to a schema
   */
  async addField(schemaId: string, field: FieldDefinition): Promise<ExtractionSchema> {
    const { data: existing } = await this.supabase
      .from('extraction_schemas')
      .select('fields')
      .eq('id', schemaId)
      .single();

    if (!existing) throw new Error(`Schema not found: ${schemaId}`);

    const fields = [...(existing.fields as FieldDefinition[]), field];
    return this.update(schemaId, { fields });
  }

  /**
   * Remove a field from a schema
   */
  async removeField(schemaId: string, fieldName: string): Promise<ExtractionSchema> {
    const { data: existing } = await this.supabase
      .from('extraction_schemas')
      .select('fields')
      .eq('id', schemaId)
      .single();

    if (!existing) throw new Error(`Schema not found: ${schemaId}`);

    const fields = (existing.fields as FieldDefinition[]).filter(f => f.name !== fieldName);
    return this.update(schemaId, { fields });
  }

  /**
   * Create a new version of a schema
   */
  async createVersion(documentType: string, carrierId: string | null): Promise<ExtractionSchema> {
    // Get current highest version
    const { data: current } = await this.supabase
      .from('extraction_schemas')
      .select('*')
      .eq('document_type', documentType)
      .eq('carrier_id', carrierId)
      .order('version', { ascending: false })
      .limit(1)
      .single();

    if (!current) throw new Error(`No existing schema for ${documentType}:${carrierId}`);

    // Disable old version
    await this.supabase
      .from('extraction_schemas')
      .update({ enabled: false })
      .eq('id', current.id);

    // Create new version
    const newSchema = {
      document_type: current.document_type,
      carrier_id: current.carrier_id,
      version: current.version + 1,
      fields: current.fields,
      sections: current.sections,
      tables_config: current.tables_config,
      enabled: true,
    };

    return this.create(newSchema);
  }

  /**
   * Bulk insert schemas (for seeding)
   */
  async bulkInsert(schemas: Omit<ExtractionSchema, 'id' | 'created_at' | 'updated_at'>[]): Promise<number> {
    const { data, error } = await this.supabase
      .from('extraction_schemas')
      .insert(schemas)
      .select();

    if (error) throw new Error(`Failed to bulk insert schemas: ${error.message}`);
    this.invalidateCache();
    return data?.length || 0;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async ensureCache(): Promise<void> {
    if (this.isCacheValid()) return;

    const { data, error } = await this.supabase
      .from('extraction_schemas')
      .select('*')
      .eq('enabled', true)
      .order('version', { ascending: false });

    if (error) throw new Error(`Failed to load schemas: ${error.message}`);

    const schemas = (data || []) as ExtractionSchema[];

    // Build indexes
    const byDocType = new Map<string, ExtractionSchema[]>();
    const byDocTypeAndCarrier = new Map<string, ExtractionSchema>();

    for (const schema of schemas) {
      // By document type
      const docTypeSchemas = byDocType.get(schema.document_type) || [];
      docTypeSchemas.push(schema);
      byDocType.set(schema.document_type, docTypeSchemas);

      // By document type + carrier (only store latest version)
      const key = `${schema.document_type}:${schema.carrier_id}`;
      if (!byDocTypeAndCarrier.has(key)) {
        byDocTypeAndCarrier.set(key, schema);
      }
    }

    this.cache = {
      schemas,
      byDocType,
      byDocTypeAndCarrier,
      loadedAt: Date.now(),
      ttlMs: this.DEFAULT_TTL_MS,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createSchemaRepository(supabase: SupabaseClient): SchemaRepository {
  return new SchemaRepository(supabase);
}

export default SchemaRepository;
