'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Shipment, ShipmentDocument } from '@/types/shipment';
import {
  MultiSourceETADisplay,
  DateSource,
  DocumentFlowBadge,
  WorkflowStatusBadge,
  RevisionBadge,
  PartyTypeBadge,
  DateUrgencyBadge,
  ShipmentWorkflowProgress,
  MilestoneTimeline,
} from '@/components/tracking';
import {
  History,
  ArrowRight,
  AlertCircle,
  Package,
  MapPin,
  CheckCircle2,
  Download,
  RefreshCw,
  Printer,
  MoreHorizontal,
  Link2,
  ExternalLink,
  Copy,
  Users,
  Building2,
  Mail,
  Phone,
  Star,
  TrendingUp,
  Clock,
  Ship,
  FileText,
  Anchor,
  ChevronRight,
  Loader2,
  Calendar,
  Hash,
  Box,
  Thermometer,
  AlertTriangle,
} from 'lucide-react';
import { DocumentTypeBadge } from '@/components/ui/document-type-badge';
import { PartyType, WorkflowState, DocumentDirection, DocumentType } from '@/types/email-intelligence';

interface DocumentWithFlow extends ShipmentDocument {
  gmail_message_id?: string;
  true_sender_email?: string;
  sender_email?: string;
  received_at?: string;
  classification?: {
    document_direction?: DocumentDirection;
    sender_party_type?: PartyType;
    receiver_party_type?: PartyType;
    workflow_state?: WorkflowState;
    requires_approval_from?: PartyType | null;
    revision_type?: 'original' | 'update' | 'amendment' | 'cancellation';
    revision_number?: number;
  };
}

interface GroupedDocument {
  document_type: string;
  true_sender: string;
  sender_display: string;
  versions: DocumentWithFlow[];
  latest: DocumentWithFlow;
  version_count: number;
}

interface MultiSourceDates {
  etd_sources: DateSource[];
  eta_sources: DateSource[];
  hasEtdConflict: boolean;
  hasEtaConflict: boolean;
}

interface BookingRevision {
  booking_number: string;
  revision_number: number;
  revision_type: string;
  vessel_name?: string;
  voyage_number?: string;
  etd?: string;
  eta?: string;
  port_of_loading?: string;
  port_of_discharge?: string;
  changed_fields?: Record<string, { old: string | number | null; new: string | number | null }>;
  source_email_subject?: string;
  revision_received_at?: string;
  created_at: string;
}

interface ContainerData {
  id: string;
  shipment_id: string;
  container_number: string;
  container_type?: string;
  iso_type_code?: string;
  seal_number?: string;
  gross_weight?: number;
  weight_unit?: string;
  is_reefer?: boolean;
  temperature_setting?: number;
  is_hazmat?: boolean;
  is_primary?: boolean;
}

interface ShipmentEventData {
  id: string;
  shipment_id: string;
  event_type: string;
  event_date: string;
  location?: string;
  location_code?: string;
  description?: string;
  source_type: string;
  is_milestone: boolean;
}

interface StakeholderData {
  id: string;
  party_name: string;
  party_type: string;
  contact_email?: string;
  contact_phone?: string;
  address?: string;
  city?: string;
  country?: string;
  reliability_score?: number;
  response_time_avg_hours?: number;
  total_shipments?: number;
  is_customer?: boolean;
}

interface ShipmentStakeholders {
  shipper?: StakeholderData;
  consignee?: StakeholderData;
  carrier?: StakeholderData;
  notify_party?: StakeholderData;
}

// Terminal-style status colors
const STATUS_DOT_COLORS: Record<string, string> = {
  draft: 'bg-terminal-muted',
  booked: 'bg-terminal-blue',
  in_transit: 'bg-terminal-purple',
  arrived: 'bg-terminal-amber',
  delivered: 'bg-terminal-green',
  cancelled: 'bg-terminal-red',
};

const STATUS_TEXT_COLORS: Record<string, string> = {
  draft: 'text-terminal-muted',
  booked: 'text-terminal-blue',
  in_transit: 'text-terminal-purple',
  arrived: 'text-terminal-amber',
  delivered: 'text-terminal-green',
  cancelled: 'text-terminal-red',
};

