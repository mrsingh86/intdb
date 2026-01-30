/**
 * Query Classifier Service
 *
 * Classifies search queries to determine optimal search strategy.
 * Routes queries to keyword, semantic, or hybrid search.
 *
 * Following CLAUDE.md principles:
 * - Single Responsibility (Principle #3) - only classification
 * - Small Functions < 20 lines (Principle #17)
 * - Define Errors Out of Existence (Principle #13) - TypeScript enums
 */

// ============================================================================
// TYPES
// ============================================================================

/**
 * Query types based on what's being searched
 */
export type QueryType =
  | 'booking_number'      // 2038256270, ABC123456
  | 'mbl_number'          // MAEU262822342, HLCU123456789
  | 'container_number'    // MRKU1234567
  | 'hbl_number'          // SE1225003104
  | 'port_code'           // INNSA, USNYC (5-letter UN/LOCODE)
  | 'port_name'           // "New York", "Mumbai"
  | 'party_name'          // Company names
  | 'email_address'       // user@domain.com
  | 'document_type'       // booking_confirmation, draft_bl
  | 'date_expression'     // "today", "this week", "2025-01-30"
  | 'conceptual'          // Free text, questions, concepts
  | 'unknown';

/**
 * Search strategy to use
 */
export type SearchStrategy = 'keyword' | 'semantic' | 'hybrid';

/**
 * Classified query result
 */
export interface ClassifiedQuery {
  originalQuery: string;
  normalizedQuery: string;
  queryType: QueryType;
  searchStrategy: SearchStrategy;
  confidence: number;  // 0-100 confidence in classification
  metadata: {
    isUpperCase?: boolean;
    hasDigits?: boolean;
    wordCount?: number;
    detectedPatterns?: string[];
  };
}

// ============================================================================
// KNOWN VALUES (for pattern matching)
// ============================================================================

/**
 * Known port codes (UN/LOCODE format)
 */
const KNOWN_PORT_CODES = new Set([
  // India
  'INNSA', 'INMUN', 'INPAV', 'INCHE', 'INKOL', 'INBOM', 'INDEL', 'INBLR',
  'INHYD', 'INMAA', 'INCCJ', 'INTUT', 'INKTP', 'INLUH', 'INGIT',
  // USA
  'USNYC', 'USLAX', 'USOAK', 'USSEA', 'USHOU', 'USSAV', 'USNEW', 'USBAL',
  'USMIA', 'USCHI', 'USATL', 'USEWK', 'USEWR', 'USLGB', 'USSFO', 'USCHS',
  // Asia
  'SGSIN', 'CNSHA', 'CNYTN', 'HKHKG', 'KRPUS', 'JPYOK', 'JPTYO', 'TWKHH',
  'VNSGN', 'VNHPH', 'THBKK', 'THLCH', 'MYPKG', 'MYPEN', 'IDTPP', 'IDJKT',
  // Europe
  'DEHAM', 'NLRTM', 'GBLES', 'BEANR', 'FRLEH', 'GBFXT', 'GBLGP', 'ITGOA',
  // Middle East
  'AEJEA', 'AEDXB', 'AEAUH', 'OMSLL', 'SAJED',
]);

/**
 * Known carrier MBL prefixes
 */
const MBL_PREFIXES = [
  'MAEU', 'MSKU', 'MRKU', 'MSCU',  // Maersk
  'HLCU', 'HLXU',                   // Hapag-Lloyd
  'CMDU', 'CMAU',                   // CMA CGM
  'OOLU', 'ONEY',                   // ONE/OOCL
  'COSU', 'CCLU',                   // COSCO
  'EGLV', 'EGHU',                   // Evergreen
  'YMLU', 'YMJA',                   // Yang Ming
  'ZIMU',                           // ZIM
  'MSMU', 'MEDU',                   // MSC
];

/**
 * Known document types
 */
const DOCUMENT_TYPES = new Set([
  'booking_confirmation', 'booking_amendment', 'booking_request',
  'shipping_instructions', 'si_confirmation', 'si_amendment',
  'vgm_confirmation', 'vgm_submission',
  'draft_bl', 'final_bl', 'house_bl', 'telex_release',
  'arrival_notice', 'delivery_order',
  'customs_entry', 'isf_filing',
  'invoice', 'commercial_invoice', 'freight_invoice',
  'packing_list', 'certificate_of_origin',
  'general_correspondence', 'internal_communication',
]);

/**
 * Port name aliases (for fuzzy matching)
 * Single words that are clearly port names
 */
