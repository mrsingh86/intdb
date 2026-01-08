/**
 * Document Registry Service
 *
 * Tracks unique business documents and their versions.
 * Links attachments to documents for iteration tracking.
 *
 * DOCUMENT LIFECYCLE:
 * 1. Attachment arrives → Extract references & detect type
 * 2. Check if document exists (by reference + type)
 * 3. Check if version exists (by content hash)
 * 4. Create document/version as needed
 * 5. Link attachment to version
 *
 * HANDLES:
 * - SI iterations (Draft 1 → Draft 2 → Submitted)
 * - BL versions (Draft → Final)
 * - Invoice amendments
 * - Exact duplicates (same PDF shared multiple times)
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import {
  DocumentContentClassificationService,
  createDocumentContentClassificationService,
} from './classification/document-content-classification-service';

// =============================================================================
// TYPES
// =============================================================================

export type DocumentType =
  | 'booking_confirmation'
  | 'shipping_instructions'
  | 'draft_bl'
  | 'final_bl'
  | 'house_bl'
  | 'master_bl'
  | 'arrival_notice'
  | 'delivery_order'
  | 'invoice'
  | 'packing_list'
  | 'certificate'
  | 'vgm'
  | 'checklist'
  | 'customs_entry'
  | 'other';

export type DocumentStatus =
  | 'draft'
  | 'submitted'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'amended'
  | 'final'
  | 'superseded';

export interface ExtractedReferences {
  primaryReference: string | null;
  secondaryReference: string | null;
  carrierCode: string | null;
  documentType: DocumentType;
  versionLabel: string | null;
  confidence: number;
}

export interface DocumentMatch {
  documentId: string | null;
  versionId: string | null;
  isNewDocument: boolean;
  isNewVersion: boolean;
  isDuplicate: boolean;
  matchMethod: 'filename' | 'content' | 'reference';
}

export interface RegistrationResult {
  success: boolean;
  documentId: string | null;
  versionId: string | null;
  isNewDocument: boolean;
  isNewVersion: boolean;
  isDuplicate: boolean;
  error?: string;
}

/**
 * Classification input from upstream ClassificationOrchestrator.
 * When provided, the registry uses this instead of its own classification.
 */
export interface ClassificationInput {
  documentType: string;
  confidence: number;
  primaryReference?: string;  // From extraction service
  secondaryReference?: string;
}

// =============================================================================
// CONSTANTS - Reference Patterns
// =============================================================================

// Carrier codes
const CARRIER_PATTERNS: Record<string, RegExp> = {
  HLCU: /\b(HL|HLCU|Hapag|Hapag-Lloyd)\b/i,
  MAEU: /\b(MAEU|Maersk|MAERSK)\b/i,
  CMDU: /\b(CMDU|CMA|CMA-CGM|CMA CGM)\b/i,
  MSCU: /\b(MSCU|MSC)\b/i,
  EGLV: /\b(EGLV|Evergreen|EMC)\b/i,
  COSU: /\b(COSU|COSCO)\b/i,
  ONEY: /\b(ONEY|ONE|Ocean Network)\b/i,
  YMLU: /\b(YMLU|Yang Ming|YML)\b/i,
};

// Note: DOC_TYPE_PATTERNS removed - now using DocumentContentClassificationService
// for accurate document type detection with content markers

// Version label patterns
const VERSION_PATTERNS: Array<{ pattern: RegExp; extractor: (match: RegExpMatchArray) => string }> = [
  // "5TH UPDATE", "3RD AMENDMENT"
  { pattern: /(\d+)(?:ST|ND|RD|TH)\s*(UPDATE|AMENDMENT|REVISION)/i, extractor: (m) => `${m[1]}${m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase()}` },
  // "ORIGINAL"
  { pattern: /\bORIGINAL\b/i, extractor: () => 'Original' },
  // "FINAL"
  { pattern: /\bFINAL\b/i, extractor: () => 'Final' },
  // "DRAFT", "DRAFT 1", "DRAFT-2"
  { pattern: /\bDRAFT[-\s]*(\d+)?/i, extractor: (m) => m[1] ? `Draft ${m[1]}` : 'Draft' },
  // "V1", "V2", "VERSION 3"
  { pattern: /\b(?:V|VERSION)[-\s]*(\d+)/i, extractor: (m) => `Version ${m[1]}` },
  // "REV 1", "REVISION 2"
  { pattern: /\bREV(?:ISION)?[-\s]*(\d+)/i, extractor: (m) => `Revision ${m[1]}` },
];

