/**
 * HaikuSummaryService - Intelligent Story Telling
 *
 * Two-part architecture:
 * 1. STORY SAVING: Chronicle captures events as they happen
 * 2. STORY TELLING: AI synthesizes full context into actionable narrative
 *
 * Tiered Data Strategy:
 * - Layer 1: Shipment Context (dates, cutoffs, routing, parties)
 * - Layer 2: Key Milestones (all-time: issues, amendments, stage changes)
 * - Layer 3: Recent Detail (7 days: all communications)
 * - Layer 4: Date-Derived Urgency (computed from deadlines vs today)
 *
 * Cost: ~$0.001 per shipment with full context
 */

import Anthropic from '@anthropic-ai/sdk';
import { SupabaseClient } from '@supabase/supabase-js';

// =============================================================================
// TYPES
// =============================================================================

interface ShipmentContext {
  id: string;
  booking_number: string | null;
  mbl_number: string | null;
  hbl_number: string | null;
  // Routing
  port_of_loading: string | null;
  port_of_loading_code: string | null;
  port_of_discharge: string | null;
  port_of_discharge_code: string | null;
  // Schedule
  vessel_name: string | null;
  voyage_number: string | null;
  carrier_name: string | null;
  etd: string | null;
  eta: string | null;
  atd: string | null; // Actual departure
  ata: string | null; // Actual arrival
  // Cutoffs
  si_cutoff: string | null;
  vgm_cutoff: string | null;
  cargo_cutoff: string | null;
  // Status
  stage: string | null;
  status: string | null;
  // Parties
  shipper_name: string | null;
  consignee_name: string | null;
  // Containers
  containers: string[];
  // Timestamps
  created_at: string | null;
}

interface MilestoneEvent {
  occurred_at: string;
  event_type: string;
  from_party: string | null;
  summary: string;
  has_issue: boolean;
  issue_type: string | null;
  issue_description: string | null;
  carrier_name: string | null;
}

interface RecentChronicle {
  occurred_at: string;
  direction: string;
  from_party: string;
  from_address: string | null;
  message_type: string;
  summary: string;
  has_issue: boolean;
  issue_type: string | null;
  issue_description: string | null;
  has_action: boolean;
  action_description: string | null;
  action_priority: string | null;
  action_deadline: string | null;
  action_completed_at: string | null;
  carrier_name: string | null;
  sentiment: string | null;
}

interface DateUrgency {
  type: 'cutoff' | 'schedule' | 'stale' | 'overdue';
  label: string;
  daysRemaining: number;
  severity: 'critical' | 'warning' | 'info';
}

interface ShipperProfileContext {
  shipperName: string;
  totalShipments: number;
  avgSiDaysBeforeCutoff: number | null;
  siLateRate: number | null;
  docIssueRate: number | null;
  issueRate: number | null;
  riskScore: number;
  riskFactors: string[];
  preferredCarriers: string[];
  commonIssueTypes: string[];
  relationshipMonths: number;
}

export interface AISummary {
  story: string;
  currentBlocker: string | null;
  blockerOwner: string | null;
  nextAction: string | null;
  actionOwner: string | null;
  actionPriority: 'critical' | 'high' | 'medium' | 'low' | null;
  financialImpact: string | null;
  customerImpact: string | null;
  riskLevel: 'red' | 'amber' | 'green';
  riskReason: string | null;
}

export interface GenerationResult {
  summary: AISummary;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  chronicleCount: number;
}

// =============================================================================
// INTELLIGENT STORYTELLER PROMPT
// =============================================================================

