/**
 * ShipmentStoryService
 *
 * Assembles the complete shipment story by combining:
 * - Narrative chains (cause-effect relationships)
 * - Stakeholder summaries (party behavior)
 * - Story events (unified timeline)
 *
 * Generates smart recommendations with full chain-of-thought reasoning.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { NarrativeChainService } from './narrative-chain-service';
import { StakeholderAnalysisService } from './stakeholder-analysis-service';
import type {
  ShipmentStory,
  NarrativeChain,
  StakeholderSummary,
  StoryEvent,
  ChainOfThoughtRecommendation,
  DraftReplyContext,
  EventImportance,
  ChainRole,
} from '../types';

// =============================================================================
// TYPES
// =============================================================================

interface ChronicleRecord {
  id: string;
  shipment_id: string;
  thread_id: string;
  direction: string;
  from_party: string;
  from_address: string;
  subject: string | null;
  message_type: string;
  sentiment: string;
  summary: string;
  has_issue: boolean;
  issue_type: string | null;
  issue_description: string | null;
  has_action: boolean;
  action_description: string | null;
  action_owner: string | null;
  action_deadline: string | null;
  action_completed_at: string | null;
  action_priority: string | null;
  document_type: string | null;
  occurred_at: string;
}

interface ShipmentRecord {
  id: string;
  booking_number: string | null;
  mbl_number: string | null;
  hbl_number: string | null;
  status: string;
  stage: string | null;
  carrier_name: string | null;
  vessel_name: string | null;
  etd: string | null;
  eta: string | null;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function daysBetween(from: Date, to: Date): number {
  const fromDate = new Date(from);
  fromDate.setHours(0, 0, 0, 0);
  const toDate = new Date(to);
  toDate.setHours(0, 0, 0, 0);
  return Math.floor((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
}

function formatPartyName(party: string): string {
  const partyMap: Record<string, string> = {
    carrier: 'Shipping Line',
    ocean_carrier: 'Shipping Line',
    customer: 'Customer',
    broker: 'Customs Broker',
    customs_broker: 'Customs Broker',
    trucker: 'Trucker',
    terminal: 'Terminal',
    intoglo: 'Operations',
    operations: 'Operations',
    unknown: 'Unknown Party',
  };
  return partyMap[party] || party;
}

function determineEventImportance(chronicle: ChronicleRecord): EventImportance {
  // Critical: active issues with urgent sentiment or overdue actions
  if (chronicle.has_issue && chronicle.sentiment === 'urgent') return 'critical';
  if (
    chronicle.has_action &&
    !chronicle.action_completed_at &&
    chronicle.action_deadline &&
    new Date(chronicle.action_deadline) < new Date()
  ) {
    return 'critical';
  }

  // High: issues, actions due soon, urgent messages
  if (chronicle.has_issue) return 'high';
  if (chronicle.sentiment === 'urgent') return 'high';
  if (
    chronicle.has_action &&
    !chronicle.action_completed_at &&
    chronicle.action_deadline
  ) {
    const daysToDeadline = daysBetween(new Date(), new Date(chronicle.action_deadline));
    if (daysToDeadline <= 2) return 'high';
  }

  // Normal: regular communications
  if (chronicle.direction === 'inbound') return 'normal';

  // Low: outbound/acknowledgements
  if (chronicle.message_type === 'acknowledgement') return 'low';

  return 'normal';
}

function isKeyMoment(chronicle: ChronicleRecord): boolean {
  // Key moments: issues, important documents, significant events
  if (chronicle.has_issue) return true;
  if (chronicle.sentiment === 'urgent') return true;
  if (
    chronicle.document_type === 'booking_confirmation' ||
    chronicle.document_type === 'final_bl' ||
    chronicle.document_type === 'arrival_notice' ||
    chronicle.document_type === 'delivery_order'
  ) {
    return true;
  }
  if (chronicle.message_type === 'issue_reported') return true;
  if (chronicle.message_type === 'escalation') return true;

  return false;
}

// =============================================================================
// SERVICE CLASS
// =============================================================================

export class ShipmentStoryService {
  private chainService: NarrativeChainService;
  private stakeholderService: StakeholderAnalysisService;

  constructor(private supabase: SupabaseClient) {
    this.chainService = new NarrativeChainService(supabase);
    this.stakeholderService = new StakeholderAnalysisService(supabase);
  }

  // ---------------------------------------------------------------------------
  // MAIN STORY ASSEMBLY
  // ---------------------------------------------------------------------------

  /**
   * Get the complete shipment story.
   */
  async getShipmentStory(shipmentId: string): Promise<ShipmentStory | null> {
    // Get shipment info
    const { data: shipment, error: shipmentError } = await this.supabase
      .from('shipments')
      .select('*')
      .eq('id', shipmentId)
      .single();

    if (shipmentError || !shipment) {
      console.error('[ShipmentStoryService] Error fetching shipment:', shipmentError);
      return null;
    }

    // Get narrative chains
    const activeChains = await this.chainService.getActiveChains(shipmentId);
    const allChains = await this.chainService.getAllChains(shipmentId);
    const resolvedChains = allChains.filter((c) => c.chainStatus === 'resolved');

    // Get stakeholder summaries
    const stakeholders = await this.stakeholderService.getStakeholderSummaries(shipmentId);

    // Get story events
    const timeline = await this.getStoryEvents(shipmentId);
    const keyMoments = timeline.filter((e) => e.isKeyMoment);

    // Generate recommendations
    const recommendations = await this.generateRecommendations(
      shipment,
      activeChains,
      stakeholders,
      timeline
    );

    // Build draft reply context
    const draftReplyContext = await this.buildDraftReplyContext(
      shipmentId,
      activeChains,
      timeline
    );

    // Generate headline and situation summary
    const { headline, currentSituation } = this.generateHeadlineAndSituation(
      shipment,
      activeChains,
      stakeholders,
      timeline
    );

    return {
      shipmentId,
      bookingNumber: shipment.booking_number,
      headline,
      currentSituation,
      activeChains,
      resolvedChains,
      stakeholders,
      timeline,
      keyMoments,
      recommendations,
      primaryRecommendation: recommendations.length > 0 ? recommendations[0] : null,
      draftReplyContext,
      lastUpdated: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // STORY EVENTS
  // ---------------------------------------------------------------------------

  /**
   * Get story events for a shipment.
   */
  async getStoryEvents(shipmentId: string): Promise<StoryEvent[]> {
    // First check if story events exist in database
    const { data: existingEvents, error: eventError } = await this.supabase
      .from('shipment_story_events')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('occurred_at', { ascending: false });

    if (!eventError && existingEvents && existingEvents.length > 0) {
      return existingEvents.map(this.mapDbToStoryEvent);
    }

    // Generate story events from chronicle
    return this.generateStoryEventsFromChronicle(shipmentId);
  }

  /**
   * Generate story events from chronicle data.
   */
  private async generateStoryEventsFromChronicle(shipmentId: string): Promise<StoryEvent[]> {
    const { data: chronicles, error } = await this.supabase
      .from('chronicle')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('occurred_at', { ascending: false });

    if (error || !chronicles) {
      console.error('[ShipmentStoryService] Error fetching chronicles:', error);
      return [];
    }

    const now = new Date();
    const events: StoryEvent[] = [];

    for (const chronicle of chronicles) {
      const event = this.chronicleToStoryEvent(chronicle, now);
      events.push(event);
    }

    // Save generated events
    await this.saveStoryEvents(events);

    return events;
  }

  /**
   * Convert chronicle record to story event.
   */
  private chronicleToStoryEvent(chronicle: ChronicleRecord, now: Date): StoryEvent {
    const occurredAt = new Date(chronicle.occurred_at);

    // Determine event category
    let category: StoryEvent['category'] = 'communication';
    if (chronicle.has_issue) category = 'issue';
    else if (chronicle.has_action) category = 'action';
    else if (chronicle.document_type) category = 'document';

    // Generate headline
    let headline = chronicle.summary;
    if (chronicle.has_issue && chronicle.issue_description) {
      headline = `${formatPartyName(chronicle.from_party)} reported: ${chronicle.issue_type || 'Issue'}`;
    } else if (chronicle.has_action && chronicle.action_description) {
      headline = `Action required: ${chronicle.action_description}`;
    }

    return {
      id: `event_${chronicle.id}`,
      shipmentId: chronicle.shipment_id,
      sourceType: 'chronicle',
      sourceId: chronicle.id,
      category,
      eventType: chronicle.has_issue
        ? chronicle.issue_type || 'issue'
        : chronicle.message_type,
      headline: headline.slice(0, 150),
      detail: chronicle.has_issue
        ? chronicle.issue_description
        : chronicle.summary,
      fromParty: chronicle.from_party,
      toParty: chronicle.direction === 'inbound' ? 'operations' : null,
      partyDisplayName: formatPartyName(chronicle.from_party),
      importance: determineEventImportance(chronicle),
      isKeyMoment: isKeyMoment(chronicle),
      chainId: null, // Will be linked during chain detection
      chainPosition: null,
      chainRole: null,
      relatedIssueType: chronicle.issue_type,
      relatedActionId: chronicle.has_action ? chronicle.id : null,
      occurredAt: chronicle.occurred_at,
      daysAgo: daysBetween(occurredAt, now),
      requiresResponse:
        chronicle.direction === 'inbound' &&
        (chronicle.message_type === 'action_required' ||
          chronicle.message_type === 'request' ||
          chronicle.message_type === 'query'),
      responseReceived: false, // Will be computed during chain analysis
      responseDeadline: chronicle.action_deadline,
    };
  }

  /**
   * Save story events to database.
   */
  private async saveStoryEvents(events: StoryEvent[]): Promise<void> {
    for (const event of events) {
      const dbRecord = {
        shipment_id: event.shipmentId,
        source_type: event.sourceType,
        source_id: event.sourceId,
        event_category: event.category,
        event_type: event.eventType,
        event_headline: event.headline,
        event_detail: event.detail,
        from_party: event.fromParty,
        to_party: event.toParty,
        party_display_name: event.partyDisplayName,
        importance: event.importance,
        is_key_moment: event.isKeyMoment,
        narrative_chain_id: event.chainId,
        chain_position: event.chainPosition,
        chain_role: event.chainRole,
        related_issue_type: event.relatedIssueType,
        related_action_id: event.relatedActionId,
        occurred_at: event.occurredAt,
        days_ago: event.daysAgo,
        requires_response: event.requiresResponse,
        response_received: event.responseReceived,
        response_deadline: event.responseDeadline,
      };

      const { error } = await this.supabase
        .from('shipment_story_events')
        .upsert(dbRecord, {
          onConflict: 'source_type,source_id',
          ignoreDuplicates: false,
        });

      if (error) {
        // Ignore duplicate errors since source_type,source_id might not be unique constraint
        if (!error.message?.includes('duplicate')) {
          console.error('[ShipmentStoryService] Error saving story event:', error);
        }
      }
    }
  }

  /**
   * Map database record to StoryEvent.
   */
  private mapDbToStoryEvent(record: Record<string, unknown>): StoryEvent {
    return {
      id: record.id as string,
      shipmentId: record.shipment_id as string,
      sourceType: record.source_type as StoryEvent['sourceType'],
      sourceId: record.source_id as string | null,
      category: record.event_category as StoryEvent['category'],
      eventType: record.event_type as string,
      headline: record.event_headline as string,
      detail: record.event_detail as string | null,
      fromParty: record.from_party as string | null,
      toParty: record.to_party as string | null,
      partyDisplayName: record.party_display_name as string | null,
      importance: record.importance as EventImportance,
      isKeyMoment: record.is_key_moment as boolean,
      chainId: record.narrative_chain_id as string | null,
      chainPosition: record.chain_position as number | null,
      chainRole: record.chain_role as ChainRole | null,
      relatedIssueType: record.related_issue_type as string | null,
      relatedActionId: record.related_action_id as string | null,
      occurredAt: record.occurred_at as string,
      daysAgo: record.days_ago as number,
      requiresResponse: record.requires_response as boolean,
      responseReceived: record.response_received as boolean,
      responseDeadline: record.response_deadline as string | null,
    };
  }

  // ---------------------------------------------------------------------------
  // RECOMMENDATIONS
  // ---------------------------------------------------------------------------

  /**
   * Generate smart recommendations with chain-of-thought reasoning.
   */
  private async generateRecommendations(
    shipment: ShipmentRecord,
    chains: NarrativeChain[],
    stakeholders: StakeholderSummary[],
    timeline: StoryEvent[]
  ): Promise<ChainOfThoughtRecommendation[]> {
    const recommendations: ChainOfThoughtRecommendation[] = [];

    // 1. Check for active issue chains
    const issueChains = chains.filter(
      (c) => c.chainType === 'issue_to_action' && c.chainStatus === 'active'
    );
    for (const chain of issueChains) {
      const rec = this.buildIssueChainRecommendation(chain, stakeholders);
      if (rec) recommendations.push(rec);
    }

    // 2. Check for pending communication chains
    const commChains = chains.filter(
      (c) => c.chainType === 'communication_chain' && c.chainStatus === 'active'
    );
    for (const chain of commChains) {
      const rec = this.buildCommunicationRecommendation(chain, stakeholders);
      if (rec) recommendations.push(rec);
    }

    // 3. Check for delay chains
    const delayChains = chains.filter(
      (c) => c.chainType === 'delay_chain' && c.chainStatus === 'active'
    );
    for (const chain of delayChains) {
      const rec = this.buildDelayChainRecommendation(chain, stakeholders, shipment);
      if (rec) recommendations.push(rec);
    }

    // 4. Check for stakeholders needing follow-up
    const needFollowup = stakeholders.filter(
      (s) => s.responsiveness.unansweredCount > 0 || (s.stats.daysSinceLastContact && s.stats.daysSinceLastContact > 5)
    );
    for (const stakeholder of needFollowup) {
      const rec = this.buildFollowupRecommendation(stakeholder);
      if (rec) recommendations.push(rec);
    }

    // Sort by priority
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    recommendations.sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
    );

    return recommendations;
  }

  /**
   * Build recommendation for issue chain.
   */
  private buildIssueChainRecommendation(
    chain: NarrativeChain,
    stakeholders: StakeholderSummary[]
  ): ChainOfThoughtRecommendation | null {
    const partyStakeholder = stakeholders.find(
      (s) => s.partyType === chain.trigger.party
    );

    const hasOverdueActions = chain.events.some(
      (e) =>
        e.eventType === 'action_required' &&
        chain.resolution.deadline &&
        new Date(chain.resolution.deadline) < new Date()
    );

    const priority = hasOverdueActions ? 'critical' : 'high';

    // Build chain of thought
    const chainOfThought = [
      `1. ${formatPartyName(chain.trigger.party || 'Unknown')} reported ${chain.trigger.eventType} on ${new Date(chain.trigger.occurredAt).toLocaleDateString()} (${chain.trigger.daysAgo} days ago)`,
      `2. Issue summary: "${chain.trigger.summary}"`,
      chain.events.length > 0
        ? `3. ${chain.events.length} related action(s) detected`
        : '3. No actions have been taken yet',
      `4. Current state: ${chain.currentState}`,
      chain.currentStateParty
        ? `5. Waiting on: ${formatPartyName(chain.currentStateParty)}`
        : '5. No specific party blocking',
      partyStakeholder
        ? `6. ${partyStakeholder.displayName} response pattern: ${partyStakeholder.responsiveness.behaviorPattern}`
        : '',
      hasOverdueActions
        ? '7. ⚠️ Action deadline has passed - escalation may be needed'
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      action: hasOverdueActions
        ? `Escalate ${chain.trigger.eventType} - deadline passed`
        : `Address ${chain.trigger.eventType} reported by ${formatPartyName(chain.trigger.party || 'Unknown')}`,
      priority,
      reason: chain.currentState,
      chainOfThought,
      suggestedRecipients: chain.currentStateParty
        ? [formatPartyName(chain.currentStateParty)]
        : [],
      relatedChainId: chain.id,
    };
  }

  /**
   * Build recommendation for communication chain.
   */
  private buildCommunicationRecommendation(
    chain: NarrativeChain,
    stakeholders: StakeholderSummary[]
  ): ChainOfThoughtRecommendation | null {
    const daysWaiting = chain.daysInCurrentState;
    const priority = daysWaiting > 3 ? 'high' : daysWaiting > 1 ? 'medium' : 'low';

    const chainOfThought = [
      `1. ${formatPartyName(chain.trigger.party || 'Unknown')} sent message on ${new Date(chain.trigger.occurredAt).toLocaleDateString()}`,
      `2. Message type: ${chain.trigger.eventType}`,
      `3. Summary: "${chain.trigger.summary.slice(0, 100)}..."`,
      `4. Days waiting for response: ${daysWaiting}`,
      daysWaiting > 2 ? '5. ⚠️ Response delayed - may impact relationship' : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      action: `Respond to ${formatPartyName(chain.trigger.party || 'Unknown')} (${daysWaiting}d waiting)`,
      priority,
      reason: `${formatPartyName(chain.trigger.party || 'Unknown')} is awaiting response`,
      chainOfThought,
      suggestedRecipients: [formatPartyName(chain.trigger.party || 'Unknown')],
      relatedChainId: chain.id,
    };
  }

  /**
   * Build recommendation for delay chain.
   */
  private buildDelayChainRecommendation(
    chain: NarrativeChain,
    stakeholders: StakeholderSummary[],
    shipment: ShipmentRecord
  ): ChainOfThoughtRecommendation | null {
    const daysInState = chain.daysInCurrentState;
    const priority = daysInState > 3 ? 'critical' : 'high';

    const chainOfThought = [
      `1. ${chain.trigger.eventType} reported on ${new Date(chain.trigger.occurredAt).toLocaleDateString()} (${chain.trigger.daysAgo}d ago)`,
      `2. Reported by: ${formatPartyName(chain.trigger.party || 'Unknown')}`,
      shipment.etd ? `3. Original ETD: ${new Date(shipment.etd).toLocaleDateString()}` : '',
      chain.impact.delayDays
        ? `4. Estimated delay impact: ${chain.impact.delayDays} days`
        : '',
      `5. Current status: ${chain.currentState}`,
      `6. Days since last update: ${daysInState}`,
      daysInState > 2
        ? '7. ⚠️ No update received - follow up recommended'
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      action: `Follow up with ${formatPartyName(chain.currentStateParty || 'Carrier')} for ${chain.narrativeHeadline || 'schedule update'}`,
      priority,
      reason: `No update for ${daysInState} days on ${chain.trigger.eventType}`,
      chainOfThought,
      suggestedRecipients: [formatPartyName(chain.currentStateParty || 'Carrier')],
      relatedChainId: chain.id,
    };
  }

  /**
   * Build follow-up recommendation for stakeholder.
   */
  private buildFollowupRecommendation(
    stakeholder: StakeholderSummary
  ): ChainOfThoughtRecommendation | null {
    const hasUnanswered = stakeholder.responsiveness.unansweredCount > 0;
    const daysGone = stakeholder.stats.daysSinceLastContact || 0;

    const priority = hasUnanswered ? 'medium' : 'low';

    const chainOfThought = [
      `1. Stakeholder: ${stakeholder.displayName} (${stakeholder.partyType})`,
      `2. Last contact: ${stakeholder.stats.lastContact ? new Date(stakeholder.stats.lastContact).toLocaleDateString() : 'Unknown'}`,
      `3. Days since last contact: ${daysGone}`,
      hasUnanswered
        ? `4. ${stakeholder.responsiveness.unansweredCount} message(s) sent without response`
        : '',
      `5. Behavior pattern: ${stakeholder.responsiveness.behaviorPattern}`,
      stakeholder.responsiveness.behaviorNotes
        ? `6. Notes: ${stakeholder.responsiveness.behaviorNotes}`
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    return {
      action: hasUnanswered
        ? `Follow up with ${stakeholder.displayName} - ${stakeholder.responsiveness.unansweredCount} pending`
        : `Check in with ${stakeholder.displayName} (${daysGone}d no contact)`,
      priority,
      reason: hasUnanswered
        ? `${stakeholder.responsiveness.unansweredCount} message(s) unanswered`
        : `No communication for ${daysGone} days`,
      chainOfThought,
      suggestedRecipients: [stakeholder.displayName],
      relatedChainId: null,
    };
  }

  // ---------------------------------------------------------------------------
  // DRAFT REPLY CONTEXT
  // ---------------------------------------------------------------------------

  /**
   * Build context for draft reply generation.
   */
  private async buildDraftReplyContext(
    shipmentId: string,
    chains: NarrativeChain[],
    timeline: StoryEvent[]
  ): Promise<DraftReplyContext | null> {
    // Find the most recent inbound message requiring response
    const { data: recentInbound, error } = await this.supabase
      .from('chronicle')
      .select('*')
      .eq('shipment_id', shipmentId)
      .eq('direction', 'inbound')
      .in('message_type', ['action_required', 'request', 'query', 'issue_reported'])
      .order('occurred_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !recentInbound) return null;

    // Find relevant chain
    const relatedChain = chains.find(
      (c) =>
        c.trigger.chronicleId === recentInbound.id ||
        c.events.some((e) => e.chronicleId === recentInbound.id)
    );

    // Determine suggested tone
    let suggestedTone: DraftReplyContext['suggestedTone'] = 'formal';
    if (recentInbound.sentiment === 'urgent') suggestedTone = 'urgent';
    if (recentInbound.sentiment === 'positive') suggestedTone = 'friendly';

    // Build key points to address
    const keyPoints: string[] = [];
    if (recentInbound.has_issue) {
      keyPoints.push(`Address ${recentInbound.issue_type || 'issue'} reported`);
    }
    if (recentInbound.has_action) {
      keyPoints.push(`Respond to action: ${recentInbound.action_description}`);
    }
    if (relatedChain) {
      keyPoints.push(`Reference ongoing ${relatedChain.chainType.replace(/_/g, ' ')}`);
    }

    return {
      lastMessageFrom: formatPartyName(recentInbound.from_party),
      lastMessageSubject: recentInbound.subject,
      lastMessageChronicleId: recentInbound.id,
      suggestedTone,
      keyPointsToAddress: keyPoints,
      chainContext: relatedChain
        ? {
            chainType: relatedChain.chainType,
            triggerSummary: relatedChain.trigger.summary,
            currentState: relatedChain.currentState,
          }
        : null,
    };
  }

  // ---------------------------------------------------------------------------
  // HEADLINE AND SITUATION
  // ---------------------------------------------------------------------------

  /**
   * Generate headline and current situation summary.
   */
  private generateHeadlineAndSituation(
    shipment: ShipmentRecord,
    chains: NarrativeChain[],
    stakeholders: StakeholderSummary[],
    timeline: StoryEvent[]
  ): { headline: string; currentSituation: string } {
    // Prioritize active issues
    const activeIssueChains = chains.filter(
      (c) => c.chainStatus === 'active' && c.chainType === 'issue_to_action'
    );
    const activeDelayChains = chains.filter(
      (c) => c.chainStatus === 'active' && c.chainType === 'delay_chain'
    );
    const pendingComms = chains.filter(
      (c) => c.chainStatus === 'active' && c.chainType === 'communication_chain'
    );

    let headline = 'Shipment on track';
    let currentSituation = 'No outstanding issues or actions.';

    if (activeDelayChains.length > 0) {
      const delayChain = activeDelayChains[0];
      headline = delayChain.narrativeHeadline || 'Schedule change reported';
      currentSituation = `${delayChain.narrativeSummary || delayChain.currentState}. ${
        delayChain.currentStateParty
          ? `Awaiting update from ${formatPartyName(delayChain.currentStateParty)}.`
          : ''
      }`;
    } else if (activeIssueChains.length > 0) {
      const issueChain = activeIssueChains[0];
      headline = issueChain.narrativeHeadline || 'Issue reported';
      currentSituation = `${issueChain.narrativeSummary || issueChain.currentState}. ${
        activeIssueChains.length > 1
          ? `${activeIssueChains.length - 1} other active issue(s).`
          : ''
      }`;
    } else if (pendingComms.length > 0) {
      headline = `${pendingComms.length} message(s) pending response`;
      currentSituation = `Response needed for communication from ${pendingComms
        .map((c) => formatPartyName(c.trigger.party || 'Unknown'))
        .join(', ')}.`;
    } else {
      // No issues - check last activity
      const recentEvent = timeline[0];
      if (recentEvent) {
        headline = `Last: ${recentEvent.headline.slice(0, 50)}`;
        currentSituation = `Most recent activity: ${recentEvent.partyDisplayName || 'Unknown'} - ${recentEvent.headline}. Shipment progressing normally.`;
      }
    }

    return { headline, currentSituation };
  }

  // ---------------------------------------------------------------------------
  // REFRESH OPERATIONS
  // ---------------------------------------------------------------------------

  /**
   * Refresh all story data for a shipment.
   */
  async refreshShipmentStory(shipmentId: string): Promise<ShipmentStory | null> {
    // Refresh chains
    await this.chainService.refreshChains(shipmentId);

    // Refresh stakeholder summaries
    await this.stakeholderService.refreshSummaries(shipmentId);

    // Delete existing story events (will be regenerated)
    await this.supabase
      .from('shipment_story_events')
      .delete()
      .eq('shipment_id', shipmentId);

    // Get fresh story
    return this.getShipmentStory(shipmentId);
  }

  /**
   * Update days_ago for all story events.
   */
  async updateDaysAgo(): Promise<void> {
    const { error } = await this.supabase.rpc('update_story_events_days_ago');

    if (error) {
      console.error('[ShipmentStoryService] Error updating days_ago:', error);
    }
  }
}
