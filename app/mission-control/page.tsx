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
  TaskStatus,
  TaskCategory,
  NotificationPriority,
  UrgencyLevel,
} from '@/types/intelligence-platform';

// ============================================================================
// TYPES
// ============================================================================

type InsightSeverity = 'critical' | 'high' | 'medium' | 'low';
type InsightStatus = 'active' | 'acknowledged' | 'resolved' | 'dismissed' | 'expired';

interface InsightAction {
  type: 'email' | 'call' | 'task' | 'escalate';
  target?: string;
  subject_hint?: string;
  template?: string;
  urgency?: 'immediate' | 'today' | 'soon';
}

interface InsightWithShipment {
  id: string;
  shipment_id: string;
  task_id?: string;
  insight_type: string;
  severity: InsightSeverity;
  title: string;
  description: string;
  recommended_action?: string;
  source: string;
  pattern_id?: string;
  confidence: number;
  supporting_data?: {
    action?: InsightAction;
    [key: string]: unknown;
  };
  priority_boost: number;
  boost_reason?: string;
  status: InsightStatus;
  acknowledged_at?: string;
  resolved_at?: string;
  generated_at: string;
  expires_at?: string;
  shipments?: {
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
}

interface InsightsData {
  insights: InsightWithShipment[];
  statistics: {
    total: number;
    bySeverity: {
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
  };
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
  const [insightsData, setInsightsData] = useState<InsightsData | null>(null);
  const [insights, setInsights] = useState<InsightWithShipment[]>([]);
  const [selectedInsight, setSelectedInsight] = useState<InsightWithShipment | null>(null);

  const [loading, setLoading] = useState(true);

  const [filters, setFilters] = useState({
    severity: [] as InsightSeverity[],
    status: ['active'] as InsightStatus[],
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

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.severity.length > 0) {
        params.set('severity', filters.severity.join(','));
      }
      if (filters.status.length > 0) {
        params.set('status', filters.status.join(','));
      }
      params.set('limit', '50');

      const response = await fetch(`/api/insights?${params.toString()}`);
      if (response.ok) {
        const data = await response.json();
        setInsights(data.insights || []);
        setInsightsData(data);
      }
    } catch (error) {
      console.error('Failed to fetch insights:', error);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const refreshAll = () => {
    fetchMissionControl();
    fetchInsights();
  };

  useEffect(() => {
    fetchMissionControl();
    fetchInsights();
  }, [fetchInsights]);

  // Actions
  const handleInsightAction = async (insightId: string, action: 'acknowledge' | 'resolve' | 'dismiss') => {
    try {
      const response = await fetch(`/api/insights/${insightId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      if (response.ok) {
        fetchInsights();
        if (selectedInsight?.id === insightId) {
          setSelectedInsight(null);
        }
      }
    } catch (error) {
      console.error('Failed to perform action:', error);
    }
  };

  const handleSelectInsight = (insight: InsightWithShipment | null) => {
    setSelectedInsight(insight);
  };

  const toggleSeverityFilter = (severity: InsightSeverity) => {
    setFilters(prev => ({
      ...prev,
      severity: prev.severity.includes(severity)
        ? prev.severity.filter(s => s !== severity)
        : [...prev.severity, severity],
    }));
  };

  const totalShipments = missionData
    ? missionData.phases.preDeparture + missionData.phases.inTransit + missionData.phases.arrival + missionData.phases.delivered
    : 0;

  return (
    <div className="min-h-screen bg-terminal-bg">
      <div className="flex">
        {/* Main Content */}
        <div className={`flex-1 p-6 space-y-5 transition-all ${selectedInsight ? 'mr-96' : ''}`}>
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
          <div className="grid grid-cols-7 gap-3">
            <CompactMetric
              label="Active Insights"
              value={insightsData?.statistics.total || 0}
              icon={Lightbulb}
              color="blue"
              onClick={() => {
                // Scroll to insights section
                document.getElementById('insights-queue')?.scrollIntoView({ behavior: 'smooth' });
              }}
            />
            <CompactMetric
              label="Critical"
              value={insightsData?.statistics.bySeverity.critical || 0}
              icon={AlertTriangle}
              color={(insightsData?.statistics.bySeverity.critical || 0) > 0 ? 'red' : 'green'}
              onClick={() => {
                setFilters(prev => ({ ...prev, severity: ['critical'] }));
                document.getElementById('insights-queue')?.scrollIntoView({ behavior: 'smooth' });
              }}
            />
            <CompactMetric
              label="High Priority"
              value={insightsData?.statistics.bySeverity.high || 0}
              icon={AlertCircle}
              color={(insightsData?.statistics.bySeverity.high || 0) > 0 ? 'orange' : 'green'}
              onClick={() => {
                setFilters(prev => ({ ...prev, severity: ['high'] }));
                document.getElementById('insights-queue')?.scrollIntoView({ behavior: 'smooth' });
              }}
            />
            <CompactMetric
              label="Awaiting Reply"
              value={missionData?.journey?.awaitingResponse || 0}
              icon={MessageCircle}
              color={(missionData?.journey?.awaitingResponse || 0) > 0 ? 'orange' : 'green'}
              href="/shipments?awaiting_reply=true"
            />
            <CompactMetric
              label="Departures"
              value={missionData?.today.departures || 0}
              icon={Ship}
              color="blue"
              href="/shipments?departing_today=true"
            />
            <CompactMetric
              label="Arrivals"
              value={missionData?.today.arrivals || 0}
              icon={Anchor}
              color="green"
              href="/shipments?arriving_today=true"
            />
            <CompactMetric
              label="Shipments"
              value={totalShipments}
              icon={Package}
              color="purple"
              href="/shipments"
            />
          </div>

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
                <span className="text-xs font-mono text-terminal-muted">severity:</span>
              </div>
              {(['critical', 'high', 'medium', 'low'] as InsightSeverity[]).map(severity => (
                <button
                  key={severity}
                  onClick={() => toggleSeverityFilter(severity)}
                  className={`flex items-center gap-1.5 px-2 py-1 text-xs font-mono rounded border transition ${
                    filters.severity.includes(severity)
                      ? `${SEVERITY_TEXT_COLORS[severity]} bg-transparent border-current`
                      : 'text-terminal-muted bg-terminal-elevated border-terminal-border hover:border-gray-300 hover:border-terminal-muted'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${filters.severity.includes(severity) ? SEVERITY_DOT_COLORS[severity] : 'bg-terminal-muted'}`} />
                  {severity}
                </button>
              ))}
            </div>
          </div>

          {/* INSIGHTS QUEUE - Terminal Style */}
          <div id="insights-queue" className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
            <div className="px-4 py-3 border-b border-terminal-border bg-terminal-elevated flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-terminal-green animate-pulse" />
                <Lightbulb className="h-4 w-4 text-terminal-amber" />
                <h2 className="text-sm font-medium text-terminal-text">Insights Queue</h2>
              </div>
              <span className="text-xs font-mono text-terminal-muted">[{insights.length}] insights</span>
            </div>

            {loading ? (
              <div className="flex items-center justify-center h-64 gap-2 text-terminal-muted">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="font-mono text-sm">Loading insights...</span>
              </div>
            ) : insights.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-terminal-green">
                <CheckCircle className="h-10 w-10 mb-2" />
                <p className="font-mono text-sm">No active insights</p>
                <p className="font-mono text-xs text-terminal-muted mt-1">All clear</p>
              </div>
            ) : (
              <div className="divide-y divide-terminal-border">
                {insights.map((insight) => {
                  const isSelected = selectedInsight?.id === insight.id;

                  return (
                    <div
                      key={insight.id}
                      className={`px-4 py-3 hover:bg-terminal-elevated transition cursor-pointer ${
                        isSelected ? 'bg-terminal-blue/5 bg-terminal-blue/10 border-l-2 border-terminal-blue' : ''
                      }`}
                      onClick={() => handleSelectInsight(isSelected ? null : insight)}
                    >
                      <div className="flex items-start gap-4">
                        {/* Priority Boost - Terminal Style */}
                        <div className="flex flex-col items-center w-12">
                          <div className={`w-10 h-10 rounded border flex items-center justify-center font-mono text-sm font-bold ${
                            insight.priority_boost >= 40 ? 'bg-terminal-red/10 border-terminal-red/30 text-terminal-red' :
                            insight.priority_boost >= 25 ? 'bg-terminal-amber/10 border-terminal-amber/30 text-terminal-amber' :
                            insight.priority_boost >= 15 ? 'bg-terminal-blue/10 border-terminal-blue/30 text-terminal-blue' :
                            'bg-terminal-muted/10 border-terminal-border text-terminal-muted'
                          }`}>
                            +{insight.priority_boost}
                          </div>
                          <span className="text-[9px] font-mono text-terminal-muted mt-0.5">boost</span>
                        </div>

                        {/* Insight Details - Terminal Style */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            {/* Severity indicator */}
                            <span className={`inline-flex items-center gap-1 text-xs font-mono ${SEVERITY_TEXT_COLORS[insight.severity]}`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT_COLORS[insight.severity]}`} />
                              {insight.severity}
                            </span>
                            {/* Source indicator */}
                            <span className="text-xs font-mono text-terminal-muted bg-terminal-elevated px-1.5 py-0.5 rounded border border-terminal-border">
                              {insight.source}
                            </span>
                            {/* Confidence */}
                            <span className="text-xs font-mono text-terminal-muted">
                              {insight.confidence}% conf
                            </span>
                          </div>

                          <p className="text-sm font-medium text-terminal-text">{insight.title}</p>

                          <div className="flex items-center gap-4 mt-1.5 text-xs text-terminal-muted">
                            <span className="flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              {new Date(insight.generated_at).toLocaleDateString()}
                            </span>
                            {insight.shipments && (
                              <span className="flex items-center gap-1 text-terminal-blue font-mono">
                                <Ship className="h-3 w-3" />
                                {insight.shipments.booking_number}
                              </span>
                            )}
                            {insight.recommended_action && (
                              <span className="flex items-center gap-1 text-terminal-green truncate max-w-[200px]">
                                <ArrowRight className="h-3 w-3 flex-shrink-0" />
                                {insight.recommended_action}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Quick Actions - Terminal Style Buttons */}
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          {insight.status === 'active' && (
                            <>
                              <button
                                onClick={() => handleInsightAction(insight.id, 'acknowledge')}
                                className="p-1.5 text-terminal-blue hover:bg-terminal-blue/10 rounded border border-transparent hover:border-terminal-blue/30 transition-colors"
                                title="Acknowledge"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleInsightAction(insight.id, 'resolve')}
                                className="p-1.5 text-terminal-green hover:bg-terminal-green/10 rounded border border-transparent hover:border-terminal-green/30 transition-colors"
                                title="Resolve"
                              >
                                <CheckCircle className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => handleInsightAction(insight.id, 'dismiss')}
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
        {selectedInsight && (
          <InsightQuickViewPanel
            insight={selectedInsight}
            onClose={() => handleSelectInsight(null)}
            onAction={handleInsightAction}
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
  href,
  onClick,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  color: 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'orange' | 'gray';
  badge?: string;
  href?: string;
  onClick?: () => void;
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

  const content = (
    <>
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
    </>
  );

  const className = "rounded-lg border border-terminal-border bg-terminal-surface p-3 hover:bg-terminal-elevated transition-colors cursor-pointer";

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button onClick={onClick} className={`${className} w-full text-left`}>
        {content}
      </button>
    );
  }

  return (
    <div className={className.replace('cursor-pointer', '')}>
      {content}
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

function InsightQuickViewPanel({
  insight,
  onClose,
  onAction,
}: {
  insight: InsightWithShipment;
  onClose: () => void;
  onAction: (insightId: string, action: 'acknowledge' | 'resolve' | 'dismiss') => void;
}) {
  const shipment = insight.shipments;

  return (
    <div className="fixed right-0 top-0 h-screen w-96 bg-terminal-surface border-l border-terminal-border shadow-xl z-50 overflow-y-auto">
      {/* Header - Terminal Style */}
      <div className="sticky top-0 bg-terminal-elevated border-b border-terminal-border px-4 py-2.5 flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-terminal-amber" />
          <h3 className="text-sm font-medium text-terminal-text">Insight Details</h3>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-terminal-surface rounded border border-transparent hover:border-terminal-border transition-colors">
          <X className="h-4 w-4 text-terminal-muted" />
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Insight Info - Terminal Style */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            {/* Severity indicator */}
            <span className={`inline-flex items-center gap-1 text-xs font-mono ${SEVERITY_TEXT_COLORS[insight.severity]}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY_DOT_COLORS[insight.severity]}`} />
              {insight.severity}
            </span>
            {/* Source indicator */}
            <span className="text-xs font-mono text-terminal-muted bg-terminal-elevated px-1.5 py-0.5 rounded border border-terminal-border">
              {insight.source}
            </span>
            {/* Confidence */}
            <span className="text-xs font-mono text-terminal-muted">
              {insight.confidence}% conf
            </span>
          </div>
          <h4 className="text-base font-medium text-terminal-text">{insight.title}</h4>
          <p className="text-sm text-terminal-muted mt-2">{insight.description}</p>
        </div>

        {/* Priority Boost Info */}
        {insight.priority_boost > 0 && (
          <div className="rounded-lg border border-terminal-amber/30 bg-terminal-amber/5 p-3">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="h-4 w-4 text-terminal-amber" />
              <span className="text-xs font-medium text-terminal-amber">Priority Boost</span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-mono font-bold text-terminal-amber">+{insight.priority_boost}</span>
              {insight.boost_reason && (
                <span className="text-xs text-terminal-muted">{insight.boost_reason}</span>
              )}
            </div>
          </div>
        )}

        {/* Recommended Action */}
        {insight.recommended_action && (
          <div className="rounded-lg border border-terminal-green/30 bg-terminal-green/5 p-3">
            <div className="flex items-center gap-2 mb-1">
              <ArrowRight className="h-4 w-4 text-terminal-green" />
              <span className="text-xs font-medium text-terminal-green">Recommended Action</span>
            </div>
            <p className="text-sm text-terminal-text mb-2">{insight.recommended_action}</p>
            {insight.supporting_data?.action?.type === 'email' && shipment && (
              <button
                onClick={() => {
                  const action = insight.supporting_data?.action;
                  const subject = encodeURIComponent(
                    action?.subject_hint || `Re: ${shipment.booking_number} - Action Required`
                  );
                  const body = encodeURIComponent(
                    `Dear Team,\n\nRegarding shipment ${shipment.booking_number}:\n\n${insight.description}\n\nPlease take the necessary action.\n\nBest regards`
                  );
                  window.location.href = `mailto:?subject=${subject}&body=${body}`;
                }}
                className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium text-white bg-terminal-green border border-terminal-green rounded hover:bg-terminal-green/90 transition-colors cursor-pointer"
              >
                <Mail className="h-4 w-4" />
                Draft Email
              </button>
            )}
          </div>
        )}

        {/* Actions - Terminal Style Buttons */}
        {insight.status === 'active' && (
          <div className="flex gap-2">
            <button
              onClick={() => onAction(insight.id, 'acknowledge')}
              className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium text-terminal-blue bg-terminal-blue/10 border border-terminal-blue/30 rounded hover:bg-terminal-blue/20 transition-colors"
            >
              <Check className="h-4 w-4" />
              Acknowledge
            </button>
            <button
              onClick={() => onAction(insight.id, 'resolve')}
              className="flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium text-terminal-green bg-terminal-green/10 border border-terminal-green/30 rounded hover:bg-terminal-green/20 transition-colors"
            >
              <CheckCircle className="h-4 w-4" />
              Resolve
            </button>
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

        {/* Insight Details - Terminal Style */}
        <div className="border-t border-terminal-border pt-4">
          <h5 className="text-xs font-medium text-terminal-text mb-2 flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-terminal-muted" />
            Details
          </h5>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between font-mono">
              <span className="text-terminal-muted">type</span>
              <span className="text-terminal-text">{insight.insight_type}</span>
            </div>
            <div className="flex justify-between font-mono">
              <span className="text-terminal-muted">status</span>
              <span className="text-terminal-text">{insight.status}</span>
            </div>
            <div className="flex justify-between font-mono">
              <span className="text-terminal-muted">generated</span>
              <span className="text-terminal-text">{new Date(insight.generated_at).toLocaleString()}</span>
            </div>
            {insight.expires_at && (
              <div className="flex justify-between font-mono">
                <span className="text-terminal-muted">expires</span>
                <span className="text-terminal-amber">{new Date(insight.expires_at).toLocaleString()}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