const SYSTEM_PROMPT = `You are an intelligent freight operations storyteller at Intoglo (an NVOCC).

Your job: Transform raw shipment data into a clear, actionable narrative.

## YOUR AUDIENCE
- Operations Manager: "What do I need to do TODAY?"
- Customer Success: "What should I tell the customer?"
- Finance: "What costs are at risk?"
- Executive: "Is this shipment healthy?"

## STORYTELLING RULES

1. **BE SPECIFIC** - Use actual names, dates, amounts
   ❌ "The carrier reported a delay"
   ✅ "Hapag-Lloyd reported 3-day delay on Jan 10"

2. **DERIVE URGENCY FROM DATES** - Even without new emails
   ❌ "Cutoff is approaching"
   ✅ "SI cutoff is Jan 15 (2 days away), SI not yet submitted"

3. **IDENTIFY THE BLOCKER** - What's stopping progress RIGHT NOW
   ❌ "Waiting for documents"
   ✅ "Waiting for packing list from ABC Exports since Jan 8 (4 days)"

4. **QUANTIFY IMPACT** - Make stakes concrete
   ❌ "May incur charges"
   ✅ "$150/day detention starting Jan 18 if not picked up"

5. **ASSIGN OWNERSHIP** - Who needs to act
   ❌ "Follow up needed"
   ✅ "Intoglo ops to call Carmel Transport for pickup ETA"

## DOMAIN KNOWLEDGE

**Parties:** ocean_carrier (Maersk, Hapag, CMA CGM), trucker, customs_broker, shipper, consignee, warehouse, terminal, intoglo

**Issue Types:** delay, rollover, hold, detention, demurrage, documentation, payment, damage, shortage

**Milestones:** Booking → SI Submitted → BL Draft → BL Issued → Departed → Arrived → Customs Cleared → Delivered

**Financial Risks:**
- Detention: Container held beyond free time (~$100-200/day)
- Demurrage: Port storage charges (~$50-150/day)
- Rollover: Missed sailing = rebooking + delays

## OUTPUT FORMAT (strict JSON)

{
  "story": "3-4 sentence narrative with specific names, dates, and current state",
  "currentBlocker": "What's stopping progress NOW with specific party and duration (null if none)",
  "blockerOwner": "Who owns the blocker: [specific company/party name]|intoglo|null",
  "nextAction": "Specific action with deadline: 'Call [party] for [outcome] by [date]'",
  "actionOwner": "Who should act: intoglo|customer|[specific party name]",
  "actionPriority": "critical|high|medium|low",
  "financialImpact": "Specific amount/risk: '$X detention since [date]' or null",
  "customerImpact": "How customer affected: 'Delivery delayed 3 days' or null",
  "riskLevel": "red|amber|green",
  "riskReason": "One line: why this risk level"
}

## RISK LEVEL GUIDE
- **RED**: Immediate action required (cutoff <24h, active issue, financial loss)
- **AMBER**: Attention needed (cutoff <3d, pending response >3d, potential issue)
- **GREEN**: On track (no blockers, schedule holding, all parties responsive)

## SHIPPER INTELLIGENCE (Cross-Shipment Patterns)
When shipper profile data is provided:
- Use SI late rate to proactively warn: "This shipper submits SI late 60% of the time - follow up early"
- Use doc issue rate: "This shipper has documentation issues 25% of shipments - verify docs carefully"
- Use risk factors to contextualize: "Based on history, expect late SI submission"
- DON'T be judgmental - be helpful: "Send SI reminder 2 days earlier than usual for this shipper"

Return ONLY valid JSON.`;

// =============================================================================
// SERVICE CLASS
// =============================================================================

