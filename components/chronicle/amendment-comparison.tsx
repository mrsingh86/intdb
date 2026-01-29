'use client';

import { useState } from 'react';
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Ship,
  Calendar,
  Anchor,
  MapPin,
  RefreshCw,
  Clock,
} from 'lucide-react';

interface FieldChange {
  field: string;
  oldValue: string | number | null;
  newValue: string | number | null;
  changeType: 'added' | 'removed' | 'modified';
}

interface AmendmentData {
  id: string;
  revisionNumber: number;
  revisionType: 'amendment' | 'update' | 'rollover' | 'cancellation';
  changedFields: FieldChange[];
  sourceEmailSubject?: string;
  sourceEmailDate?: string;
  reason?: string;
  severity: 'critical' | 'major' | 'minor';
}

interface AmendmentComparisonProps {
  amendment: AmendmentData;
  variant?: 'full' | 'compact' | 'inline';
  showHeader?: boolean;
}

/**
 * AmendmentComparison - Shows before/after differences for document amendments
 *
 * Used for:
 * - Vessel rollovers (vessel/voyage changes)
 * - ETD/ETA updates
 * - Port changes
 * - Booking amendments
 */
export function AmendmentComparison({
  amendment,
  variant = 'full',
  showHeader = true,
}: AmendmentComparisonProps) {
  const [isExpanded, setIsExpanded] = useState(variant === 'full');

  const getSeverityStyles = (severity: string) => {
    switch (severity) {
      case 'critical':
        return {
          bg: 'bg-terminal-red/10',
          border: 'border-terminal-red/30',
          text: 'text-terminal-red',
          dot: 'bg-terminal-red animate-pulse',
        };
      case 'major':
        return {
          bg: 'bg-terminal-amber/10',
          border: 'border-terminal-amber/30',
          text: 'text-terminal-amber',
          dot: 'bg-terminal-amber',
        };
      default:
        return {
          bg: 'bg-terminal-blue/10',
          border: 'border-terminal-blue/30',
          text: 'text-terminal-blue',
          dot: 'bg-terminal-blue',
        };
    }
  };

  const getRevisionLabel = () => {
    const ordinal = getOrdinal(amendment.revisionNumber);
    switch (amendment.revisionType) {
      case 'rollover':
        return `${ordinal} Vessel Rollover`;
      case 'cancellation':
        return 'Cancellation';
      case 'update':
        return `${ordinal} Update`;
      default:
        return `${ordinal} Amendment`;
    }
  };

  const getOrdinal = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  const severityStyles = getSeverityStyles(amendment.severity);

  if (variant === 'inline') {
    return (
      <div className="flex items-center gap-2 text-xs font-mono">
        <span className={`h-2 w-2 rounded-full ${severityStyles.dot}`} />
        <span className={severityStyles.text}>{getRevisionLabel()}</span>
        <span className="text-terminal-muted">
          ({amendment.changedFields.length} changes)
        </span>
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className={`rounded-lg border ${severityStyles.border} overflow-hidden`}>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className={`w-full px-3 py-2 flex items-center gap-2 ${severityStyles.bg} hover:opacity-90 transition-opacity`}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-terminal-muted" />
          ) : (
            <ChevronRight className="h-4 w-4 text-terminal-muted" />
          )}
          <RefreshCw className={`h-4 w-4 ${severityStyles.text}`} />
          <span className={`text-sm font-mono font-medium ${severityStyles.text}`}>
            {getRevisionLabel()}
          </span>
          <span className="ml-auto text-xs font-mono text-terminal-muted">
            {amendment.changedFields.length} changes
          </span>
        </button>

        {isExpanded && (
          <div className="px-3 py-2 border-t border-terminal-border bg-terminal-surface">
            <ChangesList changes={amendment.changedFields} compact />
          </div>
        )}
      </div>
    );
  }

  // Full variant
  return (
    <div className={`rounded-lg border ${severityStyles.border} bg-terminal-surface overflow-hidden`}>
      {/* Header */}
      {showHeader && (
        <div className={`px-4 py-2.5 ${severityStyles.bg} border-b border-terminal-border flex items-center gap-2`}>
          <span className={`h-2 w-2 rounded-full ${severityStyles.dot}`} />
          <RefreshCw className={`h-4 w-4 ${severityStyles.text}`} />
          <span className={`font-medium ${severityStyles.text} text-sm`}>
            {getRevisionLabel()}
          </span>
          <span className={`ml-2 px-2 py-0.5 text-[10px] font-mono rounded ${severityStyles.bg} border ${severityStyles.border} ${severityStyles.text} capitalize`}>
            {amendment.severity}
          </span>
          <span className="ml-auto text-xs font-mono text-terminal-muted">
            {amendment.changedFields.length} field{amendment.changedFields.length !== 1 ? 's' : ''} changed
          </span>
        </div>
      )}

      <div className="p-4 space-y-4">
        {/* Reason (if provided) */}
        {amendment.reason && (
          <div className="flex items-start gap-2 text-sm">
            <AlertTriangle className={`h-4 w-4 flex-shrink-0 mt-0.5 ${severityStyles.text}`} />
            <span className="text-terminal-text">{amendment.reason}</span>
          </div>
        )}

        {/* Source email */}
        {amendment.sourceEmailSubject && (
          <div className="text-xs font-mono text-terminal-muted flex items-center gap-2">
            <Clock className="h-3.5 w-3.5" />
            <span>Source: {amendment.sourceEmailSubject}</span>
            {amendment.sourceEmailDate && (
              <span>• {new Date(amendment.sourceEmailDate).toLocaleDateString()}</span>
            )}
          </div>
        )}

        {/* Changes */}
        <ChangesList changes={amendment.changedFields} />

        {/* Impact Summary */}
        <ImpactSummary changes={amendment.changedFields} severity={amendment.severity} />
      </div>
    </div>
  );
}

