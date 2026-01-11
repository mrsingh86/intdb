'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { ShipmentLinkCandidate } from '@/types/shipment';

// Extended type with email data for deduplication
interface CandidateWithEmail extends ShipmentLinkCandidate {
  gmail_message_id?: string;
  true_sender_email?: string;
  sender_email?: string;
  subject?: string;
}

// Grouped candidate for display
interface GroupedCandidate {
  link_type: string;
  matched_value: string;
  true_sender: string;
  sender_display: string;
  versions: CandidateWithEmail[];
  latest: CandidateWithEmail;
  version_count: number;
  avg_confidence: number;
}

export default function LinkReviewPage() {
  const [candidates, setCandidates] = useState<CandidateWithEmail[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCandidates();
  }, []);

  const fetchCandidates = async () => {
    try {
      const response = await fetch('/api/shipments/link-candidates');
      const data = await response.json();
      setCandidates(data.candidates || []);
    } catch (error) {
      console.error('Failed to fetch link candidates:', error);
    } finally {
      setLoading(false);
    }
  };

  // Group candidates by (link_type + matched_value + true_sender), dedupe by gmail_message_id
  const groupedCandidates = useMemo((): GroupedCandidate[] => {
    const seen = new Set<string>(); // Track gmail_message_ids to dedupe group forwards
    const groups = new Map<string, CandidateWithEmail[]>();

    for (const candidate of candidates) {
      // Skip if we've already seen this gmail_message_id (forwarded to multiple groups)
      if (candidate.gmail_message_id && seen.has(candidate.gmail_message_id)) {
        continue;
      }
      if (candidate.gmail_message_id) {
        seen.add(candidate.gmail_message_id);
      }

      const trueSender = candidate.true_sender_email || candidate.sender_email || 'unknown';
      const key = `${candidate.link_type}|${candidate.matched_value}|${trueSender}`;

      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(candidate);
    }

    // Convert to grouped candidates, sorted by latest date
    return Array.from(groups.entries())
      .map(([, versions]) => {
        // Sort by date descending to get latest first
        versions.sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        const latest = versions[0];
        const trueSender = latest.true_sender_email || latest.sender_email || 'unknown';

        return {
          link_type: latest.link_type,
          matched_value: latest.matched_value,
          true_sender: trueSender,
          sender_display: trueSender.split('@')[1] || trueSender,
          versions,
          latest,
          version_count: versions.length,
          avg_confidence: Math.round(
            versions.reduce((sum, v) => sum + v.confidence_score, 0) / versions.length
          ),
        };
      })
      .sort((a, b) => b.avg_confidence - a.avg_confidence);
  }, [candidates]);

  // Confirm all versions in a group
  const handleConfirmGroup = async (group: GroupedCandidate) => {
    try {
      // Confirm all versions
      for (const version of group.versions) {
        await fetch('/api/shipments/link-candidates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ candidate_id: version.id }),
        });
      }
      alert(`Link confirmed for ${group.version_count} version(s)!`);
      await fetchCandidates();
    } catch (error) {
      console.error('Failed to confirm link:', error);
      alert('Failed to confirm link');
    }
  };

  // Reject all versions in a group
  const handleRejectGroup = async (group: GroupedCandidate) => {
    const reason = prompt('Why are you rejecting this link?');
    if (!reason) return;

    try {
      // Reject all versions
      for (const version of group.versions) {
        await fetch('/api/shipments/link-candidates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            candidate_id: version.id,
            action: 'reject',
            reason: reason,
          }),
        });
      }
      alert(`Link rejected for ${group.version_count} version(s)!`);
      await fetchCandidates();
    } catch (error) {
      console.error('Failed to reject link:', error);
      alert('Failed to reject link');
    }
  };

  const getConfidenceBadgeClass = (score: number) => {
    if (score >= 85) return 'bg-terminal-green/20 text-terminal-green';
    if (score >= 60) return 'bg-terminal-amber/20 text-terminal-amber';
    return 'bg-terminal-red/20 text-terminal-red';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-terminal-bg p-8">
        <div className="max-w-7xl mx-auto">
          <div className="text-center py-12 text-terminal-muted font-mono">
            <span className="inline-block animate-pulse">Loading link candidates...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-terminal-bg p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link href="/shipments" className="text-terminal-blue hover:text-terminal-green mb-4 inline-block font-mono text-sm">
            [← back to shipments]
          </Link>
          <h1 className="text-2xl font-semibold text-terminal-text mb-1 flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-terminal-blue"></span>
            Link Review
            <span className="text-xs font-mono text-terminal-muted">~/orion/link-review</span>
          </h1>
          <p className="text-terminal-muted font-mono text-sm">
            AI-generated linking suggestions requiring manual review (confidence 60-84%)
          </p>
        </div>

        {/* Stats */}
        <div className="bg-terminal-surface rounded-lg border border-terminal-border p-6 mb-6">
          <div className="grid grid-cols-4 gap-6">
            <div>
              <div className="text-sm text-terminal-muted font-mono uppercase tracking-wide">Unique Links</div>
              <div className="text-3xl font-bold font-mono text-terminal-blue">{groupedCandidates.length}</div>
            </div>
            <div>
              <div className="text-sm text-terminal-muted font-mono uppercase tracking-wide">Total Versions</div>
              <div className="text-3xl font-bold font-mono text-terminal-muted">
                {groupedCandidates.reduce((sum, g) => sum + g.version_count, 0)}
              </div>
            </div>
            <div>
              <div className="text-sm text-terminal-muted font-mono uppercase tracking-wide">Avg Confidence</div>
              <div className="text-3xl font-bold font-mono text-terminal-amber">
                {groupedCandidates.length > 0
                  ? Math.round(
                      groupedCandidates.reduce((sum, g) => sum + g.avg_confidence, 0) / groupedCandidates.length
                    )
                  : 0}%
              </div>
            </div>
            <div>
              <div className="text-sm text-terminal-muted font-mono uppercase tracking-wide">High Confidence</div>
              <div className="text-3xl font-bold font-mono text-terminal-green">
                {groupedCandidates.filter(g => g.avg_confidence >= 75).length}
              </div>
            </div>
          </div>
        </div>

        {/* Candidates List */}
        <div className="space-y-4">
          {groupedCandidates.length === 0 ? (
            <div className="bg-terminal-surface rounded-lg border border-terminal-border p-12 text-center">
              <div className="mb-4">
                <svg
                  className="mx-auto h-12 w-12 text-terminal-green"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <h3 className="text-lg font-medium text-terminal-green mb-2 font-mono">
                No pending link candidates
              </h3>
              <p className="text-terminal-muted font-mono text-sm">
                All emails have been automatically linked or require no linking
              </p>
            </div>
          ) : (
            groupedCandidates.map((group) => (
              <div key={`${group.link_type}-${group.matched_value}-${group.true_sender}`} className="bg-terminal-surface rounded-lg border border-terminal-border p-6">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-3">
                      <h3 className="text-lg font-semibold">
                        Link Type: {group.link_type.replace('_', ' ').toUpperCase()}
                      </h3>
                      <span
                        className={`px-2 py-1 text-xs font-medium rounded-full ${getConfidenceBadgeClass(
                          group.avg_confidence
                        )}`}
                      >
                        {group.avg_confidence}% Confidence
                      </span>
                      {group.version_count > 1 && (
                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-terminal-blue/20 text-terminal-blue">
                          {group.version_count} versions
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-4 mb-4">
                      <div>
                        <div className="text-sm text-terminal-muted">Matched Value</div>
                        <div className="text-base font-medium">{group.matched_value}</div>
                      </div>
                      <div>
                        <div className="text-sm text-terminal-muted">From</div>
                        <div className="text-base font-medium">{group.sender_display}</div>
                      </div>
                      <div>
                        <div className="text-sm text-terminal-muted">Email</div>
                        <Link
                          href={`/emails/${group.latest.email_id}`}
                          className="text-base text-terminal-blue hover:text-terminal-green"
                        >
                          View Latest →
                        </Link>
                      </div>
                    </div>

                    {group.latest.match_reasoning && (
                      <div className="mb-4">
                        <div className="text-sm text-terminal-muted">AI Reasoning</div>
                        <div className="text-base text-terminal-muted italic">
                          {group.latest.match_reasoning}
                        </div>
                      </div>
                    )}

                    {group.latest.shipment_id && (
                      <div className="mb-4">
                        <div className="text-sm text-terminal-muted">Suggested Shipment</div>
                        <Link
                          href={`/shipments/${group.latest.shipment_id}`}
                          className="text-base text-terminal-blue hover:text-terminal-green"
                        >
                          View Shipment →
                        </Link>
                      </div>
                    )}

                    <div className="text-xs text-terminal-muted">
                      Latest: {new Date(group.latest.created_at).toLocaleString()}
                    </div>
                  </div>

                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => handleConfirmGroup(group)}
                      className="px-4 py-2 bg-terminal-green/20 text-terminal-green border border-terminal-green/30 rounded-lg hover:bg-terminal-green/30 font-mono text-sm transition-colors"
                    >
                      Confirm{group.version_count > 1 ? ` All (${group.version_count})` : ''}
                    </button>
                    <button
                      onClick={() => handleRejectGroup(group)}
                      className="px-4 py-2 bg-terminal-red/20 text-terminal-red border border-terminal-red/30 rounded-lg hover:bg-terminal-red/30 font-mono text-sm transition-colors"
                    >
                      Reject{group.version_count > 1 ? ' All' : ''}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
