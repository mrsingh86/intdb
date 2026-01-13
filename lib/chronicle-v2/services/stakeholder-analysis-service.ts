/**
 * StakeholderAnalysisService
 *
 * Computes and manages stakeholder interaction summaries.
 * Pre-computes party behavior metrics (response times, sentiment, issues)
 * for instant access without real-time aggregation.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { StakeholderSummary, BehaviorPattern, OverallSentiment, PartyRole } from '../types';

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
  has_action: boolean;
  action_description: string | null;
  action_completed_at: string | null;
  occurred_at: string;
}

interface ThreadAnalysis {
  threadId: string;
  messages: ChronicleRecord[];
  responseTimeHours: number | null;
  hasUnansweredInbound: boolean;
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function hoursBetween(from: Date, to: Date): number {
  return Math.abs(to.getTime() - from.getTime()) / (1000 * 60 * 60);
}

function daysBetween(from: Date, to: Date): number {
  const fromDate = new Date(from);
  fromDate.setHours(0, 0, 0, 0);
  const toDate = new Date(to);
  toDate.setHours(0, 0, 0, 0);
  return Math.floor((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Determine the party role based on party type and email domain.
 *
 * IMPORTANT: The partyType from chronicle classification indicates the role
 * in the EMAIL CONTEXT, not necessarily the business relationship.
 *
 * PRIORITY ORDER:
 * 1. Internal (intoglo.com domain) - always internal
 * 2. PartyType = customer/consignee - always customer (they're the trading party)
 * 3. PartyType = trucker/broker/etc - vendor (service provider)
 * 4. PartyType = carrier/nvocc - partner
 *
 * Example: Highway Motor may be a freight company by name, but if they're
 * the CONSIGNEE receiving goods, partyType will be 'customer' or 'consignee'.
 */
function determinePartyRole(partyType: string, emailDomain: string): PartyRole {
  // 1. Internal check - always check domain first
  if (emailDomain === 'intoglo.com') {
    return 'internal';
  }

  // 2. Customer types - these are the TRADING PARTIES we serve
  // partyType from chronicle indicates their role in the transaction
  const customerTypes = ['customer', 'consignee', 'shipper'];
  if (customerTypes.includes(partyType)) {
    return 'customer';
  }

  // 3. Partner types - shipping lines, terminals (operational partners)
  const partnerTypes = ['carrier', 'ocean_carrier', 'nvocc', 'terminal', 'port'];
  if (partnerTypes.includes(partyType)) {
    return 'partner';
  }

  // 4. Vendor types - service providers we hire
  const vendorTypes = ['trucker', 'customs_broker', 'broker', 'warehouse', 'transloader'];
  if (vendorTypes.includes(partyType)) {
    return 'vendor';
  }

  // 5. Default to vendor for unknown external parties
  return 'vendor';
}

/**
 * Extract company name from email domain.
 * E.g., "operations@carmeltransport.com" → "Carmel Transport"
 */
function extractCompanyName(emailDomain: string): string {
  if (!emailDomain) return 'Unknown';

  // Remove common TLDs
  const name = emailDomain.split('.')[0];

  // Handle common patterns
  const cleanName = name
    .replace(/transport$/i, ' Transport')
    .replace(/shipping$/i, ' Shipping')
    .replace(/logistics$/i, ' Logistics')
    .replace(/freight$/i, ' Freight')
    .replace(/customs$/i, ' Customs')
    .replace(/motor$/i, ' Motor');

  // Capitalize first letter
  const formatted = cleanName.charAt(0).toUpperCase() + cleanName.slice(1);

  // Add spaces before capital letters (CamelCase → Camel Case)
  return formatted.replace(/([a-z])([A-Z])/g, '$1 $2').trim();
}

function getPartyDisplayName(party: string, address: string): string {
  const partyMap: Record<string, string> = {
    carrier: 'Shipping Line',
    ocean_carrier: 'Shipping Line',
    customer: 'Customer',
    broker: 'Customs Broker',
    customs_broker: 'Customs Broker',
    trucker: 'Trucker',
    terminal: 'Terminal',
    intoglo: 'Intoglo Operations',
    operations: 'Operations',
  };

  // Try to extract company name from email domain
  const domain = address.split('@')[1];
  if (domain) {
    const companyName = extractCompanyName(domain);
    if (companyName !== 'Unknown' && companyName.length > 3) {
      return companyName;
    }
  }

  return partyMap[party] || party;
}

