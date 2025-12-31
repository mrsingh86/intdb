/**
 * Email Processing Orchestrator
 *
 * Unified pipeline for processing shipping emails:
 * 1. Classification → Determine document type
 * 2. Entity Extraction → Extract booking numbers, dates, ports, etc.
 * 3. Shipment Linking → Create/update shipments from booking confirmations
 * 4. Document Lifecycle → Track document status
 * 5. Notification Generation → Create notifications for exceptions
 *
 * This orchestrator ensures all stages flow automatically.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { StakeholderExtractionService, DocumentEntity, ShipmentDirection } from './stakeholder-extraction-service';
import { DocumentLifecycleService } from './document-lifecycle-service';
import { BackfillService } from './shipment-linking/backfill-service';

// Types
interface ProcessingResult {
  emailId: string;
  success: boolean;
  stage: 'classification' | 'extraction' | 'linking' | 'lifecycle' | 'notification';
  shipmentId?: string;
  error?: string;
  fieldsExtracted?: number;
}

interface ExtractedBookingData {
  carrier?: string;
  booking_number?: string;
  vessel_name?: string;
  voyage_number?: string;
  etd?: string;
  eta?: string;
  port_of_loading?: string;
  port_of_loading_code?: string;
  port_of_discharge?: string;
  port_of_discharge_code?: string;
  final_destination?: string;
  si_cutoff?: string;
  vgm_cutoff?: string;
  cargo_cutoff?: string;
  gate_cutoff?: string;
  doc_cutoff?: string;
  shipper_name?: string;
  consignee_name?: string;
  container_number?: string;
}

// Direct carrier domains - emails from these domains are source of truth
const DIRECT_CARRIER_DOMAINS = [
  'service.hlag.com', 'hapag-lloyd.com',
  'maersk.com',
  'msc.com',
  'cma-cgm.com',
  'evergreen-line.com', 'evergreen-marine.com',
  'oocl.com',
  'cosco.com', 'coscoshipping.com',
  'yangming.com',
  'one-line.com',
  'zim.com',
  'hmm21.com',
  'pilship.com',
  'wanhai.com',
  'sitc.com',
];

// Carrier-specific extraction prompts
const CARRIER_PROMPTS: Record<string, string> = {
  'hapag-lloyd': `You are extracting data from a Hapag-Lloyd booking confirmation.

IMPORTANT: Look for these specific sections:
- "Deadline Information" section contains all cutoffs:
  - "Shipping instruction closing" → si_cutoff
  - "VGM cut-off" → vgm_cutoff
  - "FCL delivery cut-off" or "Cargo cut-off" → cargo_cutoff
  - "Documentation cut-off" → doc_cutoff

- Dates are typically in format: DD-Mon-YYYY HH:MM (e.g., "25-Dec-2025 10:00")
- Booking numbers start with "HLCU" or are 8-digit numbers
- Look for "Vessel/Voyage" for vessel and voyage info

`,
  'maersk': `You are extracting data from a Maersk booking confirmation.

IMPORTANT: Look for these specific sections:
- "Important Dates" or "Key Dates" section contains cutoffs:
  - "SI Cut-off" or "Documentation Deadline" → si_cutoff
  - "VGM Deadline" → vgm_cutoff
  - "Cargo Receiving" or "CY Cut-off" → cargo_cutoff
  - "Gate Cut-off" → gate_cutoff

- Dates may be in format: YYYY-MM-DD or DD/MM/YYYY
- Booking numbers often start with numbers or "MAEU"
- Look for "M/V" or "Vessel:" for vessel name

`,
  'cma-cgm': `You are extracting data from a CMA CGM booking confirmation.

IMPORTANT: Look for these specific sections:
- "Cut-off Dates" section contains:
  - "SI Closing" → si_cutoff
  - "VGM Closing" → vgm_cutoff
  - "Cargo Closing" → cargo_cutoff

- Dates often in format: DD/MM/YYYY HH:MM
- Booking numbers may start with "CMI" or be alphanumeric

`,
  'msc': `You are extracting data from an MSC booking confirmation.

IMPORTANT: Look for cutoff information labeled as:
- "Closing Date" sections for various cutoffs
- "SI Deadline" → si_cutoff
- "VGM Cut-off" → vgm_cutoff
- "Port Cut-off" → cargo_cutoff

`,
  'cosco': `You are extracting data from a COSCO booking confirmation.

IMPORTANT: Look for:
- Booking numbers starting with "COSU"
- "Cut-off" or "Closing" sections for deadlines
- Dates in various formats

`,
  'default': `You are extracting data from a shipping booking confirmation email.

Look for ALL of the following information:
- Cutoff dates (SI, VGM, Cargo, Gate, Documentation cutoffs)
- Vessel and voyage information
- Port of loading and discharge
- ETD and ETA dates
- Shipper and consignee names

`
};

const EXTRACTION_PROMPT_TEMPLATE = `{CARRIER_PROMPT}
Extract ALL shipping information from the content below. Return ONLY valid JSON:

{
  "carrier": "shipping line name (Hapag-Lloyd, Maersk, CMA CGM, MSC, COSCO, ONE, Evergreen, etc.)",
  "booking_number": "booking reference number",
  "vessel_name": "vessel/ship name (without M/V prefix)",
  "voyage_number": "voyage number",
  "etd": "departure date in YYYY-MM-DD format",
  "eta": "arrival date in YYYY-MM-DD format",
  "port_of_loading": "loading port name",
  "port_of_loading_code": "UN/LOCODE 5-char code if found",
  "port_of_discharge": "discharge port name",
  "port_of_discharge_code": "UN/LOCODE 5-char code if found",
  "final_destination": "final destination if different from POD",
  "si_cutoff": "SI/documentation cutoff in YYYY-MM-DD format",
  "vgm_cutoff": "VGM cutoff in YYYY-MM-DD format",
  "cargo_cutoff": "cargo/CY cutoff in YYYY-MM-DD format",
  "gate_cutoff": "gate cutoff in YYYY-MM-DD format",
  "doc_cutoff": "documentation cutoff in YYYY-MM-DD format",
  "shipper_name": "shipper/exporter company name",
  "consignee_name": "consignee/importer company name",
  "container_number": "container number if available"
}

CRITICAL:
- Convert ALL dates to YYYY-MM-DD format
- If a date has time, ignore the time portion
- Use null for missing values, not empty strings
- Extract cutoff dates even if labeled differently (closing, deadline, cut-off)

CONTENT:
{CONTENT}`;

export class EmailProcessingOrchestrator {
  private supabase: SupabaseClient;
  private anthropic: Anthropic;
  private carrierIdMap: Map<string, string> = new Map();
  private stakeholderService: StakeholderExtractionService;
  private lifecycleService: DocumentLifecycleService;
  private backfillService: BackfillService;

  constructor(supabaseUrl: string, supabaseKey: string, anthropicKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.anthropic = new Anthropic({ apiKey: anthropicKey });
    this.stakeholderService = new StakeholderExtractionService(this.supabase);
    this.lifecycleService = new DocumentLifecycleService(this.supabase);
    this.backfillService = new BackfillService(this.supabase);
  }

  /**
   * Check if email is from a direct carrier (source of truth)
   * Only direct carrier emails should CREATE shipments
   *
   * IMPORTANT: Must check true_sender_email because:
   * - Emails often arrive via ops group (sender_email = ops@intoglo.com)
   * - The actual carrier domain is in true_sender_email
   * - Example: sender_email=ops@intoglo.com, true_sender_email=digital-business@hlag.com
   */
  private isDirectCarrierEmail(trueSenderEmail: string | null, senderEmail: string): boolean {
    // First check true_sender_email (preferred - actual sender before forwarding)
    if (trueSenderEmail) {
      const domain = trueSenderEmail.toLowerCase().split('@')[1] || '';
      if (DIRECT_CARRIER_DOMAINS.some(d => domain.includes(d))) {
        return true;
      }
    }
    // Fallback to sender_email for direct sends
    if (senderEmail) {
      const domain = senderEmail.toLowerCase().split('@')[1] || '';
      return DIRECT_CARRIER_DOMAINS.some(d => domain.includes(d));
    }
    return false;
  }

  /**
   * Initialize carrier ID mapping
   */
  async initialize(): Promise<void> {
    const { data: carriers } = await this.supabase.from('carriers').select('id, carrier_name');
    carriers?.forEach(c => {
      const lower = c.carrier_name.toLowerCase();
      this.carrierIdMap.set(lower, c.id);
      // Add common variations
      if (lower.includes('hapag')) this.carrierIdMap.set('hapag-lloyd', c.id);
      if (lower.includes('maersk')) this.carrierIdMap.set('maersk', c.id);
      if (lower.includes('cma')) this.carrierIdMap.set('cma cgm', c.id);
      if (lower.includes('cosco')) this.carrierIdMap.set('cosco', c.id);
      if (lower.includes('msc')) this.carrierIdMap.set('msc', c.id);
    });
  }

  /**
   * Process a single email through the entire pipeline
   */
  async processEmail(emailId: string): Promise<ProcessingResult> {
    try {
      // 1. Get email with classification
      const { data: email } = await this.supabase
        .from('raw_emails')
        .select('*, document_classifications(*)')
        .eq('id', emailId)
        .single();

      if (!email) {
        return { emailId, success: false, stage: 'classification', error: 'Email not found' };
      }

      const classification = email.document_classifications?.[0];
      const documentType = classification?.document_type;

      // 2. Get email content including PDF attachments
      const content = await this.getFullContent(emailId, email);

      // 3. Detect carrier from sender/content (prefer true_sender_email for forwarded emails)
      const carrier = this.detectCarrier(email.true_sender_email || email.sender_email, content);

      // 4. Extract data using carrier-specific prompt
      const extractedData = await this.extractWithAI(content, carrier);

      if (!extractedData) {
        return { emailId, success: false, stage: 'extraction', error: 'AI extraction failed' };
      }

      // 5. Process based on document type
      let shipmentId: string | undefined;
      let fieldsExtracted = 0;

      if (documentType === 'booking_confirmation') {
        // CREATE shipment only from DIRECT carrier emails, otherwise LINK
        // Use true_sender_email to detect carrier for emails via ops group
        const result = await this.processBookingConfirmation(
          emailId,
          extractedData,
          carrier,
          email.true_sender_email,  // Actual sender before forwarding
          email.sender_email
        );
        shipmentId = result.shipmentId;
        fieldsExtracted = result.fieldsUpdated;
      } else if (documentType === 'booking_amendment') {
        // UPDATE existing shipment
        const result = await this.processAmendment(emailId, extractedData);
        shipmentId = result.shipmentId;
        fieldsExtracted = result.fieldsUpdated;
      } else {
        // LINK to existing shipment
        const result = await this.linkToExistingShipment(emailId, extractedData);
        shipmentId = result.shipmentId;
      }

      // 6. Extract and link stakeholders (shipper_id, consignee_id)
      if (shipmentId && extractedData) {
        await this.extractAndLinkStakeholders(shipmentId, extractedData, documentType);
      }

      // 7. Create document lifecycle record
      if (shipmentId && documentType) {
        await this.createDocumentLifecycle(shipmentId, documentType, extractedData);
      }

      // 8. Update processing status
      await this.supabase
        .from('raw_emails')
        .update({ processing_status: 'processed' })
        .eq('id', emailId);

      return {
        emailId,
        success: true,
        stage: 'lifecycle',
        shipmentId,
        fieldsExtracted
      };

    } catch (error: any) {
      return { emailId, success: false, stage: 'extraction', error: error.message };
    }
  }

  /**
   * Get full content including email body and PDF attachments
   */
  private async getFullContent(emailId: string, email: any): Promise<string> {
    let content = `Subject: ${email.subject || ''}\n\nBody:\n${email.body_text || ''}`;

    // Get PDF attachments with extracted text
    const { data: attachments } = await this.supabase
      .from('raw_attachments')
      .select('filename, extracted_text, mime_type')
      .eq('email_id', emailId);

    for (const att of attachments || []) {
      if (att.extracted_text && att.mime_type?.includes('pdf')) {
        content += `\n\n--- PDF ATTACHMENT: ${att.filename} ---\n${att.extracted_text}`;
      }
    }

    return content;
  }

  /**
   * Detect carrier from sender email and content
   */
  private detectCarrier(senderEmail: string, content: string): string {
    const combined = `${senderEmail} ${content}`.toLowerCase();

    if (combined.includes('hapag') || combined.includes('hlag') || combined.includes('hlcu')) {
      return 'hapag-lloyd';
    }
    if (combined.includes('maersk') || combined.includes('maeu') || combined.includes('msku')) {
      return 'maersk';
    }
    if (combined.includes('cma-cgm') || combined.includes('cma cgm') || combined.includes('cmau')) {
      return 'cma-cgm';
    }
    if (combined.includes('msc') && !combined.includes('misc')) {
      return 'msc';
    }
    if (combined.includes('cosco') || combined.includes('cosu')) {
      return 'cosco';
    }

    return 'default';
  }

  /**
   * Extract booking data using AI with carrier-specific prompt
   */
  private async extractWithAI(content: string, carrier: string): Promise<ExtractedBookingData | null> {
    const carrierPrompt = CARRIER_PROMPTS[carrier] || CARRIER_PROMPTS['default'];
    const prompt = EXTRACTION_PROMPT_TEMPLATE
      .replace('{CARRIER_PROMPT}', carrierPrompt)
      .replace('{CONTENT}', content.substring(0, 8000));

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Clean null strings
        for (const key of Object.keys(parsed)) {
          if (parsed[key] === 'null' || parsed[key] === '') {
            parsed[key] = null;
          }
        }
        return parsed;
      }
      return null;
    } catch (error) {
      console.error('AI extraction error:', error);
      return null;
    }
  }

  /**
   * Process booking confirmation - CREATE or UPDATE shipment
   *
   * IMPORTANT: Only DIRECT carrier emails can CREATE new shipments.
   * Forwarded emails (from intoglo.com, etc.) should only LINK to existing shipments.
   * This ensures shipments have source-of-truth data from carriers.
   *
   * NOTE: Uses true_sender_email to detect carrier for emails via ops group
   */
  private async processBookingConfirmation(
    emailId: string,
    data: ExtractedBookingData,
    carrier: string,
    trueSenderEmail: string | null,
    senderEmail: string
  ): Promise<{ shipmentId?: string; fieldsUpdated: number }> {
    const bookingNumber = data.booking_number;
    if (!bookingNumber) {
      return { fieldsUpdated: 0 };
    }

    const isDirectCarrier = this.isDirectCarrierEmail(trueSenderEmail, senderEmail);

    // Check if shipment exists
    const { data: existing } = await this.supabase
      .from('shipments')
      .select('id')
      .eq('booking_number', bookingNumber)
      .single();

    const carrierId = this.carrierIdMap.get(carrier) || this.carrierIdMap.get(data.carrier?.toLowerCase() || '');

    const shipmentData: Record<string, any> = {};
    let fieldsUpdated = 0;

    // Build update/insert data
    if (carrierId) { shipmentData.carrier_id = carrierId; fieldsUpdated++; }
    if (data.vessel_name) { shipmentData.vessel_name = data.vessel_name; fieldsUpdated++; }
    if (data.voyage_number) { shipmentData.voyage_number = data.voyage_number; fieldsUpdated++; }
    if (data.etd) { shipmentData.etd = data.etd; fieldsUpdated++; }
    if (data.eta) { shipmentData.eta = data.eta; fieldsUpdated++; }
    if (data.port_of_loading) { shipmentData.port_of_loading = data.port_of_loading; fieldsUpdated++; }
    if (data.port_of_loading_code) { shipmentData.port_of_loading_code = data.port_of_loading_code; }
    if (data.port_of_discharge) { shipmentData.port_of_discharge = data.port_of_discharge; fieldsUpdated++; }
    if (data.port_of_discharge_code) { shipmentData.port_of_discharge_code = data.port_of_discharge_code; }
    if (data.final_destination) { shipmentData.final_destination = data.final_destination; }
    if (data.si_cutoff) { shipmentData.si_cutoff = data.si_cutoff; fieldsUpdated++; }
    if (data.vgm_cutoff) { shipmentData.vgm_cutoff = data.vgm_cutoff; fieldsUpdated++; }
    if (data.cargo_cutoff) { shipmentData.cargo_cutoff = data.cargo_cutoff; fieldsUpdated++; }
    if (data.gate_cutoff) { shipmentData.gate_cutoff = data.gate_cutoff; fieldsUpdated++; }
    if (data.doc_cutoff) { shipmentData.doc_cutoff = data.doc_cutoff; fieldsUpdated++; }
    if (data.shipper_name) { shipmentData.shipper_name = data.shipper_name; fieldsUpdated++; }
    if (data.consignee_name) { shipmentData.consignee_name = data.consignee_name; fieldsUpdated++; }
    if (data.container_number) { shipmentData.container_number_primary = data.container_number; }

    shipmentData.updated_at = new Date().toISOString();

    if (existing) {
      // UPDATE existing shipment (both direct and forwarded can update)
      await this.supabase
        .from('shipments')
        .update(shipmentData)
        .eq('id', existing.id);

      // Link email to shipment
      await this.linkEmailToShipment(emailId, existing.id, 'booking_confirmation');

      return { shipmentId: existing.id, fieldsUpdated };
    } else if (isDirectCarrier) {
      // CREATE new shipment - ONLY from direct carrier emails
      shipmentData.booking_number = bookingNumber;
      shipmentData.created_from_email_id = emailId;
      shipmentData.workflow_state = 'booking_confirmed';
      shipmentData.workflow_phase = 'pre_carriage';

      const { data: newShipment } = await this.supabase
        .from('shipments')
        .insert(shipmentData)
        .select('id')
        .single();

      if (newShipment) {
        // Link email to newly created shipment
        await this.linkEmailToShipment(emailId, newShipment.id, 'booking_confirmation');

        // AUTO-BACKFILL: Link any related emails that arrived before this shipment was created
        // This finds forwarded emails with matching booking#, BL#, or container# and links them
        try {
          const backfillResult = await this.backfillService.linkRelatedEmails(newShipment.id);
          if (backfillResult.emails_linked > 0) {
            console.log(`[Orchestrator] Auto-backfill: Linked ${backfillResult.emails_linked} related emails to new shipment ${newShipment.id}`);
          }
        } catch (backfillError) {
          // Don't fail the whole process if backfill fails
          console.error(`[Orchestrator] Auto-backfill failed for shipment ${newShipment.id}:`, backfillError);
        }
      }

      return { shipmentId: newShipment?.id, fieldsUpdated };
    } else {
      // NOT direct carrier and no existing shipment - just store entities, don't create
      // The direct carrier email may arrive later and create the shipment
      console.log(`[Orchestrator] Booking ${bookingNumber} from forward - no shipment created (waiting for direct carrier email)`);
      await this.storeEntitiesForLaterLinking(emailId, data);
      return { fieldsUpdated: 0 };
    }
  }

  /**
   * Link email to shipment via shipment_documents table
   */
  private async linkEmailToShipment(
    emailId: string,
    shipmentId: string,
    documentType: string
  ): Promise<void> {
    // Upsert to avoid duplicates
    await this.supabase
      .from('shipment_documents')
      .upsert({
        email_id: emailId,
        shipment_id: shipmentId,
        document_type: documentType,
        created_at: new Date().toISOString()
      }, { onConflict: 'email_id,shipment_id' });
  }

  /**
   * Store entities for forwarded emails that arrive before direct carrier email
   * These can be linked later when the direct carrier email creates the shipment
   */
  private async storeEntitiesForLaterLinking(
    emailId: string,
    data: ExtractedBookingData
  ): Promise<void> {
    const entities: { email_id: string; entity_type: string; entity_value: string; confidence_score: number }[] = [];

    if (data.booking_number) {
      entities.push({ email_id: emailId, entity_type: 'booking_number', entity_value: data.booking_number, confidence_score: 90 });
    }
    if (data.vessel_name) {
      entities.push({ email_id: emailId, entity_type: 'vessel_name', entity_value: data.vessel_name, confidence_score: 85 });
    }
    if (data.voyage_number) {
      entities.push({ email_id: emailId, entity_type: 'voyage_number', entity_value: data.voyage_number, confidence_score: 85 });
    }
    if (data.etd) {
      entities.push({ email_id: emailId, entity_type: 'etd', entity_value: data.etd, confidence_score: 85 });
    }
    if (data.eta) {
      entities.push({ email_id: emailId, entity_type: 'eta', entity_value: data.eta, confidence_score: 85 });
    }
    if (data.port_of_loading) {
      entities.push({ email_id: emailId, entity_type: 'port_of_loading', entity_value: data.port_of_loading, confidence_score: 85 });
    }
    if (data.port_of_discharge) {
      entities.push({ email_id: emailId, entity_type: 'port_of_discharge', entity_value: data.port_of_discharge, confidence_score: 85 });
    }

    if (entities.length > 0) {
      await this.supabase
        .from('entity_extractions')
        .upsert(entities, { onConflict: 'email_id,entity_type' });
    }
  }

  /**
   * Process booking amendment - UPDATE existing shipment
   */
  private async processAmendment(
    emailId: string,
    data: ExtractedBookingData
  ): Promise<{ shipmentId?: string; fieldsUpdated: number }> {
    const bookingNumber = data.booking_number;
    if (!bookingNumber) {
      return { fieldsUpdated: 0 };
    }

    const { data: existing } = await this.supabase
      .from('shipments')
      .select('*')
      .eq('booking_number', bookingNumber)
      .single();

    if (!existing) {
      return { fieldsUpdated: 0 };
    }

    // Track changes for revision
    const changedFields: Record<string, { old: any; new: any }> = {};
    const updates: Record<string, any> = {};

    const fieldsToCheck = [
      'vessel_name', 'voyage_number', 'etd', 'eta',
      'port_of_loading', 'port_of_discharge',
      'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff'
    ];

    for (const field of fieldsToCheck) {
      const newValue = (data as any)[field];
      const oldValue = existing[field];
      if (newValue && newValue !== oldValue) {
        changedFields[field] = { old: oldValue, new: newValue };
        updates[field] = newValue;
      }
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      updates.booking_revision_count = (existing.booking_revision_count || 0) + 1;

      // Update shipment
      await this.supabase
        .from('shipments')
        .update(updates)
        .eq('id', existing.id);

      // Create revision record
      await this.supabase.from('booking_revisions').insert({
        shipment_id: existing.id,
        revision_number: updates.booking_revision_count,
        changed_fields: changedFields,
        source_email_id: emailId,
        created_at: new Date().toISOString()
      });
    }

    return { shipmentId: existing.id, fieldsUpdated: Object.keys(updates).length };
  }

  /**
   * Link email to existing shipment (for non-booking documents)
   */
  private async linkToExistingShipment(
    emailId: string,
    data: ExtractedBookingData
  ): Promise<{ shipmentId?: string }> {
    const bookingNumber = data.booking_number;
    if (!bookingNumber) {
      return {};
    }

    const { data: existing } = await this.supabase
      .from('shipments')
      .select('id')
      .eq('booking_number', bookingNumber)
      .single();

    if (existing) {
      // Link email to shipment (via shipment_documents if table exists)
      return { shipmentId: existing.id };
    }

    return {};
  }

  /**
   * Extract stakeholders and link to shipment (shipper_id, consignee_id)
   */
  private async extractAndLinkStakeholders(
    shipmentId: string,
    data: ExtractedBookingData,
    documentType?: string
  ): Promise<void> {
    // Build document entities from extracted data
    const entities: DocumentEntity = {};

    if (data.shipper_name) {
      entities.shipper = { name: data.shipper_name };
    }
    if (data.consignee_name) {
      entities.consignee = { name: data.consignee_name };
    }

    // Skip if no shipper or consignee found
    if (!entities.shipper && !entities.consignee) {
      return;
    }

    // Get shipment to determine direction
    const { data: shipment } = await this.supabase
      .from('shipments')
      .select('port_of_loading_code')
      .eq('id', shipmentId)
      .single();

    // Determine direction: if POL is in India, it's export
    const direction: ShipmentDirection =
      shipment?.port_of_loading_code?.startsWith('IN') ? 'export' : 'import';

    // Map to stakeholder document type
    const docType = this.mapToStakeholderDocType(documentType);

    // Extract stakeholders using service
    const result = await this.stakeholderService.extractFromDocument(
      entities,
      docType,
      direction,
      shipmentId
    );

    // Link extracted parties to shipment
    const allParties = [...result.created, ...result.matched];
    for (const party of allParties) {
      if (party.party_type === 'shipper') {
        await this.supabase
          .from('shipments')
          .update({ shipper_id: party.id })
          .eq('id', shipmentId);
      } else if (party.party_type === 'consignee') {
        await this.supabase
          .from('shipments')
          .update({ consignee_id: party.id })
          .eq('id', shipmentId);
      }
    }
  }

  /**
   * Map document type to stakeholder document type
   */
  private mapToStakeholderDocType(docType?: string): 'booking_confirmation' | 'hbl' | 'si_draft' | 'arrival_notice' {
    switch (docType) {
      case 'booking_confirmation':
      case 'booking_amendment':
        return 'booking_confirmation';
      case 'bill_of_lading':
      case 'bl_draft':
      case 'hbl_draft':
        return 'hbl';
      case 'shipping_instruction':
      case 'si_draft':
      case 'si_submission':
        return 'si_draft';
      case 'arrival_notice':
        return 'arrival_notice';
      default:
        return 'booking_confirmation';
    }
  }

  /**
   * Create document lifecycle record for tracking
   */
  private async createDocumentLifecycle(
    shipmentId: string,
    documentType: string,
    data: ExtractedBookingData | null
  ): Promise<void> {
    // Build extracted fields for quality scoring
    const extractedFields: Record<string, unknown> = {};

    if (data) {
      if (data.booking_number) extractedFields.booking_number = data.booking_number;
      if (data.vessel_name) extractedFields.vessel_name = data.vessel_name;
      if (data.voyage_number) extractedFields.voyage_number = data.voyage_number;
      if (data.port_of_loading) extractedFields.port_of_loading = data.port_of_loading;
      if (data.port_of_discharge) extractedFields.port_of_discharge = data.port_of_discharge;
      if (data.etd) extractedFields.etd = data.etd;
      if (data.eta) extractedFields.eta = data.eta;
      if (data.shipper_name) extractedFields.shipper_name = data.shipper_name;
      if (data.consignee_name) extractedFields.consignee_name = data.consignee_name;
      if (data.container_number) extractedFields.container_numbers = [data.container_number];
    }

    // Create lifecycle record
    await this.lifecycleService.createLifecycleForDocument(
      shipmentId,
      documentType,
      { extractedFields }
    );
  }

  /**
   * Process batch of emails
   */
  async processBatch(emailIds: string[], onProgress?: (processed: number, total: number) => void): Promise<ProcessingResult[]> {
    const results: ProcessingResult[] = [];

    for (let i = 0; i < emailIds.length; i++) {
      const result = await this.processEmail(emailIds[i]);
      results.push(result);

      if (onProgress) {
        onProgress(i + 1, emailIds.length);
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, 200));
    }

    return results;
  }

  /**
   * Get emails needing processing (classified but not extracted)
   */
  async getEmailsNeedingProcessing(limit: number = 100): Promise<string[]> {
    const { data } = await this.supabase
      .from('raw_emails')
      .select('id')
      .in('processing_status', ['classified', 'pending'])
      .limit(limit);

    return data?.map(e => e.id) || [];
  }
}

export default EmailProcessingOrchestrator;
