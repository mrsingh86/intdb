'use client';

import { useState, useEffect } from 'react';
import {
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  Calendar,
  Package,
  FileCheck,
  Ship,
  Anchor,
  Truck,
  ClipboardCheck,
  AlertCircle,
} from 'lucide-react';

export interface MilestoneData {
  id: string;
  milestone_code: string;
  milestone_status: 'pending' | 'achieved' | 'missed' | 'skipped';
  expected_date?: string;
  actual_date?: string;
  metadata?: Record<string, unknown>;
  milestone_definition?: {
    milestone_name: string;
    milestone_phase: string;
    is_critical: boolean;
  };
}

export interface MilestoneAlert {
  milestone_code: string;
  alert_type: 'approaching' | 'overdue' | 'missed';
  expected_date?: string;
  days_remaining?: number;
}

export interface MilestoneTimelineProps {
  shipmentId: string;
  etd?: string;
  eta?: string;
  compact?: boolean;
}

const MILESTONE_ICONS: Record<string, typeof Package> = {
  booking_confirmed: FileCheck,
  container_available: Package,
  container_picked_up: Truck,
  container_gated_in: Anchor,
  vgm_submitted: ClipboardCheck,
  si_submitted: FileCheck,
  hbl_released: FileCheck,
  vessel_departed: Ship,
  transshipment_arrived: Anchor,
  transshipment_departed: Ship,
  vessel_arrived: Anchor,
  customs_cleared: ClipboardCheck,
  container_discharged: Package,
  container_available_for_pickup: Package,
  delivery_scheduled: Calendar,
  out_for_delivery: Truck,
  delivered: CheckCircle2,
  pod_confirmed: FileCheck,
};

const MILESTONE_PHASES: Record<string, { label: string; color: string }> = {
  booking: { label: 'Booking', color: 'blue' },
  pre_departure: { label: 'Pre-Departure', color: 'indigo' },
  departure: { label: 'Departure', color: 'yellow' },
  in_transit: { label: 'In Transit', color: 'orange' },
  arrival: { label: 'Arrival', color: 'purple' },
  customs: { label: 'Customs', color: 'pink' },
  delivery: { label: 'Delivery', color: 'green' },
};

