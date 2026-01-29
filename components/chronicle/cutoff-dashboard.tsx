'use client';

import { useState, useEffect } from 'react';
import { Clock, AlertTriangle, CheckCircle, AlertCircle } from 'lucide-react';

interface CutoffData {
  siCutoff?: string;
  vgmCutoff?: string;
  cargoCutoff?: string;
  docCutoff?: string;
  gateCutoff?: string;
  siSubmitted?: boolean;
  vgmSubmitted?: boolean;
  docsComplete?: boolean;
}

interface CutoffDashboardProps {
  cutoffs: CutoffData;
  variant?: 'full' | 'compact' | 'inline';
}

interface CutoffStatus {
  daysRemaining: number | null;
  hoursRemaining: number | null;
  urgency: 'safe' | 'warning' | 'urgent' | 'overdue' | 'submitted' | 'unknown';
  label: string;
}

/**
 * CutoffDashboard - Displays cutoff dates with countdown timers and urgency indicators
 *
 * Urgency colors:
 * - [7d]        → Gray (safe)
 * - [3d!]       → Amber (warning)
 * - [2d!!]      → Red pulsing (urgent)
 * - [OVERDUE]   → Red solid
 * - [SUBMITTED] → Green
 */
export function CutoffDashboard({ cutoffs, variant = 'full' }: CutoffDashboardProps) {
  const [now, setNow] = useState(new Date());

  // Update time every minute
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);

  const getCutoffStatus = (dateStr?: string, isSubmitted?: boolean): CutoffStatus => {
    if (isSubmitted) {
      return { daysRemaining: null, hoursRemaining: null, urgency: 'submitted', label: 'SUBMITTED' };
    }

    if (!dateStr) {
      return { daysRemaining: null, hoursRemaining: null, urgency: 'unknown', label: '--' };
    }

    const cutoffDate = new Date(dateStr);
    const diffMs = cutoffDate.getTime() - now.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffMs < 0) {
      return { daysRemaining: diffDays, hoursRemaining: diffHours, urgency: 'overdue', label: 'OVERDUE' };
    }

    if (diffDays <= 2) {
      return { daysRemaining: diffDays, hoursRemaining: diffHours, urgency: 'urgent', label: diffHours <= 24 ? `${diffHours}h!!` : `${diffDays}d!!` };
    }

    if (diffDays <= 5) {
      return { daysRemaining: diffDays, hoursRemaining: diffHours, urgency: 'warning', label: `${diffDays}d!` };
    }

    return { daysRemaining: diffDays, hoursRemaining: diffHours, urgency: 'safe', label: `${diffDays}d` };
  };

  const siStatus = getCutoffStatus(cutoffs.siCutoff, cutoffs.siSubmitted);
  const vgmStatus = getCutoffStatus(cutoffs.vgmCutoff, cutoffs.vgmSubmitted);
  const cargoStatus = getCutoffStatus(cutoffs.cargoCutoff);
  const docStatus = getCutoffStatus(cutoffs.docCutoff, cutoffs.docsComplete);
  const gateStatus = getCutoffStatus(cutoffs.gateCutoff);

  const allCutoffs = [
    { name: 'SI', status: siStatus, date: cutoffs.siCutoff },
    { name: 'VGM', status: vgmStatus, date: cutoffs.vgmCutoff },
    { name: 'Cargo', status: cargoStatus, date: cutoffs.cargoCutoff },
    { name: 'Docs', status: docStatus, date: cutoffs.docCutoff },
    { name: 'Gate', status: gateStatus, date: cutoffs.gateCutoff },
  ].filter(c => c.date || c.status.urgency === 'submitted');

  if (allCutoffs.length === 0) {
    return null;
  }

  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {allCutoffs.map(cutoff => (
          <CutoffBadge key={cutoff.name} name={cutoff.name} status={cutoff.status} size="sm" />
        ))}
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className="flex items-center gap-3 py-2 px-3 bg-terminal-surface rounded-lg border border-terminal-border">
        <Clock className="h-4 w-4 text-terminal-muted flex-shrink-0" />
        <div className="flex items-center gap-2 flex-wrap">
          {allCutoffs.map(cutoff => (
            <CutoffBadge key={cutoff.name} name={cutoff.name} status={cutoff.status} size="sm" />
          ))}
        </div>
      </div>
    );
  }

  // Full variant
  return (
    <div className="rounded-lg border border-terminal-amber/30 bg-terminal-surface overflow-hidden">
      <div className="px-4 py-2.5 bg-terminal-amber/10 border-b border-terminal-border flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-terminal-amber animate-pulse" />
        <AlertTriangle className="h-4 w-4 text-terminal-amber" />
        <span className="font-medium text-terminal-amber text-sm">Cutoff Dashboard</span>
        <span className="ml-auto text-[10px] font-mono text-terminal-muted">
          Updated {now.toLocaleTimeString()}
        </span>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {allCutoffs.map(cutoff => (
            <CutoffCard
              key={cutoff.name}
              name={cutoff.name}
              status={cutoff.status}
              date={cutoff.date}
            />
          ))}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-4 pt-3 border-t border-terminal-border text-[10px] font-mono text-terminal-muted">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-terminal-muted" /> Safe
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-terminal-amber" /> Warning
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-terminal-red animate-pulse" /> Urgent
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-terminal-green" /> Submitted
          </span>
        </div>
      </div>
    </div>
  );
}

