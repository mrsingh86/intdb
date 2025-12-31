'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Clock,
  Ship,
  ArrowRight,
  CheckCircle,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  Filter,
  Play,
  Check,
  X,
  User,
  Calendar,
  Zap,
  FileWarning,
  AlertCircle,
  Package,
  Anchor,
  Truck,
  Lock,
  XCircle,
  Loader2,
  ExternalLink,
  Lightbulb,
  Mail,
  Phone,
  Send,
  MessageCircle,
  TrendingUp,
  Activity,
} from 'lucide-react';
import {
  ActionTask,
  TaskStatus,
  TaskCategory,
  NotificationPriority,
  UrgencyLevel,
  formatTaskNumber,
  calculateUrgencyLevel,
} from '@/types/intelligence-platform';

// ============================================================================
// TYPES
// ============================================================================

interface TaskWithRelations extends ActionTask {
  template?: { template_code: string; template_name: string };
  shipment?: {
    id: string;
    booking_number: string;
    bl_number?: string;
    vessel_name?: string;
    etd?: string;
    eta?: string;
    status?: string;
    workflow_state?: string;
    port_of_loading?: string;
    port_of_discharge?: string;
  };
  notification?: { id: string; title: string; priority: NotificationPriority };
  urgency_level?: UrgencyLevel;
}

interface DashboardData {
  statistics: {
    total: number;
    byStatus: Record<TaskStatus, number>;
    byPriority: Record<NotificationPriority, number>;
    byCategory: Record<string, number>;
    byUrgency: Record<UrgencyLevel, number>;
    overdue: number;
    dueToday: number;
    dueThisWeek: number;
    completedToday: number;
    avgCompletionTimeHours: number;
  };
  urgentTasks: TaskWithRelations[];
}

interface MissionControlData {
  today: {
    departures: number;
    arrivals: number;
    cutoffsExpiring: number;
  };
  phases: {
    preDeparture: number;
    inTransit: number;
    arrival: number;
    delivered: number;
  };
  cutoffs: {
    siPending: number;
    siTotal: number;
    vgmPending: number;
    vgmTotal: number;
    docsPending: number;
    docsTotal: number;
  };
  journey?: {
    distribution: {
      early: number;
      midway: number;
      advanced: number;
      nearComplete: number;
    };
    awaitingResponse: number;
    shipmentsNeedingAttention: Array<{
      id: string;
      booking_number: string;
      workflow_state: string;
      journey_progress: number;
      days_to_etd: number | null;
    }>;
  };
}

interface Blocker {
  id: string;
  shipment_id: string;
  blocker_type: string;
  blocker_description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  blocked_since: string;
  blocks_workflow_state?: string;
  blocks_document_type?: string;
  is_resolved: boolean;
  shipments?: {
    id: string;
    booking_number: string;
    bl_number?: string;
    vessel_name?: string;
    etd?: string;
  };
}

interface BlockersData {
  blockers: Blocker[];
  summary: {
    total: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
  };
}

interface InsightAction {
  type: 'email' | 'call' | 'task' | 'escalate';
  target: 'shipper' | 'consignee' | 'carrier' | 'internal' | 'customs';
  template?: string;
  urgency: 'immediate' | 'today' | 'soon';
  subject_hint?: string;
}

interface Insight {
  id: string;
  shipment_id: string;
  insight_type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  recommended_action?: string;
  supporting_data?: {
    action?: InsightAction;
    [key: string]: unknown;
  };
  status: string;
  priority_boost: number;
}

interface InsightDraft {
  id: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  body: string;
  urgency: string;
}

// ============================================================================
// CONSTANTS - Terminal/Homebrew Style
// ============================================================================

// Terminal-style status with dot indicators
const PRIORITY_DOT_COLORS: Record<NotificationPriority, string> = {
  critical: 'bg-terminal-red',
  high: 'bg-terminal-amber',
  medium: 'bg-terminal-blue',
  low: 'bg-terminal-muted',
};

const PRIORITY_TEXT_COLORS: Record<NotificationPriority, string> = {
  critical: 'text-terminal-red',
  high: 'text-terminal-amber',
  medium: 'text-terminal-blue',
  low: 'text-terminal-muted',
};

const STATUS_DOT_COLORS: Record<TaskStatus, string> = {
  pending: 'bg-terminal-muted',
  in_progress: 'bg-terminal-blue',
  blocked: 'bg-terminal-red',
  completed: 'bg-terminal-green',
  dismissed: 'bg-gray-400',
  failed: 'bg-terminal-red',
};

const STATUS_TEXT_COLORS: Record<TaskStatus, string> = {
  pending: 'text-terminal-muted',
  in_progress: 'text-terminal-blue',
  blocked: 'text-terminal-red',
  completed: 'text-terminal-green',
  dismissed: 'text-gray-400',
  failed: 'text-terminal-red',
};

const URGENCY_DOT_COLORS: Record<UrgencyLevel, string> = {
  overdue: 'bg-terminal-red animate-pulse',
  immediate: 'bg-terminal-amber animate-pulse',
  today: 'bg-terminal-amber',
  this_week: 'bg-terminal-blue',
  later: 'bg-terminal-muted',
  no_deadline: 'bg-gray-400',
};

const URGENCY_TEXT_COLORS: Record<UrgencyLevel, string> = {
  overdue: 'text-terminal-red',
  immediate: 'text-terminal-amber',
  today: 'text-terminal-amber',
  this_week: 'text-terminal-blue',
  later: 'text-terminal-muted',
  no_deadline: 'text-gray-400',
};

const SEVERITY_DOT_COLORS: Record<string, string> = {
  critical: 'bg-terminal-red animate-pulse',
  high: 'bg-terminal-amber',
  medium: 'bg-terminal-blue',
  low: 'bg-terminal-muted',
};

const SEVERITY_TEXT_COLORS: Record<string, string> = {
  critical: 'text-terminal-red',
  high: 'text-terminal-amber',
  medium: 'text-terminal-blue',
  low: 'text-terminal-muted',
};

const BLOCKER_TYPE_LABELS: Record<string, string> = {
  missing_document: 'Missing Document',
  awaiting_approval: 'Awaiting Approval',
  awaiting_response: 'Awaiting Response',
  customs_hold: 'Customs Hold',
  payment_pending: 'Payment Pending',
  milestone_missed: 'Milestone Missed',
  task_overdue: 'Task Overdue',
  cutoff_passed: 'Cutoff Passed',
  discrepancy_unresolved: 'Discrepancy',
};

