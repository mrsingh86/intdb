/**
 * Milestone Tracking Service
 *
 * Tracks operational notifications and milestones throughout shipment lifecycle.
 * Detects missed milestones and generates alerts for approaching/overdue events.
 *
 * Principles:
 * - Configuration Over Code: Milestone definitions in database
 * - Single Responsibility: Only milestone tracking logic
 * - Audit Trail: All milestone changes logged
 * - Proactive Alerts: Detect issues before they become problems
 */

import { SupabaseClient } from '@supabase/supabase-js';

export type MilestoneStatus =
  | 'pending'
  | 'expected'
  | 'achieved'
  | 'missed'
  | 'skipped'
  | 'not_applicable';

export type MilestonePhase = 'pre_departure' | 'in_transit' | 'arrival' | 'delivery';

export interface MilestoneDefinition {
  id: string;
  milestone_code: string;
  milestone_name: string;
  milestone_phase: MilestonePhase;
  milestone_order: number;
  document_types: string[] | null;
  is_critical: boolean;
  expected_days_before_etd: number | null;
  expected_days_after_eta: number | null;
  description: string | null;
}

export interface ShipmentMilestone {
  id: string;
  shipment_id: string;
  milestone_code: string;
  milestone_status: MilestoneStatus;
  expected_date: string | null;
  achieved_date: string | null;
  missed_since: string | null;
  triggered_by_email_id: string | null;
  triggered_by_user_id: string | null;
  metadata: Record<string, unknown>;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface MilestoneAlert {
  id: string;
  shipment_id: string;
  milestone_id: string;
  alert_type: 'approaching' | 'missed' | 'overdue';
  alert_severity: 'critical' | 'warning' | 'info';
  alert_message: string;
  is_acknowledged: boolean;
  created_at: string;
}

export interface MilestoneProgress {
  shipment_id: string;
  total_milestones: number;
  achieved_milestones: number;
  missed_milestones: number;
  progress_percentage: number;
  current_milestone: MilestoneDefinition | null;
  next_milestones: MilestoneDefinition[];
  alerts: MilestoneAlert[];
}

export class MilestoneTrackingService {
  private definitionsCache: Map<string, MilestoneDefinition> = new Map();
  private definitionsByPhase: Map<MilestonePhase, MilestoneDefinition[]> = new Map();
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 10 * 60 * 1000;

  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Initialize milestones for a new shipment
   */
  async initializeMilestones(
    shipmentId: string,
    etd: string | null,
    eta: string | null
  ): Promise<ShipmentMilestone[]> {
    await this.ensureCacheValid();

    const milestones: Partial<ShipmentMilestone>[] = [];

    for (const def of this.definitionsCache.values()) {
      const expectedDate = this.calculateExpectedDate(def, etd, eta);

      milestones.push({
        shipment_id: shipmentId,
        milestone_code: def.milestone_code,
        milestone_status: 'pending',
        expected_date: expectedDate,
        metadata: {},
      });
    }

    const { data, error } = await this.supabase
      .from('shipment_milestones')
      .insert(milestones)
      .select();

    if (error) {
      throw new Error(`Failed to initialize milestones: ${error.message}`);
    }

    // Update shipment summary
    await this.updateShipmentMilestoneSummary(shipmentId);

    return data || [];
  }

