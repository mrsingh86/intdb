/**
 * Reclassification Logger
 *
 * Detailed logging system for reclassification with:
 * - Batch summaries
 * - Error tracking with probable causes
 * - Performance metrics
 * - Classification change tracking
 */

export interface ClassificationChange {
  chronicleId: string;
  subject: string;
  oldType: string;
  newType: string;
  method: 'pattern' | 'ai';
  confidence: number;
  patternMatched?: string;
  reason?: string;
}

export interface BatchError {
  chronicleId: string;
  subject: string;
  error: string;
  probableCause: string;
  stack?: string;
  timestamp: Date;
}

export interface BatchSummary {
  batchNumber: number;
  startTime: Date;
  endTime: Date;
  durationMs: number;
  processed: number;
  patternMatches: number;
  aiClassifications: number;
  changed: number;
  unchanged: number;
  errors: number;
  changesByCategory: Record<string, { from: Record<string, number>; to: Record<string, number> }>;
}

export interface ReclassificationReport {
  startTime: Date;
  endTime?: Date;
  totalProcessed: number;
  totalChanged: number;
  totalErrors: number;
  totalPatternMatches: number;
  totalAiClassifications: number;
  batches: BatchSummary[];
  topChanges: Array<{ from: string; to: string; count: number }>;
  errors: BatchError[];
  durationMs: number;
}

export class ReclassificationLogger {
  private report: ReclassificationReport;
  private currentBatch: {
    number: number;
    startTime: Date;
    changes: ClassificationChange[];
    errors: BatchError[];
  } | null = null;
  private logToConsole: boolean;
  private logInterval: number;
  private lastLogTime: Date;

  constructor(options: { logToConsole?: boolean; logIntervalMs?: number } = {}) {
    this.logToConsole = options.logToConsole ?? true;
    this.logInterval = options.logIntervalMs ?? 10000; // Log every 10s
    this.lastLogTime = new Date();

    this.report = {
      startTime: new Date(),
      totalProcessed: 0,
      totalChanged: 0,
      totalErrors: 0,
      totalPatternMatches: 0,
      totalAiClassifications: 0,
      batches: [],
      topChanges: [],
      errors: [],
      durationMs: 0,
    };
  }

  startBatch(batchNumber: number): void {
    this.currentBatch = {
      number: batchNumber,
      startTime: new Date(),
      changes: [],
      errors: [],
    };

    if (this.logToConsole) {
      console.log(`\n[Reclassification] ===== BATCH ${batchNumber} STARTED =====`);
    }
  }

  recordChange(change: ClassificationChange): void {
    if (!this.currentBatch) return;

    this.currentBatch.changes.push(change);
    this.report.totalProcessed++;

    if (change.oldType !== change.newType) {
      this.report.totalChanged++;
    }

    if (change.method === 'pattern') {
      this.report.totalPatternMatches++;
    } else {
      this.report.totalAiClassifications++;
    }

    // Periodic progress logging
    if (this.shouldLogProgress()) {
      this.logProgress();
    }
  }

  recordError(chronicleId: string, subject: string, error: Error | string): void {
    if (!this.currentBatch) return;

    const errorMessage = error instanceof Error ? error.message : error;
    const stack = error instanceof Error ? error.stack : undefined;

    const batchError: BatchError = {
      chronicleId,
      subject: subject?.substring(0, 100) || 'Unknown',
      error: errorMessage,
      probableCause: this.determineProbableCause(errorMessage),
      stack,
      timestamp: new Date(),
    };

    this.currentBatch.errors.push(batchError);
    this.report.errors.push(batchError);
    this.report.totalErrors++;

    if (this.logToConsole) {
      console.error(`[Reclassification] ERROR: ${chronicleId.substring(0, 8)} - ${batchError.probableCause}`);
    }
  }

  endBatch(): BatchSummary {
    if (!this.currentBatch) {
      throw new Error('No active batch');
    }

    const endTime = new Date();
    const changes = this.currentBatch.changes;
    const errors = this.currentBatch.errors;

    // Calculate change categories
    const changesByCategory: Record<string, { from: Record<string, number>; to: Record<string, number> }> = {};

    for (const change of changes) {
      if (change.oldType !== change.newType) {
        if (!changesByCategory[change.newType]) {
          changesByCategory[change.newType] = { from: {}, to: {} };
        }
        changesByCategory[change.newType].from[change.oldType] =
          (changesByCategory[change.newType].from[change.oldType] || 0) + 1;
      }
    }

    const summary: BatchSummary = {
      batchNumber: this.currentBatch.number,
      startTime: this.currentBatch.startTime,
      endTime,
      durationMs: endTime.getTime() - this.currentBatch.startTime.getTime(),
      processed: changes.length,
      patternMatches: changes.filter(c => c.method === 'pattern').length,
      aiClassifications: changes.filter(c => c.method === 'ai').length,
      changed: changes.filter(c => c.oldType !== c.newType).length,
      unchanged: changes.filter(c => c.oldType === c.newType).length,
      errors: errors.length,
      changesByCategory,
    };

    this.report.batches.push(summary);

    if (this.logToConsole) {
      this.logBatchSummary(summary);
    }

    this.currentBatch = null;
    return summary;
  }