export class HaikuSummaryService {
  private anthropic: Anthropic;
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.anthropic = new Anthropic();
    this.supabase = supabase;
  }

  // ===========================================================================
  // DATA FETCHING - TIERED APPROACH
  // ===========================================================================

  /**
   * Layer 1: Full shipment context with all dates and parties
   */
  private async getShipmentContext(shipmentId: string): Promise<ShipmentContext | null> {
    const { data: shipment, error } = await this.supabase
      .from('shipments')
      .select(`
        id, booking_number, mbl_number, hbl_number,
        port_of_loading, port_of_loading_code,
        port_of_discharge, port_of_discharge_code,
        vessel_name, voyage_number, carrier_name,
        etd, eta, atd, ata,
        si_cutoff, vgm_cutoff, cargo_cutoff,
        stage, status,
        shipper_name, consignee_name,
        created_at
      `)
      .eq('id', shipmentId)
      .single();

    if (error || !shipment) return null;

    // Get containers
    const { data: containers } = await this.supabase
      .from('shipment_containers')
      .select('container_number')
      .eq('shipment_id', shipmentId);

    return {
      ...shipment,
      containers: (containers || []).map(c => c.container_number).filter(Boolean),
    } as ShipmentContext;
  }

  /**
   * Layer 2: Key milestones (all-time) - issues, amendments, stage changes
   */
  private async getMilestones(shipmentId: string): Promise<MilestoneEvent[]> {
    // Get all issues and significant events (no time limit)
    const { data } = await this.supabase
      .from('chronicle')
      .select(`
        occurred_at, document_type, from_party, summary,
        has_issue, issue_type, issue_description, carrier_name
      `)
      .eq('shipment_id', shipmentId)
      .or('has_issue.eq.true,document_type.in.(booking_confirmation,booking_amendment,si_confirmation,bl_draft,bl_final,arrival_notice,delivery_order)')
      .order('occurred_at', { ascending: true })
      .limit(20);

    return (data || []).map(d => ({
      occurred_at: d.occurred_at,
      event_type: d.document_type || 'communication',
      from_party: d.from_party,
      summary: d.summary,
      has_issue: d.has_issue,
      issue_type: d.issue_type,
      issue_description: d.issue_description,
      carrier_name: d.carrier_name,
    }));
  }

  /**
   * Layer 3: Recent communications (last 7 days)
   */
  private async getRecentChronicles(shipmentId: string): Promise<RecentChronicle[]> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data } = await this.supabase
      .from('chronicle')
      .select(`
        occurred_at, direction, from_party, from_address, message_type, summary,
        has_issue, issue_type, issue_description,
        has_action, action_description, action_priority, action_deadline, action_completed_at,
        carrier_name, sentiment
      `)
      .eq('shipment_id', shipmentId)
      .gte('occurred_at', sevenDaysAgo)
      .order('occurred_at', { ascending: false })
      .limit(25);

    return (data || []) as RecentChronicle[];
  }

  /**
   * Layer 4: Compute date-derived urgency
   */
  private computeDateUrgency(shipment: ShipmentContext): DateUrgency[] {
    const urgencies: DateUrgency[] = [];
    const now = new Date();

    const daysUntil = (dateStr: string | null): number | null => {
      if (!dateStr) return null;
      const date = new Date(dateStr);
      return Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    };

    // Cutoff urgency
    const cutoffs = [
      { name: 'SI Cutoff', date: shipment.si_cutoff },
      { name: 'VGM Cutoff', date: shipment.vgm_cutoff },
      { name: 'Cargo Cutoff', date: shipment.cargo_cutoff },
    ];

    for (const cutoff of cutoffs) {
      const days = daysUntil(cutoff.date);
      if (days !== null) {
        if (days < 0) {
          urgencies.push({
            type: 'cutoff',
            label: `${cutoff.name} PASSED ${Math.abs(days)} days ago`,
            daysRemaining: days,
            severity: 'critical',
          });
        } else if (days <= 1) {
          urgencies.push({
            type: 'cutoff',
            label: `${cutoff.name} in ${days === 0 ? 'TODAY' : '1 day'}`,
            daysRemaining: days,
            severity: 'critical',
          });
        } else if (days <= 3) {
          urgencies.push({
            type: 'cutoff',
            label: `${cutoff.name} in ${days} days`,
            daysRemaining: days,
            severity: 'warning',
          });
        }
      }
    }

    // ETD urgency (departure approaching)
    const etdDays = daysUntil(shipment.etd);
    if (etdDays !== null && !shipment.atd) {
      if (etdDays < 0) {
        urgencies.push({
          type: 'schedule',
          label: `ETD was ${Math.abs(etdDays)} days ago, no departure confirmed`,
          daysRemaining: etdDays,
          severity: 'warning',
        });
      } else if (etdDays <= 3) {
        urgencies.push({
          type: 'schedule',
          label: `Departure in ${etdDays === 0 ? 'TODAY' : `${etdDays} days`}`,
          daysRemaining: etdDays,
          severity: etdDays <= 1 ? 'critical' : 'info',
        });
      }
    }

    // ETA urgency (arrival approaching or passed)
    const etaDays = daysUntil(shipment.eta);
    if (etaDays !== null && shipment.atd && !shipment.ata) {
      if (etaDays < 0) {
        urgencies.push({
          type: 'schedule',
          label: `ETA was ${Math.abs(etaDays)} days ago, arrival not confirmed`,
          daysRemaining: etaDays,
          severity: 'warning',
        });
      } else if (etaDays <= 2) {
        urgencies.push({
          type: 'schedule',
          label: `Arrival in ${etaDays === 0 ? 'TODAY' : `${etaDays} days`}`,
          daysRemaining: etaDays,
          severity: 'info',
        });
      }
    }

    return urgencies;
  }

  /**
   * Layer 5: Shipper intelligence (cross-shipment patterns)
   */
  private async getShipperProfile(shipperName: string | null): Promise<ShipperProfileContext | null> {
    if (!shipperName) return null;

    // Extract primary identifier from shipper name for flexible matching
    const cleanName = shipperName
      .toLowerCase()
      .trim()
      .replace(/pvt\.?\s*ltd\.?/gi, '')
      .replace(/p\.?\s*ltd\.?/gi, '')
      .replace(/private\s*limited/gi, '')
      .replace(/limited/gi, '')
      .replace(/llp/gi, '')
      .replace(/inc\.?/gi, '')
      .replace(/[.,]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Use first meaningful word(s) for matching
    const searchWords = cleanName
      .split(' ')
      .filter(w => w.length > 2)
      .slice(0, 2);

    if (searchWords.length === 0) return null;

    // Use ILIKE with first word for flexible matching
    const { data: profiles } = await this.supabase
      .from('shipper_profiles')
      .select(`
        shipper_name, total_shipments, avg_si_days_before_cutoff,
        si_late_rate, doc_issue_rate, issue_rate, risk_score,
        risk_factors, preferred_carriers, common_issue_types,
        relationship_months
      `)
      .ilike('shipper_name_normalized', `%${searchWords[0]}%`)
      .order('total_shipments', { ascending: false })
      .limit(1);

    const profile = profiles?.[0];
    if (!profile) return null;

    return {
      shipperName: profile.shipper_name,
      totalShipments: profile.total_shipments,
      avgSiDaysBeforeCutoff: profile.avg_si_days_before_cutoff ? parseFloat(profile.avg_si_days_before_cutoff) : null,
      siLateRate: profile.si_late_rate ? parseFloat(profile.si_late_rate) : null,
      docIssueRate: profile.doc_issue_rate ? parseFloat(profile.doc_issue_rate) : null,
      issueRate: profile.issue_rate ? parseFloat(profile.issue_rate) : null,
      riskScore: profile.risk_score || 0,
      riskFactors: profile.risk_factors || [],
      preferredCarriers: profile.preferred_carriers || [],
      commonIssueTypes: profile.common_issue_types || [],
      relationshipMonths: profile.relationship_months || 0,
    };
  }

  // ===========================================================================
  // PROMPT BUILDING
  // ===========================================================================

  private formatDate(dateStr: string | null): string {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  private formatDateWithDays(dateStr: string | null): string {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    const days = Math.ceil((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    if (days < 0) return `${formatted} (${Math.abs(days)}d ago)`;
    if (days === 0) return `${formatted} (TODAY)`;
    if (days === 1) return `${formatted} (tomorrow)`;
    return `${formatted} (${days}d)`;
  }

  private buildPrompt(
    shipment: ShipmentContext,
    milestones: MilestoneEvent[],
    recent: RecentChronicle[],
    urgencies: DateUrgency[],
    shipperProfile: ShipperProfileContext | null = null
  ): string {
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });

    // Build shipment header
    const header = `
## SHIPMENT CONTEXT
Today: ${today}
Booking: ${shipment.booking_number || 'N/A'} | MBL: ${shipment.mbl_number || 'N/A'}
Route: ${shipment.port_of_loading_code || shipment.port_of_loading || '?'} → ${shipment.port_of_discharge_code || shipment.port_of_discharge || '?'}
Vessel: ${shipment.vessel_name || 'TBD'} ${shipment.voyage_number ? `/ ${shipment.voyage_number}` : ''}
Carrier: ${shipment.carrier_name || 'N/A'}
Stage: ${shipment.stage || 'PENDING'}
Shipper: ${shipment.shipper_name || 'N/A'}
Consignee: ${shipment.consignee_name || 'N/A'}
Containers: ${shipment.containers.length > 0 ? shipment.containers.join(', ') : 'N/A'}`;

    // Build schedule section
    const schedule = `
## CRITICAL DATES
ETD: ${this.formatDateWithDays(shipment.etd)}${shipment.atd ? ` | ATD: ${this.formatDate(shipment.atd)}` : ''}
ETA: ${this.formatDateWithDays(shipment.eta)}${shipment.ata ? ` | ATA: ${this.formatDate(shipment.ata)}` : ''}
SI Cutoff: ${this.formatDateWithDays(shipment.si_cutoff)}
VGM Cutoff: ${this.formatDateWithDays(shipment.vgm_cutoff)}
Cargo Cutoff: ${this.formatDateWithDays(shipment.cargo_cutoff)}`;

    // Build urgency alerts
    let alertSection = '';
    if (urgencies.length > 0) {
      const alerts = urgencies
        .sort((a, b) => a.daysRemaining - b.daysRemaining)
        .map(u => `⚠️ ${u.severity.toUpperCase()}: ${u.label}`)
        .join('\n');
      alertSection = `\n## DATE-BASED ALERTS\n${alerts}`;
    }

    // Build milestone timeline
    let milestoneSection = '';
    if (milestones.length > 0) {
      const events = milestones.map(m => {
        const date = this.formatDate(m.occurred_at);
        const party = m.carrier_name || m.from_party || 'system';
        const issue = m.has_issue ? ` [ISSUE: ${m.issue_type}]` : '';
        return `${date} | ${party}: ${m.summary.slice(0, 80)}${issue}`;
      }).join('\n');
      milestoneSection = `\n## KEY MILESTONES (Full History)\n${events}`;
    }

    // Build recent activity
    let recentSection = '';
    if (recent.length > 0) {
      const entries = recent.slice(0, 15).map(r => {
        const date = this.formatDate(r.occurred_at);
        const dir = r.direction === 'inbound' ? '←' : '→';
        const party = r.carrier_name || r.from_party || 'unknown';
        const issue = r.has_issue ? ` [ISSUE: ${r.issue_type}]` : '';
        const action = r.has_action && !r.action_completed_at
          ? ` [ACTION: ${r.action_description?.slice(0, 40)}${r.action_deadline ? ` by ${this.formatDate(r.action_deadline)}` : ''}]`
          : '';
        const sentiment = r.sentiment === 'urgent' ? ' [URGENT]' : '';
        return `${date} ${dir} ${party}: ${r.summary.slice(0, 60)}${issue}${action}${sentiment}`;
      }).join('\n');
      recentSection = `\n## RECENT ACTIVITY (Last 7 Days)\n${entries}`;
    }

    // Build pending actions
    const pendingActions = recent.filter(r => r.has_action && !r.action_completed_at);
    let actionsSection = '';
    if (pendingActions.length > 0) {
      const actions = pendingActions.map(a => {
        const deadline = a.action_deadline ? this.formatDateWithDays(a.action_deadline) : 'no deadline';
        const priority = a.action_priority || 'medium';
        return `- [${priority.toUpperCase()}] ${a.action_description} (${deadline})`;
      }).join('\n');
      actionsSection = `\n## PENDING ACTIONS\n${actions}`;
    }

    // Build shipper intelligence section
    let shipperSection = '';
    if (shipperProfile && shipperProfile.totalShipments >= 3) {
      const insights: string[] = [];

      // SI behavior insight
      if (shipperProfile.siLateRate !== null && shipperProfile.siLateRate > 20) {
        insights.push(`⚠️ SI LATE: ${shipperProfile.siLateRate}% of shipments have late SI (avg ${shipperProfile.avgSiDaysBeforeCutoff?.toFixed(1) || 'N/A'} days before cutoff)`);
      } else if (shipperProfile.avgSiDaysBeforeCutoff !== null && shipperProfile.avgSiDaysBeforeCutoff > 3) {
        insights.push(`✅ SI RELIABLE: Usually submits ${shipperProfile.avgSiDaysBeforeCutoff.toFixed(1)} days before cutoff`);
      }

      // Documentation quality insight
      if (shipperProfile.docIssueRate !== null && shipperProfile.docIssueRate > 15) {
        insights.push(`⚠️ DOC ISSUES: ${shipperProfile.docIssueRate}% of shipments have documentation problems`);
        if (shipperProfile.commonIssueTypes.length > 0) {
          insights.push(`   Common issues: ${shipperProfile.commonIssueTypes.join(', ')}`);
        }
      }

      // Risk assessment
      if (shipperProfile.riskScore >= 50) {
        insights.push(`🔴 HIGH RISK SHIPPER (score ${shipperProfile.riskScore}/100): ${shipperProfile.riskFactors.join(', ')}`);
      } else if (shipperProfile.riskScore >= 25) {
        insights.push(`🟡 MODERATE RISK SHIPPER (score ${shipperProfile.riskScore}/100)`);
      }

      // Relationship context
      if (shipperProfile.totalShipments >= 20) {
        insights.push(`📊 ESTABLISHED: ${shipperProfile.totalShipments} shipments over ${shipperProfile.relationshipMonths} months`);
      } else if (shipperProfile.totalShipments < 10) {
        insights.push(`📊 NEW RELATIONSHIP: Only ${shipperProfile.totalShipments} shipments in history`);
      }

      if (insights.length > 0) {
        shipperSection = `\n## SHIPPER INTELLIGENCE (${shipperProfile.shipperName})\n${insights.join('\n')}`;
      }
    }

    return `${header}${schedule}${alertSection}${shipperSection}${milestoneSection}${recentSection}${actionsSection}

Analyze this shipment and return the JSON summary:`;
  }

  // ===========================================================================
  // AI GENERATION
  // ===========================================================================

  async generateSummary(
    shipment: ShipmentContext,
    milestones: MilestoneEvent[],
    recent: RecentChronicle[],
    urgencies: DateUrgency[],
    shipperProfile: ShipperProfileContext | null = null
  ): Promise<GenerationResult> {
    const userPrompt = this.buildPrompt(shipment, milestones, recent, urgencies, shipperProfile);

    const response = await this.anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    let summary: AISummary;

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        summary = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found');
      }
    } catch {
      summary = {
        story: 'Unable to generate summary',
        currentBlocker: null,
        blockerOwner: null,
        nextAction: 'Review shipment manually',
        actionOwner: 'intoglo',
        actionPriority: 'medium',
        financialImpact: null,
        customerImpact: null,
        riskLevel: 'amber',
        riskReason: 'AI parsing failed',
      };
    }

    // Calculate cost (Haiku: $0.80/1M input, $4/1M output for claude-3-5-haiku)
    const inputTokens = response.usage.input_tokens;
    const outputTokens = response.usage.output_tokens;
    const cost = (inputTokens * 0.80) / 1_000_000 + (outputTokens * 4) / 1_000_000;

    return {
      summary,
      inputTokens,
      outputTokens,
      cost,
      chronicleCount: milestones.length + recent.length,
    };
  }

  // ===========================================================================
  // DATABASE OPERATIONS
  // ===========================================================================

  async saveSummary(shipmentId: string, result: GenerationResult): Promise<void> {
    const { summary } = result;

    const { error } = await this.supabase.from('shipment_ai_summaries').upsert(
      {
        shipment_id: shipmentId,
        story: summary.story,
        current_blocker: summary.currentBlocker,
        blocker_owner: summary.blockerOwner,
        next_action: summary.nextAction,
        action_owner: summary.actionOwner,
        action_priority: summary.actionPriority,
        financial_impact: summary.financialImpact,
        customer_impact: summary.customerImpact,
        risk_level: summary.riskLevel,
        risk_reason: summary.riskReason,
        model_used: 'claude-3-5-haiku',
        input_tokens: result.inputTokens,
        output_tokens: result.outputTokens,
        generation_cost_usd: result.cost,
        chronicle_count: result.chronicleCount,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'shipment_id' }
    );

    if (error) throw error;
  }

  // ===========================================================================
  // MAIN PROCESSING
  // ===========================================================================

  async processShipment(shipmentId: string): Promise<GenerationResult | null> {
    // Layer 1: Get full shipment context
    const shipment = await this.getShipmentContext(shipmentId);
    if (!shipment) {
      console.log('[HaikuSummary] Shipment not found:', shipmentId);
      return null;
    }

    // Layer 2: Get key milestones (all-time)
    const milestones = await this.getMilestones(shipmentId);

    // Layer 3: Get recent communications
    const recent = await this.getRecentChronicles(shipmentId);

    // Skip if no activity at all
    if (milestones.length === 0 && recent.length === 0) {
      console.log('[HaikuSummary] No chronicle data for:', shipmentId);
      return null;
    }

    // Layer 4: Compute date-derived urgency
    const urgencies = this.computeDateUrgency(shipment);

    // Layer 5: Shipper intelligence (cross-shipment patterns)
    const shipperProfile = await this.getShipperProfile(shipment.shipper_name);

    // Generate AI summary
    const result = await this.generateSummary(shipment, milestones, recent, urgencies, shipperProfile);

    // Save to database
    await this.saveSummary(shipmentId, result);

    return result;
  }

  async getShipmentsNeedingSummary(limit: number = 100): Promise<string[]> {
    // Priority: TODAY and upcoming ETD first, then recent past, then older
    // This ensures active shipments always get AI summaries first

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const sevenDaysAhead = new Date(today);
    sevenDaysAhead.setDate(sevenDaysAhead.getDate() + 7);

    // Filter out shipments with recent summaries (< 12 hours old)
    const { data: recentSummaries } = await this.supabase
      .from('shipment_ai_summaries')
      .select('shipment_id')
      .gte('updated_at', new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString());

    const recentIds = new Set((recentSummaries || []).map(r => r.shipment_id));

    // Priority 1: ETD today or within next 7 days (most urgent)
    const { data: upcomingShipments } = await this.supabase
      .from('shipments')
      .select('id')
      .not('status', 'eq', 'cancelled')
      .gte('etd', today.toISOString())
      .lte('etd', sevenDaysAhead.toISOString())
      .order('etd', { ascending: true });

    // Priority 2: ETD in past 7 days (recently active)
    const { data: recentPastShipments } = await this.supabase
      .from('shipments')
      .select('id')
      .not('status', 'eq', 'cancelled')
      .gte('etd', sevenDaysAgo.toISOString())
      .lt('etd', today.toISOString())
      .order('etd', { ascending: false });

    // Priority 3: No ETD but has recent activity
    const { data: noEtdShipments } = await this.supabase
      .from('shipments')
      .select('id')
      .not('status', 'eq', 'cancelled')
      .is('etd', null)
      .order('created_at', { ascending: false })
      .limit(100);

    // Priority 4: Older shipments (lowest priority)
    const { data: olderShipments } = await this.supabase
      .from('shipments')
      .select('id')
      .not('status', 'eq', 'cancelled')
      .lt('etd', sevenDaysAgo.toISOString())
      .order('etd', { ascending: false })
      .limit(200);

    // Combine in priority order, filtering out recent summaries
    const allIds: string[] = [];
    const seen = new Set<string>();

    const addIds = (data: { id: string }[] | null) => {
      for (const row of data || []) {
        if (!seen.has(row.id) && !recentIds.has(row.id)) {
          seen.add(row.id);
          allIds.push(row.id);
        }
      }
    };

    addIds(upcomingShipments);
    addIds(recentPastShipments);
    addIds(noEtdShipments);
    addIds(olderShipments);

    return allIds.slice(0, limit);
  }

  async processShipments(
    shipmentIds: string[],
    onProgress?: (processed: number, total: number) => void
  ): Promise<{ processed: number; failed: number; totalCost: number }> {
    let processed = 0;
    let failed = 0;
    let totalCost = 0;

    for (let i = 0; i < shipmentIds.length; i++) {
      try {
        const result = await this.processShipment(shipmentIds[i]);
        if (result) {
          processed++;
          totalCost += result.cost;
        } else {
          failed++;
        }
      } catch (error) {
        console.error('[HaikuSummary] Error:', shipmentIds[i], error);
        failed++;
      }

      onProgress?.(i + 1, shipmentIds.length);

      // Rate limiting delay
      if (i < shipmentIds.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return { processed, failed, totalCost };
  }
}
