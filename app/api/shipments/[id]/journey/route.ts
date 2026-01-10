import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { withAuth } from '@/lib/auth/server-auth';
import {
  WORKFLOW_STATES,
  WORKFLOW_PHASES,
  getWorkflowStateFromDocument,
  WorkflowPhase,
} from '@/lib/config/workflow-states';

// =============================================================================
// TYPES
// =============================================================================

interface ChronicleRecord {
  id: string;
  document_type: string;
  direction: 'inbound' | 'outbound';
  from_party: string;
  summary: string;
  occurred_at: string;
  has_action: boolean;
  action_description: string | null;
  action_priority: string | null;
  has_issue: boolean;
  issue_type: string | null;
  issue_description: string | null;
}

interface AchievedState {
  state: string;
  label: string;
  order: number;
  achieved: true;
  achievedAt: string;
  chronicle: {
    id: string;
    summary: string;
    fromParty: string;
    documentType: string;
  };
}

interface PendingState {
  state: string;
  label: string;
  order: number;
  achieved: false;
}

type JourneyState = AchievedState | PendingState;

interface PhaseJourney {
  phase: WorkflowPhase;
  label: string;
  order: number;
  states: JourneyState[];
}

interface PendingAction {
  chronicleId: string;
  description: string;
  priority: string | null;
  occurredAt: string;
}

interface Issue {
  chronicleId: string;
  type: string;
  description: string | null;
  occurredAt: string;
}

// =============================================================================
// API HANDLER
// =============================================================================

/**
 * GET /api/shipments/[id]/journey
 *
 * Returns the shipment journey timeline derived from Chronicle records.
 * Each Chronicle record is mapped to a workflow state based on document_type + direction.
 */
export const GET = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id: shipmentId } = resolvedParams;
    const supabase = createClient();

    // Fetch all Chronicle records for this shipment
    const { data: chronicles, error } = await supabase
      .from('chronicle')
      .select(
        `id, document_type, direction, from_party, summary, occurred_at,
         has_action, action_description, action_priority,
         has_issue, issue_type, issue_description`
      )
      .eq('shipment_id', shipmentId)
      .order('occurred_at', { ascending: true });

    if (error) {
      throw error;
    }

    // Build the journey from Chronicle records
    const journey = buildJourney(chronicles || []);
    const currentState = findCurrentState(journey);
    const pendingActions = extractPendingActions(chronicles || []);
    const issues = extractIssues(chronicles || []);

    return NextResponse.json({
      shipmentId,
      currentState: currentState?.state || null,
      currentPhase: currentState?.phase || null,
      currentOrder: currentState?.order || 0,
      maxOrder: 240,
      journey,
      pendingActions,
      issues,
    });
  } catch (error) {
    console.error('[Journey API] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch journey' },
      { status: 500 }
    );
  }
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Build journey timeline from Chronicle records
 */
function buildJourney(chronicles: ChronicleRecord[]): PhaseJourney[] {
  // Map chronicles to achieved states
  const achievedStatesMap = new Map<string, AchievedState>();

  for (const chronicle of chronicles) {
    const workflowState = getWorkflowStateFromDocument(
      chronicle.document_type,
      chronicle.direction as 'inbound' | 'outbound'
    );

    if (!workflowState) continue;

    // Keep earliest achievement (first occurrence)
    if (!achievedStatesMap.has(workflowState.key)) {
      achievedStatesMap.set(workflowState.key, {
        state: workflowState.key,
        label: workflowState.label,
        order: workflowState.order,
        achieved: true,
        achievedAt: chronicle.occurred_at,
        chronicle: {
          id: chronicle.id,
          summary: chronicle.summary,
          fromParty: chronicle.from_party,
          documentType: chronicle.document_type,
        },
      });
    }
  }

  // Build phases with all states (achieved and pending)
  const phases: PhaseJourney[] = WORKFLOW_PHASES.map((phase) => {
    const phaseStates = WORKFLOW_STATES.filter((s) => s.phase === phase.key)
      .sort((a, b) => a.order - b.order)
      .map((state): JourneyState => {
        const achieved = achievedStatesMap.get(state.key);
        if (achieved) {
          return achieved;
        }
        return {
          state: state.key,
          label: state.label,
          order: state.order,
          achieved: false,
        };
      });

    return {
      phase: phase.key,
      label: phase.label,
      order: phase.order,
      states: phaseStates,
    };
  });

  return phases;
}

/**
 * Find the current (highest achieved) state
 */
function findCurrentState(
  journey: PhaseJourney[]
): { state: string; phase: WorkflowPhase; order: number } | null {
  let highest: { state: string; phase: WorkflowPhase; order: number } | null = null;

  for (const phase of journey) {
    for (const state of phase.states) {
      if (state.achieved && (!highest || state.order > highest.order)) {
        highest = {
          state: state.state,
          phase: phase.phase,
          order: state.order,
        };
      }
    }
  }

  return highest;
}

/**
 * Extract pending actions from Chronicle records
 */
function extractPendingActions(chronicles: ChronicleRecord[]): PendingAction[] {
  return chronicles
    .filter((c) => c.has_action && c.action_description)
    .map((c) => ({
      chronicleId: c.id,
      description: c.action_description!,
      priority: c.action_priority,
      occurredAt: c.occurred_at,
    }));
}

/**
 * Extract issues from Chronicle records
 */
function extractIssues(chronicles: ChronicleRecord[]): Issue[] {
  return chronicles
    .filter((c) => c.has_issue && c.issue_type)
    .map((c) => ({
      chronicleId: c.id,
      type: c.issue_type!,
      description: c.issue_description,
      occurredAt: c.occurred_at,
    }));
}
