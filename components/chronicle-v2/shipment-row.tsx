'use client';

import {
  AlertCircle,
  ArrowRight,
  ChevronRight,
  Calendar,
  Lightbulb,
  BookOpen,
  DollarSign,
  Users,
  Ship,
} from 'lucide-react';
import { type ShipmentListItem } from '@/lib/chronicle-v2';

interface ShipmentRowProps {
  shipment: ShipmentListItem;
  onClick: () => void;
  isExpanded?: boolean;
}

// Risk level colors
const RISK_COLORS: Record<string, { bg: string; text: string; border: string; dot: string }> = {
  red: { bg: 'var(--ink-error-bg)', text: 'var(--ink-error)', border: 'var(--ink-error)', dot: 'var(--ink-error)' },
  amber: { bg: 'var(--ink-warning-bg)', text: 'var(--ink-warning)', border: 'var(--ink-warning)', dot: 'var(--ink-warning)' },
  green: { bg: 'var(--ink-success-bg)', text: 'var(--ink-success)', border: 'var(--ink-success)', dot: 'var(--ink-success)' },
};

// Priority colors for actions
const PRIORITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: 'var(--ink-error-bg)', text: 'var(--ink-error)', border: 'var(--ink-error)' },
  high: { bg: 'var(--ink-warning-bg)', text: 'var(--ink-warning)', border: 'var(--ink-warning)' },
  medium: { bg: 'var(--ink-info-bg)', text: 'var(--ink-info)', border: 'var(--ink-info)' },
  low: { bg: 'var(--ink-elevated)', text: 'var(--ink-text-muted)', border: 'var(--ink-border)' },
};

/**
 * ShipmentRow Component - Intelligent Story Telling
 *
 * Displays AI-powered shipment intelligence with tiered context:
 * - Story: Full narrative with specific names, dates, amounts
 * - Blocker: What's stopping progress NOW with owner
 * - Financial Impact: Specific charges at risk
 * - Customer Impact: How customer is affected
 * - Next Action: Specific action with deadline and owner
 */