function determineBehaviorPattern(
  avgResponseHours: number | null,
  unansweredCount: number,
  issuesRaised: number,
  totalEmails: number
): BehaviorPattern {
  if (totalEmails < 3) return 'unknown';

  // Problematic: many issues, slow/no responses
  if (unansweredCount > 2 || (issuesRaised > 2 && avgResponseHours && avgResponseHours > 48)) {
    return 'problematic';
  }

  if (avgResponseHours === null) return 'unknown';

  // Excellent: very fast responses, few issues
  if (avgResponseHours < 4 && issuesRaised <= 1) return 'excellent';

  // Responsive: reasonably fast
  if (avgResponseHours < 12) return 'responsive';

  // Standard: normal response time
  if (avgResponseHours < 24) return 'standard';

  // Slow: delayed responses
  return 'slow';
}

function determineOverallSentiment(
  positive: number,
  neutral: number,
  negative: number,
  urgent: number
): OverallSentiment | null {
  const total = positive + neutral + negative + urgent;
  if (total === 0) return null;

  const negativeRatio = (negative + urgent) / total;
  const positiveRatio = positive / total;

  if (negativeRatio > 0.4) return 'negative';
  if (positiveRatio > 0.5) return 'positive';
  if (positiveRatio > 0.2 && negativeRatio > 0.2) return 'mixed';
  return 'neutral';
}

// =============================================================================
// SERVICE CLASS
// =============================================================================

export class StakeholderAnalysisService {
  constructor(private supabase: SupabaseClient) {}

  // ---------------------------------------------------------------------------
  // MAIN COMPUTATION
  // ---------------------------------------------------------------------------

  /**
   * Compute stakeholder summaries for a shipment.
   */
  async computeStakeholderSummaries(shipmentId: string): Promise<StakeholderSummary[]> {
    // Get all chronicle entries for this shipment
    const { data: chronicles, error } = await this.supabase
      .from('chronicle')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('occurred_at', { ascending: true });

    if (error || !chronicles) {
      console.error('[StakeholderAnalysisService] Error fetching chronicles:', error);
      return [];
    }

    // Group by party
    const partyGroups = this.groupByParty(chronicles);

    // Compute summary for each party
    const summaries: StakeholderSummary[] = [];

    for (const [partyKey, records] of Object.entries(partyGroups)) {
      // Skip internal (intoglo) party
      if (partyKey.startsWith('intoglo')) continue;

      const summary = this.computePartySummary(shipmentId, partyKey, records, chronicles);
      summaries.push(summary);
    }

    // Save to database
    await this.saveSummaries(summaries);

    return summaries;
  }

  /**
   * Group chronicles by party (type + identifier).
   */
  private groupByParty(chronicles: ChronicleRecord[]): Record<string, ChronicleRecord[]> {
    const groups: Record<string, ChronicleRecord[]> = {};

    for (const record of chronicles) {
      // Only consider inbound messages for party grouping
      // (outbound are from us)
      const party = record.direction === 'inbound' ? record.from_party : null;
      if (!party || party === 'intoglo' || party === 'unknown') continue;

      const domain = record.from_address.split('@')[1] || 'unknown';
      const key = `${party}_${domain}`;

      if (!groups[key]) groups[key] = [];
      groups[key].push(record);
    }

    return groups;
  }

