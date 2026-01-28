'use client';

import { useState, useEffect, useMemo, Suspense, useRef, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';

// =============================================================================
// TYPES
// =============================================================================

interface DocumentRecord {
  id: string;
  type: string;
  displayName: string;
  receivedAt: string;
  fromParty: string;
  subject: string;
  hasAttachment: boolean;
  gmailLink: string;
  attachmentUrl?: string;
  emailViewUrl?: string;
  snippet?: string;
}

interface CutoffDate {
  type: string;
  displayName: string;
  date: string;
  status: 'passed' | 'today' | 'upcoming' | 'unknown';
  hoursRemaining?: number;
  completed?: boolean;
}

interface Escalation {
  type: 'customer' | 'vendor' | 'internal';
  severity: 'critical' | 'high' | 'medium';
  date: string;
  subject: string;
  from: string;
  snippet: string;
  gmailLink: string;
  emailViewUrl?: string;
}

interface Discrepancy {
  field: string;
  intdbValue: string;
  carrierValue?: string;
  severity: 'high' | 'medium' | 'low';
  recommendation: string;
}

interface PendingAction {
  description: string;
  owner?: string;
  deadline?: string;
  isOverdue: boolean;
}

interface LiveTracking {
  source: string;
  status: string;
  vessel?: string;
  location?: string;
  etd?: string;
  eta?: string;
  lastEvent?: string;
  lastEventDate?: string;
}

interface DnDCharges {
  totalCharges: number;
  currency: string;
  lastFreeDay?: string;
  demurrageCharges?: number;
  detentionCharges?: number;
}

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
  cutoffs: CutoffDate[];
  documents: DocumentRecord[];
  liveTracking?: LiveTracking;
  dnd?: DnDCharges;
  discrepancies: Discrepancy[];
  escalations: Escalation[];
  emailCount: number;
  pendingActionsCount: number;
  pendingActionsList: PendingAction[];
  documentCompletion: number;
}

interface ShipmentSummary {
  bookingNumber: string;
  mblNumber?: string;
  shipper?: string;
  consignee?: string;
  pol?: string;
  pod?: string;
  vessel?: string;
  etd?: string;
  eta?: string;
  stage: string;
  emailCount: number;
  containerCount: number;
  siCutoff?: string;
  vgmCutoff?: string;
}

interface FeedItem {
  id: string;
  date: string;
  type: 'document' | 'escalation';
  docType?: string;
  displayName?: string;
  fromParty?: string;
  subject?: string;
  hasAttachment?: boolean;
  url?: string;
  snippet?: string;
  escalationType?: string;
  severity?: string;
}

interface DossierSearchResult {
  id: string;
  type: 'email' | 'document';
  subject: string;
  sender: string;
  date: string;
  snippet: string;
  matchedText: string;
  gmailLink?: string;
  emailViewUrl?: string;
  documentType?: string;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export default function PulsePage() {
  return (
    <Suspense fallback={<PulseLoading />}>
      <PulseContent />
    </Suspense>
  );
}

function PulseLoading() {
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-center">
        <span className="block w-8 h-8 border-2 border-pink-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-gray-400 mt-4">Loading Pulse...</p>
      </div>
    </div>
  );
}

