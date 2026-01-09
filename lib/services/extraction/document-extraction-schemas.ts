/**
 * Document Extraction Schemas
 *
 * Defines extraction rules for each document type based on real document samples.
 * Each schema specifies:
 * - Required and optional fields
 * - Section markers for locating data
 * - Label patterns for field extraction
 * - Table extraction rules
 *
 * Based on analysis of actual documents from:
 * - Hapag-Lloyd BL drafts
 * - ONE Arrival Notices
 * - COSCO Freight Invoices
 * - Commercial Invoices
 * - Packing Lists
 * - CBP Entry Summaries
 * - Shipping Instructions
 */

// ============================================================================
// Types
// ============================================================================

export type FieldType =
  | 'string'
  | 'date'
  | 'number'
  | 'amount'
  | 'party'
  | 'address'
  | 'container'
  | 'weight'
  | 'volume';

export interface EntityField {
  name: string;
  type: FieldType;
  required: boolean;
  /** Patterns to match the label before the value */
  labelPatterns: RegExp[];
  /** Patterns to extract the value itself */
  valuePatterns?: RegExp[];
  /** Validation function */
  validate?: (value: string) => boolean;
  /** Normalization function */
  normalize?: (value: string) => string;
}

export interface SectionDefinition {
  name: string;
  /** Patterns that mark the start of this section */
  startMarkers: RegExp[];
  /** Patterns that mark the end (start of next section) */
  endMarkers: RegExp[];
  /** Fields to look for within this section */
  fields: string[];
}

export interface TableColumn {
  name: string;
  headerPatterns: RegExp[];
  valuePatterns?: RegExp[];
  type: FieldType;
}

export interface TableDefinition {
  name: string;
  /** Patterns to identify the table header row */
  headerPatterns: RegExp[];
  columns: TableColumn[];
  /** Row separator pattern */
  rowPattern?: RegExp;
}

export interface DocumentExtractionSchema {
  documentType: string;
  displayName: string;
  category: string;
  /** Fields to extract */
  fields: EntityField[];
  /** Document sections for contextual extraction */
  sections: SectionDefinition[];
  /** Tables to extract */
  tables?: TableDefinition[];
  /** Carrier-specific variations */
  carrierVariations?: Record<string, Partial<DocumentExtractionSchema>>;
}

// ============================================================================
// Common Patterns
// ============================================================================

const PATTERNS = {
  // Date patterns
  DATE_DMY: /(\d{1,2}[-/]\w{3}[-/]\d{2,4})/i,
  DATE_YMD: /(\d{4}-\d{2}-\d{2})/,
  DATE_MDY: /(\d{1,2}\/\d{1,2}\/\d{4})/,
  DATE_WRITTEN: /(\d{1,2}\s+\w{3}\s+\d{2,4}(?:\s+\d{2}:\d{2})?)/i,

  // Container patterns
  CONTAINER: /\b([A-Z]{4}\d{7})\b/,
  CONTAINER_WITH_SIZE: /([A-Z]{4}\d{7})(?:\/|\s*-\s*)?(20'?(?:GP|DV|HC)?|40'?(?:GP|DV|HC|HQ)?)?/i,

  // Seal patterns
  SEAL: /\b([A-Z0-9]{6,12})\b/,

  // Weight patterns
  WEIGHT_KG: /([\d,]+\.?\d*)\s*(?:KG|KGS|KG\.?S?)/i,
  WEIGHT_MT: /([\d,]+\.?\d*)\s*(?:MT|MTS|M\.?T\.?)/i,
  WEIGHT_LB: /([\d,]+\.?\d*)\s*(?:LB|LBS)/i,

  // Volume patterns
  VOLUME_CBM: /([\d,]+\.?\d*)\s*(?:CBM|M3|M³|CU\.?M)/i,

  // Amount patterns
  AMOUNT_USD: /(?:USD|US\$|\$)\s*([\d,]+\.?\d*)/i,
  AMOUNT_INR: /(?:INR|₹|RS\.?)\s*([\d,]+\.?\d*)/i,
  AMOUNT_EUR: /(?:EUR|€)\s*([\d,]+\.?\d*)/i,
  AMOUNT_GENERIC: /([\d,]+\.\d{2})/,

  // Reference patterns
  BL_NUMBER: /\b([A-Z]{4}[A-Z0-9]{10,14})\b/,
  BOOKING_NUMBER: /\b(\d{8,12})\b/,
  INVOICE_NUMBER: /\b([A-Z0-9]{8,20})\b/,
  HS_CODE: /\b(\d{4,10})\b/,

  // Phone/Email
  PHONE: /(?:TEL|PHONE|PH)?[:\s]*([+\d\s\-()]{10,20})/i,
  EMAIL: /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i,
};

// ============================================================================
// Party Extraction Helpers
// ============================================================================

export interface PartyInfo {
  name: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  email?: string;
  taxId?: string;
}

/**
 * Common words that indicate end of company name
 */
const ADDRESS_START_INDICATORS = [
  /^\d+/,                          // Starts with number (street address)
  /^(?:PLOT|UNIT|SUITE|FLOOR|BLDG|BUILDING)/i,
  /^(?:P\.?O\.?\s*BOX)/i,
  /,\s*(?:INC|LLC|LTD|PVT|CORP)/i,  // Company suffix followed by comma
];

/**
 * Common country names
 */
export const COUNTRIES = [
  'INDIA', 'UNITED STATES', 'USA', 'UNITED STATES OF AMERICA',
  'CHINA', 'GERMANY', 'UNITED KINGDOM', 'UK', 'CANADA',
  'JAPAN', 'SOUTH KOREA', 'VIETNAM', 'BANGLADESH', 'PAKISTAN',
  'MEXICO', 'BRAZIL', 'NETHERLANDS', 'BELGIUM', 'FRANCE',
  'ITALY', 'SPAIN', 'SINGAPORE', 'MALAYSIA', 'INDONESIA',
  'THAILAND', 'PHILIPPINES', 'TAIWAN', 'HONG KONG', 'UAE',
];

// ============================================================================
// Document Schemas
// ============================================================================

/**
 * Bill of Lading (Draft & Final - MBL/HBL)
 *
 * Based on: Hapag-Lloyd BL, Intoglo HBL
 */
