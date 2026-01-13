'use client';

import { Search } from 'lucide-react';
import { type Direction, type Phase, type TimeWindow, PHASE_LABELS } from '@/lib/chronicle-v2';

interface FilterBarProps {
  direction: Direction;
  phase: Phase;
  timeWindow: TimeWindow;
  search: string;
  onDirectionChange: (d: Direction) => void;
  onPhaseChange: (p: Phase) => void;
  onTimeWindowChange: (t: TimeWindow) => void;
  onSearchChange: (s: string) => void;
  scoreDistribution?: {
    strong: number;
    medium: number;
    weak: number;
    noise: number;
  };
}

/**
 * FilterBar Component
 *
 * Provides filtering controls for direction, phase, and time window.
 * Uses Chronicle Ink theme colors.
 */
export function FilterBar({
  direction,
  phase,
  timeWindow,
  search,
  onDirectionChange,
  onPhaseChange,
  onTimeWindowChange,
  onSearchChange,
  scoreDistribution,
}: FilterBarProps) {
  const directions: { value: Direction; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'export', label: 'Export' },
    { value: 'import', label: 'Import' },
  ];

  const phases: { value: Phase; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'origin', label: PHASE_LABELS.origin },
    { value: 'in_transit', label: PHASE_LABELS.in_transit },
    { value: 'destination', label: PHASE_LABELS.destination },
    { value: 'completed', label: PHASE_LABELS.completed },
  ];

  const timeWindows: { value: TimeWindow; label: string; title: string }[] = [
    { value: 'today', label: 'Today', title: 'ETD/ETA today + all overdue' },
    { value: '3days', label: '3 Days', title: 'ETD/ETA within 3 days' },
    { value: '7days', label: 'Week', title: 'ETD/ETA within 7 days' },
    { value: 'all', label: 'All', title: 'All active shipments' },
  ];

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
          style={{ color: 'var(--ink-text-muted)' }}
        />
        <input
          type="text"
          placeholder="Search booking, BL, vessel, shipper, consignee..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full rounded-lg border py-2.5 pl-10 pr-4 text-sm transition-colors focus:outline-none"
          style={{
            backgroundColor: 'var(--ink-surface)',
            borderColor: 'var(--ink-border-subtle)',
            color: 'var(--ink-text)',
            fontFamily: 'var(--ink-font-sans)',
          }}
        />
      </div>

      {/* Filter Row */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Direction Toggle */}
        <div className="flex items-center gap-1">
          <span
            className="mr-2 text-xs font-medium"
            style={{ color: 'var(--ink-text-muted)' }}
          >
            Direction
          </span>
          <div
            className="flex rounded-lg border p-0.5"
            style={{
              backgroundColor: 'var(--ink-surface)',
              borderColor: 'var(--ink-border-subtle)',
            }}
          >
            {directions.map((d) => (
              <button
                key={d.value}
                onClick={() => onDirectionChange(d.value)}
                className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: direction === d.value ? 'var(--ink-elevated)' : 'transparent',
                  color: direction === d.value ? 'var(--ink-text)' : 'var(--ink-text-muted)',
                }}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        {/* Phase Toggle */}
        <div className="flex items-center gap-1">
          <span
            className="mr-2 text-xs font-medium"
            style={{ color: 'var(--ink-text-muted)' }}
          >
            Phase
          </span>
          <div
            className="flex rounded-lg border p-0.5"
            style={{
              backgroundColor: 'var(--ink-surface)',
              borderColor: 'var(--ink-border-subtle)',
            }}
          >
            {phases.map((p) => (
              <button
                key={p.value}
                onClick={() => onPhaseChange(p.value)}
                className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: phase === p.value ? 'var(--ink-elevated)' : 'transparent',
                  color: phase === p.value ? 'var(--ink-text)' : 'var(--ink-text-muted)',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Time Window Toggle */}
        <div className="flex items-center gap-1">
          <span
            className="mr-2 text-xs font-medium"
            style={{ color: 'var(--ink-text-muted)' }}
          >
            Time
          </span>
          <div
            className="flex rounded-lg border p-0.5"
            style={{
              backgroundColor: 'var(--ink-surface)',
              borderColor: 'var(--ink-border-subtle)',
            }}
          >
            {timeWindows.map((t) => (
              <button
                key={t.value}
                onClick={() => onTimeWindowChange(t.value)}
                className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  backgroundColor: timeWindow === t.value ? 'var(--ink-elevated)' : 'transparent',
                  color: timeWindow === t.value ? 'var(--ink-text)' : 'var(--ink-text-muted)',
                }}
                title={t.title}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Score Distribution (if provided) */}
        {scoreDistribution && (
          <div
            className="ml-auto flex items-center gap-3 text-xs"
            style={{ color: 'var(--ink-text-muted)' }}
          >
            {scoreDistribution.strong > 0 && (
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: 'var(--ink-error)' }}
                />
                {scoreDistribution.strong} critical
              </span>
            )}
            {scoreDistribution.medium > 0 && (
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: 'var(--ink-warning)' }}
                />
                {scoreDistribution.medium} attention
              </span>
            )}
            <span className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: 'var(--ink-success)' }}
              />
              {scoreDistribution.weak + (scoreDistribution.noise || 0)} on track
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
