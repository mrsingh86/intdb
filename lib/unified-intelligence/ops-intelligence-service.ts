/**
 * Operations Intelligence Service
 *
 * High-value queries for freight forwarding ops team.
 * Provides actionable intelligence, not just raw data.
 *
 * Based on deep domain analysis:
 * - Real data mismatches (conflicting values, not just missing)
 * - Stage-based document blockers
 * - Cutoff deadline monitoring
 * - Shipment health scoring
 * - Priority-tiered workload
 */

import { SupabaseClient, createClient } from '@supabase/supabase-js';

// =============================================================================
// TYPES
// =============================================================================

export interface ShipmentHealth {
  bookingNumber: string;
  mblNumber?: string;
  containerNumber?: string;
  shipper?: string;
  consignee?: string;
  healthScore: number; // 0-100
  riskLevel: 'critical' | 'high' | 'medium' | 'low';
  stage: string;
  issues: HealthIssue[];
  lastActivity: string;
  daysSinceActivity: number;
}

export interface HealthIssue {
  type: 'overdue_action' | 'missing_document' | 'data_conflict' | 'cutoff_missed' | 'stalled' | 'negative_sentiment';
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  deadline?: string;
  daysOverdue?: number;
}

export interface DataMismatch {
  bookingNumber: string;
  field: string;
  values: { value: string; source: string; date: string }[];
  recommendation: string;
}

export interface Blocker {
  bookingNumber: string;
  stage: string;
  blockerType: 'missing_document' | 'overdue_action' | 'cutoff_missed' | 'pending_response';
  description: string;
  owner: 'operations' | 'customer' | 'carrier' | 'broker';
  deadline?: string;
  daysOverdue?: number;
}

export interface CutoffAlert {
  bookingNumber: string;
  cutoffType: 'si_cutoff' | 'vgm_cutoff' | 'doc_cutoff' | 'cargo_cutoff';
  cutoffDate: string;
  urgency: 'overdue' | 'today' | 'tomorrow' | 'this_week';
  hoursRemaining: number;
  status: 'pending' | 'completed';
  vessel?: string;
  pol?: string;
}

export interface DashboardMetrics {
  critical: number;
  high: number;
  medium: number;
  low: number;
  topCritical: ShipmentHealth[];
  cutoffsToday: number;
  overdueActions: number;
  shipmentsInTransit: number;
  arrivingToday: number;
  departingToday: number;
}

// Document requirements by stage
const STAGE_REQUIREMENTS: Record<string, string[]> = {
  'PENDING': ['booking_confirmation'],
  'BOOKED': ['booking_confirmation'],
  'SI_SUBMITTED': ['booking_confirmation', 'shipping_instructions'],
  'SI_CONFIRMED': ['booking_confirmation', 'shipping_instructions', 'si_confirmation'],
  'DRAFT_BL': ['booking_confirmation', 'shipping_instructions', 'draft_bl'],
  'BL_ISSUED': ['booking_confirmation', 'shipping_instructions', 'draft_bl', 'final_bl'],
  'DEPARTED': ['booking_confirmation', 'shipping_instructions', 'final_bl'],
  'ARRIVED': ['booking_confirmation', 'shipping_instructions', 'final_bl', 'arrival_notice'],
  'DELIVERED': ['booking_confirmation', 'shipping_instructions', 'final_bl', 'arrival_notice', 'delivery_order'],
};

// =============================================================================
// SERVICE
// =============================================================================

export class OpsIntelligenceService {
  private supabase: SupabaseClient;

