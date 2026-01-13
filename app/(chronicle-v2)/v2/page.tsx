'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Loader2, ChevronRight, Ship, Anchor } from 'lucide-react';
import {
  type ShipmentListItem,
  type ShipmentListResponse,
} from '@/lib/chronicle-v2';

/**
 * Chronicle V2 - Clean Unified List
 *
 * View modes:
 * - All: Shows all shipments sorted by urgency
 * - Departure: ±7 days from today by ETD, sorted by ETD ascending
 * - Arrival: ±7 days from today by ETA, sorted by ETA ascending
 */

type ViewMode = 'all' | 'departure' | 'arrival';
type FilterMode = 'all' | 'urgent' | 'attention';

export default function ChronicleListPage() {
  const router = useRouter();

  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [shipments, setShipments] = useState<ShipmentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch shipments
  const fetchShipments = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set('timeWindow', 'all');
      params.set('showWatchlist', 'true');
      params.set('pageSize', '200');
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
  }, [fetchShipments, search]);

  // Helper to parse date string to timestamp (midnight UTC)
  const parseDate = (dateStr: string | null): number | null => {
    if (!dateStr) return null;
    // Parse YYYY-MM-DD format, treat as UTC
    const d = new Date(dateStr + 'T00:00:00Z');
    return d.getTime();
  };

  // Process and filter shipments based on view mode
  const { urgent, attention, onTrack, filtered, stats } = useMemo(() => {
    // Get today at midnight UTC
    const now = new Date();
    const todayMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    const threeDaysMs = todayMs + 3 * 24 * 60 * 60 * 1000;
    const sevenDaysAgoMs = todayMs - 7 * 24 * 60 * 60 * 1000;
    const sevenDaysAheadMs = todayMs + 7 * 24 * 60 * 60 * 1000;

    // First, filter by view mode (departure/arrival window)
    let workingSet = shipments;

    if (viewMode === 'departure') {
      workingSet = shipments.filter((s) => {
        const etdMs = parseDate(s.etd);
        if (etdMs === null) return false;
        return etdMs >= sevenDaysAgoMs && etdMs <= sevenDaysAheadMs;
      });
    } else if (viewMode === 'arrival') {
      workingSet = shipments.filter((s) => {
        const etaMs = parseDate(s.eta);
        if (etaMs === null) return false;
        return etaMs >= sevenDaysAgoMs && etaMs <= sevenDaysAheadMs;
      });
    }

    // Categorize by urgency
    const urgentList: ShipmentListItem[] = [];
    const attentionList: ShipmentListItem[] = [];
    const onTrackList: ShipmentListItem[] = [];

    workingSet.forEach((s) => {
      const etdMs = parseDate(s.etd);
      const aiRisk = s.aiSummary?.riskLevel;
      const hasOverdue = s.actions?.overdue > 0;
      const hasIssues = s.issues?.count > 0;

      // Determine urgency
      const isUrgent =
        aiRisk === 'red' ||
        hasOverdue ||
        (etdMs !== null && etdMs <= todayMs);

      const needsAttention =
        aiRisk === 'amber' ||
        hasIssues ||
        (etdMs !== null && etdMs <= threeDaysMs);

      if (isUrgent) {
        urgentList.push(s);
      } else if (needsAttention) {
        attentionList.push(s);
      } else {
        onTrackList.push(s);
      }
    });

    // Sort based on view mode
    // Departure/Arrival views: farthest first (descending), All view: closest first (ascending)
    const sortByDate = (a: ShipmentListItem, b: ShipmentListItem) => {
      let dateA: string | null;
      let dateB: string | null;

      if (viewMode === 'arrival') {
        dateA = a.eta || a.etd;
        dateB = b.eta || b.etd;
      } else {
        // 'all' and 'departure' sort by ETD
        dateA = a.etd || a.eta;
        dateB = b.etd || b.eta;
      }

      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;

      // Departure/Arrival: descending (farthest first), All: ascending (closest first)
      const diff = new Date(dateA).getTime() - new Date(dateB).getTime();
      return viewMode === 'all' ? diff : -diff;
    };

    urgentList.sort(sortByDate);
    attentionList.sort(sortByDate);
    onTrackList.sort(sortByDate);

    // Apply urgency filter
    let filteredList: ShipmentListItem[] = [];
    if (filterMode === 'urgent') {
      filteredList = urgentList;
    } else if (filterMode === 'attention') {
      filteredList = [...urgentList, ...attentionList];
    } else {
      filteredList = [...urgentList, ...attentionList, ...onTrackList];
    }

    return {
      urgent: urgentList,
      attention: attentionList,
      onTrack: onTrackList,
      filtered: filteredList,
      stats: {
        total: workingSet.length,
        urgentCount: urgentList.length,
        attentionCount: attentionList.length,
        onTrackCount: onTrackList.length,
      },
    };
  }, [shipments, viewMode, filterMode]);

  const handleViewDetails = (shipmentId: string) => {
    router.push(`/v2/${shipmentId}`);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getUrgencyIndicator = (s: ShipmentListItem) => {
    const aiRisk = s.aiSummary?.riskLevel;
    if (aiRisk === 'red' || s.actions?.overdue > 0) return 'urgent';
    if (aiRisk === 'amber' || s.issues?.count > 0) return 'attention';
    return 'normal';
  };

  // Get days until/since date
  const getDaysLabel = (dateStr: string | null) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    date.setHours(0, 0, 0, 0);
    const diffDays = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays === -1) return 'Yesterday';
    if (diffDays > 0) return `in ${diffDays}d`;
    return `${Math.abs(diffDays)}d ago`;
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink-text)' }}>
          Shipments
        </h1>
        <div className="mt-2 flex items-center gap-4 text-sm">
          {stats.urgentCount > 0 && (
            <span style={{ color: '#ef4444' }}>
              {stats.urgentCount} urgent
            </span>
          )}
          {stats.attentionCount > 0 && (
            <span style={{ color: '#f59e0b' }}>
              {stats.attentionCount} need attention
            </span>
          )}
          <span style={{ color: 'var(--ink-text-muted)' }}>
            {stats.onTrackCount} on track
          </span>
        </div>
      </div>

      {/* View Mode Toggle */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex items-center gap-1 rounded-lg p-1" style={{ backgroundColor: 'var(--ink-surface)' }}>
          <button
            onClick={() => setViewMode('all')}
            className="px-4 py-2 rounded-md text-sm font-medium transition-colors"
            style={{
              backgroundColor: viewMode === 'all' ? 'var(--ink-elevated)' : 'transparent',
              color: viewMode === 'all' ? 'var(--ink-text)' : 'var(--ink-text-muted)',
            }}
          >
            All
          </button>
          <button
            onClick={() => setViewMode('departure')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors"
            style={{
              backgroundColor: viewMode === 'departure' ? 'var(--ink-elevated)' : 'transparent',
              color: viewMode === 'departure' ? 'var(--ink-text)' : 'var(--ink-text-muted)',
            }}
          >
            <Ship className="h-3.5 w-3.5" />
            Departure
          </button>
          <button
            onClick={() => setViewMode('arrival')}
            className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors"
            style={{
              backgroundColor: viewMode === 'arrival' ? 'var(--ink-elevated)' : 'transparent',
              color: viewMode === 'arrival' ? 'var(--ink-text)' : 'var(--ink-text-muted)',
            }}
          >
            <Anchor className="h-3.5 w-3.5" />
            Arrival
          </button>
        </div>
        {(viewMode === 'departure' || viewMode === 'arrival') && (
          <span className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>
            ±7 days from today
          </span>
        )}
      </div>

      {/* Search + Filter */}
      <div className="flex items-center gap-3 mb-6">
        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2"
            style={{ color: 'var(--ink-text-muted)' }}
          />
          <input
            type="text"
            placeholder="Search booking, BL, vessel, shipper..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-1"
            style={{
              backgroundColor: 'var(--ink-surface)',
              borderColor: 'var(--ink-border)',
              color: 'var(--ink-text)',
            }}
          />
        </div>

        {/* Urgency Filter Pills with counts */}
        <div className="flex items-center gap-1 rounded-lg p-1" style={{ backgroundColor: 'var(--ink-surface)' }}>
          <button
            onClick={() => setFilterMode('all')}
            className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            style={{
              backgroundColor: filterMode === 'all' ? 'var(--ink-elevated)' : 'transparent',
              color: filterMode === 'all' ? 'var(--ink-text)' : 'var(--ink-text-muted)',
            }}
          >
            All ({stats.total})
          </button>
          <button
            onClick={() => setFilterMode('attention')}
            className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            style={{
              backgroundColor: filterMode === 'attention' ? 'var(--ink-elevated)' : 'transparent',
              color: filterMode === 'attention' ? '#f59e0b' : 'var(--ink-text-muted)',
            }}
          >
            Attention ({stats.urgentCount + stats.attentionCount})
          </button>
          <button
            onClick={() => setFilterMode('urgent')}
            className="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
            style={{
              backgroundColor: filterMode === 'urgent' ? 'var(--ink-elevated)' : 'transparent',
              color: filterMode === 'urgent' ? '#ef4444' : 'var(--ink-text-muted)',
            }}
          >
            Urgent ({stats.urgentCount})
          </button>
        </div>
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
            {viewMode !== 'all'
              ? `No shipments with ${viewMode === 'departure' ? 'ETD' : 'ETA'} within ±7 days`
              : 'Try adjusting your search or filters'
            }
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((shipment) => {
            const urgency = getUrgencyIndicator(shipment);
            const borderColor = urgency === 'urgent' ? '#ef4444' : urgency === 'attention' ? '#f59e0b' : 'transparent';

            // Highlight the relevant date based on view mode
            const primaryDate = viewMode === 'arrival' ? shipment.eta : shipment.etd;
            const primaryLabel = viewMode === 'arrival' ? 'ETA' : 'ETD';
            const daysLabel = getDaysLabel(primaryDate);

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
                {/* Row 1: Booking | Route | Carrier | Primary Date */}
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
                    {/* Show relative time badge in departure/arrival views */}
                    {viewMode !== 'all' && daysLabel && (
                      <span
                        className="text-xs font-medium px-2 py-1 rounded"
                        style={{
                          backgroundColor: 'var(--ink-elevated)',
                          color: 'var(--ink-text-secondary)'
                        }}
                      >
                        {daysLabel}
                      </span>
                    )}
                    <ChevronRight
                      className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity"
                      style={{ color: 'var(--ink-text-muted)' }}
                    />
                  </div>
                </div>

                {/* Row 2: Shipper → Consignee + Dates (always show both ETD/ETA) */}
                <div className="mt-1.5 flex items-center justify-between text-sm">
                  <span style={{ color: 'var(--ink-text-muted)' }}>
                    {shipment.shipper || '—'} → {shipment.consignee || '—'}
                  </span>
                  <div className="flex items-center gap-3" style={{ color: 'var(--ink-text-secondary)' }}>
                    <span style={{ fontWeight: viewMode === 'departure' ? 500 : 400 }}>
                      ETD {formatDate(shipment.etd) || '—'}
                    </span>
                    <span style={{ color: 'var(--ink-text-muted)' }}>→</span>
                    <span style={{ fontWeight: viewMode === 'arrival' ? 500 : 400 }}>
                      ETA {formatDate(shipment.eta) || '—'}
                    </span>
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