export function MilestoneTimeline({ shipmentId, etd, eta, compact = false }: MilestoneTimelineProps) {
  const [milestones, setMilestones] = useState<MilestoneData[]>([]);
  const [alerts, setAlerts] = useState<MilestoneAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchMilestones();
  }, [shipmentId]);

  const fetchMilestones = async () => {
    try {
      const [milestonesRes, alertsRes] = await Promise.all([
        fetch(`/api/shipments/${shipmentId}/milestones`),
        fetch(`/api/shipments/${shipmentId}/milestones/alerts`),
      ]);

      if (milestonesRes.ok) {
        const data = await milestonesRes.json();
        setMilestones(data.milestones || []);
      }

      if (alertsRes.ok) {
        const alertData = await alertsRes.json();
        setAlerts(alertData.alerts || []);
      }
    } catch (err) {
      setError('Failed to load milestones');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (date?: string | null) => {
    if (!date || date === 'null') return '-';
    try {
      const d = new Date(date);
      // Check for invalid date
      if (isNaN(d.getTime())) return '-';
      return d.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return '-';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'achieved':
        return <CheckCircle2 className="h-5 w-5 text-terminal-green" />;
      case 'missed':
        return <AlertTriangle className="h-5 w-5 text-terminal-red" />;
      case 'skipped':
        return <Circle className="h-5 w-5 text-terminal-muted" />;
      default:
        return <Clock className="h-5 w-5 text-terminal-muted" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'achieved':
        return 'bg-terminal-green/20 border-terminal-green/30 text-terminal-green';
      case 'missed':
        return 'bg-terminal-red/20 border-terminal-red/30 text-terminal-red';
      case 'skipped':
        return 'bg-terminal-elevated border-terminal-border text-terminal-muted';
      default:
        return 'bg-terminal-surface border-terminal-border text-terminal-text';
    }
  };

  // Group milestones by phase
  const groupedMilestones = milestones.reduce((acc, milestone) => {
    const phase = milestone.milestone_definition?.milestone_phase || 'other';
    if (!acc[phase]) acc[phase] = [];
    acc[phase].push(milestone);
    return acc;
  }, {} as Record<string, MilestoneData[]>);

  const achievedCount = milestones.filter(m => m.milestone_status === 'achieved').length;
  const totalCount = milestones.length;
  const progressPercent = totalCount > 0 ? Math.round((achievedCount / totalCount) * 100) : 0;

  if (loading) {
    return (
      <div className="bg-terminal-surface rounded-lg border border-terminal-border p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-4 bg-terminal-elevated rounded w-1/4"></div>
          <div className="h-2 bg-terminal-elevated rounded"></div>
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-12 bg-terminal-elevated rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (compact) {
    return (
      <CompactMilestoneTimeline
        milestones={milestones}
        alerts={alerts}
        progressPercent={progressPercent}
      />
    );
  }

  return (
    <div className="bg-terminal-surface rounded-lg border border-terminal-border overflow-hidden">
      {/* Header with Progress */}
      <div className="p-6 border-b border-terminal-border">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-terminal-text">Milestone Progress</h2>
          <span className="text-sm text-terminal-muted font-mono">
            {achievedCount} of {totalCount} completed
          </span>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-2 bg-terminal-elevated rounded-full overflow-hidden">
          <div
            className="h-full bg-terminal-green transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Key Dates */}
        <div className="flex gap-6 mt-4 text-sm font-mono">
          {etd && (
            <div>
              <span className="text-terminal-muted">ETD: </span>
              <span className="font-medium text-terminal-text">{formatDate(etd)}</span>
            </div>
          )}
          {eta && (
            <div>
              <span className="text-terminal-muted">ETA: </span>
              <span className="font-medium text-terminal-text">{formatDate(eta)}</span>
            </div>
          )}
        </div>
      </div>

      {/* Alerts Section */}
      {alerts.length > 0 && (
        <div className="px-6 py-4 bg-terminal-amber/10 border-b border-terminal-amber/30">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-terminal-amber flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-medium text-terminal-amber">Attention Required</h3>
              <ul className="mt-1 space-y-1">
                {alerts.map((alert, idx) => (
                  <li key={idx} className="text-sm text-terminal-text font-mono">
                    {alert.alert_type === 'overdue' && (
                      <span className="font-medium text-terminal-red">OVERDUE: </span>
                    )}
                    {alert.alert_type === 'approaching' && (
                      <span className="font-medium text-terminal-amber">UPCOMING: </span>
                    )}
                    {alert.milestone_code.replace(/_/g, ' ')}
                    {alert.days_remaining !== undefined && alert.days_remaining > 0 && (
                      <span className="text-terminal-muted"> - {alert.days_remaining} days remaining</span>
                    )}
                    {alert.days_remaining !== undefined && alert.days_remaining < 0 && (
                      <span className="text-terminal-red"> - {Math.abs(alert.days_remaining)} days overdue</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Timeline */}
      <div className="p-6">
        {milestones.length === 0 ? (
          <div className="text-center py-8 text-terminal-muted">
            <Clock className="h-12 w-12 mx-auto mb-4 text-terminal-muted" />
            <p className="text-terminal-text">No milestones initialized yet</p>
            <p className="text-sm">Milestones will appear as the shipment progresses</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedMilestones).map(([phase, phaseMilestones]) => {
              const phaseInfo = MILESTONE_PHASES[phase] || { label: phase, color: 'gray' };
              const phaseAchieved = phaseMilestones.filter(m => m.milestone_status === 'achieved').length;

              return (
                <div key={phase} className="relative">
                  {/* Phase Header */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className="px-2 py-0.5 text-xs font-medium font-mono rounded-full bg-terminal-blue/20 text-terminal-blue border border-terminal-blue/30">
                      {phaseInfo.label}
                    </span>
                    <span className="text-xs text-terminal-muted font-mono">
                      {phaseAchieved}/{phaseMilestones.length}
                    </span>
                  </div>

                  {/* Milestones in Phase */}
                  <div className="relative pl-4 border-l-2 border-terminal-border space-y-3">
                    {phaseMilestones.map((milestone, idx) => {
                      const MilestoneIcon = MILESTONE_ICONS[milestone.milestone_code] || Circle;
                      const isCritical = milestone.milestone_definition?.is_critical;

                      return (
                        <div
                          key={milestone.id}
                          className={`
                            relative flex items-start gap-4 p-3 rounded-lg border
                            ${getStatusColor(milestone.milestone_status)}
                          `}
                        >
                          {/* Connector dot */}
                          <div
                            className={`
                              absolute -left-[1.4rem] w-3 h-3 rounded-full border-2 border-terminal-surface
                              ${milestone.milestone_status === 'achieved'
                                ? 'bg-terminal-green'
                                : milestone.milestone_status === 'missed'
                                  ? 'bg-terminal-red'
                                  : 'bg-terminal-muted'
                              }
                            `}
                          />

                          {/* Icon */}
                          <div className="flex-shrink-0">
                            <MilestoneIcon className="h-5 w-5" />
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium font-mono">
                                {milestone.milestone_definition?.milestone_name ||
                                  milestone.milestone_code.replace(/_/g, ' ')}
                              </span>
                              {isCritical && (
                                <span className="px-1.5 py-0.5 text-xs bg-terminal-red/20 text-terminal-red border border-terminal-red/30 rounded font-mono">
                                  Critical
                                </span>
                              )}
                            </div>

                            <div className="flex gap-4 mt-1 text-xs text-terminal-muted font-mono">
                              {milestone.expected_date && (
                                <span>Expected: {formatDate(milestone.expected_date)}</span>
                              )}
                              {milestone.actual_date && (
                                <span className="text-terminal-green">
                                  Actual: {formatDate(milestone.actual_date)}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Status Icon */}
                          <div className="flex-shrink-0">
                            {getStatusIcon(milestone.milestone_status)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function CompactMilestoneTimeline({
  milestones,
  alerts,
  progressPercent,
}: {
  milestones: MilestoneData[];
  alerts: MilestoneAlert[];
  progressPercent: number;
}) {
  const achievedCount = milestones.filter(m => m.milestone_status === 'achieved').length;
  const totalCount = milestones.length;

  return (
    <div className="flex items-center gap-4">
      {/* Mini Progress Bar */}
      <div className="flex items-center gap-2">
        <div className="w-24 h-2 bg-terminal-elevated rounded-full overflow-hidden">
          <div
            className="h-full bg-terminal-green"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="text-xs text-terminal-muted font-mono">
          {achievedCount}/{totalCount}
        </span>
      </div>

      {/* Alert Indicator */}
      {alerts.length > 0 && (
        <div className="flex items-center gap-1 text-terminal-amber">
          <AlertCircle className="h-4 w-4" />
          <span className="text-xs font-mono">{alerts.length} alert{alerts.length !== 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  );
}

export { CompactMilestoneTimeline };
