/**
 * Chronicle Logger
 *
 * Comprehensive logging system for:
 * 1. Software Engineer - Debug, performance, errors
 * 2. Freight Forwarder - Shipment journeys, business events
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

export type LogStage =
  | 'gmail_fetch'
  | 'email_parse'
  | 'attachment_download'
  | 'pdf_extract'
  | 'ocr_extract'
  | 'ai_analysis'
  | 'validation'
  | 'db_save'
  | 'linking'
  | 'stage_detection';

export type ErrorSeverity = 'warning' | 'error' | 'critical';

export type ShipmentStage =
  | 'PENDING'
  | 'REQUESTED'
  | 'BOOKED'
  | 'SI_STAGE'
  | 'DRAFT_BL'
  | 'BL_ISSUED'
  | 'ARRIVED'
  | 'DELIVERED'
  | 'CANCELLED';

export type EventType =
  | 'created'
  | 'stage_change'
  | 'document_received'
  | 'action_detected'
  | 'issue_flagged'
  | 'party_communication';

interface StageMetrics {
  successCount: number;
  failureCount: number;
  skipCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
  details: Record<string, number>;
}

interface ErrorSummary {
  [errorType: string]: {
    count: number;
    stage: LogStage;
    severity: ErrorSeverity;
    lastMessage: string;
  };
}

interface RunProgress {
  emailsTotal: number;
  emailsProcessed: number;
  emailsSucceeded: number;
  emailsFailed: number;
  emailsSkipped: number;
  shipmentsCreated: number;
  shipmentsUpdated: number;
  emailsLinked: number;
  stageChanges: number;
  actionsDetected: number;
  issuesDetected: number;
}

// ============================================================================
// CHRONICLE LOGGER
// ============================================================================

export class ChronicleLogger {
  private supabase: SupabaseClient;
  private runId: string | null = null;
  private startTime: number = 0;
  private lastProgressTime: number = 0;

  // In-memory metrics (flushed to DB periodically)
  private stageMetrics: Map<LogStage, StageMetrics> = new Map();
  private errorSummary: ErrorSummary = {};
  private progress: RunProgress = {
    emailsTotal: 0,
    emailsProcessed: 0,
    emailsSucceeded: 0,
    emailsFailed: 0,
    emailsSkipped: 0,
    shipmentsCreated: 0,
    shipmentsUpdated: 0,
    emailsLinked: 0,
    stageChanges: 0,
    actionsDetected: 0,
    issuesDetected: 0,
  };

  // Batch errors for bulk insert
  private errorBatch: Array<{
    gmail_message_id: string | null;
    stage: LogStage;
    error_type: string;
    error_message: string;
    stack_trace: string | null;
    severity: ErrorSeverity;
    context: Record<string, unknown>;
    is_recoverable: boolean;
  }> = [];

  // Batch shipment events
  private eventBatch: Array<{
    shipment_id: string;
    chronicle_id: string | null;
    event_type: EventType;
    event_subtype: string | null;
    event_description: string;
    previous_stage: string | null;
    new_stage: string | null;
    action_owner: string | null;
    action_deadline: string | null;
    action_priority: string | null;
    issue_type: string | null;
    issue_severity: string | null;
    document_type: string | null;
    from_party: string | null;
    occurred_at: string;
  }> = [];

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  // ==========================================================================
  // RUN LIFECYCLE
  // ==========================================================================

  async startRun(config: {
    queryAfter?: Date;
    queryBefore?: Date;
    maxResults?: number;
    emailsTotal: number;
  }): Promise<string> {
    this.startTime = Date.now();
    this.lastProgressTime = Date.now();
    this.resetMetrics();
    this.progress.emailsTotal = config.emailsTotal;

    const { data, error } = await this.supabase
      .from('chronicle_runs')
      .insert({
        status: 'running',
        query_after: config.queryAfter?.toISOString(),
        query_before: config.queryBefore?.toISOString(),
        max_results: config.maxResults,
        emails_total: config.emailsTotal,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[Logger] Failed to create run:', error);
      throw error;
    }

    this.runId = data.id;
    this.printRunStart(config);
    return data.id;
  }

  async endRun(status: 'completed' | 'failed' | 'cancelled'): Promise<void> {
    if (!this.runId) return;

    await this.flushAll();

    const totalTimeMs = Date.now() - this.startTime;
    const avgTimePerEmail =
      this.progress.emailsProcessed > 0
        ? Math.round(totalTimeMs / this.progress.emailsProcessed)
        : 0;

    await this.supabase
      .from('chronicle_runs')
      .update({
        status,
        completed_at: new Date().toISOString(),
        emails_processed: this.progress.emailsProcessed,
        emails_succeeded: this.progress.emailsSucceeded,
        emails_failed: this.progress.emailsFailed,
        emails_skipped: this.progress.emailsSkipped,
        shipments_created: this.progress.shipmentsCreated,
        shipments_updated: this.progress.shipmentsUpdated,
        emails_linked: this.progress.emailsLinked,
        stage_changes: this.progress.stageChanges,
        actions_detected: this.progress.actionsDetected,
        issues_detected: this.progress.issuesDetected,
        total_time_ms: totalTimeMs,
        avg_time_per_email_ms: avgTimePerEmail,
        error_summary: this.errorSummary,
      })
      .eq('id', this.runId);

    this.printRunEnd(status, totalTimeMs);
  }

  // ==========================================================================
  // STAGE LOGGING
  // ==========================================================================

  logStageStart(stage: LogStage): number {
    return Date.now();
  }

  logStageSuccess(
    stage: LogStage,
    startTime: number,
    details?: Record<string, number>
  ): void {
    const duration = Date.now() - startTime;
    this.updateStageMetrics(stage, 'success', duration, details);
  }

  logStageFailure(
    stage: LogStage,
    startTime: number,
    error: Error,
    context: {
      gmailMessageId?: string;
      subject?: string;
      sender?: string;
      attachmentName?: string;
    } = {},
    isRecoverable: boolean = false
  ): void {
    const duration = Date.now() - startTime;
    this.updateStageMetrics(stage, 'failure', duration);

    const errorType = this.classifyError(error, stage);
    const severity = this.determineSeverity(errorType, stage);

    // Add to error batch
    this.errorBatch.push({
      gmail_message_id: context.gmailMessageId || null,
      stage,
      error_type: errorType,
      error_message: error.message,
      stack_trace: error.stack || null,
      severity,
      context: context as Record<string, unknown>,
      is_recoverable: isRecoverable,
    });

    // Update error summary
    if (!this.errorSummary[errorType]) {
      this.errorSummary[errorType] = {
        count: 0,
        stage,
        severity,
        lastMessage: '',
      };
    }
    this.errorSummary[errorType].count++;
    this.errorSummary[errorType].lastMessage = error.message.substring(0, 200);

    // Log to console for immediate visibility
    if (severity === 'critical') {
      console.error(`[CRITICAL] ${stage}: ${errorType} - ${error.message}`);
    }
  }

  logStageSkip(stage: LogStage, reason: string): void {
    this.updateStageMetrics(stage, 'skip', 0);
  }

  // ==========================================================================
  // EMAIL PROCESSING
  // ==========================================================================

  logEmailProcessed(success: boolean, skipped: boolean = false): void {
    this.progress.emailsProcessed++;
    if (skipped) {
      this.progress.emailsSkipped++;
    } else if (success) {
      this.progress.emailsSucceeded++;
    } else {
      this.progress.emailsFailed++;
    }
  }

  // ==========================================================================
  // SHIPMENT EVENTS
  // ==========================================================================

  logShipmentCreated(
    shipmentId: string,
    chronicleId: string | null,
    documentType: string,
    occurredAt: Date
  ): void {
    this.progress.shipmentsCreated++;
    this.eventBatch.push({
      shipment_id: shipmentId,
      chronicle_id: chronicleId,
      event_type: 'created',
      event_subtype: null,
      event_description: `Shipment created from ${documentType}`,
      previous_stage: null,
      new_stage: 'PENDING',
      action_owner: null,
      action_deadline: null,
      action_priority: null,
      issue_type: null,
      issue_severity: null,
      document_type: documentType,
      from_party: null,
      occurred_at: occurredAt.toISOString(),
    });
  }

  logStageChange(
    shipmentId: string,
    chronicleId: string | null,
    previousStage: ShipmentStage,
    newStage: ShipmentStage,
    documentType: string,
    occurredAt: Date
  ): void {
    this.progress.stageChanges++;
    this.eventBatch.push({
      shipment_id: shipmentId,
      chronicle_id: chronicleId,
      event_type: 'stage_change',
      event_subtype: null,
      event_description: `Stage changed from ${previousStage} to ${newStage}`,
      previous_stage: previousStage,
      new_stage: newStage,
      action_owner: null,
      action_deadline: null,
      action_priority: null,
      issue_type: null,
      issue_severity: null,
      document_type: documentType,
      from_party: null,
      occurred_at: occurredAt.toISOString(),
    });

    console.log(
      `[STAGE] ${shipmentId.substring(0, 8)}: ${previousStage} -> ${newStage} (${documentType})`
    );
  }

  logActionDetected(
    shipmentId: string,
    chronicleId: string,
    actionOwner: string | null,
    actionDeadline: string | null,
    actionPriority: string | null,
    description: string,
    documentType: string,
    occurredAt: Date
  ): void {
    this.progress.actionsDetected++;
    this.eventBatch.push({
      shipment_id: shipmentId,
      chronicle_id: chronicleId,
      event_type: 'action_detected',
      event_subtype: actionOwner,
      event_description: description,
      previous_stage: null,
      new_stage: null,
      action_owner: actionOwner,
      action_deadline: actionDeadline,
      action_priority: actionPriority,
      issue_type: null,
      issue_severity: null,
      document_type: documentType,
      from_party: null,
      occurred_at: occurredAt.toISOString(),
    });
  }

  logIssueDetected(
    shipmentId: string,
    chronicleId: string,
    issueType: string,
    description: string,
    documentType: string,
    occurredAt: Date
  ): void {
    this.progress.issuesDetected++;
    const severity = this.determineIssueSeverity(issueType);
    this.eventBatch.push({
      shipment_id: shipmentId,
      chronicle_id: chronicleId,
      event_type: 'issue_flagged',
      event_subtype: issueType,
      event_description: description,
      previous_stage: null,
      new_stage: null,
      action_owner: null,
      action_deadline: null,
      action_priority: null,
      issue_type: issueType,
      issue_severity: severity,
      document_type: documentType,
      from_party: null,
      occurred_at: occurredAt.toISOString(),
    });
  }

  logEmailLinked(shipmentId: string): void {
    this.progress.emailsLinked++;
  }

  // ==========================================================================
  // PROGRESS REPORTING
  // ==========================================================================

  async checkAndReportProgress(forceReport: boolean = false): Promise<void> {
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    if (!forceReport && now - this.lastProgressTime < fiveMinutes) {
      return;
    }

    this.lastProgressTime = now;
    await this.flushAll();
    this.printProgressReport();
  }

  private printRunStart(config: { emailsTotal: number }): void {
    console.log('\n' + '='.repeat(70));
    console.log('  CHRONICLE PROCESSING STARTED');
    console.log('='.repeat(70));
    console.log(`  Run ID: ${this.runId}`);
    console.log(`  Emails to process: ${config.emailsTotal}`);
    console.log(`  Started at: ${new Date().toLocaleTimeString()}`);
    console.log('='.repeat(70) + '\n');
  }

  private printProgressReport(): void {
    const elapsed = Math.round((Date.now() - this.startTime) / 1000);
    const progressPct =
      this.progress.emailsTotal > 0
        ? Math.round(
            (this.progress.emailsProcessed / this.progress.emailsTotal) * 100
          )
        : 0;

    const remaining =
      this.progress.emailsTotal - this.progress.emailsProcessed;
    const rate =
      elapsed > 0 ? this.progress.emailsProcessed / elapsed : 0;
    const etaSeconds = rate > 0 ? Math.round(remaining / rate) : 0;
    const etaMinutes = Math.round(etaSeconds / 60);

    console.log('\n' + '╔' + '═'.repeat(68) + '╗');
    console.log(
      '║  CHRONICLE PROGRESS - ' +
        new Date().toLocaleTimeString().padEnd(45) +
        '║'
    );
    console.log('╠' + '═'.repeat(68) + '╣');

    // Progress bar
    const barWidth = 30;
    const filled = Math.round((progressPct / 100) * barWidth);
    const bar = '█'.repeat(filled) + '░'.repeat(barWidth - filled);
    console.log(
      `║  EMAILS: ${this.progress.emailsProcessed}/${this.progress.emailsTotal} (${progressPct}%) ${bar} ETA: ${etaMinutes}m`.padEnd(
        69
      ) + '║'
    );
    console.log('║' + '─'.repeat(68) + '║');
    console.log(
      `║  ✓ Succeeded: ${this.progress.emailsSucceeded}`.padEnd(35) +
        `✗ Failed: ${this.progress.emailsFailed}`.padEnd(20) +
        `○ Skipped: ${this.progress.emailsSkipped}`.padEnd(14) +
        '║'
    );

    console.log('╠' + '═'.repeat(68) + '╣');
    console.log('║  PIPELINE HEALTH:'.padEnd(69) + '║');

    // Stage metrics
    for (const [stage, metrics] of this.stageMetrics) {
      const total = metrics.successCount + metrics.failureCount;
      const successRate =
        total > 0 ? Math.round((metrics.successCount / total) * 100) : 100;
      const stageBar = this.createMiniBar(successRate);
      const avgMs =
        metrics.successCount > 0
          ? Math.round(metrics.totalDurationMs / metrics.successCount)
          : 0;

      let detail = '';
      if (stage === 'pdf_extract' && metrics.details.ocr_count) {
        detail = ` (${metrics.details.ocr_count} OCR)`;
      } else if (stage === 'linking') {
        detail = ` (${this.progress.emailsLinked} linked)`;
      }

      console.log(
        `║  ${stage.padEnd(18)} ${stageBar} ${successRate}% OK ${avgMs}ms avg${detail}`.padEnd(
          69
        ) + '║'
      );
    }

    console.log('╠' + '═'.repeat(68) + '╣');
    console.log('║  SHIPMENTS:'.padEnd(69) + '║');
    console.log(
      `║  Created: ${this.progress.shipmentsCreated}  |  Linked: ${this.progress.emailsLinked}  |  Stage Changes: ${this.progress.stageChanges}`.padEnd(
        69
      ) + '║'
    );
    console.log(
      `║  Actions: ${this.progress.actionsDetected}  |  Issues: ${this.progress.issuesDetected}`.padEnd(
        69
      ) + '║'
    );

    // Errors
    const errorCount = Object.values(this.errorSummary).reduce(
      (sum, e) => sum + e.count,
      0
    );
    if (errorCount > 0) {
      console.log('╠' + '═'.repeat(68) + '╣');
      console.log(`║  ERRORS (${errorCount} total):`.padEnd(69) + '║');
      for (const [type, info] of Object.entries(this.errorSummary).slice(
        0,
        5
      )) {
        console.log(
          `║  • ${type}: ${info.count} (${info.stage})`.padEnd(69) + '║'
        );
      }
    }

    console.log('╚' + '═'.repeat(68) + '╝\n');
  }

  private printRunEnd(status: string, totalTimeMs: number): void {
    const minutes = Math.round(totalTimeMs / 60000);
    const seconds = Math.round((totalTimeMs % 60000) / 1000);

    console.log('\n' + '='.repeat(70));
    console.log(`  CHRONICLE PROCESSING ${status.toUpperCase()}`);
    console.log('='.repeat(70));
    console.log(`  Total time: ${minutes}m ${seconds}s`);
    console.log(`  Emails processed: ${this.progress.emailsProcessed}`);
    console.log(
      `  Success rate: ${Math.round((this.progress.emailsSucceeded / Math.max(1, this.progress.emailsProcessed)) * 100)}%`
    );
    console.log(`  Shipments created: ${this.progress.shipmentsCreated}`);
    console.log(`  Emails linked: ${this.progress.emailsLinked}`);
    console.log(`  Stage changes: ${this.progress.stageChanges}`);
    console.log('='.repeat(70) + '\n');
  }

  private createMiniBar(pct: number): string {
    const width = 12;
    const filled = Math.round((pct / 100) * width);
    return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
  }

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  private resetMetrics(): void {
    this.stageMetrics.clear();
    this.errorSummary = {};
    this.errorBatch = [];
    this.eventBatch = [];
    this.progress = {
      emailsTotal: 0,
      emailsProcessed: 0,
      emailsSucceeded: 0,
      emailsFailed: 0,
      emailsSkipped: 0,
      shipmentsCreated: 0,
      shipmentsUpdated: 0,
      emailsLinked: 0,
      stageChanges: 0,
      actionsDetected: 0,
      issuesDetected: 0,
    };
  }

  private updateStageMetrics(
    stage: LogStage,
    result: 'success' | 'failure' | 'skip',
    durationMs: number,
    details?: Record<string, number>
  ): void {
    if (!this.stageMetrics.has(stage)) {
      this.stageMetrics.set(stage, {
        successCount: 0,
        failureCount: 0,
        skipCount: 0,
        totalDurationMs: 0,
        maxDurationMs: 0,
        details: {},
      });
    }

    const metrics = this.stageMetrics.get(stage)!;
    if (result === 'success') {
      metrics.successCount++;
      metrics.totalDurationMs += durationMs;
      metrics.maxDurationMs = Math.max(metrics.maxDurationMs, durationMs);
    } else if (result === 'failure') {
      metrics.failureCount++;
    } else {
      metrics.skipCount++;
    }

    // Merge details
    if (details) {
      for (const [key, value] of Object.entries(details)) {
        metrics.details[key] = (metrics.details[key] || 0) + value;
      }
    }
  }

  private classifyError(error: Error, stage: LogStage): string {
    const msg = error.message.toLowerCase();

    // Network errors
    if (msg.includes('econnrefused') || msg.includes('network'))
      return 'NETWORK_ERROR';
    if (msg.includes('timeout')) return 'TIMEOUT';
    if (msg.includes('rate limit')) return 'RATE_LIMIT';

    // Auth errors
    if (msg.includes('auth') || msg.includes('401') || msg.includes('403'))
      return 'AUTH_ERROR';

    // PDF errors
    if (msg.includes('pdf') && msg.includes('password'))
      return 'PDF_PASSWORD_PROTECTED';
    if (msg.includes('pdf') || msg.includes('parse'))
      return 'PDF_PARSE_ERROR';

    // AI errors
    if (stage === 'ai_analysis') {
      if (msg.includes('json')) return 'AI_PARSE_ERROR';
      if (msg.includes('token')) return 'AI_TOKEN_LIMIT';
      return 'AI_ERROR';
    }

    // DB errors
    if (msg.includes('constraint') || msg.includes('duplicate'))
      return 'DB_CONSTRAINT';
    if (msg.includes('connection')) return 'DB_CONNECTION';

    // Stage-specific defaults
    return `${stage.toUpperCase()}_ERROR`;
  }

  private determineSeverity(
    errorType: string,
    stage: LogStage
  ): ErrorSeverity {
    // Critical - stop the run
    if (
      ['AUTH_ERROR', 'DB_CONNECTION', 'NETWORK_ERROR'].includes(errorType)
    ) {
      return 'critical';
    }

    // Warning - continue but track
    if (
      ['PDF_PASSWORD_PROTECTED', 'RATE_LIMIT', 'TIMEOUT'].includes(errorType)
    ) {
      return 'warning';
    }

    return 'error';
  }

  private determineIssueSeverity(
    issueType: string
  ): 'low' | 'medium' | 'high' | 'critical' {
    const critical = ['damage', 'hold', 'shortage'];
    const high = ['delay', 'rollover', 'documentation'];
    const medium = ['detention', 'demurrage', 'capacity'];

    if (critical.includes(issueType)) return 'critical';
    if (high.includes(issueType)) return 'high';
    if (medium.includes(issueType)) return 'medium';
    return 'low';
  }

  // ==========================================================================
  // FLUSH TO DATABASE
  // ==========================================================================

  private async flushAll(): Promise<void> {
    await Promise.all([
      this.flushStageMetrics(),
      this.flushErrors(),
      this.flushEvents(),
      this.updateRunProgress(),
    ]);
  }

  private async flushStageMetrics(): Promise<void> {
    if (!this.runId || this.stageMetrics.size === 0) return;

    const records = Array.from(this.stageMetrics.entries()).map(
      ([stage, metrics]) => ({
        run_id: this.runId,
        stage,
        success_count: metrics.successCount,
        failure_count: metrics.failureCount,
        skip_count: metrics.skipCount,
        total_duration_ms: metrics.totalDurationMs,
        avg_duration_ms:
          metrics.successCount > 0
            ? Math.round(metrics.totalDurationMs / metrics.successCount)
            : 0,
        max_duration_ms: metrics.maxDurationMs,
        details: metrics.details,
      })
    );

    await this.supabase.from('chronicle_stage_metrics').upsert(records, {
      onConflict: 'run_id,stage',
    });
  }

  private async flushErrors(): Promise<void> {
    if (!this.runId || this.errorBatch.length === 0) return;

    const records = this.errorBatch.map((e) => ({
      ...e,
      run_id: this.runId,
    }));

    await this.supabase.from('chronicle_errors').insert(records);
    this.errorBatch = [];
  }

  private async flushEvents(): Promise<void> {
    if (!this.runId || this.eventBatch.length === 0) return;

    const records = this.eventBatch.map((e) => ({
      ...e,
      run_id: this.runId,
    }));

    await this.supabase.from('shipment_events').insert(records);
    this.eventBatch = [];
  }

  private async updateRunProgress(): Promise<void> {
    if (!this.runId) return;

    await this.supabase
      .from('chronicle_runs')
      .update({
        emails_processed: this.progress.emailsProcessed,
        emails_succeeded: this.progress.emailsSucceeded,
        emails_failed: this.progress.emailsFailed,
        emails_skipped: this.progress.emailsSkipped,
        shipments_created: this.progress.shipmentsCreated,
        emails_linked: this.progress.emailsLinked,
        stage_changes: this.progress.stageChanges,
        actions_detected: this.progress.actionsDetected,
        issues_detected: this.progress.issuesDetected,
        last_progress_at: new Date().toISOString(),
      })
      .eq('id', this.runId);
  }

  // ==========================================================================
  // STAGE DETECTION (Freight Forwarder Logic)
  // ==========================================================================

  static detectShipmentStage(documentType: string): ShipmentStage {
    const stageMap: Record<string, ShipmentStage> = {
      // Delivery stage (destination events)
      pod_proof_of_delivery: 'DELIVERED',
      delivery_order: 'ARRIVED',
      gate_pass: 'ARRIVED',
      arrival_notice: 'ARRIVED',
      freight_release: 'ARRIVED',      // Release at DESTINATION = arrived

      // NOTE: container_release is at ORIGIN (pickup), not destination!
      // It happens BEFORE vessel departure, so it's SI_STAGE not ARRIVED
      container_release: 'SI_STAGE',   // Origin: container ready for pickup

      // BL stage
      final_bl: 'BL_ISSUED',
      telex_release: 'BL_ISSUED',
      sea_waybill: 'BL_ISSUED',
      house_bl: 'BL_ISSUED',
      sob_confirmation: 'BL_ISSUED',   // Shipped on Board = BL issued
      draft_bl: 'DRAFT_BL',

      // SI stage
      si_confirmation: 'SI_STAGE',
      shipping_instructions: 'SI_STAGE',
      vgm_confirmation: 'SI_STAGE',
      checklist: 'SI_STAGE',
      shipping_bill: 'SI_STAGE',
      leo_copy: 'SI_STAGE',

      // Booking stage
      booking_confirmation: 'BOOKED',
      booking_amendment: 'BOOKED',

      // Request stage
      booking_request: 'REQUESTED',
      rate_request: 'PENDING',
      quotation: 'PENDING',

      // Customs (depends on origin vs destination, default to SI_STAGE)
      customs_entry: 'SI_STAGE',       // Often origin customs
      entry_summary: 'ARRIVED',        // US 7501 = destination customs
      isf_filing: 'SI_STAGE',          // Pre-arrival filing
      duty_invoice: 'ARRIVED',         // Destination charges

      // Communication types - NO stage change!
      // These are just messages, not document milestones
      approval: 'PENDING',
      request: 'PENDING',
      escalation: 'PENDING',
      acknowledgement: 'PENDING',
      notification: 'PENDING',
      internal_notification: 'PENDING',
      system_notification: 'PENDING',
      general_correspondence: 'PENDING',
      internal_communication: 'PENDING',
      unknown: 'PENDING',
    };

    return stageMap[documentType] || 'PENDING';
  }

  static isStageProgression(
    current: ShipmentStage,
    newStage: ShipmentStage
  ): boolean {
    const order: ShipmentStage[] = [
      'PENDING',
      'REQUESTED',
      'BOOKED',
      'SI_STAGE',
      'DRAFT_BL',
      'BL_ISSUED',
      'ARRIVED',
      'DELIVERED',
    ];

    const currentIdx = order.indexOf(current);
    const newIdx = order.indexOf(newStage);

    return newIdx > currentIdx;
  }
}
