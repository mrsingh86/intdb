/**
 * NarrativeChainService
 *
 * Detects and manages narrative chains from chronicle data.
 * Links trigger events (issues, requests) to their effects (actions, responses)
 * to create coherent cause-effect chains.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  NarrativeChain,
  ChainType,
  ChainStatus,
  ChainEvent,
  ChainRelation,
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
  occurred_at: string;
  document_type: string | null;
}

interface ChainDetectionResult {
  detected: boolean;
  chain: Partial<NarrativeChain> | null;
  confidence: number;
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

function generateNarrativeHeadline(
  chainType: ChainType,
  triggerType: string,
  triggerSummary: string
): string {
  const headlineMap: Record<string, string> = {
    delay: 'Vessel Delay',
    rollover: 'Vessel Rollover',
    hold: 'Shipment Hold',
    documentation: 'Document Issue',
    customs: 'Customs Issue',
    damage: 'Cargo Damage',
    missing_document: 'Missing Document',
    payment: 'Payment Issue',
  };

  if (chainType === 'delay_chain') {
    return headlineMap[triggerType] || 'Schedule Change';
  }
  if (chainType === 'communication_chain') {
    return 'Pending Response';
  }
  if (chainType === 'document_chain') {
    return 'Document Processing';
  }

  return headlineMap[triggerType] || triggerSummary.slice(0, 50);
}

function generateNarrativeSummary(
  chainType: ChainType,
  trigger: { eventType: string; summary: string; party: string | null },
  currentState: string
): string {
  const partyName = trigger.party ? formatPartyName(trigger.party) : 'Unknown';

  switch (chainType) {
    case 'issue_to_action':
      return `${partyName} reported ${trigger.eventType}. ${currentState}`;
    case 'delay_chain':
      return `${trigger.eventType} reported by ${partyName}. ${currentState}`;
    case 'communication_chain':
      return `Message from ${partyName} requires attention. ${currentState}`;
    case 'document_chain':
      return `Document ${trigger.eventType}. ${currentState}`;
    default:
      return `${trigger.summary}. ${currentState}`;
  }
}

// =============================================================================
// SERVICE CLASS
// =============================================================================

export class NarrativeChainService {
  constructor(private supabase: SupabaseClient) {}

  // ---------------------------------------------------------------------------
  // CHAIN DETECTION
  // ---------------------------------------------------------------------------

  /**
   * Detect and create chains for a shipment based on its chronicle entries.
   */
  async detectChainsForShipment(shipmentId: string): Promise<NarrativeChain[]> {
    // Get all chronicle entries for this shipment
    const { data: chronicles, error } = await this.supabase
      .from('chronicle')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('occurred_at', { ascending: true });

    if (error || !chronicles) {
      console.error('[NarrativeChainService] Error fetching chronicles:', error);
      return [];
    }

    const detectedChains: NarrativeChain[] = [];

    // Process each chronicle entry to detect chains
    for (const chronicle of chronicles) {
      // Check for issue-to-action chains
      if (chronicle.has_issue) {
        const chain = await this.detectIssueToActionChain(chronicle, chronicles);
        if (chain) detectedChains.push(chain);
      }

      // Check for communication chains (messages requiring response)
      if (this.needsResponse(chronicle)) {
        const chain = await this.detectCommunicationChain(chronicle, chronicles);
        if (chain) detectedChains.push(chain);
      }

      // Check for delay chains
      if (this.isDelayEvent(chronicle)) {
        const chain = await this.detectDelayChain(chronicle, chronicles);
        if (chain) detectedChains.push(chain);
      }
    }

    // Deduplicate chains (same trigger shouldn't create multiple chains)
    const uniqueChains = this.deduplicateChains(detectedChains);

    // Save chains to database
    await this.saveChains(uniqueChains);

    return uniqueChains;
  }

  /**
   * Detect issue-to-action chain.
   * Pattern: Issue reported → Action required → Action completed
   */
  private async detectIssueToActionChain(
    issueChronicle: ChronicleRecord,
    allChronicles: ChronicleRecord[]
  ): Promise<NarrativeChain | null> {
    const now = new Date();
    const triggerDate = new Date(issueChronicle.occurred_at);

    // Find related actions that came after this issue
    const relatedActions = allChronicles.filter(
      (c) =>
        c.has_action &&
        new Date(c.occurred_at) >= triggerDate &&
        c.id !== issueChronicle.id
    );

    // Build chain events
    const chainEvents: ChainEvent[] = relatedActions.map((action) => ({
      chronicleId: action.id,
      eventType: 'action_required',
      summary: action.action_description || action.summary,
      occurredAt: action.occurred_at,
      party: action.action_owner || action.from_party,
      relation: 'caused_by' as ChainRelation,
      daysFromTrigger: daysBetween(triggerDate, new Date(action.occurred_at)),
    }));

    // Determine chain status
    const allActionsCompleted = relatedActions.every((a) => a.action_completed_at);
    const hasOverdueActions = relatedActions.some(
      (a) =>
        !a.action_completed_at &&
        a.action_deadline &&
        new Date(a.action_deadline) < now
    );

    let chainStatus: ChainStatus = 'active';
    if (allActionsCompleted && relatedActions.length > 0) {
      chainStatus = 'resolved';
    }

    // Determine current state
    let currentState = 'Issue reported - awaiting action';
    let currentStateParty: string | null = 'Operations';

    if (relatedActions.length > 0) {
      const pendingActions = relatedActions.filter((a) => !a.action_completed_at);
      if (pendingActions.length > 0) {
        currentState = hasOverdueActions
          ? `${pendingActions.length} action(s) pending - ${this.countOverdue(pendingActions)} overdue`
          : `${pendingActions.length} action(s) pending`;
        currentStateParty = pendingActions[0].action_owner || 'Operations';
      } else {
        currentState = 'All actions completed';
        currentStateParty = null;
      }
    }

    const daysInCurrentState = daysBetween(
      new Date(relatedActions.length > 0 ? relatedActions[relatedActions.length - 1].occurred_at : issueChronicle.occurred_at),
      now
    );

    return {
      id: '', // Will be generated by database
      shipmentId: issueChronicle.shipment_id,
      chainType: 'issue_to_action',
      chainStatus,
      trigger: {
        chronicleId: issueChronicle.id,
        eventType: issueChronicle.issue_type || 'unknown_issue',
        summary: issueChronicle.issue_description || issueChronicle.summary,
        occurredAt: issueChronicle.occurred_at,
        party: issueChronicle.from_party,
        daysAgo: daysBetween(triggerDate, now),
      },
      events: chainEvents,
      currentState,
      currentStateParty,
      daysInCurrentState,
      narrativeHeadline: generateNarrativeHeadline(
        'issue_to_action',
        issueChronicle.issue_type || '',
        issueChronicle.issue_description || ''
      ),
      narrativeSummary: generateNarrativeSummary(
        'issue_to_action',
        {
          eventType: issueChronicle.issue_type || 'issue',
          summary: issueChronicle.issue_description || '',
          party: issueChronicle.from_party,
        },
        currentState
      ),
      fullNarrative: null, // Generated on demand
      impact: {
        delayDays: this.estimateDelayImpact(issueChronicle.issue_type),
        financialUsd: null,
        affectedParties: this.identifyAffectedParties(issueChronicle, relatedActions),
      },
      resolution: {
        required: true,
        deadline: this.findEarliestDeadline(relatedActions),
        resolvedAt: allActionsCompleted && relatedActions.length > 0
          ? relatedActions[relatedActions.length - 1].action_completed_at
          : null,
        resolvedBy: null,
        summary: null,
      },
      autoDetected: true,
      confidenceScore: this.calculateConfidence(issueChronicle, relatedActions),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Detect communication chain.
   * Pattern: Message received → Response required → Response sent
   */
  private async detectCommunicationChain(
    chronicle: ChronicleRecord,
    allChronicles: ChronicleRecord[]
  ): Promise<NarrativeChain | null> {
    const now = new Date();
    const triggerDate = new Date(chronicle.occurred_at);

    // Find responses in the same thread
    const threadMessages = allChronicles.filter(
      (c) => c.thread_id === chronicle.thread_id && c.id !== chronicle.id
    );

    const responses = threadMessages.filter(
      (c) =>
        c.direction === 'outbound' &&
        new Date(c.occurred_at) > triggerDate
    );

    const chainStatus: ChainStatus = responses.length > 0 ? 'resolved' : 'active';

    const currentState = responses.length > 0
      ? 'Response sent'
      : `Awaiting response - ${daysBetween(triggerDate, now)} days`;

    const chainEvents: ChainEvent[] = responses.map((response) => ({
      chronicleId: response.id,
      eventType: 'response_sent',
      summary: response.summary,
      occurredAt: response.occurred_at,
      party: 'operations',
      relation: 'resolved_by' as ChainRelation,
      daysFromTrigger: daysBetween(triggerDate, new Date(response.occurred_at)),
    }));

    return {
      id: '', // Will be generated by database
      shipmentId: chronicle.shipment_id,
      chainType: 'communication_chain',
      chainStatus,
      trigger: {
        chronicleId: chronicle.id,
        eventType: chronicle.message_type,
        summary: chronicle.summary,
        occurredAt: chronicle.occurred_at,
        party: chronicle.from_party,
        daysAgo: daysBetween(triggerDate, now),
      },
      events: chainEvents,
      currentState,
      currentStateParty: responses.length > 0 ? null : 'Operations',
      daysInCurrentState: daysBetween(
        new Date(responses.length > 0 ? responses[responses.length - 1].occurred_at : chronicle.occurred_at),
        now
      ),
      narrativeHeadline: 'Pending Response',
      narrativeSummary: `${formatPartyName(chronicle.from_party)} sent: "${chronicle.summary.slice(0, 60)}...". ${currentState}`,
      fullNarrative: null,
      impact: {
        delayDays: null,
        financialUsd: null,
        affectedParties: [chronicle.from_party],
      },
      resolution: {
        required: true,
        deadline: chronicle.action_deadline || null,
        resolvedAt: responses.length > 0 ? responses[responses.length - 1].occurred_at : null,
        resolvedBy: responses.length > 0 ? responses[responses.length - 1].id : null,
        summary: responses.length > 0 ? 'Response sent' : null,
      },
      autoDetected: true,
      confidenceScore: 85,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Detect delay chain.
   * Pattern: Delay reported → Schedule impact → New schedule confirmed
   */
  private async detectDelayChain(
    chronicle: ChronicleRecord,
    allChronicles: ChronicleRecord[]
  ): Promise<NarrativeChain | null> {
    const now = new Date();
    const triggerDate = new Date(chronicle.occurred_at);

    // Find subsequent schedule-related communications
    const subsequentComms = allChronicles.filter(
      (c) =>
        new Date(c.occurred_at) > triggerDate &&
        (c.document_type === 'booking_amendment' ||
          c.message_type === 'update' ||
          c.summary.toLowerCase().includes('schedule') ||
          c.summary.toLowerCase().includes('new etd'))
    );

    const hasNewSchedule = subsequentComms.some(
      (c) =>
        c.message_type === 'confirmation' ||
        c.summary.toLowerCase().includes('confirmed')
    );

    const chainStatus: ChainStatus = hasNewSchedule ? 'resolved' : 'active';

    const currentState = hasNewSchedule
      ? 'New schedule confirmed'
      : 'Awaiting new schedule from carrier';

    const chainEvents: ChainEvent[] = subsequentComms.map((comm) => ({
      chronicleId: comm.id,
      eventType: comm.document_type || comm.message_type,
      summary: comm.summary,
      occurredAt: comm.occurred_at,
      party: comm.from_party,
      relation: (hasNewSchedule && comm.message_type === 'confirmation'
        ? 'resolved_by'
        : 'followed_by') as ChainRelation,
      daysFromTrigger: daysBetween(triggerDate, new Date(comm.occurred_at)),
    }));

    return {
      id: '', // Will be generated by database
      shipmentId: chronicle.shipment_id,
      chainType: 'delay_chain',
      chainStatus,
      trigger: {
        chronicleId: chronicle.id,
        eventType: chronicle.issue_type || 'delay',
        summary: chronicle.issue_description || chronicle.summary,
        occurredAt: chronicle.occurred_at,
        party: chronicle.from_party,
        daysAgo: daysBetween(triggerDate, now),
      },
      events: chainEvents,
      currentState,
      currentStateParty: hasNewSchedule ? null : 'Shipping Line',
      daysInCurrentState: daysBetween(
        new Date(subsequentComms.length > 0 ? subsequentComms[subsequentComms.length - 1].occurred_at : chronicle.occurred_at),
        now
      ),
      narrativeHeadline: generateNarrativeHeadline('delay_chain', chronicle.issue_type || 'delay', ''),
      narrativeSummary: generateNarrativeSummary(
        'delay_chain',
        {
          eventType: chronicle.issue_type || 'Delay',
          summary: chronicle.issue_description || '',
          party: chronicle.from_party,
        },
        currentState
      ),
      fullNarrative: null,
      impact: {
        delayDays: this.estimateDelayImpact(chronicle.issue_type),
        financialUsd: null,
        affectedParties: ['shipper', 'consignee'],
      },
      resolution: {
        required: true,
        deadline: null,
        resolvedAt: hasNewSchedule ? subsequentComms[subsequentComms.length - 1].occurred_at : null,
        resolvedBy: hasNewSchedule ? subsequentComms[subsequentComms.length - 1].id : null,
        summary: hasNewSchedule ? 'New schedule confirmed' : null,
      },
      autoDetected: true,
      confidenceScore: 80,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // HELPER METHODS
  // ---------------------------------------------------------------------------

  private needsResponse(chronicle: ChronicleRecord): boolean {
    return (
      chronicle.direction === 'inbound' &&
      (chronicle.message_type === 'action_required' ||
        chronicle.message_type === 'request' ||
        chronicle.message_type === 'query' ||
        chronicle.sentiment === 'urgent')
    );
  }

  private isDelayEvent(chronicle: ChronicleRecord): boolean {
    if (!chronicle.has_issue) return false;
    const issueType = chronicle.issue_type?.toLowerCase() || '';
    return (
      issueType === 'delay' ||
      issueType === 'rollover' ||
      issueType.includes('schedule') ||
      chronicle.summary.toLowerCase().includes('delay') ||
      chronicle.summary.toLowerCase().includes('rollover')
    );
  }

  private countOverdue(actions: ChronicleRecord[]): number {
    const now = new Date();
    return actions.filter(
      (a) =>
        !a.action_completed_at &&
        a.action_deadline &&
        new Date(a.action_deadline) < now
    ).length;
  }

  private estimateDelayImpact(issueType: string | null): number | null {
    const delayEstimates: Record<string, number> = {
      delay: 3,
      rollover: 7,
      hold: 5,
      customs: 3,
    };
    return issueType ? delayEstimates[issueType.toLowerCase()] || null : null;
  }

  private identifyAffectedParties(
    issue: ChronicleRecord,
    actions: ChronicleRecord[]
  ): string[] {
    const parties = new Set<string>();

    // Issue reporter
    if (issue.from_party && issue.from_party !== 'intoglo') {
      parties.add(issue.from_party);
    }

    // Action owners
    for (const action of actions) {
      if (action.action_owner && action.action_owner !== 'operations') {
        parties.add(action.action_owner);
      }
    }

    // Default affected parties for shipment issues
    parties.add('shipper');
    parties.add('consignee');

    return Array.from(parties);
  }

  private findEarliestDeadline(actions: ChronicleRecord[]): string | null {
    const deadlines = actions
      .filter((a) => a.action_deadline && !a.action_completed_at)
      .map((a) => a.action_deadline!)
      .sort();

    return deadlines.length > 0 ? deadlines[0] : null;
  }

  private calculateConfidence(
    trigger: ChronicleRecord,
    relatedEvents: ChronicleRecord[]
  ): number {
    let confidence = 60; // Base confidence

    // Higher confidence if trigger has clear issue type
    if (trigger.issue_type) confidence += 15;

    // Higher confidence with related events
    if (relatedEvents.length > 0) confidence += 10;

    // Higher confidence if action deadlines exist
    if (relatedEvents.some((e) => e.action_deadline)) confidence += 10;

    // Cap at 100
    return Math.min(100, confidence);
  }

  private deduplicateChains(chains: NarrativeChain[]): NarrativeChain[] {
    const seen = new Set<string>();
    return chains.filter((chain) => {
      const key = `${chain.chainType}_${chain.trigger.chronicleId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ---------------------------------------------------------------------------
  // DATABASE OPERATIONS
  // ---------------------------------------------------------------------------

  /**
   * Save chains to the database.
   */
  private async saveChains(chains: NarrativeChain[]): Promise<void> {
    for (const chain of chains) {
      const dbRecord = {
        shipment_id: chain.shipmentId,
        chain_type: chain.chainType,
        chain_status: chain.chainStatus,
        trigger_chronicle_id: chain.trigger.chronicleId,
        trigger_event_type: chain.trigger.eventType,
        trigger_summary: chain.trigger.summary,
        trigger_occurred_at: chain.trigger.occurredAt,
        trigger_party: chain.trigger.party,
        chain_events: chain.events,
        current_state: chain.currentState,
        current_state_party: chain.currentStateParty,
        days_in_current_state: chain.daysInCurrentState,
        narrative_headline: chain.narrativeHeadline,
        narrative_summary: chain.narrativeSummary,
        full_narrative: chain.fullNarrative,
        delay_impact_days: chain.impact.delayDays,
        financial_impact_usd: chain.impact.financialUsd,
        affected_parties: chain.impact.affectedParties,
        resolution_required: chain.resolution.required,
        resolution_deadline: chain.resolution.deadline,
        resolved_at: chain.resolution.resolvedAt,
        resolution_chronicle_id: chain.resolution.resolvedBy,
        resolution_summary: chain.resolution.summary,
        auto_detected: chain.autoDetected,
        confidence_score: chain.confidenceScore,
      };

      // Check if chain already exists
      const { data: existing } = await this.supabase
        .from('shipment_narrative_chains')
        .select('id')
        .eq('trigger_chronicle_id', chain.trigger.chronicleId)
        .eq('chain_type', chain.chainType)
        .single();

      if (existing) {
        // Update existing chain
        const { error } = await this.supabase
          .from('shipment_narrative_chains')
          .update({
            ...dbRecord,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);

        if (error) {
          console.error('[NarrativeChainService] Error updating chain:', error);
        }
      } else {
        // Insert new chain
        const { error } = await this.supabase
          .from('shipment_narrative_chains')
          .insert(dbRecord);

        if (error) {
          console.error('[NarrativeChainService] Error inserting chain:', error);
        }
      }
    }
  }

  /**
   * Get active chains for a shipment.
   */
  async getActiveChains(shipmentId: string): Promise<NarrativeChain[]> {
    const { data, error } = await this.supabase
      .from('shipment_narrative_chains')
      .select('*')
      .eq('shipment_id', shipmentId)
      .eq('chain_status', 'active')
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[NarrativeChainService] Error fetching chains:', error);
      return [];
    }

    return (data || []).map(this.mapDbToChain);
  }

  /**
   * Get all chains for a shipment.
   */
  async getAllChains(shipmentId: string): Promise<NarrativeChain[]> {
    const { data, error } = await this.supabase
      .from('shipment_narrative_chains')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('[NarrativeChainService] Error fetching chains:', error);
      return [];
    }

    return (data || []).map(this.mapDbToChain);
  }

  /**
   * Update chain status.
   */
  async updateChainStatus(
    chainId: string,
    status: ChainStatus,
    resolutionSummary?: string
  ): Promise<void> {
    const updateData: Record<string, unknown> = {
      chain_status: status,
      updated_at: new Date().toISOString(),
    };

    if (status === 'resolved') {
      updateData.resolved_at = new Date().toISOString();
      if (resolutionSummary) {
        updateData.resolution_summary = resolutionSummary;
      }
    }

    const { error } = await this.supabase
      .from('shipment_narrative_chains')
      .update(updateData)
      .eq('id', chainId);

    if (error) {
      console.error('[NarrativeChainService] Error updating chain status:', error);
    }
  }

  /**
   * Map database record to NarrativeChain type.
   */
  private mapDbToChain(record: Record<string, unknown>): NarrativeChain {
    const now = new Date();
    const triggerDate = new Date(record.trigger_occurred_at as string);

    return {
      id: record.id as string,
      shipmentId: record.shipment_id as string,
      chainType: record.chain_type as ChainType,
      chainStatus: record.chain_status as ChainStatus,
      trigger: {
        chronicleId: record.trigger_chronicle_id as string | null,
        eventType: record.trigger_event_type as string,
        summary: record.trigger_summary as string,
        occurredAt: record.trigger_occurred_at as string,
        party: record.trigger_party as string | null,
        daysAgo: daysBetween(triggerDate, now),
      },
      events: (record.chain_events as ChainEvent[]) || [],
      currentState: record.current_state as string,
      currentStateParty: record.current_state_party as string | null,
      daysInCurrentState: record.days_in_current_state as number,
      narrativeHeadline: record.narrative_headline as string | null,
      narrativeSummary: record.narrative_summary as string | null,
      fullNarrative: record.full_narrative as string | null,
      impact: {
        delayDays: record.delay_impact_days as number | null,
        financialUsd: record.financial_impact_usd as number | null,
        affectedParties: (record.affected_parties as string[]) || [],
      },
      resolution: {
        required: record.resolution_required as boolean,
        deadline: record.resolution_deadline as string | null,
        resolvedAt: record.resolved_at as string | null,
        resolvedBy: record.resolution_chronicle_id as string | null,
        summary: record.resolution_summary as string | null,
      },
      autoDetected: record.auto_detected as boolean,
      confidenceScore: record.confidence_score as number | null,
      createdAt: record.created_at as string,
      updatedAt: record.updated_at as string,
    };
  }

  /**
   * Refresh chains for a shipment (re-detect from chronicle data).
   */
  async refreshChains(shipmentId: string): Promise<NarrativeChain[]> {
    // Mark existing chains as stale before re-detection
    await this.supabase
      .from('shipment_narrative_chains')
      .update({ chain_status: 'superseded' })
      .eq('shipment_id', shipmentId)
      .eq('auto_detected', true);

    // Re-detect chains
    return this.detectChainsForShipment(shipmentId);
  }

  /**
   * Mark stale chains (no activity for extended period).
   */
  async markStaleChains(): Promise<number> {
    const { data, error } = await this.supabase.rpc('mark_stale_narrative_chains');

    if (error) {
      console.error('[NarrativeChainService] Error marking stale chains:', error);
      return 0;
    }

    return data || 0;
  }
}
