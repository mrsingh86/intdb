/**
 * Pattern Definitions for Regex-First Extraction
 *
 * Centralized pattern library with confidence scores for deterministic extraction.
 * Patterns are organized by carrier and field type for targeted matching.
 *
 * Principles:
 * - Configuration Over Code: Patterns defined as data, not hardcoded regex
 * - High Confidence First: Only extract when pattern confidence >= threshold
 * - Carrier Context: Use carrier-specific patterns for accuracy
 */

// ============================================================================
// Types
// ============================================================================

export interface PatternDefinition {
  pattern: RegExp;
  confidence: number;
  carrier?: string;
  description?: string;
  captureGroup?: number; // Which capture group to extract (default 1)
}

export interface DatePatternDefinition extends PatternDefinition {
  format: 'iso' | 'dmy' | 'mdy' | 'dmy_text' | 'mdy_text';
  hasTime?: boolean;
}

export interface CutoffKeywordDefinition {
  keywords: RegExp[];
  fieldName: 'si_cutoff' | 'vgm_cutoff' | 'cargo_cutoff' | 'gate_cutoff' | 'doc_cutoff' | 'port_cutoff';
  confidence: number;
}

// ============================================================================
// Booking Number Patterns (95%+ confidence)
// ============================================================================

export const BOOKING_NUMBER_PATTERNS: PatternDefinition[] = [
  // Maersk: 9-digit starting with 26
  {
    pattern: /\b(26\d{7})\b/g,
    confidence: 96,
    carrier: 'maersk',
    description: 'Maersk 9-digit booking (26xxxxxxx)',
  },
  // Hapag-Lloyd: HL- prefix with 8 digits
  {
    pattern: /\bHL-?(\d{8})\b/gi,
    confidence: 95,
    carrier: 'hapag-lloyd',
    description: 'Hapag-Lloyd HL-XXXXXXXX format',
  },
  // Hapag-Lloyd: HLCU prefix with 7-10 digits
  {
    pattern: /\b(HLCU\d{7,10})\b/gi,
    confidence: 93,
    carrier: 'hapag-lloyd',
    description: 'Hapag-Lloyd HLCU prefix',
  },
  // CMA CGM: CEI or AMC prefix with 7 digits
  {
    pattern: /\b(CEI\d{7})\b/gi,
    confidence: 94,
    carrier: 'cma-cgm',
    description: 'CMA CGM CEI prefix',
  },
  {
    pattern: /\b(AMC\d{7})\b/gi,
    confidence: 94,
    carrier: 'cma-cgm',
    description: 'CMA CGM AMC prefix',
  },
  {
    pattern: /\b(CAD\d{7})\b/gi,
    confidence: 94,
    carrier: 'cma-cgm',
    description: 'CMA CGM CAD prefix',
  },
  // COSCO: COSU prefix with 10 digits
  {
    pattern: /\b(COSU\d{10})\b/gi,
    confidence: 96,
    carrier: 'cosco',
    description: 'COSCO COSU prefix',
  },
  // MSC: Generic patterns (less specific)
  {
    pattern: /\bMSC[A-Z]{2}\d{6,8}\b/gi,
    confidence: 88,
    carrier: 'msc',
    description: 'MSC booking pattern',
  },
  // Generic 9-digit booking starting with 2 (excludes phone numbers)
  // Indian phone numbers start with 7, 8, 9 - exclude those
  // Also exclude if preceded by phone-related words or +91
  {
    pattern: /(?<!\+91[-\s]?)(?<!\+\d{1,2}[-\s]?)(?<!(?:phone|mobile|cell|tel|fax|contact)[-:\s]*)(?<![789])\b(2\d{8})\b/gi,
    confidence: 78,
    description: 'Generic 9-digit booking starting with 2',
  },
  // Generic 10-digit booking - require context to avoid phone numbers
  // Must be preceded by booking-related keywords
  {
    pattern: /(?:Booking|BKG|Ref(?:erence)?)\s*(?:#|No\.?|Number)?\s*:?\s*(\d{9,10})\b/gi,
    confidence: 75,
    description: 'Booking number with label',
    captureGroup: 1,
  },
];

// ============================================================================
// Container Number Patterns (ISO 6346)
// ============================================================================

export const CONTAINER_NUMBER_PATTERNS: PatternDefinition[] = [
  // ISO 6346: 4 letters + 7 digits (standard format)
  {
    pattern: /\b([A-Z]{4}\d{7})\b/g,
    confidence: 94,
    description: 'ISO 6346 container format',
  },
  // Common carrier prefixes for higher confidence
  {
    pattern: /\b(MAEU\d{7})\b/gi,
    confidence: 96,
    carrier: 'maersk',
    description: 'Maersk container',
  },
  {
    pattern: /\b(MSKU\d{7})\b/gi,
    confidence: 96,
    carrier: 'maersk',
    description: 'Maersk container (MSKU)',
  },
  {
    pattern: /\b(HLCU\d{7})\b/gi,
    confidence: 96,
    carrier: 'hapag-lloyd',
    description: 'Hapag-Lloyd container',
  },
  {
    pattern: /\b(HLXU\d{7})\b/gi,
    confidence: 96,
    carrier: 'hapag-lloyd',
    description: 'Hapag-Lloyd container (HLXU)',
  },
  {
    pattern: /\b(CMAU\d{7})\b/gi,
    confidence: 96,
    carrier: 'cma-cgm',
    description: 'CMA CGM container',
  },
  {
    pattern: /\b(COSU\d{7})\b/gi,
    confidence: 96,
    carrier: 'cosco',
    description: 'COSCO container',
  },
  {
    pattern: /\b(MSCU\d{7})\b/gi,
    confidence: 96,
    carrier: 'msc',
    description: 'MSC container',
  },
  {
    pattern: /\b(TCLU\d{7})\b/gi,
    confidence: 94,
    description: 'Common leasing container',
  },
  {
    pattern: /\b(TRLU\d{7})\b/gi,
    confidence: 94,
    description: 'Triton leasing container',
  },
];

// ============================================================================
// Bill of Lading Patterns
// ============================================================================

export const BL_NUMBER_PATTERNS: PatternDefinition[] = [
  // Intoglo House BL format: SE + 10 digits
  {
    pattern: /\b(SE\d{10,})\b/gi,
    confidence: 94,
    description: 'Intoglo HBL format',
  },
  // Carrier MBL patterns (carrier prefix + 9+ digits)
  {
    pattern: /\b(MAEU\d{9,})\b/gi,
    confidence: 92,
    carrier: 'maersk',
    description: 'Maersk MBL',
  },
  {
    pattern: /\b(HLCU\d{9,})\b/gi,
    confidence: 92,
    carrier: 'hapag-lloyd',
    description: 'Hapag-Lloyd MBL',
  },
  {
    pattern: /\b(COAU\d{9,})\b/gi,
    confidence: 92,
    carrier: 'cosco',
    description: 'COSCO MBL',
  },
  {
    pattern: /\b(CMAU\d{9,})\b/gi,
    confidence: 92,
    carrier: 'cma-cgm',
    description: 'CMA CGM MBL',
  },
  // BL with label - require alphanumeric 8+ chars
  {
    pattern: /B\/L\s*(?:#|No\.?|Number)?\s*:?\s*([A-Z0-9]{8,20})/gi,
    confidence: 82,
    description: 'BL with label',
    captureGroup: 1,
  },
  {
    pattern: /Bill\s+of\s+Lading\s*(?:#|No\.?|Number)?\s*:?\s*([A-Z0-9]{8,20})/gi,
    confidence: 85,
    description: 'Bill of Lading with label',
    captureGroup: 1,
  },
  // MBL/HBL specific labels
  {
    pattern: /(?:Master\s+)?(?:MBL|M\.B\.L)\s*(?:#|No\.?)?\s*:?\s*([A-Z0-9]{8,20})/gi,
    confidence: 88,
    description: 'Master BL with label',
    captureGroup: 1,
  },
  {
    pattern: /(?:House\s+)?(?:HBL|H\.B\.L)\s*(?:#|No\.?)?\s*:?\s*([A-Z0-9]{8,20})/gi,
    confidence: 88,
    description: 'House BL with label',
    captureGroup: 1,
  },
];

// ============================================================================
// Entry Number Patterns (US Customs)
// ============================================================================

export const ENTRY_NUMBER_PATTERNS: PatternDefinition[] = [
  // Standard US Customs entry format: XXX-XXXXXXX-X (11 digits with dashes)
  {
    pattern: /\b(\d{3}-\d{7}-\d)\b/g,
    confidence: 96,
    description: 'US Customs entry format',
  },
  // Alternative format: 9JW-XXXXXXXX (3 alphanumeric + 8 digits)
  {
    pattern: /\b([A-Z0-9]{3}-\d{8})\b/g,
    confidence: 90,
    description: 'Alternative entry format',
  },
  // Entry number with label - require alphanumeric format
  {
    pattern: /Entry\s*(?:#|No\.?|Number)?\s*:?\s*([A-Z0-9]{3}[-\s]?\d{7,8}[-\s]?\d?)\b/gi,
    confidence: 88,
    description: 'Entry with label',
    captureGroup: 1,
  },
  // Intoglo job reference format (common in their systems)
  {
    pattern: /\b(165-\d{7}-\d-\d{4})\b/g,
    confidence: 92,
    description: 'Intoglo entry format',
  },
];

// ============================================================================
// Date Patterns
// ============================================================================

export const DATE_PATTERNS: DatePatternDefinition[] = [
  // ISO format: YYYY-MM-DD (highest confidence)
  {
    pattern: /\b(20\d{2}-\d{2}-\d{2})\b/g,
    confidence: 96,
    format: 'iso',
    description: 'ISO date format',
  },
  // ISO with time: YYYY-MM-DD HH:MM
  {
    pattern: /\b(20\d{2}-\d{2}-\d{2})\s+(\d{2}:\d{2})\b/g,
    confidence: 96,
    format: 'iso',
    hasTime: true,
    description: 'ISO datetime format',
  },
  // DD-MMM-YYYY: 25-Dec-2025
  {
    pattern: /\b(\d{1,2})-([A-Za-z]{3})-(\d{4})\b/g,
    confidence: 92,
    format: 'dmy_text',
    description: 'DD-MMM-YYYY format',
  },
  // DD/MM/YYYY (European)
  {
    pattern: /\b(\d{2})\/(\d{2})\/(\d{4})\b/g,
    confidence: 85,
    format: 'dmy',
    description: 'DD/MM/YYYY European format',
  },
  // MM/DD/YYYY (American) - need context to disambiguate
  {
    pattern: /\b(\d{2})\/(\d{2})\/(\d{4})\b/g,
    confidence: 75,
    format: 'mdy',
    description: 'MM/DD/YYYY American format (needs carrier context)',
  },
  // DD-MM-YYYY
  {
    pattern: /\b(\d{2})-(\d{2})-(\d{4})\b/g,
    confidence: 82,
    format: 'dmy',
    description: 'DD-MM-YYYY format',
  },
  // MMM DD, YYYY: Dec 25, 2025
  {
    pattern: /\b([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})\b/g,
    confidence: 88,
    format: 'mdy_text',
    description: 'MMM DD, YYYY format',
  },
];

// ============================================================================
// Cutoff Keywords and Patterns
// ============================================================================

export const CUTOFF_KEYWORDS: CutoffKeywordDefinition[] = [
  {
    keywords: [
      /SI[\s-]?(?:cut[-\s]?off|closing|deadline)/gi,
      /Shipping\s+Instruction[\s-]?(?:cut[-\s]?off|closing|deadline)/gi,
      /Documentation[\s-]?(?:cut[-\s]?off|closing|deadline)/gi,
      /Doc[\s-]?(?:cut[-\s]?off|closing)/gi,
    ],
    fieldName: 'si_cutoff',
    confidence: 88,
  },
  {
    keywords: [
      /VGM[\s-]?(?:cut[-\s]?off|closing|deadline|submission)/gi,
      /Verified\s+Gross\s+Mass[\s-]?(?:cut[-\s]?off|deadline)/gi,
    ],
    fieldName: 'vgm_cutoff',
    confidence: 90,
  },
  {
    keywords: [
      /Cargo[\s-]?(?:cut[-\s]?off|closing|deadline)/gi,
      /CY[\s-]?(?:cut[-\s]?off|closing)/gi,
      /FCL[\s-]?(?:cut[-\s]?off|delivery)/gi,
      /Container[\s-]?(?:Yard|receiving)[\s-]?(?:cut[-\s]?off|closing)/gi,
    ],
    fieldName: 'cargo_cutoff',
    confidence: 88,
  },
  {
    keywords: [
      /Gate[\s-]?(?:cut[-\s]?off|closing|in)/gi,
      /Terminal[\s-]?Gate[\s-]?(?:cut[-\s]?off|closing)/gi,
    ],
    fieldName: 'gate_cutoff',
    confidence: 85,
  },
  {
    keywords: [
      /Port[\s-]?(?:cut[-\s]?off|closing)/gi,
      /Terminal[\s-]?(?:cut[-\s]?off|closing)/gi,
    ],
    fieldName: 'port_cutoff',
    confidence: 82,
  },
];

// ============================================================================
// Port Patterns
// ============================================================================

export const PORT_PATTERNS: PatternDefinition[] = [
  // UN/LOCODE format: 5 characters (2 country + 3 location)
  {
    pattern: /\b([A-Z]{2}[A-Z0-9]{3})\b/g,
    confidence: 75,
    description: 'UN/LOCODE format',
  },
  // Common Indian ports
  {
    pattern: /\b(INMUN|INPAV|INNSA|INMAA|INHZA)\b/gi,
    confidence: 95,
    description: 'Indian port codes',
  },
  // Common US ports
  {
    pattern: /\b(USHOU|USEWR|USLAX|USLGB|USCHS|USSAV|USNYC)\b/gi,
    confidence: 95,
    description: 'US port codes',
  },
  // Port name patterns with context - require proper word (3+ chars, start with capital)
  {
    pattern: /Port\s+of\s+Loading\s*:?\s*([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]*)*)/gi,
    confidence: 88,
    description: 'POL with label',
    captureGroup: 1,
  },
  {
    pattern: /Port\s+of\s+Discharge\s*:?\s*([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]*)*)/gi,
    confidence: 88,
    description: 'POD with label',
    captureGroup: 1,
  },
  // POL/POD abbreviations - require proper location name (minimum 3 chars)
  {
    pattern: /POL\s*:?\s*([A-Z][A-Za-z]{2,}(?:\s+[A-Z][A-Za-z]*)*)/gi,
    confidence: 82,
    description: 'POL abbreviation',
    captureGroup: 1,
  },
  {
    pattern: /POD\s*:?\s*([A-Z][A-Za-z]{2,}(?:\s+[A-Z][A-Za-z]*)*)/gi,
    confidence: 82,
    description: 'POD abbreviation',
    captureGroup: 1,
  },
  // Common port names (direct matching for accuracy)
  {
    pattern: /\b(Mumbai|Nhava Sheva|JNPT|Chennai|Mundra|Hazira|New York|Los Angeles|Long Beach|Houston|Savannah|Newark|Seattle|Oakland)\b/gi,
    confidence: 92,
    description: 'Common port names',
  },
];

// ============================================================================
// Vessel & Voyage Patterns
// ============================================================================

export const VESSEL_PATTERNS: PatternDefinition[] = [
  // Vessel name with context keywords
  {
    pattern: /(?:M\/V|MV|Vessel)\s*:?\s*([A-Z][A-Za-z\s]+?)(?:\s+V\.|,|\s+\d)/gi,
    confidence: 88,
    description: 'Vessel with prefix',
    captureGroup: 1,
  },
  {
    pattern: /Vessel\s+Name\s*:?\s*([A-Za-z\s]+)/gi,
    confidence: 90,
    description: 'Vessel Name label',
    captureGroup: 1,
  },
];

export const VOYAGE_PATTERNS: PatternDefinition[] = [
  // Voyage number with clear label - must contain at least one digit
  {
    pattern: /(?:Voyage|Voy\.?)\s*(?:#|No\.?|Number)?\s*:?\s*([A-Z0-9]*\d[A-Z0-9]{2,14})\b/gi,
    confidence: 90,
    description: 'Voyage with label',
    captureGroup: 1,
  },
  // Common voyage formats: 3-4 digits + direction (123E, 456W)
  {
    pattern: /\b(\d{3,4}[ENSW])\b/g,
    confidence: 92,
    description: 'Numeric voyage with direction',
  },
  // Alphanumeric voyage like MA449E, 0TP47E1MA (must have digits)
  {
    pattern: /\b([A-Z]{2}\d{2,4}[ENSW])\b/g,
    confidence: 90,
    description: 'Alpha-numeric voyage format',
  },
  // Service code + voyage: e.g., AE7/449E
  {
    pattern: /\b([A-Z]{2}\d\/\d{3}[ENSW])\b/g,
    confidence: 94,
    description: 'Service/voyage format',
  },
  // Voyage with V prefix: V.449E or V449E
  {
    pattern: /\bV\.?\s?(\d{3,4}[ENSW]?)\b/g,
    confidence: 88,
    description: 'V prefix voyage',
    captureGroup: 1,
  },
];

// ============================================================================
// Carrier Detection Patterns (for context)
// ============================================================================

export const CARRIER_DETECTION_PATTERNS: Record<string, RegExp[]> = {
  'maersk': [
    /maersk\.com/gi,
    /\bMaersk\b/gi,
    /\bMAEU\b/gi,
    /\bMSKU\b/gi,
    /\bSealand\b/gi,
  ],
  'hapag-lloyd': [
    /hapag-?lloyd/gi,
    /hlag\.com/gi,
    /\bHLCU\b/gi,
    /\bHLXU\b/gi,
    /\bHL-\d+/gi,
  ],
  'cma-cgm': [
    /cma-?cgm/gi,
    /\bCMAU\b/gi,
    /\bAPL\b/gi,
    /\bANL\b/gi,
  ],
  'msc': [
    /\bMSC\b/g,
    /\bMSCU\b/gi,
    /\bMEDU\b/gi,
  ],
  'cosco': [
    /cosco/gi,
    /\bCOSU\b/gi,
    /\bOOCL\b/gi,
  ],
  'evergreen': [
    /evergreen/gi,
    /\bEGLV\b/gi,
    /\bEGHU\b/gi,
  ],
  'one': [
    /ocean\s*network\s*express/gi,
    /\bONE\b/g,
    /\bONEY\b/gi,
  ],
  'yang-ming': [
    /yang[-\s]?ming/gi,
    /\bYMLU\b/gi,
  ],
};

// ============================================================================
// Confidence Thresholds
// ============================================================================

export const CONFIDENCE_THRESHOLDS = {
  HIGH: 90,           // Use directly, no AI validation needed
  MEDIUM_HIGH: 85,    // Reliable, minimal AI validation
  MEDIUM: 75,         // Needs AI validation for confirmation
  LOW: 65,            // Needs AI to fill gaps
  REJECT: 50,         // Too unreliable, mark for manual review
} as const;

// ============================================================================
// Field Priority (for selective AI validation)
// ============================================================================

export const CRITICAL_FIELDS = [
  'booking_number',
  'bl_number',
  'container_number',
  'port_of_loading',
  'port_of_discharge',
  'etd',
  'eta',
] as const;

export const IMPORTANT_FIELDS = [
  'vessel_name',
  'voyage_number',
  'si_cutoff',
  'vgm_cutoff',
  'cargo_cutoff',
  'carrier',
] as const;

export const OPTIONAL_FIELDS = [
  'shipper_name',
  'consignee_name',
  'notify_party',
  'commodity_description',
  'incoterms',
] as const;

// ============================================================================
// IT Number Patterns (US Customs In-Transit)
// ============================================================================

export const IT_NUMBER_PATTERNS: PatternDefinition[] = [
  // Standard IT format: V-XXX-XXXXXXX-X or IT-XXX-XXXXXXX-X
  {
    pattern: /\b(?:IT|T&E|IE|TE)[-\s]?(\d{3}[-\s]?\d{7}[-\s]?\d)\b/gi,
    confidence: 92,
    description: 'IT number with prefix',
    captureGroup: 1,
  },
  // IT number with label
  {
    pattern: /(?:IT|In[-\s]?Transit|I\.T\.|Immediate\s+Transportation)\s*(?:#|No\.?|Number)?\s*:?\s*(\d{3}[-\s]?\d{7}[-\s]?\d)/gi,
    confidence: 90,
    description: 'IT with label',
    captureGroup: 1,
  },
  // T&E (Transportation & Exportation) format
  {
    pattern: /T&E\s*(?:#|No\.?)?\s*:?\s*(\d{3}[-\s]?\d{7}[-\s]?\d)/gi,
    confidence: 88,
    description: 'T&E number',
    captureGroup: 1,
  },
];

// ============================================================================
// ISF Number Patterns (Importer Security Filing / 10+2)
// ============================================================================

export const ISF_NUMBER_PATTERNS: PatternDefinition[] = [
  // ISF with label
  {
    pattern: /ISF\s*(?:#|No\.?|Number|Transaction)?\s*:?\s*([A-Z0-9]{10,20})/gi,
    confidence: 88,
    description: 'ISF with label',
    captureGroup: 1,
  },
  // 10+2 filing reference
  {
    pattern: /(?:10\+2|10\s*\+\s*2)\s*(?:#|No\.?|Filing)?\s*:?\s*([A-Z0-9]{10,20})/gi,
    confidence: 85,
    description: '10+2 filing number',
    captureGroup: 1,
  },
  // ISF Transaction Number format (often starts with ISF or numeric)
  {
    pattern: /\b(ISF\d{12,18})\b/gi,
    confidence: 90,
    description: 'ISF transaction format',
  },
];

// ============================================================================
// AMS Number Patterns (Automated Manifest System)
// ============================================================================

export const AMS_NUMBER_PATTERNS: PatternDefinition[] = [
  // AMS with label
  {
    pattern: /AMS\s*(?:#|No\.?|Number)?\s*:?\s*([A-Z0-9]{8,15})/gi,
    confidence: 85,
    description: 'AMS with label',
    captureGroup: 1,
  },
  // AMS Bill number format
  {
    pattern: /AMS\s+Bill\s*(?:#|No\.?)?\s*:?\s*([A-Z0-9]{10,20})/gi,
    confidence: 88,
    description: 'AMS Bill number',
    captureGroup: 1,
  },
];

// ============================================================================
// HS Code Patterns (Harmonized System)
// ============================================================================

export const HS_CODE_PATTERNS: PatternDefinition[] = [
  // HS Code with label (6-10 digits, often with dots)
  {
    pattern: /(?:HS|HTS|Tariff)\s*(?:Code|#|No\.?)?\s*:?\s*(\d{4}[\.\s]?\d{2}(?:[\.\s]?\d{2,4})?)/gi,
    confidence: 90,
    description: 'HS code with label',
    captureGroup: 1,
  },
  // HTS format: XXXX.XX.XXXX
  {
    pattern: /\b(\d{4}\.\d{2}\.\d{4})\b/g,
    confidence: 92,
    description: 'HTS 10-digit format',
  },
  // HS 6-digit: XXXX.XX
  {
    pattern: /\b(\d{4}\.\d{2})\b/g,
    confidence: 78,
    description: 'HS 6-digit format',
  },
];

// ============================================================================
// Seal Number Patterns
// ============================================================================

export const SEAL_NUMBER_PATTERNS: PatternDefinition[] = [
  // Seal with explicit label (highest confidence)
  {
    pattern: /Seal\s*(?:#|No\.?|Number)?\s*:?\s*([A-Z0-9]{6,12})\b/gi,
    confidence: 94,
    description: 'Seal with label',
    captureGroup: 1,
  },
  // Carrier-specific seal patterns
  {
    pattern: /\b(ML\d{7,10})\b/gi,
    confidence: 90,
    carrier: 'maersk',
    description: 'Maersk seal format',
  },
  // Common seal prefixes (exclude container/BL prefixes)
  // Seals typically start with specific prefixes: ML, SL, CN, ISO
  // Exclude MAEU, MSKU, HLCU, COSU, etc (containers)
  {
    pattern: /\b(?:SL|CN|ISO|HS)\d{6,10}\b/gi,
    confidence: 85,
    description: 'Standard seal prefixes',
  },
  // Numeric-only seal with context (7+ digits)
  {
    pattern: /(?:Seal|Sealing)\s*[:=]?\s*(\d{7,12})\b/gi,
    confidence: 88,
    description: 'Numeric seal with context',
    captureGroup: 1,
  },
];

// ============================================================================
// Weight Patterns (Gross, Net, Tare, VGM)
// ============================================================================

export interface WeightPatternDefinition extends PatternDefinition {
  weightType: 'gross' | 'net' | 'tare' | 'vgm' | 'cargo';
  unit: 'kg' | 'lbs' | 'mt';
}

export const WEIGHT_PATTERNS: WeightPatternDefinition[] = [
  // Gross Weight
  {
    pattern: /Gross\s*(?:Weight|Wt\.?)?\s*:?\s*([\d,\.]+)\s*(?:KG|KGS|Kgs)/gi,
    confidence: 92,
    description: 'Gross weight in KG',
    weightType: 'gross',
    unit: 'kg',
    captureGroup: 1,
  },
  {
    pattern: /G\.?W\.?\s*:?\s*([\d,\.]+)\s*(?:KG|KGS)/gi,
    confidence: 85,
    description: 'GW abbreviation',
    weightType: 'gross',
    unit: 'kg',
    captureGroup: 1,
  },
  // Net Weight
  {
    pattern: /Net\s*(?:Weight|Wt\.?)?\s*:?\s*([\d,\.]+)\s*(?:KG|KGS|Kgs)/gi,
    confidence: 92,
    description: 'Net weight in KG',
    weightType: 'net',
    unit: 'kg',
    captureGroup: 1,
  },
  {
    pattern: /N\.?W\.?\s*:?\s*([\d,\.]+)\s*(?:KG|KGS)/gi,
    confidence: 85,
    description: 'NW abbreviation',
    weightType: 'net',
    unit: 'kg',
    captureGroup: 1,
  },
  // Tare Weight
  {
    pattern: /Tare\s*(?:Weight|Wt\.?)?\s*:?\s*([\d,\.]+)\s*(?:KG|KGS|Kgs)/gi,
    confidence: 90,
    description: 'Tare weight',
    weightType: 'tare',
    unit: 'kg',
    captureGroup: 1,
  },
  // VGM (Verified Gross Mass)
  {
    pattern: /VGM\s*(?:Weight)?\s*:?\s*([\d,\.]+)\s*(?:KG|KGS|Kgs|MT)/gi,
    confidence: 94,
    description: 'VGM weight',
    weightType: 'vgm',
    unit: 'kg',
    captureGroup: 1,
  },
  {
    pattern: /Verified\s+Gross\s+Mass\s*:?\s*([\d,\.]+)\s*(?:KG|KGS|MT)/gi,
    confidence: 94,
    description: 'Verified Gross Mass',
    weightType: 'vgm',
    unit: 'kg',
    captureGroup: 1,
  },
  // Cargo Weight
  {
    pattern: /Cargo\s*(?:Weight|Wt\.?)?\s*:?\s*([\d,\.]+)\s*(?:KG|KGS|Kgs)/gi,
    confidence: 88,
    description: 'Cargo weight',
    weightType: 'cargo',
    unit: 'kg',
    captureGroup: 1,
  },
  // Metric Tons
  {
    pattern: /(?:Weight|Wt\.?)\s*:?\s*([\d,\.]+)\s*(?:MT|M\.T\.|Metric\s+Tons?)/gi,
    confidence: 88,
    description: 'Weight in MT',
    weightType: 'gross',
    unit: 'mt',
    captureGroup: 1,
  },
  // Pounds
  {
    pattern: /(?:Weight|Wt\.?)\s*:?\s*([\d,\.]+)\s*(?:LBS?|Lbs?|Pounds?)/gi,
    confidence: 85,
    description: 'Weight in LBS',
    weightType: 'gross',
    unit: 'lbs',
    captureGroup: 1,
  },
];

// ============================================================================
// Volume/Measurement Patterns (CBM)
// ============================================================================

export const VOLUME_PATTERNS: PatternDefinition[] = [
  // CBM with label
  {
    pattern: /(?:Volume|Measurement|CBM|Cubic\s+Meters?)\s*:?\s*([\d,\.]+)\s*(?:CBM|M3|M³)?/gi,
    confidence: 90,
    description: 'Volume in CBM',
    captureGroup: 1,
  },
  // Meas. abbreviation
  {
    pattern: /Meas\.?\s*:?\s*([\d,\.]+)\s*(?:CBM|M3)/gi,
    confidence: 85,
    description: 'Measurement abbreviation',
    captureGroup: 1,
  },
];

// ============================================================================
// Package Patterns (Count & Type)
// ============================================================================

export const PACKAGE_PATTERNS: PatternDefinition[] = [
  // Package count with type
  {
    pattern: /(\d+)\s*(?:X\s*)?(CTNS?|Cartons?|PLTS?|Pallets?|PKGS?|Packages?|PCS|Pieces?|Drums?|Bags?|Bales?|Boxes?)/gi,
    confidence: 88,
    description: 'Package count with type',
    captureGroup: 1,
  },
  // No. of Packages
  {
    pattern: /(?:No\.?\s*of\s*)?(?:Packages?|Pkgs?|Pieces?|Pcs)\s*:?\s*(\d+)/gi,
    confidence: 85,
    description: 'Number of packages',
    captureGroup: 1,
  },
  // Total packages
  {
    pattern: /Total\s*(?:Packages?|Pkgs?|Pieces?|Pcs|Quantity|Qty)\s*:?\s*(\d+)/gi,
    confidence: 88,
    description: 'Total packages',
    captureGroup: 1,
  },
];

// ============================================================================
// Container Type Patterns
// ============================================================================

export const CONTAINER_TYPE_PATTERNS: PatternDefinition[] = [
  // Standard container types
  {
    pattern: /\b(20'?\s*(?:GP|DC|DV|ST|OT|FR|RF|RH|HC)?)\b/gi,
    confidence: 88,
    description: '20ft container',
  },
  {
    pattern: /\b(40'?\s*(?:GP|DC|DV|ST|OT|FR|RF|RH|HC|HQ)?)\b/gi,
    confidence: 88,
    description: '40ft container',
  },
  {
    pattern: /\b(45'?\s*(?:GP|HC|HQ)?)\b/gi,
    confidence: 88,
    description: '45ft container',
  },
  // Explicit type codes
  {
    pattern: /\b(20DC|20GP|20RF|20OT|40DC|40GP|40HC|40HQ|40RF|40OT|45HC|45HQ)\b/gi,
    confidence: 95,
    description: 'Container type code',
  },
  // With x notation: 1x40HC
  {
    pattern: /(\d+)\s*[xX]\s*(20DC|20GP|40DC|40GP|40HC|40HQ|40RF|45HC)/gi,
    confidence: 92,
    description: 'Container count x type',
  },
];

// ============================================================================
// Free Time & Demurrage Date Patterns
// ============================================================================

export interface DemurrageDateKeyword {
  keywords: RegExp[];
  fieldName: 'last_free_day' | 'free_time_expiry' | 'cargo_available_date' | 'empty_return_date' | 'demurrage_start' | 'detention_start';
  confidence: number;
}

export const DEMURRAGE_DATE_KEYWORDS: DemurrageDateKeyword[] = [
  {
    keywords: [
      /(?:Last\s+Free\s+Day|LFD)\s*:?\s*/gi,
      /Free\s+Time\s+(?:Expires?|Ends?|Until)\s*:?\s*/gi,
    ],
    fieldName: 'last_free_day',
    confidence: 92,
  },
  {
    keywords: [
      /(?:Cargo|Container)\s+Available\s*(?:Date)?\s*:?\s*/gi,
      /Available\s+(?:for\s+)?(?:Pickup|Delivery)\s*:?\s*/gi,
      /Ready\s+(?:for\s+)?(?:Pickup|Delivery)\s*:?\s*/gi,
    ],
    fieldName: 'cargo_available_date',
    confidence: 88,
  },
  {
    keywords: [
      /Empty\s+Return\s*(?:Date|By|Deadline)?\s*:?\s*/gi,
      /Return\s+Empty\s*(?:By|Before)?\s*:?\s*/gi,
      /Equipment\s+Return\s*:?\s*/gi,
    ],
    fieldName: 'empty_return_date',
    confidence: 85,
  },
  {
    keywords: [
      /Demurrage\s+(?:Starts?|Begins?|From)\s*:?\s*/gi,
      /Demurrage\s+Effective\s*:?\s*/gi,
    ],
    fieldName: 'demurrage_start',
    confidence: 85,
  },
  {
    keywords: [
      /Detention\s+(?:Starts?|Begins?|From)\s*:?\s*/gi,
      /Detention\s+Effective\s*:?\s*/gi,
    ],
    fieldName: 'detention_start',
    confidence: 85,
  },
];

// ============================================================================
// Free Time Days Pattern
// ============================================================================

export const FREE_TIME_PATTERNS: PatternDefinition[] = [
  // Free time in days
  {
    pattern: /(?:Free\s+Time|Free\s+Days?)\s*:?\s*(\d+)\s*(?:days?|calendar\s+days?)?/gi,
    confidence: 90,
    description: 'Free time days',
    captureGroup: 1,
  },
  // X days free
  {
    pattern: /(\d+)\s*(?:calendar\s+)?days?\s+(?:free|of\s+free\s+time)/gi,
    confidence: 88,
    description: 'Days free pattern',
    captureGroup: 1,
  },
];

// ============================================================================
// Appointment Patterns
// ============================================================================

export const APPOINTMENT_PATTERNS: PatternDefinition[] = [
  // Appointment number - must contain at least one digit
  {
    pattern: /(?:Appointment|Appt\.?)\s*(?:#|No\.?|Number|ID)?\s*:?\s*([A-Z]*\d[A-Z0-9]{5,14})\b/gi,
    confidence: 88,
    description: 'Appointment number',
    captureGroup: 1,
  },
  // Delivery appointment - must contain digits
  {
    pattern: /(?:Delivery|Pickup|Gate)\s+Appointment\s*:?\s*([A-Z]*\d[A-Z0-9]{5,14})\b/gi,
    confidence: 85,
    description: 'Delivery appointment',
    captureGroup: 1,
  },
  // TIR/PARS number (Canada) - specific format
  {
    pattern: /(?:TIR|PARS)\s*(?:#|No\.?)?\s*:?\s*(\d{10,15})\b/gi,
    confidence: 88,
    description: 'TIR/PARS number',
    captureGroup: 1,
  },
  // Terminal appointment code format (often alphanumeric)
  {
    pattern: /(?:Terminal\s+)?(?:Appt|Appointment)\s+Code\s*:?\s*([A-Z0-9]{8,15})\b/gi,
    confidence: 90,
    description: 'Terminal appointment code',
    captureGroup: 1,
  },
];

// ============================================================================
// Inland Location Patterns
// ============================================================================

export const INLAND_LOCATION_PATTERNS: PatternDefinition[] = [
  // IPI destination - require proper city name (3+ chars starting with capital)
  {
    pattern: /(?:IPI|Inland\s+Point|Interior\s+Point)\s*:?\s*([A-Z][a-z]{2,}(?:[\s,]+[A-Z][a-z]*)*)/gi,
    confidence: 85,
    description: 'IPI destination',
    captureGroup: 1,
  },
  // Ramp/Rail destination - require proper city name
  {
    pattern: /(?:Ramp|Rail\s+Ramp|Intermodal)\s*(?:Destination|Location)?\s*:?\s*([A-Z][a-z]{2,}(?:[\s,]+[A-Z][a-z]*)*)/gi,
    confidence: 82,
    description: 'Ramp location',
    captureGroup: 1,
  },
  // Final destination - require proper city name
  {
    pattern: /(?:Final|Ultimate)\s+Destination\s*:?\s*([A-Z][a-z]{2,}(?:[\s,]+[A-Z][a-z]*)*)/gi,
    confidence: 85,
    description: 'Final destination',
    captureGroup: 1,
  },
  // CFS/Warehouse location
  {
    pattern: /(?:CFS|Warehouse|Depot)\s*(?:Location|Address)?\s*:?\s*([A-Z][A-Za-z0-9\s,]{5,}?)(?:\s*[-–|]|\s*\n|$)/gi,
    confidence: 80,
    description: 'CFS/Warehouse location',
    captureGroup: 1,
  },
  // Common US inland destinations (direct match)
  {
    pattern: /\b(Detroit|Chicago|Memphis|Atlanta|Dallas|Columbus|Louisville|Kansas City|Indianapolis|Cincinnati|St\.\s*Louis)\b/gi,
    confidence: 90,
    description: 'Common US inland cities',
  },
];

// ============================================================================
// Temperature Patterns (Reefer)
// ============================================================================

export const TEMPERATURE_PATTERNS: PatternDefinition[] = [
  // Temperature setting in Celsius
  {
    pattern: /(?:Temp(?:erature)?|Set\s+Point)\s*:?\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*[Cc]/gi,
    confidence: 92,
    description: 'Temperature in Celsius',
    captureGroup: 1,
  },
  // Temperature in Fahrenheit
  {
    pattern: /(?:Temp(?:erature)?|Set\s+Point)\s*:?\s*([+-]?\d+(?:\.\d+)?)\s*°?\s*[Ff]/gi,
    confidence: 90,
    description: 'Temperature in Fahrenheit',
    captureGroup: 1,
  },
  // Frozen/Chilled indicators
  {
    pattern: /\b(Frozen|Chilled|Ambient|Fresh)\b/gi,
    confidence: 75,
    description: 'Temperature type indicator',
  },
];

// ============================================================================
// Incoterms Patterns
// ============================================================================

export const INCOTERMS_PATTERNS: PatternDefinition[] = [
  // Standard Incoterms 2020
  {
    pattern: /\b(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)\b/g,
    confidence: 92,
    description: 'Incoterms 2020',
  },
  // Incoterms with label
  {
    pattern: /(?:Incoterms?|Terms?)\s*:?\s*(EXW|FCA|FAS|FOB|CFR|CIF|CPT|CIP|DAP|DPU|DDP)/gi,
    confidence: 95,
    description: 'Incoterms with label',
    captureGroup: 1,
  },
];

// ============================================================================
// Currency & Amount Patterns
// ============================================================================

export interface AmountPatternDefinition extends PatternDefinition {
  amountType?: 'freight' | 'duty' | 'demurrage' | 'detention' | 'total' | 'invoice';
}

export const AMOUNT_PATTERNS: AmountPatternDefinition[] = [
  // USD amount
  {
    pattern: /(?:USD|US\$|\$)\s*([\d,]+(?:\.\d{2})?)/gi,
    confidence: 88,
    description: 'USD amount',
    captureGroup: 1,
  },
  // EUR amount
  {
    pattern: /(?:EUR|€)\s*([\d,]+(?:\.\d{2})?)/gi,
    confidence: 88,
    description: 'EUR amount',
    captureGroup: 1,
  },
  // INR amount
  {
    pattern: /(?:INR|₹|Rs\.?)\s*([\d,]+(?:\.\d{2})?)/gi,
    confidence: 88,
    description: 'INR amount',
    captureGroup: 1,
  },
  // Freight amount
  {
    pattern: /(?:Ocean\s+)?Freight\s*(?:Charges?)?\s*:?\s*(?:USD|US\$|\$|EUR|€)?\s*([\d,]+(?:\.\d{2})?)/gi,
    confidence: 90,
    description: 'Freight amount',
    amountType: 'freight',
    captureGroup: 1,
  },
  // Demurrage amount
  {
    pattern: /Demurrage\s*(?:Charges?)?\s*:?\s*(?:USD|US\$|\$|EUR|€)?\s*([\d,]+(?:\.\d{2})?)/gi,
    confidence: 90,
    description: 'Demurrage amount',
    amountType: 'demurrage',
    captureGroup: 1,
  },
  // Detention amount
  {
    pattern: /Detention\s*(?:Charges?)?\s*:?\s*(?:USD|US\$|\$|EUR|€)?\s*([\d,]+(?:\.\d{2})?)/gi,
    confidence: 90,
    description: 'Detention amount',
    amountType: 'detention',
    captureGroup: 1,
  },
  // Total amount
  {
    pattern: /(?:Total|Grand\s+Total|Amount\s+Due)\s*:?\s*(?:USD|US\$|\$|EUR|€)?\s*([\d,]+(?:\.\d{2})?)/gi,
    confidence: 88,
    description: 'Total amount',
    amountType: 'total',
    captureGroup: 1,
  },
];

// ============================================================================
// PO/Reference Number Patterns
// ============================================================================

export const REFERENCE_NUMBER_PATTERNS: PatternDefinition[] = [
  // PO Number
  {
    pattern: /(?:P\.?O\.?|Purchase\s+Order)\s*(?:#|No\.?|Number)?\s*:?\s*([A-Z0-9-]{5,20})/gi,
    confidence: 88,
    description: 'PO number',
    captureGroup: 1,
  },
  // Customer Reference
  {
    pattern: /(?:Customer|Cust\.?|Your)\s*(?:Ref(?:erence)?|#|No\.?)\s*:?\s*([A-Z0-9-]{5,20})/gi,
    confidence: 85,
    description: 'Customer reference',
    captureGroup: 1,
  },
  // Job/File Number
  {
    pattern: /(?:Job|File|Shipment)\s*(?:#|No\.?|Number|Ref(?:erence)?)\s*:?\s*([A-Z0-9-]{5,20})/gi,
    confidence: 85,
    description: 'Job/File number',
    captureGroup: 1,
  },
  // Invoice Number
  {
    pattern: /(?:Invoice|Inv\.?)\s*(?:#|No\.?|Number)?\s*:?\s*([A-Z0-9-]{5,20})/gi,
    confidence: 88,
    description: 'Invoice number',
    captureGroup: 1,
  },
];

// ============================================================================
// Sender Category Detection Patterns
// ============================================================================

export const SENDER_CATEGORY_PATTERNS: Record<string, RegExp[]> = {
  'maersk': [
    /maersk\.com$/i,
    /@maersk\./i,
    /sealandmaersk\.com$/i,
    /sealand\.com$/i,
  ],
  'hapag': [
    /hapag-lloyd\.com$/i,
    /hlag\.com$/i,
    /service\.hlag\.com$/i,
    /@hlag\./i,
    /hapag\.com$/i,
  ],
  'cma_cgm': [
    /cma-cgm\.com$/i,
    /@apl\.com$/i,
    /@anl\.com\.au$/i,
    /cma-cgm/i,
  ],
  'msc': [
    /msc\.com$/i,
    /@msc\./i,
    /medlog\.com$/i,
  ],
  'cosco': [
    /cosco\.com$/i,
    /coscoshipping\.com$/i,
    /coscon\.com$/i,
    /@oocl\.com$/i,
    /oocl\.com$/i,
  ],
  'one_line': [
    /one-line\.com$/i,
    /@one-line\./i,
    /ocean-network-express/i,
  ],
  'evergreen': [
    /evergreen-marine\.com$/i,
    /evergreen-line\.com$/i,
    /evergreen-shipping/i,
  ],
  'yang_ming': [
    /yangming\.com$/i,
    /@yml\./i,
    /yangming/i,
  ],
  'customs_broker': [
    /abordeaux\.com$/i,
    /expeditors\.com$/i,
    /chrobinson\.com$/i,
    /dhl\.com$/i,
    /ups\.com$/i,
    /fedex\.com$/i,
    /customs/i,
    /broker/i,
  ],
  'freight_forwarder': [
    /intoglo\.com$/i,
    /flexport\.com$/i,
    /kuehne-nagel\.com$/i,
    /dbschenker\.com$/i,
    /freight/i,
    /logistics/i,
    /forwarder/i,
  ],
  'terminal': [
    /apm-terminals\.com$/i,
    /dpworld\.com$/i,
    /pfrpier\.com$/i,
    /wbct\.com$/i,
    /terminal/i,
    /port\s+of/i,
  ],
  'trucking': [
    /jbhunt\.com$/i,
    /schneider\.com$/i,
    /xpo\.com$/i,
    /trucking/i,
    /drayage/i,
    /transport/i,
  ],
  'rail': [
    /bnsf\.com$/i,
    /up\.com$/i,
    /csx\.com$/i,
    /ns\.com$/i,
    /rail/i,
    /intermodal/i,
  ],
};
