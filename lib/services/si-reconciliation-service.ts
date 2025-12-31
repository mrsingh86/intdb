/**
 * SI Reconciliation Service
 *
 * Compares SI Draft (MASTER SOURCE) against Checklist and HBL.
 * All discrepancies block SI submission - no warnings, only critical.
 *
 * Principles:
 * - SI Draft is MASTER: All reconciliation uses SI Draft values as truth
 * - Fail Fast: Any discrepancy = blocked submission
 * - Audit Trail: All comparisons logged with field-level details
 * - Configuration Over Code: Fields to compare defined in database
 */

import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

export type ReconciliationStatus =
  | 'pending'
  | 'in_progress'
  | 'matches'
  | 'discrepancies_found'
  | 'resolved'
  | 'blocked';

export type ComparisonType = 'exact' | 'contains' | 'numeric' | 'date' | 'fuzzy';

export interface ReconciliationField {
  id: string;
  field_name: string;
  field_label: string;
  comparison_type: ComparisonType;
  severity: 'critical' | 'warning' | 'info';
  applies_to_checklist: boolean;
  applies_to_hbl: boolean;
  field_order: number;
  description: string | null;
}

export interface FieldComparison {
  field_name: string;
  field_label: string;
  si_value: string | null;
  comparison_value: string | null;
  matches: boolean;
  severity: 'critical' | 'warning' | 'info';
  comparison_type: ComparisonType;
}

export interface ReconciliationRecord {
  id: string;
  shipment_id: string;
  si_draft_email_id: string | null;
  comparison_document_type: 'checklist' | 'house_bl';
  comparison_email_id: string | null;
  reconciliation_status: ReconciliationStatus;
  field_comparisons: Record<string, FieldComparison>;
  total_fields_compared: number;
  matching_fields: number;
  discrepancy_count: number;
  critical_discrepancies: number;
  can_submit_si: boolean;
  block_reason: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_notes: string | null;
  created_at: string;
}

export interface ReconciliationResult {
  success: boolean;
  record_id: string;
  status: ReconciliationStatus;
  can_submit_si: boolean;
  total_fields: number;
  matching_fields: number;
  discrepancies: FieldComparison[];
  block_reason?: string;
}

export class SIReconciliationService {
  private fieldsCache: ReconciliationField[] = [];
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 10 * 60 * 1000;
  private anthropic: Anthropic;

  constructor(private readonly supabase: SupabaseClient) {
    this.anthropic = new Anthropic();
  }

