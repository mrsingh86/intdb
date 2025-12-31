/**
 * Document Authority Service
 *
 * Determines which document type is the authoritative source for each entity type.
 * Enables document-hierarchy based entity extraction and storage.
 *
 * Principles:
 * - Configuration Over Code: Authority rules stored in database
 * - Single Responsibility: Only authority determination logic
 * - Deep Module: Simple interface, complex authority resolution
 */

import { SupabaseClient } from '@supabase/supabase-js';

export interface DocumentAuthorityRule {
  id: string;
  document_type: string;
  entity_type: string;
  authority_level: number;  // 1=primary, 2=secondary, 3=fallback
  can_override_from: string[] | null;
  extraction_prompt_key: string | null;
  validation_rules: Record<string, unknown> | null;
  is_active: boolean;
}

export interface EntityWithAuthority {
  entity_type: string;
  entity_value: string;
  source_document_type: string;
  authority_level: number;
  confidence_score?: number;
}

export interface AuthorityResolution {
  should_update: boolean;
  reason: string;
  existing_authority_level?: number;
  new_authority_level: number;
}

export class DocumentAuthorityService {
  private rulesCache: Map<string, DocumentAuthorityRule[]> = new Map();
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Get authority rules for a document type
   */
  async getRulesForDocument(documentType: string): Promise<DocumentAuthorityRule[]> {
    await this.ensureCacheValid();
    return this.rulesCache.get(documentType) || [];
  }

  /**
   * Get authority rule for a specific entity type from a document type
   */
  async getAuthorityRule(
    documentType: string,
    entityType: string
  ): Promise<DocumentAuthorityRule | null> {
    const rules = await this.getRulesForDocument(documentType);
    return rules.find(r => r.entity_type === entityType) || null;
  }

  /**
   * Get all entity types that a document type is authoritative for
   */
  async getAuthoritativeEntityTypes(documentType: string): Promise<string[]> {
    const rules = await this.getRulesForDocument(documentType);
    return rules.map(r => r.entity_type);
  }

  /**
   * Get the extraction prompt key for an entity from a document
   */
  async getExtractionPromptKey(
    documentType: string,
    entityType: string
  ): Promise<string | null> {
    const rule = await this.getAuthorityRule(documentType, entityType);
    return rule?.extraction_prompt_key || null;
  }

  /**
   * Determine if a new entity value should override an existing one
   * Based on document authority hierarchy
   */
  async resolveAuthority(
    entityType: string,
    newDocumentType: string,
    existingDocumentType?: string
  ): Promise<AuthorityResolution> {
    const newRule = await this.getAuthorityRule(newDocumentType, entityType);

    // If no rule exists for this document type, don't update
    if (!newRule) {
      return {
        should_update: false,
        reason: `${newDocumentType} is not authoritative for ${entityType}`,
        new_authority_level: 999,
      };
    }

    // If no existing value, always update
    if (!existingDocumentType) {
      return {
        should_update: true,
        reason: 'No existing value, setting from authoritative source',
        new_authority_level: newRule.authority_level,
      };
    }

    const existingRule = await this.getAuthorityRule(existingDocumentType, entityType);
    const existingLevel = existingRule?.authority_level || 999;

    // Check if new document can override existing
    if (newRule.can_override_from?.includes(existingDocumentType)) {
      return {
        should_update: true,
        reason: `${newDocumentType} explicitly can override ${existingDocumentType}`,
        existing_authority_level: existingLevel,
        new_authority_level: newRule.authority_level,
      };
    }

    // Higher authority (lower number) wins
    if (newRule.authority_level < existingLevel) {
      return {
        should_update: true,
        reason: `${newDocumentType} (level ${newRule.authority_level}) has higher authority than ${existingDocumentType} (level ${existingLevel})`,
        existing_authority_level: existingLevel,
        new_authority_level: newRule.authority_level,
      };
    }

    // Equal or lower authority - don't update
    return {
      should_update: false,
      reason: `Existing value from ${existingDocumentType} (level ${existingLevel}) has equal or higher authority`,
      existing_authority_level: existingLevel,
      new_authority_level: newRule.authority_level,
    };
  }

  /**
   * Get all entity types where a specific document type is the PRIMARY source
   */
  async getPrimaryEntitiesForDocument(documentType: string): Promise<string[]> {
    const rules = await this.getRulesForDocument(documentType);
    return rules
      .filter(r => r.authority_level === 1)
      .map(r => r.entity_type);
  }

  /**
   * Get the primary document type for an entity type
   */
  async getPrimaryDocumentForEntity(entityType: string): Promise<string | null> {
    await this.ensureCacheValid();

    for (const [docType, rules] of this.rulesCache.entries()) {
      const rule = rules.find(r => r.entity_type === entityType && r.authority_level === 1);
      if (rule) return docType;
    }

    return null;
  }

  /**
   * Validate entity value against rules
   */
  async validateEntity(
    documentType: string,
    entityType: string,
    value: string
  ): Promise<{ valid: boolean; errors: string[] }> {
    const rule = await this.getAuthorityRule(documentType, entityType);

    if (!rule?.validation_rules) {
      return { valid: true, errors: [] };
    }

    const errors: string[] = [];
    const rules = rule.validation_rules;

    // Pattern validation
    if (rules.pattern && typeof rules.pattern === 'string') {
      const regex = new RegExp(rules.pattern);
      if (!regex.test(value)) {
        errors.push(`Value does not match pattern: ${rules.pattern}`);
      }
    }

    // Min length
    if (rules.minLength && typeof rules.minLength === 'number') {
      if (value.length < rules.minLength) {
        errors.push(`Value too short (min: ${rules.minLength})`);
      }
    }

    // Max length
    if (rules.maxLength && typeof rules.maxLength === 'number') {
      if (value.length > rules.maxLength) {
        errors.push(`Value too long (max: ${rules.maxLength})`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Apply entity with authority tracking
   * Returns the entity data with provenance information
   */
  applyEntityWithAuthority(
    entityType: string,
    entityValue: string,
    documentType: string,
    authorityLevel: number,
    confidenceScore?: number
  ): EntityWithAuthority {
    return {
      entity_type: entityType,
      entity_value: entityValue,
      source_document_type: documentType,
      authority_level: authorityLevel,
      confidence_score: confidenceScore,
    };
  }

  /**
   * Load and cache all authority rules from database
   */
  private async loadRules(): Promise<void> {
    const { data, error } = await this.supabase
      .from('document_authority_rules')
      .select('*')
      .eq('is_active', true)
      .order('authority_level', { ascending: true });

    if (error) {
      throw new Error(`Failed to load authority rules: ${error.message}`);
    }

    // Clear and rebuild cache
    this.rulesCache.clear();

    for (const rule of data || []) {
      const existing = this.rulesCache.get(rule.document_type) || [];
      existing.push(rule);
      this.rulesCache.set(rule.document_type, existing);
    }

    this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
  }

  /**
   * Ensure cache is valid, reload if expired
   */
  private async ensureCacheValid(): Promise<void> {
    if (Date.now() >= this.cacheExpiry) {
      await this.loadRules();
    }
  }

  /**
   * Force cache refresh
   */
  async refreshCache(): Promise<void> {
    await this.loadRules();
  }

  /**
   * Get complete authority hierarchy for display/debugging
   */
  async getAuthorityHierarchy(): Promise<Record<string, DocumentAuthorityRule[]>> {
    await this.ensureCacheValid();
    return Object.fromEntries(this.rulesCache.entries());
  }
}
