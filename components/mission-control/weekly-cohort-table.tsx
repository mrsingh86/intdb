'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, Loader2, RefreshCw, ChevronDown } from 'lucide-react';

const WEEK_OPTIONS = [
  { value: 4, label: 'Last 4 weeks' },
  { value: 8, label: 'Last 8 weeks' },
  { value: 12, label: 'Last 12 weeks' },
  { value: 0, label: 'All weeks' },
];

interface WeekInfo {
  key: string;
  month: string;
  startDate: string;
  endDate: string;
  startDay: number;
  endDay: number;
  shipmentCount: number;
}

interface MonthGroup {
  month: string;
  weeks: number;
}

interface StateInfo {
  key: string;
  label: string;
}

interface CohortData {
  weeks: WeekInfo[];
  monthGroups: MonthGroup[];
  states: StateInfo[];
  data: Record<string, { count: number; percentage: number }[]>;
  totalShipments: number;
}

export default function WeeklyCohortTable() {
  const [data, setData] = useState<CohortData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [weeksToShow, setWeeksToShow] = useState(8);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const fetchData = async (weeks: number) => {
    setLoading(true);
    setError(null);
    try {
      const url = weeks > 0
        ? `/api/workflow-cohort?weeks=${weeks}`
        : '/api/workflow-cohort?weeks=0';
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch');
      const result = await response.json();
      setData(result);
    } catch (err) {
      setError('Failed to load cohort data');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(weeksToShow);
  }, [weeksToShow]);

  const handleWeekChange = (weeks: number) => {
    setWeeksToShow(weeks);
    setDropdownOpen(false);
  };

  const selectedOption = WEEK_OPTIONS.find(o => o.value === weeksToShow) || WEEK_OPTIONS[1];

  // Color scale for percentages
  const getPercentageColor = (pct: number) => {
    if (pct >= 80) return 'text-terminal-green';
    if (pct >= 50) return 'text-terminal-blue';
    if (pct >= 25) return 'text-terminal-amber';
    if (pct > 0) return 'text-terminal-red';
    return 'text-terminal-muted';
  };

  const getPercentageBg = (pct: number) => {
    if (pct >= 80) return 'bg-terminal-green/10';
    if (pct >= 50) return 'bg-terminal-blue/10';
    if (pct >= 25) return 'bg-terminal-amber/10';
    if (pct > 0) return 'bg-terminal-red/10';
    return '';
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
        <div className="px-4 py-2.5 bg-terminal-elevated border-b border-terminal-border flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-terminal-purple" />
          <TrendingUp className="h-4 w-4 text-terminal-purple" />
          <span className="font-medium text-terminal-text text-sm">Weekly Cohort Analysis</span>
        </div>
        <div className="flex items-center justify-center h-64 gap-2 text-terminal-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="font-mono text-sm">Loading cohort data...</span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
        <div className="px-4 py-2.5 bg-terminal-elevated border-b border-terminal-border flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-terminal-red" />
          <TrendingUp className="h-4 w-4 text-terminal-red" />
          <span className="font-medium text-terminal-text text-sm">Weekly Cohort Analysis</span>
        </div>
        <div className="flex flex-col items-center justify-center h-64 text-terminal-red">
          <p className="font-mono text-sm">{error || 'Failed to load data'}</p>
          <button
            onClick={() => fetchData(weeksToShow)}
            className="mt-2 flex items-center gap-2 px-3 py-1.5 text-sm font-mono border border-terminal-border rounded hover:bg-terminal-elevated"
          >
            <RefreshCw className="h-4 w-4" /> Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 bg-terminal-elevated border-b border-terminal-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-terminal-purple" />
          <TrendingUp className="h-4 w-4 text-terminal-purple" />
          <span className="font-medium text-terminal-text text-sm">Weekly Cohort Analysis</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Week Range Dropdown */}
          <div className="relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono bg-terminal-surface border border-terminal-border rounded hover:bg-terminal-bg transition-colors"
            >
              <span className="text-terminal-text">{selectedOption.label}</span>
              <ChevronDown className={`h-3.5 w-3.5 text-terminal-muted transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {dropdownOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setDropdownOpen(false)}
                />
                <div className="absolute right-0 top-full mt-1 z-20 bg-terminal-surface border border-terminal-border rounded shadow-lg min-w-[140px]">
                  {WEEK_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => handleWeekChange(option.value)}
                      className={`w-full px-3 py-2 text-left text-xs font-mono hover:bg-terminal-elevated transition-colors ${
                        option.value === weeksToShow
                          ? 'text-terminal-purple bg-terminal-purple/10'
                          : 'text-terminal-text'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <span className="text-xs font-mono text-terminal-muted">
            {data.totalShipments} shipments
          </span>
          <button
            onClick={() => fetchData(weeksToShow)}
            className="p-1.5 hover:bg-terminal-surface rounded border border-transparent hover:border-terminal-border transition-colors"
            title="Refresh"
          >
            <RefreshCw className={`h-3.5 w-3.5 text-terminal-muted ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Table Container with Horizontal Scroll */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          {/* Month Header Row */}
          <thead>
            <tr className="bg-terminal-elevated border-b border-terminal-border">
              <th className="sticky left-0 z-10 bg-terminal-elevated px-3 py-2.5 text-left font-medium text-terminal-muted w-36 min-w-[144px] text-sm">
                State
              </th>
              {data.monthGroups.map((group, idx) => (
                <th
                  key={idx}
                  colSpan={group.weeks}
                  className={`px-2 py-2 text-center font-bold text-terminal-text border-l border-terminal-border text-sm ${
                    group.month === 'Total' ? 'bg-terminal-purple/10 text-terminal-purple' : ''
                  }`}
                >
                  {group.month}
                </th>
              ))}
            </tr>
            {/* Week Date Range Row */}
            <tr className="bg-terminal-surface border-b border-terminal-border">
              <th className="sticky left-0 z-10 bg-terminal-surface px-3 py-1.5 text-left font-normal text-terminal-muted w-36 min-w-[144px]">
                <span className="text-xs">Week Range</span>
              </th>
              {data.weeks.map((week) => (
                <th
                  key={week.key}
                  className="px-2 py-1.5 text-center font-normal text-terminal-muted border-l border-terminal-border min-w-[80px]"
                >
                  <div className="text-xs">
                    {week.startDay}-{week.endDay}
                  </div>
                </th>
              ))}
              <th className="px-2 py-1.5 text-center font-bold text-terminal-purple bg-terminal-purple/10 border-l border-terminal-border min-w-[80px] text-xs">
                All
              </th>
            </tr>
            {/* Shipment Count Row */}
            <tr className="bg-terminal-elevated border-b-2 border-terminal-border">
              <th className="sticky left-0 z-10 bg-terminal-elevated px-3 py-2 text-left font-medium text-terminal-text w-36 min-w-[144px] text-sm">
                Shipments
              </th>
              {data.weeks.map((week) => (
                <th
                  key={week.key}
                  className="px-2 py-2 text-center font-bold text-terminal-green border-l border-terminal-border min-w-[80px] text-sm"
                >
                  {week.shipmentCount}
                </th>
              ))}
              <th className="px-2 py-2 text-center font-bold text-terminal-purple bg-terminal-purple/10 border-l border-terminal-border min-w-[80px] text-sm">
                {data.totalShipments}
              </th>
            </tr>
          </thead>

          {/* State Rows */}
          <tbody>
            {data.states.map((state, stateIdx) => {
              const stateData = data.data[state.key] || [];
              const isFirstRow = stateIdx === 0;

              return (
                <tr
                  key={state.key}
                  className={`border-b border-terminal-border hover:bg-terminal-elevated/50 ${
                    isFirstRow ? 'bg-terminal-green/5' : ''
                  }`}
                >
                  {/* State Label */}
                  <td className="sticky left-0 z-10 bg-terminal-surface px-3 py-2.5 text-left font-medium text-terminal-text w-36 min-w-[144px] border-r border-terminal-border">
                    <span className={`text-sm ${isFirstRow ? 'text-terminal-green' : ''}`}>
                      {state.label}
                    </span>
                  </td>

                  {/* Week Data Cells */}
                  {stateData.map((cell, cellIdx) => {
                    const isTotal = cellIdx === stateData.length - 1;
                    const colorClass = getPercentageColor(cell.percentage);
                    const bgClass = getPercentageBg(cell.percentage);

                    return (
                      <td
                        key={cellIdx}
                        className={`px-2 py-2 text-center border-l border-terminal-border min-w-[80px] ${
                          isTotal ? 'bg-terminal-purple/5' : bgClass
                        }`}
                      >
                        <div className="flex flex-col items-center gap-0.5">
                          <span className={`text-sm font-bold ${isTotal ? 'text-terminal-purple' : colorClass}`}>
                            {cell.percentage}%
                          </span>
                          <span className="text-xs text-terminal-muted">
                            ({cell.count})
                          </span>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="px-4 py-2.5 bg-terminal-elevated border-t border-terminal-border flex items-center justify-between text-[10px] font-mono text-terminal-muted">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded bg-terminal-green"></span> 80%+
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded bg-terminal-blue"></span> 50-79%
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded bg-terminal-amber"></span> 25-49%
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-2 rounded bg-terminal-red"></span> &lt;25%
          </span>
        </div>
        <div className="text-terminal-muted">
          Cohort = Shipments grouped by Booking Confirmation received date
        </div>
      </div>
    </div>
  );
}
