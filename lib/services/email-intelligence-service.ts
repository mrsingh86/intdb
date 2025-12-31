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
 */

import { EmailRepository, EmailQueryFilters } from '../repositories/email-repository';
import { ClassificationRepository } from '../repositories/classification-repository';
import { EntityRepository } from '../repositories/entity-repository';
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
    private readonly classificationRepo: ClassificationRepository,
    private readonly entityRepo: EntityRepository
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

    // Step 2: Fetch related data in parallel
    const emailIds = emailResult.data.map(e => e.id);
    const [classifications, entities] = await Promise.all([
      this.classificationRepo.findByEmailIds(emailIds),
      this.entityRepo.findByEmailIds(emailIds),
    ]);

    // Step 3: Group by email_id for efficient lookup
    const classificationsByEmail = this.groupClassificationsByEmailId(classifications);
    const entitiesByEmail = this.groupEntitiesByEmailId(entities);

    // Step 4: Transform to EmailWithIntelligence
    const enrichedEmails = emailResult.data.map(email => ({
      ...email,
      classification: classificationsByEmail.get(email.id) || null,
      entities: entitiesByEmail.get(email.id) || [],
      thread_metadata: null, // Can be added later if needed
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
}
