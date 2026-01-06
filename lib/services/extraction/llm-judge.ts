/**
 * LLM Judge Service
 *
 * Uses Claude Sonnet for quality evaluation of extractions.
 * Acts as a quality gate for critical shipments and high-value documents.
 *
 * Architecture:
 * - Haiku: Fast extraction (sentiment, urgency, summary, action items)
 * - Sonnet: Quality judge (validation, cross-reference, error detection)
 *
 * Use Cases:
 * 1. Validate regex-only extractions for critical fields
 * 2. Detect hallucinated values from AI extraction
 * 3. Cross-reference extracted data against source content
 * 4. Recommend manual review for ambiguous cases
 *
 * Design Principles:
 * - Single Responsibility: Only quality evaluation, no extraction
 * - Fail Fast: Flag issues early, before data persists
 * - Deep Module: Simple judge() interface, sophisticated evaluation
 */

import Anthropic from '@anthropic-ai/sdk';
import { ExtractedData, ExtractionMetadata } from './layered-extraction-service';
import { CONFIDENCE_THRESHOLDS, CRITICAL_FIELDS } from './pattern-definitions';

// ============================================================================
// Types
// ============================================================================

export interface JudgementInput {
  extractedData: ExtractedData;
  metadata: ExtractionMetadata;
  sourceContent: string;
  documentType?: string;
  carrier?: string;
}

export interface JudgementResult {
  verdict: 'approved' | 'needs_review' | 'rejected';
  overallScore: number; // 0-100
  fieldEvaluations: FieldEvaluation[];
  issues: JudgementIssue[];
  recommendations: string[];
  processingTime: number;
}

export interface FieldEvaluation {
  field: string;
  extractedValue: string | null;
  verdict: 'correct' | 'likely_correct' | 'suspicious' | 'incorrect' | 'missing';
  confidence: number;
  reason?: string;
  suggestedValue?: string;
}

export interface JudgementIssue {
  severity: 'critical' | 'warning' | 'info';
  field: string;
  issue: string;
  impact: string;
}

// ============================================================================
// LLM Judge Service
// ============================================================================

export class LLMJudge {
  private anthropic: Anthropic;
  private model = 'claude-sonnet-4-20250514'; // Sonnet for quality judging

  constructor(anthropicApiKey: string) {
    this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
  }

