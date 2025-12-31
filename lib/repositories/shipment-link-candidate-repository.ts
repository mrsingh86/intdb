/**
 * Shipment Link Candidate Repository
 *
 * Manages AI-generated linking suggestions for manual review.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { ShipmentLinkCandidate } from '@/types/shipment';

export class ShipmentLinkCandidateRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Find all pending link candidates (not confirmed/rejected)
   */
  async findPending(): Promise<ShipmentLinkCandidate[]> {
    const { data, error } = await this.supabase
      .from('shipment_link_candidates')
      .select('*')
      .eq('is_confirmed', false)
      .eq('is_rejected', false)
      .order('confidence_score', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch link candidates: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Find pending candidates with email data for deduplication
   * Includes true_sender_email, gmail_message_id for grouping
   */
  async findPendingWithEmailData(): Promise<(ShipmentLinkCandidate & {
    gmail_message_id?: string;
    true_sender_email?: string;
    sender_email?: string;
    subject?: string;
  })[]> {
    const { data: candidates, error: candidateError } = await this.supabase
      .from('shipment_link_candidates')
      .select('*')
      .eq('is_confirmed', false)
      .eq('is_rejected', false)
      .order('confidence_score', { ascending: false });

    if (candidateError) {
      throw new Error(`Failed to fetch link candidates: ${candidateError.message}`);
    }

    if (!candidates || candidates.length === 0) {
      return [];
    }

    // Get email IDs to fetch email data
    const emailIds = candidates.map(c => c.email_id).filter(Boolean);

    if (emailIds.length === 0) {
      return candidates;
    }

    // Fetch email data for deduplication
    const { data: emails, error: emailError } = await this.supabase
      .from('raw_emails')
      .select('id, gmail_message_id, sender_email, true_sender_email, subject')
      .in('id', emailIds);

    if (emailError) {
      console.error('Failed to fetch email data:', emailError);
      return candidates;
    }

    // Create map for quick lookup
    const emailMap = new Map(
      (emails || []).map(e => [e.id, {
        gmail_message_id: e.gmail_message_id,
        sender_email: e.sender_email,
        true_sender_email: e.true_sender_email,
        subject: e.subject,
      }])
    );

    // Merge email data into candidates
    return candidates.map(candidate => ({
      ...candidate,
      ...(emailMap.get(candidate.email_id) || {}),
    }));
  }

  /**
   * Find candidates for a specific email
   */
  async findByEmailId(emailId: string): Promise<ShipmentLinkCandidate[]> {
    const { data, error } = await this.supabase
      .from('shipment_link_candidates')
      .select('*')
      .eq('email_id', emailId)
      .order('confidence_score', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch candidates: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Create a new link candidate
   */
  async create(candidate: Partial<ShipmentLinkCandidate>): Promise<ShipmentLinkCandidate> {
    const { data, error } = await this.supabase
      .from('shipment_link_candidates')
      .insert(candidate)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to create link candidate: ${error?.message}`);
    }

    return data;
  }

  /**
   * Confirm a link candidate
   */
  async confirm(id: string, userId?: string): Promise<ShipmentLinkCandidate> {
    const { data, error } = await this.supabase
      .from('shipment_link_candidates')
      .update({
        is_confirmed: true,
        confirmed_by: userId,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to confirm candidate: ${error?.message}`);
    }

    return data;
  }

  /**
   * Reject a link candidate
   */
  async reject(id: string, reason?: string): Promise<ShipmentLinkCandidate> {
    const { data, error } = await this.supabase
      .from('shipment_link_candidates')
      .update({
        is_rejected: true,
        rejection_reason: reason,
      })
      .eq('id', id)
      .select()
      .single();

    if (error || !data) {
      throw new Error(`Failed to reject candidate: ${error?.message}`);
    }

    return data;
  }
}
