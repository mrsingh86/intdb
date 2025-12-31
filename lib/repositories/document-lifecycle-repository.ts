/**
 * Document Lifecycle Repository
 *
 * Data access layer for document lifecycle management including:
 * - Document lifecycle states
 * - Document comparisons
 * - Missing document alerts
 * - Document type requirements
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  DocumentLifecycle,
  DocumentComparison,
  MissingDocumentAlert,
  DocumentComparisonField,
  DocumentTypeRequirement,
  DocumentLifecycleStatus,
  DocumentComparisonStatus,
  MissingDocumentAlertStatus,
} from '@/types/intelligence-platform';

export interface DocumentLifecycleFilters {
  shipmentId?: string;
  documentType?: string;
  lifecycleStatus?: DocumentLifecycleStatus | DocumentLifecycleStatus[];
  hasMissingFields?: boolean;
  dueBefore?: string;
}

export interface DocumentComparisonFilters {
  shipmentId?: string;
  sourceDocumentType?: string;
  targetDocumentType?: string;
  comparisonStatus?: DocumentComparisonStatus;
  isResolved?: boolean;
  hasCriticalDiscrepancies?: boolean;
}

export interface MissingDocumentAlertFilters {
  shipmentId?: string;
  documentType?: string;
  alertStatus?: MissingDocumentAlertStatus | MissingDocumentAlertStatus[];
  overdueOnly?: boolean;
  dueSoon?: boolean;
}

export class DocumentLifecycleRepository {
  constructor(private supabase: SupabaseClient) {}

  // ============================================================================
  // DOCUMENT LIFECYCLE CRUD
  // ============================================================================

  async findLifecycleById(id: string): Promise<DocumentLifecycle | null> {
    const { data, error } = await this.supabase
      .from('document_lifecycle')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to fetch document lifecycle: ${error.message}`);
    }

    return data;
  }

  async findLifecycleByShipmentAndType(
    shipmentId: string,
    documentType: string
  ): Promise<DocumentLifecycle | null> {
    const { data, error } = await this.supabase
      .from('document_lifecycle')
      .select('*')
      .eq('shipment_id', shipmentId)
      .eq('document_type', documentType)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to fetch document lifecycle: ${error.message}`);
    }

    return data;
  }

  async findAllLifecycles(
    filters: DocumentLifecycleFilters = {},
    pagination?: { page: number; limit: number }
  ): Promise<{ data: DocumentLifecycle[]; total: number }> {
    let query = this.supabase
      .from('document_lifecycle')
      .select('*', { count: 'exact' });

    if (filters.shipmentId) {
      query = query.eq('shipment_id', filters.shipmentId);
    }

    if (filters.documentType) {
      query = query.eq('document_type', filters.documentType);
    }

    if (filters.lifecycleStatus) {
      if (Array.isArray(filters.lifecycleStatus)) {
        query = query.in('lifecycle_status', filters.lifecycleStatus);
      } else {
        query = query.eq('lifecycle_status', filters.lifecycleStatus);
      }
    }

    if (filters.hasMissingFields) {
      query = query.not('missing_fields', 'is', null)
        .neq('missing_fields', '{}');
    }

    if (filters.dueBefore) {
      query = query.lte('due_date', filters.dueBefore);
    }

    query = query.order('due_date', { ascending: true, nullsFirst: false });

    if (pagination) {
      const offset = (pagination.page - 1) * pagination.limit;
      query = query.range(offset, offset + pagination.limit - 1);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch document lifecycles: ${error.message}`);
    }

    return { data: data || [], total: count || 0 };
  }

  async createLifecycle(
    lifecycle: Omit<DocumentLifecycle, 'id' | 'created_at' | 'updated_at'>
  ): Promise<DocumentLifecycle> {
    const { data, error } = await this.supabase
      .from('document_lifecycle')
      .insert({
        ...lifecycle,
        status_history: lifecycle.status_history || [
          {
            status: lifecycle.lifecycle_status,
            changed_at: new Date().toISOString(),
            changed_by: 'system',
          },
        ],
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create document lifecycle: ${error.message}`);
    }

    return data;
  }

  async updateLifecycle(
    id: string,
    updates: Partial<DocumentLifecycle>
  ): Promise<DocumentLifecycle> {
    const { data, error } = await this.supabase
      .from('document_lifecycle')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update document lifecycle: ${error.message}`);
    }

    return data;
  }

  async upsertLifecycle(
    shipmentId: string,
    documentType: string,
    updates: Partial<DocumentLifecycle>
  ): Promise<DocumentLifecycle> {
    const { data, error } = await this.supabase
      .from('document_lifecycle')
      .upsert(
        {
          shipment_id: shipmentId,
          document_type: documentType,
          ...updates,
        },
        { onConflict: 'shipment_id,document_type' }
      )
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to upsert document lifecycle: ${error.message}`);
    }

    return data;
  }

  async updateLifecycleStatus(
    id: string,
    newStatus: DocumentLifecycleStatus,
    changedBy: string = 'system'
  ): Promise<DocumentLifecycle> {
    // Get current lifecycle for history
    const current = await this.findLifecycleById(id);
    if (!current) {
      throw new Error(`Document lifecycle not found: ${id}`);
    }

    const statusHistory = [
      ...(current.status_history || []),
      {
        status: newStatus,
        changed_at: new Date().toISOString(),
        changed_by: changedBy,
        previous_status: current.lifecycle_status,
      },
    ];

    const updates: Partial<DocumentLifecycle> = {
      lifecycle_status: newStatus,
      status_history: statusHistory,
    };

    // Set timestamps based on status
    if (newStatus === 'approved') {
      updates.approved_at = new Date().toISOString();
    } else if (newStatus === 'sent') {
      updates.sent_at = new Date().toISOString();
    }

    return this.updateLifecycle(id, updates);
  }

  // ============================================================================
  // DOCUMENT COMPARISONS
  // ============================================================================

  async findComparisonById(id: string): Promise<DocumentComparison | null> {
    const { data, error } = await this.supabase
      .from('document_comparisons')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to fetch document comparison: ${error.message}`);
    }

    return data;
  }

  async findAllComparisons(
    filters: DocumentComparisonFilters = {},
    pagination?: { page: number; limit: number }
  ): Promise<{ data: DocumentComparison[]; total: number }> {
    let query = this.supabase
      .from('document_comparisons')
      .select('*', { count: 'exact' });

    if (filters.shipmentId) {
      query = query.eq('shipment_id', filters.shipmentId);
    }

    if (filters.sourceDocumentType) {
      query = query.eq('source_document_type', filters.sourceDocumentType);
    }

    if (filters.targetDocumentType) {
      query = query.eq('target_document_type', filters.targetDocumentType);
    }

    if (filters.comparisonStatus) {
      query = query.eq('comparison_status', filters.comparisonStatus);
    }

    if (filters.isResolved !== undefined) {
      query = query.eq('is_resolved', filters.isResolved);
    }

    if (filters.hasCriticalDiscrepancies) {
      query = query.gt('critical_discrepancies', 0);
    }

    query = query.order('compared_at', { ascending: false });

    if (pagination) {
      const offset = (pagination.page - 1) * pagination.limit;
      query = query.range(offset, offset + pagination.limit - 1);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch document comparisons: ${error.message}`);
    }

    return { data: data || [], total: count || 0 };
  }

  async findUnresolvedComparisons(
    shipmentId?: string
  ): Promise<DocumentComparison[]> {
    let query = this.supabase
      .from('document_comparisons')
      .select('*')
      .eq('is_resolved', false)
      .eq('comparison_status', 'discrepancies_found')
      .order('critical_discrepancies', { ascending: false });

    if (shipmentId) {
      query = query.eq('shipment_id', shipmentId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch unresolved comparisons: ${error.message}`);
    }

    return data || [];
  }

  async createComparison(
    comparison: Omit<DocumentComparison, 'id' | 'created_at' | 'updated_at' | 'compared_at'>
  ): Promise<DocumentComparison> {
    const { data, error } = await this.supabase
      .from('document_comparisons')
      .insert({
        ...comparison,
        compared_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create document comparison: ${error.message}`);
    }

    return data;
  }

  async updateComparison(
    id: string,
    updates: Partial<DocumentComparison>
  ): Promise<DocumentComparison> {
    const { data, error } = await this.supabase
      .from('document_comparisons')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update document comparison: ${error.message}`);
    }

    return data;
  }

  async resolveComparison(
    id: string,
    resolvedBy: string,
    notes?: string
  ): Promise<DocumentComparison> {
    return this.updateComparison(id, {
      is_resolved: true,
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
      resolution_notes: notes,
    });
  }

  // ============================================================================
  // COMPARISON FIELD CONFIGURATION
  // ============================================================================

  async getComparisonFields(
    sourceType: string,
    targetType: string
  ): Promise<DocumentComparisonField[]> {
    const { data, error } = await this.supabase
      .from('document_comparison_fields')
      .select('*')
      .eq('source_document_type', sourceType)
      .eq('target_document_type', targetType)
      .eq('is_active', true)
      .order('severity', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch comparison fields: ${error.message}`);
    }

    return data || [];
  }

  async getAllComparisonFieldConfigs(): Promise<DocumentComparisonField[]> {
    const { data, error } = await this.supabase
      .from('document_comparison_fields')
      .select('*')
      .eq('is_active', true)
      .order('source_document_type')
      .order('target_document_type')
      .order('severity');

    if (error) {
      throw new Error(`Failed to fetch comparison field configs: ${error.message}`);
    }

    return data || [];
  }

  // ============================================================================
  // MISSING DOCUMENT ALERTS
  // ============================================================================

  async findAlertById(id: string): Promise<MissingDocumentAlert | null> {
    const { data, error } = await this.supabase
      .from('missing_document_alerts')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to fetch missing document alert: ${error.message}`);
    }

    return data;
  }

  async findAllAlerts(
    filters: MissingDocumentAlertFilters = {},
    pagination?: { page: number; limit: number }
  ): Promise<{ data: MissingDocumentAlert[]; total: number }> {
    let query = this.supabase
      .from('missing_document_alerts')
      .select('*', { count: 'exact' });

    if (filters.shipmentId) {
      query = query.eq('shipment_id', filters.shipmentId);
    }

    if (filters.documentType) {
      query = query.eq('document_type', filters.documentType);
    }

    if (filters.alertStatus) {
      if (Array.isArray(filters.alertStatus)) {
        query = query.in('alert_status', filters.alertStatus);
      } else {
        query = query.eq('alert_status', filters.alertStatus);
      }
    }

    if (filters.overdueOnly) {
      query = query.eq('alert_status', 'overdue');
    }

    if (filters.dueSoon) {
      query = query.eq('alert_status', 'due_soon');
    }

    query = query.order('expected_by', { ascending: true });

    if (pagination) {
      const offset = (pagination.page - 1) * pagination.limit;
      query = query.range(offset, offset + pagination.limit - 1);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch missing document alerts: ${error.message}`);
    }

    return { data: data || [], total: count || 0 };
  }

  async findActiveAlerts(shipmentId?: string): Promise<MissingDocumentAlert[]> {
    let query = this.supabase
      .from('missing_document_alerts')
      .select('*')
      .in('alert_status', ['pending', 'due_soon', 'overdue', 'reminded'])
      .order('expected_by', { ascending: true });

    if (shipmentId) {
      query = query.eq('shipment_id', shipmentId);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch active alerts: ${error.message}`);
    }

    return data || [];
  }

  async createAlert(
    alert: Omit<MissingDocumentAlert, 'id' | 'created_at' | 'updated_at'>
  ): Promise<MissingDocumentAlert> {
    const { data, error } = await this.supabase
      .from('missing_document_alerts')
      .insert(alert)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create missing document alert: ${error.message}`);
    }

    return data;
  }

  async upsertAlert(
    shipmentId: string,
    documentType: string,
    updates: Partial<MissingDocumentAlert>
  ): Promise<MissingDocumentAlert> {
    const { data, error } = await this.supabase
      .from('missing_document_alerts')
      .upsert(
        {
          shipment_id: shipmentId,
          document_type: documentType,
          ...updates,
        },
        { onConflict: 'shipment_id,document_type' }
      )
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to upsert missing document alert: ${error.message}`);
    }

    return data;
  }

  async updateAlert(
    id: string,
    updates: Partial<MissingDocumentAlert>
  ): Promise<MissingDocumentAlert> {
    const { data, error } = await this.supabase
      .from('missing_document_alerts')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update missing document alert: ${error.message}`);
    }

    return data;
  }

  async resolveAlert(
    id: string,
    resolvedBy: string,
    notes?: string
  ): Promise<MissingDocumentAlert> {
    return this.updateAlert(id, {
      alert_status: 'resolved',
      resolved_by: resolvedBy,
      resolved_at: new Date().toISOString(),
      resolution_notes: notes,
    });
  }

  async recordReminder(id: string): Promise<MissingDocumentAlert> {
    const alert = await this.findAlertById(id);
    if (!alert) {
      throw new Error(`Alert not found: ${id}`);
    }

    return this.updateAlert(id, {
      alert_status: 'reminded',
      reminder_count: (alert.reminder_count || 0) + 1,
      last_reminder_at: new Date().toISOString(),
    });
  }

  // ============================================================================
  // DOCUMENT TYPE REQUIREMENTS
  // ============================================================================

  async getDocumentRequirements(): Promise<DocumentTypeRequirement[]> {
    const { data, error } = await this.supabase
      .from('document_type_requirements')
      .select('*')
      .eq('is_active', true)
      .order('due_days_offset', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch document requirements: ${error.message}`);
    }

    return data || [];
  }

  async getRequirementsForStage(stage: string): Promise<DocumentTypeRequirement[]> {
    const { data, error } = await this.supabase
      .from('document_type_requirements')
      .select('*')
      .eq('required_at_stage', stage)
      .eq('is_active', true)
      .order('due_days_offset', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch requirements for stage: ${error.message}`);
    }

    return data || [];
  }

  // ============================================================================
  // STATISTICS & DASHBOARD
  // ============================================================================

  async getDocumentStatistics(): Promise<{
    totalLifecycles: number;
    byStatus: Record<string, number>;
    withMissingFields: number;
    pendingComparisons: number;
    unresolvedDiscrepancies: number;
    criticalDiscrepancies: number;
    activeAlerts: number;
    overdueAlerts: number;
  }> {
    // Lifecycle stats
    const { data: lifecycles, count: lifecycleCount } = await this.supabase
      .from('document_lifecycle')
      .select('lifecycle_status, missing_fields', { count: 'exact' });

    const byStatus: Record<string, number> = {};
    let withMissingFields = 0;
    for (const lc of lifecycles || []) {
      byStatus[lc.lifecycle_status] = (byStatus[lc.lifecycle_status] || 0) + 1;
      if (lc.missing_fields && lc.missing_fields.length > 0) {
        withMissingFields++;
      }
    }

    // Comparison stats
    const { data: comparisons } = await this.supabase
      .from('document_comparisons')
      .select('comparison_status, is_resolved, critical_discrepancies');

    let pendingComparisons = 0;
    let unresolvedDiscrepancies = 0;
    let criticalDiscrepancies = 0;
    for (const c of comparisons || []) {
      if (c.comparison_status === 'pending') pendingComparisons++;
      if (c.comparison_status === 'discrepancies_found' && !c.is_resolved) {
        unresolvedDiscrepancies++;
        if (c.critical_discrepancies > 0) criticalDiscrepancies++;
      }
    }

    // Alert stats
    const { data: alerts } = await this.supabase
      .from('missing_document_alerts')
      .select('alert_status');

    let activeAlerts = 0;
    let overdueAlerts = 0;
    for (const a of alerts || []) {
      if (['pending', 'due_soon', 'overdue', 'reminded'].includes(a.alert_status)) {
        activeAlerts++;
      }
      if (a.alert_status === 'overdue') overdueAlerts++;
    }

    return {
      totalLifecycles: lifecycleCount || 0,
      byStatus,
      withMissingFields,
      pendingComparisons,
      unresolvedDiscrepancies,
      criticalDiscrepancies,
      activeAlerts,
      overdueAlerts,
    };
  }

  async getShipmentDocumentStatus(shipmentId: string): Promise<{
    lifecycles: DocumentLifecycle[];
    comparisons: DocumentComparison[];
    alerts: MissingDocumentAlert[];
    summary: {
      totalDocuments: number;
      approved: number;
      pending: number;
      hasDiscrepancies: boolean;
      hasMissingDocs: boolean;
    };
  }> {
    const [lifecyclesResult, comparisonsResult, alertsResult] = await Promise.all([
      this.findAllLifecycles({ shipmentId }),
      this.findAllComparisons({ shipmentId }),
      this.findAllAlerts({ shipmentId }),
    ]);

    const lifecycles = lifecyclesResult.data;
    const comparisons = comparisonsResult.data;
    const alerts = alertsResult.data;

    const approved = lifecycles.filter(l => l.lifecycle_status === 'approved').length;
    const pending = lifecycles.filter(l =>
      ['draft', 'review'].includes(l.lifecycle_status)
    ).length;
    const hasDiscrepancies = comparisons.some(
      c => c.comparison_status === 'discrepancies_found' && !c.is_resolved
    );
    const hasMissingDocs = alerts.some(
      a => ['pending', 'due_soon', 'overdue'].includes(a.alert_status)
    );

    return {
      lifecycles,
      comparisons,
      alerts,
      summary: {
        totalDocuments: lifecycles.length,
        approved,
        pending,
        hasDiscrepancies,
        hasMissingDocs,
      },
    };
  }
}
