/**
 * SemanticGroupingService
 *
 * Groups communications by semantic topic for better AI summary context.
 * Enables the AI to see related discussions together rather than pure chronological order.
 *
 * Key Features:
 * 1. Topic Clustering: Groups messages about the same issue (customs, delays, documentation)
 * 2. Historical Context: Surfaces relevant older communications (beyond 7 days)
 * 3. Thread Consolidation: Combines related email threads
 *
 * Following CLAUDE.md principles:
 * - Deep Modules (Principle #8) - simple interface, complex internals
 * - Single Responsibility (Principle #3) - only semantic grouping
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { IEmbeddingService, createEmbeddingService } from '../../chronicle/embedding-service';

// ============================================================================
// TYPES
// ============================================================================

export interface CommunicationItem {
  id: string;
  occurredAt: string;
  direction: string;
  fromParty: string;
  documentType: string | null;
  summary: string;
  hasIssue: boolean;
  issueType: string | null;
  hasAction: boolean;
  actionDescription: string | null;
  threadId: string | null;
}

export interface SemanticGroup {
  topic: string;
  topicType: 'issue' | 'documentation' | 'status' | 'financial' | 'general';
  communications: CommunicationItem[];
  summary: string;
  isOngoing: boolean; // Has unresolved action/issue
  oldestDate: string;
  newestDate: string;
}

export interface HistoricalContext {
  chronicleId: string;
  occurredAt: string;
  documentType: string;
  summary: string;
  similarity: number;
  relevantTo: string; // Which current issue/topic it relates to
}

export interface SemanticGroupingResult {
  groups: SemanticGroup[];
  historicalContext: HistoricalContext[];
  ungroupedCount: number;
}

export interface ISemanticGroupingService {
  /**
   * Group communications by semantic topic
   */
  groupCommunications(
    shipmentId: string,
    recentCommunications: CommunicationItem[]
  ): Promise<SemanticGroupingResult>;

  /**
   * Find relevant historical communications for current issues
   */
  findHistoricalContext(
    shipmentId: string,
    currentIssues: string[]
  ): Promise<HistoricalContext[]>;

  /**
   * Build prompt section for AI summary
   */
  buildPromptSection(result: SemanticGroupingResult): string;
}

// ============================================================================
// CONFIGURATION
// ============================================================================

// Topic keywords for fast classification
const TOPIC_PATTERNS: Record<string, { keywords: string[]; type: SemanticGroup['topicType'] }> = {
  'Customs & Clearance': {
    keywords: ['customs', 'clearance', 'hold', 'exam', 'duty', 'tariff', 'cbp', 'pga'],
    type: 'issue',
  },
  'Documentation Issues': {
    keywords: ['missing', 'incorrect', 'amendment', 'correction', 'revision', 'error'],
    type: 'documentation',
  },
  'Shipping Instructions': {
    keywords: ['si', 'shipping instruction', 'shipper details', 'consignee details'],
    type: 'documentation',
  },
  'Bill of Lading': {
    keywords: ['bl', 'bill of lading', 'draft', 'telex', 'original', 'surrender'],
    type: 'documentation',
  },
  'VGM & Weights': {
    keywords: ['vgm', 'verified gross mass', 'weight', 'cargo weight'],
    type: 'documentation',
  },
  'Schedule & Delays': {
    keywords: ['delay', 'rollover', 'missed', 'late', 'reschedule', 'omit', 'blank sailing'],
    type: 'issue',
  },
  'Arrival & Delivery': {
    keywords: ['arrival', 'delivery', 'discharge', 'unload', 'gate out', 'release'],
    type: 'status',
  },
  'Financial & Charges': {
    keywords: ['invoice', 'charge', 'demurrage', 'detention', 'payment', 'fee', 'cost'],
    type: 'financial',
  },
  'Container Status': {
    keywords: ['container', 'equipment', 'pickup', 'empty', 'laden', 'gate in'],
    type: 'status',
  },
};

// Minimum similarity for historical context
const HISTORICAL_MIN_SIMILARITY = 0.78;

// How far back to look for historical context (days)
const HISTORICAL_LOOKBACK_DAYS = 60;

// Minimum communications to form a group
const MIN_GROUP_SIZE = 2;

// ============================================================================
// IMPLEMENTATION
// ============================================================================

export class SemanticGroupingService implements ISemanticGroupingService {
  private embeddingService: IEmbeddingService | null = null;

  constructor(
    private readonly supabase: SupabaseClient
  ) {
    // Initialize embedding service
    try {
      this.embeddingService = createEmbeddingService(supabase);
    } catch (error) {
      console.warn('[SemanticGrouping] Could not initialize embedding service:', error);
    }
  }

  // ==========================================================================
  // MAIN GROUPING METHOD
  // ==========================================================================

