/**
 * Semantic Context Service
 *
 * Provides vector-based context enrichment for AI analysis.
 * Uses embeddings to find similar emails, sender patterns, and related documents.
 *
 * Following CLAUDE.md principles:
 * - Single Responsibility (Principle #3) - only semantic context
 * - Interface-Based Design (Principle #6)
 * - Small Functions < 20 lines (Principle #17)
 * - Never Return Null (Principle #20) - use empty arrays
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { IEmbeddingService, SemanticSearchResult } from './embedding-service';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Similar email for context injection
 */
export interface SimilarEmail {
  id: string;
  documentType: string;
  subject: string;
  summary: string;
  similarity: number;
  occurredAt: string;
}

/**
 * Sender pattern history - what types of docs this sender usually sends
 */
export interface SenderPatternHistory {
  senderDomain: string;
  totalEmails: number;
  documentTypes: DocumentTypeCount[];
  topDocumentType: string;
  avgConfidence: number;
}

/**
 * Document type count for sender history
 */
export interface DocumentTypeCount {
  documentType: string;
  count: number;
  percentage: number;
}

/**
 * Related document from same shipment
 */
export interface RelatedDocument {
  id: string;
  documentType: string;
  subject: string;
  summary: string;
  occurredAt: string;
  fromParty: string;
}

/**
 * Full semantic context for AI prompt enrichment
 */
export interface SemanticContext {
  similarEmails: SimilarEmail[];
  senderHistory: SenderPatternHistory | null;
  relatedDocs: RelatedDocument[];
}

// ============================================================================
// INTERFACE
// ============================================================================

export interface ISemanticContextService {
  /**
   * Get similar emails based on content embedding (by chronicle ID)
   */
  getSimilarEmails(
    chronicleId: string,
    limit?: number
  ): Promise<SimilarEmail[]>;

  /**
   * Get similar emails based on raw text (for new emails before chronicle created)
   */
  getSimilarEmailsByText(
    subject: string,
    bodyPreview: string,
    limit?: number
  ): Promise<SimilarEmail[]>;

  /**
   * Get document type distribution for a sender domain
   */
  getSenderPatternHistory(
    senderDomain: string
  ): Promise<SenderPatternHistory | null>;

  /**
   * Get related documents from the same shipment
   */
  getRelatedShipmentDocs(
    bookingNumber?: string | null,
    mblNumber?: string | null,
    excludeId?: string
  ): Promise<RelatedDocument[]>;

  /**
   * Get full semantic context for AI analysis (by chronicle ID)
   */
  getFullContext(
    chronicleId: string,
    senderEmail: string,
    bookingNumber?: string | null,
    mblNumber?: string | null
  ): Promise<SemanticContext>;

  /**
   * Get semantic context for NEW emails (before chronicle record exists)
   * Used by AI Analyzer during initial processing
   */
  getContextForNewEmail(
    subject: string,
    bodyPreview: string,
    senderEmail: string,
    bookingNumber?: string | null,
    mblNumber?: string | null
  ): Promise<SemanticContext>;

  /**
   * Build prompt section from semantic context
   */
  buildPromptSection(context: SemanticContext): string;
}

// ============================================================================
// IMPLEMENTATION
// ============================================================================

export class SemanticContextService implements ISemanticContextService {
  private supabase: SupabaseClient;
  private embeddingService: IEmbeddingService;

  constructor(
    supabase: SupabaseClient,
    embeddingService: IEmbeddingService
  ) {
    this.supabase = supabase;
    this.embeddingService = embeddingService;
  }

  /**
   * Get similar emails based on content embedding (by chronicle ID)
   */
  async getSimilarEmails(
    chronicleId: string,
    limit: number = 3
  ): Promise<SimilarEmail[]> {
    // Get the chronicle record's text for embedding query
    const { data: record } = await this.supabase
      .from('chronicle')
      .select('subject, summary, body_preview, document_type')
      .eq('id', chronicleId)
      .single();

    if (!record) return [];

    // Build query text same as embedding generation
    const queryText = [
      record.document_type ? `[${record.document_type}]` : '',
      record.subject || '',
      record.summary || '',
      (record.body_preview || '').substring(0, 500),
    ].filter(Boolean).join(' | ');

    // Search for similar emails
    const results = await this.embeddingService.searchGlobal(queryText, { limit: limit + 1 });

    // Filter out the source email and map to SimilarEmail
    return results
      .filter(r => r.id !== chronicleId)
      .slice(0, limit)
      .map(this.mapToSimilarEmail);
  }

