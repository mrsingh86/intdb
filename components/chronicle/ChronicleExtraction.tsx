'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Mail,
  Clock,
  CheckCircle,
  AlertCircle,
  Eye,
  Ship,
  Anchor,
  Calendar,
  Package,
  Hash,
  User,
  Building2,
  MapPin,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';

interface ExtractedField {
  field: string;
  value: string | number | boolean | null;
  confidence: number;
  source?: string;
}

interface ChronicleData {
  id: string;
  gmailMessageId: string;
  emailSubject?: string;
  emailFrom?: string;
  emailDate?: string;
  documentType?: string;
  carrier?: string;
  classification?: {
    confidence: number;
    reasoning?: string;
  };
  extractedData: ExtractedField[];
  shipmentId?: string;
  shipmentBookingNumber?: string;
  linkedBy?: string;
  linkConfidence?: number;
  actions?: Array<{
    type: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  processedAt: string;
}

interface ChronicleExtractionProps {
  chronicle: ChronicleData;
  variant?: 'full' | 'compact' | 'summary';
  showSource?: boolean;
}

/**
 * ChronicleExtraction - Displays AI-extracted data from a document/email
 *
 * Shows:
 * - Classification result with confidence
 * - Extracted fields with individual confidence scores
 * - Source email reference
 * - Linked shipment (if any)
 * - Detected actions/issues
 */
export function ChronicleExtraction({
  chronicle,
  variant = 'full',
  showSource = true,
}: ChronicleExtractionProps) {
  const [isExpanded, setIsExpanded] = useState(variant === 'full');

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 90) return { text: 'text-terminal-green', bg: 'bg-terminal-green/10', border: 'border-terminal-green/30', dot: 'bg-terminal-green' };
    if (confidence >= 75) return { text: 'text-terminal-amber', bg: 'bg-terminal-amber/10', border: 'border-terminal-amber/30', dot: 'bg-terminal-amber' };
    return { text: 'text-terminal-red', bg: 'bg-terminal-red/10', border: 'border-terminal-red/30', dot: 'bg-terminal-red' };
  };

  const overallConfidence = chronicle.classification?.confidence || 0;
  const confidenceColors = getConfidenceColor(overallConfidence);

  if (variant === 'summary') {
    return (
      <div className="flex items-center gap-3 px-3 py-2 bg-terminal-surface rounded-lg border border-terminal-border">
        <Sparkles className="h-4 w-4 text-terminal-purple flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-mono text-terminal-text">
            {chronicle.documentType?.replace(/_/g, ' ') || 'Document'}
          </span>
          {chronicle.carrier && (
            <span className="text-xs font-mono text-terminal-muted ml-2">
              ({chronicle.carrier})
            </span>
          )}
        </div>
        <ConfidenceBadge confidence={overallConfidence} size="sm" />
        <span className="text-xs font-mono text-terminal-muted">
          {chronicle.extractedData.length} fields
        </span>
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="w-full px-4 py-3 flex items-center gap-3 hover:bg-terminal-elevated transition-colors"
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-terminal-muted" />
          ) : (
            <ChevronRight className="h-4 w-4 text-terminal-muted" />
          )}
          <Sparkles className="h-4 w-4 text-terminal-purple" />
          <span className="font-medium text-terminal-text text-sm">AI Extraction</span>
          <ConfidenceBadge confidence={overallConfidence} size="sm" />
          <span className="ml-auto text-xs font-mono text-terminal-muted">
            {chronicle.extractedData.length} fields extracted
          </span>
        </button>

        {isExpanded && (
          <div className="px-4 pb-4 pt-2 border-t border-terminal-border">
            <ExtractedFieldsList fields={chronicle.extractedData} />
          </div>
        )}
      </div>
    );
  }

  // Full variant
  return (
    <div className="rounded-lg border border-terminal-purple/30 bg-terminal-surface overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 bg-terminal-purple/10 border-b border-terminal-border flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-terminal-purple" />
        <Sparkles className="h-4 w-4 text-terminal-purple" />
        <span className="font-medium text-terminal-purple text-sm">Chronicle Extraction</span>
        <ConfidenceBadge confidence={overallConfidence} />
        <span className="ml-auto text-[10px] font-mono text-terminal-muted">
          {new Date(chronicle.processedAt).toLocaleString()}
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* Source Email (if showing) */}
        {showSource && (
          <div className="flex items-start gap-3 p-3 bg-terminal-bg rounded-lg border border-terminal-border">
            <Mail className="h-4 w-4 text-terminal-blue flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-terminal-text truncate">
                {chronicle.emailSubject || 'No subject'}
              </div>
              <div className="flex items-center gap-2 text-xs font-mono text-terminal-muted mt-0.5">
                <span>{chronicle.emailFrom}</span>
                {chronicle.emailDate && (
                  <>
                    <span>•</span>
                    <span>{new Date(chronicle.emailDate).toLocaleDateString()}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Classification */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-mono text-terminal-muted">
            <FileText className="h-3.5 w-3.5" />
            Classification
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="px-3 py-1.5 bg-terminal-blue/10 text-terminal-blue border border-terminal-blue/30 rounded-lg text-sm font-mono">
              {chronicle.documentType?.replace(/_/g, ' ') || 'Unknown'}
            </span>
            {chronicle.carrier && (
              <span className="px-2 py-1 bg-terminal-elevated text-terminal-text border border-terminal-border rounded text-xs font-mono">
                {chronicle.carrier}
              </span>
            )}
            <ConfidenceBadge confidence={overallConfidence} showLabel />
          </div>
          {chronicle.classification?.reasoning && (
            <p className="text-xs text-terminal-muted mt-2 italic">
              "{chronicle.classification.reasoning}"
            </p>
          )}
        </div>

        {/* Linked Shipment */}
        {chronicle.shipmentId && (
          <div className="flex items-center gap-3 p-3 bg-terminal-green/5 rounded-lg border border-terminal-green/30">
            <Ship className="h-4 w-4 text-terminal-green" />
            <div className="flex-1">
              <div className="text-xs font-mono text-terminal-muted mb-0.5">
                Linked to Shipment
              </div>
              <Link
                href={`/shipments/${chronicle.shipmentId}`}
                className="text-sm font-mono font-medium text-terminal-green hover:underline"
              >
                {chronicle.shipmentBookingNumber || chronicle.shipmentId}
              </Link>
            </div>
            {chronicle.linkConfidence && (
              <ConfidenceBadge confidence={chronicle.linkConfidence} size="sm" />
            )}
            {chronicle.linkedBy && (
              <span className="text-[10px] font-mono text-terminal-muted">
                by {chronicle.linkedBy}
              </span>
            )}
          </div>
        )}

        {/* Extracted Fields */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs font-mono text-terminal-muted">
            <Eye className="h-3.5 w-3.5" />
            Extracted Data ({chronicle.extractedData.length} fields)
          </div>
          <ExtractedFieldsList fields={chronicle.extractedData} />
        </div>

        {/* Actions/Issues Detected */}
        {chronicle.actions && chronicle.actions.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-mono text-terminal-amber">
              <AlertTriangle className="h-3.5 w-3.5" />
              Actions Detected ({chronicle.actions.length})
            </div>
            <div className="space-y-2">
              {chronicle.actions.map((action, idx) => (
                <ActionItem key={idx} action={action} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface ExtractedFieldsListProps {
  fields: ExtractedField[];
}

function ExtractedFieldsList({ fields }: ExtractedFieldsListProps) {
  // Group fields by category
  const identifiers = fields.filter(f => ['booking_number', 'bl_number', 'container_number', 'reference_number'].includes(f.field));
  const routing = fields.filter(f => ['port_of_loading', 'port_of_discharge', 'place_of_receipt', 'place_of_delivery', 'origin_inland', 'destination_inland'].includes(f.field));
  const dates = fields.filter(f => ['etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'atd', 'ata'].includes(f.field));
  const vessel = fields.filter(f => ['vessel_name', 'voyage_number', 'carrier'].includes(f.field));
  const parties = fields.filter(f => ['shipper', 'consignee', 'notify_party', 'carrier'].includes(f.field));
  const cargo = fields.filter(f => ['commodity', 'weight', 'volume', 'container_type', 'package_count'].includes(f.field));
  const other = fields.filter(f => !identifiers.includes(f) && !routing.includes(f) && !dates.includes(f) && !vessel.includes(f) && !parties.includes(f) && !cargo.includes(f));

  return (
    <div className="space-y-3">
      {identifiers.length > 0 && (
        <FieldGroup icon={Hash} label="Identifiers" fields={identifiers} />
      )}
      {routing.length > 0 && (
        <FieldGroup icon={MapPin} label="Routing" fields={routing} />
      )}
      {dates.length > 0 && (
        <FieldGroup icon={Calendar} label="Dates" fields={dates} />
      )}
      {vessel.length > 0 && (
        <FieldGroup icon={Anchor} label="Vessel" fields={vessel} />
      )}
      {parties.length > 0 && (
        <FieldGroup icon={Building2} label="Parties" fields={parties} />
      )}
      {cargo.length > 0 && (
        <FieldGroup icon={Package} label="Cargo" fields={cargo} />
      )}
      {other.length > 0 && (
        <FieldGroup icon={FileText} label="Other" fields={other} />
      )}
    </div>
  );
}

interface FieldGroupProps {
  icon: React.ElementType;
  label: string;
  fields: ExtractedField[];
}

function FieldGroup({ icon: Icon, label, fields }: FieldGroupProps) {
  return (
    <div className="bg-terminal-bg rounded-lg p-3 border border-terminal-border">
      <div className="flex items-center gap-2 mb-2 text-xs font-mono text-terminal-muted">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {fields.map((field, idx) => (
          <FieldItem key={idx} field={field} />
        ))}
      </div>
    </div>
  );
}

interface FieldItemProps {
  field: ExtractedField;
}

function FieldItem({ field }: FieldItemProps) {
  const confidenceColors = field.confidence >= 90
    ? 'border-l-terminal-green'
    : field.confidence >= 75
      ? 'border-l-terminal-amber'
      : 'border-l-terminal-red';

  const formatValue = (value: string | number | boolean | null): string => {
    if (value === null || value === undefined) return '--';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/)) {
      return new Date(value).toLocaleDateString();
    }
    return String(value);
  };

  return (
    <div className={`pl-2 border-l-2 ${confidenceColors}`}>
      <div className="text-[10px] font-mono text-terminal-muted uppercase tracking-wide">
        {field.field.replace(/_/g, ' ')}
      </div>
      <div className="text-xs font-mono text-terminal-text font-medium truncate">
        {formatValue(field.value)}
      </div>
      <div className="text-[9px] font-mono text-terminal-muted">
        {field.confidence}% conf
      </div>
    </div>
  );
}

interface ActionItemProps {
  action: {
    type: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
  };
}

function ActionItem({ action }: ActionItemProps) {
  const priorityStyles = {
    high: 'bg-terminal-red/10 border-terminal-red/30 text-terminal-red',
    medium: 'bg-terminal-amber/10 border-terminal-amber/30 text-terminal-amber',
    low: 'bg-terminal-muted/10 border-terminal-border text-terminal-muted',
  };

  return (
    <div className={`flex items-start gap-2 p-2 rounded border ${priorityStyles[action.priority]}`}>
      <AlertCircle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-mono font-medium capitalize">
          {action.type.replace(/_/g, ' ')}
        </div>
        <div className="text-[10px] font-mono opacity-80">
          {action.description}
        </div>
      </div>
    </div>
  );
}

interface ConfidenceBadgeProps {
  confidence: number;
  size?: 'sm' | 'md';
  showLabel?: boolean;
}

function ConfidenceBadge({ confidence, size = 'md', showLabel = false }: ConfidenceBadgeProps) {
  const colors = confidence >= 90
    ? 'bg-terminal-green/10 text-terminal-green border-terminal-green/30'
    : confidence >= 75
      ? 'bg-terminal-amber/10 text-terminal-amber border-terminal-amber/30'
      : 'bg-terminal-red/10 text-terminal-red border-terminal-red/30';

  const icon = confidence >= 90
    ? <CheckCircle className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
    : confidence >= 75
      ? <AlertCircle className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      : <AlertTriangle className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} />;

  const sizeClasses = size === 'sm'
    ? 'px-1.5 py-0.5 text-[10px]'
    : 'px-2 py-1 text-xs';

  return (
    <span className={`inline-flex items-center gap-1 font-mono border rounded ${colors} ${sizeClasses}`}>
      {icon}
      {showLabel && <span>Confidence:</span>}
      <span className="font-bold">{confidence}%</span>
    </span>
  );
}

export default ChronicleExtraction;
