'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Clock,
  Paperclip,
  Mail,
  FileText,
  Loader2,
  ExternalLink,
} from 'lucide-react';
import { type DocumentDetail, type DocumentDetailResponse } from '@/lib/chronicle-v2';

interface PageProps {
  params: Promise<{ shipmentId: string; docId: string }>;
}

/**
 * Chronicle V2 - Document Detail Page (Level 3)
 *
 * Shows full email/document content with extracted fields and attachments.
 */
export default function DocumentDetailPage({ params }: PageProps) {
  const router = useRouter();
  const { shipmentId, docId } = use(params);

  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch document detail
  useEffect(() => {
    async function fetchDocument() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/chronicle-v2/documents/${docId}`);

        if (!res.ok) {
          if (res.status === 404) {
            throw new Error('Document not found');
          }
          throw new Error('Failed to fetch document');
        }

        const data: DocumentDetailResponse = await res.json();
        setDocument(data.document);
      } catch (err) {
        console.error('Error fetching document:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchDocument();
  }, [docId]);

  // Navigate to previous/next document
  const navigateToDocument = (targetDocId: string | null) => {
    if (targetDocId) {
      router.push(`/v2/${shipmentId}/documents/${targetDocId}`);
    }
  };

  // Format date
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  // Format file size
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  // Get sentiment color
  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'positive':
        return 'var(--ink-success)';
      case 'negative':
        return 'var(--ink-error)';
      case 'urgent':
        return 'var(--ink-warning)';
      default:
        return 'var(--ink-text-muted)';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--ink-text-muted)' }} />
      </div>
    );
  }

  if (error || !document) {
    return (
      <div
        className="rounded-lg border p-8 text-center"
        style={{
          backgroundColor: 'var(--ink-error-bg)',
          borderColor: 'var(--ink-error-border)',
        }}
      >
        <p style={{ color: 'var(--ink-error)' }}>{error || 'Document not found'}</p>
        <button
          onClick={() => router.push(`/v2/${shipmentId}`)}
          className="mt-4 rounded-md px-4 py-2 text-sm font-medium"
          style={{
            backgroundColor: 'var(--ink-surface)',
            color: 'var(--ink-text)',
          }}
        >
          Back to shipment
        </button>
      </div>
    );
  }

  // Group extracted fields by category
  const fieldsByCategory = document.extractedFields.reduce(
    (acc, field) => {
      if (!acc[field.category]) {
        acc[field.category] = [];
      }
      acc[field.category].push(field);
      return acc;
    },
    {} as Record<string, typeof document.extractedFields>
  );

  const categoryLabels: Record<string, string> = {
    identifier: 'Identifiers',
    party: 'Parties',
    location: 'Locations',
    date: 'Dates',
    cargo: 'Cargo & Vessel',
    other: 'Other',
  };

  return (
    <div className="space-y-6">
      {/* Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push(`/v2/${shipmentId}`)}
          className="flex items-center gap-2 text-sm transition-colors"
          style={{ color: 'var(--ink-text-muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink-text)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-text-muted)')}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to shipment
        </button>

        {/* Prev/Next navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigateToDocument(document.previousDocId)}
            disabled={!document.previousDocId}
            className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
            style={{
              backgroundColor: 'var(--ink-surface)',
              color: 'var(--ink-text-muted)',
            }}
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </button>
          <button
            onClick={() => navigateToDocument(document.nextDocId)}
            disabled={!document.nextDocId}
            className="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
            style={{
              backgroundColor: 'var(--ink-surface)',
              color: 'var(--ink-text-muted)',
            }}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Document Header */}
      <div
        className="rounded-lg border p-6"
        style={{
          backgroundColor: 'var(--ink-surface)',
          borderColor: 'var(--ink-border-subtle)',
        }}
      >
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: 'var(--ink-info-bg)' }}
          >
            <Mail className="h-5 w-5" style={{ color: 'var(--ink-info)' }} />
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1">
            {/* Document type and badges */}
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="rounded-md px-2 py-0.5 text-xs font-medium"
                style={{
                  backgroundColor: 'var(--ink-elevated)',
                  color: 'var(--ink-text-secondary)',
                }}
              >
                {document.documentType}
              </span>
              <span
                className="rounded-md px-2 py-0.5 text-xs"
                style={{
                  backgroundColor: 'var(--ink-bg)',
                  color: getSentimentColor(document.sentiment),
                }}
              >
                {document.sentiment}
              </span>
              {document.issue && (
                <span
                  className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs"
                  style={{
                    backgroundColor: 'var(--ink-error-bg)',
                    color: 'var(--ink-error)',
                  }}
                >
                  <AlertCircle className="h-3 w-3" />
                  {document.issue.type}
                </span>
              )}
              {document.action && !document.action.completed && (
                <span
                  className="flex items-center gap-1 rounded-md px-2 py-0.5 text-xs"
                  style={{
                    backgroundColor: 'var(--ink-warning-bg)',
                    color: 'var(--ink-warning)',
                  }}
                >
                  <Clock className="h-3 w-3" />
                  Action needed
                </span>
              )}
            </div>

            {/* Subject */}
            <h1
              className="mt-2 text-lg font-medium"
              style={{ color: 'var(--ink-text)' }}
            >
              {document.subject || 'No subject'}
            </h1>

            {/* Sender and date */}
            <div
              className="mt-2 flex items-center gap-4 text-sm"
              style={{ color: 'var(--ink-text-muted)' }}
            >
              <span>
                From: <span style={{ color: 'var(--ink-text-secondary)' }}>{document.sender.party}</span>
                {' '}
                <span style={{ color: 'var(--ink-text-muted)' }}>({document.sender.email})</span>
              </span>
              <span>•</span>
              <span>{formatDate(document.receivedAt)}</span>
            </div>
          </div>
        </div>

        {/* AI Summary */}
        {document.summary && (
          <div
            className="mt-4 rounded-md border p-3"
            style={{
              backgroundColor: 'var(--ink-bg)',
              borderColor: 'var(--ink-border-subtle)',
            }}
          >
            <p
              className="text-sm font-medium"
              style={{ color: 'var(--ink-text-muted)' }}
            >
              AI Summary
            </p>
            <p
              className="mt-1 text-sm"
              style={{ color: 'var(--ink-text-secondary)' }}
            >
              {document.summary}
            </p>
          </div>
        )}
      </div>

      {/* Issue/Action Details */}
      {(document.issue || document.action) && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Issue */}
          {document.issue && (
            <div
              className="rounded-lg border p-4"
              style={{
                backgroundColor: 'var(--ink-error-bg)',
                borderColor: 'var(--ink-error-border)',
              }}
            >
              <h3
                className="flex items-center gap-2 text-sm font-medium"
                style={{ color: 'var(--ink-error)' }}
              >
                <AlertCircle className="h-4 w-4" />
                Issue: {document.issue.type}
              </h3>
              <p
                className="mt-2 text-sm"
                style={{ color: 'var(--ink-text-secondary)' }}
              >
                {document.issue.description}
              </p>
            </div>
          )}

          {/* Action */}
          {document.action && (
            <div
              className="rounded-lg border p-4"
              style={{
                backgroundColor: document.action.completed ? 'var(--ink-success-bg)' : 'var(--ink-warning-bg)',
                borderColor: document.action.completed ? 'var(--ink-success-border)' : 'var(--ink-warning-border)',
              }}
            >
              <h3
                className="flex items-center gap-2 text-sm font-medium"
                style={{ color: document.action.completed ? 'var(--ink-success)' : 'var(--ink-warning)' }}
              >
                <Clock className="h-4 w-4" />
                {document.action.completed ? 'Completed Action' : 'Action Required'}
              </h3>
              <p
                className="mt-2 text-sm"
                style={{ color: 'var(--ink-text-secondary)' }}
              >
                {document.action.description}
              </p>
              {document.action.deadline && (
                <p
                  className="mt-1 text-xs"
                  style={{ color: 'var(--ink-text-muted)' }}
                >
                  Deadline: {formatDate(document.action.deadline)}
                </p>
              )}
              {document.action.owner && (
                <p
                  className="mt-1 text-xs"
                  style={{ color: 'var(--ink-text-muted)' }}
                >
                  Owner: {document.action.owner}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Extracted Fields */}
      {document.extractedFields.length > 0 && (
        <div
          className="rounded-lg border p-4"
          style={{
            backgroundColor: 'var(--ink-surface)',
            borderColor: 'var(--ink-border-subtle)',
          }}
        >
          <h3
            className="text-sm font-medium"
            style={{ color: 'var(--ink-text)' }}
          >
            Extracted Data
          </h3>

          <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {Object.entries(fieldsByCategory).map(([category, fields]) => (
              <div key={category}>
                <h4
                  className="text-xs font-medium uppercase tracking-wider"
                  style={{ color: 'var(--ink-text-muted)' }}
                >
                  {categoryLabels[category] || category}
                </h4>
                <div className="mt-2 space-y-2">
                  {fields.map((field) => (
                    <div key={field.key}>
                      <p
                        className="text-xs"
                        style={{ color: 'var(--ink-text-muted)' }}
                      >
                        {field.label}
                      </p>
                      <p
                        className="text-sm font-medium"
                        style={{
                          color: 'var(--ink-text)',
                          fontFamily: category === 'identifier' ? 'var(--ink-font-mono)' : 'var(--ink-font-sans)',
                        }}
                      >
                        {field.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Email Body */}
      {document.bodyPreview && (
        <div
          className="rounded-lg border p-4"
          style={{
            backgroundColor: 'var(--ink-surface)',
            borderColor: 'var(--ink-border-subtle)',
          }}
        >
          <h3
            className="text-sm font-medium"
            style={{ color: 'var(--ink-text)' }}
          >
            Email Content
          </h3>
          <div
            className="mt-4 whitespace-pre-wrap text-sm"
            style={{
              color: 'var(--ink-text-secondary)',
              fontFamily: 'var(--ink-font-sans)',
              lineHeight: 1.6,
            }}
          >
            {document.bodyPreview}
          </div>
        </div>
      )}

      {/* Attachments */}
      {document.attachments.length > 0 && (
        <div
          className="rounded-lg border p-4"
          style={{
            backgroundColor: 'var(--ink-surface)',
            borderColor: 'var(--ink-border-subtle)',
          }}
        >
          <h3
            className="flex items-center gap-2 text-sm font-medium"
            style={{ color: 'var(--ink-text)' }}
          >
            <Paperclip className="h-4 w-4" />
            Attachments ({document.attachments.length})
          </h3>

          <div className="mt-3 space-y-2">
            {document.attachments.map((att) => {
              // Build view URL if we have the required IDs
              const canView = att.attachmentId && document.gmailMessageId && att.mimeType === 'application/pdf';
              const viewUrl = canView
                ? `/api/chronicle-v2/attachments/${document.gmailMessageId}/${att.attachmentId}?filename=${encodeURIComponent(att.filename)}`
                : null;

              return (
                <div
                  key={att.id}
                  className="flex items-center justify-between gap-3 rounded-md border p-3"
                  style={{
                    backgroundColor: 'var(--ink-bg)',
                    borderColor: 'var(--ink-border-subtle)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5" style={{ color: 'var(--ink-text-muted)' }} />
                    <div>
                      <p
                        className="text-sm font-medium"
                        style={{ color: 'var(--ink-text)' }}
                      >
                        {att.filename}
                      </p>
                      <p
                        className="text-xs"
                        style={{ color: 'var(--ink-text-muted)' }}
                      >
                        {formatFileSize(att.size)} • {att.mimeType}
                      </p>
                    </div>
                  </div>
                  {viewUrl && (
                    <a
                      href={viewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors"
                      style={{
                        backgroundColor: 'var(--ink-elevated)',
                        color: 'var(--ink-text-secondary)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--ink-accent)';
                        e.currentTarget.style.color = 'white';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--ink-elevated)';
                        e.currentTarget.style.color = 'var(--ink-text-secondary)';
                      }}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      View
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
