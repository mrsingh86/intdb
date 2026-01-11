'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  Ship,
  Anchor,
  Package,
  Truck,
  AlertTriangle,
  Clock,
  RefreshCw,
  ChevronRight,
  TrendingUp,
  CheckCircle,
  AlertCircle,
  Calendar,
  FileText,
  Zap,
  Activity,
  Eye,
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

interface JourneyDistribution {
  early: number;      // 0-25% progress
  midway: number;     // 25-50% progress
  advanced: number;   // 50-75% progress
  nearComplete: number; // 75-100% progress
}

interface CutoffAlert {
  shipmentId: string;
  bookingNumber: string;
  cutoffType: 'si' | 'vgm' | 'cargo' | 'doc';
  cutoffDate: string;
  daysRemaining: number;
  hoursRemaining: number;
}

interface ShipmentNeedingAttention {
  id: string;
  bookingNumber: string;
  stage: string;
  journeyProgress: number;
  daysToEtd: number | null;
  issue?: string;
}

interface DashboardData {
  totals: {
    active: number;
    preDeparture: number;
    postDeparture: number;
    preArrival: number;
    postArrival: number;
  };
  journey: {
    distribution: JourneyDistribution;
    averageProgress: number;
  };
  cutoffs: {
    urgent: CutoffAlert[];
    siPending: number;
    vgmPending: number;
  };
  attention: ShipmentNeedingAttention[];
  recentActivity: {
    newEmails: number;
    processed: number;
    linked: number;
    shipmentsCreated: number;
  };
}

// ============================================================================
// COMMAND CENTER
// ============================================================================