  /**
   * Get similar emails based on raw text (for new emails before chronicle created)
   */
  async getSimilarEmailsByText(
    subject: string,
    bodyPreview: string,
    limit: number = 3
  ): Promise<SimilarEmail[]> {
    // Build query text from raw inputs
    const queryText = [
      subject || '',
      (bodyPreview || '').substring(0, 500),
    ].filter(Boolean).join(' | ');

    if (!queryText.trim()) return [];

    try {
      // Search for similar emails
      const results = await this.embeddingService.searchGlobal(queryText, { limit });
      return results.map(this.mapToSimilarEmail);
    } catch (error) {
      // Gracefully handle embedding service errors
      console.warn('[SemanticContextService] Error searching similar emails:', error);
      return [];
    }
  }

  /**
   * Get document type distribution for a sender domain
   */
  async getSenderPatternHistory(
    senderDomain: string
  ): Promise<SenderPatternHistory | null> {
    if (!senderDomain) return null;

    // Query document type counts for this sender domain
    const { data, error } = await this.supabase
      .from('chronicle')
      .select('document_type, ai_confidence')
      .ilike('from_address', `%${senderDomain}%`)
      .not('document_type', 'is', null)
      .limit(500);

    if (error || !data || data.length === 0) return null;

    // Count document types
    const typeMap = new Map<string, number>();
    let totalConfidence = 0;
    let confidenceCount = 0;

    for (const row of data) {
      const docType = row.document_type;
      typeMap.set(docType, (typeMap.get(docType) || 0) + 1);
      if (row.ai_confidence) {
        totalConfidence += row.ai_confidence;
        confidenceCount++;
      }
    }

    // Build sorted document type list
    const documentTypes: DocumentTypeCount[] = Array.from(typeMap.entries())
      .map(([documentType, count]) => ({
        documentType,
        count,
        percentage: Math.round((count / data.length) * 100),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5); // Top 5

    return {
      senderDomain,
      totalEmails: data.length,
      documentTypes,
      topDocumentType: documentTypes[0]?.documentType || 'unknown',
      avgConfidence: confidenceCount > 0 ? Math.round(totalConfidence / confidenceCount) : 0,
    };
  }

  /**
   * Get related documents from the same shipment
   */
  async getRelatedShipmentDocs(
    bookingNumber?: string | null,
    mblNumber?: string | null,
    excludeId?: string
  ): Promise<RelatedDocument[]> {
    if (!bookingNumber && !mblNumber) return [];

    let query = this.supabase
      .from('chronicle')
      .select('id, document_type, subject, summary, occurred_at, from_party')
      .order('occurred_at', { ascending: false })
      .limit(10);

    // Build OR condition for booking or MBL
    if (bookingNumber && mblNumber) {
      query = query.or(`booking_number.eq.${bookingNumber},mbl_number.eq.${mblNumber}`);
    } else if (bookingNumber) {
      query = query.eq('booking_number', bookingNumber);
    } else if (mblNumber) {
      query = query.eq('mbl_number', mblNumber);
    }

    const { data, error } = await query;

    if (error || !data) return [];

    return data
      .filter(r => r.id !== excludeId)
      .slice(0, 5)
      .map(row => ({
        id: row.id,
        documentType: row.document_type || 'unknown',
        subject: row.subject || '',
        summary: row.summary || '',
        occurredAt: row.occurred_at || '',
        fromParty: row.from_party || 'unknown',
      }));
  }

  /**
   * Get full semantic context for AI analysis (by chronicle ID)
   */
  async getFullContext(
    chronicleId: string,
    senderEmail: string,
    bookingNumber?: string | null,
    mblNumber?: string | null
  ): Promise<SemanticContext> {
    const senderDomain = this.extractDomain(senderEmail);

    // Fetch all context in parallel
    const [similarEmails, senderHistory, relatedDocs] = await Promise.all([
      this.getSimilarEmails(chronicleId, 3),
      this.getSenderPatternHistory(senderDomain),
      this.getRelatedShipmentDocs(bookingNumber, mblNumber, chronicleId),
    ]);

    return {
      similarEmails,
      senderHistory,
      relatedDocs,
    };
  }

  /**
   * Get semantic context for NEW emails (before chronicle record exists)
   * Used by AI Analyzer during initial processing
   */
  async getContextForNewEmail(
    subject: string,
    bodyPreview: string,
    senderEmail: string,
    bookingNumber?: string | null,
    mblNumber?: string | null
  ): Promise<SemanticContext> {
    const senderDomain = this.extractDomain(senderEmail);

    // Fetch all context in parallel
    const [similarEmails, senderHistory, relatedDocs] = await Promise.all([
      this.getSimilarEmailsByText(subject, bodyPreview, 3),
      this.getSenderPatternHistory(senderDomain),
      this.getRelatedShipmentDocs(bookingNumber, mblNumber),
    ]);

    return {
      similarEmails,
      senderHistory,
      relatedDocs,
    };
  }

  /**
   * Build prompt section from semantic context
   */
  buildPromptSection(context: SemanticContext): string {
    const sections: string[] = [];

    // Similar emails section
    if (context.similarEmails.length > 0) {
      sections.push(this.buildSimilarEmailsSection(context.similarEmails));
    }

    // Sender history section
    if (context.senderHistory) {
      sections.push(this.buildSenderHistorySection(context.senderHistory));
    }

    // Related documents section
    if (context.relatedDocs.length > 0) {
      sections.push(this.buildRelatedDocsSection(context.relatedDocs));
    }

    if (sections.length === 0) return '';

    return `
=== SEMANTIC CONTEXT (from similar emails) ===
${sections.join('\n')}
NOTE: Use this context to improve classification accuracy. Similar emails and sender patterns provide hints but the CURRENT email content takes precedence.
`;
  }

  // ==========================================================================
  // PRIVATE HELPERS
  // ==========================================================================

  private mapToSimilarEmail(result: SemanticSearchResult): SimilarEmail {
    return {
      id: result.id,
      documentType: result.documentType,
      subject: result.subject,
      summary: result.summary,
      similarity: result.similarity,
      occurredAt: result.occurredAt,
    };
  }

  private extractDomain(email: string): string {
    if (!email) return '';
    const match = email.match(/@([^>]+)/);
    return match ? match[1].toLowerCase() : '';
  }

  private buildSimilarEmailsSection(emails: SimilarEmail[]): string {
    let section = `\n📧 SIMILAR EMAILS (${emails.length} found):\n`;
    for (const email of emails) {
      const simPercent = Math.round(email.similarity * 100);
      section += `  • [${email.documentType}] ${simPercent}% similar: ${email.summary?.slice(0, 80) || email.subject?.slice(0, 80)}\n`;
    }
    return section;
  }

  private buildSenderHistorySection(history: SenderPatternHistory): string {
    let section = `\n📤 SENDER HISTORY (@${history.senderDomain}, ${history.totalEmails} emails):\n`;
    section += `  Typical document types:\n`;
    for (const dt of history.documentTypes.slice(0, 3)) {
      section += `    • ${dt.documentType}: ${dt.percentage}% (${dt.count} emails)\n`;
    }
    if (history.avgConfidence > 0) {
      section += `  Average classification confidence: ${history.avgConfidence}%\n`;
    }
    return section;
  }

  private buildRelatedDocsSection(docs: RelatedDocument[]): string {
    let section = `\n📋 RELATED SHIPMENT DOCUMENTS (${docs.length} found):\n`;
    for (const doc of docs) {
      const date = doc.occurredAt ? new Date(doc.occurredAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
      section += `  • ${date} [${doc.documentType}] from ${doc.fromParty}: ${doc.summary?.slice(0, 60) || ''}\n`;
    }
    return section;
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createSemanticContextService(
  supabase: SupabaseClient,
  embeddingService: IEmbeddingService
): ISemanticContextService {
  return new SemanticContextService(supabase, embeddingService);
}
