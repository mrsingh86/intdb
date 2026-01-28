'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

interface Dossier {
  bookingNumber: string;
  mblNumber?: string;
  hblNumber?: string;
  containerNumbers: string[];
  shipper?: string;
  consignee?: string;
  carrier?: string;
  pol?: string;
  pod?: string;
  vessel?: string;
  voyage?: string;
  stage: string;
  healthScore: number;
  dates: {
    etd?: string;
    eta?: string;
    atd?: string;
    ata?: string;
  };
  cutoffs: Array<{
    type: string;
    displayName: string;
    date: string;
    status: string;
    completed?: boolean;
  }>;
  documents: Array<{
    id: string;
    displayName: string;
    receivedAt: string;
    fromParty: string;
  }>;
  liveTracking?: {
    status: string;
    location?: string;
    vessel?: string;
    lastEvent?: string;
    lastEventDate?: string;
  };
  emailCount: number;
  documentCompletion: number;
}

export default function SharePage() {
  const params = useParams();
  const token = params.token as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [sharedAt, setSharedAt] = useState<string | null>(null);

  useEffect(() => {
    async function fetchDossier() {
      try {
        const res = await fetch(`/api/pulse/share?token=${token}`);
        const data = await res.json();

        if (!data.success) {
          setError(data.error || 'Failed to load shipment');
          return;
        }

        setDossier(data.dossier);
        setSharedAt(data.sharedAt);
      } catch {
        setError('Failed to load shipment');
      } finally {
        setLoading(false);
      }
    }

    if (token) {
      fetchDossier();
    }
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-pink-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-gray-400 mt-4">Loading shipment...</p>
        </div>
      </div>
    );
  }

  if (error || !dossier) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-900/30 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Link Invalid or Expired</h1>
          <p className="text-gray-400">{error}</p>
          <a
            href="/pulse"
            className="inline-block mt-6 px-6 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 transition-colors"
          >
            Go to Pulse
          </a>
        </div>
      </div>
    );
  }

  const d = dossier;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-6 h-6" viewBox="0 0 520 601" fill="none">
              <path d="M0 600.517L346.711 0L520.064 300.259L346.711 600.517H0Z" fill="#E72566"/>
              <path d="M0 0L346.711 600.518L520.064 300.258L346.711 0H0Z" fill="#E72566"/>
              <path d="M129.111 376.892L173.355 300.257L346.711 600.517L129.111 376.892Z" fill="#8B001D"/>
            </svg>
            <span className="text-lg font-bold text-white">intoglo</span>
            <div className="h-5 w-px bg-gray-700 mx-1" />
            <span className="text-lg font-semibold" style={{ color: '#E72566' }}>PULSE</span>
          </div>
          <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded">Shared View</span>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-4 pb-20">
        <div className="space-y-4">
          {/* Header Card */}
          <div className="bg-gradient-to-r from-pink-900/20 to-gray-900 rounded-xl border border-pink-800/30 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-wide mb-1" style={{ color: '#E72566' }}>Booking</p>
                <h1 className="text-2xl font-bold font-mono text-white">{d.bookingNumber}</h1>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm">
                  {d.mblNumber && d.mblNumber !== d.bookingNumber && (
                    <p className="text-gray-400 font-mono"><span className="text-gray-500">MBL:</span> {d.mblNumber}</p>
                  )}
                  {d.hblNumber && <p className="text-gray-400 font-mono"><span className="text-gray-500">HBL:</span> {d.hblNumber}</p>}
                </div>
              </div>
              <div className="text-right">
                <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
                  d.healthScore >= 80 ? 'bg-green-900/50 text-green-400' :
                  d.healthScore >= 60 ? 'bg-amber-900/50 text-amber-400' :
                  'bg-red-900/50 text-red-400'
                }`}>
                  Health {d.healthScore}
                </span>
                <p className="text-xs text-gray-500 mt-1">{d.stage}</p>
              </div>
            </div>
            {(d.carrier || d.vessel) && (
              <p className="text-sm text-gray-400 mt-3 pt-3 border-t border-gray-800">
                🚢 {d.carrier}{d.vessel && ` • ${d.vessel}`}{d.voyage && ` / ${d.voyage}`}
              </p>
            )}
          </div>

          {/* Parties */}
          <Section title="Parties">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-500 uppercase">📤 Shipper</p>
                <p className="text-sm mt-1">{d.shipper || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 uppercase">📥 Consignee</p>
                <p className="text-sm mt-1">{d.consignee || '—'}</p>
              </div>
            </div>
          </Section>

          {/* Route */}
          <Section title="Route">
            <div className="flex items-center justify-between">
              <div className="text-center">
                <p className="text-lg font-bold font-mono text-blue-400">{d.pol || '—'}</p>
                <p className="text-xs text-gray-500">POL</p>
                {d.dates.etd && <p className="text-xs text-gray-400 mt-1">ETD: {formatDate(d.dates.etd)}</p>}
                {d.dates.atd && <p className="text-xs text-green-400">ATD: {formatDate(d.dates.atd)}</p>}
              </div>
              <div className="flex-1 px-4">
                <div className="h-0.5 bg-gradient-to-r from-blue-500 to-green-500 relative">
                  <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-900 px-2">🚢</span>
                </div>
              </div>
              <div className="text-center">
                <p className="text-lg font-bold font-mono text-green-400">{d.pod || '—'}</p>
                <p className="text-xs text-gray-500">POD</p>
                {d.dates.eta && <p className="text-xs text-gray-400 mt-1">ETA: {formatDate(d.dates.eta)}</p>}
                {d.dates.ata && <p className="text-xs text-green-400">ATA: {formatDate(d.dates.ata)}</p>}
              </div>
            </div>
          </Section>

          {/* Containers */}
          {d.containerNumbers.length > 0 && (
            <Section title={`Containers (${d.containerNumbers.length})`}>
              <div className="flex flex-wrap gap-2">
                {d.containerNumbers.map((c) => (
                  <span key={c} className="px-2 py-1 bg-gray-800 rounded text-sm font-mono">{c}</span>
                ))}
              </div>
            </Section>
          )}

          {/* Quick Stats */}
          <div className="grid grid-cols-3 gap-2">
            <StatBox label="Emails" value={d.emailCount} />
            <StatBox label="Docs" value={`${d.documentCompletion}%`} />
            <StatBox label="Containers" value={d.containerNumbers.length} />
          </div>

          {/* Live Tracking */}
          {d.liveTracking && (
            <Section title="Live Tracking" icon="📍">
              <div className="space-y-1 text-sm">
                <p><span className="text-gray-500">Status:</span> <span className="text-green-400">{d.liveTracking.status}</span></p>
                {d.liveTracking.location && <p><span className="text-gray-500">Location:</span> {d.liveTracking.location}</p>}
                {d.liveTracking.vessel && <p><span className="text-gray-500">Vessel:</span> {d.liveTracking.vessel}</p>}
                {d.liveTracking.lastEvent && (
                  <p><span className="text-gray-500">Last:</span> {d.liveTracking.lastEvent}
                    {d.liveTracking.lastEventDate && ` (${formatDate(d.liveTracking.lastEventDate)})`}
                  </p>
                )}
              </div>
            </Section>
          )}

          {/* Cutoffs */}
          {d.cutoffs.length > 0 && (
            <Section title="Cutoffs">
              <div className="grid grid-cols-2 gap-2">
                {d.cutoffs.map((c) => (
                  <div key={c.type} className="flex items-center justify-between text-sm bg-gray-800 rounded-lg px-3 py-2">
                    <span className="text-gray-400">{c.displayName}</span>
                    <span className={`text-xs ${
                      c.completed ? 'text-green-400' :
                      c.status === 'passed' ? 'text-red-400' :
                      'text-gray-400'
                    }`}>
                      {formatDate(c.date)} {c.completed ? '✅' : c.status === 'passed' ? '🔴' : ''}
                    </span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* Documents */}
          {d.documents.length > 0 && (
            <Section title={`Documents (${d.documents.length})`}>
              <div className="space-y-2">
                {d.documents.slice(0, 10).map((doc) => (
                  <div key={doc.id} className="flex items-center gap-3 p-2 bg-gray-800 rounded-lg text-sm">
                    <span className="text-gray-300">{doc.displayName}</span>
                    <span className="text-xs text-gray-500 ml-auto">{formatDate(doc.receivedAt)}</span>
                  </div>
                ))}
                {d.documents.length > 10 && (
                  <p className="text-xs text-gray-500 text-center">+{d.documents.length - 10} more documents</p>
                )}
              </div>
            </Section>
          )}

          {/* Footer */}
          <div className="text-center text-xs text-gray-600 pt-4">
            {sharedAt && <p>Shared on {new Date(sharedAt).toLocaleDateString()}</p>}
            <p className="mt-1">Powered by intoglo Pulse</p>
          </div>
        </div>
      </main>
    </div>
  );
}

// Helper Components

function Section({ title, icon, children }: { title?: string; icon?: string; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
      {title && (
        <h3 className="text-xs text-gray-500 uppercase mb-3 flex items-center gap-2">
          {icon && <span>{icon}</span>}
          {title}
        </h3>
      )}
      {children}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-3 text-center">
      <p className="text-xl font-bold font-mono text-blue-400">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
