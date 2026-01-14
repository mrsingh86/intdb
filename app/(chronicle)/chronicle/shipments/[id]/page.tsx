'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Ship,
  ArrowLeft,
  ArrowRight,
  Calendar,
  Package,
  FileText,
  Mail,
  Loader2,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Zap,
  DollarSign,
  ExternalLink,
  Users,
  MapPin,
  Anchor,
  Container,
  Paperclip,
  MessageSquare,
  TrendingUp,
  Eye,
  Filter,
  X,
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
  chronicles: Array<{
    id: string;
    messageId: string;
    subject: string;
    sender: string;
    receivedAt: string;
    documentType: string;
    messageType?: string;
    carrier: string;
    confidence: number;
    extractedData?: Record<string, unknown>;
    hasAttachments: boolean;
    attachmentCount: number;
    summary?: string;
    sentiment?: string;
    hasIssue?: boolean;
    issueType?: string;
    fromParty?: string;
  }>;
  aiSummary?: {
    story: string;
    narrative: string | null;
    currentBlocker: string | null;
    blockerOwner: string | null;
    blockerType?: string | null;
    nextAction: string | null;
    actionOwner: string | null;
    actionContact?: string | null;
    financialImpact: string | null;
    documentedCharges: string | null;
    estimatedDetention: string | null;
    customerImpact: string | null;
    customerActionRequired?: string | null;
    riskLevel: 'red' | 'amber' | 'green';
    riskReason: string | null;
    daysOverdue: number | null;
    escalationCount: number | null;
    daysSinceActivity: number | null;
    issueCount: number | null;
    urgentMessageCount: number | null;
    carrierPerformance?: string | null;
    shipperRiskSignal?: string | null;
    keyInsight: string | null;
    keyDeadline: string | null;
    intelligenceWarnings?: string[] | null;
    updatedAt: string;
  } | null;
  deepDive?: {
    escalations: Array<{
      id: string;
      date: string;
      fromParty: string | null;
      issueType: string | null;
      summary: string | null;
    }>;
    issues: Array<{
      id: string;
      date: string;
      messageType: string | null;
      issueType: string | null;
      fromParty: string | null;
      summary: string | null;
    }>;
    urgentMessages: Array<{
      id: string;
      date: string;
      messageType: string | null;
      sentiment: string | null;
      fromParty: string | null;
      summary: string | null;
    }>;
  };
}

type TimelineFilter = 'all' | 'issues' | 'documents' | 'updates';

// ============================================================================
// SHIPMENT DETAIL PAGE
// ============================================================================

export default function ShipmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const shipmentId = params.id as string;

  const [data, setData] = useState<ShipmentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>('all');
  const [expandedTimeline, setExpandedTimeline] = useState(false);

  useEffect(() => {
    async function fetchShipment() {
      setLoading(true);
      try {
        const response = await fetch(`/api/chronicle/shipments/${shipmentId}`);
        if (!response.ok) {
          setError(response.status === 404 ? 'Shipment not found' : 'Failed to load shipment');
          return;
        }
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError('Failed to load shipment');
      } finally {
        setLoading(false);
      }
    }
    if (shipmentId) fetchShipment();
  }, [shipmentId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-terminal-muted" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-16">
        <AlertCircle className="h-10 w-10 mx-auto mb-4 text-terminal-red" />
        <h2 className="text-lg font-medium text-terminal-text">{error || 'Shipment not found'}</h2>
        <p className="mt-2 text-sm text-terminal-muted">
          The shipment you are looking for could not be loaded.
        </p>
        <button
          onClick={() => router.push('/chronicle/shipments')}
          className="mt-6 px-4 py-2 text-sm font-mono bg-terminal-purple/10 text-terminal-purple border border-terminal-purple/30 rounded-lg hover:bg-terminal-purple/20 transition-colors inline-flex items-center gap-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Shipments
        </button>
      </div>
    );
  }

  const { shipment, routing, cutoffs, containers, chronicles, aiSummary, deepDive } = data;
  const risk = aiSummary?.riskLevel || 'green';

  return (
    <div className="space-y-6 pb-12">
      {/* Back Navigation */}
      <button
        onClick={() => router.push('/chronicle/shipments')}
        className="flex items-center gap-2 text-sm text-terminal-muted hover:text-terminal-purple transition-colors font-mono"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Shipments
      </button>

      {/* Hero Header */}
      <ShipmentHeader shipment={shipment} routing={routing} risk={risk} />

      {/* AI Intelligence Card - The Star */}
      {aiSummary && <IntelligenceCard aiSummary={aiSummary} />}

      {/* Quick Stats Bar */}
      <QuickStatsBar
        shipment={shipment}
        aiSummary={aiSummary}
        chroniclesCount={chronicles.length}
        escalationsCount={deepDive?.escalations.length || 0}
        issuesCount={deepDive?.issues.length || 0}
      />

      {/* Cutoffs Section */}
      {cutoffs.length > 0 && <CutoffsSection cutoffs={cutoffs} />}

      {/* Containers Section */}
      {containers.length > 0 && <ContainersSection containers={containers} />}

      {/* Deep Dive: Issues & Escalations */}
      {(deepDive?.escalations.length || deepDive?.issues.length) ? (
        <DeepDiveSection deepDive={deepDive} />
      ) : null}

      {/* Document Timeline */}
      <DocumentTimeline
        chronicles={chronicles}
        filter={timelineFilter}
        onFilterChange={setTimelineFilter}
        expanded={expandedTimeline}
        onToggleExpand={() => setExpandedTimeline(!expandedTimeline)}
      />
    </div>
  );
}