function PulseContent() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [shipmentList, setShipmentList] = useState<ShipmentSummary[] | null>(null);
  const [listQuery, setListQuery] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [initialSearchDone, setInitialSearchDone] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  // Dossier search state
  const [dossierKeyword, setDossierKeyword] = useState('');
  const [dossierSearchResults, setDossierSearchResults] = useState<DossierSearchResult[] | null>(null);
  const [dossierSearchLoading, setDossierSearchLoading] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('pulse_recent');
    if (saved) setRecentSearches(JSON.parse(saved).slice(0, 5));
  }, []);

  // Handle URL search parameter (for back navigation from email view)
  useEffect(() => {
    const urlSearch = searchParams.get('search');
    if (urlSearch && !initialSearchDone) {
      setInitialSearchDone(true);
      // Trigger search for the URL parameter
      (async () => {
        setLoading(true);
        setError(null);
        try {
          const res = await fetch('/api/pulse/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: urlSearch }),
          });
          const data = await res.json();
          if (res.ok && data.success) {
            if (data.type === 'list') {
              setShipmentList(data.shipments);
              setListQuery(urlSearch);
            } else {
              setDossier(data.dossier);
            }
          }
        } catch {
          // Silently fail for URL-triggered searches
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [searchParams, initialSearchDone]);

  const search = async (q: string) => {
    const searchQuery = q.trim();
    if (!searchQuery || loading) return;

    setLoading(true);
    setError(null);
    setDossier(null);
    setShipmentList(null);

    try {
      const res = await fetch('/api/pulse/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Search failed');
        return;
      }

      if (data.type === 'list') {
        setShipmentList(data.shipments);
        setListQuery(searchQuery);
      } else {
        setDossier(data.dossier);
      }

      const updated = [searchQuery, ...recentSearches.filter(s => s !== searchQuery)].slice(0, 5);
      setRecentSearches(updated);
      localStorage.setItem('pulse_recent', JSON.stringify(updated));
      setQuery('');
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  const loadDossier = async (bookingNumber: string) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/pulse/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingNumber }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || 'Failed to load shipment');
        return;
      }

      setDossier(data.dossier);
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  const goBackToList = () => {
    setDossier(null);
  };

  const clearAll = () => {
    setDossier(null);
    setShipmentList(null);
    setListQuery('');
    setError(null);
    setDossierKeyword('');
    setDossierSearchResults(null);
  };

  // Search within current shipment
  const searchDossier = async (keyword: string) => {
    if (!dossier || !keyword.trim() || keyword.trim().length < 2) return;

    console.log('[Dossier Search] Searching:', { bookingNumber: dossier.bookingNumber, keyword: keyword.trim() });
    setDossierSearchLoading(true);
    try {
      const res = await fetch('/api/pulse/dossier-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingNumber: dossier.bookingNumber, keyword: keyword.trim() }),
      });
      const data = await res.json();
      console.log('[Dossier Search] Response:', data);

      if (res.ok && data.success) {
        setDossierSearchResults(data.results);
      } else {
        console.error('[Dossier Search] Error:', data.error);
        setDossierSearchResults([]);
      }
    } catch (err) {
      console.error('[Dossier Search] Fetch error:', err);
      setDossierSearchResults([]);
    } finally {
      setDossierSearchLoading(false);
    }
  };

  const clearDossierSearch = () => {
    setDossierKeyword('');
    setDossierSearchResults(null);
  };

  // Build unified chronological feed
  const feed = useMemo(() => {
    if (!dossier) return [];
    const items: FeedItem[] = [];

    for (const doc of dossier.documents) {
      items.push({
        id: doc.id,
        date: doc.receivedAt,
        type: 'document',
        docType: doc.type,
        displayName: doc.displayName,
        fromParty: doc.fromParty,
        subject: doc.subject,
        hasAttachment: doc.hasAttachment,
        url: doc.attachmentUrl || doc.emailViewUrl || doc.gmailLink,
        snippet: doc.snippet,
      });
    }

    for (const esc of dossier.escalations) {
      items.push({
        id: `esc-${esc.date}-${esc.subject.substring(0, 20)}`,
        date: esc.date,
        type: 'escalation',
        escalationType: esc.type,
        severity: esc.severity,
        fromParty: esc.from,
        subject: esc.subject,
        snippet: esc.snippet,
        url: esc.emailViewUrl || esc.gmailLink,
      });
    }

    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return items;
  }, [dossier]);

  const d = dossier;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              {(d || shipmentList) && (
                <button onClick={clearAll} className="p-1 text-gray-400 hover:text-white">
                  <BackIcon />
                </button>
              )}
              <IntogloLogo />
              <div className="h-5 w-px bg-gray-700 mx-1" />
              <span className="text-lg font-semibold" style={{ color: '#E72566' }}>PULSE</span>
            </div>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); search(query); }}>
            <div className="relative">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Booking, MBL, container, port, or company..."
                disabled={loading}
                className="w-full bg-gray-800 text-white px-4 py-3 pr-12 rounded-xl border border-gray-700 focus:border-blue-500 focus:outline-none disabled:opacity-50"
                autoFocus
              />
              <button
                type="submit"
                disabled={loading || !query.trim()}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-white disabled:opacity-50"
              >
                {loading ? <Spinner /> : <SearchIcon />}
              </button>
            </div>
          </form>
          {!d && !shipmentList && recentSearches.length > 0 && (
            <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
              {recentSearches.map((s) => (
                <button key={s} onClick={() => search(s)} disabled={loading}
                  className="px-3 py-1.5 bg-gray-800 text-gray-300 text-sm rounded-full border border-gray-700 whitespace-nowrap hover:bg-gray-700 disabled:opacity-50">
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="max-w-2xl mx-auto px-4 py-4 pb-20">
        {error && (
          <div className="bg-red-900/30 border border-red-800 rounded-xl p-4 text-center">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {!d && !shipmentList && !error && !loading && (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-pink-900/20 border border-pink-800/30 mb-6">
              <svg className="w-12 h-12" viewBox="0 0 520 601" fill="none">
                <path d="M0 600.517L346.711 0L520.064 300.259L346.711 600.517H0Z" fill="#E72566"/>
                <path d="M0 0L346.711 600.518L520.064 300.258L346.711 0H0Z" fill="#E72566"/>
                <path d="M129.111 376.892L173.355 300.257L346.711 600.517L129.111 376.892Z" fill="#8B001D"/>
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white mb-2">Shipment Intelligence</h2>
            <p className="text-gray-400 mb-4">Search by booking, MBL, container, port, or company</p>
            <div className="flex flex-wrap justify-center gap-2 text-xs">
              {['262822342', 'INNSA', 'Pearl Global', 'MRSU7283866'].map((term) => (
                <button
                  key={term}
                  onClick={() => search(term)}
                  className="px-2 py-1 bg-gray-800 rounded text-gray-400 hover:bg-pink-900/30 hover:text-pink-300 cursor-pointer transition-colors"
                >
                  {term}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading && (
          <div className="text-center py-16">
            <Spinner size="lg" />
            <p className="text-gray-400 mt-4">Searching...</p>
          </div>
        )}

        {/* === LIST VIEW === */}
        {shipmentList && !d && (
          <div className="space-y-3">
            <div className="bg-gradient-to-r from-pink-900/20 to-gray-900 rounded-xl border border-pink-800/30 p-4">
              <p className="text-sm text-gray-400">
                Found <span className="text-white font-bold text-lg">{shipmentList.length}</span> shipments for
              </p>
              <p className="text-xl font-semibold mt-1" style={{ color: '#E72566' }}>"{listQuery}"</p>
            </div>
            {shipmentList.map((s) => (
              <ShipmentCard key={s.bookingNumber} shipment={s} onClick={() => loadDossier(s.bookingNumber)} />
            ))}
          </div>
        )}

        {/* === DOSSIER VIEW === */}
        {d && (
          <div className="space-y-4">
            {/* Back navigation */}
            {shipmentList ? (
              <button onClick={goBackToList} className="flex items-center gap-2 text-sm text-pink-400 hover:text-pink-300 bg-pink-900/20 px-3 py-2 rounded-lg border border-pink-800/30 hover:border-pink-700/50 transition-colors">
                <BackIcon /> Back to {shipmentList.length} results for "{listQuery}"
              </button>
            ) : (
              <button onClick={clearAll} className="flex items-center gap-2 text-sm text-pink-400 hover:text-pink-300 bg-pink-900/20 px-3 py-2 rounded-lg border border-pink-800/30 hover:border-pink-700/50 transition-colors">
                <BackIcon /> New search
              </button>
            )}

            {/* === HEADER === */}
            <div className="bg-gradient-to-r from-pink-900/20 to-gray-900 rounded-xl border border-pink-800/30 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wide mb-1" style={{ color: '#E72566' }}>Booking</p>
                  <h2 className="text-2xl font-bold font-mono text-white">{d.bookingNumber}</h2>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm">
                    {d.mblNumber && d.mblNumber !== d.bookingNumber && (
                      <p className="text-gray-400 font-mono"><span className="text-gray-500">MBL:</span> {d.mblNumber}</p>
                    )}
                    {d.hblNumber && <p className="text-gray-400 font-mono"><span className="text-gray-500">HBL:</span> {d.hblNumber}</p>}
                  </div>
                </div>
                <div className="text-right">
                  <HealthBadge score={d.healthScore} />
                  <p className="text-xs text-gray-500 mt-1">{d.stage}</p>
                </div>
              </div>
              {(d.carrier || d.vessel) && (
                <p className="text-sm text-gray-400 mt-3 pt-3 border-t border-gray-800">
                  🚢 {d.carrier}{d.vessel && ` • ${d.vessel}`}{d.voyage && ` / ${d.voyage}`}
                </p>
              )}
              {/* Share button */}
              <div className="flex gap-2 mt-3 pt-3 border-t border-gray-800">
                <button
                  onClick={() => setShowShareModal(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-pink-900/30 text-pink-400 border border-pink-800/50 hover:bg-pink-900/50 transition-colors"
                >
                  <ShareIcon />
                  Share
                </button>
              </div>
            </div>

            {/* === DOSSIER SEARCH === */}
            <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type="text"
                    value={dossierKeyword}
                    onChange={(e) => setDossierKeyword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchDossier(dossierKeyword)}
                    placeholder="Search emails &amp; documents..."
                    className="w-full bg-gray-800 text-white px-4 py-2.5 pr-10 rounded-lg border border-gray-700 focus:border-pink-500 focus:outline-none text-sm"
                  />
                  {dossierKeyword && (
                    <button
                      onClick={clearDossierSearch}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-white"
                    >
                      <CloseIcon />
                    </button>
                  )}
                </div>
                <button
                  onClick={() => searchDossier(dossierKeyword)}
                  disabled={dossierSearchLoading || !dossierKeyword.trim() || dossierKeyword.trim().length < 2}
                  className="px-4 py-2.5 rounded-lg bg-pink-900/30 text-pink-400 border border-pink-800/50 hover:bg-pink-900/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {dossierSearchLoading ? <Spinner /> : <SearchIcon />}
                </button>
              </div>
              <p className="text-xs text-gray-600 mt-2">Search full email content and documents within this shipment</p>
            </div>

            {/* === DOSSIER SEARCH RESULTS === */}
            {dossierSearchResults !== null && (
              <div className="bg-gray-900 rounded-xl border border-pink-800/50 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-pink-400">
                    {dossierSearchResults.length} result{dossierSearchResults.length !== 1 ? 's' : ''} for "{dossierKeyword}"
                  </h3>
                  <button
                    onClick={clearDossierSearch}
                    className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-800"
                  >
                    Clear
                  </button>
                </div>
                {dossierSearchResults.length === 0 ? (
                  <p className="text-sm text-gray-500 py-4 text-center">No matches found in emails or documents</p>
                ) : (
                  <div className="space-y-2">
                    {dossierSearchResults.map((result) => (
                      <a
                        key={result.id}
                        href={result.emailViewUrl || result.gmailLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-3 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <span className="text-lg shrink-0">{result.type === 'document' ? '📎' : '📧'}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-white truncate">{result.subject}</p>
                            <p className="text-xs text-gray-500 mt-0.5">
                              {formatDate(result.date)} • {result.sender}
                              {result.documentType && <span className="ml-2 text-blue-400">{result.documentType}</span>}
                            </p>
                            <p className="text-xs text-gray-400 mt-2 line-clamp-2 bg-gray-900/50 p-2 rounded">
                              <span className="text-gray-600">Match in {result.matchedText}:</span>{' '}
                              <HighlightedSnippet text={result.snippet} keyword={dossierKeyword} />
                            </p>
                          </div>
                        </div>
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* === PARTIES === */}
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

            {/* === ROUTE === */}
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

            {/* === CONTAINERS === */}
            {d.containerNumbers.length > 0 && (
              <Section title={`Containers (${d.containerNumbers.length})`}>
                <div className="flex flex-wrap gap-2">
                  {d.containerNumbers.map((c) => (
                    <span key={c} className="px-2 py-1 bg-gray-800 rounded text-sm font-mono">{c}</span>
                  ))}
                </div>
              </Section>
            )}

            {/* === QUICK STATS === */}
            <div className="grid grid-cols-4 gap-2">
              <StatBox label="Emails" value={d.emailCount} color="blue" />
              <StatBox label="Docs" value={`${d.documentCompletion}%`} color="green" />
              <StatBox label="Actions" value={d.pendingActionsCount} color={d.pendingActionsCount > 0 ? 'amber' : 'green'} />
              <StatBox label="Issues" value={d.escalations.length} color={d.escalations.length > 0 ? 'red' : 'green'} />
            </div>

            {/* === LIVE TRACKING === */}
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

            {/* === D&D CHARGES === */}
            {d.dnd && (
              <Section title="D&D Charges" icon="💰" alert={d.dnd.totalCharges > 0}>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {d.dnd.lastFreeDay && (
                    <p><span className="text-gray-500">LFD:</span> {formatDate(d.dnd.lastFreeDay)}</p>
                  )}
                  <p className="font-bold">
                    <span className="text-gray-500">Total:</span>{' '}
                    <span className={d.dnd.totalCharges > 0 ? 'text-red-400' : 'text-green-400'}>
                      {d.dnd.currency} {d.dnd.totalCharges}
                    </span>
                  </p>
                </div>
              </Section>
            )}

            {/* === CUTOFFS === */}
            {d.cutoffs.length > 0 && (
              <Section title="Cutoffs">
                <div className="grid grid-cols-2 gap-2">
                  {d.cutoffs.map((c) => (
                    <div key={c.type} className="flex items-center justify-between text-sm bg-gray-800 rounded-lg px-3 py-2">
                      <span className="text-gray-400">{c.displayName}</span>
                      <CutoffBadge status={c.status} completed={c.completed} hours={c.hoursRemaining} date={c.date} />
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* === UNIFIED CHRONOLOGICAL FEED === */}
            <Section title={`Activity (${feed.length} events)`}>
              <p className="text-xs text-gray-600 mb-3">Newest first • Documents & escalations merged</p>
              <div className="space-y-1">
                {feed.map((item) => (
                  <FeedRow key={item.id} item={item} />
                ))}
              </div>
            </Section>

            {/* === PENDING ACTIONS === */}
            {d.pendingActionsList.length > 0 && (
              <Section title={`Pending Actions (${d.pendingActionsCount})`} icon="⚡" alert>
                <div className="space-y-2">
                  {d.pendingActionsList.map((a, i) => (
                    <div key={i} className={`p-3 rounded-lg text-sm ${a.isOverdue ? 'bg-red-900/30 border border-red-800' : 'bg-gray-800'}`}>
                      <p className={a.isOverdue ? 'text-red-400' : 'text-gray-200'}>{a.description}</p>
                      <div className="flex gap-3 text-xs text-gray-500 mt-1">
                        {a.owner && <span>Owner: {a.owner}</span>}
                        {a.deadline && <span>Due: {formatDate(a.deadline)}</span>}
                        {a.isOverdue && <span className="text-red-400 font-medium">OVERDUE</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* === DISCREPANCIES === */}
            {d.discrepancies.length > 0 && (
              <Section title={`Discrepancies (${d.discrepancies.length})`} icon="⚠️">
                <div className="space-y-2">
                  {d.discrepancies.map((disc, i) => (
                    <div key={i} className={`p-3 rounded-lg text-sm ${
                      disc.severity === 'high' ? 'bg-red-900/20 border border-red-800/50' :
                      disc.severity === 'medium' ? 'bg-amber-900/20 border border-amber-800/50' :
                      'bg-gray-800'
                    }`}>
                      <p className="font-medium">{disc.field}</p>
                      <p className="text-xs text-gray-400 mt-1">INTDB: {disc.intdbValue}</p>
                      {disc.carrierValue && <p className="text-xs text-gray-400">Carrier: {disc.carrierValue}</p>}
                      <p className="text-xs text-blue-400 mt-1">{disc.recommendation}</p>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </div>
        )}

        {/* Share Modal */}
        {showShareModal && d && (
          <ShareModal dossier={d} onClose={() => setShowShareModal(false)} />
        )}
      </main>
    </div>
  );
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function ShipmentCard({ shipment: s, onClick }: { shipment: ShipmentSummary; onClick: () => void }) {
  const stageColor = {
    ARRIVED: 'text-green-400 bg-green-900/30',
    IN_TRANSIT: 'text-blue-400 bg-blue-900/30',
    PENDING: 'text-amber-400 bg-amber-900/30',
    UNKNOWN: 'text-gray-400 bg-gray-800',
  }[s.stage] || 'text-gray-400 bg-gray-800';

  // Calculate cutoff urgency
  const getCutoffStatus = (cutoffDate?: string) => {
    if (!cutoffDate) return null;
    const now = new Date();
    const cutoff = new Date(cutoffDate);
    const hoursRemaining = (cutoff.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hoursRemaining < 0) return { status: 'passed', hours: 0 };
    if (hoursRemaining < 24) return { status: 'urgent', hours: Math.floor(hoursRemaining) };
    if (hoursRemaining < 48) return { status: 'soon', hours: Math.floor(hoursRemaining) };
    return { status: 'ok', hours: Math.floor(hoursRemaining) };
  };

  const siStatus = getCutoffStatus(s.siCutoff);
  const vgmStatus = getCutoffStatus(s.vgmCutoff);
  const hasCutoffs = siStatus || vgmStatus;

  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-gray-900 rounded-xl border border-gray-800 p-4 hover:border-pink-700/50 hover:bg-gray-900/80 transition-all group"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p className="font-mono font-bold text-white group-hover:text-pink-400 transition-colors">{s.bookingNumber}</p>
          <p className="text-sm text-gray-300 mt-1 truncate">
            {s.shipper || '?'} <span className="text-gray-600">→</span> {s.consignee || '?'}
          </p>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded ${stageColor}`}>{s.stage}</span>
      </div>
      <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
        <span className="font-mono">{s.pol || '?'} → {s.pod || '?'}</span>
        {s.etd && <span>ETD {formatDate(s.etd)}</span>}
        <span>{s.emailCount} emails</span>
        {s.containerCount > 0 && <span>{s.containerCount} ctr</span>}
      </div>
      {s.vessel && (
        <p className="text-xs text-gray-600 mt-1">🚢 {s.vessel}</p>
      )}
      {hasCutoffs && (
        <div className="flex items-center gap-3 mt-2 text-xs">
          {s.siCutoff && (
            <span className={`px-2 py-0.5 rounded ${
              siStatus?.status === 'passed' ? 'bg-gray-800 text-gray-500' :
              siStatus?.status === 'urgent' ? 'bg-red-900/30 text-red-400' :
              siStatus?.status === 'soon' ? 'bg-amber-900/30 text-amber-400' :
              'bg-gray-800 text-gray-400'
            }`}>
              SI: {formatDate(s.siCutoff)}
            </span>
          )}
          {s.vgmCutoff && (
            <span className={`px-2 py-0.5 rounded ${
              vgmStatus?.status === 'passed' ? 'bg-gray-800 text-gray-500' :
              vgmStatus?.status === 'urgent' ? 'bg-red-900/30 text-red-400' :
              vgmStatus?.status === 'soon' ? 'bg-amber-900/30 text-amber-400' :
              'bg-gray-800 text-gray-400'
            }`}>
              VGM: {formatDate(s.vgmCutoff)}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

function Section({ title, icon, alert, children }: {
  title?: string; icon?: string; alert?: boolean; children: React.ReactNode
}) {
  return (
    <div className={`bg-gray-900 rounded-xl border p-4 ${alert ? 'border-red-800' : 'border-gray-800'}`}>
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

// =============================================================================
// SHARE MODAL & COMPONENTS
// =============================================================================

function ShareModal({ dossier: d, onClose }: { dossier: Dossier; onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<'card' | 'docs' | 'link'>('card');
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Generate shareable text - comprehensive summary
  const generateShareText = useCallback((includeLink?: string) => {
    const lines = [
      `📦 *SHIPMENT UPDATE*`,
      `━━━━━━━━━━━━━━━━━━`,
      '',
      `*Booking:* ${d.bookingNumber}`,
      d.mblNumber ? `*MBL:* ${d.mblNumber}` : '',
      d.hblNumber ? `*HBL:* ${d.hblNumber}` : '',
      '',
      `🚢 *VESSEL & CARRIER*`,
      d.carrier ? `Carrier: ${d.carrier}` : '',
      d.vessel ? `Vessel: ${d.vessel}${d.voyage ? ` / ${d.voyage}` : ''}` : '',
      '',
      `📍 *ROUTE*`,
      `${d.pol || '?'} ────► ${d.pod || '?'}`,
      d.dates.etd ? `ETD: ${new Date(d.dates.etd).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}` : '',
      d.dates.atd ? `ATD: ${new Date(d.dates.atd).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ✓` : '',
      d.dates.eta ? `ETA: ${new Date(d.dates.eta).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}` : '',
      d.dates.ata ? `ATA: ${new Date(d.dates.ata).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ✓` : '',
      '',
      `📊 *STATUS*`,
      `Stage: ${d.stage}`,
      `Health Score: ${d.healthScore}/100`,
      '',
      `👥 *PARTIES*`,
      d.shipper ? `Shipper: ${d.shipper}` : '',
      d.consignee ? `Consignee: ${d.consignee}` : '',
      '',
      d.containerNumbers.length > 0 ? `📦 *CONTAINERS (${d.containerNumbers.length})*` : '',
      d.containerNumbers.length > 0 ? d.containerNumbers.join(', ') : '',
      '',
      d.cutoffs.length > 0 ? `⏰ *CUTOFFS*` : '',
      ...d.cutoffs.map(c => `${c.displayName}: ${new Date(c.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}${c.completed ? ' ✅' : ''}`),
      '',
      includeLink ? `🔗 *View Full Details:*` : '',
      includeLink ? includeLink : '',
      '',
      `━━━━━━━━━━━━━━━━━━`,
      `_Sent via Intoglo Pulse_`,
    ].filter(Boolean).join('\n');
    return lines;
  }, [d]);

  // Share via WhatsApp
  const shareWhatsApp = useCallback((text: string) => {
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  }, []);

  // Share via Email
  const shareEmail = useCallback((text: string, subject?: string) => {
    const subj = subject || `Shipment Update: ${d.bookingNumber}`;
    const url = `mailto:?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(text.replace(/\*/g, ''))}`;
    window.location.href = url;
  }, [d.bookingNumber]);

  // Generate shareable link using current domain
  const generateShareLink = useCallback(async () => {
    setGenerating(true);
    try {
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await fetch('/api/pulse/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingNumber: d.bookingNumber, baseUrl }),
      });
      const data = await res.json();
      if (data.success && data.shareUrl) {
        setShareLink(data.shareUrl);
      }
    } catch (err) {
      console.error('Failed to generate share link:', err);
    } finally {
      setGenerating(false);
    }
  }, [d.bookingNumber]);

  // Copy to clipboard
  const copyToClipboard = useCallback(async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  // Share selected documents with full URLs
  const shareSelectedDocs = useCallback((via: 'whatsapp' | 'email') => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    const docs = d.documents.filter(doc => selectedDocs.has(doc.id));

    const lines = [
      `📎 *DOCUMENTS*`,
      `*Shipment:* ${d.bookingNumber}`,
      `━━━━━━━━━━━━━━━━━━`,
      '',
      ...docs.map(doc => {
        const url = doc.emailViewUrl
          ? `${baseUrl}${doc.emailViewUrl}`
          : doc.gmailLink;
        return `📄 *${doc.displayName}*\nDate: ${formatDate(doc.receivedAt)}\nFrom: ${doc.fromParty}\n${url}`;
      }),
      '',
      `━━━━━━━━━━━━━━━━━━`,
      `_Sent via Intoglo Pulse_`,
    ];
    const text = lines.join('\n');

    if (via === 'whatsapp') {
      shareWhatsApp(text);
    } else {
      shareEmail(text, `Documents for Shipment ${d.bookingNumber}`);
    }
  }, [d, selectedDocs, shareWhatsApp, shareEmail]);

  // Toggle document selection
  const toggleDoc = (id: string) => {
    const newSet = new Set(selectedDocs);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedDocs(newSet);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-gray-900 rounded-t-2xl sm:rounded-2xl border border-gray-700 max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-800">
          <h2 className="text-lg font-semibold text-white">Share Shipment</h2>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-white">
            <CloseIcon />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800">
          <button
            onClick={() => setActiveTab('card')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'card' ? 'text-pink-400 border-b-2 border-pink-400' : 'text-gray-400'
            }`}
          >
            📇 Quick Card
          </button>
          <button
            onClick={() => setActiveTab('docs')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'docs' ? 'text-pink-400 border-b-2 border-pink-400' : 'text-gray-400'
            }`}
          >
            📎 Documents
          </button>
          <button
            onClick={() => setActiveTab('link')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === 'link' ? 'text-pink-400 border-b-2 border-pink-400' : 'text-gray-400'
            }`}
          >
            🔗 Link
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Quick Card Tab */}
          {activeTab === 'card' && (
            <div className="space-y-4">
              {/* Preview Card */}
              <div ref={cardRef} className="bg-gradient-to-br from-gray-800 to-gray-900 rounded-xl border border-gray-700 p-4 space-y-3">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-pink-900/50 flex items-center justify-center">
                      <svg className="w-5 h-5" viewBox="0 0 520 601" fill="none">
                        <path d="M0 600.517L346.711 0L520.064 300.259L346.711 600.517H0Z" fill="#E72566"/>
                        <path d="M0 0L346.711 600.518L520.064 300.258L346.711 0H0Z" fill="#E72566"/>
                        <path d="M129.111 376.892L173.355 300.257L346.711 600.517L129.111 376.892Z" fill="#8B001D"/>
                      </svg>
                    </div>
                    <span className="text-xs text-gray-400">intoglo PULSE</span>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded ${
                    d.healthScore >= 80 ? 'bg-green-900/50 text-green-400' :
                    d.healthScore >= 60 ? 'bg-amber-900/50 text-amber-400' :
                    'bg-red-900/50 text-red-400'
                  }`}>
                    {d.healthScore}/100
                  </span>
                </div>

                {/* Booking Info */}
                <div>
                  <p className="text-2xl font-bold font-mono text-white">{d.bookingNumber}</p>
                  <p className="text-sm text-gray-400">{d.carrier}{d.vessel ? ` • ${d.vessel}` : ''}</p>
                </div>

                {/* Route */}
                <div className="flex items-center justify-between bg-gray-900/50 rounded-lg p-3">
                  <div className="text-center">
                    <p className="text-lg font-bold text-blue-400 font-mono">{d.pol || '—'}</p>
                    <p className="text-xs text-gray-500">POL</p>
                    {d.dates.etd && <p className="text-xs text-gray-400">{formatDate(d.dates.etd)}</p>}
                  </div>
                  <div className="flex-1 px-4">
                    <div className="h-0.5 bg-gradient-to-r from-blue-500 to-green-500 relative">
                      <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-900 px-1 text-sm">✈️</span>
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-lg font-bold text-green-400 font-mono">{d.pod || '—'}</p>
                    <p className="text-xs text-gray-500">POD</p>
                    {d.dates.eta && <p className="text-xs text-gray-400">{formatDate(d.dates.eta)}</p>}
                  </div>
                </div>

                {/* Status Row */}
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Status</span>
                  <span className="font-medium text-white">{d.stage}</span>
                </div>

                {/* Parties */}
                {(d.shipper || d.consignee) && (
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {d.shipper && (
                      <div className="bg-gray-900/50 rounded p-2">
                        <p className="text-gray-500">Shipper</p>
                        <p className="text-gray-300 truncate">{d.shipper}</p>
                      </div>
                    )}
                    {d.consignee && (
                      <div className="bg-gray-900/50 rounded p-2">
                        <p className="text-gray-500">Consignee</p>
                        <p className="text-gray-300 truncate">{d.consignee}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Containers */}
                {d.containerNumbers.length > 0 && (
                  <div className="text-xs">
                    <span className="text-gray-500">Containers: </span>
                    <span className="text-gray-300">{d.containerNumbers.length} units</span>
                  </div>
                )}
              </div>

              {/* Share Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={() => shareWhatsApp(generateShareText())}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg bg-green-900/30 text-green-400 border border-green-800/50 hover:bg-green-900/50 transition-colors"
                >
                  <WhatsAppIcon /> WhatsApp
                </button>
                <button
                  onClick={() => shareEmail(generateShareText())}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg bg-blue-900/30 text-blue-400 border border-blue-800/50 hover:bg-blue-900/50 transition-colors"
                >
                  <EmailIcon /> Email
                </button>
              </div>
            </div>
          )}

          {/* Documents Tab */}
          {activeTab === 'docs' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400">Select documents to download or share:</p>

              {d.documents.length === 0 ? (
                <p className="text-center py-8 text-gray-500">No documents available</p>
              ) : (
                <div className="space-y-2">
                  {d.documents.map(doc => (
                    <div
                      key={doc.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                        selectedDocs.has(doc.id)
                          ? 'bg-pink-900/20 border-pink-700'
                          : 'bg-gray-800 border-gray-700'
                      }`}
                    >
                      {/* Checkbox */}
                      <button
                        onClick={() => toggleDoc(doc.id)}
                        className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 ${
                          selectedDocs.has(doc.id)
                            ? 'bg-pink-500 border-pink-500'
                            : 'border-gray-600 hover:border-gray-500'
                        }`}
                      >
                        {selectedDocs.has(doc.id) && (
                          <svg className="w-3 h-3 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        )}
                      </button>

                      {/* Document Info */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{doc.displayName}</p>
                        <p className="text-xs text-gray-500">{formatDate(doc.receivedAt)} • {doc.fromParty}</p>
                      </div>

                      {/* Download button if has attachment */}
                      {doc.hasAttachment && doc.attachmentUrl && (
                        <a
                          href={doc.attachmentUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="p-2 rounded-lg bg-blue-900/30 text-blue-400 hover:bg-blue-900/50 transition-colors"
                          title="Download PDF"
                        >
                          <DownloadIcon />
                        </a>
                      )}

                      {/* View button */}
                      <a
                        href={doc.emailViewUrl || doc.gmailLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
                        title="View Email"
                      >
                        <ViewIcon />
                      </a>
                    </div>
                  ))}
                </div>
              )}

              {/* Actions for Selected */}
              {selectedDocs.size > 0 && (
                <div className="space-y-2 pt-2 border-t border-gray-800">
                  <p className="text-xs text-gray-500">{selectedDocs.size} document(s) selected</p>

                  {/* Download Selected */}
                  <button
                    onClick={() => {
                      const docs = d.documents.filter(doc => selectedDocs.has(doc.id) && doc.attachmentUrl);
                      docs.forEach(doc => {
                        if (doc.attachmentUrl) {
                          window.open(doc.attachmentUrl, '_blank');
                        }
                      });
                    }}
                    className="w-full flex items-center justify-center gap-2 py-3 rounded-lg bg-purple-900/30 text-purple-400 border border-purple-800/50 hover:bg-purple-900/50 transition-colors"
                  >
                    <DownloadIcon /> Download {d.documents.filter(doc => selectedDocs.has(doc.id) && doc.attachmentUrl).length} PDFs
                  </button>

                  {/* Share Links */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => shareSelectedDocs('whatsapp')}
                      className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg bg-green-900/30 text-green-400 border border-green-800/50 hover:bg-green-900/50 transition-colors"
                    >
                      <WhatsAppIcon /> Links
                    </button>
                    <button
                      onClick={() => shareSelectedDocs('email')}
                      className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg bg-blue-900/30 text-blue-400 border border-blue-800/50 hover:bg-blue-900/50 transition-colors"
                    >
                      <EmailIcon /> Links
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Link Tab */}
          {activeTab === 'link' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400">Generate a shareable link that anyone can view:</p>

              {!shareLink ? (
                <button
                  onClick={generateShareLink}
                  disabled={generating}
                  className="w-full py-4 rounded-lg bg-pink-900/30 text-pink-400 border border-pink-800/50 hover:bg-pink-900/50 transition-colors disabled:opacity-50"
                >
                  {generating ? 'Generating...' : '🔗 Generate Shareable Link'}
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 p-3 bg-gray-800 rounded-lg border border-gray-700">
                    <input
                      type="text"
                      value={shareLink}
                      readOnly
                      className="flex-1 bg-transparent text-sm text-gray-300 outline-none"
                    />
                    <button
                      onClick={() => copyToClipboard(shareLink)}
                      className="px-3 py-1 text-sm bg-gray-700 rounded hover:bg-gray-600 transition-colors"
                    >
                      {copied ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>

                  <p className="text-xs text-gray-500">Link expires in 7 days</p>

                  <div className="flex gap-2">
                    <button
                      onClick={() => shareWhatsApp(generateShareText(shareLink))}
                      className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg bg-green-900/30 text-green-400 border border-green-800/50 hover:bg-green-900/50 transition-colors"
                    >
                      <WhatsAppIcon /> WhatsApp
                    </button>
                    <button
                      onClick={() => shareEmail(generateShareText(shareLink))}
                      className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg bg-blue-900/30 text-blue-400 border border-blue-800/50 hover:bg-blue-900/50 transition-colors"
                    >
                      <EmailIcon /> Email
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function WhatsAppIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  );
}

function EmailIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  );
}

function ShareIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  );
}

function ViewIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

function HighlightedSnippet({ text, keyword }: { text: string; keyword: string }) {
  if (!keyword) return <>{text}</>;

  const lowerText = text.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  const idx = lowerText.indexOf(lowerKeyword);

  if (idx === -1) return <>{text}</>;

  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + keyword.length);
  const after = text.slice(idx + keyword.length);

  return (
    <>
      {before}
      <span className="bg-yellow-500/30 text-yellow-300 font-medium px-0.5 rounded">{match}</span>
      {after}
    </>
  );
}

function StatBox({ label, value, color }: { label: string; value: number | string; color: 'blue' | 'green' | 'amber' | 'red' }) {
  const colorClass = {
    blue: 'text-blue-400',
    green: 'text-green-400',
    amber: 'text-amber-400',
    red: 'text-red-400',
  }[color];

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-3 text-center">
      <p className={`text-xl font-bold font-mono ${colorClass}`}>{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

function HealthBadge({ score }: { score: number }) {
  const color = score >= 80 ? 'bg-green-900/50 text-green-400' :
                score >= 60 ? 'bg-amber-900/50 text-amber-400' :
                'bg-red-900/50 text-red-400';
  const label = score >= 80 ? 'Healthy' : score >= 60 ? 'Attention' : 'Critical';

  return (
    <span className={`px-2 py-1 rounded-lg text-xs font-medium ${color}`}>
      {label} ({score})
    </span>
  );
}

function CutoffBadge({ status, completed, hours, date }: { status: string; completed?: boolean; hours?: number; date?: string }) {
  const dateStr = date ? formatDate(date) : '—';

  if (completed) {
    return <span className="text-green-400 text-xs font-medium">{dateStr} ✅</span>;
  }
  if (status === 'passed') {
    return <span className="text-red-400 text-xs font-medium">{dateStr} 🔴</span>;
  }
  if (status === 'today') {
    return <span className="text-red-400 text-xs font-medium">{dateStr} ⚠️ {hours}h</span>;
  }
  if (hours && hours > 0 && hours < 48) {
    return <span className="text-amber-400 text-xs">{dateStr} ⚠️ {hours}h</span>;
  }
  return <span className="text-gray-400 text-xs">{dateStr}</span>;
}

function FeedRow({ item }: { item: FeedItem }) {
  const isEscalation = item.type === 'escalation';

  const docIcons: Record<string, string> = {
    'booking_confirmation': '📋',
    'booking_amendment': '📝',
    'shipping_instructions': '📄',
    'si_confirmation': '✅',
    'vgm_confirmation': '⚖️',
    'draft_bl': '📜',
    'final_bl': '📜',
    'telex_release': '📨',
    'arrival_notice': '🚢',
    'delivery_order': '🚚',
    'invoice': '💵',
    'customs_entry': '🛃',
  };

  const icon = isEscalation ? '🚨' : docIcons[item.docType || ''] || '📧';

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-start gap-3 p-3 rounded-lg hover:bg-gray-800 transition-colors ${
        isEscalation ? 'bg-red-900/20 border border-red-800/50' : ''
      }`}
    >
      <span className="text-lg shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-medium ${isEscalation ? 'text-red-400' : 'text-gray-200'}`}>
            {item.displayName || (isEscalation ? 'Escalation' : 'Email')}
          </span>
          {item.hasAttachment && <span className="text-xs text-blue-400">📎</span>}
          {isEscalation && item.severity && (
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              item.severity === 'critical' ? 'bg-red-700 text-white' :
              item.severity === 'high' ? 'bg-orange-700 text-white' : 'bg-yellow-700 text-white'
            }`}>{item.severity}</span>
          )}
        </div>
        {item.subject && (
          <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{item.subject}</p>
        )}
        <div className="flex items-center gap-2 text-xs text-gray-600 mt-1">
          <span>{formatDateTime(item.date)}</span>
          {item.fromParty && <span>• {item.fromParty}</span>}
        </div>
      </div>
    </a>
  );
}

function Spinner({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  const cls = size === 'lg' ? 'w-8 h-8' : 'w-5 h-5';
  return <span className={`block ${cls} border-2 border-blue-500 border-t-transparent rounded-full animate-spin`} />;
}

function SearchIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  );
}

function BackIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function IntogloLogo() {
  return (
    <div className="flex items-center gap-2">
      {/* Intoglo diamond icon */}
      <svg className="w-6 h-6" viewBox="0 0 520 601" fill="none">
        <path d="M0 600.517L346.711 0L520.064 300.259L346.711 600.517H0Z" fill="#E72566"/>
        <path d="M0 0L346.711 600.518L520.064 300.258L346.711 0H0Z" fill="#E72566"/>
        <path d="M129.111 376.892L173.355 300.257L346.711 600.517L129.111 376.892Z" fill="#8B001D"/>
      </svg>
      {/* Intoglo text */}
      <span className="text-lg font-bold tracking-tight text-white">
        intoglo
      </span>
    </div>
  );
}

// =============================================================================
// HELPERS
// =============================================================================

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
