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
  // Financial tracking
  amount: string | null;
  currency: string | null;
  last_free_day: string | null;
}

interface FinancialSummary {
  totalDocumentedCharges: number;
  chargeBreakdown: { type: string; amount: number; currency: string }[];
  detentionDays: number | null;
  demurrageDays: number | null;
  lastFreeDay: string | null;
  estimatedExposure: string | null;
}

interface IntelligenceWarning {
  type: 'staleness' | 'data_quality' | 'financial' | 'blocker_mismatch';
  message: string;
  severity: 'critical' | 'warning' | 'info';
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
  // V2 format (new tight format)
  narrative: string | null; // Tight one-paragraph intelligence
  owner: string | null; // Exact party who needs to act
  ownerType: 'shipper' | 'consignee' | 'carrier' | 'intoglo' | null;
  keyDeadline: string | null; // Critical date (e.g., "Jan 14 ETD")
  keyInsight: string | null; // Most important intelligence (e.g., "61% SI late rate")

  // V1 format (legacy, kept for backwards compatibility)
  story: string;
  currentBlocker: string | null;
  blockerOwner: string | null;
  blockerType: 'external_dependency' | 'internal_task' | null; // NEW: Distinguish blocker vs task
  nextAction: string | null;
  actionOwner: string | null;
  actionContact: string | null; // NEW: Contact info for action owner
  actionPriority: 'critical' | 'high' | 'medium' | 'low' | null;
  financialImpact: string | null;
  customerImpact: string | null;
  customerActionRequired: boolean; // NEW: Flag for customer-facing actions
  riskLevel: 'red' | 'amber' | 'green';
  riskReason: string | null;
  daysOverdue: number | null; // NEW: Days past ETA/ETD for headline
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
- Operations Manager: "What do I need to do TODAY?" (Must pass 10-second scan test)
- Customer Success: "What should I tell the customer?" (Must be call-ready)
- Finance: "What costs are at risk?" (Must quantify dollar amounts)
- Executive: "Is this shipment healthy?"

## CRITICAL: BLOCKER vs TASK DISTINCTION

**BLOCKER** = External dependency stopping progress (someone else must act first)
  ✅ "Chassis shortage at Houston terminal" (external - trucker can't pick up)
  ✅ "Waiting for shipper to submit packing list" (external - shipper must act)
  ✅ "Carrier hasn't released container" (external - carrier must act)

**TASK** = Internal action Intoglo needs to complete (we can do it now)
  ❌ NOT A BLOCKER: "Missing shipper details in system" (Intoglo can collect)
  ❌ NOT A BLOCKER: "Need to submit SI" (Intoglo can submit)
  ❌ NOT A BLOCKER: "Invoice not raised" (Intoglo can raise)

When identifying currentBlocker:
- If it's something Intoglo can do independently → set blockerType: "internal_task"
- If we're waiting on external party → set blockerType: "external_dependency"

## CRITICAL: FINANCIAL QUANTIFICATION FORMULA

**ALWAYS calculate and show total exposure using this formula:**
\`[Days] × [Daily Rate] = $[Total] exposure\`

Examples:
- ✅ "32 days past ETA × $150/day = $4,800 detention exposure"
- ✅ "14 days at terminal × $100/day = $1,400 demurrage risk"
- ❌ "Potential detention charges accumulating" (TOO VAGUE)

**Documented Charges:** When FINANCIAL CHARGES section shows actual amounts, SUM THEM:
- ✅ "Total documented charges: $12,999 (customs $5,804 + trucking $2,100 + storage $455 + transloading $1,200 + destination $3,440)"
- ❌ "Potential storage charges" when actual amounts are documented

## CRITICAL: DAYS-OVERDUE IN HEADLINES

For any shipment past its ETA/ETD, ALWAYS include days overdue in the story:
- ✅ "Arrived 32 days ago, still awaiting pickup due to chassis shortage"
- ✅ "Container stuck at terminal for 14 days - $2,100 detention accumulated"
- ❌ "Container awaiting pickup" (missing duration)

Set daysOverdue field to the number of days past ETA (positive) or days until ETA (negative/null).

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

4. **QUANTIFY IMPACT** - Make stakes concrete using formula
   ❌ "May incur charges"
   ✅ "14 days × $150/day = $2,100 detention since Jan 1"

5. **ASSIGN OWNERSHIP WITH CONTACT** - Who needs to act and how
   ❌ "Follow up needed"
   ✅ "Intoglo ops to call Carmel Transport (from_address in chronicles) for pickup ETA"

6. **FLAG CUSTOMER ACTIONS** - Set customerActionRequired: true when customer must act
   ✅ "Customer must provide W-9 form" → customerActionRequired: true
   ✅ "Intoglo to submit SI" → customerActionRequired: false

## DOMAIN KNOWLEDGE

**Parties:** ocean_carrier (Maersk, Hapag, CMA CGM), trucker, customs_broker, shipper, consignee, warehouse, terminal, intoglo

**Issue Types:** delay, rollover, hold, detention, demurrage, documentation, payment, damage, shortage

**Milestones:** Booking → SI Submitted → BL Draft → BL Issued → Departed → Arrived → Customs Cleared → Delivered

**Financial Rates (use for calculations):**
- Detention: Container held beyond free time = $100-200/day (use $150 average)
- Demurrage: Port storage charges = $50-150/day (use $100 average)
- Terminal storage: $50-100/day
- Chassis rental: $30-50/day

## CRITICAL: READING CONFIRMATIONS (✓CONFIRMED)

In milestones, entries marked with **✓CONFIRMED** mean that step is COMPLETE:
- \`vgm_confirmation ✓CONFIRMED\` = VGM has been submitted, do NOT report "VGM pending"
- \`sob_confirmation ✓CONFIRMED\` = Cargo is on board, ALL pre-departure cutoffs are COMPLETE
- \`booking_confirmation ✓CONFIRMED\` = Booking is confirmed
- \`container_release ✓CONFIRMED\` = Container released for pickup

**NEVER say cutoff was "missed" if:**
1. There's a ✓CONFIRMED milestone for that item, OR
2. Stage is past that milestone (BL_ISSUED means SI is done, DEPARTED means all cutoffs met)

## OUTPUT FORMAT (strict JSON)

{
  "narrative": "1-2 tight sentences: What's happening + who needs to act + key deadline. Include days overdue if past ETA.",
  "owner": "Exact party who must act next: 'ABC Exports' | 'Hapag-Lloyd' | 'Intoglo Ops' | null",
  "ownerType": "shipper|consignee|carrier|intoglo|null",
  "keyDeadline": "Most critical date: 'SI Cutoff Jan 14' | 'ETD Jan 16' | 'Pickup by Jan 18' | null",
  "keyInsight": "One-liner intelligence with numbers: '32 days overdue, $4,800 exposure' | 'Total charges: $12,999' | null",
  "story": "3-4 sentence narrative with specific names, dates, amounts, and days overdue",
  "currentBlocker": "What's stopping progress NOW with party and duration (null if only internal tasks)",
  "blockerOwner": "Who owns the blocker: [specific company/party name]|intoglo|null",
  "blockerType": "external_dependency|internal_task|null",
  "nextAction": "Specific action with deadline and contact: 'Call [party] at [email/phone from chronicles] for [outcome] by [date]'",
  "actionOwner": "Who should act: intoglo|customer|[specific party name]",
  "actionContact": "Contact info from chronicles if available: email or phone | null",
  "actionPriority": "critical|high|medium|low",
  "financialImpact": "Calculated amount: '[X] days × $[rate]/day = $[total]' OR 'Total documented: $X' | null",
  "customerImpact": "How customer affected with days: 'Delivery delayed 14 days from original ETA' | null",
  "customerActionRequired": true/false,
  "riskLevel": "red|amber|green",
  "riskReason": "One line with numbers: 'X days overdue with $Y exposure'",
  "daysOverdue": number or null
}

## RISK LEVEL GUIDE (Stage-Aware)
- **RED**: Immediate action required (cutoff <24h, active issue, financial loss >$1000, overdue >7 days)
- **AMBER**: Attention needed (cutoff <3d, pending response >3d, potential issue, overdue 1-7 days)
- **GREEN**: On track OR DELIVERED (no blockers, schedule holding, all parties responsive)

**CRITICAL:** If stage is DELIVERED, risk should be GREEN unless there's a post-delivery payment issue.

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
   * Uses RPC functions to bypass RLS
   */
  private async getShipmentContext(shipmentId: string): Promise<ShipmentContext | null> {
    // Use RPC function to bypass RLS (SECURITY DEFINER)
    // Returns JSONB to avoid type mismatch issues
    const { data: shipmentData, error } = await this.supabase
      .rpc('get_shipment_context_for_ai', { p_shipment_id: shipmentId });

    if (error) {
      console.log('[HaikuSummary] RPC error getting shipment:', error.message);
      return null;
    }

    // Handle JSONB response - could be {shipment_data: {...}} or direct object
    const row = shipmentData?.[0];
    if (!row) return null;

    const shipment = row.shipment_data || row;
    if (!shipment || !shipment.id) return null;

    // Get containers using RPC function
    const { data: containerData } = await this.supabase
      .rpc('get_shipment_containers_for_ai', { p_shipment_id: shipmentId });

    return {
      id: shipment.id,
      booking_number: shipment.booking_number,
      mbl_number: shipment.mbl_number,
      hbl_number: shipment.hbl_number,
      port_of_loading: shipment.port_of_loading,
      port_of_loading_code: shipment.port_of_loading_code,
      port_of_discharge: shipment.port_of_discharge,
      port_of_discharge_code: shipment.port_of_discharge_code,
      vessel_name: shipment.vessel_name,
      voyage_number: shipment.voyage_number,
      carrier_name: shipment.carrier_name,
      etd: shipment.etd,
      eta: shipment.eta,
      atd: shipment.atd,
      ata: shipment.ata,
      si_cutoff: shipment.si_cutoff,
      vgm_cutoff: shipment.vgm_cutoff,
      cargo_cutoff: shipment.cargo_cutoff,
      stage: shipment.stage,
      status: shipment.status,
      shipper_name: shipment.shipper_name,
      consignee_name: shipment.consignee_name,
      created_at: shipment.created_at,
      containers: (containerData || []).map((c: any) => c.container_number).filter(Boolean),
    };
  }

  /**
   * Layer 2: Key milestones (all-time) - issues, amendments, stage changes, confirmations
   */
  private async getMilestones(shipmentId: string): Promise<MilestoneEvent[]> {
    // Get all issues and significant events (no time limit)
    // IMPORTANT: Include ALL confirmation types so AI knows what's COMPLETED
    const { data } = await this.supabase
      .from('chronicle')
      .select(`
        occurred_at, document_type, from_party, summary,
        has_issue, issue_type, issue_description, carrier_name
      `)
      .eq('shipment_id', shipmentId)
      .or('has_issue.eq.true,document_type.in.(booking_confirmation,booking_amendment,si_confirmation,si_submitted,vgm_confirmation,sob_confirmation,bl_draft,bl_final,telex_release,arrival_notice,delivery_order,container_release,gate_in,gate_out,cargo_loaded,vessel_departed,vessel_arrived)')
      .order('occurred_at', { ascending: true })
      .limit(30);

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
        carrier_name, sentiment, thread_id, document_type,
        amount, currency, last_free_day
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
   * Layer 3.5: Extract financial summary from ALL chronicles (not just recent)
   * This captures all documented charges, detention days, and calculates exposure
   */
  private async getFinancialSummary(shipmentId: string, stage: string | null, eta: string | null): Promise<FinancialSummary> {
    // Get ALL chronicles with financial data
    const { data } = await this.supabase
      .from('chronicle')
      .select('document_type, amount, currency, last_free_day, issue_type, occurred_at')
      .eq('shipment_id', shipmentId)
      .not('amount', 'is', null)
      .order('occurred_at', { ascending: false });

    const chargeBreakdown: { type: string; amount: number; currency: string }[] = [];
    let totalUSD = 0;
    let lastFreeDay: string | null = null;
    let detentionDays: number | null = null;
    let demurrageDays: number | null = null;

    // Process each chronicle with financial data
    for (const row of data || []) {
      const amount = parseFloat(row.amount);
      if (isNaN(amount)) continue;

      const currency = row.currency || 'USD';
      const type = row.document_type || 'charge';

      chargeBreakdown.push({ type, amount, currency });

      // Convert to USD for total (rough conversion for non-USD)
      if (currency === 'USD') {
        totalUSD += amount;
      } else if (currency === 'INR') {
        totalUSD += amount / 83; // Rough INR to USD
      } else if (currency === 'EUR') {
        totalUSD += amount * 1.1;
      } else if (currency === 'CAD') {
        totalUSD += amount * 0.74;
      } else {
        totalUSD += amount; // Assume USD if unknown
      }

      // Track last free day
      if (row.last_free_day && !lastFreeDay) {
        lastFreeDay = row.last_free_day;
      }
    }

    // Calculate detention/demurrage days if applicable
    const now = new Date();
    const POST_ARRIVAL_STAGES = ['ARRIVED', 'CUSTOMS_CLEARED', 'DELIVERED', 'COMPLETED'];
    const isPostArrival = stage && POST_ARRIVAL_STAGES.includes(stage.toUpperCase());

    if (isPostArrival && lastFreeDay) {
      const lfdDate = new Date(lastFreeDay);
      if (lfdDate < now) {
        detentionDays = Math.ceil((now.getTime() - lfdDate.getTime()) / (1000 * 60 * 60 * 24));
      }
    } else if (isPostArrival && eta) {
      // Estimate based on ETA + 5 days free time
      const etaDate = new Date(eta);
      const estimatedLFD = new Date(etaDate.getTime() + 5 * 24 * 60 * 60 * 1000);
      if (estimatedLFD < now) {
        detentionDays = Math.ceil((now.getTime() - estimatedLFD.getTime()) / (1000 * 60 * 60 * 24));
      }
    }

    // Calculate estimated exposure
    let estimatedExposure: string | null = null;
    if (detentionDays && detentionDays > 0) {
      const dailyRate = 150; // Average detention rate
      const exposure = detentionDays * dailyRate;
      estimatedExposure = `${detentionDays} days × $${dailyRate}/day = $${exposure.toLocaleString()} detention exposure`;
    }

    return {
      totalDocumentedCharges: Math.round(totalUSD * 100) / 100,
      chargeBreakdown,
      detentionDays,
      demurrageDays,
      lastFreeDay,
      estimatedExposure,
    };
  }

  /**
   * Generate intelligence warnings for data quality issues
   */
  private generateIntelligenceWarnings(
    shipment: ShipmentContext,
    milestones: MilestoneEvent[],
    recent: RecentChronicle[],
    financial: FinancialSummary
  ): IntelligenceWarning[] {
    const warnings: IntelligenceWarning[] = [];
    const now = new Date();
    const stage = (shipment.stage || 'PENDING').toUpperCase();

    // 1. Staleness check - No activity in 14+ days
    const latestActivity = recent[0]?.occurred_at || milestones[milestones.length - 1]?.occurred_at;
    if (latestActivity) {
      const daysSinceActivity = Math.ceil((now.getTime() - new Date(latestActivity).getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceActivity > 14 && !['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(stage)) {
        warnings.push({
          type: 'staleness',
          message: `No activity for ${daysSinceActivity} days`,
          severity: daysSinceActivity > 30 ? 'critical' : 'warning',
        });
      }
    }

    // 2. Zombie shipment check - ETD 90+ days old without delivery
    if (shipment.etd) {
      const etdDate = new Date(shipment.etd);
      const daysSinceETD = Math.ceil((now.getTime() - etdDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceETD > 90 && !['DELIVERED', 'COMPLETED', 'CANCELLED'].includes(stage)) {
        warnings.push({
          type: 'staleness',
          message: `ETD was ${daysSinceETD} days ago, shipment still not delivered`,
          severity: 'critical',
        });
      }
    }

    // 3. Financial data check - Has issues but no financial impact documented
    const hasIssues = recent.some(r => r.has_issue) || milestones.some(m => m.has_issue);
    if (hasIssues && financial.totalDocumentedCharges === 0 && !financial.estimatedExposure) {
      warnings.push({
        type: 'financial',
        message: 'Has issues flagged but no financial impact documented',
        severity: 'warning',
      });
    }

    // 4. Post-arrival without pickup - Detention risk
    const POST_ARRIVAL_STAGES = ['ARRIVED', 'CUSTOMS_CLEARED'];
    if (POST_ARRIVAL_STAGES.includes(stage) && shipment.eta) {
      const etaDate = new Date(shipment.eta);
      const daysSinceArrival = Math.ceil((now.getTime() - etaDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysSinceArrival > 7) {
        warnings.push({
          type: 'financial',
          message: `Container at port ${daysSinceArrival} days - detention charges likely`,
          severity: daysSinceArrival > 14 ? 'critical' : 'warning',
        });
      }
    }

    // 5. Missing core data check
    const missingCore: string[] = [];
    if (!shipment.booking_number && !shipment.mbl_number) missingCore.push('booking/MBL');
    if (!shipment.port_of_loading && !shipment.port_of_loading_code) missingCore.push('POL');
    if (!shipment.port_of_discharge && !shipment.port_of_discharge_code) missingCore.push('POD');
    if (!shipment.etd && !shipment.atd) missingCore.push('ETD');

    if (missingCore.length > 0 && !['PENDING', 'DRAFT', 'REQUESTED'].includes(stage)) {
      warnings.push({
        type: 'data_quality',
        message: `Missing core data: ${missingCore.join(', ')}`,
        severity: 'warning',
      });
    }

    return warnings;
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
    },
    financial: FinancialSummary,
    warnings: IntelligenceWarning[]
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

    // Build milestone timeline with clear COMPLETED markers
    let milestoneSection = '';
    if (milestones.length > 0) {
      // Identify completion events
      const COMPLETION_TYPES = new Set([
        'booking_confirmation', 'si_confirmation', 'vgm_confirmation',
        'sob_confirmation', 'bl_draft', 'bl_final', 'telex_release',
        'container_release', 'delivery_order', 'gate_in', 'gate_out',
        'vessel_departed', 'vessel_arrived', 'cargo_loaded'
      ]);

      const events = milestones.map(m => {
        const date = this.formatDate(m.occurred_at);
        const party = m.carrier_name || m.from_party || 'system';
        const issue = m.has_issue ? ` [ISSUE: ${m.issue_type}]` : '';
        const completed = COMPLETION_TYPES.has(m.event_type) ? ' ✓CONFIRMED' : '';
        return `${date} | ${party}: ${m.summary.slice(0, 80)}${issue}${completed}`;
      }).join('\n');
      milestoneSection = `\n## KEY MILESTONES (Full History) - ✓ = COMPLETED\n${events}`;
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

    // Build pending actions from recent (last 7 days)
    const pendingActions = recent.filter(r => r.has_action && !r.action_completed_at);
    let actionsSection = '';
    if (pendingActions.length > 0) {
      const actions = pendingActions.map(a => {
        const deadline = a.action_deadline ? this.formatDateWithDays(a.action_deadline) : 'no deadline';
        const priority = a.action_priority || 'medium';
        const contact = a.from_address ? ` [Contact: ${a.from_address}]` : '';
        return `- [${priority.toUpperCase()}] ${a.action_description} (${deadline})${contact}`;
      }).join('\n');
      actionsSection = `\n## PENDING ACTIONS\n${actions}`;
    }

    // Build financial section - CRITICAL for accurate summaries
    let financialSection = '';
    if (financial.totalDocumentedCharges > 0 || financial.estimatedExposure) {
      const parts: string[] = [];

      if (financial.totalDocumentedCharges > 0) {
        parts.push(`Total Documented Charges: $${financial.totalDocumentedCharges.toLocaleString()}`);
        // Show top 5 charge breakdown
        const topCharges = financial.chargeBreakdown.slice(0, 5);
        if (topCharges.length > 0) {
          const breakdown = topCharges.map(c => `  - ${c.type}: ${c.currency} ${c.amount}`).join('\n');
          parts.push(`Breakdown:\n${breakdown}`);
        }
      }

      if (financial.lastFreeDay) {
        parts.push(`Last Free Day: ${this.formatDateWithDays(financial.lastFreeDay)}`);
      }

      if (financial.detentionDays && financial.detentionDays > 0) {
        parts.push(`Detention Days: ${financial.detentionDays} (calculate: ${financial.detentionDays} × $150/day = $${financial.detentionDays * 150})`);
      }

      if (financial.estimatedExposure) {
        parts.push(`⚠️ EXPOSURE: ${financial.estimatedExposure}`);
      }

      financialSection = `\n## FINANCIAL CHARGES (Use these actual amounts!)\n${parts.join('\n')}`;
    }

    // Build warnings section
    let warningsSection = '';
    if (warnings.length > 0) {
      const warningLines = warnings.map(w => {
        const icon = w.severity === 'critical' ? '🔴' : w.severity === 'warning' ? '🟡' : 'ℹ️';
        return `${icon} ${w.type.toUpperCase()}: ${w.message}`;
      }).join('\n');
      warningsSection = `\n## INTELLIGENCE WARNINGS\n${warningLines}`;
    }

    // Calculate days overdue for context
    let daysOverdueSection = '';
    if (shipment.eta) {
      const etaDate = new Date(shipment.eta);
      const now = new Date();
      const daysOverdue = Math.ceil((now.getTime() - etaDate.getTime()) / (1000 * 60 * 60 * 24));
      if (daysOverdue > 0 && !['DELIVERED', 'COMPLETED'].includes((shipment.stage || '').toUpperCase())) {
        daysOverdueSection = `\n## DAYS OVERDUE\n⏰ ${daysOverdue} days past ETA - INCLUDE THIS IN STORY AND RISK ASSESSMENT`;
      }
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

    return `${header}${schedule}${alertSection}${daysOverdueSection}${financialSection}${warningsSection}${intelligenceSection}${milestoneSection}${recentSection}${actionsSection}

Analyze this shipment and return the JSON summary. Remember:
1. Use ACTUAL documented charges from FINANCIAL CHARGES section
2. Calculate detention: [days] × $150/day = $[total]
3. Include days overdue in story if past ETA
4. Distinguish BLOCKER (external dependency) vs TASK (Intoglo can do now)
5. Set customerActionRequired=true if customer must act`;
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
    },
    financial: FinancialSummary,
    warnings: IntelligenceWarning[]
  ): Promise<GenerationResult> {
    const userPrompt = this.buildPrompt(shipment, milestones, recent, urgencies, profiles, financial, warnings);

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
        const parsed = JSON.parse(jsonMatch[0]);
        // Ensure all fields are present (may be null)
        summary = {
          // V2 fields
          narrative: parsed.narrative || null,
          owner: parsed.owner || null,
          ownerType: parsed.ownerType || null,
          keyDeadline: parsed.keyDeadline || null,
          keyInsight: parsed.keyInsight || null,
          // V1 fields (enhanced)
          story: parsed.story || 'Unable to generate summary',
          currentBlocker: parsed.currentBlocker || null,
          blockerOwner: parsed.blockerOwner || null,
          blockerType: parsed.blockerType || null,
          nextAction: parsed.nextAction || null,
          actionOwner: parsed.actionOwner || null,
          actionContact: parsed.actionContact || null,
          actionPriority: parsed.actionPriority || null,
          financialImpact: parsed.financialImpact || null,
          customerImpact: parsed.customerImpact || null,
          customerActionRequired: parsed.customerActionRequired || false,
          riskLevel: parsed.riskLevel || 'amber',
          riskReason: parsed.riskReason || null,
          daysOverdue: parsed.daysOverdue || null,
        };
      } else {
        throw new Error('No JSON found');
      }
    } catch {
      summary = {
        // V2 fields
        narrative: null,
        owner: null,
        ownerType: null,
        keyDeadline: null,
        keyInsight: null,
        // V1 fields
        story: 'Unable to generate summary',
        currentBlocker: null,
        blockerOwner: null,
        blockerType: null,
        nextAction: 'Review shipment manually',
        actionOwner: 'intoglo',
        actionContact: null,
        actionPriority: 'medium',
        financialImpact: null,
        customerImpact: null,
        customerActionRequired: false,
        riskLevel: 'amber',
        riskReason: 'AI parsing failed',
        daysOverdue: null,
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

  async saveSummary(shipmentId: string, result: GenerationResult, warnings: IntelligenceWarning[] = []): Promise<void> {
    const { summary } = result;

    const { error } = await this.supabase.from('shipment_ai_summaries').upsert(
      {
        shipment_id: shipmentId,
        // V2 fields (new tight format)
        narrative: summary.narrative,
        owner: summary.owner,
        owner_type: summary.ownerType,
        key_deadline: summary.keyDeadline,
        key_insight: summary.keyInsight,
        // V1 fields (enhanced)
        story: summary.story,
        current_blocker: summary.currentBlocker,
        blocker_owner: summary.blockerOwner,
        blocker_type: summary.blockerType,
        next_action: summary.nextAction,
        action_owner: summary.actionOwner,
        action_contact: summary.actionContact,
        action_priority: summary.actionPriority,
        financial_impact: summary.financialImpact,
        customer_impact: summary.customerImpact,
        customer_action_required: summary.customerActionRequired,
        risk_level: summary.riskLevel,
        risk_reason: summary.riskReason,
        days_overdue: summary.daysOverdue,
        // Intelligence warnings
        intelligence_warnings: warnings.map(w => w.message),
        // Metadata
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

    // Layer 2: Get key milestones (all-time) - includes confirmations to show what's DONE
    const milestones = await this.getMilestones(shipmentId);

    // Layer 3: Get recent communications (last 7 days)
    let recent = await this.getRecentChronicles(shipmentId);

    // Fallback: If no milestones and no recent, fetch ANY chronicles (for older shipments)
    if (milestones.length === 0 && recent.length === 0) {
      const { data: anyChronicles } = await this.supabase
        .from('chronicle')
        .select(`
          occurred_at, direction, from_party, from_address, message_type, summary,
          has_issue, issue_type, issue_description,
          has_action, action_description, action_priority, action_deadline, action_completed_at,
          carrier_name, sentiment, thread_id, document_type,
          amount, currency, last_free_day
        `)
        .eq('shipment_id', shipmentId)
        .order('occurred_at', { ascending: false })
        .limit(10);

      if (!anyChronicles || anyChronicles.length === 0) {
        console.log('[HaikuSummary] No chronicle data for:', shipmentId);
        return null;
      }

      // Use older chronicles as "recent" for summary generation
      recent = anyChronicles as RecentChronicle[];
      console.log(`[HaikuSummary] Using ${recent.length} older chronicles for:`, shipmentId);
    }

    // Layer 3.5: Get financial summary (ALL chronicles with amounts)
    const financial = await this.getFinancialSummary(shipmentId, shipment.stage, shipment.eta);

    // Layer 4: Compute date-derived urgency
    const urgencies = this.computeDateUrgency(shipment);

    // Layer 4.5: Generate intelligence warnings
    const warnings = this.generateIntelligenceWarnings(shipment, milestones, recent, financial);

    // Layer 5-8: Cross-shipment intelligence profiles
    const [shipperProfile, consigneeProfile, carrierProfile, routeProfile] = await Promise.all([
      this.getShipperProfile(shipment.shipper_name),
      this.getConsigneeProfile(shipment.consignee_name),
      this.getCarrierProfile(shipment.carrier_name),
      this.getRouteProfile(shipment.port_of_loading_code, shipment.port_of_discharge_code),
    ]);

    // Generate AI summary with financial data and warnings
    const result = await this.generateSummary(
      shipment,
      milestones,
      recent,
      urgencies,
      {
        shipper: shipperProfile,
        consignee: consigneeProfile,
        carrier: carrierProfile,
        route: routeProfile,
      },
      financial,
      warnings
    );

    // Save to database with warnings
    await this.saveSummary(shipmentId, result, warnings);

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