  finalize(): ReclassificationReport {
    this.report.endTime = new Date();
    this.report.durationMs = this.report.endTime.getTime() - this.report.startTime.getTime();

    // Calculate top changes
    const changeMap = new Map<string, number>();
    for (const batch of this.report.batches) {
      for (const [newType, data] of Object.entries(batch.changesByCategory)) {
        for (const [oldType, count] of Object.entries(data.from)) {
          const key = `${oldType} → ${newType}`;
          changeMap.set(key, (changeMap.get(key) || 0) + count);
        }
      }
    }

    this.report.topChanges = Array.from(changeMap.entries())
      .map(([key, count]) => {
        const [from, to] = key.split(' → ');
        return { from, to, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    if (this.logToConsole) {
      this.logFinalReport();
    }

    return this.report;
  }

  getReport(): ReclassificationReport {
    return this.report;
  }

  private shouldLogProgress(): boolean {
    const now = new Date();
    if (now.getTime() - this.lastLogTime.getTime() > this.logInterval) {
      this.lastLogTime = now;
      return true;
    }
    return false;
  }

  private logProgress(): void {
    const elapsed = (new Date().getTime() - this.report.startTime.getTime()) / 1000;
    const rate = this.report.totalProcessed / elapsed;

    console.log(
      `[Reclassification] Progress: ${this.report.totalProcessed} processed, ` +
      `${this.report.totalChanged} changed, ${this.report.totalErrors} errors ` +
      `(${rate.toFixed(1)}/sec)`
    );
  }

  private logBatchSummary(summary: BatchSummary): void {
    console.log(`\n[Reclassification] ===== BATCH ${summary.batchNumber} COMPLETE =====`);
    console.log(`  Duration: ${summary.durationMs}ms`);
    console.log(`  Processed: ${summary.processed}`);
    console.log(`  Pattern matches: ${summary.patternMatches} (${((summary.patternMatches/summary.processed)*100).toFixed(1)}%)`);
    console.log(`  AI classifications: ${summary.aiClassifications} (${((summary.aiClassifications/summary.processed)*100).toFixed(1)}%)`);
    console.log(`  Changed: ${summary.changed}`);
    console.log(`  Unchanged: ${summary.unchanged}`);
    console.log(`  Errors: ${summary.errors}`);

    if (Object.keys(summary.changesByCategory).length > 0) {
      console.log(`  Top changes:`);
      for (const [newType, data] of Object.entries(summary.changesByCategory).slice(0, 5)) {
        const fromTypes = Object.entries(data.from)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([t, c]) => `${t}(${c})`)
          .join(', ');
        console.log(`    → ${newType}: from ${fromTypes}`);
      }
    }
  }

  private logFinalReport(): void {
    const r = this.report;

    console.log('\n' + '='.repeat(70));
    console.log('           RECLASSIFICATION FINAL REPORT');
    console.log('='.repeat(70));
    console.log(`\nDuration: ${(r.durationMs / 1000).toFixed(1)} seconds`);
    console.log(`Total Processed: ${r.totalProcessed}`);
    console.log(`Total Changed: ${r.totalChanged} (${((r.totalChanged/r.totalProcessed)*100).toFixed(1)}%)`);
    console.log(`Total Errors: ${r.totalErrors}`);
    console.log(`\nClassification Method:`);
    console.log(`  Pattern Matches: ${r.totalPatternMatches} (${((r.totalPatternMatches/r.totalProcessed)*100).toFixed(1)}%)`);
    console.log(`  AI Classifications: ${r.totalAiClassifications} (${((r.totalAiClassifications/r.totalProcessed)*100).toFixed(1)}%)`);

    if (r.topChanges.length > 0) {
      console.log(`\nTop Classification Changes:`);
      for (const change of r.topChanges.slice(0, 10)) {
        console.log(`  ${change.from} → ${change.to}: ${change.count}`);
      }
    }

    if (r.errors.length > 0) {
      console.log(`\nError Summary:`);
      const errorCauses = new Map<string, number>();
      for (const err of r.errors) {
        errorCauses.set(err.probableCause, (errorCauses.get(err.probableCause) || 0) + 1);
      }
      for (const [cause, count] of Array.from(errorCauses.entries()).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${cause}: ${count}`);
      }
    }

    console.log('\n' + '='.repeat(70));
  }

  private determineProbableCause(errorMessage: string): string {
    const msg = errorMessage.toLowerCase();

    if (msg.includes('rate limit') || msg.includes('429')) {
      return 'AI_RATE_LIMIT - Too many requests to Claude API';
    }
    if (msg.includes('timeout') || msg.includes('timed out')) {
      return 'TIMEOUT - Request took too long';
    }
    if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('fetch')) {
      return 'NETWORK_ERROR - Connection issue';
    }
    if (msg.includes('invalid') || msg.includes('parse') || msg.includes('json')) {
      return 'PARSE_ERROR - Invalid response format';
    }
    if (msg.includes('not found') || msg.includes('404')) {
      return 'NOT_FOUND - Record not found';
    }
    if (msg.includes('duplicate') || msg.includes('unique')) {
      return 'DUPLICATE - Duplicate key violation';
    }
    if (msg.includes('permission') || msg.includes('401') || msg.includes('403')) {
      return 'AUTH_ERROR - Permission denied';
    }
    if (msg.includes('token') || msg.includes('context')) {
      return 'AI_TOKEN_LIMIT - Input too large for AI';
    }

    return 'UNKNOWN - ' + errorMessage.substring(0, 50);
  }
}

export function createReclassificationLogger(
  options?: { logToConsole?: boolean; logIntervalMs?: number }
): ReclassificationLogger {
  return new ReclassificationLogger(options);
}
