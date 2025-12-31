'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Mail,
  Calendar,
  User,
  FileText,
  Paperclip,
  Ship,
  Tag,
  Clock,
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Download,
  Loader2,
  ChevronDown,
  ChevronUp,
  Database,
} from 'lucide-react';
import { DocumentTypeBadge } from '@/components/ui/document-type-badge';
import { DocumentType } from '@/types/email-intelligence';

interface EmailData {
  id: string;
  gmail_message_id: string;
  subject: string;
  sender_email: string;
  true_sender_email?: string;
  body_text: string;
  snippet?: string;
  received_at: string;
  has_attachments: boolean;
  thread_id?: string;
}

interface Classification {
  document_type?: string;
  document_direction?: string;
  sender_party_type?: string;
  receiver_party_type?: string;
  confidence_score?: number;
  workflow_state?: string;
  revision_type?: string;
  revision_number?: number;
}

interface Entity {
  entity_type: string;
  entity_value: string;
  confidence_score: number;
}

interface Attachment {
  id: string;
  filename: string;
  mime_type: string;
  file_size: number;
  extracted_text?: string | null;
  extraction_status?: string | null;
}

interface LinkedShipment {
  id: string;
  booking_number: string;
  bl_number?: string;
  status: string;
}

// Format entity type for display
const formatEntityType = (type: string) => {
  const formatMap: Record<string, string> = {
    booking_number: 'Booking Number',
    bl_number: 'BL Number',
    container_number: 'Container Number',
    vessel_name: 'Vessel',
    voyage_number: 'Voyage',
    port_of_loading: 'Port of Loading',
    port_of_discharge: 'Port of Discharge',
    eta: 'ETA',
    etd: 'ETD',
    shipper_name: 'Shipper',
    consignee_name: 'Consignee',
    carrier_name: 'Carrier',
    commodity: 'Commodity',
    weight: 'Weight',
    volume: 'Volume',
    free_days: 'Free Days',
    pickup_location: 'Pickup Location',
    delivery_location: 'Delivery Location',
  };
  return formatMap[type] || type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
};

// Get icon color based on entity type
const getEntityColor = (type: string): string => {
  if (['booking_number', 'bl_number'].includes(type)) return 'text-terminal-blue';
  if (['container_number'].includes(type)) return 'text-terminal-purple';
  if (['vessel_name', 'voyage_number'].includes(type)) return 'text-terminal-amber';
  if (['eta', 'etd'].includes(type)) return 'text-terminal-green';
  if (['port_of_loading', 'port_of_discharge'].includes(type)) return 'text-terminal-blue';
  return 'text-terminal-muted';
};

