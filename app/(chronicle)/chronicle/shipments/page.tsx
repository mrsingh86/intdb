'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Ship,
  Anchor,
  Package,
  Truck,
  Search,
  Filter,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  AlertTriangle,
  Clock,
  MapPin,
  Calendar,
  CheckCircle,
  ArrowUpDown,
  X,
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

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
}

interface FleetData {
  shipments: ShipmentRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: {
    phases: string[];
    carriers: string[];
  };
}

// ============================================================================
// FLEET VIEW
// ============================================================================

export default function FleetViewPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center py-20">
        <RefreshCw className="h-5 w-5 animate-spin text-terminal-muted" />
        <span className="ml-2 text-sm font-mono text-terminal-muted">Loading...</span>
      </div>
    }>
      <FleetViewContent />
    </Suspense>
  );
}

function FleetViewContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [data, setData] = useState<FleetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [selectedPhase, setSelectedPhase] = useState(searchParams.get('phase') || '');
  const [sortBy, setSortBy] = useState(searchParams.get('sort') || 'etd');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(
    (searchParams.get('order') as 'asc' | 'desc') || 'asc'
  );
  const [showFilters, setShowFilters] = useState(false);

  const fetchShipments = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      if (selectedPhase) params.set('phase', selectedPhase);
      params.set('sort', sortBy);
      params.set('order', sortOrder);
      params.set('page', '1');
      params.set('pageSize', '50');

      const response = await fetch(`/api/chronicle/shipments?${params.toString()}`);
      if (response.ok) {
        const result = await response.json();
        setData(result);
      }
    } catch (error) {
      console.error('Failed to fetch shipments:', error);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, selectedPhase, sortBy, sortOrder]);

  useEffect(() => {
    fetchShipments();
  }, [fetchShipments]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchShipments();
  };

  const toggleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedPhase('');
    setSortBy('etd');
    setSortOrder('asc');
  };

  const phases = [
    { value: '', label: 'All Phases', icon: Ship, color: 'text-terminal-muted' },
    { value: 'pre_departure', label: 'Pre-Departure', icon: Package, color: 'text-terminal-blue' },
    { value: 'post_departure', label: 'Post-Departure', icon: Ship, color: 'text-terminal-purple' },
    { value: 'pre_arrival', label: 'Pre-Arrival', icon: Anchor, color: 'text-terminal-amber' },
    { value: 'post_arrival', label: 'Post-Arrival', icon: Truck, color: 'text-terminal-green' },
  ];

  return (
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-terminal-text">Fleet View</h1>
          <p className="text-xs font-mono text-terminal-muted mt-1">
            ~/chronicle/shipments • {data?.total || 0} shipments
          </p>
        </div>
        <button
          onClick={fetchShipments}
          disabled={loading}
          className="flex items-center gap-2 px-3 py-1.5 text-sm font-mono bg-terminal-surface border border-terminal-border rounded-lg hover:bg-terminal-elevated transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Search & Filters */}
      <div className="flex items-center gap-4">
        {/* Search */}
        <form onSubmit={handleSearch} className="flex-1 max-w-md">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-terminal-muted" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search booking, BL, vessel..."
              className="w-full pl-10 pr-4 py-2 bg-terminal-surface border border-terminal-border rounded-lg text-sm font-mono text-terminal-text placeholder:text-terminal-muted focus:outline-none focus:border-terminal-purple"
            />
          </div>
        </form>

        {/* Phase Filter Pills */}
        <div className="flex items-center gap-1">
          {phases.map((phase) => {
            const Icon = phase.icon;
            const isActive = selectedPhase === phase.value;
            return (
              <button
                key={phase.value}
                onClick={() => setSelectedPhase(phase.value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono rounded-lg border transition-colors ${
                  isActive
                    ? 'bg-terminal-purple/10 text-terminal-purple border-terminal-purple/30'
                    : 'bg-terminal-surface text-terminal-muted border-terminal-border hover:border-terminal-muted'
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${isActive ? phase.color : ''}`} />
                {phase.label}
              </button>
            );
          })}
        </div>

        {/* Clear Filters */}
        {(searchQuery || selectedPhase) && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-1 px-2 py-1.5 text-xs font-mono text-terminal-muted hover:text-terminal-text transition-colors"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
        {/* Table Header */}
        <div className="bg-terminal-elevated border-b border-terminal-border px-4 py-2 grid grid-cols-12 gap-4 text-xs font-mono text-terminal-muted uppercase tracking-wide">
          <div className="col-span-2 flex items-center gap-1 cursor-pointer hover:text-terminal-text" onClick={() => toggleSort('booking_number')}>
            Booking
            <SortIndicator field="booking_number" currentSort={sortBy} currentOrder={sortOrder} />
          </div>
          <div className="col-span-2">Route</div>
          <div className="col-span-1 flex items-center gap-1 cursor-pointer hover:text-terminal-text" onClick={() => toggleSort('etd')}>
            ETD
            <SortIndicator field="etd" currentSort={sortBy} currentOrder={sortOrder} />
          </div>
          <div className="col-span-2">Vessel</div>
          <div className="col-span-2">Progress</div>
          <div className="col-span-2">Cutoffs</div>
          <div className="col-span-1 text-right">Docs</div>
        </div>

        {/* Table Body */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-5 w-5 animate-spin text-terminal-muted" />
            <span className="ml-2 text-sm font-mono text-terminal-muted">Loading...</span>
          </div>
        ) : data?.shipments && data.shipments.length > 0 ? (
          <div className="divide-y divide-terminal-border">
            {data.shipments.map((shipment) => (
              <ShipmentRow key={shipment.id} shipment={shipment} />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-terminal-muted">
            <Ship className="h-10 w-10 mb-2" />
            <p className="font-mono text-sm">No shipments found</p>
            {(searchQuery || selectedPhase) && (
              <button
                onClick={clearFilters}
                className="mt-2 text-xs font-mono text-terminal-blue hover:text-terminal-green transition-colors"
              >
                [clear filters]
              </button>
            )}
          </div>
        )}
      </div>

      {/* Pagination */}
      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between text-xs font-mono text-terminal-muted">
          <span>
            Showing {(data.page - 1) * data.pageSize + 1}-{Math.min(data.page * data.pageSize, data.total)} of {data.total}
          </span>
          <div className="flex items-center gap-2">
            <button className="px-3 py-1 bg-terminal-surface border border-terminal-border rounded hover:bg-terminal-elevated transition-colors">
              Previous
            </button>
            <button className="px-3 py-1 bg-terminal-surface border border-terminal-border rounded hover:bg-terminal-elevated transition-colors">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function SortIndicator({
  field,
  currentSort,
  currentOrder,
}: {
  field: string;
  currentSort: string;
  currentOrder: 'asc' | 'desc';
}) {
  if (currentSort !== field) {
    return <ArrowUpDown className="h-3 w-3 opacity-30" />;
  }
  return (
    <ArrowUpDown className={`h-3 w-3 text-terminal-purple ${currentOrder === 'desc' ? 'rotate-180' : ''}`} />
  );
}

function ShipmentRow({ shipment }: { shipment: ShipmentRow }) {
  const getPhaseIcon = (phase: string) => {
    switch (phase?.toLowerCase()) {
      case 'pre_departure': return Package;
      case 'post_departure': return Ship;
      case 'pre_arrival': return Anchor;
      case 'post_arrival': return Truck;
      default: return Package;
    }
  };

  const getPhaseColor = (phase: string) => {
    switch (phase?.toLowerCase()) {
      case 'pre_departure': return 'text-terminal-blue bg-terminal-blue/10 border-terminal-blue/30';
      case 'post_departure': return 'text-terminal-purple bg-terminal-purple/10 border-terminal-purple/30';
      case 'pre_arrival': return 'text-terminal-amber bg-terminal-amber/10 border-terminal-amber/30';
      case 'post_arrival': return 'text-terminal-green bg-terminal-green/10 border-terminal-green/30';
      default: return 'text-terminal-muted bg-terminal-muted/10 border-terminal-border';
    }
  };

  const getProgressColor = (progress: number) => {
    if (progress >= 75) return 'bg-terminal-green';
    if (progress >= 50) return 'bg-terminal-blue';
    if (progress >= 25) return 'bg-terminal-amber';
    return 'bg-terminal-red';
  };

  const PhaseIcon = getPhaseIcon(shipment.phase);

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '--';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <Link
      href={`/chronicle/shipments/${shipment.id}`}
      className="grid grid-cols-12 gap-4 px-4 py-3 hover:bg-terminal-elevated transition-colors group"
    >
      {/* Booking */}
      <div className="col-span-2">
        <div className="flex items-center gap-2">
          <span className={`p-1 rounded border ${getPhaseColor(shipment.phase)}`}>
            <PhaseIcon className="h-3.5 w-3.5" />
          </span>
          <div>
            <div className="text-sm font-mono font-medium text-terminal-text group-hover:text-terminal-purple transition-colors">
              {shipment.bookingNumber}
            </div>
            {shipment.blNumber && (
              <div className="text-[10px] font-mono text-terminal-muted">
                BL: {shipment.blNumber}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Route */}
      <div className="col-span-2 flex items-center">
        <div className="flex items-center gap-1 text-xs font-mono">
          <span className="text-terminal-blue font-medium">{shipment.polCode || shipment.pol || '--'}</span>
          <ChevronRight className="h-3 w-3 text-terminal-muted" />
          <span className="text-terminal-green font-medium">{shipment.podCode || shipment.pod || '--'}</span>
        </div>
      </div>

      {/* ETD */}
      <div className="col-span-1 flex items-center">
        <span className="text-xs font-mono text-terminal-text">
          {formatDate(shipment.etd)}
        </span>
      </div>

      {/* Vessel */}
      <div className="col-span-2 flex items-center">
        <span className="text-xs font-mono text-terminal-muted truncate">
          {shipment.vesselName || '--'}
        </span>
      </div>

      {/* Progress */}
      <div className="col-span-2 flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-terminal-bg rounded-full overflow-hidden border border-terminal-border">
          <div
            className={`h-full ${getProgressColor(shipment.journeyProgress)} transition-all`}
            style={{ width: `${shipment.journeyProgress}%` }}
          />
        </div>
        <span className="text-xs font-mono text-terminal-muted w-8 text-right">
          {shipment.journeyProgress}%
        </span>
      </div>

      {/* Cutoffs */}
      <div className="col-span-2 flex items-center gap-2">
        {shipment.cutoffs.si && (
          <CutoffBadge type="SI" daysRemaining={shipment.cutoffs.si.daysRemaining} />
        )}
        {shipment.cutoffs.vgm && (
          <CutoffBadge type="VGM" daysRemaining={shipment.cutoffs.vgm.daysRemaining} />
        )}
        {!shipment.cutoffs.si && !shipment.cutoffs.vgm && (
          <span className="text-[10px] font-mono text-terminal-muted">--</span>
        )}
      </div>

      {/* Docs Count */}
      <div className="col-span-1 flex items-center justify-end">
        <span className="px-2 py-0.5 text-[10px] font-mono bg-terminal-bg text-terminal-muted border border-terminal-border rounded">
          {shipment.documentsCount}
        </span>
      </div>
    </Link>
  );
}

function CutoffBadge({ type, daysRemaining }: { type: string; daysRemaining: number }) {
  const isUrgent = daysRemaining <= 2;
  const isWarning = daysRemaining <= 5;
  const isOverdue = daysRemaining < 0;

  const colorClass = isOverdue
    ? 'bg-terminal-red/20 text-terminal-red border-terminal-red/30'
    : isUrgent
      ? 'bg-terminal-red/10 text-terminal-red border-terminal-red/30'
      : isWarning
        ? 'bg-terminal-amber/10 text-terminal-amber border-terminal-amber/30'
        : 'bg-terminal-muted/10 text-terminal-muted border-terminal-border';

  return (
    <span className={`px-1.5 py-0.5 text-[10px] font-mono border rounded ${colorClass} ${isUrgent ? 'animate-pulse' : ''}`}>
      {type}:{isOverdue ? 'OD' : `${daysRemaining}d`}
    </span>
  );
}