export function ShipmentRow({ shipment, onClick, isExpanded }: ShipmentRowProps) {
  const {
    bookingNumber,
    mblNumber,
    route,
    shipper,
    consignee,
    etd,
    eta,
    vessel,
    carrier,
    attentionScore,
    signalTier,
    journey,
    aiSummary,
  } = shipment;

  // Format date
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Get attention dot color - prefer AI risk level, fallback to signal tier
  const getAttentionColor = () => {
    if (aiSummary?.riskLevel) {
      return RISK_COLORS[aiSummary.riskLevel]?.dot || 'var(--ink-text-muted)';
    }
    switch (signalTier) {
      case 'strong':
        return 'var(--ink-error)';
      case 'medium':
        return 'var(--ink-warning)';
      default:
        return 'var(--ink-text-muted)';
    }
  };

  // Truncate text with smart word boundary
  const truncate = (text: string | null, maxLen: number) => {
    if (!text) return null;
    if (text.length <= maxLen) return text;
    const truncated = text.slice(0, maxLen);
    const lastSpace = truncated.lastIndexOf(' ');
    return (lastSpace > maxLen * 0.7 ? truncated.slice(0, lastSpace) : truncated) + '...';
  };

  // Get display data - AI summary takes priority
  const story = aiSummary?.story || journey.summary;
  const currentBlocker = aiSummary?.currentBlocker;
  const blockerOwner = aiSummary?.blockerOwner;
  const nextAction = aiSummary?.nextAction;
  const actionPriority = aiSummary?.actionPriority || 'medium';
  const actionOwner = aiSummary?.actionOwner;
  const financialImpact = aiSummary?.financialImpact;
  const customerImpact = aiSummary?.customerImpact;
  const riskLevel = aiSummary?.riskLevel || 'green';
  const riskReason = aiSummary?.riskReason;

  // Determine if shipment needs attention
  const needsAttention = riskLevel === 'red' || riskLevel === 'amber' || currentBlocker || nextAction;

  return (
    <div
      onClick={onClick}
      className="group cursor-pointer rounded-lg border p-4 transition-all"
      style={{
        backgroundColor: isExpanded ? 'var(--ink-elevated)' : 'var(--ink-surface)',
        borderColor: isExpanded ? 'var(--ink-border)' : 'var(--ink-border-subtle)',
      }}
      onMouseEnter={(e) => {
        if (!isExpanded) {
          e.currentTarget.style.backgroundColor = 'var(--ink-elevated)';
          e.currentTarget.style.borderColor = 'var(--ink-border)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isExpanded) {
          e.currentTarget.style.backgroundColor = 'var(--ink-surface)';
          e.currentTarget.style.borderColor = 'var(--ink-border-subtle)';
        }
      }}
    >
      {/* Row 1: Booking, Route, Dates, Carrier */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Risk Indicator Dot */}
          <div
            className="h-2.5 w-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: getAttentionColor() }}
            title={`Risk: ${riskLevel}${riskReason ? ` - ${riskReason}` : ''}`}
          />

          {/* Booking Number */}
          <span
            className="font-semibold"
            style={{
              color: 'var(--ink-text)',
              fontFamily: 'var(--ink-font-mono)',
              fontSize: '14px',
            }}
          >
            {bookingNumber || mblNumber || '—'}
          </span>

          {/* Route */}
          <div className="flex items-center gap-1.5" style={{ color: 'var(--ink-text-secondary)' }}>
            <span className="text-sm font-medium">{route.origin || '—'}</span>
            <ArrowRight className="h-3 w-3" style={{ color: 'var(--ink-text-muted)' }} />
            <span className="text-sm font-medium">{route.destination || '—'}</span>
          </div>

          {/* Carrier badge */}
          {carrier && (
            <span
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs"
              style={{
                backgroundColor: 'var(--ink-elevated)',
                color: 'var(--ink-text-muted)',
              }}
            >
              <Ship className="h-3 w-3" />
              {carrier}
            </span>
          )}

          {/* ETD → ETA */}
          <div className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--ink-text-muted)' }}>
            <Calendar className="h-3 w-3" />
            <span>{formatDate(etd)}</span>
            {eta && (
              <>
                <ArrowRight className="h-2.5 w-2.5" />
                <span>{formatDate(eta)}</span>
              </>
            )}
          </div>
        </div>

        {/* Chevron */}
        <ChevronRight
          className={`h-5 w-5 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
          style={{ color: 'var(--ink-text-muted)' }}
        />
      </div>

      {/* Row 2: Shipper → Consignee + Vessel */}
      <div
        className="mt-1.5 flex items-center justify-between text-sm"
        style={{ marginLeft: '22px' }}
      >
        <div className="flex items-center gap-1.5" style={{ color: 'var(--ink-text-secondary)' }}>
          <span>{truncate(shipper, 25) || '—'}</span>
          <ArrowRight className="h-3 w-3" style={{ color: 'var(--ink-text-muted)' }} />
          <span>{truncate(consignee, 25) || '—'}</span>
        </div>
        {vessel && (
          <span className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>
            {vessel}
          </span>
        )}
      </div>

      {/* Row 3: AI STORY - Full narrative with specific details */}
      {story && (
        <div
          className="mt-3 flex items-start gap-2 p-3 rounded-md"
          style={{
            backgroundColor: 'var(--ink-elevated)',
            marginLeft: '22px',
          }}
        >
          <BookOpen
            className="h-4 w-4 flex-shrink-0 mt-0.5"
            style={{ color: 'var(--ink-accent)' }}
          />
          <div className="flex-1 min-w-0">
            <span className="text-sm leading-relaxed" style={{ color: 'var(--ink-text)' }}>
              {truncate(story, 280)}
            </span>
          </div>
        </div>
      )}

      {/* Row 4: CURRENT BLOCKER with specific owner */}
      {currentBlocker && (
        <div
          className="mt-2 flex items-start gap-2 p-3 rounded-md"
          style={{
            backgroundColor: RISK_COLORS[riskLevel]?.bg || 'var(--ink-error-bg)',
            borderLeft: `3px solid ${RISK_COLORS[riskLevel]?.border || 'var(--ink-error)'}`,
            marginLeft: '22px',
          }}
        >
          <AlertCircle
            className="h-4 w-4 flex-shrink-0 mt-0.5"
            style={{ color: RISK_COLORS[riskLevel]?.text || 'var(--ink-error)' }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="text-xs font-semibold uppercase"
                style={{ color: RISK_COLORS[riskLevel]?.text || 'var(--ink-error)' }}
              >
                Blocker
              </span>
              {blockerOwner && (
                <span
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: 'rgba(0,0,0,0.2)',
                    color: RISK_COLORS[riskLevel]?.text || 'var(--ink-error)',
                  }}
                >
                  {blockerOwner}
                </span>
              )}
            </div>
            <p className="text-sm mt-1" style={{ color: 'var(--ink-text)' }}>
              {currentBlocker}
            </p>
          </div>
        </div>
      )}

      {/* Row 5: FINANCIAL IMPACT with specific amounts */}
      {financialImpact && (
        <div
          className="mt-2 flex items-start gap-2 p-2.5 rounded-md"
          style={{
            backgroundColor: 'var(--ink-warning-bg)',
            borderLeft: '3px solid var(--ink-warning)',
            marginLeft: '22px',
          }}
        >
          <DollarSign
            className="h-4 w-4 flex-shrink-0 mt-0.5"
            style={{ color: 'var(--ink-warning)' }}
          />
          <div className="flex-1 min-w-0">
            <span
              className="text-xs font-semibold uppercase"
              style={{ color: 'var(--ink-warning)' }}
            >
              Financial Risk
            </span>
            <p className="text-sm mt-0.5" style={{ color: 'var(--ink-text)' }}>
              {financialImpact}
            </p>
          </div>
        </div>
      )}

      {/* Row 6: CUSTOMER IMPACT */}
      {customerImpact && (
        <div
          className="mt-2 flex items-start gap-2 p-2.5 rounded-md"
          style={{
            backgroundColor: 'var(--ink-info-bg)',
            borderLeft: '3px solid var(--ink-info)',
            marginLeft: '22px',
          }}
        >
          <Users
            className="h-4 w-4 flex-shrink-0 mt-0.5"
            style={{ color: 'var(--ink-info)' }}
          />
          <div className="flex-1 min-w-0">
            <span
              className="text-xs font-semibold uppercase"
              style={{ color: 'var(--ink-info)' }}
            >
              Customer Impact
            </span>
            <p className="text-sm mt-0.5" style={{ color: 'var(--ink-text)' }}>
              {customerImpact}
            </p>
          </div>
        </div>
      )}

      {/* Row 7: RECOMMENDED NEXT ACTION with specific deadline */}
      {nextAction && (
        <div
          className="mt-2 flex items-start gap-2 p-3 rounded-md"
          style={{
            backgroundColor: PRIORITY_COLORS[actionPriority]?.bg || 'var(--ink-elevated)',
            borderLeft: `3px solid ${PRIORITY_COLORS[actionPriority]?.border || 'var(--ink-border)'}`,
            marginLeft: '22px',
          }}
        >
          <Lightbulb
            className="h-4 w-4 flex-shrink-0 mt-0.5"
            style={{ color: PRIORITY_COLORS[actionPriority]?.text || 'var(--ink-text-muted)' }}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className="text-xs font-semibold uppercase"
                style={{ color: PRIORITY_COLORS[actionPriority]?.text || 'var(--ink-text-muted)' }}
              >
                Next Action
              </span>
              <span
                className="text-xs px-1.5 py-0.5 rounded font-medium"
                style={{
                  backgroundColor: 'rgba(0,0,0,0.15)',
                  color: PRIORITY_COLORS[actionPriority]?.text || 'var(--ink-text-muted)',
                }}
              >
                {actionPriority}
              </span>
              {actionOwner && (
                <span
                  className="text-xs px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: 'rgba(0,0,0,0.1)',
                    color: PRIORITY_COLORS[actionPriority]?.text || 'var(--ink-text-muted)',
                  }}
                >
                  {actionOwner}
                </span>
              )}
            </div>
            <p className="text-sm font-medium mt-1" style={{ color: 'var(--ink-text)' }}>
              {nextAction}
            </p>
            {riskReason && (
              <p className="text-xs mt-1.5" style={{ color: 'var(--ink-text-muted)' }}>
                {riskReason}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Row 8: All Clear State */}
      {!needsAttention && (
        <div
          className="mt-3 flex items-center gap-2 p-2.5 rounded-md text-sm"
          style={{
            backgroundColor: 'var(--ink-success-bg)',
            color: 'var(--ink-success)',
            marginLeft: '22px',
          }}
        >
          <span className="font-medium">On track</span>
          <span style={{ color: 'var(--ink-text-muted)' }}>— {journey.stageLabel}</span>
        </div>
      )}
    </div>
  );
}
