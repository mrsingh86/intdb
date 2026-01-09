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
}

// ============================================================================
// FACTORY
// ============================================================================

export function createChronicleRepository(supabase: SupabaseClient): IChronicleRepository {
  return new ChronicleRepository(supabase);
}
