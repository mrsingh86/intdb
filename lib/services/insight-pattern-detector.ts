/**
 * Insight Pattern Detector
 *
 * Stage 2 of the Insight Engine pipeline.
 * Detects known patterns using rules - fast and deterministic.
 *
 * Pattern Categories:
 * - Timeline: Cutoff conflicts, schedule issues
 * - Stakeholder: Shipper/consignee/carrier behavior
 * - Cross-Shipment: Multi-shipment risks
 * - Document: Missing/quality issues
 * - Financial: Payment, demurrage risks
 *
 * Principles:
 * - Single Responsibility: Only pattern detection
 * - Configuration Over Code: Patterns are data-driven
 * - Fail Fast: Invalid patterns logged, not crashed
 */

import {
  InsightContext,
  DetectedPattern,
  InsightSeverity,
  PatternCategory,
  InsightAction,
} from '@/types/insight';

// ============================================================================
// PATTERN DEFINITION TYPES
// ============================================================================

interface PatternRule {
  id: string;
  pattern_code: string;
  category: PatternCategory;
  name: string;
  severity: InsightSeverity;
  priority_boost: number;
  check: (ctx: InsightContext) => boolean | Promise<boolean>;
  insight: (ctx: InsightContext) => string;
  action?: InsightAction | ((ctx: InsightContext) => InsightAction | null);
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function daysBetween(date1: Date | null, date2: Date | null): number | null {
  if (!date1 || !date2) return null;
  return Math.round((date2.getTime() - date1.getTime()) / (1000 * 60 * 60 * 24));
}

function daysSince(date: Date | null): number | null {
  if (!date) return null;
  return Math.round((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
}

function daysUntil(date: Date | null): number | null {
  if (!date) return null;
  return Math.round((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function isPast(date: Date | null): boolean {
  if (!date) return false;
  return date.getTime() < Date.now();
}

function countCutoffsOnSameDay(dates: {
  si_cutoff: Date | null;
  vgm_cutoff: Date | null;
  cargo_cutoff: Date | null;
  gate_cutoff: Date | null;
}): number {
  const cutoffs = [dates.si_cutoff, dates.vgm_cutoff, dates.cargo_cutoff, dates.gate_cutoff]
    .filter(d => d !== null) as Date[];

  if (cutoffs.length < 2) return 0;

  const byDate: Record<string, number> = {};
  for (const cutoff of cutoffs) {
    const key = cutoff.toISOString().split('T')[0];
    byDate[key] = (byDate[key] || 0) + 1;
  }

  return Math.max(...Object.values(byDate));
}

function hasDocument(ctx: InsightContext, docType: string): boolean {
  return ctx.documents.received.some(d => d.document_type === docType);
}

function getNearestCutoff(dates: {
  si_cutoff: Date | null;
  vgm_cutoff: Date | null;
  cargo_cutoff: Date | null;
  gate_cutoff: Date | null;
}): { type: string; date: Date } | null {
  const cutoffs = [
    { type: 'SI Cutoff', date: dates.si_cutoff },
    { type: 'VGM Cutoff', date: dates.vgm_cutoff },
    { type: 'Cargo Cutoff', date: dates.cargo_cutoff },
    { type: 'Gate Cutoff', date: dates.gate_cutoff },
  ].filter(c => c.date !== null && c.date.getTime() > Date.now()) as { type: string; date: Date }[];

  if (cutoffs.length === 0) return null;

  cutoffs.sort((a, b) => a.date.getTime() - b.date.getTime());
  return cutoffs[0];
}

// ============================================================================
// PATTERN DEFINITIONS
// ============================================================================

const TIMELINE_PATTERNS: PatternRule[] = [
  {
    id: 'vgm_after_cargo_cutoff',
    pattern_code: 'vgm_after_cargo_cutoff',
    category: 'timeline',
    name: 'VGM After Cargo Cutoff',
    severity: 'critical',
    priority_boost: 20,
    check: (ctx) => {
      const { vgm_cutoff, cargo_cutoff } = ctx.shipment.dates;
      if (!vgm_cutoff || !cargo_cutoff) return false;
      return vgm_cutoff.getTime() > cargo_cutoff.getTime();
    },
    insight: (ctx) =>
      `VGM cutoff (${ctx.shipment.dates.vgm_cutoff?.toLocaleDateString()}) is AFTER cargo cutoff (${ctx.shipment.dates.cargo_cutoff?.toLocaleDateString()}) - impossible timeline`,
  },
  {
    id: 'multiple_cutoffs_same_day',
    pattern_code: 'multiple_cutoffs_same_day',
    category: 'timeline',
    name: 'Multiple Cutoffs Same Day',
    severity: 'high',
    priority_boost: 10,
    check: (ctx) => countCutoffsOnSameDay(ctx.shipment.dates) >= 3,
    insight: (ctx) => {
      const count = countCutoffsOnSameDay(ctx.shipment.dates);
      return `${count} cutoffs on the same day - high workload risk`;
    },
  },
  {
    id: 'si_cutoff_passed_no_si',
    pattern_code: 'si_cutoff_passed_no_si',
    category: 'timeline',
    name: 'SI Cutoff Passed Without SI',
    severity: 'critical',
    priority_boost: 25,
    check: (ctx) =>
      isPast(ctx.shipment.dates.si_cutoff) && !hasDocument(ctx, 'shipping_instruction'),
    insight: (ctx) =>
      `SI cutoff passed on ${ctx.shipment.dates.si_cutoff?.toLocaleDateString()} but no SI document submitted`,
    action: {
      type: 'email',
      target: 'shipper',
      template: 'urgent_si_request',
      urgency: 'immediate',
      subject_hint: 'URGENT: SI Required Immediately',
    },
  },
  {
    id: 'cutoff_within_24h',
    pattern_code: 'cutoff_within_24h',
    category: 'timeline',
    name: 'Cutoff Within 24 Hours',
    severity: 'critical',
    priority_boost: 15,
    check: (ctx) => {
      const nearest = getNearestCutoff(ctx.shipment.dates);
      if (!nearest) return false;
      const hoursUntil = (nearest.date.getTime() - Date.now()) / (1000 * 60 * 60);
      return hoursUntil > 0 && hoursUntil <= 24;
    },
    insight: (ctx) => {
      const nearest = getNearestCutoff(ctx.shipment.dates)!;
      const hoursUntil = Math.round(
        (nearest.date.getTime() - Date.now()) / (1000 * 60 * 60)
      );
      return `${nearest.type} is in ${hoursUntil} hours - immediate action required`;
    },
    action: {
      type: 'email',
      target: 'shipper',
      template: 'urgent_cutoff_reminder',
      urgency: 'immediate',
      subject_hint: 'URGENT: Cutoff in 24 hours',
    },
  },
  {
    id: 'etd_before_cutoffs',
    pattern_code: 'etd_before_cutoffs',
    category: 'timeline',
    name: 'ETD Before Cutoffs',
    severity: 'critical',
    priority_boost: 20,
    check: (ctx) => {
      const { etd, si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff } = ctx.shipment.dates;
      if (!etd) return false;
      const cutoffs = [si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff].filter(
        (c) => c !== null
      ) as Date[];
      return cutoffs.some((cutoff) => etd.getTime() < cutoff.getTime());
    },
    insight: (ctx) =>
      `ETD (${ctx.shipment.dates.etd?.toLocaleDateString()}) is before one or more cutoff dates - impossible timeline`,
  },
];

const STAKEHOLDER_PATTERNS: PatternRule[] = [
  {
    id: 'shipper_reliability_low',
    pattern_code: 'shipper_reliability_low',
    category: 'stakeholder',
    name: 'Low Shipper Reliability',
    severity: 'high',
    priority_boost: 12,
    check: (ctx) =>
      ctx.stakeholders.shipper?.reliability_score !== undefined &&
      ctx.stakeholders.shipper.reliability_score !== null &&
      ctx.stakeholders.shipper.reliability_score < 60,
    insight: (ctx) =>
      `Shipper "${ctx.stakeholders.shipper?.name}" has low reliability score (${ctx.stakeholders.shipper?.reliability_score}%) - extra follow-up recommended`,
  },
  {
    id: 'shipper_no_response_3d',
    pattern_code: 'shipper_no_response_3d',
    category: 'stakeholder',
    name: 'Shipper No Response',
    severity: 'medium',
    priority_boost: 8,
    check: (ctx) => {
      const days = daysSince(ctx.communications.last_response_from_shipper);
      return days !== null && days >= 3;
    },
    insight: (ctx) => {
      const days = daysSince(ctx.communications.last_response_from_shipper);
      return `No response from shipper in ${days} days - follow up required`;
    },
    action: {
      type: 'email',
      target: 'shipper',
      template: 'follow_up_general',
      urgency: 'today',
      subject_hint: 'Follow-up on pending shipment',
    },
  },
  {
    id: 'carrier_high_rollover',
    pattern_code: 'carrier_high_rollover',
    category: 'stakeholder',
    name: 'High Carrier Rollover Rate',
    severity: 'high',
    priority_boost: 15,
    check: (ctx) =>
      ctx.stakeholders.carrier?.rollover_rate_30d !== undefined &&
      ctx.stakeholders.carrier.rollover_rate_30d !== null &&
      ctx.stakeholders.carrier.rollover_rate_30d > 0.25,
    insight: (ctx) => {
      const rate = Math.round((ctx.stakeholders.carrier?.rollover_rate_30d || 0) * 100);
      return `Carrier "${ctx.stakeholders.carrier?.name}" has ${rate}% rollover rate in last 30 days - booking at risk`;
    },
    action: {
      type: 'call',
      target: 'carrier',
      urgency: 'today',
      subject_hint: 'Confirm booking status with carrier',
    },
  },
  {
    id: 'consignee_low_reliability',
    pattern_code: 'consignee_low_reliability',
    category: 'stakeholder',
    name: 'Low Consignee Reliability',
    severity: 'medium',
    priority_boost: 8,
    check: (ctx) =>
      ctx.stakeholders.consignee?.reliability_score !== undefined &&
      ctx.stakeholders.consignee.reliability_score !== null &&
      ctx.stakeholders.consignee.reliability_score < 60,
    insight: (ctx) =>
      `Consignee "${ctx.stakeholders.consignee?.name}" has low reliability score (${ctx.stakeholders.consignee?.reliability_score}%) - delivery may face issues`,
  },
  {
    id: 'new_shipper_first_shipment',
    pattern_code: 'new_shipper_first_shipment',
    category: 'stakeholder',
    name: 'New Shipper First Shipment',
    severity: 'medium',
    priority_boost: 5,
    check: (ctx) =>
      ctx.stakeholders.shipper?.total_shipments !== undefined &&
      ctx.stakeholders.shipper.total_shipments <= 1,
    insight: (ctx) =>
      `First shipment with shipper "${ctx.stakeholders.shipper?.name}" - extra attention and guidance recommended`,
  },
];

const CROSS_SHIPMENT_PATTERNS: PatternRule[] = [
  {
    id: 'consignee_capacity_risk',
    pattern_code: 'consignee_capacity_risk',
    category: 'cross_shipment',
    name: 'Consignee Capacity Risk',
    severity: 'high',
    priority_boost: 12,
    check: (ctx) => {
      const eta = ctx.shipment.dates.eta;
      if (!eta) return false;

      const arrivingNearby = ctx.related.same_consignee_active.filter((s) => {
        if (!s.eta) return false;
        const days = Math.abs(daysBetween(eta, s.eta) || 999);
        return days <= 3;
      });

      return arrivingNearby.length >= 2; // 2 other + current = 3+
    },
    insight: (ctx) => {
      const eta = ctx.shipment.dates.eta!;
      const count = ctx.related.same_consignee_active.filter((s) => {
        if (!s.eta) return false;
        const days = Math.abs(daysBetween(eta, s.eta) || 999);
        return days <= 3;
      }).length;

      return `${count + 1} shipments arriving to same consignee within 3 days - capacity risk`;
    },
    action: {
      type: 'email',
      target: 'consignee',
      template: 'delivery_coordination',
      urgency: 'today',
      subject_hint: 'Multiple Shipments Arriving - Delivery Coordination',
    },
  },
  {
    id: 'high_customer_exposure',
    pattern_code: 'high_customer_exposure',
    category: 'cross_shipment',
    name: 'High Customer Exposure',
    severity: 'high',
    priority_boost: 10,
    check: (ctx) => {
      // Count active shipments for same shipper
      return ctx.related.same_shipper_active.length >= 5;
    },
    insight: (ctx) => {
      const count = ctx.related.same_shipper_active.length + 1;
      return `${count} active shipments for same customer - high exposure concentration`;
    },
  },
  {
    id: 'route_congestion',
    pattern_code: 'route_congestion',
    category: 'cross_shipment',
    name: 'Route Congestion',
    severity: 'medium',
    priority_boost: 5,
    check: (ctx) => ctx.related.same_week_arrivals.length >= 10,
    insight: (ctx) =>
      `${ctx.related.same_week_arrivals.length + 1} shipments arriving at ${ctx.shipment.port_of_discharge} this week - potential congestion`,
  },
  {
    id: 'shared_deadline_pressure',
    pattern_code: 'shared_deadline_pressure',
    category: 'cross_shipment',
    name: 'Shared Deadline Pressure',
    severity: 'high',
    priority_boost: 10,
    check: (ctx) => {
      // Check if multiple shipments from same shipper have cutoffs on same day
      const siCutoff = ctx.shipment.dates.si_cutoff;
      if (!siCutoff) return false;

      const sameDayCutoffs = ctx.related.same_shipper_active.filter((s) => {
        if (!s.etd) return false;
        // Approximate: if ETD is within 1 day, likely same cutoffs
        const days = Math.abs(daysBetween(ctx.shipment.dates.etd, s.etd) || 999);
        return days <= 1;
      });

      return sameDayCutoffs.length >= 2;
    },
    insight: (ctx) => {
      const count = ctx.related.same_shipper_active.filter((s) => {
        if (!s.etd) return false;
        const days = Math.abs(daysBetween(ctx.shipment.dates.etd, s.etd) || 999);
        return days <= 1;
      }).length;

      return `${count + 1} shipments from same shipper with cutoffs on same day - workload risk`;
    },
  },
];

const DOCUMENT_PATTERNS: PatternRule[] = [
  {
    id: 'missing_critical_doc',
    pattern_code: 'missing_critical_doc',
    category: 'document',
    name: 'Missing Critical Document',
    severity: 'critical',
    priority_boost: 20,
    check: (ctx) => ctx.documents.missing.length > 0,
    insight: (ctx) =>
      `Missing critical document(s): ${ctx.documents.missing.join(', ')}`,
    action: {
      type: 'email',
      target: 'shipper',
      template: 'document_request',
      urgency: 'immediate',
      subject_hint: 'Urgent: Documents Required',
    },
  },
  {
    id: 'high_amendment_frequency',
    pattern_code: 'high_amendment_frequency',
    category: 'document',
    name: 'High Amendment Frequency',
    severity: 'medium',
    priority_boost: 8,
    check: (ctx) => ctx.documents.recent_amendments.length >= 3,
    insight: (ctx) =>
      `${ctx.documents.recent_amendments.length} amendments in last 7 days - unusual document churn`,
  },
  {
    id: 'document_quality_critical',
    pattern_code: 'document_quality_critical',
    category: 'document',
    name: 'Critical Document Quality Issues',
    severity: 'high',
    priority_boost: 12,
    check: (ctx) =>
      ctx.documents.quality_issues.some((q) => q.severity === 'critical'),
    insight: (ctx) => {
      const critical = ctx.documents.quality_issues.filter(
        (q) => q.severity === 'critical'
      );
      return `Critical document quality issues: ${critical.map((q) => q.description).join('; ')}`;
    },
    action: {
      type: 'email',
      target: 'shipper',
      template: 'document_correction',
      urgency: 'today',
      subject_hint: 'Document Corrections Required',
    },
  },
  {
    id: 'bl_not_released_near_eta',
    pattern_code: 'bl_not_released_near_eta',
    category: 'document',
    name: 'BL Not Released Near ETA',
    severity: 'critical',
    priority_boost: 18,
    check: (ctx) => {
      const daysToEta = daysUntil(ctx.shipment.dates.eta);
      if (daysToEta === null || daysToEta > 3) return false;

      const blDoc = ctx.documents.received.find(
        (d) => d.document_type === 'bill_of_lading'
      );
      if (!blDoc) return true; // No BL at all

      // Check if BL is released
      return blDoc.lifecycle_status !== 'released';
    },
    insight: (ctx) => {
      const daysToEta = daysUntil(ctx.shipment.dates.eta);
      return `ETA in ${daysToEta} day(s) but BL not yet released - cargo release at risk`;
    },
    action: {
      type: 'email',
      target: 'carrier',
      template: 'bl_release_request',
      urgency: 'immediate',
      subject_hint: 'URGENT: BL Release Required - ETA Approaching',
    },
  },
  {
    id: 'si_draft_pending_review',
    pattern_code: 'si_draft_pending_review',
    category: 'document',
    name: 'SI Draft Pending Review',
    severity: 'high',
    priority_boost: 10,
    check: (ctx) => {
      const siDoc = ctx.documents.received.find(
        (d) => d.document_type === 'shipping_instruction'
      );
      if (!siDoc) return false;

      // Check if SI is in draft status and received > 24h ago
      if (siDoc.lifecycle_status !== 'draft' && siDoc.lifecycle_status !== 'pending') {
        return false;
      }

      const hoursSinceReceived = siDoc.received_at
        ? (Date.now() - siDoc.received_at.getTime()) / (1000 * 60 * 60)
        : 0;

      return hoursSinceReceived > 24;
    },
    insight: (ctx) => {
      const siDoc = ctx.documents.received.find(
        (d) => d.document_type === 'shipping_instruction'
      )!;
      const hours = Math.round(
        (Date.now() - siDoc.received_at!.getTime()) / (1000 * 60 * 60)
      );
      return `SI draft received ${hours} hours ago but not yet reviewed - action needed`;
    },
  },
];

const FINANCIAL_PATTERNS: PatternRule[] = [
  {
    id: 'payment_overdue_other',
    pattern_code: 'payment_overdue_other',
    category: 'financial',
    name: 'Payment Overdue Other Shipment',
    severity: 'high',
    priority_boost: 12,
    check: (ctx) => {
      // Check if shipper has overdue payments via customer tier/notes
      // This would need payment tracking integration
      return false; // Placeholder - enable when payment data available
    },
    insight: () => 'Customer has overdue invoices on other shipments',
  },
  {
    id: 'demurrage_risk',
    pattern_code: 'demurrage_risk',
    category: 'financial',
    name: 'Demurrage Risk',
    severity: 'critical',
    priority_boost: 20,
    check: (ctx) => {
      const daysAtPort = daysSince(ctx.shipment.dates.ata);
      if (daysAtPort === null || daysAtPort < 3) return false;

      // Check if delivery order received
      const hasDO = ctx.documents.received.some(
        (d) => d.document_type === 'delivery_order'
      );

      return !hasDO;
    },
    insight: (ctx) => {
      const daysAtPort = daysSince(ctx.shipment.dates.ata);
      return `Container at port ${daysAtPort} days without delivery order - demurrage likely accruing`;
    },
  },
  {
    id: 'detention_accruing',
    pattern_code: 'detention_accruing',
    category: 'financial',
    name: 'Detention Accruing',
    severity: 'high',
    priority_boost: 15,
    check: (ctx) => {
      // Would need container tracking with free days data
      // Placeholder - enable when detention tracking available
      return false;
    },
    insight: () => 'Container held beyond free days - detention accruing',
  },
];

// ============================================================================
// BLOCKER PATTERNS (Journey Tracking Integration)
// ============================================================================

const BLOCKER_PATTERNS: PatternRule[] = [
  {
    id: 'critical_blocker_active',
    pattern_code: 'critical_blocker_active',
    category: 'blocker',
    name: 'Critical Blocker Active',
    severity: 'critical',
    priority_boost: 30,
    check: (ctx) => {
      const critical = ctx.journey?.blockers?.filter(b => b.severity === 'critical') || [];
      return critical.length > 0;
    },
    insight: (ctx) => {
      const critical = ctx.journey?.blockers?.filter(b => b.severity === 'critical') || [];
      const types = critical.map(b => b.blocker_type).join(', ');
      return `${critical.length} critical blocker(s) preventing shipment progress: ${types}`;
    },
  },
  {
    id: 'blocker_duration_critical',
    pattern_code: 'blocker_duration_critical',
    category: 'blocker',
    name: 'Long-Standing Blocker',
    severity: 'critical',
    priority_boost: 25,
    check: (ctx) => {
      const blockers = ctx.journey?.blockers || [];
      const now = Date.now();
      return blockers.some(b => {
        const hoursBlocked = (now - new Date(b.blocked_since).getTime()) / (1000 * 60 * 60);
        return hoursBlocked > 24;
      });
    },
    insight: (ctx) => {
      const blockers = ctx.journey?.blockers || [];
      const now = Date.now();
      const oldestBlocker = blockers
        .map(b => ({
          type: b.blocker_type,
          hours: (now - new Date(b.blocked_since).getTime()) / (1000 * 60 * 60)
        }))
        .sort((a, b) => b.hours - a.hours)[0];

      return `Blocker "${oldestBlocker?.type}" unresolved for ${Math.round(oldestBlocker?.hours || 0)} hours - escalation required`;
    },
  },
  {
    id: 'multiple_blockers_compound',
    pattern_code: 'multiple_blockers_compound',
    category: 'blocker',
    name: 'Multiple Blockers Compounding',
    severity: 'high',
    priority_boost: 20,
    check: (ctx) => {
      const blockers = ctx.journey?.blockers || [];
      return blockers.length >= 2;
    },
    insight: (ctx) => {
      const blockers = ctx.journey?.blockers || [];
      const types = [...new Set(blockers.map(b => b.blocker_type))].join(', ');
      return `${blockers.length} blockers compounding on this shipment: ${types}`;
    },
  },
  {
    id: 'awaiting_approval_blocker',
    pattern_code: 'awaiting_approval_blocker',
    category: 'blocker',
    name: 'Awaiting Approval',
    severity: 'high',
    priority_boost: 15,
    check: (ctx) => {
      const blockers = ctx.journey?.blockers || [];
      return blockers.some(b => b.blocker_type === 'awaiting_approval');
    },
    insight: (ctx) => {
      const approval = ctx.journey?.blockers?.find(b => b.blocker_type === 'awaiting_approval');
      const hours = approval
        ? Math.round((Date.now() - new Date(approval.blocked_since).getTime()) / (1000 * 60 * 60))
        : 0;
      return `Document awaiting approval for ${hours} hours - stakeholder action required`;
    },
  },
  {
    id: 'missing_document_blocker',
    pattern_code: 'missing_document_blocker',
    category: 'blocker',
    name: 'Missing Document Blocker',
    severity: 'high',
    priority_boost: 18,
    check: (ctx) => {
      const blockers = ctx.journey?.blockers || [];
      return blockers.some(b => b.blocker_type === 'missing_document');
    },
    insight: (ctx) => {
      const missing = ctx.journey?.blockers?.find(b => b.blocker_type === 'missing_document');
      return `Shipment blocked by missing document: ${missing?.blocker_description || 'Unknown'} - request from stakeholder`;
    },
  },
  {
    id: 'cutoff_passed_blocker',
    pattern_code: 'cutoff_passed_blocker',
    category: 'blocker',
    name: 'Cutoff Passed Blocker',
    severity: 'critical',
    priority_boost: 25,
    check: (ctx) => {
      const blockers = ctx.journey?.blockers || [];
      return blockers.some(b => b.blocker_type === 'cutoff_passed');
    },
    insight: (ctx) => {
      const cutoff = ctx.journey?.blockers?.find(b => b.blocker_type === 'cutoff_passed');
      return `Critical: Cutoff has passed - ${cutoff?.blocker_description || 'Immediate escalation required'}`;
    },
  },
  {
    id: 'awaiting_response_blocker',
    pattern_code: 'awaiting_response_blocker',
    category: 'blocker',
    name: 'Awaiting Stakeholder Response',
    severity: 'high',
    priority_boost: 15,
    check: (ctx) => {
      const blockers = ctx.journey?.blockers || [];
      return blockers.some(b => b.blocker_type === 'awaiting_response');
    },
    insight: (ctx) => {
      const response = ctx.journey?.blockers?.find(b => b.blocker_type === 'awaiting_response');
      const hours = response
        ? Math.round((Date.now() - new Date(response.blocked_since).getTime()) / (1000 * 60 * 60))
        : 0;
      return `Awaiting stakeholder response for ${hours} hours - follow-up required`;
    },
  },
  {
    id: 'acknowledgment_overdue',
    pattern_code: 'acknowledgment_overdue',
    category: 'blocker',
    name: 'Acknowledgment Overdue',
    severity: 'medium',
    priority_boost: 12,
    check: (ctx) => {
      // Check if any documents have overdue acknowledgment
      return ctx.documents.received.some(d => {
        if (!d.acknowledgment_due_date || d.acknowledged) return false;
        return new Date(d.acknowledgment_due_date).getTime() < Date.now();
      });
    },
    insight: (ctx) => {
      const overdue = ctx.documents.received.filter(d =>
        d.acknowledgment_due_date &&
        !d.acknowledged &&
        new Date(d.acknowledgment_due_date).getTime() < Date.now()
      );
      return `${overdue.length} document(s) awaiting acknowledgment past due date - follow up required`;
    },
  },
];

// ============================================================================
// ALL PATTERNS COMBINED
// ============================================================================

const ALL_PATTERNS: PatternRule[] = [
  ...TIMELINE_PATTERNS,
  ...STAKEHOLDER_PATTERNS,
  ...CROSS_SHIPMENT_PATTERNS,
  ...DOCUMENT_PATTERNS,
  ...FINANCIAL_PATTERNS,
  ...BLOCKER_PATTERNS,
];

// ============================================================================
// PATTERN DETECTOR SERVICE
// ============================================================================

export class InsightPatternDetector {
  private patterns: PatternRule[];

  constructor() {
    this.patterns = ALL_PATTERNS;
  }

  /**
   * Detect all matching patterns for a given context
   * Returns detected patterns with insights
   */
  async detectPatterns(context: InsightContext): Promise<DetectedPattern[]> {
    const detected: DetectedPattern[] = [];

    for (const pattern of this.patterns) {
      try {
        const matches = await pattern.check(context);

        if (matches) {
          // Resolve action (can be static or dynamic based on context)
          const resolvedAction = typeof pattern.action === 'function'
            ? pattern.action(context)
            : pattern.action;

          detected.push({
            pattern_id: pattern.id,
            pattern_code: pattern.pattern_code,
            severity: pattern.severity,
            title: pattern.name,
            insight: pattern.insight(context),
            confidence: 1.0, // Rules-based = 100% confidence
            source: 'rules',
            priority_boost: pattern.priority_boost,
            supporting_data: this.extractSupportingData(pattern, context),
            action: resolvedAction ?? undefined,
          });
        }
      } catch (error) {
        // Log but don't fail - patterns are independent
        console.warn(`Pattern ${pattern.id} check failed:`, error);
      }
    }

    // Sort by severity (critical first) then priority boost
    return detected.sort((a, b) => {
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      const severityDiff = severityOrder[b.severity] - severityOrder[a.severity];
      if (severityDiff !== 0) return severityDiff;
      return b.priority_boost - a.priority_boost;
    });
  }

  /**
   * Detect patterns for a specific category only
   */
  async detectPatternsByCategory(
    context: InsightContext,
    category: PatternCategory
  ): Promise<DetectedPattern[]> {
    const categoryPatterns = this.patterns.filter((p) => p.category === category);
    const allDetected = await this.detectPatterns(context);
    return allDetected.filter((d) =>
      categoryPatterns.some((p) => p.pattern_code === d.pattern_code)
    );
  }

  /**
   * Get all available patterns (for UI display)
   */
  getAvailablePatterns(): Array<{
    id: string;
    name: string;
    category: PatternCategory;
    severity: InsightSeverity;
  }> {
    return this.patterns.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      severity: p.severity,
    }));
  }

  /**
   * Extract relevant data that supports the detected pattern
   */
  private extractSupportingData(
    pattern: PatternRule,
    context: InsightContext
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {
      category: pattern.category,
      pattern_code: pattern.pattern_code,
    };

    // Add context-specific data based on category
    switch (pattern.category) {
      case 'timeline':
        data.etd = context.shipment.dates.etd?.toISOString();
        data.si_cutoff = context.shipment.dates.si_cutoff?.toISOString();
        data.vgm_cutoff = context.shipment.dates.vgm_cutoff?.toISOString();
        data.cargo_cutoff = context.shipment.dates.cargo_cutoff?.toISOString();
        break;

      case 'stakeholder':
        if (context.stakeholders.shipper) {
          data.shipper_name = context.stakeholders.shipper.name;
          data.shipper_reliability = context.stakeholders.shipper.reliability_score;
        }
        if (context.stakeholders.carrier) {
          data.carrier_name = context.stakeholders.carrier.name;
          data.carrier_rollover_rate = context.stakeholders.carrier.rollover_rate_30d;
        }
        break;

      case 'cross_shipment':
        data.same_shipper_active_count = context.related.same_shipper_active.length;
        data.same_consignee_active_count = context.related.same_consignee_active.length;
        data.same_week_arrivals_count = context.related.same_week_arrivals.length;
        break;

      case 'document':
        data.missing_documents = context.documents.missing;
        data.quality_issues_count = context.documents.quality_issues.length;
        data.recent_amendments_count = context.documents.recent_amendments.length;
        break;

      case 'financial':
        data.days_at_port = context.shipment.dates.ata
          ? daysSince(context.shipment.dates.ata)
          : null;
        break;

      case 'blocker':
        if (context.journey?.blockers) {
          data.active_blockers_count = context.journey.blockers.length;
          data.blocker_types = [...new Set(context.journey.blockers.map(b => b.blocker_type))];
          data.blockers_by_severity = {
            critical: context.journey.blockers.filter(b => b.severity === 'critical').length,
            high: context.journey.blockers.filter(b => b.severity === 'high').length,
            medium: context.journey.blockers.filter(b => b.severity === 'medium').length,
            low: context.journey.blockers.filter(b => b.severity === 'low').length,
          };
          // Include oldest blocker duration
          const now = Date.now();
          const oldestBlocker = context.journey.blockers
            .map(b => (now - new Date(b.blocked_since).getTime()) / (1000 * 60 * 60))
            .sort((a, b) => b - a)[0];
          data.oldest_blocker_hours = oldestBlocker ? Math.round(oldestBlocker) : null;
        }
        break;
    }

    return data;
  }
}
