/**
 * Insight AI Analyzer
 *
 * Stage 3 of the Insight Engine pipeline.
 * Uses Claude to discover non-obvious patterns that rules can't catch.
 *
 * Discovers:
 * - Correlations across data points
 * - Anomalies in behavior vs baselines
 * - Predictive signals from history
 * - Recommendations for specific actions
 *
 * Principles:
 * - Single Responsibility: Only AI analysis
 * - Fail Gracefully: Returns empty result on failure
 * - Cost Conscious: Only called when needed
 */

import Anthropic from '@anthropic-ai/sdk';
import {
  InsightContext,
  AIInsight,
  AIInsightResult,
  InsightSeverity,
  InsightType,
} from '@/types/insight';

// ============================================================================
// CONSTANTS
// ============================================================================

const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 2000;
const TEMPERATURE = 0.3; // Slightly creative for discovery

// ============================================================================
// PROMPT TEMPLATE
// ============================================================================

const AI_INSIGHT_PROMPT = `You are an expert freight forwarding operations analyst. Analyze this shipment context and discover insights that would help an operations team prioritize their work.

## SHIPMENT CONTEXT
{context_json}

## YOUR TASK
Analyze this data and identify:

1. **HIDDEN RISKS** - Problems that aren't immediately obvious but could cause issues
   - Look for: unusual patterns, timeline conflicts, stakeholder behavior anomalies

2. **CROSS-SHIPMENT IMPACTS** - How this shipment relates to others
   - Look for: capacity issues, shared deadlines, customer exposure

3. **PREDICTIVE SIGNALS** - What's likely to happen based on history
   - Look for: stakeholder past behavior, route patterns, carrier trends

4. **RECOMMENDED ACTIONS** - Specific steps to take
   - Be concrete: "Call shipper about SI" not "Follow up"

## OUTPUT FORMAT
Return ONLY valid JSON (no markdown, no explanation):
{
  "insights": [
    {
      "type": "risk|pattern|prediction|recommendation",
      "severity": "critical|high|medium|low",
      "title": "Short title (max 10 words)",
      "description": "Detailed explanation with specific data points",
      "action": "Specific recommended action if applicable",
      "confidence": 0.0-1.0,
      "supporting_data": {}
    }
  ],
  "priority_boost": 0-30,
  "priority_boost_reason": "Why priority should be boosted"
}

## GUIDELINES
- Be SPECIFIC - use actual numbers, dates, names from the context
- Focus on ACTIONABLE insights - what can the team DO about it?
- Prioritize DISCOVERIES - things not obvious from a quick glance
- Include CONFIDENCE - how sure are you about this insight?
- Maximum 5 insights - quality over quantity
- Return ONLY the JSON object, nothing else`;

// ============================================================================
// TYPES
// ============================================================================

interface PreparedContext {
  shipment: {
    booking_number: string | null;
    bl_number: string | null;
    status: string;
    workflow_phase: string | null;
    days_to_etd: number | null;
    days_to_eta: number | null;
    days_to_si_cutoff: number | null;
    days_to_vgm_cutoff: number | null;
    days_to_cargo_cutoff: number | null;
    port_of_loading: string | null;
    port_of_discharge: string | null;
    carrier_name: string | null;
    vessel_name: string | null;
  };
  shipper: {
    name: string;
    reliability_score: number | null;
    avg_response_hours: number | null;
    total_shipments: number;
    is_customer: boolean;
    customer_tier: string | null;
    recent_issues: string[];
  } | null;
  consignee: {
    name: string;
    reliability_score: number | null;
    total_shipments: number;
  } | null;
  carrier: {
    name: string;
    rollover_rate_30d: number | null;
    on_time_rate: number | null;
    total_bookings_30d: number;
  } | null;
  documents: {
    received_count: number;
    received_types: string[];
    missing_types: string[];
    quality_issues_count: number;
    amendment_count_7d: number;
  };
  related_shipments: {
    same_shipper_active: number;
    same_consignee_active: number;
    same_week_arrivals: number;
  };
  history: {
    shipper_avg_si_delay_days: number | null;
    carrier_rollover_rate: number | null;
    route_avg_delay_days: number | null;
  };
  communication: {
    days_since_shipper_response: number | null;
    days_since_last_communication: number | null;
    unanswered_emails: number;
  };
  notifications: {
    pending_count: number;
    recent_critical_count: number;
  };
}

// ============================================================================
// AI ANALYZER SERVICE
// ============================================================================

export class InsightAIAnalyzer {
  private anthropic: Anthropic;

  constructor(apiKey: string) {
    this.anthropic = new Anthropic({ apiKey });
  }

  /**
   * Analyze context with Claude to discover insights
   */
  async analyzeContext(context: InsightContext): Promise<AIInsightResult> {
    try {
      const preparedContext = this.prepareContextForAI(context);
      const prompt = AI_INSIGHT_PROMPT.replace(
        '{context_json}',
        JSON.stringify(preparedContext, null, 2)
      );

      const response = await this.anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      return this.parseResponse(text);
    } catch (error) {
      console.error('AI analysis failed:', error);
      return this.emptyResult();
    }
  }