export default function CommandCenterPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchDashboard = useCallback(async () => {
    try {
      const response = await fetch('/api/chronicle/dashboard');
      if (response.ok) {
        const result = await response.json();
        setData(result);
        setLastUpdated(new Date());
      }
    } catch (error) {
      console.error('Failed to fetch dashboard:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
    // Auto-refresh every 60 seconds
    const interval = setInterval(fetchDashboard, 60000);
    return () => clearInterval(interval);
  }, [fetchDashboard]);

  const totalActive = data?.totals.active || 0;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-terminal-text flex items-center gap-2">
            Command Center
            <span className="text-xs font-mono text-terminal-muted bg-terminal-elevated px-2 py-0.5 rounded border border-terminal-border">
              Live
            </span>
          </h1>
          <p className="text-xs font-mono text-terminal-muted mt-1">
            ~/chronicle/command • {totalActive} active shipments
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-[10px] font-mono text-terminal-muted">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchDashboard}
            disabled={loading}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-mono bg-terminal-surface border border-terminal-border rounded-lg hover:bg-terminal-elevated transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {/* Phase Distribution Cards */}
      <div className="grid grid-cols-4 gap-4">
        <PhaseCard
          phase="Pre-Departure"
          count={data?.totals.preDeparture || 0}
          icon={Package}
          color="blue"
          href="/chronicle/shipments?phase=pre_departure"
        />
        <PhaseCard
          phase="Post-Departure"
          count={data?.totals.postDeparture || 0}
          icon={Ship}
          color="purple"
          href="/chronicle/shipments?phase=post_departure"
        />
        <PhaseCard
          phase="Pre-Arrival"
          count={data?.totals.preArrival || 0}
          icon={Anchor}
          color="amber"
          href="/chronicle/shipments?phase=pre_arrival"
        />
        <PhaseCard
          phase="Post-Arrival"
          count={data?.totals.postArrival || 0}
          icon={Truck}
          color="green"
          href="/chronicle/shipments?phase=post_arrival"
        />
      </div>

      {/* Journey Progress Distribution */}
      <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
        <div className="px-4 py-3 bg-terminal-elevated border-b border-terminal-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-terminal-purple animate-pulse" />
            <Activity className="h-4 w-4 text-terminal-purple" />
            <span className="font-medium text-terminal-text text-sm">Journey Progress Distribution</span>
          </div>
          <span className="text-xs font-mono text-terminal-muted">
            Avg: {data?.journey.averageProgress || 0}%
          </span>
        </div>

        <div className="p-4">
          {/* Progress Bar */}
          <div className="mb-4">
            <div className="flex items-center gap-0.5 h-10 rounded-lg overflow-hidden bg-terminal-bg border border-terminal-border">
              {data?.journey.distribution && totalActive > 0 && (
                <>
                  {data.journey.distribution.early > 0 && (
                    <DistributionSegment
                      count={data.journey.distribution.early}
                      total={totalActive}
                      color="red"
                      label="Early"
                    />
                  )}
                  {data.journey.distribution.midway > 0 && (
                    <DistributionSegment
                      count={data.journey.distribution.midway}
                      total={totalActive}
                      color="amber"
                      label="Midway"
                    />
                  )}
                  {data.journey.distribution.advanced > 0 && (
                    <DistributionSegment
                      count={data.journey.distribution.advanced}
                      total={totalActive}
                      color="blue"
                      label="Advanced"
                    />
                  )}
                  {data.journey.distribution.nearComplete > 0 && (
                    <DistributionSegment
                      count={data.journey.distribution.nearComplete}
                      total={totalActive}
                      color="green"
                      label="Near Complete"
                    />
                  )}
                </>
              )}
            </div>

            {/* Legend */}
            <div className="flex justify-between mt-2 text-[10px] font-mono text-terminal-muted">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-terminal-red" /> Early (0-25%)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-terminal-amber" /> Midway (25-50%)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-terminal-blue" /> Advanced (50-75%)
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-terminal-green" /> Near Complete (75-100%)
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Cutoff Alerts */}
        <div className="rounded-lg border border-terminal-amber/30 bg-terminal-surface overflow-hidden">
          <div className="px-4 py-3 bg-terminal-amber/10 border-b border-terminal-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-terminal-amber animate-pulse" />
              <AlertTriangle className="h-4 w-4 text-terminal-amber" />
              <span className="font-medium text-terminal-amber text-sm">Cutoff Alerts</span>
            </div>
            <span className="text-xs font-mono text-terminal-muted">
              [{data?.cutoffs.urgent.length || 0}] urgent
            </span>
          </div>

          <div className="p-4">
            {/* Cutoff Summary */}
            <div className="flex items-center gap-4 mb-4 pb-3 border-b border-terminal-border">
              <CutoffStat label="SI Pending" count={data?.cutoffs.siPending || 0} />
              <CutoffStat label="VGM Pending" count={data?.cutoffs.vgmPending || 0} />
            </div>

            {/* Urgent Cutoffs */}
            {data?.cutoffs.urgent && data.cutoffs.urgent.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {data.cutoffs.urgent.slice(0, 5).map((alert) => (
                  <CutoffAlertRow key={`${alert.shipmentId}-${alert.cutoffType}`} alert={alert} />
                ))}
                {data.cutoffs.urgent.length > 5 && (
                  <Link
                    href="/chronicle/shipments?cutoff_urgent=true"
                    className="block text-center text-xs font-mono text-terminal-amber hover:text-terminal-text transition-colors py-2"
                  >
                    [view all {data.cutoffs.urgent.length} urgent cutoffs]
                  </Link>
                )}
              </div>
            ) : (
              <div className="text-center py-6 text-terminal-green">
                <CheckCircle className="h-8 w-8 mx-auto mb-2" />
                <p className="text-sm font-mono">No urgent cutoffs</p>
              </div>
            )}
          </div>
        </div>

        {/* Needs Attention */}
        <div className="rounded-lg border border-terminal-red/30 bg-terminal-surface overflow-hidden">
          <div className="px-4 py-3 bg-terminal-red/10 border-b border-terminal-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-terminal-red" />
              <AlertCircle className="h-4 w-4 text-terminal-red" />
              <span className="font-medium text-terminal-red text-sm">Needs Attention</span>
            </div>
            <span className="text-xs font-mono text-terminal-muted">
              Low progress + ETD &lt;14d
            </span>
          </div>

          <div className="p-4">
            {data?.attention && data.attention.length > 0 ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {data.attention.slice(0, 6).map((ship) => (
                  <AttentionRow key={ship.id} shipment={ship} />
                ))}
                {data.attention.length > 6 && (
                  <Link
                    href="/chronicle/shipments?needs_attention=true"
                    className="block text-center text-xs font-mono text-terminal-red hover:text-terminal-text transition-colors py-2"
                  >
                    [view all {data.attention.length} needing attention]
                  </Link>
                )}
              </div>
            ) : (
              <div className="text-center py-6 text-terminal-green">
                <CheckCircle className="h-8 w-8 mx-auto mb-2" />
                <p className="text-sm font-mono">All shipments on track</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
        <div className="px-4 py-3 bg-terminal-elevated border-b border-terminal-border flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-terminal-green" />
          <Zap className="h-4 w-4 text-terminal-green" />
          <span className="font-medium text-terminal-text text-sm">Chronicle Activity (24h)</span>
        </div>

        <div className="p-4">
          <div className="grid grid-cols-4 gap-4">
            <ActivityMetric
              label="Emails Processed"
              value={data?.recentActivity.processed || 0}
              icon={FileText}
              color="blue"
            />
            <ActivityMetric
              label="Documents Linked"
              value={data?.recentActivity.linked || 0}
              icon={Eye}
              color="green"
            />
            <ActivityMetric
              label="Shipments Created"
              value={data?.recentActivity.shipmentsCreated || 0}
              icon={Ship}
              color="purple"
            />
            <ActivityMetric
              label="New Emails"
              value={data?.recentActivity.newEmails || 0}
              icon={Clock}
              color="amber"
            />
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex items-center gap-4">
        <Link
          href="/chronicle/shipments"
          className="flex items-center gap-2 px-4 py-2 bg-terminal-purple/10 text-terminal-purple border border-terminal-purple/30 rounded-lg hover:bg-terminal-purple/20 transition-colors font-mono text-sm"
        >
          <Ship className="h-4 w-4" />
          View All Shipments
          <ChevronRight className="h-4 w-4" />
        </Link>
        <Link
          href="/chronicle/shipments?phase=pre_departure"
          className="flex items-center gap-2 px-4 py-2 bg-terminal-blue/10 text-terminal-blue border border-terminal-blue/30 rounded-lg hover:bg-terminal-blue/20 transition-colors font-mono text-sm"
        >
          <Package className="h-4 w-4" />
          Pre-Departure
        </Link>
        <Link
          href="/chronicle/shipments?phase=post_departure"
          className="flex items-center gap-2 px-4 py-2 bg-terminal-purple/10 text-terminal-purple border border-terminal-purple/30 rounded-lg hover:bg-terminal-purple/20 transition-colors font-mono text-sm"
        >
          <Ship className="h-4 w-4" />
          Post-Departure
        </Link>
        <Link
          href="/chronicle/shipments?phase=pre_arrival"
          className="flex items-center gap-2 px-4 py-2 bg-terminal-amber/10 text-terminal-amber border border-terminal-amber/30 rounded-lg hover:bg-terminal-amber/20 transition-colors font-mono text-sm"
        >
          <Anchor className="h-4 w-4" />
          Pre-Arrival
        </Link>
      </div>
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

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
  const colorClasses = {
    blue: { bg: 'bg-terminal-blue/10', border: 'border-terminal-blue/30', text: 'text-terminal-blue', dot: 'bg-terminal-blue' },
    purple: { bg: 'bg-terminal-purple/10', border: 'border-terminal-purple/30', text: 'text-terminal-purple', dot: 'bg-terminal-purple' },
    amber: { bg: 'bg-terminal-amber/10', border: 'border-terminal-amber/30', text: 'text-terminal-amber', dot: 'bg-terminal-amber' },
    green: { bg: 'bg-terminal-green/10', border: 'border-terminal-green/30', text: 'text-terminal-green', dot: 'bg-terminal-green' },
  };

  const classes = colorClasses[color];

  return (
    <Link
      href={href}
      className={`rounded-lg border ${classes.border} ${classes.bg} p-4 hover:opacity-90 transition-opacity group`}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={`h-2 w-2 rounded-full ${classes.dot}`} />
        <Icon className={`h-4 w-4 ${classes.text}`} />
        <span className="text-xs font-mono text-terminal-muted uppercase tracking-wide">{phase}</span>
      </div>
      <div className={`text-3xl font-mono font-bold ${classes.text}`}>
        {count}
      </div>
      <div className="flex items-center gap-1 mt-1 text-[10px] font-mono text-terminal-muted group-hover:text-terminal-text transition-colors">
        View shipments <ChevronRight className="h-3 w-3" />
      </div>
    </Link>
  );
}