  /**
   * Compute summary for a single party.
   */
  private computePartySummary(
    shipmentId: string,
    partyKey: string,
    partyRecords: ChronicleRecord[],
    allRecords: ChronicleRecord[]
  ): StakeholderSummary {
    const [partyType, partyIdentifier] = partyKey.split('_');
    const now = new Date();

    // Extract email domain and determine role
    const primaryEmail = partyRecords[0]?.from_address || '';
    const emailDomain = primaryEmail.split('@')[1] || '';
    const partyRole = determinePartyRole(partyType, emailDomain);
    const companyName = extractCompanyName(emailDomain);

    // Basic counts
    const inboundRecords = partyRecords.filter((r) => r.direction === 'inbound');
    const outboundRecords = allRecords.filter(
      (r) =>
        r.direction === 'outbound' &&
        r.thread_id &&
        partyRecords.some((pr) => pr.thread_id === r.thread_id)
    );

    const totalEmails = inboundRecords.length + outboundRecords.length;
    const firstContact = inboundRecords.length > 0 ? inboundRecords[0].occurred_at : null;
    const lastContact =
      inboundRecords.length > 0
        ? inboundRecords[inboundRecords.length - 1].occurred_at
        : null;

    // Analyze threads for response times
    const threadAnalysis = this.analyzeThreads(partyRecords, allRecords);
    const responseTimes = threadAnalysis
      .map((t) => t.responseTimeHours)
      .filter((t): t is number => t !== null);

    const avgResponseHours =
      responseTimes.length > 0
        ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
        : null;

    const fastestResponseHours = responseTimes.length > 0 ? Math.min(...responseTimes) : null;
    const slowestResponseHours = responseTimes.length > 0 ? Math.max(...responseTimes) : null;
    const unansweredCount = threadAnalysis.filter((t) => t.hasUnansweredInbound).length;

    // Sentiment counts
    const positiveCount = inboundRecords.filter((r) => r.sentiment === 'positive').length;
    const neutralCount = inboundRecords.filter((r) => r.sentiment === 'neutral').length;
    const negativeCount = inboundRecords.filter((r) => r.sentiment === 'negative').length;
    const urgentCount = inboundRecords.filter((r) => r.sentiment === 'urgent').length;

    // Issue tracking
    const issueRecords = inboundRecords.filter((r) => r.has_issue);
    const issueTypes = [...new Set(issueRecords.map((r) => r.issue_type).filter(Boolean))] as string[];

    // Action tracking
    const actionRecords = inboundRecords.filter((r) => r.has_action);
    const completedActions = actionRecords.filter((r) => r.action_completed_at);

    // Recent communications (last 5)
    const recentRecords = inboundRecords.slice(-5).reverse();
    const recentCommunications = recentRecords.map((r) => ({
      date: r.occurred_at,
      direction: 'inbound' as const,
      type: r.message_type,
      summary: r.summary.slice(0, 100),
      sentiment: r.sentiment,
      chronicleId: r.id,
      hasPendingAction: r.has_action && !r.action_completed_at,
    }));

    // Compute derived metrics
    const behaviorPattern = determineBehaviorPattern(
      avgResponseHours,
      unansweredCount,
      issueRecords.length,
      totalEmails
    );

    const overallSentiment = determineOverallSentiment(
      positiveCount,
      neutralCount,
      negativeCount,
      urgentCount
    );

    const displayName = getPartyDisplayName(
      partyType,
      partyRecords[0]?.from_address || ''
    );

    const daysSinceLastContact = lastContact
      ? daysBetween(new Date(lastContact), now)
      : null;

    return {
      id: `stakeholder_${shipmentId}_${partyKey}`,
      shipmentId,
      partyType,
      partyIdentifier,
      displayName,
      partyRole,
      companyName,
      contactEmail: primaryEmail || null,
      stats: {
        totalEmails,
        inboundCount: inboundRecords.length,
        outboundCount: outboundRecords.length,
        firstContact,
        lastContact,
        daysSinceLastContact,
      },
      responsiveness: {
        avgResponseHours,
        fastestResponseHours,
        slowestResponseHours,
        unansweredCount,
        behaviorPattern,
        behaviorNotes: this.generateBehaviorNotes(behaviorPattern, avgResponseHours, unansweredCount),
      },
      sentiment: {
        positiveCount,
        neutralCount,
        negativeCount,
        urgentCount,
        overall: overallSentiment,
      },
      issues: {
        raised: issueRecords.length,
        resolved: issueRecords.filter((r) => !r.has_action || r.action_completed_at).length,
        types: issueTypes,
      },
      actions: {
        requested: actionRecords.length,
        completed: completedActions.length,
      },
      recentCommunications,
      lastComputed: now.toISOString(),
    };
  }

