'use client';

import { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Circle,
  Clock,
  Ship,
  Anchor,
  Truck,
  FileText,
  AlertCircle,
} from 'lucide-react';

export interface WorkflowStateInfo {
  state_code: string;
  state_name: string;
  state_order: number;
  phase: string;
  is_completed: boolean;
  is_current: boolean;
  is_skipped: boolean;  // Document not received but state passed
  required_doc_types: string[];
  completed_at?: string;
}

export interface WorkflowProgressProps {
  shipmentId: string;
  currentState?: string;
  workflowPhase?: string;
  compact?: boolean;
}

interface WorkflowData {
  current_state: string;
  current_phase: string;
  state_info: {
    state_name: string;
    state_order: number;
    phase: string;
  };
  history: Array<{
    from_state: string;
    to_state: string;
    transitioned_at: string;
    notes?: string;
  }>;
  valid_transitions: string[];
}

const PHASES = [
  { key: 'pre_departure', label: 'Pre-Departure', icon: FileText, color: 'blue' },
  { key: 'in_transit', label: 'In Transit', icon: Ship, color: 'yellow' },
  { key: 'arrival', label: 'Arrival', icon: Anchor, color: 'purple' },
  { key: 'delivery', label: 'Delivery', icon: Truck, color: 'green' },
];

// Map workflow states to required document types
// Simplified workflow focused on document receipt milestones
const WORKFLOW_STATES: WorkflowStateInfo[] = [
  // Pre-Departure (documents received before vessel sails)
  { state_code: 'booking_confirmed', state_name: 'Booking Confirmed', state_order: 10, phase: 'pre_departure', is_completed: false, is_current: false, is_skipped: false, required_doc_types: ['booking_confirmation', 'booking_amendment'] },
  { state_code: 'invoice_received', state_name: 'Invoice Received', state_order: 20, phase: 'pre_departure', is_completed: false, is_current: false, is_skipped: false, required_doc_types: ['invoice', 'commercial_invoice', 'freight_invoice'] },
  { state_code: 'si_submitted', state_name: 'SI Submitted', state_order: 30, phase: 'pre_departure', is_completed: false, is_current: false, is_skipped: false, required_doc_types: ['shipping_instruction', 'si_draft', 'si_submission'] },
  { state_code: 'bl_draft_received', state_name: 'BL Draft Received', state_order: 40, phase: 'pre_departure', is_completed: false, is_current: false, is_skipped: false, required_doc_types: ['bill_of_lading', 'house_bl', 'bl_draft'] },
  // In Transit (vessel departed)
  { state_code: 'vessel_departed', state_name: 'Vessel Departed', state_order: 50, phase: 'in_transit', is_completed: false, is_current: false, is_skipped: false, required_doc_types: ['vessel_schedule', 'cargo_manifest'] },
  { state_code: 'bl_released', state_name: 'BL Released', state_order: 60, phase: 'in_transit', is_completed: false, is_current: false, is_skipped: false, required_doc_types: ['bl_released', 'telex_release'] },
  // Arrival (vessel arrived at destination)
  { state_code: 'arrival_notice_received', state_name: 'Arrival Notice', state_order: 70, phase: 'arrival', is_completed: false, is_current: false, is_skipped: false, required_doc_types: ['arrival_notice'] },
  { state_code: 'customs_cleared', state_name: 'Customs Cleared', state_order: 80, phase: 'arrival', is_completed: false, is_current: false, is_skipped: false, required_doc_types: ['customs_document', 'customs_clearance'] },
  { state_code: 'cargo_released', state_name: 'Cargo Released', state_order: 90, phase: 'arrival', is_completed: false, is_current: false, is_skipped: false, required_doc_types: ['delivery_order', 'container_release'] },
  // Delivery
  { state_code: 'pod_received', state_name: 'POD Received', state_order: 100, phase: 'delivery', is_completed: false, is_current: false, is_skipped: false, required_doc_types: ['proof_of_delivery', 'pod_confirmation'] },
];

