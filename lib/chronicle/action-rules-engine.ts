/**
 * ActionRulesEngine
 *
 * Unified 3-source action system:
 * 1. DOCUMENT_RECEIPT - When document arrives, determine routing and action
 * 2. TIME_BASED - Cutoff/ETA triggered actions
 * 3. DOCUMENT_FLOW - Multi-step routing flows
 *
 * Uses new database tables:
 * - document_action_rules: Primary action determination
 * - time_based_action_rules: Time-triggered actions
 * - document_routing_rules: Multi-step document flows
 * - action_trigger_log: Audit trail
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// TYPES
// ============================================================================

export interface DocumentActionRule {
  id: string;
  document_type: string;
  from_party: string;
  is_reply: boolean;
  applicable_stages: string[] | null;
  has_action: boolean;
  action_verb: string | null;
  action_object: string | null;
  to_party: string | null;
  action_owner: string;
  action_description: string | null;
  requires_response: boolean;
  expected_response_type: string | null;
  default_deadline_hours: number | null;
  urgency: string;
  confidence: number;
}

export interface TimeBasedRule {
  id: string;
  trigger_event: string;
  trigger_offset_hours: number;
  applicable_stages: string[] | null;
  condition_field: string | null;
  condition_operator: string | null;
  action_verb: string;
  action_object: string;
  action_description: string;
  action_owner: string;
  notify_parties: string[] | null;
  urgency: string;
  cooldown_hours: number;
}

export interface DocumentFlow {
  document_type: string;
  steps: FlowStep[];
}

export interface FlowStep {
  sequence: number;
  from_party: string;
  to_party: string;
  action: string;
  action_description: string | null;
  action_owner: string;
  deadline_hours: number | null;
  trigger_on_response: string | null;
}

export interface ActionResult {
  hasAction: boolean;
  actionVerb: string | null;
  actionObject: string | null;
  actionDescription: string | null;
  toParty: string | null;
  actionOwner: string;
  requiresResponse: boolean;
  expectedResponseType: string | null;
  deadlineHours: number | null;
  urgency: string;
  confidence: number;
  source: 'document_rule' | 'time_based' | 'flow_step' | 'fallback';
  ruleId: string | null;
}

export interface TimeBasedAction {
  ruleId: string;
  triggerEvent: string;
  actionVerb: string;
  actionObject: string;
  actionDescription: string;
  actionOwner: string;
  notifyParties: string[];
  urgency: string;
  hoursUntilTrigger: number;
  isFiring: boolean;
}

export interface FlowPosition {
  documentType: string;
  currentStep: number;
  nextStep: FlowStep | null;
  isComplete: boolean;
  pendingAction: string | null;
}

// ============================================================================
// SERVICE
// ============================================================================

export class ActionRulesEngine {
  private documentRulesCache: Map<string, DocumentActionRule> = new Map();
  private timeRulesCache: TimeBasedRule[] = [];
  private flowCache: Map<string, DocumentFlow> = new Map();
  private cacheExpiry: number = 0;
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(private readonly supabase: SupabaseClient) {}

  // ==========================================================================
  // SOURCE 1: DOCUMENT RECEIPT ACTIONS
  // ==========================================================================

  /**
   * Determine action when a document is received
   * Primary method for document-triggered actions
   */
  async getDocumentAction(
    documentType: string,
    fromParty: string,
    isReply: boolean = false,
    shipmentStage?: string
  ): Promise<ActionResult> {
    await this.ensureCacheLoaded();

    // Build lookup key
    const key = `${documentType}|${fromParty}|${isReply}`;
    const rule = this.documentRulesCache.get(key);

    if (!rule) {
      // Try without is_reply flag (rules without reply apply to both)
      const fallbackKey = `${documentType}|${fromParty}|false`;
      const fallbackRule = this.documentRulesCache.get(fallbackKey);

      if (fallbackRule) {
        return this.ruleToResult(fallbackRule, shipmentStage);
      }

      return this.createFallbackResult(documentType, fromParty);
    }

    return this.ruleToResult(rule, shipmentStage);
  }

  /**
   * Convert database rule to ActionResult
   */
  private ruleToResult(rule: DocumentActionRule, shipmentStage?: string): ActionResult {
    // Check if rule applies to this stage
    if (rule.applicable_stages && shipmentStage) {
      if (!rule.applicable_stages.includes(shipmentStage)) {
        // Rule doesn't apply to this stage, return no-action
        return {
          hasAction: false,
          actionVerb: null,
          actionObject: null,
          actionDescription: `${rule.document_type} not applicable at ${shipmentStage} stage`,
          toParty: null,
          actionOwner: 'operations',
          requiresResponse: false,
          expectedResponseType: null,
          deadlineHours: null,
          urgency: 'low',
          confidence: 70,
          source: 'document_rule',
          ruleId: rule.id,
        };
      }
    }

    return {
      hasAction: rule.has_action,
      actionVerb: rule.action_verb,
      actionObject: rule.action_object,
      actionDescription: rule.action_description,
      toParty: rule.to_party,
      actionOwner: rule.action_owner,
      requiresResponse: rule.requires_response,
      expectedResponseType: rule.expected_response_type,
      deadlineHours: rule.default_deadline_hours,
      urgency: rule.urgency,
      confidence: rule.confidence,
      source: 'document_rule',
      ruleId: rule.id,
    };
  }

  /**
   * Create fallback when no rule exists
   */
  private createFallbackResult(documentType: string, fromParty: string): ActionResult {
    // Confirmations from carriers → no action
    const confirmationTypes = [
      'booking_confirmation', 'vgm_confirmation', 'si_confirmation',
      'sob_confirmation', 'rate_confirmation', 'approval',
    ];
    if (confirmationTypes.includes(documentType) && fromParty !== 'customer') {
      return {
        hasAction: false,
        actionVerb: 'complete',
        actionObject: 'task',
        actionDescription: `${documentType.replace(/_/g, ' ')} received - confirmation, no action needed`,
        toParty: null,
        actionOwner: 'operations',
        requiresResponse: false,
        expectedResponseType: null,
        deadlineHours: null,
        urgency: 'low',
        confidence: 70,
        source: 'fallback',
        ruleId: null,
      };
    }

    // Notifications → no action
    const notificationTypes = [
      'tracking_update', 'schedule_update', 'notification',
      'internal_notification',
    ];
    if (notificationTypes.includes(documentType)) {
      return {
        hasAction: false,
        actionVerb: null,
        actionObject: null,
        actionDescription: 'Informational notification - no action required',
        toParty: null,
        actionOwner: 'operations',
        requiresResponse: false,
        expectedResponseType: null,
        deadlineHours: null,
        urgency: 'low',
        confidence: 70,
        source: 'fallback',
        ruleId: null,
      };
    }

    // Default: needs review
    return {
      hasAction: true,
      actionVerb: 'review',
      actionObject: 'document',
      actionDescription: `Review ${documentType.replace(/_/g, ' ')} from ${fromParty.replace(/_/g, ' ')}`,
      toParty: null,
      actionOwner: 'operations',
      requiresResponse: false,
      expectedResponseType: null,
      deadlineHours: 24,
      urgency: 'normal',
      confidence: 50,
      source: 'fallback',
      ruleId: null,
    };
  }

  // ==========================================================================
  // SOURCE 2: TIME-BASED ACTIONS
  // ==========================================================================

  /**
   * Get time-based actions that should fire for a shipment
   */
  async getTimeBasedActions(
    shipmentId: string,
    shipmentStage: string,
    cutoffs: {
      siCutoff?: Date | null;
      vgmCutoff?: Date | null;
      cargoCutoff?: Date | null;
      etd?: Date | null;
      eta?: Date | null;
    },
    conditions: {
      siSubmitted?: boolean;
      vgmSubmitted?: boolean;
      blIssued?: boolean;
      isfFiled?: boolean;
      containerPickedUp?: boolean;
    }
  ): Promise<TimeBasedAction[]> {
    await this.ensureCacheLoaded();

    const now = new Date();
    const actions: TimeBasedAction[] = [];

    for (const rule of this.timeRulesCache) {
      // Check if rule applies to this stage
      if (rule.applicable_stages && !rule.applicable_stages.includes(shipmentStage)) {
        continue;
      }

      // Get the relevant date for this trigger event
      const triggerDate = this.getTriggerDate(rule.trigger_event, cutoffs);
      if (!triggerDate) continue;

      // Calculate when the rule fires (date + offset)
      const fireTime = new Date(triggerDate);
      fireTime.setHours(fireTime.getHours() + rule.trigger_offset_hours);

      // Calculate hours until trigger
      const hoursUntilTrigger = (fireTime.getTime() - now.getTime()) / (1000 * 60 * 60);

      // Check if within firing window (past trigger time but not too old)
      const isFiring = hoursUntilTrigger <= 0 && hoursUntilTrigger > -(rule.cooldown_hours);

      // Check condition (if specified)
      if (rule.condition_field && rule.condition_operator === 'is_false') {
        const conditionValue = this.getConditionValue(rule.condition_field, conditions);
        if (conditionValue !== false) {
          continue; // Condition not met, skip this rule
        }
      }

      // Include rules that are firing or about to fire (within 72 hours)
      if (hoursUntilTrigger <= 72 && hoursUntilTrigger > -(rule.cooldown_hours)) {
        actions.push({
          ruleId: rule.id,
          triggerEvent: rule.trigger_event,
          actionVerb: rule.action_verb,
          actionObject: rule.action_object,
          actionDescription: rule.action_description,
          actionOwner: rule.action_owner,
          notifyParties: rule.notify_parties || [],
          urgency: rule.urgency,
          hoursUntilTrigger,
          isFiring,
        });
      }
    }

    // Sort by hours until trigger (soonest first)
    return actions.sort((a, b) => a.hoursUntilTrigger - b.hoursUntilTrigger);
  }

  /**
   * Get the date for a trigger event
   */
  private getTriggerDate(
    triggerEvent: string,
    cutoffs: { siCutoff?: Date | null; vgmCutoff?: Date | null; cargoCutoff?: Date | null; etd?: Date | null; eta?: Date | null }
  ): Date | null {
    switch (triggerEvent) {
      case 'si_cutoff': return cutoffs.siCutoff || null;
      case 'vgm_cutoff': return cutoffs.vgmCutoff || null;
      case 'cargo_cutoff': return cutoffs.cargoCutoff || null;
      case 'etd': return cutoffs.etd || null;
      case 'eta': return cutoffs.eta || null;
      default: return null;
    }
  }

  /**
   * Get condition value
   */
  private getConditionValue(
    field: string,
    conditions: { siSubmitted?: boolean; vgmSubmitted?: boolean; blIssued?: boolean; isfFiled?: boolean; containerPickedUp?: boolean }
  ): boolean | undefined {
    switch (field) {
      case 'si_submitted': return conditions.siSubmitted;
      case 'vgm_submitted': return conditions.vgmSubmitted;
      case 'bl_issued': return conditions.blIssued;
      case 'isf_filed': return conditions.isfFiled;
      case 'container_picked_up': return conditions.containerPickedUp;
      default: return undefined;
    }
  }

  // ==========================================================================
  // SOURCE 3: DOCUMENT FLOW TRACKING
  // ==========================================================================

  /**
   * Get the flow position for a document type on a shipment
   * Tracks multi-step flows like checklist: CHA → customer → back to CHA
   */
  async getFlowPosition(
    documentType: string,
    shipmentId: string
  ): Promise<FlowPosition> {
    await this.ensureCacheLoaded();

    const flow = this.flowCache.get(documentType);
    if (!flow || flow.steps.length === 0) {
      return {
        documentType,
        currentStep: 0,
        nextStep: null,
        isComplete: true,
        pendingAction: null,
      };
    }

    // Get chronicles for this document type on this shipment
    const { data: chronicles } = await this.supabase
      .from('chronicle')
      .select('id, from_party, has_action, action_completed_at, created_at')
      .eq('shipment_id', shipmentId)
      .eq('document_type', documentType)
      .order('created_at', { ascending: true });

    if (!chronicles || chronicles.length === 0) {
      // No documents yet - waiting for step 1
      return {
        documentType,
        currentStep: 0,
        nextStep: flow.steps[0],
        isComplete: false,
        pendingAction: flow.steps[0].action_description,
      };
    }

    // Determine current step based on latest document
    const lastChronicle = chronicles[chronicles.length - 1];
    const currentStepIndex = this.findStepIndex(flow.steps, lastChronicle.from_party);

    if (currentStepIndex === -1 || currentStepIndex >= flow.steps.length - 1) {
      // Either unknown step or at the end
      return {
        documentType,
        currentStep: flow.steps.length,
        nextStep: null,
        isComplete: true,
        pendingAction: null,
      };
    }

    // Check if current step action is pending
    const currentStep = flow.steps[currentStepIndex];
    const nextStep = flow.steps[currentStepIndex + 1];
    const hasPendingAction = lastChronicle.has_action && !lastChronicle.action_completed_at;

    return {
      documentType,
      currentStep: currentStepIndex + 1,
      nextStep: hasPendingAction ? currentStep : nextStep,
      isComplete: false,
      pendingAction: hasPendingAction
        ? currentStep.action_description
        : nextStep.action_description,
    };
  }

  /**
   * Find step index by from_party
   */
  private findStepIndex(steps: FlowStep[], fromParty: string): number {
    return steps.findIndex(s => s.from_party === fromParty || s.to_party === fromParty);
  }

  // ==========================================================================
  // AUDIT LOGGING
  // ==========================================================================

  /**
   * Log when an action rule fires (for learning and debugging)
   */
  async logActionTrigger(
    triggerSource: 'document_receipt' | 'time_based' | 'explicit_request',
    ruleId: string | null,
    ruleTable: string | null,
    chronicleId: string | null,
    shipmentId: string | null,
    actionDescription: string,
    actionOwner: string,
    toParty: string | null
  ): Promise<void> {
    await this.supabase.from('action_trigger_log').insert({
      trigger_source: triggerSource,
      rule_id: ruleId,
      rule_table: ruleTable,
      chronicle_id: chronicleId,
      shipment_id: shipmentId,
      action_description: actionDescription,
      action_owner: actionOwner,
      to_party: toParty,
    });
  }

  /**
   * Record feedback on whether triggered action was correct
   */
  async recordFeedback(
    logId: string,
    wasCorrect: boolean,
    feedbackNotes?: string
  ): Promise<void> {
    await this.supabase
      .from('action_trigger_log')
      .update({
        was_correct: wasCorrect,
        feedback_notes: feedbackNotes,
        action_completed_at: new Date().toISOString(),
      })
      .eq('id', logId);
  }

  // ==========================================================================
  // CACHE MANAGEMENT
  // ==========================================================================

  private async ensureCacheLoaded(): Promise<void> {
    if (Date.now() < this.cacheExpiry && this.documentRulesCache.size > 0) {
      return;
    }

    // Load document_action_rules
    const { data: docRules } = await this.supabase
      .from('document_action_rules')
      .select('*')
      .eq('enabled', true);

    this.documentRulesCache.clear();
    for (const rule of docRules || []) {
      const key = `${rule.document_type}|${rule.from_party}|${rule.is_reply}`;
      this.documentRulesCache.set(key, rule);
    }

    // Load time_based_action_rules
    const { data: timeRules } = await this.supabase
      .from('time_based_action_rules')
      .select('*')
      .eq('enabled', true);

    this.timeRulesCache = timeRules || [];

    // Load document_routing_rules
    const { data: flowRules } = await this.supabase
      .from('document_routing_rules')
      .select('*')
      .eq('enabled', true)
      .order('flow_sequence', { ascending: true });

    this.flowCache.clear();
    for (const rule of flowRules || []) {
      if (!this.flowCache.has(rule.document_type)) {
        this.flowCache.set(rule.document_type, {
          document_type: rule.document_type,
          steps: [],
        });
      }
      this.flowCache.get(rule.document_type)!.steps.push({
        sequence: rule.flow_sequence,
        from_party: rule.step_from_party,
        to_party: rule.step_to_party,
        action: rule.step_action,
        action_description: rule.action_description,
        action_owner: rule.action_owner,
        deadline_hours: rule.deadline_hours,
        trigger_on_response: rule.trigger_on_response,
      });
    }

    this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
    console.log(
      `[ActionRulesEngine] Loaded ${this.documentRulesCache.size} document rules, ` +
      `${this.timeRulesCache.length} time rules, ${this.flowCache.size} document flows`
    );
  }

  /**
   * Invalidate cache (call after rule updates)
   */
  invalidateCache(): void {
    this.cacheExpiry = 0;
    this.documentRulesCache.clear();
    this.timeRulesCache = [];
    this.flowCache.clear();
  }

  // ==========================================================================
  // ADMIN/DEBUG METHODS
  // ==========================================================================

  async getAllDocumentRules(): Promise<DocumentActionRule[]> {
    await this.ensureCacheLoaded();
    return Array.from(this.documentRulesCache.values());
  }

  async getAllTimeRules(): Promise<TimeBasedRule[]> {
    await this.ensureCacheLoaded();
    return this.timeRulesCache;
  }

  async getAllFlows(): Promise<DocumentFlow[]> {
    await this.ensureCacheLoaded();
    return Array.from(this.flowCache.values());
  }

  /**
   * Get summary stats for dashboard
   */
  async getStats(): Promise<{
    documentRules: number;
    timeRules: number;
    documentFlows: number;
    triggerLogCount: number;
  }> {
    await this.ensureCacheLoaded();

    const { count: triggerCount } = await this.supabase
      .from('action_trigger_log')
      .select('id', { count: 'exact', head: true });

    return {
      documentRules: this.documentRulesCache.size,
      timeRules: this.timeRulesCache.length,
      documentFlows: this.flowCache.size,
      triggerLogCount: triggerCount || 0,
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createActionRulesEngine(supabase: SupabaseClient): ActionRulesEngine {
  return new ActionRulesEngine(supabase);
}