  /**
   * Analyze threads to compute response times.
   */
  private analyzeThreads(
    partyRecords: ChronicleRecord[],
    allRecords: ChronicleRecord[]
  ): ThreadAnalysis[] {
    const threadIds = [...new Set(partyRecords.map((r) => r.thread_id))];
    const analyses: ThreadAnalysis[] = [];

    for (const threadId of threadIds) {
      const threadMessages = allRecords
        .filter((r) => r.thread_id === threadId)
        .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());

      let responseTimeHours: number | null = null;
      let hasUnansweredInbound = false;

      // Find inbound messages and their responses
      for (let i = 0; i < threadMessages.length; i++) {
        const msg = threadMessages[i];
        if (msg.direction === 'inbound') {
          // Look for outbound response after this
          const response = threadMessages.slice(i + 1).find((m) => m.direction === 'outbound');

          if (response) {
            const hours = hoursBetween(
              new Date(msg.occurred_at),
              new Date(response.occurred_at)
            );
            responseTimeHours =
              responseTimeHours === null ? hours : Math.min(responseTimeHours, hours);
          } else {
            // No response found - check if message needs response
            if (
              msg.message_type === 'action_required' ||
              msg.message_type === 'request' ||
              msg.message_type === 'query'
            ) {
              hasUnansweredInbound = true;
            }
          }
        }
      }

      analyses.push({
        threadId,
        messages: threadMessages,
        responseTimeHours,
        hasUnansweredInbound,
      });
    }