// Reference number patterns
const REFERENCE_PATTERNS = [
  // Hapag Lloyd: HL-94480005, 20154815
  { pattern: /\bHL[-\s]?(\d{8})\b/i, carrier: 'HLCU' },
  { pattern: /\b(\d{8})\b/, carrier: null }, // Generic 8-digit

  // Maersk: 123456789, MAEU123456789
  { pattern: /\bMAEU?[-\s]?(\d{9,10})\b/i, carrier: 'MAEU' },

  // Generic booking patterns
  { pattern: /\b([A-Z]{2,4}\d{6,12})\b/, carrier: null },

  // Invoice patterns: INV-2501958, INVP0301_959116161
  { pattern: /\bINV[A-Z]*[-_]?(\d+)/i, carrier: null },

  // BL patterns: HLCUSHA123456789
  { pattern: /\b(HLCU[A-Z]{3}\d{9})\b/i, carrier: 'HLCU' },
  { pattern: /\b(MAEU\d{9})\b/i, carrier: 'MAEU' },
];

// =============================================================================
// SERVICE
// =============================================================================

export class DocumentRegistryService {
  private readonly contentClassifier: DocumentContentClassificationService;

  constructor(private readonly supabase: SupabaseClient) {
    this.contentClassifier = createDocumentContentClassificationService();
  }

  // ===========================================================================
  // MAIN API
  // ===========================================================================