export default function ShipmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const shipmentId = params.id as string;

  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [documents, setDocuments] = useState<DocumentWithFlow[]>([]);
  const [multiSourceDates, setMultiSourceDates] = useState<MultiSourceDates | null>(null);
  const [revisions, setRevisions] = useState<BookingRevision[]>([]);
  const [containers, setContainers] = useState<ContainerData[]>([]);
  const [milestones, setMilestones] = useState<ShipmentEventData[]>([]);
  const [stakeholders, setStakeholders] = useState<ShipmentStakeholders>({});
  const [loading, setLoading] = useState(true);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    fetchShipmentDetails();
  }, [shipmentId]);

  const fetchShipmentDetails = async () => {
    try {
      const [shipmentRes, datesRes, revisionsRes, containersRes] = await Promise.all([
        fetch(`/api/shipments/${shipmentId}`),
        fetch(`/api/shipments/${shipmentId}/multi-source-dates`),
        fetch(`/api/shipments/${shipmentId}/revisions`),
        fetch(`/api/shipments/${shipmentId}/containers`),
      ]);

      if (!shipmentRes.ok) {
        throw new Error('Shipment not found');
      }

      const shipmentData = await shipmentRes.json();
      setShipment(shipmentData.shipment);
      setDocuments(shipmentData.documents || []);
      setStakeholders(shipmentData.stakeholders || {});

      if (datesRes.ok) {
        const datesData = await datesRes.json();
        setMultiSourceDates(datesData);
      }

      if (revisionsRes.ok) {
        const revisionsData = await revisionsRes.json();
        setRevisions(revisionsData.revisions || []);
      }

      if (containersRes.ok) {
        const containersData = await containersRes.json();
        setContainers(containersData.containers || []);
        setMilestones(containersData.milestones || []);
      }
    } catch (error) {
      console.error('Failed to fetch shipment:', error);
      alert('Failed to load shipment details');
      router.push('/shipments');
    } finally {
      setLoading(false);
    }
  };

  const resyncShipment = async () => {
    setActionLoading('resync');
    try {
      const response = await fetch('/api/shipments/resync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shipment_id: shipmentId }),
      });
      if (response.ok) {
        await fetchShipmentDetails();
        alert('Shipment data resynced successfully');
      }
    } catch (error) {
      console.error('Failed to resync:', error);
      alert('Failed to resync shipment');
    } finally {
      setActionLoading(null);
    }
  };

  const exportShipment = async (format: 'csv' | 'xlsx') => {
    setActionLoading('export');
    setShowActionsMenu(false);
    try {
      const response = await fetch(`/api/shipments/export?format=${format}&ids=${shipmentId}`);
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `shipment-${shipment?.booking_number || shipmentId}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch (error) {
      console.error('Failed to export:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const printShipment = () => {
    setShowActionsMenu(false);
    window.open(`/shipments/print?ids=${shipmentId}`, '_blank');
  };

  const copyBookingNumber = () => {
    if (shipment?.booking_number) {
      navigator.clipboard.writeText(shipment.booking_number);
      alert('Booking number copied to clipboard');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-terminal-bg flex items-center justify-center">
        <div className="flex items-center gap-3 text-terminal-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="font-mono text-sm">Loading shipment details...</span>
        </div>
      </div>
    );
  }

  if (!shipment) {
    return (
      <div className="min-h-screen bg-terminal-bg flex items-center justify-center">
        <div className="text-center">
          <Ship className="h-12 w-12 text-terminal-muted mx-auto mb-4" />
          <p className="text-terminal-muted font-mono">Shipment not found</p>
          <Link
            href="/shipments"
            className="mt-4 inline-block text-terminal-blue hover:text-terminal-green font-mono text-sm transition-colors"
          >
            [back to shipments]
          </Link>
        </div>
      </div>
    );
  }

  // Deduplicate documents by gmail_message_id (remove duplicates from group forwards)
  const deduplicatedDocuments = (() => {
    const seen = new Set<string>();
    return documents.filter(doc => {
      if (doc.gmail_message_id && seen.has(doc.gmail_message_id)) {
        return false; // Skip duplicate
      }
      if (doc.gmail_message_id) {
        seen.add(doc.gmail_message_id);
      }
      return true;
    });
  })();

  const getStatusDot = (status: string) => {
    const s = status?.toLowerCase() || 'draft';
    return STATUS_DOT_COLORS[s] || 'bg-terminal-muted';
  };

  const getStatusText = (status: string) => {
    const s = status?.toLowerCase() || 'draft';
    return STATUS_TEXT_COLORS[s] || 'text-terminal-muted';
  };

  return (
    <div className="min-h-screen bg-terminal-bg">
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header - Terminal Style */}
        <div className="space-y-4">
          {/* Back Link */}
          <Link
            href="/shipments"
            className="inline-flex items-center gap-1.5 text-terminal-blue hover:text-terminal-green font-mono text-sm transition-colors"
          >
            <ArrowRight className="h-3.5 w-3.5 rotate-180" />
            [back to shipments]
          </Link>

          {/* Main Header */}
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              {/* Icon */}
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-terminal-blue/10 border border-terminal-blue/30">
                <Ship className="h-6 w-6 text-terminal-blue" />
              </div>

              {/* Title & Meta */}
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-xl font-semibold text-terminal-text font-mono">
                    {shipment.booking_number || shipment.bl_number || 'Shipment Details'}
                  </h1>
                  {shipment.booking_number && (
                    <button
                      onClick={copyBookingNumber}
                      className="p-1 text-terminal-muted hover:text-terminal-blue hover:bg-terminal-blue/10 rounded border border-transparent hover:border-terminal-blue/30 transition-colors"
                      title="Copy booking number"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="flex items-center gap-4 text-sm">
                  {/* Status */}
                  <span className="flex items-center gap-1.5">
                    <span className={`h-2 w-2 rounded-full ${getStatusDot(shipment.status)}`} />
                    <span className={`font-mono text-xs uppercase ${getStatusText(shipment.status)}`}>
                      {shipment.status?.replace('_', ' ') || 'UNKNOWN'}
                    </span>
                  </span>

                  {/* Vessel */}
                  {shipment.vessel_name && (
                    <span className="flex items-center gap-1.5 text-terminal-muted font-mono text-xs">
                      <Anchor className="h-3.5 w-3.5" />
                      {shipment.vessel_name}
                      {shipment.voyage_number && ` / ${shipment.voyage_number}`}
                    </span>
                  )}

                  {/* Created */}
                  <span className="text-terminal-muted font-mono text-xs">
                    Created {new Date(shipment.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>

            {/* Action Buttons - Terminal Style */}
            <div className="flex items-center gap-2">
              <button
                onClick={resyncShipment}
                disabled={actionLoading === 'resync'}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-mono text-terminal-muted bg-terminal-surface border border-terminal-border rounded-lg hover:bg-terminal-elevated disabled:opacity-50 transition-colors"
                title="Resync data from emails"
              >
                <RefreshCw className={`h-4 w-4 ${actionLoading === 'resync' ? 'animate-spin' : ''}`} />
                Resync
              </button>

              <button
                onClick={printShipment}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-mono text-terminal-muted bg-terminal-surface border border-terminal-border rounded-lg hover:bg-terminal-elevated transition-colors"
                title="Print shipment details"
              >
                <Printer className="h-4 w-4" />
                Print
              </button>

              {/* More Actions Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setShowActionsMenu(!showActionsMenu)}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-sm font-mono text-terminal-green bg-terminal-green/10 border border-terminal-green/30 rounded-lg hover:bg-terminal-green/20 transition-colors"
                >
                  <MoreHorizontal className="h-4 w-4" />
                  Actions
                </button>

                {showActionsMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowActionsMenu(false)}
                    />
                    <div className="absolute right-0 mt-2 w-48 bg-terminal-surface rounded-lg shadow-lg border border-terminal-border py-1 z-20">
                      <button
                        onClick={() => exportShipment('csv')}
                        className="w-full px-4 py-2 text-left text-sm font-mono text-terminal-text hover:bg-terminal-elevated flex items-center gap-2 transition-colors"
                      >
                        <Download className="h-4 w-4" />
                        Export as CSV
                      </button>
                      <button
                        onClick={() => exportShipment('xlsx')}
                        className="w-full px-4 py-2 text-left text-sm font-mono text-terminal-text hover:bg-terminal-elevated flex items-center gap-2 transition-colors"
                      >
                        <Download className="h-4 w-4" />
                        Export as Excel
                      </button>
                      <div className="border-t border-terminal-border my-1" />
                      <Link
                        href={`/shipments/link-review?shipment=${shipmentId}`}
                        onClick={() => setShowActionsMenu(false)}
                        className="w-full px-4 py-2 text-left text-sm font-mono text-terminal-text hover:bg-terminal-elevated flex items-center gap-2 transition-colors"
                      >
                        <Link2 className="h-4 w-4" />
                        Link Documents
                      </Link>
                      <button
                        onClick={() => {
                          setShowActionsMenu(false);
                          window.open(`/emails?shipment=${shipmentId}`, '_blank');
                        }}
                        className="w-full px-4 py-2 text-left text-sm font-mono text-terminal-text hover:bg-terminal-elevated flex items-center gap-2 transition-colors"
                      >
                        <ExternalLink className="h-4 w-4" />
                        View Related Emails
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Quick Jump Navigation - Terminal Style */}
        <div className="flex items-center gap-4 py-3 border-b border-terminal-border text-xs font-mono">
          <span className="text-terminal-muted">Jump to:</span>
          <a href="#overview" className="text-terminal-blue hover:text-terminal-green transition-colors">[overview]</a>
          <a href="#documents" className="text-terminal-blue hover:text-terminal-green transition-colors flex items-center gap-1">
            [documents]
            <span className="text-terminal-muted">({documents.length})</span>
          </a>
          <a href="#timeline" className="text-terminal-blue hover:text-terminal-green transition-colors">[timeline]</a>
          <a href="#containers" className="text-terminal-blue hover:text-terminal-green transition-colors flex items-center gap-1">
            [containers]
            {containers.length > 0 && <span className="text-terminal-muted">({containers.length})</span>}
          </a>
          <a href="#revisions" className="text-terminal-blue hover:text-terminal-green transition-colors flex items-center gap-1">
            [revisions]
            {revisions.length > 0 && <span className="text-terminal-muted">({revisions.length})</span>}
          </a>
          <a href="#stakeholders" className="text-terminal-blue hover:text-terminal-green transition-colors">[stakeholders]</a>
        </div>

        {/* All Sections */}
        <div className="space-y-8">
          {/* SECTION: Overview */}
          <section id="overview" className="scroll-mt-4 space-y-6">
            {/* Journey Progress Card - Terminal Style */}
            <JourneyProgressCard
              workflowPhase={shipment.workflow_phase}
              workflowState={shipment.workflow_state}
              etd={shipment.etd}
              eta={shipment.eta}
              status={shipment.status}
            />

            {/* Workflow Progress - Full Width */}
            <ShipmentWorkflowProgress
              shipmentId={shipmentId}
              currentState={shipment.workflow_state}
              workflowPhase={shipment.workflow_phase}
            />

            <div className="grid grid-cols-3 gap-6">
              {/* Main Info */}
              <div className="col-span-2 space-y-6">
                {/* Identifiers - Terminal Style */}
                <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
                  <div className="px-4 py-2.5 bg-terminal-elevated border-b border-terminal-border flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-terminal-blue" />
                    <Hash className="h-4 w-4 text-terminal-blue" />
                    <span className="font-medium text-terminal-text text-sm">Identifiers</span>
                  </div>
                  <div className="p-4">
                    <dl className="grid grid-cols-2 gap-4">
                      <div>
                        <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide">Booking Number</dt>
                        <dd className="text-sm font-mono font-medium text-terminal-text mt-1">{shipment.booking_number || '--'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide">BL Number</dt>
                        <dd className="text-sm font-mono font-medium text-terminal-text mt-1">{shipment.bl_number || '--'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide">Container Number</dt>
                        <dd className="text-sm font-mono font-medium text-terminal-text mt-1">{shipment.container_number_primary || '--'}</dd>
                      </div>
                    </dl>
                  </div>
                </div>

                {/* Vessel & Voyage - Terminal Style */}
                <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
                  <div className="px-4 py-2.5 bg-terminal-elevated border-b border-terminal-border flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-terminal-purple" />
                    <Anchor className="h-4 w-4 text-terminal-purple" />
                    <span className="font-medium text-terminal-text text-sm">Vessel & Voyage</span>
                  </div>
                  <div className="p-4">
                    <dl className="grid grid-cols-2 gap-4">
                      <div>
                        <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide">Vessel Name</dt>
                        <dd className="text-sm font-mono font-medium text-terminal-text mt-1">{shipment.vessel_name || '--'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide">Voyage Number</dt>
                        <dd className="text-sm font-mono font-medium text-terminal-text mt-1">{shipment.voyage_number || '--'}</dd>
                      </div>
                    </dl>
                  </div>
                </div>

                {/* Route - Terminal Style */}
                <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
                  <div className="px-4 py-2.5 bg-terminal-elevated border-b border-terminal-border flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-terminal-green" />
                    <MapPin className="h-4 w-4 text-terminal-green" />
                    <span className="font-medium text-terminal-text text-sm">Route</span>
                  </div>
                  <div className="p-4">
                    <dl className="grid grid-cols-2 gap-4">
                      <div>
                        <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide">Port of Loading</dt>
                        <dd className="text-sm font-mono font-medium text-terminal-text mt-1">
                          {shipment.port_of_loading || '--'}
                          {shipment.port_of_loading_code && (
                            <span className="text-terminal-muted ml-2">({shipment.port_of_loading_code})</span>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide">Port of Discharge</dt>
                        <dd className="text-sm font-mono font-medium text-terminal-text mt-1">
                          {shipment.port_of_discharge || '--'}
                          {shipment.port_of_discharge_code && (
                            <span className="text-terminal-muted ml-2">({shipment.port_of_discharge_code})</span>
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide">Place of Receipt</dt>
                        <dd className="text-sm font-mono font-medium text-terminal-text mt-1">{shipment.place_of_receipt || '--'}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide">Place of Delivery</dt>
                        <dd className="text-sm font-mono font-medium text-terminal-text mt-1">{shipment.place_of_delivery || '--'}</dd>
                      </div>
                    </dl>
                  </div>
                </div>

                {/* Cutoff Dates - Terminal Style */}
                {(shipment.si_cutoff || shipment.vgm_cutoff || shipment.cargo_cutoff || shipment.gate_cutoff) && (
                  <div className="rounded-lg border border-terminal-amber/30 bg-terminal-surface overflow-hidden">
                    <div className="px-4 py-2.5 bg-terminal-amber/10 border-b border-terminal-border flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-terminal-amber animate-pulse" />
                      <AlertTriangle className="h-4 w-4 text-terminal-amber" />
                      <span className="font-medium text-terminal-amber text-sm">Cutoff Dates</span>
                    </div>
                    <div className="p-4">
                      <dl className="grid grid-cols-2 gap-4">
                        {shipment.si_cutoff && (
                          <div>
                            <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide mb-1">SI Cutoff</dt>
                            <dd>
                              <DateUrgencyBadge date={shipment.si_cutoff} />
                            </dd>
                          </div>
                        )}
                        {shipment.vgm_cutoff && (
                          <div>
                            <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide mb-1">VGM Cutoff</dt>
                            <dd>
                              <DateUrgencyBadge date={shipment.vgm_cutoff} />
                            </dd>
                          </div>
                        )}
                        {shipment.cargo_cutoff && (
                          <div>
                            <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide mb-1">Cargo Cutoff</dt>
                            <dd>
                              <DateUrgencyBadge date={shipment.cargo_cutoff} />
                            </dd>
                          </div>
                        )}
                        {shipment.gate_cutoff && (
                          <div>
                            <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide mb-1">Gate Cutoff</dt>
                            <dd>
                              <DateUrgencyBadge date={shipment.gate_cutoff} />
                            </dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  </div>
                )}

                {/* Multi-Source Schedule - Terminal Style */}
                <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
                  <div className="px-4 py-2.5 bg-terminal-elevated border-b border-terminal-border flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-terminal-blue" />
                    <Calendar className="h-4 w-4 text-terminal-blue" />
                    <span className="font-medium text-terminal-text text-sm">Schedule</span>
                    {(multiSourceDates?.hasEtdConflict || multiSourceDates?.hasEtaConflict) && (
                      <span className="ml-2 px-2 py-0.5 text-[10px] font-mono bg-terminal-red/10 text-terminal-red border border-terminal-red/30 rounded">
                        Conflicts Detected
                      </span>
                    )}
                  </div>
                  <div className="p-4">
                    {multiSourceDates && (multiSourceDates.etd_sources.length > 0 || multiSourceDates.eta_sources.length > 0) ? (
                      <div className="space-y-4">
                        {multiSourceDates.etd_sources.length > 0 && (
                          <MultiSourceETADisplay
                            label="ETD"
                            sources={multiSourceDates.etd_sources}
                          />
                        )}
                        {multiSourceDates.eta_sources.length > 0 && (
                          <MultiSourceETADisplay
                            label="ETA"
                            sources={multiSourceDates.eta_sources}
                          />
                        )}
                      </div>
                    ) : (
                      <dl className="grid grid-cols-2 gap-4">
                        <div>
                          <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide">ETD (Estimated Departure)</dt>
                          <dd className="text-sm font-mono font-medium text-terminal-text mt-1">
                            {shipment.etd ? new Date(shipment.etd).toLocaleDateString() : '--'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide">ETA (Estimated Arrival)</dt>
                          <dd className="text-sm font-mono font-medium text-terminal-text mt-1">
                            {shipment.eta ? new Date(shipment.eta).toLocaleDateString() : '--'}
                          </dd>
                        </div>
                        {shipment.atd && (
                          <div>
                            <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide">ATD (Actual Departure)</dt>
                            <dd className="text-sm font-mono font-medium text-terminal-green mt-1">
                              {new Date(shipment.atd).toLocaleDateString()}
                            </dd>
                          </div>
                        )}
                        {shipment.ata && (
                          <div>
                            <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide">ATA (Actual Arrival)</dt>
                            <dd className="text-sm font-mono font-medium text-terminal-green mt-1">
                              {new Date(shipment.ata).toLocaleDateString()}
                            </dd>
                          </div>
                        )}
                      </dl>
                    )}
                  </div>
                </div>

                {/* Cargo Details - Terminal Style */}
                {(shipment.commodity_description || shipment.total_weight || shipment.total_volume) && (
                  <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
                    <div className="px-4 py-2.5 bg-terminal-elevated border-b border-terminal-border flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-terminal-purple" />
                      <Box className="h-4 w-4 text-terminal-purple" />
                      <span className="font-medium text-terminal-text text-sm">Cargo Details</span>
                    </div>
                    <div className="p-4">
                      <dl className="space-y-3">
                        {shipment.commodity_description && (
                          <div>
                            <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide">Commodity</dt>
                            <dd className="text-sm text-terminal-text mt-1">{shipment.commodity_description}</dd>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-4">
                          {shipment.total_weight && (
                            <div>
                              <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide">Weight</dt>
                              <dd className="text-sm font-mono font-medium text-terminal-text mt-1">
                                {shipment.total_weight} {shipment.weight_unit || 'KG'}
                              </dd>
                            </div>
                          )}
                          {shipment.total_volume && (
                            <div>
                              <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide">Volume</dt>
                              <dd className="text-sm font-mono font-medium text-terminal-text mt-1">
                                {shipment.total_volume} {shipment.volume_unit || 'CBM'}
                              </dd>
                            </div>
                          )}
                        </div>
                      </dl>
                    </div>
                  </div>
                )}
              </div>

              {/* Sidebar */}
              <div className="space-y-6">
                {/* Linked Documents - Terminal Style */}
                <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
                  <div className="px-4 py-2.5 bg-terminal-elevated border-b border-terminal-border flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-terminal-green" />
                    <FileText className="h-4 w-4 text-terminal-green" />
                    <span className="font-medium text-terminal-text text-sm">Linked Documents</span>
                    <span className="ml-auto text-xs font-mono text-terminal-muted">[{deduplicatedDocuments.length}]</span>
                  </div>
                  <div className="p-4">
                    {deduplicatedDocuments.length === 0 ? (
                      <p className="text-sm text-terminal-muted font-mono text-center py-4">No documents linked yet</p>
                    ) : (
                      <div className="space-y-3">
                        {deduplicatedDocuments.slice(0, 5).map((doc) => (
                          <DocumentCard key={doc.id} document={doc} />
                        ))}
                        {deduplicatedDocuments.length > 5 && (
                          <a href="#documents" className="block text-center text-xs font-mono text-terminal-blue hover:text-terminal-green transition-colors">
                            [view all {deduplicatedDocuments.length} documents]
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Commercial Terms - Terminal Style */}
                {(shipment.incoterms || shipment.freight_terms) && (
                  <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
                    <div className="px-4 py-2.5 bg-terminal-elevated border-b border-terminal-border flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-terminal-amber" />
                      <FileText className="h-4 w-4 text-terminal-amber" />
                      <span className="font-medium text-terminal-text text-sm">Commercial Terms</span>
                    </div>
                    <div className="p-4">
                      <dl className="space-y-3">
                        {shipment.incoterms && (
                          <div>
                            <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide">Incoterms</dt>
                            <dd className="text-sm font-mono font-medium text-terminal-text mt-1">{shipment.incoterms}</dd>
                          </div>
                        )}
                        {shipment.freight_terms && (
                          <div>
                            <dt className="text-xs text-terminal-muted font-mono uppercase tracking-wide">Freight Terms</dt>
                            <dd className="text-sm font-mono font-medium text-terminal-text mt-1">{shipment.freight_terms}</dd>
                          </div>
                        )}
                      </dl>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* SECTION: Documents */}
          <section id="documents" className="scroll-mt-4">
            <SectionHeader icon={FileText} title="Documents" count={documents.length} color="green" />
            <DocumentsTab documents={documents} />
          </section>

          {/* SECTION: Timeline */}
          <section id="timeline" className="scroll-mt-4">
            <SectionHeader icon={Clock} title="Timeline" color="blue" />
            <TimelineTab
              documents={documents}
              shipmentId={shipmentId}
              etd={shipment.etd}
              eta={shipment.eta}
            />
          </section>

          {/* SECTION: Containers */}
          <section id="containers" className="scroll-mt-4">
            <SectionHeader icon={Package} title="Containers" count={containers.length} color="purple" />
            <ContainersTab containers={containers} milestones={milestones} />
          </section>

          {/* SECTION: Revisions */}
          <section id="revisions" className="scroll-mt-4">
            <SectionHeader icon={History} title="Revision History" count={revisions.length} color="amber" />
            <RevisionsTab revisions={revisions} bookingNumber={shipment.booking_number} />
          </section>

          {/* SECTION: Stakeholders */}
          <section id="stakeholders" className="scroll-mt-4">
            <SectionHeader icon={Users} title="Stakeholders" color="blue" />
            <StakeholdersSection stakeholders={stakeholders} />
          </section>
        </div>
      </div>
    </div>
  );
}

// Section Header Component - Terminal Style
function SectionHeader({ icon: Icon, title, count, color }: { icon: React.ElementType; title: string; count?: number; color: 'blue' | 'green' | 'purple' | 'amber' }) {
  const dotColors = {
    blue: 'bg-terminal-blue',
    green: 'bg-terminal-green',
    purple: 'bg-terminal-purple',
    amber: 'bg-terminal-amber',
  };
  const textColors = {
    blue: 'text-terminal-blue',
    green: 'text-terminal-green',
    purple: 'text-terminal-purple',
    amber: 'text-terminal-amber',
  };

  return (
    <div className="flex items-center gap-2 mb-4 pb-2 border-b border-terminal-border">
      <span className={`h-2 w-2 rounded-full ${dotColors[color]}`} />
      <Icon className={`h-5 w-5 ${textColors[color]}`} />
      <h2 className="text-lg font-semibold text-terminal-text">{title}</h2>
      {count !== undefined && (
        <span className="text-xs font-mono text-terminal-muted ml-1">[{count}]</span>
      )}
    </div>
  );
}

function DocumentCard({ document }: { document: DocumentWithFlow }) {
  const classification = document.classification;

  return (
    <div className="border border-terminal-border rounded-lg p-3 hover:border-terminal-blue/50  transition-colors bg-terminal-elevated">
      <div className="flex items-start justify-between mb-2">
        <DocumentTypeBadge type={document.document_type as DocumentType} size="sm" />
        {classification?.revision_type && classification.revision_type !== 'original' && (
          <RevisionBadge
            revisionType={classification.revision_type}
            revisionNumber={classification.revision_number}
            size="sm"
          />
        )}
      </div>

      {classification?.document_direction && classification?.sender_party_type && (
        <div className="mb-2">
          <DocumentFlowBadge
            direction={classification.document_direction}
            senderPartyType={classification.sender_party_type}
            size="sm"
            variant="compact"
          />
        </div>
      )}

      {classification?.workflow_state && (
        <div className="mb-2">
          <WorkflowStatusBadge
            state={classification.workflow_state}
            requiresApprovalFrom={classification.requires_approval_from}
            size="sm"
            showApprovalInfo={false}
          />
        </div>
      )}

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-terminal-border">
        <span className="text-[10px] font-mono text-terminal-muted">
          {document.link_confidence_score || 0}% match
        </span>
        <Link
          href={`/emails/${document.email_id}`}
          className="text-[10px] font-mono text-terminal-blue hover:text-terminal-green transition-colors"
        >
          [view email]
        </Link>
      </div>
    </div>
  );
}

function DocumentsTab({ documents }: { documents: DocumentWithFlow[] }) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  if (documents.length === 0) {
    return (
      <div className="rounded-lg border border-terminal-border bg-terminal-surface p-12 text-center">
        <FileText className="h-12 w-12 text-terminal-muted mx-auto mb-4" />
        <p className="text-terminal-muted font-mono">No documents linked to this shipment yet.</p>
      </div>
    );
  }

  // Group documents by (document_type + true_sender_email)
  const groupDocuments = (docs: DocumentWithFlow[]): GroupedDocument[] => {
    const seen = new Set<string>();
    const groups = new Map<string, DocumentWithFlow[]>();

    for (const doc of docs) {
      if (doc.gmail_message_id && seen.has(doc.gmail_message_id)) {
        continue;
      }
      if (doc.gmail_message_id) {
        seen.add(doc.gmail_message_id);
      }

      const sender = doc.true_sender_email || doc.sender_email || 'unknown';
      const key = `${doc.document_type}|${sender}`;

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(doc);
    }

    return Array.from(groups.entries()).map(([key, versions]) => {
      const sorted = versions.sort((a, b) => {
        const dateA = new Date(a.received_at || a.document_date || a.created_at || 0);
        const dateB = new Date(b.received_at || b.document_date || b.created_at || 0);
        return dateB.getTime() - dateA.getTime();
      });

      const [docType, sender] = key.split('|');
      const senderDisplay = extractSenderDisplay(sender);

      return {
        document_type: docType,
        true_sender: sender,
        sender_display: senderDisplay,
        versions: sorted,
        latest: sorted[0],
        version_count: sorted.length,
      };
    });
  };

  const extractSenderDisplay = (email: string): string => {
    if (!email || email === 'unknown') return 'Unknown';

    const domain = email.split('@')[1] || email;
    const carrierPatterns: Record<string, string> = {
      'maersk.com': 'Maersk',
      'hapag-lloyd.com': 'Hapag-Lloyd',
      'msc.com': 'MSC',
      'cma-cgm.com': 'CMA CGM',
      'one-line.com': 'ONE',
      'evergreen-marine.com': 'Evergreen',
      'intoglo.com': 'Intoglo',
    };

    for (const [pattern, name] of Object.entries(carrierPatterns)) {
      if (domain.includes(pattern.split('.')[0])) return name;
    }

    return domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1);
  };

  const groupedDocs = groupDocuments(documents);
  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
      {/* Summary - Terminal Style */}
      <div className="px-4 py-3 bg-terminal-elevated border-b border-terminal-border">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-terminal-muted">
            {groupedDocs.length} document type{groupedDocs.length !== 1 ? 's' : ''} from {new Set(groupedDocs.map(g => g.true_sender)).size} sender{new Set(groupedDocs.map(g => g.true_sender)).size !== 1 ? 's' : ''}
          </span>
          <span className="text-terminal-muted">
            [{documents.length}] total emails (deduplicated)
          </span>
        </div>
      </div>

      {/* Grouped Document List */}
      <div className="divide-y divide-terminal-border">
        {groupedDocs.map((group) => {
          const key = `${group.document_type}|${group.true_sender}`;
          const isExpanded = expandedGroups.has(key);
          const latest = group.latest;

          return (
            <div key={key}>
              {/* Group Header */}
              <div
                className="px-4 py-3 hover:bg-terminal-elevated cursor-pointer flex items-center gap-4 transition-colors"
                onClick={() => group.version_count > 1 && toggleGroup(key)}
              >
                {/* Expand/Collapse */}
                <div className="w-5">
                  {group.version_count > 1 && (
                    <ChevronRight className={`h-4 w-4 text-terminal-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                  )}
                </div>

                {/* Document Type */}
                <div className="flex-shrink-0">
                  <DocumentTypeBadge type={group.document_type as DocumentType} size="sm" />
                </div>

                {/* Sender */}
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-terminal-text">
                    {group.sender_display}
                  </span>
                  <span className="text-xs text-terminal-muted ml-2 font-mono truncate">
                    {group.true_sender}
                  </span>
                </div>

                {/* Version Count */}
                <div className="flex-shrink-0">
                  {group.version_count > 1 ? (
                    <span className="px-2 py-0.5 text-[10px] font-mono bg-terminal-blue/10 text-terminal-blue border border-terminal-blue/30 rounded">
                      {group.version_count} ver
                    </span>
                  ) : (
                    <span className="text-xs font-mono text-terminal-muted">1 ver</span>
                  )}
                </div>

                {/* Latest Date */}
                <div className="flex-shrink-0 text-xs font-mono text-terminal-muted w-24 text-right">
                  {latest.document_date
                    ? new Date(latest.document_date).toLocaleDateString()
                    : latest.received_at
                      ? new Date(latest.received_at).toLocaleDateString()
                      : '--'}
                </div>

                {/* View Latest */}
                <div className="flex-shrink-0">
                  <Link
                    href={`/emails/${latest.email_id}`}
                    className="text-xs font-mono text-terminal-blue hover:text-terminal-green transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    [view]
                  </Link>
                </div>
              </div>

              {/* Expanded Versions */}
              {isExpanded && group.version_count > 1 && (
                <div className="bg-terminal-bg border-t border-terminal-border">
                  {group.versions.map((doc, idx) => (
                    <div
                      key={doc.id}
                      className="px-4 py-2.5 pl-14 flex items-center gap-4 text-sm border-b border-terminal-border last:border-0"
                    >
                      <span className="text-terminal-muted font-mono text-xs w-6">#{idx + 1}</span>

                      {doc.classification?.revision_type && (
                        <RevisionBadge
                          revisionType={doc.classification.revision_type}
                          revisionNumber={doc.classification.revision_number}
                          size="sm"
                        />
                      )}

                      <span className="flex-1 text-terminal-muted font-mono text-xs truncate">
                        {doc.document_date
                          ? new Date(doc.document_date).toLocaleDateString()
                          : doc.received_at
                            ? new Date(doc.received_at).toLocaleDateString()
                            : '--'}
                      </span>

                      <span className="text-[10px] font-mono text-terminal-muted">
                        {doc.link_confidence_score || 0}%
                      </span>

                      <Link
                        href={`/emails/${doc.email_id}`}
                        className="text-xs font-mono text-terminal-blue hover:text-terminal-green transition-colors"
                      >
                        [view]
                      </Link>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimelineTab({
  documents,
  shipmentId,
  etd,
  eta,
}: {
  documents: DocumentWithFlow[];
  shipmentId: string;
  etd?: string;
  eta?: string;
}) {
  // Deduplicate documents by gmail_message_id and group by (document_type + true_sender)
  const deduplicateAndGroup = (docs: DocumentWithFlow[]): GroupedDocument[] => {
    const seen = new Set<string>();
    const groups = new Map<string, DocumentWithFlow[]>();

    for (const doc of docs) {
      if (doc.gmail_message_id && seen.has(doc.gmail_message_id)) {
        continue;
      }
      if (doc.gmail_message_id) {
        seen.add(doc.gmail_message_id);
      }

      const sender = doc.true_sender_email || doc.sender_email || 'unknown';
      const key = `${doc.document_type}|${sender}`;

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(doc);
    }

    return Array.from(groups.entries()).map(([key, versions]) => {
      const sorted = versions.sort((a, b) => {
        const dateA = new Date(a.received_at || a.document_date || a.created_at || 0);
        const dateB = new Date(b.received_at || b.document_date || b.created_at || 0);
        return dateB.getTime() - dateA.getTime();
      });

      const [docType, sender] = key.split('|');
      return {
        document_type: docType,
        true_sender: sender,
        sender_display: extractSenderName(sender),
        versions: sorted,
        latest: sorted[0],
        version_count: sorted.length,
      };
    });
  };

  const extractSenderName = (email: string): string => {
    if (!email || email === 'unknown') return 'Unknown';
    const domain = email.split('@')[1] || email;
    const patterns: Record<string, string> = {
      'maersk': 'Maersk', 'hapag': 'Hapag-Lloyd', 'msc': 'MSC',
      'cma': 'CMA CGM', 'one-line': 'ONE', 'evergreen': 'Evergreen', 'intoglo': 'Intoglo',
    };
    for (const [pattern, name] of Object.entries(patterns)) {
      if (domain.includes(pattern)) return name;
    }
    return domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1);
  };

  const groupedDocs = deduplicateAndGroup(documents);

  // Sort groups by latest document date (most recent first)
  const sortedGroups = [...groupedDocs].sort((a, b) => {
    const dateA = new Date(a.latest.received_at || a.latest.document_date || a.latest.created_at || 0);
    const dateB = new Date(b.latest.received_at || b.latest.document_date || b.latest.created_at || 0);
    return dateB.getTime() - dateA.getTime();
  });

  return (
    <div className="grid grid-cols-2 gap-6">
      {/* Milestone Timeline */}
      <div>
        <MilestoneTimeline shipmentId={shipmentId} etd={etd} eta={eta} />
      </div>

      {/* Document Timeline - Terminal Style */}
      <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
        <div className="px-4 py-2.5 bg-terminal-elevated border-b border-terminal-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-terminal-blue" />
            <FileText className="h-4 w-4 text-terminal-blue" />
            <span className="font-medium text-terminal-text text-sm">Document Timeline</span>
          </div>
          <span className="text-xs font-mono text-terminal-muted">[{sortedGroups.length}] unique</span>
        </div>

        {sortedGroups.length === 0 ? (
          <div className="text-center py-8 text-terminal-muted font-mono text-sm">
            No documents linked yet
          </div>
        ) : (
          <div className="p-4">
            <div className="flow-root">
              <ul className="-mb-8">
                {sortedGroups.map((group, idx) => {
                  const latest = group.latest;
                  const classification = latest.classification;
                  const isLast = idx === sortedGroups.length - 1;

                  return (
                    <li key={`${group.document_type}|${group.true_sender}`}>
                      <div className="relative pb-8">
                        {!isLast && (
                          <span
                            className="absolute top-4 left-4 -ml-px h-full w-0.5 bg-terminal-border"
                            aria-hidden="true"
                          />
                        )}
                        <div className="relative flex space-x-4">
                          <div>
                            <span className="h-8 w-8 rounded-full bg-terminal-blue/20 flex items-center justify-center ring-4 ring-terminal-surface border border-terminal-blue/30">
                              <span className="text-terminal-blue text-xs font-mono font-bold">
                                {idx + 1}
                              </span>
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3 mb-2">
                              <DocumentTypeBadge type={group.document_type as DocumentType} size="sm" />
                              {group.version_count > 1 && (
                                <span className="px-1.5 py-0.5 text-[10px] font-mono bg-terminal-blue/10 text-terminal-blue border border-terminal-blue/30 rounded">
                                  {group.version_count} ver
                                </span>
                              )}
                              {classification?.revision_type && classification.revision_type !== 'original' && (
                                <RevisionBadge
                                  revisionType={classification.revision_type}
                                  revisionNumber={classification.revision_number}
                                  size="sm"
                                />
                              )}
                            </div>

                            {/* Sender info */}
                            <div className="text-sm mb-2">
                              <span className="font-medium text-terminal-text">{group.sender_display}</span>
                              <span className="text-terminal-muted text-xs font-mono ml-1">({group.true_sender.split('@')[0]})</span>
                            </div>

                            <div className="flex items-center gap-4 text-sm mb-2">
                              {classification?.document_direction && classification?.sender_party_type && (
                                <DocumentFlowBadge
                                  direction={classification.document_direction}
                                  senderPartyType={classification.sender_party_type}
                                  receiverPartyType={classification.receiver_party_type}
                                  size="sm"
                                  variant="detailed"
                                />
                              )}
                            </div>

                            <div className="flex items-center justify-between">
                              <p className="text-xs font-mono text-terminal-muted">
                                {latest.received_at
                                  ? new Date(latest.received_at).toLocaleDateString()
                                  : latest.document_date
                                    ? new Date(latest.document_date).toLocaleDateString()
                                    : 'No date'}
                              </p>
                              <Link
                                href={`/emails/${latest.email_id}`}
                                className="text-xs font-mono text-terminal-blue hover:text-terminal-green transition-colors"
                              >
                                [view]
                              </Link>
                            </div>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ContainersTab({
  containers,
  milestones,
}: {
  containers: ContainerData[];
  milestones: ShipmentEventData[];
}) {
  if (containers.length === 0 && milestones.length === 0) {
    return (
      <div className="rounded-lg border border-terminal-border bg-terminal-surface p-12 text-center">
        <Package className="mx-auto h-12 w-12 text-terminal-muted mb-4" />
        <h3 className="text-sm font-medium text-terminal-text mb-2 font-mono">No Container Information</h3>
        <p className="text-xs text-terminal-muted font-mono">Container details and tracking events will appear here</p>
      </div>
    );
  }

  const formatDate = (date: string) => {
    try {
      return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return date;
    }
  };

  const getEventIcon = (eventType: string) => {
    const type = eventType.toLowerCase();
    if (type.includes('depart') || type.includes('sail')) {
      return <Ship className="h-4 w-4 text-terminal-blue" />;
    }
    if (type.includes('arriv') || type.includes('dock')) {
      return <Anchor className="h-4 w-4 text-terminal-green" />;
    }
    if (type.includes('load') || type.includes('discharge')) {
      return <Package className="h-4 w-4 text-terminal-amber" />;
    }
    return <CheckCircle2 className="h-4 w-4 text-terminal-muted" />;
  };

  const getContainerTypeLabel = (type?: string) => {
    if (!type) return 'Standard';
    const labels: Record<string, string> = {
      '20GP': "20' GP",
      '40GP': "40' GP",
      '40HC': "40' HC",
      '45HC': "45' HC",
      'REEFER': 'Reefer',
      '20RF': "20' RF",
      '40RF': "40' RF",
    };
    return labels[type.toUpperCase()] || type;
  };

  return (
    <div className="space-y-6">
      {/* Containers List - Terminal Style */}
      <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
        <div className="px-4 py-2.5 bg-terminal-elevated border-b border-terminal-border flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-terminal-purple" />
          <Package className="h-4 w-4 text-terminal-purple" />
          <span className="font-medium text-terminal-text text-sm">Containers</span>
          <span className="ml-auto text-xs font-mono text-terminal-muted">[{containers.length}]</span>
        </div>

        {containers.length > 0 ? (
          <div className="divide-y divide-terminal-border">
            {containers.map((container) => (
              <div key={container.id} className="p-4 hover:bg-terminal-elevated transition-colors">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-base font-mono font-semibold text-terminal-text">
                        {container.container_number}
                      </span>
                      {container.is_primary && (
                        <span className="px-2 py-0.5 text-[10px] font-mono bg-terminal-blue/10 text-terminal-blue border border-terminal-blue/30 rounded">
                          Primary
                        </span>
                      )}
                      {container.container_type && (
                        <span className="px-2 py-0.5 text-[10px] font-mono bg-terminal-bg text-terminal-muted border border-terminal-border rounded">
                          {getContainerTypeLabel(container.container_type)}
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs font-mono">
                      {container.seal_number && (
                        <div>
                          <span className="text-terminal-muted">Seal: </span>
                          <span className="text-terminal-text">{container.seal_number}</span>
                        </div>
                      )}
                      {container.gross_weight && (
                        <div>
                          <span className="text-terminal-muted">Weight: </span>
                          <span className="text-terminal-text">
                            {container.gross_weight} {container.weight_unit || 'KG'}
                          </span>
                        </div>
                      )}
                      {container.is_reefer && (
                        <div className="flex items-center gap-1">
                          <Thermometer className="h-3 w-3 text-terminal-blue" />
                          <span className="text-terminal-blue">
                            Reefer {container.temperature_setting && `${container.temperature_setting}C`}
                          </span>
                        </div>
                      )}
                      {container.is_hazmat && (
                        <div className="flex items-center gap-1">
                          <AlertTriangle className="h-3 w-3 text-terminal-red" />
                          <span className="text-terminal-red">Hazmat</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-6 text-center text-terminal-muted font-mono text-sm">
            No container details available
          </div>
        )}
      </div>

      {/* Milestones Timeline - Terminal Style */}
      <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
        <div className="px-4 py-2.5 bg-terminal-elevated border-b border-terminal-border flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-terminal-green" />
          <MapPin className="h-4 w-4 text-terminal-green" />
          <span className="font-medium text-terminal-text text-sm">Tracking Milestones</span>
          <span className="ml-auto text-xs font-mono text-terminal-muted">[{milestones.length}]</span>
        </div>

        {milestones.length > 0 ? (
          <div className="p-4">
            <div className="relative">
              {milestones.map((event, idx) => {
                const isLast = idx === milestones.length - 1;

                return (
                  <div key={event.id} className="relative pb-6 last:pb-0">
                    {!isLast && (
                      <div className="absolute left-4 top-8 bottom-0 w-0.5 bg-terminal-border" />
                    )}

                    <div className="flex gap-4">
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-terminal-elevated flex items-center justify-center z-10 border border-terminal-border">
                        {getEventIcon(event.event_type)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-terminal-text capitalize text-sm">
                            {event.event_type.replace(/_/g, ' ')}
                          </span>
                          <span className="text-xs font-mono text-terminal-muted">
                            {formatDate(event.event_date)}
                          </span>
                        </div>

                        {event.location && (
                          <div className="flex items-center gap-1 text-xs text-terminal-muted font-mono mb-1">
                            <MapPin className="h-3 w-3" />
                            {event.location}
                            {event.location_code && (
                              <span className="text-terminal-muted">({event.location_code})</span>
                            )}
                          </div>
                        )}

                        {event.description && (
                          <p className="text-xs text-terminal-muted">{event.description}</p>
                        )}

                        <span className="text-[10px] font-mono text-terminal-muted capitalize">
                          src: {event.source_type.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="p-6 text-center text-terminal-muted font-mono text-sm">
            No tracking milestones recorded yet
          </div>
        )}
      </div>
    </div>
  );
}

function RevisionsTab({
  revisions,
  bookingNumber,
}: {
  revisions: BookingRevision[];
  bookingNumber?: string;
}) {
  if (revisions.length === 0) {
    return (
      <div className="rounded-lg border border-terminal-border bg-terminal-surface p-12 text-center">
        <History className="mx-auto h-12 w-12 text-terminal-muted mb-4" />
        <h3 className="text-sm font-medium text-terminal-text mb-2 font-mono">No Revision History</h3>
        <p className="text-xs text-terminal-muted font-mono">
          {bookingNumber
            ? `No revisions recorded for booking ${bookingNumber}`
            : 'No booking number associated with this shipment'}
        </p>
      </div>
    );
  }

  const formatDate = (date: string | undefined) => {
    if (!date) return '--';
    try {
      return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return date;
    }
  };

  const getRevisionLabel = (revision: BookingRevision) => {
    if (revision.revision_number === 0) return 'Original';
    const ordinal = getOrdinal(revision.revision_number);
    return `${ordinal} Update`;
  };

  const getOrdinal = (n: number) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };

  const getRevisionDotColor = (revisionType: string) => {
    switch (revisionType?.toLowerCase()) {
      case 'original':
        return 'bg-terminal-green';
      case 'amendment':
        return 'bg-terminal-amber';
      case 'cancellation':
        return 'bg-terminal-red';
      default:
        return 'bg-terminal-blue';
    }
  };

  const getRevisionTextColor = (revisionType: string) => {
    switch (revisionType?.toLowerCase()) {
      case 'original':
        return 'text-terminal-green';
      case 'amendment':
        return 'text-terminal-amber';
      case 'cancellation':
        return 'text-terminal-red';
      default:
        return 'text-terminal-blue';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-lg border border-terminal-border bg-terminal-surface p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="h-2 w-2 rounded-full bg-terminal-amber" />
          <History className="h-4 w-4 text-terminal-amber" />
          <span className="font-medium text-terminal-text text-sm">Booking Revision History</span>
        </div>
        <p className="text-xs font-mono text-terminal-muted">
          Tracking {revisions.length} revision{revisions.length !== 1 ? 's' : ''} for booking{' '}
          <span className="text-terminal-text">{bookingNumber}</span>
        </p>
      </div>

      {/* Timeline - Terminal Style */}
      <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
        <div className="relative">
          {revisions.map((revision, idx) => {
            const isLast = idx === revisions.length - 1;
            const changedFields = revision.changed_fields || {};
            const changedFieldNames = Object.keys(changedFields);

            return (
              <div key={`${revision.booking_number}-${revision.revision_number}`} className="relative">
                {/* Connector line */}
                {!isLast && (
                  <div className="absolute left-8 top-16 bottom-0 w-0.5 bg-terminal-border" />
                )}

                <div className="p-6 hover:bg-terminal-elevated transition-colors">
                  <div className="flex items-start gap-4">
                    {/* Revision number circle - Terminal Style */}
                    <div className={`flex-shrink-0 w-10 h-10 rounded-full border flex items-center justify-center z-10 ${
                      revision.revision_number === 0
                        ? 'bg-terminal-green/10 border-terminal-green/30'
                        : 'bg-terminal-blue/10 border-terminal-blue/30'
                    }`}>
                      <span className={`text-sm font-mono font-bold ${
                        revision.revision_number === 0 ? 'text-terminal-green' : 'text-terminal-blue'
                      }`}>
                        {revision.revision_number}
                      </span>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        {/* Revision label with dot */}
                        <span className={`flex items-center gap-1.5 text-xs font-mono ${getRevisionTextColor(revision.revision_type)}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${getRevisionDotColor(revision.revision_type)}`} />
                          {getRevisionLabel(revision)}
                        </span>
                        {revision.revision_type && revision.revision_type !== 'original' && (
                          <span className="text-xs font-mono text-terminal-muted capitalize">
                            ({revision.revision_type})
                          </span>
                        )}
                        <span className="text-xs font-mono text-terminal-muted">
                          {formatDate(revision.revision_received_at || revision.created_at)}
                        </span>
                      </div>

                      {/* Snapshot data - Terminal Style */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 p-3 bg-terminal-bg rounded-lg border border-terminal-border">
                        <div>
                          <dt className="text-[10px] font-mono text-terminal-muted uppercase tracking-wide">Vessel</dt>
                          <dd className="text-xs font-mono font-medium text-terminal-text mt-0.5">{revision.vessel_name || '--'}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] font-mono text-terminal-muted uppercase tracking-wide">Voyage</dt>
                          <dd className="text-xs font-mono font-medium text-terminal-text mt-0.5">{revision.voyage_number || '--'}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] font-mono text-terminal-muted uppercase tracking-wide">ETD</dt>
                          <dd className="text-xs font-mono font-medium text-terminal-text mt-0.5">
                            {revision.etd ? new Date(revision.etd).toLocaleDateString() : '--'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] font-mono text-terminal-muted uppercase tracking-wide">ETA</dt>
                          <dd className="text-xs font-mono font-medium text-terminal-text mt-0.5">
                            {revision.eta ? new Date(revision.eta).toLocaleDateString() : '--'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[10px] font-mono text-terminal-muted uppercase tracking-wide">Port of Loading</dt>
                          <dd className="text-xs font-mono font-medium text-terminal-text mt-0.5">{revision.port_of_loading || '--'}</dd>
                        </div>
                        <div>
                          <dt className="text-[10px] font-mono text-terminal-muted uppercase tracking-wide">Port of Discharge</dt>
                          <dd className="text-xs font-mono font-medium text-terminal-text mt-0.5">{revision.port_of_discharge || '--'}</dd>
                        </div>
                      </div>

                      {/* Changed fields - Terminal Style */}
                      {changedFieldNames.length > 0 && (
                        <div className="mt-3">
                          <div className="flex items-center gap-2 text-[10px] font-mono text-terminal-amber mb-2">
                            <AlertCircle className="h-3 w-3" />
                            Changes from previous revision:
                          </div>
                          <div className="space-y-1">
                            {changedFieldNames.map((field) => {
                              const change = changedFields[field];
                              return (
                                <div
                                  key={field}
                                  className="flex items-center gap-2 text-xs font-mono bg-terminal-amber/10 border border-terminal-amber/20 px-3 py-1.5 rounded"
                                >
                                  <span className="font-medium text-terminal-text capitalize">
                                    {field.replace(/_/g, ' ')}:
                                  </span>
                                  <span className="text-terminal-red line-through">
                                    {change.old || 'empty'}
                                  </span>
                                  <ArrowRight className="h-3 w-3 text-terminal-muted" />
                                  <span className="text-terminal-green font-medium">
                                    {change.new || 'empty'}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Source email */}
                      {revision.source_email_subject && (
                        <div className="mt-3 text-[10px] font-mono text-terminal-muted">
                          src: {revision.source_email_subject}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface JourneyProgressCardProps {
  workflowPhase?: string;
  workflowState?: string;
  etd?: string;
  eta?: string;
  status?: string;
}

function JourneyProgressCard({
  workflowPhase,
  workflowState,
  etd,
  eta,
  status,
}: JourneyProgressCardProps) {
  // Calculate journey progress percentage
  const calculateProgress = (): number => {
    if (!workflowPhase && !workflowState) return 0;

    const phase = (workflowPhase || '').toLowerCase();
    const state = (workflowState || '').toLowerCase();

    // Delivery phase = 90-100%
    if (phase === 'delivery') {
      if (state === 'pod_received') return 100;
      return 90;
    }

    // Arrival phase = 70-89%
    if (phase === 'arrival') return 75;

    // In-transit phase = 50-69%
    if (phase === 'in_transit' || state === 'departed' || state === 'sailing') return 55;

    // Pre-departure states with specific progress
    const stateProgress: Record<string, number> = {
      'new': 5,
      'booking_confirmed': 10,
      'booking_confirmation_received': 10,
      'booking_confirmation_shared': 15,
      'commercial_invoice_received': 20,
      'packing_list_received': 25,
      'si_pending': 25,
      'si_draft_received': 30,
      'si_submitted': 35,
      'checklist_approved': 35,
      'si_confirmed': 40,
      'vgm_confirmed': 42,
      'hbl_draft_sent': 45,
      'documentation_complete': 48,
    };

    return stateProgress[state] || 5;
  };

  const progress = calculateProgress();

  // Calculate days to ETD
  const getDaysToDate = (dateStr?: string): number | null => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  };

  const daysToEtd = getDaysToDate(etd);
  const daysToEta = getDaysToDate(eta);

  // Determine phase display
  const getPhaseInfo = () => {
    const phase = (workflowPhase || '').toLowerCase();
    const state = (workflowState || status || '').toLowerCase();

    if (phase === 'delivery' || state === 'delivered') {
      return { label: 'Delivered', color: 'terminal-green', dot: 'bg-terminal-green' };
    }
    if (phase === 'arrival' || state === 'arrived') {
      return { label: 'Arrival', color: 'terminal-amber', dot: 'bg-terminal-amber' };
    }
    if (phase === 'in_transit' || state === 'in_transit' || state === 'departed' || state === 'sailing') {
      return { label: 'In Transit', color: 'terminal-purple', dot: 'bg-terminal-purple' };
    }
    return { label: 'Pre-Departure', color: 'terminal-blue', dot: 'bg-terminal-blue' };
  };

  const phaseInfo = getPhaseInfo();

  // Progress bar color based on progress
  const getProgressColor = () => {
    if (progress >= 90) return 'bg-terminal-green';
    if (progress >= 50) return 'bg-terminal-purple';
    if (progress >= 25) return 'bg-terminal-amber';
    return 'bg-terminal-blue';
  };

  // Format workflow state for display
  const formatState = (state?: string) => {
    if (!state) return 'Unknown';
    return state
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  return (
    <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
      <div className="px-4 py-2.5 bg-terminal-elevated border-b border-terminal-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${phaseInfo.dot}`} />
          <TrendingUp className={`h-4 w-4 text-${phaseInfo.color}`} />
          <span className="font-medium text-terminal-text text-sm">Journey Progress</span>
        </div>
        <span className={`flex items-center gap-1.5 px-2 py-0.5 text-xs font-mono text-${phaseInfo.color} bg-${phaseInfo.color}/10 border border-${phaseInfo.color}/30 rounded`}>
          <span className={`h-1.5 w-1.5 rounded-full ${phaseInfo.dot}`} />
          {phaseInfo.label}
        </span>
      </div>

      <div className="p-4">
        {/* Progress Bar - Terminal Style */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-mono text-terminal-muted">{formatState(workflowState)}</span>
            <span className="text-lg font-mono font-bold text-terminal-text">{progress}%</span>
          </div>
          <div className="h-2 bg-terminal-bg rounded-full overflow-hidden border border-terminal-border">
            <div
              className={`h-full ${getProgressColor()} transition-all duration-500 ease-out rounded-full`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-[10px] font-mono text-terminal-muted">
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-terminal-blue"></span> Booking</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-terminal-amber"></span> Documentation</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-terminal-purple"></span> In Transit</span>
            <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-terminal-green"></span> Delivered</span>
          </div>
        </div>

        {/* Timeline Metrics - Terminal Style */}
        <div className="grid grid-cols-2 gap-4">
          {/* Days to ETD */}
          <div className="bg-terminal-bg rounded-lg p-4 border border-terminal-border">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="h-4 w-4 text-terminal-muted" />
              <span className="text-xs font-mono text-terminal-muted uppercase tracking-wide">ETD</span>
            </div>
            {etd ? (
              <>
                <div className="text-xl font-mono font-bold">
                  {daysToEtd !== null && daysToEtd >= 0 ? (
                    <span className={daysToEtd <= 3 ? 'text-terminal-red' : daysToEtd <= 7 ? 'text-terminal-amber' : 'text-terminal-text'}>
                      {daysToEtd === 0 ? 'Today' : daysToEtd === 1 ? 'Tomorrow' : `${daysToEtd}d`}
                    </span>
                  ) : daysToEtd !== null && daysToEtd < 0 ? (
                    <span className="text-terminal-green">Departed</span>
                  ) : (
                    <span className="text-terminal-text font-mono">{new Date(etd).toLocaleDateString()}</span>
                  )}
                </div>
                <div className="text-[10px] font-mono text-terminal-muted">
                  {new Date(etd).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </>
            ) : (
              <div className="text-sm font-mono text-terminal-muted">--</div>
            )}
          </div>

          {/* Days to ETA */}
          <div className="bg-terminal-bg rounded-lg p-4 border border-terminal-border">
            <div className="flex items-center gap-2 mb-1">
              <MapPin className="h-4 w-4 text-terminal-muted" />
              <span className="text-xs font-mono text-terminal-muted uppercase tracking-wide">ETA</span>
            </div>
            {eta ? (
              <>
                <div className="text-xl font-mono font-bold">
                  {daysToEta !== null && daysToEta >= 0 ? (
                    <span className={daysToEta <= 3 ? 'text-terminal-amber' : 'text-terminal-text'}>
                      {daysToEta === 0 ? 'Today' : daysToEta === 1 ? 'Tomorrow' : `${daysToEta}d`}
                    </span>
                  ) : daysToEta !== null && daysToEta < 0 ? (
                    <span className="text-terminal-green">Arrived</span>
                  ) : (
                    <span className="text-terminal-text font-mono">{new Date(eta).toLocaleDateString()}</span>
                  )}
                </div>
                <div className="text-[10px] font-mono text-terminal-muted">
                  {new Date(eta).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </>
            ) : (
              <div className="text-sm font-mono text-terminal-muted">--</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StakeholdersSection({ stakeholders }: { stakeholders: ShipmentStakeholders }) {
  const hasStakeholders = stakeholders.shipper || stakeholders.consignee || stakeholders.carrier || stakeholders.notify_party;

  if (!hasStakeholders) {
    return (
      <div className="rounded-lg border border-terminal-border bg-terminal-surface p-12 text-center">
        <Users className="mx-auto h-12 w-12 text-terminal-muted mb-4" />
        <h3 className="text-sm font-medium text-terminal-text mb-2 font-mono">No Stakeholders Linked</h3>
        <p className="text-xs text-terminal-muted font-mono">Stakeholder information will appear here once linked</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {stakeholders.shipper && (
        <StakeholderCard party={stakeholders.shipper} role="Shipper" />
      )}
      {stakeholders.consignee && (
        <StakeholderCard party={stakeholders.consignee} role="Consignee" />
      )}
      {stakeholders.notify_party && (
        <StakeholderCard party={stakeholders.notify_party} role="Notify Party" />
      )}
      {stakeholders.carrier && (
        <StakeholderCard party={stakeholders.carrier} role="Carrier" />
      )}
    </div>
  );
}

function StakeholderCard({ party, role }: { party: StakeholderData; role: string }) {
  const roleColors: Record<string, { dot: string; text: string; border: string }> = {
    Shipper: { dot: 'bg-terminal-blue', text: 'text-terminal-blue', border: 'border-terminal-blue/30' },
    'Notify Party': { dot: 'bg-terminal-amber', text: 'text-terminal-amber', border: 'border-terminal-amber/30' },
    Consignee: { dot: 'bg-terminal-green', text: 'text-terminal-green', border: 'border-terminal-green/30' },
    Carrier: { dot: 'bg-terminal-purple', text: 'text-terminal-purple', border: 'border-terminal-purple/30' },
  };

  const colors = roleColors[role] || { dot: 'bg-terminal-muted', text: 'text-terminal-muted', border: 'border-terminal-border' };

  const reliabilityColor = (score?: number) => {
    if (!score) return 'text-terminal-muted';
    if (score >= 80) return 'text-terminal-green';
    if (score >= 60) return 'text-terminal-amber';
    return 'text-terminal-red';
  };

  return (
    <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-terminal-elevated border-b border-terminal-border">
        <div className="flex items-center justify-between mb-2">
          <span className={`flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-mono ${colors.text} bg-${colors.text.replace('text-', '')}/10 border ${colors.border} rounded`}>
            <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
            {role}
          </span>
          {party.is_customer && (
            <span className="flex items-center gap-1 text-terminal-amber">
              <Star className="h-3 w-3 fill-terminal-amber" />
              <span className="text-[10px] font-mono">Customer</span>
            </span>
          )}
        </div>
        <h3 className="text-sm font-semibold text-terminal-text flex items-center gap-2">
          <Building2 className="h-4 w-4 text-terminal-muted" />
          {party.party_name}
        </h3>
        <p className="text-xs font-mono text-terminal-muted capitalize mt-0.5">{party.party_type.replace(/_/g, ' ')}</p>
      </div>

      {/* Contact Info */}
      <div className="px-4 py-3 space-y-2">
        {party.contact_email && (
          <div className="flex items-center gap-2 text-xs">
            <Mail className="h-3.5 w-3.5 text-terminal-muted" />
            <a href={`mailto:${party.contact_email}`} className="text-terminal-blue hover:text-terminal-green font-mono truncate transition-colors">
              {party.contact_email}
            </a>
          </div>
        )}
        {party.contact_phone && (
          <div className="flex items-center gap-2 text-xs">
            <Phone className="h-3.5 w-3.5 text-terminal-muted" />
            <a href={`tel:${party.contact_phone}`} className="text-terminal-blue hover:text-terminal-green font-mono transition-colors">
              {party.contact_phone}
            </a>
          </div>
        )}
        {(party.city || party.country) && (
          <div className="flex items-center gap-2 text-xs text-terminal-muted">
            <MapPin className="h-3.5 w-3.5" />
            <span className="font-mono">{[party.city, party.country].filter(Boolean).join(', ')}</span>
          </div>
        )}
      </div>

      {/* Metrics - Terminal Style */}
      <div className="px-4 py-3 bg-terminal-bg border-t border-terminal-border">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <div className={`text-sm font-mono font-bold ${reliabilityColor(party.reliability_score)}`}>
              {party.reliability_score ? `${Math.round(party.reliability_score)}%` : '--'}
            </div>
            <div className="text-[10px] font-mono text-terminal-muted uppercase tracking-wide">Reliability</div>
          </div>
          <div>
            <div className="text-sm font-mono font-bold text-terminal-text">
              {party.response_time_avg_hours ? `${Math.round(party.response_time_avg_hours)}h` : '--'}
            </div>
            <div className="text-[10px] font-mono text-terminal-muted uppercase tracking-wide">Avg Response</div>
          </div>
          <div>
            <div className="text-sm font-mono font-bold text-terminal-text">
              {party.total_shipments || 0}
            </div>
            <div className="text-[10px] font-mono text-terminal-muted uppercase tracking-wide">Shipments</div>
          </div>
        </div>
      </div>
    </div>
  );
}
