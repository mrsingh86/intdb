/**
 * Classification Config Repository
 *
 * Database-driven repository for sender patterns and content markers.
 * Replaces hardcoded patterns in content-classification-config.ts.
 *
 * Features:
 * - In-memory caching with TTL
 * - Sender type detection by domain
 * - Document type classification by content markers
 *
 * Usage:
 *   const repo = new ClassificationConfigRepository(supabase);
 *   const senderType = await repo.detectSenderType('noreply@maersk.com');
 *   const markers = await repo.getContentMarkers('booking_confirmation');
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

export type SenderType =
  | 'shipping_line'
  | 'freight_forwarder'
  | 'customs_broker_us'
  | 'customs_broker_india'
  | 'port_terminal'
  | 'nvocc'
  | 'insurance'
  | 'inspection'
  | 'unknown';

export interface SenderPattern {
  id: string;
  sender_type: SenderType;
  domains: string[];
  name_patterns: string[];
  description: string | null;
  enabled: boolean;
}

export interface ContentMarker {
  id: string;
  document_type: string;
  required_keywords: string[];
  optional_keywords: string[];
  exclude_keywords: string[];
  confidence_score: number;
  marker_order: number;
  enabled: boolean;
}

export interface ContentMatchResult {
  matched: boolean;
  documentType?: string;
  confidence?: number;
  matchedKeywords?: string[];
}

interface ClassificationCache {
  senderPatterns: SenderPattern[];
  contentMarkers: ContentMarker[];
  domainIndex: Map<string, SenderType>;
  markersByDocType: Map<string, ContentMarker[]>;
  loadedAt: number;
  ttlMs: number;
}

// ============================================================================
// Classification Config Repository
// ============================================================================

export class ClassificationConfigRepository {
  private supabase: SupabaseClient;
  private cache: ClassificationCache | null = null;
  private readonly DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  // ==========================================================================
  // Sender Pattern Methods
  // ==========================================================================

  /**
   * Get all sender patterns
   */
  async getAllSenderPatterns(): Promise<SenderPattern[]> {
    await this.ensureCache();
    return this.cache!.senderPatterns;
  }

  /**
   * Detect sender type from email address
   */
  async detectSenderType(emailAddress: string): Promise<SenderType> {
    await this.ensureCache();

    const email = emailAddress.toLowerCase();
    const domain = email.split('@')[1];

    if (!domain) return 'unknown';

    // Check domain index
    const senderType = this.cache!.domainIndex.get(domain);
    if (senderType) return senderType;

    // Check for subdomain matches (e.g., 'usa.cma-cgm.com' matches 'cma-cgm.com')
    const entries = Array.from(this.cache!.domainIndex.entries());
    for (const [indexedDomain, type] of entries) {
      if (domain.endsWith('.' + indexedDomain)) {
        return type;
      }
    }

    // Check name patterns
    for (const pattern of this.cache!.senderPatterns) {
      for (const namePattern of pattern.name_patterns) {
        const regex = new RegExp(namePattern, 'i');
        if (regex.test(email)) {
          return pattern.sender_type;
        }
      }
    }

    return 'unknown';
  }

  /**
   * Check if sender is a shipping line
   */
  async isShippingLine(emailAddress: string): Promise<boolean> {
    const type = await this.detectSenderType(emailAddress);
    return type === 'shipping_line';
  }

  // ==========================================================================
  // Content Marker Methods
  // ==========================================================================

  /**
   * Get all content markers
   */
  async getAllContentMarkers(): Promise<ContentMarker[]> {
    await this.ensureCache();
    return this.cache!.contentMarkers;
  }

  /**
   * Get content markers for a specific document type
   */
  async getContentMarkers(documentType: string): Promise<ContentMarker[]> {
    await this.ensureCache();
    return this.cache!.markersByDocType.get(documentType) || [];
  }

  /**
   * Classify document content using content markers
   */
  async classifyContent(text: string): Promise<ContentMatchResult> {
    await this.ensureCache();

    if (!text) return { matched: false };

    const upperText = text.toUpperCase();
    let bestMatch: ContentMatchResult = { matched: false };

    for (const marker of this.cache!.contentMarkers) {
      // Check exclude keywords first
      const hasExclude = marker.exclude_keywords.some(kw =>
        upperText.includes(kw.toUpperCase())
      );
      if (hasExclude) continue;

      // Check required keywords
      const matchedRequired = marker.required_keywords.filter(kw =>
        upperText.includes(kw.toUpperCase())
      );

      // All required keywords must match
      if (matchedRequired.length < marker.required_keywords.length) continue;

      // Count optional keyword matches
      const matchedOptional = marker.optional_keywords.filter(kw =>
        upperText.includes(kw.toUpperCase())
      );

      // Calculate confidence
      const optionalBonus = matchedOptional.length * 2;
      const confidence = Math.min(100, marker.confidence_score + optionalBonus);

      if (!bestMatch.matched || confidence > (bestMatch.confidence || 0)) {
        bestMatch = {
          matched: true,
          documentType: marker.document_type,
          confidence,
          matchedKeywords: [...matchedRequired, ...matchedOptional],
        };
      }
    }

    return bestMatch;
  }

  /**
   * Get all unique document types that have markers
   */
  async getDocumentTypes(): Promise<string[]> {
    await this.ensureCache();
    return Array.from(this.cache!.markersByDocType.keys());
  }

  // ==========================================================================
  // Cache Management
  // ==========================================================================

  /**
   * Invalidate the cache
   */
  invalidateCache(): void {
    this.cache = null;
  }

  /**
   * Check if cache is valid
   */
  isCacheValid(): boolean {
    if (!this.cache) return false;
    return Date.now() - this.cache.loadedAt < this.cache.ttlMs;
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private async ensureCache(): Promise<void> {
    if (this.isCacheValid()) return;

    // Load sender patterns
    const { data: senderData, error: senderError } = await this.supabase
      .from('sender_patterns')
      .select('*')
      .eq('enabled', true);

    if (senderError) {
      console.error('Failed to load sender patterns:', senderError);
    }

    // Load content markers
    const { data: markerData, error: markerError } = await this.supabase
      .from('content_markers')
      .select('*')
      .eq('enabled', true)
      .order('confidence_score', { ascending: false })
      .order('marker_order', { ascending: true });

    if (markerError) {
      console.error('Failed to load content markers:', markerError);
    }

    const senderPatterns = (senderData || []) as SenderPattern[];
    const contentMarkers = (markerData || []) as ContentMarker[];

    // Build domain index
    const domainIndex = new Map<string, SenderType>();
    for (const pattern of senderPatterns) {
      for (const domain of pattern.domains) {
        domainIndex.set(domain.toLowerCase(), pattern.sender_type);
      }
    }

    // Build markers by doc type
    const markersByDocType = new Map<string, ContentMarker[]>();
    for (const marker of contentMarkers) {
      const markers = markersByDocType.get(marker.document_type) || [];
      markers.push(marker);
      markersByDocType.set(marker.document_type, markers);
    }

    this.cache = {
      senderPatterns,
      contentMarkers,
      domainIndex,
      markersByDocType,
      loadedAt: Date.now(),
      ttlMs: this.DEFAULT_TTL_MS,
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createClassificationConfigRepository(
  supabase: SupabaseClient
): ClassificationConfigRepository {
  return new ClassificationConfigRepository(supabase);
}

export default ClassificationConfigRepository;