  /**
   * Evaluate extraction quality using Sonnet
   */
  async judge(input: JudgementInput): Promise<JudgementResult> {
    const startTime = Date.now();

    try {
      const prompt = this.buildJudgementPrompt(input);

      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 4096,
        temperature: 0, // Deterministic for consistency
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const evaluation = this.parseJudgementResponse(text, input);

      return {
        ...evaluation,
        processingTime: Date.now() - startTime,
      };

    } catch (error: any) {
      console.error('[LLMJudge] Evaluation error:', error.message);

      // Return conservative result on error
      return {
        verdict: 'needs_review',
        overallScore: 50,
        fieldEvaluations: [],
        issues: [{
          severity: 'warning',
          field: 'system',
          issue: `Judge evaluation failed: ${error.message}`,
          impact: 'Unable to verify extraction quality',
        }],
        recommendations: ['Manual review recommended due to judge failure'],
        processingTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Quick validation for critical fields only (cost-effective)
   */
  async quickValidate(input: JudgementInput): Promise<{
    isValid: boolean;
    criticalIssues: JudgementIssue[];
  }> {
    const startTime = Date.now();

    try {
      const prompt = this.buildQuickValidationPrompt(input);

      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307', // Haiku for quick checks
        max_tokens: 1024,
        temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return this.parseQuickValidation(text);

    } catch (error: any) {
      console.error('[LLMJudge] Quick validation error:', error.message);
      return {
        isValid: false,
        criticalIssues: [{
          severity: 'critical',
          field: 'system',
          issue: 'Validation check failed',
          impact: 'Cannot verify critical fields',
        }],
      };
    }
  }

  /**
   * Build comprehensive judgement prompt
   */
  private buildJudgementPrompt(input: JudgementInput): string {
    const { extractedData, metadata, sourceContent, documentType, carrier } = input;

    return `You are a shipping document extraction quality judge. Your role is to evaluate whether extracted data is accurate by cross-referencing with the source content.

## Context
- Document Type: ${documentType || 'Unknown'}
- Carrier: ${carrier || 'Unknown'}
- Extraction Strategy: ${metadata.strategy}
- Regex Fields: ${metadata.regexFieldCount}
- AI Fields: ${metadata.aiFieldCount}
- Reported Confidence: ${metadata.overallConfidence}%

## Extracted Data (to evaluate)
\`\`\`json
${JSON.stringify(extractedData, null, 2)}
\`\`\`

## Source Content (ground truth)
\`\`\`
${sourceContent.substring(0, 12000)}
\`\`\`

## Your Task

Evaluate EACH extracted field against the source content. Look for:

1. **Correctness**: Does the extracted value actually appear in the source?
2. **Hallucination**: Is the value fabricated or from AI training data (not source)?
3. **Misattribution**: Is the value from wrong section (e.g., shipper vs consignee)?
4. **Format Issues**: Wrong date format, missing digits, truncation?
5. **Completeness**: Are array fields missing items?

## Critical Fields (must be correct)
- booking_number
- bl_number
- container_numbers
- port_of_loading
- port_of_discharge
- etd
- eta

## Response Format

Return ONLY valid JSON:
{
  "overallScore": <0-100>,
  "verdict": "approved" | "needs_review" | "rejected",
  "fieldEvaluations": [
    {
      "field": "<field_name>",
      "extractedValue": "<value or null>",
      "verdict": "correct" | "likely_correct" | "suspicious" | "incorrect" | "missing",
      "confidence": <0-100>,
      "reason": "<explanation if not correct>",
      "suggestedValue": "<correct value if different>"
    }
  ],
  "issues": [
    {
      "severity": "critical" | "warning" | "info",
      "field": "<field_name>",
      "issue": "<description>",
      "impact": "<business impact>"
    }
  ],
  "recommendations": ["<action item 1>", "<action item 2>"]
}

## Scoring Guidelines
- 90-100: All critical fields correct, minor issues only → approved
- 70-89: Most fields correct, some need verification → needs_review
- Below 70: Critical errors or hallucinations → rejected

Be strict. Better to flag for review than miss an error.`;
  }

  /**
   * Build quick validation prompt for critical fields
   */
  private buildQuickValidationPrompt(input: JudgementInput): string {
    const { extractedData, sourceContent } = input;

    const criticalValues = {
      booking_number: extractedData.booking_number,
      bl_number: extractedData.bl_number,
      container_numbers: extractedData.container_numbers,
      port_of_loading: extractedData.port_of_loading,
      port_of_discharge: extractedData.port_of_discharge,
      etd: extractedData.etd,
      eta: extractedData.eta,
    };

    return `Verify these extracted values appear in the source document.

## Extracted Critical Fields
\`\`\`json
${JSON.stringify(criticalValues, null, 2)}
\`\`\`

## Source Content
\`\`\`
${sourceContent.substring(0, 8000)}
\`\`\`

For each non-null field, check if the value actually exists in the source.
Report any field that:
1. Does not appear in source (hallucinated)
2. Appears but in wrong context (misattributed)
3. Has wrong format (corrupted)

Return JSON:
{
  "isValid": true | false,
  "criticalIssues": [
    {
      "field": "<field>",
      "issue": "<what's wrong>",
      "severity": "critical"
    }
  ]
}`;
  }

  /**
   * Parse full judgement response
   */
  private parseJudgementResponse(
    text: string,
    input: JudgementInput
  ): Omit<JudgementResult, 'processingTime'> {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        return {
          verdict: parsed.verdict || 'needs_review',
          overallScore: parsed.overallScore || 50,
          fieldEvaluations: parsed.fieldEvaluations || [],
          issues: parsed.issues || [],
          recommendations: parsed.recommendations || [],
        };
      }
    } catch (error) {
      console.error('[LLMJudge] Failed to parse response:', error);
    }

    // Fallback: conservative evaluation
    return {
      verdict: 'needs_review',
      overallScore: input.metadata.overallConfidence,
      fieldEvaluations: [],
      issues: [{
        severity: 'warning',
        field: 'system',
        issue: 'Could not parse judge response',
        impact: 'Extraction quality unverified',
      }],
      recommendations: ['Manual review recommended'],
    };
  }

  /**
   * Parse quick validation response
   */
  private parseQuickValidation(text: string): {
    isValid: boolean;
    criticalIssues: JudgementIssue[];
  } {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          isValid: parsed.isValid ?? false,
          criticalIssues: (parsed.criticalIssues || []).map((issue: any) => ({
            severity: 'critical' as const,
            field: issue.field,
            issue: issue.issue,
            impact: 'Critical field validation failed',
          })),
        };
      }
    } catch (error) {
      console.error('[LLMJudge] Failed to parse quick validation:', error);
    }

    return {
      isValid: false,
      criticalIssues: [{
        severity: 'critical',
        field: 'system',
        issue: 'Validation parse error',
        impact: 'Cannot verify extraction',
      }],
    };
  }

  /**
   * Determine if document should be judged based on criteria
   */
  static shouldJudge(
    metadata: ExtractionMetadata,
    documentType?: string
  ): { shouldJudge: boolean; reason: string } {
    // Always judge high-value document types
    const highValueDocs = ['bill_of_lading', 'hbl', 'arrival_notice', 'customs_document'];
    if (documentType && highValueDocs.includes(documentType)) {
      return { shouldJudge: true, reason: 'High-value document type' };
    }

    // Judge if confidence is in questionable range
    if (
      metadata.overallConfidence >= CONFIDENCE_THRESHOLDS.LOW &&
      metadata.overallConfidence < CONFIDENCE_THRESHOLDS.MEDIUM_HIGH
    ) {
      return { shouldJudge: true, reason: 'Medium confidence needs verification' };
    }

    // Judge if AI was heavily used
    if (metadata.aiFieldCount > metadata.regexFieldCount) {
      return { shouldJudge: true, reason: 'AI-heavy extraction needs validation' };
    }

    // Judge if critical fields came from AI
    const criticalFromAI = CRITICAL_FIELDS.filter(
      f => metadata.fieldSources[f] === 'ai'
    ).length;
    if (criticalFromAI >= 2) {
      return { shouldJudge: true, reason: 'Critical fields from AI' };
    }

    return { shouldJudge: false, reason: 'High confidence regex extraction' };
  }

  /**
   * Apply judge corrections to extracted data
   */
  static applyCorrections(
    data: ExtractedData,
    judgement: JudgementResult
  ): { correctedData: ExtractedData; correctionsMade: string[] } {
    const correctedData = { ...data };
    const correctionsMade: string[] = [];

    for (const evaluation of judgement.fieldEvaluations) {
      if (evaluation.verdict === 'incorrect' && evaluation.suggestedValue) {
        const field = evaluation.field as keyof ExtractedData;

        // Type-safe correction
        if (field in correctedData) {
          const oldValue = correctedData[field];
          (correctedData as any)[field] = evaluation.suggestedValue;
          correctionsMade.push(
            `${field}: "${oldValue}" → "${evaluation.suggestedValue}"`
          );
        }
      }
    }

    return { correctedData, correctionsMade };
  }
}

