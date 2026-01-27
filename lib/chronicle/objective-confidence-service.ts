/**
 * ObjectiveConfidenceService
 *
 * Calculates confidence scores using OBJECTIVE signals instead of AI self-assessment.
 * All rules are database-driven for easy tuning without code deployment.
 *
 * Signals:
 * 1. Completeness - Required fields populated for document type
 * 2. Pattern Match - Detection pattern confidence + historical reliability
 * 3. Sender Trust - Historical sender domain reliability
 * 4. Flow Validation - Document appears in correct stage sequence
 * 5. Field Consistency - Cross-field validation passes
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================
// TYPES
// ============================================

export interface ConfidenceSignal {
  name: string;
  score: number;
  weight: number;
  details: Record<string, unknown>;
}

export interface ConfidenceResult {
  overallScore: number;
  signals: {
    completeness: ConfidenceSignal;
    patternMatch: ConfidenceSignal;
    senderTrust: ConfidenceSignal;
    flowValidation: ConfidenceSignal;
    fieldConsistency: ConfidenceSignal;
  };
  recommendation: 'accept' | 'flag_review' | 'escalate_sonnet' | 'escalate_opus' | 'human_review';
  reasoning: string[];
  calculationId?: string;
}

export interface ConfidenceInput {
  chronicleId: string;
  documentType: string;
  extractedFields: Record<string, unknown>;
  senderEmail: string;
  patternId?: string;
  patternConfidence?: number;
  shipmentId?: string;
}

interface ConfidenceRule {
  rule_name: string;
  weight: number;
  enabled: boolean;
  min_threshold: number;
}

interface ExpectedField {
  field_name: string;
  is_required: boolean;
  weight: number;
}

interface Threshold {
  min_score: number;
  max_score: number;
  action: string;
}

// ============================================
// SERVICE
// ============================================

export class ObjectiveConfidenceService {
  private rulesCache: Map<string, ConfidenceRule> = new Map();
  private fieldsCache: Map<string, ExpectedField[]> = new Map();
  private thresholdsCache: Threshold[] = [];
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly supabase: SupabaseClient) {}

  // ============================================
  // MAIN ENTRY POINT
  // ============================================

  async calculateConfidence(input: ConfidenceInput): Promise<ConfidenceResult> {
    await this.ensureCacheLoaded();

    const signals = await this.calculateAllSignals(input);
    const overallScore = this.calculateWeightedScore(signals);
    const recommendation = this.determineRecommendation(overallScore);
    const reasoning = this.generateReasoning(signals, overallScore);

    // Record calculation for audit
    const calculationId = await this.recordCalculation(input, signals, overallScore, recommendation);

    return {
      overallScore,
      signals,
      recommendation,
      reasoning,
      calculationId,
    };
  }

  // ============================================
  // SIGNAL CALCULATIONS
  // ============================================

  private async calculateAllSignals(input: ConfidenceInput): Promise<ConfidenceResult['signals']> {
    const [completeness, patternMatch, senderTrust, flowValidation, fieldConsistency] =
      await Promise.all([
        this.calculateCompleteness(input.documentType, input.extractedFields),
        this.calculatePatternMatch(input.patternId, input.patternConfidence),
        this.calculateSenderTrust(input.senderEmail),
        this.calculateFlowValidation(input.shipmentId, input.documentType),
        this.calculateFieldConsistency(input.extractedFields),
      ]);

    return {
      completeness,
      patternMatch,
      senderTrust,
      flowValidation,
      fieldConsistency,
    };
  }

  // ----------------------------------------
  // Signal 1: Completeness
  // ----------------------------------------
  private async calculateCompleteness(
    documentType: string,
    fields: Record<string, unknown>
  ): Promise<ConfidenceSignal> {
    const rule = this.rulesCache.get('completeness');
    const weight = rule?.enabled ? rule.weight : 0;

    // Use database function for calculation
    const { data, error } = await this.supabase.rpc('calculate_completeness_score', {
      p_document_type: documentType,
      p_fields: fields,
    });

    if (error || !data || data.length === 0) {
      return {
        name: 'completeness',
        score: 50,
        weight,
        details: { reason: 'Completeness calculation failed', error: error?.message },
      };
    }

    return {
      name: 'completeness',
      score: data[0].score,
      weight,
      details: data[0].details,
    };
  }

  // ----------------------------------------
  // Signal 2: Pattern Match
  // ----------------------------------------
  private async calculatePatternMatch(
    patternId?: string,
    patternConfidence?: number
  ): Promise<ConfidenceSignal> {
    const rule = this.rulesCache.get('pattern_match');
    const weight = rule?.enabled ? rule.weight : 0;

    if (!patternId) {
      return {
        name: 'pattern_match',
        score: 0,
        weight,
        details: { reason: 'No pattern matched - AI classification only' },
      };
    }

    // Get pattern reliability from database
    const { data: pattern } = await this.supabase
      .from('detection_patterns')
      .select('pattern_type, document_type, hit_count, false_positive_count')
      .eq('id', patternId)
      .single();

    if (!pattern) {
      return {
        name: 'pattern_match',
        score: patternConfidence || 70,
        weight,
        details: { reason: 'Pattern ID not found', patternConfidence },
      };
    }

    // Calculate reliability based on false positive rate
    const hitCount = pattern.hit_count || 0;
    const falsePositives = pattern.false_positive_count || 0;
    const reliability = hitCount > 0
      ? Math.round((1 - falsePositives / hitCount) * 100)
      : 80;

    // Combine pattern confidence with historical reliability
    const score = Math.round(((patternConfidence || 80) + reliability) / 2);

    return {
      name: 'pattern_match',
      score,
      weight,
      details: {
        patternType: pattern.pattern_type,
        documentType: pattern.document_type,
        patternConfidence,
        historicalReliability: reliability,
        hitCount,
        falsePositives,
      },
    };
  }

  // ----------------------------------------
  // Signal 3: Sender Trust
  // ----------------------------------------
  private async calculateSenderTrust(senderEmail: string): Promise<ConfidenceSignal> {
    const rule = this.rulesCache.get('sender_trust');
    const weight = rule?.enabled ? rule.weight : 0;

    const domain = senderEmail?.split('@')[1]?.toLowerCase();

    if (!domain) {
      return {
        name: 'sender_trust',
        score: 30,
        weight,
        details: { reason: 'Invalid sender email format' },
      };
    }

    // Use database function
    const { data: trustScore } = await this.supabase.rpc('get_sender_trust_score', {
      p_sender_email: senderEmail,
    });

    const score = Math.round((trustScore || 0.5) * 100);

    // Get additional details
    const { data: trustData } = await this.supabase
      .from('sender_trust_scores')
      .select('total_emails, correct_extractions')
      .eq('sender_domain', domain)
      .single();

    return {
      name: 'sender_trust',
      score,
      weight,
      details: {
        domain,
        trustScore: trustScore || 0.5,
        totalEmails: trustData?.total_emails || 0,
        correctExtractions: trustData?.correct_extractions || 0,
        isNewSender: !trustData || trustData.total_emails < 10,
      },
    };
  }

  // ----------------------------------------
  // Signal 4: Flow Validation
  // ----------------------------------------
  private async calculateFlowValidation(
    shipmentId?: string,
    documentType?: string
  ): Promise<ConfidenceSignal> {
    const rule = this.rulesCache.get('flow_validation');
    const weight = rule?.enabled ? rule.weight : 0;

    if (!shipmentId || !documentType) {
      return {
        name: 'flow_validation',
        score: 75,
        weight,
        details: { reason: 'No shipment context for flow validation' },
      };
    }

    // Use database function
    const { data, error } = await this.supabase.rpc('validate_flow_sequence', {
      p_shipment_id: shipmentId,
      p_new_document_type: documentType,
    });

    if (error || !data || data.length === 0) {
      return {
        name: 'flow_validation',
        score: 75,
        weight,
        details: { reason: 'Flow validation query failed', error: error?.message },
      };
    }

    return {
      name: 'flow_validation',
      score: data[0].score,
      weight,
      details: data[0].details,
    };
  }

  // ----------------------------------------
  // Signal 5: Field Consistency
  // ----------------------------------------
  private async calculateFieldConsistency(
    fields: Record<string, unknown>
  ): Promise<ConfidenceSignal> {
    const rule = this.rulesCache.get('field_consistency');
    const weight = rule?.enabled ? rule.weight : 0;

    const issues: string[] = [];

    // Check ETD vs ETA
    if (fields.etd && fields.eta) {
      const etd = new Date(fields.etd as string);
      const eta = new Date(fields.eta as string);
      if (!isNaN(etd.getTime()) && !isNaN(eta.getTime()) && etd > eta) {
        issues.push('ETD is after ETA - verify if multi-leg shipment');
      }
    }

    // Check container count vs container numbers
    if (fields.container_count && fields.container_numbers) {
      const count = Number(fields.container_count);
      const numbers = Array.isArray(fields.container_numbers)
        ? fields.container_numbers.length
        : 0;
      if (!isNaN(count) && count !== numbers && numbers > 0) {
        issues.push(`Container count (${count}) doesn't match list (${numbers})`);
      }
    }

    // Check booking number format
    if (fields.booking_number) {
      const bookingNumber = String(fields.booking_number);
      if (bookingNumber.length < 5 || bookingNumber.length > 25) {
        issues.push(`Unusual booking number length: ${bookingNumber.length} chars`);
      }
    }

    // Check BL number format (mbl_number or hbl_number)
    const blNumber = fields.mbl_number || fields.hbl_number;
    if (blNumber) {
      const bl = String(blNumber);
      if (bl.length < 5 || bl.length > 30) {
        issues.push(`Unusual BL number length: ${bl.length} chars`);
      }
    }

    // Score based on issues found
    const score = Math.max(40, 100 - issues.length * 15);

    return {
      name: 'field_consistency',
      score,
      weight,
      details: {
        issuesFound: issues.length,
        issues,
        fieldsChecked: ['etd_vs_eta', 'container_count', 'booking_format', 'bl_format'],
      },
    };
  }

  // ============================================
  // COMPOSITE CALCULATION
  // ============================================

  private calculateWeightedScore(signals: ConfidenceResult['signals']): number {
    let totalWeight = 0;
    let weightedSum = 0;

    for (const signal of Object.values(signals)) {
      if (signal.weight > 0) {
        totalWeight += signal.weight;
        weightedSum += signal.score * signal.weight;
      }
    }

    if (totalWeight === 0) {
      return 50;
    }

    return Math.round(weightedSum / totalWeight);
  }

  private determineRecommendation(
    score: number
  ): ConfidenceResult['recommendation'] {
    for (const threshold of this.thresholdsCache) {
      if (score >= threshold.min_score && score <= threshold.max_score) {
        return threshold.action as ConfidenceResult['recommendation'];
      }
    }
    return 'human_review';
  }

  private generateReasoning(
    signals: ConfidenceResult['signals'],
    overallScore: number
  ): string[] {
    const reasons: string[] = [];

    // Overall assessment
    if (overallScore >= 85) {
      reasons.push(`High confidence (${overallScore}%) - extraction looks reliable`);
    } else if (overallScore >= 70) {
      reasons.push(`Medium confidence (${overallScore}%) - some concerns flagged`);
    } else if (overallScore >= 50) {
      reasons.push(`Low confidence (${overallScore}%) - recommend verification`);
    } else {
      reasons.push(`Very low confidence (${overallScore}%) - likely needs re-extraction`);
    }

    // Signal-specific reasoning
    if (signals.completeness.score < 60) {
      const details = signals.completeness.details as { fields?: Array<{ field: string; present: boolean; required: boolean }> };
      const missingRequired = details.fields?.filter(f => !f.present && f.required).map(f => f.field) || [];
      if (missingRequired.length > 0) {
        reasons.push(`Missing required fields: ${missingRequired.join(', ')}`);
      }
    }

    if (signals.patternMatch.score === 0) {
      reasons.push('No pattern matched - classified by AI only');
    } else if (signals.patternMatch.score >= 90) {
      reasons.push(`Strong pattern match (${signals.patternMatch.score}%)`);
    }

    if (signals.senderTrust.details.isNewSender) {
      reasons.push(`New/low-volume sender: ${signals.senderTrust.details.domain}`);
    } else if (signals.senderTrust.score < 60) {
      reasons.push(`Low sender trust: ${signals.senderTrust.details.domain} (${signals.senderTrust.score}%)`);
    }

    if (signals.flowValidation.score < 70) {
      reasons.push(`Flow concern: ${signals.flowValidation.details.reason}`);
    }

    if (signals.fieldConsistency.score < 80) {
      const issues = signals.fieldConsistency.details.issues as string[];
      if (issues?.length > 0) {
        reasons.push(`Field issues: ${issues.join('; ')}`);
      }
    }

    return reasons;
  }

  // ============================================
  // AUDIT & CACHING
  // ============================================

  private async recordCalculation(
    input: ConfidenceInput,
    signals: ConfidenceResult['signals'],
    overallScore: number,
    recommendation: string
  ): Promise<string | undefined> {
    const { data, error } = await this.supabase
      .from('confidence_calculations')
      .insert({
        chronicle_id: input.chronicleId,
        completeness_score: signals.completeness.score,
        completeness_details: signals.completeness.details,
        pattern_match_score: signals.patternMatch.score,
        pattern_id: input.patternId,
        sender_trust_score: signals.senderTrust.score,
        sender_domain: input.senderEmail?.split('@')[1]?.toLowerCase(),
        flow_validation_score: signals.flowValidation.score,
        flow_details: signals.flowValidation.details,
        field_consistency_score: signals.fieldConsistency.score,
        consistency_details: signals.fieldConsistency.details,
        overall_score: overallScore,
        weights_used: {
          completeness: signals.completeness.weight,
          pattern_match: signals.patternMatch.weight,
          sender_trust: signals.senderTrust.weight,
          flow_validation: signals.flowValidation.weight,
          field_consistency: signals.fieldConsistency.weight,
        },
        recommendation,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[ObjectiveConfidenceService] Failed to record calculation:', error);
      return undefined;
    }

    return data?.id;
  }

  private async ensureCacheLoaded(): Promise<void> {
    if (Date.now() < this.cacheExpiry) {
      return;
    }

    // Load confidence rules
    const { data: rules } = await this.supabase
      .from('confidence_rules')
      .select('*');

    this.rulesCache.clear();
    for (const rule of rules || []) {
      this.rulesCache.set(rule.rule_name, rule);
    }

    // Load expected fields by document type
    const { data: fields } = await this.supabase
      .from('expected_fields_by_doctype')
      .select('*');

    this.fieldsCache.clear();
    for (const field of fields || []) {
      const existing = this.fieldsCache.get(field.document_type) || [];
      existing.push(field);
      this.fieldsCache.set(field.document_type, existing);
    }

    // Load thresholds (sorted by min_score descending)
    const { data: thresholds } = await this.supabase
      .from('confidence_thresholds')
      .select('*')
      .order('min_score', { ascending: false });

    this.thresholdsCache = thresholds || [];

    this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;

    console.log(
      `[ObjectiveConfidenceService] Loaded ${this.rulesCache.size} rules, ` +
        `${this.fieldsCache.size} doc types, ${this.thresholdsCache.length} thresholds`
    );
  }

  /**
   * Force cache refresh (call after rule updates)
   */
  invalidateCache(): void {
    this.cacheExpiry = 0;
  }
}

export function createObjectiveConfidenceService(
  supabase: SupabaseClient
): ObjectiveConfidenceService {
  return new ObjectiveConfidenceService(supabase);
}