export default function DocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const emailId = params.emailId as string;

  const [email, setEmail] = useState<EmailData | null>(null);
  const [classification, setClassification] = useState<Classification | null>(null);
  const [entities, setEntities] = useState<Entity[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [linkedShipment, setLinkedShipment] = useState<LinkedShipment | null>(null);
  const [documentType, setDocumentType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showEmail, setShowEmail] = useState(false);

  useEffect(() => {
    fetchEmailDetails();
  }, [emailId]);

  const fetchEmailDetails = async () => {
    try {
      // Fetch email details and attachments in parallel
      const [emailResponse, attachmentsResponse] = await Promise.all([
        fetch(`/api/emails/${emailId}`),
        fetch(`/api/emails/${emailId}/attachments`),
      ]);

      if (!emailResponse.ok) {
        throw new Error('Document not found');
      }
      const data = await emailResponse.json();
      setEmail(data.email);
      setClassification(data.classification);
      setEntities(data.entities || []);
      setLinkedShipment(data.linkedShipment);

      // Set attachments from dedicated endpoint (has extracted text)
      if (attachmentsResponse.ok) {
        const attachmentsData = await attachmentsResponse.json();
        setAttachments(attachmentsData.attachments || []);
      }
      setDocumentType(data.classification?.document_type || data.documentType);
    } catch (err) {
      setError('Failed to load document details');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const getConfidenceColor = (score?: number) => {
    if (!score) return 'text-terminal-muted';
    if (score >= 85) return 'text-terminal-green';
    if (score >= 60) return 'text-terminal-amber';
    return 'text-terminal-red';
  };

  const getDocumentTitle = () => {
    if (!documentType) return 'Document Details';
    return documentType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  // Group entities by category
  const groupedEntities = entities.reduce((acc, entity) => {
    const category = ['booking_number', 'bl_number', 'container_number'].includes(entity.entity_type)
      ? 'identifiers'
      : ['vessel_name', 'voyage_number', 'eta', 'etd'].includes(entity.entity_type)
        ? 'voyage'
        : ['port_of_loading', 'port_of_discharge', 'pickup_location', 'delivery_location'].includes(entity.entity_type)
          ? 'locations'
          : 'other';
    if (!acc[category]) acc[category] = [];
    acc[category].push(entity);
    return acc;
  }, {} as Record<string, Entity[]>);

  if (loading) {
    return (
      <div className="min-h-screen bg-terminal-bg flex items-center justify-center">
        <div className="flex items-center gap-3 text-terminal-muted">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="font-mono text-sm">Loading document...</span>
        </div>
      </div>
    );
  }

  if (error || !email) {
    return (
      <div className="min-h-screen bg-terminal-bg p-8">
        <div className="max-w-4xl mx-auto">
          <div className="bg-terminal-surface rounded-lg border border-terminal-red/50 p-8 text-center">
            <AlertCircle className="h-12 w-12 text-terminal-red mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-terminal-text mb-2">Document Not Found</h2>
            <p className="text-terminal-muted mb-4 font-mono text-sm">{error || 'The requested document could not be found.'}</p>
            <button
              onClick={() => router.back()}
              className="px-4 py-2 bg-terminal-blue/20 text-terminal-blue border border-terminal-blue/30 rounded-lg hover:bg-terminal-blue/30 font-mono text-sm transition-colors"
            >
              [go back]
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-terminal-bg p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.back()}
            className="text-terminal-blue hover:text-terminal-green mb-4 inline-flex items-center gap-2 font-mono text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            [back]
          </button>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-terminal-text flex items-center gap-3">
                <span className="h-2 w-2 rounded-full bg-terminal-green"></span>
                {getDocumentTitle()}
                <span className="text-xs font-mono text-terminal-muted">~/orion/documents/{emailId.slice(0, 8)}</span>
              </h1>
              <p className="text-terminal-muted font-mono text-sm mt-1">{email.subject}</p>
            </div>
            {documentType && (
              <DocumentTypeBadge type={documentType as DocumentType} size="md" />
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="col-span-2 space-y-6">
            {/* Extracted Document Fields - PRIMARY */}
            <div className="bg-terminal-surface rounded-lg border border-terminal-green/30 overflow-hidden">
              <div className="px-4 py-3 bg-terminal-green/10 border-b border-terminal-green/30 flex items-center gap-2">
                <Database className="h-4 w-4 text-terminal-green" />
                <span className="font-medium text-terminal-green text-sm">Extracted Document Fields</span>
                <span className="text-xs font-mono text-terminal-muted">[{entities.length} fields]</span>
              </div>
              <div className="p-4">
                {entities.length > 0 ? (
                  <div className="space-y-4">
                    {/* Identifiers Section */}
                    {groupedEntities.identifiers && groupedEntities.identifiers.length > 0 && (
                      <div>
                        <h3 className="text-xs font-mono text-terminal-muted uppercase mb-2">Reference Numbers</h3>
                        <div className="grid grid-cols-2 gap-3">
                          {groupedEntities.identifiers.map((entity, idx) => (
                            <div
                              key={idx}
                              className="p-3 bg-terminal-elevated rounded-lg border border-terminal-border"
                            >
                              <div className="text-xs text-terminal-muted uppercase font-mono mb-1">
                                {formatEntityType(entity.entity_type)}
                              </div>
                              <div className={`text-lg font-semibold font-mono ${getEntityColor(entity.entity_type)}`}>
                                {entity.entity_value}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Voyage Section */}
                    {groupedEntities.voyage && groupedEntities.voyage.length > 0 && (
                      <div>
                        <h3 className="text-xs font-mono text-terminal-muted uppercase mb-2">Voyage Information</h3>
                        <div className="grid grid-cols-2 gap-3">
                          {groupedEntities.voyage.map((entity, idx) => (
                            <div
                              key={idx}
                              className="p-3 bg-terminal-elevated rounded-lg border border-terminal-border"
                            >
                              <div className="text-xs text-terminal-muted uppercase font-mono mb-1">
                                {formatEntityType(entity.entity_type)}
                              </div>
                              <div className={`text-base font-medium font-mono ${getEntityColor(entity.entity_type)}`}>
                                {entity.entity_value}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Locations Section */}
                    {groupedEntities.locations && groupedEntities.locations.length > 0 && (
                      <div>
                        <h3 className="text-xs font-mono text-terminal-muted uppercase mb-2">Locations</h3>
                        <div className="grid grid-cols-2 gap-3">
                          {groupedEntities.locations.map((entity, idx) => (
                            <div
                              key={idx}
                              className="p-3 bg-terminal-elevated rounded-lg border border-terminal-border"
                            >
                              <div className="text-xs text-terminal-muted uppercase font-mono mb-1">
                                {formatEntityType(entity.entity_type)}
                              </div>
                              <div className="text-base font-medium font-mono text-terminal-text">
                                {entity.entity_value}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Other Fields */}
                    {groupedEntities.other && groupedEntities.other.length > 0 && (
                      <div>
                        <h3 className="text-xs font-mono text-terminal-muted uppercase mb-2">Additional Fields</h3>
                        <div className="grid grid-cols-2 gap-3">
                          {groupedEntities.other.map((entity, idx) => (
                            <div
                              key={idx}
                              className="p-3 bg-terminal-elevated rounded-lg border border-terminal-border"
                            >
                              <div className="text-xs text-terminal-muted uppercase font-mono mb-1">
                                {formatEntityType(entity.entity_type)}
                              </div>
                              <div className="text-base font-medium font-mono text-terminal-text">
                                {entity.entity_value}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <AlertCircle className="h-8 w-8 text-terminal-amber mx-auto mb-2" />
                    <p className="text-terminal-muted font-mono text-sm">No extracted fields available</p>
                    <p className="text-terminal-muted font-mono text-xs mt-1">Check the email content below</p>
                  </div>
                )}
              </div>
            </div>

            {/* Attachments / PDF Content */}
            {attachments.length > 0 && (
              <div className="bg-terminal-surface rounded-lg border border-terminal-border overflow-hidden">
                <div className="px-4 py-3 bg-terminal-elevated border-b border-terminal-border flex items-center gap-2">
                  <Paperclip className="h-4 w-4 text-terminal-amber" />
                  <span className="font-medium text-terminal-text text-sm">Attachments</span>
                  <span className="text-xs font-mono text-terminal-muted">[{attachments.length}]</span>
                </div>
                <div className="p-4 space-y-4">
                  {attachments.map((attachment) => (
                    <div
                      key={attachment.id}
                      className="bg-terminal-elevated rounded-lg border border-terminal-border overflow-hidden"
                    >
                      {/* Attachment Header */}
                      <div className="flex items-center justify-between p-3 border-b border-terminal-border">
                        <div className="flex items-center gap-3">
                          <FileText className="h-5 w-5 text-terminal-blue" />
                          <div>
                            <div className="text-sm font-medium text-terminal-text font-mono">
                              {attachment.filename}
                            </div>
                            <div className="text-xs text-terminal-muted font-mono flex items-center gap-2">
                              <span>{attachment.mime_type}</span>
                              <span>-</span>
                              <span>{formatFileSize(attachment.file_size)}</span>
                              {attachment.extraction_status && (
                                <>
                                  <span>-</span>
                                  <span className={attachment.extraction_status === 'completed' ? 'text-terminal-green' : 'text-terminal-amber'}>
                                    {attachment.extraction_status}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                        <a
                          href={`/api/emails/${emailId}/attachments?id=${attachment.id}&download=true`}
                          className="p-2 text-terminal-blue hover:text-terminal-green transition-colors"
                          title="Download attachment"
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      </div>

                      {/* Extracted Text */}
                      {attachment.extracted_text && (
                        <div className="p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <CheckCircle2 className="h-4 w-4 text-terminal-green" />
                            <span className="text-xs font-mono text-terminal-green uppercase">
                              Extracted PDF Content
                            </span>
                          </div>
                          <pre className="text-terminal-text font-mono text-xs whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto bg-terminal-bg p-3 rounded border border-terminal-border">
                            {attachment.extracted_text}
                          </pre>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Email Content - Collapsible */}
            <div className="bg-terminal-surface rounded-lg border border-terminal-border overflow-hidden">
              <button
                onClick={() => setShowEmail(!showEmail)}
                className="w-full px-4 py-3 bg-terminal-elevated border-b border-terminal-border flex items-center justify-between hover:bg-terminal-surface transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-terminal-blue" />
                  <span className="font-medium text-terminal-text text-sm">Source Email</span>
                </div>
                {showEmail ? (
                  <ChevronUp className="h-4 w-4 text-terminal-muted" />
                ) : (
                  <ChevronDown className="h-4 w-4 text-terminal-muted" />
                )}
              </button>
              {showEmail && (
                <div className="p-4 space-y-4">
                  {/* Subject */}
                  <div>
                    <h2 className="text-lg font-semibold text-terminal-text">{email.subject}</h2>
                  </div>

                  {/* Sender & Date */}
                  <div className="flex flex-wrap gap-4 text-sm">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-terminal-muted" />
                      <span className="text-terminal-muted">From:</span>
                      <span className="text-terminal-text font-mono">
                        {email.true_sender_email || email.sender_email}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-terminal-muted" />
                      <span className="text-terminal-muted">Received:</span>
                      <span className="text-terminal-text font-mono">{formatDate(email.received_at)}</span>
                    </div>
                  </div>

                  {/* Body */}
                  <div className="mt-4 pt-4 border-t border-terminal-border">
                    <pre className="text-terminal-text font-mono text-sm whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
                      {email.body_text}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Linked Shipment */}
            {linkedShipment && (
              <div className="bg-terminal-surface rounded-lg border border-terminal-border overflow-hidden">
                <div className="px-4 py-3 bg-terminal-elevated border-b border-terminal-border flex items-center gap-2">
                  <Ship className="h-4 w-4 text-terminal-green" />
                  <span className="font-medium text-terminal-text text-sm">Linked Shipment</span>
                </div>
                <div className="p-4">
                  <Link
                    href={`/shipments/${linkedShipment.id}`}
                    className="block p-3 bg-terminal-elevated rounded-lg border border-terminal-border hover:border-terminal-green/50 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono text-terminal-blue font-medium">
                        {linkedShipment.booking_number || linkedShipment.bl_number}
                      </span>
                      <ExternalLink className="h-4 w-4 text-terminal-muted" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-terminal-green"></span>
                      <span className="text-xs font-mono text-terminal-muted uppercase">
                        {linkedShipment.status}
                      </span>
                    </div>
                  </Link>
                </div>
              </div>
            )}

            {/* Classification */}
            {classification && (
              <div className="bg-terminal-surface rounded-lg border border-terminal-border overflow-hidden">
                <div className="px-4 py-3 bg-terminal-elevated border-b border-terminal-border flex items-center gap-2">
                  <Tag className="h-4 w-4 text-terminal-purple" />
                  <span className="font-medium text-terminal-text text-sm">Classification</span>
                </div>
                <div className="p-4 space-y-3">
                  {classification.confidence_score && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-terminal-muted">Confidence</span>
                      <span className={`font-mono text-sm font-medium ${getConfidenceColor(classification.confidence_score)}`}>
                        {classification.confidence_score}%
                      </span>
                    </div>
                  )}
                  {classification.document_direction && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-terminal-muted">Direction</span>
                      <span className="font-mono text-sm text-terminal-text">
                        {classification.document_direction}
                      </span>
                    </div>
                  )}
                  {classification.sender_party_type && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-terminal-muted">Sender Type</span>
                      <span className="font-mono text-sm text-terminal-text">
                        {classification.sender_party_type}
                      </span>
                    </div>
                  )}
                  {classification.workflow_state && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-terminal-muted">Workflow</span>
                      <span className="font-mono text-sm text-terminal-blue">
                        {classification.workflow_state.replace(/_/g, ' ')}
                      </span>
                    </div>
                  )}
                  {classification.revision_type && classification.revision_type !== 'original' && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-terminal-muted">Revision</span>
                      <span className="font-mono text-sm text-terminal-amber">
                        {classification.revision_type} #{classification.revision_number}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Source Info */}
            <div className="bg-terminal-surface rounded-lg border border-terminal-border overflow-hidden">
              <div className="px-4 py-3 bg-terminal-elevated border-b border-terminal-border flex items-center gap-2">
                <Clock className="h-4 w-4 text-terminal-muted" />
                <span className="font-medium text-terminal-text text-sm">Source Info</span>
              </div>
              <div className="p-4 space-y-2 text-xs font-mono">
                <div className="flex justify-between">
                  <span className="text-terminal-muted">From</span>
                  <span className="text-terminal-text truncate max-w-[140px]" title={email.true_sender_email || email.sender_email}>
                    {(email.true_sender_email || email.sender_email).split('@')[0]}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-terminal-muted">Received</span>
                  <span className="text-terminal-text">
                    {new Date(email.received_at).toLocaleDateString()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-terminal-muted">Attachments</span>
                  <span className={attachments.length > 0 ? 'text-terminal-green' : 'text-terminal-muted'}>
                    {attachments.length > 0 ? attachments.length : 'None'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-terminal-muted">Email ID</span>
                  <span className="text-terminal-text">{email.id.slice(0, 8)}...</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