  /**
   * Run reconciliation between SI Draft and another document
   */
  async reconcile(
    shipmentId: string,
    siDraftEmailId: string,
    comparisonDocumentType: 'checklist' | 'house_bl',
    comparisonEmailId: string
  ): Promise<ReconciliationResult> {
    await this.ensureCacheValid();

    // Get applicable fields for this comparison type
    const fields = this.getFieldsForComparison(comparisonDocumentType);

    // Extract values from both documents using AI
    const siValues = await this.extractFieldValues(siDraftEmailId, fields);
    const comparisonValues = await this.extractFieldValues(comparisonEmailId, fields);

    // Compare each field
    const comparisons: Record<string, FieldComparison> = {};
    const discrepancies: FieldComparison[] = [];
    let matchingCount = 0;
    let criticalCount = 0;

    for (const field of fields) {
      const siValue = siValues[field.field_name] || null;
      const compValue = comparisonValues[field.field_name] || null;

      const matches = this.compareValues(
        siValue,
        compValue,
        field.comparison_type
      );

      const comparison: FieldComparison = {
        field_name: field.field_name,
        field_label: field.field_label,
        si_value: siValue,
        comparison_value: compValue,
        matches,
        severity: field.severity,
        comparison_type: field.comparison_type,
      };

      comparisons[field.field_name] = comparison;

      if (matches) {
        matchingCount++;
      } else {
        discrepancies.push(comparison);
        if (field.severity === 'critical') {
          criticalCount++;
        }
      }
    }

    // Determine result
    const canSubmit = criticalCount === 0;
    const status: ReconciliationStatus = discrepancies.length === 0
      ? 'matches'
      : 'discrepancies_found';

    const blockReason = !canSubmit
      ? `${criticalCount} critical discrepancies found: ${discrepancies.filter(d => d.severity === 'critical').map(d => d.field_label).join(', ')}`
      : null;

    // Save reconciliation record
    const { data: record, error } = await this.supabase
      .from('si_reconciliation_records')
      .insert({
        shipment_id: shipmentId,
        si_draft_email_id: siDraftEmailId,
        comparison_document_type: comparisonDocumentType,
        comparison_email_id: comparisonEmailId,
        reconciliation_status: status,
        field_comparisons: comparisons,
        total_fields_compared: fields.length,
        matching_fields: matchingCount,
        discrepancy_count: discrepancies.length,
        critical_discrepancies: criticalCount,
        can_submit_si: canSubmit,
        block_reason: blockReason,
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to save reconciliation record: ${error.message}`);
    }

    // Update shipment SI status
    await this.supabase
      .from('shipments')
      .update({
        si_reconciliation_status: status,
        si_can_submit: canSubmit,
        si_block_reason: blockReason,
      })
      .eq('id', shipmentId);

    return {
      success: true,
      record_id: record.id,
      status,
      can_submit_si: canSubmit,
      total_fields: fields.length,
      matching_fields: matchingCount,
      discrepancies,
      block_reason: blockReason || undefined,
    };
  }

  /**
   * Check if SI can be submitted for a shipment
   */
  async canSubmitSI(shipmentId: string): Promise<{
    can_submit: boolean;
    reason?: string;
    pending_reconciliations: string[];
  }> {
    // Get latest reconciliation records
    const { data: records } = await this.supabase
      .from('si_reconciliation_records')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('created_at', { ascending: false });

    if (!records || records.length === 0) {
      return {
        can_submit: false,
        reason: 'No reconciliation performed yet',
        pending_reconciliations: ['checklist', 'house_bl'],
      };
    }

    // Check if all required reconciliations passed
    const checklistRecon = records.find(r => r.comparison_document_type === 'checklist');
    const hblRecon = records.find(r => r.comparison_document_type === 'house_bl');

    const pending: string[] = [];
    const blockers: string[] = [];

    if (!checklistRecon) {
      pending.push('checklist');
    } else if (!checklistRecon.can_submit_si) {
      blockers.push(`Checklist: ${checklistRecon.block_reason}`);
    }

    // HBL reconciliation is optional until HBL is received
    if (hblRecon && !hblRecon.can_submit_si) {
      blockers.push(`HBL: ${hblRecon.block_reason}`);
    }

    if (blockers.length > 0) {
      return {
        can_submit: false,
        reason: blockers.join('; '),
        pending_reconciliations: pending,
      };
    }

    if (pending.includes('checklist')) {
      return {
        can_submit: false,
        reason: 'Checklist reconciliation required before SI submission',
        pending_reconciliations: pending,
      };
    }

    return {
      can_submit: true,
      pending_reconciliations: pending,
    };
  }

  /**
   * Resolve discrepancies manually
   */
  async resolveDiscrepancies(
    recordId: string,
    resolvedBy: string,
    notes: string
  ): Promise<void> {
    const { error } = await this.supabase
      .from('si_reconciliation_records')
      .update({
        reconciliation_status: 'resolved',
        can_submit_si: true,
        resolved_by: resolvedBy,
        resolved_at: new Date().toISOString(),
        resolution_notes: notes,
      })
      .eq('id', recordId);

    if (error) {
      throw new Error(`Failed to resolve discrepancies: ${error.message}`);
    }

    // Update shipment status
    const { data: record } = await this.supabase
      .from('si_reconciliation_records')
      .select('shipment_id')
      .eq('id', recordId)
      .single();

    if (record) {
      await this.supabase
        .from('shipments')
        .update({
          si_reconciliation_status: 'resolved',
          si_can_submit: true,
          si_block_reason: null,
        })
        .eq('id', record.shipment_id);
    }
  }

  /**
   * Get reconciliation status for a shipment
   */
  async getReconciliationStatus(shipmentId: string): Promise<{
    checklist: ReconciliationRecord | null;
    house_bl: ReconciliationRecord | null;
    overall_can_submit: boolean;
  }> {
    const { data: records } = await this.supabase
      .from('si_reconciliation_records')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('created_at', { ascending: false });

    const checklist = records?.find(r => r.comparison_document_type === 'checklist') || null;
    const houseBl = records?.find(r => r.comparison_document_type === 'house_bl') || null;

    // Can submit if checklist passed (HBL optional until received)
    const overallCanSubmit = checklist?.can_submit_si ?? false;

    return {
      checklist,
      house_bl: houseBl,
      overall_can_submit: overallCanSubmit,
    };
  }

  /**
   * Compare two values based on comparison type
   */
  private compareValues(
    value1: string | null,
    value2: string | null,
    comparisonType: ComparisonType
  ): boolean {
    // Both null = match
    if (!value1 && !value2) return true;

    // One null = no match
    if (!value1 || !value2) return false;

    const v1 = value1.trim();
    const v2 = value2.trim();

    switch (comparisonType) {
      case 'exact':
        return v1.toUpperCase() === v2.toUpperCase();

      case 'contains':
        return v1.toUpperCase().includes(v2.toUpperCase()) ||
               v2.toUpperCase().includes(v1.toUpperCase());

      case 'numeric':
        const num1 = parseFloat(v1.replace(/[^0-9.-]/g, ''));
        const num2 = parseFloat(v2.replace(/[^0-9.-]/g, ''));
        if (isNaN(num1) || isNaN(num2)) return false;
        // Allow 1% tolerance for numeric comparisons
        return Math.abs(num1 - num2) <= Math.max(num1, num2) * 0.01;

      case 'date':
        const date1 = new Date(v1);
        const date2 = new Date(v2);
        if (isNaN(date1.getTime()) || isNaN(date2.getTime())) return false;
        // Same day = match
        return date1.toDateString() === date2.toDateString();

      case 'fuzzy':
        return this.fuzzyMatch(v1, v2);

      default:
        return v1 === v2;
    }
  }

  /**
   * Fuzzy string matching for names/addresses
   */
  private fuzzyMatch(str1: string, str2: string): boolean {
    // Normalize: lowercase, remove extra spaces, remove punctuation
    const normalize = (s: string) =>
      s.toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const n1 = normalize(str1);
    const n2 = normalize(str2);

    // Exact match after normalization
    if (n1 === n2) return true;

    // One contains the other
    if (n1.includes(n2) || n2.includes(n1)) return true;

    // Calculate similarity ratio
    const similarity = this.calculateSimilarity(n1, n2);
    return similarity >= 0.85; // 85% similarity threshold
  }

  /**
   * Calculate string similarity (Levenshtein-based)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const editDistance = this.levenshteinDistance(longer, shorter);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Levenshtein distance calculation
   */
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Extract field values from an email using AI
   */
  private async extractFieldValues(
    emailId: string,
    fields: ReconciliationField[]
  ): Promise<Record<string, string>> {
    // Get email content
    const { data: email } = await this.supabase
      .from('raw_emails')
      .select('subject, body_text')
      .eq('id', emailId)
      .single();

    if (!email) {
      return {};
    }

    // Get existing entity extractions for this email
    const { data: entities } = await this.supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', emailId);

    // Build result from existing extractions
    const result: Record<string, string> = {};

    for (const field of fields) {
      // Map field names to entity types
      const entityMapping: Record<string, string> = {
        shipper_name: 'shipper_name',
        shipper_address: 'shipper_address',
        consignee_name: 'consignee_name',
        consignee_address: 'consignee_address',
        notify_party_name: 'notify_party_name',
        notify_party_address: 'notify_party_address',
        cargo_description: 'cargo_description',
        hs_code: 'hs_code',
        marks_numbers: 'marks_numbers',
        container_numbers: 'container_number',
        seal_numbers: 'seal_number',
        total_weight: 'weight',
        weight_unit: 'weight_unit',
        total_packages: 'packages',
        package_type: 'package_type',
        total_volume: 'volume',
      };

      const entityType = entityMapping[field.field_name];
      if (entityType) {
        const entity = entities?.find(e => e.entity_type === entityType);
        if (entity?.entity_value) {
          result[field.field_name] = entity.entity_value;
        }
      }
    }

    // If we have missing fields, use AI to extract them
    const missingFields = fields.filter(f => !result[f.field_name]);
    if (missingFields.length > 0 && email.body_text) {
      const aiExtracted = await this.extractWithAI(
        email.body_text,
        missingFields
      );
      Object.assign(result, aiExtracted);
    }

    return result;
  }

  /**
   * Extract missing fields using AI
   */
  private async extractWithAI(
    bodyText: string,
    fields: ReconciliationField[]
  ): Promise<Record<string, string>> {
    const fieldList = fields.map(f => `- ${f.field_name}: ${f.description || f.field_label}`).join('\n');

    const message = await this.anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: `Extract the following fields from this shipping document. Return ONLY a JSON object with field names as keys and extracted values as strings. If a field is not found, omit it from the response.

Fields to extract:
${fieldList}

Document:
${bodyText.substring(0, 8000)}

Return ONLY valid JSON, no explanation.`,
        },
      ],
    });

    try {
      const content = message.content[0];
      if (content.type === 'text') {
        // Extract JSON from response
        const jsonMatch = content.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
      }
    } catch {
      // AI extraction failed, return empty
    }

    return {};
  }

  /**
   * Get fields applicable for a comparison type
   */
  private getFieldsForComparison(comparisonType: 'checklist' | 'house_bl'): ReconciliationField[] {
    return this.fieldsCache.filter(f =>
      comparisonType === 'checklist' ? f.applies_to_checklist : f.applies_to_hbl
    );
  }

  /**
   * Load reconciliation fields from database
   */
  private async loadFields(): Promise<void> {
    const { data, error } = await this.supabase
      .from('si_reconciliation_fields')
      .select('*')
      .eq('is_active', true)
      .order('field_order', { ascending: true });

    if (error) {
      throw new Error(`Failed to load reconciliation fields: ${error.message}`);
    }

    this.fieldsCache = data || [];
    this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
  }

  /**
   * Ensure cache is valid
   */
  private async ensureCacheValid(): Promise<void> {
    if (Date.now() >= this.cacheExpiry || this.fieldsCache.length === 0) {
      await this.loadFields();
    }
  }
}