interface CutoffCardProps {
  name: string;
  status: CutoffStatus;
  date?: string;
}

function CutoffCard({ name, status, date }: CutoffCardProps) {
  const urgencyStyles = {
    safe: {
      bg: 'bg-terminal-muted/10',
      border: 'border-terminal-border',
      dot: 'bg-terminal-muted',
      text: 'text-terminal-muted',
      label: 'text-terminal-text',
    },
    warning: {
      bg: 'bg-terminal-amber/10',
      border: 'border-terminal-amber/30',
      dot: 'bg-terminal-amber',
      text: 'text-terminal-amber',
      label: 'text-terminal-amber',
    },
    urgent: {
      bg: 'bg-terminal-red/10',
      border: 'border-terminal-red/30',
      dot: 'bg-terminal-red animate-pulse',
      text: 'text-terminal-red',
      label: 'text-terminal-red',
    },
    overdue: {
      bg: 'bg-terminal-red/20',
      border: 'border-terminal-red/50',
      dot: 'bg-terminal-red',
      text: 'text-terminal-red',
      label: 'text-terminal-red',
    },
    submitted: {
      bg: 'bg-terminal-green/10',
      border: 'border-terminal-green/30',
      dot: 'bg-terminal-green',
      text: 'text-terminal-green',
      label: 'text-terminal-green',
    },
    unknown: {
      bg: 'bg-terminal-bg',
      border: 'border-terminal-border',
      dot: 'bg-terminal-muted',
      text: 'text-terminal-muted',
      label: 'text-terminal-muted',
    },
  };

  const styles = urgencyStyles[status.urgency];

  return (
    <div className={`rounded-lg p-3 ${styles.bg} border ${styles.border}`}>
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`h-2 w-2 rounded-full ${styles.dot}`} />
        <span className="text-xs font-mono text-terminal-muted uppercase tracking-wide">{name}</span>
      </div>

      <div className={`text-lg font-mono font-bold ${styles.label}`}>
        {status.label}
      </div>

      {date && status.urgency !== 'submitted' && (
        <div className="text-[10px] font-mono text-terminal-muted mt-1">
          {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      {status.urgency === 'submitted' && (
        <div className="flex items-center gap-1 text-[10px] font-mono text-terminal-green mt-1">
          <CheckCircle className="h-3 w-3" />
          Complete
        </div>
      )}

      {status.urgency === 'overdue' && (
        <div className="flex items-center gap-1 text-[10px] font-mono text-terminal-red mt-1">
          <AlertCircle className="h-3 w-3" />
          Action required
        </div>
      )}
    </div>
  );
}

interface CutoffBadgeProps {
  name: string;
  status: CutoffStatus;
  size?: 'sm' | 'md';
}

function CutoffBadge({ name, status, size = 'md' }: CutoffBadgeProps) {
  const urgencyStyles = {
    safe: 'bg-terminal-muted/10 text-terminal-muted border-terminal-border',
    warning: 'bg-terminal-amber/10 text-terminal-amber border-terminal-amber/30',
    urgent: 'bg-terminal-red/10 text-terminal-red border-terminal-red/30',
    overdue: 'bg-terminal-red/20 text-terminal-red border-terminal-red/50',
    submitted: 'bg-terminal-green/10 text-terminal-green border-terminal-green/30',
    unknown: 'bg-terminal-bg text-terminal-muted border-terminal-border',
  };

  const sizeClasses = size === 'sm'
    ? 'px-1.5 py-0.5 text-[10px]'
    : 'px-2 py-1 text-xs';

  return (
    <span className={`inline-flex items-center gap-1 font-mono border rounded ${urgencyStyles[status.urgency]} ${sizeClasses}`}>
      <span className="font-medium">{name}:</span>
      <span className={status.urgency === 'urgent' ? 'animate-pulse' : ''}>
        [{status.label}]
      </span>
    </span>
  );
}

export default CutoffDashboard;
