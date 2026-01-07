/**
 * Email Intelligence Service
 *
 * Orchestrates fetching emails with their classifications and entities.
 * Implements Deep Module pattern: simple interface, complex implementation.
 *
 * Principles:
 * - Deep Modules: Simple fetchEmailsWithIntelligence() hides complexity
 * - Separation of Concerns: Business logic separated from API/DB
 * - Single Responsibility: Only email intelligence aggregation
 *
 * Uses split architecture:
 * - EmailClassificationRepository + AttachmentClassificationRepository
 * - EmailExtractionRepository + AttachmentExtractionRepository
 */

import { EmailRepository, EmailQueryFilters } from '../repositories/email-repository';
import {
  EmailClassificationRepository,
  AttachmentClassificationRepository,
  EmailExtractionRepository,
  AttachmentExtractionRepository,
} from '../repositories';
import { EmailWithIntelligence, DocumentClassification, EntityExtraction } from '@/types/email-intelligence';
import { PaginationOptions, PaginatedResult } from '../types/repository-filters';

export interface EmailIntelligenceFilters extends EmailQueryFilters {
  documentType?: string[];
  confidenceLevel?: string[];
  needsReview?: boolean;
}

export class EmailIntelligenceService {
  constructor(
    private readonly emailRepo: EmailRepository,
    private readonly emailClassificationRepo: EmailClassificationRepository,
    private readonly attachmentClassificationRepo: AttachmentClassificationRepository,
    private readonly emailExtractionRepo: EmailExtractionRepository,
    private readonly attachmentExtractionRepo: AttachmentExtractionRepository
  ) {}

  /**
   * Fetch emails with classifications and entities
   *
   * Deep module: Hides complexity of fetching from 3 tables and joining
   */
  async fetchEmailsWithIntelligence(
    filters: EmailIntelligenceFilters,
    pagination: PaginationOptions
  ): Promise<PaginatedResult<EmailWithIntelligence>> {
    // Step 1: Fetch emails with basic filters
    const emailResult = await this.emailRepo.findAll(
      {
        threadId: filters.threadId,
        hasAttachments: filters.hasAttachments,
        search: filters.search,
      },
      pagination
    );

    if (emailResult.data.length === 0) {
      return {
        ...emailResult,
        data: [],
      };
    }

    // Step 2: Fetch related data in parallel from split repositories
    const emailIds = emailResult.data.map(e => e.id).filter((id): id is string => !!id);
    const [emailClassifications, attachmentClassifications, emailExtractions, attachmentExtractions] = await Promise.all([
      this.emailClassificationRepo.findByEmailIds(emailIds),
      this.attachmentClassificationRepo.findByEmailIds(emailIds),
      this.emailExtractionRepo.findByEmailIds(emailIds),
      this.attachmentExtractionRepo.findByEmailIds(emailIds),
    ]);

    // Merge classifications: prefer email classification, fall back to attachment
    const classifications: DocumentClassification[] = this.mergeClassifications(emailClassifications, attachmentClassifications);

    // Merge extractions from both sources
    const entities: EntityExtraction[] = this.mergeExtractions(emailExtractions, attachmentExtractions);

    // Step 3: Group by email_id for efficient lookup
    const classificationsByEmail = this.groupClassificationsByEmailId(classifications);
    const entitiesByEmail = this.groupEntitiesByEmailId(entities);

    // Step 4: Transform to EmailWithIntelligence
    const enrichedEmails = emailResult.data.map(email => ({
      ...email,
      classification: email.id ? classificationsByEmail.get(email.id) : undefined,
      entities: email.id ? (entitiesByEmail.get(email.id) || []) : [],
      thread_metadata: undefined,
    }));

    return {
      data: enrichedEmails,
      pagination: emailResult.pagination,
    };
  }

  /**
   * Group classifications by email_id for O(1) lookup
   */
  private groupClassificationsByEmailId(
    classifications: DocumentClassification[]
  ): Map<string, DocumentClassification> {
    const map = new Map<string, DocumentClassification>();
    classifications.forEach(c => map.set(c.email_id, c));
    return map;
  }

  /**
   * Group entities by email_id for O(1) lookup
   */
  private groupEntitiesByEmailId(
    entities: EntityExtraction[]
  ): Map<string, EntityExtraction[]> {
    const map = new Map<string, EntityExtraction[]>();
    entities.forEach(e => {
      const existing = map.get(e.email_id) || [];
      existing.push(e);
      map.set(e.email_id, existing);
    });
    return map;
  }

  /**
   * Merge classifications from email and attachment classification repos
   * Prefers attachment classification (has document_type); falls back to email classification
   */
  private mergeClassifications(
    emailClassifications: any[],
    attachmentClassifications: any[]
  ): DocumentClassification[] {
    const merged = new Map<string, DocumentClassification>();

    // Add attachment classifications first (they have document_type from PDF content)
    for (const ac of attachmentClassifications) {
      merged.set(ac.email_id, {
        id: ac.id,
        email_id: ac.email_id,
        document_type: ac.document_type || 'unknown',
        confidence_score: ac.confidence || 0,
        classification_reason: ac.classification_status || '',
        classified_at: ac.classified_at || ac.created_at,
        model_name: ac.classification_method || 'content',
        is_manual_review: false,
        created_at: ac.created_at || new Date().toISOString(),
      });
    }

    // Add email classifications for emails without attachment classification
    // Email classifications have email_type, not document_type
    for (const ec of emailClassifications) {
      if (!merged.has(ec.email_id)) {
        merged.set(ec.email_id, {
          id: ec.id,
          email_id: ec.email_id,
          // Map email_type to document_type for compatibility
          document_type: ec.email_type || 'unknown',
          confidence_score: ec.confidence || 0,
          classification_reason: ec.classification_status || '',
          classified_at: ec.classified_at || ec.created_at,
          model_name: ec.classification_source || 'email',
          is_manual_review: false,
          created_at: ec.created_at || new Date().toISOString(),
        });
      }
    }

    return Array.from(merged.values());
  }

  /**
   * Merge extractions from email and attachment extraction repos
   * Combines all extractions into unified EntityExtraction format
   */
  private mergeExtractions(
    emailExtractions: any[],
    attachmentExtractions: any[]
  ): EntityExtraction[] {
    const mapToEntityExtraction = (e: any): EntityExtraction => ({
      id: e.id,
      email_id: e.email_id,
      entity_type: e.entity_type,
      entity_value: e.entity_value,
      confidence_score: e.confidence_score || 0,
      extraction_method: e.extraction_method || 'unknown',
      is_verified: e.is_correct ?? false,
      created_at: e.created_at || e.extracted_at || new Date().toISOString(),
      context_snippet: e.context_snippet,
    });

    return [
      ...emailExtractions.map(mapToEntityExtraction),
      ...attachmentExtractions.map(mapToEntityExtraction),
    ];
  }
}