function DistributionSegment({
  count,
  total,
  color,
  label,
}: {
  count: number;
  total: number;
  color: 'red' | 'amber' | 'blue' | 'green';
  label: string;
}) {
  const percentage = (count / total) * 100;
  const colorClasses = {
    red: 'bg-terminal-red',
    amber: 'bg-terminal-amber',
    blue: 'bg-terminal-blue',
    green: 'bg-terminal-green',
  };

  const textColors = {
    red: 'text-white',
    amber: 'text-terminal-bg',
    blue: 'text-white',
    green: 'text-terminal-bg',
  };

  return (
    <div
      className={`h-full ${colorClasses[color]} flex items-center justify-center ${textColors[color]} text-sm font-mono font-bold transition-all`}
      style={{ width: `${percentage}%`, minWidth: count > 0 ? '40px' : '0' }}
      title={`${label}: ${count} (${Math.round(percentage)}%)`}
    >
      {count}
    </div>
  );
}

function CutoffStat({ label, count }: { label: string; count: number }) {
  return (
    <div className="text-center">
      <div className={`text-xl font-mono font-bold ${count > 0 ? 'text-terminal-amber' : 'text-terminal-green'}`}>
        {count}
      </div>
      <div className="text-[10px] font-mono text-terminal-muted uppercase tracking-wide">{label}</div>
    </div>
  );
}

