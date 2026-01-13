'use client';

import { useState } from 'react';
import {
  Ship,
  Truck,
  Building2,
  User,
  MessageCircle,
  Clock,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Send,
  Mail,
  Users,
  Briefcase,
} from 'lucide-react';
import type { StakeholderSummary, PartyRole } from '@/lib/chronicle-v2';

interface StakeholderCardProps {
  stakeholder: StakeholderSummary;
  onFollowUp?: (stakeholderId: string) => void;
  onDraftEmail?: (stakeholder: StakeholderSummary) => void;
}

// Party role styles and labels
const PARTY_ROLE_STYLES: Record<PartyRole, { label: string; color: string; bgColor: string; icon: typeof Briefcase }> = {
  vendor: {
    label: 'Vendor',
    color: 'var(--ink-info)',
    bgColor: 'var(--ink-info-bg)',
    icon: Truck,
  },
  customer: {
    label: 'Customer',
    color: 'var(--ink-success)',
    bgColor: 'var(--ink-success-bg)',
    icon: User,
  },
  partner: {
    label: 'Partner',
    color: 'var(--ink-accent)',
    bgColor: 'var(--ink-accent-bg)',
    icon: Ship,
  },
  internal: {
    label: 'Internal',
    color: 'var(--ink-text-muted)',
    bgColor: 'var(--ink-elevated)',
    icon: Users,
  },
};

// Party type icons
const PARTY_TYPE_ICONS: Record<string, typeof Ship> = {
  carrier: Ship,
  ocean_carrier: Ship,
  nvocc: Ship,
  trucker: Truck,
  customs_broker: Building2,
  broker: Building2,
  warehouse: Building2,
  terminal: Building2,
  customer: User,
  shipper: User,
  consignee: User,
};

// Behavior pattern styles
const BEHAVIOR_STYLES: Record<string, { label: string; color: string; icon: typeof TrendingUp }> = {
  excellent: { label: 'Excellent', color: 'var(--ink-success)', icon: TrendingUp },
  responsive: { label: 'Responsive', color: 'var(--ink-success)', icon: TrendingUp },
  standard: { label: 'Standard', color: 'var(--ink-text-secondary)', icon: Minus },
  slow: { label: 'Slow', color: 'var(--ink-warning)', icon: TrendingDown },
  problematic: { label: 'Problematic', color: 'var(--ink-error)', icon: TrendingDown },
  unknown: { label: 'Unknown', color: 'var(--ink-text-muted)', icon: Minus },
};

// Sentiment styles
const SENTIMENT_STYLES: Record<string, { color: string }> = {
  positive: { color: 'var(--ink-success)' },
  neutral: { color: 'var(--ink-text-secondary)' },
  negative: { color: 'var(--ink-error)' },
  mixed: { color: 'var(--ink-warning)' },
};

/**
 * StakeholderCard
 *
 * Displays stakeholder interaction summary with:
 * - Clear role label (Vendor/Customer/Partner/Internal)
 * - Company name and party type
 * - Communication stats and response behavior
 * - Sentiment tracking
 * - Draft email capability
 */
