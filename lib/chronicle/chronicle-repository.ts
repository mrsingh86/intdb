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
      'vgm_confirmation': ['vgm', 'verified gross mass'],
      'si_confirmation': ['si', 'shipping instruction', 'shipping instructions'],
      'sob_confirmation': ['shipped', 'on board', 'sob'],
      'booking_confirmation': ['booking', 'book'],
      'draft_bl': ['bl draft', 'draft bl'],
      'final_bl': ['bl', 'bill of lading'],
      'arrival_notice': ['arrival', 'arrive'],
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
      .or(keywordConditions);

    if (error) {
      console.error('[Chronicle] Action resolution failed:', error);
      return 0;
    }

    // Return count of resolved actions
    return data?.length || 0;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createChronicleRepository(supabase: SupabaseClient): IChronicleRepository {
  return new ChronicleRepository(supabase);
}
