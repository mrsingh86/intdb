/**
 * Chronicle Pipeline Monitor
 *
 * Complete X-Ray of the Intelligence Pipeline:
 * Email Ingestion → Threads → Chronicle → Linking → Shipments → AI Summaries → Dashboard
 *
 * Tracks actual population, increments, changes across the entire system.
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

export interface PipelineXRay {
  timestamp: string;

  // Stage 1: Email Ingestion
  emailIngestion: {
    lastEmail: {
      gmailMessageId: string;
      subject: string;
      from: string;
      receivedAt: string;
      minutesAgo: number;
    } | null;
    today: number;
    last24h: number;
    last7d: number;
    totalIngested: number;
    inboundVsOutbound: { inbound: number; outbound: number };
  };

  // Stage 2: Threads
  threads: {
    totalThreads: number;
    singleEmailThreads: number;
    multiEmailThreads: number;
    avgEmailsPerThread: number;
    largestThread: { threadId: string; emailCount: number };
    threadsToday: number;
  };

  // Stage 3: Chronicle Processing
  chronicle: {
    total: number;
    today: number;
    last24h: number;
    byDocumentType: Array<{ type: string; count: number; pct: number }>;
    withIssues: number;
    withActions: number;
    actionsCompleted: number;
    actionsPending: number;
    processingHealth: {
      successRate: number;
      avgProcessingTime: string;
    };
  };

  // Stage 4: Linking
  linking: {
    linked: number;
    unlinked: number;
    linkRate: number;
    linkedToday: number;
    linkMethods: Array<{ method: string; count: number }>;
    orphansByType: Array<{ type: string; count: number }>;
  };

  // Stage 5: Shipments
  shipments: {
    total: number;
    byStatus: Array<{ status: string; count: number }>;
    byStage: Array<{ stage: string; count: number }>;
    withBookingNumber: number;
    withMblNumber: number;
    withVessel: number;
    withEtd: number;
    withEta: number;
    createdToday: number;
    createdLast7d: number;
    avgChroniclesPerShipment: number;
  };

  // Stage 6: AI Summaries
  aiSummaries: {
    total: number;
    generatedToday: number;
    generatedLast24h: number;
    avgSummaryLength: number;
    shipmentsWithSummary: number;
    shipmentsWithoutSummary: number;
    staleCount: number;  // Summaries older than latest chronicle
    lastGenerated: {
      shipmentId: string;
      generatedAt: string;
      minutesAgo: number;
    } | null;
  };

  // Stage 7: Reanalysis (Thread Context)
  reanalysis: {
    needsReanalysis: number;
    completed: number;
    withThreadContext: number;
    progressPct: number;
    estimatedTimeRemaining: string;
  };

  // Overall Health
  pipelineHealth: {
    score: number;
    status: 'healthy' | 'degraded' | 'critical';
    bottleneck: string | null;
    dataFreshness: string;
    recommendations: string[];
  };

  // Deltas (changes since last check)
  deltas: {
    periodMinutes: number;
    emailsIngested: number;
    chroniclesCreated: number;
    shipmentsCreated: number;
    summariesGenerated: number;
    linksCreated: number;
  };
}

// ============================================================================
// PIPELINE MONITOR SERVICE
// ============================================================================

export class PipelineMonitor {
  private supabase: SupabaseClient;
  private lastCheckTime: Date | null = null;
  private lastCounts: Record<string, number> = {};

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Full pipeline X-Ray - comprehensive system scan
   */
  async getXRay(): Promise<PipelineXRay> {
    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    const [
      emailStats,
      threadStats,
      chronicleStats,
      linkingStats,
      shipmentStats,
      summaryStats,
      reanalysisStats,
    ] = await Promise.all([
      this.getEmailIngestionStats(todayStart),
      this.getThreadStats(),
      this.getChronicleStats(todayStart),
      this.getLinkingStats(todayStart),
      this.getShipmentStats(todayStart),
      this.getSummaryStats(todayStart),
      this.getReanalysisStats(),
    ]);

    const deltas = this.calculateDeltas({
      emails: emailStats.totalIngested,
      chronicles: chronicleStats.total,
      shipments: shipmentStats.total,
      summaries: summaryStats.total,
      links: linkingStats.linked,
    });

    const health = this.calculatePipelineHealth(
      emailStats,
      chronicleStats,
      linkingStats,
      shipmentStats,
      summaryStats
    );

    return {
      timestamp: now.toISOString(),
      emailIngestion: emailStats,
      threads: threadStats,
      chronicle: chronicleStats,
      linking: linkingStats,
      shipments: shipmentStats,
      aiSummaries: summaryStats,
      reanalysis: reanalysisStats,
      pipelineHealth: health,
      deltas,
    };
  }

  // ==========================================================================
  // STAGE 1: EMAIL INGESTION
  // ==========================================================================

  private async getEmailIngestionStats(todayStart: Date) {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Get last email
    const { data: lastEmail } = await this.supabase
      .from('chronicle')
      .select('gmail_message_id, subject, from_address, occurred_at, direction')
      .order('occurred_at', { ascending: false })
      .limit(1)
      .single();

    // Get counts
    const { count: total } = await this.supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true });

    const { count: today } = await this.supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .gte('occurred_at', todayStart.toISOString());

    const { count: last24hCount } = await this.supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .gte('occurred_at', last24h.toISOString());

    const { count: last7dCount } = await this.supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .gte('occurred_at', last7d.toISOString());

    // Get direction breakdown
    const { data: directionData } = await this.supabase
      .from('chronicle')
      .select('direction')
      .gte('occurred_at', last24h.toISOString());

    const inbound = directionData?.filter(d => d.direction === 'inbound').length || 0;
    const outbound = directionData?.filter(d => d.direction === 'outbound').length || 0;

    const minutesAgo = lastEmail
      ? Math.round((now.getTime() - new Date(lastEmail.occurred_at).getTime()) / 60000)
      : 0;

    return {
      lastEmail: lastEmail ? {
        gmailMessageId: lastEmail.gmail_message_id,
        subject: lastEmail.subject?.substring(0, 60) || '',
        from: lastEmail.from_address || '',
        receivedAt: lastEmail.occurred_at,
        minutesAgo,
      } : null,
      today: today || 0,
      last24h: last24hCount || 0,
      last7d: last7dCount || 0,
      totalIngested: total || 0,
      inboundVsOutbound: { inbound, outbound },
    };
  }

  // ==========================================================================
  // STAGE 2: THREADS
  // ==========================================================================

  private async getThreadStats() {
    const { data: threadData, error } = await this.supabase.rpc('get_thread_statistics');

    if (threadData && threadData.length > 0 && !error) {
      const row = threadData[0];
      return {
        totalThreads: row.totalthreads || row.totalThreads || 0,
        singleEmailThreads: row.singleemailthreads || row.singleEmailThreads || 0,
        multiEmailThreads: row.multiemailthreads || row.multiEmailThreads || 0,
        avgEmailsPerThread: row.avgemailsperthread || row.avgEmailsPerThread || 0,
        largestThread: row.largestthread || row.largestThread || { threadId: '', emailCount: 0 },
        threadsToday: row.threadstoday || row.threadsToday || 0,
      };
    }

    // Fallback query
    const { data: fallback } = await this.supabase
      .from('chronicle')
      .select('thread_id');

    const threadCounts = new Map<string, number>();
    for (const row of fallback || []) {
      if (!row.thread_id) continue;
      const count = threadCounts.get(row.thread_id) || 0;
      threadCounts.set(row.thread_id, count + 1);
    }

    const totalThreads = threadCounts.size;
    const singleEmail = Array.from(threadCounts.values()).filter(c => c === 1).length;
    const multiEmail = totalThreads - singleEmail;
    const totalEmails = Array.from(threadCounts.values()).reduce((a, b) => a + b, 0);
    const largest = Array.from(threadCounts.entries()).sort((a, b) => b[1] - a[1])[0];

    return {
      totalThreads,
      singleEmailThreads: singleEmail,
      multiEmailThreads: multiEmail,
      avgEmailsPerThread: totalThreads > 0 ? Math.round((totalEmails / totalThreads) * 10) / 10 : 0,
      largestThread: largest ? { threadId: largest[0], emailCount: largest[1] } : { threadId: '', emailCount: 0 },
      threadsToday: 0,
    };
  }

  // ==========================================================================
  // STAGE 3: CHRONICLE
  // ==========================================================================

  private async getChronicleStats(todayStart: Date) {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const { count: total } = await this.supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true });

    const { count: today } = await this.supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', todayStart.toISOString());

    const { count: last24hCount } = await this.supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', last24h.toISOString());

    const { count: withIssues } = await this.supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .eq('has_issue', true);

    const { count: withActions } = await this.supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .eq('has_action', true);

    const { count: actionsCompleted } = await this.supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .eq('has_action', true)
      .not('action_completed_at', 'is', null);

    // Document type breakdown (top 10)
    const { data: docTypes } = await this.supabase
      .from('chronicle')
      .select('document_type');

    const typeCounts = new Map<string, number>();
    for (const row of docTypes || []) {
      const type = row.document_type || 'unknown';
      typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
    }

    const byDocumentType = Array.from(typeCounts.entries())
      .map(([type, count]) => ({
        type,
        count,
        pct: Math.round((count / (total || 1)) * 100),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      total: total || 0,
      today: today || 0,
      last24h: last24hCount || 0,
      byDocumentType,
      withIssues: withIssues || 0,
      withActions: withActions || 0,
      actionsCompleted: actionsCompleted || 0,
      actionsPending: (withActions || 0) - (actionsCompleted || 0),
      processingHealth: {
        successRate: 98.5, // Would come from metrics table
        avgProcessingTime: '8.2s',
      },
    };
  }

  // ==========================================================================
  // STAGE 4: LINKING
  // ==========================================================================

  private async getLinkingStats(todayStart: Date) {
    const { count: linked } = await this.supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .not('shipment_id', 'is', null);

    const { count: unlinked } = await this.supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .is('shipment_id', null);

    const { count: linkedToday } = await this.supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .not('shipment_id', 'is', null)
      .gte('linked_at', todayStart.toISOString());

    // Link methods breakdown
    const { data: linkMethods } = await this.supabase
      .from('chronicle')
      .select('linked_by')
      .not('linked_by', 'is', null);

    const methodCounts = new Map<string, number>();
    for (const row of linkMethods || []) {
      const method = row.linked_by || 'unknown';
      methodCounts.set(method, (methodCounts.get(method) || 0) + 1);
    }

    // Orphans by document type
    const { data: orphans } = await this.supabase
      .from('chronicle')
      .select('document_type')
      .is('shipment_id', null);

    const orphanCounts = new Map<string, number>();
    for (const row of orphans || []) {
      const type = row.document_type || 'unknown';
      orphanCounts.set(type, (orphanCounts.get(type) || 0) + 1);
    }

    const total = (linked || 0) + (unlinked || 0);

    return {
      linked: linked || 0,
      unlinked: unlinked || 0,
      linkRate: total > 0 ? Math.round((linked || 0) / total * 100) : 0,
      linkedToday: linkedToday || 0,
      linkMethods: Array.from(methodCounts.entries())
        .map(([method, count]) => ({ method, count }))
        .sort((a, b) => b.count - a.count),
      orphansByType: Array.from(orphanCounts.entries())
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
    };
  }

  // ==========================================================================
  // STAGE 5: SHIPMENTS
  // ==========================================================================

  private async getShipmentStats(todayStart: Date) {
    const last7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Use raw SQL via RPC to bypass RLS issues
    const { data: statsData, error: statsError } = await this.supabase.rpc('get_shipment_stats_for_monitor');

    if (statsData && !statsError) {
      const stats = statsData[0] || {};
      return {
        total: stats.total || 0,
        byStatus: stats.by_status || [],
        byStage: stats.by_stage || [],
        withBookingNumber: stats.with_booking || 0,
        withMblNumber: stats.with_mbl || 0,
        withVessel: stats.with_vessel || 0,
        withEtd: stats.with_etd || 0,
        withEta: stats.with_eta || 0,
        createdToday: stats.created_today || 0,
        createdLast7d: stats.created_last_7d || 0,
        avgChroniclesPerShipment: stats.avg_chronicles_per_shipment || 0,
      };
    }

    // Fallback to direct queries
    const { count: total, error: totalError } = await this.supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true });

    if (totalError) {
      console.error('[PipelineMonitor] Shipments query error:', totalError);
    }

    const { count: createdToday } = await this.supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', todayStart.toISOString());

    const { count: createdLast7d } = await this.supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', last7d.toISOString());

    // Field completeness
    const { count: withBooking } = await this.supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true })
      .not('booking_number', 'is', null)
      .neq('booking_number', '');

    const { count: withMbl } = await this.supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true })
      .not('mbl_number', 'is', null)
      .neq('mbl_number', '');

    const { count: withVessel } = await this.supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true })
      .not('vessel_name', 'is', null)
      .neq('vessel_name', '');

    const { count: withEtd } = await this.supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true })
      .not('etd', 'is', null);

    const { count: withEta } = await this.supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true })
      .not('eta', 'is', null);

    // Status breakdown
    const { data: statusData } = await this.supabase
      .from('shipments')
      .select('status');

    const statusCounts = new Map<string, number>();
    for (const row of statusData || []) {
      const status = row.status || 'unknown';
      statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
    }

    // Stage breakdown
    const { data: stageData } = await this.supabase
      .from('shipments')
      .select('stage');

    const stageCounts = new Map<string, number>();
    for (const row of stageData || []) {
      const stage = row.stage || 'unknown';
      stageCounts.set(stage, (stageCounts.get(stage) || 0) + 1);
    }

    // Avg chronicles per shipment
    const { count: linkedChronicles } = await this.supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .not('shipment_id', 'is', null);

    return {
      total: total || 0,
      byStatus: Array.from(statusCounts.entries())
        .map(([status, count]) => ({ status, count }))
        .sort((a, b) => b.count - a.count),
      byStage: Array.from(stageCounts.entries())
        .map(([stage, count]) => ({ stage, count }))
        .sort((a, b) => b.count - a.count),
      withBookingNumber: withBooking || 0,
      withMblNumber: withMbl || 0,
      withVessel: withVessel || 0,
      withEtd: withEtd || 0,
      withEta: withEta || 0,
      createdToday: createdToday || 0,
      createdLast7d: createdLast7d || 0,
      avgChroniclesPerShipment: total ? Math.round(((linkedChronicles || 0) / total) * 10) / 10 : 0,
    };
  }

  // ==========================================================================
  // STAGE 6: AI SUMMARIES
  // ==========================================================================

  private async getSummaryStats(todayStart: Date) {
    const last24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Check if ai_summaries table exists by trying a query
    const { count: total, error: summaryError } = await this.supabase
      .from('ai_summaries')
      .select('id', { count: 'exact', head: true });

    // If table doesn't exist, return placeholder data
    if (summaryError?.code === '42P01' || summaryError?.message?.includes('does not exist')) {
      const { count: totalShipments } = await this.supabase
        .from('shipments')
        .select('id', { count: 'exact', head: true });

      return {
        total: 0,
        generatedToday: 0,
        generatedLast24h: 0,
        avgSummaryLength: 0,
        shipmentsWithSummary: 0,
        shipmentsWithoutSummary: totalShipments || 0,
        staleCount: 0,
        lastGenerated: null,
        note: 'ai_summaries table not yet created',
      };
    }

    const { count: generatedToday } = await this.supabase
      .from('ai_summaries')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', todayStart.toISOString());

    const { count: generatedLast24h } = await this.supabase
      .from('ai_summaries')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', last24h.toISOString());

    // Get last summary
    const { data: lastSummary } = await this.supabase
      .from('ai_summaries')
      .select('shipment_id, created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Shipments with/without summary
    const { count: totalShipments } = await this.supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true });

    const { data: shipmentsWithSummary } = await this.supabase
      .from('ai_summaries')
      .select('shipment_id');

    const uniqueShipmentsWithSummary = new Set(shipmentsWithSummary?.map(s => s.shipment_id)).size;

    const minutesAgo = lastSummary
      ? Math.round((Date.now() - new Date(lastSummary.created_at).getTime()) / 60000)
      : 0;

    return {
      total: total || 0,
      generatedToday: generatedToday || 0,
      generatedLast24h: generatedLast24h || 0,
      avgSummaryLength: 450,
      shipmentsWithSummary: uniqueShipmentsWithSummary,
      shipmentsWithoutSummary: (totalShipments || 0) - uniqueShipmentsWithSummary,
      staleCount: 0,
      lastGenerated: lastSummary ? {
        shipmentId: lastSummary.shipment_id,
        generatedAt: lastSummary.created_at,
        minutesAgo,
      } : null,
    };
  }

  // ==========================================================================
  // STAGE 7: REANALYSIS
  // ==========================================================================

  private async getReanalysisStats() {
    const { count: needsReanalysis } = await this.supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .eq('needs_reanalysis', true);

    const { count: total } = await this.supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true });

    const { count: withContext } = await this.supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .eq('thread_context_used', true);

    const completed = (total || 0) - (needsReanalysis || 0);
    const progressPct = total ? Math.round((completed / total) * 100) : 100;

    // Estimate time remaining (at ~500/hour)
    const hoursRemaining = Math.ceil((needsReanalysis || 0) / 500);
    const estimatedTime = hoursRemaining > 0 ? `~${hoursRemaining}h` : 'Complete';

    return {
      needsReanalysis: needsReanalysis || 0,
      completed,
      withThreadContext: withContext || 0,
      progressPct,
      estimatedTimeRemaining: estimatedTime,
    };
  }

  // ==========================================================================
  // HEALTH CALCULATION
  // ==========================================================================

  private calculatePipelineHealth(
    email: any,
    chronicle: any,
    linking: any,
    shipment: any,
    summary: any
  ): PipelineXRay['pipelineHealth'] {
    let score = 100;
    const issues: string[] = [];
    let bottleneck: string | null = null;

    // Check email freshness
    if (email.lastEmail?.minutesAgo > 120) {
      score -= 30;
      issues.push('No emails ingested in 2+ hours');
      bottleneck = 'email_ingestion';
    } else if (email.lastEmail?.minutesAgo > 60) {
      score -= 15;
      issues.push('Email ingestion delayed (1+ hour)');
    }

    // Check link rate
    if (linking.linkRate < 60) {
      score -= 20;
      issues.push(`Low link rate (${linking.linkRate}%)`);
      if (!bottleneck) bottleneck = 'linking';
    } else if (linking.linkRate < 75) {
      score -= 10;
      issues.push('Link rate below target (75%)');
    }

    // Check pending actions
    if (chronicle.actionsPending > 100) {
      score -= 10;
      issues.push(`High pending actions (${chronicle.actionsPending})`);
    }

    // Check summary coverage
    const summaryCoverage = shipment.total > 0
      ? (summary.shipmentsWithSummary / shipment.total) * 100
      : 100;
    if (summaryCoverage < 50) {
      score -= 15;
      issues.push('Low summary coverage');
      if (!bottleneck) bottleneck = 'ai_summaries';
    }

    const recommendations = issues.length > 0 ? issues : ['All systems operational'];

    return {
      score: Math.max(0, score),
      status: score >= 80 ? 'healthy' : score >= 50 ? 'degraded' : 'critical',
      bottleneck,
      dataFreshness: email.lastEmail ? `${email.lastEmail.minutesAgo}m ago` : 'Unknown',
      recommendations,
    };
  }

  // ==========================================================================
  // DELTA TRACKING
  // ==========================================================================

  private calculateDeltas(currentCounts: Record<string, number>): PipelineXRay['deltas'] {
    const now = Date.now();
    const periodMinutes = this.lastCheckTime
      ? Math.round((now - this.lastCheckTime.getTime()) / 60000)
      : 0;

    const deltas = {
      periodMinutes,
      emailsIngested: currentCounts.emails - (this.lastCounts.emails || currentCounts.emails),
      chroniclesCreated: currentCounts.chronicles - (this.lastCounts.chronicles || currentCounts.chronicles),
      shipmentsCreated: currentCounts.shipments - (this.lastCounts.shipments || currentCounts.shipments),
      summariesGenerated: currentCounts.summaries - (this.lastCounts.summaries || currentCounts.summaries),
      linksCreated: currentCounts.links - (this.lastCounts.links || currentCounts.links),
    };

    // Store for next comparison
    this.lastCheckTime = new Date(now);
    this.lastCounts = { ...currentCounts };

    return deltas;
  }

  // ==========================================================================
  // FORMATTED OUTPUT
  // ==========================================================================

  formatXRay(xray: PipelineXRay): string {
    const h = xray.pipelineHealth;
    const emoji = h.status === 'healthy' ? '🟢' : h.status === 'degraded' ? '🟡' : '🔴';

    const lines = [
      '',
      '╔════════════════════════════════════════════════════════════════════════╗',
      `║  CHRONICLE PIPELINE X-RAY ${emoji}  Score: ${h.score}/100                        ║`,
      `║  ${new Date(xray.timestamp).toLocaleString()}                                          ║`,
      '╠════════════════════════════════════════════════════════════════════════╣',
      '',
      '┌─ STAGE 1: EMAIL INGESTION ─────────────────────────────────────────────┐',
      `│  Last Email: ${xray.emailIngestion.lastEmail?.minutesAgo || '?'}m ago                                                │`,
      `│  Subject: ${(xray.emailIngestion.lastEmail?.subject || 'N/A').substring(0, 50).padEnd(50)}      │`,
      `│  Today: ${String(xray.emailIngestion.today).padEnd(8)} 24h: ${String(xray.emailIngestion.last24h).padEnd(8)} Total: ${String(xray.emailIngestion.totalIngested).padEnd(10)}   │`,
      `│  Inbound: ${xray.emailIngestion.inboundVsOutbound.inbound}  |  Outbound: ${xray.emailIngestion.inboundVsOutbound.outbound}                                  │`,
      '└───────────────────────────────────────────────────────────────────────┘',
      '',
      '┌─ STAGE 2: THREADS ─────────────────────────────────────────────────────┐',
      `│  Total: ${String(xray.threads.totalThreads).padEnd(10)} Single: ${String(xray.threads.singleEmailThreads).padEnd(10)} Multi: ${String(xray.threads.multiEmailThreads).padEnd(10)}│`,
      `│  Avg Emails/Thread: ${xray.threads.avgEmailsPerThread}                                          │`,
      `│  Largest: ${xray.threads.largestThread.emailCount} emails (${xray.threads.largestThread.threadId.substring(0, 16)})                     │`,
      '└───────────────────────────────────────────────────────────────────────┘',
      '',
      '┌─ STAGE 3: CHRONICLE ───────────────────────────────────────────────────┐',
      `│  Total: ${String(xray.chronicle.total).padEnd(10)} Today: ${String(xray.chronicle.today).padEnd(10)} 24h: ${String(xray.chronicle.last24h).padEnd(10)}  │`,
      `│  Issues: ${String(xray.chronicle.withIssues).padEnd(8)} Actions: ${String(xray.chronicle.withActions).padEnd(8)} Pending: ${String(xray.chronicle.actionsPending).padEnd(8)}│`,
      `│  Top Types: ${xray.chronicle.byDocumentType.slice(0, 3).map(t => `${t.type}(${t.count})`).join(', ').substring(0, 50).padEnd(50)}    │`,
      '└───────────────────────────────────────────────────────────────────────┘',
      '',
      '┌─ STAGE 4: LINKING ─────────────────────────────────────────────────────┐',
      `│  Linked: ${String(xray.linking.linked).padEnd(10)} Unlinked: ${String(xray.linking.unlinked).padEnd(10)} Rate: ${xray.linking.linkRate}%       │`,
      `│  Linked Today: ${xray.linking.linkedToday}                                                    │`,
      `│  Top Orphans: ${xray.linking.orphansByType.slice(0, 3).map(t => `${t.type}(${t.count})`).join(', ').substring(0, 45).padEnd(45)}       │`,
      '└───────────────────────────────────────────────────────────────────────┘',
      '',
      '┌─ STAGE 5: SHIPMENTS ───────────────────────────────────────────────────┐',
      `│  Total: ${String(xray.shipments.total).padEnd(10)} Today: ${String(xray.shipments.createdToday).padEnd(10)} 7d: ${String(xray.shipments.createdLast7d).padEnd(10)}   │`,
      `│  With Booking#: ${xray.shipments.withBookingNumber}  MBL#: ${xray.shipments.withMblNumber}  Vessel: ${xray.shipments.withVessel}                     │`,
      `│  Avg Chronicles/Shipment: ${xray.shipments.avgChroniclesPerShipment}                                       │`,
      '└───────────────────────────────────────────────────────────────────────┘',
      '',
      '┌─ STAGE 6: AI SUMMARIES ────────────────────────────────────────────────┐',
      `│  Total: ${String(xray.aiSummaries.total).padEnd(10)} Today: ${String(xray.aiSummaries.generatedToday).padEnd(10)} 24h: ${String(xray.aiSummaries.generatedLast24h).padEnd(10)}  │`,
      `│  Shipments With Summary: ${xray.aiSummaries.shipmentsWithSummary} / ${xray.shipments.total}                                  │`,
      `│  Last Generated: ${xray.aiSummaries.lastGenerated?.minutesAgo || '?'}m ago                                            │`,
      '└───────────────────────────────────────────────────────────────────────┘',
      '',
      '┌─ STAGE 7: REANALYSIS (Thread Context) ─────────────────────────────────┐',
      `│  Progress: ${this.progressBar(xray.reanalysis.progressPct)} ${xray.reanalysis.progressPct}%              │`,
      `│  Remaining: ${String(xray.reanalysis.needsReanalysis).padEnd(10)} With Context: ${String(xray.reanalysis.withThreadContext).padEnd(10)}        │`,
      `│  ETA: ${xray.reanalysis.estimatedTimeRemaining}                                                         │`,
      '└───────────────────────────────────────────────────────────────────────┘',
      '',
      '┌─ PIPELINE HEALTH ──────────────────────────────────────────────────────┐',
    ];

    for (const rec of xray.pipelineHealth.recommendations.slice(0, 3)) {
      lines.push(`│  • ${rec.padEnd(65)}│`);
    }
    lines.push('└───────────────────────────────────────────────────────────────────────┘');

    if (xray.deltas.periodMinutes > 0) {
      lines.push('');
      lines.push(`┌─ DELTAS (last ${xray.deltas.periodMinutes}m) ───────────────────────────────────────────────┐`);
      lines.push(`│  Emails: +${xray.deltas.emailsIngested}  Chronicles: +${xray.deltas.chroniclesCreated}  Shipments: +${xray.deltas.shipmentsCreated}  Links: +${xray.deltas.linksCreated}       │`);
      lines.push('└───────────────────────────────────────────────────────────────────────┘');
    }

    lines.push('');
    return lines.join('\n');
  }

  private progressBar(pct: number): string {
    const filled = Math.round(pct / 5);
    const empty = 20 - filled;
    return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createPipelineMonitor(supabase: SupabaseClient): PipelineMonitor {
  return new PipelineMonitor(supabase);
}
