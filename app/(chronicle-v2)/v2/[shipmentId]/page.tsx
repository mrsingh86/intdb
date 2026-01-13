'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  Clock,
  Calendar,
  Ship,
  CheckCircle,
  Circle,
  Loader2,
  Package,
} from 'lucide-react';
import { DocumentTimeline } from '@/components/chronicle-v2';
import { type ShipmentDetail, type ShipmentDetailResponse, PHASE_LABELS } from '@/lib/chronicle-v2';

interface PageProps {
  params: Promise<{ shipmentId: string }>;
}

/**
 * Chronicle V2 - Shipment Detail Page (Level 2)
 *
 * Shows full shipment details with issues, actions, cutoffs, and document timeline.
 */
export default function ShipmentDetailPage({ params }: PageProps) {
  const router = useRouter();
  const { shipmentId } = use(params);

  const [shipment, setShipment] = useState<ShipmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllTimeline, setShowAllTimeline] = useState(false);

  // Fetch shipment detail
  useEffect(() => {
    async function fetchShipment() {
      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/chronicle-v2/shipments/${shipmentId}`);

        if (!res.ok) {
          if (res.status === 404) {
            throw new Error('Shipment not found');
          }
          throw new Error('Failed to fetch shipment');
        }

        const data: ShipmentDetailResponse = await res.json();
        setShipment(data.shipment);
      } catch (err) {
        console.error('Error fetching shipment:', err);
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    fetchShipment();
  }, [shipmentId]);

  // Handle document click - navigate to document detail
  const handleDocumentClick = (docId: string) => {
    router.push(`/v2/${shipmentId}/documents/${docId}`);
  };

  // Format date
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--ink-text-muted)' }} />
      </div>
    );
  }

  if (error || !shipment) {
    return (
      <div
        className="rounded-lg border p-8 text-center"
        style={{
          backgroundColor: 'var(--ink-error-bg)',
          borderColor: 'var(--ink-error-border)',
        }}
      >
        <p style={{ color: 'var(--ink-error)' }}>{error || 'Shipment not found'}</p>
        <button
          onClick={() => router.push('/v2')}
          className="mt-4 rounded-md px-4 py-2 text-sm font-medium"
          style={{
            backgroundColor: 'var(--ink-surface)',
            color: 'var(--ink-text)',
          }}
        >
          Back to list
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back button */}
      <button
        onClick={() => router.push('/v2')}
        className="flex items-center gap-2 text-sm transition-colors"
        style={{ color: 'var(--ink-text-muted)' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--ink-text)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-text-muted)')}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to shipments
      </button>

      {/* Header */}
      <div
        className="rounded-lg border p-6"
        style={{
          backgroundColor: 'var(--ink-surface)',
          borderColor: 'var(--ink-border-subtle)',
        }}
      >
        <div className="flex items-start justify-between">
          <div>
            {/* Booking Number */}
            <h1
              className="text-xl font-semibold"
              style={{
                color: 'var(--ink-text)',
                fontFamily: 'var(--ink-font-mono)',
              }}
            >
              {shipment.bookingNumber || shipment.mblNumber || shipment.id.slice(0, 8)}
            </h1>

            {/* Shipper → Consignee */}
            <div
              className="mt-2 flex items-center gap-2 text-sm"
              style={{ color: 'var(--ink-text-secondary)' }}
            >
              <span>{shipment.shipper || '—'}</span>
              <ArrowRight className="h-3 w-3" style={{ color: 'var(--ink-text-muted)' }} />
              <span>{shipment.consignee || '—'}</span>
            </div>

            {/* Route and Vessel */}
            <div
              className="mt-2 flex items-center gap-4 text-sm"
              style={{ color: 'var(--ink-text-muted)' }}
            >
              <span className="flex items-center gap-1.5">
                <span className="font-medium" style={{ color: 'var(--ink-text-secondary)' }}>
                  {shipment.route.origin}
                </span>
                <ArrowRight className="h-3 w-3" />
                <span className="font-medium" style={{ color: 'var(--ink-text-secondary)' }}>
                  {shipment.route.destination}
                </span>
              </span>
              {shipment.vessel && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Ship className="h-3 w-3" />
                    {shipment.vessel}
                    {shipment.voyage && ` / ${shipment.voyage}`}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Phase badge */}
          <div
            className="rounded-lg border px-3 py-1.5 text-sm font-medium"
            style={{
              backgroundColor: 'var(--ink-elevated)',
              borderColor: 'var(--ink-border)',
              color: 'var(--ink-text-secondary)',
            }}
          >
            {PHASE_LABELS[shipment.phase]}
          </div>
        </div>

        {/* ETD / ETA */}
        <div
          className="mt-4 flex items-center gap-6 text-sm"
          style={{ color: 'var(--ink-text-muted)' }}
        >
          <span className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            ETD: <span style={{ color: 'var(--ink-text-secondary)' }}>{formatDate(shipment.etd)}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            ETA: <span style={{ color: 'var(--ink-text-secondary)' }}>{formatDate(shipment.eta)}</span>
          </span>
          </div>

        {/* Container Numbers */}
        {shipment.containers.length > 0 && (
          <div className="mt-4">
            <div
              className="flex items-center gap-2 text-sm"
              style={{ color: 'var(--ink-text-muted)' }}
            >
              <Package className="h-3.5 w-3.5" />
              <span>{shipment.containers.length} container{shipment.containers.length > 1 ? 's' : ''}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {shipment.containers.map((container, idx) => (
                <span
                  key={idx}
                  className="rounded px-2 py-1 text-xs font-medium"
                  style={{
                    backgroundColor: 'var(--ink-elevated)',
                    color: 'var(--ink-text-secondary)',
                    fontFamily: 'var(--ink-font-mono)',
                  }}
                >
                  {container}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Three Column Grid: Issues, Actions, Cutoffs */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Issues */}
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
            <AlertCircle className="h-4 w-4" style={{ color: 'var(--ink-error)' }} />
            Issues ({shipment.issuesList.length})
          </h3>

          {shipment.issuesList.length === 0 ? (
            <p
              className="mt-3 text-sm"
              style={{ color: 'var(--ink-text-muted)' }}
            >
              No issues
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {shipment.issuesList.slice(0, 5).map((issue) => (
                <div
                  key={issue.id}
                  className="rounded-md border p-2"
                  style={{
                    backgroundColor: 'var(--ink-error-bg)',
                    borderColor: 'var(--ink-error-border)',
                  }}
                >
                  <p
                    className="text-sm font-medium"
                    style={{ color: 'var(--ink-error)' }}
                  >
                    {issue.type.charAt(0).toUpperCase() + issue.type.slice(1)}
                  </p>
                  <p
                    className="mt-0.5 text-xs"
                    style={{ color: 'var(--ink-text-muted)' }}
                  >
                    {issue.description.slice(0, 80)}
                    {issue.description.length > 80 ? '...' : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
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
            <Clock className="h-4 w-4" style={{ color: 'var(--ink-warning)' }} />
            Actions ({shipment.actions.pending} pending)
          </h3>

          {shipment.actionsList.length === 0 ? (
            <p
              className="mt-3 text-sm"
              style={{ color: 'var(--ink-text-muted)' }}
            >
              No actions
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {shipment.actionsList.slice(0, 5).map((action) => (
                <div
                  key={action.id}
                  className="flex items-start gap-2 rounded-md border p-2"
                  style={{
                    backgroundColor: action.completed ? 'transparent' : 'var(--ink-warning-bg)',
                    borderColor: action.completed ? 'var(--ink-border-subtle)' : 'var(--ink-warning-border)',
                  }}
                >
                  {action.completed ? (
                    <CheckCircle
                      className="mt-0.5 h-4 w-4 flex-shrink-0"
                      style={{ color: 'var(--ink-success)' }}
                    />
                  ) : (
                    <Circle
                      className="mt-0.5 h-4 w-4 flex-shrink-0"
                      style={{ color: 'var(--ink-warning)' }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p
                      className="text-sm"
                      style={{
                        color: action.completed ? 'var(--ink-text-muted)' : 'var(--ink-text)',
                        textDecoration: action.completed ? 'line-through' : 'none',
                      }}
                    >
                      {action.description.slice(0, 60)}
                      {action.description.length > 60 ? '...' : ''}
                    </p>
                    {action.deadline && !action.completed && (
                      <p
                        className="mt-0.5 text-xs"
                        style={{
                          color:
                            new Date(action.deadline) < new Date()
                              ? 'var(--ink-error)'
                              : 'var(--ink-text-muted)',
                        }}
                      >
                        Due: {formatDate(action.deadline)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cutoffs */}
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
            <Calendar className="h-4 w-4" style={{ color: 'var(--ink-info)' }} />
            Cutoffs
          </h3>

          <div className="mt-3 space-y-2">
            {shipment.cutoffDetails.map((cutoff) => {
              const statusColors = {
                overdue: { bg: 'var(--ink-error-bg)', border: 'var(--ink-error-border)', text: 'var(--ink-error)' },
                urgent: { bg: 'var(--ink-warning-bg)', border: 'var(--ink-warning-border)', text: 'var(--ink-warning)' },
                warning: { bg: 'var(--ink-warning-bg)', border: 'var(--ink-warning-border)', text: 'var(--ink-warning)' },
                safe: { bg: 'transparent', border: 'var(--ink-border-subtle)', text: 'var(--ink-success)' },
                submitted: { bg: 'var(--ink-success-bg)', border: 'var(--ink-success-border)', text: 'var(--ink-success)' },
                unknown: { bg: 'transparent', border: 'var(--ink-border-subtle)', text: 'var(--ink-text-muted)' },
              };

              const colors = statusColors[cutoff.status];

              // Format status text
              const getStatusText = () => {
                if (!cutoff.date) return null;
                if (cutoff.daysRemaining === null) return null;
                if (cutoff.daysRemaining < 0) return 'Overdue';
                if (cutoff.daysRemaining === 0) return 'Today';
                if (cutoff.daysRemaining <= 3) return `${cutoff.daysRemaining}d left`;
                return null;
              };

              const statusText = getStatusText();

              return (
                <div
                  key={cutoff.type}
                  className="flex items-center justify-between rounded-md border p-2"
                  style={{
                    backgroundColor: colors.bg,
                    borderColor: colors.border,
                  }}
                >
                  <span
                    className="text-sm"
                    style={{ color: 'var(--ink-text-secondary)' }}
                  >
                    {cutoff.label}
                  </span>
                  <div className="flex items-center gap-2">
                    {/* Always show the actual date */}
                    <span
                      className="text-sm"
                      style={{ color: 'var(--ink-text-secondary)' }}
                    >
                      {cutoff.date ? formatDate(cutoff.date) : '—'}
                    </span>
                    {/* Show status badge if urgent/overdue */}
                    {statusText && (
                      <span
                        className="text-xs font-medium px-1.5 py-0.5 rounded"
                        style={{
                          backgroundColor: colors.text === 'var(--ink-error)' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(245, 158, 11, 0.2)',
                          color: colors.text,
                        }}
                      >
                        {statusText}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Document Timeline */}
      <div
        className="rounded-lg border p-4"
        style={{
          backgroundColor: 'var(--ink-surface)',
          borderColor: 'var(--ink-border-subtle)',
        }}
      >
        <div className="flex items-center justify-between">
          <h3
            className="text-sm font-medium"
            style={{ color: 'var(--ink-text)' }}
          >
            Document Timeline ({shipment.timeline.length})
          </h3>
          {shipment.timeline.length > 10 && (
            <button
              onClick={() => setShowAllTimeline(!showAllTimeline)}
              className="text-sm"
              style={{ color: 'var(--ink-accent)' }}
            >
              {showAllTimeline ? 'Show less' : 'Show all'}
            </button>
          )}
        </div>

        <div className="mt-4">
          <DocumentTimeline
            timeline={shipment.timeline}
            onDocumentClick={handleDocumentClick}
            maxItems={10}
            showAll={showAllTimeline}
          />
        </div>
      </div>

    </div>
  );
}
