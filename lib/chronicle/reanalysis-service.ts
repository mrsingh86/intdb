/**
 * Chronicle Reanalysis Service
 *
 * Reprocesses existing chronicles with thread context.
 * Used to upgrade historical data after thread context feature was added.
 *
 * Following CLAUDE.md principles:
 * - Single Responsibility (Principle #3)
 * - Small Functions < 20 lines (Principle #17)
 * - Idempotency (Principle #11)
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { ShippingAnalysis, ThreadContext } from './types';
import { IAiAnalyzer, IChronicleRepository } from './interfaces';
import { AiAnalyzer } from './ai-analyzer';
import { ChronicleRepository } from './chronicle-repository';
import { AI_CONFIG } from './prompts/freight-forwarder.prompt';

// ============================================================================
// TYPES
// ============================================================================

export interface ReanalysisResult {
  chronicleId: string;
  success: boolean;
  threadContextUsed: boolean;
  threadEmailCount: number;
  error?: string;
}

export interface ReanalysisBatchResult {
  total: number;
  succeeded: number;
  failed: number;
  withThreadContext: number;
  timeMs: number;
  results: ReanalysisResult[];
}

interface ChronicleForReanalysis {
  id: string;
  gmail_message_id: string;
  thread_id: string;
  subject: string;
  body_preview: string;
  attachments: Array<{ extractedText?: string; filename?: string }>;
  occurred_at: string;
}

// ============================================================================
// SERVICE IMPLEMENTATION
// ============================================================================

export class ReanalysisService {
  private supabase: SupabaseClient;
  private aiAnalyzer: IAiAnalyzer;
  private repository: IChronicleRepository;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.aiAnalyzer = new AiAnalyzer();
    this.repository = new ChronicleRepository(supabase);
  }

  /**
   * Reanalyze a batch of chronicles that need thread context
   */
  async reanalyzeBatch(batchSize: number = 50): Promise<ReanalysisBatchResult> {
    const startTime = Date.now();

    // Fetch chronicles needing reanalysis (oldest first for proper thread context)
    const chronicles = await this.fetchChroniclesForReanalysis(batchSize);
    console.log(`[Reanalysis] Found ${chronicles.length} chronicles to reanalyze`);

    if (chronicles.length === 0) {
      return this.createEmptyResult();
    }

    const results: ReanalysisResult[] = [];
    for (const chronicle of chronicles) {
      const result = await this.reanalyzeSingle(chronicle);
      results.push(result);

      // Progress logging
      if (results.length % 10 === 0) {
        const succeeded = results.filter(r => r.success).length;
        console.log(`[Reanalysis] Progress: ${results.length}/${chronicles.length} (${succeeded} succeeded)`);
      }
    }

    return this.aggregateResults(results, startTime);
  }

  /**
   * Get count of chronicles remaining for reanalysis
   */
  async getRemainingCount(): Promise<number> {
    const { count, error } = await this.supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .eq('needs_reanalysis', true);

    if (error) throw error;
    return count || 0;
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private async fetchChroniclesForReanalysis(limit: number): Promise<ChronicleForReanalysis[]> {
    const { data, error } = await this.supabase
      .from('chronicle')
      .select('id, gmail_message_id, thread_id, subject, body_preview, attachments, occurred_at')
      .eq('needs_reanalysis', true)
      .order('occurred_at', { ascending: true }) // Oldest first for proper context
      .limit(limit);

    if (error) throw error;
    return (data || []) as ChronicleForReanalysis[];
  }

  private async reanalyzeSingle(chronicle: ChronicleForReanalysis): Promise<ReanalysisResult> {
    try {
      // Get thread context
      const threadContext = await this.repository.getThreadContext(
        chronicle.thread_id,
        new Date(chronicle.occurred_at)
      );

      // Build attachment text from stored extractions
      const attachmentText = this.buildAttachmentText(chronicle.attachments);

      // Re-run AI analysis with thread context
      const analysis = await this.aiAnalyzer.analyze(
        this.buildProcessedEmail(chronicle),
        attachmentText,
        threadContext || undefined
      );

      // Update chronicle with new analysis
      await this.updateChronicleWithAnalysis(chronicle.id, analysis, threadContext);

      return {
        chronicleId: chronicle.id,
        success: true,
        threadContextUsed: !!threadContext && threadContext.emailCount > 0,
        threadEmailCount: threadContext?.emailCount || 0,
      };
    } catch (error) {
      console.error(`[Reanalysis] Failed for ${chronicle.id}:`, error);
      return {
        chronicleId: chronicle.id,
        success: false,
        threadContextUsed: false,
        threadEmailCount: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private buildProcessedEmail(chronicle: ChronicleForReanalysis) {
    return {
      gmailMessageId: chronicle.gmail_message_id,
      threadId: chronicle.thread_id,
      subject: chronicle.subject,
      bodyText: chronicle.body_preview || '',
      senderEmail: '',
      senderName: '',
      receivedAt: new Date(chronicle.occurred_at),
      direction: 'inbound' as const,
      snippet: '',
      attachments: [],
    };
  }

  private buildAttachmentText(attachments: Array<{ extractedText?: string; filename?: string }>): string {
    if (!attachments || attachments.length === 0) return '';

    return attachments
      .filter(a => a.extractedText)
      .map(a => `\n=== ${a.filename || 'attachment'} ===\n${a.extractedText?.substring(0, AI_CONFIG.maxAttachmentChars)}\n`)
      .join('');
  }

  private async updateChronicleWithAnalysis(
    chronicleId: string,
    analysis: ShippingAnalysis,
    threadContext: ThreadContext | null
  ): Promise<void> {
    const { error } = await this.supabase
      .from('chronicle')
      .update({
        // Update AI-generated fields
        summary: analysis.summary,
        document_type: analysis.document_type,
        message_type: analysis.message_type,
        sentiment: analysis.sentiment,
        has_action: analysis.has_action,
        action_description: analysis.action_description || null,
        action_owner: analysis.action_owner || null,
        action_deadline: analysis.action_deadline || null,
        action_priority: analysis.action_priority || null,
        has_issue: analysis.has_issue || false,
        issue_type: analysis.issue_type || null,
        issue_description: analysis.issue_description || null,

        // Mark as reanalyzed
        needs_reanalysis: false,
        reanalyzed_at: new Date().toISOString(),
        thread_context_used: !!threadContext && threadContext.emailCount > 0,
        thread_context_email_count: threadContext?.emailCount || 0,

        // Update AI response
        ai_response: analysis,
        ai_model: AI_CONFIG.model,
      })
      .eq('id', chronicleId);

    if (error) throw error;
  }

  private createEmptyResult(): ReanalysisBatchResult {
    return {
      total: 0,
      succeeded: 0,
      failed: 0,
      withThreadContext: 0,
      timeMs: 0,
      results: [],
    };
  }

  private aggregateResults(results: ReanalysisResult[], startTime: number): ReanalysisBatchResult {
    return {
      total: results.length,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      withThreadContext: results.filter(r => r.threadContextUsed).length,
      timeMs: Date.now() - startTime,
      results,
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createReanalysisService(supabase: SupabaseClient): ReanalysisService {
  return new ReanalysisService(supabase);
}