  /**
   * Check if AI analysis should run based on context
   * (Cost optimization - only run when valuable)
   */
  shouldRunAnalysis(context: InsightContext, rulesMatchCount: number): boolean {
    // Always run if critical patterns detected by rules
    if (rulesMatchCount > 0) {
      return true;
    }

    // Run if high-value shipment
    if (context.stakeholders.shipper?.customer_tier === 'platinum') {
      return true;
    }

    // Run if complex situation (many related shipments)
    if (
      context.related.same_shipper_active.length >= 5 ||
      context.related.same_consignee_active.length >= 3
    ) {
      return true;
    }

    // Run if near deadlines
    const daysToEtd = this.daysBetween(new Date(), context.shipment.dates.etd);
    if (daysToEtd !== null && daysToEtd <= 7 && daysToEtd >= 0) {
      return true;
    }

    // Skip for simple cases
    return false;
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  private prepareContextForAI(context: InsightContext): PreparedContext {
    const now = new Date();

    return {
      shipment: {
        booking_number: context.shipment.booking_number,
        bl_number: context.shipment.bl_number,
        status: context.shipment.status,
        workflow_phase: context.shipment.workflow_phase,
        days_to_etd: this.daysBetween(now, context.shipment.dates.etd),
        days_to_eta: this.daysBetween(now, context.shipment.dates.eta),
        days_to_si_cutoff: this.daysBetween(now, context.shipment.dates.si_cutoff),
        days_to_vgm_cutoff: this.daysBetween(now, context.shipment.dates.vgm_cutoff),
        days_to_cargo_cutoff: this.daysBetween(now, context.shipment.dates.cargo_cutoff),
        port_of_loading: context.shipment.port_of_loading,
        port_of_discharge: context.shipment.port_of_discharge,
        carrier_name: context.shipment.carrier_name,
        vessel_name: context.shipment.vessel_name,
      },
      shipper: context.stakeholders.shipper
        ? {
            name: context.stakeholders.shipper.name,
            reliability_score: context.stakeholders.shipper.reliability_score,
            avg_response_hours: context.stakeholders.shipper.response_time_avg_hours,
            total_shipments: context.stakeholders.shipper.total_shipments,
            is_customer: context.stakeholders.shipper.is_customer,
            customer_tier: context.stakeholders.shipper.customer_tier,
            recent_issues: context.stakeholders.shipper.recent_issues,
          }
        : null,
      consignee: context.stakeholders.consignee
        ? {
            name: context.stakeholders.consignee.name,
            reliability_score: context.stakeholders.consignee.reliability_score,
            total_shipments: context.stakeholders.consignee.total_shipments,
          }
        : null,
      carrier: context.stakeholders.carrier
        ? {
            name: context.stakeholders.carrier.name,
            rollover_rate_30d: context.stakeholders.carrier.rollover_rate_30d,
            on_time_rate: context.stakeholders.carrier.on_time_rate,
            total_bookings_30d: context.stakeholders.carrier.total_bookings_30d,
          }
        : null,
      documents: {
        received_count: context.documents.received.length,
        received_types: context.documents.received.map((d) => d.document_type),
        missing_types: context.documents.missing,
        quality_issues_count: context.documents.quality_issues.length,
        amendment_count_7d: context.documents.recent_amendments.length,
      },
      related_shipments: {
        same_shipper_active: context.related.same_shipper_active.length,
        same_consignee_active: context.related.same_consignee_active.length,
        same_week_arrivals: context.related.same_week_arrivals.length,
      },
      history: {
        shipper_avg_si_delay_days: context.history.shipper_avg_si_delay_days,
        carrier_rollover_rate: context.history.carrier_rollover_rate_30d,
        route_avg_delay_days: context.history.route_avg_delay_days,
      },
      communication: {
        days_since_shipper_response: this.daysSince(
          context.communications.last_response_from_shipper
        ),
        days_since_last_communication: context.communications.days_since_last_communication,
        unanswered_emails: context.communications.unanswered_emails_count,
      },
      notifications: {
        pending_count: context.notifications.pending.length,
        recent_critical_count: context.notifications.recent_critical.length,
      },
    };
  }

  private parseResponse(text: string): AIInsightResult {
    try {
      // Extract JSON from response (handles potential markdown wrapping)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.warn('AI response did not contain valid JSON');
        return this.emptyResult();
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate and normalize insights
      const insights: AIInsight[] = (parsed.insights || [])
        .slice(0, 5)
        .map((i: any) => ({
          type: this.normalizeType(i.type),
          severity: this.normalizeSeverity(i.severity),
          title: String(i.title || '').slice(0, 100),
          description: String(i.description || ''),
          action: i.action ? String(i.action) : null,
          confidence: Math.min(1, Math.max(0, Number(i.confidence) || 0.5)),
          supporting_data: i.supporting_data || {},
        }));

      return {
        insights,
        priority_boost: Math.min(30, Math.max(0, Number(parsed.priority_boost) || 0)),
        priority_boost_reason: String(parsed.priority_boost_reason || ''),
      };
    } catch (error) {
      console.error('Failed to parse AI response:', error);
      return this.emptyResult();
    }
  }

  private normalizeType(type: string): InsightType {
    const validTypes: InsightType[] = ['risk', 'pattern', 'prediction', 'recommendation'];
    const normalized = String(type).toLowerCase();
    return validTypes.includes(normalized as InsightType)
      ? (normalized as InsightType)
      : 'pattern';
  }

  private normalizeSeverity(severity: string): InsightSeverity {
    const validSeverities: InsightSeverity[] = ['critical', 'high', 'medium', 'low'];
    const normalized = String(severity).toLowerCase();
    return validSeverities.includes(normalized as InsightSeverity)
      ? (normalized as InsightSeverity)
      : 'medium';
  }

  private emptyResult(): AIInsightResult {
    return {
      insights: [],
      priority_boost: 0,
      priority_boost_reason: '',
    };
  }

  private daysBetween(date1: Date, date2: Date | null): number | null {
    if (!date2) return null;
    return Math.round((date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24));
  }

  private daysSince(date: Date | null): number | null {
    if (!date) return null;
    return Math.round((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

export function createInsightAIAnalyzer(apiKey: string): InsightAIAnalyzer {
  return new InsightAIAnalyzer(apiKey);
}
