/**
 * Insight Generation Service
 *
 * Generates AI-powered insights for tasks explaining:
 * - Why the task is recommended
 * - Risk assessment
 * - Historical patterns
 * - Stakeholder context
 * - Deadline impact
 * - Financial impact
 * - Suggested actions
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { TaskRepository } from '@/lib/repositories/task-repository';
import {
  ActionTask,
  TaskInsight,
  InsightType,
  PriorityFactors,
} from '@/types/intelligence-platform';

// ============================================================================
// INTERFACES
// ============================================================================

export interface InsightContext {
  task: ActionTask;
  shipment?: {
    booking_number: string;
    vessel_name?: string;
    carrier_name?: string;
    etd?: string;
    eta?: string;
    origin_port?: string;
    destination_port?: string;
    container_count?: number;
  };
  notification?: {
    title: string;
    priority: string;
    notification_type?: string;
    summary?: string;
  };
  stakeholder?: {
    party_name: string;
    party_type: string;
    is_customer: boolean;
    reliability_score?: number;
    total_shipments?: number;
    priority_tier?: string;
  };
}

// ============================================================================
// SERVICE
// ============================================================================

export class InsightGenerationService {
  private repository: TaskRepository;

  constructor(private supabase: SupabaseClient) {
    this.repository = new TaskRepository(supabase);
  }

  // --------------------------------------------------------------------------
  // MAIN GENERATION
  // --------------------------------------------------------------------------

  async generateInsightsForTask(taskId: string): Promise<TaskInsight[]> {
    const task = await this.repository.findById(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const context = await this.buildContext(task);
    const insights: TaskInsight[] = [];

    // Generate different types of insights
    const insightGenerators = [
      this.generateWhyRecommended.bind(this),
      this.generateRiskAssessment.bind(this),
      this.generateDeadlineImpact.bind(this),
      this.generateStakeholderContext.bind(this),
      this.generateSuggestedAction.bind(this),
    ];

    for (const generator of insightGenerators) {
      try {
        const insight = await generator(context);
        if (insight) {
          const saved = await this.repository.createInsight({
            task_id: taskId,
            ...insight,
            generated_at: new Date().toISOString(),
          });
          insights.push(saved);
        }
      } catch (err) {
        console.error(`Failed to generate insight: ${err}`);
      }
    }

    return insights;
  }

  // --------------------------------------------------------------------------
  // INSIGHT GENERATORS
  // --------------------------------------------------------------------------

  private async generateWhyRecommended(
    context: InsightContext
  ): Promise<Omit<TaskInsight, 'id' | 'task_id' | 'created_at' | 'generated_at'> | null> {
    const { task } = context;
    const factors = task.priority_factors;

    // Build explanation based on priority factors
    const reasons: string[] = [];

    if (factors.deadline_urgency.score >= factors.deadline_urgency.max * 0.7) {
      reasons.push(`**Deadline urgency**: ${factors.deadline_urgency.reason}`);
    }

    if (factors.financial_impact.score >= factors.financial_impact.max * 0.7) {
      reasons.push(`**Financial impact**: ${factors.financial_impact.reason}`);
    }

    if (factors.notification_severity.score >= factors.notification_severity.max * 0.7) {
      reasons.push(`**Notification severity**: ${factors.notification_severity.reason}`);
    }

    if (factors.stakeholder_importance.score >= factors.stakeholder_importance.max * 0.7) {
      reasons.push(`**Stakeholder importance**: ${factors.stakeholder_importance.reason}`);
    }

    if (reasons.length === 0) {
      reasons.push('This task was generated based on standard workflow triggers.');
    }

    const content = `This task has a priority score of **${task.priority_score}/100** (${task.priority.toUpperCase()}) because:\n\n${reasons.join('\n\n')}`;

    return {
      insight_type: 'why_recommended',
      title: 'Why This Task Is Prioritized',
      content,
      supporting_data: {
        priority_score: task.priority_score,
        priority: task.priority,
        factors: this.summarizeFactors(factors),
      },
      confidence_score: 95,
    };
  }

  private async generateRiskAssessment(
    context: InsightContext
  ): Promise<Omit<TaskInsight, 'id' | 'task_id' | 'created_at' | 'generated_at'> | null> {
    const { task, shipment, stakeholder } = context;
    const risks: string[] = [];
    let riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'low';

    // Deadline risk
    if (task.due_date) {
      const hoursUntilDue = (new Date(task.due_date).getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilDue < 0) {
        risks.push('⚠️ **OVERDUE**: This deadline has passed. Immediate action required.');
        riskLevel = 'critical';
      } else if (hoursUntilDue < 24) {
        risks.push('⚠️ **Urgent**: Less than 24 hours until deadline.');
        riskLevel = 'high';
      }
    }

    // Shipment risk
    if (shipment) {
      if (shipment.container_count && shipment.container_count >= 5) {
        risks.push(`📦 High-volume shipment with ${shipment.container_count} containers at stake.`);
        riskLevel = riskLevel === 'low' ? 'medium' : riskLevel;
      }
    }

    // Stakeholder risk
    if (stakeholder) {
      if (stakeholder.reliability_score !== undefined && stakeholder.reliability_score < 70) {
        risks.push(`⚡ Stakeholder has low reliability score (${stakeholder.reliability_score}%). Extra follow-up may be needed.`);
        riskLevel = riskLevel === 'low' ? 'medium' : riskLevel;
      }
      if (stakeholder.is_customer && stakeholder.priority_tier === 'platinum') {
        risks.push('⭐ Platinum customer - any delays may impact relationship.');
        riskLevel = riskLevel === 'low' ? 'medium' : riskLevel;
      }
    }

    // Notification risk
    if (context.notification?.notification_type) {
      const criticalTypes = ['rollover', 'customs_hold', 'vessel_omission'];
      if (criticalTypes.includes(context.notification.notification_type)) {
        risks.push(`🚨 ${context.notification.notification_type.replace(/_/g, ' ').toUpperCase()} notifications require immediate attention.`);
        riskLevel = riskLevel !== 'critical' ? 'high' : 'critical';
      }
    }

    if (risks.length === 0) {
      return null; // No significant risks
    }

    const riskEmoji = {
      low: '🟢',
      medium: '🟡',
      high: '🟠',
      critical: '🔴',
    };

    return {
      insight_type: 'risk_assessment',
      title: `Risk Assessment: ${riskEmoji[riskLevel]} ${riskLevel.toUpperCase()}`,
      content: risks.join('\n\n'),
      supporting_data: {
        risk_level: riskLevel,
        risk_count: risks.length,
      },
      confidence_score: 85,
    };
  }

  private async generateDeadlineImpact(
    context: InsightContext
  ): Promise<Omit<TaskInsight, 'id' | 'task_id' | 'created_at' | 'generated_at'> | null> {
    const { task, shipment } = context;

    if (!task.due_date) {
      return null;
    }

    const dueDate = new Date(task.due_date);
    const now = new Date();
    const hoursUntilDue = (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    let impact: string;
    if (hoursUntilDue < 0) {
      impact = `This deadline passed **${Math.abs(Math.round(hoursUntilDue))} hours ago**. Missing this deadline may result in:\n\n- Additional carrier fees\n- Shipment delays\n- Customer dissatisfaction`;
    } else if (hoursUntilDue < 24) {
      impact = `Only **${Math.round(hoursUntilDue)} hours** remaining until deadline.\n\nAction is needed today to avoid:\n- Late submission penalties\n- Risk of rollover\n- Downstream delays`;
    } else if (hoursUntilDue < 72) {
      const days = Math.round(hoursUntilDue / 24);
      impact = `**${days} day${days > 1 ? 's' : ''}** until deadline.\n\nRecommended: Start working on this task today to allow time for:\n- Document review and corrections\n- Stakeholder approvals\n- Unexpected issues`;
    } else {
      return null; // No urgent deadline impact
    }

    if (shipment) {
      impact += `\n\n**Shipment context**: ${shipment.booking_number}${shipment.vessel_name ? ` on ${shipment.vessel_name}` : ''}`;
    }

    return {
      insight_type: 'deadline_impact',
      title: 'Deadline Impact Analysis',
      content: impact,
      supporting_data: {
        due_date: task.due_date,
        hours_remaining: Math.round(hoursUntilDue),
        is_overdue: hoursUntilDue < 0,
      },
      confidence_score: 95,
    };
  }

  private async generateStakeholderContext(
    context: InsightContext
  ): Promise<Omit<TaskInsight, 'id' | 'task_id' | 'created_at' | 'generated_at'> | null> {
    const { stakeholder } = context;

    if (!stakeholder) {
      return null;
    }

    const details: string[] = [];

    details.push(`**${stakeholder.party_name}** (${stakeholder.party_type.replace(/_/g, ' ')})`);

    if (stakeholder.is_customer) {
      const tier = stakeholder.priority_tier
        ? `${stakeholder.priority_tier.charAt(0).toUpperCase()}${stakeholder.priority_tier.slice(1)}`
        : 'Standard';
      details.push(`\n🏢 **Customer Status**: ${tier} tier customer`);
    }

    if (stakeholder.total_shipments !== undefined) {
      details.push(`📊 **History**: ${stakeholder.total_shipments} shipments`);
    }

    if (stakeholder.reliability_score !== undefined) {
      const emoji = stakeholder.reliability_score >= 90 ? '🟢' :
                    stakeholder.reliability_score >= 70 ? '🟡' : '🔴';
      details.push(`${emoji} **Reliability Score**: ${stakeholder.reliability_score}/100`);
    }

    return {
      insight_type: 'stakeholder_context',
      title: 'Stakeholder Profile',
      content: details.join('\n'),
      supporting_data: {
        party_name: stakeholder.party_name,
        party_type: stakeholder.party_type,
        is_customer: stakeholder.is_customer,
        reliability_score: stakeholder.reliability_score,
      },
      confidence_score: 90,
    };
  }

  private async generateSuggestedAction(
    context: InsightContext
  ): Promise<Omit<TaskInsight, 'id' | 'task_id' | 'created_at' | 'generated_at'> | null> {
    const { task, notification } = context;

    const suggestions: string[] = [];

    // Based on task category
    switch (task.category) {
      case 'deadline':
        suggestions.push('1. Review current documentation status');
        suggestions.push('2. Contact relevant stakeholders for missing information');
        suggestions.push('3. Submit before cutoff time');
        suggestions.push('4. Confirm receipt with carrier');
        break;

      case 'notification':
        if (notification?.notification_type === 'rollover') {
          suggestions.push('1. Review rollover details and new schedule');
          suggestions.push('2. Assess impact on downstream operations');
          suggestions.push('3. Notify customer of schedule change');
          suggestions.push('4. Update internal systems with new dates');
        } else if (notification?.notification_type === 'customs_hold') {
          suggestions.push('1. Contact customs broker immediately');
          suggestions.push('2. Gather required documentation');
          suggestions.push('3. Respond to customs query');
          suggestions.push('4. Monitor clearance status');
        } else {
          suggestions.push('1. Review notification details');
          suggestions.push('2. Assess required action');
          suggestions.push('3. Communicate with stakeholders');
          suggestions.push('4. Mark task as completed');
        }
        break;

      case 'document':
        suggestions.push('1. Download and review document');
        suggestions.push('2. Verify against source data');
        suggestions.push('3. Flag any discrepancies');
        suggestions.push('4. Forward to relevant parties');
        break;

      default:
        suggestions.push('1. Review task requirements');
        suggestions.push('2. Complete required action');
        suggestions.push('3. Update status');
        suggestions.push('4. Close task with notes');
    }

    return {
      insight_type: 'suggested_action',
      title: 'Recommended Steps',
      content: suggestions.join('\n'),
      supporting_data: {
        category: task.category,
        step_count: suggestions.length,
      },
      confidence_score: 80,
    };
  }

  // --------------------------------------------------------------------------
  // HELPERS
  // --------------------------------------------------------------------------

  private async buildContext(task: ActionTask): Promise<InsightContext> {
    const context: InsightContext = { task };

    // Fetch shipment details
    if (task.shipment_id) {
      const { data: shipment } = await this.supabase
        .from('shipments')
        .select(`
          booking_number,
          vessel_name,
          etd,
          eta,
          origin_port,
          destination_port,
          container_count,
          carrier:carriers(carrier_name)
        `)
        .eq('id', task.shipment_id)
        .single();

      if (shipment) {
        context.shipment = {
          ...shipment,
          carrier_name: (shipment.carrier as { carrier_name?: string })?.carrier_name,
        };
      }
    }

    // Fetch notification details
    if (task.notification_id) {
      const { data: notification } = await this.supabase
        .from('notifications')
        .select('title, priority, notification_type, summary')
        .eq('id', task.notification_id)
        .single();

      if (notification) {
        context.notification = notification;
      }
    }

    // Fetch stakeholder details
    if (task.stakeholder_id) {
      const { data: stakeholder } = await this.supabase
        .from('parties')
        .select('party_name, party_type, is_customer, reliability_score, total_shipments, priority_tier')
        .eq('id', task.stakeholder_id)
        .single();

      if (stakeholder) {
        context.stakeholder = stakeholder;
      }
    }

    return context;
  }

  private summarizeFactors(factors: PriorityFactors): Record<string, string> {
    return {
      deadline_urgency: `${factors.deadline_urgency.score}/${factors.deadline_urgency.max}`,
      financial_impact: `${factors.financial_impact.score}/${factors.financial_impact.max}`,
      notification_severity: `${factors.notification_severity.score}/${factors.notification_severity.max}`,
      stakeholder_importance: `${factors.stakeholder_importance.score}/${factors.stakeholder_importance.max}`,
      historical_pattern: `${factors.historical_pattern.score}/${factors.historical_pattern.max}`,
      document_criticality: `${factors.document_criticality.score}/${factors.document_criticality.max}`,
    };
  }
}
