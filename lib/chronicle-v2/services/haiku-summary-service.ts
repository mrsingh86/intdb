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
import { ActionRulesEngine, TimeBasedAction, FlowPosition } from '../../chronicle/action-rules-engine';
import {
  ShipmentIntelligenceService,
  createShipmentIntelligenceService,
  ShipmentIntelligence,
} from './shipment-intelligence-service';
import {
  buildPreComputedSection,
  buildCustomerDraftSection,
  validateAgainstPreComputed,
  ENHANCED_SYSTEM_PROMPT_ADDITIONS,
} from './enhanced-prompt-builder';

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
  // NEW: Precise action fields from PreciseActionService
  action_type: string | null;
  action_verb: string | null;
  action_owner: string | null;
  action_deadline_source: string | null;
  action_auto_resolve_on: string[] | null;
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

// Rule-based actions context from ActionRulesEngine
interface RuleBasedActionsContext {
  timeBasedActions: TimeBasedAction[];  // Cutoff/ETA triggered actions
  documentFlows: FlowPosition[];        // Multi-step document flow positions
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
  financialImpact: string | null; // Legacy combined field
  documentedCharges: string | null; // NEW: Actual invoiced amounts from chronicles
  estimatedDetention: string | null; // NEW: Calculated detention (days × rate)
  customerImpact: string | null;
  customerActionRequired: boolean; // NEW: Flag for customer-facing actions
  riskLevel: 'red' | 'amber' | 'green';
  riskReason: string | null;
  daysOverdue: number | null; // NEW: Days past ETA/ETD for headline
  // Intelligence signals
  escalationCount: number | null; // How many escalations sent
  daysSinceActivity: number | null; // Days since last chronicle
  issueCount: number | null; // Total issues detected
  urgentMessageCount: number | null; // Urgent/negative sentiment messages
  carrierPerformance: string | null; // "MSC: 72% on-time"
  shipperRiskSignal: string | null; // "SI late 45%, high risk"
  // Predictive elements
  predictedRisks: string[] | null; // Likely upcoming issues based on patterns
  proactiveRecommendations: string[] | null; // Preventive actions to take
  predictedEta: string | null; // AI-estimated actual arrival
  etaConfidence: 'high' | 'medium' | 'low' | null; // Confidence in prediction
  // P0: SLA Status (pre-computed, anti-hallucination)
  slaStatus: 'OK' | 'AT_RISK' | 'CRITICAL' | 'BREACHED' | 'NO_CONTACT' | null;
  hoursSinceCustomerUpdate: number | null;
  slaSummary: string | null; // e.g., "Customer waiting 72 hours for update"
  // P1: Escalation Level (pre-computed, anti-hallucination)
  escalationLevel: 'L1' | 'L2' | 'L3' | null;
  escalateTo: string | null; // "Operations Team" | "Operations Manager" | "Leadership"
  // P2: Root Cause (pre-computed, anti-hallucination)
  rootCauseCategory: 'CARRIER' | 'PORT' | 'CUSTOMS' | 'CUSTOMER' | 'LOGISTICS' | 'INTOGLO' | null;
  rootCauseSubcategory: string | null; // e.g., "chassis_shortage"
  typicalResolutionDays: number | null;
  benchmarkReference: string | null; // "Similar issues: 4.2 days avg (36 cases)"
  // P0: Customer Draft (AI-generated based on facts)
  customerDraftSubject: string | null;
  customerDraftBody: string | null;
  // P3: Confidence (AI self-assessment)
  recommendationConfidence: 'high' | 'medium' | 'low' | null;
  confidenceReason: string | null; // "Based on data completeness score: 85/100"
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
  "documentedCharges": "ONLY actual invoiced amounts from FINANCIAL CHARGES section: 'Total: $18,218 (freight $12,500 + customs $3,218 + trucking $2,500)' | null",
  "estimatedDetention": "ONLY for post-arrival: '[X] days × $150/day = $[total] detention' | null for pre-arrival stages",
  "financialImpact": "Combined summary for display: 'Documented: $18,218 | Detention: $450' | null",
  "customerImpact": "How customer affected with days: 'Delivery delayed 14 days from original ETA' | null",
  "customerActionRequired": true/false,
  "riskLevel": "red|amber|green",
  "riskReason": "One line with numbers: 'X days overdue with $Y exposure'",
  "daysOverdue": number or null,
  "predictedRisks": ["Array of 0-3 likely upcoming issues based on patterns: 'High rollover probability - confirm cargo availability', 'Detention risk given consignee's 35% detention rate'"],
  "proactiveRecommendations": ["Array of 0-2 preventive actions: 'Request earlier SI given shipper pattern', 'Pre-arrange chassis for pickup'"],
  "predictedEta": "AI-estimated actual arrival based on carrier/route performance: 'Jan 25 (+3 days from scheduled)' | null",
  "etaConfidence": "high|medium|low|null (based on data quality and carrier reliability)"
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

## CRITICAL: ANTI-TEMPLATE RULES (READ CAREFULLY)

You MUST generate SHIPMENT-SPECIFIC summaries. NEVER use these generic phrases:
❌ "Missing booking, shipping instructions (SI), and verified gross mass (VGM)"
❌ "Potential demurrage and detention fees"
❌ "Critical pre-shipment documents are still pending"
❌ "Multiple pending actions require attention"

INSTEAD, be SPECIFIC to THIS shipment:
✅ "Awaiting SI v3 approval from Hapag since Jan 15 (3 days)"
✅ "Container MSKU1234567 at terminal 12 days, $1,800 detention accrued"
✅ "Hot loading required due to cargo rollover - safety review needed"
✅ "Invoice #INV-2025-001 for $5,804 unpaid since Jan 10"

## PRIORITY DETECTION RULES

When you see these keywords in chronicle, LEAD with them in your story:
- "hot loading", "safety", "hazmat", "dangerous" → SAFETY ALERT (critical priority)
- "escalation", "escalated" → ESCALATION (high priority)
- "detention", "demurrage", "free time" → FINANCIAL RISK (with calculation)
- "rollover", "rolled" → BOOKING AT RISK
- "amendment", "revision", "update" → Track version count
- "payment", "invoice", "outstanding" → PAYMENT STATUS

## SPECIFICITY REQUIREMENTS

Your story MUST include:
1. SPECIFIC party names from chronicle (not "the carrier" but "Hapag-Lloyd")
2. SPECIFIC dates with duration ("since Jan 15, 3 days ago")
3. SPECIFIC amounts when available ("$5,804" not "charges pending")
4. SPECIFIC container numbers when relevant
5. SPECIFIC contact info if in pending actions section

## WHAT CHANGED TRACKING

If CHRONICLE INTELLIGENCE section shows:
- Amendment count > 1 → Mention "SI/BL revised X times"
- Negative sentiment > 0 → Mention escalating tone
- Thread depth > 3 → Mention ongoing issue resolution
- Unresolved issues → Mention duration unresolved

Return ONLY valid JSON.`;

// =============================================================================
// SERVICE CLASS
// =============================================================================

export class HaikuSummaryService {
  private anthropic: Anthropic;
  private supabase: SupabaseClient;
  private actionRulesEngine: ActionRulesEngine;
  private intelligenceService: ShipmentIntelligenceService;

  constructor(supabase: SupabaseClient) {
    this.anthropic = new Anthropic();
    this.supabase = supabase;
    this.actionRulesEngine = new ActionRulesEngine(supabase);
    this.intelligenceService = createShipmentIntelligenceService(supabase);
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
        amount, currency, last_free_day,
        action_type, action_verb, action_owner, action_deadline_source, action_auto_resolve_on
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
   * Layer 4.5: Fetch intelligence signals for enhanced context
   * Escalations, sentiment, staleness, issue counts
   */
  private async getIntelligenceSignals(shipmentId: string): Promise<{
    escalationCount: number;
    urgentCount: number;
    negativeCount: number;
    issueCount: number;
    daysSinceActivity: number | null;
    lastActivityDate: string | null;
  }> {
    const { data } = await this.supabase
      .from('chronicle')
      .select('message_type, sentiment, has_issue, occurred_at')
      .eq('shipment_id', shipmentId)
      .order('occurred_at', { ascending: false });

    if (!data || data.length === 0) {
      return {
        escalationCount: 0,
        urgentCount: 0,
        negativeCount: 0,
        issueCount: 0,
        daysSinceActivity: null,
        lastActivityDate: null,
      };
    }

    const escalationCount = data.filter(d => d.message_type === 'escalation').length;
    const urgentCount = data.filter(d => d.sentiment === 'urgent').length;
    const negativeCount = data.filter(d => d.sentiment === 'negative').length;
    const issueCount = data.filter(d => d.has_issue).length;

    const lastActivity = data[0]?.occurred_at;
    let daysSinceActivity: number | null = null;
    if (lastActivity) {
      const lastDate = new Date(lastActivity);
      daysSinceActivity = Math.ceil((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
    }

    return {
      escalationCount,
      urgentCount,
      negativeCount,
      issueCount,
      daysSinceActivity,
      lastActivityDate: lastActivity,
    };
  }

  /**
   * Layer 4.7: Get rule-based actions from ActionRulesEngine
   * Returns time-based actions (cutoff triggers) and document flow positions
   */
  private async getRuleBasedActions(
    shipmentId: string,
    shipment: ShipmentContext,
    recent: RecentChronicle[]
  ): Promise<RuleBasedActionsContext> {
    try {
      // Get time-based actions (cutoff/ETA triggers)
      const timeBasedActions = await this.actionRulesEngine.getTimeBasedActions(
        shipmentId,
        shipment.stage || 'PENDING',
        {
          siCutoff: shipment.si_cutoff ? new Date(shipment.si_cutoff) : null,
          vgmCutoff: shipment.vgm_cutoff ? new Date(shipment.vgm_cutoff) : null,
          cargoCutoff: shipment.cargo_cutoff ? new Date(shipment.cargo_cutoff) : null,
          etd: shipment.etd ? new Date(shipment.etd) : null,
          eta: shipment.eta ? new Date(shipment.eta) : null,
        },
        {
          siSubmitted: recent.some(r => r.document_type === 'shipping_instructions' || r.document_type === 'si_confirmation'),
          vgmSubmitted: recent.some(r => r.document_type === 'vgm_confirmation'),
          blIssued: recent.some(r => r.document_type === 'final_bl' || r.document_type === 'sea_waybill'),
          isfFiled: recent.some(r => r.document_type === 'isf_filing'),
          containerPickedUp: recent.some(r => r.document_type === 'gate_out' || r.document_type === 'delivery_order'),
        }
      );

      // Get document flow positions for key document types
      const flowDocTypes = ['checklist', 'draft_entry', 'draft_bl', 'duty_invoice'];
      const documentFlows: FlowPosition[] = [];

      for (const docType of flowDocTypes) {
        // Only check flow if we have this document type in recent chronicles
        const hasDocType = recent.some(r => r.document_type === docType);
        if (hasDocType) {
          const flowPosition = await this.actionRulesEngine.getFlowPosition(docType, shipmentId);
          if (!flowPosition.isComplete && flowPosition.pendingAction) {
            documentFlows.push(flowPosition);
          }
        }
      }

      return { timeBasedActions, documentFlows };
    } catch (error) {
      console.error('[HaikuSummary] Error getting rule-based actions:', error);
      return { timeBasedActions: [], documentFlows: [] };
    }
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
    warnings: IntelligenceWarning[],
    signals: {
      escalationCount: number;
      urgentCount: number;
      negativeCount: number;
      issueCount: number;
      daysSinceActivity: number | null;
    },
    ruleBasedActions?: RuleBasedActionsContext,
    intelligence?: ShipmentIntelligence | null // P0-P3: Pre-computed intelligence
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

    // CRITICAL: Build explicit completion status for AI clarity
    const COMPLETION_TYPES = new Set([
      'booking_confirmation', 'si_confirmation', 'vgm_confirmation',
      'sob_confirmation', 'bl_draft', 'bl_final', 'telex_release',
      'container_release', 'delivery_order', 'gate_in', 'gate_out',
      'vessel_departed', 'vessel_arrived', 'cargo_loaded',
      'shipping_instructions', 'draft_bl', 'final_bl', 'sea_waybill'
    ]);

    // Track what milestones have been COMPLETED
    const completedMilestones: string[] = [];
    const pendingMilestones: string[] = [];

    // Check milestones from chronicle data
    const milestoneTypes = new Set(milestones.map(m => m.event_type));
    const recentTypes = new Set(recent.map(r => r.document_type).filter(Boolean));
    const allDocTypes = new Set([...milestoneTypes, ...recentTypes]);

    // Determine completion status for key milestones
    if (allDocTypes.has('booking_confirmation')) completedMilestones.push('✅ Booking Confirmed');
    else pendingMilestones.push('⏳ Booking Confirmation');

    if (allDocTypes.has('shipping_instructions') || allDocTypes.has('si_confirmation') || allDocTypes.has('si_submitted')) {
      completedMilestones.push('✅ SI Submitted');
    } else {
      pendingMilestones.push('⏳ SI Submission');
    }

    if (allDocTypes.has('si_confirmation')) completedMilestones.push('✅ SI Confirmed');

    if (allDocTypes.has('vgm_confirmation')) completedMilestones.push('✅ VGM Confirmed');
    else pendingMilestones.push('⏳ VGM Submission');

    if (allDocTypes.has('draft_bl') || allDocTypes.has('bl_draft')) completedMilestones.push('✅ Draft BL Received');

    if (allDocTypes.has('final_bl') || allDocTypes.has('bl_final') || allDocTypes.has('sea_waybill')) {
      completedMilestones.push('✅ Final BL/SWB Issued');
    }

    if (allDocTypes.has('telex_release')) completedMilestones.push('✅ Telex Released');
    if (allDocTypes.has('vessel_departed')) completedMilestones.push('✅ Vessel Departed');
    if (allDocTypes.has('vessel_arrived') || allDocTypes.has('arrival_notice')) completedMilestones.push('✅ Vessel Arrived');
    if (allDocTypes.has('container_release') || allDocTypes.has('delivery_order')) completedMilestones.push('✅ Container Released');

    // Build completion status section - CRITICAL for AI accuracy
    let completionStatusSection = `
## COMPLETION STATUS (What is DONE vs PENDING)
COMPLETED: ${completedMilestones.length > 0 ? completedMilestones.join(' | ') : 'None yet'}
STILL NEEDED: ${pendingMilestones.length > 0 ? pendingMilestones.join(' | ') : 'All complete'}

IMPORTANT: Do NOT say cutoffs "passed" if the required document was submitted BEFORE the cutoff.
If SI is submitted/confirmed, the SI cutoff was MET, not missed.`;

    if (milestones.length > 0) {
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

    // Build pending actions from recent (last 7 days) - ENHANCED with precise action data
    const pendingActions = recent.filter(r => r.has_action && !r.action_completed_at);
    let actionsSection = '';
    if (pendingActions.length > 0) {
      // Group actions by owner for better AI understanding
      const byOwner: Record<string, typeof pendingActions> = {};
      for (const a of pendingActions) {
        const owner = a.action_owner || 'operations';
        if (!byOwner[owner]) byOwner[owner] = [];
        byOwner[owner].push(a);
      }

      const ownerSections: string[] = [];
      for (const [owner, actions] of Object.entries(byOwner)) {
        const ownerLabel = owner.toUpperCase();
        const actionLines = actions.map(a => {
          const priority = a.action_priority || 'MEDIUM';
          const actionType = a.action_type || 'review';
          const verb = a.action_verb || 'Review';
          const deadline = a.action_deadline ? this.formatDateWithDays(a.action_deadline) : 'no deadline';
          const deadlineReason = a.action_deadline_source ? ` (${a.action_deadline_source})` : '';
          const contact = a.from_address ? `\n    Contact: ${a.from_address}` : '';
          const autoResolve = a.action_auto_resolve_on && a.action_auto_resolve_on.length > 0
            ? `\n    Auto-resolves when: ${a.action_auto_resolve_on.join(', ')}`
            : '';

          return `  - [${priority}] ${verb}: ${a.action_description}
    Type: ${actionType} | Deadline: ${deadline}${deadlineReason}${contact}${autoResolve}`;
        }).join('\n');

        ownerSections.push(`### ${ownerLabel} TEAM (${actions.length} action${actions.length > 1 ? 's' : ''})\n${actionLines}`);
      }

      actionsSection = `\n## PENDING ACTIONS BY OWNER\n${ownerSections.join('\n\n')}`;
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

    // Build response velocity & escalation signals section
    let signalsSection = '';
    const signalParts: string[] = [];

    if (signals.escalationCount > 0) {
      const urgency = signals.escalationCount >= 3 ? '🔴 CRITICAL' : signals.escalationCount >= 2 ? '🟡 HIGH' : 'ℹ️';
      signalParts.push(`${urgency}: ${signals.escalationCount} escalation(s) sent - REQUIRES IMMEDIATE ATTENTION`);
    }

    if (signals.negativeCount > 0) {
      signalParts.push(`⚠️ ${signals.negativeCount} negative sentiment message(s) detected`);
    }

    if (signals.urgentCount > 0) {
      signalParts.push(`⚡ ${signals.urgentCount} urgent message(s) in thread`);
    }

    if (signals.issueCount > 0) {
      signalParts.push(`📋 ${signals.issueCount} issue(s) detected in chronicle`);
    }

    if (signals.daysSinceActivity !== null && signals.daysSinceActivity > 3) {
      const staleness = signals.daysSinceActivity > 7 ? '🔴 STALE' : '🟡 SLOW';
      signalParts.push(`${staleness}: No activity for ${signals.daysSinceActivity} days - needs follow-up`);
    }

    if (signalParts.length > 0) {
      signalsSection = `\n## RESPONSE VELOCITY & ESCALATION SIGNALS\n${signalParts.join('\n')}`;
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

      // NEW: Preferred carriers - useful for carrier selection context
      if (p.preferredCarriers && p.preferredCarriers.length > 0) {
        const carrierList = p.preferredCarriers.slice(0, 3).join(', ');
        insights.push(`🚢 PREFERRED CARRIERS: ${carrierList}`);
      }

      // NEW: Common issue types - proactive risk awareness
      if (p.commonIssueTypes && p.commonIssueTypes.length > 0) {
        const issueList = p.commonIssueTypes.slice(0, 3).join(', ');
        insights.push(`⚠️ COMMON ISSUES: ${issueList}`);
      }

      // NEW: Relationship context - tenure affects trust level
      if (p.relationshipMonths !== undefined && p.relationshipMonths > 0) {
        if (p.relationshipMonths >= 12) {
          insights.push(`📅 RELATIONSHIP: ${Math.floor(p.relationshipMonths / 12)}+ years (established)`);
        } else if (p.relationshipMonths <= 3) {
          insights.push(`📅 RELATIONSHIP: ${p.relationshipMonths} months (new customer - extra verification)`);
        }
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

      // NEW: Performance factors - specific strengths/weaknesses
      if (p.performanceFactors && p.performanceFactors.length > 0) {
        const factors = p.performanceFactors.slice(0, 3).join(', ');
        insights.push(`📊 PERFORMANCE: ${factors}`);
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

    // Build CHRONICLE INTELLIGENCE section - computed signals from email data
    let chronicleIntelSection = '';
    const chronicleSignals: string[] = [];

    // 1. Sentiment Analysis
    const urgentEmails = recent.filter(r => r.sentiment === 'urgent').length;
    const negativeEmails = recent.filter(r => r.sentiment === 'negative').length;
    if (urgentEmails > 0 || negativeEmails > 0) {
      chronicleSignals.push(`📊 SENTIMENT: ${urgentEmails} urgent, ${negativeEmails} negative emails in last 7 days`);
    }

    // 2. Amendment/Revision Tracking
    const amendments = recent.filter(r =>
      r.document_type?.includes('amendment') ||
      r.summary?.toLowerCase().includes('amendment') ||
      r.summary?.toLowerCase().includes('revision') ||
      r.summary?.toLowerCase().includes('updated')
    ).length;
    if (amendments > 1) {
      chronicleSignals.push(`📝 AMENDMENTS: ${amendments} revisions detected - frequent changes`);
    }

    // 3. Escalation Detection
    const escalations = recent.filter(r =>
      r.message_type === 'escalation' ||
      r.summary?.toLowerCase().includes('escalat') ||
      r.summary?.toLowerCase().includes('urgent')
    ).length;
    if (escalations > 0) {
      chronicleSignals.push(`🚨 ESCALATIONS: ${escalations} escalation(s) in thread - requires attention`);
    }

    // 4. Safety/Priority Keywords Detection
    const safetyKeywords = ['hot loading', 'hazmat', 'dangerous', 'safety', 'rollover'];
    const hasSafetyAlert = recent.some(r =>
      safetyKeywords.some(kw => r.summary?.toLowerCase().includes(kw))
    );
    if (hasSafetyAlert) {
      chronicleSignals.push(`⚠️ SAFETY ALERT: Safety-related keywords detected in chronicle - review immediately`);
    }

    // 5. Unresolved Issues
    const unresolvedIssues = recent.filter(r => r.has_issue).length;
    if (unresolvedIssues > 0) {
      chronicleSignals.push(`❗ ISSUES: ${unresolvedIssues} issue(s) flagged in recent communications`);
    }

    // 6. Thread Activity Analysis
    const uniqueThreads = new Set(recent.filter(r => r.thread_id).map(r => r.thread_id));
    const avgEmailsPerThread = uniqueThreads.size > 0 ? recent.length / uniqueThreads.size : 0;
    if (avgEmailsPerThread > 3) {
      chronicleSignals.push(`💬 THREAD DEPTH: Avg ${avgEmailsPerThread.toFixed(1)} emails per thread - ongoing discussions`);
    }

    // 7. Party Communication Patterns
    const partyEmails: Record<string, number> = {};
    for (const r of recent) {
      const party = r.carrier_name || r.from_party || 'unknown';
      partyEmails[party] = (partyEmails[party] || 0) + 1;
    }
    const topParties = Object.entries(partyEmails)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .filter(([_, count]) => count >= 2);
    if (topParties.length > 0) {
      const partyList = topParties.map(([party, count]) => `${party}: ${count}`).join(', ');
      chronicleSignals.push(`📧 COMMUNICATION: ${partyList} emails in 7 days`);
    }

    // 8. Financial Signals from Chronicle
    const financialMentions = recent.filter(r =>
      r.amount ||
      r.summary?.toLowerCase().includes('invoice') ||
      r.summary?.toLowerCase().includes('payment') ||
      r.summary?.toLowerCase().includes('detention') ||
      r.summary?.toLowerCase().includes('demurrage')
    );
    if (financialMentions.length > 0) {
      const amounts = financialMentions.filter(r => r.amount).map(r => `${r.currency || 'USD'} ${r.amount}`);
      if (amounts.length > 0) {
        chronicleSignals.push(`💰 FINANCIAL: ${amounts.slice(0, 3).join(', ')} mentioned in emails`);
      } else {
        chronicleSignals.push(`💰 FINANCIAL: ${financialMentions.length} financial-related emails detected`);
      }
    }

    if (chronicleSignals.length > 0) {
      chronicleIntelSection = `\n## CHRONICLE INTELLIGENCE (Computed from ${recent.length} emails)\n${chronicleSignals.join('\n')}`;
    }

    // Build rule-based actions section (time-based triggers and document flows)
    let ruleBasedActionsSection = '';
    if (ruleBasedActions) {
      const parts: string[] = [];

      // Time-based actions (cutoff triggers)
      if (ruleBasedActions.timeBasedActions.length > 0) {
        const firingActions = ruleBasedActions.timeBasedActions.filter(a => a.isFiring);
        const upcomingActions = ruleBasedActions.timeBasedActions.filter(a => !a.isFiring && a.hoursUntilTrigger > 0);

        if (firingActions.length > 0) {
          const firingLines = firingActions.map(a =>
            `🔴 NOW: ${a.actionDescription} (${a.urgency.toUpperCase()}) - Owner: ${a.actionOwner}`
          ).join('\n');
          parts.push(`### ACTIVE TRIGGERS (Action Required NOW)\n${firingLines}`);
        }

        if (upcomingActions.length > 0) {
          const upcomingLines = upcomingActions.slice(0, 3).map(a => {
            const hours = Math.round(a.hoursUntilTrigger);
            const timeStr = hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
            return `⏰ ${timeStr}: ${a.actionDescription} (${a.urgency})`;
          }).join('\n');
          parts.push(`### UPCOMING TRIGGERS\n${upcomingLines}`);
        }
      }

      // Document flow positions (multi-step workflows)
      if (ruleBasedActions.documentFlows.length > 0) {
        const flowLines = ruleBasedActions.documentFlows.map(f => {
          const stepInfo = f.nextStep ? `Step ${f.currentStep + 1}: ${f.nextStep.action} → ${f.nextStep.to_party}` : '';
          return `📋 ${f.documentType}: ${f.pendingAction || 'Awaiting next step'} ${stepInfo}`;
        }).join('\n');
        parts.push(`### DOCUMENT FLOWS IN PROGRESS\n${flowLines}`);
      }

      if (parts.length > 0) {
        ruleBasedActionsSection = `\n## RULE-BASED ACTIONS (Automatic triggers from workflow rules)
${parts.join('\n\n')}

IMPORTANT: These are PRE-COMPUTED actions from business rules. Use them to populate nextAction if relevant.
Active triggers (NOW) should be your PRIORITY nextAction.`;
      }
    }

    // P0-P3: Add pre-computed intelligence section (anti-hallucination)
    let preComputedSection = '';
    if (intelligence) {
      preComputedSection = buildPreComputedSection(intelligence);
    }

    return `${header}${schedule}${alertSection}${completionStatusSection}${chronicleIntelSection}${daysOverdueSection}${financialSection}${warningsSection}${intelligenceSection}${ruleBasedActionsSection}${preComputedSection}${milestoneSection}${recentSection}${actionsSection}

Analyze this shipment and return the JSON summary. Remember:
1. Use ACTUAL documented charges from FINANCIAL CHARGES section
2. Calculate detention: [days] × $150/day = $[total]
3. Include days overdue in story if past ETA
4. Distinguish BLOCKER (external dependency) vs TASK (Intoglo can do now)
5. Set customerActionRequired=true if customer must act
6. Be SPECIFIC - use party names, dates, amounts from the data above
7. If CHRONICLE INTELLIGENCE shows escalations/safety alerts, LEAD with them
8. If RULE-BASED ACTIONS has active triggers, prioritize them in nextAction
9. Use PRE-COMPUTED FACTS section values EXACTLY - do not recalculate SLA hours, escalation level, or financial exposure
10. Generate customerDraftBody email if SLA is BREACHED or CRITICAL`;
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
    warnings: IntelligenceWarning[],
    signals: {
      escalationCount: number;
      urgentCount: number;
      negativeCount: number;
      issueCount: number;
      daysSinceActivity: number | null;
    },
    ruleBasedActions?: RuleBasedActionsContext,
    intelligence?: ShipmentIntelligence | null // P0-P3: Pre-computed intelligence
  ): Promise<GenerationResult> {
    const userPrompt = this.buildPrompt(shipment, milestones, recent, urgencies, profiles, financial, warnings, signals, ruleBasedActions, intelligence);

    // Use enhanced system prompt with anti-hallucination rules
    const enhancedSystemPrompt = intelligence
      ? SYSTEM_PROMPT + ENHANCED_SYSTEM_PROMPT_ADDITIONS
      : SYSTEM_PROMPT;

    const response = await this.anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 1500, // Increased for enhanced P0-P3 output
      system: enhancedSystemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    let summary: AISummary;

    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.log('[HaikuSummary] No JSON in response:', text.substring(0, 200));
      }
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
          documentedCharges: parsed.documentedCharges || null,
          estimatedDetention: parsed.estimatedDetention || null,
          customerImpact: parsed.customerImpact || null,
          customerActionRequired: parsed.customerActionRequired || false,
          riskLevel: parsed.riskLevel || 'amber',
          riskReason: parsed.riskReason || null,
          daysOverdue: parsed.daysOverdue || null,
          // Intelligence signals (populated from signals param, not AI)
          escalationCount: signals.escalationCount > 0 ? signals.escalationCount : null,
          daysSinceActivity: signals.daysSinceActivity,
          issueCount: signals.issueCount > 0 ? signals.issueCount : null,
          urgentMessageCount: (signals.urgentCount + signals.negativeCount) > 0 ? signals.urgentCount + signals.negativeCount : null,
          carrierPerformance: profiles.carrier ? `${profiles.carrier.carrierName}: ${profiles.carrier.onTimeArrivalRate ?? 'N/A'}% on-time` : null,
          shipperRiskSignal: profiles.shipper && profiles.shipper.riskScore >= 30 ? `${profiles.shipper.siLateRate ?? 0}% SI late, risk ${profiles.shipper.riskScore}` : null,
          // Predictive elements (from AI)
          predictedRisks: Array.isArray(parsed.predictedRisks) ? parsed.predictedRisks.slice(0, 3) : null,
          proactiveRecommendations: Array.isArray(parsed.proactiveRecommendations) ? parsed.proactiveRecommendations.slice(0, 2) : null,
          predictedEta: parsed.predictedEta || null,
          etaConfidence: ['high', 'medium', 'low'].includes(parsed.etaConfidence) ? parsed.etaConfidence : null,
          // P0: SLA Status (will be overwritten by post-validation)
          slaStatus: parsed.slaStatus || null,
          hoursSinceCustomerUpdate: parsed.hoursSinceCustomerUpdate || null,
          slaSummary: parsed.slaSummary || null,
          // P1: Escalation Level (will be overwritten by post-validation)
          escalationLevel: parsed.escalationLevel || null,
          escalateTo: parsed.escalateTo || null,
          // P2: Root Cause (will be overwritten by post-validation)
          rootCauseCategory: parsed.rootCauseCategory || null,
          rootCauseSubcategory: parsed.rootCauseSubcategory || null,
          typicalResolutionDays: parsed.typicalResolutionDays || null,
          benchmarkReference: parsed.benchmarkReference || null,
          // P0: Customer Draft (AI-generated)
          customerDraftSubject: parsed.customerDraftSubject || null,
          customerDraftBody: parsed.customerDraftBody || null,
          // P3: Confidence (will be overwritten by post-validation)
          recommendationConfidence: parsed.recommendationConfidence || null,
          confidenceReason: parsed.confidenceReason || null,
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
        documentedCharges: null,
        estimatedDetention: null,
        customerImpact: null,
        customerActionRequired: false,
        riskLevel: 'amber',
        riskReason: 'AI parsing failed',
        daysOverdue: null,
        // Intelligence signals (populate from signals even on error)
        escalationCount: signals.escalationCount > 0 ? signals.escalationCount : null,
        daysSinceActivity: signals.daysSinceActivity,
        issueCount: signals.issueCount > 0 ? signals.issueCount : null,
        urgentMessageCount: (signals.urgentCount + signals.negativeCount) > 0 ? signals.urgentCount + signals.negativeCount : null,
        carrierPerformance: profiles.carrier ? `${profiles.carrier.carrierName}: ${profiles.carrier.onTimeArrivalRate ?? 'N/A'}% on-time` : null,
        shipperRiskSignal: profiles.shipper && profiles.shipper.riskScore >= 30 ? `${profiles.shipper.siLateRate ?? 0}% SI late, risk ${profiles.shipper.riskScore}` : null,
        // Predictive elements (null on error)
        predictedRisks: null,
        proactiveRecommendations: null,
        predictedEta: null,
        etaConfidence: null,
        // P0-P3 fields (null on error, will be filled by post-validation if intelligence available)
        slaStatus: null,
        hoursSinceCustomerUpdate: null,
        slaSummary: null,
        escalationLevel: null,
        escalateTo: null,
        rootCauseCategory: null,
        rootCauseSubcategory: null,
        typicalResolutionDays: null,
        benchmarkReference: null,
        customerDraftSubject: null,
        customerDraftBody: null,
        recommendationConfidence: null,
        confidenceReason: null,
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
  // POST-GENERATION VALIDATION (Business Rules Layer)
  // ===========================================================================

  /**
   * Validates and corrects AI output based on business rules.
   * This layer catches logical errors that the AI may make.
   *
   * Rules:
   * 1. DELIVERED = No urgency (clear daysOverdue, set green)
   * 2. Future ETA = Not overdue (daysOverdue must be null)
   * 3. Pre-Arrival = No detention (remove detention from financial impact)
   * 4. Customer Action = Set flag when customer must act
   * 5. Blocker Type = Infer if missing but blocker exists
   * 6. Correct daysOverdue = Recalculate from ETA if needed
   * 7. Risk Level Consistency
   * 8. Sentiment-based Risk Boost (escalations/urgent messages boost risk)
   */
  private validateAndEnrich(
    result: GenerationResult,
    shipment: ShipmentContext,
    signals?: { escalationCount: number; urgentCount: number; negativeCount: number; issueCount: number; daysSinceActivity: number | null }
  ): GenerationResult {
    const summary = { ...result.summary };
    const stage = (shipment.stage || 'PENDING').toUpperCase();
    const today = new Date();
    const eta = shipment.eta ? new Date(shipment.eta) : null;


    // Stage categories
    const TERMINAL_STAGES = ['DELIVERED', 'COMPLETED', 'CANCELLED'];
    const PRE_ARRIVAL_STAGES = ['PENDING', 'DRAFT', 'BOOKED', 'BOOKING_CONFIRMED', 'SI_SUBMITTED', 'SI_CONFIRMED', 'DRAFT_BL', 'BL_ISSUED', 'DEPARTED', 'IN_TRANSIT', 'TRANSSHIPMENT'];

    // =========================================================================
    // RULE 1: DELIVERED/COMPLETED = No Urgency
    // Delivered shipments should be green unless post-delivery payment issue
    // =========================================================================
    if (TERMINAL_STAGES.includes(stage)) {
      summary.daysOverdue = null;

      // Only keep blocker if it's payment-related
      const isPaymentBlocker = summary.currentBlocker?.toLowerCase().includes('payment') ||
                               summary.currentBlocker?.toLowerCase().includes('invoice') ||
                               summary.currentBlocker?.toLowerCase().includes('outstanding');

      if (!isPaymentBlocker) {
        summary.riskLevel = 'green';
        summary.currentBlocker = null;
        summary.blockerOwner = null;
        summary.blockerType = null;
      }
    }

    // =========================================================================
    // RULE 2: Future ETA = Not Overdue
    // If ETA is in the future, daysOverdue MUST be null (not positive)
    // =========================================================================
    if (eta && eta > today) {
      if (summary.daysOverdue !== null && summary.daysOverdue > 0) {
        // AI incorrectly set overdue for future ETA - correct it
        summary.daysOverdue = null;
      }
    }

    // =========================================================================
    // RULE 3: Pre-Arrival = No Detention
    // Detention/demurrage cannot occur before cargo arrives
    // =========================================================================
    if (PRE_ARRIVAL_STAGES.includes(stage)) {
      // Clear estimated detention for pre-arrival (detention is impossible)
      summary.estimatedDetention = null;

      // Clean financialImpact to remove detention references
      if (summary.financialImpact) {
        const lower = summary.financialImpact.toLowerCase();
        if (lower.includes('detention') || lower.includes('demurrage')) {
          // Keep only documented charges in combined field
          summary.financialImpact = summary.documentedCharges || null;
        }
      }
    }

    // =========================================================================
    // RULE 4: Customer Action Logic Coherence
    // If action owner is customer/shipper/consignee, flag it
    // =========================================================================
    const customerParties = ['customer', 'shipper', 'consignee'];
    const isCustomerOwner =
      customerParties.some(p => summary.actionOwner?.toLowerCase().includes(p)) ||
      summary.blockerOwner?.toLowerCase() === shipment.shipper_name?.toLowerCase() ||
      summary.blockerOwner?.toLowerCase() === shipment.consignee_name?.toLowerCase();

    if (isCustomerOwner && !summary.customerActionRequired) {
      summary.customerActionRequired = true;
    }

    // =========================================================================
    // RULE 5: Blocker Type Required
    // If there's a blocker but no type, infer it
    // =========================================================================
    if (summary.currentBlocker && !summary.blockerType) {
      // Infer type based on blocker owner
      const intogloIndicators = ['intoglo', 'ops', 'team', 'we ', 'our '];
      const isInternal = intogloIndicators.some(ind =>
        summary.blockerOwner?.toLowerCase().includes(ind) ||
        summary.currentBlocker?.toLowerCase().includes(ind)
      );

      summary.blockerType = isInternal ? 'internal_task' : 'external_dependency';
    }

    // =========================================================================
    // RULE 6: Correct daysOverdue Calculation
    // Recalculate if ETA is past and not in terminal stage
    // =========================================================================
    if (!TERMINAL_STAGES.includes(stage) && eta && eta <= today) {
      const correctDays = Math.ceil((today.getTime() - eta.getTime()) / (1000 * 60 * 60 * 24));

      // Only override if AI got it significantly wrong (off by more than 1 day)
      if (summary.daysOverdue === null || Math.abs(summary.daysOverdue - correctDays) > 1) {
        summary.daysOverdue = correctDays;
      }
    }

    // =========================================================================
    // RULE 7: Risk Level Consistency
    // Ensure risk level matches the actual situation
    // =========================================================================
    if (!TERMINAL_STAGES.includes(stage)) {
      // High overdue = should be red or amber
      if (summary.daysOverdue !== null && summary.daysOverdue > 14 && summary.riskLevel === 'green') {
        summary.riskLevel = 'red';
        if (!summary.riskReason?.includes('overdue')) {
          summary.riskReason = `${summary.daysOverdue} days overdue`;
        }
      } else if (summary.daysOverdue !== null && summary.daysOverdue > 7 && summary.riskLevel === 'green') {
        summary.riskLevel = 'amber';
      }
    }

    // =========================================================================
    // RULE 8: Sentiment-Based Risk Boost
    // Multiple escalations or negative sentiment indicates elevated risk
    // =========================================================================
    if (signals && !TERMINAL_STAGES.includes(stage)) {
      const { escalationCount, urgentCount, negativeCount, issueCount, daysSinceActivity } = signals;

      // Critical: 3+ escalations = always red
      if (escalationCount >= 3 && summary.riskLevel !== 'red') {
        summary.riskLevel = 'red';
        summary.riskReason = `${escalationCount} escalations sent - requires immediate attention`;
      }
      // High: 2 escalations OR (1 escalation + multiple issues)
      else if (escalationCount >= 2 && summary.riskLevel === 'green') {
        summary.riskLevel = 'amber';
        if (!summary.riskReason) {
          summary.riskReason = `${escalationCount} escalations detected`;
        }
      }
      else if (escalationCount >= 1 && issueCount >= 2 && summary.riskLevel === 'green') {
        summary.riskLevel = 'amber';
        if (!summary.riskReason) {
          summary.riskReason = `${issueCount} issues with escalation`;
        }
      }

      // High urgency/negative sentiment combo
      const sentimentScore = urgentCount * 2 + negativeCount;
      if (sentimentScore >= 4 && summary.riskLevel === 'green') {
        summary.riskLevel = 'amber';
        if (!summary.riskReason) {
          summary.riskReason = `${urgentCount + negativeCount} urgent/negative messages`;
        }
      }

      // Staleness boost: No activity for 7+ days
      if (daysSinceActivity !== null && daysSinceActivity >= 7 && summary.riskLevel === 'green') {
        summary.riskLevel = 'amber';
        if (!summary.riskReason) {
          summary.riskReason = `No activity for ${daysSinceActivity} days - needs follow-up`;
        }
      }
    }

    // =========================================================================
    // RULE 9: Stale Data Cap (>90 days overdue = data quality issue)
    // Shipments >90 days past ETA are likely closed but not properly marked
    // Cap at 90 days to avoid showing unrealistic numbers like 377d
    // =========================================================================
    const STALE_DATA_THRESHOLD_DAYS = 90;
    if (summary.daysOverdue !== null && summary.daysOverdue > STALE_DATA_THRESHOLD_DAYS) {
      // This is likely a data quality issue - shipment should be DELIVERED/CANCELLED
      summary.riskLevel = 'amber'; // Flag as needing attention but not critical
      summary.riskReason = `Stale data: ${summary.daysOverdue}d past ETA - verify shipment status`;
      summary.daysOverdue = STALE_DATA_THRESHOLD_DAYS; // Cap the display value

      // Add a data quality note to the narrative if it mentions extreme days
      if (summary.narrative && /\d{3,}\s*days?/i.test(summary.narrative)) {
        summary.narrative = summary.narrative.replace(
          /(\d{3,})\s*(days?)/gi,
          `90+ $2 (data review needed)`
        );
      }
    }

    // =========================================================================
    // RULE 10: Stage-Inappropriate Predicted Risks
    // Remove predictions that are impossible given the current stage
    // =========================================================================
    const POST_DEPARTURE_STAGES = ['BL_ISSUED', 'DEPARTED', 'IN_TRANSIT', 'TRANSSHIPMENT', 'ARRIVED', 'CUSTOMS_CLEARED', 'DELIVERED', 'COMPLETED'];
    const isPostDeparture = POST_DEPARTURE_STAGES.includes(stage);

    if (isPostDeparture && summary.predictedRisks && summary.predictedRisks.length > 0) {
      // Filter out pre-departure risks that are impossible post-departure
      const preDepartureRiskPatterns = [
        /rollover/i,           // Can't roll over cargo already on vessel
        /missed?\s*(si|vgm|cargo)\s*cutoff/i,  // Cutoffs are pre-departure
        /booking\s*cancel/i,   // Can't cancel shipped booking
        /space\s*(loss|unavailable)/i,  // Space issues are pre-departure
      ];

      summary.predictedRisks = summary.predictedRisks.filter(risk => {
        const isInappropriate = preDepartureRiskPatterns.some(pattern => pattern.test(risk));
        if (isInappropriate) {
          console.log(`[HaikuSummary] Filtered stage-inappropriate risk at ${stage}: "${risk}"`);
        }
        return !isInappropriate;
      });

      // Set to null if all risks were filtered
      if (summary.predictedRisks.length === 0) {
        summary.predictedRisks = null;
      }
    }

    // Also filter blockers that mention pre-departure concepts for post-departure stages
    if (isPostDeparture && summary.currentBlocker) {
      const preDepartureBlockerPatterns = [
        /rollover/i,
        /vessel\s*space/i,
        /booking\s*(not\s*)?confirm/i,
        /cutoff.*(miss|pass|overdue)/i,  // Cutoffs can't be missed if BL is issued
        /(miss|pass|overdue).*cutoff/i,
        /(si|vgm|cargo)\s*cutoff/i,      // Pre-departure cutoff references
      ];

      const hasInappropriateBlocker = preDepartureBlockerPatterns.some(
        pattern => pattern.test(summary.currentBlocker || '')
      );

      if (hasInappropriateBlocker) {
        console.log(`[HaikuSummary] Filtered stage-inappropriate blocker at ${stage}: "${summary.currentBlocker}"`);
        summary.currentBlocker = null;
        summary.blockerOwner = null;
        summary.blockerType = null;
      }
    }

    // =========================================================================
    // RULE 11: Clean Up Stage-Inappropriate Language in Narratives
    // If BL is issued, cutoffs were MET (not missed) - fix misleading language
    // =========================================================================
    if (isPostDeparture) {
      // Fix narrative
      if (summary.narrative) {
        summary.narrative = summary.narrative
          .replace(/cutoffs?\s*(were\s*)?(missed|passed|overdue)/gi, 'cutoffs were met')
          .replace(/(missed|overdue)\s*cutoffs?/gi, 'met cutoffs')
          .replace(/pending\s*(si|vgm|cargo)\s*(submission|cutoff)/gi, 'completed $1')
          .replace(/(si|vgm)\s*not\s*(yet\s*)?(submitted|complete)/gi, '$1 completed');
      }

      // Fix story
      if (summary.story) {
        summary.story = summary.story
          .replace(/cutoffs?\s*(were\s*)?(missed|passed|overdue)/gi, 'cutoffs were met')
          .replace(/(missed|overdue)\s*cutoffs?/gi, 'met cutoffs')
          .replace(/pending\s*(si|vgm|cargo)\s*(submission|cutoff)/gi, 'completed $1')
          .replace(/(si|vgm)\s*not\s*(yet\s*)?(submitted|complete)/gi, '$1 completed');
      }

      // Fix risk reason
      if (summary.riskReason) {
        summary.riskReason = summary.riskReason
          .replace(/cutoffs?\s*(missed|passed|overdue)/gi, 'documentation delays')
          .replace(/(missed|overdue)\s*cutoffs?/gi, 'prior delays')
          .replace(/rollover\s*risk/gi, 'transit risk');
      }

      // Fix key insight
      if (summary.keyInsight) {
        summary.keyInsight = summary.keyInsight
          .replace(/cutoffs?\s*(missed|passed|overdue)/gi, 'documentation completed')
          .replace(/(missed|overdue)\s*cutoffs?/gi, 'prior delays');
      }
    }

    return { ...result, summary };
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
        documented_charges: summary.documentedCharges,
        estimated_detention: summary.estimatedDetention,
        customer_impact: summary.customerImpact,
        customer_action_required: summary.customerActionRequired,
        risk_level: summary.riskLevel,
        risk_reason: summary.riskReason,
        days_overdue: summary.daysOverdue,
        // Intelligence signals
        escalation_count: summary.escalationCount,
        days_since_activity: summary.daysSinceActivity,
        issue_count: summary.issueCount,
        urgent_message_count: summary.urgentMessageCount,
        carrier_performance: summary.carrierPerformance,
        shipper_risk_signal: summary.shipperRiskSignal,
        // Predictive elements
        predicted_risks: summary.predictedRisks,
        proactive_recommendations: summary.proactiveRecommendations,
        predicted_eta: summary.predictedEta,
        eta_confidence: summary.etaConfidence,
        // P0: SLA Status (pre-computed, anti-hallucination)
        sla_status: summary.slaStatus,
        hours_since_customer_update: summary.hoursSinceCustomerUpdate,
        sla_breach_reason: summary.slaSummary,
        // P1: Escalation Level (pre-computed, anti-hallucination)
        escalation_level: summary.escalationLevel,
        escalate_to: summary.escalateTo,
        // P2: Root Cause (pre-computed, anti-hallucination)
        root_cause_category: summary.rootCauseCategory,
        root_cause_subcategory: summary.rootCauseSubcategory,
        typical_resolution_days: summary.typicalResolutionDays,
        benchmark_source: summary.benchmarkReference,
        // P0: Customer Draft (AI-generated based on facts)
        customer_draft_subject: summary.customerDraftSubject,
        customer_draft_body: summary.customerDraftBody,
        // P3: Confidence (AI self-assessment)
        recommendation_confidence: summary.recommendationConfidence,
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

    // Layer 1.5: Get PRE-COMPUTED INTELLIGENCE (anti-hallucination layer)
    const intelligence = await this.intelligenceService.getIntelligence(shipmentId);
    if (intelligence) {
      console.log(`[HaikuSummary] Intelligence loaded: SLA=${intelligence.sla.slaStatus}, Escalation=${intelligence.escalation.escalationLevel}`);
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

    // Layer 4.6: Get intelligence signals (escalations, sentiment, staleness)
    const signals = await this.getIntelligenceSignals(shipmentId);

    // Layer 4.7: Get rule-based actions (time-based triggers, document flows)
    const ruleBasedActions = await this.getRuleBasedActions(shipmentId, shipment, recent);

    // Layer 5-8: Cross-shipment intelligence profiles
    const [shipperProfile, consigneeProfile, carrierProfile, routeProfile] = await Promise.all([
      this.getShipperProfile(shipment.shipper_name),
      this.getConsigneeProfile(shipment.consignee_name),
      this.getCarrierProfile(shipment.carrier_name),
      this.getRouteProfile(shipment.port_of_loading_code, shipment.port_of_discharge_code),
    ]);

    // Generate AI summary with financial data, warnings, intelligence signals, rule-based actions, AND pre-computed intelligence
    const rawResult = await this.generateSummary(
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
      warnings,
      signals,
      ruleBasedActions,
      intelligence // P0-P3: Pre-computed intelligence for anti-hallucination
    );

    // CRITICAL: Validate and enrich AI output with business rules
    // This catches logical errors like "DELIVERED with overdue" or "future ETA overdue"
    let validatedResult = this.validateAndEnrich(rawResult, shipment, signals);

    // P0-P3: Additional validation against pre-computed values (anti-hallucination)
    if (intelligence) {
      validatedResult = {
        ...validatedResult,
        summary: validateAgainstPreComputed(validatedResult.summary, intelligence),
      };
    }

    // Save validated result to database
    await this.saveSummary(shipmentId, validatedResult, warnings);

    return validatedResult;
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

    // Get all summaries with their timestamps
    const { data: allSummaries } = await this.supabase
      .from('shipment_ai_summaries')
      .select('shipment_id, updated_at');

    const summaryMap = new Map<string, Date>();
    for (const s of allSummaries || []) {
      summaryMap.set(s.shipment_id, new Date(s.updated_at));
    }

    // Find stale summaries: shipments with new chronicles AFTER summary was generated
    // These need to be regenerated regardless of age
    const { data: staleSummaries } = await this.supabase.rpc('get_stale_summaries');
    const staleIds = new Set<string>((staleSummaries || []).map((r: { shipment_id: string }) => r.shipment_id));

    // Filter out shipments with recent summaries (< 6 hours old) UNLESS they have new data
    const recentCutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
    const recentIds = new Set<string>();
    for (const [shipmentId, updatedAt] of summaryMap) {
      // Skip if summary is recent AND not stale (no new data)
      if (updatedAt > recentCutoff && !staleIds.has(shipmentId)) {
        recentIds.add(shipmentId);
      }
    }

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

    // Priority 0: STALE summaries first (have new data since last summary)
    // Convert Set to array of objects for addIds
    const staleShipmentIds = Array.from(staleIds).map(id => ({ id }));
    addIds(staleShipmentIds);

    // Priority 1-4: Other shipments by ETD urgency
    addIds(upcomingShipments);
    addIds(recentPastShipments);
    addIds(noEtdShipments);
    addIds(olderShipments);

    console.log(`[AI-Summary] Found ${staleIds.size} stale, ${allIds.length} total needing update`);

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