export function ShipmentWorkflowProgress({ shipmentId, currentState, workflowPhase, compact = false }: WorkflowProgressProps) {
  const [workflowData, setWorkflowData] = useState<WorkflowData | null>(null);
  const [documentsReceived, setDocumentsReceived] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchWorkflowData();
  }, [shipmentId]);

  const fetchWorkflowData = async () => {
    try {
      // Fetch both workflow data and documents in parallel
      const [workflowRes, shipmentRes] = await Promise.all([
        fetch(`/api/shipments/${shipmentId}/workflow`),
        fetch(`/api/shipments/${shipmentId}`),
      ]);

      if (workflowRes.ok) {
        const data = await workflowRes.json();
        setWorkflowData(data);
      }

      // Get document types actually received
      if (shipmentRes.ok) {
        const shipmentData = await shipmentRes.json();
        const docTypes = (shipmentData.documents || []).map((d: any) => d.document_type);
        setDocumentsReceived(docTypes);
      }
    } catch (err) {
      setError('Failed to load workflow');
    } finally {
      setLoading(false);
    }
  };

  const activeState = workflowData?.current_state || currentState;

  // Determine active phase: use workflow data, prop, or infer from documents
  const inferPhaseFromDocuments = (): string => {
    if (documentsReceived.includes('arrival_notice')) return 'arrival';
    if (documentsReceived.includes('bill_of_lading') || documentsReceived.includes('house_bl')) return 'in_transit';
    return 'pre_departure';
  };
  const activePhase = workflowData?.current_phase || workflowPhase || inferPhaseFromDocuments();

  // Calculate completed states based on current state order
  const currentStateInfo = WORKFLOW_STATES.find(s => s.state_code === activeState);
  const currentOrder = currentStateInfo?.state_order || 0;

  // Check if a state's required document was actually received
  const hasRequiredDocument = (state: WorkflowStateInfo): boolean => {
    if (state.required_doc_types.length === 0) return false; // No doc required means we can't auto-complete
    return state.required_doc_types.some(docType => documentsReceived.includes(docType));
  };

  // Calculate states with proper status
  // NEW LOGIC: Mark states as completed if:
  // 1. Required document was received (regardless of workflow_state), OR
  // 2. State is before current workflow_state (if workflow_state is set)
  const statesWithStatus = WORKFLOW_STATES.map(state => {
    const hasDoc = hasRequiredDocument(state);
    const isBeforeCurrentState = currentOrder > 0 && state.state_order < currentOrder;

    // Completed if: we have the document OR workflow_state says we passed this state
    const isCompleted = hasDoc || isBeforeCurrentState;
    const isCurrent = state.state_code === activeState;

    // Skipped = state is "completed" by workflow order but required document not received
    // Only applies when we pass states without receiving documents
    const isSkipped = isBeforeCurrentState && state.required_doc_types.length > 0 && !hasDoc;

    return {
      ...state,
      is_completed: isCompleted && !isSkipped,
      is_current: isCurrent,
      is_skipped: isSkipped,
    };
  });

  // Count skipped states for summary
  const skippedCount = statesWithStatus.filter(s => s.is_skipped).length;

  // Group states by phase
  const statesByPhase = PHASES.map(phase => ({
    ...phase,
    states: statesWithStatus.filter(s => s.phase === phase.key),
    isActive: phase.key === activePhase,
    isCompleted: statesWithStatus
      .filter(s => s.phase === phase.key)
      .every(s => s.is_completed),
    hasSkipped: statesWithStatus
      .filter(s => s.phase === phase.key)
      .some(s => s.is_skipped),
  }));

  if (loading) {
    return (
      <div className="bg-terminal-surface rounded-lg border border-terminal-border p-6">
        <div className="animate-pulse flex space-x-4">
          <div className="flex-1 space-y-4 py-1">
            <div className="h-4 bg-terminal-elevated rounded w-3/4"></div>
            <div className="space-y-2">
              <div className="h-4 bg-terminal-elevated rounded"></div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (compact) {
    return <CompactWorkflowProgress phases={statesByPhase} currentState={activeState} />;
  }

  return (
    <div className="bg-terminal-surface rounded-lg border border-terminal-border p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-terminal-text">Workflow Progress</h2>
          {skippedCount > 0 && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-terminal-amber/20 text-terminal-amber rounded-full border border-terminal-amber/30">
              <AlertCircle className="h-3 w-3" />
              {skippedCount} doc{skippedCount !== 1 ? 's' : ''} missing
            </span>
          )}
        </div>
        {activeState && (
          <span className="px-3 py-1 text-sm font-mono bg-terminal-blue/20 text-terminal-blue rounded-full border border-terminal-blue/30">
            {currentStateInfo?.state_name || activeState.replace(/_/g, ' ')}
          </span>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-6 text-xs text-terminal-muted font-mono">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-terminal-green"></div>
          <span>Completed</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-terminal-blue"></div>
          <span>Current</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-terminal-amber"></div>
          <span>Skipped (doc missing)</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded-full bg-terminal-muted"></div>
          <span>Pending</span>
        </div>
      </div>

      {/* Phase Progress Bar */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          {statesByPhase.map((phase, idx) => {
            const PhaseIcon = phase.icon;
            const isLast = idx === statesByPhase.length - 1;
            const completedStates = phase.states.filter(s => s.is_completed || s.is_current).length;
            const totalStates = phase.states.length;
            const progress = totalStates > 0 ? (completedStates / totalStates) * 100 : 0;

            return (
              <div key={phase.key} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div
                    className={`
                      w-12 h-12 rounded-full flex items-center justify-center
                      ${phase.hasSkipped
                        ? 'bg-terminal-amber/20 text-terminal-amber'
                        : phase.isCompleted
                          ? 'bg-terminal-green/20 text-terminal-green'
                          : phase.isActive
                            ? 'bg-terminal-blue/20 text-terminal-blue'
                            : 'bg-terminal-elevated text-terminal-muted'
                      }
                    `}
                  >
                    {phase.hasSkipped ? (
                      <AlertCircle className="h-6 w-6" />
                    ) : phase.isCompleted ? (
                      <CheckCircle2 className="h-6 w-6" />
                    ) : (
                      <PhaseIcon className="h-6 w-6" />
                    )}
                  </div>
                  <span
                    className={`
                      mt-2 text-xs font-medium font-mono
                      ${phase.isCompleted || phase.isActive ? 'text-terminal-text' : 'text-terminal-muted'}
                    `}
                  >
                    {phase.label}
                  </span>
                  <span className="text-xs text-terminal-muted font-mono">
                    {completedStates}/{totalStates}
                  </span>
                </div>

                {!isLast && (
                  <div className="flex-1 h-1 mx-4 bg-terminal-elevated rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 ${
                        phase.isCompleted ? 'bg-terminal-green' : 'bg-terminal-blue'
                      }`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Detailed State List */}
      <div className="space-y-4">
        {statesByPhase.map((phase) => (
          <div
            key={phase.key}
            className={`
              border rounded-lg p-4
              ${phase.isActive ? 'border-terminal-blue/50 bg-terminal-blue/10' : 'border-terminal-border bg-terminal-elevated'}
            `}
          >
            <div className="flex items-center gap-2 mb-3">
              <phase.icon className={`h-4 w-4 ${phase.isActive ? 'text-terminal-blue' : 'text-terminal-muted'}`} />
              <span className={`text-sm font-medium font-mono ${phase.isActive ? 'text-terminal-blue' : 'text-terminal-text'}`}>
                {phase.label}
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {phase.states.map((state) => (
                <div
                  key={state.state_code}
                  className={`
                    flex items-center gap-2 px-3 py-2 rounded-md text-sm font-mono
                    ${state.is_current
                      ? 'bg-terminal-blue text-terminal-bg'
                      : state.is_skipped
                        ? 'bg-terminal-amber/20 text-terminal-amber border border-terminal-amber/30'
                        : state.is_completed
                          ? 'bg-terminal-green/20 text-terminal-green'
                          : 'bg-terminal-surface text-terminal-muted'
                    }
                  `}
                  title={state.is_skipped ? `Missing: ${state.required_doc_types.join(', ')}` : undefined}
                >
                  {state.is_skipped ? (
                    <AlertCircle className="h-4 w-4 flex-shrink-0" />
                  ) : state.is_completed ? (
                    <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
                  ) : state.is_current ? (
                    <Clock className="h-4 w-4 flex-shrink-0 animate-pulse" />
                  ) : (
                    <Circle className="h-4 w-4 flex-shrink-0" />
                  )}
                  <span className="truncate">{state.state_name}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* History Section */}
      {workflowData?.history && workflowData.history.length > 0 && (
        <div className="mt-6 pt-6 border-t border-terminal-border">
          <h3 className="text-sm font-medium text-terminal-text mb-3 font-mono">Recent Transitions</h3>
          <div className="space-y-2">
            {workflowData.history.slice(0, 5).map((transition, idx) => (
              <div key={idx} className="flex items-center gap-2 text-sm text-terminal-muted font-mono">
                <span className="w-24 text-xs text-terminal-muted">
                  {new Date(transition.transitioned_at).toLocaleDateString()}
                </span>
                <span className="text-terminal-muted">{transition.from_state?.replace(/_/g, ' ') || 'Start'}</span>
                <span className="text-terminal-blue">→</span>
                <span className="font-medium text-terminal-text">{transition.to_state.replace(/_/g, ' ')}</span>
                {transition.notes && (
                  <span className="text-xs text-terminal-muted">({transition.notes})</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CompactWorkflowProgress({
  phases,
  currentState,
}: {
  phases: Array<{
    key: string;
    label: string;
    icon: any;
    color: string;
    states: WorkflowStateInfo[];
    isActive: boolean;
    isCompleted: boolean;
  }>;
  currentState?: string;
}) {
  const currentStateInfo = WORKFLOW_STATES.find(s => s.state_code === currentState);

  return (
    <div className="flex items-center gap-3">
      {phases.map((phase, idx) => {
        const isLast = idx === phases.length - 1;
        const completedStates = phase.states.filter(s => s.is_completed || s.is_current).length;
        const totalStates = phase.states.length;

        return (
          <div key={phase.key} className="flex items-center">
            <div
              className={`
                w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium font-mono
                ${phase.isCompleted
                  ? 'bg-terminal-green text-terminal-bg'
                  : phase.isActive
                    ? 'bg-terminal-blue text-terminal-bg'
                    : 'bg-terminal-elevated text-terminal-muted'
                }
              `}
              title={`${phase.label}: ${completedStates}/${totalStates}`}
            >
              {phase.isCompleted ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                completedStates
              )}
            </div>
            {!isLast && (
              <div className={`w-8 h-0.5 ${phase.isCompleted ? 'bg-terminal-green' : 'bg-terminal-elevated'}`} />
            )}
          </div>
        );
      })}
      {currentStateInfo && (
        <span className="ml-2 text-xs text-terminal-muted truncate max-w-[150px] font-mono">
          {currentStateInfo.state_name}
        </span>
      )}
    </div>
  );
}

export { CompactWorkflowProgress, ShipmentWorkflowProgress as default };
