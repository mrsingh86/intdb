/**
 * Entity Repository
 *
 * Abstracts all database access for entity extractions.
 * Hides Supabase implementation details from business logic.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { EntityExtraction } from '@/types/email-intelligence';

export class EntityRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Find entities by email IDs
   */
  async findByEmailIds(emailIds: string[]): Promise<EntityExtraction[]> {
    if (emailIds.length === 0) return [];

    const { data, error } = await this.supabase
      .from('entity_extractions')
      .select('*')
      .in('email_id', emailIds);

    if (error) {
      throw new Error(`Failed to fetch entities: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Find entities for a single email
   */
  async findByEmailId(emailId: string): Promise<EntityExtraction[]> {
    const { data, error } = await this.supabase
      .from('entity_extractions')
      .select('*')
      .eq('email_id', emailId);

    if (error) {
      throw new Error(`Failed to fetch entities: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Create new entities (batch)
   */
  async createMany(entities: Partial<EntityExtraction>[]): Promise<EntityExtraction[]> {
    if (entities.length === 0) return [];

    const { data, error } = await this.supabase
      .from('entity_extractions')
      .insert(entities)
      .select();

    if (error || !data) {
      throw new Error(`Failed to create entities: ${error?.message}`);
    }

    return data;
  }

  /**
   * Update existing entity
   */
  async update(
    id: string,
    updates: Partial<EntityExtraction>
  ): Promise<EntityExtraction> {
    const { data, error } = await this.supabase
      .from('entity_extractions')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to update entity: ${error?.message}`);
    }

    return data;
  }

  /**
   * Find emails that have identifier entities (booking_number, bl_number, container_number)
   * Used for backfill linking process
   */
  async findEmailsWithIdentifiers(
    limit: number = 1000,
    offset: number = 0
  ): Promise<{ email_id: string }[]> {
    const identifierTypes = ['booking_number', 'bl_number', 'container_number'];

    const { data, error } = await this.supabase
      .from('entity_extractions')
      .select('email_id')
      .in('entity_type', identifierTypes)
      .not('entity_value', 'is', null)
      .range(offset, offset + limit - 1);

    if (error) {
      throw new Error(`Failed to fetch emails with identifiers: ${error.message}`);
    }

    // Dedupe email_ids (one email can have multiple identifier types)
    const uniqueEmailIds = [...new Set((data || []).map(e => e.email_id))];
    return uniqueEmailIds.map(email_id => ({ email_id }));
  }

  /**
   * Find entities by type and value (for matching against shipments)
   */
  async findByTypeAndValue(
    entityType: string,
    entityValue: string
  ): Promise<EntityExtraction[]> {
    const { data, error } = await this.supabase
      .from('entity_extractions')
      .select('*')
      .eq('entity_type', entityType)
      .eq('entity_value', entityValue);

    if (error) {
      throw new Error(`Failed to fetch entities: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Find all emails that have a specific identifier value
   * Useful for finding related emails for linking
   */
  async findEmailIdsByIdentifier(
    identifierType: 'booking_number' | 'bl_number' | 'container_number',
    identifierValue: string
  ): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('entity_extractions')
      .select('email_id')
      .eq('entity_type', identifierType)
      .eq('entity_value', identifierValue);

    if (error) {
      throw new Error(`Failed to fetch email IDs: ${error.message}`);
    }

    return [...new Set((data || []).map(e => e.email_id))];
  }
}