export function StakeholderCard({ stakeholder, onFollowUp, onDraftEmail }: StakeholderCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const partyRole = stakeholder.partyRole || 'vendor';
  const roleStyle = PARTY_ROLE_STYLES[partyRole];
  const RoleIcon = roleStyle.icon;

  const TypeIcon = PARTY_TYPE_ICONS[stakeholder.partyType] || Building2;
  const behaviorStyle = BEHAVIOR_STYLES[stakeholder.responsiveness.behaviorPattern] || BEHAVIOR_STYLES.unknown;
  const BehaviorIcon = behaviorStyle.icon;
  const sentimentStyle = stakeholder.sentiment.overall ? SENTIMENT_STYLES[stakeholder.sentiment.overall] : null;

  // Format date
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Format response time
  const formatResponseTime = (hours: number | null) => {
    if (hours === null) return '—';
    if (hours < 1) return '<1h';
    if (hours < 24) return `${Math.round(hours)}h`;
    return `${Math.round(hours / 24)}d`;
  };

  // Format party type for display
  const formatPartyType = (type: string) => {
    const typeMap: Record<string, string> = {
      ocean_carrier: 'Shipping Line',
      customs_broker: 'Customs Broker',
      trucker: 'Trucker',
      carrier: 'Carrier',
      nvocc: 'NVOCC',
      terminal: 'Terminal',
      warehouse: 'Warehouse',
      shipper: 'Shipper',
      consignee: 'Consignee',
      customer: 'Customer',
    };
    return typeMap[type] || type.replace(/_/g, ' ');
  };

  // Has pending issues or needs attention
  const needsAttention = stakeholder.responsiveness.unansweredCount > 0 ||
    (stakeholder.stats.daysSinceLastContact !== null && stakeholder.stats.daysSinceLastContact > 5);

  // Calculate pending actions summary
  const pendingActions = stakeholder.actions.requested - stakeholder.actions.completed;

  return (
    <div
      className="rounded-lg border transition-all"
      style={{
        backgroundColor: 'var(--ink-surface)',
        borderColor: needsAttention ? 'var(--ink-warning)' : 'var(--ink-border-subtle)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-3 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          {/* Party type icon */}
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ backgroundColor: roleStyle.bgColor }}
          >
            <TypeIcon size={18} style={{ color: roleStyle.color }} />
          </div>

          {/* Name, role, and type */}
          <div>
            <div className="flex items-center gap-2">
              <span
                className="text-sm font-medium"
                style={{ color: 'var(--ink-text-primary)' }}
              >
                {stakeholder.companyName || stakeholder.displayName}
              </span>
              {/* Role badge */}
              <span
                className="text-[10px] px-1.5 py-0.5 rounded uppercase font-medium"
                style={{ backgroundColor: roleStyle.bgColor, color: roleStyle.color }}
              >
                {roleStyle.label}
              </span>
              {needsAttention && (
                <AlertCircle size={14} style={{ color: 'var(--ink-warning)' }} />
              )}
            </div>
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--ink-text-muted)' }}>
              <span>{formatPartyType(stakeholder.partyType)}</span>
              {stakeholder.contactEmail && (
                <>
                  <span>•</span>
                  <span className="truncate max-w-[150px]">{stakeholder.contactEmail}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Quick stats */}
          <div className="flex items-center gap-3 text-xs">
            {stakeholder.stats.daysSinceLastContact !== null && (
              <span style={{ color: 'var(--ink-text-muted)' }}>
                {stakeholder.stats.daysSinceLastContact === 0
                  ? 'Today'
                  : `${stakeholder.stats.daysSinceLastContact}d ago`}
              </span>
            )}
            <span
              className="flex items-center gap-1"
              style={{ color: behaviorStyle.color }}
            >
              <BehaviorIcon size={12} />
              {formatResponseTime(stakeholder.responsiveness.avgResponseHours)}
            </span>
          </div>

          {/* Draft email button (visible on hover or always if needs attention) */}
          {onDraftEmail && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDraftEmail(stakeholder);
              }}
              className="p-2 rounded transition-colors opacity-70 hover:opacity-100"
              style={{ backgroundColor: 'var(--ink-elevated)' }}
              title="Draft email"
            >
              <Mail size={14} style={{ color: 'var(--ink-accent)' }} />
            </button>
          )}

          {/* Expand icon */}
          {isExpanded ? (
            <ChevronDown size={16} style={{ color: 'var(--ink-text-muted)' }} />
          ) : (
            <ChevronRight size={16} style={{ color: 'var(--ink-text-muted)' }} />
          )}
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div
          className="border-t px-3 py-3"
          style={{ borderColor: 'var(--ink-border-subtle)' }}
        >
          {/* Stats grid */}
          <div className="grid grid-cols-5 gap-3 mb-3">
            <div>
              <span className="text-xs block" style={{ color: 'var(--ink-text-muted)' }}>
                Emails
              </span>
              <span className="text-sm font-medium" style={{ color: 'var(--ink-text-primary)' }}>
                {stakeholder.stats.totalEmails}
              </span>
            </div>
            <div>
              <span className="text-xs block" style={{ color: 'var(--ink-text-muted)' }}>
                Avg Response
              </span>
              <span
                className="text-sm font-medium"
                style={{ color: behaviorStyle.color }}
              >
                {formatResponseTime(stakeholder.responsiveness.avgResponseHours)}
              </span>
            </div>
            <div>
              <span className="text-xs block" style={{ color: 'var(--ink-text-muted)' }}>
                Unanswered
              </span>
              <span
                className="text-sm font-medium"
                style={{
                  color: stakeholder.responsiveness.unansweredCount > 0
                    ? 'var(--ink-warning)'
                    : 'var(--ink-text-primary)',
                }}
              >
                {stakeholder.responsiveness.unansweredCount}
              </span>
            </div>
            <div>
              <span className="text-xs block" style={{ color: 'var(--ink-text-muted)' }}>
                Pending Actions
              </span>
              <span
                className="text-sm font-medium"
                style={{
                  color: pendingActions > 0 ? 'var(--ink-warning)' : 'var(--ink-text-primary)',
                }}
              >
                {pendingActions}
              </span>
            </div>
            <div>
              <span className="text-xs block" style={{ color: 'var(--ink-text-muted)' }}>
                Sentiment
              </span>
              <span
                className="text-sm font-medium capitalize"
                style={{ color: sentimentStyle?.color || 'var(--ink-text-primary)' }}
              >
                {stakeholder.sentiment.overall || '—'}
              </span>
            </div>
          </div>

          {/* Behavior pattern */}
          <div
            className="flex items-center gap-2 mb-3 p-2 rounded"
            style={{ backgroundColor: 'var(--ink-elevated)' }}
          >
            <BehaviorIcon size={14} style={{ color: behaviorStyle.color }} />
            <span className="text-xs font-medium" style={{ color: behaviorStyle.color }}>
              {behaviorStyle.label}
            </span>
            {stakeholder.responsiveness.behaviorNotes && (
              <span className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>
                — {stakeholder.responsiveness.behaviorNotes}
              </span>
            )}
          </div>

          {/* Issues involvement */}
          {(stakeholder.issues.raised > 0 || stakeholder.issues.types.length > 0) && (
            <div className="mb-3">
              <span className="text-xs block mb-1" style={{ color: 'var(--ink-text-muted)' }}>
                Issues Involvement
              </span>
              <div className="flex items-center gap-2 text-xs">
                <span style={{ color: 'var(--ink-text-secondary)' }}>
                  {stakeholder.issues.raised} raised / {stakeholder.issues.resolved} resolved
                </span>
                {stakeholder.issues.types.length > 0 && (
                  <span style={{ color: 'var(--ink-text-muted)' }}>
                    ({stakeholder.issues.types.join(', ')})
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Recent communications */}
          {stakeholder.recentCommunications.length > 0 && (
            <div>
              <span className="text-xs block mb-2" style={{ color: 'var(--ink-text-muted)' }}>
                Recent Communications
              </span>
              <div className="space-y-2">
                {stakeholder.recentCommunications.slice(0, 3).map((comm) => (
                  <div
                    key={comm.chronicleId}
                    className="flex items-start gap-2 text-xs"
                  >
                    <MessageCircle
                      size={12}
                      style={{
                        color: comm.direction === 'inbound'
                          ? 'var(--ink-info)'
                          : 'var(--ink-text-muted)',
                      }}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span style={{ color: 'var(--ink-text-muted)' }}>
                          {formatDate(comm.date)}
                        </span>
                        {comm.hasPendingAction && (
                          <span
                            className="px-1 py-0.5 rounded text-[10px]"
                            style={{
                              backgroundColor: 'var(--ink-warning-bg)',
                              color: 'var(--ink-warning)',
                            }}
                          >
                            Action Pending
                          </span>
                        )}
                      </div>
                      <p
                        className="truncate"
                        style={{ color: 'var(--ink-text-secondary)' }}
                      >
                        {comm.summary}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-3 pt-3 border-t flex items-center gap-2" style={{ borderColor: 'var(--ink-border-subtle)' }}>
            {onDraftEmail && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDraftEmail(stakeholder);
                }}
                className="flex items-center gap-2 text-xs px-3 py-1.5 rounded transition-colors"
                style={{
                  backgroundColor: 'var(--ink-accent-bg)',
                  color: 'var(--ink-accent)',
                }}
              >
                <Send size={12} />
                Draft Email
              </button>
            )}
            {needsAttention && onFollowUp && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onFollowUp(stakeholder.id);
                }}
                className="text-xs px-3 py-1.5 rounded transition-colors"
                style={{
                  backgroundColor: 'var(--ink-warning-bg)',
                  color: 'var(--ink-warning)',
                }}
              >
                Follow Up
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
