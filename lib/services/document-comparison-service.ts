/**
 * Document Comparison Service
 *
 * Compares documents field-by-field based on configured rules.
 * Supports multiple comparison types and severity levels.
 *
 * Comparison Pairs:
 * - SI Draft vs Checklist
 * - SI Draft vs HBL
 * - Booking Confirmation vs SI
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { DocumentLifecycleRepository } from '@/lib/repositories/document-lifecycle-repository';
import {
  DocumentComparison,
  DocumentComparisonField,
  DocumentComparisonStatus,
  FieldComparisonResult,
  DiscrepancySeverity,
} from '@/types/intelligence-platform';

export type ComparisonType = 'exact' | 'fuzzy' | 'numeric' | 'date' | 'contains' | 'case_insensitive';
export type ComparisonSeverity = DiscrepancySeverity;

export interface ComparisonResult {
  status: DocumentComparisonStatus;
  fieldComparisons: Record<string, FieldComparisonResult>;
  totalFieldsCompared: number;
  matchingFields: number;
  discrepancyCount: number;
  criticalDiscrepancies: number;
  warningDiscrepancies: number;
  summary: string;
}

// Fuzzy match threshold (0-1, higher = stricter)
const FUZZY_THRESHOLD = 0.85;

// Numeric tolerance for numeric comparisons
const NUMERIC_TOLERANCE = 0.01; // 1%

// Date tolerance in days
const DATE_TOLERANCE_DAYS = 1;

export class DocumentComparisonService {
  private repository: DocumentLifecycleRepository;

  constructor(private supabase: SupabaseClient) {
    this.repository = new DocumentLifecycleRepository(supabase);
  }

  // ============================================================================
  // COMPARISON EXECUTION
  // ============================================================================

  async compareDocuments(
    shipmentId: string,
    sourceDocumentType: string,
    targetDocumentType: string,
    sourceData: Record<string, unknown>,
    targetData: Record<string, unknown>,
    sourceRevisionId?: string,
    targetRevisionId?: string
  ): Promise<DocumentComparison> {
    // Get comparison field configuration
    const fieldConfigs = await this.repository.getComparisonFields(
      sourceDocumentType,
      targetDocumentType
    );

    if (fieldConfigs.length === 0) {
      // No comparison rules configured, create not_applicable record
      return this.repository.createComparison({
        shipment_id: shipmentId,
        source_document_type: sourceDocumentType,
        target_document_type: targetDocumentType,
        source_revision_id: sourceRevisionId,
        target_revision_id: targetRevisionId,
        comparison_status: 'not_applicable',
        field_comparisons: {},
        total_fields_compared: 0,
        matching_fields: 0,
        discrepancy_count: 0,
        critical_discrepancies: 0,
        is_resolved: true,
        resolution_notes: 'No comparison rules configured for this document pair',
      });
    }

    // Perform field-by-field comparison
    const result = this.performComparison(
      sourceData,
      targetData,
      fieldConfigs
    );

    // Create comparison record
    return this.repository.createComparison({
      shipment_id: shipmentId,
      source_document_type: sourceDocumentType,
      target_document_type: targetDocumentType,
      source_revision_id: sourceRevisionId,
      target_revision_id: targetRevisionId,
      comparison_status: result.status,
      field_comparisons: result.fieldComparisons,
      total_fields_compared: result.totalFieldsCompared,
      matching_fields: result.matchingFields,
      discrepancy_count: result.discrepancyCount,
      critical_discrepancies: result.criticalDiscrepancies,
      is_resolved: result.discrepancyCount === 0,
    });
  }

  performComparison(
    sourceData: Record<string, unknown>,
    targetData: Record<string, unknown>,
    fieldConfigs: DocumentComparisonField[]
  ): ComparisonResult {
    const fieldComparisons: Record<string, FieldComparisonResult> = {};
    let matchingFields = 0;
    let discrepancyCount = 0;
    let criticalDiscrepancies = 0;
    let warningDiscrepancies = 0;

    for (const config of fieldConfigs) {
      const sourceValue = this.getNestedValue(sourceData, config.field_name);
      const targetValue = this.getNestedValue(targetData, config.field_name);

      const comparisonResult = this.compareField(
        sourceValue,
        targetValue,
        config.comparison_type as ComparisonType,
        config.field_name
      );

      const result: FieldComparisonResult = {
        fieldName: config.field_name,
        displayName: config.field_display_name || config.field_name,
        sourceValue,
        targetValue,
        matches: comparisonResult.matches,
        severity: config.severity as ComparisonSeverity,
        comparisonType: config.comparison_type as ComparisonType,
        message: comparisonResult.message,
      };

      fieldComparisons[config.field_name] = result;

      if (comparisonResult.matches) {
        matchingFields++;
      } else {
        discrepancyCount++;
        if (config.severity === 'critical') {
          criticalDiscrepancies++;
        } else if (config.severity === 'warning') {
          warningDiscrepancies++;
        }
      }
    }

    const totalFieldsCompared = fieldConfigs.length;
    const status: DocumentComparisonStatus =
      discrepancyCount === 0 ? 'matches' : 'discrepancies_found';

    const summary = this.generateSummary(
      matchingFields,
      totalFieldsCompared,
      criticalDiscrepancies,
      warningDiscrepancies
    );

    return {
      status,
      fieldComparisons,
      totalFieldsCompared,
      matchingFields,
      discrepancyCount,
      criticalDiscrepancies,
      warningDiscrepancies,
      summary,
    };
  }

  private compareField(
    sourceValue: unknown,
    targetValue: unknown,
    comparisonType: ComparisonType,
    fieldName: string
  ): { matches: boolean; message?: string } {
    // Handle null/undefined cases
    if (sourceValue === null || sourceValue === undefined) {
      if (targetValue === null || targetValue === undefined) {
        return { matches: true, message: 'Both values are empty' };
      }
      return { matches: false, message: 'Source value is missing' };
    }

    if (targetValue === null || targetValue === undefined) {
      return { matches: false, message: 'Target value is missing' };
    }

    switch (comparisonType) {
      case 'exact':
        return this.compareExact(sourceValue, targetValue);

      case 'fuzzy':
        return this.compareFuzzy(sourceValue, targetValue);

      case 'numeric':
        return this.compareNumeric(sourceValue, targetValue);

      case 'date':
        return this.compareDate(sourceValue, targetValue);

      case 'contains':
        return this.compareContains(sourceValue, targetValue);

      case 'case_insensitive':
        return this.compareCaseInsensitive(sourceValue, targetValue);

      default:
        return this.compareExact(sourceValue, targetValue);
    }
  }

  private compareExact(
    source: unknown,
    target: unknown
  ): { matches: boolean; message?: string } {
    const sourceStr = this.normalizeValue(source);
    const targetStr = this.normalizeValue(target);

    if (sourceStr === targetStr) {
      return { matches: true };
    }

    return {
      matches: false,
      message: `Values differ: "${sourceStr}" vs "${targetStr}"`,
    };
  }

  private compareFuzzy(
    source: unknown,
    target: unknown
  ): { matches: boolean; message?: string } {
    const sourceStr = this.normalizeValue(source).toLowerCase();
    const targetStr = this.normalizeValue(target).toLowerCase();

    // Exact match after normalization
    if (sourceStr === targetStr) {
      return { matches: true };
    }

    // Calculate similarity
    const similarity = this.calculateSimilarity(sourceStr, targetStr);

    if (similarity >= FUZZY_THRESHOLD) {
      return {
        matches: true,
        message: `Fuzzy match (${(similarity * 100).toFixed(0)}% similar)`,
      };
    }

    return {
      matches: false,
      message: `Values differ (${(similarity * 100).toFixed(0)}% similar)`,
    };
  }

  private compareNumeric(
    source: unknown,
    target: unknown
  ): { matches: boolean; message?: string } {
    const sourceNum = this.parseNumber(source);
    const targetNum = this.parseNumber(target);

    if (sourceNum === null || targetNum === null) {
      return {
        matches: false,
        message: 'One or both values are not valid numbers',
      };
    }

    // Exact match
    if (sourceNum === targetNum) {
      return { matches: true };
    }

    // Check within tolerance
    const maxVal = Math.max(Math.abs(sourceNum), Math.abs(targetNum));
    const diff = Math.abs(sourceNum - targetNum);
    const percentDiff = maxVal > 0 ? diff / maxVal : diff;

    if (percentDiff <= NUMERIC_TOLERANCE) {
      return {
        matches: true,
        message: `Within tolerance (${(percentDiff * 100).toFixed(2)}% difference)`,
      };
    }

    return {
      matches: false,
      message: `Numeric difference: ${sourceNum} vs ${targetNum} (${(percentDiff * 100).toFixed(2)}% diff)`,
    };
  }

  private compareDate(
    source: unknown,
    target: unknown
  ): { matches: boolean; message?: string } {
    const sourceDate = this.parseDate(source);
    const targetDate = this.parseDate(target);

    if (!sourceDate || !targetDate) {
      return {
        matches: false,
        message: 'One or both values are not valid dates',
      };
    }

    const diffMs = Math.abs(sourceDate.getTime() - targetDate.getTime());
    const diffDays = diffMs / (1000 * 60 * 60 * 24);

    if (diffDays <= DATE_TOLERANCE_DAYS) {
      if (diffDays === 0) {
        return { matches: true };
      }
      return {
        matches: true,
        message: `Within ${diffDays.toFixed(1)} day(s) tolerance`,
      };
    }

    return {
      matches: false,
      message: `Date difference: ${diffDays.toFixed(0)} days`,
    };
  }

  private compareContains(
    source: unknown,
    target: unknown
  ): { matches: boolean; message?: string } {
    const sourceStr = this.normalizeValue(source).toLowerCase();
    const targetStr = this.normalizeValue(target).toLowerCase();

    if (targetStr.includes(sourceStr)) {
      return { matches: true };
    }

    return {
      matches: false,
      message: `Target does not contain source value`,
    };
  }

  private compareCaseInsensitive(
    source: unknown,
    target: unknown
  ): { matches: boolean; message?: string } {
    const sourceStr = this.normalizeValue(source).toLowerCase().trim();
    const targetStr = this.normalizeValue(target).toLowerCase().trim();

    if (sourceStr === targetStr) {
      return { matches: true };
    }

    return {
      matches: false,
      message: `Values differ (case-insensitive)`,
    };
  }

  // ============================================================================
  // HELPER FUNCTIONS
  // ============================================================================

  private normalizeValue(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  private parseNumber(value: unknown): number | null {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      // Remove common formatting
      const cleaned = value.replace(/[,\s]/g, '');
      const num = parseFloat(cleaned);
      return isNaN(num) ? null : num;
    }
    return null;
  }

  private parseDate(value: unknown): Date | null {
    if (value instanceof Date) return value;
    if (typeof value === 'string') {
      const date = new Date(value);
      return isNaN(date.getTime()) ? null : date;
    }
    return null;
  }

  private getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    const keys = path.split('.');
    let current: unknown = obj;

    for (const key of keys) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = (current as Record<string, unknown>)[key];
    }

    return current;
  }

  private calculateSimilarity(str1: string, str2: string): number {
    // Levenshtein distance-based similarity
    const len1 = str1.length;
    const len2 = str2.length;

    if (len1 === 0) return len2 === 0 ? 1 : 0;
    if (len2 === 0) return 0;

    // Create distance matrix
    const matrix: number[][] = [];

    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,      // deletion
          matrix[i][j - 1] + 1,      // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }

    const distance = matrix[len1][len2];
    const maxLen = Math.max(len1, len2);

    return 1 - distance / maxLen;
  }

  private generateSummary(
    matching: number,
    total: number,
    critical: number,
    warning: number
  ): string {
    if (matching === total) {
      return `All ${total} fields match`;
    }

    const parts: string[] = [];
    parts.push(`${matching}/${total} fields match`);

    if (critical > 0) {
      parts.push(`${critical} critical`);
    }
    if (warning > 0) {
      parts.push(`${warning} warnings`);
    }

    return parts.join(', ');
  }

  // ============================================================================
  // HIGH-LEVEL COMPARISON OPERATIONS
  // ============================================================================

  async compareAllPairsForShipment(
    shipmentId: string,
    documentData: Record<string, Record<string, unknown>>
  ): Promise<DocumentComparison[]> {
    const configs = await this.repository.getAllComparisonFieldConfigs();

    // Group by source-target pairs
    const pairs = new Map<string, DocumentComparisonField[]>();
    for (const config of configs) {
      const key = `${config.source_document_type}:${config.target_document_type}`;
      if (!pairs.has(key)) {
        pairs.set(key, []);
      }
      pairs.get(key)!.push(config);
    }

    const comparisons: DocumentComparison[] = [];

    for (const [key] of pairs) {
      const [sourceType, targetType] = key.split(':');

      const sourceData = documentData[sourceType];
      const targetData = documentData[targetType];

      if (sourceData && targetData) {
        const comparison = await this.compareDocuments(
          shipmentId,
          sourceType,
          targetType,
          sourceData,
          targetData
        );
        comparisons.push(comparison);
      }
    }

    return comparisons;
  }

  async getComparisonSummaryForShipment(shipmentId: string): Promise<{
    totalComparisons: number;
    matchingPairs: number;
    withDiscrepancies: number;
    criticalIssues: number;
    unresolvedCount: number;
    details: Array<{
      sourceType: string;
      targetType: string;
      status: DocumentComparisonStatus;
      criticalCount: number;
      warningCount: number;
      isResolved: boolean;
    }>;
  }> {
    const { data: comparisons } = await this.repository.findAllComparisons({
      shipmentId,
    });

    let matchingPairs = 0;
    let withDiscrepancies = 0;
    let criticalIssues = 0;
    let unresolvedCount = 0;

    const details = comparisons.map(c => {
      if (c.comparison_status === 'matches') {
        matchingPairs++;
      } else if (c.comparison_status === 'discrepancies_found') {
        withDiscrepancies++;
        if (c.critical_discrepancies > 0) {
          criticalIssues += c.critical_discrepancies;
        }
        if (!c.is_resolved) {
          unresolvedCount++;
        }
      }

      return {
        sourceType: c.source_document_type,
        targetType: c.target_document_type,
        status: c.comparison_status,
        criticalCount: c.critical_discrepancies,
        warningCount: c.discrepancy_count - c.critical_discrepancies,
        isResolved: c.is_resolved,
      };
    });

    return {
      totalComparisons: comparisons.length,
      matchingPairs,
      withDiscrepancies,
      criticalIssues,
      unresolvedCount,
      details,
    };
  }
}
