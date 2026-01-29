'use client';

import { useState } from 'react';
import { AlertCircle, Clock, Paperclip, ChevronRight, ChevronDown } from 'lucide-react';
import { type TimelineItem } from '@/lib/chronicle-v2';

interface DocumentTimelineProps {
  timeline: TimelineItem[];
  onDocumentClick: (docId: string) => void;
  maxItems?: number;
  showAll?: boolean;
}

/**
 * DocumentTimeline Component
 *
 * Displays a vertical timeline of documents for a shipment.
 * Issues and actions are highlighted inline.
 */
export function DocumentTimeline({
  timeline,
  onDocumentClick,
  maxItems = 10,
  showAll: initialShowAll = false,
}: DocumentTimelineProps) {
  const [expanded, setExpanded] = useState(initialShowAll);
  const showAll = expanded || initialShowAll;
  const displayItems = showAll ? timeline : timeline.slice(0, maxItems);
  const hasMore = !showAll && timeline.length > maxItems;

  // Format date
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Format relative time
  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return 'Just now';
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDate(dateStr);
  };

  if (timeline.length === 0) {
    return (
      <div
        className="rounded-lg border p-8 text-center"
        style={{
          backgroundColor: 'var(--ink-surface)',
          borderColor: 'var(--ink-border-subtle)',
        }}
      >
        <p style={{ color: 'var(--ink-text-muted)' }}>No documents yet</p>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Timeline line */}
      <div
        className="absolute left-3 top-0 bottom-0 w-px"
        style={{ backgroundColor: 'var(--ink-border-subtle)' }}
      />

      {/* Timeline items */}
      <div className="space-y-1">
        {displayItems.map((item, index) => (
          <div
            key={item.id}
            onClick={() => onDocumentClick(item.id)}
            className="group relative cursor-pointer rounded-lg p-3 pl-8 transition-colors"
            style={{ backgroundColor: 'transparent' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--ink-surface)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            {/* Timeline dot */}
            <div
              className="absolute left-1.5 top-4 h-3 w-3 rounded-full border-2"
              style={{
                backgroundColor: index === 0 ? 'var(--ink-accent)' : 'var(--ink-bg)',
                borderColor: index === 0 ? 'var(--ink-accent)' : 'var(--ink-border)',
              }}
            />

            {/* Content */}
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                {/* Document type and time */}
                <div className="flex items-center gap-2">
                  <span
                    className="text-sm font-medium"
                    style={{ color: 'var(--ink-text)' }}
                  >
                    {item.type}
                  </span>
                  <span
                    className="text-xs"
                    style={{ color: 'var(--ink-text-muted)' }}
                  >
                    {formatRelativeTime(item.occurredAt)}
                  </span>

                  {/* Badges */}
                  {item.hasIssue && (
                    <span
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs"
                      style={{
                        backgroundColor: 'var(--ink-error-bg)',
                        color: 'var(--ink-error)',
                      }}
                    >
                      <AlertCircle className="h-3 w-3" />
                      {item.issueType || 'Issue'}
                    </span>
                  )}
                  {item.hasAction && (
                    <span
                      className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs"
                      style={{
                        backgroundColor: 'var(--ink-warning-bg)',
                        color: 'var(--ink-warning)',
                      }}
                    >
                      <Clock className="h-3 w-3" />
                      Action
                    </span>
                  )}
                </div>

                {/* Subject */}
                <p
                  className="mt-1 truncate text-sm"
                  style={{ color: 'var(--ink-text-secondary)' }}
                >
                  {item.subject || item.summary}
                </p>

                {/* Sender and attachments */}
                <div
                  className="mt-1 flex items-center gap-3 text-xs"
                  style={{ color: 'var(--ink-text-muted)' }}
                >
                  <span>from {item.senderParty}</span>
                  {item.attachmentCount > 0 && (
                    <span className="flex items-center gap-1">
                      <Paperclip className="h-3 w-3" />
                      {item.attachmentCount}
                    </span>
                  )}
                </div>
              </div>

              {/* Chevron */}
              <ChevronRight
                className="h-4 w-4 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: 'var(--ink-text-muted)' }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Show more / Show less */}
      {(hasMore || (expanded && timeline.length > maxItems)) && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-2 pl-8 text-sm flex items-center gap-1 transition-colors"
          style={{ color: 'var(--ink-accent)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '0.8';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = '1';
          }}
        >
          <ChevronDown
            className="h-4 w-4 transition-transform"
            style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
          {expanded
            ? 'Show less'
            : `+${timeline.length - maxItems} more documents`
          }
        </button>
      )}
    </div>
  );
}