  /**
   * Register an attachment in the document registry.
   * Creates document/version as needed, links attachment.
   *
   * PRODUCTION FLOW (with classification input):
   * ClassificationOrchestrator → UnifiedExtractionService → DocumentRegistryService
   * When classification is provided, uses it for accurate document type.
   * When extractedReferences is provided, uses it for primary reference.
   *
   * LEGACY FLOW (without classification input):
   * Falls back to internal classification (less accurate, for backfill compatibility).
   *
   * @param attachmentId - The attachment ID
   * @param contentHash - SHA256 hash of attachment content
   * @param filename - Original filename
   * @param extractedText - OCR/parsed text from attachment
   * @param emailId - Parent email ID
   * @param receivedAt - Email received timestamp
   * @param classification - Optional classification from upstream service (PREFERRED)
   */
  async registerAttachment(
    attachmentId: string,
    contentHash: string,
    filename: string,
    extractedText: string | null,
    emailId: string,
    receivedAt: string,
    classification?: ClassificationInput
  ): Promise<RegistrationResult> {
    try {
      // 1. Extract references - use classification if provided, else internal extraction
      let refs: ExtractedReferences;

      if (classification) {
        // PRODUCTION FLOW: Use upstream classification + extracted references
        refs = {
          documentType: this.mapToRegistryType(classification.documentType),
          primaryReference: classification.primaryReference || null,
          secondaryReference: classification.secondaryReference || null,
          carrierCode: this.extractCarrierCode(filename, extractedText),
          versionLabel: this.extractVersionLabel(filename, extractedText),
          confidence: classification.confidence / 100,
        };

        // If no reference from extraction, try to extract from content
        if (!refs.primaryReference) {
          const fallbackRefs = this.extractReferencesFromContent(filename, extractedText);
          refs.primaryReference = fallbackRefs.primaryReference;
          refs.secondaryReference = fallbackRefs.secondaryReference;
        }
      } else {
        // LEGACY FLOW: Use internal classification (less accurate)
        refs = this.extractReferences(filename, extractedText);
      }

      if (!refs.primaryReference) {
        // Can't register without a reference - just update content hash
        await this.updateAttachmentHash(attachmentId, contentHash);
        return {
          success: true,
          documentId: null,
          versionId: null,
          isNewDocument: false,
          isNewVersion: false,
          isDuplicate: false,
        };
      }

      // 2. Find or create document
      const { documentId, isNewDocument } = await this.findOrCreateDocument(
        refs.documentType,
        refs.primaryReference,
        refs.secondaryReference,
        refs.carrierCode
      );

      // 3. Find or create version
      const { versionId, isNewVersion, isDuplicate } = await this.findOrCreateVersion(
        documentId,
        contentHash,
        refs.versionLabel,
        emailId,
        attachmentId,
        receivedAt
      );

      // 4. Link attachment to version
      await this.linkAttachment(attachmentId, versionId, contentHash, refs.confidence);

      return {
        success: true,
        documentId,
        versionId,
        isNewDocument,
        isNewVersion,
        isDuplicate,
      };
    } catch (error) {
      return {
        success: false,
        documentId: null,
        versionId: null,
        isNewDocument: false,
        isNewVersion: false,
        isDuplicate: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Extract carrier code from filename/content.
   */
  private extractCarrierCode(filename: string, extractedText: string | null): string | null {
    const combined = `${filename} ${extractedText || ''}`;
    for (const [code, pattern] of Object.entries(CARRIER_PATTERNS)) {
      if (pattern.test(combined)) {
        return code;
      }
    }
    return null;
  }

  /**
   * Extract version label from filename/content.
   */
  private extractVersionLabel(filename: string, extractedText: string | null): string | null {
    const combined = `${filename} ${extractedText || ''}`;
    for (const { pattern, extractor } of VERSION_PATTERNS) {
      const match = combined.match(pattern);
      if (match) {
        return extractor(match);
      }
    }
    return null;
  }

  /**
   * Extract primary/secondary references from content (used when classification
   * doesn't provide references).
   */
  private extractReferencesFromContent(
    filename: string,
    extractedText: string | null
  ): { primaryReference: string | null; secondaryReference: string | null } {
    let primaryReference: string | null = null;
    let secondaryReference: string | null = null;

    // Try filename first
    for (const { pattern } of REFERENCE_PATTERNS) {
      const match = filename.match(pattern);
      if (match && match[1]) {
        primaryReference = match[1].toUpperCase();
        break;
      }
    }

    // Try extracted text for secondary reference
    if (extractedText) {
      for (const { pattern } of REFERENCE_PATTERNS) {
        const match = extractedText.match(pattern);
        if (match && match[1] && match[1].toUpperCase() !== primaryReference) {
          secondaryReference = match[1].toUpperCase();
          break;
        }
      }
    }

    return { primaryReference, secondaryReference };
  }

  /**
   * Check if an attachment is a duplicate or new version.
   */
  async checkDuplicate(contentHash: string): Promise<{
    isDuplicate: boolean;
    existingVersionId: string | null;
    existingDocumentId: string | null;
  }> {
    const { data } = await this.supabase
      .from('document_versions')
      .select('id, document_id')
      .eq('content_hash', contentHash)
      .limit(1)
      .single();

    if (data) {
      return {
        isDuplicate: true,
        existingVersionId: data.id,
        existingDocumentId: data.document_id,
      };
    }

    return {
      isDuplicate: false,
      existingVersionId: null,
      existingDocumentId: null,
    };
  }

  /**
   * Get document with all versions.
   */
  async getDocumentWithVersions(documentId: string): Promise<{
    document: any;
    versions: any[];
  } | null> {
    const { data: document } = await this.supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .single();

    if (!document) return null;

    const { data: versions } = await this.supabase
      .from('document_versions')
      .select('*')
      .eq('document_id', documentId)
      .order('version_number', { ascending: true });

    return { document, versions: versions || [] };
  }

  /**
   * Get latest version of a document.
   */
  async getLatestVersion(documentId: string): Promise<any | null> {
    const { data } = await this.supabase
      .from('document_versions')
      .select('*')
      .eq('document_id', documentId)
      .order('version_number', { ascending: false })
      .limit(1)
      .single();

    return data;
  }

  // ===========================================================================
  // REFERENCE EXTRACTION
  // ===========================================================================

  /**
   * Extract references from filename and content.
   * Uses DocumentContentClassificationService for accurate document type detection.
   */
  extractReferences(filename: string, extractedText: string | null): ExtractedReferences {
    const combined = `${filename} ${extractedText || ''}`;

    // Detect carrier from filename/content
    let carrierCode: string | null = null;
    for (const [code, pattern] of Object.entries(CARRIER_PATTERNS)) {
      if (pattern.test(combined)) {
        carrierCode = code;
        break;
      }
    }

    // Use ContentClassificationService for document type detection (high accuracy)
    let documentType: DocumentType = 'other';
    let classificationConfidence = 0;

    if (extractedText && extractedText.length >= 50) {
      const classification = this.contentClassifier.classify({ pdfContent: extractedText });
      if (classification && classification.confidence >= 70) {
        documentType = this.mapToRegistryType(classification.documentType);
        classificationConfidence = classification.confidence / 100;
      }
    }

    // Fallback to filename-based detection only if content classification failed
    if (documentType === 'other') {
      documentType = this.classifyByFilename(filename);
    }

    // Extract version label
    let versionLabel: string | null = null;
    for (const { pattern, extractor } of VERSION_PATTERNS) {
      const match = combined.match(pattern);
      if (match) {
        versionLabel = extractor(match);
        break;
      }
    }

    // Extract primary reference
    let primaryReference: string | null = null;
    let confidence = classificationConfidence || 0;

    // Try filename first (higher confidence)
    for (const { pattern, carrier } of REFERENCE_PATTERNS) {
      const match = filename.match(pattern);
      if (match) {
        primaryReference = match[1] || match[0];
        confidence = Math.max(confidence, 0.9);
        if (carrier && !carrierCode) carrierCode = carrier;
        break;
      }
    }

    // Try content if no filename match
    if (!primaryReference && extractedText) {
      const refPatterns = [
        /Our\s*Reference[:\s]+([A-Z0-9-]+)/i,
        /Booking\s*(?:Number|No|#)[:\s]+([A-Z0-9-]+)/i,
        /B[\/]?L\s*(?:Number|No|#)[:\s]+([A-Z0-9-]+)/i,
        /Invoice\s*(?:Number|No|#)[:\s]+([A-Z0-9-]+)/i,
        /Reference[:\s]+([A-Z0-9-]+)/i,
      ];

      for (const pattern of refPatterns) {
        const match = extractedText.match(pattern);
        if (match) {
          primaryReference = match[1];
          confidence = Math.max(confidence, 0.8);
          break;
        }
      }
    }

    // Extract secondary reference (customer reference)
    let secondaryReference: string | null = null;
    if (extractedText) {
      const custRefMatch = extractedText.match(/Your\s*Reference[:\s]+([A-Z0-9-]+)/i);
      if (custRefMatch) {
        secondaryReference = custRefMatch[1];
      }
    }

    return {
      primaryReference,
      secondaryReference,
      carrierCode,
      documentType,
      versionLabel,
      confidence,
    };
  }

  /**
   * Map DocumentContentClassificationService types to DocumentType.
   * The content classifier uses more granular types; we map to registry types.
   */
  private mapToRegistryType(contentType: string): DocumentType {
    const typeMap: Record<string, DocumentType> = {
      // Booking
      booking_confirmation: 'booking_confirmation',
      booking_amendment: 'booking_confirmation',

      // Shipping Instructions
      shipping_instruction: 'shipping_instructions',
      si_draft: 'shipping_instructions',
      si_confirmation: 'shipping_instructions',

      // Bills of Lading
      draft_bl: 'draft_bl',
      final_bl: 'final_bl',
      house_bl: 'house_bl',
      master_bl: 'master_bl',
      seaway_bill: 'house_bl',

      // Arrival/Delivery
      arrival_notice: 'arrival_notice',
      delivery_order: 'delivery_order',
      release_order: 'delivery_order',

      // Commercial
      commercial_invoice: 'invoice',
      freight_invoice: 'invoice',
      proforma_invoice: 'invoice',
      invoice: 'invoice',

      // Packing
      packing_list: 'packing_list',

      // VGM
      vgm: 'vgm',
      vgm_declaration: 'vgm',

      // Customs
      entry_summary: 'customs_entry',
      customs_declaration: 'customs_entry',
      customs_bond: 'customs_entry',
      isf: 'customs_entry',

      // Certificates
      certificate_of_origin: 'certificate',
      fumigation_certificate: 'certificate',
      phytosanitary_certificate: 'certificate',
      insurance_certificate: 'certificate',

      // Checklist
      checklist: 'checklist',
    };

    return typeMap[contentType] || 'other';
  }

  /**
   * Fallback: classify by filename patterns (used only when content classification fails).
   * More conservative patterns to avoid false positives.
   */
  private classifyByFilename(filename: string): DocumentType {
    const upper = filename.toUpperCase();

    // Very specific patterns only - avoid ambiguous ones like "SI"
    if (/BOOKING.*CONFIRM/i.test(upper)) return 'booking_confirmation';
    if (/\bBC\s*\d+/i.test(upper)) return 'booking_confirmation';
    if (/SHIPPING.*INSTRUCT/i.test(upper)) return 'shipping_instructions';
    if (/ARRIVAL.*NOTICE/i.test(upper)) return 'arrival_notice';
    if (/\bAN[-_]\d+/i.test(upper)) return 'arrival_notice';
    if (/HOUSE.*B[\/]?L/i.test(upper)) return 'house_bl';
    if (/\bHBL[-_]/i.test(upper)) return 'house_bl';
    if (/MASTER.*B[\/]?L/i.test(upper)) return 'master_bl';
    if (/\bMBL[-_]/i.test(upper)) return 'master_bl';
    if (/DRAFT.*B[\/]?L/i.test(upper)) return 'draft_bl';
    if (/FINAL.*B[\/]?L/i.test(upper)) return 'final_bl';
    if (/DELIVERY.*ORDER/i.test(upper)) return 'delivery_order';
    if (/\bDO[-_]\d+/i.test(upper)) return 'delivery_order';
    if (/INVOICE/i.test(upper)) return 'invoice';
    if (/\bINV[-_P]\d+/i.test(upper)) return 'invoice';
    if (/PACKING.*LIST/i.test(upper)) return 'packing_list';
    if (/\bVGM\b/i.test(upper)) return 'vgm';
    if (/ENTRY.*SUMMARY/i.test(upper)) return 'customs_entry';
    if (/\b7501\b/.test(upper)) return 'customs_entry';
    if (/CERTIFICATE/i.test(upper)) return 'certificate';

    return 'other';
  }

  // ===========================================================================
  // INTERNAL METHODS
  // ===========================================================================

  /**
   * Find existing document or create new one.
   */
  private async findOrCreateDocument(
    documentType: DocumentType,
    primaryReference: string,
    secondaryReference: string | null,
    carrierCode: string | null
  ): Promise<{ documentId: string; isNewDocument: boolean }> {
    // Try to find existing document
    const { data: existing } = await this.supabase
      .from('documents')
      .select('id')
      .eq('document_type', documentType)
      .eq('primary_reference', primaryReference)
      .limit(1)
      .single();

    if (existing) {
      return { documentId: existing.id, isNewDocument: false };
    }

    // Create new document
    const { data: created, error } = await this.supabase
      .from('documents')
      .insert({
        document_type: documentType,
        primary_reference: primaryReference,
        secondary_reference: secondaryReference,
        carrier_code: carrierCode,
      })
      .select('id')
      .single();

    if (error || !created) {
      throw new Error(`Failed to create document: ${error?.message}`);
    }

    return { documentId: created.id, isNewDocument: true };
  }

  /**
   * Find existing version or create new one.
   */
  private async findOrCreateVersion(
    documentId: string,
    contentHash: string,
    versionLabel: string | null,
    emailId: string,
    attachmentId: string,
    receivedAt: string
  ): Promise<{ versionId: string; isNewVersion: boolean; isDuplicate: boolean }> {
    // Check if this exact content already exists for this document
    const { data: existingByHash } = await this.supabase
      .from('document_versions')
      .select('id')
      .eq('document_id', documentId)
      .eq('content_hash', contentHash)
      .limit(1)
      .single();

    if (existingByHash) {
      // Exact duplicate - same document, same content
      return { versionId: existingByHash.id, isNewVersion: false, isDuplicate: true };
    }

    // Get current version count
    const { data: versions } = await this.supabase
      .from('document_versions')
      .select('id, version_number')
      .eq('document_id', documentId)
      .order('version_number', { ascending: false })
      .limit(1);

    const previousVersion = versions?.[0];
    const newVersionNumber = (previousVersion?.version_number || 0) + 1;

    // Determine status from version label
    let status: DocumentStatus = 'draft';
    if (versionLabel?.toLowerCase().includes('final')) {
      status = 'final';
    } else if (versionLabel?.toLowerCase().includes('submitted')) {
      status = 'submitted';
    } else if (versionLabel?.toLowerCase().includes('approved')) {
      status = 'approved';
    }

    // Create new version
    const { data: created, error } = await this.supabase
      .from('document_versions')
      .insert({
        document_id: documentId,
        version_number: newVersionNumber,
        version_label: versionLabel || `Version ${newVersionNumber}`,
        status,
        content_hash: contentHash,
        first_seen_at: receivedAt,
        first_seen_email_id: emailId,
        first_seen_attachment_id: attachmentId,
        supersedes_version_id: previousVersion?.id || null,
      })
      .select('id')
      .single();

    if (error || !created) {
      throw new Error(`Failed to create version: ${error?.message}`);
    }

    // Update document's current version and count
    await this.supabase
      .from('documents')
      .update({
        current_version_id: created.id,
        version_count: newVersionNumber,
        updated_at: new Date().toISOString(),
      })
      .eq('id', documentId);

    return { versionId: created.id, isNewVersion: true, isDuplicate: false };
  }

  /**
   * Link attachment to document version.
   */
  private async linkAttachment(
    attachmentId: string,
    versionId: string,
    contentHash: string,
    confidence: number
  ): Promise<void> {
    await this.supabase
      .from('raw_attachments')
      .update({
        document_version_id: versionId,
        content_hash: contentHash,
        document_match_confidence: confidence,
        document_match_method: confidence >= 0.9 ? 'filename' : 'content',
      })
      .eq('id', attachmentId);
  }

  /**
   * Update attachment with content hash only (no document match).
   */
  private async updateAttachmentHash(
    attachmentId: string,
    contentHash: string
  ): Promise<void> {
    await this.supabase
      .from('raw_attachments')
      .update({ content_hash: contentHash })
      .eq('id', attachmentId);
  }

  /**
   * Compute content hash for a string (for testing/backfill).
   */
  computeContentHash(content: string): string {
    return createHash('sha256').update(content).digest('hex');
  }
}

// =============================================================================
// FACTORY
// =============================================================================

export function createDocumentRegistryService(
  supabase: SupabaseClient
): DocumentRegistryService {
  return new DocumentRegistryService(supabase);
}
