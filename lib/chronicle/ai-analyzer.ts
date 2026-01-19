/**
 * AI Analyzer Service
 *
 * Handles AI-powered analysis of shipping communications.
 * Uses Anthropic tool_use for structured extraction.
 *
 * Following CLAUDE.md principles:
 * - Single Responsibility (Principle #3)
 * - Configuration Over Code (Principle #5)
 * - Small Functions < 20 lines (Principle #17)
 */

import Anthropic from '@anthropic-ai/sdk';
import { IAiAnalyzer } from './interfaces';
import { ProcessedEmail, ShippingAnalysis, ThreadContext, analyzeShippingCommunicationSchema } from './types';
import {
  AI_CONFIG,
  ANALYZE_TOOL_SCHEMA,
  buildAnalysisPrompt,
  validateExtractedDates,
  checkExpectedDates,
} from './prompts/freight-forwarder.prompt';

// ============================================================================
// ENUM NORMALIZATION - Fixes common AI enum mistakes BEFORE Zod validation
// ============================================================================

/**
 * Hardcoded enum mappings for fast normalization
 * These are the most common AI mistakes that cause validation failures
 */
const ENUM_MAPPINGS: Record<string, Record<string, string>> = {
  document_type: {
    'vgm': 'vgm_confirmation',
    'form_13': 'customs_entry',
    'mbl_amendment': 'booking_amendment',
    'bl_amendment': 'booking_amendment',
    'tr_confirmation': 'telex_release',
    'customs_form': 'customs_entry',
    'customs_clearance': 'customs_entry',
    'amendment': 'booking_amendment',
    'booking_change': 'booking_amendment',
    'hbl_draft': 'house_bl',
    'hbl': 'house_bl',
    'mbl': 'final_bl',
    'seaway_bill': 'sea_waybill',
    'seawaybill': 'sea_waybill',
  },
  pol_type: {
    'icd': 'port',           // ICD near port treated as port for loading
    'terminal': 'port',
    'seaport': 'port',
    'cfs': 'port',           // CFS near port treated as port
  },
  por_type: {
    'port': 'cfs',           // POR can't be port - likely CFS
    'terminal': 'icd',
    'depot': 'icd',
    'rail_terminal': 'icd',  // Rail terminal maps to ICD
  },
  pofd_type: {
    'port': 'cfs',           // POFD can't be port
    'terminal': 'icd',
    'depot': 'icd',
    'rail_terminal': 'icd',  // Rail terminal maps to ICD
  },
  pod_type: {
    'icd': 'port',
    'terminal': 'port',
  },
  message_type: {
    'draft': 'approval',
    'tracking_update': 'update',
    'response': 'acknowledgement',
    'reply': 'acknowledgement',
    'followup': 'request',
    'reminder': 'action_required',
    'alert': 'notification',
    'notice': 'notification',
    'info': 'notification',
    'fyi': 'notification',
  },
};

/**
 * Normalize AI response before Zod validation
 * Fixes common enum mistakes using hardcoded mappings
 */
function normalizeAiResponse(input: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...input };

  // Normalize each mapped field
  for (const [field, mappings] of Object.entries(ENUM_MAPPINGS)) {
    if (normalized[field] && typeof normalized[field] === 'string') {
      const value = (normalized[field] as string).toLowerCase();
      if (mappings[value]) {
        console.log(`[AiAnalyzer] Normalizing ${field}: ${normalized[field]} → ${mappings[value]}`);
        normalized[field] = mappings[value];
      }
    }
  }

  // Handle NaN in numeric fields (pieces, amount)
  const numericFields = ['pieces', 'amount'];
  for (const field of numericFields) {
    if (normalized[field] !== undefined && normalized[field] !== null) {
      const val = normalized[field];
      // Check for NaN or invalid numeric values
      if (typeof val === 'number' && isNaN(val)) {
        console.log(`[AiAnalyzer] Fixing NaN in ${field} → null`);
        normalized[field] = null;
      } else if (typeof val === 'string') {
        const num = parseFloat(val);
        if (isNaN(num)) {
          console.log(`[AiAnalyzer] Fixing invalid ${field}: ${val} → null`);
          normalized[field] = null;
        } else {
          normalized[field] = num;
        }
      }
    }
  }

  // Handle weight (should be string like "18500 KGS", but AI may return number)
  if (normalized.weight !== undefined && normalized.weight !== null) {
    if (typeof normalized.weight === 'number') {
      // Convert number to string
      normalized.weight = String(normalized.weight);
      console.log(`[AiAnalyzer] Converting weight number → string: ${normalized.weight}`);
    }
  }

  return normalized;
}