  constructor(supabaseClient?: SupabaseClient) {
    if (supabaseClient) {
      this.supabase = supabaseClient;
    } else {
      const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) throw new Error('Missing Supabase configuration');
      this.supabase = createClient(url, key);
    }
  }

  // ===========================================================================
  // DASHBOARD - Priority Overview
  // ===========================================================================

  async getDashboard(): Promise<DashboardMetrics> {
    const [healthScores, cutoffs, actions, schedule] = await Promise.all([
      this.getHealthScores(50),
      this.getCutoffAlerts(),
      this.getOverdueActions(),
      this.getTodaySchedule(),
    ]);

    const critical = healthScores.filter(h => h.riskLevel === 'critical').length;
    const high = healthScores.filter(h => h.riskLevel === 'high').length;
    const medium = healthScores.filter(h => h.riskLevel === 'medium').length;
    const low = healthScores.filter(h => h.riskLevel === 'low').length;

    return {
      critical,
      high,
      medium,
      low,
      topCritical: healthScores.filter(h => h.riskLevel === 'critical').slice(0, 5),
      cutoffsToday: cutoffs.filter(c => c.urgency === 'today' || c.urgency === 'overdue').length,
      overdueActions: actions.length,
      shipmentsInTransit: await this.countShipmentsInTransit(),
      arrivingToday: schedule.arrivals,
      departingToday: schedule.departures,
    };
  }

  // ===========================================================================
  // HEALTH SCORES - Risk Assessment
  // ===========================================================================

  async getHealthScores(limit: number = 20): Promise<ShipmentHealth[]> {
    // Only look at active/recent shipments (last 60 days)
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    // Get shipments with aggregated data
    const { data: shipments, error } = await this.supabase
      .from('chronicle')
      .select(`
        booking_number,
        mbl_number,
        container_numbers,
        shipper_name,
        consignee_name,
        document_type,
        has_action,
        action_completed_at,
        action_deadline,
        action_description,
        has_issue,
        issue_type,
        sentiment,
        occurred_at,
        etd,
        eta,
        vessel_name,
        pol_location,
        pod_location
      `)
      .not('booking_number', 'is', null)
      .gte('occurred_at', sixtyDaysAgo) // Only recent shipments
      .order('occurred_at', { ascending: false })
      .limit(500);

    if (error || !shipments) return [];

    // Group by booking number
    const grouped = this.groupByBooking(shipments);
    const healthScores: ShipmentHealth[] = [];

    for (const [bookingNumber, records] of Object.entries(grouped)) {
      const health = this.calculateHealth(bookingNumber, records);
      healthScores.push(health);
    }

    // Sort by risk (critical first) then by health score (lowest first)
    healthScores.sort((a, b) => {
      const riskOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      if (riskOrder[a.riskLevel] !== riskOrder[b.riskLevel]) {
        return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
      }
      return a.healthScore - b.healthScore;
    });

    return healthScores.slice(0, limit);
  }

  private calculateHealth(bookingNumber: string, records: any[]): ShipmentHealth {
    const issues: HealthIssue[] = [];
    let score = 100;

    // Get latest record for basic info
    const latest = records[0];
    const documentTypes = [...new Set(records.map(r => r.document_type).filter(Boolean))];

    // Determine stage based on documents received
    const stage = this.determineStage(documentTypes);

    // Check for overdue actions
    const pendingActions = records.filter(r => r.has_action && !r.action_completed_at);
    const now = new Date();

    for (const action of pendingActions) {
      if (action.action_deadline) {
        const deadline = new Date(action.action_deadline);
        const daysOverdue = Math.floor((now.getTime() - deadline.getTime()) / (1000 * 60 * 60 * 24));

        if (daysOverdue > 0) {
          issues.push({
            type: 'overdue_action',
            severity: daysOverdue > 7 ? 'critical' : daysOverdue > 3 ? 'high' : 'medium',
            description: action.action_description || 'Overdue action',
            deadline: action.action_deadline,
            daysOverdue,
          });
          score -= Math.min(daysOverdue * 5, 30);
        }
      }
    }

    // Check for missing documents based on stage
    const requiredDocs = STAGE_REQUIREMENTS[stage] || [];
    for (const reqDoc of requiredDocs) {
      if (!documentTypes.includes(reqDoc)) {
        issues.push({
          type: 'missing_document',
          severity: 'high',
          description: `Missing ${this.formatDocumentType(reqDoc)}`,
        });
        score -= 10;
      }
    }

    // Check for negative sentiment
    const negativeSentiments = records.filter(r => r.sentiment === 'negative' || r.sentiment === 'urgent');
    if (negativeSentiments.length > 0) {
      issues.push({
        type: 'negative_sentiment',
        severity: negativeSentiments.length > 2 ? 'high' : 'medium',
        description: `${negativeSentiments.length} urgent/negative email(s)`,
      });
      score -= negativeSentiments.length * 5;
    }

    // Check for stalled shipments (no activity in 7+ days)
    const latestDate = new Date(latest.occurred_at);
    const daysSinceActivity = Math.floor((now.getTime() - latestDate.getTime()) / (1000 * 60 * 60 * 24));

    if (daysSinceActivity > 7 && stage !== 'DELIVERED') {
      issues.push({
        type: 'stalled',
        severity: daysSinceActivity > 14 ? 'high' : 'medium',
        description: `No activity for ${daysSinceActivity} days`,
      });
      score -= Math.min(daysSinceActivity * 2, 20);
    }

    // Determine risk level
    let riskLevel: 'critical' | 'high' | 'medium' | 'low';
    if (score < 40 || issues.some(i => i.severity === 'critical')) {
      riskLevel = 'critical';
    } else if (score < 60 || issues.some(i => i.severity === 'high')) {
      riskLevel = 'high';
    } else if (score < 80) {
      riskLevel = 'medium';
    } else {
      riskLevel = 'low';
    }

    return {
      bookingNumber,
      mblNumber: latest.mbl_number,
      containerNumber: latest.container_numbers?.[0],
      shipper: latest.shipper_name,
      consignee: latest.consignee_name,
      healthScore: Math.max(0, score),
      riskLevel,
      stage,
      issues,
      lastActivity: latest.occurred_at,
      daysSinceActivity,
    };
  }

  // ===========================================================================
  // DATA MISMATCHES - Real Conflicts
  // ===========================================================================

  async getRealMismatches(): Promise<DataMismatch[]> {
    // Only look at recent shipments (last 60 days)
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await this.supabase
      .from('chronicle')
      .select(`
        booking_number,
        etd,
        eta,
        vessel_name,
        pol_location,
        pod_location,
        document_type,
        occurred_at
      `)
      .not('booking_number', 'is', null)
      .gte('occurred_at', sixtyDaysAgo) // Only recent shipments
      .order('occurred_at', { ascending: false })
      .limit(1000);

    if (error || !data) return [];

    const mismatches: DataMismatch[] = [];
    const grouped = this.groupByBooking(data);

    for (const [bookingNumber, records] of Object.entries(grouped)) {
      // Check ETD conflicts
      const etdValues = records
        .filter(r => r.etd)
        .map(r => ({ value: r.etd, source: r.document_type, date: r.occurred_at }));

      const uniqueEtds = [...new Set(etdValues.map(v => v.value))];
      if (uniqueEtds.length > 1) {
        mismatches.push({
          bookingNumber,
          field: 'ETD',
          values: etdValues.slice(0, 3),
          recommendation: 'Verify departure date with carrier',
        });
      }

      // Check vessel name conflicts
      const vesselValues = records
        .filter(r => r.vessel_name)
        .map(r => ({ value: r.vessel_name, source: r.document_type, date: r.occurred_at }));

      const uniqueVessels = [...new Set(vesselValues.map(v => v.value?.toLowerCase()))];
      if (uniqueVessels.length > 1) {
        mismatches.push({
          bookingNumber,
          field: 'Vessel',
          values: vesselValues.slice(0, 3),
          recommendation: 'Confirm vessel assignment - may be amended',
        });
      }

      // Check POD conflicts
      const podValues = records
        .filter(r => r.pod_location)
        .map(r => ({ value: r.pod_location, source: r.document_type, date: r.occurred_at }));

      const uniquePods = [...new Set(podValues.map(v => v.value?.toLowerCase()))];
      if (uniquePods.length > 1) {
        mismatches.push({
          bookingNumber,
          field: 'Destination',
          values: podValues.slice(0, 3),
          recommendation: 'Verify final destination port',
        });
      }
    }

    return mismatches.slice(0, 20);
  }

  // ===========================================================================
  // BLOCKERS - Stage-based Missing Items
  // ===========================================================================

  async getBlockers(): Promise<Blocker[]> {
    // Only look at recent shipments (last 60 days)
    const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await this.supabase
      .from('chronicle')
      .select(`
        booking_number,
        document_type,
        has_action,
        action_completed_at,
        action_deadline,
        action_description,
        action_owner,
        occurred_at
      `)
      .not('booking_number', 'is', null)
      .gte('occurred_at', sixtyDaysAgo) // Only recent shipments
      .order('occurred_at', { ascending: false })
      .limit(500);

    if (error || !data) return [];

    const blockers: Blocker[] = [];
    const grouped = this.groupByBooking(data);
    const now = new Date();

    for (const [bookingNumber, records] of Object.entries(grouped)) {
      const documentTypes = [...new Set(records.map(r => r.document_type).filter(Boolean))];
      const stage = this.determineStage(documentTypes);
      const requiredDocs = STAGE_REQUIREMENTS[stage] || [];

      // Missing documents for current stage
      for (const reqDoc of requiredDocs) {
        if (!documentTypes.includes(reqDoc)) {
          blockers.push({
            bookingNumber,
            stage,
            blockerType: 'missing_document',
            description: `Missing ${this.formatDocumentType(reqDoc)}`,
            owner: this.getDocumentOwner(reqDoc),
          });
        }
      }

      // Overdue actions (skip if older than 7 days - likely stale/delivered)
      const pendingActions = records.filter(r => r.has_action && !r.action_completed_at);
      for (const action of pendingActions) {
        if (action.action_deadline) {
          const deadline = new Date(action.action_deadline);
          const daysOverdue = Math.floor((now.getTime() - deadline.getTime()) / (1000 * 60 * 60 * 24));

          // Only show blockers overdue by 1-7 days (not ancient stale data)
          if (daysOverdue > 0 && daysOverdue <= 7) {
            blockers.push({
              bookingNumber,
              stage,
              blockerType: 'overdue_action',
              description: action.action_description || 'Overdue action',
              owner: action.action_owner || 'operations',
              deadline: action.action_deadline,
              daysOverdue,
            });
          }
        }
      }
    }

    // Sort by days overdue (most overdue first)
    blockers.sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0));

    return blockers.slice(0, 30);
  }

  // ===========================================================================
  // CUTOFF ALERTS - Deadline Monitoring
  // ===========================================================================

  async getCutoffAlerts(): Promise<CutoffAlert[]> {
    // Only look at cutoffs from recent shipments (last 7 days for overdue, 7 days ahead)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAhead = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await this.supabase
      .from('chronicle')
      .select(`
        booking_number,
        si_cutoff,
        vgm_cutoff,
        doc_cutoff,
        cargo_cutoff,
        vessel_name,
        pol_location,
        document_type,
        occurred_at
      `)
      .not('booking_number', 'is', null)
      .or('si_cutoff.not.is.null,vgm_cutoff.not.is.null,doc_cutoff.not.is.null,cargo_cutoff.not.is.null')
      .gte('occurred_at', sevenDaysAgo) // Only recent shipments
      .order('si_cutoff', { ascending: true })
      .limit(200);

    if (error || !data) return [];

    const alerts: CutoffAlert[] = [];
    const now = new Date();
    const seen = new Set<string>();

    for (const record of data) {
      const cutoffs = [
        { type: 'si_cutoff', date: record.si_cutoff },
        { type: 'vgm_cutoff', date: record.vgm_cutoff },
        { type: 'doc_cutoff', date: record.doc_cutoff },
        { type: 'cargo_cutoff', date: record.cargo_cutoff },
      ];

      for (const cutoff of cutoffs) {
        if (!cutoff.date) continue;

        const key = `${record.booking_number}-${cutoff.type}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const cutoffDate = new Date(cutoff.date);
        const hoursRemaining = (cutoffDate.getTime() - now.getTime()) / (1000 * 60 * 60);

        // Skip cutoffs older than 7 days (stale data, not actionable)
        if (hoursRemaining < -168) continue; // -168 hours = -7 days

        let urgency: 'overdue' | 'today' | 'tomorrow' | 'this_week';
        if (hoursRemaining < 0) {
          urgency = 'overdue';
        } else if (hoursRemaining < 24) {
          urgency = 'today';
        } else if (hoursRemaining < 48) {
          urgency = 'tomorrow';
        } else if (hoursRemaining < 168) {
          urgency = 'this_week';
        } else {
          continue; // Skip cutoffs more than a week away
        }

        alerts.push({
          bookingNumber: record.booking_number,
          cutoffType: cutoff.type as any,
          cutoffDate: cutoff.date,
          urgency,
          hoursRemaining: Math.round(hoursRemaining),
          status: 'pending',
          vessel: record.vessel_name,
          pol: record.pol_location,
        });
      }
    }

    // Sort by urgency then hours remaining
    const urgencyOrder = { overdue: 0, today: 1, tomorrow: 2, this_week: 3 };
    alerts.sort((a, b) => {
      if (urgencyOrder[a.urgency] !== urgencyOrder[b.urgency]) {
        return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
      }
      return a.hoursRemaining - b.hoursRemaining;
    });

    return alerts.slice(0, 30);
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private async getOverdueActions(): Promise<any[]> {
    // Only count actions from recent shipments (last 30 days)
    // Skip actions overdue by more than 7 days (stale/not actionable)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysOverdue = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data } = await this.supabase
      .from('chronicle')
      .select('id, booking_number, action_description, action_deadline, occurred_at')
      .eq('has_action', true)
      .is('action_completed_at', null)
      .lt('action_deadline', new Date().toISOString())
      .gte('action_deadline', sevenDaysOverdue) // Not older than 7 days overdue
      .gte('occurred_at', thirtyDaysAgo) // Only recent shipments
      .limit(100);

    return data || [];
  }

  private async getTodaySchedule(): Promise<{ arrivals: number; departures: number }> {
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    const [{ count: arrivals }, { count: departures }] = await Promise.all([
      this.supabase.from('chronicle').select('*', { count: 'exact', head: true })
        .gte('eta', today).lt('eta', tomorrow),
      this.supabase.from('chronicle').select('*', { count: 'exact', head: true })
        .gte('etd', today).lt('etd', tomorrow),
    ]);

    return { arrivals: arrivals || 0, departures: departures || 0 };
  }

  private async countShipmentsInTransit(): Promise<number> {
    const { count } = await this.supabase
      .from('chronicle')
      .select('booking_number', { count: 'exact', head: true })
      .not('etd', 'is', null)
      .is('eta', null);

    return count || 0;
  }

  private groupByBooking(records: any[]): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};
    for (const record of records) {
      const key = record.booking_number;
      if (!key) continue;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(record);
    }
    return grouped;
  }

  private determineStage(documentTypes: string[]): string {
    if (documentTypes.includes('delivery_order') || documentTypes.includes('pod_proof_of_delivery')) {
      return 'DELIVERED';
    }
    if (documentTypes.includes('arrival_notice')) {
      return 'ARRIVED';
    }
    if (documentTypes.includes('final_bl') || documentTypes.includes('telex_release')) {
      return 'DEPARTED';
    }
    if (documentTypes.includes('draft_bl')) {
      return 'DRAFT_BL';
    }
    if (documentTypes.includes('si_confirmation')) {
      return 'SI_CONFIRMED';
    }
    if (documentTypes.includes('shipping_instructions')) {
      return 'SI_SUBMITTED';
    }
    if (documentTypes.includes('booking_confirmation')) {
      return 'BOOKED';
    }
    return 'PENDING';
  }

  private formatDocumentType(type: string): string {
    const names: Record<string, string> = {
      'booking_confirmation': 'Booking Confirmation',
      'shipping_instructions': 'Shipping Instructions',
      'si_confirmation': 'SI Confirmation',
      'vgm_confirmation': 'VGM Confirmation',
      'draft_bl': 'Draft BL',
      'final_bl': 'Final BL',
      'telex_release': 'Telex Release',
      'arrival_notice': 'Arrival Notice',
      'delivery_order': 'Delivery Order',
      'customs_entry': 'Customs Entry',
      'invoice': 'Invoice',
    };
    return names[type] || type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  private getDocumentOwner(docType: string): 'operations' | 'customer' | 'carrier' | 'broker' {
    const ownerMap: Record<string, 'operations' | 'customer' | 'carrier' | 'broker'> = {
      'booking_confirmation': 'carrier',
      'shipping_instructions': 'customer',
      'si_confirmation': 'carrier',
      'vgm_confirmation': 'customer',
      'draft_bl': 'carrier',
      'final_bl': 'carrier',
      'arrival_notice': 'carrier',
      'delivery_order': 'operations',
      'customs_entry': 'broker',
    };
    return ownerMap[docType] || 'operations';
  }
}

// =============================================================================
// FACTORY
// =============================================================================

let instance: OpsIntelligenceService | null = null;

export function getOpsIntelligenceService(supabase?: SupabaseClient): OpsIntelligenceService {
  if (!instance || supabase) {
    instance = new OpsIntelligenceService(supabase);
  }
  return instance;
}
