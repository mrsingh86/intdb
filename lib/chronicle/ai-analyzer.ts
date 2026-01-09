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
import { ProcessedEmail, ShippingAnalysis, analyzeShippingCommunicationSchema } from './types';
import {
  AI_CONFIG,
  ANALYZE_TOOL_SCHEMA,
  buildAnalysisPrompt,
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
   */
  async analyze(email: ProcessedEmail, attachmentText: string): Promise<ShippingAnalysis> {
    const prompt = this.buildPrompt(email, attachmentText);
    const response = await this.callAnthropic(prompt);
    return this.parseResponse(response);
  }

  // ==========================================================================
  // PRIVATE HELPERS - Each < 20 lines
  // ==========================================================================

  private buildPrompt(email: ProcessedEmail, attachmentText: string): string {
    const bodyPreview = email.bodyText.substring(0, AI_CONFIG.maxBodyChars);
    return buildAnalysisPrompt(email.subject, bodyPreview, attachmentText);
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

  private parseResponse(response: Anthropic.Message): ShippingAnalysis {
    const toolUse = response.content.find((c) => c.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('No tool use in AI response');
    }
    return analyzeShippingCommunicationSchema.parse(toolUse.input);
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createAiAnalyzer(): IAiAnalyzer {
  return new AiAnalyzer();
}
