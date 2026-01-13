/**
 * Chronicle Repository
 *
 * Data access layer for chronicle records.
 *
 * Following CLAUDE.md principles:
 * - Separation of Concerns (Principle #7)
 * - Single Responsibility (Principle #3)
 * - Never Return Null (Principle #20)
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { IChronicleRepository, ChronicleInsertData } from './interfaces';
import { ThreadContext, ThreadEmailSummary, ChronicleSyncState } from './types';

// ============================================================================
// CHRONICLE REPOSITORY IMPLEMENTATION
// ============================================================================

export class ChronicleRepository implements IChronicleRepository {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Check if email already processed
   */
  async findByGmailMessageId(messageId: string): Promise<{ id: string } | null> {
    const { data } = await this.supabase
      .from('chronicle')
      .select('id')
      .eq('gmail_message_id', messageId)
      .single();

    return data;
  }

  /**
   * Insert chronicle record
   */
  async insert(data: ChronicleInsertData): Promise<{ id: string }> {
    const { data: inserted, error } = await this.supabase
      .from('chronicle')
      .insert(data)
      .select('id')
      .single();

    if (error) {
      throw new Error(`Insert failed: ${error.message}`);
    }

    return inserted;
  }

  /**
   * Link chronicle to shipment using database function
   */
  async linkToShipment(chronicleId: string): Promise<{
    shipmentId?: string;
    linkedBy?: string;
  }> {
    try {
      const { data: linkResult } = await this.supabase
        .rpc('link_chronicle_to_shipment', { chronicle_id: chronicleId });

      if (linkResult && linkResult.length > 0) {
        return {
          shipmentId: linkResult[0].shipment_id,
          linkedBy: linkResult[0].linked_by,
        };
      }

      return {};
    } catch (error) {
      console.error('[Chronicle] Linking failed:', error);
      return {};
    }
  }

  /**
   * Resolve pending actions when confirmation documents arrive
   *
   * When VGM confirmation arrives → mark VGM-related actions as completed
   * When SI confirmation arrives → mark SI-related actions as completed
   */
  async resolveRelatedActions(
    shipmentId: string,
    documentType: string,
    resolvedAt: string
  ): Promise<number> {
    // Map confirmation types to action keywords they resolve
    const resolutionMap: Record<string, string[]> = {
      // Pre-shipment confirmations
      'vgm_confirmation': ['vgm', 'verified gross mass'],
      'si_confirmation': ['si', 'shipping instruction', 'shipping instructions'],
      'sob_confirmation': ['shipped', 'on board', 'sob'],
      'booking_confirmation': ['booking', 'book'],
      'leo_copy': ['leo', 'let export'],
      // BL confirmations
      'draft_bl': ['bl draft', 'draft bl'],
      'final_bl': ['release bl', 'bl release', 'share bl', 'provide bl', 'bill of lading'],
      'telex_release': ['release bl', 'bl release', 'telex', 'express release'],
      'sea_waybill': ['sea waybill', 'seaway', 'swb'],
      // Destination confirmations
      'arrival_notice': ['arrival', 'arrive'],
      'container_release': ['container release', 'pickup'],
      'delivery_order': ['delivery order', 'do release'],
      'pod_proof_of_delivery': ['proof of delivery', 'pod', 'delivered'],
    };

    const keywords = resolutionMap[documentType];
    if (!keywords || keywords.length === 0) {
      return 0; // No actions to resolve for this document type
    }

    // Build the keyword match condition
    // Match any pending action whose description contains these keywords
    const keywordConditions = keywords
      .map(kw => `action_description ILIKE '%${kw}%'`)
      .join(' OR ');

    // Update all pending actions that match
    const { data, error } = await this.supabase
      .from('chronicle')
      .update({ action_completed_at: resolvedAt })
      .eq('shipment_id', shipmentId)
      .eq('has_action', true)
      .is('action_completed_at', null)
      .or(keywordConditions)
      .select('id');

    if (error) {
      console.error('[Chronicle] Action resolution failed:', error);
      return 0;
    }

    // Return count of resolved actions
    return data?.length ?? 0;
  }

  /**
   * Get thread context for AI analysis
   * Fetches previous emails in the same thread to provide context
   */
  async getThreadContext(
    threadId: string,
    beforeDate: Date
  ): Promise<ThreadContext | null> {
    const { data: threadEmails, error } = await this.supabase
      .from('chronicle')
      .select(`
        occurred_at, subject, document_type, summary, direction, from_party,
        has_issue, has_action, vessel_name, etd, eta, booking_number,
        mbl_number, container_numbers, shipment_id
      `)
      .eq('thread_id', threadId)
      .lt('occurred_at', beforeDate.toISOString())
      .order('occurred_at', { ascending: true })
      .limit(10); // Limit to last 10 emails in thread for context

    if (error || !threadEmails || threadEmails.length === 0) {
      return null;
    }

    // Build previous email summaries
    const previousEmails: ThreadEmailSummary[] = threadEmails.map(email => ({
      occurredAt: email.occurred_at,
      subject: email.subject,
      documentType: email.document_type,
      summary: email.summary || '',
      direction: email.direction as 'inbound' | 'outbound',
      fromParty: email.from_party,
      hasIssue: email.has_issue || false,
      hasAction: email.has_action || false,
      keyValues: {
        vesselName: email.vessel_name || undefined,
        etd: email.etd || undefined,
        eta: email.eta || undefined,
        bookingNumber: email.booking_number || undefined,
        mblNumber: email.mbl_number || undefined,
        containerNumbers: email.container_numbers || undefined,
      },
    }));

    // Aggregate known values from the thread (most recent non-null value wins)
    const knownValues = this.aggregateKnownValues(threadEmails);

    return {
      threadId,
      emailCount: threadEmails.length,
      previousEmails,
      knownValues,
      firstEmailDate: threadEmails[0]?.occurred_at,
      lastEmailDate: threadEmails[threadEmails.length - 1]?.occurred_at,
      linkedShipmentId: threadEmails.find(e => e.shipment_id)?.shipment_id,
    };
  }

  /**
   * Aggregate known values from thread emails
   * Takes the most recent non-null value for each field
   */
  private aggregateKnownValues(emails: any[]): ThreadContext['knownValues'] {
    const knownValues: ThreadContext['knownValues'] = {};

    // Process in chronological order, later values override earlier
    for (const email of emails) {
      if (email.booking_number) knownValues.bookingNumber = email.booking_number;
      if (email.mbl_number) knownValues.mblNumber = email.mbl_number;
      if (email.vessel_name) knownValues.vesselName = email.vessel_name;
      if (email.etd) knownValues.etd = email.etd;
      if (email.eta) knownValues.eta = email.eta;
      if (email.container_numbers?.length > 0) {
        knownValues.containerNumbers = email.container_numbers;
      }
    }

    return knownValues;
  }

  /**
   * Get sync state for hybrid fetching
   */
  async getSyncState(): Promise<ChronicleSyncState | null> {
    const { data, error } = await this.supabase
      .from('chronicle_sync_state')
      .select('*')
      .eq('id', 'default')
      .single();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      lastHistoryId: data.last_history_id,
      lastSyncAt: data.last_sync_at,
      lastFullSyncAt: data.last_full_sync_at,
      syncStatus: data.sync_status,
      consecutiveFailures: data.consecutive_failures || 0,
      emailsSyncedTotal: data.emails_synced_total || 0,
    };
  }

  /**
   * Update sync state after fetching
   */
  async updateSyncState(
    historyId: string | null,
    isFullSync: boolean,
    emailsStored: number
  ): Promise<void> {
    const now = new Date().toISOString();

    // Get current state to update totals
    const current = await this.getSyncState();
    const newTotal = (current?.emailsSyncedTotal || 0) + emailsStored;

    const update: any = {
      sync_status: 'active',
      consecutive_failures: 0,
      last_sync_at: now,
      updated_at: now,
      emails_synced_total: newTotal,
    };

    if (historyId) {
      update.last_history_id = historyId;
    }

    if (isFullSync) {
      update.last_full_sync_at = now;
    }

    const { error } = await this.supabase
      .from('chronicle_sync_state')
      .upsert({
        id: 'default',
        ...update,
      });

    if (error) {
      console.error('[ChronicleRepository] Failed to update sync state:', error);
    }
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createChronicleRepository(supabase: SupabaseClient): IChronicleRepository {
  return new ChronicleRepository(supabase);
}
