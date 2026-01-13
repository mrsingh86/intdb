'use client';

import { useState } from 'react';
import {
  Lightbulb,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  AlertCircle,
  Info,
  Send,
  Copy,
  Check,
} from 'lucide-react';
import type { ChainOfThoughtRecommendation } from '@/lib/chronicle-v2';

interface ChainOfThoughtPanelProps {
  recommendations: ChainOfThoughtRecommendation[];
  onDraftReply?: (chainId: string | null) => void;
}

// Priority styles
const PRIORITY_STYLES: Record<
  string,
  { label: string; color: string; bgColor: string; icon: typeof AlertTriangle }
> = {
  critical: {
    label: 'Critical',
    color: 'var(--ink-error)',
    bgColor: 'var(--ink-error-bg)',
    icon: AlertTriangle,
  },
  high: {
    label: 'High',
    color: 'var(--ink-warning)',
    bgColor: 'var(--ink-warning-bg)',
    icon: AlertCircle,
  },
  medium: {
    label: 'Medium',
    color: 'var(--ink-info)',
    bgColor: 'var(--ink-info-bg)',
    icon: Info,
  },
  low: {
    label: 'Low',
    color: 'var(--ink-text-muted)',
    bgColor: 'var(--ink-elevated)',
    icon: Info,
  },
};

/**
 * ChainOfThoughtPanel
 *
 * Displays smart recommendations with full chain-of-thought reasoning.
 * Shows the "why" behind each recommendation step by step.
 */
export function ChainOfThoughtPanel({ recommendations, onDraftReply }: ChainOfThoughtPanelProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(0); // First one expanded by default
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  if (recommendations.length === 0) {
    return (
      <div
        className="rounded-lg border p-4"
        style={{
          backgroundColor: 'var(--ink-surface)',
          borderColor: 'var(--ink-border-subtle)',
        }}
      >
        <div className="flex items-center gap-2" style={{ color: 'var(--ink-text-muted)' }}>
          <Lightbulb size={16} />
          <span className="text-sm">No recommendations at this time. Shipment is on track.</span>
        </div>
      </div>
    );
  }

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Lightbulb size={16} style={{ color: 'var(--ink-warning)' }} />
        <span className="text-sm font-medium" style={{ color: 'var(--ink-text-primary)' }}>
          Recommendations ({recommendations.length})
        </span>
      </div>

      {recommendations.map((rec, index) => {
        const priorityStyle = PRIORITY_STYLES[rec.priority] || PRIORITY_STYLES.medium;
        const PriorityIcon = priorityStyle.icon;
        const isExpanded = expandedIndex === index;

        return (
          <div
            key={index}
            className="rounded-lg border transition-all"
            style={{
              backgroundColor: 'var(--ink-surface)',
              borderColor: index === 0 ? priorityStyle.color : 'var(--ink-border-subtle)',
              borderLeftWidth: '3px',
            }}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between p-3 cursor-pointer"
              onClick={() => setExpandedIndex(isExpanded ? null : index)}
            >
              <div className="flex items-center gap-3">
                {/* Priority indicator */}
                <PriorityIcon size={16} style={{ color: priorityStyle.color }} />

                {/* Action */}
                <div>
                  <p
                    className="text-sm font-medium"
                    style={{ color: 'var(--ink-text-primary)' }}
                  >
                    {rec.action}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>
                    {rec.reason}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {/* Priority badge */}
                <span
                  className="text-xs px-2 py-0.5 rounded"
                  style={{ backgroundColor: priorityStyle.bgColor, color: priorityStyle.color }}
                >
                  {priorityStyle.label}
                </span>

                {/* Expand icon */}
                {isExpanded ? (
                  <ChevronDown size={16} style={{ color: 'var(--ink-text-muted)' }} />
                ) : (
                  <ChevronRight size={16} style={{ color: 'var(--ink-text-muted)' }} />
                )}
              </div>
            </div>

            {/* Expanded content - Chain of thought */}
            {isExpanded && (
              <div
                className="border-t px-3 py-3"
                style={{ borderColor: 'var(--ink-border-subtle)' }}
              >
                {/* Chain of thought reasoning */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium" style={{ color: 'var(--ink-text-muted)' }}>
                      Chain of Thought
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleCopy(rec.chainOfThought, index);
                      }}
                      className="text-xs flex items-center gap-1 px-2 py-1 rounded transition-colors"
                      style={{
                        backgroundColor: 'var(--ink-elevated)',
                        color: 'var(--ink-text-muted)',
                      }}
                    >
                      {copiedIndex === index ? (
                        <>
                          <Check size={12} />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy size={12} />
                          Copy
                        </>
                      )}
                    </button>
                  </div>

                  <div
                    className="p-3 rounded font-mono text-xs whitespace-pre-wrap"
                    style={{
                      backgroundColor: 'var(--ink-elevated)',
                      color: 'var(--ink-text-secondary)',
                    }}
                  >
                    {rec.chainOfThought}
                  </div>
                </div>

                {/* Suggested recipients */}
                {rec.suggestedRecipients.length > 0 && (
                  <div className="mb-3">
                    <span className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>
                      Suggested recipients:{' '}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--ink-text-secondary)' }}>
                      {rec.suggestedRecipients.join(', ')}
                    </span>
                  </div>
                )}

                {/* Draft reply button */}
                {onDraftReply && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDraftReply(rec.relatedChainId);
                    }}
                    className="flex items-center gap-2 text-xs px-3 py-2 rounded transition-colors"
                    style={{
                      backgroundColor: 'var(--ink-accent-bg)',
                      color: 'var(--ink-accent)',
                    }}
                  >
                    <Send size={12} />
                    Draft Reply
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
