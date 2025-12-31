'use client';

import { Suspense, useEffect, useState, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Search,
  Ship,
  Package,
  Anchor,
  Truck,
  X,
  Loader2,
  ChevronRight,
  Calendar,
  MapPin,
  FileText,
  AlertCircle,
} from 'lucide-react';

interface Shipment {
  id: string;
  booking_number: string | null;
  bl_number: string | null;
  status: string;
  workflow_state: string | null;
  vessel_name: string | null;
  voyage_number: string | null;
  port_of_loading: string | null;
  port_of_loading_code: string | null;
  port_of_discharge: string | null;
  port_of_discharge_code: string | null;
  place_of_receipt: string | null;
  place_of_delivery: string | null;
  etd: string | null;
  eta: string | null;
  container_count: number | null;
  shipper_name?: string | null;
  consignee_name?: string | null;
  document_count?: number;
}

type Phase = 'all' | 'pre_departure' | 'in_transit' | 'arrival' | 'delivered';

// Terminal-style status colors
const STATUS_DOT_COLORS: Record<string, string> = {
  in_transit: 'bg-terminal-purple',
  arrived: 'bg-terminal-amber',
  delivered: 'bg-terminal-green',
  booked: 'bg-terminal-blue',
  draft: 'bg-terminal-muted',
};

const STATUS_TEXT_COLORS: Record<string, string> = {
  in_transit: 'text-terminal-purple',
  arrived: 'text-terminal-amber',
  delivered: 'text-terminal-green',
  booked: 'text-terminal-blue',
  draft: 'text-terminal-muted',
};

// Phase colors for tabs
const PHASE_COLORS: Record<Phase, { dot: string; text: string; active: string }> = {
  all: { dot: 'bg-terminal-green', text: 'text-terminal-green', active: 'border-terminal-green' },
  pre_departure: { dot: 'bg-terminal-blue', text: 'text-terminal-blue', active: 'border-terminal-blue' },
  in_transit: { dot: 'bg-terminal-purple', text: 'text-terminal-purple', active: 'border-terminal-purple' },
  arrival: { dot: 'bg-terminal-amber', text: 'text-terminal-amber', active: 'border-terminal-amber' },
  delivered: { dot: 'bg-terminal-green', text: 'text-terminal-green', active: 'border-terminal-green' },
};

function ShipmentsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activePhase, setActivePhase] = useState<Phase>('all');
  const [quickFilter, setQuickFilter] = useState<string | null>(null);

  // Initialize from URL params
  useEffect(() => {
    const phase = searchParams.get('phase') as Phase;
    const filter = searchParams.get('filter');

    if (phase && ['all', 'pre_departure', 'in_transit', 'arrival', 'delivered'].includes(phase)) {
      setActivePhase(phase);
    }
    if (filter) {
      setQuickFilter(filter);
    }
  }, [searchParams]);

  useEffect(() => {
    fetchShipments();
  }, []);

  const fetchShipments = async () => {
    try {
      // Fetch only confirmed shipments (with booking confirmation)
      const response = await fetch('/api/shipments?confirmed_only=true&limit=500');
      const data = await response.json();
      setShipments(data.shipments || []);
    } catch (error) {
      console.error('Failed to fetch shipments:', error);
    } finally {
      setLoading(false);
    }
  };

  // Phase counts
  const phaseCounts = useMemo(() => {
    const counts = { all: 0, pre_departure: 0, in_transit: 0, arrival: 0, delivered: 0 };

    for (const s of shipments) {
      counts.all++;
      const status = (s.status || '').toLowerCase();
      if (status === 'in_transit') counts.in_transit++;
      else if (status === 'arrived') counts.arrival++;
      else if (status === 'delivered') counts.delivered++;
      else counts.pre_departure++;
    }

    return counts;
  }, [shipments]);

  // Filtered shipments
  const filteredShipments = useMemo(() => {
    return shipments.filter(s => {
      const status = (s.status || '').toLowerCase();

      // Phase filter
      if (activePhase !== 'all') {
        if (activePhase === 'pre_departure' && !['booked', 'draft'].includes(status)) return false;
        if (activePhase === 'in_transit' && status !== 'in_transit') return false;
        if (activePhase === 'arrival' && status !== 'arrived') return false;
        if (activePhase === 'delivered' && status !== 'delivered') return false;
      }

      // Quick filter (from Mission Control)
      if (quickFilter) {
        const today = new Date().toISOString().split('T')[0];
        if (quickFilter === 'departing_today') {
          const etd = s.etd ? s.etd.split('T')[0] : null;
          if (etd !== today) return false;
        }
        if (quickFilter === 'arriving_today') {
          const eta = s.eta ? s.eta.split('T')[0] : null;
          if (eta !== today) return false;
        }
      }

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const searchable = [
          s.booking_number,
          s.bl_number,
          s.vessel_name,
          s.port_of_loading,
          s.port_of_discharge,
          s.shipper_name,
          s.consignee_name,
        ].filter(Boolean).join(' ').toLowerCase();
        if (!searchable.includes(query)) return false;
      }

      return true;
    });
  }, [shipments, activePhase, quickFilter, searchQuery]);

  const getQuickFilterLabel = (filter: string) => {
    switch (filter) {
      case 'departing_today': return 'Departing Today';
      case 'arriving_today': return 'Arriving Today';
      default: return filter;
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '--';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getStatusDot = (status: string) => {
    const s = status?.toLowerCase() || 'draft';
    return STATUS_DOT_COLORS[s] || 'bg-terminal-muted';
  };

  const getStatusText = (status: string) => {
    const s = status?.toLowerCase() || 'draft';
    return STATUS_TEXT_COLORS[s] || 'text-terminal-muted';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-terminal-bg flex items-center justify-center">
        <div className="flex items-center gap-3 text-terminal-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="font-mono text-sm">Loading shipments...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-terminal-bg">
      <div className="p-6 space-y-5">
        {/* Header - Terminal Style */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-terminal-blue/10 border border-terminal-blue/30">
              <Ship className="h-5 w-5 text-terminal-blue" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-terminal-text flex items-center gap-2">
                Shipments
                <span className="text-xs font-mono text-terminal-muted">v1.0</span>
              </h1>
              <p className="text-xs text-terminal-muted font-mono mt-0.5">
                ~/orion/shipments
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-terminal-muted bg-terminal-elevated px-2 py-1 rounded border border-terminal-border">
              [{shipments.length}] confirmed
            </span>
          </div>
        </div>

        {/* Phase Tabs - Terminal Style */}
        <div className="flex items-center gap-1 border-b border-terminal-border">
          {[
            { id: 'all' as Phase, label: 'All', icon: Ship, count: phaseCounts.all },
            { id: 'pre_departure' as Phase, label: 'Pre-Departure', icon: Package, count: phaseCounts.pre_departure },
            { id: 'in_transit' as Phase, label: 'In Transit', icon: Ship, count: phaseCounts.in_transit },
            { id: 'arrival' as Phase, label: 'Arrival', icon: Anchor, count: phaseCounts.arrival },
            { id: 'delivered' as Phase, label: 'Delivered', icon: Truck, count: phaseCounts.delivered },
          ].map((tab) => {
            const colors = PHASE_COLORS[tab.id];
            const isActive = activePhase === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => {
                  setActivePhase(tab.id);
                  setQuickFilter(null);
                }}
                className={`
                  flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors
                  ${isActive
                    ? `${colors.active} ${colors.text}`
                    : 'border-transparent text-terminal-muted hover:text-terminal-text hover:border-terminal-border'
                  }
                `}
              >
                <span className={`h-2 w-2 rounded-full ${isActive ? colors.dot : 'bg-terminal-muted'}`} />
                <tab.icon className="h-4 w-4" />
                <span className="font-mono">{tab.label}</span>
                <span className={`px-1.5 py-0.5 text-xs font-mono rounded border ${
                  isActive
                    ? `${colors.text} bg-transparent border-current`
                    : 'bg-terminal-elevated text-terminal-muted border-terminal-border'
                }`}>
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search and Filters - Terminal Style */}
        <div className="flex items-center gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-terminal-muted" />
            <input
              type="text"
              placeholder="Search by booking #, BL #, vessel, port..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-terminal-border rounded-lg focus:ring-2 focus:ring-terminal-blue/50 focus:border-terminal-blue bg-terminal-surface text-terminal-text placeholder:text-terminal-muted font-mono text-sm"
            />
          </div>

          {/* Quick Filter Badge - Terminal Style */}
          {quickFilter && (
            <div className="flex items-center gap-2 px-3 py-2 bg-terminal-amber/10 text-terminal-amber border border-terminal-amber/30 rounded-lg text-sm font-mono">
              <span className="h-2 w-2 rounded-full bg-terminal-amber" />
              <Calendar className="h-4 w-4" />
              {getQuickFilterLabel(quickFilter)}
              <button
                onClick={() => setQuickFilter(null)}
                className="hover:text-terminal-red transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Results count - Terminal Style */}
          <span className="text-xs font-mono text-terminal-muted">
            [{filteredShipments.length}] results
          </span>
        </div>

        {/* Shipments List - Terminal Style */}
        {filteredShipments.length === 0 ? (
          <div className="text-center py-16 bg-terminal-surface rounded-lg border border-terminal-border">
            <Ship className="h-12 w-12 text-terminal-muted mx-auto mb-4" />
            <p className="text-terminal-muted font-mono">No shipments found</p>
            {(searchQuery || quickFilter) && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setQuickFilter(null);
                }}
                className="mt-3 text-terminal-blue hover:text-terminal-green text-sm font-mono transition-colors"
              >
                [clear filters]
              </button>
            )}
          </div>
        ) : (
          <div className="bg-terminal-surface rounded-lg border border-terminal-border overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-terminal-elevated border-b border-terminal-border">
                  <th className="text-left px-4 py-3 text-xs font-mono font-medium text-terminal-muted uppercase tracking-wider">Shipment</th>
                  <th className="text-left px-4 py-3 text-xs font-mono font-medium text-terminal-muted uppercase tracking-wider">Route</th>
                  <th className="text-left px-4 py-3 text-xs font-mono font-medium text-terminal-muted uppercase tracking-wider">Dates</th>
                  <th className="text-left px-4 py-3 text-xs font-mono font-medium text-terminal-muted uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-mono font-medium text-terminal-muted uppercase tracking-wider">Docs</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-terminal-border">
                {filteredShipments.map((shipment) => (
                  <tr
                    key={shipment.id}
                    onClick={() => router.push(`/shipments/${shipment.id}`)}
                    className="hover:bg-terminal-elevated cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-4">
                      <div className="font-mono font-medium text-terminal-text">
                        {shipment.booking_number || shipment.bl_number || 'No reference'}
                      </div>
                      {shipment.vessel_name && (
                        <div className="text-xs font-mono text-terminal-muted mt-0.5">
                          {shipment.vessel_name} {shipment.voyage_number && `/ ${shipment.voyage_number}`}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-1 text-sm font-mono">
                        {/* Main Route: POL → POD */}
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3.5 w-3.5 text-terminal-muted" />
                          <span className="text-terminal-muted">
                            {shipment.port_of_loading || '--'}
                          </span>
                          <span className="text-terminal-blue">→</span>
                          <span className="text-terminal-text font-medium">
                            {shipment.port_of_discharge || '--'}
                          </span>
                        </div>
                        {/* Inland Ports: POR / POFD */}
                        {(shipment.place_of_receipt || shipment.place_of_delivery) && (
                          <div className="flex items-center gap-2 text-xs text-terminal-muted">
                            <Truck className="h-3 w-3" />
                            {shipment.place_of_receipt && (
                              <span title="Place of Receipt">{shipment.place_of_receipt}</span>
                            )}
                            {shipment.place_of_receipt && shipment.place_of_delivery && (
                              <span>→</span>
                            )}
                            {shipment.place_of_delivery && (
                              <span title="Place of Delivery">{shipment.place_of_delivery}</span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="text-xs font-mono">
                        <div className="flex items-center gap-2">
                          <span className="text-terminal-muted">ETD:</span>
                          <span className="text-terminal-text">{formatDate(shipment.etd)}</span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-terminal-muted">ETA:</span>
                          <span className="text-terminal-text">{formatDate(shipment.eta)}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${getStatusDot(shipment.status)}`} />
                        <span className={`font-mono text-xs uppercase ${getStatusText(shipment.status)}`}>
                          {shipment.status?.replace(/_/g, ' ') || 'UNKNOWN'}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1.5 text-xs font-mono text-terminal-muted">
                        <FileText className="h-4 w-4" />
                        <span>{shipment.document_count || 0}</span>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <ChevronRight className="h-4 w-4 text-terminal-muted" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ShipmentsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin text-terminal-muted" /></div>}>
      <ShipmentsPageContent />
    </Suspense>
  );
}
