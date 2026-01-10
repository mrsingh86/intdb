'use client';

import { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Circle,
  Ship,
  Anchor,
  Truck,
  Package,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Clock,
} from 'lucide-react';

// Simple utility for combining class names
const cn = (...classes: (string | boolean | undefined)[]) =>
  classes.filter(Boolean).join(' ');

// =============================================================================
// TYPES
// =============================================================================

interface ChronicleInfo {
  id: string;
  summary: string;
  fromParty: string;
  documentType: string;
}

interface AchievedState {
  state: string;
  label: string;
  order: number;
  achieved: true;
  achievedAt: string;
  chronicle: ChronicleInfo;
}

interface PendingState {
  state: string;
  label: string;
  order: number;
  achieved: false;
}

type JourneyState = AchievedState | PendingState;

interface PhaseJourney {
  phase: string;
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

interface JourneyData {
  shipmentId: string;
  currentState: string | null;
  currentPhase: string | null;
  currentOrder: number;
  maxOrder: number;
  journey: PhaseJourney[];
  pendingActions: PendingAction[];
  issues: Issue[];
}

export interface JourneyTimelineProps {
  shipmentId: string;
  compact?: boolean;
}

// =============================================================================
// PHASE ICONS & COLORS
// =============================================================================

const PHASE_CONFIG: Record<string, { icon: typeof Ship; color: string; bgColor: string }> = {
  pre_shipment: { icon: Package, color: 'text-blue-600', bgColor: 'bg-blue-100' },
  in_transit: { icon: Ship, color: 'text-amber-600', bgColor: 'bg-amber-100' },
  arrival: { icon: Anchor, color: 'text-purple-600', bgColor: 'bg-purple-100' },
  delivery: { icon: Truck, color: 'text-green-600', bgColor: 'bg-green-100' },
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function JourneyTimeline({ shipmentId, compact = false }: JourneyTimelineProps) {
  const [data, setData] = useState<JourneyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPhases, setExpandedPhases] = useState<Set<string>>(new Set(['pre_shipment', 'in_transit']));

  useEffect(() => {
    fetchJourney();
  }, [shipmentId]);

  const fetchJourney = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/shipments/${shipmentId}/journey`);
      if (!response.ok) throw new Error('Failed to fetch journey');
      const journeyData = await response.json();
      setData(journeyData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const togglePhase = (phase: string) => {
    setExpandedPhases((prev) => {
      const next = new Set(prev);
      if (next.has(phase)) {
        next.delete(phase);
      } else {
        next.add(phase);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-4 bg-gray-200 rounded w-1/3"></div>
        <div className="h-20 bg-gray-200 rounded"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-red-600 p-4 bg-red-50 rounded-lg">
        <AlertTriangle className="inline-block w-4 h-4 mr-2" />
        {error}
      </div>
    );
  }

  if (!data) {
    return <div className="text-gray-500">No journey data available</div>;
  }

  const progressPercent = Math.round((data.currentOrder / data.maxOrder) * 100);

  return (
    <div className="space-y-4">
      {/* Progress Header */}
      <JourneyHeader
        currentState={data.currentState}
        currentPhase={data.currentPhase}
        progressPercent={progressPercent}
      />

      {/* Phase Timeline */}
      <div className="space-y-3">
        {data.journey.map((phase) => (
          <PhaseCard
            key={phase.phase}
            phase={phase}
            isExpanded={expandedPhases.has(phase.phase)}
            onToggle={() => togglePhase(phase.phase)}
            compact={compact}
          />
        ))}
      </div>

      {/* Issues & Actions */}
      {(data.issues.length > 0 || data.pendingActions.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          {data.issues.length > 0 && <IssuesCard issues={data.issues} />}
          {data.pendingActions.length > 0 && <ActionsCard actions={data.pendingActions} />}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function JourneyHeader({
  currentState,
  currentPhase,
  progressPercent,
}: {
  currentState: string | null;
  currentPhase: string | null;
  progressPercent: number;
}) {
  const phaseConfig = currentPhase ? PHASE_CONFIG[currentPhase] : null;
  const PhaseIcon = phaseConfig?.icon || Circle;

  return (
    <div className="bg-white border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {phaseConfig && (
            <div className={cn('p-2 rounded-lg', phaseConfig.bgColor)}>
              <PhaseIcon className={cn('w-5 h-5', phaseConfig.color)} />
            </div>
          )}
          <div>
            <div className="text-sm text-gray-500">Current State</div>
            <div className="font-medium">
              {currentState?.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()) ||
                'Not Started'}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold text-gray-900">{progressPercent}%</div>
          <div className="text-xs text-gray-500">Complete</div>
        </div>
      </div>
      {/* Progress Bar */}
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-gradient-to-r from-blue-500 via-amber-500 to-green-500 h-2 rounded-full transition-all duration-500"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}

function PhaseCard({
  phase,
  isExpanded,
  onToggle,
  compact,
}: {
  phase: PhaseJourney;
  isExpanded: boolean;
  onToggle: () => void;
  compact: boolean;
}) {
  const config = PHASE_CONFIG[phase.phase] || PHASE_CONFIG.pre_shipment;
  const PhaseIcon = config.icon;
  const achievedCount = phase.states.filter((s) => s.achieved).length;
  const totalCount = phase.states.length;
  const isComplete = achievedCount === totalCount;
  const hasAchieved = achievedCount > 0;

  return (
    <div className="border rounded-lg overflow-hidden">
      {/* Phase Header */}
      <button
        onClick={onToggle}
        className={cn(
          'w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors',
          isComplete && 'bg-green-50'
        )}
      >
        <div className="flex items-center gap-3">
          <div className={cn('p-1.5 rounded', config.bgColor)}>
            <PhaseIcon className={cn('w-4 h-4', config.color)} />
          </div>
          <span className="font-medium">{phase.label}</span>
          <span className="text-sm text-gray-500">
            {achievedCount}/{totalCount}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isComplete && <CheckCircle2 className="w-4 h-4 text-green-500" />}
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-400" />
          )}
        </div>
      </button>

      {/* States List */}
      {isExpanded && (
        <div className="border-t divide-y">
          {phase.states.map((state) => (
            <StateRow key={state.state} state={state} compact={compact} />
          ))}
        </div>
      )}
    </div>
  );
}

function StateRow({ state, compact }: { state: JourneyState; compact: boolean }) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className={cn('py-2 px-4', state.achieved && 'bg-green-50/50')}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {state.achieved ? (
            <CheckCircle2 className="w-4 h-4 text-green-500" />
          ) : (
            <Circle className="w-4 h-4 text-gray-300" />
          )}
          <span className={cn('text-sm', state.achieved ? 'text-gray-900' : 'text-gray-400')}>
            {state.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {state.achieved && (
            <>
              <span className="text-xs text-gray-500">
                {formatDate(state.achievedAt)}
              </span>
              {!compact && state.chronicle && (
                <button
                  onClick={() => setIsExpanded(!isExpanded)}
                  className="text-xs text-blue-600 hover:text-blue-800"
                >
                  {isExpanded ? 'Hide' : 'Details'}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Chronicle Details */}
      {isExpanded && state.achieved && state.chronicle && (
        <div className="mt-2 ml-6 p-2 bg-gray-50 rounded text-xs">
          <div className="text-gray-600">{state.chronicle.summary}</div>
          <div className="mt-1 text-gray-400">
            From: {formatParty(state.chronicle.fromParty)} •{' '}
            {formatDocType(state.chronicle.documentType)}
          </div>
        </div>
      )}
    </div>
  );
}

function IssuesCard({ issues }: { issues: Issue[] }) {
  return (
    <div className="border border-red-200 rounded-lg p-3 bg-red-50">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-4 h-4 text-red-600" />
        <span className="font-medium text-red-900">Issues ({issues.length})</span>
      </div>
      <ul className="space-y-1">
        {issues.slice(0, 3).map((issue) => (
          <li key={issue.chronicleId} className="text-sm text-red-800">
            <span className="font-medium">{issue.type}:</span> {issue.description || 'No details'}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ActionsCard({ actions }: { actions: PendingAction[] }) {
  return (
    <div className="border border-amber-200 rounded-lg p-3 bg-amber-50">
      <div className="flex items-center gap-2 mb-2">
        <Clock className="w-4 h-4 text-amber-600" />
        <span className="font-medium text-amber-900">Pending Actions ({actions.length})</span>
      </div>
      <ul className="space-y-1">
        {actions.slice(0, 3).map((action) => (
          <li key={action.chronicleId} className="text-sm text-amber-800">
            {action.description}
            {action.priority && (
              <span
                className={cn(
                  'ml-2 px-1.5 py-0.5 rounded text-xs',
                  action.priority === 'critical' && 'bg-red-200 text-red-800',
                  action.priority === 'high' && 'bg-orange-200 text-orange-800',
                  action.priority === 'medium' && 'bg-yellow-200 text-yellow-800',
                  action.priority === 'low' && 'bg-gray-200 text-gray-800'
                )}
              >
                {action.priority}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatParty(party: string): string {
  return party
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

function formatDocType(docType: string): string {
  return docType
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (l) => l.toUpperCase());
}
