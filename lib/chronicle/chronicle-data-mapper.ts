/**
 * Chronicle Data Mapper
 *
 * Pure data transformation: maps ProcessedEmail + ShippingAnalysis → ChronicleInsertData.
 * Extracted from ChronicleService (P2-15 God class decomposition).
 *
 * Responsibilities:
 * - Sanitize string fields for PostgreSQL (strip \u0000 null bytes)
 * - Map AI analysis output + email metadata into database insert format
 *
 * Following CLAUDE.md principles:
 * - Single Responsibility (Principle #3)
 * - Small Functions < 20 lines (Principle #17)
 * - Deep Modules (Principle #8) - simple interface hiding 120+ field mapping
 */

import {
  ProcessedEmail,
  ProcessedAttachment,
  ShippingAnalysis,
  detectPartyType,
  extractTrueSender,
} from './types';
import { ChronicleInsertData } from './interfaces';
import { ActionRecommendation } from './unified-action-service';
import { ConfidenceResult } from './objective-confidence-service';
import { AI_CONFIG } from './prompts/freight-forwarder.prompt';

export interface ConfidenceData {
  confidenceSource: string;
  confidenceSignals: ConfidenceResult['signals'] | null;
  escalatedTo: string | null;
  escalationReason: string | null;
}

/**
 * Maps email + analysis data into chronicle database insert format.
 * Stateless - all methods are static (pure functions).
 */
export class ChronicleDataMapper {
  /**
   * Strip null bytes (\u0000) that crash PostgreSQL.
   * Applies to all string fields before DB insert.
   */
  static sanitizeForDb(value: string | null | undefined): string | null {
    if (!value) return null;
    // eslint-disable-next-line no-control-regex
    return value.replace(/\u0000/g, '');
  }

  /**
   * Build the full insert data object for the chronicle table.
   * Maps 120+ fields from email, analysis, actions, and confidence.
   */
  static buildInsertData(
    email: ProcessedEmail,
    analysis: ShippingAnalysis,
    attachmentsWithText: ProcessedAttachment[],
    actionRecommendation?: ActionRecommendation,
    confidenceData?: ConfidenceData
  ): ChronicleInsertData {
    const trueSender = extractTrueSender(email);
    const fromParty = analysis.from_party || detectPartyType(trueSender);
    const s = ChronicleDataMapper.sanitizeForDb;

    return {
      gmail_message_id: email.gmailMessageId,
      thread_id: email.threadId,
      direction: email.direction,
      from_party: fromParty,
      from_address: email.senderEmail,
      transport_mode: analysis.transport_mode,

      // Identifiers
      booking_number: s(analysis.booking_number),
      mbl_number: s(analysis.mbl_number),
      hbl_number: s(analysis.hbl_number),
      container_numbers: analysis.container_numbers || [],
      mawb_number: s(analysis.mawb_number),
      hawb_number: s(analysis.hawb_number),
      work_order_number: s(analysis.work_order_number),
      pro_number: s(analysis.pro_number),
      reference_numbers: analysis.reference_numbers || [],
      identifier_source: analysis.identifier_source,
      document_type: analysis.document_type,

      // 4-Point Routing
      por_location: s(analysis.por_location),
      por_type: analysis.por_type || null,
      pol_location: s(analysis.pol_location),
      pol_type: analysis.pol_type || null,
      pod_location: s(analysis.pod_location),
      pod_type: analysis.pod_type || null,
      pofd_location: s(analysis.pofd_location),
      pofd_type: analysis.pofd_type || null,

      // Vessel/Carrier
      vessel_name: s(analysis.vessel_name),
      voyage_number: s(analysis.voyage_number),
      flight_number: s(analysis.flight_number),
      carrier_name: s(analysis.carrier_name),

      // Dates
      etd: analysis.etd || null,
      atd: analysis.atd || null,
      eta: analysis.eta || null,
      ata: analysis.ata || null,
      pickup_date: analysis.pickup_date || null,
      delivery_date: analysis.delivery_date || null,

      // Cutoffs
      si_cutoff: analysis.si_cutoff || null,
      vgm_cutoff: analysis.vgm_cutoff || null,
      cargo_cutoff: analysis.cargo_cutoff || null,
      doc_cutoff: analysis.doc_cutoff || null,

      // Demurrage/Detention
      last_free_day: analysis.last_free_day || null,
      empty_return_date: analysis.empty_return_date || null,

      // POD
      pod_delivery_date: analysis.pod_delivery_date || null,
      pod_signed_by: s(analysis.pod_signed_by),

      // Cargo
      container_type: s(analysis.container_type),
      weight: s(analysis.weight),
      pieces: analysis.pieces || null,
      commodity: s(analysis.commodity),

      // Stakeholders
      shipper_name: s(analysis.shipper_name),
      shipper_address: s(analysis.shipper_address),
      shipper_contact: s(analysis.shipper_contact),
      consignee_name: s(analysis.consignee_name),
      consignee_address: s(analysis.consignee_address),
      consignee_contact: s(analysis.consignee_contact),
      notify_party_name: s(analysis.notify_party_name),
      notify_party_address: s(analysis.notify_party_address),
      notify_party_contact: s(analysis.notify_party_contact),

      // Financial
      invoice_number: s(analysis.invoice_number),
      amount: analysis.amount || null,
      currency: s(analysis.currency),

      // Intelligence
      message_type: analysis.message_type,
      sentiment: analysis.sentiment,
      summary: s(analysis.summary) || 'No summary available',
      has_action: analysis.has_action,
      action_description: s(analysis.action_description),
      action_owner: analysis.action_owner || null,
      action_deadline: analysis.action_deadline || null,
      action_priority: analysis.action_priority || null,

      // Action fields (from UnifiedActionService)
      action_type: actionRecommendation?.actionType || null,
      action_verb: actionRecommendation?.actionVerb || null,
      action_priority_score: actionRecommendation?.priority || null,
      action_deadline_source: actionRecommendation?.deadlineSource || null,
      action_auto_resolve_on: actionRecommendation?.autoResolveOn || [],
      action_auto_resolve_keywords: actionRecommendation?.autoResolveKeywords || [],
      action_confidence: actionRecommendation?.confidence || null,
      action_source: actionRecommendation?.source || null,

      has_issue: analysis.has_issue || false,
      issue_type: analysis.issue_type || null,
      issue_description: s(analysis.issue_description),

      // Raw content (sanitize text fields that may contain null bytes)
      subject: s(email.subject) || '',
      snippet: s(email.snippet) || '',
      body_preview: s(email.bodyText.substring(0, 1000)) || '',
      attachments: attachmentsWithText,
      ai_response: analysis,
      ai_model: AI_CONFIG.model,
      occurred_at: email.receivedAt.toISOString(),

      // Confidence tracking (from ObjectiveConfidenceService)
      confidence_source: confidenceData?.confidenceSource || null,
      confidence_signals: confidenceData?.confidenceSignals || null,
      escalated_to: confidenceData?.escalatedTo || null,
      escalation_reason: confidenceData?.escalationReason || null,
    };
  }
}
