/**
 * PreciseActionService
 *
 * Generates intelligent, context-aware action recommendations.
 * Uses action_templates table + shipment context + urgency detection.
 *
 * KEY FEATURES:
 * - Specific action descriptions (not generic "review and respond")
 * - Smart deadline calculation (based on cutoffs)
 * - Priority scoring (keywords + deadlines + shipment stage)
 * - Auto-resolution logic (what completes this action)
 * - Owner assignment (operations, sales, finance, customs)
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

export interface ActionTemplate {
  id: string;
  document_type: string;
  from_party: string;
  direction: string;
  action_type: string;
  action_template: string;
  action_verb: string;
  default_owner: string | null;
  deadline_type: string | null;
  deadline_days: number | null;
  deadline_cutoff_field: string | null;
  deadline_cutoff_offset: number | null;
  base_priority: number;
  priority_boost_keywords: string[] | null;
  priority_boost_amount: number;
  auto_resolve_on: string[] | null;
  auto_resolve_keywords: string[] | null;
}

export interface ShipmentContext {
  shipmentId?: string;
  stage?: string;
  customerName?: string;
  bookingNumber?: string;
  siCutoff?: Date | null;
  vgmCutoff?: Date | null;
  cargoCutoff?: Date | null;
  eta?: Date | null;
}

export interface PreciseActionRecommendation {
  hasAction: boolean;
  actionType: string;           // share, respond, process, pay, investigate, etc.
  actionVerb: string;           // Short verb for UI
  actionDescription: string;    // Full, specific description
  owner: string;                // Who should handle this
  priority: number;             // 0-100 score
  priorityLabel: string;        // URGENT, HIGH, MEDIUM, LOW
  deadline: Date | null;        // When this needs to be done
  deadlineSource: string | null; // "2 days from receipt" or "2 days before SI cutoff"
  autoResolveOn: string[];      // Document types that will resolve this
  autoResolveKeywords: string[]; // Keywords in reply that resolve
  confidence: number;
  source: 'template' | 'fallback';
}

// ============================================================================
// SERVICE
// ============================================================================

export class PreciseActionService {
  private templateCache: Map<string, ActionTemplate> = new Map();
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Generate precise action recommendation for a classified email
   */
  async getRecommendation(
    documentType: string,
    fromParty: string,
    subject: string,
    body: string,
    emailDate: Date,
    shipmentContext?: ShipmentContext
  ): Promise<PreciseActionRecommendation> {
    await this.ensureCacheLoaded();

    // Find matching template
    const key = `${documentType}|${fromParty}|inbound`;
    const template = this.templateCache.get(key);

    if (!template) {
      return this.createFallbackRecommendation(documentType, fromParty);
    }

    // Calculate priority
    const { priority, priorityLabel } = this.calculatePriority(
      template,
      subject,
      body,
      emailDate,
      shipmentContext
    );

    // Calculate deadline
    const { deadline, deadlineSource } = this.calculateDeadline(
      template,
      emailDate,
      shipmentContext
    );

    // Generate action description from template
    const actionDescription = this.renderTemplate(
      template.action_template,
      documentType,
      fromParty,
      shipmentContext
    );

    return {
      hasAction: true,
      actionType: template.action_type,
      actionVerb: template.action_verb,
      actionDescription,
      owner: template.default_owner || 'operations',
      priority,
      priorityLabel,
      deadline,
      deadlineSource,
      autoResolveOn: template.auto_resolve_on || [],
      autoResolveKeywords: template.auto_resolve_keywords || [],
      confidence: 85,
      source: 'template',
    };
  }

  /**
   * Check if an incoming email should auto-resolve pending actions
   */
  async checkAutoResolve(
    shipmentId: string,
    documentType: string,
    subject: string,
    body: string
  ): Promise<{ resolved: boolean; resolvedActions: string[] }> {
    // Find pending actions for this shipment that could be auto-resolved
    const { data: pendingActions } = await this.supabase
      .from('chronicle')
      .select('id, document_type, action_description')
      .eq('shipment_id', shipmentId)
      .eq('has_action', true)
      .is('action_completed_at', null);

    if (!pendingActions || pendingActions.length === 0) {
      return { resolved: false, resolvedActions: [] };
    }

    await this.ensureCacheLoaded();
    const resolvedActions: string[] = [];
    const searchText = `${subject} ${body}`.toLowerCase();

    for (const action of pendingActions) {
      const key = `${action.document_type}|*|inbound`;
      const template = this.findTemplate(action.document_type);

      if (!template) continue;

      // Check if this document type resolves the action
      const docTypeResolves = template.auto_resolve_on?.includes(documentType);

      // Check if keywords indicate resolution
      const keywordResolves = template.auto_resolve_keywords?.some(
        kw => searchText.includes(kw.toLowerCase())
      );

      if (docTypeResolves || keywordResolves) {
        // Mark as resolved
        await this.supabase
          .from('chronicle')
          .update({
            action_completed_at: new Date().toISOString(),
            action_description: `${action.action_description} [Auto-resolved by ${documentType}]`,
          })
          .eq('id', action.id);

        resolvedActions.push(action.id);
      }
    }

    return {
      resolved: resolvedActions.length > 0,
      resolvedActions,
    };
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private calculatePriority(
    template: ActionTemplate,
    subject: string,
    body: string,
    emailDate: Date,
    context?: ShipmentContext
  ): { priority: number; priorityLabel: string } {
    let priority = template.base_priority;
    const searchText = `${subject} ${body}`.toLowerCase();

    // Boost for urgency keywords
    if (template.priority_boost_keywords) {
      const hasUrgentKeyword = template.priority_boost_keywords.some(
        kw => searchText.includes(kw.toLowerCase())
      );
      if (hasUrgentKeyword) {
        priority += template.priority_boost_amount;
      }
    }

    // Boost if approaching cutoff
    if (context?.siCutoff) {
      const daysUntilCutoff = this.daysBetween(new Date(), context.siCutoff);
      if (daysUntilCutoff <= 1) priority += 25;
      else if (daysUntilCutoff <= 3) priority += 15;
      else if (daysUntilCutoff <= 5) priority += 10;
    }

    // Boost for exception/issue documents
    if (template.action_type === 'investigate') {
      priority += 10;
    }

    // Cap at 100
    priority = Math.min(priority, 100);

    // Determine label
    let priorityLabel: string;
    if (priority >= 85) priorityLabel = 'URGENT';
    else if (priority >= 70) priorityLabel = 'HIGH';
    else if (priority >= 50) priorityLabel = 'MEDIUM';
    else priorityLabel = 'LOW';

    return { priority, priorityLabel };
  }

  private calculateDeadline(
    template: ActionTemplate,
    emailDate: Date,
    context?: ShipmentContext
  ): { deadline: Date | null; deadlineSource: string | null } {
    if (!template.deadline_type) {
      return { deadline: null, deadlineSource: null };
    }

    if (template.deadline_type === 'fixed_days' && template.deadline_days) {
      const deadline = new Date(emailDate);
      deadline.setDate(deadline.getDate() + template.deadline_days);
      return {
        deadline,
        deadlineSource: `${template.deadline_days} day(s) from receipt`,
      };
    }

    if (template.deadline_type === 'cutoff_relative' && context) {
      const cutoffField = template.deadline_cutoff_field || 'siCutoff';
      const cutoffDate = context[cutoffField as keyof ShipmentContext] as Date | null;

      if (cutoffDate) {
        const deadline = new Date(cutoffDate);
        const offset = template.deadline_cutoff_offset || -2;
        deadline.setDate(deadline.getDate() + offset);
        return {
          deadline,
          deadlineSource: `${Math.abs(offset)} day(s) before ${cutoffField.replace('Cutoff', '')} cutoff`,
        };
      }
    }

    if (template.deadline_type === 'urgent') {
      const deadline = new Date(emailDate);
      deadline.setDate(deadline.getDate() + 1);
      return {
        deadline,
        deadlineSource: 'Urgent - within 24 hours',
      };
    }

    return { deadline: null, deadlineSource: null };
  }

  private renderTemplate(
    template: string,
    documentType: string,
    fromParty: string,
    context?: ShipmentContext
  ): string {
    let result = template;

    // Replace placeholders
    result = result.replace(/{document_type}/g, documentType.replace(/_/g, ' '));
    result = result.replace(/{from_party}/g, fromParty.replace(/_/g, ' '));
    result = result.replace(/{customer}/g, context?.customerName || 'customer');
    result = result.replace(/{booking}/g, context?.bookingNumber || '');

    return result;
  }

  private findTemplate(documentType: string): ActionTemplate | null {
    // Try exact match first
    const entries = Array.from(this.templateCache.entries());
    for (const [key, template] of entries) {
      if (key.startsWith(`${documentType}|`)) {
        return template;
      }
    }
    return null;
  }

  private createFallbackRecommendation(
    documentType: string,
    fromParty: string
  ): PreciseActionRecommendation {
    // Determine if this document type typically needs action
    const noActionTypes = [
      'tracking_update', 'schedule_update', 'acknowledgement',
      'notification', 'system_notification', 'pod_proof_of_delivery',
    ];
    const confirmationTypes = [
      'booking_confirmation', 'vgm_confirmation', 'si_confirmation',
      'sob_confirmation', 'rate_confirmation',
    ];

    if (noActionTypes.includes(documentType)) {
      return {
        hasAction: false,
        actionType: 'none',
        actionVerb: 'File',
        actionDescription: 'Informational - no action required',
        owner: 'operations',
        priority: 0,
        priorityLabel: 'LOW',
        deadline: null,
        deadlineSource: null,
        autoResolveOn: [],
        autoResolveKeywords: [],
        confidence: 70,
        source: 'fallback',
      };
    }

    if (confirmationTypes.includes(documentType) && fromParty !== 'customer') {
      return {
        hasAction: false,
        actionType: 'none',
        actionVerb: 'File',
        actionDescription: 'Confirmation received - task completed',
        owner: 'operations',
        priority: 0,
        priorityLabel: 'LOW',
        deadline: null,
        deadlineSource: null,
        autoResolveOn: [],
        autoResolveKeywords: [],
        confidence: 75,
        source: 'fallback',
      };
    }

    // Default: needs review
    return {
      hasAction: true,
      actionType: 'review',
      actionVerb: 'Review',
      actionDescription: `Review ${documentType.replace(/_/g, ' ')} from ${fromParty.replace(/_/g, ' ')}`,
      owner: 'operations',
      priority: 50,
      priorityLabel: 'MEDIUM',
      deadline: null,
      deadlineSource: null,
      autoResolveOn: [],
      autoResolveKeywords: [],
      confidence: 50,
      source: 'fallback',
    };
  }

  private daysBetween(date1: Date, date2: Date): number {
    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    return Math.floor((date2.getTime() - date1.getTime()) / MS_PER_DAY);
  }

  private async ensureCacheLoaded(): Promise<void> {
    if (Date.now() < this.cacheExpiry && this.templateCache.size > 0) {
      return;
    }

    const { data: templates, error } = await this.supabase
      .from('action_templates')
      .select('*')
      .eq('enabled', true);

    if (error) {
      console.error('[PreciseActionService] Failed to load templates:', error.message);
      return;
    }

    this.templateCache.clear();
    for (const template of templates || []) {
      const key = `${template.document_type}|${template.from_party}|${template.direction}`;
      this.templateCache.set(key, template);
    }

    this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
    console.log(`[PreciseActionService] Loaded ${this.templateCache.size} action templates`);
  }

  /**
   * Invalidate cache after template updates
   */
  invalidateCache(): void {
    this.cacheExpiry = 0;
    this.templateCache.clear();
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createPreciseActionService(supabase: SupabaseClient): PreciseActionService {
  return new PreciseActionService(supabase);
}
