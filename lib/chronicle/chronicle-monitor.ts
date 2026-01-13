/**
 * Chronicle System Monitor
 *
 * "CT Scan" for the Chronicle Intelligence System
 * Tracks health, errors, and metrics at critical junctures.
 *
 * Usage:
 *   const monitor = createChronicleMonitor(supabase);
 *
 *   // Quick health check
 *   const health = await monitor.getHealth();
 *
 *   // Full system scan
 *   const scan = await monitor.fullScan();
 *
 *   // Log an error
 *   await monitor.logError('ai_analysis', error, { chronicleId });
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

export interface HealthStatus {
  score: number;  // 0-100
  status: 'healthy' | 'degraded' | 'critical';
  emoji: string;
  summary: string;
}

export interface SystemHealth {
  overall: HealthStatus;
  sync: {
    status: string;
    lastSyncAt: string | null;
    minutesSinceSync: number;
    consecutiveFailures: number;
  };
  activity24h: {
    processed: number;
    linked: number;
    linkRate: number;
    issues: number;
    pendingActions: number;
  };
  reanalysis: {
    total: number;
    completed: number;
    remaining: number;
    progressPct: number;
    withThreadContext: number;
  };
  pipeline: {
    stage: string;
    throughputPerHour: number;
  };
}

export interface FullScan {
  timestamp: string;
  health: SystemHealth;
  errors: ErrorSummary[];
  throughput: ThroughputHour[];
  documentTypes: DocumentTypeStat[];
  topIssues: IssueStat[];
  recommendations: string[];
}

interface ErrorSummary {
  hour: string;
  category: string;
  count: number;
  sample: string;
}

interface ThroughputHour {
  hour: string;
  emails: number;
  linked: number;
  issues: number;
  linkRate: number;
}

interface DocumentTypeStat {
  type: string;
  count: number;
  linked: number;
  linkRate: number;
}

interface IssueStat {
  issueType: string;
  count: number;
  sample: string;
}

// ============================================================================
// MONITOR SERVICE
// ============================================================================

export class ChronicleMonitor {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  // ==========================================================================
  // QUICK HEALTH CHECK
  // ==========================================================================

  async getHealth(): Promise<SystemHealth> {
    const { data, error } = await this.supabase
      .from('v_chronicle_health')
      .select('*')
      .single();

    if (error || !data) {
      return this.getDefaultHealth();
    }

    const score = data.health_score || 50;

    return {
      overall: this.scoreToStatus(score),
      sync: {
        status: data.sync_status || 'unknown',
        lastSyncAt: data.last_sync_at,
        minutesSinceSync: Math.round(data.minutes_since_sync || 0),
        consecutiveFailures: data.consecutive_failures || 0,
      },
      activity24h: {
        processed: data.total_24h || 0,
        linked: data.linked_24h || 0,
        linkRate: data.link_rate_24h || 0,
        issues: data.issues_24h || 0,
        pendingActions: data.pending_actions_24h || 0,
      },
      reanalysis: {
        total: data.total_all || 0,
        completed: (data.total_all || 0) - (data.needs_reanalysis || 0),
        remaining: data.needs_reanalysis || 0,
        progressPct: data.reanalysis_progress_pct || 0,
        withThreadContext: data.with_thread_context || 0,
      },
      pipeline: {
        stage: this.determinePipelineStage(data),
        throughputPerHour: Math.round((data.total_24h || 0) / 24),
      },
    };
  }

  // ==========================================================================
  // FULL SYSTEM SCAN (CT SCAN)
  // ==========================================================================

  async fullScan(): Promise<FullScan> {
    const [health, errors, throughput, docTypes, issues] = await Promise.all([
      this.getHealth(),
      this.getRecentErrors(),
      this.getThroughput(),
      this.getDocumentTypeStats(),
      this.getTopIssues(),
    ]);

    const recommendations = this.generateRecommendations(health, errors);

    return {
      timestamp: new Date().toISOString(),
      health,
      errors,
      throughput,
      documentTypes: docTypes,
      topIssues: issues,
      recommendations,
    };
  }

  // ==========================================================================
  // ERROR LOGGING
  // ==========================================================================

  async logError(
    category: string,
    error: Error | string,
    context?: Record<string, any>,
    source: string = 'system'
  ): Promise<void> {
    const message = error instanceof Error ? error.message : error;

    await this.supabase.from('chronicle_metrics').insert({
      metric_type: 'error',
      error_category: category,
      error_message: message.substring(0, 1000),
      error_context: context || {},
      source,
    });
  }

  // ==========================================================================
  // METRIC LOGGING
  // ==========================================================================

  async logBatchComplete(stats: {
    processed: number;
    failed: number;
    linked: number;
    aiCalls: number;
    aiErrors: number;
    avgLatencyMs: number;
    threadContextUsed: number;
    source: string;
    runId?: string;
  }): Promise<void> {
    const linkRate = stats.processed > 0
      ? (stats.linked / stats.processed) * 100
      : 0;
    const errorRate = stats.processed > 0
      ? (stats.failed / stats.processed) * 100
      : 0;

    await this.supabase.from('chronicle_metrics').insert({
      metric_type: 'hourly_summary',
      emails_processed: stats.processed,
      emails_failed: stats.failed,
      emails_linked: stats.linked,
      ai_calls: stats.aiCalls,
      ai_errors: stats.aiErrors,
      ai_avg_latency_ms: stats.avgLatencyMs,
      thread_context_used: stats.threadContextUsed,
      link_rate_pct: linkRate,
      error_rate_pct: errorRate,
      source: stats.source,
      run_id: stats.runId,
    });
  }

  // ==========================================================================
  // FORMATTED OUTPUT (Terminal-Friendly)
  // ==========================================================================

  formatHealthReport(health: SystemHealth): string {
    const lines = [
      '',
      '╔══════════════════════════════════════════════════════════════════╗',
      `║  CHRONICLE SYSTEM HEALTH ${health.overall.emoji}                                  ║`,
      '╠══════════════════════════════════════════════════════════════════╣',
      `║  Score: ${health.overall.score}/100 - ${health.overall.status.toUpperCase().padEnd(20)}                    ║`,
      `║  ${health.overall.summary.padEnd(62)}║`,
      '╠══════════════════════════════════════════════════════════════════╣',
      '║  SYNC STATUS                                                     ║',
      `║  Status: ${health.sync.status.padEnd(15)} Last: ${this.formatTimeAgo(health.sync.minutesSinceSync).padEnd(20)}    ║`,
      `║  Failures: ${health.sync.consecutiveFailures}                                                      ║`,
      '╠══════════════════════════════════════════════════════════════════╣',
      '║  24H ACTIVITY                                                    ║',
      `║  Processed: ${String(health.activity24h.processed).padEnd(8)} Linked: ${String(health.activity24h.linked).padEnd(8)} Rate: ${health.activity24h.linkRate}%      ║`,
      `║  Issues: ${String(health.activity24h.issues).padEnd(10)} Pending Actions: ${String(health.activity24h.pendingActions).padEnd(10)}          ║`,
      '╠══════════════════════════════════════════════════════════════════╣',
      '║  REANALYSIS PROGRESS                                             ║',
      `║  ${this.progressBar(health.reanalysis.progressPct)} ${health.reanalysis.progressPct}%            ║`,
      `║  Completed: ${health.reanalysis.completed} / ${health.reanalysis.total}  |  With Context: ${health.reanalysis.withThreadContext}        ║`,
      '╚══════════════════════════════════════════════════════════════════╝',
      '',
    ];

    return lines.join('\n');
  }

  formatFullScan(scan: FullScan): string {
    let output = this.formatHealthReport(scan.health);

    // Add errors section
    if (scan.errors.length > 0) {
      output += '\n┌─────────────────────────────────────────────────────────────────┐\n';
      output += '│  RECENT ERRORS (24h)                                            │\n';
      output += '├─────────────────────────────────────────────────────────────────┤\n';
      for (const err of scan.errors.slice(0, 5)) {
        output += `│  ${err.category.padEnd(20)} x${String(err.count).padEnd(5)} ${err.sample.substring(0, 30).padEnd(30)}│\n`;
      }
      output += '└─────────────────────────────────────────────────────────────────┘\n';
    }

    // Add recommendations
    if (scan.recommendations.length > 0) {
      output += '\n┌─────────────────────────────────────────────────────────────────┐\n';
      output += '│  💡 RECOMMENDATIONS                                              │\n';
      output += '├─────────────────────────────────────────────────────────────────┤\n';
      for (const rec of scan.recommendations) {
        output += `│  • ${rec.padEnd(61)}│\n`;
      }
      output += '└─────────────────────────────────────────────────────────────────┘\n';
    }

    return output;
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private async getRecentErrors(): Promise<ErrorSummary[]> {
    const { data } = await this.supabase
      .from('v_chronicle_errors')
      .select('*')
      .limit(20);

    return (data || []).map(row => ({
      hour: row.hour,
      category: row.error_category,
      count: row.error_count,
      sample: row.sample_message || '',
    }));
  }

  private async getThroughput(): Promise<ThroughputHour[]> {
    const { data } = await this.supabase
      .from('v_chronicle_throughput')
      .select('*')
      .limit(48);

    return (data || []).map(row => ({
      hour: row.hour,
      emails: row.emails,
      linked: row.linked,
      issues: row.issues,
      linkRate: row.link_rate,
    }));
  }

  private async getDocumentTypeStats(): Promise<DocumentTypeStat[]> {
    const { data } = await this.supabase
      .from('chronicle')
      .select('document_type, shipment_id')
      .limit(10000);

    if (!data) return [];

    const stats = new Map<string, { total: number; linked: number }>();
    for (const row of data) {
      const type = row.document_type || 'unknown';
      const current = stats.get(type) || { total: 0, linked: 0 };
      current.total++;
      if (row.shipment_id) current.linked++;
      stats.set(type, current);
    }

    return Array.from(stats.entries())
      .map(([type, s]) => ({
        type,
        count: s.total,
        linked: s.linked,
        linkRate: Math.round((s.linked / s.total) * 100),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);
  }

  private async getTopIssues(): Promise<IssueStat[]> {
    const { data } = await this.supabase
      .from('chronicle')
      .select('issue_type, issue_description')
      .eq('has_issue', true)
      .not('issue_type', 'is', null)
      .limit(1000);

    if (!data) return [];

    const stats = new Map<string, { count: number; sample: string }>();
    for (const row of data) {
      const type = row.issue_type;
      const current = stats.get(type) || { count: 0, sample: row.issue_description || '' };
      current.count++;
      stats.set(type, current);
    }

    return Array.from(stats.entries())
      .map(([type, s]) => ({
        issueType: type,
        count: s.count,
        sample: s.sample,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  private scoreToStatus(score: number): HealthStatus {
    if (score >= 80) {
      return { score, status: 'healthy', emoji: '🟢', summary: 'All systems operational' };
    } else if (score >= 50) {
      return { score, status: 'degraded', emoji: '🟡', summary: 'Some issues detected, monitoring recommended' };
    } else {
      return { score, status: 'critical', emoji: '🔴', summary: 'Critical issues detected, action required' };
    }
  }

  private determinePipelineStage(data: any): string {
    if (data.consecutive_failures > 0) return 'sync_error';
    if (data.needs_reanalysis > 0) return 'reanalysis_in_progress';
    return 'normal_operation';
  }

  private generateRecommendations(health: SystemHealth, errors: ErrorSummary[]): string[] {
    const recs: string[] = [];

    if (health.sync.consecutiveFailures > 0) {
      recs.push('Check Gmail API credentials - sync failures detected');
    }
    if (health.sync.minutesSinceSync > 60) {
      recs.push('Sync is delayed - verify cron job is running');
    }
    if (health.activity24h.linkRate < 70) {
      recs.push('Link rate below 70% - review linking rules');
    }
    if (health.reanalysis.remaining > 0) {
      recs.push(`${health.reanalysis.remaining} emails pending reanalysis`);
    }
    if (health.activity24h.pendingActions > 50) {
      recs.push('High pending actions - review action queue');
    }

    const aiErrors = errors.filter(e => e.category?.includes('ai'));
    if (aiErrors.length > 0) {
      recs.push('AI errors detected - check API rate limits');
    }

    if (recs.length === 0) {
      recs.push('System running optimally - no action needed');
    }

    return recs;
  }

  private formatTimeAgo(minutes: number): string {
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${Math.round(minutes)}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  private progressBar(pct: number): string {
    const filled = Math.round(pct / 5);
    const empty = 20 - filled;
    return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
  }

  private getDefaultHealth(): SystemHealth {
    return {
      overall: { score: 0, status: 'critical', emoji: '🔴', summary: 'Unable to fetch health data' },
      sync: { status: 'unknown', lastSyncAt: null, minutesSinceSync: 0, consecutiveFailures: 0 },
      activity24h: { processed: 0, linked: 0, linkRate: 0, issues: 0, pendingActions: 0 },
      reanalysis: { total: 0, completed: 0, remaining: 0, progressPct: 0, withThreadContext: 0 },
      pipeline: { stage: 'unknown', throughputPerHour: 0 },
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createChronicleMonitor(supabase: SupabaseClient): ChronicleMonitor {
  return new ChronicleMonitor(supabase);
}
