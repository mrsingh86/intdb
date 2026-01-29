'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ChevronRight } from 'lucide-react';
import {
  type ShipmentListItem,
  type ShipmentListResponse,
  type Phase,
  type TimeWindow,
} from '@/lib/chronicle-v2';
import { FilterBar } from '@/components/chronicle-v2/filter-bar';

type RiskFilter = 'all' | 'critical' | 'warning' | 'on_track';

const INITIAL_PAGE_SIZE = 30;
const LOAD_MORE_SIZE = 30;

/**
 * Chronicle V2 - Clean Unified List
 *
 * Filters:
 * - Risk: Critical (red) | Warning (amber) | On Track (green)
 * - Phase: Departure | Arrival | All
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
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const currentPage = useRef(1);

  // Fetch shipments with server-side filtering
  const fetchShipments = useCallback(async (isLoadMore = false) => {
    if (isLoadMore) {
      setLoadingMore(true);
    } else {
      setLoading(true);
      currentPage.current = 1;
    }
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('phase', phase);
      params.set('timeWindow', timeWindow);
      params.set('showWatchlist', 'true');
      params.set('page', String(currentPage.current));
      params.set('pageSize', String(isLoadMore ? LOAD_MORE_SIZE : INITIAL_PAGE_SIZE));
      if (search) params.set('search', search);

      const res = await fetch(`/api/chronicle-v2/shipments?${params.toString()}`);

      if (!res.ok) throw new Error('Failed to fetch shipments');

      const data: ShipmentListResponse = await res.json();

      const pageSize = isLoadMore ? LOAD_MORE_SIZE : INITIAL_PAGE_SIZE;

      if (isLoadMore) {
        setShipments(prev => {
          const newList = [...prev, ...data.shipments];
          // Check if there's more to load
          setHasMore(data.shipments.length === pageSize && newList.length < data.total);
          return newList;
        });
      } else {
        setShipments(data.shipments);
        setHasMore(data.shipments.length === pageSize && data.shipments.length < data.total);
      }

      setTotal(data.total);
    } catch (err) {
      console.error('Error fetching shipments:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [search, phase, timeWindow]);

  // Load more handler
  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      currentPage.current += 1;
      fetchShipments(true);
    }
  }, [loadingMore, hasMore, fetchShipments]);

  useEffect(() => {
    const timer = setTimeout(() => fetchShipments(), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [fetchShipments]);

  // Categorize and filter shipments (only risk filter is client-side now)
  const { filtered, stats } = useMemo(() => {
    // Categorize by risk level
    const criticalList: ShipmentListItem[] = [];
    const warningList: ShipmentListItem[] = [];
    const onTrackList: ShipmentListItem[] = [];

    shipments.forEach((s) => {
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
        total: shipments.length,
        criticalCount: criticalList.length,
        warningCount: warningList.length,
        onTrackCount: onTrackList.length,
      },
    };
  }, [shipments, riskFilter]);

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
    <div className="max-w-5xl mx-auto px-4 sm:px-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-semibold" style={{ color: 'var(--ink-text)' }}>
          Shipments
        </h1>
        <div className="mt-2 flex items-center gap-3 sm:gap-4 text-sm">
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
        <div className="space-y-2">
          {/* Skeleton cards for faster perceived loading */}
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="rounded-lg border p-4 animate-pulse"
              style={{
                backgroundColor: 'var(--ink-surface)',
                borderColor: 'var(--ink-border-subtle)',
              }}
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="h-5 w-32 rounded" style={{ backgroundColor: 'var(--ink-elevated)' }} />
                  <div className="h-4 w-24 rounded" style={{ backgroundColor: 'var(--ink-elevated)' }} />
                  <div className="h-4 w-16 rounded" style={{ backgroundColor: 'var(--ink-elevated)' }} />
                </div>
                <div className="h-6 w-20 rounded" style={{ backgroundColor: 'var(--ink-elevated)' }} />
              </div>
              <div className="mt-2 flex flex-col sm:flex-row gap-2">
                <div className="h-4 w-48 rounded" style={{ backgroundColor: 'var(--ink-elevated)' }} />
                <div className="h-4 w-32 rounded ml-auto" style={{ backgroundColor: 'var(--ink-elevated)' }} />
              </div>
              <div className="mt-3 h-12 rounded" style={{ backgroundColor: 'var(--ink-elevated)' }} />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg p-4 sm:p-6 text-center" style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)' }}>
          <p className="text-sm sm:text-base" style={{ color: '#ef4444' }}>{error}</p>
          <button
            onClick={() => fetchShipments()}
            className="mt-3 rounded-md px-4 py-2 text-sm font-medium"
            style={{ backgroundColor: '#ef4444', color: 'white' }}
          >
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 sm:py-16" style={{ color: 'var(--ink-text-muted)' }}>
          <p className="text-base sm:text-lg">No shipments found</p>
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
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    <span
                      className="font-semibold text-sm sm:text-base"
                      style={{ color: 'var(--ink-text)', fontFamily: 'var(--ink-font-mono)' }}
                    >
                      {shipment.bookingNumber || shipment.mblNumber || '—'}
                    </span>
                    <span className="text-xs sm:text-sm" style={{ color: 'var(--ink-text-secondary)' }}>
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
                  <div className="flex items-center gap-2 sm:gap-3">
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
                      className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity hidden sm:block"
                      style={{ color: 'var(--ink-text-muted)' }}
                    />
                  </div>
                </div>

                {/* Row 2: Shipper → Consignee + Dates */}
                <div className="mt-1.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-0 text-xs sm:text-sm">
                  <span className="truncate" style={{ color: 'var(--ink-text-muted)' }}>
                    {shipment.shipper || '—'} → {shipment.consignee || '—'}
                  </span>
                  <div className="flex items-center gap-2 sm:gap-3 shrink-0" style={{ color: 'var(--ink-text-secondary)' }}>
                    <span>ETD {formatDate(shipment.etd) || '—'}</span>
                    <span style={{ color: 'var(--ink-text-muted)' }}>→</span>
                    <span>ETA {formatDate(shipment.eta) || '—'}</span>
                  </div>
                </div>

                {/* Row 3: AI Summary - Always show Blocker/Next/Impacts when available */}
                {shipment.aiSummary ? (
                  <div className="mt-3 space-y-2">
                    {/* Story/Narrative paragraph */}
                    {(shipment.aiSummary.narrative || shipment.aiSummary.story) && (
                      <div className="text-sm leading-relaxed" style={{ color: 'var(--ink-text-secondary)' }}>
                        {shipment.aiSummary.narrative || shipment.aiSummary.story}
                      </div>
                    )}

                    {/* Blocker (red) - always show if exists */}
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

                    {/* Next Action (orange) - always show if exists */}
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

                    {/* Financial & Customer Impact - always show if exists */}
                    {(shipment.aiSummary.financialImpact || shipment.aiSummary.customerImpact) && (
                      <div className="text-xs flex flex-wrap gap-x-3 gap-y-1" style={{ color: 'var(--ink-text-muted)' }}>
                        {shipment.aiSummary.financialImpact && (
                          <span>💰 {shipment.aiSummary.financialImpact}</span>
                        )}
                        {shipment.aiSummary.customerImpact && (
                          <span>⚠️ {shipment.aiSummary.customerImpact}</span>
                        )}
                      </div>
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

          {/* Load More button */}
          {hasMore && filtered.length > 0 && (
            <div className="flex justify-center pt-4 pb-8">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium transition-colors disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--ink-elevated)',
                  color: 'var(--ink-text)',
                  border: '1px solid var(--ink-border-subtle)',
                }}
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading...
                  </>
                ) : (
                  `Load More`
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