    return analyses;
  }

  /**
   * Generate behavior notes based on metrics.
   */
  private generateBehaviorNotes(
    pattern: BehaviorPattern,
    avgResponseHours: number | null,
    unanswered: number
  ): string | null {
    const notes: string[] = [];

    if (avgResponseHours !== null) {
      if (avgResponseHours < 4) {
        notes.push('Very fast responses');
      } else if (avgResponseHours > 48) {
        notes.push('Slow to respond');
      }
    }

    if (unanswered > 0) {
      notes.push(`${unanswered} unanswered message(s)`);
    }

    return notes.length > 0 ? notes.join('. ') : null;
  }

  // ---------------------------------------------------------------------------
  // DATABASE OPERATIONS
  // ---------------------------------------------------------------------------

  /**
   * Save stakeholder summaries to database.
   */
  private async saveSummaries(summaries: StakeholderSummary[]): Promise<void> {
    for (const summary of summaries) {
      const dbRecord = {
        shipment_id: summary.shipmentId,
        party_type: summary.partyType,
        party_identifier: summary.partyIdentifier,
        party_display_name: summary.displayName,
        party_role: summary.partyRole,
        company_name: summary.companyName,
        contact_email: summary.contactEmail,
        total_emails: summary.stats.totalEmails,
        inbound_count: summary.stats.inboundCount,
        outbound_count: summary.stats.outboundCount,
        first_contact: summary.stats.firstContact,
        last_contact: summary.stats.lastContact,
        days_since_last_contact: summary.stats.daysSinceLastContact,
        avg_response_time_hours: summary.responsiveness.avgResponseHours,
        fastest_response_hours: summary.responsiveness.fastestResponseHours,
        slowest_response_hours: summary.responsiveness.slowestResponseHours,
        unanswered_count: summary.responsiveness.unansweredCount,
        behavior_pattern: summary.responsiveness.behaviorPattern,
        behavior_notes: summary.responsiveness.behaviorNotes,
        positive_count: summary.sentiment.positiveCount,
        neutral_count: summary.sentiment.neutralCount,
        negative_count: summary.sentiment.negativeCount,
        urgent_count: summary.sentiment.urgentCount,
        overall_sentiment: summary.sentiment.overall,
        issues_raised: summary.issues.raised,
        issues_resolved: summary.issues.resolved,
        issue_types: summary.issues.types,
        actions_requested: summary.actions.requested,
        actions_completed: summary.actions.completed,
        recent_communications: summary.recentCommunications,
        last_computed: summary.lastComputed,
      };

      // Upsert based on unique constraint
      const { error } = await this.supabase
        .from('stakeholder_interaction_summary')
        .upsert(dbRecord, {
          onConflict: 'shipment_id,party_type,party_identifier',
          ignoreDuplicates: false,
        });

      if (error) {
        console.error('[StakeholderAnalysisService] Error saving summary:', error);
      }
    }
  }

  /**
   * Get stakeholder summaries for a shipment.
   */
  async getStakeholderSummaries(shipmentId: string): Promise<StakeholderSummary[]> {
    const { data, error } = await this.supabase
      .from('stakeholder_interaction_summary')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('last_contact', { ascending: false, nullsFirst: false });

    if (error) {
      console.error('[StakeholderAnalysisService] Error fetching summaries:', error);
      return [];
    }

    return (data || []).map(this.mapDbToSummary);
  }

  /**
   * Get stakeholders needing follow-up.
   */
  async getStakeholdersNeedingFollowup(shipmentId: string): Promise<StakeholderSummary[]> {
    const { data, error } = await this.supabase
      .from('stakeholder_interaction_summary')
      .select('*')
      .eq('shipment_id', shipmentId)
      .or('unanswered_count.gt.0,days_since_last_contact.gt.3')
      .order('unanswered_count', { ascending: false });

    if (error) {
      console.error('[StakeholderAnalysisService] Error fetching follow-ups:', error);
      return [];
    }

    return (data || []).map(this.mapDbToSummary);
  }

  /**
   * Map database record to StakeholderSummary.
   */
  private mapDbToSummary(record: Record<string, unknown>): StakeholderSummary {
    return {
      id: record.id as string,
      shipmentId: record.shipment_id as string,
      partyType: record.party_type as string,
      partyIdentifier: record.party_identifier as string | null,
      displayName: record.party_display_name as string,
      partyRole: (record.party_role as PartyRole) || 'vendor',
      companyName: record.company_name as string | null,
      contactEmail: record.contact_email as string | null,
      stats: {
        totalEmails: record.total_emails as number,
        inboundCount: record.inbound_count as number,
        outboundCount: record.outbound_count as number,
        firstContact: record.first_contact as string | null,
        lastContact: record.last_contact as string | null,
        daysSinceLastContact: record.days_since_last_contact as number | null,
      },
      responsiveness: {
        avgResponseHours: record.avg_response_time_hours as number | null,
        fastestResponseHours: record.fastest_response_hours as number | null,
        slowestResponseHours: record.slowest_response_hours as number | null,
        unansweredCount: record.unanswered_count as number,
        behaviorPattern: record.behavior_pattern as BehaviorPattern,
        behaviorNotes: record.behavior_notes as string | null,
      },
      sentiment: {
        positiveCount: record.positive_count as number,
        neutralCount: record.neutral_count as number,
        negativeCount: record.negative_count as number,
        urgentCount: record.urgent_count as number,
        overall: record.overall_sentiment as OverallSentiment | null,
      },
      issues: {
        raised: record.issues_raised as number,
        resolved: record.issues_resolved as number,
        types: (record.issue_types as string[]) || [],
      },
      actions: {
        requested: record.actions_requested as number,
        completed: record.actions_completed as number,
      },
      recentCommunications: (record.recent_communications as StakeholderSummary['recentCommunications']) || [],
      lastComputed: record.last_computed as string,
    };
  }

  /**
   * Refresh stakeholder summaries (recompute from chronicle data).
   */
  async refreshSummaries(shipmentId: string): Promise<StakeholderSummary[]> {
    // Delete existing summaries
    await this.supabase
      .from('stakeholder_interaction_summary')
      .delete()
      .eq('shipment_id', shipmentId);

    // Recompute
    return this.computeStakeholderSummaries(shipmentId);
  }

  /**
   * Update days_since_last_contact for all stakeholders.
   */
  async updateDaysSinceContact(): Promise<void> {
    const { error } = await this.supabase.rpc('update_stakeholder_days_since_contact');

    if (error) {
      console.error('[StakeholderAnalysisService] Error updating days since contact:', error);
    }
  }
}