export const BL_SCHEMA: DocumentExtractionSchema = {
  documentType: 'bill_of_lading',
  displayName: 'Bill of Lading',
  category: 'documentation',

  fields: [
    // Identifiers
    {
      name: 'bl_number',
      type: 'string',
      required: true,
      labelPatterns: [
        /B(?:ILL)?(?:\/|\s*OF\s*)L(?:ADING)?\s*(?:NO|NUMBER|#)?[:\s]*/i,
        /BL\s*(?:NO|NUMBER|#)?[:\s]*/i,
        /DOCUMENT\s*(?:NO|NUMBER|#)?[:\s]*/i,
      ],
      valuePatterns: [PATTERNS.BL_NUMBER],
    },
    {
      name: 'booking_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /BOOKING\s+(?:NO|NUMBER|#|REF)[.:\s]*/i,  // Require NO/NUMBER/# suffix
        /BOOKING[.:\s]+$/im,  // Or BOOKING followed by punctuation at end of line
        /BKG\s*(?:NO|#)?[:\s]*/i,
      ],
      valuePatterns: [PATTERNS.BOOKING_NUMBER],
    },

    // Parties (extracted via sections)
    {
      name: 'shipper',
      type: 'party',
      required: true,
      labelPatterns: [
        /SHIPPER[:\s]*/i,
        /CONSIGNOR[:\s]*/i,
        /EXPORTER[:\s]*/i,
      ],
    },
    {
      name: 'consignee',
      type: 'party',
      required: true,
      labelPatterns: [
        /CONSIGNEE[:\s]*/i,
        /IMPORTER[:\s]*/i,
      ],
    },
    {
      name: 'notify_party',
      type: 'party',
      required: false,
      labelPatterns: [
        /NOTIFY\s*(?:PARTY|ADDRESS)?[:\s]*/i,
        /ALSO\s*NOTIFY[:\s]*/i,
      ],
    },

    // Routing
    {
      name: 'vessel_name',
      type: 'string',
      required: false,
      labelPatterns: [
        /VESSEL\s*(?:NAME)?[:\s]*/i,
        /OCEAN\s*VESSEL[:\s]*/i,
        /MOTHER\s*VESSEL[:\s]*/i,
      ],
      // CMA CGM format: "CMA CGM VERDI / 0INLRW1MAVessel/Voyage:" (value BEFORE label)
      // Standard format: after label like "VESSEL: CMA CGM VERDI"
      // NOTE: Use [A-Z ] (space only) not [A-Z\s] to avoid matching across lines
      valuePatterns: [
        // CMA CGM reversed format: vessel name before " / " and voyage code followed by Vessel/Voyage
        /([A-Z][A-Z ]{2,}[A-Z])\s*\/\s*[A-Z0-9]+\s*(?:Vessel|Voyage)/i,
        // With prefix like "Name-CORNELIA MAERSK-546"
        /Name[-:\s]*([A-Z][A-Z \-]+[A-Z])/i,
        // After VESSEL label: extract 2-4 word names
        /VESSEL[:\s]+([A-Z][A-Z \-\.]{2,25}[A-Z])/i,
      ],
      validate: (value: string) => {
        // Reject obvious garbage
        if (!value || value.length < 3) return false;
        if (/^[\/\s]+$/.test(value)) return false;
        if (/Voyage|IMO|Lloyds|Carrier|Load|Disch|ETA|ETD|DATA/i.test(value)) return false;
        if (/OCEAN BILL|HOUSE BILL|LADING/i.test(value)) return false;
        // Must be mostly letters (vessel names are words)
        const letterRatio = (value.match(/[A-Za-z]/g) || []).length / value.length;
        return letterRatio > 0.7;
      },
    },
    {
      name: 'voyage_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /VOYAGE\s*(?:NO|NUMBER|#)?[:\s]*/i,
        /VOY(?:AGE)?[:\s]*/i,
      ],
      // CMA CGM format: "CMA CGM VERDI / 0INLRW1MAVessel/Voyage:" - voyage is alphanumeric code
      valuePatterns: [
        // CMA CGM reversed format: alphanumeric code before "Vessel/Voyage:" (no space)
        /\/\s*([A-Z0-9]{6,12})(?:Vessel|Voyage)/i,
        // After VOYAGE label
        /VOYAGE[:\s#]+([A-Z0-9]{4,15})/i,
        // Hyphenated like "-546" or "-722"
        /[-](\d{3,6})(?:\s|$)/,
      ],
      validate: (value: string) => {
        // Voyage numbers are short alphanumeric codes
        if (!value || value.length < 3 || value.length > 20) return false;
        if (/Vessel|IMO|Lloyds|Carrier/i.test(value)) return false;
        return /^[A-Z0-9\-]+$/i.test(value);
      },
    },
    {
      name: 'port_of_loading',
      type: 'string',
      required: false,
      labelPatterns: [
        /PORT\s*OF\s*LOADING[:\s]*/i,
        /POL[:\s]*/i,
        /LOAD(?:ING)?\s*PORT[:\s]*/i,
      ],
    },
    {
      name: 'port_of_discharge',
      type: 'string',
      required: false,
      labelPatterns: [
        /PORT\s*OF\s*DISCHARGE[:\s]*/i,
        /POD[:\s]*/i,
        /DISCHARGE\s*PORT[:\s]*/i,
      ],
    },
    {
      name: 'place_of_receipt',
      type: 'string',
      required: false,
      labelPatterns: [
        /PLACE\s*OF\s*RECEIPT[:\s]*/i,
        /POR[:\s]*/i,
        /GOODS\s*COLLECTED\s*FROM[:\s]*/i,
      ],
    },
    {
      name: 'place_of_delivery',
      type: 'string',
      required: false,
      labelPatterns: [
        /PLACE\s*OF\s*DELIVERY[:\s]*/i,
        /FINAL\s*DESTINATION[:\s]*/i,
        /GOODS\s*DELIVERED\s*TO[:\s]*/i,
      ],
    },

    // Dates
    {
      name: 'etd',
      type: 'date',
      required: false,
      labelPatterns: [
        /ETD[:\s]*/i,
        /ESTIMATED\s*(?:TIME\s*OF\s*)?DEPARTURE[:\s]*/i,
        /SAILING\s*DATE[:\s]*/i,
      ],
    },
    {
      name: 'eta',
      type: 'date',
      required: false,
      labelPatterns: [
        /ETA[:\s]*/i,
        /ESTIMATED\s*(?:TIME\s*OF\s*)?ARRIVAL[:\s]*/i,
        /ARRIVAL\s*DATE[:\s]*/i,
      ],
    },
    {
      name: 'shipped_on_board_date',
      type: 'date',
      required: false,
      labelPatterns: [
        /SHIPPED\s*ON\s*BOARD[:\s]*/i,
        /ON\s*BOARD\s*DATE[:\s]*/i,
        /SOB\s*DATE[:\s]*/i,
      ],
    },

    // Cargo
    {
      name: 'container_numbers',
      type: 'container',
      required: false,
      labelPatterns: [
        /CONTAINER\s*(?:NO|NUMBER|#)?[:\s]*/i,
        /CONT(?:AINER)?\.?\s*(?:NO|#)?[:\s]*/i,
      ],
      valuePatterns: [PATTERNS.CONTAINER],
    },
    {
      name: 'seal_numbers',
      type: 'string',
      required: false,
      labelPatterns: [
        /SEAL\s*(?:NO|NUMBER|#)?[:\s]*/i,
        /L\.?\s*SEAL[:\s]*/i,
        /C\.?\s*SEAL[:\s]*/i,
        /SHIPPER'?S?\s*SEAL[:\s]*/i,
      ],
      valuePatterns: [PATTERNS.SEAL],
    },
    {
      name: 'gross_weight',
      type: 'weight',
      required: false,
      labelPatterns: [
        /GROSS\s*WEIGHT[:\s]*/i,
        /GR\.?\s*(?:WT|WEIGHT)[:\s]*/i,
        /TOTAL\s*WEIGHT[:\s]*/i,
      ],
      valuePatterns: [PATTERNS.WEIGHT_KG, PATTERNS.WEIGHT_MT],
    },
    {
      name: 'net_weight',
      type: 'weight',
      required: false,
      labelPatterns: [
        /NET\s*WEIGHT[:\s]*/i,
        /N(?:ET)?\.?\s*(?:WT|WEIGHT)[:\s]*/i,
      ],
      valuePatterns: [PATTERNS.WEIGHT_KG, PATTERNS.WEIGHT_MT],
    },
    {
      name: 'volume',
      type: 'volume',
      required: false,
      labelPatterns: [
        /VOLUME[:\s]*/i,
        /MEASUREMENT[:\s]*/i,
        /MEASURE[:\s]*/i,
        /CBM[:\s]*/i,
      ],
      valuePatterns: [PATTERNS.VOLUME_CBM],
    },
    {
      name: 'package_count',
      type: 'number',
      required: false,
      labelPatterns: [
        /PACKAGE\s*(?:COUNT|QTY|QUANTITY)?[:\s]*/i,
        /NO\.?\s*OF\s*(?:PACKAGES|PKGS)[:\s]*/i,
        /TOTAL\s*(?:PACKAGES|PKGS)[:\s]*/i,
      ],
    },
    {
      name: 'cargo_description',
      type: 'string',
      required: false,
      labelPatterns: [
        /DESCRIPTION\s*OF\s*(?:GOODS|CARGO)[:\s]*/i,
        /CARGO\s*DESCRIPTION[:\s]*/i,
        /MARKS\s*(?:AND|&)\s*NOS?[:\s]*/i,
      ],
    },
    {
      name: 'hs_code',
      type: 'string',
      required: false,
      labelPatterns: [
        /H\.?S\.?\s*CODE[:\s]*/i,
        /HS\s*(?:NO|NUMBER|#)?[:\s]*/i,
        /TARIFF\s*(?:CODE|NO)[:\s]*/i,
      ],
      valuePatterns: [PATTERNS.HS_CODE],
    },

    // Payment
    {
      name: 'freight_terms',
      type: 'string',
      required: false,
      labelPatterns: [
        /FREIGHT[:\s]*/i,
        /FREIGHT\s*(?:TERMS|PAYMENT)[:\s]*/i,
      ],
      valuePatterns: [/(PREPAID|COLLECT|PP|CC)/i],
    },
    {
      name: 'incoterms',
      type: 'string',
      required: false,
      labelPatterns: [
        /INCOTERM[S]?[:\s]*/i,
        /TERMS\s*OF\s*(?:SALE|DELIVERY)[:\s]*/i,
      ],
      valuePatterns: [/\b(FOB|CIF|CFR|EXW|DDP|DAP|FCA|CIP|CPT|DAT|FAS)\b/i],
    },

    // Free time
    {
      name: 'demurrage_free_days',
      type: 'number',
      required: false,
      labelPatterns: [
        /DEMURRAGE[:\s]*/i,
        /(\d+)\s*DAYS?\s*DEMURRAGE/i,
      ],
    },
    {
      name: 'detention_free_days',
      type: 'number',
      required: false,
      labelPatterns: [
        /DETENTION[:\s]*/i,
        /(\d+)\s*DAYS?\s*DETENTION/i,
      ],
    },
  ],

  sections: [
    {
      name: 'shipper_section',
      startMarkers: [/\bSHIPPER\b/i, /\bCONSIGNOR\b/i, /\bEXPORTER\b/i],
      endMarkers: [/\bCONSIGNEE\b/i, /\bNOTIFY\b/i, /\bVESSEL\b/i, /\bPORT\b/i],
      fields: ['shipper'],
    },
    {
      name: 'consignee_section',
      startMarkers: [/\bCONSIGNEE\b/i, /\bIMPORTER\b/i],
      endMarkers: [/\bNOTIFY\b/i, /\bVESSEL\b/i, /\bPORT\b/i, /\bSHIPPER\b/i],
      fields: ['consignee'],
    },
    {
      name: 'notify_section',
      startMarkers: [/\bNOTIFY\b/i],
      endMarkers: [/\bVESSEL\b/i, /\bPORT\b/i, /\bCONTAINER\b/i, /\bCARGO\b/i],
      fields: ['notify_party'],
    },
    {
      name: 'routing_section',
      startMarkers: [/\bVESSEL\b/i, /\bPORT\s*OF\b/i, /\bROUTING\b/i],
      endMarkers: [/\bCONTAINER\b/i, /\bCARGO\b/i, /\bMARKS\b/i],
      fields: ['vessel_name', 'voyage_number', 'port_of_loading', 'port_of_discharge', 'etd', 'eta'],
    },
    {
      name: 'cargo_section',
      startMarkers: [/\bCONTAINER\b/i, /\bMARKS\b/i, /\bCARGO\b/i],
      endMarkers: [/\bFREIGHT\b/i, /\bSHIPPED\s*ON\s*BOARD\b/i, /\bTERMS\b/i],
      fields: ['container_numbers', 'seal_numbers', 'gross_weight', 'net_weight', 'volume', 'package_count', 'cargo_description'],
    },
  ],
};

/**
 * Arrival Notice
 *
 * Based on: ONE Arrival Notice
 */
export const ARRIVAL_NOTICE_SCHEMA: DocumentExtractionSchema = {
  documentType: 'arrival_notice',
  displayName: 'Arrival Notice',
  category: 'arrival_delivery',

  fields: [
    // Identifiers
    {
      name: 'bl_number',
      type: 'string',
      required: true,
      labelPatterns: [
        /B\/L\s*(?:NO|NUMBER|#)?[:\s]*/i,
        /BILL\s*OF\s*LADING[:\s]*/i,
        /BL\s*(?:NO|#)?[:\s]*/i,
      ],
      valuePatterns: [PATTERNS.BL_NUMBER],
    },

    // Parties
    {
      name: 'consignee',
      type: 'party',
      required: false,
      labelPatterns: [
        /CONSIGNEE\s*ADDRESS[:\s]*/i,
        /CONSIGNEE[:\s]*/i,
      ],
    },
    {
      name: 'notify_party',
      type: 'party',
      required: false,
      labelPatterns: [
        /NOTIFY\s*ADDRESS[:\s]*/i,
        /NOTIFY\s*PARTY[:\s]*/i,
      ],
    },
    {
      name: 'shipper',
      type: 'party',
      required: false,
      labelPatterns: [
        /SHIPPER\s*ADDRESS[:\s]*/i,
        /SHIPPER[:\s]*/i,
      ],
    },

    // Vessel
    {
      name: 'vessel_name',
      type: 'string',
      required: false,
      labelPatterns: [
        /ARRIVAL\s*VESSEL[:\s]*/i,
        /VESSEL[:\s]*/i,
      ],
    },

    // Locations
    {
      name: 'port_of_discharge',
      type: 'string',
      required: false,
      labelPatterns: [
        /PORT\s*OF\s*DISCHARG(?:E|ING)[:\s]*/i,
        /POD[:\s]*/i,
      ],
    },
    {
      name: 'place_of_delivery',
      type: 'string',
      required: false,
      labelPatterns: [
        /PLACE\s*OF\s*DELIVERY[:\s]*/i,
        /FINAL\s*DEST(?:INATION)?[:\s]*/i,
      ],
    },
    {
      name: 'pickup_location',
      type: 'string',
      required: false,
      labelPatterns: [
        /AVAILABLE\s*CONTAINER\s*YARD[:\s]*/i,
        /PICKUP\s*(?:LOCATION|AT)[:\s]*/i,
        /CY\s*(?:LOCATION)?[:\s]*/i,
      ],
    },

    // Dates
    {
      name: 'eta',
      type: 'date',
      required: true,
      labelPatterns: [
        /\bETA\b[:\s]*/i,
        /ESTIMATED\s*ARRIVAL[:\s]*/i,
        /ARRIVAL\s*DATE[:\s]*/i,
      ],
    },
    {
      name: 'available_date',
      type: 'date',
      required: false,
      labelPatterns: [
        /AVAILABLE\s*DATE[:\s]*/i,
        /CARGO\s*AVAILABLE[:\s]*/i,
      ],
    },
    {
      name: 'last_free_day',
      type: 'date',
      required: false,
      labelPatterns: [
        /LAST\s*FREE\s*DAY[:\s]*/i,
        /LFD[:\s]*/i,
        /EST\.?\s*GENERAL\s*ORDER[:\s]*/i,
        /FREE\s*TIME\s*EXPIR(?:Y|ES)[:\s]*/i,
      ],
    },
    {
      name: 'free_time_days',
      type: 'number',
      required: false,
      labelPatterns: [
        /FREE\s*TIME[:\s]*/i,
        /(\d+)\s*(?:DAYS?)?\s*FREE/i,
      ],
    },

    // Demurrage/Detention
    {
      name: 'demurrage_rate',
      type: 'amount',
      required: false,
      labelPatterns: [
        /DEMURRAGE\s*(?:RATE|CHARGE)?[:\s]*/i,
        /PER\s*DIEM[:\s]*/i,
      ],
      valuePatterns: [PATTERNS.AMOUNT_USD],
    },
    {
      name: 'storage_rate',
      type: 'amount',
      required: false,
      labelPatterns: [
        /STORAGE\s*(?:RATE|CHARGE)?[:\s]*/i,
      ],
      valuePatterns: [PATTERNS.AMOUNT_USD],
    },

    // Cargo
    {
      name: 'container_numbers',
      type: 'container',
      required: false,
      labelPatterns: [
        /CONTAINER\s*(?:NO|#)?[:\s]*/i,
      ],
      valuePatterns: [PATTERNS.CONTAINER],
    },
    {
      name: 'seal_numbers',
      type: 'string',
      required: false,
      labelPatterns: [
        /SEAL\s*(?:NO|#)?[:\s]*/i,
      ],
    },
    {
      name: 'total_weight',
      type: 'weight',
      required: false,
      labelPatterns: [
        /TOTAL\s*WEIGHT[:\s]*/i,
        /WEIGHT[:\s]*/i,
      ],
      valuePatterns: [PATTERNS.WEIGHT_KG],
    },
    {
      name: 'total_volume',
      type: 'volume',
      required: false,
      labelPatterns: [
        /MEASURE[:\s]*/i,
        /VOLUME[:\s]*/i,
        /CBM[:\s]*/i,
      ],
      valuePatterns: [PATTERNS.VOLUME_CBM],
    },
    {
      name: 'total_pieces',
      type: 'number',
      required: false,
      labelPatterns: [
        /TOTAL\s*PIECE\s*COUNT[:\s]*/i,
        /PIECES[:\s]*/i,
        /PACKAGES[:\s]*/i,
      ],
    },

    // Payment
    {
      name: 'freight_status',
      type: 'string',
      required: false,
      labelPatterns: [
        /FREIGHT[:\s]*/i,
      ],
      valuePatterns: [/(PREPAID|COLLECT)/i],
    },
    {
      name: 'total_charges',
      type: 'amount',
      required: false,
      labelPatterns: [
        /TOTAL\s*(?:AMOUNT\s*)?DUE[:\s]*/i,
        /COLLECT\s*(?:CHARGES|TOTAL)[:\s]*/i,
      ],
      valuePatterns: [PATTERNS.AMOUNT_USD],
    },

    // In-bond
    {
      name: 'inbond_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /IN-?BOND\s*(?:NO|NUMBER|#)?[:\s]*/i,
        /I\.?T\.?\s*(?:NO|NUMBER|#)?[:\s]*/i,
      ],
    },
    {
      name: 'firms_code',
      type: 'string',
      required: false,
      labelPatterns: [
        /FIRM[S]?\s*(?:CODE|#)?[:\s]*/i,
      ],
    },
  ],

  sections: [
    {
      name: 'consignee_section',
      startMarkers: [/CONSIGNEE\s*ADDRESS/i],
      endMarkers: [/NOTIFY/i, /SHIPPER/i, /PORT/i],
      fields: ['consignee'],
    },
    {
      name: 'notify_section',
      startMarkers: [/NOTIFY\s*ADDRESS/i],
      endMarkers: [/SHIPPER/i, /PORT/i, /ETA/i],
      fields: ['notify_party'],
    },
    {
      name: 'shipper_section',
      startMarkers: [/SHIPPER\s*ADDRESS/i],
      endMarkers: [/PORT/i, /ETA/i, /PLACE/i],
      fields: ['shipper'],
    },
  ],

  tables: [
    {
      name: 'container_details',
      headerPatterns: [/CONTAINER\s*#?\s*TP\s*QTY\s*WGT\s*SEAL/i],
      columns: [
        { name: 'container_number', headerPatterns: [/CONTAINER/i], type: 'container' },
        { name: 'container_type', headerPatterns: [/TP/i, /TYPE/i], type: 'string' },
        { name: 'quantity', headerPatterns: [/QTY/i], type: 'string' },
        { name: 'weight', headerPatterns: [/WGT/i, /WEIGHT/i], type: 'weight' },
        { name: 'seal', headerPatterns: [/SEAL/i], type: 'string' },
      ],
    },
    {
      name: 'charges',
      headerPatterns: [/CHG\s*RATED\s*AS\s*RATE\s*PER\s*COLLECT/i],
      columns: [
        { name: 'charge_code', headerPatterns: [/CHG/i], type: 'string' },
        { name: 'description', headerPatterns: [/RATED\s*AS/i], type: 'string' },
        { name: 'rate', headerPatterns: [/RATE/i], type: 'amount' },
        { name: 'per', headerPatterns: [/PER/i], type: 'string' },
        { name: 'amount', headerPatterns: [/COLLECT/i], type: 'amount' },
      ],
    },
  ],
};

/**
 * Freight Invoice
 *
 * Based on: COSCO Invoice, Hapag Invoice
 */
export const FREIGHT_INVOICE_SCHEMA: DocumentExtractionSchema = {
  documentType: 'freight_invoice',
  displayName: 'Freight Invoice',
  category: 'financial',

  fields: [
    // Invoice details
    {
      name: 'invoice_number',
      type: 'string',
      required: true,
      labelPatterns: [
        /INVOICE\s*(?:NO|NUMBER|#)?[:\s]*/i,
        /INV\s*(?:NO|#)?[:\s]*/i,
      ],
    },
    {
      name: 'invoice_date',
      type: 'date',
      required: true,
      labelPatterns: [
        /INVOICE\s*DATE[:\s]*/i,
        /DATE[:\s]*/i,
      ],
    },
    {
      name: 'due_date',
      type: 'date',
      required: false,
      labelPatterns: [
        /DUE\s*DATE[:\s]*/i,
        /PAYMENT\s*DUE[:\s]*/i,
      ],
    },

    // Customer
    {
      name: 'party_name',
      type: 'string',
      required: false,
      labelPatterns: [
        /PARTY\s*NAME[:\s]*/i,
        /CUSTOMER[:\s]*/i,
        /BILL\s*TO[:\s]*/i,
      ],
    },
    {
      name: 'customer_id',
      type: 'string',
      required: false,
      labelPatterns: [
        /CUSTOMER\s*ID[:\s]*/i,
      ],
    },

    // Shipment reference
    {
      name: 'bl_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /M(?:ASTER)?B\/L[:\s]*/i,
        /MB\/L[:\s]*/i,
        /B\/L[:\s]*/i,
      ],
    },
    {
      name: 'booking_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /BOOKING\s*(?:NO|#)?[:\s]*/i,
      ],
    },
    {
      name: 'container_numbers',
      type: 'container',
      required: false,
      labelPatterns: [
        /CONTAINER\s*(?:NO|#)?[:\s]*/i,
        /CONT(?:AINER)?\.?\s*(?:NO|#)?[:\s]*/i,
      ],
    },

    // Vessel
    {
      name: 'vessel_voyage',
      type: 'string',
      required: false,
      labelPatterns: [
        /VESSEL\/?VOY(?:AGE)?[:\s]*/i,
        /VESSEL[:\s]*/i,
      ],
    },
    {
      name: 'etd',
      type: 'date',
      required: false,
      labelPatterns: [
        /(?:VESSEL\s*)?ETD(?:\s*DATE)?[:\s]*/i,
      ],
    },

    // Routing
    {
      name: 'pol',
      type: 'string',
      required: false,
      labelPatterns: [
        /POL[:\s]*/i,
        /PORT\s*OF\s*LOADING[:\s]*/i,
      ],
    },
    {
      name: 'pod',
      type: 'string',
      required: false,
      labelPatterns: [
        /POD[:\s]*/i,
        /PORT\s*OF\s*DISCHARGE[:\s]*/i,
      ],
    },
    {
      name: 'fpd',
      type: 'string',
      required: false,
      labelPatterns: [
        /FPD[:\s]*/i,
        /FINAL\s*(?:PLACE\s*OF\s*)?DEST(?:INATION)?[:\s]*/i,
      ],
    },

    // Cargo
    {
      name: 'cargo_weight',
      type: 'weight',
      required: false,
      labelPatterns: [
        /CARGO\s*WEIGHT[:\s]*/i,
        /WEIGHT[:\s]*/i,
      ],
    },
    {
      name: 'cargo_type',
      type: 'string',
      required: false,
      labelPatterns: [
        /CARGO\s*TYPE[:\s]*/i,
      ],
    },

    // Amounts
    {
      name: 'subtotal',
      type: 'amount',
      required: false,
      labelPatterns: [
        /SUB\s*TOTAL[:\s]*/i,
        /GROSS[:\s]*/i,
      ],
    },
    {
      name: 'tax_amount',
      type: 'amount',
      required: false,
      labelPatterns: [
        /(?:I?GST|TAX)\s*(?:@\s*\d+%)?[:\s]*/i,
        /INTEGRATED\s*GST[:\s]*/i,
      ],
    },
    {
      name: 'total_amount',
      type: 'amount',
      required: true,
      labelPatterns: [
        /NET\s*AMOUNT[:\s]*/i,
        /TOTAL\s*(?:AMOUNT|INR|USD)?[:\s]*/i,
        /GRAND\s*TOTAL[:\s]*/i,
      ],
    },
    {
      name: 'currency',
      type: 'string',
      required: false,
      labelPatterns: [
        /CURRENCY[:\s]*/i,
      ],
      valuePatterns: [/\b(USD|INR|EUR|GBP)\b/i],
    },
  ],

  sections: [],

  tables: [
    {
      name: 'line_items',
      headerPatterns: [
        /CHARGE\s*NAME.*CURR.*RATE.*TOTAL/i,
        /DESCRIPTION.*CHARGE.*AMOUNT/i,
        /HSN.*CHARGE.*TAXABLE/i,
      ],
      columns: [
        { name: 'charge_name', headerPatterns: [/CHARGE\s*NAME/i, /DESCRIPTION/i], type: 'string' },
        { name: 'hsn_sac', headerPatterns: [/HSN/i, /SAC/i], type: 'string' },
        { name: 'currency', headerPatterns: [/CURR/i], type: 'string' },
        { name: 'exchange_rate', headerPatterns: [/EX\.?\s*RATE/i], type: 'number' },
        { name: 'quantity', headerPatterns: [/QTY|QUANTITY/i], type: 'number' },
        { name: 'rate', headerPatterns: [/RATE/i], type: 'amount' },
        { name: 'amount', headerPatterns: [/TOTAL|AMOUNT/i], type: 'amount' },
        { name: 'taxable', headerPatterns: [/TAXABLE/i], type: 'amount' },
      ],
    },
  ],
};

/**
 * Shipping Instruction
 *
 * Based on: Hapag-Lloyd SI
 */
export const SHIPPING_INSTRUCTION_SCHEMA: DocumentExtractionSchema = {
  documentType: 'shipping_instruction',
  displayName: 'Shipping Instruction',
  category: 'documentation',

  fields: [
    // References
    {
      name: 'booking_number',
      type: 'string',
      required: true,
      labelPatterns: [
        /BOOKING\s*(?:NO|NUMBER|#)?[:\s]*/i,
      ],
    },
    {
      name: 'bl_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /B(?:\/)?L\s*(?:NO|NUMBER|#)?[:\s]*/i,
      ],
    },

    // Parties
    {
      name: 'shipper',
      type: 'party',
      required: true,
      labelPatterns: [
        /\bSHIPPER\b[:\s]*/i,
      ],
    },
    {
      name: 'consignee',
      type: 'party',
      required: true,
      labelPatterns: [
        /\bCONSIGNEE\b[:\s]*/i,
      ],
    },
    {
      name: 'notify_party',
      type: 'party',
      required: false,
      labelPatterns: [
        /NOTIFY\s*(?:ADDRESS|PARTY)?[:\s]*/i,
      ],
    },

    // Routing
    {
      name: 'port_of_loading',
      type: 'string',
      required: false,
      labelPatterns: [
        /PORT\s*OF\s*LOADING[:\s]*/i,
        /POL[:\s]*/i,
      ],
    },
    {
      name: 'port_of_discharge',
      type: 'string',
      required: false,
      labelPatterns: [
        /PORT\s*OF\s*DISCHARGE[:\s]*/i,
        /POD[:\s]*/i,
      ],
    },

    // Container
    {
      name: 'container_number',
      type: 'container',
      required: false,
      labelPatterns: [
        /CONTAINER\s*(?:NO|NUMBER|#)?[:\s]*/i,
      ],
    },
    {
      name: 'seal_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /SEAL(?:\(S\))?[:\s]*/i,
      ],
    },

    // Cargo
    {
      name: 'hs_code',
      type: 'string',
      required: false,
      labelPatterns: [
        /HS\s*CODE[:\s]*/i,
      ],
    },
    {
      name: 'cargo_description',
      type: 'string',
      required: false,
      labelPatterns: [
        /CARGO\s*DESCRIPTION[:\s]*/i,
        /DESCRIPTION\s*OF\s*GOODS[:\s]*/i,
      ],
    },
    {
      name: 'gross_weight',
      type: 'weight',
      required: false,
      labelPatterns: [
        /GROSS\s*WEIGHT[:\s]*/i,
        /GR\.?\s*WEIGHT[:\s]*/i,
      ],
    },
    {
      name: 'net_weight',
      type: 'weight',
      required: false,
      labelPatterns: [
        /NET\s*WEIGHT[:\s]*/i,
      ],
    },
    {
      name: 'volume',
      type: 'volume',
      required: false,
      labelPatterns: [
        /GROSS\s*VOLUME[:\s]*/i,
        /VOLUME[:\s]*/i,
      ],
    },
    {
      name: 'package_count',
      type: 'number',
      required: false,
      labelPatterns: [
        /NO\.?\s*OF(?:\s*OUTER)?\s*PACKAG(?:ES|ING)?[:\s]*/i,
        /PACKAGES[:\s]*/i,
      ],
    },

    // Payment
    {
      name: 'origin_charges',
      type: 'string',
      required: false,
      labelPatterns: [
        /ORIGIN\s*(?:PORT\s*)?CHARGE[:\s]*/i,
      ],
      valuePatterns: [/(PREPAID|COLLECT)/i],
    },
    {
      name: 'sea_freight',
      type: 'string',
      required: false,
      labelPatterns: [
        /SEA\s*FREIGHT[:\s]*/i,
        /OCEAN\s*FREIGHT[:\s]*/i,
      ],
      valuePatterns: [/(PREPAID|COLLECT)/i],
    },
    {
      name: 'destination_charges',
      type: 'string',
      required: false,
      labelPatterns: [
        /DESTINATION\s*(?:PORT\s*)?CHARGE[:\s]*/i,
      ],
      valuePatterns: [/(PREPAID|COLLECT)/i],
    },

    // Document
    {
      name: 'document_type',
      type: 'string',
      required: false,
      labelPatterns: [
        /DOCUMENT\s*TYPE[:\s]*/i,
      ],
      valuePatterns: [/(BILL\s*OF\s*LADING|SEA\s*WAYBILL|EXPRESS|ORIGINAL)/i],
    },
    {
      name: 'ams_scac',
      type: 'string',
      required: false,
      labelPatterns: [
        /SCAC\s*CODE[:\s]*/i,
        /SELF\s*FILER\s*SCAC[:\s]*/i,
      ],
    },
  ],

  sections: [
    {
      name: 'shipper_section',
      startMarkers: [/\bSHIPPER\b/i],
      endMarkers: [/\bCONSIGNEE\b/i],
      fields: ['shipper'],
    },
    {
      name: 'consignee_section',
      startMarkers: [/\bCONSIGNEE\b/i],
      endMarkers: [/\bNOTIFY\b/i, /\bPORT\b/i],
      fields: ['consignee'],
    },
    {
      name: 'notify_section',
      startMarkers: [/\bNOTIFY\b/i],
      endMarkers: [/\bPORT\b/i, /\bCONTAINER\b/i],
      fields: ['notify_party'],
    },
  ],
};

/**
 * Packing List
 *
 * Based on: Star Pipe Packing List
 */
export const PACKING_LIST_SCHEMA: DocumentExtractionSchema = {
  documentType: 'packing_list',
  displayName: 'Packing List',
  category: 'export_docs',

  fields: [
    // References
    {
      name: 'invoice_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /(?:EXPORT\s*)?INVOICE\s*(?:NO|#)?[:\s]*/i,
      ],
    },
    {
      name: 'invoice_date',
      type: 'date',
      required: false,
      labelPatterns: [
        /INVOICE\s*DATE[:\s]*/i,
        /DATE[:\s]*/i,
      ],
    },

    // Parties
    {
      name: 'consignee',
      type: 'party',
      required: false,
      labelPatterns: [
        /\bCONSIGNEE\b[:\s]*/i,
      ],
    },
    {
      name: 'buyer',
      type: 'party',
      required: false,
      labelPatterns: [
        /\bBUYER\b[:\s]*/i,
      ],
    },

    // Routing
    {
      name: 'country_of_origin',
      type: 'string',
      required: false,
      labelPatterns: [
        /COUNTRY\s*OF\s*ORIGIN[:\s]*/i,
        /ORIGIN[:\s]*/i,
      ],
    },
    {
      name: 'country_of_destination',
      type: 'string',
      required: false,
      labelPatterns: [
        /COUNTRY\s*OF\s*(?:FINAL\s*)?DESTINATION[:\s]*/i,
        /DESTINATION[:\s]*/i,
      ],
    },
    {
      name: 'port_of_loading',
      type: 'string',
      required: false,
      labelPatterns: [
        /PORT\s*OF\s*LOADING[:\s]*/i,
      ],
    },
    {
      name: 'port_of_destination',
      type: 'string',
      required: false,
      labelPatterns: [
        /PORT\s*OF\s*DESTINATION[:\s]*/i,
      ],
    },
    {
      name: 'final_destination',
      type: 'string',
      required: false,
      labelPatterns: [
        /FINAL\s*DESTINATION[:\s]*/i,
      ],
    },

    // Container
    {
      name: 'container_number',
      type: 'container',
      required: false,
      labelPatterns: [
        /CONTAINER[:\s]*/i,
      ],
    },

    // Cargo totals
    {
      name: 'total_net_weight',
      type: 'weight',
      required: true,
      labelPatterns: [
        /TOTAL\s*NET\s*WEIGHT[:\s]*/i,
      ],
    },
    {
      name: 'total_gross_weight',
      type: 'weight',
      required: true,
      labelPatterns: [
        /TOTAL\s*GROSS\s*WEIGHT[:\s]*/i,
      ],
    },
    {
      name: 'total_packages',
      type: 'number',
      required: false,
      labelPatterns: [
        /TOTAL\s*(?:CRATES|PACKAGES|CARTONS)[:\s]*/i,
      ],
    },

    // Terms
    {
      name: 'incoterms',
      type: 'string',
      required: false,
      labelPatterns: [
        /SHIPMENT\/?PAYMENT\s*TERMS[:\s]*/i,
        /TERMS[:\s]*/i,
      ],
      valuePatterns: [/\b(FOB|CIF|CFR|EXW)\b/i],
    },
  ],

  sections: [
    {
      name: 'consignee_section',
      startMarkers: [/\bCONSIGNEE\b/i],
      endMarkers: [/\bBUYER\b/i, /\bINVOICE\b/i, /\bCOUNTRY\b/i],
      fields: ['consignee'],
    },
    {
      name: 'buyer_section',
      startMarkers: [/\bBUYER\b/i],
      endMarkers: [/\bINVOICE\b/i, /\bCOUNTRY\b/i, /\bSR\.?\s*NO/i],
      fields: ['buyer'],
    },
  ],

  tables: [
    {
      name: 'package_details',
      headerPatterns: [
        /SR\.?\s*NO\s*ITEM\s*CODE\s*DESCRIPTION/i,
        /MARKS.*PACKAGE.*WEIGHT/i,
      ],
      columns: [
        { name: 'sr_no', headerPatterns: [/SR\.?\s*NO/i], type: 'number' },
        { name: 'item_code', headerPatterns: [/ITEM\s*CODE/i], type: 'string' },
        { name: 'description', headerPatterns: [/DESCRIPTION/i], type: 'string' },
        { name: 'quantity', headerPatterns: [/QUANTITY/i, /QTY/i], type: 'number' },
        { name: 'unit_weight', headerPatterns: [/WEIGHT.*KG/i], type: 'weight' },
        { name: 'net_weight', headerPatterns: [/NET\s*WEIGHT/i], type: 'weight' },
        { name: 'gross_weight', headerPatterns: [/GROSS\s*WEIGHT/i], type: 'weight' },
        { name: 'crates', headerPatterns: [/CRATES/i, /PACKAGES/i], type: 'number' },
      ],
    },
  ],
};

/**
 * Entry Summary (CBP 7501)
 *
 * Based on: US Customs Entry Summary
 */
export const ENTRY_SUMMARY_SCHEMA: DocumentExtractionSchema = {
  documentType: 'entry_summary',
  displayName: 'Entry Summary (CBP 7501)',
  category: 'us_customs',

  fields: [
    // Entry info
    {
      name: 'entry_number',
      type: 'string',
      required: true,
      labelPatterns: [
        /FILER\s*CODE\/?ENTRY\s*(?:NO|NUMBER|#)?[:\s]*/i,
        /ENTRY\s*(?:NO|NUMBER|#)?[:\s]*/i,
      ],
    },
    {
      name: 'entry_type',
      type: 'string',
      required: false,
      labelPatterns: [
        /ENTRY\s*TYPE[:\s]*/i,
      ],
    },
    {
      name: 'entry_date',
      type: 'date',
      required: false,
      labelPatterns: [
        /ENTRY\s*DATE[:\s]*/i,
      ],
    },
    {
      name: 'summary_date',
      type: 'date',
      required: false,
      labelPatterns: [
        /SUMMARY\s*DATE[:\s]*/i,
      ],
    },

    // Parties
    {
      name: 'ultimate_consignee',
      type: 'party',
      required: false,
      labelPatterns: [
        /ULTIMATE\s*CONSIGNEE[:\s]*/i,
      ],
    },
    {
      name: 'importer_of_record',
      type: 'party',
      required: false,
      labelPatterns: [
        /IMPORTER\s*OF\s*RECORD[:\s]*/i,
      ],
    },
    {
      name: 'manufacturer_id',
      type: 'string',
      required: false,
      labelPatterns: [
        /MANUFACTURER\s*ID[:\s]*/i,
      ],
    },

    // Transport
    {
      name: 'bl_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /B\/L\s*(?:OR\s*AWB)?\s*(?:NO|NUMBER|#)?[:\s]*/i,
      ],
    },
    {
      name: 'importing_carrier',
      type: 'string',
      required: false,
      labelPatterns: [
        /IMPORTING\s*CARRIER[:\s]*/i,
      ],
    },
    {
      name: 'mode_of_transport',
      type: 'string',
      required: false,
      labelPatterns: [
        /MODE\s*OF\s*TRANSPORT[:\s]*/i,
      ],
    },

    // Locations
    {
      name: 'country_of_origin',
      type: 'string',
      required: false,
      labelPatterns: [
        /COUNTRY\s*OF\s*ORIGIN[:\s]*/i,
      ],
    },
    {
      name: 'exporting_country',
      type: 'string',
      required: false,
      labelPatterns: [
        /EXPORTING\s*COUNTRY[:\s]*/i,
      ],
    },
    {
      name: 'foreign_port_of_lading',
      type: 'string',
      required: false,
      labelPatterns: [
        /FOREIGN\s*PORT\s*OF\s*LADING[:\s]*/i,
      ],
    },
    {
      name: 'us_port_of_unlading',
      type: 'string',
      required: false,
      labelPatterns: [
        /U\.?S\.?\s*PORT\s*OF\s*UNLADING[:\s]*/i,
      ],
    },
    {
      name: 'location_of_goods',
      type: 'string',
      required: false,
      labelPatterns: [
        /LOCATION\s*OF\s*GOODS[:\s]*/i,
      ],
    },

    // Dates
    {
      name: 'import_date',
      type: 'date',
      required: false,
      labelPatterns: [
        /IMPORT\s*DATE[:\s]*/i,
      ],
    },
    {
      name: 'export_date',
      type: 'date',
      required: false,
      labelPatterns: [
        /EXPORT\s*DATE[:\s]*/i,
      ],
    },

    // IT (In-Transit)
    {
      name: 'it_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /I\.?T\.?\s*(?:NO|NUMBER|#)?[:\s]*/i,
      ],
    },
    {
      name: 'it_date',
      type: 'date',
      required: false,
      labelPatterns: [
        /I\.?T\.?\s*DATE[:\s]*/i,
      ],
    },

    // Values
    {
      name: 'total_entered_value',
      type: 'amount',
      required: false,
      labelPatterns: [
        /TOTAL\s*ENTERED\s*VALUE[:\s]*/i,
      ],
    },
    {
      name: 'duty',
      type: 'amount',
      required: false,
      labelPatterns: [
        /\bDUTY\b[:\s]*/i,
        /ASCERTAINED\s*DUTY[:\s]*/i,
      ],
    },
    {
      name: 'tax',
      type: 'amount',
      required: false,
      labelPatterns: [
        /\bTAX\b[:\s]*/i,
        /ASCERTAINED\s*TAX[:\s]*/i,
      ],
    },
    {
      name: 'other_fees',
      type: 'amount',
      required: false,
      labelPatterns: [
        /OTHER\s*FEES?[:\s]*/i,
        /TOTAL\s*OTHER\s*FEES[:\s]*/i,
      ],
    },
    {
      name: 'mpf',
      type: 'amount',
      required: false,
      labelPatterns: [
        /MPF[:\s]*/i,
        /MERCHANDISE\s*PROCESS(?:ING)?\s*FEE[:\s]*/i,
      ],
    },
    {
      name: 'hmf',
      type: 'amount',
      required: false,
      labelPatterns: [
        /HMF[:\s]*/i,
        /HARBOR\s*MAINTENANCE\s*FEE[:\s]*/i,
      ],
    },
    {
      name: 'total',
      type: 'amount',
      required: false,
      labelPatterns: [
        /\bTOTAL\b[:\s]*/i,
        /ASCERTAINED\s*TOTAL[:\s]*/i,
      ],
    },

    // Broker
    {
      name: 'broker_name',
      type: 'string',
      required: false,
      labelPatterns: [
        /BROKER\/?FILER\s*INFORMATION[:\s]*/i,
      ],
    },
  ],

  sections: [
    {
      name: 'consignee_section',
      startMarkers: [/ULTIMATE\s*CONSIGNEE/i],
      endMarkers: [/IMPORTER\s*OF\s*RECORD/i, /DESCRIPTION/i],
      fields: ['ultimate_consignee'],
    },
    {
      name: 'importer_section',
      startMarkers: [/IMPORTER\s*OF\s*RECORD/i],
      endMarkers: [/DESCRIPTION/i, /LINE\s*NO/i],
      fields: ['importer_of_record'],
    },
  ],

  tables: [
    {
      name: 'line_items',
      headerPatterns: [
        /LINE\s*NO.*HTSUS.*DESCRIPTION/i,
        /HTSUS\s*NO.*GROSS\s*WEIGHT/i,
      ],
      columns: [
        { name: 'line_number', headerPatterns: [/LINE\s*NO/i], type: 'number' },
        { name: 'htsus_number', headerPatterns: [/HTSUS\s*NO/i], type: 'string' },
        { name: 'description', headerPatterns: [/DESCRIPTION/i], type: 'string' },
        { name: 'gross_weight', headerPatterns: [/GROSS\s*WEIGHT/i], type: 'weight' },
        { name: 'entered_value', headerPatterns: [/ENTERED\s*VALUE/i], type: 'amount' },
        { name: 'htsus_rate', headerPatterns: [/HTSUS\s*RATE/i], type: 'string' },
        { name: 'duty', headerPatterns: [/DUTY/i], type: 'amount' },
      ],
    },
  ],
};

/**
 * Commercial Invoice
 *
 * Based on: Intoglo Pro Forma Invoice
 */
export const COMMERCIAL_INVOICE_SCHEMA: DocumentExtractionSchema = {
  documentType: 'commercial_invoice',
  displayName: 'Commercial Invoice',
  category: 'export_docs',

  fields: [
    // Invoice details
    {
      name: 'invoice_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /INVOICE\s*(?:NO|NUMBER|#)?[:\s]*/i,
        /SHIPMENTS?[:\s]*/i,
      ],
    },
    {
      name: 'invoice_date',
      type: 'date',
      required: true,
      labelPatterns: [
        /INVOICE\s*DATE[:\s]*/i,
        /DATE[:\s]*/i,
      ],
    },
    {
      name: 'due_date',
      type: 'date',
      required: false,
      labelPatterns: [
        /DUE\s*DATE[:\s]*/i,
      ],
    },
    {
      name: 'payment_terms',
      type: 'string',
      required: false,
      labelPatterns: [
        /\bTERMS\b[:\s]*/i,
        /PAYMENT\s*TERMS[:\s]*/i,
      ],
    },

    // Parties
    {
      name: 'consignor',
      type: 'party',
      required: false,
      labelPatterns: [
        /CONSIGNOR[:\s]*/i,
        /SELLER[:\s]*/i,
        /EXPORTER[:\s]*/i,
      ],
    },
    {
      name: 'consignee',
      type: 'party',
      required: false,
      labelPatterns: [
        /CONSIGNEE[:\s]*/i,
        /BUYER[:\s]*/i,
        /IMPORTER[:\s]*/i,
      ],
    },

    // References
    {
      name: 'bl_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /(?:OCEAN|HOUSE)\s*BILL\s*OF\s*LADING[:\s]*/i,
        /MBL[:\s]*/i,
        /HBL[:\s]*/i,
      ],
    },
    {
      name: 'customer_id',
      type: 'string',
      required: false,
      labelPatterns: [
        /CUSTOMER\s*ID[:\s]*/i,
      ],
    },

    // Vessel
    {
      name: 'vessel_voyage',
      type: 'string',
      required: false,
      labelPatterns: [
        /VESSEL\s*\/?\s*VOYAGE[:\s]*/i,
      ],
    },

    // Routing
    {
      name: 'origin',
      type: 'string',
      required: false,
      labelPatterns: [
        /\bORIGIN\b[:\s]*/i,
      ],
    },
    {
      name: 'destination',
      type: 'string',
      required: false,
      labelPatterns: [
        /DESTINATION[:\s]*/i,
      ],
    },
    {
      name: 'etd',
      type: 'date',
      required: false,
      labelPatterns: [
        /\bETD\b[:\s]*/i,
      ],
    },
    {
      name: 'eta',
      type: 'date',
      required: false,
      labelPatterns: [
        /\bETA\b[:\s]*/i,
      ],
    },

    // Container
    {
      name: 'container_numbers',
      type: 'container',
      required: false,
      labelPatterns: [
        /CONTAINERS?[:\s]*/i,
      ],
    },

    // Cargo
    {
      name: 'weight',
      type: 'weight',
      required: false,
      labelPatterns: [
        /\bWEIGHT\b[:\s]*/i,
      ],
    },
    {
      name: 'volume',
      type: 'volume',
      required: false,
      labelPatterns: [
        /\bVOLUME\b[:\s]*/i,
      ],
    },
    {
      name: 'packages',
      type: 'string',
      required: false,
      labelPatterns: [
        /PACKAGES[:\s]*/i,
      ],
    },
    {
      name: 'goods_description',
      type: 'string',
      required: false,
      labelPatterns: [
        /GOODS\s*DESCRIPTION[:\s]*/i,
        /CONTAINS[:\s]*/i,
      ],
    },

    // Amounts
    {
      name: 'subtotal',
      type: 'amount',
      required: false,
      labelPatterns: [
        /SUBTOTAL[:\s]*/i,
        /TOTAL\s*CHARGES[:\s]*/i,
      ],
    },
    {
      name: 'tax',
      type: 'amount',
      required: false,
      labelPatterns: [
        /I?GST[:\s]*/i,
        /TAX[:\s]*/i,
      ],
    },
    {
      name: 'total',
      type: 'amount',
      required: true,
      labelPatterns: [
        /TOTAL\s*(?:INR|USD)?[:\s]*/i,
        /GRAND\s*TOTAL[:\s]*/i,
        /BALANCE\s*DUE[:\s]*/i,
      ],
    },
    {
      name: 'currency',
      type: 'string',
      required: false,
      labelPatterns: [],
      valuePatterns: [/\b(INR|USD|EUR)\b/],
    },

    // Bank details
    {
      name: 'bank_name',
      type: 'string',
      required: false,
      labelPatterns: [
        /\bBANK\b[:\s]*/i,
      ],
    },
    {
      name: 'bank_account',
      type: 'string',
      required: false,
      labelPatterns: [
        /ACCOUNT\s*(?:NO|NUMBER|#)?[:\s]*/i,
      ],
    },
    {
      name: 'ifsc_code',
      type: 'string',
      required: false,
      labelPatterns: [
        /IFSC[:\s]*/i,
      ],
    },
  ],

  sections: [
    {
      name: 'consignor_section',
      startMarkers: [/CONSIGNOR/i],
      endMarkers: [/CONSIGNEE/i, /ORDER/i],
      fields: ['consignor'],
    },
    {
      name: 'consignee_section',
      startMarkers: [/CONSIGNEE/i],
      endMarkers: [/ORDER/i, /GOODS/i, /IMPORT/i],
      fields: ['consignee'],
    },
  ],

  tables: [
    {
      name: 'charges',
      headerPatterns: [
        /DESCRIPTION.*(?:I?GST|TAX).*CHARGES/i,
      ],
      columns: [
        { name: 'description', headerPatterns: [/DESCRIPTION/i], type: 'string' },
        { name: 'sac_code', headerPatterns: [/SAC/i], type: 'string' },
        { name: 'tax_rate', headerPatterns: [/I?GST/i], type: 'string' },
        { name: 'tax_amount', headerPatterns: [/I?GST.*INR/i], type: 'amount' },
        { name: 'charge_amount', headerPatterns: [/CHARGES.*INR/i], type: 'amount' },
      ],
    },
  ],
};

// ============================================================================
// Schema Registry
// ============================================================================

/**
 * Booking Confirmation
 *
 * Based on: Hapag-Lloyd Booking Confirmation
 */
export const BOOKING_CONFIRMATION_SCHEMA: DocumentExtractionSchema = {
  documentType: 'booking_confirmation',
  displayName: 'Booking Confirmation',
  category: 'documentation',

  fields: [
    {
      name: 'booking_number',
      type: 'string',
      required: true,
      labelPatterns: [
        /BOOKING\s+(?:NO|NUMBER|#|REF(?:ERENCE)?)[.:\s]*/i,  // Require suffix
        /BOOKING[.:\s]+$/im,  // Or BOOKING at end of line with punctuation
        /BKG\s*(?:NO|#)?[:\s]*/i,
        /REFERENCE[:\s]*/i,
      ],
      // Validate booking number format - reject garbage like "Bkg Pty Ref:"
      validate: (value: string) => {
        // Reject obvious non-booking values
        if (/^(Bkg|Pty|Ref|Reference|Party|Number)[:\s]*$/i.test(value)) return false;
        if (value.includes(':') && value.length < 10) return false;
        // Must have at least some alphanumeric content
        return /^[A-Z0-9]{5,}$/i.test(value.replace(/[-\s]/g, ''));
      },
    },
    {
      name: 'shipper',
      type: 'party',
      required: false,
      labelPatterns: [
        /SHIPPER[:\s]*/i,
        /CONSIGNOR[:\s]*/i,
      ],
    },
    {
      name: 'consignee',
      type: 'party',
      required: false,
      labelPatterns: [
        /CONSIGNEE[:\s]*/i,
      ],
    },
    {
      name: 'vessel_name',
      type: 'string',
      required: false,
      labelPatterns: [
        /VESSEL[:\s]*/i,
        /SHIP\s*NAME[:\s]*/i,
      ],
      // CMA CGM format: "CMA CGM VERDI / 0INLRW1MAVessel/Voyage:" (value BEFORE label)
      // NOTE: Use [A-Z ] (space only) not [A-Z\s] to avoid matching across lines
      valuePatterns: [
        // CMA CGM reversed format: vessel name before " / " and voyage code followed by Vessel/Voyage
        /([A-Z][A-Z ]{2,}[A-Z])\s*\/\s*[A-Z0-9]+\s*(?:Vessel|Voyage)/i,
        // With prefix like "Name-CORNELIA MAERSK-546"
        /Name[-:\s]*([A-Z][A-Z \-]+[A-Z])/i,
        // After VESSEL label: extract 2-4 word names
        /VESSEL[:\s]+([A-Z][A-Z \-\.]{2,25}[A-Z])/i,
      ],
      validate: (value: string) => {
        // Reject obvious garbage
        if (!value || value.length < 3) return false;
        if (/^[\/\s]+$/.test(value)) return false;
        // Reject common non-vessel terms
        if (/Voyage|IMO|Lloyds|Carrier|Load|Disch|ETA|ETD|DATA/i.test(value)) return false;
        if (/OCEAN BILL|HOUSE BILL|LADING/i.test(value)) return false;
        if (/cut\s*off|Connecting|Feeder|Receipt|Delivery/i.test(value)) return false;
        // Must be mostly letters (vessel names are words)
        const letterRatio = (value.match(/[A-Za-z]/g) || []).length / value.length;
        return letterRatio > 0.7;
      },
    },
    {
      name: 'voyage_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /VOYAGE[:\s]*/i,
        /VOY[:\s]*/i,
      ],
      // CMA CGM format: "CMA CGM VERDI / 0INLRW1MAVessel/Voyage:" - voyage is alphanumeric code
      valuePatterns: [
        // CMA CGM reversed format: alphanumeric code before "Vessel/Voyage:" (no space)
        /\/\s*([A-Z0-9]{6,12})(?:Vessel|Voyage)/i,
        // After VOYAGE label
        /VOYAGE[:\s#]+([A-Z0-9]{4,15})/i,
        // Hyphenated like "-546" or "-722"
        /[-](\d{3,6})(?:\s|$)/,
      ],
      validate: (value: string) => {
        // Voyage numbers are short alphanumeric codes
        if (!value || value.length < 3 || value.length > 20) return false;
        if (/Vessel|IMO|Lloyds|Carrier/i.test(value)) return false;
        return /^[A-Z0-9\-]+$/i.test(value);
      },
    },
    {
      name: 'port_of_loading',
      type: 'string',
      required: false,
      labelPatterns: [
        /PORT\s*OF\s*LOADING[:\s]*/i,
        /POL[:\s]*/i,
        /LOADING\s*PORT[:\s]*/i,
      ],
    },
    {
      name: 'port_of_discharge',
      type: 'string',
      required: false,
      labelPatterns: [
        /PORT\s*OF\s*DISCHARGE[:\s]*/i,
        /POD[:\s]*/i,
        /DISCHARGE\s*PORT[:\s]*/i,
      ],
    },
    {
      name: 'etd',
      type: 'date',
      required: false,
      labelPatterns: [
        /ETD[:\s]*/i,
        /DEPARTURE[:\s]*/i,
        /SAILING\s*DATE[:\s]*/i,
      ],
    },
    {
      name: 'eta',
      type: 'date',
      required: false,
      labelPatterns: [
        /ETA[:\s]*/i,
        /ARRIVAL[:\s]*/i,
      ],
    },
    {
      name: 'container_type',
      type: 'string',
      required: false,
      labelPatterns: [
        /CONTAINER\s*(?:TYPE|SIZE)[:\s]*/i,
        /EQUIPMENT[:\s]*/i,
      ],
    },
    {
      name: 'container_count',
      type: 'number',
      required: false,
      labelPatterns: [
        /(?:NO\.?\s*OF\s*)?CONTAINERS?[:\s]*/i,
        /QTY[:\s]*/i,
      ],
    },
    {
      name: 'cargo_type',
      type: 'string',
      required: false,
      labelPatterns: [
        /CARGO\s*(?:TYPE|NATURE)?[:\s]*/i,
        /COMMODITY[:\s]*/i,
      ],
    },
    {
      name: 'weight',
      type: 'weight',
      required: false,
      labelPatterns: [
        /WEIGHT[:\s]*/i,
        /CARGO\s*WEIGHT[:\s]*/i,
      ],
    },
    {
      name: 'vgm_cutoff',
      type: 'date',
      required: false,
      labelPatterns: [
        /VGM\s*(?:CUT[\s-]?OFF)?[:\s]*/i,
      ],
    },
    {
      name: 'si_cutoff',
      type: 'date',
      required: false,
      labelPatterns: [
        /S\.?I\.?\s*(?:CUT[\s-]?OFF)?[:\s]*/i,
        /SHIPPING\s*INSTRUCTION\s*(?:CUT[\s-]?OFF)?[:\s]*/i,
      ],
    },
    {
      name: 'cargo_cutoff',
      type: 'date',
      required: false,
      labelPatterns: [
        /CARGO\s*(?:CUT[\s-]?OFF)?[:\s]*/i,
        /CY\s*(?:CUT[\s-]?OFF)?[:\s]*/i,
      ],
    },
    {
      name: 'free_time',
      type: 'string',
      required: false,
      labelPatterns: [
        /FREE\s*TIME[:\s]*/i,
        /DEMURRAGE[:\s]*/i,
        /DETENTION[:\s]*/i,
      ],
    },
  ],

  sections: [
    {
      name: 'shipper_section',
      startMarkers: [/\bSHIPPER\b/i],
      endMarkers: [/\bCONSIGNEE\b/i, /\bVESSEL\b/i],
      fields: ['shipper'],
    },
    {
      name: 'consignee_section',
      startMarkers: [/\bCONSIGNEE\b/i],
      endMarkers: [/\bNOTIFY\b/i, /\bVESSEL\b/i, /\bPORT\b/i],
      fields: ['consignee'],
    },
  ],
};

/**
 * Delivery Order
 *
 * Based on: Intoglo Pro Forma Invoice (same format, different context)
 */
export const DELIVERY_ORDER_SCHEMA: DocumentExtractionSchema = {
  documentType: 'delivery_order',
  displayName: 'Delivery Order',
  category: 'arrival_delivery',

  fields: [
    {
      name: 'do_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /(?:D\.?O\.?|DELIVERY\s*ORDER)\s*(?:NO|NUMBER|#)?[:\s]*/i,
      ],
    },
    {
      name: 'bl_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /B\/L\s*(?:NO|#)?[:\s]*/i,
        /BILL\s*OF\s*LADING[:\s]*/i,
      ],
    },
    {
      name: 'shipment_reference',
      type: 'string',
      required: false,
      labelPatterns: [
        /SHIPMENTS?[:\s]*/i,
        /CONSOL\s*(?:NO|NUMBER)?[:\s]*/i,
      ],
    },
    {
      name: 'invoice_date',
      type: 'date',
      required: false,
      labelPatterns: [
        /INVOICE\s*DATE[:\s]*/i,
        /DATE[:\s]*/i,
      ],
    },
    {
      name: 'due_date',
      type: 'date',
      required: false,
      labelPatterns: [
        /DUE\s*DATE[:\s]*/i,
      ],
    },
    {
      name: 'customer_id',
      type: 'string',
      required: false,
      labelPatterns: [
        /CUSTOMER\s*ID[:\s]*/i,
      ],
    },
    {
      name: 'consignor',
      type: 'party',
      required: false,
      labelPatterns: [
        /CONSIGNOR[:\s]*/i,
        /SHIPPER[:\s]*/i,
      ],
    },
    {
      name: 'consignee',
      type: 'party',
      required: false,
      labelPatterns: [
        /CONSIGNEE[:\s]*/i,
      ],
    },
    {
      name: 'vessel_voyage',
      type: 'string',
      required: false,
      labelPatterns: [
        /VESSEL\s*\/?\s*VOYAGE[:\s]*/i,
      ],
    },
    {
      name: 'origin',
      type: 'string',
      required: false,
      labelPatterns: [
        /\bORIGIN\b[:\s]*/i,
      ],
    },
    {
      name: 'destination',
      type: 'string',
      required: false,
      labelPatterns: [
        /DESTINATION[:\s]*/i,
      ],
    },
    {
      name: 'etd',
      type: 'date',
      required: false,
      labelPatterns: [
        /\bETD\b[:\s]*/i,
      ],
    },
    {
      name: 'eta',
      type: 'date',
      required: false,
      labelPatterns: [
        /\bETA\b[:\s]*/i,
      ],
    },
    {
      name: 'container_numbers',
      type: 'container',
      required: false,
      labelPatterns: [
        /CONTAINERS?[:\s]*/i,
      ],
    },
    {
      name: 'weight',
      type: 'weight',
      required: false,
      labelPatterns: [
        /\bWEIGHT\b[:\s]*/i,
      ],
    },
    {
      name: 'volume',
      type: 'volume',
      required: false,
      labelPatterns: [
        /\bVOLUME\b[:\s]*/i,
      ],
    },
    {
      name: 'packages',
      type: 'string',
      required: false,
      labelPatterns: [
        /PACKAGES[:\s]*/i,
      ],
    },
    {
      name: 'subtotal',
      type: 'amount',
      required: false,
      labelPatterns: [
        /SUBTOTAL[:\s]*/i,
      ],
    },
    {
      name: 'tax',
      type: 'amount',
      required: false,
      labelPatterns: [
        /I?GST[:\s]*/i,
      ],
    },
    {
      name: 'total',
      type: 'amount',
      required: true,
      labelPatterns: [
        /TOTAL\s*(?:INR|USD)?[:\s]*/i,
        /BALANCE\s*DUE[:\s]*/i,
      ],
    },
  ],

  sections: [
    {
      name: 'consignor_section',
      startMarkers: [/CONSIGNOR/i],
      endMarkers: [/CONSIGNEE/i],
      fields: ['consignor'],
    },
    {
      name: 'consignee_section',
      startMarkers: [/CONSIGNEE/i],
      endMarkers: [/ORDER/i, /GOODS/i, /VESSEL/i],
      fields: ['consignee'],
    },
  ],

  tables: [
    {
      name: 'charges',
      headerPatterns: [
        /DESCRIPTION.*(?:I?GST|TAX).*CHARGES/i,
      ],
      columns: [
        { name: 'description', headerPatterns: [/DESCRIPTION/i], type: 'string' },
        { name: 'sac_code', headerPatterns: [/SAC/i], type: 'string' },
        { name: 'tax_rate', headerPatterns: [/I?GST/i], type: 'string' },
        { name: 'tax_amount', headerPatterns: [/I?GST.*INR/i], type: 'amount' },
        { name: 'charge_amount', headerPatterns: [/CHARGES.*INR/i], type: 'amount' },
      ],
    },
  ],
};

/**
 * ISF Filing (10+2)
 *
 * Import Security Filing required for US imports
 * Based on CBP 10+2 requirements
 */
export const ISF_FILING_SCHEMA: DocumentExtractionSchema = {
  documentType: 'isf_filing',
  displayName: 'ISF Filing (10+2)',
  category: 'us_customs',

  fields: [
    // Filing Information
    {
      name: 'isf_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /ISF\s*(?:NO|NUMBER|#|TRANSACTION)?[:\s]*/i,
        /ISF\s*REFERENCE[:\s]*/i,
      ],
    },
    {
      name: 'filing_date',
      type: 'date',
      required: false,
      labelPatterns: [
        /FILING\s*DATE[:\s]*/i,
        /DATE\s*(?:OF\s*)?FILED[:\s]*/i,
      ],
    },
    {
      name: 'filing_status',
      type: 'string',
      required: false,
      labelPatterns: [
        /STATUS[:\s]*/i,
        /FILING\s*STATUS[:\s]*/i,
      ],
      valuePatterns: [/(ACCEPTED|REJECTED|PENDING|ON\s*FILE)/i],
    },

    // Importer Info (Importer of Record)
    {
      name: 'importer_of_record',
      type: 'party',
      required: false,
      labelPatterns: [
        /IMPORTER\s*(?:OF\s*RECORD)?[:\s]*/i,
        /IOR[:\s]*/i,
      ],
    },
    {
      name: 'importer_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /IMPORTER\s*(?:NO|NUMBER|#|ID)?[:\s]*/i,
        /IOR\s*(?:NO|#)?[:\s]*/i,
      ],
    },

    // Consignee
    {
      name: 'consignee',
      type: 'party',
      required: false,
      labelPatterns: [
        /CONSIGNEE[:\s]*/i,
        /SHIP\s*TO[:\s]*/i,
      ],
    },

    // Seller/Buyer
    {
      name: 'seller',
      type: 'party',
      required: false,
      labelPatterns: [
        /SELLER[:\s]*/i,
        /VENDOR[:\s]*/i,
        /MANUFACTURER[:\s]*/i,
      ],
    },
    {
      name: 'buyer',
      type: 'party',
      required: false,
      labelPatterns: [
        /BUYER[:\s]*/i,
        /PURCHASER[:\s]*/i,
      ],
    },

    // Manufacturer/Supplier
    {
      name: 'manufacturer',
      type: 'party',
      required: false,
      labelPatterns: [
        /MANUFACTURER[:\s]*/i,
        /MFR[:\s]*/i,
      ],
    },
    {
      name: 'country_of_origin',
      type: 'string',
      required: false,
      labelPatterns: [
        /COUNTRY\s*OF\s*ORIGIN[:\s]*/i,
        /ORIGIN[:\s]*/i,
      ],
    },

    // Ship To Party
    {
      name: 'ship_to_party',
      type: 'party',
      required: false,
      labelPatterns: [
        /SHIP\s*TO\s*(?:PARTY)?[:\s]*/i,
        /DELIVERY\s*(?:ADDRESS|LOCATION)[:\s]*/i,
      ],
    },

    // Stuffing Location
    {
      name: 'stuffing_location',
      type: 'string',
      required: false,
      labelPatterns: [
        /STUFFING\s*(?:LOCATION)?[:\s]*/i,
        /CONTAINER\s*STUFFING[:\s]*/i,
      ],
    },

    // Consolidator
    {
      name: 'consolidator',
      type: 'party',
      required: false,
      labelPatterns: [
        /CONSOLIDATOR[:\s]*/i,
      ],
    },

    // Transport Info
    {
      name: 'bl_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /B\/L\s*(?:NO|NUMBER|#)?[:\s]*/i,
        /BILL\s*OF\s*LADING[:\s]*/i,
        /MBL[:\s]*/i,
        /HBL[:\s]*/i,
      ],
    },
    {
      name: 'container_numbers',
      type: 'container',
      required: false,
      labelPatterns: [
        /CONTAINER\s*(?:NO|NUMBER|#)?[:\s]*/i,
      ],
    },
    {
      name: 'vessel_name',
      type: 'string',
      required: false,
      labelPatterns: [
        /VESSEL[:\s]*/i,
      ],
    },
    {
      name: 'voyage_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /VOYAGE[:\s]*/i,
      ],
    },
    {
      name: 'port_of_loading',
      type: 'string',
      required: false,
      labelPatterns: [
        /PORT\s*OF\s*(?:LOADING|LADING)[:\s]*/i,
        /POL[:\s]*/i,
      ],
    },
    {
      name: 'port_of_discharge',
      type: 'string',
      required: false,
      labelPatterns: [
        /PORT\s*OF\s*DISCHARGE[:\s]*/i,
        /POD[:\s]*/i,
      ],
    },
    {
      name: 'estimated_arrival',
      type: 'date',
      required: false,
      labelPatterns: [
        /ETA[:\s]*/i,
        /ESTIMATED\s*ARRIVAL[:\s]*/i,
      ],
    },

    // Cargo Info
    {
      name: 'hs_code',
      type: 'string',
      required: false,
      labelPatterns: [
        /H\.?S\.?\s*(?:CODE|TARIFF)?[:\s]*/i,
        /HTSUS[:\s]*/i,
      ],
    },
    {
      name: 'commodity_description',
      type: 'string',
      required: false,
      labelPatterns: [
        /COMMODITY[:\s]*/i,
        /DESCRIPTION\s*OF\s*GOODS[:\s]*/i,
        /CARGO\s*DESCRIPTION[:\s]*/i,
      ],
    },

    // SCAC
    {
      name: 'scac_code',
      type: 'string',
      required: false,
      labelPatterns: [
        /SCAC[:\s]*/i,
        /CARRIER\s*CODE[:\s]*/i,
      ],
    },
  ],

  sections: [
    {
      name: 'importer_section',
      startMarkers: [/IMPORTER/i],
      endMarkers: [/CONSIGNEE/i, /SELLER/i, /MANUFACTURER/i],
      fields: ['importer_of_record'],
    },
    {
      name: 'consignee_section',
      startMarkers: [/CONSIGNEE/i],
      endMarkers: [/SELLER/i, /MANUFACTURER/i, /BUYER/i],
      fields: ['consignee'],
    },
    {
      name: 'seller_section',
      startMarkers: [/SELLER/i],
      endMarkers: [/BUYER/i, /MANUFACTURER/i, /SHIP\s*TO/i],
      fields: ['seller'],
    },
    {
      name: 'manufacturer_section',
      startMarkers: [/MANUFACTURER/i],
      endMarkers: [/SHIP\s*TO/i, /CONTAINER/i, /COMMODITY/i],
      fields: ['manufacturer'],
    },
  ],
};

/**
 * Shipping Bill (India)
 *
 * India Export Declaration (DGFT format)
 */
export const SHIPPING_BILL_SCHEMA: DocumentExtractionSchema = {
  documentType: 'shipping_bill',
  displayName: 'Shipping Bill (India)',
  category: 'india_customs',

  fields: [
    // SB Details
    {
      name: 'sb_number',
      type: 'string',
      required: true,
      labelPatterns: [
        /S\.?B\.?\s*(?:NO|NUMBER|#)?[:\s]*/i,
        /SHIPPING\s*BILL\s*(?:NO|NUMBER|#)?[:\s]*/i,
      ],
    },
    {
      name: 'sb_date',
      type: 'date',
      required: false,
      labelPatterns: [
        /S\.?B\.?\s*DATE[:\s]*/i,
        /SHIPPING\s*BILL\s*DATE[:\s]*/i,
      ],
    },
    {
      name: 'leo_date',
      type: 'date',
      required: false,
      labelPatterns: [
        /LEO\s*DATE[:\s]*/i,
        /LET\s*EXPORT\s*(?:ORDER\s*)?DATE[:\s]*/i,
      ],
    },

    // Exporter
    {
      name: 'exporter',
      type: 'party',
      required: false,
      labelPatterns: [
        /EXPORTER[:\s]*/i,
        /SHIPPER[:\s]*/i,
      ],
    },
    {
      name: 'exporter_iec',
      type: 'string',
      required: false,
      labelPatterns: [
        /IEC\s*(?:NO|CODE|#)?[:\s]*/i,
        /IMPORTER\s*EXPORTER\s*CODE[:\s]*/i,
      ],
    },
    {
      name: 'exporter_gstin',
      type: 'string',
      required: false,
      labelPatterns: [
        /GSTIN[:\s]*/i,
        /GST\s*(?:NO|NUMBER)?[:\s]*/i,
      ],
    },

    // Consignee
    {
      name: 'consignee',
      type: 'party',
      required: false,
      labelPatterns: [
        /CONSIGNEE[:\s]*/i,
        /BUYER[:\s]*/i,
      ],
    },

    // Port Info
    {
      name: 'port_of_loading',
      type: 'string',
      required: false,
      labelPatterns: [
        /PORT\s*OF\s*(?:LOADING|SHIPMENT)[:\s]*/i,
        /CUSTOMS\s*STATION[:\s]*/i,
      ],
    },
    {
      name: 'port_of_discharge',
      type: 'string',
      required: false,
      labelPatterns: [
        /PORT\s*OF\s*DISCHARGE[:\s]*/i,
        /DESTINATION\s*PORT[:\s]*/i,
      ],
    },
    {
      name: 'country_of_destination',
      type: 'string',
      required: false,
      labelPatterns: [
        /COUNTRY\s*OF\s*(?:FINAL\s*)?DESTINATION[:\s]*/i,
      ],
    },

    // Invoice
    {
      name: 'invoice_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /INVOICE\s*(?:NO|NUMBER|#)?[:\s]*/i,
        /INV\s*(?:NO|#)?[:\s]*/i,
      ],
    },
    {
      name: 'invoice_date',
      type: 'date',
      required: false,
      labelPatterns: [
        /INVOICE\s*DATE[:\s]*/i,
      ],
    },

    // Cargo
    {
      name: 'hs_code',
      type: 'string',
      required: false,
      labelPatterns: [
        /H\.?S\.?\s*CODE[:\s]*/i,
        /CTH[:\s]*/i,
        /RITC[:\s]*/i,
      ],
    },
    {
      name: 'cargo_description',
      type: 'string',
      required: false,
      labelPatterns: [
        /DESCRIPTION\s*(?:OF\s*GOODS)?[:\s]*/i,
        /COMMODITY[:\s]*/i,
      ],
    },
    {
      name: 'gross_weight',
      type: 'weight',
      required: false,
      labelPatterns: [
        /GROSS\s*WEIGHT[:\s]*/i,
        /GR\.?\s*WT[:\s]*/i,
      ],
    },
    {
      name: 'net_weight',
      type: 'weight',
      required: false,
      labelPatterns: [
        /NET\s*WEIGHT[:\s]*/i,
      ],
    },
    {
      name: 'package_count',
      type: 'number',
      required: false,
      labelPatterns: [
        /NO\.?\s*OF\s*(?:PACKAGES|PKGS)[:\s]*/i,
        /PACKAGES[:\s]*/i,
      ],
    },

    // Value
    {
      name: 'fob_value',
      type: 'amount',
      required: false,
      labelPatterns: [
        /FOB\s*VALUE[:\s]*/i,
        /FREE\s*ON\s*BOARD[:\s]*/i,
      ],
    },
    {
      name: 'currency',
      type: 'string',
      required: false,
      labelPatterns: [
        /CURRENCY[:\s]*/i,
      ],
      valuePatterns: [/\b(USD|INR|EUR|GBP)\b/i],
    },

    // Container
    {
      name: 'container_numbers',
      type: 'container',
      required: false,
      labelPatterns: [
        /CONTAINER\s*(?:NO|NUMBER|#)?[:\s]*/i,
      ],
    },
    {
      name: 'seal_numbers',
      type: 'string',
      required: false,
      labelPatterns: [
        /SEAL\s*(?:NO|NUMBER|#)?[:\s]*/i,
      ],
    },

    // Scheme
    {
      name: 'export_scheme',
      type: 'string',
      required: false,
      labelPatterns: [
        /SCHEME[:\s]*/i,
        /EXPORT\s*SCHEME[:\s]*/i,
      ],
    },
    {
      name: 'drawback_amount',
      type: 'amount',
      required: false,
      labelPatterns: [
        /DRAWBACK[:\s]*/i,
        /DBK[:\s]*/i,
      ],
    },
  ],

  sections: [
    {
      name: 'exporter_section',
      startMarkers: [/EXPORTER/i],
      endMarkers: [/CONSIGNEE/i, /PORT/i],
      fields: ['exporter'],
    },
    {
      name: 'consignee_section',
      startMarkers: [/CONSIGNEE/i],
      endMarkers: [/PORT/i, /INVOICE/i],
      fields: ['consignee'],
    },
  ],
};

/**
 * Container Release Order
 *
 * Terminal/CFS release order for container pickup
 */
export const CONTAINER_RELEASE_SCHEMA: DocumentExtractionSchema = {
  documentType: 'container_release',
  displayName: 'Container Release Order',
  category: 'arrival_delivery',

  fields: [
    // Release Info
    {
      name: 'release_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /RELEASE\s*(?:NO|NUMBER|#|ORDER)?[:\s]*/i,
        /DO\s*(?:NO|NUMBER|#)?[:\s]*/i,
        /CRO\s*(?:NO|#)?[:\s]*/i,
      ],
    },
    {
      name: 'release_date',
      type: 'date',
      required: false,
      labelPatterns: [
        /RELEASE\s*DATE[:\s]*/i,
        /DATE\s*(?:OF\s*)?RELEASE[:\s]*/i,
      ],
    },
    {
      name: 'valid_until',
      type: 'date',
      required: false,
      labelPatterns: [
        /VALID\s*(?:UNTIL|THROUGH|TILL)[:\s]*/i,
        /EXPIRY\s*DATE[:\s]*/i,
      ],
    },

    // BL Reference
    {
      name: 'bl_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /B\/L\s*(?:NO|NUMBER|#)?[:\s]*/i,
        /MBL[:\s]*/i,
        /HBL[:\s]*/i,
      ],
    },

    // Consignee
    {
      name: 'consignee',
      type: 'party',
      required: false,
      labelPatterns: [
        /CONSIGNEE[:\s]*/i,
        /RELEASE\s*TO[:\s]*/i,
      ],
    },

    // Notify Party
    {
      name: 'notify_party',
      type: 'party',
      required: false,
      labelPatterns: [
        /NOTIFY[:\s]*/i,
      ],
    },

    // Container Details
    {
      name: 'container_numbers',
      type: 'container',
      required: true,
      labelPatterns: [
        /CONTAINER\s*(?:NO|NUMBER|#)?[:\s]*/i,
      ],
    },
    {
      name: 'container_size',
      type: 'string',
      required: false,
      labelPatterns: [
        /SIZE\s*(?:\/\s*TYPE)?[:\s]*/i,
        /CONTAINER\s*SIZE[:\s]*/i,
      ],
    },
    {
      name: 'seal_numbers',
      type: 'string',
      required: false,
      labelPatterns: [
        /SEAL\s*(?:NO|NUMBER|#)?[:\s]*/i,
      ],
    },

    // Pickup Location
    {
      name: 'pickup_location',
      type: 'string',
      required: false,
      labelPatterns: [
        /PICKUP\s*(?:LOCATION|AT|FROM)?[:\s]*/i,
        /TERMINAL[:\s]*/i,
        /CFS[:\s]*/i,
        /CY[:\s]*/i,
      ],
    },
    {
      name: 'firms_code',
      type: 'string',
      required: false,
      labelPatterns: [
        /FIRMS?\s*(?:CODE|#)?[:\s]*/i,
      ],
    },

    // Empty Return
    {
      name: 'empty_return_location',
      type: 'string',
      required: false,
      labelPatterns: [
        /EMPTY\s*RETURN[:\s]*/i,
        /RETURN\s*(?:LOCATION|TO)[:\s]*/i,
      ],
    },
    {
      name: 'empty_return_cutoff',
      type: 'date',
      required: false,
      labelPatterns: [
        /RETURN\s*(?:BY|CUTOFF|DATE)[:\s]*/i,
        /EMPTY\s*(?:RETURN\s*)?CUTOFF[:\s]*/i,
      ],
    },

    // Vessel Info
    {
      name: 'vessel_name',
      type: 'string',
      required: false,
      labelPatterns: [
        /VESSEL[:\s]*/i,
      ],
    },
    {
      name: 'voyage_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /VOYAGE[:\s]*/i,
      ],
    },

    // Cargo
    {
      name: 'cargo_description',
      type: 'string',
      required: false,
      labelPatterns: [
        /CARGO[:\s]*/i,
        /DESCRIPTION[:\s]*/i,
      ],
    },
    {
      name: 'weight',
      type: 'weight',
      required: false,
      labelPatterns: [
        /WEIGHT[:\s]*/i,
      ],
    },
    {
      name: 'packages',
      type: 'number',
      required: false,
      labelPatterns: [
        /PACKAGES[:\s]*/i,
      ],
    },

    // Charges
    {
      name: 'freight_status',
      type: 'string',
      required: false,
      labelPatterns: [
        /FREIGHT[:\s]*/i,
      ],
      valuePatterns: [/(PREPAID|COLLECT|PAID)/i],
    },
    {
      name: 'charges_due',
      type: 'amount',
      required: false,
      labelPatterns: [
        /CHARGES\s*(?:DUE|PAYABLE)?[:\s]*/i,
        /AMOUNT\s*DUE[:\s]*/i,
      ],
    },

    // Trucker/Transporter
    {
      name: 'trucker_name',
      type: 'string',
      required: false,
      labelPatterns: [
        /TRUCKER[:\s]*/i,
        /TRANSPORTER[:\s]*/i,
        /CARRIER[:\s]*/i,
      ],
    },
    {
      name: 'truck_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /TRUCK\s*(?:NO|NUMBER|#)?[:\s]*/i,
        /VEHICLE\s*(?:NO|#)?[:\s]*/i,
      ],
    },
  ],

  sections: [
    {
      name: 'consignee_section',
      startMarkers: [/CONSIGNEE/i, /RELEASE\s*TO/i],
      endMarkers: [/CONTAINER/i, /PICKUP/i, /VESSEL/i],
      fields: ['consignee'],
    },
  ],
};

/**
 * Proof of Delivery (POD)
 *
 * Delivery confirmation with signature
 */
export const PROOF_OF_DELIVERY_SCHEMA: DocumentExtractionSchema = {
  documentType: 'proof_of_delivery',
  displayName: 'Proof of Delivery',
  category: 'trucking',

  fields: [
    // POD Reference
    {
      name: 'pod_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /POD\s*(?:NO|NUMBER|#)?[:\s]*/i,
        /DELIVERY\s*(?:RECEIPT|CONFIRMATION)\s*(?:NO|#)?[:\s]*/i,
      ],
    },
    {
      name: 'delivery_date',
      type: 'date',
      required: true,
      labelPatterns: [
        /DELIVERY\s*DATE[:\s]*/i,
        /DATE\s*(?:OF\s*)?DELIVERY[:\s]*/i,
        /DELIVERED\s*(?:ON)?[:\s]*/i,
      ],
    },
    {
      name: 'delivery_time',
      type: 'string',
      required: false,
      labelPatterns: [
        /DELIVERY\s*TIME[:\s]*/i,
        /TIME\s*(?:OF\s*)?DELIVERY[:\s]*/i,
      ],
    },

    // References
    {
      name: 'bl_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /B\/L\s*(?:NO|#)?[:\s]*/i,
      ],
    },
    {
      name: 'work_order',
      type: 'string',
      required: false,
      labelPatterns: [
        /WORK\s*ORDER[:\s]*/i,
        /WO\s*(?:NO|#)?[:\s]*/i,
        /DISPATCH\s*(?:NO|#)?[:\s]*/i,
      ],
    },
    {
      name: 'reference_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /REF(?:ERENCE)?\s*(?:NO|#)?[:\s]*/i,
        /ORDER\s*(?:NO|#)?[:\s]*/i,
      ],
    },

    // Container
    {
      name: 'container_numbers',
      type: 'container',
      required: false,
      labelPatterns: [
        /CONTAINER\s*(?:NO|#)?[:\s]*/i,
      ],
    },
    {
      name: 'seal_numbers',
      type: 'string',
      required: false,
      labelPatterns: [
        /SEAL\s*(?:NO|#)?[:\s]*/i,
      ],
    },

    // Delivery Location
    {
      name: 'delivery_address',
      type: 'address',
      required: false,
      labelPatterns: [
        /DELIVERY\s*(?:ADDRESS|LOCATION)[:\s]*/i,
        /DELIVERED\s*TO[:\s]*/i,
        /DESTINATION[:\s]*/i,
      ],
    },
    {
      name: 'consignee',
      type: 'party',
      required: false,
      labelPatterns: [
        /CONSIGNEE[:\s]*/i,
        /RECEIVER[:\s]*/i,
      ],
    },

    // Cargo
    {
      name: 'cargo_description',
      type: 'string',
      required: false,
      labelPatterns: [
        /CARGO[:\s]*/i,
        /DESCRIPTION[:\s]*/i,
        /GOODS[:\s]*/i,
      ],
    },
    {
      name: 'packages_delivered',
      type: 'number',
      required: false,
      labelPatterns: [
        /PACKAGES?\s*(?:DELIVERED)?[:\s]*/i,
        /CARTONS[:\s]*/i,
        /PIECES[:\s]*/i,
      ],
    },
    {
      name: 'weight',
      type: 'weight',
      required: false,
      labelPatterns: [
        /WEIGHT[:\s]*/i,
      ],
    },

    // Condition
    {
      name: 'condition_on_delivery',
      type: 'string',
      required: false,
      labelPatterns: [
        /CONDITION[:\s]*/i,
        /REMARKS[:\s]*/i,
        /DAMAGE[:\s]*/i,
      ],
    },
    {
      name: 'shortages',
      type: 'string',
      required: false,
      labelPatterns: [
        /SHORTAGE[:\s]*/i,
        /SHORT[:\s]*/i,
        /MISSING[:\s]*/i,
      ],
    },

    // Signature
    {
      name: 'received_by',
      type: 'string',
      required: false,
      labelPatterns: [
        /RECEIVED\s*BY[:\s]*/i,
        /SIGNATURE[:\s]*/i,
        /SIGNED\s*BY[:\s]*/i,
      ],
    },

    // Trucker
    {
      name: 'driver_name',
      type: 'string',
      required: false,
      labelPatterns: [
        /DRIVER[:\s]*/i,
        /DELIVERED\s*BY[:\s]*/i,
      ],
    },
    {
      name: 'truck_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /TRUCK\s*(?:NO|#)?[:\s]*/i,
        /VEHICLE\s*(?:NO|#)?[:\s]*/i,
      ],
    },
    {
      name: 'trucker_company',
      type: 'string',
      required: false,
      labelPatterns: [
        /TRUCKER[:\s]*/i,
        /CARRIER[:\s]*/i,
        /TRUCKING\s*CO[:\s]*/i,
      ],
    },
  ],

  sections: [
    {
      name: 'consignee_section',
      startMarkers: [/CONSIGNEE/i, /DELIVERED\s*TO/i],
      endMarkers: [/CARGO/i, /CONTAINER/i, /CONDITION/i],
      fields: ['consignee'],
    },
  ],
};

/**
 * VGM Confirmation
 *
 * Verified Gross Mass certificate (SOLAS requirement)
 */
export const VGM_CONFIRMATION_SCHEMA: DocumentExtractionSchema = {
  documentType: 'vgm_confirmation',
  displayName: 'VGM Confirmation',
  category: 'vgm',

  fields: [
    // VGM Reference
    {
      name: 'vgm_reference',
      type: 'string',
      required: false,
      labelPatterns: [
        /VGM\s*(?:REF(?:ERENCE)?|NO|NUMBER|#)?[:\s]*/i,
      ],
    },
    {
      name: 'submission_date',
      type: 'date',
      required: false,
      labelPatterns: [
        /SUBMISSION\s*DATE[:\s]*/i,
        /VGM\s*DATE[:\s]*/i,
        /DATE[:\s]*/i,
      ],
    },
    {
      name: 'vgm_status',
      type: 'string',
      required: false,
      labelPatterns: [
        /STATUS[:\s]*/i,
        /VGM\s*STATUS[:\s]*/i,
      ],
      valuePatterns: [/(SUBMITTED|CONFIRMED|ACCEPTED|PENDING|REJECTED)/i],
    },

    // Booking/BL Reference
    {
      name: 'booking_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /BOOKING\s*(?:NO|NUMBER|#)?[:\s]*/i,
      ],
    },
    {
      name: 'bl_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /B\/L\s*(?:NO|NUMBER|#)?[:\s]*/i,
      ],
    },

    // Container Info
    {
      name: 'container_number',
      type: 'container',
      required: true,
      labelPatterns: [
        /CONTAINER\s*(?:NO|NUMBER|#)?[:\s]*/i,
      ],
    },
    {
      name: 'container_size',
      type: 'string',
      required: false,
      labelPatterns: [
        /SIZE\s*(?:\/\s*TYPE)?[:\s]*/i,
        /CONTAINER\s*(?:SIZE|TYPE)[:\s]*/i,
      ],
    },
    {
      name: 'seal_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /SEAL\s*(?:NO|NUMBER|#)?[:\s]*/i,
      ],
    },

    // Weight Information (core VGM data)
    {
      name: 'verified_gross_mass',
      type: 'weight',
      required: true,
      labelPatterns: [
        /VGM[:\s]*/i,
        /VERIFIED\s*GROSS\s*MASS[:\s]*/i,
        /GROSS\s*MASS[:\s]*/i,
        /TOTAL\s*WEIGHT[:\s]*/i,
      ],
    },
    {
      name: 'tare_weight',
      type: 'weight',
      required: false,
      labelPatterns: [
        /TARE\s*(?:WEIGHT)?[:\s]*/i,
        /CONTAINER\s*TARE[:\s]*/i,
      ],
    },
    {
      name: 'cargo_weight',
      type: 'weight',
      required: false,
      labelPatterns: [
        /CARGO\s*WEIGHT[:\s]*/i,
        /NET\s*WEIGHT[:\s]*/i,
        /PAYLOAD[:\s]*/i,
      ],
    },
    {
      name: 'dunnage_weight',
      type: 'weight',
      required: false,
      labelPatterns: [
        /DUNNAGE[:\s]*/i,
        /PACKAGING\s*WEIGHT[:\s]*/i,
      ],
    },

    // Weighing Method
    {
      name: 'weighing_method',
      type: 'string',
      required: false,
      labelPatterns: [
        /METHOD[:\s]*/i,
        /WEIGHING\s*METHOD[:\s]*/i,
      ],
      valuePatterns: [/(METHOD\s*[12]|SM[12]|CALCULATED|ACTUAL)/i],
    },
    {
      name: 'weighbridge_name',
      type: 'string',
      required: false,
      labelPatterns: [
        /WEIGHBRIDGE[:\s]*/i,
        /SCALE[:\s]*/i,
      ],
    },
    {
      name: 'weighbridge_certificate',
      type: 'string',
      required: false,
      labelPatterns: [
        /CERTIFICATE\s*(?:NO|#)?[:\s]*/i,
        /CALIBRATION[:\s]*/i,
      ],
    },

    // Shipper Info
    {
      name: 'shipper',
      type: 'party',
      required: false,
      labelPatterns: [
        /SHIPPER[:\s]*/i,
        /EXPORTER[:\s]*/i,
      ],
    },
    {
      name: 'authorized_signatory',
      type: 'string',
      required: false,
      labelPatterns: [
        /AUTHORIZED\s*(?:SIGNATORY|PERSON)[:\s]*/i,
        /SIGNED\s*BY[:\s]*/i,
        /CERTIFIED\s*BY[:\s]*/i,
      ],
    },

    // Vessel/Voyage
    {
      name: 'vessel_name',
      type: 'string',
      required: false,
      labelPatterns: [
        /VESSEL[:\s]*/i,
      ],
    },
    {
      name: 'voyage_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /VOYAGE[:\s]*/i,
      ],
    },
    {
      name: 'port_of_loading',
      type: 'string',
      required: false,
      labelPatterns: [
        /PORT\s*OF\s*LOADING[:\s]*/i,
        /POL[:\s]*/i,
      ],
    },

    // Cutoffs
    {
      name: 'vgm_cutoff',
      type: 'date',
      required: false,
      labelPatterns: [
        /VGM\s*(?:CUT[\s-]?OFF)?[:\s]*/i,
        /CUTOFF[:\s]*/i,
      ],
    },
  ],

  sections: [
    {
      name: 'shipper_section',
      startMarkers: [/SHIPPER/i],
      endMarkers: [/CONTAINER/i, /VESSEL/i, /VGM/i],
      fields: ['shipper'],
    },
  ],
};

/**
 * Booking Amendment
 *
 * Changes to existing booking
 */
export const BOOKING_AMENDMENT_SCHEMA: DocumentExtractionSchema = {
  documentType: 'booking_amendment',
  displayName: 'Booking Amendment',
  category: 'booking',

  fields: [
    // References
    {
      name: 'booking_number',
      type: 'string',
      required: true,
      labelPatterns: [
        /BOOKING\s*(?:NO|NUMBER|#|REF)?[:\s]*/i,
        /BKG\s*(?:NO|#)?[:\s]*/i,
      ],
    },
    {
      name: 'amendment_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /AMENDMENT\s*(?:NO|NUMBER|#)?[:\s]*/i,
        /VERSION[:\s]*/i,
        /REVISION[:\s]*/i,
      ],
    },
    {
      name: 'amendment_date',
      type: 'date',
      required: false,
      labelPatterns: [
        /AMENDMENT\s*DATE[:\s]*/i,
        /DATE\s*(?:OF\s*)?(?:AMENDMENT|CHANGE)[:\s]*/i,
      ],
    },

    // Parties
    {
      name: 'shipper',
      type: 'party',
      required: false,
      labelPatterns: [
        /SHIPPER[:\s]*/i,
      ],
    },
    {
      name: 'consignee',
      type: 'party',
      required: false,
      labelPatterns: [
        /CONSIGNEE[:\s]*/i,
      ],
    },

    // Vessel
    {
      name: 'vessel_name',
      type: 'string',
      required: false,
      labelPatterns: [
        /VESSEL[:\s]*/i,
      ],
    },
    {
      name: 'voyage_number',
      type: 'string',
      required: false,
      labelPatterns: [
        /VOYAGE[:\s]*/i,
      ],
    },

    // Routing
    {
      name: 'port_of_loading',
      type: 'string',
      required: false,
      labelPatterns: [
        /PORT\s*OF\s*LOADING[:\s]*/i,
        /POL[:\s]*/i,
      ],
    },
    {
      name: 'port_of_discharge',
      type: 'string',
      required: false,
      labelPatterns: [
        /PORT\s*OF\s*DISCHARGE[:\s]*/i,
        /POD[:\s]*/i,
      ],
    },

    // Dates
    {
      name: 'etd',
      type: 'date',
      required: false,
      labelPatterns: [
        /ETD[:\s]*/i,
        /DEPARTURE[:\s]*/i,
      ],
    },
    {
      name: 'eta',
      type: 'date',
      required: false,
      labelPatterns: [
        /ETA[:\s]*/i,
        /ARRIVAL[:\s]*/i,
      ],
    },

    // Container
    {
      name: 'container_type',
      type: 'string',
      required: false,
      labelPatterns: [
        /CONTAINER\s*(?:TYPE|SIZE)[:\s]*/i,
        /EQUIPMENT[:\s]*/i,
      ],
    },
    {
      name: 'container_count',
      type: 'number',
      required: false,
      labelPatterns: [
        /(?:NO\.?\s*OF\s*)?CONTAINERS?[:\s]*/i,
        /QTY[:\s]*/i,
      ],
    },

    // Changes
    {
      name: 'change_type',
      type: 'string',
      required: false,
      labelPatterns: [
        /(?:TYPE\s*OF\s*)?CHANGE[:\s]*/i,
        /AMENDMENT\s*TYPE[:\s]*/i,
      ],
    },
    {
      name: 'change_reason',
      type: 'string',
      required: false,
      labelPatterns: [
        /REASON[:\s]*/i,
        /REMARKS[:\s]*/i,
      ],
    },

    // Cutoffs
    {
      name: 'vgm_cutoff',
      type: 'date',
      required: false,
      labelPatterns: [
        /VGM\s*(?:CUT[\s-]?OFF)?[:\s]*/i,
      ],
    },
    {
      name: 'si_cutoff',
      type: 'date',
      required: false,
      labelPatterns: [
        /S\.?I\.?\s*(?:CUT[\s-]?OFF)?[:\s]*/i,
      ],
    },
    {
      name: 'cargo_cutoff',
      type: 'date',
      required: false,
      labelPatterns: [
        /CARGO\s*(?:CUT[\s-]?OFF)?[:\s]*/i,
        /CY\s*(?:CUT[\s-]?OFF)?[:\s]*/i,
      ],
    },
  ],

  sections: [
    {
      name: 'shipper_section',
      startMarkers: [/\bSHIPPER\b/i],
      endMarkers: [/\bCONSIGNEE\b/i, /\bVESSEL\b/i],
      fields: ['shipper'],
    },
    {
      name: 'consignee_section',
      startMarkers: [/\bCONSIGNEE\b/i],
      endMarkers: [/\bVESSEL\b/i, /\bPORT\b/i],
      fields: ['consignee'],
    },
  ],
};

export const DOCUMENT_SCHEMAS: Record<string, DocumentExtractionSchema> = {
  // Bills of Lading - all variations
  'mbl': BL_SCHEMA,
  'hbl': BL_SCHEMA,
  'draft_mbl': BL_SCHEMA,
  'draft_hbl': BL_SCHEMA,
  'bill_of_lading': BL_SCHEMA,
  'bl_draft': BL_SCHEMA,
  'bl_final': BL_SCHEMA,

  // Booking
  'booking_confirmation': BOOKING_CONFIRMATION_SCHEMA,
  'booking': BOOKING_CONFIRMATION_SCHEMA,
  'booking_amendment': BOOKING_AMENDMENT_SCHEMA,

  // Arrival & Delivery
  'arrival_notice': ARRIVAL_NOTICE_SCHEMA,
  'delivery_order': DELIVERY_ORDER_SCHEMA,
  'container_release': CONTAINER_RELEASE_SCHEMA,

  // Trucking
  'proof_of_delivery': PROOF_OF_DELIVERY_SCHEMA,
  'pod': PROOF_OF_DELIVERY_SCHEMA,

  // Financial
  'freight_invoice': FREIGHT_INVOICE_SCHEMA,
  'invoice': FREIGHT_INVOICE_SCHEMA,
  'duty_invoice': FREIGHT_INVOICE_SCHEMA,

  // Documentation
  'shipping_instruction': SHIPPING_INSTRUCTION_SCHEMA,
  'si_draft': SHIPPING_INSTRUCTION_SCHEMA,
  'si_confirmation': SHIPPING_INSTRUCTION_SCHEMA,

  // Export docs
  'packing_list': PACKING_LIST_SCHEMA,
  'commercial_invoice': COMMERCIAL_INVOICE_SCHEMA,

  // US Customs
  'entry_summary': ENTRY_SUMMARY_SCHEMA,
  'isf_filing': ISF_FILING_SCHEMA,
  'isf': ISF_FILING_SCHEMA,

  // India Customs
  'shipping_bill': SHIPPING_BILL_SCHEMA,

  // VGM
  'vgm_confirmation': VGM_CONFIRMATION_SCHEMA,
  'vgm': VGM_CONFIRMATION_SCHEMA,
};

/**
 * Get extraction schema for a document type
 */
export function getExtractionSchema(documentType: string): DocumentExtractionSchema | undefined {
  return DOCUMENT_SCHEMAS[documentType.toLowerCase()];
}

/**
 * Get all supported document types
 */
export function getSupportedDocumentTypes(): string[] {
  return Object.keys(DOCUMENT_SCHEMAS);
}