interface ChangesListProps {
  changes: FieldChange[];
  compact?: boolean;
}

function ChangesList({ changes, compact }: ChangesListProps) {
  const getFieldIcon = (field: string) => {
    if (field.includes('vessel') || field.includes('voyage')) return Ship;
    if (field.includes('date') || field.includes('etd') || field.includes('eta') || field.includes('cutoff')) return Calendar;
    if (field.includes('port')) return Anchor;
    if (field.includes('place') || field.includes('location')) return MapPin;
    return null;
  };

  const formatValue = (value: string | number | null): string => {
    if (value === null || value === undefined) return '(empty)';
    if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/)) {
      return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    return String(value);
  };

  if (compact) {
    return (
      <div className="space-y-1.5">
        {changes.map((change, idx) => (
          <div key={idx} className="flex items-center gap-2 text-xs font-mono">
            <span className="text-terminal-muted capitalize min-w-[100px]">
              {change.field.replace(/_/g, ' ')}:
            </span>
            <span className="text-terminal-red line-through">
              {formatValue(change.oldValue)}
            </span>
            <ArrowRight className="h-3 w-3 text-terminal-muted flex-shrink-0" />
            <span className="text-terminal-green font-medium">
              {formatValue(change.newValue)}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {changes.map((change, idx) => {
        const Icon = getFieldIcon(change.field);
        const changeTypeStyles = {
          added: 'border-l-terminal-green',
          removed: 'border-l-terminal-red',
          modified: 'border-l-terminal-amber',
        };

        return (
          <div
            key={idx}
            className={`flex items-center gap-3 p-3 bg-terminal-bg rounded-lg border border-terminal-border border-l-2 ${changeTypeStyles[change.changeType]}`}
          >
            {Icon && <Icon className="h-4 w-4 text-terminal-muted flex-shrink-0" />}

            <div className="flex-1 min-w-0">
              <div className="text-xs font-mono text-terminal-muted uppercase tracking-wide mb-1">
                {change.field.replace(/_/g, ' ')}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {/* Old Value */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-terminal-muted">OLD:</span>
                  <span className={`text-sm font-mono ${change.changeType === 'added' ? 'text-terminal-muted' : 'text-terminal-red line-through'}`}>
                    {formatValue(change.oldValue)}
                  </span>
                </div>

                <ArrowRight className="h-4 w-4 text-terminal-muted flex-shrink-0" />

                {/* New Value */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-mono text-terminal-muted">NEW:</span>
                  <span className={`text-sm font-mono font-medium ${change.changeType === 'removed' ? 'text-terminal-muted' : 'text-terminal-green'}`}>
                    {formatValue(change.newValue)}
                  </span>
                </div>
              </div>
            </div>

            {/* Change type badge */}
            <span className={`px-1.5 py-0.5 text-[10px] font-mono rounded capitalize ${
              change.changeType === 'added'
                ? 'bg-terminal-green/10 text-terminal-green border border-terminal-green/30'
                : change.changeType === 'removed'
                  ? 'bg-terminal-red/10 text-terminal-red border border-terminal-red/30'
                  : 'bg-terminal-amber/10 text-terminal-amber border border-terminal-amber/30'
            }`}>
              {change.changeType}
            </span>
          </div>
        );
      })}
    </div>
  );
}

interface ImpactSummaryProps {
  changes: FieldChange[];
  severity: string;
}

function ImpactSummary({ changes, severity }: ImpactSummaryProps) {
  const hasVesselChange = changes.some(c => c.field.includes('vessel') || c.field.includes('voyage'));
  const hasDateChange = changes.some(c => c.field.includes('etd') || c.field.includes('eta') || c.field.includes('date'));
  const hasPortChange = changes.some(c => c.field.includes('port'));

  if (!hasVesselChange && !hasDateChange && !hasPortChange) {
    return null;
  }

  return (
    <div className="mt-4 pt-3 border-t border-terminal-border">
      <div className="text-xs font-mono text-terminal-muted mb-2 flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5" />
        Impact Assessment
      </div>

      <div className="flex flex-wrap gap-2">
        {hasVesselChange && (
          <span className="px-2 py-1 text-[10px] font-mono bg-terminal-amber/10 text-terminal-amber border border-terminal-amber/30 rounded flex items-center gap-1">
            <Ship className="h-3 w-3" />
            Vessel Change - Update tracking
          </span>
        )}
        {hasDateChange && (
          <span className="px-2 py-1 text-[10px] font-mono bg-terminal-amber/10 text-terminal-amber border border-terminal-amber/30 rounded flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            Schedule Change - Review cutoffs
          </span>
        )}
        {hasPortChange && (
          <span className="px-2 py-1 text-[10px] font-mono bg-terminal-amber/10 text-terminal-amber border border-terminal-amber/30 rounded flex items-center gap-1">
            <Anchor className="h-3 w-3" />
            Port Change - Update logistics
          </span>
        )}
      </div>
    </div>
  );
}

export default AmendmentComparison;