function CutoffAlertRow({ alert }: { alert: CutoffAlert }) {
  const isUrgent = alert.daysRemaining <= 2;
  const isWarning = alert.daysRemaining <= 5;

  const urgencyClass = isUrgent
    ? 'bg-terminal-red/10 border-terminal-red/30'
    : isWarning
      ? 'bg-terminal-amber/10 border-terminal-amber/30'
      : 'bg-terminal-surface border-terminal-border';

  const timeClass = isUrgent
    ? 'text-terminal-red'
    : isWarning
      ? 'text-terminal-amber'
      : 'text-terminal-muted';

  return (
    <Link
      href={`/chronicle/shipments/${alert.shipmentId}`}
      className={`flex items-center gap-3 p-2 rounded-lg border ${urgencyClass} hover:opacity-80 transition-opacity`}
    >
      <div className={`px-2 py-1 rounded font-mono text-xs font-bold ${timeClass} ${isUrgent ? 'animate-pulse' : ''}`}>
        {alert.daysRemaining <= 0 ? 'OVERDUE' : alert.hoursRemaining <= 24 ? `${alert.hoursRemaining}h` : `${alert.daysRemaining}d`}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-mono text-terminal-text truncate">{alert.bookingNumber}</div>
        <div className="text-[10px] font-mono text-terminal-muted uppercase">{alert.cutoffType} Cutoff</div>
      </div>
      <ChevronRight className="h-4 w-4 text-terminal-muted" />
    </Link>
  );
}

function AttentionRow({ shipment }: { shipment: ShipmentNeedingAttention }) {
  return (
    <Link
      href={`/chronicle/shipments/${shipment.id}`}
      className="flex items-center gap-3 p-2 rounded-lg border border-terminal-border bg-terminal-bg hover:bg-terminal-elevated transition-colors"
    >
      <div className={`px-2 py-1 rounded font-mono text-xs font-bold ${
        shipment.journeyProgress < 25 ? 'text-terminal-red bg-terminal-red/10' : 'text-terminal-amber bg-terminal-amber/10'
      }`}>
        {shipment.journeyProgress}%
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-mono text-terminal-text truncate">{shipment.bookingNumber}</div>
        <div className="text-[10px] font-mono text-terminal-muted">{shipment.stage?.replace(/_/g, ' ')}</div>
      </div>
      <div className={`text-xs font-mono ${
        shipment.daysToEtd !== null && shipment.daysToEtd <= 3 ? 'text-terminal-red' :
        shipment.daysToEtd !== null && shipment.daysToEtd <= 7 ? 'text-terminal-amber' :
        'text-terminal-muted'
      }`}>
        {shipment.daysToEtd !== null ? `${shipment.daysToEtd}d` : '--'}
      </div>
      <ChevronRight className="h-4 w-4 text-terminal-muted" />
    </Link>
  );
}

function ActivityMetric({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ElementType;
  color: 'blue' | 'green' | 'purple' | 'amber';
}) {
  const colorClasses = {
    blue: 'text-terminal-blue',
    green: 'text-terminal-green',
    purple: 'text-terminal-purple',
    amber: 'text-terminal-amber',
  };

  return (
    <div className="text-center p-3 bg-terminal-bg rounded-lg border border-terminal-border">
      <Icon className={`h-5 w-5 mx-auto mb-2 ${colorClasses[color]}`} />
      <div className={`text-2xl font-mono font-bold ${colorClasses[color]}`}>{value}</div>
      <div className="text-[10px] font-mono text-terminal-muted uppercase tracking-wide mt-1">{label}</div>
    </div>
  );
}
