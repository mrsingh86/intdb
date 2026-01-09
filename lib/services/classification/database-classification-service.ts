/**
 * Database Classification Service
 *
 * Bridges the ClassificationConfigRepository (database) with classification services.
 * Loads sender patterns and content markers from database.
 *
 * Features:
 * - Sender type detection from email addresses
 * - Document type classification from content
 * - Falls back to hardcoded patterns if DB unavailable
 *
 * Usage:
 *   const service = new DatabaseClassificationService(supabase);
 *   const senderType = await service.detectSenderType('noreply@maersk.com');
 *   const docType = await service.classifyContent(extractedText);
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  ClassificationConfigRepository,
  SenderType,
  ContentMatchResult,
} from '../../repositories';
import {
  identifySenderType as identifyHardcodedSenderType,
  SenderType as HardcodedSenderType,
} from '../../config/content-classification-config';

// ============================================================================
// Types
// ============================================================================

export interface SenderClassificationResult {
  senderType: SenderType;
  fromDatabase: boolean;
}

export interface ContentClassificationResult {
  documentType: string | null;
  confidence: number;
  matchedKeywords: string[];
  fromDatabase: boolean;
}

// ============================================================================
// Database Classification Service
// ============================================================================

export class DatabaseClassificationService {
  private supabase: SupabaseClient;
  private configRepo: ClassificationConfigRepository;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.configRepo = new ClassificationConfigRepository(supabase);
  }

  // ==========================================================================
  // Sender Classification
  // ==========================================================================

  /**
   * Detect sender type from email address
   * First tries database, then falls back to hardcoded
   */
  async detectSenderType(emailAddress: string): Promise<SenderClassificationResult> {
    try {
      const dbSenderType = await this.configRepo.detectSenderType(emailAddress);
      if (dbSenderType !== 'unknown') {
        return {
          senderType: dbSenderType,
          fromDatabase: true,
        };
      }
    } catch (err) {
      console.error('DB sender detection failed, using fallback:', err);
    }

    // Fall back to hardcoded
    const hardcodedType = identifyHardcodedSenderType(emailAddress);
    return {
      senderType: this.mapHardcodedSenderType(hardcodedType),
      fromDatabase: false,
    };
  }

  /**
   * Check if sender is a shipping line
   */
  async isShippingLine(emailAddress: string): Promise<boolean> {
    const result = await this.detectSenderType(emailAddress);
    return result.senderType === 'shipping_line';
  }

  // ==========================================================================
  // Content Classification
  // ==========================================================================

  /**
   * Classify document content using content markers
   * First tries database, then falls back to hardcoded
   */
  async classifyContent(text: string): Promise<ContentClassificationResult> {
    if (!text || text.length < 20) {
      return {
        documentType: null,
        confidence: 0,
        matchedKeywords: [],
        fromDatabase: false,
      };
    }

    try {
      const dbResult = await this.configRepo.classifyContent(text);
      if (dbResult.matched) {
        return {
          documentType: dbResult.documentType || null,
          confidence: dbResult.confidence || 0,
          matchedKeywords: dbResult.matchedKeywords || [],
          fromDatabase: true,
        };
      }
    } catch (err) {
      console.error('DB content classification failed, using fallback:', err);
    }

    // Fall back to hardcoded document type configs
    const { DOCUMENT_TYPE_CONFIGS } = await import('../../config/content-classification-config');
    const hardcodedResult = this.classifyByHardcodedMarkers(text, DOCUMENT_TYPE_CONFIGS);

    return {
      documentType: hardcodedResult.documentType,
      confidence: hardcodedResult.confidence,
      matchedKeywords: hardcodedResult.matchedKeywords,
      fromDatabase: false,
    };
  }

  /**
   * Get all document types that have classification markers
   */
  async getClassifiableDocumentTypes(): Promise<string[]> {
    try {
      return await this.configRepo.getDocumentTypes();
    } catch (err) {
      console.error('Failed to get document types from DB:', err);
      return [];
    }
  }

  // ==========================================================================
  // Cache Management
  // ==========================================================================

  /**
   * Invalidate cache (force reload from DB)
   */
  invalidateCache(): void {
    this.configRepo.invalidateCache();
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  /**
   * Map hardcoded sender types to database sender types
   */
  private mapHardcodedSenderType(hardcodedType: HardcodedSenderType): SenderType {
    const mapping: Record<HardcodedSenderType, SenderType> = {
      'shipping_line': 'shipping_line',
      'customs_broker_us': 'customs_broker_us',
      'customs_broker_in': 'customs_broker_india',
      'freight_forwarder': 'freight_forwarder',
      'trucker': 'unknown', // Not in DB yet
      'shipper': 'unknown',
      'consignee': 'unknown',
      'intoglo': 'freight_forwarder', // Map to freight_forwarder
      'unknown': 'unknown',
    };
    return mapping[hardcodedType] || 'unknown';
  }

  /**
   * Classify content using hardcoded document type configs as fallback
   */
  private classifyByHardcodedMarkers(
    text: string,
    configs: Array<{ type: string; contentMarkers?: Array<{ required: string[]; optional?: string[]; exclude?: string[]; confidence: number }> }>
  ): { documentType: string | null; confidence: number; matchedKeywords: string[] } {
    const upperText = text.toUpperCase();
    let bestMatch = { documentType: null as string | null, confidence: 0, matchedKeywords: [] as string[] };

    for (const config of configs) {
      if (!config.contentMarkers) continue;

      for (const marker of config.contentMarkers) {
        // Check exclude keywords
        if (marker.exclude?.some(kw => upperText.includes(kw.toUpperCase()))) {
          continue;
        }

        // Check required keywords
        const matchedRequired = marker.required.filter(kw =>
          upperText.includes(kw.toUpperCase())
        );

        if (matchedRequired.length < marker.required.length) continue;

        // Count optional matches
        const matchedOptional = (marker.optional || []).filter(kw =>
          upperText.includes(kw.toUpperCase())
        );

        const confidence = Math.min(100, marker.confidence + matchedOptional.length * 2);

        if (confidence > bestMatch.confidence) {
          bestMatch = {
            documentType: config.type,
            confidence,
            matchedKeywords: [...matchedRequired, ...matchedOptional],
          };
        }
      }
    }

    return bestMatch;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

let instance: DatabaseClassificationService | null = null;

export function createDatabaseClassificationService(
  supabase: SupabaseClient
): DatabaseClassificationService {
  if (!instance) {
    instance = new DatabaseClassificationService(supabase);
  }
  return instance;
}

export function getDatabaseClassificationService(): DatabaseClassificationService | null {
  return instance;
}

export default DatabaseClassificationService;
