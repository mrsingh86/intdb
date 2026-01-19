/**
 * ShipmentIntelligenceService
 *
 * Queries pre-computed database views to provide factual data to AI prompts.
 * This is the ANTI-HALLUCINATION layer - all values come from database, not AI.
 *
 * Features:
 * - P0: SLA Status (hours_since_customer_update, sla_status)
 * - P1: Escalation Level (L1/L2/L3, escalate_to)
 * - P2: Root Cause Classification (category, subcategory, typical_resolution)
 * - P2: Resolution Benchmarks (similar cases avg days)
 * - P3: Data Completeness Score
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// INTERFACES
// ============================================================================

export interface SlaStatus {
  slaStatus: 'OK' | 'AT_RISK' | 'CRITICAL' | 'BREACHED' | 'NO_CONTACT';
  hoursSinceCustomerUpdate: number | null;
  hoursAwaitingResponse: number | null;
  responsePending: boolean;
  unansweredCustomerEmails: number;
  nextSlaDeadline: string | null;
}

export interface EscalationInfo {
  escalationLevel: 'L1' | 'L2' | 'L3';
  escalateTo: string;
  escalationReason: string;
  daysOverdue: number | null;
  estimatedExposureUsd: number;
  escalationCount: number;
  issueCount: number;
  urgentMessageCount: number;
  priorityScore: number;
}

export interface RootCause {
  category: 'CARRIER' | 'PORT' | 'CUSTOMS' | 'CUSTOMER' | 'LOGISTICS' | 'INTOGLO' | null;
  subcategory: string | null;
  typicalResolutionDays: number | null;
  resolutionOwner: string | null;
  requiresCustomerAction: boolean;
  matchConfidence: 'high' | 'medium' | 'low' | null;
}

export interface ResolutionBenchmark {
  benchmarkSource: string;
  avgDays: number;
  sampleSize: number;
  confidence: 'high' | 'medium' | 'low';
}

export type CutoffStatus = 'OK' | 'DUE_SOON' | 'OVERDUE' | 'NO_DATE';
export type DelayCategory = 'PRE_DEPARTURE' | 'DEPARTURE' | 'TRANSIT' | 'DELIVERY' | 'UNKNOWN';
export type DelayType = 'SI_DELAY' | 'VGM_DELAY' | 'DOC_DELAY' | 'CARGO_DELAY' | 'DEPARTURE_DELAY' | 'ARRIVAL_DELAY' | 'DELIVERY_DELAY' | 'NO_DELAY' | 'UNKNOWN';

export interface CutoffDelays {
  siCutoff: string | null;
  siDelayDays: number;
  siStatus: CutoffStatus;
  vgmCutoff: string | null;
  vgmDelayDays: number;
  vgmStatus: CutoffStatus;
  docCutoff: string | null;
  docDelayDays: number;
  docStatus: CutoffStatus;
  cargoCutoff: string | null;
  cargoDelayDays: number;
  cargoStatus: CutoffStatus;
}

export interface DelayBreakdown {
  // Key dates
  etd: string | null;
  etdSource: string | null;
  eta: string | null;
  etaSource: string | null;
  lastFreeDay: string | null;

  // Cutoff delays (for pre-departure)
  cutoffs: CutoffDelays;

  // Stage-specific delays
  departureDelayDays: number;
  arrivalDelayDays: number;
  deliveryDelayDays: number;

  // Computed summary
  delayCategory: DelayCategory;
  primaryDelayType: DelayType;
  primaryDelayDays: number;
  delaySummary: string;
}

export interface ShipmentIntelligence {
  shipmentId: string;
  intogloReference: string | null;
  stage: string | null;
  shipperName: string | null;
  consigneeName: string | null;
  carrierName: string | null;

  // P0: SLA Status
  sla: SlaStatus;

  // P1: Escalation
  escalation: EscalationInfo;

  // P2: Root Cause (if blocker exists)
  rootCause: RootCause | null;

  // P2: Benchmarks
  benchmarks: ResolutionBenchmark[];

  // P3: Data Completeness
  dataCompletenessScore: number;

  // P4: Categorized Delay Breakdown
  delayBreakdown: DelayBreakdown | null;

  // Existing AI summary data
  currentBlocker: string | null;
  blockerOwner: string | null;
  riskLevel: string | null;
}

export interface CustomerDraftContext {
  shipmentReference: string;
  customerName: string;
  currentStatus: string;
  delayReason: string | null;
  daysOverdue: number | null;
  estimatedExposure: number | null;
  nextAction: string | null;
  contactEmail: string | null;
}

// ============================================================================
// SERVICE
// ============================================================================

export class ShipmentIntelligenceService {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Get all pre-computed intelligence for a shipment.
   * This is the main entry point - returns everything needed for AI prompt.
   */
  async getIntelligence(shipmentId: string): Promise<ShipmentIntelligence | null> {
    // Query the combined intelligence view
    const { data: intel, error } = await this.supabase
      .from('v_shipment_intelligence')
      .select('*')
      .eq('shipment_id', shipmentId)
      .single();

    if (error || !intel) {
      console.warn(`[ShipmentIntelligence] No data for shipment ${shipmentId}:`, error?.message);
      return null;
    }

    // Get root cause if blocker exists
    let rootCause: RootCause | null = null;
    if (intel.current_blocker) {
      rootCause = await this.matchRootCause(intel.current_blocker);
    }

    // Get resolution benchmarks
    const benchmarks = await this.getBenchmarks(
      intel.current_blocker,
      rootCause?.category || null
    );

    // Calculate data completeness
    const dataCompletenessScore = this.calculateDataCompleteness(intel);

    // Get categorized delay breakdown
    const delayBreakdown = await this.getDelayBreakdown(shipmentId);

    return {
      shipmentId: intel.shipment_id,
      intogloReference: intel.intoglo_reference,
      stage: intel.stage,
      shipperName: intel.shipper_name,
      consigneeName: intel.consignee_name,
      carrierName: intel.carrier_name,

      sla: {
        slaStatus: intel.sla_status || 'NO_CONTACT',
        hoursSinceCustomerUpdate: intel.hours_since_customer_update,
        hoursAwaitingResponse: intel.hours_awaiting_response,
        responsePending: intel.response_pending || false,
        unansweredCustomerEmails: intel.unanswered_customer_emails || 0,
        nextSlaDeadline: intel.next_sla_deadline,
      },

      escalation: {
        escalationLevel: intel.escalation_level || 'L1',
        escalateTo: intel.escalate_to || 'Operations Team',
        escalationReason: intel.escalation_reason || 'Normal operations',
        daysOverdue: intel.days_overdue,
        estimatedExposureUsd: intel.estimated_exposure_usd || 0,
        escalationCount: intel.escalation_count || 0,
        issueCount: intel.issue_count || 0,
        urgentMessageCount: intel.urgent_message_count || 0,
        priorityScore: intel.priority_score || 0,
      },

      rootCause,
      benchmarks,
      dataCompletenessScore,
      delayBreakdown,

      currentBlocker: intel.current_blocker,
      blockerOwner: intel.blocker_owner,
      riskLevel: intel.risk_level,
    };
  }

  /**
   * Match blocker text to root cause pattern using enhanced database function.
   * Phase 3: Now uses scoring-based matching with confidence levels.
   */
  async matchRootCause(blockerText: string): Promise<RootCause | null> {
    const { data, error } = await this.supabase
      .rpc('match_root_cause', { blocker_text: blockerText });

    if (error || !data || data.length === 0) {
      // Fallback: Try simple keyword matching for common cases
      return this.fallbackRootCauseMatch(blockerText);
    }

    const match = data[0];
    return {
      category: match.out_category,
      subcategory: match.out_subcategory,
      typicalResolutionDays: parseFloat(match.out_typical_resolution_days) || null,
      resolutionOwner: match.out_resolution_owner,
      requiresCustomerAction: match.out_requires_customer_action || false,
      matchConfidence: match.out_match_confidence,
    };
  }

  /**
   * Fallback root cause matching for when DB function returns no results.
   * Uses simple heuristics for common patterns.
   */
  private fallbackRootCauseMatch(blockerText: string): RootCause | null {
    const text = blockerText.toLowerCase();

    // Common fallback patterns
    if (text.includes('booking') || text.includes('no vessel')) {
      return { category: 'INTOGLO', subcategory: 'booking_management', typicalResolutionDays: 1, resolutionOwner: 'operations', requiresCustomerAction: false, matchConfidence: 'low' };
    }
    if (text.includes('customs') || text.includes('duty') || text.includes('clearance')) {
      return { category: 'CUSTOMS', subcategory: 'clearance_delay', typicalResolutionDays: 2, resolutionOwner: 'customs_broker', requiresCustomerAction: true, matchConfidence: 'low' };
    }
    if (text.includes('pickup') || text.includes('delivery') || text.includes('truck')) {
      return { category: 'LOGISTICS', subcategory: 'trucking_delay', typicalResolutionDays: 1.5, resolutionOwner: 'trucker', requiresCustomerAction: false, matchConfidence: 'low' };
    }
    if (text.includes('payment') || text.includes('invoice') || text.includes('unpaid')) {
      return { category: 'CUSTOMER', subcategory: 'payment_pending', typicalResolutionDays: 5, resolutionOwner: 'customer', requiresCustomerAction: true, matchConfidence: 'low' };
    }
    if (text.includes('missing') || text.includes('incomplete') || text.includes('no details')) {
      return { category: 'INTOGLO', subcategory: 'data_incompleteness', typicalResolutionDays: 0.5, resolutionOwner: 'operations', requiresCustomerAction: false, matchConfidence: 'low' };
    }

    return null;
  }

  /**
   * Get resolution benchmarks for similar situations.
   */
  async getBenchmarks(
    blockerText: string | null,
    rootCauseCategory: string | null
  ): Promise<ResolutionBenchmark[]> {
    const { data, error } = await this.supabase
      .from('v_resolution_benchmarks')
      .select('*')
      .gte('sample_count', 10)
      .order('sample_count', { ascending: false })
      .limit(5);

    if (error || !data) {
      return [];
    }

    return data.map(row => ({
      benchmarkSource: `${row.benchmark_type}:${row.category}`,
      avgDays: parseFloat(row.avg_resolution_days) || 0,
      sampleSize: row.sample_count,
      confidence: row.sample_count >= 50 ? 'high' : row.sample_count >= 20 ? 'medium' : 'low',
    }));
  }

  /**
   * Get categorized delay breakdown for a shipment.
   * P4: Stage-aware delay calculation using appropriate reference dates.
   */
  async getDelayBreakdown(shipmentId: string): Promise<DelayBreakdown | null> {
    const { data, error } = await this.supabase
      .from('v_shipment_delay_breakdown')
      .select('*')
      .eq('shipment_id', shipmentId)
      .single();

    if (error || !data) {
      console.warn(`[ShipmentIntelligence] No delay breakdown for shipment ${shipmentId}:`, error?.message);
      return null;
    }

    return {
      etd: data.etd,
      etdSource: data.etd_source,
      eta: data.eta,
      etaSource: data.eta_source,
      lastFreeDay: data.last_free_day,

      cutoffs: {
        siCutoff: data.si_cutoff,
        siDelayDays: data.si_delay_days || 0,
        siStatus: data.si_status as CutoffStatus,
        vgmCutoff: data.vgm_cutoff,
        vgmDelayDays: data.vgm_delay_days || 0,
        vgmStatus: data.vgm_status as CutoffStatus,
        docCutoff: data.doc_cutoff,
        docDelayDays: data.doc_delay_days || 0,
        docStatus: data.doc_status as CutoffStatus,
        cargoCutoff: data.cargo_cutoff,
        cargoDelayDays: data.cargo_delay_days || 0,
        cargoStatus: data.cargo_status as CutoffStatus,
      },

      departureDelayDays: data.departure_delay_days || 0,
      arrivalDelayDays: data.arrival_delay_days || 0,
      deliveryDelayDays: data.delivery_delay_days || 0,

      delayCategory: data.delay_category as DelayCategory,
      primaryDelayType: data.primary_delay_type as DelayType,
      primaryDelayDays: data.primary_delay_days || 0,
      delaySummary: data.delay_summary || 'Status unknown',
    };
  }

  /**
   * Calculate data completeness score (0-100).
   * Higher score = more reliable AI recommendations.
   */
  private calculateDataCompleteness(intel: any): number {
    let score = 0;
    const checks = [
      { field: intel.stage, weight: 10 },
      { field: intel.shipper_name, weight: 10 },
      { field: intel.carrier_name, weight: 10 },
      { field: intel.eta || intel.etd, weight: 15 },
      { field: intel.current_blocker, weight: 10 },
      { field: intel.blocker_owner, weight: 10 },
      { field: intel.sla_status && intel.sla_status !== 'NO_CONTACT', weight: 15 },
      { field: intel.escalation_level, weight: 10 },
      { field: intel.days_overdue !== null, weight: 10 },
    ];

    for (const check of checks) {
      if (check.field) {
        score += check.weight;
      }
    }

    return Math.min(score, 100);
  }

  /**
   * Build context for customer email draft.
   * All values from database - AI just writes prose.
   */
  async getCustomerDraftContext(shipmentId: string): Promise<CustomerDraftContext | null> {
    const intel = await this.getIntelligence(shipmentId);
    if (!intel) return null;

    // Get latest contact email from chronicle
    const { data: latestEmail } = await this.supabase
      .from('chronicle')
      .select('from_address')
      .eq('shipment_id', shipmentId)
      .in('from_party', ['customer', 'shipper', 'consignee'])
      .eq('direction', 'inbound')
      .order('occurred_at', { ascending: false })
      .limit(1)
      .single();

    return {
      shipmentReference: intel.intogloReference || intel.shipmentId.slice(0, 8),
      customerName: intel.shipperName || 'Valued Customer',
      currentStatus: intel.stage || 'In Progress',
      delayReason: intel.rootCause?.subcategory?.replace(/_/g, ' ') || intel.currentBlocker,
      daysOverdue: intel.escalation.daysOverdue,
      estimatedExposure: intel.escalation.estimatedExposureUsd,
      nextAction: null, // Will be filled by AI
      contactEmail: latestEmail?.from_address || null,
    };
  }

  /**
   * Get all L3 escalations for dashboard.
   */
  async getL3Escalations(limit: number = 20): Promise<ShipmentIntelligence[]> {
    const { data, error } = await this.supabase
      .from('v_shipment_intelligence')
      .select('*')
      .eq('escalation_level', 'L3')
      .order('priority_score', { ascending: false })
      .limit(limit);

    if (error || !data) {
      return [];
    }

    // Transform to ShipmentIntelligence (simplified, without root cause lookup)
    return data.map(intel => ({
      shipmentId: intel.shipment_id,
      intogloReference: intel.intoglo_reference,
      stage: intel.stage,
      shipperName: intel.shipper_name,
      consigneeName: intel.consignee_name,
      carrierName: intel.carrier_name,
      sla: {
        slaStatus: intel.sla_status || 'NO_CONTACT',
        hoursSinceCustomerUpdate: intel.hours_since_customer_update,
        hoursAwaitingResponse: intel.hours_awaiting_response,
        responsePending: intel.response_pending || false,
        unansweredCustomerEmails: intel.unanswered_customer_emails || 0,
        nextSlaDeadline: intel.next_sla_deadline,
      },
      escalation: {
        escalationLevel: intel.escalation_level || 'L1',
        escalateTo: intel.escalate_to || 'Operations Team',
        escalationReason: intel.escalation_reason || 'Normal operations',
        daysOverdue: intel.days_overdue,
        estimatedExposureUsd: intel.estimated_exposure_usd || 0,
        escalationCount: intel.escalation_count || 0,
        issueCount: intel.issue_count || 0,
        urgentMessageCount: intel.urgent_message_count || 0,
        priorityScore: intel.priority_score || 0,
      },
      rootCause: null,
      benchmarks: [],
      dataCompletenessScore: 0,
      delayBreakdown: null,
      currentBlocker: intel.current_blocker,
      blockerOwner: intel.blocker_owner,
      riskLevel: intel.risk_level,
    }));
  }

  /**
   * Get SLA breached shipments for alerts.
   */
  async getSlaBreachedShipments(limit: number = 20): Promise<ShipmentIntelligence[]> {
    const { data, error } = await this.supabase
      .from('v_shipment_sla_status')
      .select('*')
      .in('sla_status', ['BREACHED', 'CRITICAL'])
      .order('hours_since_customer_update', { ascending: false })
      .limit(limit);

    if (error || !data) {
      return [];
    }

    // Get full intelligence for each
    const results: ShipmentIntelligence[] = [];
    for (const row of data.slice(0, 10)) { // Limit to 10 to avoid too many queries
      const intel = await this.getIntelligence(row.shipment_id);
      if (intel) {
        results.push(intel);
      }
    }

    return results;
  }
}

// Factory function
export function createShipmentIntelligenceService(
  supabase: SupabaseClient
): ShipmentIntelligenceService {
  return new ShipmentIntelligenceService(supabase);
}