const PORT_NAME_SINGLE_WORDS = new Set([
  'mumbai', 'chennai', 'kolkata', 'delhi', 'newark', 'houston',
  'savannah', 'charleston', 'miami', 'singapore', 'shanghai', 'busan',
  'tokyo', 'yokohama', 'hamburg', 'rotterdam', 'antwerp', 'mundra',
  'hazira', 'pipavav', 'kandla', 'tuticorin', 'cochin', 'vizag',
]);

/**
 * Port name aliases (for fuzzy matching in multi-word queries)
 */
const PORT_NAME_HINTS = [
  'port', 'harbor', 'terminal',
  'new york', 'los angeles', 'long beach',
  'nhava sheva', 'jnpt', 'jawaharlal nehru',
  'hong kong', 'ho chi minh',
];

/**
 * Conceptual/action phrases that indicate semantic search
 */
const CONCEPTUAL_INDICATORS = [
  'delayed', 'delay', 'late', 'urgent', 'problem', 'issue', 'missing',
  'pending', 'overdue', 'stuck', 'hold', 'customs', 'inspection',
  'angry', 'frustrated', 'complaint', 'escalation', 'help',
  'where is', 'what happened', 'show me', 'find', 'search',
  'similar', 'like', 'related', 'about',
  // Document type phrases (should be semantic, not party name)
  'confirmation', 'submission', 'notice', 'amendment', 'request',
  'invoice', 'draft', 'release', 'instruction', 'booking',
  'arrival', 'departure', 'vgm', 'sob', 'bl', 'bill of lading',
];

// ============================================================================
// CLASSIFIER IMPLEMENTATION
// ============================================================================

/**
 * Classify a search query to determine optimal search strategy
 */
export function classifyQuery(query: string): ClassifiedQuery {
  const original = query;
  const normalized = query.trim();
  const upper = normalized.toUpperCase();
  const lower = normalized.toLowerCase();
  const words = normalized.split(/\s+/);

  // Build metadata
  const metadata = {
    isUpperCase: normalized === upper && /[A-Z]/.test(normalized),
    hasDigits: /\d/.test(normalized),
    wordCount: words.length,
    detectedPatterns: [] as string[],
  };

  // Single word queries - likely identifiers
  if (words.length === 1) {
    // Container number: 4 letters + 7 digits (e.g., MRKU1234567)
    if (/^[A-Z]{4}\d{7}$/i.test(upper)) {
      metadata.detectedPatterns.push('container_format');
      return createResult(original, upper, 'container_number', 'keyword', 95, metadata);
    }

    // MBL number: Known carrier prefix + digits
    for (const prefix of MBL_PREFIXES) {
      if (upper.startsWith(prefix) && upper.length >= 10) {
        metadata.detectedPatterns.push(`mbl_prefix_${prefix}`);
        return createResult(original, upper, 'mbl_number', 'keyword', 95, metadata);
      }
    }

    // Port code: Known UN/LOCODE
    if (KNOWN_PORT_CODES.has(upper)) {
      metadata.detectedPatterns.push('known_port_code');
      return createResult(original, upper, 'port_code', 'keyword', 98, metadata);
    }

    // HBL number: SE + 10 digits (Intoglo format)
    if (/^SE\d{10}$/i.test(upper)) {
      metadata.detectedPatterns.push('hbl_format');
      return createResult(original, upper, 'hbl_number', 'keyword', 95, metadata);
    }

    // Booking number: Mostly digits (6-15 chars)
    if (/^\d{6,15}$/.test(normalized)) {
      metadata.detectedPatterns.push('numeric_booking');
      return createResult(original, normalized, 'booking_number', 'keyword', 90, metadata);
    }

    // Booking number: Letters + digits
    if (/^[A-Z]{0,4}\d{6,15}$/i.test(upper)) {
      metadata.detectedPatterns.push('alphanumeric_booking');
      return createResult(original, upper, 'booking_number', 'keyword', 85, metadata);
    }

    // Email address
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower)) {
      metadata.detectedPatterns.push('email_format');
      return createResult(original, lower, 'email_address', 'keyword', 95, metadata);
    }

    // Document type (exact match)
    if (DOCUMENT_TYPES.has(lower) || DOCUMENT_TYPES.has(lower.replace(/ /g, '_'))) {
      metadata.detectedPatterns.push('document_type');
      return createResult(original, lower.replace(/ /g, '_'), 'document_type', 'keyword', 95, metadata);
    }

    // Single word port name (e.g., "Newark", "Mumbai", "Hazira")
    if (PORT_NAME_SINGLE_WORDS.has(lower)) {
      metadata.detectedPatterns.push('port_name_single');
      return createResult(original, normalized, 'port_name', 'hybrid', 85, metadata);
    }

    // Single capitalized word - likely a company name
    if (/^[A-Z][a-z]+$/.test(normalized) || /^[A-Z]+$/.test(normalized)) {
      metadata.detectedPatterns.push('single_word_name');
      return createResult(original, normalized, 'party_name', 'hybrid', 70, metadata);
    }
  }

  // Multi-word queries
  if (words.length >= 2) {
    // FIRST: Check for conceptual indicators (document types, issues, etc.)
    // This must come before company name check to avoid "booking confirmation" → party_name
    for (const indicator of CONCEPTUAL_INDICATORS) {
      if (lower.includes(indicator)) {
        metadata.detectedPatterns.push(`conceptual_${indicator}`);
        return createResult(original, normalized, 'conceptual', 'semantic', 80, metadata);
      }
    }

    // Check for port name hints
    for (const hint of PORT_NAME_HINTS) {
      if (lower.includes(hint)) {
        metadata.detectedPatterns.push(`port_hint_${hint}`);
        return createResult(original, normalized, 'port_name', 'hybrid', 75, metadata);
      }
    }

    // Date expressions
    if (/today|tomorrow|yesterday|this week|last week|next week|\d{4}-\d{2}-\d{2}/i.test(lower)) {
      metadata.detectedPatterns.push('date_expression');
      return createResult(original, normalized, 'date_expression', 'keyword', 85, metadata);
    }

    // Company name patterns (2-4 words, may end with Inc/Ltd/Corp/LLC)
    // Only match if it looks like a formal company name with suffix
    if (/^[A-Z][a-zA-Z\s]+\s(Inc|Ltd|Corp|LLC|Co|Company|Limited|International|Industries|Enterprises)\.?$/i.test(normalized)) {
      metadata.detectedPatterns.push('company_name_format');
      return createResult(original, normalized, 'party_name', 'hybrid', 75, metadata);
    }

    // Short proper case phrases (2-3 words) that look like company names
    // e.g., "Marathon Brake", "KHOSLA PROFIL", "Trade Partners"
    // Match: either all caps or Title Case, 2-3 words
    if (words.length >= 2 && words.length <= 3) {
      const isAllCaps = /^[A-Z\s]+$/.test(normalized);
      const isTitleCase = words.every(w => /^[A-Z][a-zA-Z]*$/.test(w));

      if (isAllCaps || isTitleCase) {
        metadata.detectedPatterns.push('probable_company_name');
        return createResult(original, normalized, 'party_name', 'hybrid', 65, metadata);
      }
    }
  }

  // Default: Treat as conceptual (semantic search)
  metadata.detectedPatterns.push('default_conceptual');
  return createResult(original, normalized, 'conceptual', 'semantic', 60, metadata);
}

