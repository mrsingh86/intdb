/**
 * Task Priority Service
 *
 * Calculates and recalculates task priorities based on multiple factors:
 * - Deadline urgency (25%)
 * - Financial impact (15%)
 * - Notification severity (15%)
 * - Stakeholder importance (10%)
 * - Historical patterns (10%)
 * - Document criticality (5%)
 * - Insight boost (10%) - AI-powered discovery
 * - Blocker impact (10%) - Journey tracking blockers
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  ActionTask,
  PriorityFactors,
  PriorityFactor,
  NotificationPriority,
} from '@/types/intelligence-platform';
import { InsightRepository } from '@/lib/repositories/insight-repository';

// ============================================================================
// CONSTANTS
// ============================================================================

const PRIORITY_WEIGHTS = {
  deadline_urgency: 25,           // Reduced from 30 to make room for blockers
  financial_impact: 15,
  notification_severity: 15,
  stakeholder_importance: 10,
  historical_pattern: 10,
  document_criticality: 5,
  insight_boost: 10,              // Reduced from 15 to make room for blockers
  blocker_impact: 10,             // NEW: Active blockers from journey tracking
};

const PRIORITY_THRESHOLDS = {
  critical: 85,
  high: 70,
  medium: 50,
};

// ============================================================================
// INTERFACES
// ============================================================================

export interface PriorityCalculationContext {
  basePriority?: NotificationPriority;
  dueDate?: string;
  shipmentId?: string;
  notificationId?: string;
  stakeholderId?: string;
  documentId?: string;
}

export interface PriorityResult {
  priority: NotificationPriority;
  score: number;
  factors: PriorityFactors;
}

// ============================================================================
// SERVICE
// ============================================================================

export class TaskPriorityService {
  private insightRepository: InsightRepository;

  constructor(private supabase: SupabaseClient) {
    this.insightRepository = new InsightRepository(supabase);
  }

  // --------------------------------------------------------------------------
  // MAIN CALCULATION
  // --------------------------------------------------------------------------

  async calculatePriority(context: PriorityCalculationContext): Promise<PriorityResult> {
    const factors: PriorityFactors = {
      deadline_urgency: await this.calculateDeadlineUrgency(context.dueDate),
      financial_impact: await this.calculateFinancialImpact(context.shipmentId, context.stakeholderId),
      notification_severity: await this.calculateNotificationSeverity(context.notificationId, context.basePriority),
      stakeholder_importance: await this.calculateStakeholderImportance(context.stakeholderId),
      historical_pattern: await this.calculateHistoricalPattern(context.stakeholderId),
      document_criticality: await this.calculateDocumentCriticality(context.documentId),
      insight_boost: await this.calculateInsightBoost(context.shipmentId),
      blocker_impact: await this.calculateBlockerImpact(context.shipmentId),
    };

    // Calculate weighted score
    const score = this.calculateWeightedScore(factors);

    // Determine priority level
    const priority = this.determinePriorityLevel(score);

    return { priority, score, factors };
  }

  async recalculatePriority(task: ActionTask): Promise<PriorityResult> {
    return this.calculatePriority({
      basePriority: task.priority,
      dueDate: task.due_date || undefined,
      shipmentId: task.shipment_id || undefined,
      notificationId: task.notification_id || undefined,
      stakeholderId: task.stakeholder_id || undefined,
      documentId: task.document_lifecycle_id || undefined,
    });
  }

  // --------------------------------------------------------------------------
  // FACTOR CALCULATIONS
  // --------------------------------------------------------------------------

  private async calculateDeadlineUrgency(dueDate?: string): Promise<PriorityFactor> {
    if (!dueDate) {
      return {
        score: 0,
        max: PRIORITY_WEIGHTS.deadline_urgency,
        reason: 'No deadline set',
      };
    }

    const now = new Date();
    const deadline = new Date(dueDate);
    const hoursUntilDeadline = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);

    let score = 0;
    let reason = '';

    if (hoursUntilDeadline < 0) {
      score = PRIORITY_WEIGHTS.deadline_urgency;
      reason = `Overdue by ${Math.abs(Math.floor(hoursUntilDeadline))} hours`;
    } else if (hoursUntilDeadline < 4) {
      score = PRIORITY_WEIGHTS.deadline_urgency * 0.95;
      reason = 'Due within 4 hours';
    } else if (hoursUntilDeadline < 24) {
      score = PRIORITY_WEIGHTS.deadline_urgency * 0.85;
      reason = 'Due within 24 hours';
    } else if (hoursUntilDeadline < 48) {
      score = PRIORITY_WEIGHTS.deadline_urgency * 0.7;
      reason = 'Due within 48 hours';
    } else if (hoursUntilDeadline < 72) {
      score = PRIORITY_WEIGHTS.deadline_urgency * 0.5;
      reason = 'Due within 3 days';
    } else if (hoursUntilDeadline < 168) {
      score = PRIORITY_WEIGHTS.deadline_urgency * 0.3;
      reason = 'Due within 1 week';
    } else {
      score = PRIORITY_WEIGHTS.deadline_urgency * 0.1;
      reason = 'Due in more than 1 week';
    }

    return {
      score: Math.round(score),
      max: PRIORITY_WEIGHTS.deadline_urgency,
      reason,
    };
  }

  private async calculateFinancialImpact(
    shipmentId?: string,
    stakeholderId?: string
  ): Promise<PriorityFactor> {
    if (!shipmentId && !stakeholderId) {
      return {
        score: PRIORITY_WEIGHTS.financial_impact * 0.3,
        max: PRIORITY_WEIGHTS.financial_impact,
        reason: 'No shipment or stakeholder context',
      };
    }

    let score = PRIORITY_WEIGHTS.financial_impact * 0.3;
    let reason = 'Default financial impact';

    // Check shipment value if available
    if (shipmentId) {
      const { data: shipment } = await this.supabase
        .from('shipments')
        .select('container_count, freight_charges')
        .eq('id', shipmentId)
        .single();

      if (shipment) {
        const containerCount = shipment.container_count || 1;
        const freightCharges = shipment.freight_charges || 0;

        // Higher container count = higher impact
        if (containerCount >= 10) {
          score = PRIORITY_WEIGHTS.financial_impact * 0.9;
          reason = `High volume shipment (${containerCount} containers)`;
        } else if (containerCount >= 5) {
          score = PRIORITY_WEIGHTS.financial_impact * 0.7;
          reason = `Medium volume shipment (${containerCount} containers)`;
        } else if (freightCharges > 10000) {
          score = PRIORITY_WEIGHTS.financial_impact * 0.8;
          reason = `High value shipment ($${freightCharges.toLocaleString()})`;
        }
      }
    }

    // Check customer tier if stakeholder provided
    if (stakeholderId) {
      const { data: stakeholder } = await this.supabase
        .from('parties')
        .select('is_customer, total_revenue, priority_tier')
        .eq('id', stakeholderId)
        .single();

      if (stakeholder?.is_customer) {
        const tier = stakeholder.priority_tier;
        if (tier === 'platinum') {
          score = Math.max(score, PRIORITY_WEIGHTS.financial_impact * 0.95);
          reason = 'Platinum customer';
        } else if (tier === 'gold') {
          score = Math.max(score, PRIORITY_WEIGHTS.financial_impact * 0.8);
          reason = 'Gold customer';
        } else if (stakeholder.total_revenue > 100000) {
          score = Math.max(score, PRIORITY_WEIGHTS.financial_impact * 0.7);
          reason = 'High-revenue customer';
        }
      }
    }

    return {
      score: Math.round(score),
      max: PRIORITY_WEIGHTS.financial_impact,
      reason,
    };
  }

  private async calculateNotificationSeverity(
    notificationId?: string,
    basePriority?: NotificationPriority
  ): Promise<PriorityFactor> {
    const priorityScores: Record<NotificationPriority, number> = {
      critical: 1.0,
      high: 0.75,
      medium: 0.5,
      low: 0.25,
    };

    if (notificationId) {
      const { data: notification } = await this.supabase
        .from('notifications')
        .select('priority, notification_type, urgency_score')
        .eq('id', notificationId)
        .single();

      if (notification) {
        const score = PRIORITY_WEIGHTS.notification_severity * priorityScores[notification.priority as NotificationPriority];
        const criticalTypes = ['rollover', 'customs_hold', 'vessel_omission', 'cargo_cutoff'];
        const isCriticalType = criticalTypes.includes(notification.notification_type || '');

        return {
          score: Math.round(isCriticalType ? score * 1.2 : score),
          max: PRIORITY_WEIGHTS.notification_severity,
          reason: `${notification.priority} priority ${isCriticalType ? '(critical type)' : ''} notification`,
        };
      }
    }

    if (basePriority) {
      const score = PRIORITY_WEIGHTS.notification_severity * priorityScores[basePriority];
      return {
        score: Math.round(score),
        max: PRIORITY_WEIGHTS.notification_severity,
        reason: `Base priority: ${basePriority}`,
      };
    }

    return {
      score: PRIORITY_WEIGHTS.notification_severity * 0.5,
      max: PRIORITY_WEIGHTS.notification_severity,
      reason: 'No notification context',
    };
  }

  private async calculateStakeholderImportance(stakeholderId?: string): Promise<PriorityFactor> {
    if (!stakeholderId) {
      return {
        score: PRIORITY_WEIGHTS.stakeholder_importance * 0.3,
        max: PRIORITY_WEIGHTS.stakeholder_importance,
        reason: 'No stakeholder context',
      };
    }

    const { data: stakeholder } = await this.supabase
      .from('parties')
      .select('is_customer, reliability_score, total_shipments, priority_tier')
      .eq('id', stakeholderId)
      .single();

    if (!stakeholder) {
      return {
        score: PRIORITY_WEIGHTS.stakeholder_importance * 0.3,
        max: PRIORITY_WEIGHTS.stakeholder_importance,
        reason: 'Stakeholder not found',
      };
    }

    let score = PRIORITY_WEIGHTS.stakeholder_importance * 0.3;
    let reason = 'Standard stakeholder';

    // Customer status
    if (stakeholder.is_customer) {
      score = PRIORITY_WEIGHTS.stakeholder_importance * 0.6;
      reason = 'Active customer';

      // Priority tier
      if (stakeholder.priority_tier === 'platinum') {
        score = PRIORITY_WEIGHTS.stakeholder_importance * 1.0;
        reason = 'Platinum tier customer';
      } else if (stakeholder.priority_tier === 'gold') {
        score = PRIORITY_WEIGHTS.stakeholder_importance * 0.85;
        reason = 'Gold tier customer';
      } else if (stakeholder.priority_tier === 'silver') {
        score = PRIORITY_WEIGHTS.stakeholder_importance * 0.7;
        reason = 'Silver tier customer';
      }
    }

    // High volume bonus
    if (stakeholder.total_shipments > 50) {
      score = Math.min(score * 1.1, PRIORITY_WEIGHTS.stakeholder_importance);
      reason += ' (high volume)';
    }

    return {
      score: Math.round(score),
      max: PRIORITY_WEIGHTS.stakeholder_importance,
      reason,
    };
  }

  private async calculateHistoricalPattern(stakeholderId?: string): Promise<PriorityFactor> {
    if (!stakeholderId) {
      return {
        score: PRIORITY_WEIGHTS.historical_pattern * 0.5,
        max: PRIORITY_WEIGHTS.historical_pattern,
        reason: 'No historical context',
      };
    }

    // Check for patterns like frequent delays, amendments, etc.
    const { data: metrics } = await this.supabase
      .from('stakeholder_behavior_metrics')
      .select('on_time_rate, amendment_count, avg_response_time_hours')
      .eq('party_id', stakeholderId)
      .eq('metric_period', 'quarterly')
      .order('period_start', { ascending: false })
      .limit(1)
      .single();

    if (!metrics) {
      return {
        score: PRIORITY_WEIGHTS.historical_pattern * 0.5,
        max: PRIORITY_WEIGHTS.historical_pattern,
        reason: 'No historical metrics',
      };
    }

    let score = PRIORITY_WEIGHTS.historical_pattern * 0.5;
    let reason = 'Normal patterns';

    // Poor on-time rate = prioritize their tasks
    if (metrics.on_time_rate !== null && metrics.on_time_rate < 70) {
      score = PRIORITY_WEIGHTS.historical_pattern * 0.9;
      reason = `Low on-time rate (${metrics.on_time_rate}%) - needs attention`;
    } else if (metrics.on_time_rate !== null && metrics.on_time_rate > 95) {
      score = PRIORITY_WEIGHTS.historical_pattern * 0.3;
      reason = `Excellent track record (${metrics.on_time_rate}%)`;
    }

    // Slow response time = escalate priority
    if (metrics.avg_response_time_hours !== null && metrics.avg_response_time_hours > 48) {
      score = Math.max(score, PRIORITY_WEIGHTS.historical_pattern * 0.8);
      reason = `Slow responder (${Math.round(metrics.avg_response_time_hours)}h avg)`;
    }

    return {
      score: Math.round(score),
      max: PRIORITY_WEIGHTS.historical_pattern,
      reason,
    };
  }

  private async calculateDocumentCriticality(documentId?: string): Promise<PriorityFactor> {
    if (!documentId) {
      return {
        score: PRIORITY_WEIGHTS.document_criticality * 0.3,
        max: PRIORITY_WEIGHTS.document_criticality,
        reason: 'No document context',
      };
    }

    const { data: doc } = await this.supabase
      .from('document_lifecycle')
      .select('document_type, quality_score, missing_fields')
      .eq('id', documentId)
      .single();

    if (!doc) {
      return {
        score: PRIORITY_WEIGHTS.document_criticality * 0.3,
        max: PRIORITY_WEIGHTS.document_criticality,
        reason: 'Document not found',
      };
    }

    const criticalDocs = ['bill_of_lading', 'shipping_instruction', 'customs_declaration'];
    const isCritical = criticalDocs.some(t => doc.document_type.includes(t));

    let score = isCritical
      ? PRIORITY_WEIGHTS.document_criticality * 0.8
      : PRIORITY_WEIGHTS.document_criticality * 0.4;

    let reason = isCritical ? 'Critical document type' : 'Standard document';

    // Quality issues
    if (doc.quality_score !== null && doc.quality_score < 60) {
      score = Math.min(score * 1.3, PRIORITY_WEIGHTS.document_criticality);
      reason += ' (quality issues)';
    }

    if (doc.missing_fields && doc.missing_fields.length > 0) {
      score = Math.min(score * 1.2, PRIORITY_WEIGHTS.document_criticality);
      reason += ` (${doc.missing_fields.length} missing fields)`;
    }

    return {
      score: Math.round(score),
      max: PRIORITY_WEIGHTS.document_criticality,
      reason,
    };
  }

  private async calculateInsightBoost(shipmentId?: string): Promise<PriorityFactor> {
    if (!shipmentId) {
      return {
        score: 0,
        max: PRIORITY_WEIGHTS.insight_boost,
        reason: 'No shipment context for insights',
      };
    }

    try {
      // Get active insights for this shipment
      const insights = await this.insightRepository.findByShipmentId(shipmentId, true);

      if (insights.length === 0) {
        return {
          score: 0,
          max: PRIORITY_WEIGHTS.insight_boost,
          reason: 'No active insights',
        };
      }

      // Calculate boost based on insight severities
      let boost = 0;
      const reasons: string[] = [];

      const critical = insights.filter(i => i.severity === 'critical');
      const high = insights.filter(i => i.severity === 'high');
      const medium = insights.filter(i => i.severity === 'medium');

      if (critical.length > 0) {
        boost += PRIORITY_WEIGHTS.insight_boost * 0.6;
        reasons.push(`${critical.length} critical insight(s)`);
      }

      if (high.length > 0) {
        boost += Math.min(PRIORITY_WEIGHTS.insight_boost * 0.3, PRIORITY_WEIGHTS.insight_boost - boost);
        reasons.push(`${high.length} high insight(s)`);
      }

      if (medium.length > 0) {
        boost += Math.min(PRIORITY_WEIGHTS.insight_boost * 0.1, PRIORITY_WEIGHTS.insight_boost - boost);
        reasons.push(`${medium.length} medium insight(s)`);
      }

      // Cap at max weight
      boost = Math.min(boost, PRIORITY_WEIGHTS.insight_boost);

      return {
        score: Math.round(boost),
        max: PRIORITY_WEIGHTS.insight_boost,
        reason: reasons.join(', ') || 'AI-detected patterns',
      };
    } catch (error) {
      // Insights are optional - don't fail priority calculation
      console.warn('Failed to fetch insights for priority:', error);
      return {
        score: 0,
        max: PRIORITY_WEIGHTS.insight_boost,
        reason: 'Insights unavailable',
      };
    }
  }

  /**
   * Calculate priority boost from active blockers (Journey Tracking)
   * Critical blockers = high boost, more blockers = higher boost
   */
  private async calculateBlockerImpact(shipmentId?: string): Promise<PriorityFactor> {
    if (!shipmentId) {
      return {
        score: 0,
        max: PRIORITY_WEIGHTS.blocker_impact,
        reason: 'No shipment context for blockers',
      };
    }

    try {
      // Fetch active (unresolved) blockers for this shipment
      const { data: blockers, error } = await this.supabase
        .from('shipment_blockers')
        .select('id, severity, blocker_type, blocked_since')
        .eq('shipment_id', shipmentId)
        .eq('is_resolved', false);

      if (error) {
        console.warn('Failed to fetch blockers:', error);
        return {
          score: 0,
          max: PRIORITY_WEIGHTS.blocker_impact,
          reason: 'Blockers unavailable',
        };
      }

      if (!blockers || blockers.length === 0) {
        return {
          score: 0,
          max: PRIORITY_WEIGHTS.blocker_impact,
          reason: 'No active blockers',
        };
      }

      // Calculate score based on blocker severity
      // critical = 100%, high = 70%, medium = 40%, low = 15%
      let totalWeight = 0;
      const reasons: string[] = [];

      const critical = blockers.filter(b => b.severity === 'critical');
      const high = blockers.filter(b => b.severity === 'high');
      const medium = blockers.filter(b => b.severity === 'medium');
      const low = blockers.filter(b => b.severity === 'low');

      if (critical.length > 0) {
        totalWeight += critical.length * 1.0;
        reasons.push(`${critical.length} critical`);
      }
      if (high.length > 0) {
        totalWeight += high.length * 0.7;
        reasons.push(`${high.length} high`);
      }
      if (medium.length > 0) {
        totalWeight += medium.length * 0.4;
        reasons.push(`${medium.length} medium`);
      }
      if (low.length > 0) {
        totalWeight += low.length * 0.15;
      }

      // Check for long-standing blockers (duration boost)
      const now = Date.now();
      const oldBlockers = blockers.filter(b => {
        const blockedSince = new Date(b.blocked_since).getTime();
        const hoursBlocked = (now - blockedSince) / (1000 * 60 * 60);
        return hoursBlocked > 24; // More than 24 hours
      });

      if (oldBlockers.length > 0) {
        totalWeight += 0.3; // Duration boost
        reasons.push('blocker >24h');
      }

      // Calculate final score (cap at max weight, scale for multiple blockers)
      const score = Math.min(
        Math.round(totalWeight * (PRIORITY_WEIGHTS.blocker_impact / 2)),
        PRIORITY_WEIGHTS.blocker_impact
      );

      return {
        score,
        max: PRIORITY_WEIGHTS.blocker_impact,
        reason: `${blockers.length} blocker(s): ${reasons.join(', ')}`,
      };
    } catch (error) {
      console.warn('Failed to calculate blocker impact:', error);
      return {
        score: 0,
        max: PRIORITY_WEIGHTS.blocker_impact,
        reason: 'Blocker check failed',
      };
    }
  }

  // --------------------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------------------

  private calculateWeightedScore(factors: PriorityFactors): number {
    const total =
      factors.deadline_urgency.score +
      factors.financial_impact.score +
      factors.notification_severity.score +
      factors.stakeholder_importance.score +
      factors.historical_pattern.score +
      factors.document_criticality.score +
      (factors.insight_boost?.score || 0) +
      (factors.blocker_impact?.score || 0);  // NEW: Journey blockers

    // Normalize to 0-100
    return Math.round(total);
  }

  private determinePriorityLevel(score: number): NotificationPriority {
    if (score >= PRIORITY_THRESHOLDS.critical) return 'critical';
    if (score >= PRIORITY_THRESHOLDS.high) return 'high';
    if (score >= PRIORITY_THRESHOLDS.medium) return 'medium';
    return 'low';
  }

  // --------------------------------------------------------------------------
  // BATCH RECALCULATION
  // --------------------------------------------------------------------------

  async recalculateAllActiveTasks(): Promise<{
    updated: number;
    errors: string[];
  }> {
    let updated = 0;
    const errors: string[] = [];

    const { data: tasks, error } = await this.supabase
      .from('action_tasks')
      .select('*')
      .not('status', 'in', '("completed","dismissed")')
      .order('updated_at', { ascending: true })
      .limit(100);

    if (error) {
      errors.push(`Failed to fetch tasks: ${error.message}`);
      return { updated, errors };
    }

    for (const task of tasks || []) {
      try {
        const { priority, score, factors } = await this.recalculatePriority(task);

        // Only update if priority or score changed significantly
        if (priority !== task.priority || Math.abs(score - task.priority_score) > 5) {
          await this.supabase
            .from('action_tasks')
            .update({
              priority,
              priority_score: score,
              priority_factors: factors,
              updated_at: new Date().toISOString(),
            })
            .eq('id', task.id);

          updated++;
        }
      } catch (err) {
        errors.push(`Task ${task.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    return { updated, errors };
  }
}
