'use client';

import { ExternalLink } from 'lucide-react';
import { type ShipmentListItem } from '@/lib/chronicle-v2';

interface ShipmentCardProps {
  shipment: ShipmentListItem;
  onViewDetails?: (id: string) => void;
  dateMode?: 'etd' | 'eta' | 'smart';
}

/**
 * ShipmentCard - Broader, More Informative Design
 *
 * Shows key info at a glance:
 * Line 1: Booking | Route | Carrier | Date
 * Line 2: Full issue/action summary (not truncated)
 */
export function ShipmentCard({ shipment, onViewDetails, dateMode = 'smart' }: ShipmentCardProps) {
  const {
    id,
    bookingNumber,
    mblNumber,
    route,
    carrier,
    etd,
    eta,
    shipper,
    consignee,
    aiSummary,
    journey,
    recommendation,
    issues,
  } = shipment;

  const riskLevel = aiSummary?.riskLevel || 'green';
  const riskColors = {
    red: { border: '#ef4444', bg: 'rgba(239, 68, 68, 0.08)' },
    amber: { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.06)' },
    green: { border: '#22c55e', bg: 'rgba(34, 197, 94, 0.04)' },
  };
  const colors = riskColors[riskLevel];

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getDisplayDate = () => {
    if (dateMode === 'etd') {
      return etd ? { date: formatDate(etd), label: 'ETD' } : null;
    }
    if (dateMode === 'eta') {
      return eta ? { date: formatDate(eta), label: 'ETA' } : null;
    }
    const now = new Date();
    const etdDate = etd ? new Date(etd) : null;
    const etaDate = eta ? new Date(eta) : null;
    if (etdDate && etdDate > now) {
      return { date: formatDate(etd), label: 'ETD' };
    }
    if (etaDate && etaDate > now) {
      return { date: formatDate(eta), label: 'ETA' };
    }
    return null;
  };

  const displayDate = getDisplayDate();

  return (
    <div
      className="p-3 transition-all duration-200 hover:opacity-90"
      style={{
        backgroundColor: colors.bg,
        borderLeft: `3px solid ${colors.border}`,
        borderRadius: '6px',
      }}
    >
      {/* Line 1: Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <span
            className="font-semibold text-sm"
            style={{ color: 'var(--ink-text)', fontFamily: 'var(--ink-font-mono)' }}
          >
            {bookingNumber || mblNumber || '—'}
          </span>
          <span className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>
            {route.origin || '?'} → {route.destination || '?'}
          </span>
          {carrier && (
            <span
              className="text-xs px-1.5 py-0.5 rounded"
              style={{ backgroundColor: 'var(--ink-elevated)', color: 'var(--ink-text-muted)' }}
            >
              {carrier}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {displayDate && (
            <span
              className="text-xs font-medium px-2 py-1 rounded"
              style={{ backgroundColor: 'var(--ink-elevated)', color: 'var(--ink-text)' }}
            >
              {displayDate.label} {displayDate.date}
            </span>
          )}
          {onViewDetails && (
            <button
              onClick={() => onViewDetails(id)}
              className="p-1 rounded hover:bg-black/10"
              title="View Details"
            >
              <ExternalLink className="h-3.5 w-3.5" style={{ color: 'var(--ink-text-muted)' }} />
            </button>
          )}
        </div>
      </div>

      {/* Line 2: Parties */}
      <div className="text-xs mb-2" style={{ color: 'var(--ink-text-muted)' }}>
        {shipper || 'Shipper'} → {consignee || 'Consignee'}
      </div>

      {/* Line 3: AI Narrative (V2 format) or fallback to legacy */}
      {aiSummary?.narrative ? (
        // V2: Tight narrative with inline owner + insight
        <div className="space-y-2">
          <div className="text-sm leading-relaxed" style={{ color: 'var(--ink-text)' }}>
            {aiSummary.narrative}
          </div>
          {/* Key insight + owner badges */}
          <div className="flex items-center gap-2 flex-wrap">
            {aiSummary.keyInsight && (
              <span
                className="text-xs px-2 py-0.5 rounded"
                style={{
                  backgroundColor: riskLevel === 'red' ? 'rgba(239, 68, 68, 0.15)' : riskLevel === 'amber' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                  color: riskLevel === 'red' ? '#ef4444' : riskLevel === 'amber' ? '#f59e0b' : '#22c55e',
                }}
              >
                {aiSummary.keyInsight}
              </span>
            )}
            {aiSummary.owner && (
              <span
                className="text-xs px-2 py-0.5 rounded"
                style={{
                  backgroundColor: 'var(--ink-elevated)',
                  color: aiSummary.ownerType === 'intoglo' ? '#3b82f6' : 'var(--ink-text-muted)',
                }}
              >
                → {aiSummary.owner}
              </span>
            )}
            {aiSummary.keyDeadline && (
              <span
                className="text-xs px-2 py-0.5 rounded"
                style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}
              >
                ⏰ {aiSummary.keyDeadline}
              </span>
            )}
          </div>
        </div>
      ) : (
        // V1 Legacy: Blocker/Action/Story format
        <>
          {aiSummary?.currentBlocker && (
            <div
              className="p-2 rounded text-sm mb-2"
              style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)' }}
            >
              <span className="font-semibold" style={{ color: '#ef4444' }}>Blocker: </span>
              <span style={{ color: 'var(--ink-text)' }}>{aiSummary.currentBlocker}</span>
              {aiSummary.blockerOwner && (
                <span
                  className="ml-2 text-xs px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#ef4444' }}
                >
                  {aiSummary.blockerOwner}
                </span>
              )}
            </div>
          )}

          {aiSummary?.nextAction && !aiSummary?.currentBlocker && (
            <div
              className="p-2 rounded text-sm mb-2"
              style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)' }}
            >
              <span className="font-semibold" style={{ color: '#3b82f6' }}>Next: </span>
              <span style={{ color: 'var(--ink-text)' }}>{aiSummary.nextAction}</span>
              {aiSummary.actionOwner && (
                <span
                  className="ml-2 text-xs px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: 'rgba(59, 130, 246, 0.15)', color: '#3b82f6' }}
                >
                  {aiSummary.actionOwner}
                </span>
              )}
            </div>
          )}

          {/* Story if no blocker/action */}
          {aiSummary?.story && !aiSummary?.currentBlocker && !aiSummary?.nextAction && (
            <div className="text-sm" style={{ color: 'var(--ink-text-secondary)' }}>
              {aiSummary.story}
            </div>
          )}
        </>
      )}

      {/* FALLBACK: Show journey/recommendation if no AI summary */}
      {!aiSummary && (
        <>
          {/* Journey summary */}
          {journey?.summary && (
            <div className="text-sm mb-2" style={{ color: 'var(--ink-text)' }}>
              {journey.summary}
            </div>
          )}

          {/* Recommendation as next action */}
          {recommendation && (
            <div
              className="p-2 rounded text-sm mb-2"
              style={{
                backgroundColor:
                  recommendation.priority === 'critical'
                    ? 'rgba(239, 68, 68, 0.1)'
                    : recommendation.priority === 'high'
                    ? 'rgba(245, 158, 11, 0.1)'
                    : 'rgba(59, 130, 246, 0.1)',
              }}
            >
              <span
                className="font-semibold"
                style={{
                  color:
                    recommendation.priority === 'critical'
                      ? '#ef4444'
                      : recommendation.priority === 'high'
                      ? '#f59e0b'
                      : '#3b82f6',
                }}
              >
                Action:{' '}
              </span>
              <span style={{ color: 'var(--ink-text)' }}>{recommendation.action}</span>
              <span
                className="ml-2 text-xs px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor:
                    recommendation.priority === 'critical'
                      ? 'rgba(239, 68, 68, 0.2)'
                      : recommendation.priority === 'high'
                      ? 'rgba(245, 158, 11, 0.2)'
                      : 'rgba(59, 130, 246, 0.15)',
                  color:
                    recommendation.priority === 'critical'
                      ? '#ef4444'
                      : recommendation.priority === 'high'
                      ? '#f59e0b'
                      : '#3b82f6',
                }}
              >
                {recommendation.priority}
              </span>
            </div>
          )}

          {/* Issue summary if no recommendation */}
          {!recommendation && issues?.latestSummary && (
            <div
              className="p-2 rounded text-sm mb-2"
              style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}
            >
              <span className="font-semibold" style={{ color: '#ef4444' }}>Issue: </span>
              <span style={{ color: 'var(--ink-text)' }}>{issues.latestSummary}</span>
            </div>
          )}
        </>
      )}

      {/* Financial impact if present */}
      {aiSummary?.financialImpact && (
        <div
          className="p-2 rounded text-sm mt-2"
          style={{ backgroundColor: 'rgba(245, 158, 11, 0.1)' }}
        >
          <span className="font-semibold" style={{ color: '#f59e0b' }}>💰 </span>
          <span style={{ color: 'var(--ink-text)' }}>{aiSummary.financialImpact}</span>
        </div>
      )}

      {/* Risk reason at bottom */}
      {aiSummary?.riskReason && (
        <div className="mt-2 text-xs" style={{ color: 'var(--ink-text-muted)' }}>
          {aiSummary.riskReason}
        </div>
      )}
    </div>
  );
}
