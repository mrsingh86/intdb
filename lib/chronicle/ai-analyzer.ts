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
} from './prompts/freight-forwarder.prompt';

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
   */
  async analyze(
    email: ProcessedEmail,
    attachmentText: string,
    threadContext?: ThreadContext
  ): Promise<ShippingAnalysis> {
    const prompt = this.buildPrompt(email, attachmentText, threadContext);
    const response = await this.callAnthropic(prompt);
    return this.parseResponse(response, email.receivedAt);
  }

  // ==========================================================================
  // PRIVATE HELPERS - Each < 20 lines
  // ==========================================================================

  private buildPrompt(
    email: ProcessedEmail,
    attachmentText: string,
    threadContext?: ThreadContext
  ): string {
    const bodyPreview = email.bodyText.substring(0, AI_CONFIG.maxBodyChars);
    return buildAnalysisPrompt(
      email.subject,
      bodyPreview,
      attachmentText,
      email.receivedAt,
      threadContext
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

    // Parse the AI response
    const parsed = analyzeShippingCommunicationSchema.parse(toolUse.input);

    // Validate and correct dates
    const validatedDates = validateExtractedDates(
      {
        etd: parsed.etd,
        eta: parsed.eta,
        si_cutoff: parsed.si_cutoff,
        vgm_cutoff: parsed.vgm_cutoff,
        cargo_cutoff: parsed.cargo_cutoff,
        action_deadline: parsed.action_deadline,
      },
      emailDate
    );

    // Return with validated dates (convert undefined to null for type safety)
    return {
      ...parsed,
      etd: validatedDates.etd ?? null,
      eta: validatedDates.eta ?? null,
      si_cutoff: validatedDates.si_cutoff ?? null,
      vgm_cutoff: validatedDates.vgm_cutoff ?? null,
      cargo_cutoff: validatedDates.cargo_cutoff ?? null,
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