  /**
   * Record milestone achievement
   */
  async recordMilestone(
    shipmentId: string,
    milestoneCode: string,
    options: {
      achieved_date?: string;
      triggered_by_email_id?: string;
      triggered_by_user_id?: string;
      metadata?: Record<string, unknown>;
      notes?: string;
    } = {}
  ): Promise<ShipmentMilestone> {
    const achievedDate = options.achieved_date || new Date().toISOString();

    // Upsert milestone record
    const { data, error } = await this.supabase
      .from('shipment_milestones')
      .upsert(
        {
          shipment_id: shipmentId,
          milestone_code: milestoneCode,
          milestone_status: 'achieved',
          achieved_date: achievedDate,
          triggered_by_email_id: options.triggered_by_email_id,
          triggered_by_user_id: options.triggered_by_user_id,
          metadata: options.metadata || {},
          notes: options.notes,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'shipment_id,milestone_code',
        }
      )
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to record milestone: ${error.message}`);
    }

    // Clear any related alerts
    await this.acknowledgeAlertsForMilestone(data.id);

    // Update shipment summary
    await this.updateShipmentMilestoneSummary(shipmentId);

    return data;
  }

  /**
   * Auto-record milestone from received document
   */
  async autoRecordFromDocument(
    shipmentId: string,
    documentType: string,
    emailId: string
  ): Promise<ShipmentMilestone | null> {
    await this.ensureCacheValid();

    // Find milestone that can be triggered by this document type
    let matchingMilestone: MilestoneDefinition | null = null;

    for (const def of this.definitionsCache.values()) {
      if (def.document_types?.includes(documentType)) {
        matchingMilestone = def;
        break;
      }
    }

    if (!matchingMilestone) {
      return null;
    }

    return await this.recordMilestone(shipmentId, matchingMilestone.milestone_code, {
      triggered_by_email_id: emailId,
      notes: `Auto-recorded from ${documentType}`,
    });
  }

  /**
   * Mark milestone as skipped
   */
  async skipMilestone(
    shipmentId: string,
    milestoneCode: string,
    reason: string
  ): Promise<void> {
    const { error } = await this.supabase
      .from('shipment_milestones')
      .upsert(
        {
          shipment_id: shipmentId,
          milestone_code: milestoneCode,
          milestone_status: 'skipped',
          notes: reason,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'shipment_id,milestone_code',
        }
      );

    if (error) {
      throw new Error(`Failed to skip milestone: ${error.message}`);
    }

    await this.updateShipmentMilestoneSummary(shipmentId);
  }

  /**
   * Get milestone progress for a shipment
   */
  async getMilestoneProgress(shipmentId: string): Promise<MilestoneProgress> {
    await this.ensureCacheValid();

    // Get all milestones for shipment
    const { data: milestones } = await this.supabase
      .from('shipment_milestones')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('created_at', { ascending: true });

    // Get alerts
    const { data: alerts } = await this.supabase
      .from('milestone_alerts')
      .select('*')
      .eq('shipment_id', shipmentId)
      .eq('is_acknowledged', false)
      .order('created_at', { ascending: false });

    // Calculate stats
    const achieved = milestones?.filter(m => m.milestone_status === 'achieved').length || 0;
    const missed = milestones?.filter(m => m.milestone_status === 'missed').length || 0;
    const total = this.definitionsCache.size;

    // Find current and next milestones
    const achievedCodes = new Set(
      milestones?.filter(m => m.milestone_status === 'achieved').map(m => m.milestone_code)
    );

    const sortedDefs = Array.from(this.definitionsCache.values())
      .sort((a, b) => a.milestone_order - b.milestone_order);

    let currentMilestone: MilestoneDefinition | null = null;
    const nextMilestones: MilestoneDefinition[] = [];

    for (const def of sortedDefs) {
      if (!achievedCodes.has(def.milestone_code)) {
        if (!currentMilestone) {
          currentMilestone = def;
        } else {
          nextMilestones.push(def);
          if (nextMilestones.length >= 3) break;
        }
      }
    }

    return {
      shipment_id: shipmentId,
      total_milestones: total,
      achieved_milestones: achieved,
      missed_milestones: missed,
      progress_percentage: Math.round((achieved / total) * 100),
      current_milestone: currentMilestone,
      next_milestones: nextMilestones,
      alerts: alerts || [],
    };
  }

  /**
   * Check for missed milestones and create alerts
   */
  async checkMissedMilestones(shipmentId: string): Promise<MilestoneAlert[]> {
    await this.ensureCacheValid();

    const now = new Date();
    const createdAlerts: MilestoneAlert[] = [];

    // Get all pending/expected milestones
    const { data: milestones } = await this.supabase
      .from('shipment_milestones')
      .select('*')
      .eq('shipment_id', shipmentId)
      .in('milestone_status', ['pending', 'expected']);

    for (const milestone of milestones || []) {
      if (!milestone.expected_date) continue;

      const expectedDate = new Date(milestone.expected_date);
      const def = this.definitionsCache.get(milestone.milestone_code);

      // Check if missed (past expected date)
      if (expectedDate < now) {
        // Mark as missed
        await this.supabase
          .from('shipment_milestones')
          .update({
            milestone_status: 'missed',
            missed_since: now.toISOString(),
            updated_at: now.toISOString(),
          })
          .eq('id', milestone.id);

        // Create alert
        const alert = await this.createAlert(
          shipmentId,
          milestone.id,
          'missed',
          def?.is_critical ? 'critical' : 'warning',
          `${def?.milestone_name || milestone.milestone_code} was expected by ${expectedDate.toLocaleDateString()} but not received`
        );

        if (alert) createdAlerts.push(alert);
      }
      // Check if approaching (within 2 days)
      else {
        const hoursUntil = (expectedDate.getTime() - now.getTime()) / (1000 * 60 * 60);
        if (hoursUntil <= 48) {
          // Check if we already have an approaching alert
          const { data: existingAlert } = await this.supabase
            .from('milestone_alerts')
            .select('id')
            .eq('milestone_id', milestone.id)
            .eq('alert_type', 'approaching')
            .eq('is_acknowledged', false)
            .single();

          if (!existingAlert) {
            const alert = await this.createAlert(
              shipmentId,
              milestone.id,
              'approaching',
              hoursUntil <= 24 ? 'warning' : 'info',
              `${def?.milestone_name || milestone.milestone_code} expected in ${Math.round(hoursUntil)} hours`
            );

            if (alert) createdAlerts.push(alert);
          }
        }
      }
    }

    return createdAlerts;
  }

  /**
   * Get all active alerts for a shipment
   */
  async getActiveAlerts(shipmentId: string): Promise<MilestoneAlert[]> {
    const { data, error } = await this.supabase
      .from('milestone_alerts')
      .select('*')
      .eq('shipment_id', shipmentId)
      .eq('is_acknowledged', false)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch alerts: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Acknowledge an alert
   */
  async acknowledgeAlert(
    alertId: string,
    acknowledgedBy: string
  ): Promise<void> {
    const { error } = await this.supabase
      .from('milestone_alerts')
      .update({
        is_acknowledged: true,
        acknowledged_by: acknowledgedBy,
        acknowledged_at: new Date().toISOString(),
      })
      .eq('id', alertId);

    if (error) {
      throw new Error(`Failed to acknowledge alert: ${error.message}`);
    }
  }

  /**
   * Update expected dates when ETD/ETA changes
   */
  async updateExpectedDates(
    shipmentId: string,
    etd: string | null,
    eta: string | null
  ): Promise<void> {
    await this.ensureCacheValid();

    // Get existing milestones
    const { data: milestones } = await this.supabase
      .from('shipment_milestones')
      .select('id, milestone_code, milestone_status')
      .eq('shipment_id', shipmentId)
      .in('milestone_status', ['pending', 'expected']);

    for (const milestone of milestones || []) {
      const def = this.definitionsCache.get(milestone.milestone_code);
      if (!def) continue;

      const expectedDate = this.calculateExpectedDate(def, etd, eta);

      await this.supabase
        .from('shipment_milestones')
        .update({
          expected_date: expectedDate,
          updated_at: new Date().toISOString(),
        })
        .eq('id', milestone.id);
    }
  }

  /**
   * Calculate expected date for a milestone
   */
  private calculateExpectedDate(
    def: MilestoneDefinition,
    etd: string | null,
    eta: string | null
  ): string | null {
    if (def.expected_days_before_etd !== null && etd) {
      const etdDate = new Date(etd);
      etdDate.setDate(etdDate.getDate() - def.expected_days_before_etd);
      return etdDate.toISOString();
    }

    if (def.expected_days_after_eta !== null && eta) {
      const etaDate = new Date(eta);
      etaDate.setDate(etaDate.getDate() + def.expected_days_after_eta);
      return etaDate.toISOString();
    }

    return null;
  }

  /**
   * Create a milestone alert
   */
  private async createAlert(
    shipmentId: string,
    milestoneId: string,
    alertType: 'approaching' | 'missed' | 'overdue',
    severity: 'critical' | 'warning' | 'info',
    message: string
  ): Promise<MilestoneAlert | null> {
    const { data, error } = await this.supabase
      .from('milestone_alerts')
      .insert({
        shipment_id: shipmentId,
        milestone_id: milestoneId,
        alert_type: alertType,
        alert_severity: severity,
        alert_message: message,
      })
      .select()
      .single();

    if (error) {
      console.error('Failed to create alert:', error.message);
      return null;
    }

    return data;
  }

  /**
   * Acknowledge all alerts for a milestone
   */
  private async acknowledgeAlertsForMilestone(milestoneId: string): Promise<void> {
    await this.supabase
      .from('milestone_alerts')
      .update({
        is_acknowledged: true,
        acknowledged_at: new Date().toISOString(),
      })
      .eq('milestone_id', milestoneId)
      .eq('is_acknowledged', false);
  }

  /**
   * Update shipment milestone summary
   */
  private async updateShipmentMilestoneSummary(shipmentId: string): Promise<void> {
    await this.ensureCacheValid();

    // Get milestone stats
    const { data: milestones } = await this.supabase
      .from('shipment_milestones')
      .select('milestone_code, milestone_status, expected_date')
      .eq('shipment_id', shipmentId);

    const achieved = milestones?.filter(m => m.milestone_status === 'achieved').length || 0;
    const missed = milestones?.filter(m => m.milestone_status === 'missed').length || 0;
    const total = this.definitionsCache.size;

    // Find next milestone
    const achievedCodes = new Set(
      milestones?.filter(m => m.milestone_status === 'achieved').map(m => m.milestone_code)
    );

    let nextMilestone: string | null = null;
    let nextMilestoneDate: string | null = null;

    const sortedDefs = Array.from(this.definitionsCache.values())
      .sort((a, b) => a.milestone_order - b.milestone_order);

    for (const def of sortedDefs) {
      if (!achievedCodes.has(def.milestone_code)) {
        nextMilestone = def.milestone_code;
        const milestone = milestones?.find(m => m.milestone_code === def.milestone_code);
        nextMilestoneDate = milestone?.expected_date || null;
        break;
      }
    }

    // Update shipment
    await this.supabase
      .from('shipments')
      .update({
        milestones_total: total,
        milestones_achieved: achieved,
        milestones_missed: missed,
        next_milestone: nextMilestone,
        next_milestone_date: nextMilestoneDate,
      })
      .eq('id', shipmentId);
  }

  /**
   * Load milestone definitions
   */
  private async loadDefinitions(): Promise<void> {
    const { data, error } = await this.supabase
      .from('milestone_definitions')
      .select('*')
      .order('milestone_order', { ascending: true });

    if (error) {
      throw new Error(`Failed to load milestone definitions: ${error.message}`);
    }

    this.definitionsCache.clear();
    this.definitionsByPhase.clear();

    for (const def of data || []) {
      this.definitionsCache.set(def.milestone_code, def);

      const phaseList = this.definitionsByPhase.get(def.milestone_phase) || [];
      phaseList.push(def);
      this.definitionsByPhase.set(def.milestone_phase, phaseList);
    }

    this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
  }

  /**
   * Ensure cache is valid
   */
  private async ensureCacheValid(): Promise<void> {
    if (Date.now() >= this.cacheExpiry || this.definitionsCache.size === 0) {
      await this.loadDefinitions();
    }
  }

  /**
   * Force cache refresh
   */
  async refreshCache(): Promise<void> {
    await this.loadDefinitions();
  }
}
