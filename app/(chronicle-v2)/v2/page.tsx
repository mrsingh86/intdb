'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ChevronRight } from 'lucide-react';
import {
  type ShipmentListItem,
  type ShipmentListResponse,
  type Phase,
  type TimeWindow,
} from '@/lib/chronicle-v2';
import { FilterBar } from '@/components/chronicle-v2/FilterBar';

type RiskFilter = 'all' | 'critical' | 'warning' | 'on_track';

/**
 * Chronicle V2 - Clean Unified List
 *
 * Filters:
 * - Risk: Critical (red) | Warning (amber) | On Track (green)
 * - Direction: Export | Import | All
 * - Phase: Origin | In Transit | Destination | Completed
 * - Time: Today | 3 Days | Week | All
 */

export default function ChronicleListPage() {
  const router = useRouter();

  // Filter state
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [phase, setPhase] = useState<Phase>('all');
  const [timeWindow, setTimeWindow] = useState<TimeWindow>('all');

  // Data state
  const [shipments, setShipments] = useState<ShipmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch ALL shipments (filtering done client-side for counts)
  const fetchShipments = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('timeWindow', 'all'); // Always fetch all, filter client-side
      params.set('showWatchlist', 'true');
      params.set('pageSize', '500');
      if (search) params.set('search', search);

      const res = await fetch(`/api/chronicle-v2/shipments?${params.toString()}`);

      if (!res.ok) throw new Error('Failed to fetch shipments');

      const data: ShipmentListResponse = await res.json();
      setShipments(data.shipments);
    } catch (err) {
      console.error('Error fetching shipments:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => fetchShipments(), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [fetchShipments]);

  // Helper: Check if shipment is within time window
  const isInTimeWindow = useCallback((s: ShipmentListItem, window: TimeWindow): boolean => {
    if (window === 'all') return true;

    // Parse date string to day timestamp (midnight UTC)
    const parseDate = (dateStr: string | null): number | null => {
      if (!dateStr) return null;
      const d = new Date(dateStr + 'T00:00:00Z');
      return d.getTime();
    };

    const now = new Date();
    const todayMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const dayMs = 24 * 60 * 60 * 1000;

    const etdMs = parseDate(s.etd);
    const etaMs = parseDate(s.eta);

    // Define window ranges
    let startMs: number;
    let endMs: number;

    if (window === 'today') {
      // Today only: just today
      startMs = todayMs;
      endMs = todayMs + dayMs;
    } else if (window === '3days') {
      // Next 3 days: today through day 3
      startMs = todayMs;
      endMs = todayMs + 3 * dayMs;
    } else {
      // Week: today through day 7
      startMs = todayMs;
      endMs = todayMs + 7 * dayMs;
    }

    // Check if ETD or ETA falls within the range
    const etdInRange = etdMs !== null && etdMs >= startMs && etdMs < endMs;
    const etaInRange = etaMs !== null && etaMs >= startMs && etaMs < endMs;

    return etdInRange || etaInRange;
  }, []);

  // Helper: Check if shipment matches phase filter
  const matchesPhase = useCallback((s: ShipmentListItem, phaseFilter: Phase): boolean => {
    if (phaseFilter === 'all') return true;

    const stage = (s.stage || '').toUpperCase();
    const departureStages = ['PENDING', 'REQUESTED', 'BOOKED', 'SI_SUBMITTED', 'SI_CONFIRMED', 'BL_DRAFT', 'BL_ISSUED'];
    const arrivalStages = ['DEPARTED', 'IN_TRANSIT', 'ARRIVED', 'CUSTOMS_CLEARED', 'DELIVERED', 'COMPLETED'];

    if (phaseFilter === 'origin') return departureStages.includes(stage);
    if (phaseFilter === 'destination') return arrivalStages.includes(stage);
    return true;
  }, []);

  // Categorize and filter shipments
  const { filtered, stats } = useMemo(() => {
    // First apply phase filter
    const phaseFiltered = shipments.filter(s => matchesPhase(s, phase));

    // Apply time window filter
    const timeFiltered = phaseFiltered.filter(s => isInTimeWindow(s, timeWindow));

    // Categorize by risk level
    const criticalList: ShipmentListItem[] = [];
    const warningList: ShipmentListItem[] = [];
    const onTrackList: ShipmentListItem[] = [];

    timeFiltered.forEach((s) => {
      const aiRisk = s.aiSummary?.riskLevel;
      const hasOverdue = s.actions?.overdue > 0;

      if (aiRisk === 'red' || hasOverdue) {
        criticalList.push(s);
      } else if (aiRisk === 'amber') {
        warningList.push(s);
      } else {
        onTrackList.push(s);
      }
    });

    // Sort by ETD (closest first)
    const sortByEtd = (a: ShipmentListItem, b: ShipmentListItem) => {
      const dateA = a.etd || a.eta;
      const dateB = b.etd || b.eta;
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      return new Date(dateA).getTime() - new Date(dateB).getTime();
    };

    criticalList.sort(sortByEtd);
    warningList.sort(sortByEtd);
    onTrackList.sort(sortByEtd);

    // Apply risk filter
    let filteredList: ShipmentListItem[] = [];
    if (riskFilter === 'critical') {
      filteredList = criticalList;
    } else if (riskFilter === 'warning') {
      filteredList = warningList;
    } else if (riskFilter === 'on_track') {
      filteredList = onTrackList;
    } else {
      filteredList = [...criticalList, ...warningList, ...onTrackList];
    }

    return {
      filtered: filteredList,
      stats: {
        total: timeFiltered.length,
        criticalCount: criticalList.length,
        warningCount: warningList.length,
        onTrackCount: onTrackList.length,
      },
    };
  }, [shipments, phase, timeWindow, riskFilter, isInTimeWindow, matchesPhase]);

  const handleViewDetails = (shipmentId: string) => {
    router.push(`/v2/${shipmentId}`);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getRiskIndicator = (s: ShipmentListItem) => {
    const aiRisk = s.aiSummary?.riskLevel;
    if (aiRisk === 'red' || s.actions?.overdue > 0) return 'critical';
    if (aiRisk === 'amber') return 'warning';
    return 'on_track';
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink-text)' }}>
          Shipments
        </h1>
        <div className="mt-2 flex items-center gap-4 text-sm">
          {stats.criticalCount > 0 && (
            <span style={{ color: '#ef4444' }}>
              {stats.criticalCount} critical
            </span>
          )}
          {stats.warningCount > 0 && (
            <span style={{ color: '#f59e0b' }}>
              {stats.warningCount} warning
            </span>
          )}
          <span style={{ color: 'var(--ink-text-muted)' }}>
            {stats.onTrackCount} on track
          </span>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="mb-6">
        <FilterBar
          phase={phase}
          timeWindow={timeWindow}
          search={search}
          riskFilter={riskFilter}
          onPhaseChange={setPhase}
          onTimeWindowChange={setTimeWindow}
          onSearchChange={setSearch}
          onRiskFilterChange={setRiskFilter}
          scoreDistribution={{
            strong: stats.criticalCount,
            medium: stats.warningCount,
            weak: stats.onTrackCount,
            noise: 0,
          }}
        />
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--ink-text-muted)' }} />
        </div>
      ) : error ? (
        <div className="rounded-lg p-6 text-center" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
          <p style={{ color: '#ef4444' }}>{error}</p>
          <button
            onClick={fetchShipments}
            className="mt-3 rounded-md px-4 py-2 text-sm font-medium"
            style={{ backgroundColor: '#ef4444', color: 'white' }}
          >
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16" style={{ color: 'var(--ink-text-muted)' }}>
          <p className="text-lg">No shipments found</p>
          <p className="mt-1 text-sm">
            Try adjusting your search or filters
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((shipment) => {
            const risk = getRiskIndicator(shipment);
            const borderColor = risk === 'critical' ? '#ef4444' : risk === 'warning' ? '#f59e0b' : 'transparent';

            return (
              <div
                key={shipment.id}
                onClick={() => handleViewDetails(shipment.id)}
                className="group cursor-pointer rounded-lg border p-4 transition-all hover:shadow-md"
                style={{
                  backgroundColor: 'var(--ink-surface)',
                  borderColor: 'var(--ink-border-subtle)',
                  borderLeftWidth: '3px',
                  borderLeftColor: borderColor,
                }}
              >
                {/* Row 1: Booking | Route | Carrier | Risk Badge */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className="font-semibold"
                      style={{ color: 'var(--ink-text)', fontFamily: 'var(--ink-font-mono)' }}
                    >
                      {shipment.bookingNumber || shipment.mblNumber || '—'}
                    </span>
                    <span className="text-sm" style={{ color: 'var(--ink-text-secondary)' }}>
                      {shipment.route.origin || '?'} → {shipment.route.destination || '?'}
                    </span>
                    {shipment.carrier && (
                      <span
                        className="text-xs px-2 py-0.5 rounded"
                        style={{ backgroundColor: 'var(--ink-elevated)', color: 'var(--ink-text-muted)' }}
                      >
                        {shipment.carrier}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {/* Risk Level Badge */}
                    <span
                      className="text-xs font-medium px-2 py-1 rounded"
                      style={{
                        backgroundColor: risk === 'critical' ? 'rgba(239, 68, 68, 0.15)' : risk === 'warning' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                        color: risk === 'critical' ? '#ef4444' : risk === 'warning' ? '#f59e0b' : '#22c55e',
                      }}
                    >
                      {risk === 'critical' ? '🔴 Critical' : risk === 'warning' ? '🟡 Warning' : '🟢 On Track'}
                    </span>
                    <ChevronRight
                      className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ color: 'var(--ink-text-muted)' }}
                    />
                  </div>
                </div>

                {/* Row 2: Shipper → Consignee + Dates */}
                <div className="mt-1.5 flex items-center justify-between text-sm">
                  <span style={{ color: 'var(--ink-text-muted)' }}>
                    {shipment.shipper || '—'} → {shipment.consignee || '—'}
                  </span>
                  <div className="flex items-center gap-3" style={{ color: 'var(--ink-text-secondary)' }}>
                    <span>ETD {formatDate(shipment.etd) || '—'}</span>
                    <span style={{ color: 'var(--ink-text-muted)' }}>→</span>
                    <span>ETA {formatDate(shipment.eta) || '—'}</span>
                  </div>
                </div>

                {/* Row 3: AI Summary - V2 format (narrative) or V1 fallback */}
                {shipment.aiSummary ? (
                  <div className="mt-3 space-y-2">
                    {/* V2 Format: Tight narrative with inline intelligence */}
                    {shipment.aiSummary.narrative ? (
                      <>
                        {/* Narrative - the main intelligence paragraph */}
                        <div className="text-sm leading-relaxed" style={{ color: 'var(--ink-text-secondary)' }}>
                          {shipment.aiSummary.narrative}
                        </div>

                        {/* Key insight + owner + deadline badges */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {shipment.aiSummary.keyInsight && (
                            <span
                              className="text-xs px-2 py-0.5 rounded font-medium"
                              style={{
                                backgroundColor: shipment.aiSummary.riskLevel === 'red'
                                  ? 'rgba(239, 68, 68, 0.15)'
                                  : shipment.aiSummary.riskLevel === 'amber'
                                  ? 'rgba(245, 158, 11, 0.15)'
                                  : 'rgba(34, 197, 94, 0.15)',
                                color: shipment.aiSummary.riskLevel === 'red'
                                  ? '#ef4444'
                                  : shipment.aiSummary.riskLevel === 'amber'
                                  ? '#f59e0b'
                                  : '#22c55e',
                              }}
                            >
                              {shipment.aiSummary.keyInsight}
                            </span>
                          )}
                          {shipment.aiSummary.owner && (
                            <span
                              className="text-xs px-2 py-0.5 rounded"
                              style={{
                                backgroundColor: 'var(--ink-elevated)',
                                color: shipment.aiSummary.ownerType === 'intoglo' ? '#3b82f6' : 'var(--ink-text-muted)',
                              }}
                            >
                              → {shipment.aiSummary.owner}
                            </span>
                          )}
                          {shipment.aiSummary.keyDeadline && (
                            <span
                              className="text-xs px-2 py-0.5 rounded"
                              style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}
                            >
                              ⏰ {shipment.aiSummary.keyDeadline}
                            </span>
                          )}
                        </div>
                      </>
                    ) : (
                      /* V1 Legacy Format: Story + Blocker/Action */
                      <>
                        {shipment.aiSummary.story && (
                          <div className="text-sm" style={{ color: 'var(--ink-text-secondary)' }}>
                            {shipment.aiSummary.story}
                          </div>
                        )}

                        {shipment.aiSummary.currentBlocker && (
                          <div className="text-sm" style={{ color: '#ef4444' }}>
                            <span className="font-medium">Blocker:</span> {shipment.aiSummary.currentBlocker}
                            {shipment.aiSummary.blockerOwner && (
                              <span
                                className="ml-2 text-xs px-1.5 py-0.5 rounded"
                                style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}
                              >
                                {shipment.aiSummary.blockerOwner}
                              </span>
                            )}
                          </div>
                        )}

                        {shipment.aiSummary.nextAction && (
                          <div className="text-sm" style={{ color: '#f59e0b' }}>
                            <span className="font-medium">Next:</span> {shipment.aiSummary.nextAction}
                            {shipment.aiSummary.actionOwner && (
                              <span
                                className="ml-2 text-xs px-1.5 py-0.5 rounded"
                                style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}
                              >
                                {shipment.aiSummary.actionOwner}
                              </span>
                            )}
                          </div>
                        )}

                        {(shipment.aiSummary.financialImpact || shipment.aiSummary.customerImpact) && (
                          <div className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>
                            {shipment.aiSummary.financialImpact && (
                              <span className="mr-3">💰 {shipment.aiSummary.financialImpact}</span>
                            )}
                            {shipment.aiSummary.customerImpact && (
                              <span>⚠️ {shipment.aiSummary.customerImpact}</span>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  /* Fallback: Show issues/actions count if no AI summary */
                  (shipment.issues?.count > 0 || shipment.actions?.pending > 0) && (
                    <div className="mt-3 flex items-center gap-4 text-sm" style={{ color: 'var(--ink-text-muted)' }}>
                      {shipment.issues?.count > 0 && (
                        <span style={{ color: '#ef4444' }}>{shipment.issues.count} issue{shipment.issues.count > 1 ? 's' : ''}</span>
                      )}
                      {shipment.actions?.pending > 0 && (
                        <span style={{ color: '#f59e0b' }}>
                          {shipment.actions.pending} action{shipment.actions.pending > 1 ? 's' : ''}
                          {shipment.actions.overdue > 0 && ` (${shipment.actions.overdue} overdue)`}
                        </span>
                      )}
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
