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
  // Added for filtering
  thread_id: string | null;
  document_type: string | null;
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

interface ConsigneeProfileContext {
  consigneeName: string;
  totalShipments: number;
  detentionRate: number | null;
  demurrageRate: number | null;
  customsIssueRate: number | null;
  riskScore: number;
  riskFactors: string[];
}

interface CarrierProfileContext {
  carrierName: string;
  totalShipments: number;
  onTimeDepartureRate: number | null;
  onTimeArrivalRate: number | null;
  rolloverRate: number | null;
  performanceScore: number;
  performanceFactors: string[];
}

interface RouteProfileContext {
  polCode: string;
  podCode: string;
  totalShipments: number;
  scheduledTransitDays: number | null;
  actualAvgTransitDays: number | null;
  transitVarianceDays: number | null;
  onTimeRate: number | null;
  bestCarrier: string | null;
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

## CRITICAL: STAGE-AWARE INTELLIGENCE

Profile intelligence MUST match the current shipment stage. DO NOT flag risks for completed milestones.

**Shipment Lifecycle:**
\`\`\`
PENDING → BOOKED → SI_SUBMITTED → DRAFT_BL → BL_ISSUED → DEPARTED → IN_TRANSIT → ARRIVED → DELIVERED
\`\`\`

**Stage-Appropriate Intelligence:**

| Current Stage | Relevant Intelligence | NOT Relevant (Already Past) |
|---------------|----------------------|----------------------------|
| PENDING/BOOKED | SI late patterns, doc issues | - |
| BL_ISSUED | Vessel tracking, departure timing | SI patterns (SI is done!) |
| DEPARTED/IN_TRANSIT | ETA accuracy, arrival delays | SI, doc issues, rollover |
| ARRIVED | Detention, demurrage, customs | All pre-arrival concerns |
| DELIVERED | Historical only, no action | Everything |

**NEVER DO THIS:**
❌ Stage is BL_ISSUED but blocker mentions "SI not submitted" (SI is already done!)
❌ Stage is DELIVERED but risk is RED (shipment is complete!)
❌ Stage is IN_TRANSIT but warn about rollover (cargo already departed!)

**ALWAYS DO THIS:**
✅ Check the Stage field FIRST before identifying blockers
✅ Only flag profile risks for CURRENT or FUTURE milestones
✅ If stage is past a milestone, that milestone is COMPLETE - don't create blockers for it

## CROSS-SHIPMENT INTELLIGENCE (Use Only When Stage-Appropriate)
When profile data is provided AND marked "RELEVANT NOW":
- Use it to contextualize risks and suggest proactive actions
- DON'T be judgmental - be helpful
- If no profile intelligence is marked relevant, focus on chronicle data only

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
   *
   * IMPROVED Filtering strategy:
   * 1. Exclude low-value message types (acknowledgement, general)
   * 2. Smart thread grouping: Show thread PROGRESSION, not just latest
   *    - Keep high-value emails from same thread (issues, actions, confirmations)
   *    - Deduplicate only notification/update types within same thread
   * 3. Prioritize: issues > actions > urgent > confirmations > updates
   */
  private async getRecentChronicles(shipmentId: string): Promise<RecentChronicle[]> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Fetch more than needed, then filter and deduplicate
    const { data } = await this.supabase
      .from('chronicle')
      .select(`
        occurred_at, direction, from_party, from_address, message_type, summary,
        has_issue, issue_type, issue_description,
        has_action, action_description, action_priority, action_deadline, action_completed_at,
        carrier_name, sentiment, thread_id, document_type
      `)
      .eq('shipment_id', shipmentId)
      .gte('occurred_at', sevenDaysAgo)
      // Filter out low-value message types that add noise
      .not('message_type', 'in', '(acknowledgement,general)')
      .order('occurred_at', { ascending: false })
      .limit(50); // Fetch more, will dedupe below

    if (!data || data.length === 0) return [];

    // IMPROVED: Smart thread deduplication
    // Keep high-value emails (issues, actions, confirmations) even from same thread
    // Only deduplicate low-value updates/notifications within same thread
    const HIGH_VALUE_TYPES = new Set([
      'booking_confirmation', 'booking_amendment', 'shipping_instructions',
      'si_confirmation', 'draft_bl', 'final_bl', 'telex_release',
      'arrival_notice', 'container_release', 'delivery_order',
      'vgm_confirmation', 'sob_confirmation', 'exception_notice',
    ]);

    const threadLatestLowValue = new Map<string, any>(); // Track latest low-value per thread
    const results: any[] = [];

    for (const entry of data) {
      const threadId = (entry as any).thread_id;
      const isHighValue = HIGH_VALUE_TYPES.has(entry.document_type) ||
                          entry.has_issue ||
                          (entry.has_action && !entry.action_completed_at) ||
                          entry.sentiment === 'urgent';

      if (!threadId) {
        // No thread - always keep
        results.push(entry);
      } else if (isHighValue) {
        // High-value email - always keep (shows thread progression)
        results.push(entry);
      } else {
        // Low-value email - keep only latest per thread
        if (!threadLatestLowValue.has(threadId)) {
          threadLatestLowValue.set(threadId, entry);
          results.push(entry);
        }
        // Skip subsequent low-value emails from same thread
      }
    }

    // Prioritize by importance
    const prioritized = results.sort((a, b) => {
      const getPriority = (entry: any): number => {
        // Issues are highest priority
        if (entry.has_issue) return 0;
        // Pending actions next
        if (entry.has_action && !entry.action_completed_at) return 1;
        // Urgent sentiment
        if (entry.sentiment === 'urgent') return 2;
        // Escalations
        if (entry.message_type === 'escalation') return 3;
        // Action required
        if (entry.message_type === 'action_required') return 4;
        // Issue reported
        if (entry.message_type === 'issue_reported') return 5;
        // Requests (need response)
        if (entry.message_type === 'request') return 6;
        // Confirmations (important but no action needed)
        if (entry.message_type === 'confirmation') return 7;
        // Updates
        if (entry.message_type === 'update') return 8;
        // Everything else
        return 9;
      };

      const priorityDiff = getPriority(a) - getPriority(b);
      if (priorityDiff !== 0) return priorityDiff;

      // Same priority - sort by date (newest first)
      return new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime();
    });

    // Return top 25 most important entries (increased from 20 to show more progression)
    return prioritized.slice(0, 25) as RecentChronicle[];
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

  /**
   * Layer 6: Consignee intelligence (destination behavior patterns)
   */
  private async getConsigneeProfile(consigneeName: string | null): Promise<ConsigneeProfileContext | null> {
    if (!consigneeName) return null;

    const cleanName = consigneeName
      .toLowerCase()
      .trim()
      .replace(/pvt\.?\s*ltd\.?/gi, '')
      .replace(/private\s*limited/gi, '')
      .replace(/limited/gi, '')
      .replace(/[.,]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const searchWord = cleanName.split(' ').filter(w => w.length > 2)[0];
    if (!searchWord) return null;

    const { data: profiles } = await this.supabase
      .from('consignee_profiles')
      .select('*')
      .ilike('consignee_name_normalized', `%${searchWord}%`)
      .order('total_shipments', { ascending: false })
      .limit(1);

    const profile = profiles?.[0];
    if (!profile) return null;

    return {
      consigneeName: profile.consignee_name,
      totalShipments: profile.total_shipments,
      detentionRate: profile.detention_rate ? parseFloat(profile.detention_rate) : null,
      demurrageRate: profile.demurrage_rate ? parseFloat(profile.demurrage_rate) : null,
      customsIssueRate: profile.customs_issue_rate ? parseFloat(profile.customs_issue_rate) : null,
      riskScore: profile.risk_score || 0,
      riskFactors: profile.risk_factors || [],
    };
  }

  /**
   * Layer 7: Carrier intelligence (shipping line performance)
   */
  private async getCarrierProfile(carrierName: string | null): Promise<CarrierProfileContext | null> {
    if (!carrierName) return null;

    const cleanName = carrierName
      .toLowerCase()
      .trim()
      .replace(/shipping\s*(line)?/gi, '')
      .replace(/container\s*(line)?/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    const searchWord = cleanName.split(' ').filter(w => w.length > 2)[0];
    if (!searchWord) return null;

    const { data: profiles } = await this.supabase
      .from('carrier_profiles')
      .select('*')
      .ilike('carrier_name_normalized', `%${searchWord}%`)
      .order('total_shipments', { ascending: false })
      .limit(1);

    const profile = profiles?.[0];
    if (!profile) return null;

    return {
      carrierName: profile.carrier_name,
      totalShipments: profile.total_shipments,
      onTimeDepartureRate: profile.on_time_departure_rate ? parseFloat(profile.on_time_departure_rate) : null,
      onTimeArrivalRate: profile.on_time_arrival_rate ? parseFloat(profile.on_time_arrival_rate) : null,
      rolloverRate: profile.rollover_rate ? parseFloat(profile.rollover_rate) : null,
      performanceScore: profile.performance_score || 50,
      performanceFactors: profile.performance_factors || [],
    };
  }

  /**
   * Layer 8: Route intelligence (lane-specific patterns)
   */
  private async getRouteProfile(polCode: string | null, podCode: string | null): Promise<RouteProfileContext | null> {
    if (!polCode || !podCode) return null;

    const { data: profile } = await this.supabase
      .from('route_profiles')
      .select('*')
      .eq('pol_code', polCode)
      .eq('pod_code', podCode)
      .single();

    if (!profile) return null;

    return {
      polCode: profile.pol_code,
      podCode: profile.pod_code,
      totalShipments: profile.total_shipments,
      scheduledTransitDays: profile.scheduled_transit_days ? parseFloat(profile.scheduled_transit_days) : null,
      actualAvgTransitDays: profile.actual_avg_transit_days ? parseFloat(profile.actual_avg_transit_days) : null,
      transitVarianceDays: profile.transit_variance_days ? parseFloat(profile.transit_variance_days) : null,
      onTimeRate: profile.on_time_rate ? parseFloat(profile.on_time_rate) : null,
      bestCarrier: profile.best_carrier,
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
    profiles: {
      shipper: ShipperProfileContext | null;
      consignee: ConsigneeProfileContext | null;
      carrier: CarrierProfileContext | null;
      route: RouteProfileContext | null;
    }
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

    // Build intelligence sections with STAGE-AWARE filtering
    let intelligenceSection = '';
    const stage = (shipment.stage || 'PENDING').toUpperCase();

    // Stage categories for filtering
    const PRE_SI_STAGES = ['PENDING', 'DRAFT', 'BOOKED', 'BOOKING_CONFIRMED'];
    const PRE_DEPARTURE_STAGES = [...PRE_SI_STAGES, 'SI_SUBMITTED', 'SI_CONFIRMED', 'DRAFT_BL', 'BL_ISSUED'];
    const POST_ARRIVAL_STAGES = ['ARRIVED', 'CUSTOMS_CLEARED', 'DELIVERED', 'COMPLETED'];
    const IN_TRANSIT_STAGES = ['DEPARTED', 'IN_TRANSIT', 'TRANSSHIPMENT'];

    const isPreSI = PRE_SI_STAGES.includes(stage);
    const isPreDeparture = PRE_DEPARTURE_STAGES.includes(stage);
    const isPostArrival = POST_ARRIVAL_STAGES.includes(stage);
    const isInTransit = IN_TRANSIT_STAGES.includes(stage);

    // Shipper intelligence - SI patterns only relevant BEFORE BL issued
    if (profiles.shipper && profiles.shipper.totalShipments >= 3) {
      const insights: string[] = [];
      const p = profiles.shipper;

      // SI late rate only relevant if SI is still pending
      if (isPreSI) {
        if (p.siLateRate !== null && p.siLateRate > 20) {
          insights.push(`⚠️ SI LATE PATTERN: ${p.siLateRate}% late (avg ${p.avgSiDaysBeforeCutoff?.toFixed(1) || 'N/A'}d before cutoff) - RELEVANT NOW`);
        } else if (p.avgSiDaysBeforeCutoff !== null && p.avgSiDaysBeforeCutoff > 3) {
          insights.push(`✅ SI RELIABLE: Usually ${p.avgSiDaysBeforeCutoff.toFixed(1)}d before cutoff`);
        }
      }
      // Doc issues relevant until BL is final
      if (isPreDeparture && p.docIssueRate !== null && p.docIssueRate > 15) {
        insights.push(`⚠️ DOC ISSUES: ${p.docIssueRate}% have documentation problems`);
      }
      // General risk always shown if high
      if (p.riskScore >= 40) {
        insights.push(`🔴 HIGH RISK SHIPPER (${p.riskScore}/100): ${p.riskFactors.join(', ')}`);
      }

      if (insights.length > 0) {
        intelligenceSection += `\n## SHIPPER INTEL (${p.shipperName}) [Stage: ${stage}]\n${insights.join('\n')}`;
      }
    }

    // Consignee intelligence - detention/demurrage only relevant AFTER arrival
    if (profiles.consignee && profiles.consignee.totalShipments >= 3) {
      const insights: string[] = [];
      const p = profiles.consignee;

      // Detention/demurrage only relevant post-arrival or approaching arrival
      if (isPostArrival || isInTransit) {
        if (p.detentionRate !== null && p.detentionRate > 15) {
          insights.push(`⚠️ DETENTION RISK: ${p.detentionRate}% of shipments incur detention - RELEVANT NOW`);
        }
        if (p.demurrageRate !== null && p.demurrageRate > 15) {
          insights.push(`⚠️ DEMURRAGE RISK: ${p.demurrageRate}% incur demurrage - RELEVANT NOW`);
        }
      }
      // Customs issues relevant when approaching or at destination
      if ((isInTransit || isPostArrival) && p.customsIssueRate !== null && p.customsIssueRate > 20) {
        insights.push(`⚠️ CUSTOMS RISK: ${p.customsIssueRate}% have customs issues`);
      }
      if (p.riskScore >= 40) {
        insights.push(`🔴 HIGH RISK CONSIGNEE (${p.riskScore}/100)`);
      }

      if (insights.length > 0) {
        intelligenceSection += `\n## CONSIGNEE INTEL (${p.consigneeName}) [Stage: ${stage}]\n${insights.join('\n')}`;
      }
    }

    // Carrier intelligence - departure issues before departure, arrival issues after
    if (profiles.carrier && profiles.carrier.totalShipments >= 5) {
      const insights: string[] = [];
      const p = profiles.carrier;

      // Departure delays only relevant before departure
      if (isPreDeparture && p.onTimeDepartureRate !== null && p.onTimeDepartureRate < 70) {
        insights.push(`⚠️ DEPARTURE DELAYS: Only ${p.onTimeDepartureRate}% on-time - WATCH ETD`);
      }
      // Arrival delays relevant during transit
      if (isInTransit && p.onTimeArrivalRate !== null && p.onTimeArrivalRate < 65) {
        insights.push(`⚠️ ARRIVAL DELAYS: Only ${p.onTimeArrivalRate}% on-time - ETA may slip`);
      }
      // Rollover risk only before departure
      if (isPreDeparture && p.rolloverRate !== null && p.rolloverRate > 15) {
        insights.push(`⚠️ ROLLOVER RISK: ${p.rolloverRate}% get rolled - confirm booking`);
      }
      // Performance score always useful context
      if (p.performanceScore >= 75) {
        insights.push(`✅ HIGH PERFORMER (${p.performanceScore}/100)`);
      } else if (p.performanceScore < 40) {
        insights.push(`🔴 LOW PERFORMER (${p.performanceScore}/100)`);
      }

      if (insights.length > 0) {
        intelligenceSection += `\n## CARRIER INTEL (${p.carrierName}) [Stage: ${stage}]\n${insights.join('\n')}`;
      }
    }

    // Route intelligence - transit variance relevant during transit
    if (profiles.route && profiles.route.totalShipments >= 5) {
      const insights: string[] = [];
      const p = profiles.route;

      // Transit variance most relevant during transit or approaching departure
      if ((isPreDeparture || isInTransit) && p.transitVarianceDays !== null && p.transitVarianceDays > 3) {
        insights.push(`⚠️ SLOW LANE: Typically ${p.transitVarianceDays}d longer than scheduled`);
      } else if (p.transitVarianceDays !== null && p.transitVarianceDays < -1) {
        insights.push(`✅ FAST LANE: Usually ${Math.abs(p.transitVarianceDays)}d ahead of schedule`);
      }
      if ((isPreDeparture || isInTransit) && p.onTimeRate !== null && p.onTimeRate < 60) {
        insights.push(`⚠️ DELAYS COMMON: Only ${p.onTimeRate}% on-time on this lane`);
      }
      if (isPreDeparture && p.bestCarrier) {
        insights.push(`💡 BEST CARRIER: ${p.bestCarrier} on this route`);
      }

      if (insights.length > 0) {
        intelligenceSection += `\n## ROUTE INTEL (${p.polCode} → ${p.podCode}) [Stage: ${stage}]\n${insights.join('\n')}`;
      }
    }

    return `${header}${schedule}${alertSection}${intelligenceSection}${milestoneSection}${recentSection}${actionsSection}

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
    profiles: {
      shipper: ShipperProfileContext | null;
      consignee: ConsigneeProfileContext | null;
      carrier: CarrierProfileContext | null;
      route: RouteProfileContext | null;
    }
  ): Promise<GenerationResult> {
    const userPrompt = this.buildPrompt(shipment, milestones, recent, urgencies, profiles);

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

    // Layer 5-8: Cross-shipment intelligence profiles
    const [shipperProfile, consigneeProfile, carrierProfile, routeProfile] = await Promise.all([
      this.getShipperProfile(shipment.shipper_name),
      this.getConsigneeProfile(shipment.consignee_name),
      this.getCarrierProfile(shipment.carrier_name),
      this.getRouteProfile(shipment.port_of_loading_code, shipment.port_of_discharge_code),
    ]);

    // Generate AI summary
    const result = await this.generateSummary(shipment, milestones, recent, urgencies, {
      shipper: shipperProfile,
      consignee: consigneeProfile,
      carrier: carrierProfile,
      route: routeProfile,
    });

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