  async groupCommunications(
    shipmentId: string,
    recentCommunications: CommunicationItem[]
  ): Promise<SemanticGroupingResult> {
    if (recentCommunications.length === 0) {
      return { groups: [], historicalContext: [], ungroupedCount: 0 };
    }

    // Step 1: Classify each communication by topic using keywords
    const classified = this.classifyByTopic(recentCommunications);

    // Step 2: Group by topic
    const groups = this.buildGroups(classified);

    // Step 3: Find ongoing issues that need historical context
    const ongoingIssues = groups
      .filter(g => g.isOngoing && (g.topicType === 'issue' || g.topicType === 'documentation'))
      .map(g => g.topic);

    // Step 4: Fetch historical context for ongoing issues
    let historicalContext: HistoricalContext[] = [];
    if (ongoingIssues.length > 0 && this.embeddingService) {
      historicalContext = await this.findHistoricalContext(shipmentId, ongoingIssues);
    }

    // Count ungrouped items (those in 'General' topic)
    const ungroupedCount = groups.find(g => g.topic === 'General Communications')?.communications.length || 0;

    return {
      groups: groups.filter(g => g.topic !== 'General Communications' || g.communications.length >= MIN_GROUP_SIZE),
      historicalContext,
      ungroupedCount,
    };
  }

  // ==========================================================================
  // TOPIC CLASSIFICATION
  // ==========================================================================

  private classifyByTopic(
    communications: CommunicationItem[]
  ): Map<string, CommunicationItem[]> {
    const topicMap = new Map<string, CommunicationItem[]>();

    for (const comm of communications) {
      const searchText = `${comm.summary} ${comm.documentType || ''} ${comm.issueType || ''}`.toLowerCase();
      let assigned = false;

      // Check against topic patterns
      for (const [topic, config] of Object.entries(TOPIC_PATTERNS)) {
        const matches = config.keywords.some(kw => searchText.includes(kw));
        if (matches) {
          const existing = topicMap.get(topic) || [];
          existing.push(comm);
          topicMap.set(topic, existing);
          assigned = true;
          break; // First match wins
        }
      }

      // Group by issue type if has issue
      if (!assigned && comm.hasIssue && comm.issueType) {
        const topic = `Issue: ${this.formatTopicName(comm.issueType)}`;
        const existing = topicMap.get(topic) || [];
        existing.push(comm);
        topicMap.set(topic, existing);
        assigned = true;
      }

      // Group by document type if not assigned
      if (!assigned && comm.documentType) {
        const topic = `${this.formatTopicName(comm.documentType)}`;
        const existing = topicMap.get(topic) || [];
        existing.push(comm);
        topicMap.set(topic, existing);
        assigned = true;
      }

      // Fallback: General
      if (!assigned) {
        const existing = topicMap.get('General Communications') || [];
        existing.push(comm);
        topicMap.set('General Communications', existing);
      }
    }

    return topicMap;
  }

