'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Ship,
  Anchor,
  Package,
  Truck,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  AlertTriangle,
  Clock,
  MapPin,
  Calendar,
  CheckCircle,
  FileText,
  Mail,
  ExternalLink,
  ArrowLeft,
  Container,
  Building2,
  User,
  Boxes,
  Route,
  Timer,
  ChevronUp,
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

interface ShipmentData {
  shipment: {
    id: string;
    bookingNumber: string;
    blNumber?: string;
    shipper?: string;
    consignee?: string;
    notifyParty?: string;
    vessel?: string;
    voyage?: string;
    carrier?: string;
    phase: string;
    stage: string;
    journeyProgress: number;
    cargo: {
      description?: string;
      commodity?: string;
      containerCount: number;
      incoterm?: string;
    };
    dates: {
      etd?: string;
      eta?: string;
      actualDeparture?: string;
      actualArrival?: string;
    };
    createdAt: string;
    updatedAt: string;
    status: string;
  };
  routing: {
    originInland?: string;
    portOfLoading?: string;
    portOfLoadingCode?: string;
    vesselName?: string;
    voyageNumber?: string;
    portOfDischarge?: string;
    portOfDischargeCode?: string;
    destinationInland?: string;
    currentPhase: string;
    journeyProgress: number;
  };
  cutoffs: Array<{
    type: string;
    label: string;
    date: string | null;
    daysRemaining: number | null;
    hoursRemaining: number | null;
    status: 'safe' | 'warning' | 'urgent' | 'overdue' | 'submitted' | 'unknown';
  }>;
  containers: Array<{
    number: string;
    type: string;
    seal?: string;
    weight?: number;
    status?: string;
  }>;
  chapters: Array<{
    id: string;
    phase: string;
    title: string;
    subtitle: string;
    status: 'completed' | 'active' | 'upcoming';
    documents: Array<{
      id: string;
      type: string;
      subject: string;
      date: string;
      confidence: number;
    }>;
    events: Array<{
      id: string;
      type: string;
      date: string;
      description: string;
    }>;
    summary: string;
  }>;
  chronicles: Array<{
    id: string;
    messageId: string;
    subject: string;
    sender: string;
    receivedAt: string;
    documentType: string;
    carrier: string;
    confidence: number;
    extractedData: Record<string, unknown>;
    hasAttachments: boolean;
    attachmentCount: number;
  }>;
  events: Array<{
    id: string;
    type: string;
    date: string;
    location?: string;
    description: string;
    source?: string;
  }>;
}

// ============================================================================
// SHIPMENT STORY PAGE
// ============================================================================

