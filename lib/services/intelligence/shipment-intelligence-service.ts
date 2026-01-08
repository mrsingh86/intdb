/**
 * Shipment Intelligence Service
 *
 * Aggregates email-level intelligence into shipment-level rollups.
 * Provides one-glance dashboard view per shipment.
 *
 * Single Responsibility: Aggregate and store intelligence for ONE shipment.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { Sentiment, Urgency, EventType } from './email-intelligence-service';

// ============================================================================
// Types
// ============================================================================

export type SentimentTrend = 'improving' | 'stable' | 'declining' | 'unknown';

export interface ShipmentIntelligence {
  shipment_id: string;
  status_summary: string | null;
  total_actions: number;
  open_actions: number;
  urgent_actions: number;
  actions_detail: ActionDetail[];
  next_action: string | null;
  next_deadline: string | null;
  sentiment_trend: SentimentTrend;
  latest_sentiment: Sentiment;
  sentiment_history: SentimentEntry[];
  critical_count: number;
  high_urgency_count: number;
  unresolved_issues: string[];
  issue_count: number;
  timeline: TimelineEntry[];
  last_event_type: EventType;
  last_event_description: string | null;
  total_emails: number;
  last_email_at: string | null;
  last_email_id: string | null;
  needs_attention: boolean;
  attention_reasons: string[];
  key_dates: Record<string, string>;
}

interface ActionDetail {
  action: string;
  deadline: string | null;
  priority: string;
  source_email_id: string;
}

interface SentimentEntry {
  date: string;
  sentiment: Sentiment;
  email_id: string;
}

interface TimelineEntry {
  event_type: EventType;
  description: string | null;
  date: string;
  email_id: string;
}

interface EmailIntelligenceRow {
  email_id: string;
  sentiment: Sentiment;
  urgency: Urgency;
  has_action: boolean;
  action_summary: string | null;
  action_deadline: string | null;
  action_priority: string | null;
  event_type: EventType;
  event_description: string | null;
  one_line_summary: string | null;
  issues: string[];
  key_dates: Record<string, string>;
  created_at: string;
}

// ============================================================================
// Service
// ============================================================================

export class ShipmentIntelligenceService {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Update intelligence rollup for a shipment.
   * Call this whenever a new email is linked to a shipment.
   */
  async updateShipmentIntelligence(shipmentId: string): Promise<ShipmentIntelligence | null> {
    // Fetch all email intelligence for this shipment
    const { data: emailIntel, error } = await this.supabase
      .from('email_intelligence')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[ShipmentIntelligence] Fetch error:', error);
      return null;
    }

    if (!emailIntel || emailIntel.length === 0) {
      return null; // No intelligence data for this shipment
    }

    // Aggregate into shipment intelligence
    const intelligence = this.aggregateIntelligence(shipmentId, emailIntel);

    // Store in database
    await this.storeIntelligence(intelligence);

    return intelligence;
  }

  /**
   * Aggregate email intelligence into shipment-level rollup.
   */
  private aggregateIntelligence(
    shipmentId: string,
    emails: EmailIntelligenceRow[]
  ): ShipmentIntelligence {
    const latestEmail = emails[emails.length - 1];

    // Aggregate actions
    const actions = this.aggregateActions(emails);

    // Aggregate sentiment
    const sentiment = this.aggregateSentiment(emails);

    // Aggregate urgency
    const urgency = this.aggregateUrgency(emails);

    // Aggregate issues
    const issues = this.aggregateIssues(emails);

    // Build timeline
    const timeline = this.buildTimeline(emails);

    // Aggregate key dates
    const keyDates = this.aggregateKeyDates(emails);

    // Determine attention status
    const attention = this.determineAttention(urgency, actions, issues);

    // Generate status summary
    const statusSummary = this.generateStatusSummary(latestEmail, actions, issues);

    return {
      shipment_id: shipmentId,
      status_summary: statusSummary,
      total_actions: actions.total,
      open_actions: actions.open,
      urgent_actions: actions.urgent,
      actions_detail: actions.details,
      next_action: actions.next,
      next_deadline: actions.nextDeadline,
      sentiment_trend: sentiment.trend,
      latest_sentiment: sentiment.latest,
      sentiment_history: sentiment.history,
      critical_count: urgency.critical,
      high_urgency_count: urgency.high,
      unresolved_issues: issues.unresolved,
      issue_count: issues.count,
      timeline: timeline,
      last_event_type: latestEmail.event_type,
      last_event_description: latestEmail.event_description,
      total_emails: emails.length,
      last_email_at: latestEmail.created_at,
      last_email_id: latestEmail.email_id,
      needs_attention: attention.needs,
      attention_reasons: attention.reasons,
      key_dates: keyDates,
    };
  }

  /**
   * Aggregate action items across all emails.
   */
  private aggregateActions(emails: EmailIntelligenceRow[]): {
    total: number;
    open: number;
    urgent: number;
    details: ActionDetail[];
    next: string | null;
    nextDeadline: string | null;
  } {
    const details: ActionDetail[] = [];

    for (const email of emails) {
      if (email.has_action && email.action_summary) {
        details.push({
          action: email.action_summary,
          deadline: email.action_deadline,
          priority: email.action_priority || 'medium',
          source_email_id: email.email_id,
        });
      }
    }

    // Sort by deadline (earliest first), then by priority
    details.sort((a, b) => {
      if (a.deadline && b.deadline) {
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      }
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return (priorityOrder[a.priority as keyof typeof priorityOrder] || 1) -
             (priorityOrder[b.priority as keyof typeof priorityOrder] || 1);
    });

    const urgent = details.filter(d => d.priority === 'high').length;
    const next = details[0]?.action || null;
    const nextDeadline = details[0]?.deadline || null;

    return {
      total: details.length,
      open: details.length, // All actions considered open for now
      urgent,
      details: details.slice(0, 10), // Keep top 10
      next,
      nextDeadline,
    };
  }

  /**
   * Aggregate sentiment across all emails.
   */
  private aggregateSentiment(emails: EmailIntelligenceRow[]): {
    trend: SentimentTrend;
    latest: Sentiment;
    history: SentimentEntry[];
  } {
    const history: SentimentEntry[] = emails.map(e => ({
      date: e.created_at,
      sentiment: e.sentiment,
      email_id: e.email_id,
    }));

    const latest = emails[emails.length - 1].sentiment;

    // Calculate trend (compare first half vs second half)
    const trend = this.calculateSentimentTrend(emails);

    return { trend, latest, history: history.slice(-10) }; // Keep last 10
  }

  /**
   * Calculate sentiment trend.
   */
  private calculateSentimentTrend(emails: EmailIntelligenceRow[]): SentimentTrend {
    if (emails.length < 2) return 'unknown';

    const sentimentScore: Record<Sentiment, number> = {
      positive: 2,
      neutral: 1,
      concerned: 0,
      negative: -1,
      urgent: -1,
    };

    const midPoint = Math.floor(emails.length / 2);
    const firstHalf = emails.slice(0, midPoint);
    const secondHalf = emails.slice(midPoint);

    const firstAvg = firstHalf.reduce((sum, e) => sum + sentimentScore[e.sentiment], 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, e) => sum + sentimentScore[e.sentiment], 0) / secondHalf.length;

    const diff = secondAvg - firstAvg;

    if (diff > 0.3) return 'improving';
    if (diff < -0.3) return 'declining';
    return 'stable';
  }

  /**
   * Aggregate urgency counts.
   */
  private aggregateUrgency(emails: EmailIntelligenceRow[]): {
    critical: number;
    high: number;
  } {
    return {
      critical: emails.filter(e => e.urgency === 'critical').length,
      high: emails.filter(e => e.urgency === 'high').length,
    };
  }

  /**
   * Aggregate issues across all emails.
   */
  private aggregateIssues(emails: EmailIntelligenceRow[]): {
    unresolved: string[];
    count: number;
  } {
    const allIssues: string[] = [];

    for (const email of emails) {
      if (email.issues && email.issues.length > 0) {
        allIssues.push(...email.issues);
      }
    }

    // Deduplicate
    const unique = [...new Set(allIssues)];

    return {
      unresolved: unique.slice(0, 10), // Keep top 10
      count: unique.length,
    };
  }

  /**
   * Build timeline from email events.
   */
  private buildTimeline(emails: EmailIntelligenceRow[]): TimelineEntry[] {
    return emails
      .filter(e => e.event_type !== 'unknown' && e.event_type !== 'general_communication')
      .map(e => ({
        event_type: e.event_type,
        description: e.event_description || e.one_line_summary,
        date: e.created_at,
        email_id: e.email_id,
      }))
      .slice(-20); // Keep last 20 events
  }

  /**
   * Aggregate key dates from all emails.
   */
  private aggregateKeyDates(emails: EmailIntelligenceRow[]): Record<string, string> {
    const dates: Record<string, string> = {};

    for (const email of emails) {
      if (email.key_dates) {
        Object.assign(dates, email.key_dates);
      }
    }

    return dates;
  }

  /**
   * Determine if shipment needs attention.
   */
  private determineAttention(
    urgency: { critical: number; high: number },
    actions: { urgent: number; nextDeadline: string | null },
    issues: { count: number }
  ): { needs: boolean; reasons: string[] } {
    const reasons: string[] = [];

    if (urgency.critical > 0) {
      reasons.push(`${urgency.critical} critical urgency email(s)`);
    }

    if (actions.urgent > 0) {
      reasons.push(`${actions.urgent} high-priority action(s) pending`);
    }

    // Check if deadline is within 2 days
    if (actions.nextDeadline) {
      const deadline = new Date(actions.nextDeadline);
      const now = new Date();
      const daysUntil = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (daysUntil <= 2 && daysUntil >= 0) {
        reasons.push(`Deadline in ${Math.ceil(daysUntil)} day(s)`);
      }
    }

    if (issues.count > 0) {
      reasons.push(`${issues.count} unresolved issue(s)`);
    }

    return {
      needs: reasons.length > 0,
      reasons,
    };
  }

  /**
   * Generate one-line status summary.
   */
  private generateStatusSummary(
    latestEmail: EmailIntelligenceRow,
    actions: { open: number; next: string | null },
    issues: { count: number }
  ): string {
    const parts: string[] = [];

    // Latest event
    if (latestEmail.one_line_summary) {
      parts.push(latestEmail.one_line_summary);
    }

    // Pending actions
    if (actions.open > 0) {
      parts.push(`${actions.open} action(s) pending`);
    }

    // Issues
    if (issues.count > 0) {
      parts.push(`${issues.count} issue(s)`);
    }

    return parts.join(' | ') || 'No recent activity';
  }

  /**
   * Store intelligence in database.
   */
  private async storeIntelligence(intelligence: ShipmentIntelligence): Promise<void> {
    const { error } = await this.supabase
      .from('shipment_intelligence')
      .upsert({
        shipment_id: intelligence.shipment_id,
        status_summary: intelligence.status_summary,
        total_actions: intelligence.total_actions,
        open_actions: intelligence.open_actions,
        urgent_actions: intelligence.urgent_actions,
        actions_detail: intelligence.actions_detail,
        next_action: intelligence.next_action,
        next_deadline: intelligence.next_deadline,
        sentiment_trend: intelligence.sentiment_trend,
        latest_sentiment: intelligence.latest_sentiment,
        sentiment_history: intelligence.sentiment_history,
        critical_count: intelligence.critical_count,
        high_urgency_count: intelligence.high_urgency_count,
        unresolved_issues: intelligence.unresolved_issues,
        issue_count: intelligence.issue_count,
        timeline: intelligence.timeline,
        last_event_type: intelligence.last_event_type,
        last_event_description: intelligence.last_event_description,
        total_emails: intelligence.total_emails,
        last_email_at: intelligence.last_email_at,
        last_email_id: intelligence.last_email_id,
        needs_attention: intelligence.needs_attention,
        attention_reasons: intelligence.attention_reasons,
        key_dates: intelligence.key_dates,
      }, {
        onConflict: 'shipment_id',
      });

    if (error) {
      console.error('[ShipmentIntelligence] Store error:', error);
      throw error;
    }
  }

  /**
   * Update intelligence for all shipments with linked emails.
   */
  async updateAllShipments(): Promise<{ updated: number; errors: number }> {
    // Get all unique shipment IDs from email_intelligence
    const { data: shipmentIds } = await this.supabase
      .from('email_intelligence')
      .select('shipment_id')
      .not('shipment_id', 'is', null);

    if (!shipmentIds) return { updated: 0, errors: 0 };

    const uniqueIds = [...new Set(shipmentIds.map(s => s.shipment_id))];
    let updated = 0;
    let errors = 0;

    for (const shipmentId of uniqueIds) {
      try {
        await this.updateShipmentIntelligence(shipmentId);
        updated++;
      } catch (error) {
        console.error(`[ShipmentIntelligence] Error for ${shipmentId}:`, error);
        errors++;
      }
    }

    return { updated, errors };
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createShipmentIntelligenceService(
  supabase: SupabaseClient
): ShipmentIntelligenceService {
  return new ShipmentIntelligenceService(supabase);
}
