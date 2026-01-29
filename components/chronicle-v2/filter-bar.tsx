'use client';

import { Search } from 'lucide-react';
import { type Phase, type TimeWindow } from '@/lib/chronicle-v2';

type RiskFilter = 'all' | 'critical' | 'warning' | 'on_track';

interface FilterBarProps {
  phase: Phase;
  timeWindow: TimeWindow;
  search: string;
  riskFilter?: RiskFilter;
  onPhaseChange: (p: Phase) => void;
  onTimeWindowChange: (t: TimeWindow) => void;
  onSearchChange: (s: string) => void;
  onRiskFilterChange?: (r: RiskFilter) => void;
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
 * Provides filtering controls for risk, phase, and time window.
 * Uses Chronicle Ink theme colors.
 */
export function FilterBar({
  phase,
  timeWindow,
  search,
  riskFilter = 'all',
  onPhaseChange,
  onTimeWindowChange,
  onSearchChange,
  onRiskFilterChange,
  scoreDistribution,
}: FilterBarProps) {
  const riskFilters: { value: RiskFilter; label: string; color: string }[] = [
    { value: 'all', label: 'All', color: 'var(--ink-text-muted)' },
    { value: 'critical', label: '🔴 Critical', color: '#ef4444' },
    { value: 'warning', label: '🟡 Warning', color: '#f59e0b' },
    { value: 'on_track', label: '🟢 On Track', color: '#22c55e' },
  ];

  const phases: { value: Phase; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'origin', label: 'Departure' },
    { value: 'destination', label: 'Arrival' },
  ];

  const timeWindows: { value: TimeWindow; label: string; title: string }[] = [
    { value: 'today', label: 'Today', title: 'ETD/ETA today' },
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

      {/* Filter Row - stacks on mobile */}
      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        {/* Risk Level Toggle */}
        {onRiskFilterChange && (
          <div className="flex items-center gap-1 w-full sm:w-auto">
            <span
              className="mr-2 text-xs font-medium shrink-0"
              style={{ color: 'var(--ink-text-muted)' }}
            >
              Risk
            </span>
            <div
              className="flex flex-wrap rounded-lg border p-0.5 flex-1 sm:flex-initial"
              style={{
                backgroundColor: 'var(--ink-surface)',
                borderColor: 'var(--ink-border-subtle)',
              }}
            >
              {riskFilters.map((r) => (
                <button
                  key={r.value}
                  onClick={() => onRiskFilterChange(r.value)}
                  className="rounded-md px-2 sm:px-3 py-2 sm:py-1.5 text-xs sm:text-sm font-medium transition-colors flex-1 sm:flex-initial min-w-0"
                  style={{
                    backgroundColor: riskFilter === r.value ? 'var(--ink-elevated)' : 'transparent',
                    color: riskFilter === r.value ? r.color : 'var(--ink-text-muted)',
                  }}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Phase Toggle */}
        <div className="flex items-center gap-1 w-full sm:w-auto">
          <span
            className="mr-2 text-xs font-medium shrink-0"
            style={{ color: 'var(--ink-text-muted)' }}
          >
            Phase
          </span>
          <div
            className="flex rounded-lg border p-0.5 flex-1 sm:flex-initial"
            style={{
              backgroundColor: 'var(--ink-surface)',
              borderColor: 'var(--ink-border-subtle)',
            }}
          >
            {phases.map((p) => (
              <button
                key={p.value}
                onClick={() => onPhaseChange(p.value)}
                className="rounded-md px-2 sm:px-3 py-2 sm:py-1.5 text-xs sm:text-sm font-medium transition-colors flex-1 sm:flex-initial"
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
        <div className="flex items-center gap-1 w-full sm:w-auto">
          <span
            className="mr-2 text-xs font-medium shrink-0"
            style={{ color: 'var(--ink-text-muted)' }}
          >
            Time
          </span>
          <div
            className="flex rounded-lg border p-0.5 flex-1 sm:flex-initial"
            style={{
              backgroundColor: 'var(--ink-surface)',
              borderColor: 'var(--ink-border-subtle)',
            }}
          >
            {timeWindows.map((t) => (
              <button
                key={t.value}
                onClick={() => onTimeWindowChange(t.value)}
                className="rounded-md px-2 sm:px-3 py-2 sm:py-1.5 text-xs sm:text-sm font-medium transition-colors flex-1 sm:flex-initial"
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

        {/* Score Distribution - hidden on mobile, shown on tablet+ */}
        {scoreDistribution && (
          <div
            className="hidden sm:flex ml-auto items-center gap-3 text-xs"
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
