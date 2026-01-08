/**
 * Stakeholder Registry Service
 *
 * Tracks unique parties (shipper, consignee, notify party) from both
 * Document Registry and Email Registry sources.
 *
 * Inputs:
 * - From Document Registry: extracted party info (names, addresses)
 * - From Email Registry: sender info (email, domain) to match/link
 *
 * Responsibilities:
 * - Find or create parties with deduplication
 * - Link email senders to parties by domain
 * - Log sentiment per party from emails
 * - Track relationships between parties
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { PartyType, CustomerRelationship, Sentiment } from '@/types/intelligence-platform';

// ============================================================================
// TYPES
// ============================================================================

export interface PartyInfo {
  name: string;
  address?: string;
  city?: string;
  country?: string;
  email?: string;
  phone?: string;
}

export interface StakeholderRegistryInput {
  // From Document Registry (extracted parties from documents)
  fromDocument?: {
    shipper?: PartyInfo;
    consignee?: PartyInfo;
    notifyParty?: PartyInfo;
    documentType: string;
  };
  // From Email Registry (sender info from email)
  fromEmail?: {
    senderId: string;
    senderEmail: string;
    senderDomain: string;
    senderName?: string;
    sentiment?: Sentiment;
    sentimentScore?: number;
  };
  shipmentDirection: 'export' | 'import';
  emailId?: string;
}

export interface StakeholderRegistryResult {
  success: boolean;
  shipperId?: string;
  consigneeId?: string;
  notifyPartyId?: string;
  senderPartyId?: string;
  newPartiesCreated: string[];
  partiesMatched: string[];
  sentimentLogged: boolean;
  relationshipsCreated: number;
  error?: string;
}

interface PartyRecord {
  id: string;
  party_name: string;
  party_type: PartyType;
  is_customer: boolean;
  customer_relationship?: CustomerRelationship;
  email_domains: string[];
  total_shipments: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const INTOGLO_IDENTIFIERS = ['intoglo', 'into glo'];
const CUSTOMER_SOURCE_DOCUMENTS = ['hbl', 'si_draft', 'si_final', 'hbl_draft'];

// ============================================================================
// SERVICE
// ============================================================================

export class StakeholderRegistryService {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Register stakeholders from document and email sources
   */
  async register(input: StakeholderRegistryInput): Promise<StakeholderRegistryResult> {
    const result: StakeholderRegistryResult = {
      success: true,
      newPartiesCreated: [],
      partiesMatched: [],
      sentimentLogged: false,
      relationshipsCreated: 0,
    };

    try {
      // Process document parties if provided
      if (input.fromDocument) {
        await this.processDocumentParties(input, result);
      }

      // Process email sender if provided
      if (input.fromEmail) {
        await this.processEmailSender(input, result);
      }

      // Create shipper-consignee relationship if both exist
      if (result.shipperId && result.consigneeId) {
        await this.createRelationship(result.shipperId, result.consigneeId, 'shipper_consignee');
        result.relationshipsCreated++;
      }

      return result;
    } catch (error) {
      console.error('[StakeholderRegistry] Error:', error);
      return {
        ...result,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Process parties extracted from documents
   */
  private async processDocumentParties(
    input: StakeholderRegistryInput,
    result: StakeholderRegistryResult
  ): Promise<void> {
    const { fromDocument, shipmentDirection } = input;
    if (!fromDocument) return;

    const docType = fromDocument.documentType;
    const isCustomerSource = CUSTOMER_SOURCE_DOCUMENTS.includes(docType);

    // Process shipper
    if (fromDocument.shipper && !this.isIntogloParty(fromDocument.shipper.name)) {
      const isCustomer = isCustomerSource && shipmentDirection === 'export';
      const shipperResult = await this.findOrCreateParty(
        fromDocument.shipper,
        'shipper',
        isCustomer,
        isCustomer ? 'shipper_customer' : undefined
      );
      result.shipperId = shipperResult.id;
      if (shipperResult.isNew) {
        result.newPartiesCreated.push(shipperResult.id);
      } else {
        result.partiesMatched.push(shipperResult.id);
      }
    }

    // Process consignee
    if (fromDocument.consignee) {
      const isCustomer = isCustomerSource && shipmentDirection === 'import';
      const consigneeResult = await this.findOrCreateParty(
        fromDocument.consignee,
        'consignee',
        isCustomer,
        isCustomer ? 'consignee_customer' : undefined
      );
      result.consigneeId = consigneeResult.id;
      if (consigneeResult.isNew) {
        result.newPartiesCreated.push(consigneeResult.id);
      } else {
        result.partiesMatched.push(consigneeResult.id);
      }
    }

    // Process notify party
    if (fromDocument.notifyParty) {
      const notifyResult = await this.findOrCreateParty(
        fromDocument.notifyParty,
        'notify_party',
        false
      );
      result.notifyPartyId = notifyResult.id;
      if (notifyResult.isNew) {
        result.newPartiesCreated.push(notifyResult.id);
      } else {
        result.partiesMatched.push(notifyResult.id);
      }
    }
  }

  /**
   * Process email sender - try to match to existing party
   */
  private async processEmailSender(
    input: StakeholderRegistryInput,
    result: StakeholderRegistryResult
  ): Promise<void> {
    const { fromEmail, emailId } = input;
    if (!fromEmail) return;

    // Skip Intoglo emails
    if (this.isIntogloDomain(fromEmail.senderDomain)) {
      return;
    }

    // Try to find party by domain
    const { data: partyByDomain } = await this.supabase
      .from('parties')
      .select('id')
      .contains('email_domains', [fromEmail.senderDomain])
      .limit(1)
      .single();

    if (partyByDomain) {
      result.senderPartyId = partyByDomain.id;
      result.partiesMatched.push(partyByDomain.id);

      // Update email_senders to link to party if not already linked
      await this.supabase
        .from('email_senders')
        .update({ party_id: partyByDomain.id })
        .eq('id', fromEmail.senderId)
        .is('party_id', null);
    }

    // Log sentiment if provided
    if (fromEmail.sentiment && result.senderPartyId && emailId) {
      await this.logSentiment(
        result.senderPartyId,
        emailId,
        fromEmail.sentiment,
        fromEmail.sentimentScore
      );
      result.sentimentLogged = true;
    }
  }

  /**
   * Find or create a party record
   */
  private async findOrCreateParty(
    info: PartyInfo,
    partyType: PartyType,
    isCustomer: boolean,
    customerRelationship?: CustomerRelationship
  ): Promise<{ id: string; isNew: boolean }> {
    const cleanName = this.normalizeName(info.name);
    if (!cleanName) {
      throw new Error('Party name is required');
    }

    // Try to find by exact name and type
    const { data: existingByName } = await this.supabase
      .from('parties')
      .select('id, party_name, party_type, email_domains, total_shipments, is_customer')
      .eq('party_name', cleanName)
      .eq('party_type', partyType)
      .single();

    if (existingByName) {
      await this.updateExistingParty(existingByName as PartyRecord, info, isCustomer, customerRelationship);
      return { id: existingByName.id, isNew: false };
    }

    // Try to find by email if provided
    if (info.email) {
      const { data: existingByEmail } = await this.supabase
        .from('parties')
        .select('id, party_name, party_type, email_domains, total_shipments, is_customer')
        .eq('contact_email', info.email.toLowerCase())
        .single();

      if (existingByEmail) {
        await this.updateExistingParty(existingByEmail as PartyRecord, info, isCustomer, customerRelationship);
        return { id: existingByEmail.id, isNew: false };
      }
    }

    // Create new party
    const domain = info.email ? this.extractDomain(info.email) : null;
    const emailDomains = domain ? [domain] : [];

    const { data: newParty, error } = await this.supabase
      .from('parties')
      .insert({
        party_name: cleanName,
        party_type: partyType,
        address: info.address,
        city: info.city,
        country: info.country,
        contact_email: info.email?.toLowerCase(),
        contact_phone: info.phone,
        is_customer: isCustomer,
        customer_relationship: customerRelationship,
        email_domains: emailDomains,
        total_shipments: 1,
        total_revenue: 0,
        total_cost: 0,
        common_routes: [],
      })
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to create party: ${error.message}`);
    }

    return { id: newParty.id, isNew: true };
  }

  /**
   * Update existing party with new information
   */
  private async updateExistingParty(
    existing: PartyRecord,
    info: PartyInfo,
    isCustomer: boolean,
    customerRelationship?: CustomerRelationship
  ): Promise<void> {
    const updates: Record<string, unknown> = {
      total_shipments: (existing.total_shipments || 0) + 1,
      updated_at: new Date().toISOString(),
    };

    // Upgrade to customer if applicable
    if (isCustomer && !existing.is_customer) {
      updates.is_customer = true;
      updates.customer_relationship = customerRelationship;
    }

    // Add new email domain if applicable
    if (info.email) {
      const domain = this.extractDomain(info.email);
      if (domain && !existing.email_domains?.includes(domain)) {
        updates.email_domains = [...(existing.email_domains || []), domain];
      }
    }

    await this.supabase.from('parties').update(updates).eq('id', existing.id);
  }

  /**
   * Create relationship between two parties
   */
  private async createRelationship(
    partyAId: string,
    partyBId: string,
    type: 'shipper_consignee' | 'customer_agent' | 'regular_trading_partner'
  ): Promise<void> {
    await this.supabase.from('stakeholder_relationships').upsert(
      {
        party_a_id: partyAId,
        party_b_id: partyBId,
        relationship_type: type,
        shipment_count: 1,
        last_shipment_date: new Date().toISOString(),
      },
      { onConflict: 'party_a_id,party_b_id' }
    );
  }

  /**
   * Log sentiment for a party
   */
  private async logSentiment(
    partyId: string,
    emailId: string,
    sentiment: Sentiment,
    score?: number
  ): Promise<void> {
    await this.supabase.from('stakeholder_sentiment_log').insert({
      party_id: partyId,
      source_email_id: emailId,
      sentiment: sentiment,
      sentiment_score: score ?? this.getSentimentScore(sentiment),
      analyzed_at: new Date().toISOString(),
    });
  }

  /**
   * Get default sentiment score
   */
  private getSentimentScore(sentiment: Sentiment): number {
    switch (sentiment) {
      case 'positive':
        return 0.8;
      case 'neutral':
        return 0.5;
      case 'negative':
        return 0.2;
      case 'urgent':
        return 0.3;
      default:
        return 0.5;
    }
  }

  /**
   * Check if name belongs to Intoglo
   */
  private isIntogloParty(name: string): boolean {
    const lowerName = name.toLowerCase();
    return INTOGLO_IDENTIFIERS.some((id) => lowerName.includes(id));
  }

  /**
   * Check if domain belongs to Intoglo
   */
  private isIntogloDomain(domain: string): boolean {
    return domain.includes('intoglo');
  }

  /**
   * Normalize party name
   */
  private normalizeName(name: string): string {
    return name
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[^\w\s.\-&,]/g, '')
      .toUpperCase();
  }

  /**
   * Extract domain from email
   */
  private extractDomain(email: string): string | null {
    const match = email.match(/@([^@]+)$/);
    return match ? match[1].toLowerCase() : null;
  }

  /**
   * Get party by ID
   */
  async getPartyById(partyId: string): Promise<PartyRecord | null> {
    const { data } = await this.supabase
      .from('parties')
      .select('*')
      .eq('id', partyId)
      .single();
    return data;
  }

  /**
   * Link email sender to party by domain match
   */
  async linkSenderToPartyByDomain(senderId: string, domain: string): Promise<string | null> {
    const { data: party } = await this.supabase
      .from('parties')
      .select('id')
      .contains('email_domains', [domain])
      .limit(1)
      .single();

    if (party) {
      await this.supabase
        .from('email_senders')
        .update({ party_id: party.id })
        .eq('id', senderId);
      return party.id;
    }

    return null;
  }
}

// Factory function
export function createStakeholderRegistryService(
  supabase: SupabaseClient
): StakeholderRegistryService {
  return new StakeholderRegistryService(supabase);
}
