/**
 * Stakeholder Repository
 *
 * Abstracts all database access for parties/stakeholders.
 * Follows same pattern as ShipmentRepository.
 *
 * Principles:
 * - Information Hiding: Hides Supabase implementation
 * - Single Responsibility: Only database access
 * - No Null Returns: Throws exceptions or returns empty arrays
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  Party,
  PartyType,
  StakeholderBehaviorMetrics,
  StakeholderSentimentLog,
  StakeholderExtractionQueue,
  StakeholderRelationship,
  ExtractionStatus,
  MetricPeriod,
  ExtractedParty,
} from '@/types/intelligence-platform';

// ============================================================================
// FILTER TYPES
// ============================================================================

export interface StakeholderQueryFilters {
  party_type?: PartyType[];
  is_customer?: boolean;
  search?: string;
  min_reliability_score?: number;
  has_email_domain?: string;
}

export interface PaginationOptions {
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// ============================================================================
// CUSTOM ERRORS
// ============================================================================

export class StakeholderNotFoundError extends Error {
  constructor(public stakeholderId: string) {
    super(`Stakeholder not found: ${stakeholderId}`);
    this.name = 'StakeholderNotFoundError';
  }
}

export class DuplicateStakeholderError extends Error {
  constructor(public identifier: string) {
    super(`Duplicate stakeholder: ${identifier}`);
    this.name = 'DuplicateStakeholderError';
  }
}

// ============================================================================
// REPOSITORY CLASS
// ============================================================================

export class StakeholderRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  // --------------------------------------------------------------------------
  // PARTY CRUD OPERATIONS
  // --------------------------------------------------------------------------

  /**
   * Find all stakeholders with filters and pagination
   */
  async findAll(
    filters: StakeholderQueryFilters,
    pagination: PaginationOptions
  ): Promise<PaginatedResult<Party>> {
    const offset = (pagination.page - 1) * pagination.limit;

    let query = this.supabase
      .from('parties')
      .select('*', { count: 'exact' })
      .order('total_shipments', { ascending: false, nullsFirst: false })
      .range(offset, offset + pagination.limit - 1);

    // Apply filters
    if (filters.party_type && filters.party_type.length > 0) {
      query = query.in('party_type', filters.party_type);
    }

    if (filters.is_customer !== undefined) {
      query = query.eq('is_customer', filters.is_customer);
    }

    if (filters.min_reliability_score !== undefined) {
      query = query.gte('reliability_score', filters.min_reliability_score);
    }

    if (filters.search) {
      query = query.or(
        `party_name.ilike.%${filters.search}%,contact_email.ilike.%${filters.search}%`
      );
    }

    if (filters.has_email_domain) {
      query = query.contains('email_domains', [filters.has_email_domain]);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch stakeholders: ${error.message}`);
    }

    return {
      data: data || [],
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / pagination.limit),
      },
    };
  }

  /**
   * Find stakeholder by ID
   * @throws StakeholderNotFoundError if not found
   */
  async findById(id: string): Promise<Party> {
    const { data, error } = await this.supabase
      .from('parties')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new StakeholderNotFoundError(id);
    }

    return data;
  }

  /**
   * Find stakeholder by name (fuzzy match)
   */
  async findByName(name: string): Promise<Party[]> {
    const { data, error } = await this.supabase
      .from('parties')
      .select('*')
      .ilike('party_name', `%${name}%`)
      .limit(10);

    if (error) {
      throw new Error(`Failed to search stakeholders: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Find stakeholder by exact name match
   */
  async findByExactName(name: string, partyType?: PartyType): Promise<Party | null> {
    let query = this.supabase
      .from('parties')
      .select('*')
      .eq('party_name', name);

    if (partyType) {
      query = query.eq('party_type', partyType);
    }

    const { data, error } = await query.limit(1).single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  /**
   * Find stakeholder by email domain
   */
  async findByEmailDomain(domain: string): Promise<Party[]> {
    const { data, error } = await this.supabase
      .from('parties')
      .select('*')
      .contains('email_domains', [domain]);

    if (error) {
      throw new Error(`Failed to search by email domain: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Find stakeholder by contact email
   */
  async findByContactEmail(email: string): Promise<Party | null> {
    const { data, error } = await this.supabase
      .from('parties')
      .select('*')
      .eq('contact_email', email)
      .single();

    if (error || !data) {
      return null;
    }

    return data;
  }

  /**
   * Get all customers (is_customer = true)
   */
  async findCustomers(): Promise<Party[]> {
    const { data, error } = await this.supabase
      .from('parties')
      .select('*')
      .eq('is_customer', true)
      .order('total_revenue', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch customers: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get top stakeholders by shipment count
   */
  async findTopByShipmentCount(limit: number = 10): Promise<Party[]> {
    const { data, error } = await this.supabase
      .from('parties')
      .select('*')
      .order('total_shipments', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch top stakeholders: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Create a new stakeholder
   */
  async create(party: Partial<Party>): Promise<Party> {
    const { data, error } = await this.supabase
      .from('parties')
      .insert(party)
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        throw new DuplicateStakeholderError(party.party_name || 'unknown');
      }
      throw new Error(`Failed to create stakeholder: ${error.message}`);
    }

    return data;
  }

  /**
   * Update existing stakeholder
   */
  async update(id: string, updates: Partial<Party>): Promise<Party> {
    const { data, error } = await this.supabase
      .from('parties')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to update stakeholder: ${error?.message}`);
    }

    return data;
  }

  /**
   * Upsert stakeholder (create or update by name + type)
   */
  async upsert(party: Partial<Party>): Promise<Party> {
    // Try to find existing
    const existing = await this.findByExactName(
      party.party_name!,
      party.party_type as PartyType
    );

    if (existing) {
      return this.update(existing.id, party);
    }

    return this.create(party);
  }

  /**
   * Increment shipment count for a stakeholder
   */
  async incrementShipmentCount(id: string): Promise<void> {
    const { error } = await this.supabase.rpc('increment_stakeholder_shipments', {
      stakeholder_id: id,
    });

    // If RPC doesn't exist, do manual update
    if (error) {
      const party = await this.findById(id);
      await this.update(id, {
        total_shipments: (party.total_shipments || 0) + 1,
      });
    }
  }

  /**
   * Add email domain to stakeholder
   */
  async addEmailDomain(id: string, domain: string): Promise<Party> {
    const party = await this.findById(id);
    const domains = party.email_domains || [];

    if (!domains.includes(domain)) {
      domains.push(domain);
      return this.update(id, { email_domains: domains });
    }

    return party;
  }

  // --------------------------------------------------------------------------
  // BEHAVIOR METRICS
  // --------------------------------------------------------------------------

  /**
   * Get behavior metrics for a stakeholder
   */
  async getBehaviorMetrics(
    partyId: string,
    period?: MetricPeriod
  ): Promise<StakeholderBehaviorMetrics[]> {
    let query = this.supabase
      .from('stakeholder_behavior_metrics')
      .select('*')
      .eq('party_id', partyId)
      .order('period_start', { ascending: false });

    if (period) {
      query = query.eq('metric_period', period);
    }

    const { data, error } = await query.limit(12);

    if (error) {
      throw new Error(`Failed to fetch behavior metrics: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Save behavior metrics snapshot
   */
  async saveBehaviorMetrics(
    metrics: Omit<StakeholderBehaviorMetrics, 'id' | 'created_at'>
  ): Promise<StakeholderBehaviorMetrics> {
    const { data, error } = await this.supabase
      .from('stakeholder_behavior_metrics')
      .upsert(metrics, {
        onConflict: 'party_id,metric_period,period_start',
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to save behavior metrics: ${error.message}`);
    }

    return data;
  }

  // --------------------------------------------------------------------------
  // SENTIMENT LOG
  // --------------------------------------------------------------------------

  /**
   * Get sentiment logs for a stakeholder
   */
  async getSentimentLogs(
    partyId: string,
    limit: number = 20
  ): Promise<StakeholderSentimentLog[]> {
    const { data, error } = await this.supabase
      .from('stakeholder_sentiment_log')
      .select('*')
      .eq('party_id', partyId)
      .order('analyzed_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch sentiment logs: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Save sentiment analysis result
   */
  async saveSentimentLog(
    log: Omit<StakeholderSentimentLog, 'id' | 'created_at'>
  ): Promise<StakeholderSentimentLog> {
    const { data, error } = await this.supabase
      .from('stakeholder_sentiment_log')
      .insert(log)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to save sentiment log: ${error.message}`);
    }

    return data;
  }

  /**
   * Get average sentiment score for a stakeholder
   */
  async getAverageSentimentScore(partyId: string): Promise<number | null> {
    const { data, error } = await this.supabase
      .from('stakeholder_sentiment_log')
      .select('sentiment_score')
      .eq('party_id', partyId)
      .order('analyzed_at', { ascending: false })
      .limit(50);

    if (error || !data || data.length === 0) {
      return null;
    }

    const sum = data.reduce((acc, log) => acc + log.sentiment_score, 0);
    return sum / data.length;
  }

  // --------------------------------------------------------------------------
  // EXTRACTION QUEUE
  // --------------------------------------------------------------------------

  /**
   * Get pending extractions from queue
   */
  async getPendingExtractions(limit: number = 50): Promise<StakeholderExtractionQueue[]> {
    const { data, error } = await this.supabase
      .from('stakeholder_extraction_queue')
      .select('*')
      .eq('extraction_status', 'pending')
      .order('queued_at', { ascending: true })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch extraction queue: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Add email to extraction queue
   */
  async queueForExtraction(emailId: string): Promise<StakeholderExtractionQueue> {
    const { data, error } = await this.supabase
      .from('stakeholder_extraction_queue')
      .upsert(
        { email_id: emailId, extraction_status: 'pending' },
        { onConflict: 'email_id' }
      )
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to queue extraction: ${error.message}`);
    }

    return data;
  }

  /**
   * Update extraction status
   */
  async updateExtractionStatus(
    id: string,
    status: ExtractionStatus,
    result?: {
      extracted_parties?: ExtractedParty[];
      matched_party_ids?: string[];
      created_party_ids?: string[];
      error_message?: string;
    }
  ): Promise<StakeholderExtractionQueue> {
    const updates: Partial<StakeholderExtractionQueue> = {
      extraction_status: status,
      processed_at: status === 'completed' || status === 'failed' ? new Date().toISOString() : undefined,
      ...result,
    };

    const { data, error } = await this.supabase
      .from('stakeholder_extraction_queue')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update extraction status: ${error.message}`);
    }

    return data;
  }

  // --------------------------------------------------------------------------
  // RELATIONSHIPS
  // --------------------------------------------------------------------------

  /**
   * Get relationships for a stakeholder
   */
  async getRelationships(partyId: string): Promise<StakeholderRelationship[]> {
    const { data, error } = await this.supabase
      .from('stakeholder_relationships')
      .select('*')
      .or(`party_a_id.eq.${partyId},party_b_id.eq.${partyId}`)
      .order('shipment_count', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch relationships: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Create or update relationship between stakeholders
   */
  async upsertRelationship(
    partyAId: string,
    partyBId: string,
    relationshipType: string
  ): Promise<StakeholderRelationship> {
    // Ensure consistent ordering (lower ID first)
    const [first, second] = partyAId < partyBId ? [partyAId, partyBId] : [partyBId, partyAId];

    const { data: existing } = await this.supabase
      .from('stakeholder_relationships')
      .select('*')
      .eq('party_a_id', first)
      .eq('party_b_id', second)
      .eq('relationship_type', relationshipType)
      .single();

    if (existing) {
      const { data, error } = await this.supabase
        .from('stakeholder_relationships')
        .update({
          shipment_count: existing.shipment_count + 1,
          last_shipment_date: new Date().toISOString().split('T')[0],
        })
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw new Error(`Failed to update relationship: ${error.message}`);
      return data;
    }

    const { data, error } = await this.supabase
      .from('stakeholder_relationships')
      .insert({
        party_a_id: first,
        party_b_id: second,
        relationship_type: relationshipType,
        shipment_count: 1,
        first_shipment_date: new Date().toISOString().split('T')[0],
        last_shipment_date: new Date().toISOString().split('T')[0],
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create relationship: ${error.message}`);
    return data;
  }

  // --------------------------------------------------------------------------
  // STATISTICS
  // --------------------------------------------------------------------------

  /**
   * Get stakeholder statistics
   */
  async getStatistics(): Promise<{
    totalStakeholders: number;
    totalCustomers: number;
    byType: Record<string, number>;
    avgReliabilityScore: number | null;
  }> {
    const { data: parties, error } = await this.supabase
      .from('parties')
      .select('party_type, is_customer, reliability_score');

    if (error) {
      throw new Error(`Failed to fetch statistics: ${error.message}`);
    }

    const byType: Record<string, number> = {};
    let customerCount = 0;
    let reliabilitySum = 0;
    let reliabilityCount = 0;

    for (const party of parties || []) {
      byType[party.party_type] = (byType[party.party_type] || 0) + 1;
      if (party.is_customer) customerCount++;
      if (party.reliability_score !== null) {
        reliabilitySum += party.reliability_score;
        reliabilityCount++;
      }
    }

    return {
      totalStakeholders: parties?.length || 0,
      totalCustomers: customerCount,
      byType,
      avgReliabilityScore: reliabilityCount > 0 ? reliabilitySum / reliabilityCount : null,
    };
  }
}
