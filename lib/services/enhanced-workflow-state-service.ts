/**
 * Enhanced Workflow State Service
 *
 * Extends the original WorkflowStateService with DUAL TRIGGER support:
 * - Document Type: Traditional document-based transitions
 * - Email Type: Intent-based transitions (approvals, status updates, etc.)
 *
 * Uses ClassificationOutput directly (direction, emailType, senderCategory already computed)
 *
 * Key improvements over original:
 * 1. Email types (approval_granted, stuffing_update, etc.) can trigger state changes
 * 2. Sender authority validation (who can trigger which states)
 * 3. Subject pattern matching for context (e.g., "SI" in approval_granted → si_approved)
 * 4. Parallel workflow tracking (origin vs destination)
 * 5. Non-document events now affect workflow state
 *
 * Principles:
 * - Configuration Over Code: Rules in workflow-transition-rules.ts
 * - Fail Fast: Invalid transitions are rejected with clear errors
 * - Audit Trail: All transitions logged with trigger details
 * - Single Responsibility: This service only handles state transitions
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  WORKFLOW_TRANSITION_RULES,
  WorkflowTransitionRule,
  WorkflowPhase,
  getStateByCode,
  getStateOrder,
  isStateAfter,
  isSenderAuthorized,
} from '../config/workflow-transition-rules';
import { EmailType, SenderCategory } from '../config/email-type-config';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Input for workflow transition from classification output.
 * All fields come directly from ClassificationOutput.
 */
export interface WorkflowTransitionInput {
  /** Shipment to transition */
  shipmentId: string;

  /** Document type from classification (e.g., 'booking_confirmation') */
  documentType: string;

  /** Email type from classification (e.g., 'approval_granted', 'stuffing_update') */
  emailType: EmailType;

  /** Direction from classification - ALREADY COMPUTED by ClassificationOrchestrator */
  direction: 'inbound' | 'outbound';

  /** Sender category from classification - ALREADY COMPUTED */
  senderCategory: SenderCategory;

  /** Email ID for audit trail */
  emailId: string;

  /** Email subject for pattern matching (approval context) */
  subject: string;

  /** Optional: Force transition even if prerequisites not met */
  forceTransition?: boolean;
}

/**
 * Result of a workflow transition attempt
 */
export interface WorkflowTransitionResult {
  /** Whether transition was successful */
  success: boolean;

  /** Previous workflow state */
  previousState: string | null;

  /** New workflow state (null if no transition) */
  newState: string | null;

  /** What triggered the transition */
  triggeredBy: 'document' | 'email' | 'both' | 'none';

  /** Reason for skipping (if success is false) */
  skippedReason?: string;

  /** Transition ID for audit (if successful) */
  transitionId?: string;

  /** Parallel workflow updates (if any) */
  parallelUpdates?: {
    originState?: string;
    destinationState?: string;
  };
}

/**
 * Extended workflow history record with email type tracking
 */
export interface EnhancedWorkflowHistoryRecord {
  id: string;
  shipment_id: string;
  from_state: string | null;
  to_state: string;
  triggered_by_document_type: string | null;
  triggered_by_email_type: string | null;
  triggered_by_email_id: string | null;
  sender_category: string | null;
  trigger_type: 'document' | 'email' | 'both';
  direction: 'inbound' | 'outbound';
  transition_notes: string | null;
  created_at: string;
}

// =============================================================================
// ENHANCED WORKFLOW STATE SERVICE
// =============================================================================

