'use client';

import { useState } from 'react';
import {
  AlertTriangle,
  Clock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Link2,
  User,
  Calendar,
  ArrowDown,
} from 'lucide-react';
import type { NarrativeChain } from '@/lib/chronicle-v2';

interface NarrativeChainCardProps {
  chain: NarrativeChain;
  onResolve?: (chainId: string) => void;
}

// Chain type labels and icons
const CHAIN_TYPE_CONFIG: Record<
  string,
  { label: string; color: string; bgColor: string }
> = {
  issue_to_action: {
    label: 'Issue Chain',
    color: 'var(--ink-error)',
    bgColor: 'var(--ink-error-bg)',
  },
  delay_chain: {
    label: 'Delay Chain',
    color: 'var(--ink-warning)',
    bgColor: 'var(--ink-warning-bg)',
  },
  communication_chain: {
    label: 'Pending Response',
    color: 'var(--ink-info)',
    bgColor: 'var(--ink-info-bg)',
  },
  escalation_chain: {
    label: 'Escalation',
    color: 'var(--ink-error)',
    bgColor: 'var(--ink-error-bg)',
  },
  document_chain: {
    label: 'Document',
    color: 'var(--ink-text-secondary)',
    bgColor: 'var(--ink-elevated)',
  },
  action_to_resolution: {
    label: 'Action Chain',
    color: 'var(--ink-info)',
    bgColor: 'var(--ink-info-bg)',
  },
};

/**
 * NarrativeChainCard
 *
 * Displays a single narrative chain with trigger, events, and resolution status.
 * Shows the cause-effect chain visually.
 */
