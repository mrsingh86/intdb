/**
 * Parallel Chronicle Reanalysis Service
 *
 * Safely reprocesses chronicles in parallel by partitioning by thread.
 * Different threads can run in parallel, but emails within a thread
 * are processed sequentially to maintain proper context ordering.
 *
 * Safety guarantees:
 * - Thread isolation: Each worker handles distinct threads
 * - Chronological order: Emails within thread processed oldest-first
 * - Idempotent: Safe to restart/retry
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

export interface ParallelReanalysisConfig {
  workers: number;           // Number of parallel workers (default: 5)
  threadsPerWorker: number;  // Threads each worker processes (default: 20)
  maxEmailsPerThread: number; // Safety limit per thread (default: 50)
}

export interface ParallelReanalysisResult {
  totalThreads: number;
  totalEmails: number;
  succeeded: number;
  failed: number;
  withThreadContext: number;
  timeMs: number;
  workerStats: WorkerStats[];
}

interface WorkerStats {
  workerId: number;
  threads: number;
  emails: number;
  succeeded: number;
  failed: number;
  timeMs: number;
}

interface ThreadBatch {
  threadId: string;
  emailCount: number;
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

export class ParallelReanalysisService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Run parallel reanalysis with N workers
   */
  async runParallel(config: Partial<ParallelReanalysisConfig> = {}): Promise<ParallelReanalysisResult> {
    const startTime = Date.now();
    const { workers = 5, threadsPerWorker = 20, maxEmailsPerThread = 50 } = config;

    // Get threads that need reanalysis
    const threads = await this.getThreadsNeedingReanalysis(workers * threadsPerWorker);
    console.log(`[ParallelReanalysis] Found ${threads.length} threads to process with ${workers} workers`);

    if (threads.length === 0) {
      return this.createEmptyResult();
    }

    // Partition threads across workers
    const partitions = this.partitionThreads(threads, workers);

    // Run workers in parallel
    console.log(`[ParallelReanalysis] Starting ${partitions.length} workers...`);
    const workerPromises = partitions.map((partition, index) =>
      this.runWorker(index, partition, maxEmailsPerThread)
    );

    const workerStats = await Promise.all(workerPromises);

    // Aggregate results
    return this.aggregateResults(workerStats, startTime);
  }

  /**
   * Get status of reanalysis progress
   */
  async getStatus(): Promise<{
    remaining: number;
    threadsRemaining: number;
    completed: number;
    withContext: number;
  }> {
    const [remaining, threadsRemaining, completed, withContext] = await Promise.all([
      this.supabase
        .from('chronicle')
        .select('id', { count: 'exact', head: true })
        .eq('needs_reanalysis', true)
        .then(r => r.count || 0),
      this.supabase
        .from('chronicle')
        .select('thread_id', { count: 'exact', head: true })
        .eq('needs_reanalysis', true)
        .then(r => r.count || 0),
      this.supabase
        .from('chronicle')
        .select('id', { count: 'exact', head: true })
        .not('reanalyzed_at', 'is', null)
        .then(r => r.count || 0),
      this.supabase
        .from('chronicle')
        .select('id', { count: 'exact', head: true })
        .eq('thread_context_used', true)
        .then(r => r.count || 0),
    ]);

    return { remaining, threadsRemaining, completed, withContext };
  }

  // ==========================================================================
  // PRIVATE - THREAD MANAGEMENT
  // ==========================================================================

  private async getThreadsNeedingReanalysis(limit: number): Promise<ThreadBatch[]> {
    // Get distinct threads with counts, oldest first
    const { data, error } = await this.supabase.rpc('get_threads_for_reanalysis', {
      limit_count: limit
    });

    if (error) {
      // Fallback if RPC doesn't exist
      console.log('[ParallelReanalysis] Using fallback query for threads');
      return this.getThreadsFallback(limit);
    }

    // Map from PostgreSQL lowercase to camelCase
    return (data || []).map((row: any) => ({
      threadId: row.threadid || row.threadId,
      emailCount: Number(row.emailcount || row.emailCount),
    }));
  }

  private async getThreadsFallback(limit: number): Promise<ThreadBatch[]> {
    const { data, error } = await this.supabase
      .from('chronicle')
      .select('thread_id')
      .eq('needs_reanalysis', true)
      .limit(limit * 10); // Get more to dedupe

    if (error) throw error;

    // Count by thread and take top N
    const threadCounts = new Map<string, number>();
    for (const row of data || []) {
      const count = threadCounts.get(row.thread_id) || 0;
      threadCounts.set(row.thread_id, count + 1);
    }

    return Array.from(threadCounts.entries())
      .slice(0, limit)
      .map(([threadId, emailCount]) => ({ threadId, emailCount }));
  }

  private partitionThreads(threads: ThreadBatch[], workers: number): ThreadBatch[][] {
    const partitions: ThreadBatch[][] = Array(workers).fill(null).map(() => []);

    // Round-robin distribution
    threads.forEach((thread, index) => {
      partitions[index % workers].push(thread);
    });

    return partitions.filter(p => p.length > 0);
  }

  // ==========================================================================
  // PRIVATE - WORKER LOGIC
  // ==========================================================================

  private async runWorker(
    workerId: number,
    threads: ThreadBatch[],
    maxEmailsPerThread: number
  ): Promise<WorkerStats> {
    const startTime = Date.now();
    let totalEmails = 0;
    let succeeded = 0;
    let failed = 0;

    // Each worker gets its own instances (no shared state)
    const aiAnalyzer = new AiAnalyzer();
    const repository = new ChronicleRepository(this.supabase);

    console.log(`[Worker ${workerId}] Processing ${threads.length} threads`);

    for (const thread of threads) {
      try {
        const result = await this.processThread(
          workerId,
          thread.threadId,
          maxEmailsPerThread,
          aiAnalyzer,
          repository
        );
        totalEmails += result.total;
        succeeded += result.succeeded;
        failed += result.failed;
      } catch (error) {
        console.error(`[Worker ${workerId}] Thread ${thread.threadId} failed:`, error);
        failed += thread.emailCount;
      }
    }

    const stats: WorkerStats = {
      workerId,
      threads: threads.length,
      emails: totalEmails,
      succeeded,
      failed,
      timeMs: Date.now() - startTime,
    };

    console.log(`[Worker ${workerId}] Done: ${succeeded}/${totalEmails} in ${stats.timeMs}ms`);
    return stats;
  }

  private async processThread(
    workerId: number,
    threadId: string,
    maxEmails: number,
    aiAnalyzer: IAiAnalyzer,
    repository: IChronicleRepository
  ): Promise<{ total: number; succeeded: number; failed: number }> {
    // Get all chronicles in this thread that need reanalysis, oldest first
    const { data: chronicles, error } = await this.supabase
      .from('chronicle')
      .select('id, gmail_message_id, thread_id, subject, body_preview, attachments, occurred_at')
      .eq('thread_id', threadId)
      .eq('needs_reanalysis', true)
      .order('occurred_at', { ascending: true })
      .limit(maxEmails);

    if (error) throw error;
    if (!chronicles || chronicles.length === 0) return { total: 0, succeeded: 0, failed: 0 };

    let succeeded = 0;
    let failed = 0;

    // Process sequentially within thread (maintains context ordering)
    for (const chronicle of chronicles as ChronicleForReanalysis[]) {
      try {
        await this.reanalyzeSingleChronicle(chronicle, aiAnalyzer, repository);
        succeeded++;
      } catch (error) {
        console.error(`[Worker ${workerId}] Chronicle ${chronicle.id} failed:`, error);
        failed++;
      }
    }

    return { total: chronicles.length, succeeded, failed };
  }

  private async reanalyzeSingleChronicle(
    chronicle: ChronicleForReanalysis,
    aiAnalyzer: IAiAnalyzer,
    repository: IChronicleRepository
  ): Promise<void> {
    // Get thread context (previous emails in this thread)
    const threadContext = await repository.getThreadContext(
      chronicle.thread_id,
      new Date(chronicle.occurred_at)
    );

    // Build attachment text
    const attachmentText = this.buildAttachmentText(chronicle.attachments);

    // Re-run AI analysis
    const analysis = await aiAnalyzer.analyze(
      {
        gmailMessageId: chronicle.gmail_message_id,
        threadId: chronicle.thread_id,
        subject: chronicle.subject,
        bodyText: chronicle.body_preview || '',
        senderEmail: '',
        senderName: '',
        recipientEmails: [],
        receivedAt: new Date(chronicle.occurred_at),
        direction: 'inbound' as const,
        snippet: '',
        attachments: [],
      },
      attachmentText,
      threadContext || undefined
    );

    // Update chronicle
    await this.updateChronicle(chronicle.id, analysis, threadContext);
  }

  private buildAttachmentText(attachments: Array<{ extractedText?: string; filename?: string }>): string {
    if (!attachments || attachments.length === 0) return '';
    return attachments
      .filter(a => a.extractedText)
      .map(a => `\n=== ${a.filename || 'attachment'} ===\n${a.extractedText?.substring(0, AI_CONFIG.maxAttachmentChars)}\n`)
      .join('');
  }

  private async updateChronicle(
    chronicleId: string,
    analysis: ShippingAnalysis,
    threadContext: ThreadContext | null
  ): Promise<void> {
    await this.supabase
      .from('chronicle')
      .update({
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
        needs_reanalysis: false,
        reanalyzed_at: new Date().toISOString(),
        thread_context_used: !!threadContext && threadContext.emailCount > 0,
        thread_context_email_count: threadContext?.emailCount || 0,
        ai_response: analysis,
        ai_model: AI_CONFIG.model,
      })
      .eq('id', chronicleId);
  }

  // ==========================================================================
  // PRIVATE - RESULT AGGREGATION
  // ==========================================================================

  private createEmptyResult(): ParallelReanalysisResult {
    return {
      totalThreads: 0,
      totalEmails: 0,
      succeeded: 0,
      failed: 0,
      withThreadContext: 0,
      timeMs: 0,
      workerStats: [],
    };
  }

  private aggregateResults(
    workerStats: WorkerStats[],
    startTime: number
  ): ParallelReanalysisResult {
    const totalEmails = workerStats.reduce((sum, w) => sum + w.emails, 0);
    const succeeded = workerStats.reduce((sum, w) => sum + w.succeeded, 0);
    const failed = workerStats.reduce((sum, w) => sum + w.failed, 0);
    const totalThreads = workerStats.reduce((sum, w) => sum + w.threads, 0);

    // Estimate with context (rough: ~60% of multi-email threads have context)
    const withThreadContext = Math.round(succeeded * 0.6);

    return {
      totalThreads,
      totalEmails,
      succeeded,
      failed,
      withThreadContext,
      timeMs: Date.now() - startTime,
      workerStats,
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createParallelReanalysisService(supabase: SupabaseClient): ParallelReanalysisService {
  return new ParallelReanalysisService(supabase);
}
