/**
 * Document Revision Service
 *
 * Tracks multiple versions of documents per shipment.
 * Ensures the LATEST revision is always used for entity extraction.
 *
 * Principles:
 * - Latest Wins: Most recent document version is authoritative
 * - Audit Trail: All revisions tracked with what changed
 * - Smart Detection: Auto-detect revision numbers from subjects
 */

import { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { ShipmentRepository } from '@/lib/repositories';

export interface DocumentRevision {
  id: string;
  shipment_id: string;
  document_type: string;
  revision_number: number;
  revision_label: string | null;
  is_latest: boolean;
  email_id: string;
  classification_id: string | null;
  content_hash: string | null;
  changed_fields: Record<string, { old: string | null; new: string | null }>;
  change_summary: string | null;
  received_at: string;
  processed_at: string;
  created_at: string;
}

export interface RevisionDetectionResult {
  revision_number: number;
  revision_label: string | null;
  is_amendment: boolean;
}

export interface RevisionCreateResult {
  revision: DocumentRevision;
  is_new_revision: boolean;
  is_duplicate: boolean;
  previous_revision?: DocumentRevision;
  changed_fields: Record<string, { old: string | null; new: string | null }>;
}

export class DocumentRevisionService {
  private shipmentRepository: ShipmentRepository;

  constructor(private readonly supabase: SupabaseClient) {
    this.shipmentRepository = new ShipmentRepository(supabase);
  }

  /**
   * Register a new document revision for a shipment
   * Automatically detects revision number and marks previous as non-latest
   */
  async registerRevision(
    shipmentId: string,
    documentType: string,
    emailId: string,
    options: {
      subject?: string;
      body_text?: string;
      classification_id?: string;
      received_at?: string;
      extracted_entities?: Record<string, string>;
    } = {}
  ): Promise<RevisionCreateResult> {
    // Detect revision number from subject
    const detection = this.detectRevisionFromSubject(options.subject || '');

    // Get existing revisions for this document type
    const { data: existingRevisions } = await this.supabase
      .from('document_revisions')
      .select('*')
      .eq('shipment_id', shipmentId)
      .eq('document_type', documentType)
      .order('revision_number', { ascending: false });

    const previousLatest = existingRevisions?.find(r => r.is_latest);
    const maxRevisionNumber = existingRevisions?.[0]?.revision_number || 0;

    // Calculate content hash to detect true duplicates
    const contentHash = this.calculateContentHash(options.body_text || '');

    // Check if this is a duplicate (same content hash)
    const isDuplicate = existingRevisions?.some(r => r.content_hash === contentHash);
    if (isDuplicate) {
      const existingRevision = existingRevisions!.find(r => r.content_hash === contentHash)!;
      return {
        revision: existingRevision,
        is_new_revision: false,
        is_duplicate: true,
        changed_fields: {},
      };
    }

    // Determine revision number
    let revisionNumber: number;
    if (detection.revision_number > 1) {
      // Subject explicitly indicates revision number
      revisionNumber = detection.revision_number;
    } else if (detection.is_amendment) {
      // Subject indicates amendment but no specific number
      revisionNumber = maxRevisionNumber + 1;
    } else {
      // First document or no revision indicator
      revisionNumber = maxRevisionNumber + 1;
    }

    // Calculate what changed from previous revision
    const changedFields = await this.calculateChangedFields(
      previousLatest,
      options.extracted_entities || {}
    );

    // Mark previous latest as non-latest
    if (previousLatest) {
      await this.supabase
        .from('document_revisions')
        .update({ is_latest: false })
        .eq('id', previousLatest.id);
    }

    // Create new revision
    const { data: newRevision, error } = await this.supabase
      .from('document_revisions')
      .insert({
        shipment_id: shipmentId,
        document_type: documentType,
        revision_number: revisionNumber,
        revision_label: detection.revision_label,
        is_latest: true,
        email_id: emailId,
        classification_id: options.classification_id,
        content_hash: contentHash,
        changed_fields: changedFields,
        change_summary: this.buildChangeSummary(changedFields),
        received_at: options.received_at || new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create document revision: ${error.message}`);
    }

    // Update shipment revision counts
    await this.updateShipmentRevisionCounts(shipmentId, documentType, revisionNumber);

    // Mark previous entity extractions as non-latest
    if (previousLatest) {
      await this.supabase
        .from('entity_extractions')
        .update({ is_from_latest_revision: false })
        .eq('document_revision_id', previousLatest.id);
    }

    return {
      revision: newRevision,
      is_new_revision: true,
      is_duplicate: false,
      previous_revision: previousLatest,
      changed_fields: changedFields,
    };
  }

  /**
   * Get the latest revision for a document type
   */
  async getLatestRevision(
    shipmentId: string,
    documentType: string
  ): Promise<DocumentRevision | null> {
    const { data, error } = await this.supabase
      .from('document_revisions')
      .select('*')
      .eq('shipment_id', shipmentId)
      .eq('document_type', documentType)
      .eq('is_latest', true)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get latest revision: ${error.message}`);
    }

    return data;
  }

  /**
   * Get all revisions for a document type
   */
  async getAllRevisions(
    shipmentId: string,
    documentType: string
  ): Promise<DocumentRevision[]> {
    const { data, error } = await this.supabase
      .from('document_revisions')
      .select('*')
      .eq('shipment_id', shipmentId)
      .eq('document_type', documentType)
      .order('revision_number', { ascending: true });

    if (error) {
      throw new Error(`Failed to get revisions: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Get revision history for a shipment (all document types)
   */
  async getRevisionHistory(shipmentId: string): Promise<{
    document_type: string;
    total_revisions: number;
    latest_revision: DocumentRevision;
    revisions: DocumentRevision[];
  }[]> {
    const { data, error } = await this.supabase
      .from('document_revisions')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('document_type')
      .order('revision_number', { ascending: true });

    if (error) {
      throw new Error(`Failed to get revision history: ${error.message}`);
    }

    // Group by document type
    const grouped = new Map<string, DocumentRevision[]>();
    for (const rev of data || []) {
      const existing = grouped.get(rev.document_type) || [];
      existing.push(rev);
      grouped.set(rev.document_type, existing);
    }

    return Array.from(grouped.entries()).map(([docType, revisions]) => ({
      document_type: docType,
      total_revisions: revisions.length,
      latest_revision: revisions.find(r => r.is_latest) || revisions[revisions.length - 1],
      revisions,
    }));
  }

  /**
   * Detect revision number from email subject
   */
  detectRevisionFromSubject(subject: string): RevisionDetectionResult {
    // Pattern 1: "3RD UPDATE", "2ND AMENDMENT", "1ST REVISION"
    const ordinalMatch = subject.match(/(\d+)(?:ST|ND|RD|TH)\s+(?:UPDATE|AMENDMENT|REVISION)/i);
    if (ordinalMatch) {
      return {
        revision_number: parseInt(ordinalMatch[1], 10),
        revision_label: ordinalMatch[0].toUpperCase(),
        is_amendment: true,
      };
    }

    // Pattern 2: "AMENDMENT 2", "REVISION 3", "UPDATE #4"
    const numberedMatch = subject.match(/(?:AMENDMENT|REVISION|UPDATE)\s*#?\s*(\d+)/i);
    if (numberedMatch) {
      return {
        revision_number: parseInt(numberedMatch[1], 10),
        revision_label: `AMENDMENT ${numberedMatch[1]}`,
        is_amendment: true,
      };
    }

    // Pattern 3: "V2", "V3" version indicators
    const versionMatch = subject.match(/\bV(\d+)\b/i);
    if (versionMatch) {
      return {
        revision_number: parseInt(versionMatch[1], 10),
        revision_label: `V${versionMatch[1]}`,
        is_amendment: true,
      };
    }

    // Pattern 4: Keywords indicating amendment without number
    if (/\b(AMENDED|UPDATED|REVISED|CORRECTION|CHANGE)\b/i.test(subject)) {
      return {
        revision_number: 0, // Will be calculated from existing revisions
        revision_label: 'AMENDED',
        is_amendment: true,
      };
    }

    // Default: First version
    return {
      revision_number: 1,
      revision_label: null,
      is_amendment: false,
    };
  }

  /**
   * Calculate content hash for duplicate detection
   */
  private calculateContentHash(content: string): string {
    // Normalize content: lowercase, remove extra whitespace, remove timestamps
    const normalized = content
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/\d{1,2}[:\-\/]\d{1,2}[:\-\/]\d{2,4}/g, '') // Remove dates
      .replace(/\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?/gi, '') // Remove times
      .trim();

    return crypto.createHash('md5').update(normalized).digest('hex');
  }

  /**
   * Calculate what fields changed between revisions
   */
  private async calculateChangedFields(
    previousRevision: DocumentRevision | undefined,
    newEntities: Record<string, string>
  ): Promise<Record<string, { old: string | null; new: string | null }>> {
    if (!previousRevision) {
      return {};
    }

    // Get entities from previous revision
    const { data: previousEntities } = await this.supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('document_revision_id', previousRevision.id);

    const previousEntityMap = new Map(
      previousEntities?.map(e => [e.entity_type, e.entity_value]) || []
    );

    const changes: Record<string, { old: string | null; new: string | null }> = {};

    // Compare each field
    for (const [entityType, newValue] of Object.entries(newEntities)) {
      const oldValue = previousEntityMap.get(entityType);
      if (oldValue !== newValue) {
        changes[entityType] = {
          old: oldValue || null,
          new: newValue || null,
        };
      }
    }

    return changes;
  }

  /**
   * Build human-readable change summary
   */
  private buildChangeSummary(
    changes: Record<string, { old: string | null; new: string | null }>
  ): string | null {
    const changeCount = Object.keys(changes).length;
    if (changeCount === 0) {
      return null;
    }

    const summaryParts = Object.entries(changes)
      .slice(0, 3) // Limit to 3 for readability
      .map(([field, { old, new: newVal }]) => {
        const fieldName = field.replace(/_/g, ' ');
        if (!old) return `Added ${fieldName}: ${newVal}`;
        if (!newVal) return `Removed ${fieldName}`;
        return `${fieldName}: ${old} → ${newVal}`;
      });

    if (changeCount > 3) {
      summaryParts.push(`+${changeCount - 3} more changes`);
    }

    return summaryParts.join('; ');
  }

  /**
   * Update shipment revision counts
   */
  private async updateShipmentRevisionCounts(
    shipmentId: string,
    documentType: string,
    revisionNumber: number
  ): Promise<void> {
    const columnMap: Record<string, string> = {
      booking_confirmation: 'booking_revision_count',
      si_draft: 'si_revision_count',
      house_bl: 'hbl_revision_count',
    };

    const column = columnMap[documentType];
    if (!column) return;

    await this.shipmentRepository.update(shipmentId, {
      [column]: revisionNumber,
      last_document_update: new Date().toISOString(),
    });
  }
}
