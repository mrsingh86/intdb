'use client';

import { useState, useEffect } from 'react';
import {
  BookOpen,
  RefreshCw,
  Link2,
  Users,
  Clock,
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import type { ShipmentStory, StakeholderSummary, NarrativeChain, ChainOfThoughtRecommendation } from '@/lib/chronicle-v2';
import { NarrativeChainCard } from './NarrativeChainCard';
import { StakeholderCard } from './StakeholderCard';
import { ChainOfThoughtPanel } from './ChainOfThoughtPanel';
import { DraftEmailModal } from './DraftEmailModal';

interface ShipmentStoryPanelProps {
  shipmentId: string;
  initialStory?: ShipmentStory;
}

type TabType = 'overview' | 'chains' | 'stakeholders' | 'timeline';

/**
 * ShipmentStoryPanel
 *
 * Main panel for displaying the complete shipment story with:
 * - Headline and current situation
 * - Narrative chains (cause-effect relationships)
 * - Stakeholder summaries
 * - Smart recommendations with chain-of-thought
 * - Timeline of key events
 */
export function ShipmentStoryPanel({ shipmentId, initialStory }: ShipmentStoryPanelProps) {
  const [story, setStory] = useState<ShipmentStory | null>(initialStory || null);
  const [loading, setLoading] = useState(!initialStory);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [showResolved, setShowResolved] = useState(false);

  // Draft email modal state
  const [draftEmailOpen, setDraftEmailOpen] = useState(false);
  const [selectedStakeholder, setSelectedStakeholder] = useState<StakeholderSummary | null>(null);
  const [selectedRecommendation, setSelectedRecommendation] = useState<ChainOfThoughtRecommendation | null>(null);
  const [selectedChain, setSelectedChain] = useState<NarrativeChain | null>(null);

  // Fetch story data
  useEffect(() => {
    if (!initialStory) {
      fetchStory();
    }
  }, [shipmentId, initialStory]);

  const fetchStory = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(`/api/chronicle-v2/shipments/${shipmentId}/story`);
      if (!response.ok) throw new Error('Failed to fetch story');
      const data = await response.json();
      setStory(data.story);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const refreshStory = async () => {
    try {
      setRefreshing(true);
      setError(null);
      const response = await fetch(`/api/chronicle-v2/shipments/${shipmentId}/story`, {
        method: 'POST',
      });
      if (!response.ok) throw new Error('Failed to refresh story');
      const data = await response.json();
      setStory(data.story);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setRefreshing(false);
    }
  };

  const handleResolveChain = async (chainId: string) => {
    try {
      await fetch(`/api/chronicle-v2/shipments/${shipmentId}/chains`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chainId, status: 'resolved' }),
      });
      await fetchStory();
    } catch (err) {
      console.error('Failed to resolve chain:', err);
    }
  };

  const handleDraftReply = (chainId: string | null) => {
    // Find the chain and related recommendation
    const chain = chainId
      ? [...(story?.activeChains || []), ...(story?.resolvedChains || [])].find(c => c.id === chainId)
      : null;

    const recommendation = story?.recommendations.find(r => r.relatedChainId === chainId);

    // Find suggested stakeholder from the chain
    let stakeholder: StakeholderSummary | null = null;
    if (chain?.currentStateParty) {
      stakeholder = story?.stakeholders.find(s =>
        s.partyType === chain.currentStateParty ||
        s.displayName.toLowerCase().includes(chain.currentStateParty?.toLowerCase() || '')
      ) || null;
    }

    // If no stakeholder found, use first suggested recipient from recommendation
    if (!stakeholder && recommendation?.suggestedRecipients.length) {
      const recipientName = recommendation.suggestedRecipients[0].toLowerCase();
      stakeholder = story?.stakeholders.find(s =>
        s.displayName.toLowerCase().includes(recipientName) ||
        s.partyType === recipientName
      ) || null;
    }

    setSelectedChain(chain || null);
    setSelectedRecommendation(recommendation || null);
    setSelectedStakeholder(stakeholder);
    setDraftEmailOpen(true);
  };

  const handleDraftEmailFromStakeholder = (stakeholder: StakeholderSummary) => {
    setSelectedStakeholder(stakeholder);
    setSelectedChain(null);
    setSelectedRecommendation(null);
    setDraftEmailOpen(true);
  };

  const handleCloseDraftEmail = () => {
    setDraftEmailOpen(false);
    setSelectedStakeholder(null);
    setSelectedRecommendation(null);
    setSelectedChain(null);
  };

  // Loading state
  if (loading) {
    return (
      <div
        className="rounded-lg border p-8 flex items-center justify-center"
        style={{ backgroundColor: 'var(--ink-surface)', borderColor: 'var(--ink-border-subtle)' }}
      >
        <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--ink-text-muted)' }} />
        <span className="ml-2 text-sm" style={{ color: 'var(--ink-text-muted)' }}>
          Loading story...
        </span>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        className="rounded-lg border p-8 text-center"
        style={{ backgroundColor: 'var(--ink-error-bg)', borderColor: 'var(--ink-error)' }}
      >
        <AlertTriangle size={24} style={{ color: 'var(--ink-error)' }} className="mx-auto mb-2" />
        <p className="text-sm" style={{ color: 'var(--ink-error)' }}>{error}</p>
        <button
          onClick={fetchStory}
          className="mt-3 text-xs px-3 py-1.5 rounded"
          style={{ backgroundColor: 'var(--ink-error)', color: 'white' }}
        >
          Retry
        </button>
      </div>
    );
  }

  if (!story) return null;

  const tabs: { id: TabType; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'chains', label: 'Chains', count: story.activeChains.length },
    { id: 'stakeholders', label: 'Stakeholders', count: story.stakeholders.length },
    { id: 'timeline', label: 'Timeline', count: story.keyMoments.length },
  ];

  return (
    <div className="space-y-4">
      {/* Header with headline */}
      <div
        className="rounded-lg border p-4"
        style={{ backgroundColor: 'var(--ink-surface)', borderColor: 'var(--ink-border-subtle)' }}
      >
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3">
            <BookOpen size={20} style={{ color: 'var(--ink-accent)' }} className="mt-0.5" />
            <div>
              <h3
                className="text-base font-semibold"
                style={{ color: 'var(--ink-text-primary)' }}
              >
                {story.headline}
              </h3>
              <p className="text-sm mt-1" style={{ color: 'var(--ink-text-secondary)' }}>
                {story.currentSituation}
              </p>
            </div>
          </div>

          {/* Refresh button */}
          <button
            onClick={refreshStory}
            disabled={refreshing}
            className="p-2 rounded transition-colors"
            style={{ backgroundColor: 'var(--ink-elevated)' }}
            title="Refresh story"
          >
            <RefreshCw
              size={16}
              className={refreshing ? 'animate-spin' : ''}
              style={{ color: 'var(--ink-text-muted)' }}
            />
          </button>
        </div>

        {/* Quick stats */}
        <div className="flex items-center gap-4 mt-4 pt-4 border-t" style={{ borderColor: 'var(--ink-border-subtle)' }}>
          <div className="flex items-center gap-2 text-xs">
            <Link2 size={14} style={{ color: 'var(--ink-text-muted)' }} />
            <span style={{ color: 'var(--ink-text-secondary)' }}>
              {story.activeChains.length} active chain{story.activeChains.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Users size={14} style={{ color: 'var(--ink-text-muted)' }} />
            <span style={{ color: 'var(--ink-text-secondary)' }}>
              {story.stakeholders.length} stakeholder{story.stakeholders.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <Clock size={14} style={{ color: 'var(--ink-text-muted)' }} />
            <span style={{ color: 'var(--ink-text-secondary)' }}>
              {story.keyMoments.length} key moment{story.keyMoments.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Recommendations panel */}
      {story.recommendations.length > 0 && (
        <ChainOfThoughtPanel
          recommendations={story.recommendations}
          onDraftReply={handleDraftReply}
        />
      )}

      {/* Tabs */}
      <div
        className="flex items-center gap-1 border-b"
        style={{ borderColor: 'var(--ink-border-subtle)' }}
      >
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className="px-4 py-2 text-sm transition-colors relative"
            style={{
              color: activeTab === tab.id ? 'var(--ink-accent)' : 'var(--ink-text-muted)',
              fontWeight: activeTab === tab.id ? 500 : 400,
            }}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span
                className="ml-1.5 text-xs px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: activeTab === tab.id ? 'var(--ink-accent-bg)' : 'var(--ink-elevated)',
                  color: activeTab === tab.id ? 'var(--ink-accent)' : 'var(--ink-text-muted)',
                }}
              >
                {tab.count}
              </span>
            )}
            {activeTab === tab.id && (
              <div
                className="absolute bottom-0 left-0 right-0 h-0.5"
                style={{ backgroundColor: 'var(--ink-accent)' }}
              />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-[200px]">
        {/* Overview tab */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {/* Active chains preview */}
            {story.activeChains.length > 0 && (
              <div>
                <h4
                  className="text-sm font-medium mb-2 flex items-center gap-2"
                  style={{ color: 'var(--ink-text-primary)' }}
                >
                  <AlertTriangle size={14} style={{ color: 'var(--ink-warning)' }} />
                  Active Issues ({story.activeChains.length})
                </h4>
                <div className="space-y-2">
                  {story.activeChains.slice(0, 3).map((chain) => (
                    <NarrativeChainCard
                      key={chain.id}
                      chain={chain}
                      onResolve={handleResolveChain}
                    />
                  ))}
                  {story.activeChains.length > 3 && (
                    <button
                      onClick={() => setActiveTab('chains')}
                      className="text-xs px-3 py-2 rounded w-full text-center transition-colors"
                      style={{ backgroundColor: 'var(--ink-elevated)', color: 'var(--ink-accent)' }}
                    >
                      View all {story.activeChains.length} chains
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Key stakeholders preview */}
            {story.stakeholders.length > 0 && (
              <div>
                <h4
                  className="text-sm font-medium mb-2 flex items-center gap-2"
                  style={{ color: 'var(--ink-text-primary)' }}
                >
                  <Users size={14} style={{ color: 'var(--ink-info)' }} />
                  Key Stakeholders
                </h4>
                <div className="space-y-2">
                  {story.stakeholders.slice(0, 3).map((stakeholder) => (
                    <StakeholderCard
                      key={stakeholder.id}
                      stakeholder={stakeholder}
                      onDraftEmail={handleDraftEmailFromStakeholder}
                    />
                  ))}
                  {story.stakeholders.length > 3 && (
                    <button
                      onClick={() => setActiveTab('stakeholders')}
                      className="text-xs px-3 py-2 rounded w-full text-center transition-colors"
                      style={{ backgroundColor: 'var(--ink-elevated)', color: 'var(--ink-accent)' }}
                    >
                      View all {story.stakeholders.length} stakeholders
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* No issues state */}
            {story.activeChains.length === 0 && (
              <div
                className="rounded-lg border p-6 text-center"
                style={{ backgroundColor: 'var(--ink-surface)', borderColor: 'var(--ink-border-subtle)' }}
              >
                <CheckCircle2 size={32} style={{ color: 'var(--ink-success)' }} className="mx-auto mb-2" />
                <p className="text-sm" style={{ color: 'var(--ink-text-secondary)' }}>
                  No active issues. Shipment is progressing normally.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Chains tab */}
        {activeTab === 'chains' && (
          <div className="space-y-3">
            {/* Show resolved toggle */}
            <div className="flex items-center justify-between">
              <span className="text-sm" style={{ color: 'var(--ink-text-muted)' }}>
                {story.activeChains.length} active, {story.resolvedChains.length} resolved
              </span>
              <button
                onClick={() => setShowResolved(!showResolved)}
                className="text-xs flex items-center gap-1"
                style={{ color: 'var(--ink-accent)' }}
              >
                {showResolved ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {showResolved ? 'Hide' : 'Show'} resolved
              </button>
            </div>

            {/* Active chains */}
            {story.activeChains.map((chain) => (
              <NarrativeChainCard
                key={chain.id}
                chain={chain}
                onResolve={handleResolveChain}
              />
            ))}

            {/* Resolved chains */}
            {showResolved && story.resolvedChains.length > 0 && (
              <div className="pt-3 border-t" style={{ borderColor: 'var(--ink-border-subtle)' }}>
                <h4
                  className="text-xs font-medium mb-2"
                  style={{ color: 'var(--ink-text-muted)' }}
                >
                  Resolved
                </h4>
                {story.resolvedChains.map((chain) => (
                  <NarrativeChainCard key={chain.id} chain={chain} />
                ))}
              </div>
            )}

            {story.activeChains.length === 0 && !showResolved && (
              <div
                className="rounded-lg border p-6 text-center"
                style={{ backgroundColor: 'var(--ink-surface)', borderColor: 'var(--ink-border-subtle)' }}
              >
                <CheckCircle2 size={24} style={{ color: 'var(--ink-success)' }} className="mx-auto mb-2" />
                <p className="text-sm" style={{ color: 'var(--ink-text-secondary)' }}>
                  No active chains
                </p>
              </div>
            )}
          </div>
        )}

        {/* Stakeholders tab */}
        {activeTab === 'stakeholders' && (
          <div className="space-y-2">
            {story.stakeholders.map((stakeholder) => (
              <StakeholderCard
                key={stakeholder.id}
                stakeholder={stakeholder}
                onDraftEmail={handleDraftEmailFromStakeholder}
              />
            ))}
            {story.stakeholders.length === 0 && (
              <div
                className="rounded-lg border p-6 text-center"
                style={{ backgroundColor: 'var(--ink-surface)', borderColor: 'var(--ink-border-subtle)' }}
              >
                <Users size={24} style={{ color: 'var(--ink-text-muted)' }} className="mx-auto mb-2" />
                <p className="text-sm" style={{ color: 'var(--ink-text-secondary)' }}>
                  No stakeholder data yet
                </p>
              </div>
            )}
          </div>
        )}

        {/* Timeline tab */}
        {activeTab === 'timeline' && (
          <div className="space-y-2">
            {story.keyMoments.map((event) => (
              <div
                key={event.id}
                className="flex items-start gap-3 p-3 rounded-lg border"
                style={{
                  backgroundColor: 'var(--ink-surface)',
                  borderColor: event.importance === 'critical'
                    ? 'var(--ink-error)'
                    : event.importance === 'high'
                    ? 'var(--ink-warning)'
                    : 'var(--ink-border-subtle)',
                  borderLeftWidth: '3px',
                }}
              >
                <div
                  className="text-xs font-medium whitespace-nowrap"
                  style={{ color: 'var(--ink-text-muted)' }}
                >
                  {new Date(event.occurredAt).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-sm font-medium"
                      style={{ color: 'var(--ink-text-primary)' }}
                    >
                      {event.headline}
                    </span>
                    {event.chainRole && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded uppercase"
                        style={{
                          backgroundColor: 'var(--ink-elevated)',
                          color: 'var(--ink-text-muted)',
                        }}
                      >
                        {event.chainRole}
                      </span>
                    )}
                  </div>
                  {event.partyDisplayName && (
                    <p className="text-xs" style={{ color: 'var(--ink-text-muted)' }}>
                      {event.partyDisplayName}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {story.keyMoments.length === 0 && (
              <div
                className="rounded-lg border p-6 text-center"
                style={{ backgroundColor: 'var(--ink-surface)', borderColor: 'var(--ink-border-subtle)' }}
              >
                <Clock size={24} style={{ color: 'var(--ink-text-muted)' }} className="mx-auto mb-2" />
                <p className="text-sm" style={{ color: 'var(--ink-text-secondary)' }}>
                  No key moments recorded
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Draft Email Modal */}
      <DraftEmailModal
        isOpen={draftEmailOpen}
        onClose={handleCloseDraftEmail}
        stakeholder={selectedStakeholder}
        shipmentId={shipmentId}
        bookingNumber={story.bookingNumber}
        recommendation={selectedRecommendation}
        relatedChain={selectedChain}
      />
    </div>
  );
}