// ============================================================================
// AI ANALYZER IMPLEMENTATION
// ============================================================================

export class AiAnalyzer implements IAiAnalyzer {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic();
  }

  /**
   * Analyze email and attachments using AI
   * @param threadContext - Optional context from previous emails in thread
   * @param threadPosition - Position in thread (1 = first, 2+ = reply/forward)
   *                         Position 2+ ignores subject (stale from forwarding)
   */
  async analyze(
    email: ProcessedEmail,
    attachmentText: string,
    threadContext?: ThreadContext,
    threadPosition: number = 1
  ): Promise<ShippingAnalysis> {
    const includeSubject = threadPosition === 1;
    const prompt = this.buildPrompt(email, attachmentText, threadContext, includeSubject);
    const response = await this.callAnthropic(prompt);
    return this.parseResponse(response, email.receivedAt);
  }

  // ==========================================================================
  // PRIVATE HELPERS - Each < 20 lines
  // ==========================================================================

  private buildPrompt(
    email: ProcessedEmail,
    attachmentText: string,
    threadContext?: ThreadContext,
    includeSubject: boolean = true
  ): string {
    const bodyPreview = email.bodyText.substring(0, AI_CONFIG.maxBodyChars);
    return buildAnalysisPrompt(
      email.subject,
      bodyPreview,
      attachmentText,
      email.receivedAt,
      threadContext,
      includeSubject
    );
  }

  private async callAnthropic(prompt: string): Promise<Anthropic.Message> {
    return await this.anthropic.messages.create({
      model: AI_CONFIG.model,
      max_tokens: AI_CONFIG.maxTokens,
      tools: [ANALYZE_TOOL_SCHEMA],
      tool_choice: { type: 'tool', name: 'analyze_freight_communication' },
      messages: [{ role: 'user', content: prompt }],
    });
  }

  private parseResponse(response: Anthropic.Message, emailDate?: Date): ShippingAnalysis {
    const toolUse = response.content.find((c) => c.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('No tool use in AI response');
    }

    // Normalize AI response BEFORE Zod validation
    // This fixes common enum mistakes like 'vgm' → 'vgm_confirmation'
    const normalizedInput = normalizeAiResponse(toolUse.input as Record<string, unknown>);

    // Parse the normalized response
    const parsed = analyzeShippingCommunicationSchema.parse(normalizedInput);

    // Validate and correct dates using 3-layer defense
    // Layer 1: Year range (2024-2028)
    // Layer 2: Field-specific rules (LFD only from arrival docs)
    // Layer 3: Contextual validation (ETD < ETA < LFD)
    const validatedDates = validateExtractedDates(
      {
        etd: parsed.etd,
        eta: parsed.eta,
        si_cutoff: parsed.si_cutoff,
        vgm_cutoff: parsed.vgm_cutoff,
        cargo_cutoff: parsed.cargo_cutoff,
        doc_cutoff: parsed.doc_cutoff,
        last_free_day: parsed.last_free_day,
        action_deadline: parsed.action_deadline,
      },
      emailDate,
      parsed.document_type // Pass document type for field-specific validation
    );

    // Check extraction quality - log warning if expected dates missing
    const { missing, coverage } = checkExpectedDates(parsed.document_type, validatedDates);
    if (missing.length > 0 && coverage < 80) {
      // Low coverage for key doc types is worth investigating
      console.warn(
        `[AiAnalyzer] Low date coverage (${coverage}%) for ${parsed.document_type}: missing ${missing.join(', ')}`
      );
    }

    // Return with validated dates (convert undefined to null for type safety)
    return {
      ...parsed,
      etd: validatedDates.etd ?? null,
      eta: validatedDates.eta ?? null,
      si_cutoff: validatedDates.si_cutoff ?? null,
      vgm_cutoff: validatedDates.vgm_cutoff ?? null,
      cargo_cutoff: validatedDates.cargo_cutoff ?? null,
      doc_cutoff: validatedDates.doc_cutoff ?? null,
      last_free_day: validatedDates.last_free_day ?? null,
      action_deadline: validatedDates.action_deadline ?? null,
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createAiAnalyzer(): IAiAnalyzer {
  return new AiAnalyzer();
}