/**
 * Helper to create classified query result
 */
function createResult(
  original: string,
  normalized: string,
  queryType: QueryType,
  strategy: SearchStrategy,
  confidence: number,
  metadata: ClassifiedQuery['metadata']
): ClassifiedQuery {
  return {
    originalQuery: original,
    normalizedQuery: normalized,
    queryType,
    searchStrategy: strategy,
    confidence,
    metadata,
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Check if a query is an identifier (should use keyword-only search)
 */
export function isIdentifierQuery(query: string): boolean {
  const classified = classifyQuery(query);
  return ['booking_number', 'mbl_number', 'container_number', 'hbl_number', 'port_code'].includes(classified.queryType);
}

/**
 * Check if a query should use semantic search
 */
export function shouldUseSemanticSearch(query: string): boolean {
  const classified = classifyQuery(query);
  return classified.searchStrategy === 'semantic' || classified.searchStrategy === 'hybrid';
}

/**
 * Get search fields based on query type
 */
export function getSearchFields(queryType: QueryType): string[] {
  switch (queryType) {
    case 'booking_number':
      return ['booking_number'];
    case 'mbl_number':
      return ['mbl_number'];
    case 'container_number':
      return ['container_numbers'];
    case 'hbl_number':
      return ['hbl_number'];
    case 'port_code':
    case 'port_name':
      return ['pol_location', 'pod_location'];
    case 'party_name':
      return ['shipper_name', 'consignee_name', 'notify_party_name'];
    case 'email_address':
      return ['from_address'];
    case 'document_type':
      return ['document_type'];
    case 'conceptual':
      return ['subject', 'summary', 'body_preview'];
    default:
      return ['subject', 'summary'];
  }
}
