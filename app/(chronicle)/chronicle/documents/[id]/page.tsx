'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  FileText,
  Mail,
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
  Clock,
  Ship,
  Anchor,
  Package,
  Truck,
  User,
  Building2,
  MapPin,
  Calendar,
  Container,
  DollarSign,
  Paperclip,
  ExternalLink,
  Brain,
  Sparkles,
  ChevronRight,
  Eye,
  Download,
  Link2,
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

interface ChronicleData {
  chronicle: {
    id: string;
    messageId: string;
    threadId: string;
    subject: string;
    sender: {
      email: string;
      name?: string;
    };
    receivedAt: string;
    documentType: string;
    documentSubtype?: string;
    carrier?: string;
    classification: {
      type: string;
      subtype?: string;
      confidence: number;
      reasoning?: string;
    };
    extraction: {
      data: Record<string, unknown>;
      confidence?: number;
      fields: Array<{
        key: string;
        label: string;
        value: string | number | null;
        category: string;
        confidence?: number;
      }>;
    };
    processing: {
      status: string;
      error?: string;
    };
    content: {
      bodyText?: string;
      bodyHtml?: string;
      hasAttachments: boolean;
      attachmentCount: number;
    };
    createdAt: string;
    updatedAt: string;
  };
  linkedShipment: {
    id: string;
    bookingNumber: string;
    blNumber?: string;
    phase: string;
    vessel?: string;
  } | null;
  attachments: Array<{
    id: string;
    filename: string;
    mimeType: string;
    size: number;
    storagePath?: string;
    hasOcr: boolean;
    ocrText?: string;
    extractedData?: Record<string, unknown>;
    extractionConfidence?: number;
  }>;
  relatedDocuments: Array<{
    id: string;
    subject: string;
    documentType: string;
    receivedAt: string;
    confidence: number;
  }>;
}

// ============================================================================
// CHRONICLE EVIDENCE PAGE
// ============================================================================

