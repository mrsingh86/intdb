/**
 * Document Lifecycle Service
 *
 * Manages document lifecycle states, quality scoring, and automatic
 * lifecycle creation when documents are received.
 *
 * Lifecycle States:
 * DRAFT -> REVIEW -> APPROVED -> SENT -> ACKNOWLEDGED -> SUPERSEDED
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { DocumentLifecycleRepository } from '@/lib/repositories/document-lifecycle-repository';
import {
  DocumentLifecycle,
  DocumentLifecycleStatus,
  DocumentTypeRequirement,
} from '@/types/intelligence-platform';

// Valid state transitions
const VALID_TRANSITIONS: Record<DocumentLifecycleStatus, DocumentLifecycleStatus[]> = {
  draft: ['review', 'approved', 'superseded'],
  review: ['draft', 'approved', 'superseded'],
  approved: ['sent', 'superseded'],
  sent: ['acknowledged', 'superseded'],
  acknowledged: ['superseded'],
  superseded: [], // Terminal state
};

// Required fields by document type for quality scoring
const REQUIRED_FIELDS: Record<string, string[]> = {
  booking_confirmation: [
    'booking_number',
    'vessel_name',
    'voyage_number',
    'etd',
    'eta',
    'port_of_loading',
    'port_of_discharge',
  ],
  si_draft: [
    'shipper_name',
    'consignee_name',
    'notify_party',
    'commodity_description',
    'gross_weight',
    'container_numbers',
    'port_of_loading',
    'port_of_discharge',
  ],
  si_final: [
    'shipper_name',
    'consignee_name',
    'notify_party',
    'commodity_description',
    'gross_weight',
    'container_numbers',
    'seal_numbers',
  ],
  hbl: [
    'bl_number',
    'shipper_name',
    'consignee_name',
    'notify_party',
    'vessel_name',
    'voyage_number',
    'container_numbers',
    'gross_weight',
  ],
  mbl: [
    'mbl_number',
    'vessel_name',
    'voyage_number',
    'container_numbers',
    'port_of_loading',
    'port_of_discharge',
  ],
  arrival_notice: ['vessel_name', 'eta', 'container_numbers', 'charges'],
  delivery_order: ['bl_number', 'container_numbers', 'release_date'],
};

// Document prerequisites - what MUST have been received before this document
// When a document arrives without its prerequisites, create missing document alerts
const DOCUMENT_PREREQUISITES: Record<string, string[]> = {
  // BL requires SI to have been submitted first
  'bill_of_lading': ['shipping_instruction', 'si_draft', 'si_submission'],
  'bl_draft': ['shipping_instruction', 'si_draft', 'si_submission'],
  'hbl_draft': ['shipping_instruction', 'si_draft', 'si_submission'],
  'bl_released': ['bill_of_lading', 'bl_draft', 'hbl_draft'],
  'hbl_released': ['bill_of_lading', 'bl_draft', 'hbl_draft'],
  'telex_release': ['bill_of_lading', 'bl_draft', 'hbl_draft'],

  // Arrival notice should have BL
  'arrival_notice': ['bill_of_lading', 'bl_draft', 'hbl_draft', 'bl_released', 'hbl_released'],

  // Customs clearance needs arrival notice
  'customs_clearance': ['arrival_notice'],
  'customs_document': ['arrival_notice'],

  // Delivery requires arrival and customs
  'delivery_order': ['arrival_notice', 'customs_clearance'],
  'pod_confirmation': ['delivery_order'],

  // VGM should have SI (or at least booking)
  'vgm_confirmation': ['booking_confirmation', 'booking_amendment'],
  'vgm_submission': ['booking_confirmation', 'booking_amendment'],
};

// Map document types to normalized stage for prerequisite checking
const DOC_TYPE_TO_STAGE: Record<string, string> = {
  'booking_confirmation': 'BKG',
  'booking_amendment': 'BKG',
  'booking_request': 'BKG',
  'commercial_invoice': 'INV',
  'invoice': 'INV',
  'proforma_invoice': 'INV',
  'tax_invoice': 'INV',
  'packing_list': 'PKG',
  'si_draft': 'SI',
  'shipping_instruction': 'SI',
  'shipping_instructions': 'SI',
  'si_submission': 'SI',
  'bl_instruction': 'SI',
  'sob_confirmation': 'SI',
  'checklist': 'SI',
  'forwarding_note': 'SI',
  'vgm_confirmation': 'VGM',
  'vgm_submission': 'VGM',
  'bl_draft': 'BL_DRAFT',
  'hbl_draft': 'BL_DRAFT',
  'bill_of_lading': 'BL_DRAFT',
  'bl_released': 'BL_RELEASED',
  'hbl_released': 'BL_RELEASED',
  'telex_release': 'BL_RELEASED',
  'arrival_notice': 'ARR',
  'customs_clearance': 'CUS',
  'customs_document': 'CUS',
  'isf_filing': 'CUS',
  'duty_entry': 'CUS',
  'delivery_order': 'DEL',
  'pod_confirmation': 'DEL',
  'pickup_notification': 'DEL',
  'delivery_coordination': 'DEL',
};

// Field weights for quality scoring
const FIELD_WEIGHTS: Record<string, number> = {
  booking_number: 15,
  bl_number: 15,
  mbl_number: 15,
  shipper_name: 10,
  consignee_name: 10,
  container_numbers: 12,
  vessel_name: 8,
  voyage_number: 5,
  etd: 8,
  eta: 8,
  gross_weight: 7,
  commodity_description: 5,
  port_of_loading: 5,
  port_of_discharge: 5,
  notify_party: 5,
  seal_numbers: 5,
  charges: 5,
  release_date: 5,
};

export interface TransitionResult {
  success: boolean;
  lifecycle: DocumentLifecycle | null;
  error?: string;
  previousStatus?: DocumentLifecycleStatus;
}

export interface QualityAssessment {
  score: number;
  missingFields: string[];
  validationErrors: string[];
  fieldScores: Record<string, { present: boolean; weight: number }>;
}

export interface DocumentDueDate {
  documentType: string;
  dueDate: Date;
  requirement: DocumentTypeRequirement;
}

export class DocumentLifecycleService {
  private repository: DocumentLifecycleRepository;

  constructor(private supabase: SupabaseClient) {
    this.repository = new DocumentLifecycleRepository(supabase);
  }

  // ============================================================================
  // LIFECYCLE STATE MANAGEMENT
  // ============================================================================

  async transitionStatus(
    lifecycleId: string,
    newStatus: DocumentLifecycleStatus,
    changedBy: string = 'system'
  ): Promise<TransitionResult> {
    const lifecycle = await this.repository.findLifecycleById(lifecycleId);

    if (!lifecycle) {
      return {
        success: false,
        lifecycle: null,
        error: `Document lifecycle not found: ${lifecycleId}`,
      };
    }

    // Validate transition
    const currentStatus = lifecycle.lifecycle_status as DocumentLifecycleStatus;
    const allowedTransitions = VALID_TRANSITIONS[currentStatus];

    if (!allowedTransitions.includes(newStatus)) {
      return {
        success: false,
        lifecycle,
        error: `Invalid transition from '${currentStatus}' to '${newStatus}'. Allowed: ${allowedTransitions.join(', ')}`,
        previousStatus: currentStatus,
      };
    }

    // Perform transition
    const updated = await this.repository.updateLifecycleStatus(
      lifecycleId,
      newStatus,
      changedBy
    );

    return {
      success: true,
      lifecycle: updated,
      previousStatus: currentStatus,
    };
  }

  async bulkTransition(
    lifecycleIds: string[],
    newStatus: DocumentLifecycleStatus,
    changedBy: string = 'system'
  ): Promise<{ successful: string[]; failed: Array<{ id: string; error: string }> }> {
    const successful: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const id of lifecycleIds) {
      const result = await this.transitionStatus(id, newStatus, changedBy);
      if (result.success) {
        successful.push(id);
      } else {
        failed.push({ id, error: result.error || 'Unknown error' });
      }
    }

    return { successful, failed };
  }

  // ============================================================================
  // QUALITY SCORING
  // ============================================================================

  assessDocumentQuality(
    documentType: string,
    extractedFields: Record<string, unknown>
  ): QualityAssessment {
    const requiredFields = REQUIRED_FIELDS[documentType] || [];
    const missingFields: string[] = [];
    const validationErrors: string[] = [];
    const fieldScores: Record<string, { present: boolean; weight: number }> = {};

    let totalWeight = 0;
    let earnedWeight = 0;

    for (const field of requiredFields) {
      const weight = FIELD_WEIGHTS[field] || 5;
      totalWeight += weight;

      const value = extractedFields[field];
      const isPresent = value !== null && value !== undefined && value !== '';

      fieldScores[field] = { present: isPresent, weight };

      if (isPresent) {
        earnedWeight += weight;

        // Additional validation
        const validationError = this.validateField(field, value);
        if (validationError) {
          validationErrors.push(validationError);
          earnedWeight -= weight * 0.3; // Partial penalty for invalid values
        }
      } else {
        missingFields.push(field);
      }
    }

    const score = totalWeight > 0 ? (earnedWeight / totalWeight) * 100 : 0;

    return {
      score: Math.max(0, Math.min(100, score)),
      missingFields,
      validationErrors,
      fieldScores,
    };
  }

  private validateField(fieldName: string, value: unknown): string | null {
    if (typeof value !== 'string') return null;

    switch (fieldName) {
      case 'container_numbers':
        if (Array.isArray(value)) {
          const invalid = (value as string[]).filter(
            cn => !/^[A-Z]{4}\d{7}$/i.test(cn)
          );
          if (invalid.length > 0) {
            return `Invalid container numbers: ${invalid.join(', ')}`;
          }
        }
        break;

      case 'gross_weight':
        if (isNaN(parseFloat(value))) {
          return `Invalid gross weight: ${value}`;
        }
        break;

      case 'etd':
      case 'eta':
        if (isNaN(Date.parse(value))) {
          return `Invalid date for ${fieldName}: ${value}`;
        }
        break;

      case 'booking_number':
        if (value.length < 5) {
          return `Booking number too short: ${value}`;
        }
        break;
    }

    return null;
  }

  async updateQualityScore(
    lifecycleId: string,
    extractedFields: Record<string, unknown>
  ): Promise<DocumentLifecycle> {
    const lifecycle = await this.repository.findLifecycleById(lifecycleId);
    if (!lifecycle) {
      throw new Error(`Document lifecycle not found: ${lifecycleId}`);
    }

    const assessment = this.assessDocumentQuality(
      lifecycle.document_type,
      extractedFields
    );

    return this.repository.updateLifecycle(lifecycleId, {
      quality_score: assessment.score,
      missing_fields: assessment.missingFields,
      validation_errors: assessment.validationErrors,
    });
  }

  // ============================================================================
  // LIFECYCLE CREATION & MANAGEMENT
  // ============================================================================

  async createLifecycleForDocument(
    shipmentId: string,
    documentType: string,
    options: {
      extractedFields?: Record<string, unknown>;
      revisionId?: string;
      receivedAt?: string;
      dueDate?: string;
    } = {}
  ): Promise<DocumentLifecycle> {
    // Check if lifecycle already exists
    const existing = await this.repository.findLifecycleByShipmentAndType(
      shipmentId,
      documentType
    );

    if (existing) {
      // Update existing lifecycle with new revision
      const updates: Partial<DocumentLifecycle> = {
        revision_count: (existing.revision_count || 1) + 1,
      };

      if (options.revisionId) {
        updates.current_revision_id = options.revisionId;
      }

      // If superseded, transition back to review
      if (existing.lifecycle_status === 'superseded') {
        updates.lifecycle_status = 'review';
        updates.status_history = [
          ...(existing.status_history || []),
          {
            status: 'review',
            changed_at: new Date().toISOString(),
            changed_by: 'system',
            reason: 'New revision received',
          },
        ];
      }

      // Update quality score if fields provided
      if (options.extractedFields) {
        const assessment = this.assessDocumentQuality(
          documentType,
          options.extractedFields
        );
        updates.quality_score = assessment.score;
        updates.missing_fields = assessment.missingFields;
        updates.validation_errors = assessment.validationErrors;
      }

      return this.repository.updateLifecycle(existing.id, updates);
    }

    // Create new lifecycle
    const initialData: Omit<DocumentLifecycle, 'id' | 'created_at' | 'updated_at'> = {
      shipment_id: shipmentId,
      document_type: documentType,
      lifecycle_status: 'draft',
      status_history: [
        {
          status: 'draft',
          changed_at: new Date().toISOString(),
          changed_by: 'system',
        },
      ],
      revision_count: 1,
      received_at: options.receivedAt || new Date().toISOString(),
      due_date: options.dueDate,
      current_revision_id: options.revisionId,
    };

    // Calculate quality score if fields provided
    if (options.extractedFields) {
      const assessment = this.assessDocumentQuality(
        documentType,
        options.extractedFields
      );
      initialData.quality_score = assessment.score;
      initialData.missing_fields = assessment.missingFields;
      initialData.validation_errors = assessment.validationErrors;
    }

    return this.repository.createLifecycle(initialData);
  }

  async supersedePreviousVersions(
    shipmentId: string,
    documentType: string,
    exceptId: string
  ): Promise<void> {
    const { data } = await this.repository.findAllLifecycles({
      shipmentId,
      documentType,
    });

    for (const lifecycle of data) {
      if (
        lifecycle.id !== exceptId &&
        lifecycle.lifecycle_status !== 'superseded'
      ) {
        await this.repository.updateLifecycleStatus(
          lifecycle.id,
          'superseded',
          'system'
        );
      }
    }
  }

  // ============================================================================
  // DUE DATES & REQUIREMENTS
  // ============================================================================

  async calculateDueDates(
    shipmentId: string,
    etd: Date
  ): Promise<DocumentDueDate[]> {
    const requirements = await this.repository.getDocumentRequirements();
    const dueDates: DocumentDueDate[] = [];

    for (const req of requirements) {
      if (req.due_days_offset !== null) {
        const dueDate = new Date(etd);
        dueDate.setDate(dueDate.getDate() + req.due_days_offset);

        dueDates.push({
          documentType: req.document_type,
          dueDate,
          requirement: req,
        });
      }
    }

    return dueDates.sort(
      (a, b) => a.dueDate.getTime() - b.dueDate.getTime()
    );
  }

  async createMissingDocumentAlertsForShipment(
    shipmentId: string,
    etd: Date
  ): Promise<void> {
    const dueDates = await this.calculateDueDates(shipmentId, etd);
    const today = new Date();

    for (const { documentType, dueDate, requirement } of dueDates) {
      // Check if document already exists
      const existing = await this.repository.findLifecycleByShipmentAndType(
        shipmentId,
        documentType
      );

      if (!existing) {
        // Determine alert status
        let alertStatus: 'pending' | 'due_soon' | 'overdue' = 'pending';
        const daysUntilDue = Math.floor(
          (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysUntilDue < 0) {
          alertStatus = 'overdue';
        } else if (daysUntilDue <= 3) {
          alertStatus = 'due_soon';
        }

        await this.repository.upsertAlert(shipmentId, documentType, {
          expected_by: dueDate.toISOString().split('T')[0],
          document_description: requirement.document_description,
          alert_status: alertStatus,
        });
      }
    }
  }

  // ============================================================================
  // DASHBOARD & STATISTICS
  // ============================================================================

  async getDashboardData(): Promise<{
    statistics: {
      totalDocuments: number;
      byStatus: Record<string, number>;
      withQualityIssues: number;
      pendingReview: number;
    };
    qualityOverview: {
      averageScore: number;
      documentsBelow80: number;
      documentsBelow50: number;
    };
    alerts: {
      total: number;
      overdue: number;
      dueSoon: number;
    };
    comparisons: {
      pending: number;
      unresolved: number;
      critical: number;
    };
    recentDocuments: DocumentLifecycle[];
  }> {
    const stats = await this.repository.getDocumentStatistics();

    // Get lifecycle details for quality analysis
    const { data: lifecycles } = await this.repository.findAllLifecycles({});

    let totalScore = 0;
    let documentsWithScore = 0;
    let documentsBelow80 = 0;
    let documentsBelow50 = 0;

    for (const lc of lifecycles) {
      if (lc.quality_score !== null) {
        totalScore += lc.quality_score;
        documentsWithScore++;
        if (lc.quality_score < 80) documentsBelow80++;
        if (lc.quality_score < 50) documentsBelow50++;
      }
    }

    const averageScore =
      documentsWithScore > 0 ? totalScore / documentsWithScore : 0;

    // Get recent documents
    const { data: recentDocuments } = await this.repository.findAllLifecycles(
      {},
      { page: 1, limit: 10 }
    );

    return {
      statistics: {
        totalDocuments: stats.totalLifecycles,
        byStatus: stats.byStatus,
        withQualityIssues: stats.withMissingFields,
        pendingReview: stats.byStatus['review'] || 0,
      },
      qualityOverview: {
        averageScore,
        documentsBelow80,
        documentsBelow50,
      },
      alerts: {
        total: stats.activeAlerts,
        overdue: stats.overdueAlerts,
        dueSoon: stats.activeAlerts - stats.overdueAlerts,
      },
      comparisons: {
        pending: stats.pendingComparisons,
        unresolved: stats.unresolvedDiscrepancies,
        critical: stats.criticalDiscrepancies,
      },
      recentDocuments,
    };
  }

  // ============================================================================
  // PREREQUISITE CHECKING - Check if required documents exist before this one
  // ============================================================================

  /**
   * Check if prerequisites are met when a document arrives.
   * If prerequisites are missing, create alerts for them.
   *
   * @param shipmentId - The shipment to check
   * @param documentType - The document type that just arrived
   * @returns Object with missing prerequisites and alerts created
   */
  async checkPrerequisitesAndCreateAlerts(
    shipmentId: string,
    documentType: string
  ): Promise<{
    hasMissingPrerequisites: boolean;
    missingDocuments: string[];
    alertsCreated: number;
  }> {
    // Get prerequisites for this document type
    const prerequisites = DOCUMENT_PREREQUISITES[documentType];

    if (!prerequisites || prerequisites.length === 0) {
      return { hasMissingPrerequisites: false, missingDocuments: [], alertsCreated: 0 };
    }

    // Get all existing lifecycle records for this shipment
    const { data: existingLifecycles } = await this.repository.findAllLifecycles({
      shipmentId,
    });

    const existingDocTypes = new Set(existingLifecycles.map(lc => lc.document_type));

    // Also check document_lifecycle table directly with normalized stages
    const existingStages = new Set<string>();
    for (const lc of existingLifecycles) {
      const stage = DOC_TYPE_TO_STAGE[lc.document_type];
      if (stage) existingStages.add(stage);
    }

    // Check if ANY of the prerequisite document types exist (OR logic)
    // Group prerequisites by stage - need at least one from each stage group
    const prerequisiteStages = new Set<string>();
    for (const prereq of prerequisites) {
      const stage = DOC_TYPE_TO_STAGE[prereq];
      if (stage) prerequisiteStages.add(stage);
    }

    const missingStages: string[] = [];
    for (const requiredStage of prerequisiteStages) {
      if (!existingStages.has(requiredStage)) {
        missingStages.push(requiredStage);
      }
    }

    if (missingStages.length === 0) {
      return { hasMissingPrerequisites: false, missingDocuments: [], alertsCreated: 0 };
    }

    // Find the specific missing document types for alert creation
    const missingDocuments: string[] = [];
    for (const stage of missingStages) {
      // Find the primary document type for this stage
      const primaryDocType = this.getPrimaryDocTypeForStage(stage);
      if (primaryDocType) {
        missingDocuments.push(primaryDocType);
      }
    }

    // Create alerts for missing documents
    let alertsCreated = 0;
    // Use today as expected_by since prerequisite was already expected
    const todayStr = new Date().toISOString().split('T')[0];

    for (const missingDocType of missingDocuments) {
      try {
        await this.repository.upsertAlert(shipmentId, missingDocType, {
          expected_by: todayStr, // Already overdue since next doc arrived
          document_description: `Missing prerequisite: Required before ${documentType} can be processed`,
          alert_status: 'overdue',
        });
        alertsCreated++;
      } catch (error) {
        // Ignore duplicates (constraint violations)
        console.warn(`Could not create alert for ${missingDocType}:`, error);
      }
    }

    return {
      hasMissingPrerequisites: true,
      missingDocuments,
      alertsCreated,
    };
  }

  /**
   * Get the primary document type for a stage (for alert creation)
   */
  private getPrimaryDocTypeForStage(stage: string): string | null {
    const stageToDocType: Record<string, string> = {
      'BKG': 'booking_confirmation',
      'INV': 'commercial_invoice',
      'PKG': 'packing_list',
      'SI': 'shipping_instruction',
      'VGM': 'vgm_confirmation',
      'BL_DRAFT': 'bl_draft',
      'BL_RELEASED': 'bl_released',
      'ARR': 'arrival_notice',
      'CUS': 'customs_clearance',
      'DEL': 'delivery_order',
    };
    return stageToDocType[stage] || null;
  }

  /**
   * Batch check prerequisites for all shipments and create alerts
   * Use this for backfilling alerts on existing data
   */
  async backfillPrerequisiteAlerts(): Promise<{
    shipmentsChecked: number;
    alertsCreated: number;
    violations: Array<{ shipmentId: string; documentType: string; missing: string[] }>;
  }> {
    // Get all shipments with their document lifecycles
    const { data: allLifecycles } = await this.repository.findAllLifecycles({});

    // Group by shipment
    const shipmentDocuments = new Map<string, string[]>();
    for (const lc of allLifecycles) {
      const docs = shipmentDocuments.get(lc.shipment_id) || [];
      docs.push(lc.document_type);
      shipmentDocuments.set(lc.shipment_id, docs);
    }

    let alertsCreated = 0;
    const violations: Array<{ shipmentId: string; documentType: string; missing: string[] }> = [];

    for (const [shipmentId, docTypes] of shipmentDocuments) {
      // For each document type, check prerequisites
      for (const docType of docTypes) {
        const result = await this.checkPrerequisitesAndCreateAlerts(shipmentId, docType);

        if (result.hasMissingPrerequisites) {
          violations.push({
            shipmentId,
            documentType: docType,
            missing: result.missingDocuments,
          });
          alertsCreated += result.alertsCreated;
        }
      }
    }

    return {
      shipmentsChecked: shipmentDocuments.size,
      alertsCreated,
      violations,
    };
  }
}