const INSIGHT_SEVERITY_DOT_COLORS: Record<string, string> = {
  critical: 'bg-terminal-red',
  high: 'bg-terminal-amber',
  medium: 'bg-terminal-blue',
  low: 'bg-terminal-muted',
};

const ACTION_TYPE_ICONS: Record<string, React.ElementType> = {
  email: Mail,
  call: Phone,
  task: CheckCircle,
  escalate: AlertTriangle,
};

const ACTION_TARGET_LABELS: Record<string, string> = {
  shipper: 'Shipper',
  consignee: 'Consignee',
  carrier: 'Carrier',
  internal: 'Team',
  customs: 'Customs',
};

const CATEGORY_ICONS: Record<TaskCategory, React.ElementType> = {
  deadline: Clock,
  document: CheckCircle,
  notification: AlertCircle,
  compliance: AlertTriangle,
  communication: User,
  financial: Zap,
  operational: Zap,
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function UnifiedMissionControlPage() {
  // State
  const [missionData, setMissionData] = useState<MissionControlData | null>(null);
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [blockersData, setBlockersData] = useState<BlockersData | null>(null);
  const [tasks, setTasks] = useState<TaskWithRelations[]>([]);
  const [selectedTask, setSelectedTask] = useState<TaskWithRelations | null>(null);
  const [taskInsights, setTaskInsights] = useState<Insight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);

  const [loading, setLoading] = useState(true);
  const [blockersLoading, setBlockersLoading] = useState(true);

  const [filters, setFilters] = useState({
    priority: [] as NotificationPriority[],
    category: [] as TaskCategory[],
    status: ['pending', 'in_progress', 'blocked'] as TaskStatus[],
  });

  const [showCutoffs, setShowCutoffs] = useState(false);

  // Fetch functions
  const fetchMissionControl = async () => {
    try {
      const response = await fetch('/api/mission-control');
      if (response.ok) {
        const data = await response.json();
        setMissionData(data);
      }
    } catch (error) {
      console.error('Failed to fetch mission control:', error);
    }
  };

  const fetchBlockers = async () => {
    setBlockersLoading(true);
    try {
      const response = await fetch('/api/blockers?status=active&limit=20');
      if (response.ok) {
        const data = await response.json();
        setBlockersData(data);
      }
    } catch (error) {
      console.error('Failed to fetch blockers:', error);
    } finally {
      setBlockersLoading(false);
    }
  };

  const fetchInsightsForShipment = async (shipmentId: string) => {
    setInsightsLoading(true);
    try {
      const response = await fetch(`/api/insights?shipmentId=${shipmentId}`);
      if (response.ok) {
        const data = await response.json();
        setTaskInsights(data.insights || []);
      }
    } catch (error) {
      console.error('Failed to fetch insights:', error);
      setTaskInsights([]);
    } finally {
      setInsightsLoading(false);
    }
  };

  const fetchDashboard = async () => {
    try {
      const response = await fetch('/api/tasks/dashboard');
      if (response.ok) {
        const data = await response.json();
        setDashboardData(data);
      }
    } catch (error) {
      console.error('Failed to fetch dashboard:', error);
    }
  };

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.priority.length > 0) {
        params.set('priority', filters.priority.join(','));
      }
      if (filters.category.length > 0) {
        params.set('category', filters.category.join(','));
      }
      if (filters.status.length > 0) {
        params.set('status', filters.status.join(','));
      }
      params.set('limit', '50');

      const response = await fetch(`/api/tasks?${params.toString()}`);
      if (response.ok) {
        const result = await response.json();
        setTasks(result.tasks);
      }
    } catch (error) {
      console.error('Failed to fetch tasks:', error);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const refreshAll = () => {
    fetchMissionControl();
    fetchDashboard();
    fetchTasks();
    fetchBlockers();
  };

  useEffect(() => {
    fetchMissionControl();
    fetchDashboard();
    fetchTasks();
    fetchBlockers();
  }, [fetchTasks]);

  // Actions
  const handleTaskAction = async (taskId: string, action: string) => {
    try {
      const response = await fetch(`/api/tasks/${taskId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      if (response.ok) {
        fetchTasks();
        fetchDashboard();
        if (selectedTask?.id === taskId) {
          setSelectedTask(null);
        }
      }
    } catch (error) {
      console.error('Failed to perform action:', error);
    }
  };

  const handleBlockerResolve = async (blockerId: string) => {
    try {
      const response = await fetch('/api/blockers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockerId, action: 'resolve' }),
      });

      if (response.ok) {
        fetchBlockers();
      }
    } catch (error) {
      console.error('Failed to resolve blocker:', error);
    }
  };

  const handleSelectTask = (task: TaskWithRelations | null) => {
    setSelectedTask(task);
    if (task?.shipment?.id) {
      fetchInsightsForShipment(task.shipment.id);
    } else {
      setTaskInsights([]);
    }
  };

  const handleGenerateDraft = async (insight: Insight): Promise<InsightDraft | null> => {
    const action = insight.supporting_data?.action;
    if (!action || !insight.shipment_id) return null;

    try {
      const response = await fetch('/api/insights/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          insightId: insight.id,
          shipmentId: insight.shipment_id,
          action,
          title: insight.title,
          description: insight.description,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        return data.draft;
      }
    } catch (error) {
      console.error('Failed to generate draft:', error);
    }
    return null;
  };

  const togglePriorityFilter = (priority: NotificationPriority) => {
    setFilters(prev => ({
      ...prev,
      priority: prev.priority.includes(priority)
        ? prev.priority.filter(p => p !== priority)
        : [...prev.priority, priority],
    }));
  };

  const toggleCategoryFilter = (category: TaskCategory) => {
    setFilters(prev => ({
      ...prev,
      category: prev.category.includes(category)
        ? prev.category.filter(c => c !== category)
        : [...prev.category, category],
    }));
  };

  const totalShipments = missionData
    ? missionData.phases.preDeparture + missionData.phases.inTransit + missionData.phases.arrival + missionData.phases.delivered
    : 0;

  const activeBlockersCount = blockersData?.summary?.total || 0;
  const criticalBlockersCount = blockersData?.summary?.bySeverity?.critical || 0;

  return (
    <div className="min-h-screen bg-terminal-bg">
      <div className="flex">
        {/* Main Content */}
        <div className={`flex-1 p-6 space-y-5 transition-all ${selectedTask ? 'mr-96' : ''}`}>
          {/* Header - Terminal Style */}
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-terminal-green/20 bg-terminal-green/10 border border-terminal-green/30">
                  <Zap className="h-5 w-5 text-terminal-green" />
                </div>
                <div>
                  <h1 className="text-xl font-semibold text-terminal-text flex items-center gap-2">
                    Mission Control
                    <span className="text-xs font-mono text-terminal-muted">v1.0</span>
                  </h1>
                  <p className="text-xs text-terminal-muted font-mono mt-0.5">
                    ~/orion/command-center
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <ClientTime />
              <button
                onClick={refreshAll}
                className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-terminal-border rounded-lg bg-terminal-surface hover:bg-terminal-elevated text-terminal-text transition-colors"
              >
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {/* Compact Metrics Bar */}
          <div className="grid grid-cols-8 gap-3">
            <CompactMetric
              label="Active Tasks"
              value={dashboardData ? dashboardData.statistics.byStatus.pending + dashboardData.statistics.byStatus.in_progress : 0}
              icon={Zap}
              color="blue"
            />
            <CompactMetric
              label="Blockers"
              value={activeBlockersCount}
              icon={Lock}
              color={criticalBlockersCount > 0 ? 'red' : activeBlockersCount > 0 ? 'orange' : 'green'}
            />
            <CompactMetric
              label="Awaiting Reply"
              value={missionData?.journey?.awaitingResponse || 0}
              icon={MessageCircle}
              color={(missionData?.journey?.awaitingResponse || 0) > 0 ? 'orange' : 'green'}
            />
            <CompactMetric
              label="Overdue"
              value={dashboardData?.statistics.overdue || 0}
              icon={AlertTriangle}
              color={(dashboardData?.statistics.overdue || 0) > 0 ? 'red' : 'green'}
            />
            <CompactMetric
              label="Due Today"
              value={dashboardData?.statistics.dueToday || 0}
              icon={Calendar}
              color={(dashboardData?.statistics.dueToday || 0) > 0 ? 'yellow' : 'green'}
            />
            <CompactMetric
              label="Departures"
              value={missionData?.today.departures || 0}
              icon={Ship}
              color="blue"
            />
            <CompactMetric
              label="Arrivals"
              value={missionData?.today.arrivals || 0}
              icon={Anchor}
              color="green"
            />
            <CompactMetric
              label="Shipments"
              value={totalShipments}
              icon={Package}
              color="purple"
            />
          </div>

          {/* BLOCKERS SECTION - Terminal Style */}
          {(activeBlockersCount > 0 || blockersLoading) && (
            <div className="rounded-lg border border-gray-200 border-terminal-red/50 bg-terminal-surface overflow-hidden">
              <div className="px-4 py-2.5 bg-gray-50 bg-terminal-red/10 border-b border-terminal-border flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-terminal-red animate-pulse" />
                <Lock className="h-4 w-4 text-terminal-red" />
                <span className="font-medium text-terminal-text text-sm">Active Blockers</span>
                <span className="ml-auto text-xs font-mono text-terminal-red">
                  [{activeBlockersCount}] blocking
                </span>
              </div>

              {blockersLoading ? (
                <div className="flex items-center justify-center h-24">
                  <Loader2 className="h-5 w-5 animate-spin text-terminal-muted" />
                </div>
              ) : (
                <div className="divide-y divide-terminal-border max-h-64 overflow-y-auto">
                  {blockersData?.blockers.map((blocker) => (
                    <div
                      key={blocker.id}
                      className="px-4 py-3 hover:bg-terminal-elevated transition flex items-center gap-4"
                    >
                      {/* Severity dot + text */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className={`h-2 w-2 rounded-full ${SEVERITY_DOT_COLORS[blocker.severity]}`} />
                        <span className={`text-xs font-mono uppercase ${SEVERITY_TEXT_COLORS[blocker.severity]}`}>
                          {blocker.severity}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-terminal-text truncate">
                          {blocker.blocker_description}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-terminal-muted mt-1">
                          <span className="font-mono bg-terminal-elevated px-1.5 py-0.5 rounded border border-terminal-border">
                            {BLOCKER_TYPE_LABELS[blocker.blocker_type] || blocker.blocker_type}
                          </span>
                          {blocker.shipments && (
                            <Link
                              href={`/shipments/${blocker.shipments.id}`}
                              className="text-terminal-blue hover:underline flex items-center gap-1 font-mono"
                            >
                              <Ship className="h-3 w-3" />
                              {blocker.shipments.booking_number}
                            </Link>
                          )}
                          <span className="font-mono">
                            {new Date(blocker.blocked_since).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => handleBlockerResolve(blocker.id)}
                        className="px-3 py-1.5 text-xs font-medium text-terminal-green bg-terminal-green/10 border border-terminal-green/30 rounded hover:bg-terminal-green/20 transition-colors"
                      >
                        Resolve
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Journey Progress Section - Terminal Style */}
          {missionData?.journey && (
            <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
              <div className="px-4 py-2.5 bg-terminal-elevated border-b border-terminal-border flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-terminal-blue" />
                <Activity className="h-4 w-4 text-terminal-blue" />
                <span className="font-medium text-terminal-text text-sm">Journey Progress</span>
                <span className="ml-auto text-xs font-mono text-terminal-muted">
                  {totalShipments} active
                </span>
              </div>

              <div className="p-4">
                {/* Progress Distribution Bar - Terminal Style */}
                <div className="mb-4">
                  <div className="flex items-center gap-0.5 h-6 rounded overflow-hidden bg-terminal-bg border border-terminal-border">
                    {missionData.journey.distribution.early > 0 && (
                      <div
                        className="h-full bg-terminal-red flex items-center justify-center text-xs font-mono font-medium text-white"
                        style={{ width: `${(missionData.journey.distribution.early / totalShipments) * 100}%`, minWidth: missionData.journey.distribution.early > 0 ? '32px' : '0' }}
                        title={`Early Stage (0-25%): ${missionData.journey.distribution.early}`}
                      >
                        {missionData.journey.distribution.early}
                      </div>
                    )}
                    {missionData.journey.distribution.midway > 0 && (
                      <div
                        className="h-full bg-terminal-amber flex items-center justify-center text-xs font-mono font-medium text-terminal-bg"
                        style={{ width: `${(missionData.journey.distribution.midway / totalShipments) * 100}%`, minWidth: missionData.journey.distribution.midway > 0 ? '32px' : '0' }}
                        title={`Midway (25-50%): ${missionData.journey.distribution.midway}`}
                      >
                        {missionData.journey.distribution.midway}
                      </div>
                    )}
                    {missionData.journey.distribution.advanced > 0 && (
                      <div
                        className="h-full bg-terminal-blue flex items-center justify-center text-xs font-mono font-medium text-white"
                        style={{ width: `${(missionData.journey.distribution.advanced / totalShipments) * 100}%`, minWidth: missionData.journey.distribution.advanced > 0 ? '32px' : '0' }}
                        title={`Advanced (50-75%): ${missionData.journey.distribution.advanced}`}
                      >
                        {missionData.journey.distribution.advanced}
                      </div>
                    )}
                    {missionData.journey.distribution.nearComplete > 0 && (
                      <div
                        className="h-full bg-terminal-green flex items-center justify-center text-xs font-mono font-medium text-terminal-bg"
                        style={{ width: `${(missionData.journey.distribution.nearComplete / totalShipments) * 100}%`, minWidth: missionData.journey.distribution.nearComplete > 0 ? '32px' : '0' }}
                        title={`Near Complete (75-100%): ${missionData.journey.distribution.nearComplete}`}
                      >
                        {missionData.journey.distribution.nearComplete}
                      </div>
                    )}
                  </div>
                  <div className="flex justify-between text-[10px] font-mono text-terminal-muted mt-1.5">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-terminal-red"></span> Early</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-terminal-amber"></span> Midway</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-terminal-blue"></span> Advanced</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-terminal-green"></span> Complete</span>
                  </div>
                </div>

                {/* Shipments Needing Attention - Terminal Style */}
                {missionData.journey.shipmentsNeedingAttention.length > 0 && (
                  <div className="border-t border-terminal-border pt-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="h-2 w-2 rounded-full bg-terminal-amber animate-pulse" />
                      <span className="text-sm font-medium text-terminal-amber">Needs Attention</span>
                      <span className="text-[10px] font-mono text-terminal-muted">(low progress + ETD &lt;14d)</span>
                    </div>
                    <div className="space-y-1">
                      {missionData.journey.shipmentsNeedingAttention.map((ship) => (
                        <Link
                          key={ship.id}
                          href={`/shipments/${ship.id}`}
                          className="flex items-center gap-3 px-2 py-2 rounded hover:bg-terminal-elevated transition group border border-transparent hover:border-gray-200 hover:border-terminal-border"
                        >
                          <div className="flex-shrink-0 font-mono text-sm font-bold text-terminal-amber bg-terminal-amber/10 px-2 py-1 rounded border border-terminal-amber/30">
                            {ship.journey_progress}%
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-mono font-medium text-terminal-green truncate">{ship.booking_number}</p>
                            <p className="text-xs text-terminal-muted truncate">
                              {ship.workflow_state?.replace(/_/g, ' ') || 'No state'}
                            </p>
                          </div>
                          <div className="flex-shrink-0 text-right font-mono">
                            <p className={`text-sm font-medium ${
                              ship.days_to_etd !== null && ship.days_to_etd <= 3 ? 'text-terminal-red' :
                              ship.days_to_etd !== null && ship.days_to_etd <= 7 ? 'text-terminal-amber' :
                              'text-terminal-muted'
                            }`}>
                              {ship.days_to_etd !== null ? `${ship.days_to_etd}d` : '--'}
                            </p>
                          </div>
                          <ChevronRight className="h-4 w-4 text-terminal-muted group-hover:text-terminal-text" />
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Shipment Phases - Terminal Style */}
          <div className="rounded-lg border border-terminal-border bg-terminal-surface p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-terminal-green" />
                <Ship className="h-4 w-4 text-terminal-muted" />
                <h2 className="font-medium text-terminal-text text-sm">Shipment Status</h2>
              </div>
              <button
                onClick={() => setShowCutoffs(!showCutoffs)}
                className="text-xs font-mono text-terminal-muted hover:text-gray-700 hover:text-terminal-text flex items-center gap-1 transition-colors"
              >
                {showCutoffs ? '[hide]' : '[show]'} cutoffs
                <ChevronDown className={`h-3 w-3 transition ${showCutoffs ? 'rotate-180' : ''}`} />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <PhaseCard
                phase="Pre-Departure"
                count={missionData?.phases.preDeparture || 0}
                icon={Package}
                color="blue"
                href="/shipments?phase=pre_departure"
              />
              <PhaseCard
                phase="In Transit"
                count={missionData?.phases.inTransit || 0}
                icon={Ship}
                color="purple"
                href="/shipments?phase=in_transit"
              />
              <PhaseCard
                phase="Arrival"
                count={missionData?.phases.arrival || 0}
                icon={Anchor}
                color="amber"
                href="/shipments?phase=arrival"
              />
              <PhaseCard
                phase="Delivered"
                count={missionData?.phases.delivered || 0}
                icon={Truck}
                color="green"
                href="/shipments?phase=delivered"
              />
            </div>

            {/* Cutoffs Progress - Terminal Style */}
            {showCutoffs && missionData && (
              <div className="mt-4 pt-4 border-t border-terminal-border grid grid-cols-3 gap-6">
                <CutoffProgress
                  label="SI Submissions"
                  pending={missionData.cutoffs.siPending}
                  total={missionData.cutoffs.siTotal}
                />
                <CutoffProgress
                  label="VGM Submissions"
                  pending={missionData.cutoffs.vgmPending}
                  total={missionData.cutoffs.vgmTotal}
                />
                <CutoffProgress
                  label="Documents"
                  pending={missionData.cutoffs.docsPending}
                  total={missionData.cutoffs.docsTotal}
                />
              </div>
            )}
          </div>

          {/* Filters - Terminal Style */}
          <div className="rounded-lg border border-terminal-border bg-terminal-surface p-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Filter className="h-3.5 w-3.5 text-terminal-muted" />
                <span className="text-xs font-mono text-terminal-muted">priority:</span>
              </div>
              {(['critical', 'high', 'medium', 'low'] as NotificationPriority[]).map(priority => (
                <button
                  key={priority}
                  onClick={() => togglePriorityFilter(priority)}
                  className={`flex items-center gap-1.5 px-2 py-1 text-xs font-mono rounded border transition ${
                    filters.priority.includes(priority)
                      ? `${PRIORITY_TEXT_COLORS[priority]} bg-transparent border-current`
                      : 'text-terminal-muted bg-terminal-elevated border-terminal-border hover:border-gray-300 hover:border-terminal-muted'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${filters.priority.includes(priority) ? PRIORITY_DOT_COLORS[priority] : 'bg-terminal-muted'}`} />
                  {priority}
                </button>
              ))}

              <div className="h-5 w-px bg-terminal-border" />

              <span className="text-xs font-mono text-terminal-muted">category:</span>
              {(['deadline', 'notification', 'document', 'compliance'] as TaskCategory[]).map(category => {
                const Icon = CATEGORY_ICONS[category] || Zap;
                const isActive = filters.category.includes(category);
                return (
                  <button
                    key={category}
                    onClick={() => toggleCategoryFilter(category)}
                    className={`flex items-center gap-1.5 px-2 py-1 text-xs font-mono rounded border transition ${
                      isActive
                        ? 'text-terminal-blue bg-terminal-blue/10 border-terminal-blue/30'
                        : 'text-terminal-muted bg-terminal-elevated border-terminal-border hover:border-gray-300 hover:border-terminal-muted'
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                    {category}
                  </button>
                );
              })}
            </div>
          </div>

          {/* PRIORITY QUEUE - Terminal Style */}
          <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
            <div className="px-4 py-3 border-b border-terminal-border bg-terminal-elevated flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-terminal-green animate-pulse" />
                <Zap className="h-4 w-4 text-terminal-amber" />
                <h2 className="text-sm font-medium text-terminal-text">Priority Queue</h2>
              </div>
              <span className="text-xs font-mono text-terminal-muted">[{tasks.length}] tasks</span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-64 gap-2 text-terminal-muted">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="font-mono text-sm">Loading tasks...</span>
              </div>
            ) : tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-terminal-green">
                <CheckCircle className="h-10 w-10 mb-2" />
                <p className="font-mono text-sm">All tasks completed</p>
                <p className="font-mono text-xs text-terminal-muted mt-1">Queue is empty</p>
              </div>
            ) : (
              <div className="divide-y divide-terminal-border">
                {tasks.map((task) => {
                  const urgency = task.urgency_level || calculateUrgencyLevel(task.due_date);
                  const CategoryIcon = CATEGORY_ICONS[task.category as TaskCategory] || Zap;
                  const isSelected = selectedTask?.id === task.id;

                  return (
                    <div
                      key={task.id}
                      className={`px-4 py-3 hover:bg-terminal-elevated transition cursor-pointer ${
                        isSelected ? 'bg-terminal-blue/5 bg-terminal-blue/10 border-l-2 border-terminal-blue' : ''
                      }`}
                      onClick={() => handleSelectTask(isSelected ? null : task)}
                    >
                      <div className="flex items-start gap-4">
                        {/* Priority Score - Terminal Style */}
                        <div className="flex flex-col items-center w-12">
                          <div className={`w-10 h-10 rounded border flex items-center justify-center font-mono text-sm font-bold ${
                            task.priority_score >= 85 ? 'bg-terminal-red/10 border-terminal-red/30 text-terminal-red' :
                            task.priority_score >= 70 ? 'bg-terminal-amber/10 border-terminal-amber/30 text-terminal-amber' :
                            task.priority_score >= 50 ? 'bg-terminal-blue/10 border-terminal-blue/30 text-terminal-blue' :
                            'bg-terminal-muted/10 border-terminal-border text-terminal-muted'
                          }`}>
                            {task.priority_score}
                          </div>
                          <span className="text-[9px] font-mono text-terminal-muted mt-0.5">score</span>
                        </div>

                        {/* Task Details - Terminal Style */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-xs text-terminal-muted font-mono">
                              {formatTaskNumber(task.task_number)}
                            </span>
                            {/* Priority indicator */}
                            <span className={`inline-flex items-center gap-1 text-xs font-mono ${PRIORITY_TEXT_COLORS[task.priority]}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT_COLORS[task.priority]}`} />
                              {task.priority}
                            </span>
                            {/* Status indicator */}
                            <span className={`inline-flex items-center gap-1 text-xs font-mono ${STATUS_TEXT_COLORS[task.status]}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_COLORS[task.status]}`} />
                              {task.status.replace('_', ' ')}
                            </span>
                            {/* Urgency indicator */}
                            {urgency !== 'no_deadline' && urgency !== 'later' && (
                              <span className={`inline-flex items-center gap-1 text-xs font-mono ${URGENCY_TEXT_COLORS[urgency]}`}>
                                <span className={`h-1.5 w-1.5 rounded-full ${URGENCY_DOT_COLORS[urgency]}`} />
                                {urgency.replace('_', ' ')}
                              </span>
                            )}
                          </div>

                          <p className="text-sm font-medium text-terminal-text">{task.title}</p>

                          <div className="flex items-center gap-4 mt-1.5 text-xs text-terminal-muted">
                            <span className="flex items-center gap-1">
                              <CategoryIcon className="h-3 w-3" />
                              {task.category}
                            </span>
                            {task.shipment && (
                              <span className="flex items-center gap-1 text-terminal-blue font-mono">
                                <Ship className="h-3 w-3" />
                                {task.shipment.booking_number}
                              </span>
                            )}
                            {task.due_date && (
                              <span className="flex items-center gap-1 font-mono">
                                <Calendar className="h-3 w-3" />
                                {new Date(task.due_date).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Quick Actions - Terminal Style Buttons */}
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          {task.status === 'pending' && (
                            <button
                              onClick={() => handleTaskAction(task.id, 'start')}
                              className="p-1.5 text-terminal-blue hover:bg-terminal-blue/10 rounded border border-transparent hover:border-terminal-blue/30 transition-colors"
                              title="Start"
                            >
                              <Play className="h-4 w-4" />
                            </button>
                          )}
                          {task.status !== 'completed' && task.status !== 'dismissed' && (
                            <>
                              <button
                                onClick={() => handleTaskAction(task.id, 'complete')}
                                className="p-1.5 text-terminal-green hover:bg-terminal-green/10 rounded border border-transparent hover:border-terminal-green/30 transition-colors"
                                title="Complete"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleTaskAction(task.id, 'dismiss')}
                                className="p-1.5 text-terminal-muted hover:bg-terminal-muted/10 rounded border border-transparent hover:border-terminal-border transition-colors"
                                title="Dismiss"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            </>
                          )}
                          <ChevronRight className="h-4 w-4 text-terminal-muted" />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Quick View Panel */}
        {selectedTask && (
          <QuickViewPanel
            task={selectedTask}
            insights={taskInsights}
            insightsLoading={insightsLoading}
            onClose={() => handleSelectTask(null)}
            onAction={handleTaskAction}
            onGenerateDraft={handleGenerateDraft}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function ClientTime() {
  const [time, setTime] = useState<string>('');

  useEffect(() => {
    // Set initial time
    setTime(new Date().toLocaleTimeString());

    // Update every second
    const interval = setInterval(() => {
      setTime(new Date().toLocaleTimeString());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  if (!time) return null; // Don't render on server

  return (
    <span className="text-xs font-mono text-terminal-green flex items-center gap-1.5 bg-terminal-elevated px-2 py-1 rounded border border-terminal-border">
      <Clock className="h-3 w-3" />
      {time}
    </span>
  );
}

function CompactMetric({
  label,
  value,
  icon: Icon,
  color,
  badge,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  color: 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'orange' | 'gray';
  badge?: string;
}) {
  // Terminal-style color mapping - full classes for Tailwind JIT
  const dotColors: Record<string, string> = {
    blue: 'bg-terminal-blue',
    green: 'bg-terminal-green',
    yellow: 'bg-terminal-amber',
    red: 'bg-terminal-red',
    purple: 'bg-terminal-purple',
    orange: 'bg-terminal-amber',
    gray: 'bg-terminal-muted',
  };

  const iconColors: Record<string, string> = {
    blue: 'text-terminal-blue',
    green: 'text-terminal-green',
    yellow: 'text-terminal-amber',
    red: 'text-terminal-red',
    purple: 'text-terminal-purple',
    orange: 'text-terminal-amber',
    gray: 'text-terminal-muted',
  };

  // Value colors - homebrew style (always colored)
  const valueColors: Record<string, string> = {
    blue: 'text-terminal-blue',
    green: 'text-terminal-green',
    yellow: 'text-terminal-amber',
    red: 'text-terminal-red',
    purple: 'text-terminal-purple',
    orange: 'text-terminal-amber',
    gray: 'text-terminal-muted',
  };

  return (
    <div className="rounded-lg border border-terminal-border bg-terminal-surface p-3 hover:bg-terminal-elevated transition-colors">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${dotColors[color]}`} />
          <Icon className={`h-3.5 w-3.5 ${iconColors[color]}`} />
        </div>
        {badge && (
          <span className="text-[9px] font-mono bg-terminal-red/20 text-terminal-red px-1.5 py-0.5 rounded">
            {badge}
          </span>
        )}
      </div>
      <div className={`font-mono text-2xl font-bold ${valueColors[color]}`}>
        {value}
      </div>
      <div className="text-[10px] font-medium text-terminal-muted uppercase tracking-wide mt-0.5">
        {label}
      </div>
    </div>
  );
}

function PhaseCard({
  phase,
  count,
  icon: Icon,
  color,
  href,
}: {
  phase: string;
  count: number;
  icon: React.ElementType;
  color: 'blue' | 'purple' | 'amber' | 'green';
  href: string;
}) {
  // Terminal-style color mapping - full classes for Tailwind JIT
  const dotColors: Record<string, string> = {
    blue: 'bg-terminal-blue',
    purple: 'bg-terminal-purple',
    amber: 'bg-terminal-amber',
    green: 'bg-terminal-green',
  };

  const iconColors: Record<string, string> = {
    blue: 'text-terminal-blue',
    purple: 'text-terminal-purple',
    amber: 'text-terminal-amber',
    green: 'text-terminal-green',
  };

  // Value colors - homebrew style (always colored)
  const valueColors: Record<string, string> = {
    blue: 'text-terminal-blue',
    purple: 'text-terminal-purple',
    amber: 'text-terminal-amber',
    green: 'text-terminal-green',
  };

  return (
    <Link
      href={href}
      className="p-3 rounded-lg border border-terminal-border bg-terminal-elevated hover:bg-terminal-surface transition-colors group"
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={`h-2 w-2 rounded-full ${dotColors[color]}`} />
        <Icon className={`h-3.5 w-3.5 ${iconColors[color]}`} />
        <span className="text-[10px] font-medium text-terminal-muted uppercase tracking-wide">{phase}</span>
      </div>
      <div className={`text-2xl font-mono font-bold ${valueColors[color]}`}>
        {count}
      </div>
    </Link>
  );
}

function CutoffProgress({
  label,
  pending,
  total,
}: {
  label: string;
  pending: number;
  total: number;
}) {
  const completed = total - pending;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 100;
  const ratio = total > 0 ? pending / total : 0;
  const colorClass = ratio > 0.5 ? 'bg-terminal-red' : ratio > 0.2 ? 'bg-terminal-amber' : 'bg-terminal-green';
  const dotColor = ratio > 0.5 ? 'bg-terminal-red' : ratio > 0.2 ? 'bg-terminal-amber' : 'bg-terminal-green';

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
          <span className="text-xs font-medium text-terminal-text">{label}</span>
        </div>
        <span className="text-xs font-mono text-terminal-muted">{completed}/{total}</span>
      </div>
      <div className="h-1.5 bg-terminal-bg rounded-full overflow-hidden border border-terminal-border">
        <div className={`h-full transition-all ${colorClass}`} style={{ width: `${pct}%` }} />
      </div>
      {pending > 0 && (
        <p className="text-[10px] font-mono text-terminal-amber mt-1">{pending} pending</p>
      )}
    </div>
  );
}

function QuickViewPanel({
  task,
  insights,
  insightsLoading,
  onClose,
  onAction,
  onGenerateDraft,
}: {
  task: TaskWithRelations;
  insights: Insight[];
  insightsLoading: boolean;
  onClose: () => void;
  onAction: (taskId: string, action: string) => void;
  onGenerateDraft: (insight: Insight) => Promise<InsightDraft | null>;
}) {
  const [generatingDraft, setGeneratingDraft] = useState<string | null>(null);
  const [draftPreview, setDraftPreview] = useState<InsightDraft | null>(null);
  const shipment = task.shipment;

  const handleDraftEmail = async (insight: Insight) => {
    setGeneratingDraft(insight.id);
    const draft = await onGenerateDraft(insight);
    if (draft) {
      setDraftPreview(draft);
    }
    setGeneratingDraft(null);
  };

  return (
    <div className="fixed right-0 top-0 h-screen w-96 bg-terminal-surface border-l border-terminal-border shadow-xl z-50 overflow-y-auto">
      {/* Header - Terminal Style */}
      <div className="sticky top-0 bg-terminal-elevated border-b border-terminal-border px-4 py-2.5 flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-terminal-green" />
          <h3 className="text-sm font-medium text-terminal-text">Quick View</h3>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 hover:bg-terminal-surface rounded border border-transparent hover:border-gray-200 hover:border-terminal-border transition-colors">
          <X className="h-4 w-4 text-terminal-muted" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Task Info - Terminal Style */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            {/* Priority indicator */}
            <span className={`inline-flex items-center gap-1 text-xs font-mono ${PRIORITY_TEXT_COLORS[task.priority]}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOT_COLORS[task.priority]}`} />
              {task.priority}
            </span>
            {/* Status indicator */}
            <span className={`inline-flex items-center gap-1 text-xs font-mono ${STATUS_TEXT_COLORS[task.status]}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT_COLORS[task.status]}`} />
              {task.status.replace('_', ' ')}
            </span>
          </div>
          <h4 className="text-base font-medium text-terminal-text">{task.title}</h4>
          {task.description && (
            <p className="text-sm text-terminal-muted mt-2">{task.description}</p>
          )}
        </div>

        {/* Actions - Terminal Style Buttons */}
        <div className="flex gap-2">
          {task.status === 'pending' && (
            <button
              onClick={() => onAction(task.id, 'start')}
              className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium text-terminal-blue bg-terminal-blue/10 border border-terminal-blue/30 rounded hover:bg-terminal-blue/20 transition-colors"
            >
              <Play className="h-4 w-4" />
              Start
            </button>
          )}
          {task.status !== 'completed' && task.status !== 'dismissed' && (
            <button
              onClick={() => onAction(task.id, 'complete')}
              className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium text-terminal-green bg-terminal-green/10 border border-terminal-green/30 rounded hover:bg-terminal-green/20 transition-colors"
            >
              <Check className="h-4 w-4" />
              Complete
            </button>
          )}
        </div>

        {/* Insights Section - Terminal Style */}
        {shipment && (
          <div className="rounded-lg border border-gray-200 border-terminal-amber/30 bg-white bg-terminal-amber/5 overflow-hidden">
            <div className="px-3 py-2 bg-gray-50 bg-terminal-amber/10 border-b border-gray-200 border-terminal-amber/20 flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-terminal-amber" />
              <Lightbulb className="h-3.5 w-3.5 text-terminal-amber" />
              <span className="font-medium text-terminal-amber text-xs">Insights</span>
              {insightsLoading && <Loader2 className="h-3 w-3 animate-spin text-terminal-amber ml-auto" />}
              {!insightsLoading && insights.length > 0 && (
                <span className="ml-auto text-[10px] font-mono text-terminal-muted">[{insights.length}]</span>
              )}
            </div>

            {insightsLoading ? (
              <div className="p-4 text-center text-terminal-muted text-xs font-mono">Loading...</div>
            ) : insights.length === 0 ? (
              <div className="p-4 text-center text-terminal-muted text-xs font-mono">No insights</div>
            ) : (
              <div className="divide-y divide-terminal-border">
                {insights.slice(0, 5).map((insight) => {
                  const action = insight.supporting_data?.action;
                  const ActionIcon = action ? ACTION_TYPE_ICONS[action.type] || Mail : null;

                  return (
                    <div key={insight.id} className="p-3">
                      <div className="flex items-start gap-2">
                        <span className={`mt-0.5 flex items-center gap-1 text-[10px] font-mono ${SEVERITY_TEXT_COLORS[insight.severity]}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${INSIGHT_SEVERITY_DOT_COLORS[insight.severity]}`} />
                          {insight.severity}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-terminal-text">{insight.title}</p>
                          <p className="text-xs text-terminal-muted mt-0.5 line-clamp-2">{insight.description}</p>

                          {/* Action Button - Terminal Style */}
                          {action && (
                            <div className="mt-2 flex items-center gap-2">
                              <button
                                onClick={() => handleDraftEmail(insight)}
                                disabled={generatingDraft === insight.id}
                                className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-mono text-terminal-blue bg-terminal-blue/10 border border-terminal-blue/30 rounded hover:bg-terminal-blue/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              >
                                {generatingDraft === insight.id ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  ActionIcon && <ActionIcon className="h-3 w-3" />
                                )}
                                {action.type === 'email' ? 'Draft' : action.type}
                              </button>
                              <span className="text-[9px] font-mono text-terminal-muted">
                                {ACTION_TARGET_LABELS[action.target] || action.target}
                                {action.urgency === 'immediate' && <span className="text-terminal-red"> [urgent]</span>}
                              </span>
                            </div>
                          )}

                          {/* Text Action (fallback) */}
                          {!action && insight.recommended_action && (
                            <p className="mt-1.5 text-[10px] font-mono text-terminal-blue bg-terminal-blue/5 border border-terminal-blue/20 px-2 py-1 rounded">
                              {insight.recommended_action}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Draft Preview Modal - Terminal Style */}
        {draftPreview && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
            <div className="bg-terminal-surface rounded-lg max-w-lg w-full max-h-[80vh] overflow-hidden shadow-2xl border border-terminal-border">
              <div className="px-4 py-2.5 bg-terminal-elevated border-b border-terminal-border flex items-center justify-between">
                <h3 className="text-sm font-medium flex items-center gap-2 text-terminal-text">
                  <span className="h-2 w-2 rounded-full bg-terminal-blue" />
                  <Mail className="h-4 w-4 text-terminal-blue" />
                  Email Draft
                </h3>
                <button onClick={() => setDraftPreview(null)} className="p-1 hover:bg-gray-100 hover:bg-terminal-surface rounded transition-colors">
                  <X className="h-4 w-4 text-terminal-muted" />
                </button>
              </div>
              <div className="p-4 space-y-3 overflow-y-auto max-h-[60vh]">
                <div className="text-xs font-mono">
                  <span className="text-terminal-muted">to:</span>{' '}
                  <span className="text-terminal-text">{draftPreview.recipientName}</span>{' '}
                  <span className="text-terminal-muted">&lt;{draftPreview.recipientEmail}&gt;</span>
                </div>
                <div className="text-xs font-mono">
                  <span className="text-terminal-muted">subject:</span>{' '}
                  <span className="text-terminal-text">{draftPreview.subject}</span>
                </div>
                {draftPreview.urgency === 'immediate' && (
                  <div className="inline-flex items-center gap-1 text-[10px] font-mono text-terminal-red bg-terminal-red/10 border border-terminal-red/30 px-2 py-0.5 rounded">
                    <span className="h-1.5 w-1.5 rounded-full bg-terminal-red animate-pulse" />
                    Urgent
                  </div>
                )}
                <div className="border-t border-terminal-border pt-3">
                  <pre className="text-xs text-terminal-text whitespace-pre-wrap font-mono">{draftPreview.body}</pre>
                </div>
              </div>
              <div className="px-4 py-3 bg-terminal-elevated border-t border-terminal-border flex justify-end gap-2">
                <button
                  onClick={() => setDraftPreview(null)}
                  className="px-3 py-1.5 text-xs font-medium text-terminal-muted hover:bg-gray-100 hover:bg-terminal-surface rounded border border-terminal-border transition-colors"
                >
                  Close
                </button>
                <button
                  className="px-3 py-1.5 text-xs font-medium text-terminal-green bg-terminal-green/10 border border-terminal-green/30 rounded hover:bg-terminal-green/20 flex items-center gap-1.5 transition-colors"
                >
                  <Send className="h-3 w-3" />
                  Send
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Shipment Context - Terminal Style */}
        {shipment && (
          <div className="rounded-lg border border-terminal-border bg-terminal-elevated p-3">
            <div className="flex items-center justify-between mb-3">
              <h5 className="text-xs font-medium text-terminal-text flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-terminal-blue" />
                <Ship className="h-3.5 w-3.5 text-terminal-blue" />
                Shipment
              </h5>
              <Link
                href={`/shipments/${shipment.id}`}
                className="text-terminal-blue hover:text-terminal-green text-[10px] font-mono flex items-center gap-1 transition-colors"
              >
                [view] <ExternalLink className="h-3 w-3" />
              </Link>
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between font-mono">
                <span className="text-terminal-muted">booking</span>
                <span className="text-terminal-green">{shipment.booking_number}</span>
              </div>
              {shipment.bl_number && (
                <div className="flex justify-between font-mono">
                  <span className="text-terminal-muted">bl</span>
                  <span className="text-terminal-green">{shipment.bl_number}</span>
                </div>
              )}
              {shipment.vessel_name && (
                <div className="flex justify-between font-mono">
                  <span className="text-terminal-muted">vessel</span>
                  <span className="text-terminal-blue">{shipment.vessel_name}</span>
                </div>
              )}
              {shipment.etd && (
                <div className="flex justify-between font-mono">
                  <span className="text-terminal-muted">etd</span>
                  <span className="text-terminal-amber">{new Date(shipment.etd).toLocaleDateString()}</span>
                </div>
              )}
              {shipment.eta && (
                <div className="flex justify-between font-mono">
                  <span className="text-terminal-muted">eta</span>
                  <span className="text-terminal-amber">{new Date(shipment.eta).toLocaleDateString()}</span>
                </div>
              )}
              {shipment.status && (
                <div className="flex justify-between font-mono">
                  <span className="text-terminal-muted">status</span>
                  <span className="text-terminal-purple">{shipment.status.replace('_', ' ')}</span>
                </div>
              )}
              {shipment.workflow_state && (
                <div className="flex justify-between font-mono">
                  <span className="text-terminal-muted">stage</span>
                  <span className="text-terminal-blue bg-terminal-blue/10 px-1.5 py-0.5 rounded text-[10px]">
                    {shipment.workflow_state.replace(/_/g, ' ')}
                  </span>
                </div>
              )}
            </div>

            {/* Route - Terminal Style */}
            {(shipment.port_of_loading || shipment.port_of_discharge) && (
              <div className="mt-3 pt-3 border-t border-terminal-border">
                <div className="flex items-center justify-between text-xs font-mono">
                  <span className="text-terminal-blue">{shipment.port_of_loading || '--'}</span>
                  <ArrowRight className="h-3 w-3 text-terminal-green" />
                  <span className="text-terminal-blue">{shipment.port_of_discharge || '--'}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Task Details - Terminal Style */}
        <div className="border-t border-terminal-border pt-4">
          <h5 className="text-xs font-medium text-terminal-text mb-2 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-terminal-muted" />
            Details
          </h5>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between font-mono">
              <span className="text-terminal-muted">task_id</span>
              <span className="text-terminal-text">{formatTaskNumber(task.task_number)}</span>
            </div>
            <div className="flex justify-between font-mono">
              <span className="text-terminal-muted">category</span>
              <span className="text-terminal-text">{task.category}</span>
            </div>
            <div className="flex justify-between font-mono">
              <span className="text-terminal-muted">score</span>
              <span className={`font-bold ${
                task.priority_score >= 85 ? 'text-terminal-red' :
                task.priority_score >= 70 ? 'text-terminal-amber' :
                task.priority_score >= 50 ? 'text-terminal-blue' :
                'text-terminal-muted'
              }`}>{task.priority_score}</span>
            </div>
            {task.due_date && (
              <div className="flex justify-between font-mono">
                <span className="text-terminal-muted">due</span>
                <span className="text-terminal-text">{new Date(task.due_date).toLocaleString()}</span>
              </div>
            )}
            {task.assigned_to_name && (
              <div className="flex justify-between font-mono">
                <span className="text-terminal-muted">assignee</span>
                <span className="text-terminal-text">{task.assigned_to_name}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