export default function ChronicleEvidencePage() {
  const params = useParams();
  const router = useRouter();
  const documentId = params.id as string;

  const [data, setData] = useState<ChronicleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'extraction' | 'content' | 'attachments'>('extraction');

  useEffect(() => {
    async function fetchDocument() {
      setLoading(true);
      try {
        const response = await fetch(`/api/chronicle/documents/${documentId}`);
        if (!response.ok) {
          if (response.status === 404) {
            setError('Document not found');
          } else {
            setError('Failed to load document');
          }
          return;
        }
        const result = await response.json();
        setData(result);
      } catch (err) {
        setError('Failed to load document');
      } finally {
        setLoading(false);
      }
    }

    if (documentId) {
      fetchDocument();
    }
  }, [documentId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-20">
        <RefreshCw className="h-6 w-6 animate-spin text-terminal-muted" />
        <span className="ml-3 font-mono text-terminal-muted">Loading chronicle evidence...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-20">
        <AlertTriangle className="h-10 w-10 text-terminal-amber mb-4" />
        <p className="font-mono text-terminal-muted">{error || 'Document not found'}</p>
        <button
          onClick={() => router.back()}
          className="mt-4 text-sm font-mono text-terminal-blue hover:text-terminal-purple transition-colors"
        >
          ← Go Back
        </button>
      </div>
    );
  }

  const { chronicle, linkedShipment, attachments, relatedDocuments } = data;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <button
              onClick={() => router.back()}
              className="p-1 text-terminal-muted hover:text-terminal-text transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <DocumentTypeIcon type={chronicle.documentType} />
            <h1 className="text-lg font-semibold text-terminal-text truncate max-w-xl">{chronicle.subject}</h1>
          </div>
          <p className="text-xs font-mono text-terminal-muted ml-9 flex items-center gap-2">
            <Mail className="h-3.5 w-3.5" />
            {chronicle.sender.name || chronicle.sender.email}
            <span className="text-terminal-border">•</span>
            <Clock className="h-3.5 w-3.5" />
            {formatDateTime(chronicle.receivedAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DocumentTypeBadge type={chronicle.documentType} />
          <ConfidenceBadge confidence={chronicle.classification.confidence} large />
        </div>
      </div>

      {/* Linked Shipment Banner */}
      {linkedShipment && (
        <Link
          href={`/chronicle/shipments/${linkedShipment.id}`}
          className="flex items-center justify-between p-3 bg-terminal-purple/5 border border-terminal-purple/20 rounded-lg hover:border-terminal-purple/40 transition-colors"
        >
          <div className="flex items-center gap-3">
            <Link2 className="h-4 w-4 text-terminal-purple" />
            <span className="text-sm font-mono text-terminal-text">Linked to Shipment</span>
            <span className="font-mono font-medium text-terminal-purple">{linkedShipment.bookingNumber}</span>
            {linkedShipment.blNumber && (
              <span className="text-xs font-mono text-terminal-muted">BL: {linkedShipment.blNumber}</span>
            )}
          </div>
          <ChevronRight className="h-4 w-4 text-terminal-muted" />
        </Link>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-terminal-border">
        <TabButton
          active={activeTab === 'extraction'}
          onClick={() => setActiveTab('extraction')}
          icon={<Sparkles className="h-4 w-4" />}
          label="AI Extraction"
          count={chronicle.extraction.fields.length}
        />
        <TabButton
          active={activeTab === 'content'}
          onClick={() => setActiveTab('content')}
          icon={<Eye className="h-4 w-4" />}
          label="Email Content"
        />
        <TabButton
          active={activeTab === 'attachments'}
          onClick={() => setActiveTab('attachments')}
          icon={<Paperclip className="h-4 w-4" />}
          label="Attachments"
          count={attachments.length}
        />
      </div>

      {/* Tab Content */}
      <div className="grid grid-cols-3 gap-6">
        {/* Main Content - 2 columns */}
        <div className="col-span-2">
          {activeTab === 'extraction' && (
            <ExtractionView chronicle={chronicle} />
          )}
          {activeTab === 'content' && (
            <ContentView chronicle={chronicle} />
          )}
          {activeTab === 'attachments' && (
            <AttachmentsView attachments={attachments} messageId={chronicle.messageId} />
          )}
        </div>

        {/* Sidebar - 1 column */}
        <div className="space-y-4">
          {/* Classification Details */}
          <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4">
            <h3 className="text-xs font-mono text-terminal-muted uppercase tracking-wide mb-3 flex items-center gap-2">
              <Brain className="h-4 w-4" />
              AI Classification
            </h3>
            <div className="space-y-3">
              <div>
                <span className="text-[10px] font-mono text-terminal-muted block mb-1">Document Type</span>
                <span className="text-sm font-mono text-terminal-text capitalize">
                  {chronicle.documentType?.replace(/_/g, ' ') || 'Unknown'}
                </span>
              </div>
              {chronicle.documentSubtype && (
                <div>
                  <span className="text-[10px] font-mono text-terminal-muted block mb-1">Subtype</span>
                  <span className="text-sm font-mono text-terminal-text capitalize">
                    {chronicle.documentSubtype.replace(/_/g, ' ')}
                  </span>
                </div>
              )}
              <div>
                <span className="text-[10px] font-mono text-terminal-muted block mb-1">Confidence</span>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-terminal-bg rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${getConfidenceColor(chronicle.classification.confidence)}`}
                      style={{ width: `${chronicle.classification.confidence}%` }}
                    />
                  </div>
                  <span className="text-sm font-mono text-terminal-text">{chronicle.classification.confidence}%</span>
                </div>
              </div>
              {chronicle.classification.reasoning && (
                <div>
                  <span className="text-[10px] font-mono text-terminal-muted block mb-1">Reasoning</span>
                  <p className="text-xs font-mono text-terminal-muted leading-relaxed">
                    {chronicle.classification.reasoning}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Processing Status */}
          <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4">
            <h3 className="text-xs font-mono text-terminal-muted uppercase tracking-wide mb-3">Processing</h3>
            <div className="flex items-center gap-2">
              {chronicle.processing.status === 'processed' ? (
                <>
                  <CheckCircle className="h-4 w-4 text-terminal-green" />
                  <span className="text-sm font-mono text-terminal-green">Processed</span>
                </>
              ) : chronicle.processing.status === 'failed' ? (
                <>
                  <AlertTriangle className="h-4 w-4 text-terminal-red" />
                  <span className="text-sm font-mono text-terminal-red">Failed</span>
                </>
              ) : (
                <>
                  <Clock className="h-4 w-4 text-terminal-amber" />
                  <span className="text-sm font-mono text-terminal-amber capitalize">{chronicle.processing.status}</span>
                </>
              )}
            </div>
            {chronicle.processing.error && (
              <p className="mt-2 text-xs font-mono text-terminal-red bg-terminal-red/10 p-2 rounded">
                {chronicle.processing.error}
              </p>
            )}
          </div>

          {/* Related Documents */}
          {relatedDocuments.length > 0 && (
            <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4">
              <h3 className="text-xs font-mono text-terminal-muted uppercase tracking-wide mb-3">Thread Documents</h3>
              <div className="space-y-2">
                {relatedDocuments.map(doc => (
                  <Link
                    key={doc.id}
                    href={`/chronicle/documents/${doc.id}`}
                    className="flex items-center justify-between p-2 bg-terminal-bg border border-terminal-border rounded hover:border-terminal-purple/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <DocumentTypeIcon type={doc.documentType} small />
                      <span className="text-xs font-mono text-terminal-text truncate">{doc.subject}</span>
                    </div>
                    <span className="text-[10px] font-mono text-terminal-muted">{formatShortDate(doc.receivedAt)}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Carrier */}
          {chronicle.carrier && (
            <div className="bg-terminal-surface border border-terminal-border rounded-lg p-4">
              <h3 className="text-xs font-mono text-terminal-muted uppercase tracking-wide mb-2">Carrier</h3>
              <span className="text-sm font-mono text-terminal-text capitalize">{chronicle.carrier}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TAB VIEWS
// ============================================================================

function ExtractionView({ chronicle }: { chronicle: ChronicleData['chronicle'] }) {
  const categoryGroups = groupFieldsByCategory(chronicle.extraction.fields);
  const categoryConfig: Record<string, { icon: React.ElementType; label: string; color: string }> = {
    identifier: { icon: FileText, label: 'Identifiers', color: 'text-terminal-blue' },
    party: { icon: User, label: 'Parties', color: 'text-terminal-purple' },
    location: { icon: MapPin, label: 'Locations', color: 'text-terminal-green' },
    date: { icon: Calendar, label: 'Dates', color: 'text-terminal-amber' },
    cargo: { icon: Container, label: 'Cargo', color: 'text-terminal-cyan' },
    financial: { icon: DollarSign, label: 'Financial', color: 'text-terminal-red' },
    other: { icon: Package, label: 'Other', color: 'text-terminal-muted' },
  };

  if (chronicle.extraction.fields.length === 0) {
    return (
      <div className="bg-terminal-surface border border-terminal-border rounded-lg p-8 text-center">
        <Sparkles className="h-10 w-10 text-terminal-muted mx-auto mb-4" />
        <p className="font-mono text-terminal-muted">No data extracted from this document</p>
        <p className="text-xs font-mono text-terminal-muted mt-2">
          The AI could not extract structured data from the email content
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Extraction Summary */}
      <div className="bg-terminal-purple/5 border border-terminal-purple/20 rounded-lg p-4">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-4 w-4 text-terminal-purple" />
          <span className="text-sm font-mono text-terminal-text">AI Extraction Results</span>
        </div>
        <p className="text-xs font-mono text-terminal-muted">
          {chronicle.extraction.fields.length} fields extracted with{' '}
          {chronicle.extraction.confidence ? `${chronicle.extraction.confidence}% confidence` : 'high confidence'}
        </p>
      </div>

      {/* Grouped Fields */}
      {Object.entries(categoryGroups).map(([category, fields]) => {
        const config = categoryConfig[category] || categoryConfig.other;
        const Icon = config.icon;

        return (
          <div key={category} className="bg-terminal-surface border border-terminal-border rounded-lg">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-terminal-border">
              <Icon className={`h-4 w-4 ${config.color}`} />
              <span className="text-xs font-mono text-terminal-muted uppercase tracking-wide">{config.label}</span>
              <span className="text-[10px] font-mono text-terminal-muted">({fields.length})</span>
            </div>
            <div className="p-4 grid grid-cols-2 gap-4">
              {fields.map(field => (
                <ExtractedField key={field.key} field={field} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ContentView({ chronicle }: { chronicle: ChronicleData['chronicle'] }) {
  const [viewMode, setViewMode] = useState<'text' | 'html'>('text');

  return (
    <div className="bg-terminal-surface border border-terminal-border rounded-lg">
      {/* Toggle */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-terminal-border">
        <button
          onClick={() => setViewMode('text')}
          className={`px-2 py-1 text-xs font-mono rounded ${
            viewMode === 'text'
              ? 'bg-terminal-purple/10 text-terminal-purple'
              : 'text-terminal-muted hover:text-terminal-text'
          }`}
        >
          Plain Text
        </button>
        {chronicle.content.bodyHtml && (
          <button
            onClick={() => setViewMode('html')}
            className={`px-2 py-1 text-xs font-mono rounded ${
              viewMode === 'html'
                ? 'bg-terminal-purple/10 text-terminal-purple'
                : 'text-terminal-muted hover:text-terminal-text'
            }`}
          >
            HTML Preview
          </button>
        )}
      </div>

      {/* Content */}
      <div className="p-4 max-h-[600px] overflow-y-auto">
        {viewMode === 'text' ? (
          <pre className="text-xs font-mono text-terminal-text whitespace-pre-wrap leading-relaxed">
            {chronicle.content.bodyText || 'No text content available'}
          </pre>
        ) : (
          <div
            className="prose prose-invert prose-sm max-w-none"
            dangerouslySetInnerHTML={{ __html: chronicle.content.bodyHtml || '' }}
          />
        )}
      </div>
    </div>
  );
}

function AttachmentsView({ attachments, messageId }: { attachments: ChronicleData['attachments']; messageId: string }) {
  const handleDownload = (attachmentId: string, filename: string) => {
    const url = `/api/chronicle-v2/attachments/${messageId}/${attachmentId}?filename=${encodeURIComponent(filename)}`;
    window.open(url, '_blank');
  };

  if (attachments.length === 0) {
    return (
      <div className="bg-terminal-surface border border-terminal-border rounded-lg p-8 text-center">
        <Paperclip className="h-10 w-10 text-terminal-muted mx-auto mb-4" />
        <p className="font-mono text-terminal-muted">No attachments</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {attachments.map(attachment => (
        <div key={attachment.id} className="bg-terminal-surface border border-terminal-border rounded-lg">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-terminal-border">
            <div className="flex items-center gap-3">
              <FileTypeIcon mimeType={attachment.mimeType} />
              <div>
                <span className="text-sm font-mono text-terminal-text">{attachment.filename}</span>
                <span className="text-xs font-mono text-terminal-muted ml-2">
                  ({formatFileSize(attachment.size)})
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {attachment.hasOcr && (
                <span className="px-2 py-0.5 text-[10px] font-mono bg-terminal-green/10 text-terminal-green border border-terminal-green/30 rounded">
                  OCR
                </span>
              )}
              <button
                onClick={() => handleDownload(attachment.id, attachment.filename)}
                className="p-1.5 text-terminal-muted hover:text-terminal-text transition-colors"
                title="Download"
              >
                <Download className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Extracted Data */}
          {attachment.extractedData && Object.keys(attachment.extractedData).length > 0 && (
            <div className="p-4 border-b border-terminal-border">
              <h4 className="text-[10px] font-mono text-terminal-muted uppercase tracking-wide mb-2">
                Extracted from PDF
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(attachment.extractedData).slice(0, 6).map(([key, value]) => (
                  <div key={key} className="bg-terminal-bg p-2 rounded border border-terminal-border">
                    <span className="text-[10px] font-mono text-terminal-muted block">
                      {key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
                    </span>
                    <span className="text-xs font-mono text-terminal-text">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* OCR Preview */}
          {attachment.hasOcr && attachment.ocrText && (
            <div className="p-4">
              <h4 className="text-[10px] font-mono text-terminal-muted uppercase tracking-wide mb-2">OCR Text</h4>
              <pre className="text-xs font-mono text-terminal-muted bg-terminal-bg p-3 rounded border border-terminal-border max-h-40 overflow-y-auto whitespace-pre-wrap">
                {attachment.ocrText.slice(0, 500)}
                {attachment.ocrText.length > 500 && '...'}
              </pre>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 text-sm font-mono transition-colors ${
        active
          ? 'text-terminal-purple border-b-2 border-terminal-purple -mb-px'
          : 'text-terminal-muted hover:text-terminal-text'
      }`}
    >
      {icon}
      {label}
      {count !== undefined && (
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${active ? 'bg-terminal-purple/10' : 'bg-terminal-bg'}`}>
          {count}
        </span>
      )}
    </button>
  );
}

function DocumentTypeIcon({ type, small }: { type: string; small?: boolean }) {
  const iconClass = small ? 'h-3.5 w-3.5' : 'h-5 w-5';
  const typeColors: Record<string, string> = {
    booking_confirmation: 'text-terminal-blue',
    shipping_instructions: 'text-terminal-purple',
    draft_bl: 'text-terminal-amber',
    final_bl: 'text-terminal-green',
    arrival_notice: 'text-terminal-cyan',
    invoice: 'text-terminal-red',
    amendment: 'text-terminal-amber',
  };

  return <FileText className={`${iconClass} ${typeColors[type] || 'text-terminal-muted'}`} />;
}

function DocumentTypeBadge({ type }: { type: string }) {
  const typeColors: Record<string, string> = {
    booking_confirmation: 'bg-terminal-blue/10 text-terminal-blue border-terminal-blue/30',
    shipping_instructions: 'bg-terminal-purple/10 text-terminal-purple border-terminal-purple/30',
    draft_bl: 'bg-terminal-amber/10 text-terminal-amber border-terminal-amber/30',
    final_bl: 'bg-terminal-green/10 text-terminal-green border-terminal-green/30',
    arrival_notice: 'bg-terminal-cyan/10 text-terminal-cyan border-terminal-cyan/30',
    invoice: 'bg-terminal-red/10 text-terminal-red border-terminal-red/30',
  };

  return (
    <span className={`px-2 py-1 text-xs font-mono border rounded capitalize ${typeColors[type] || 'bg-terminal-muted/10 text-terminal-muted border-terminal-border'}`}>
      {type?.replace(/_/g, ' ') || 'Unknown'}
    </span>
  );
}

function ConfidenceBadge({ confidence, large }: { confidence: number; large?: boolean }) {
  const color = confidence >= 90
    ? 'text-terminal-green bg-terminal-green/10 border-terminal-green/30'
    : confidence >= 70
      ? 'text-terminal-amber bg-terminal-amber/10 border-terminal-amber/30'
      : 'text-terminal-red bg-terminal-red/10 border-terminal-red/30';

  return (
    <span className={`font-mono border rounded ${color} ${large ? 'px-2 py-1 text-xs' : 'px-1.5 py-0.5 text-[10px]'}`}>
      {confidence}%
    </span>
  );
}

function ExtractedField({ field }: { field: ChronicleData['chronicle']['extraction']['fields'][0] }) {
  return (
    <div className="bg-terminal-bg p-3 rounded border border-terminal-border">
      <span className="text-[10px] font-mono text-terminal-muted block mb-1">{field.label}</span>
      <span className="text-sm font-mono text-terminal-text break-words">{String(field.value)}</span>
    </div>
  );
}

function FileTypeIcon({ mimeType }: { mimeType: string }) {
  const isPdf = mimeType.includes('pdf');
  const isImage = mimeType.includes('image');
  const isExcel = mimeType.includes('excel') || mimeType.includes('spreadsheet');

  const bgColor = isPdf
    ? 'bg-terminal-red/10 border-terminal-red/30'
    : isImage
      ? 'bg-terminal-blue/10 border-terminal-blue/30'
      : isExcel
        ? 'bg-terminal-green/10 border-terminal-green/30'
        : 'bg-terminal-muted/10 border-terminal-border';

  const textColor = isPdf
    ? 'text-terminal-red'
    : isImage
      ? 'text-terminal-blue'
      : isExcel
        ? 'text-terminal-green'
        : 'text-terminal-muted';

  return (
    <div className={`p-2 rounded border ${bgColor}`}>
      <FileText className={`h-4 w-4 ${textColor}`} />
    </div>
  );
}

// ============================================================================
// UTILITIES
// ============================================================================

function formatDateTime(dateStr?: string): string {
  if (!dateStr) return '--';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatShortDate(dateStr?: string): string {
  if (!dateStr) return '--';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 90) return 'bg-terminal-green';
  if (confidence >= 70) return 'bg-terminal-amber';
  return 'bg-terminal-red';
}

function groupFieldsByCategory(
  fields: ChronicleData['chronicle']['extraction']['fields']
): Record<string, typeof fields> {
  return fields.reduce((acc, field) => {
    const category = field.category || 'other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(field);
    return acc;
  }, {} as Record<string, typeof fields>);
}