  private formatTopicName(raw: string): string {
    return raw
      .replace(/_/g, ' ')
      .split(' ')
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  // ==========================================================================
  // GROUP BUILDING
  // ==========================================================================

  private buildGroups(classified: Map<string, CommunicationItem[]>): SemanticGroup[] {
    const groups: SemanticGroup[] = [];

    for (const [topic, comms] of classified) {
      // Sort by date
      const sorted = comms.sort((a, b) =>
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime()
      );

      // Determine topic type
      const topicConfig = Object.entries(TOPIC_PATTERNS).find(([t]) => t === topic)?.[1];
      const topicType = topicConfig?.type || this.inferTopicType(topic, sorted);

      // Check if ongoing (has unresolved issue or action)
      const isOngoing = sorted.some(c =>
        (c.hasIssue) || (c.hasAction && c.actionDescription)
      );

      // Build summary of the group
      const summary = this.buildGroupSummary(topic, sorted);

      groups.push({
        topic,
        topicType,
        communications: sorted,
        summary,
        isOngoing,
        oldestDate: sorted[0].occurredAt,
        newestDate: sorted[sorted.length - 1].occurredAt,
      });
    }

    // Sort groups: ongoing issues first, then by recency
    return groups.sort((a, b) => {
      if (a.isOngoing && !b.isOngoing) return -1;
      if (!a.isOngoing && b.isOngoing) return 1;
      return new Date(b.newestDate).getTime() - new Date(a.newestDate).getTime();
    });
  }

  private inferTopicType(topic: string, comms: CommunicationItem[]): SemanticGroup['topicType'] {
    const hasIssue = comms.some(c => c.hasIssue);
    if (hasIssue || topic.startsWith('Issue:')) return 'issue';

    const docTypes = new Set(comms.map(c => c.documentType).filter(Boolean));
    if (docTypes.has('invoice') || topic.includes('Financial')) return 'financial';
    if (docTypes.size > 0) return 'documentation';

    return 'general';
  }

  private buildGroupSummary(topic: string, comms: CommunicationItem[]): string {
    const count = comms.length;
    const parties = [...new Set(comms.map(c => c.fromParty))].slice(0, 3);
    const hasUnresolved = comms.some(c => c.hasIssue || c.hasAction);

    let summary = `${count} message${count > 1 ? 's' : ''} from ${parties.join(', ')}`;
    if (hasUnresolved) {
      summary += ' (ongoing)';
    }
    return summary;
  }

  // ==========================================================================
  // HISTORICAL CONTEXT
  // ==========================================================================

  async findHistoricalContext(
    shipmentId: string,
    currentIssues: string[]
  ): Promise<HistoricalContext[]> {
    if (!this.embeddingService || currentIssues.length === 0) {
      return [];
    }

    const results: HistoricalContext[] = [];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - HISTORICAL_LOOKBACK_DAYS);

    // Get recent chronicle IDs to exclude
    const { data: recentIds } = await this.supabase
      .from('chronicle')
      .select('id')
      .eq('shipment_id', shipmentId)
      .gte('occurred_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    const excludeIds = new Set((recentIds || []).map(r => r.id));

    for (const issue of currentIssues.slice(0, 3)) { // Limit to top 3 issues
      try {
        // Search for semantically similar older communications
        const searchResults = await this.embeddingService.searchGlobal(issue, {
          limit: 5,
          minSimilarity: HISTORICAL_MIN_SIMILARITY,
        });

        // Filter to only this shipment and older communications
        for (const result of searchResults) {
          if (excludeIds.has(result.id)) continue;

          // Verify it belongs to this shipment
          const { data: chronicle } = await this.supabase
            .from('chronicle')
            .select('id, occurred_at, document_type, summary, shipment_id')
            .eq('id', result.id)
            .single();

          if (chronicle && chronicle.shipment_id === shipmentId) {
            const occurredAt = new Date(chronicle.occurred_at);
            if (occurredAt >= cutoffDate) {
              results.push({
                chronicleId: chronicle.id,
                occurredAt: chronicle.occurred_at,
                documentType: chronicle.document_type || 'unknown',
                summary: chronicle.summary || '',
                similarity: result.similarity,
                relevantTo: issue,
              });
            }
          }
        }
      } catch (error) {
        console.warn(`[SemanticGrouping] Error finding historical context for "${issue}":`, error);
      }
    }

    // Deduplicate and sort by similarity
    const unique = new Map<string, HistoricalContext>();
    for (const ctx of results) {
      const existing = unique.get(ctx.chronicleId);
      if (!existing || ctx.similarity > existing.similarity) {
        unique.set(ctx.chronicleId, ctx);
      }
    }

    return Array.from(unique.values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5); // Top 5 historical items
  }

  // ==========================================================================
  // PROMPT BUILDING
  // ==========================================================================

  buildPromptSection(result: SemanticGroupingResult): string {
    if (result.groups.length === 0 && result.historicalContext.length === 0) {
      return '';
    }

    const sections: string[] = [];

    // Semantic Groups Section
    if (result.groups.length > 0) {
      sections.push('## COMMUNICATIONS BY TOPIC (Semantically Grouped)');
      sections.push('Messages grouped by subject matter for clearer context:\n');

      for (const group of result.groups) {
        const statusIcon = group.isOngoing ? '🔴' : '✅';
        const typeIcon = this.getTopicIcon(group.topicType);

        sections.push(`### ${typeIcon} ${group.topic} ${statusIcon}`);
        sections.push(`${group.summary}\n`);

        // Show communications in this group
        for (const comm of group.communications.slice(0, 5)) {
          const date = new Date(comm.occurredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const dir = comm.direction === 'inbound' ? '←' : '→';
          const flags = [];
          if (comm.hasIssue) flags.push(`[ISSUE: ${comm.issueType}]`);
          if (comm.hasAction) flags.push('[ACTION]');
          const flagStr = flags.length > 0 ? ' ' + flags.join(' ') : '';

          sections.push(`  ${date} ${dir} ${comm.fromParty}: ${comm.summary.slice(0, 60)}${flagStr}`);
        }

        if (group.communications.length > 5) {
          sections.push(`  ... and ${group.communications.length - 5} more`);
        }
        sections.push('');
      }
    }

    // Historical Context Section
    if (result.historicalContext.length > 0) {
      sections.push('## RELEVANT HISTORICAL CONTEXT (Older Communications)');
      sections.push('These older messages may provide important background:\n');

      for (const ctx of result.historicalContext) {
        const date = new Date(ctx.occurredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const simPct = Math.round(ctx.similarity * 100);
        sections.push(`  ${date} [${ctx.documentType}] ${ctx.summary.slice(0, 70)}... (${simPct}% relevant to "${ctx.relevantTo}")`);
      }
      sections.push('');
    }

    return sections.join('\n');
  }

  private getTopicIcon(topicType: SemanticGroup['topicType']): string {
    switch (topicType) {
      case 'issue': return '⚠️';
      case 'documentation': return '📄';
      case 'status': return '📍';
      case 'financial': return '💰';
      default: return '💬';
    }
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createSemanticGroupingService(
  supabase: SupabaseClient
): ISemanticGroupingService {
  return new SemanticGroupingService(supabase);
}
