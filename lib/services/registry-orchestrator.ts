/**
 * Registry Orchestrator
 *
 * Coordinates the flow between all registry services in the correct order:
 *
 * PARALLEL:
 *   ├─ Email Registry (email_type, sentiment, sender tracking)
 *   └─ Document Registry (doc_type, version, content hash)
 *        ↓
 *   Stakeholder Registry (parties from both sources)
 *        ↓
 *   Shipment Registry (convergence, linking)
 *        ↓
 *   Workstate Registry (state transitions, history)
 *
 * This orchestrator is called AFTER:
 * - Flagging (email + attachment flags)
 * - Classification (document + email classifiers in parallel)
 * - Extraction (data extracted from PDFs/emails)
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  EmailRegistryService,
  EmailRegistryInput,
  EmailRegistryResult,
} from './registry/email-registry-service';
import {
  StakeholderRegistryService,
  StakeholderRegistryInput,
  StakeholderRegistryResult,
  PartyInfo,
} from './registry/stakeholder-registry-service';
import {
  ShipmentRegistryService,
  ShipmentRegistryInput,
  ShipmentRegistryResult,
} from './registry/shipment-registry-service';
import {
  WorkstateRegistryService,
  WorkstateRegistryInput,
  WorkstateRegistryResult,
} from './registry/workstate-registry-service';
import {
  DocumentRegistryService,
  ClassificationInput as DocumentClassificationInput,
  RegistrationResult as DocumentRegistryResult,
} from './document-registry-service';
import { Sentiment } from '@/types/intelligence-platform';

// ============================================================================
// TYPES
// ============================================================================

export interface RegistryOrchestratorInput {
  // Email info (required)
  emailId: string;
  senderEmail: string;
  senderName?: string;
  threadId?: string;
  subject: string;
  direction: 'inbound' | 'outbound';

  // Email classification (from EmailContentClassifier)
  emailType?: string;
  emailTypeConfidence?: number;
  sentiment?: Sentiment;
  sentimentScore?: number;

  // Attachment info (optional - for Document Registry)
  attachment?: {
    attachmentId: string;
    contentHash: string;
    filename: string;
    extractedText: string | null;
    receivedAt: string;
    // From DocumentContentClassifier
    documentType: string;
    documentTypeConfidence: number;
  };

  // Extracted data (from Extraction service)
  extractedData?: {
    bookingNumber?: string;
    blNumber?: string;
    containerNumbers?: string[];
    ports?: {
      pol?: string;
      polName?: string;
      pod?: string;
      podName?: string;
    };
    dates?: {
      etd?: string;
      eta?: string;
      atd?: string;
      ata?: string;
    };
    vessel?: {
      name?: string;
      voyage?: string;
      imo?: string;
    };
    carrier?: {
      id?: string;
      name?: string;
      scac?: string;
    };
    parties?: {
      shipper?: PartyInfo;
      consignee?: PartyInfo;
      notifyParty?: PartyInfo;
    };
  };

  // Context
  isAmendment?: boolean;
  amendmentNumber?: number;
}

export interface RegistryOrchestratorResult {
  success: boolean;

  // From Email Registry
  email: EmailRegistryResult;

  // From Document Registry (optional)
  document?: DocumentRegistryResult;

  // From Stakeholder Registry
  stakeholder: StakeholderRegistryResult;

  // From Shipment Registry (optional - requires booking number)
  shipment?: ShipmentRegistryResult;

  // From Workstate Registry (optional - requires shipment)
  workstate?: WorkstateRegistryResult;

  // Summary
  summary: {
    emailRegistered: boolean;
    documentRegistered: boolean;
    stakeholdersProcessed: boolean;
    shipmentLinked: boolean;
    stateTransitioned: boolean;
    newEntitiesCreated: {
      sender: boolean;
      document: boolean;
      parties: string[];
      shipment: boolean;
    };
  };

  errors: string[];
}

// ============================================================================
// ORCHESTRATOR
// ============================================================================

export class RegistryOrchestrator {
  private emailRegistry: EmailRegistryService;
  private documentRegistry: DocumentRegistryService;
  private stakeholderRegistry: StakeholderRegistryService;
  private shipmentRegistry: ShipmentRegistryService;
  private workstateRegistry: WorkstateRegistryService;

  constructor(private readonly supabase: SupabaseClient) {
    this.emailRegistry = new EmailRegistryService(supabase);
    this.documentRegistry = new DocumentRegistryService(supabase);
    this.stakeholderRegistry = new StakeholderRegistryService(supabase);
    this.shipmentRegistry = new ShipmentRegistryService(supabase);
    this.workstateRegistry = new WorkstateRegistryService(supabase);
  }

  /**
   * Process through all registries in order
   */
  async process(input: RegistryOrchestratorInput): Promise<RegistryOrchestratorResult> {
    const errors: string[] = [];
    const result: RegistryOrchestratorResult = {
      success: true,
      email: {} as EmailRegistryResult,
      stakeholder: {} as StakeholderRegistryResult,
      summary: {
        emailRegistered: false,
        documentRegistered: false,
        stakeholdersProcessed: false,
        shipmentLinked: false,
        stateTransitioned: false,
        newEntitiesCreated: {
          sender: false,
          document: false,
          parties: [],
          shipment: false,
        },
      },
      errors: [],
    };

    // =========================================================================
    // STEP 1: PARALLEL - Email Registry + Document Registry
    // =========================================================================

    // 1a. Email Registry
    const emailInput: EmailRegistryInput = {
      emailId: input.emailId,
      senderEmail: input.senderEmail,
      senderName: input.senderName,
      threadId: input.threadId,
      subject: input.subject,
      emailType: input.emailType,
      emailTypeConfidence: input.emailTypeConfidence,
      sentiment: input.sentiment,
      sentimentScore: input.sentimentScore,
      direction: input.direction,
    };

    const emailResult = await this.emailRegistry.registerEmail(emailInput);
    result.email = emailResult;
    result.summary.emailRegistered = emailResult.success;
    result.summary.newEntitiesCreated.sender = emailResult.isNewSender;

    if (!emailResult.success && emailResult.error) {
      errors.push(`Email Registry: ${emailResult.error}`);
    }

    // 1b. Document Registry (if attachment provided)
    if (input.attachment) {
      const docClassification: DocumentClassificationInput = {
        documentType: input.attachment.documentType,
        confidence: input.attachment.documentTypeConfidence,
        primaryReference: input.extractedData?.bookingNumber,
        secondaryReference: input.extractedData?.blNumber,
      };

      const documentResult = await this.documentRegistry.registerAttachment(
        input.attachment.attachmentId,
        input.attachment.contentHash,
        input.attachment.filename,
        input.attachment.extractedText,
        input.emailId,
        input.attachment.receivedAt,
        docClassification
      );

      result.document = documentResult;
      result.summary.documentRegistered = documentResult.success;
      result.summary.newEntitiesCreated.document = documentResult.isNewDocument;

      if (!documentResult.success && documentResult.error) {
        errors.push(`Document Registry: ${documentResult.error}`);
      }
    }

    // =========================================================================
    // STEP 2: Stakeholder Registry
    // =========================================================================

    const stakeholderInput: StakeholderRegistryInput = {
      fromDocument: input.extractedData?.parties
        ? {
            shipper: input.extractedData.parties.shipper,
            consignee: input.extractedData.parties.consignee,
            notifyParty: input.extractedData.parties.notifyParty,
            documentType: input.attachment?.documentType || 'email',
          }
        : undefined,
      fromEmail: {
        senderId: emailResult.senderId,
        senderEmail: input.senderEmail,
        senderDomain: emailResult.senderDomain,
        senderName: input.senderName,
        sentiment: input.sentiment,
        sentimentScore: input.sentimentScore,
      },
      shipmentDirection: this.inferShipmentDirection(input),
      emailId: input.emailId,
    };

    const stakeholderResult = await this.stakeholderRegistry.register(stakeholderInput);
    result.stakeholder = stakeholderResult;
    result.summary.stakeholdersProcessed = stakeholderResult.success;
    result.summary.newEntitiesCreated.parties = stakeholderResult.newPartiesCreated;

    if (!stakeholderResult.success && stakeholderResult.error) {
      errors.push(`Stakeholder Registry: ${stakeholderResult.error}`);
    }

    // =========================================================================
    // STEP 3: Shipment Registry (only if we have a booking number)
    // =========================================================================

    if (input.extractedData?.bookingNumber) {
      const shipmentInput: ShipmentRegistryInput = {
        // From Extraction
        bookingNumber: input.extractedData.bookingNumber,
        blNumber: input.extractedData.blNumber,
        containerNumbers: input.extractedData.containerNumbers,
        ports: input.extractedData.ports,
        dates: input.extractedData.dates,
        vessel: input.extractedData.vessel,
        carrier: input.extractedData.carrier,

        // From Email Registry
        emailId: input.emailId,
        threadId: input.threadId,
        senderId: emailResult.senderId,

        // From Document Registry
        documentId: result.document?.documentId || undefined,
        documentVersionId: result.document?.versionId || undefined,
        documentType: input.attachment?.documentType,

        // From Stakeholder Registry
        shipperId: stakeholderResult.shipperId,
        consigneeId: stakeholderResult.consigneeId,
        notifyPartyId: stakeholderResult.notifyPartyId,

        // Context
        direction: input.direction,
        isAmendment: input.isAmendment,
        amendmentNumber: input.amendmentNumber,
      };

      const shipmentResult = await this.shipmentRegistry.register(shipmentInput);
      result.shipment = shipmentResult;
      result.summary.shipmentLinked = shipmentResult.success;
      result.summary.newEntitiesCreated.shipment = shipmentResult.isNewShipment;

      if (!shipmentResult.success && shipmentResult.error) {
        errors.push(`Shipment Registry: ${shipmentResult.error}`);
      }

      // =====================================================================
      // STEP 4: Workstate Registry (only if shipment exists)
      // =====================================================================

      if (shipmentResult.success && shipmentResult.shipmentId) {
        const workstateInput: WorkstateRegistryInput = {
          shipmentId: shipmentResult.shipmentId,
          documentType: input.attachment?.documentType || input.emailType || 'email',
          direction: input.direction,
          sourceEmailId: input.emailId,
          sourceDocumentId: result.document?.documentId || undefined,
          sourceAttachmentId: input.attachment?.attachmentId,
        };

        const workstateResult = await this.workstateRegistry.recordTransition(workstateInput);
        result.workstate = workstateResult;
        result.summary.stateTransitioned = workstateResult.transitionRecorded;

        if (!workstateResult.success && workstateResult.error) {
          errors.push(`Workstate Registry: ${workstateResult.error}`);
        }
      }
    }

    // =========================================================================
    // FINALIZE
    // =========================================================================

    result.errors = errors;
    result.success = errors.length === 0;

    return result;
  }

  /**
   * Infer shipment direction from available data
   */
  private inferShipmentDirection(input: RegistryOrchestratorInput): 'export' | 'import' {
    // If we have port info, check if POL is in India (export) or POD is in India (import)
    const pol = input.extractedData?.ports?.pol || '';
    const pod = input.extractedData?.ports?.pod || '';

    if (pol.startsWith('IN')) return 'export';
    if (pod.startsWith('IN')) return 'import';

    // Default based on email direction (outbound usually means we're exporting)
    return input.direction === 'outbound' ? 'export' : 'import';
  }

  /**
   * Get all registry services for direct access if needed
   */
  getServices() {
    return {
      email: this.emailRegistry,
      document: this.documentRegistry,
      stakeholder: this.stakeholderRegistry,
      shipment: this.shipmentRegistry,
      workstate: this.workstateRegistry,
    };
  }
}

// Factory function
export function createRegistryOrchestrator(supabase: SupabaseClient): RegistryOrchestrator {
  return new RegistryOrchestrator(supabase);
}