export default function ShipmentStoryPage() {
  const params = useParams();
  const router = useRouter();
  const shipmentId = params.id as string;

  const [data, setData] = useState<ShipmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set(['pre_departure']));

  useEffect(() => {
    async function fetchShipment() {
      setLoading(true);
      try {
        const response = await fetch(`/api/chronicle/shipments/${shipmentId}`);
        if (!response.ok) {
          if (response.status === 404) {
            setError('Shipment not found');
          } else {
            setError('Failed to load shipment');
          }
          return;
        }
        const result = await response.json();
        setData(result);

        // Auto-expand active chapter
        if (result.chapters) {
          const activeChapter = result.chapters.find((c: { status: string }) => c.status === 'active');
          if (activeChapter) {
            setExpandedChapters(new Set([activeChapter.id]));
          }
        }
      } catch (err) {
        setError('Failed to load shipment');
      } finally {
        setLoading(false);
      }
    }

    if (shipmentId) {
      fetchShipment();
    }
  }, [shipmentId]);

  const toggleChapter = (chapterId: string) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      if (next.has(chapterId)) {
        next.delete(chapterId);
      } else {
        next.add(chapterId);
      }
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-20">
        <RefreshCw className="h-6 w-6 animate-spin text-terminal-muted" />
        <span className="ml-3 font-mono text-terminal-muted">Loading shipment story...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20">
        <AlertTriangle className="h-10 w-10 text-terminal-amber mb-4" />
        <p className="font-mono text-terminal-muted">{error || 'Shipment not found'}</p>
        <button
          onClick={() => router.push('/chronicle/shipments')}
          className="mt-4 text-sm font-mono text-terminal-blue hover:text-terminal-purple transition-colors"
        >
          ← Back to Fleet View
        </button>
      </div>
    );
  }

  const { shipment, routing, cutoffs, containers, chapters, chronicles } = data;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={() => router.push('/chronicle/shipments')}
              className="p-1 text-terminal-muted hover:text-terminal-text transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <PhaseIcon phase={shipment.phase} />
            <h1 className="text-xl font-semibold text-terminal-text">{shipment.bookingNumber}</h1>
            <PhaseBadge phase={shipment.phase} />
          </div>
          <p className="text-xs font-mono text-terminal-muted ml-9">
            {shipment.blNumber && `BL: ${shipment.blNumber} • `}
            {shipment.vessel} {shipment.voyage && `/ ${shipment.voyage}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 text-xs font-mono bg-terminal-surface border border-terminal-border rounded-lg hover:bg-terminal-elevated transition-colors">
            <RefreshCw className="h-3.5 w-3.5 inline mr-1.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Routing Visualization */}
      <RoutingCard routing={routing} />

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-4">
        {/* Parties Card */}
        <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4">
          <h3 className="text-xs font-mono text-terminal-muted uppercase tracking-wide mb-3">Parties</h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Building2 className="h-3.5 w-3.5 text-terminal-blue" />
              <span className="font-mono text-terminal-text truncate">{shipment.shipper || '--'}</span>
            </div>
            <div className="flex items-center gap-2">
              <User className="h-3.5 w-3.5 text-terminal-green" />
              <span className="font-mono text-terminal-text truncate">{shipment.consignee || '--'}</span>
            </div>
          </div>
        </div>

        {/* Cargo Card */}
        <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4">
          <h3 className="text-xs font-mono text-terminal-muted uppercase tracking-wide mb-3">Cargo</h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Container className="h-3.5 w-3.5 text-terminal-purple" />
              <span className="font-mono text-terminal-text">{shipment.cargo.containerCount} container{shipment.cargo.containerCount !== 1 ? 's' : ''}</span>
            </div>
            <div className="flex items-center gap-2">
              <Boxes className="h-3.5 w-3.5 text-terminal-amber" />
              <span className="font-mono text-terminal-muted truncate">{shipment.cargo.commodity || shipment.cargo.description || '--'}</span>
            </div>
          </div>
        </div>

        {/* Dates Card */}
        <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4">
          <h3 className="text-xs font-mono text-terminal-muted uppercase tracking-wide mb-3">Schedule</h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-mono text-terminal-muted">ETD</span>
              <span className="font-mono text-terminal-text">{formatDate(shipment.dates.etd)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-mono text-terminal-muted">ETA</span>
              <span className="font-mono text-terminal-text">{formatDate(shipment.dates.eta)}</span>
            </div>
          </div>
        </div>

        {/* Cutoffs Card */}
        <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4">
          <h3 className="text-xs font-mono text-terminal-muted uppercase tracking-wide mb-3">Cutoffs</h3>
          <div className="flex flex-wrap gap-2">
            {cutoffs.map(cutoff => (
              <CutoffBadge key={cutoff.type} cutoff={cutoff} />
            ))}
            {cutoffs.length === 0 && (
              <span className="text-xs font-mono text-terminal-muted">No cutoffs</span>
            )}
          </div>
        </div>
      </div>

      {/* Main Content: Journey + Chronicles */}
      <div className="grid grid-cols-3 gap-6">
        {/* Journey Chapters - 2 columns */}
        <div className="col-span-2 space-y-4">
          <h2 className="text-sm font-semibold text-terminal-text flex items-center gap-2">
            <Route className="h-4 w-4 text-terminal-purple" />
            Journey Story
          </h2>

          <div className="space-y-3">
            {chapters.map((chapter, index) => (
              <ChapterCard
                key={chapter.id}
                chapter={chapter}
                index={index}
                isExpanded={expandedChapters.has(chapter.id)}
                onToggle={() => toggleChapter(chapter.id)}
                shipmentId={shipmentId}
              />
            ))}
          </div>
        </div>

        {/* Chronicle Evidence - 1 column */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-terminal-text flex items-center gap-2">
            <FileText className="h-4 w-4 text-terminal-blue" />
            Chronicle Evidence
            <span className="text-xs font-mono text-terminal-muted">({chronicles.length})</span>
          </h2>

          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2">
            {chronicles.length > 0 ? (
              chronicles.map(chronicle => (
                <ChronicleCard key={chronicle.id} chronicle={chronicle} shipmentId={shipmentId} />
              ))
            ) : (
              <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4 text-center">
                <Mail className="h-6 w-6 text-terminal-muted mx-auto mb-2" />
                <p className="text-xs font-mono text-terminal-muted">No documents linked yet</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Containers Section */}
      {containers.length > 0 && (
        <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4">
          <h3 className="text-xs font-mono text-terminal-muted uppercase tracking-wide mb-3 flex items-center gap-2">
            <Container className="h-4 w-4" />
            Containers ({containers.length})
          </h3>
          <div className="grid grid-cols-4 gap-3">
            {containers.map(container => (
              <div key={container.number} className="bg-terminal-bg border border-terminal-border rounded-lg p-3">
                <div className="font-mono text-sm text-terminal-text font-medium">{container.number}</div>
                <div className="text-xs font-mono text-terminal-muted mt-1">
                  {container.type} {container.weight && `• ${container.weight}kg`}
                </div>
                {container.seal && (
                  <div className="text-[10px] font-mono text-terminal-purple mt-1">Seal: {container.seal}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function PhaseIcon({ phase }: { phase: string }) {
  const iconClass = 'h-5 w-5';
  switch (phase?.toLowerCase()) {
    case 'pre_departure': return <Package className={`${iconClass} text-terminal-blue`} />;
    case 'in_transit': return <Ship className={`${iconClass} text-terminal-purple`} />;
    case 'arrival': return <Anchor className={`${iconClass} text-terminal-amber`} />;
    case 'delivered': case 'delivery': return <Truck className={`${iconClass} text-terminal-green`} />;
    default: return <Package className={`${iconClass} text-terminal-muted`} />;
  }
}

function PhaseBadge({ phase }: { phase: string }) {
  const getPhaseStyle = (p: string) => {
    switch (p?.toLowerCase()) {
      case 'pre_departure': return 'text-terminal-blue bg-terminal-blue/10 border-terminal-blue/30';
      case 'in_transit': return 'text-terminal-purple bg-terminal-purple/10 border-terminal-purple/30';
      case 'arrival': return 'text-terminal-amber bg-terminal-amber/10 border-terminal-amber/30';
      case 'delivered': case 'delivery': return 'text-terminal-green bg-terminal-green/10 border-terminal-green/30';
      default: return 'text-terminal-muted bg-terminal-muted/10 border-terminal-border';
    }
  };

  const formatPhase = (p: string) => {
    return p?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Unknown';
  };

  return (
    <span className={`px-2 py-0.5 text-xs font-mono border rounded ${getPhaseStyle(phase)}`}>
      {formatPhase(phase)}
    </span>
  );
}

function RoutingCard({ routing }: { routing: ShipmentData['routing'] }) {
  const segments = [
    { type: 'inland', label: routing.originInland, icon: Truck, active: routing.currentPhase === 'pre_departure' },
    { type: 'port', label: routing.portOfLoadingCode || routing.portOfLoading, icon: Anchor, active: routing.currentPhase === 'pre_departure' },
    { type: 'vessel', label: routing.vesselName, icon: Ship, active: routing.currentPhase === 'in_transit' },
    { type: 'port', label: routing.portOfDischargeCode || routing.portOfDischarge, icon: Anchor, active: routing.currentPhase === 'arrival' },
    { type: 'inland', label: routing.destinationInland, icon: Truck, active: routing.currentPhase === 'delivery' },
  ].filter(s => s.label);

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-mono text-terminal-muted uppercase tracking-wide">Route</h3>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 w-32 bg-terminal-bg rounded-full overflow-hidden border border-terminal-border">
            <div
              className="h-full bg-terminal-purple transition-all"
              style={{ width: `${routing.journeyProgress}%` }}
            />
          </div>
          <span className="text-xs font-mono text-terminal-muted">{routing.journeyProgress}%</span>
        </div>
      </div>

      <div className="flex items-center justify-between">
        {segments.map((segment, index) => (
          <div key={index} className="flex items-center">
            <div className={`flex flex-col items-center ${segment.active ? 'opacity-100' : 'opacity-50'}`}>
              <div className={`p-2 rounded-lg border ${segment.active ? 'bg-terminal-purple/10 border-terminal-purple/30' : 'bg-terminal-bg border-terminal-border'}`}>
                <segment.icon className={`h-4 w-4 ${segment.active ? 'text-terminal-purple' : 'text-terminal-muted'}`} />
              </div>
              <span className={`text-xs font-mono mt-1 ${segment.active ? 'text-terminal-text' : 'text-terminal-muted'}`}>
                {segment.label}
              </span>
            </div>
            {index < segments.length - 1 && (
              <ChevronRight className="h-4 w-4 text-terminal-muted mx-2" />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CutoffBadge({ cutoff }: { cutoff: ShipmentData['cutoffs'][0] }) {
  if (!cutoff.date) {
    return (
      <span className="px-2 py-1 text-[10px] font-mono bg-terminal-bg text-terminal-muted border border-terminal-border rounded">
        {cutoff.type.toUpperCase()}: --
      </span>
    );
  }

  const statusColors = {
    safe: 'bg-terminal-muted/10 text-terminal-muted border-terminal-border',
    warning: 'bg-terminal-amber/10 text-terminal-amber border-terminal-amber/30',
    urgent: 'bg-terminal-red/10 text-terminal-red border-terminal-red/30 animate-pulse',
    overdue: 'bg-terminal-red/20 text-terminal-red border-terminal-red/30',
    submitted: 'bg-terminal-green/10 text-terminal-green border-terminal-green/30',
    unknown: 'bg-terminal-muted/10 text-terminal-muted border-terminal-border',
  };

  const displayValue = cutoff.status === 'overdue'
    ? 'OD'
    : cutoff.status === 'submitted'
      ? '✓'
      : `${cutoff.daysRemaining}d`;

  return (
    <span className={`px-2 py-1 text-[10px] font-mono border rounded ${statusColors[cutoff.status]}`}>
      {cutoff.type.toUpperCase()}: {displayValue}
    </span>
  );
}

function ChapterCard({
  chapter,
  index,
  isExpanded,
  onToggle,
  shipmentId,
}: {
  chapter: ShipmentData['chapters'][0];
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  shipmentId: string;
}) {
  const statusColors = {
    completed: 'border-terminal-green/30 bg-terminal-green/5',
    active: 'border-terminal-purple/30 bg-terminal-purple/5',
    upcoming: 'border-terminal-border bg-terminal-surface',
  };

  const statusIcons = {
    completed: <CheckCircle className="h-4 w-4 text-terminal-green" />,
    active: <Timer className="h-4 w-4 text-terminal-purple animate-pulse" />,
    upcoming: <Clock className="h-4 w-4 text-terminal-muted" />,
  };

  const phaseIcons = {
    pre_departure: Package,
    in_transit: Ship,
    arrival: Anchor,
    delivery: Truck,
  };

  const PhaseIcon = phaseIcons[chapter.phase as keyof typeof phaseIcons] || Package;

  return (
    <div className={`border rounded-lg transition-all ${statusColors[chapter.status]}`}>
      {/* Chapter Header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-terminal-bg border border-terminal-border">
            <PhaseIcon className={`h-4 w-4 ${chapter.status === 'active' ? 'text-terminal-purple' : chapter.status === 'completed' ? 'text-terminal-green' : 'text-terminal-muted'}`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-terminal-text">{chapter.title}</span>
              {statusIcons[chapter.status]}
            </div>
            <span className="text-xs font-mono text-terminal-muted">{chapter.subtitle}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-terminal-muted">{chapter.summary}</span>
          {isExpanded ? <ChevronUp className="h-4 w-4 text-terminal-muted" /> : <ChevronDown className="h-4 w-4 text-terminal-muted" />}
        </div>
      </button>

      {/* Chapter Content */}
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-terminal-border/50">
          {/* Documents */}
          {chapter.documents.length > 0 && (
            <div className="mt-4">
              <h4 className="text-[10px] font-mono text-terminal-muted uppercase tracking-wide mb-2">Documents</h4>
              <div className="space-y-2">
                {chapter.documents.map(doc => (
                  <Link
                    key={doc.id}
                    href={`/chronicle/documents/${doc.id}`}
                    className="flex items-center justify-between p-2 bg-terminal-bg border border-terminal-border rounded hover:border-terminal-purple/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-terminal-blue" />
                      <span className="text-xs font-mono text-terminal-text truncate max-w-[300px]">{doc.subject}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-terminal-muted">{formatShortDate(doc.date)}</span>
                      <ConfidenceBadge confidence={doc.confidence} />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Events */}
          {chapter.events.length > 0 && (
            <div className="mt-4">
              <h4 className="text-[10px] font-mono text-terminal-muted uppercase tracking-wide mb-2">Events</h4>
              <div className="space-y-2">
                {chapter.events.map(event => (
                  <div
                    key={event.id}
                    className="flex items-center justify-between p-2 bg-terminal-bg border border-terminal-border rounded"
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle className="h-3.5 w-3.5 text-terminal-green" />
                      <span className="text-xs font-mono text-terminal-text">{event.description}</span>
                    </div>
                    <span className="text-[10px] font-mono text-terminal-muted">{formatShortDate(event.date)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {chapter.documents.length === 0 && chapter.events.length === 0 && (
            <div className="mt-4 text-center py-4">
              <p className="text-xs font-mono text-terminal-muted">
                {chapter.status === 'upcoming' ? 'Awaiting activity...' : 'No activity recorded'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ChronicleCard({ chronicle, shipmentId }: { chronicle: ShipmentData['chronicles'][0]; shipmentId: string }) {
  const typeColors: Record<string, string> = {
    booking_confirmation: 'text-terminal-blue',
    shipping_instructions: 'text-terminal-purple',
    draft_bl: 'text-terminal-amber',
    final_bl: 'text-terminal-green',
    arrival_notice: 'text-terminal-cyan',
    invoice: 'text-terminal-red',
  };

  return (
    <Link
      href={`/chronicle/documents/${chronicle.id}`}
      className="block bg-terminal-surface border border-terminal-border rounded-lg p-3 hover:border-terminal-purple/50 transition-colors"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <Mail className={`h-3.5 w-3.5 ${typeColors[chronicle.documentType] || 'text-terminal-muted'}`} />
          <span className="text-[10px] font-mono text-terminal-muted uppercase">
            {chronicle.documentType?.replace(/_/g, ' ') || 'Unknown'}
          </span>
        </div>
        <ConfidenceBadge confidence={chronicle.confidence} />
      </div>
      <p className="text-xs font-mono text-terminal-text truncate mb-1">{chronicle.subject}</p>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono text-terminal-muted truncate max-w-[150px]">{chronicle.sender}</span>
        <span className="text-[10px] font-mono text-terminal-muted">{formatShortDate(chronicle.receivedAt)}</span>
      </div>
      {chronicle.hasAttachments && (
        <div className="mt-2 flex items-center gap-1 text-[10px] font-mono text-terminal-purple">
          <FileText className="h-3 w-3" />
          {chronicle.attachmentCount} attachment{chronicle.attachmentCount !== 1 ? 's' : ''}
        </div>
      )}
    </Link>
  );
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const color = confidence >= 90
    ? 'text-terminal-green'
    : confidence >= 70
      ? 'text-terminal-amber'
      : 'text-terminal-red';

  return (
    <span className={`text-[10px] font-mono ${color}`}>
      {confidence}%
    </span>
  );
}

// ============================================================================
// UTILITIES
// ============================================================================

function formatDate(dateStr?: string): string {
  if (!dateStr) return '--';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatShortDate(dateStr?: string): string {
  if (!dateStr) return '--';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