export class EnhancedWorkflowStateService {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Primary method: Transition workflow based on ClassificationOutput.
   *
   * Uses DUAL TRIGGER logic:
   * 1. Find rules matching document type OR email type (with direction)
   * 2. Validate sender authority
   * 3. Check prerequisites
   * 4. Execute transition to highest-order valid state
   *
   * @param input - Classification output + shipment context
   * @returns Transition result with details
   */
  async transitionFromClassification(
    input: WorkflowTransitionInput
  ): Promise<WorkflowTransitionResult> {
    const {
      shipmentId,
      documentType,
      emailType,
      direction,
      senderCategory,
      emailId,
      subject,
      forceTransition = false,
    } = input;

    // 1. Get current shipment state
    const currentState = await this.getCurrentState(shipmentId);

    // 2. Find ALL matching transition rules
    const matchingRules = this.findMatchingRules({
      documentType,
      emailType,
      direction,
      subject,
    });

    if (matchingRules.length === 0) {
      return {
        success: false,
        previousState: currentState,
        newState: null,
        triggeredBy: 'none',
        skippedReason: `No workflow rules match: docType=${documentType}, emailType=${emailType}, direction=${direction}`,
      };
    }

    // 3. Filter by sender authority
    const authorizedRules = matchingRules.filter(rule =>
      this.validateSenderAuthority(rule, senderCategory)
    );

    if (authorizedRules.length === 0) {
      return {
        success: false,
        previousState: currentState,
        newState: null,
        triggeredBy: 'none',
        skippedReason: `Sender '${senderCategory}' not authorized. Matched rules require: ${[...new Set(matchingRules.flatMap(r => r.triggers.allowedSenderCategories || []))].join(', ')}`,
      };
    }

    // 4. Filter by prerequisites and forward progression
    const validRules = await this.filterByPrerequisitesAndOrder(
      shipmentId,
      currentState,
      authorizedRules,
      forceTransition
    );

    if (validRules.length === 0) {
      return {
        success: false,
        previousState: currentState,
        newState: null,
        triggeredBy: 'none',
        skippedReason: `No valid forward transitions. Current state: ${currentState || 'none'}. Matched states: ${authorizedRules.map(r => r.state).join(', ')}`,
      };
    }

    // 5. Select the best target state (highest order among valid)
    const targetRule = validRules.sort((a, b) => b.order - a.order)[0];

    // 6. Determine trigger type
    const triggeredBy = this.determineTriggerType(targetRule, documentType, emailType);

    // 7. Execute transition
    const result = await this.executeTransition({
      shipmentId,
      fromState: currentState,
      toState: targetRule.state,
      phase: targetRule.phase,
      documentType,
      emailType,
      emailId,
      senderCategory,
      direction,
      triggeredBy,
      notes: this.buildTransitionNotes(targetRule, documentType, emailType, direction),
    });

    // 8. Handle parallel workflow updates (if applicable)
    const parallelUpdates = await this.updateParallelWorkflows(
      shipmentId,
      targetRule,
      direction
    );

    return {
      success: result.success,
      previousState: currentState,
      newState: result.success ? targetRule.state : null,
      triggeredBy,
      transitionId: result.transitionId,
      skippedReason: result.error,
      parallelUpdates,
    };
  }

  /**
   * Find rules that match the input (document type OR email type).
   * Both must match the direction.
   */
  private findMatchingRules(input: {
    documentType: string;
    emailType: EmailType;
    direction: 'inbound' | 'outbound';
    subject: string;
  }): WorkflowTransitionRule[] {
    const { documentType, emailType, direction, subject } = input;
    const subjectLower = subject.toLowerCase();

    return WORKFLOW_TRANSITION_RULES.filter(rule => {
      // Direction must match
      if (rule.triggers.direction !== direction) {
        return false;
      }

      // Check document type match
      const docMatch = rule.triggers.documentTypes?.includes(documentType) ?? false;

      // Check email type match
      let emailMatch = rule.triggers.emailTypes?.includes(emailType) ?? false;

      // For email type matches, also check subject patterns if defined
      if (emailMatch && rule.triggers.emailSubjectPatterns) {
        // Subject must contain at least one of the patterns
        emailMatch = rule.triggers.emailSubjectPatterns.some(pattern =>
          subjectLower.includes(pattern.toLowerCase())
        );
      }

      // Match if EITHER document OR email matches
      return docMatch || emailMatch;
    });
  }