// ============================================================================
// Batch Judge (for multiple documents)
// ============================================================================

export class BatchJudge {
  private judge: LLMJudge;

  constructor(anthropicApiKey: string) {
    this.judge = new LLMJudge(anthropicApiKey);
  }

  /**
   * Judge multiple extractions efficiently
   */
  async judgeBatch(
    items: JudgementInput[]
  ): Promise<Map<string, JudgementResult>> {
    const results = new Map<string, JudgementResult>();

    // Process in parallel with concurrency limit
    const concurrencyLimit = 3;
    const chunks: JudgementInput[][] = [];

    for (let i = 0; i < items.length; i += concurrencyLimit) {
      chunks.push(items.slice(i, i + concurrencyLimit));
    }

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(async (item, idx) => {
          const result = await this.judge.judge(item);
          return {
            id: `item_${chunks.indexOf(chunk) * concurrencyLimit + idx}`,
            result,
          };
        })
      );

      for (const { id, result } of chunkResults) {
        results.set(id, result);
      }
    }

    return results;
  }

  /**
   * Quick validate batch (for screening)
   */
  async quickValidateBatch(
    items: JudgementInput[]
  ): Promise<{ needsFullJudge: JudgementInput[]; approved: JudgementInput[] }> {
    const needsFullJudge: JudgementInput[] = [];
    const approved: JudgementInput[] = [];

    // Quick validation in parallel
    const validations = await Promise.all(
      items.map(async item => {
        const result = await this.judge.quickValidate(item);
        return { item, result };
      })
    );

    for (const { item, result } of validations) {
      if (result.isValid) {
        approved.push(item);
      } else {
        needsFullJudge.push(item);
      }
    }

    return { needsFullJudge, approved };
  }
}

export default LLMJudge;
