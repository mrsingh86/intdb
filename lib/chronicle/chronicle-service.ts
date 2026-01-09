/**
 * Chronicle Service
 *
 * Main intelligence processing service with freight forwarder expertise.
 * Orchestrates email fetching, AI analysis, and storage.
 *
 * Following CLAUDE.md principles:
 * - Deep Modules / Simple Interface (Principle #8)
 * - Single Responsibility (Principle #3) - via composition
 * - Small Functions < 20 lines (Principle #17)
 * - Interface-Based Design (Principle #6)
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  ProcessedEmail,
  ProcessedAttachment,
  ShippingAnalysis,
  ChronicleProcessResult,
  ChronicleBatchResult,
  detectPartyType,
  extractTrueSender,
} from './types';
import {
  IChronicleService,
  IGmailService,
  IPdfExtractor,
  IAiAnalyzer,
  IChronicleRepository,
  ChronicleInsertData,
} from './interfaces';
import { ChronicleGmailService } from './gmail-service';
import { PdfExtractor } from './pdf-extractor';
import { AiAnalyzer } from './ai-analyzer';
import { ChronicleRepository } from './chronicle-repository';
import { AI_CONFIG } from './prompts/freight-forwarder.prompt';

// ============================================================================
// SERVICE IMPLEMENTATION
// ============================================================================

export class ChronicleService implements IChronicleService {
  private gmailService: IGmailService;
  private pdfExtractor: IPdfExtractor;
  private aiAnalyzer: IAiAnalyzer;
  private repository: IChronicleRepository;

  constructor(
    supabase: SupabaseClient,
    gmailService: ChronicleGmailService
  ) {
    this.gmailService = gmailService;
    this.pdfExtractor = new PdfExtractor();
    this.aiAnalyzer = new AiAnalyzer();
    this.repository = new ChronicleRepository(supabase);
  }

  /**
   * Fetch and process emails - Deep module interface
   */
  async fetchAndProcess(options: {
    after?: Date;
    before?: Date;
    maxResults?: number;
    query?: string;
  }): Promise<ChronicleBatchResult> {
    const emails = await this.gmailService.fetchEmailsByTimestamp(options);
    return this.processBatch(emails);
  }

  /**
   * Process a batch of emails
   */
  async processBatch(emails: ProcessedEmail[]): Promise<ChronicleBatchResult> {
    const startTime = Date.now();
    const results = await this.processEmailsSequentially(emails);
    return this.aggregateBatchResults(emails.length, results, startTime);
  }

  /**
   * Process a single email - Main orchestration method
   */
  async processEmail(email: ProcessedEmail): Promise<ChronicleProcessResult> {
    // Step 1: Check idempotency
    const existing = await this.checkIfAlreadyProcessed(email.gmailMessageId);
    if (existing) return existing;

    // Step 2: Extract attachments
    const { attachmentText, attachmentsWithText } = await this.extractAttachments(email);

    // Step 3: Analyze with AI
    const analysis = await this.aiAnalyzer.analyze(email, attachmentText);

    // Step 4: Save to database
    const chronicleId = await this.saveToDatabase(email, analysis, attachmentsWithText);

    // Step 5: Link to shipment
    const { shipmentId, linkedBy } = await this.repository.linkToShipment(chronicleId);

    return this.createSuccessResult(email.gmailMessageId, chronicleId, shipmentId, linkedBy);
  }

  // ==========================================================================
  // PRIVATE - PROCESSING STEPS (Each < 20 lines)
  // ==========================================================================

  private async checkIfAlreadyProcessed(
    gmailMessageId: string
  ): Promise<ChronicleProcessResult | null> {
    const existing = await this.repository.findByGmailMessageId(gmailMessageId);
    if (!existing) return null;

    return {
      success: true,
      gmailMessageId,
      chronicleId: existing.id,
      error: 'Already processed',
    };
  }

  private async extractAttachments(email: ProcessedEmail): Promise<{
    attachmentText: string;
    attachmentsWithText: ProcessedAttachment[];
  }> {
    let attachmentText = '';
    const attachmentsWithText: ProcessedAttachment[] = [];

    for (const attachment of email.attachments) {
      const result = await this.extractSingleAttachment(email.gmailMessageId, attachment);
      if (result) {
        attachmentText += result.text;
        attachmentsWithText.push(result.attachment);
      }
    }

    return { attachmentText, attachmentsWithText };
  }

  private async extractSingleAttachment(
    messageId: string,
    attachment: ProcessedAttachment
  ): Promise<{ text: string; attachment: ProcessedAttachment } | null> {
    if (attachment.mimeType !== 'application/pdf' || !attachment.attachmentId) {
      return null;
    }

    try {
      const content = await this.gmailService.fetchAttachmentContent(messageId, attachment.attachmentId);
      if (!content) return null;

      const text = await this.pdfExtractor.extractText(content, attachment.filename);
      if (!text) return null;

      const truncatedText = text.substring(0, AI_CONFIG.maxAttachmentChars);
      const formattedText = `\n=== ${attachment.filename} ===\n${truncatedText}\n`;

      return {
        text: formattedText,
        attachment: { ...attachment, extractedText: truncatedText },
      };
    } catch (error) {
      console.error(`[Chronicle] PDF error ${attachment.filename}:`, error);
      return null;
    }
  }

  private async saveToDatabase(
    email: ProcessedEmail,
    analysis: ShippingAnalysis,
    attachmentsWithText: ProcessedAttachment[]
  ): Promise<string> {
    const trueSender = extractTrueSender(email);
    const fromParty = analysis.from_party || detectPartyType(trueSender);
    const insertData = this.buildInsertData(email, analysis, fromParty, attachmentsWithText);
    const { id } = await this.repository.insert(insertData);
    return id;
  }

  private buildInsertData(
    email: ProcessedEmail,
    analysis: ShippingAnalysis,
    fromParty: string,
    attachmentsWithText: ProcessedAttachment[]
  ): ChronicleInsertData {
    return {
      gmail_message_id: email.gmailMessageId,
      thread_id: email.threadId,
      direction: email.direction,
      from_party: fromParty,
      from_address: email.senderEmail,
      transport_mode: analysis.transport_mode,

      // Identifiers
      booking_number: analysis.booking_number || null,
      mbl_number: analysis.mbl_number || null,
      hbl_number: analysis.hbl_number || null,
      container_numbers: analysis.container_numbers || [],
      mawb_number: analysis.mawb_number || null,
      hawb_number: analysis.hawb_number || null,
      work_order_number: analysis.work_order_number || null,
      pro_number: analysis.pro_number || null,
      reference_numbers: analysis.reference_numbers || [],
      identifier_source: analysis.identifier_source,
      document_type: analysis.document_type,

      // 4-Point Routing
      por_location: analysis.por_location || null,
      por_type: analysis.por_type || null,
      pol_location: analysis.pol_location || null,
      pol_type: analysis.pol_type || null,
      pod_location: analysis.pod_location || null,
      pod_type: analysis.pod_type || null,
      pofd_location: analysis.pofd_location || null,
      pofd_type: analysis.pofd_type || null,

      // Vessel/Carrier
      vessel_name: analysis.vessel_name || null,
      voyage_number: analysis.voyage_number || null,
      flight_number: analysis.flight_number || null,
      carrier_name: analysis.carrier_name || null,

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
      pod_signed_by: analysis.pod_signed_by || null,

      // Cargo
      container_type: analysis.container_type || null,
      weight: analysis.weight || null,
      pieces: analysis.pieces || null,
      commodity: analysis.commodity || null,

      // Stakeholders
      shipper_name: analysis.shipper_name || null,
      shipper_address: analysis.shipper_address || null,
      shipper_contact: analysis.shipper_contact || null,
      consignee_name: analysis.consignee_name || null,
      consignee_address: analysis.consignee_address || null,
      consignee_contact: analysis.consignee_contact || null,
      notify_party_name: analysis.notify_party_name || null,
      notify_party_address: analysis.notify_party_address || null,
      notify_party_contact: analysis.notify_party_contact || null,

      // Financial
      invoice_number: analysis.invoice_number || null,
      amount: analysis.amount || null,
      currency: analysis.currency || null,

      // Intelligence
      message_type: analysis.message_type,
      sentiment: analysis.sentiment,
      summary: analysis.summary,
      has_action: analysis.has_action,
      action_description: analysis.action_description || null,
      action_owner: analysis.action_owner || null,
      action_deadline: analysis.action_deadline || null,
      action_priority: analysis.action_priority || null,
      has_issue: analysis.has_issue || false,
      issue_type: analysis.issue_type || null,
      issue_description: analysis.issue_description || null,

      // Raw content
      subject: email.subject,
      snippet: email.snippet,
      body_preview: email.bodyText.substring(0, 1000),
      attachments: attachmentsWithText,
      ai_response: analysis,
      ai_model: AI_CONFIG.model,
      occurred_at: email.receivedAt.toISOString(),
    };
  }

  // ==========================================================================
  // PRIVATE - BATCH HELPERS (Each < 20 lines)
  // ==========================================================================

  private async processEmailsSequentially(
    emails: ProcessedEmail[]
  ): Promise<ChronicleProcessResult[]> {
    const results: ChronicleProcessResult[] = [];
    const total = emails.length;
    let processed = 0;

    for (const email of emails) {
      const result = await this.processSingleEmailSafely(email);
      results.push(result);
      processed++;
      if (processed % 25 === 0 || processed === total) {
        const succeeded = results.filter(r => r.success && !r.error?.includes('Already')).length;
        const skipped = results.filter(r => r.error?.includes('Already')).length;
        console.log(`[Chronicle] Processed ${processed}/${total} (${Math.round(processed/total*100)}%) - New: ${succeeded}, Skipped: ${skipped}`);
      }
    }
    return results;
  }

  private async processSingleEmailSafely(email: ProcessedEmail): Promise<ChronicleProcessResult> {
    try {
      return await this.processEmail(email);
    } catch (error) {
      return this.createErrorResult(email.gmailMessageId, error);
    }
  }

  private aggregateBatchResults(
    total: number,
    results: ChronicleProcessResult[],
    startTime: number
  ): ChronicleBatchResult {
    const succeeded = results.filter(r => r.success && !r.error?.includes('Already')).length;
    const failed = results.filter(r => !r.success).length;
    const linked = results.filter(r => r.shipmentId).length;

    return {
      processed: total,
      succeeded,
      failed,
      linked,
      totalTimeMs: Date.now() - startTime,
      results,
    };
  }

  // ==========================================================================
  // PRIVATE - RESULT BUILDERS (Each < 20 lines)
  // ==========================================================================

  private createSuccessResult(
    gmailMessageId: string,
    chronicleId: string,
    shipmentId?: string,
    linkedBy?: string
  ): ChronicleProcessResult {
    return {
      success: true,
      gmailMessageId,
      chronicleId,
      shipmentId,
      linkedBy,
    };
  }

  private createErrorResult(gmailMessageId: string, error: unknown): ChronicleProcessResult {
    return {
      success: false,
      gmailMessageId,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createChronicleService(
  supabase: SupabaseClient,
  gmailService: ChronicleGmailService
): ChronicleService {
  return new ChronicleService(supabase, gmailService);
}
