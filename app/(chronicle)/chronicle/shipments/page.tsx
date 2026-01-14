'use client';

import { useEffect, useState, useCallback, useMemo, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Loader2, ChevronRight, AlertTriangle, Clock, DollarSign } from 'lucide-react';

/**
 * Chronicle Shipments - v2 Style with Full AI Intelligence
 *
 * Filters:
 * - Risk: Critical | Attention | On Track | All
 * - Time: Today | 3 Days | Week | All
 * - Phase: Departure | Arrival | All
 */

interface AISummary {
  riskLevel: 'red' | 'amber' | 'green' | null;
  riskReason: string | null;
  daysOverdue: number | null;
  escalationCount: number | null;
  issueCount: number | null;
  urgentCount: number | null;
  daysSinceActivity: number | null;
  currentBlocker: string | null;
  blockerOwner: string | null;
  narrative: string | null;
  keyInsight: string | null;
  nextAction: string | null;
  nextActionOwner: string | null;
  financialImpact: {
    documentedCharges: string | null;
    estimatedDetention: string | null;
  } | null;
}

interface ShipmentRow {
  id: string;
  bookingNumber: string;
  blNumber?: string;
  shipper?: string;
  consignee?: string;
  vesselName?: string;
  pol?: string;
  polCode?: string;
  pod?: string;
  podCode?: string;
  etd?: string;
  eta?: string;
  phase: string;
  stage: string;
  journeyProgress: number;
  documentsCount: number;
  cutoffs: {
    si?: { date: string; daysRemaining: number };
    vgm?: { date: string; daysRemaining: number };
  };
  carrier?: string;
  createdAt: string;
  aiSummary?: AISummary | null;
}

type RiskFilter = 'all' | 'red' | 'amber' | 'green';
type PhaseFilter = 'all' | 'departure' | 'arrival';

export default function ShipmentsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ShipmentsContent />
    </Suspense>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-6 w-6 animate-spin text-terminal-muted" />
    </div>
  );
}

function ShipmentsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(searchParams.get('q') || '');
  const [riskFilter, setRiskFilter] = useState<RiskFilter>('all');
  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>('all');

  const fetchShipments = useCallback(async (phase: PhaseFilter) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: '1', pageSize: '300' });

      if (phase === 'arrival') {
        // Arrivals: filter by ETA ±15 days, sort ascending (soonest first)
        params.set('sort', 'eta');
        params.set('order', 'asc');
        params.set('dateWindow', '15');
      } else if (phase === 'departure') {
        // Departures: filter by ETD ±15 days, sort ascending (soonest first)
        params.set('sort', 'etd');
        params.set('order', 'asc');
        params.set('dateWindow', '15');
      } else {
        // All: no date filter, sort by ETD descending (most recent first)
        params.set('sort', 'etd');
        params.set('order', 'desc');
      }

      const res = await fetch(`/api/chronicle/shipments?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setShipments(data.shipments || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchShipments(phaseFilter);
  }, [fetchShipments, phaseFilter]);

  // Filter and categorize
  const { filtered, stats } = useMemo(() => {
    if (!shipments || shipments.length === 0) {
      return { filtered: [], stats: { red: 0, amber: 0, green: 0, total: 0 } };
    }

    let list = [...shipments];

    // Search filter
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s =>
        s.bookingNumber?.toLowerCase().includes(q) ||
        s.blNumber?.toLowerCase().includes(q) ||
        s.shipper?.toLowerCase().includes(q) ||
        s.consignee?.toLowerCase().includes(q) ||
        s.vesselName?.toLowerCase().includes(q)
      );
    }

    // Phase filter
    // Departure = has ETD, Arrival = has ETA
    if (phaseFilter !== 'all') {
      list = list.filter(s => {
        if (phaseFilter === 'departure') {
          return !!s.etd;
        } else if (phaseFilter === 'arrival') {
          return !!s.eta;
        }
        return true;
      });
    }

    // Categorize by risk
    const red: ShipmentRow[] = [];
    const amber: ShipmentRow[] = [];
    const green: ShipmentRow[] = [];

    list.forEach(s => {
      const risk = s.aiSummary?.riskLevel || 'green';
      if (risk === 'red') red.push(s);
      else if (risk === 'amber') amber.push(s);
      else green.push(s);
    });

    // Apply risk filter
    let result: ShipmentRow[];
    if (riskFilter === 'red') result = red;
    else if (riskFilter === 'amber') result = amber;
    else if (riskFilter === 'green') result = green;
    else result = [...red, ...amber, ...green];

    // Sort by date
    const now = Date.now();
    result.sort((a, b) => {
      const dateA = phaseFilter === 'arrival'
        ? new Date(a.eta || '1970-01-01').getTime()
        : new Date(a.etd || '1970-01-01').getTime();
      const dateB = phaseFilter === 'arrival'
        ? new Date(b.eta || '1970-01-01').getTime()
        : new Date(b.etd || '1970-01-01').getTime();

      if (phaseFilter === 'all') {
        // All tab: descending (most recent first)
        return dateB - dateA;
      } else {
        // Arrival/Departure: future dates first (ascending), then past dates (descending)
        const aIsFuture = dateA >= now;
        const bIsFuture = dateB >= now;

        if (aIsFuture && !bIsFuture) return -1; // a is future, b is past -> a first
        if (!aIsFuture && bIsFuture) return 1;  // a is past, b is future -> b first
        if (aIsFuture && bIsFuture) return dateA - dateB; // Both future: ascending
        return dateB - dateA; // Both past: descending (most recent past first)
      }
    });

    return {
      filtered: result,
      stats: { red: red.length, amber: amber.length, green: green.length, total: list.length }
    };
  }, [shipments, search, riskFilter, phaseFilter]);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <div className="max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-terminal-text">Shipments</h1>
        <div className="mt-2 flex items-center gap-4 text-sm">
          {stats.red > 0 && <span className="text-red-500">{stats.red} critical</span>}
          {stats.amber > 0 && <span className="text-amber-500">{stats.amber} attention</span>}
          <span className="text-green-500">{stats.green} on track</span>
        </div>
      </div>

      {/* Filters - All in one row */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {/* Search */}
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          className="w-40 rounded-lg border border-terminal-border bg-terminal-surface px-3 py-1.5 text-sm text-terminal-text placeholder:text-terminal-muted focus:outline-none focus:ring-1 focus:ring-terminal-purple"
        />

        {/* Phase Filter */}
        <div className="flex gap-0.5 rounded-lg border border-terminal-border bg-terminal-surface p-0.5">
          {(['all', 'departure', 'arrival'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setPhaseFilter(filter)}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                phaseFilter === filter
                  ? 'bg-terminal-elevated text-terminal-text'
                  : 'text-terminal-muted hover:text-terminal-text'
              }`}
            >
              {filter === 'all' ? 'All' : filter === 'departure' ? 'Dep' : 'Arr'}
            </button>
          ))}
        </div>

        {/* Risk Filter */}
        <div className="flex gap-0.5 rounded-lg border border-terminal-border bg-terminal-surface p-0.5">
          <button
            onClick={() => setRiskFilter('all')}
            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
              riskFilter === 'all' ? 'bg-terminal-elevated text-terminal-text' : 'text-terminal-muted hover:text-terminal-text'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setRiskFilter('red')}
            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
              riskFilter === 'red' ? 'bg-red-500/20 text-red-500' : 'text-red-500/70 hover:text-red-500'
            }`}
          >
            Critical
          </button>
          <button
            onClick={() => setRiskFilter('amber')}
            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
              riskFilter === 'amber' ? 'bg-amber-500/20 text-amber-500' : 'text-amber-500/70 hover:text-amber-500'
            }`}
          >
            Attention
          </button>
          <button
            onClick={() => setRiskFilter('green')}
            className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
              riskFilter === 'green' ? 'bg-green-500/20 text-green-500' : 'text-green-500/70 hover:text-green-500'
            }`}
          >
            On Track
          </button>
        </div>

        {/* Clear */}
        {(phaseFilter !== 'all' || riskFilter !== 'all' || search) && (
          <button
            onClick={() => {
              setPhaseFilter('all');
              setRiskFilter('all');
              setSearch('');
            }}
            className="px-2 py-1 text-xs text-terminal-muted hover:text-red-500 transition-colors"
          >
            ✕
          </button>
        )}
      </div>

      {/* Content */}
      {loading ? (
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-terminal-border bg-terminal-surface p-4 animate-pulse"
              style={{ borderLeftWidth: '3px', borderLeftColor: 'var(--terminal-border)' }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-5 w-32 rounded bg-terminal-elevated" />
                  <div className="h-4 w-24 rounded bg-terminal-elevated" />
                </div>
                <div className="h-6 w-16 rounded bg-terminal-elevated" />
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="h-4 w-48 rounded bg-terminal-elevated" />
                <div className="h-4 w-32 rounded bg-terminal-elevated" />
              </div>
              <div className="mt-3 h-12 rounded bg-terminal-elevated" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-lg bg-red-500/10 p-6 text-center">
          <p className="text-red-500">{error}</p>
          <button onClick={() => fetchShipments(phaseFilter)} className="mt-3 px-4 py-2 bg-red-500 text-white rounded-md text-sm">
            Retry
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-terminal-muted">
          <p className="text-lg">No shipments found</p>
          <p className="mt-1 text-sm">Try adjusting your search or filters</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((shipment) => {
            const risk = shipment.aiSummary?.riskLevel || 'green';
            const ai = shipment.aiSummary;
            const borderColor = risk === 'red' ? '#ef4444' : risk === 'amber' ? '#f59e0b' : 'transparent';

            return (
              <div
                key={shipment.id}
                onClick={() => router.push(`/chronicle/shipments/${shipment.id}`)}
                className="group cursor-pointer rounded-lg border border-terminal-border bg-terminal-surface p-4 transition-all hover:shadow-md"
                style={{ borderLeftWidth: '3px', borderLeftColor: borderColor }}
              >
                {/* Row 1: Booking | Route | Carrier | Risk Badge */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-semibold font-mono text-terminal-text">
                      {shipment.bookingNumber || shipment.blNumber || '—'}
                    </span>
                    <span className="text-sm text-terminal-secondary">
                      {shipment.pol?.split(',')[0] || shipment.polCode || '?'} → {shipment.pod?.split(',')[0] || shipment.podCode || '?'}
                    </span>
                    {shipment.carrier && (
                      <span className="text-xs px-2 py-0.5 rounded bg-terminal-elevated text-terminal-muted">
                        {shipment.carrier}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs font-medium px-2 py-1 rounded"
                      style={{
                        backgroundColor: risk === 'red' ? 'rgba(239, 68, 68, 0.15)' : risk === 'amber' ? 'rgba(245, 158, 11, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                        color: risk === 'red' ? '#ef4444' : risk === 'amber' ? '#f59e0b' : '#22c55e',
                      }}
                    >
                      {risk === 'red' ? 'Critical' : risk === 'amber' ? 'Attention' : 'On Track'}
                    </span>
                    <ChevronRight className="h-4 w-4 text-terminal-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                </div>

                {/* Row 2: Shipper → Consignee | Dates */}
                <div className="mt-1.5 flex items-center justify-between text-sm">
                  <span className="text-terminal-muted truncate">
                    {shipment.shipper || '—'} → {shipment.consignee || '—'}
                  </span>
                  <div className="flex items-center gap-3 text-terminal-secondary shrink-0">
                    <span>ETD {formatDate(shipment.etd)}</span>
                    <span className="text-terminal-muted">→</span>
                    <span>ETA {formatDate(shipment.eta)}</span>
                  </div>
                </div>

                {/* Row 3: AI Intelligence */}
                {ai && (
                  <div className="mt-3 space-y-2">
                    {/* Narrative */}
                    {ai.narrative && (
                      <p className="text-sm text-terminal-text/70 leading-relaxed">
                        {ai.narrative}
                      </p>
                    )}

                    {/* Blocker (red) */}
                    {ai.currentBlocker && (
                      <div className="text-sm" style={{ color: '#ef4444' }}>
                        <span className="font-medium">Blocker:</span> {ai.currentBlocker}
                        {ai.blockerOwner && (
                          <span
                            className="ml-2 text-xs px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)' }}
                          >
                            {ai.blockerOwner}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Next Action (amber) */}
                    {ai.nextAction && (
                      <div className="text-sm" style={{ color: '#f59e0b' }}>
                        <span className="font-medium">Next:</span> {ai.nextAction}
                        {ai.nextActionOwner && (
                          <span
                            className="ml-2 text-xs px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)' }}
                          >
                            {ai.nextActionOwner}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Badges: Issues, Escalations, Financial, Overdue */}
                    {(ai.issueCount || ai.escalationCount || ai.daysOverdue || ai.financialImpact?.documentedCharges || ai.financialImpact?.estimatedDetention) && (
                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {ai.daysOverdue && ai.daysOverdue > 0 && ai.daysOverdue <= 90 && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded" style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>
                            <Clock className="h-3 w-3" />
                            {ai.daysOverdue}d overdue
                          </span>
                        )}
                        {ai.daysOverdue && ai.daysOverdue > 90 && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-terminal-elevated text-terminal-muted">
                            <Clock className="h-3 w-3" />
                            Stale data
                          </span>
                        )}
                        {ai.issueCount && ai.issueCount > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded" style={{ backgroundColor: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>
                            <AlertTriangle className="h-3 w-3" />
                            {ai.issueCount} issues
                          </span>
                        )}
                        {ai.escalationCount && ai.escalationCount > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded" style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>
                            {ai.escalationCount} escalations
                          </span>
                        )}
                        {ai.financialImpact?.documentedCharges && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-terminal-elevated text-terminal-muted">
                            <DollarSign className="h-3 w-3" />
                            {ai.financialImpact.documentedCharges}
                          </span>
                        )}
                        {ai.financialImpact?.estimatedDetention && (
                          <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded" style={{ backgroundColor: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b' }}>
                            <DollarSign className="h-3 w-3" />
                            {ai.financialImpact.estimatedDetention}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Fallback for shipments without AI summary */}
                {!ai?.narrative && !ai?.currentBlocker && !ai?.nextAction && (
                  <div className="mt-3 flex items-center gap-4 text-sm text-terminal-muted">
                    <span>Stage: {shipment.stage || 'PENDING'}</span>
                    {shipment.documentsCount > 0 && (
                      <span>{shipment.documentsCount} documents</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