// ============================================================================
// SHIPMENT HEADER
// ============================================================================

interface ShipmentHeaderProps {
  shipment: ShipmentData['shipment'];
  routing: ShipmentData['routing'];
  risk: 'red' | 'amber' | 'green';
}

function ShipmentHeader({ shipment, routing, risk }: ShipmentHeaderProps) {
  const riskConfig = {
    red: {
      label: 'Critical',
      bg: 'bg-terminal-red/15',
      text: 'text-terminal-red',
      border: 'border-terminal-red',
    },
    amber: {
      label: 'Attention Required',
      bg: 'bg-terminal-amber/15',
      text: 'text-terminal-amber',
      border: 'border-terminal-amber',
    },
    green: {
      label: 'On Track',
      bg: 'bg-terminal-green/15',
      text: 'text-terminal-green',
      border: 'border-terminal-green',
    },
  }[risk];

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '--';
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div
      className={`rounded-xl border-l-4 ${riskConfig.border} border border-terminal-border bg-terminal-surface p-6`}
    >
      {/* Top Row: Booking + Risk Badge */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-terminal-text font-mono flex items-center gap-3">
            {shipment.bookingNumber}
            {shipment.blNumber && (
              <span className="text-sm font-normal px-2 py-0.5 rounded bg-terminal-elevated text-terminal-muted border border-terminal-border">
                BL: {shipment.blNumber}
              </span>
            )}
          </h1>

          {/* Parties */}
          <div className="mt-3 flex items-center gap-2 text-sm text-terminal-muted">
            <Users className="h-4 w-4" />
            <span className="text-terminal-text">{shipment.shipper || 'Unknown Shipper'}</span>
            <ArrowRight className="h-3 w-3" />
            <span className="text-terminal-text">{shipment.consignee || 'Unknown Consignee'}</span>
          </div>
        </div>

        {/* Risk Badge */}
        <span
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${riskConfig.bg} ${riskConfig.text}`}
        >
          {riskConfig.label}
        </span>
      </div>

      {/* Route Visualization */}
      <div className="mt-6 pt-6 border-t border-terminal-border">
        <div className="flex items-center justify-between gap-4">
          {/* Origin */}
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-terminal-blue/20 flex items-center justify-center mx-auto">
              <MapPin className="h-5 w-5 text-terminal-blue" />
            </div>
            <p className="mt-2 text-lg font-mono font-semibold text-terminal-blue">
              {routing.portOfLoadingCode || 'POL'}
            </p>
            <p className="text-xs text-terminal-muted max-w-[120px] truncate">
              {routing.portOfLoading || 'Port of Loading'}
            </p>
          </div>

          {/* Route Line with Vessel */}
          <div className="flex-1 px-4">
            <div className="relative">
              {/* Line */}
              <div className="h-0.5 bg-gradient-to-r from-terminal-blue via-terminal-purple to-terminal-green" />

              {/* Vessel in middle */}
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-terminal-surface px-3 py-1">
                <div className="flex items-center gap-2 text-xs text-terminal-muted">
                  <Ship className="h-4 w-4 text-terminal-purple" />
                  <span className="font-mono">
                    {routing.vesselName || 'Vessel'}
                    {routing.voyageNumber && ` / ${routing.voyageNumber}`}
                  </span>
                </div>
              </div>

              {/* Progress indicator */}
              <div
                className="absolute top-1/2 transform -translate-y-1/2 w-3 h-3 rounded-full bg-terminal-purple border-2 border-terminal-surface shadow-lg"
                style={{ left: `${routing.journeyProgress}%` }}
              />
            </div>
          </div>

          {/* Destination */}
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-terminal-green/20 flex items-center justify-center mx-auto">
              <Anchor className="h-5 w-5 text-terminal-green" />
            </div>
            <p className="mt-2 text-lg font-mono font-semibold text-terminal-green">
              {routing.portOfDischargeCode || 'POD'}
            </p>
            <p className="text-xs text-terminal-muted max-w-[120px] truncate">
              {routing.portOfDischarge || 'Port of Discharge'}
            </p>
          </div>
        </div>

        {/* Journey Progress */}
        <div className="mt-4 text-center">
          <span className="text-xs font-mono text-terminal-muted">
            Journey Progress: {routing.journeyProgress}%
          </span>
        </div>
      </div>

      {/* Schedule Row */}
      <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
        <ScheduleItem label="ETD" date={shipment.dates.etd} icon={Calendar} />
        <ScheduleItem label="ETA" date={shipment.dates.eta} icon={Calendar} />
        {shipment.dates.actualDeparture && (
          <ScheduleItem label="ATD" date={shipment.dates.actualDeparture} icon={CheckCircle2} />
        )}
        {shipment.dates.actualArrival && (
          <ScheduleItem label="ATA" date={shipment.dates.actualArrival} icon={CheckCircle2} />
        )}
      </div>

      {/* Carrier & Metadata */}
      <div className="mt-4 pt-4 border-t border-terminal-border flex items-center gap-4 text-xs text-terminal-muted">
        {shipment.carrier && (
          <span className="px-2 py-1 rounded bg-terminal-purple/10 text-terminal-purple font-mono">
            {shipment.carrier}
          </span>
        )}
        <span>Stage: {shipment.stage}</span>
        <span>Phase: {shipment.phase.replace(/_/g, ' ')}</span>
        {shipment.cargo.containerCount > 0 && (
          <span className="flex items-center gap-1">
            <Package className="h-3 w-3" />
            {shipment.cargo.containerCount} container{shipment.cargo.containerCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  );
}

function ScheduleItem({
  label,
  date,
  icon: Icon,
}: {
  label: string;
  date?: string;
  icon: React.ElementType;
}) {
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '--';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="text-center p-3 rounded-lg bg-terminal-bg border border-terminal-border">
      <div className="flex items-center justify-center gap-1 text-xs text-terminal-muted mb-1">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className="text-sm font-mono text-terminal-text">{formatDate(date)}</div>
    </div>
  );
}

// ============================================================================
// AI INTELLIGENCE CARD
// ============================================================================

interface IntelligenceCardProps {
  aiSummary: NonNullable<ShipmentData['aiSummary']>;
}

function IntelligenceCard({ aiSummary }: IntelligenceCardProps) {
  const risk = aiSummary.riskLevel;

  const riskBg = {
    red: 'bg-gradient-to-br from-terminal-red/10 to-terminal-red/5 border-terminal-red/30',
    amber: 'bg-gradient-to-br from-terminal-amber/10 to-terminal-amber/5 border-terminal-amber/30',
    green: 'bg-gradient-to-br from-terminal-green/10 to-terminal-green/5 border-terminal-green/30',
  }[risk];

  return (
    <div className={`rounded-xl border ${riskBg} p-6`}>
      <div className="flex items-center gap-2 mb-4">
        <div className="w-8 h-8 rounded-lg bg-terminal-purple/20 flex items-center justify-center">
          <Zap className="h-4 w-4 text-terminal-purple" />
        </div>
        <h2 className="text-lg font-semibold text-terminal-text">AI Intelligence Summary</h2>
        {aiSummary.updatedAt && (
          <span className="ml-auto text-[10px] font-mono text-terminal-muted">
            Updated {new Date(aiSummary.updatedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {/* Story/Narrative */}
      {(aiSummary.story || aiSummary.narrative) && (
        <div className="mb-5">
          <p className="text-terminal-text leading-relaxed">{aiSummary.story || aiSummary.narrative}</p>
        </div>
      )}

      {/* Blocker (Critical) */}
      {aiSummary.currentBlocker && (
        <div className="mb-4 p-4 rounded-lg bg-terminal-red/10 border border-terminal-red/30">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-terminal-red shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-terminal-red">Current Blocker</p>
              <p className="text-sm text-terminal-text mt-1">{aiSummary.currentBlocker}</p>
              <div className="flex items-center gap-2 mt-2">
                {aiSummary.blockerOwner && (
                  <span className="text-xs px-2 py-0.5 rounded bg-terminal-red/20 text-terminal-red font-mono">
                    Owner: {aiSummary.blockerOwner}
                  </span>
                )}
                {aiSummary.blockerType && (
                  <span className="text-xs px-2 py-0.5 rounded bg-terminal-surface text-terminal-muted font-mono">
                    {aiSummary.blockerType}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Next Action */}
      {aiSummary.nextAction && (
        <div className="mb-4 p-4 rounded-lg bg-terminal-amber/10 border border-terminal-amber/30">
          <div className="flex items-start gap-3">
            <TrendingUp className="h-5 w-5 text-terminal-amber shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-terminal-amber">Next Action Required</p>
              <p className="text-sm text-terminal-text mt-1">{aiSummary.nextAction}</p>
              <div className="flex items-center gap-2 mt-2">
                {aiSummary.actionOwner && (
                  <span className="text-xs px-2 py-0.5 rounded bg-terminal-amber/20 text-terminal-amber font-mono">
                    Owner: {aiSummary.actionOwner}
                  </span>
                )}
                {aiSummary.actionContact && (
                  <span className="text-xs px-2 py-0.5 rounded bg-terminal-surface text-terminal-muted font-mono">
                    Contact: {aiSummary.actionContact}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Key Insight + Deadline */}
      {(aiSummary.keyInsight || aiSummary.keyDeadline) && (
        <div className="flex flex-wrap gap-3 mb-4">
          {aiSummary.keyInsight && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-terminal-surface border border-terminal-border">
              <Eye className="h-4 w-4 text-terminal-blue" />
              <span className="text-sm text-terminal-text">{aiSummary.keyInsight}</span>
            </div>
          )}
          {aiSummary.keyDeadline && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-terminal-red/10 border border-terminal-red/30">
              <Clock className="h-4 w-4 text-terminal-red" />
              <span className="text-sm text-terminal-red">{aiSummary.keyDeadline}</span>
            </div>
          )}
        </div>
      )}

      {/* Financial Impact */}
      {(aiSummary.financialImpact || aiSummary.documentedCharges || aiSummary.estimatedDetention) && (
        <div className="p-4 rounded-lg bg-terminal-surface border border-terminal-border">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="h-4 w-4 text-terminal-amber" />
            <span className="text-sm font-medium text-terminal-text">Financial Impact</span>
          </div>
          <div className="space-y-1 text-sm">
            {aiSummary.financialImpact && (
              <p className="text-terminal-muted">{aiSummary.financialImpact}</p>
            )}
            <div className="flex items-center gap-4">
              {aiSummary.documentedCharges && (
                <span className="text-terminal-text font-mono">
                  Charges: {aiSummary.documentedCharges}
                </span>
              )}
              {aiSummary.estimatedDetention && (
                <span className="text-terminal-red font-mono">
                  Detention Risk: {aiSummary.estimatedDetention}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Customer Impact */}
      {aiSummary.customerImpact && (
        <div className="mt-4 p-3 rounded-lg bg-terminal-purple/10 border border-terminal-purple/30">
          <p className="text-xs text-terminal-purple font-medium mb-1">Customer Impact</p>
          <p className="text-sm text-terminal-text">{aiSummary.customerImpact}</p>
        </div>
      )}

      {/* Intelligence Warnings */}
      {aiSummary.intelligenceWarnings && aiSummary.intelligenceWarnings.length > 0 && (
        <div className="mt-4 space-y-2">
          {aiSummary.intelligenceWarnings.map((warning, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-xs text-terminal-amber bg-terminal-amber/10 px-3 py-2 rounded-lg"
            >
              <AlertTriangle className="h-3 w-3" />
              {warning}
            </div>
          ))}
        </div>
      )}

      {/* Risk Reason */}
      {aiSummary.riskReason && (
        <div className="mt-4 text-xs text-terminal-muted border-t border-terminal-border pt-3">
          <span className="font-medium">Risk Assessment: </span>
          {aiSummary.riskReason}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// QUICK STATS BAR
// ============================================================================

interface QuickStatsBarProps {
  shipment: ShipmentData['shipment'];
  aiSummary: ShipmentData['aiSummary'];
  chroniclesCount: number;
  escalationsCount: number;
  issuesCount: number;
}

function QuickStatsBar({
  shipment,
  aiSummary,
  chroniclesCount,
  escalationsCount,
  issuesCount,
}: QuickStatsBarProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
      <StatCard
        icon={FileText}
        label="Documents"
        value={chroniclesCount}
        color="terminal-blue"
      />
      <StatCard
        icon={AlertTriangle}
        label="Escalations"
        value={escalationsCount}
        color={escalationsCount > 0 ? 'terminal-red' : 'terminal-muted'}
      />
      <StatCard
        icon={AlertCircle}
        label="Issues"
        value={issuesCount}
        color={issuesCount > 0 ? 'terminal-purple' : 'terminal-muted'}
      />
      <StatCard
        icon={Clock}
        label="Days Stale"
        value={aiSummary?.daysSinceActivity || 0}
        color={
          (aiSummary?.daysSinceActivity || 0) > 5
            ? 'terminal-amber'
            : 'terminal-muted'
        }
      />
      <StatCard
        icon={TrendingUp}
        label="Progress"
        value={`${shipment.journeyProgress}%`}
        color="terminal-green"
      />
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ElementType;
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <div className="p-4 rounded-lg bg-terminal-surface border border-terminal-border text-center">
      <Icon className={`h-5 w-5 mx-auto mb-2 text-${color}`} />
      <div className={`text-2xl font-mono font-bold text-${color}`}>{value}</div>
      <div className="text-[10px] font-mono text-terminal-muted uppercase tracking-wider">
        {label}
      </div>
    </div>
  );
}

// ============================================================================
// CUTOFFS SECTION
// ============================================================================

interface CutoffsSectionProps {
  cutoffs: ShipmentData['cutoffs'];
}

function CutoffsSection({ cutoffs }: CutoffsSectionProps) {
  const statusConfig = {
    overdue: { icon: AlertCircle, color: 'terminal-red', bg: 'bg-terminal-red/10' },
    urgent: { icon: AlertTriangle, color: 'terminal-red', bg: 'bg-terminal-red/10' },
    warning: { icon: Clock, color: 'terminal-amber', bg: 'bg-terminal-amber/10' },
    safe: { icon: CheckCircle2, color: 'terminal-green', bg: 'bg-terminal-green/10' },
    submitted: { icon: CheckCircle2, color: 'terminal-green', bg: 'bg-terminal-green/10' },
    unknown: { icon: Clock, color: 'terminal-muted', bg: 'bg-terminal-surface' },
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '--';
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="rounded-xl border border-terminal-border bg-terminal-surface p-6">
      <div className="flex items-center gap-2 mb-4">
        <Calendar className="h-5 w-5 text-terminal-amber" />
        <h2 className="text-lg font-semibold text-terminal-text">Cutoff Deadlines</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {cutoffs.map((cutoff) => {
          const config = statusConfig[cutoff.status];
          const Icon = config.icon;

          return (
            <div
              key={cutoff.type}
              className={`p-4 rounded-lg border border-terminal-border ${config.bg}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-terminal-text">{cutoff.label}</span>
                <Icon className={`h-4 w-4 text-${config.color}`} />
              </div>
              <div className="text-lg font-mono text-terminal-text">{formatDate(cutoff.date)}</div>
              {cutoff.daysRemaining !== null && (
                <div className={`text-sm font-mono text-${config.color} mt-1`}>
                  {cutoff.daysRemaining < 0
                    ? `${Math.abs(cutoff.daysRemaining)} days overdue`
                    : cutoff.daysRemaining === 0
                    ? 'Due today!'
                    : cutoff.hoursRemaining && cutoff.hoursRemaining <= 24
                    ? `${cutoff.hoursRemaining} hours remaining`
                    : `${cutoff.daysRemaining} days remaining`}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// CONTAINERS SECTION
// ============================================================================

interface ContainersSectionProps {
  containers: ShipmentData['containers'];
}

function ContainersSection({ containers }: ContainersSectionProps) {
  return (
    <div className="rounded-xl border border-terminal-border bg-terminal-surface p-6">
      <div className="flex items-center gap-2 mb-4">
        <Container className="h-5 w-5 text-terminal-blue" />
        <h2 className="text-lg font-semibold text-terminal-text">
          Containers ({containers.length})
        </h2>
      </div>

      <div className="flex flex-wrap gap-2">
        {containers.map((container, i) => (
          <div
            key={container.number || i}
            className="px-3 py-2 rounded-lg bg-terminal-bg border border-terminal-border font-mono text-sm"
          >
            <span className="text-terminal-text">{container.number}</span>
            {container.type && (
              <span className="ml-2 text-terminal-muted text-xs">{container.type}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// DEEP DIVE SECTION
// ============================================================================

interface DeepDiveSectionProps {
  deepDive: NonNullable<ShipmentData['deepDive']>;
}

function DeepDiveSection({ deepDive }: DeepDiveSectionProps) {
  const [expanded, setExpanded] = useState(false);

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  return (
    <div className="rounded-xl border border-terminal-red/30 bg-terminal-red/5 p-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full"
      >
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-terminal-red" />
          <h2 className="text-lg font-semibold text-terminal-text">Issues & Escalations</h2>
          <span className="text-xs font-mono px-2 py-0.5 rounded bg-terminal-red/20 text-terminal-red">
            {(deepDive.escalations?.length || 0) + (deepDive.issues?.length || 0)} total
          </span>
        </div>
        <ChevronDown
          className={`h-5 w-5 text-terminal-muted transition-transform ${
            expanded ? 'rotate-180' : ''
          }`}
        />
      </button>

      {expanded && (
        <div className="mt-4 space-y-4">
          {/* Escalations */}
          {deepDive.escalations && deepDive.escalations.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-terminal-red mb-2">Escalations</h3>
              <div className="space-y-2">
                {deepDive.escalations.map((esc) => (
                  <Link
                    key={esc.id}
                    href={`/chronicle/documents/${esc.id}`}
                    className="block p-3 rounded-lg bg-terminal-surface border border-terminal-border hover:border-terminal-purple/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-terminal-muted">
                        {formatDate(esc.date)}
                      </span>
                      {esc.fromParty && (
                        <span className="text-xs px-2 py-0.5 rounded bg-terminal-elevated text-terminal-muted">
                          {esc.fromParty}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-terminal-text mt-1">{esc.summary || 'No summary'}</p>
                    {esc.issueType && (
                      <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded bg-terminal-red/15 text-terminal-red">
                        {esc.issueType}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Issues */}
          {deepDive.issues && deepDive.issues.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-terminal-purple mb-2">Issues</h3>
              <div className="space-y-2">
                {deepDive.issues.map((issue) => (
                  <Link
                    key={issue.id}
                    href={`/chronicle/documents/${issue.id}`}
                    className="block p-3 rounded-lg bg-terminal-surface border border-terminal-border hover:border-terminal-purple/50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-terminal-muted">
                        {formatDate(issue.date)}
                      </span>
                      {issue.fromParty && (
                        <span className="text-xs px-2 py-0.5 rounded bg-terminal-elevated text-terminal-muted">
                          {issue.fromParty}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-terminal-text mt-1">{issue.summary || 'No summary'}</p>
                    {issue.issueType && (
                      <span className="inline-block mt-2 text-xs px-2 py-0.5 rounded bg-terminal-purple/15 text-terminal-purple">
                        {issue.issueType}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// DOCUMENT TIMELINE
// ============================================================================

interface DocumentTimelineProps {
  chronicles: ShipmentData['chronicles'];
  filter: TimelineFilter;
  onFilterChange: (f: TimelineFilter) => void;
  expanded: boolean;
  onToggleExpand: () => void;
}

function DocumentTimeline({
  chronicles,
  filter,
  onFilterChange,
  expanded,
  onToggleExpand,
}: DocumentTimelineProps) {
  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const filteredChronicles = chronicles.filter((c) => {
    if (filter === 'all') return true;
    if (filter === 'issues') return c.hasIssue || c.sentiment === 'urgent' || c.sentiment === 'negative';
    if (filter === 'documents') return c.hasAttachments;
    if (filter === 'updates') return c.documentType?.includes('update') || c.documentType?.includes('amendment');
    return true;
  });

  const displayedChronicles = expanded ? filteredChronicles : filteredChronicles.slice(0, 10);

  return (
    <div className="rounded-xl border border-terminal-border bg-terminal-surface p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Mail className="h-5 w-5 text-terminal-blue" />
          <h2 className="text-lg font-semibold text-terminal-text">Document Timeline</h2>
          <span className="text-xs font-mono px-2 py-0.5 rounded bg-terminal-elevated text-terminal-muted">
            {chronicles.length} communications
          </span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-xs text-terminal-muted font-mono flex items-center gap-1">
          <Filter className="h-3 w-3" />
          Filter:
        </span>
        {(['all', 'issues', 'documents', 'updates'] as TimelineFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => onFilterChange(f)}
            className={`px-3 py-1 rounded-full text-xs font-mono transition-colors ${
              filter === f
                ? 'bg-terminal-purple/20 text-terminal-purple border border-terminal-purple/40'
                : 'bg-terminal-bg text-terminal-muted border border-terminal-border hover:border-terminal-muted'
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === 'issues' && (
              <span className="ml-1">
                ({chronicles.filter((c) => c.hasIssue || c.sentiment === 'urgent').length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Timeline */}
      {displayedChronicles.length === 0 ? (
        <div className="text-center py-12">
          <Mail className="h-10 w-10 mx-auto mb-3 text-terminal-muted opacity-50" />
          <p className="text-terminal-muted">No communications found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayedChronicles.map((chronicle) => {
            const isIssue = chronicle.hasIssue;
            const isUrgent = chronicle.sentiment === 'urgent' || chronicle.sentiment === 'negative';

            return (
              <Link
                key={chronicle.id}
                href={`/chronicle/documents/${chronicle.id}`}
                className={`group flex items-start gap-3 p-3 rounded-lg border transition-all hover:border-terminal-purple/50 ${
                  isIssue
                    ? 'border-terminal-red/30 bg-terminal-red/5'
                    : isUrgent
                    ? 'border-terminal-amber/30 bg-terminal-amber/5'
                    : 'border-terminal-border bg-terminal-bg'
                }`}
              >
                {/* Status Indicator */}
                <div
                  className={`w-2 h-2 rounded-full mt-2 shrink-0 ${
                    isIssue
                      ? 'bg-terminal-red'
                      : isUrgent
                      ? 'bg-terminal-amber'
                      : 'bg-terminal-muted'
                  }`}
                />

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-terminal-muted">
                      {formatDate(chronicle.receivedAt)}
                    </span>
                    {chronicle.fromParty && (
                      <span className="text-xs px-2 py-0.5 rounded bg-terminal-elevated text-terminal-muted">
                        {chronicle.fromParty}
                      </span>
                    )}
                    {chronicle.documentType && (
                      <span className="text-xs px-2 py-0.5 rounded bg-terminal-blue/10 text-terminal-blue capitalize">
                        {chronicle.documentType.replace(/_/g, ' ')}
                      </span>
                    )}
                    {chronicle.hasAttachments && (
                      <span className="flex items-center gap-1 text-xs text-terminal-muted">
                        <Paperclip className="h-3 w-3" />
                        {chronicle.attachmentCount}
                      </span>
                    )}
                  </div>

                  <p className="text-sm text-terminal-text mt-1 line-clamp-2 group-hover:text-terminal-purple transition-colors">
                    {chronicle.subject}
                  </p>

                  {chronicle.summary && (
                    <p className="text-xs text-terminal-muted mt-1 line-clamp-1">
                      {chronicle.summary}
                    </p>
                  )}

                  {(chronicle.hasIssue || chronicle.issueType) && (
                    <span className="inline-flex items-center gap-1 mt-2 text-xs px-2 py-0.5 rounded bg-terminal-red/15 text-terminal-red">
                      <AlertCircle className="h-3 w-3" />
                      {chronicle.issueType || 'Issue flagged'}
                    </span>
                  )}
                </div>

                {/* Arrow */}
                <ChevronRight className="h-5 w-5 text-terminal-muted opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </Link>
            );
          })}
        </div>
      )}

      {/* Show More/Less */}
      {filteredChronicles.length > 10 && (
        <button
          onClick={onToggleExpand}
          className="mt-4 w-full py-2 text-sm font-mono text-terminal-purple hover:text-terminal-text transition-colors flex items-center justify-center gap-2"
        >
          {expanded ? (
            <>
              Show Less <ChevronDown className="h-4 w-4 rotate-180" />
            </>
          ) : (
            <>
              Show All {filteredChronicles.length} Communications{' '}
              <ChevronDown className="h-4 w-4" />
            </>
          )}
        </button>
      )}
    </div>
  );
}