  /**
   * Validate that sender category is authorized to trigger this state.
   */
  private validateSenderAuthority(
    rule: WorkflowTransitionRule,
    senderCategory: SenderCategory
  ): boolean {
    // If no sender restrictions, allow all
    if (!rule.triggers.allowedSenderCategories || rule.triggers.allowedSenderCategories.length === 0) {
      return true;
    }
    return rule.triggers.allowedSenderCategories.includes(senderCategory);
  }

  /**
   * Filter rules by prerequisites and forward-only progression.
   */
  private async filterByPrerequisitesAndOrder(
    shipmentId: string,
    currentState: string | null,
    rules: WorkflowTransitionRule[],
    forceTransition: boolean
  ): Promise<WorkflowTransitionRule[]> {
    const currentOrder = currentState ? getStateOrder(currentState) : 0;

    // Get workflow history for prerequisite checking
    const history = await this.getReachedStates(shipmentId);

    return rules.filter(rule => {
      // Forward progression only (unless forced)
      if (!forceTransition && rule.order <= currentOrder) {
        return false;
      }

      // Check prerequisites (unless parallel/optional state)
      if (!forceTransition && !rule.isParallel && rule.prerequisites && rule.prerequisites.length > 0) {
        const hasAllPrereqs = rule.prerequisites.every(prereq => history.has(prereq));
        if (!hasAllPrereqs) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Determine what triggered the transition (document, email, or both).
   */
  private determineTriggerType(
    rule: WorkflowTransitionRule,
    documentType: string,
    emailType: EmailType
  ): 'document' | 'email' | 'both' {
    const docMatch = rule.triggers.documentTypes?.includes(documentType) ?? false;
    const emailMatch = rule.triggers.emailTypes?.includes(emailType) ?? false;

    if (docMatch && emailMatch) {
      return 'both';
    } else if (docMatch) {
      return 'document';
    } else {
      return 'email';
    }
  }

  /**
   * Execute the actual state transition.
   */
  private async executeTransition(params: {
    shipmentId: string;
    fromState: string | null;
    toState: string;
    phase: WorkflowPhase;
    documentType: string;
    emailType: EmailType;
    emailId: string;
    senderCategory: SenderCategory;
    direction: 'inbound' | 'outbound';
    triggeredBy: 'document' | 'email' | 'both';
    notes: string;
  }): Promise<{ success: boolean; transitionId?: string; error?: string }> {
    const {
      shipmentId,
      fromState,
      toState,
      phase,
      documentType,
      emailType,
      emailId,
      senderCategory,
      direction,
      triggeredBy,
      notes,
    } = params;

    try {
      // 1. Create transition history record
      const { data: transition, error: historyError } = await this.supabase
        .from('shipment_workflow_history')
        .insert({
          shipment_id: shipmentId,
          from_state: fromState,
          to_state: toState,
          triggered_by_document_type: triggeredBy === 'email' ? null : documentType,
          triggered_by_email_id: emailId,
          // New columns for enhanced tracking
          email_type: emailType !== 'unknown' ? emailType : null,
          sender_category: senderCategory !== 'unknown' ? senderCategory : null,
          trigger_type: triggeredBy,
          email_direction: direction,
          transition_notes: notes,
        })
        .select('id')
        .single();

      if (historyError) {
        // If new columns don't exist yet, fall back to basic insert
        if (historyError.message.includes('column') && historyError.message.includes('does not exist')) {
          const { data: fallbackTransition, error: fallbackError } = await this.supabase
            .from('shipment_workflow_history')
            .insert({
              shipment_id: shipmentId,
              from_state: fromState,
              to_state: toState,
              triggered_by_document_type: documentType,
              triggered_by_email_id: emailId,
              transition_notes: `${notes} [email_type=${emailType}, sender=${senderCategory}, trigger=${triggeredBy}]`,
            })
            .select('id')
            .single();

          if (fallbackError) {
            return { success: false, error: `Failed to create transition record: ${fallbackError.message}` };
          }

          // Continue with shipment update using fallback transition ID
          return await this.updateShipmentState(shipmentId, toState, phase, fallbackTransition?.id);
        }

        return { success: false, error: `Failed to create transition record: ${historyError.message}` };
      }

      // 2. Update shipment state
      return await this.updateShipmentState(shipmentId, toState, phase, transition?.id);
    } catch (error) {
      return {
        success: false,
        error: `Transition failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Update shipment workflow state.
   */
  private async updateShipmentState(
    shipmentId: string,
    toState: string,
    phase: WorkflowPhase,
    transitionId?: string
  ): Promise<{ success: boolean; transitionId?: string; error?: string }> {
    const updateData: Record<string, unknown> = {
      workflow_state: toState,
      workflow_phase: phase,
      workflow_state_updated_at: new Date().toISOString(),
    };

    // Special handling for terminal states
    if (toState === 'booking_cancelled') {
      updateData.status = 'cancelled';
    } else if (toState === 'delivered') {
      updateData.status = 'delivered';
    }

    const { error: updateError } = await this.supabase
      .from('shipments')
      .update(updateData)
      .eq('id', shipmentId);

    if (updateError) {
      return { success: false, error: `Failed to update shipment: ${updateError.message}` };
    }

    return { success: true, transitionId };
  }

  /**
   * Update parallel workflow states (origin/destination).
   */
  private async updateParallelWorkflows(
    shipmentId: string,
    rule: WorkflowTransitionRule,
    direction: 'inbound' | 'outbound'
  ): Promise<{ originState?: string; destinationState?: string } | undefined> {
    // Parallel states don't update the main workflow
    if (!rule.isParallel) {
      return undefined;
    }

    // Determine which parallel workflow to update based on phase
    const isOriginState = ['stuffing_started', 'stuffing_complete', 'gate_in_complete', 'handover_complete'].includes(rule.state);
    const isDestinationState = ['clearance_started', 'customs_cleared', 'delivery_scheduled'].includes(rule.state);

    const updates: Record<string, unknown> = {};
    const result: { originState?: string; destinationState?: string } = {};

    if (isOriginState) {
      updates.origin_workflow_state = rule.state;
      updates.origin_workflow_updated_at = new Date().toISOString();
      result.originState = rule.state;
    }

    if (isDestinationState) {
      updates.destination_workflow_state = rule.state;
      updates.destination_workflow_updated_at = new Date().toISOString();
      result.destinationState = rule.state;
    }

    if (Object.keys(updates).length > 0) {
      // Try to update, but don't fail if columns don't exist yet
      try {
        await this.supabase
          .from('shipments')
          .update(updates)
          .eq('id', shipmentId);
      } catch {
        // Columns may not exist yet - that's OK
      }
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  /**
   * Get current workflow state for a shipment.
   */
  private async getCurrentState(shipmentId: string): Promise<string | null> {
    const { data: shipment, error } = await this.supabase
      .from('shipments')
      .select('workflow_state')
      .eq('id', shipmentId)
      .single();

    if (error) {
      throw new Error(`Failed to get shipment: ${error.message}`);
    }

    return shipment?.workflow_state || null;
  }

  /**
   * Get set of states that have been reached (for prerequisite checking).
   */
  private async getReachedStates(shipmentId: string): Promise<Set<string>> {
    const { data: history, error } = await this.supabase
      .from('shipment_workflow_history')
      .select('to_state')
      .eq('shipment_id', shipmentId);

    if (error) {
      return new Set();
    }

    const states = new Set<string>();
    for (const record of history || []) {
      if (record.to_state) {
        states.add(record.to_state);
      }
    }

    return states;
  }

  /**
   * Build transition notes for audit trail.
   */
  private buildTransitionNotes(
    rule: WorkflowTransitionRule,
    documentType: string,
    emailType: EmailType,
    direction: 'inbound' | 'outbound'
  ): string {
    const triggers: string[] = [];

    if (rule.triggers.documentTypes?.includes(documentType)) {
      triggers.push(`doc:${documentType}`);
    }

    if (rule.triggers.emailTypes?.includes(emailType)) {
      triggers.push(`email:${emailType}`);
    }

    return `Auto-transitioned to ${rule.state} via ${triggers.join(' + ')} (${direction})`;
  }

  // ===========================================================================
  // PUBLIC UTILITY METHODS
  // ===========================================================================

  /**
   * Get workflow history with enhanced details.
   */
  async getEnhancedWorkflowHistory(shipmentId: string): Promise<EnhancedWorkflowHistoryRecord[]> {
    const { data, error } = await this.supabase
      .from('shipment_workflow_history')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Failed to fetch workflow history: ${error.message}`);
    }

    return (data || []) as EnhancedWorkflowHistoryRecord[];
  }

  /**
   * Get current workflow status with parallel states.
   */
  async getEnhancedWorkflowStatus(shipmentId: string): Promise<{
    currentState: string | null;
    currentPhase: WorkflowPhase | null;
    originState: string | null;
    destinationState: string | null;
    progressPercentage: number;
    isComplete: boolean;
    nextPossibleStates: string[];
  }> {
    const { data: shipment, error } = await this.supabase
      .from('shipments')
      .select('workflow_state, workflow_phase, origin_workflow_state, destination_workflow_state')
      .eq('id', shipmentId)
      .single();

    if (error) {
      throw new Error(`Shipment not found: ${shipmentId}`);
    }

    const currentState = shipment?.workflow_state || null;
    const currentOrder = currentState ? getStateOrder(currentState) : 0;

    // Calculate progress (0-155 range based on order)
    const progress = currentOrder > 0 ? Math.round((currentOrder / 155) * 100) : 0;

    // Find possible next states
    const reachedStates = await this.getReachedStates(shipmentId);
    const nextStates = WORKFLOW_TRANSITION_RULES
      .filter(rule => {
        if (rule.order <= currentOrder) return false;
        if (rule.prerequisites) {
          return rule.prerequisites.every(p => reachedStates.has(p));
        }
        return true;
      })
      .map(r => r.state);

    return {
      currentState,
      currentPhase: (shipment?.workflow_phase as WorkflowPhase) || null,
      originState: shipment?.origin_workflow_state || null,
      destinationState: shipment?.destination_workflow_state || null,
      progressPercentage: Math.min(progress, 100),
      isComplete: currentState === 'delivered' || currentState === 'booking_cancelled',
      nextPossibleStates: [...new Set(nextStates)],
    };
  }

  /**
   * Check if a specific email type + subject would trigger a transition.
   * Useful for preview/debugging.
   */
  wouldTriggerTransition(input: {
    currentState: string | null;
    documentType: string;
    emailType: EmailType;
    direction: 'inbound' | 'outbound';
    senderCategory: SenderCategory;
    subject: string;
  }): { wouldTrigger: boolean; targetState: string | null; reason: string } {
    const { currentState, documentType, emailType, direction, senderCategory, subject } = input;
    const currentOrder = currentState ? getStateOrder(currentState) : 0;

    // Find matching rules
    const matchingRules = this.findMatchingRules({ documentType, emailType, direction, subject });

    if (matchingRules.length === 0) {
      return { wouldTrigger: false, targetState: null, reason: 'No matching rules' };
    }

    // Check authority
    const authorizedRules = matchingRules.filter(r => this.validateSenderAuthority(r, senderCategory));
    if (authorizedRules.length === 0) {
      return { wouldTrigger: false, targetState: null, reason: `Sender '${senderCategory}' not authorized` };
    }

    // Check forward progression
    const forwardRules = authorizedRules.filter(r => r.order > currentOrder);
    if (forwardRules.length === 0) {
      return { wouldTrigger: false, targetState: null, reason: 'No forward progression available' };
    }

    const bestRule = forwardRules.sort((a, b) => b.order - a.order)[0];
    return { wouldTrigger: true, targetState: bestRule.state, reason: `Would transition to ${bestRule.state}` };
  }
}

// =============================================================================
// FACTORY
// =============================================================================

/**
 * Create an EnhancedWorkflowStateService instance.
 */
export function createEnhancedWorkflowStateService(
  supabase: SupabaseClient
): EnhancedWorkflowStateService {
  return new EnhancedWorkflowStateService(supabase);
}