export function NarrativeChainCard({ chain, onResolve }: NarrativeChainCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const config = CHAIN_TYPE_CONFIG[chain.chainType] || CHAIN_TYPE_CONFIG.issue_to_action;
  const isActive = chain.chainStatus === 'active';

  // Format date
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Format party name
  const formatParty = (party: string | null) => {
    if (!party) return 'Unknown';
    const partyMap: Record<string, string> = {
      carrier: 'Shipping Line',
      ocean_carrier: 'Shipping Line',
      customer: 'Customer',
      broker: 'Customs Broker',
      customs_broker: 'Customs Broker',
      trucker: 'Trucker',
      terminal: 'Terminal',
      intoglo: 'Operations',
      operations: 'Operations',
    };
    return partyMap[party] || party;
  };

  return (
    <div
      className="rounded-lg border transition-all"
      style={{
        backgroundColor: 'var(--ink-surface)',
        borderColor: isActive ? config.color : 'var(--ink-border-subtle)',
        borderLeftWidth: '3px',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between p-3 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          {/* Status indicator */}
          {isActive ? (
            <AlertTriangle size={16} style={{ color: config.color }} />
          ) : (
            <CheckCircle2 size={16} style={{ color: 'var(--ink-success)' }} />
          )}

          {/* Chain type badge */}
          <span
            className="text-xs font-medium px-2 py-0.5 rounded"
            style={{ backgroundColor: config.bgColor, color: config.color }}
          >
            {config.label}
          </span>

          {/* Headline */}
          <span
            className="text-sm font-medium"
            style={{ color: 'var(--ink-text-primary)' }}
          >
            {chain.narrativeHeadline || chain.trigger.eventType}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Days indicator */}
          {isActive && chain.daysInCurrentState > 0 && (
            <span
              className="text-xs flex items-center gap-1"
              style={{ color: 'var(--ink-text-muted)' }}
            >
              <Clock size={12} />
              {chain.daysInCurrentState}d in state
            </span>
          )}

          {/* Expand icon */}
          {isExpanded ? (
            <ChevronDown size={16} style={{ color: 'var(--ink-text-muted)' }} />
          ) : (
            <ChevronRight size={16} style={{ color: 'var(--ink-text-muted)' }} />
          )}
        </div>
      </div>

      {/* Summary (always visible) */}
      <div className="px-3 pb-3">
        <p className="text-sm" style={{ color: 'var(--ink-text-secondary)' }}>
          {chain.narrativeSummary || chain.currentState}
        </p>

        {/* Awaiting info */}
        {isActive && chain.currentStateParty && (
          <div
            className="flex items-center gap-2 mt-2 text-xs"
            style={{ color: 'var(--ink-text-muted)' }}
          >
            <User size={12} />
            <span>Awaiting: {formatParty(chain.currentStateParty)}</span>
          </div>
        )}
      </div>

      {/* Expanded content - Chain of events */}
      {isExpanded && (
        <div
          className="border-t px-3 py-3"
          style={{ borderColor: 'var(--ink-border-subtle)' }}
        >
          {/* Trigger event */}
          <div className="flex items-start gap-3 mb-3">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: config.bgColor }}
            >
              <Link2 size={12} style={{ color: config.color }} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className="text-xs font-medium"
                  style={{ color: 'var(--ink-text-muted)' }}
                >
                  {formatDate(chain.trigger.occurredAt)}
                </span>
                <span
                  className="text-xs"
                  style={{ color: 'var(--ink-text-muted)' }}
                >
                  {formatParty(chain.trigger.party)}
                </span>
              </div>
              <p
                className="text-sm mt-0.5"
                style={{ color: 'var(--ink-text-primary)' }}
              >
                {chain.trigger.summary}
              </p>
            </div>
          </div>

          {/* Chain events */}
          {chain.events.length > 0 && (
            <div className="ml-3 pl-3 border-l" style={{ borderColor: 'var(--ink-border-subtle)' }}>
              {chain.events.map((event, index) => (
                <div key={event.chronicleId} className="flex items-start gap-3 mb-3">
                  <ArrowDown size={12} style={{ color: 'var(--ink-text-muted)' }} className="mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs font-medium"
                        style={{ color: 'var(--ink-text-muted)' }}
                      >
                        {formatDate(event.occurredAt)}
                      </span>
                      <span
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: 'var(--ink-elevated)',
                          color: 'var(--ink-text-muted)',
                        }}
                      >
                        +{event.daysFromTrigger}d
                      </span>
                    </div>
                    <p
                      className="text-sm mt-0.5"
                      style={{ color: 'var(--ink-text-secondary)' }}
                    >
                      {event.summary}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Impact section */}
          {(chain.impact.delayDays || chain.impact.affectedParties.length > 0) && (
            <div
              className="mt-3 pt-3 border-t"
              style={{ borderColor: 'var(--ink-border-subtle)' }}
            >
              <div className="flex items-center gap-4 text-xs">
                {chain.impact.delayDays && (
                  <span style={{ color: 'var(--ink-warning)' }}>
                    Est. delay: {chain.impact.delayDays} days
                  </span>
                )}
                {chain.impact.affectedParties.length > 0 && (
                  <span style={{ color: 'var(--ink-text-muted)' }}>
                    Affects: {chain.impact.affectedParties.join(', ')}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Resolution deadline */}
          {isActive && chain.resolution.deadline && (
            <div
              className="mt-3 pt-3 border-t flex items-center gap-2 text-xs"
              style={{ borderColor: 'var(--ink-border-subtle)', color: 'var(--ink-text-muted)' }}
            >
              <Calendar size={12} />
              <span>
                Resolution deadline: {formatDate(chain.resolution.deadline)}
              </span>
            </div>
          )}

          {/* Resolve button */}
          {isActive && onResolve && (
            <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--ink-border-subtle)' }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onResolve(chain.id);
                }}
                className="text-xs px-3 py-1.5 rounded transition-colors"
                style={{
                  backgroundColor: 'var(--ink-elevated)',
                  color: 'var(--ink-text-secondary)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--ink-hover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--ink-elevated)';
                }}
              >
                Mark as Resolved
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
