/**
 * AI Analyzer Service
 *
 * Handles AI-powered analysis of shipping communications.
 * Uses Anthropic tool_use for structured extraction.
 *
 * Following CLAUDE.md principles:
 * - Single Responsibility (Principle #3)
 * - Configuration Over Code (Principle #5)
 * - Small Functions < 20 lines (Principle #17)
 */

import Anthropic from '@anthropic-ai/sdk';
import { IAiAnalyzer } from './interfaces';
import { ProcessedEmail, ShippingAnalysis, ThreadContext, analyzeShippingCommunicationSchema } from './types';
import {
  AI_CONFIG,
  ANALYZE_TOOL_SCHEMA,
  buildAnalysisPrompt,
  validateExtractedDates,
  checkExpectedDates,
} from './prompts/freight-forwarder.prompt';

// ============================================================================
// ENUM NORMALIZATION - Fixes common AI enum mistakes BEFORE Zod validation
// ============================================================================

/**
 * Hardcoded enum mappings for fast normalization
 * These are the most common AI mistakes that cause validation failures
 */
const ENUM_MAPPINGS: Record<string, Record<string, string>> = {
  document_type: {
    'vgm': 'vgm_confirmation',
    'form_13': 'customs_entry',
    'mbl_amendment': 'booking_amendment',
    'bl_amendment': 'booking_amendment',
    'tr_confirmation': 'telex_release',
    'customs_form': 'customs_entry',
    'customs_clearance': 'customs_entry',
    'amendment': 'booking_amendment',
    'booking_change': 'booking_amendment',
    'hbl_draft': 'house_bl',
    'hbl': 'house_bl',
    'mbl': 'final_bl',
    'seaway_bill': 'sea_waybill',
    'seawaybill': 'sea_waybill',
    // New mappings from audit (eliminates 824 errors)
    'proforma_invoice': 'invoice',
    'service_contract': 'general_correspondence',
    'shipping_label': 'notification',
    'cargo_manifest': 'shipping_instructions',
    'packing_list': 'shipping_instructions',
    'commercial_invoice': 'invoice',
    'freight_invoice': 'invoice',
    'detention_invoice': 'duty_invoice',
    'demurrage_invoice': 'duty_invoice',
    'container_tracking': 'tracking_update',
    'vessel_schedule': 'schedule_update',
    'bl_surrender': 'telex_release',
    'bl_release': 'telex_release',
    'do_release': 'delivery_order',
    'container_deposit': 'invoice',
    'rate_sheet': 'quotation',
    'empty_return': 'notification',
    'pickup_notice': 'notification',
    // Merged vague types (migration 075)
    'acknowledgement': 'approval',
    'internal_communication': 'internal_notification',
    'system_notification': 'internal_notification',
    'tr_submission': 'customs_entry',
  },
  pol_type: {
    'icd': 'port',           // ICD near port treated as port for loading
    'terminal': 'port',
    'seaport': 'port',
    'cfs': 'port',           // CFS near port treated as port
  },
  por_type: {
    'port': 'cfs',           // POR can't be port - likely CFS
    'terminal': 'icd',
    'depot': 'icd',
    'rail_terminal': 'icd',  // Rail terminal maps to ICD
    'ramp': 'icd',           // Rail ramp maps to ICD (75 errors)
  },
  pofd_type: {
    'port': 'cfs',           // POFD can't be port
    'terminal': 'icd',
    'depot': 'icd',
    'rail_terminal': 'icd',  // Rail terminal maps to ICD
    'ramp': 'icd',           // Rail ramp maps to ICD (99 errors)
  },
  pod_type: {
    'icd': 'port',
    'terminal': 'port',
    'ramp': 'port',          // Rail ramp at discharge = port (32 errors)
  },
  message_type: {
    'draft': 'approval',
    'tracking_update': 'update',
    'response': 'approval',
    'reply': 'approval',
    'followup': 'request',
    'reminder': 'action_required',
    'alert': 'notification',
    'notice': 'notification',
    'info': 'notification',
    'fyi': 'notification',
    // New mappings from audit (eliminates 958 errors)
    'quotation': 'request',
    'inquiry': 'request',
    'status_update': 'update',
    'schedule_change': 'update',
    'instruction': 'action_required',
    'compliance': 'notification',
  },
  // New: action_owner mappings (296+ ongoing errors - customs_broker most common)
  action_owner: {
    'customs_broker': 'broker',
    'customs': 'broker',
    'customs_agent': 'broker',
    'trucking': 'trucker',
    'drayage': 'trucker',
    'transport': 'trucker',
    'shipper': 'customer',
    'consignee': 'customer',
    'importer': 'customer',
    'exporter': 'customer',
    'terminal': 'warehouse',
    'port': 'warehouse',
    'shipping_line': 'carrier',
    'nvocc': 'carrier',
  },
  // New: from_party mappings (148 errors)
  from_party: {
    'system_notification': 'notification',
    'system': 'notification',
    'automated': 'system',
    'auto': 'system',
    'trucking': 'trucker',
    'drayage': 'trucker',
    'customs_agent': 'customs_broker',
    'shipping_line': 'ocean_carrier',
    'port_terminal': 'terminal',
  },
  // New: sentiment mappings (25 errors)
  sentiment: {
    'medium': 'neutral',
    'high': 'urgent',
    'low': 'positive',
    'normal': 'neutral',
    'critical': 'urgent',
    'warning': 'negative',
  },
  // New: transport_mode mappings (5 errors)
  transport_mode: {
    'general_correspondence': 'unknown',
    'sea': 'ocean',
    'air_freight': 'air',
    'trucking': 'road',
    'drayage': 'road',
    'intermodal': 'multimodal',
  },
};

/**
 * Normalize AI response before Zod validation
 * Fixes common enum mistakes using hardcoded mappings
 */
function normalizeAiResponse(input: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...input };

  // Normalize each mapped field
  for (const [field, mappings] of Object.entries(ENUM_MAPPINGS)) {
    if (normalized[field] && typeof normalized[field] === 'string') {
      const value = (normalized[field] as string).toLowerCase();
      if (mappings[value]) {
        console.log(`[AiAnalyzer] Normalizing ${field}: ${normalized[field]} → ${mappings[value]}`);
        normalized[field] = mappings[value];
      }
    }
  }

  // Handle NaN in numeric fields (pieces, amount)
  const numericFields = ['pieces', 'amount'];
  for (const field of numericFields) {
    if (normalized[field] !== undefined && normalized[field] !== null) {
      const val = normalized[field];
      // Check for NaN or invalid numeric values
      if (typeof val === 'number' && isNaN(val)) {
        console.log(`[AiAnalyzer] Fixing NaN in ${field} → null`);
        normalized[field] = null;
      } else if (typeof val === 'string') {
        const num = parseFloat(val);
        if (isNaN(num)) {
          console.log(`[AiAnalyzer] Fixing invalid ${field}: ${val} → null`);
          normalized[field] = null;
        } else {
          normalized[field] = num;
        }
      }
    }
  }

  // Handle weight (should be string like "18500 KGS", but AI may return number)
  if (normalized.weight !== undefined && normalized.weight !== null) {
    if (typeof normalized.weight === 'number') {
      // Convert number to string
      normalized.weight = String(normalized.weight);
      console.log(`[AiAnalyzer] Converting weight number → string: ${normalized.weight}`);
    }
  }

  // Truncate summary if too long (Zod max 150, AI sometimes exceeds)
  if (normalized.summary && typeof normalized.summary === 'string') {
    if ((normalized.summary as string).length > 150) {
      console.log(`[AiAnalyzer] Truncating summary: ${(normalized.summary as string).length} → 150 chars`);
      normalized.summary = (normalized.summary as string).substring(0, 147) + '...';
    }
  }

  // Fix container_numbers: AI sometimes returns string instead of array
  if (normalized.container_numbers && typeof normalized.container_numbers === 'string') {
    const cn = normalized.container_numbers as string;
    // Could be comma-separated or single value
    normalized.container_numbers = cn.split(/[,;\s]+/).filter(s => s.trim().length > 0);
    console.log(`[AiAnalyzer] Wrapping container_numbers string → array: ${cn}`);
  }

  // Fix reference_numbers: AI sometimes returns string instead of array
  if (normalized.reference_numbers && typeof normalized.reference_numbers === 'string') {
    const rn = normalized.reference_numbers as string;
    normalized.reference_numbers = rn.split(/[,;\s]+/).filter(s => s.trim().length > 0);
    console.log(`[AiAnalyzer] Wrapping reference_numbers string → array: ${rn}`);
  }

  // ============================================================================
  // FIELD VALIDATION: MBL, Booking Number, Container Numbers
  // ============================================================================

  // MBL should NOT contain carrier names (common AI mistake)
  const CARRIER_NAMES = ['MAERSK', 'HAPAG', 'CMA', 'MSC', 'EVERGREEN', 'COSCO', 'ONE', 'YANG MING', 'HMM'];
  if (normalized.mbl_number && typeof normalized.mbl_number === 'string') {
    const mbl = normalized.mbl_number.toUpperCase();
    for (const carrier of CARRIER_NAMES) {
      if (mbl.includes(carrier + ' ') || mbl.startsWith(carrier + ' ')) {
        // AI put "MAERSK 263216729" as MBL - extract just the number part
        const parts = mbl.split(' ').filter(p => p !== carrier);
        const cleanedMbl = parts.join('');
        console.log(`[AiAnalyzer] Cleaning carrier name from MBL: ${normalized.mbl_number} → ${cleanedMbl || null}`);
        normalized.mbl_number = cleanedMbl || null;
        break;
      }
    }

    // If MBL is purely numeric (like booking number), it's probably wrong
    // Valid MBL format: 4 letters + digits (e.g., MAEU12345678, HLCU98765432)
    const mblValue = normalized.mbl_number as string;
    if (mblValue && /^\d+$/.test(mblValue)) {
      // Pure numeric - likely booking number placed in MBL field
      console.log(`[AiAnalyzer] MBL is pure numeric (likely booking): ${mblValue} → null`);
      normalized.mbl_number = null;
    }
  }

  // Container number validation: must be 4 letters + 7 digits
  if (normalized.container_numbers && Array.isArray(normalized.container_numbers)) {
    const validContainers = (normalized.container_numbers as string[]).filter(cn => {
      if (!cn || typeof cn !== 'string') return false;
      const containerPattern = /^[A-Z]{4}\d{7}$/;
      const isValid = containerPattern.test(cn.toUpperCase());
      if (!isValid) {
        console.log(`[AiAnalyzer] Invalid container number format: ${cn}`);
      }
      return isValid;
    });
    if (validContainers.length !== (normalized.container_numbers as string[]).length) {
      console.log(`[AiAnalyzer] Filtered containers: ${(normalized.container_numbers as string[]).length} → ${validContainers.length}`);
    }
    // Keep as empty array instead of null (Zod schema expects array)
    normalized.container_numbers = validContainers;
  } else if (normalized.container_numbers === null || normalized.container_numbers === undefined) {
    // Ensure it's an empty array if not present
    normalized.container_numbers = [];
  }

  // ============================================================================
  // POL/POD NORMALIZATION - Standardize to UN/LOCODE format
  // ============================================================================
  const locationFields = ['pol_location', 'pod_location', 'por_location', 'pofd_location'];
  for (const field of locationFields) {
    if (normalized[field] && typeof normalized[field] === 'string') {
      const original = normalized[field] as string;
      normalized[field] = normalizePortLocation(original);
    }
  }

  // ============================================================================
  // CARRIER NAME NORMALIZATION - 520 variants → ~15 canonical names
  // ============================================================================
  if (normalized.carrier_name && typeof normalized.carrier_name === 'string') {
    const original = normalized.carrier_name as string;
    normalized.carrier_name = normalizeCarrierName(original);
  }

  // ============================================================================
  // CONTAINER TYPE NORMALIZATION - 127 variants → ~10 standard types
  // ============================================================================
  if (normalized.container_type && typeof normalized.container_type === 'string') {
    const original = normalized.container_type as string;
    normalized.container_type = normalizeContainerType(original);
  }

  // ============================================================================
  // SE-PREFIX DETECTION - Move SEINUS* from mbl_number to work_order_number
  // ============================================================================
  if (normalized.mbl_number && typeof normalized.mbl_number === 'string') {
    const mbl = normalized.mbl_number as string;
    if (/^SE[A-Z]{2,}/i.test(mbl)) {
      console.log(`[AiAnalyzer] Moving SE-prefixed value from mbl_number to work_order: ${mbl}`);
      if (!normalized.work_order_number) {
        normalized.work_order_number = mbl;
      }
      normalized.mbl_number = null;
    }
  }

  return normalized;
}

// ============================================================================
// DATE SWAP DETECTION - Fixes "2nd FEB'26" → 2026-01-02 bug
// ============================================================================

const MONTH_MAP: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
  JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12
};

/**
 * Detect and fix month/day swap in dates
 * AI sometimes outputs "2nd FEB'26" as 2026-01-02 (wrong) instead of 2026-02-02
 */
function detectAndFixDateSwap(
  dateStr: string | null | undefined,
  emailSubject: string
): string | null {
  if (!dateStr) return null;

  // Extract "Xth MMM'YY" pattern from subject
  const subjectDateMatch = emailSubject.match(
    /(\d{1,2})(?:st|nd|rd|th)?\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[''`]?(\d{2})/i
  );

  if (!subjectDateMatch) return dateStr;

  const subjectDay = parseInt(subjectDateMatch[1]);
  const subjectMonth = subjectDateMatch[2].toUpperCase();
  const expectedMonth = MONTH_MAP[subjectMonth];

  if (!expectedMonth) return dateStr;

  // Parse the AI's output date
  const dateParts = dateStr.split('-');
  if (dateParts.length !== 3) return dateStr;

  const [yearStr, monthStr, dayStr] = dateParts;
  const aiMonth = parseInt(monthStr);
  const aiDay = parseInt(dayStr);

  // Check if day/month are swapped
  // AI put day in month position AND month in day position
  if (aiMonth === subjectDay && aiDay === expectedMonth && subjectDay <= 12) {
    const correctedDate = `${yearStr}-${String(expectedMonth).padStart(2, '0')}-${String(subjectDay).padStart(2, '0')}`;
    console.log(`[DateSwapFix] Corrected swapped date: ${dateStr} → ${correctedDate} (from "${subjectDateMatch[0]}")`);
    return correctedDate;
  }

  return dateStr;
}

// ============================================================================
// PORT NORMALIZATION - Standardize POL/POD to UN/LOCODE
// ============================================================================

const PORT_NORMALIZATIONS: Record<string, string> = {
  // Indian Ports
  'nhava sheva': 'INNSA',
  'jawaharlal nehru': 'INNSA',
  'jnpt': 'INNSA',
  'mumbai port': 'INNSA',
  'mundra': 'INMUN',
  'chennai': 'INMAA',
  'kolkata': 'INCCU',
  'tuticorin': 'INTUT',
  'cochin': 'INCOK',
  'pipavav': 'INPAV',
  'hazira': 'INHZA',

  // US Ports
  'new york': 'USNYC',
  'newark': 'USNYC',
  'port newark': 'USNYC',
  'los angeles': 'USLAX',
  'long beach': 'USLGB',
  'chicago': 'USCHI',
  'houston': 'USHOU',
  'savannah': 'USSAV',
  'baltimore': 'USBAL',
  'seattle': 'USSEA',
  'tacoma': 'USSEA',
  'oakland': 'USOAK',
  'norfolk': 'USORF',
  'charleston': 'USCHS',
  'miami': 'USMIA',
  'jacksonville': 'USJAX',
  'port everglades': 'USPEF',

  // Canadian Ports
  'vancouver': 'CAVAN',
  'montreal': 'CAMTR',
  'toronto': 'CATOR',
  'halifax': 'CAHAL',
  'prince rupert': 'CAPRR',

  // Chinese Ports
  'shanghai': 'CNSHA',
  'shenzhen': 'CNSZX',
  'ningbo': 'CNNGB',
  'qingdao': 'CNTAO',
  'hong kong': 'HKHKG',
  'guangzhou': 'CNCAN',
  'xiamen': 'CNXMN',
  'tianjin': 'CNTSN',
  'dalian': 'CNDLC',

  // Southeast Asia
  'singapore': 'SGSIN',
  'port klang': 'MYPKG',
  'tanjung pelepas': 'MYTPP',
  'laem chabang': 'THLCH',
  'ho chi minh': 'VNSGN',
  'cat lai': 'VNSGN',
  'hai phong': 'VNHPH',
  'jakarta': 'IDJKT',
  'tanjung priok': 'IDJKT',
  'manila': 'PHMNS',

  // European Ports
  'rotterdam': 'NLRTM',
  'hamburg': 'DEHAM',
  'antwerp': 'BEANR',
  'felixstowe': 'GBFXT',
  'southampton': 'GBSOU',
  'le havre': 'FRLEH',
  'bremerhaven': 'DEBRV',
  'valencia': 'ESVLC',
  'barcelona': 'ESBCN',
  'genoa': 'ITGOA',
  'piraeus': 'GRPIR',

  // Middle East
  'jebel ali': 'AEJEA',
  'dubai': 'AEJEA',
  'abu dhabi': 'AEAUH',
  'jeddah': 'SAJED',
  'salalah': 'OMSLL',

  // Other
  'colombo': 'LKCMB',
  'port said': 'EGPSD',
  'busan': 'KRPUS',
  'kaohsiung': 'TWKHH',
  'yokohama': 'JPYOK',
  'tokyo': 'JPTYO',
  'sydney': 'AUSYD',
  'melbourne': 'AUMEL',
};

/**
 * Normalize port location to UN/LOCODE format
 * Handles arrays, <UNKNOWN>, and city name variations
 */
function normalizePortLocation(location: string | null | undefined): string | null {
  if (!location) return null;

  let normalized = location;

  // Handle JSON arrays - take first element
  if (normalized.startsWith('[')) {
    try {
      const arr = JSON.parse(normalized);
      if (Array.isArray(arr) && arr.length > 0) {
        normalized = String(arr[0]);
        console.log(`[PortNormalize] Extracted from array: ${location} → ${normalized}`);
      }
    } catch {
      // Not valid JSON, continue with original
    }
  }

  // Reject <UNKNOWN> - return null instead
  if (normalized.includes('UNKNOWN') || normalized === '<UNKNOWN>') {
    console.log(`[PortNormalize] Rejecting <UNKNOWN>: ${location} → null`);
    return null;
  }

  // Already a valid UN/LOCODE (5 uppercase letters)
  if (/^[A-Z]{5}$/.test(normalized)) {
    return normalized;
  }

  // Try to normalize city name to UN/LOCODE
  const searchKey = normalized.toLowerCase().trim();
  for (const [pattern, code] of Object.entries(PORT_NORMALIZATIONS)) {
    if (searchKey.includes(pattern) || pattern.includes(searchKey.substring(0, 5))) {
      console.log(`[PortNormalize] Normalized: ${location} → ${code}`);
      return code;
    }
  }

  // Check if it looks like "City, XX" format
  const cityCountryMatch = normalized.match(/^([A-Za-z\s]+),\s*([A-Z]{2})$/);
  if (cityCountryMatch) {
    const city = cityCountryMatch[1].toLowerCase().trim();
    for (const [pattern, code] of Object.entries(PORT_NORMALIZATIONS)) {
      if (city.includes(pattern) || pattern.includes(city.substring(0, 5))) {
        console.log(`[PortNormalize] Normalized city,country: ${location} → ${code}`);
        return code;
      }
    }
  }

  // Return original if no normalization found (but it's usable)
  // Only log if it's not already in a reasonable format
  if (!/^[A-Z]{2}[A-Z]{3}$/.test(normalized) && normalized.length > 3) {
    console.log(`[PortNormalize] Unknown format (keeping as-is): ${location}`);
  }

  return normalized;
}

// ============================================================================
// CARRIER NAME NORMALIZATION - 520 variants → ~15 canonical names
// ============================================================================

const CARRIER_NORMALIZATIONS: Record<string, string> = {
  // Maersk variants
  'maersk line': 'Maersk', 'maersk': 'Maersk', 'a.p. moller': 'Maersk',
  'a.p. moller - maersk': 'Maersk', 'ap moller': 'Maersk', 'maersk a/s': 'Maersk',
  'sealand': 'Maersk', 'sealand - a maersk company': 'Maersk',
  // Hapag-Lloyd variants
  'hapag-lloyd': 'Hapag-Lloyd', 'hapag lloyd': 'Hapag-Lloyd', 'hapag': 'Hapag-Lloyd',
  'hlcl': 'Hapag-Lloyd',
  // CMA CGM variants
  'cma cgm': 'CMA CGM', 'cma-cgm': 'CMA CGM', 'cma': 'CMA CGM',
  'anl': 'CMA CGM', 'anl container line': 'CMA CGM',
  'apl': 'CMA CGM', 'american president lines': 'CMA CGM',
  // MSC variants
  'msc': 'MSC', 'mediterranean shipping': 'MSC', 'mediterranean shipping company': 'MSC',
  // COSCO variants
  'cosco': 'COSCO', 'cosco shipping': 'COSCO', 'cosco shipping lines': 'COSCO',
  'oocl': 'COSCO', 'orient overseas container line': 'COSCO',
  // Evergreen variants
  'evergreen': 'Evergreen', 'evergreen marine': 'Evergreen', 'evergreen line': 'Evergreen',
  // ONE variants
  'one': 'ONE', 'ocean network express': 'ONE',
  // Yang Ming variants
  'yang ming': 'Yang Ming', 'yang ming marine': 'Yang Ming', 'yang ming line': 'Yang Ming',
  // HMM variants
  'hmm': 'HMM', 'hyundai merchant marine': 'HMM', 'hyundai': 'HMM',
  // ZIM variants
  'zim': 'ZIM', 'zim integrated shipping': 'ZIM', 'zim line': 'ZIM',
  // Hamburg Sud variants
  'hamburg sud': 'Hamburg Sud', 'hamburg süd': 'Hamburg Sud',
  // Wan Hai variants
  'wan hai': 'Wan Hai Lines', 'wan hai lines': 'Wan Hai Lines',
  // PIL variants
  'pil': 'PIL', 'pacific international lines': 'PIL',
  // SM Line variants
  'sm line': 'SM Line', 'sinokor': 'SM Line',
  // Matson variants
  'matson': 'Matson', 'matson navigation': 'Matson',
  // Crowley variants
  'crowley': 'Crowley', 'crowley maritime': 'Crowley',
};

/**
 * Normalize carrier name to canonical form
 * Handles case-insensitive matching and common abbreviations
 */
function normalizeCarrierName(name: string): string {
  const searchKey = name.toLowerCase().trim();

  // Direct match
  if (CARRIER_NORMALIZATIONS[searchKey]) {
    return CARRIER_NORMALIZATIONS[searchKey];
  }

  // Partial match (carrier name contains a known pattern)
  for (const [pattern, canonical] of Object.entries(CARRIER_NORMALIZATIONS)) {
    if (searchKey.includes(pattern)) {
      return canonical;
    }
  }

  // Return original if no match (preserve AI's extraction)
  return name;
}

// ============================================================================
// CONTAINER TYPE NORMALIZATION - 127 variants → ~10 standard types
// ============================================================================

const CONTAINER_TYPE_PATTERNS: Array<{ pattern: RegExp; standard: string }> = [
  // 20ft standard
  { pattern: /20\s*(?:ft|foot|feet|')?\s*(?:gp|standard|dry|general\s*purpose|dc|st)/i, standard: '20GP' },
  { pattern: /^20\s*(?:gp|dc|st)$/i, standard: '20GP' },
  { pattern: /^20'?\s*$/i, standard: '20GP' },
  // 40ft standard
  { pattern: /40\s*(?:ft|foot|feet|')?\s*(?:gp|standard|dry|general\s*purpose|dc|st)/i, standard: '40GP' },
  { pattern: /^40\s*(?:gp|dc|st)$/i, standard: '40GP' },
  // 40ft high cube (most common)
  { pattern: /40\s*(?:ft|foot|feet|')?\s*(?:hc|hq|high\s*cube|hi[\s-]?cube)/i, standard: '40HC' },
  { pattern: /^40\s*(?:hc|hq)$/i, standard: '40HC' },
  // 45ft high cube
  { pattern: /45\s*(?:ft|foot|feet|')?\s*(?:hc|hq|high\s*cube|hi[\s-]?cube)/i, standard: '45HC' },
  { pattern: /^45\s*(?:hc|hq)$/i, standard: '45HC' },
  // 20ft reefer
  { pattern: /20\s*(?:ft|foot|feet|')?\s*(?:rf|reefer|refrigerated)/i, standard: '20RF' },
  { pattern: /^20\s*rf$/i, standard: '20RF' },
  // 40ft reefer
  { pattern: /40\s*(?:ft|foot|feet|')?\s*(?:rf|reefer|refrigerated)/i, standard: '40RF' },
  { pattern: /^40\s*rf$/i, standard: '40RF' },
  // 40ft reefer high cube
  { pattern: /40\s*(?:ft|foot|feet|')?\s*(?:rh|reefer\s*h(?:igh)?\s*c(?:ube)?)/i, standard: '40RH' },
  { pattern: /^40\s*rh$/i, standard: '40RH' },
  // Open top
  { pattern: /20\s*(?:ft|foot|feet|')?\s*(?:ot|open\s*top)/i, standard: '20OT' },
  { pattern: /40\s*(?:ft|foot|feet|')?\s*(?:ot|open\s*top)/i, standard: '40OT' },
  // Flat rack
  { pattern: /20\s*(?:ft|foot|feet|')?\s*(?:fr|flat\s*rack)/i, standard: '20FR' },
  { pattern: /40\s*(?:ft|foot|feet|')?\s*(?:fr|flat\s*rack)/i, standard: '40FR' },
  // Tank
  { pattern: /20\s*(?:ft|foot|feet|')?\s*(?:tk|tank)/i, standard: '20TK' },
  { pattern: /40\s*(?:ft|foot|feet|')?\s*(?:tk|tank)/i, standard: '40TK' },
];

/**
 * Normalize container type to industry standard code
 * E.g., "40 feet high cube" → "40HC", "20ft standard" → "20GP"
 */
function normalizeContainerType(type: string): string {
  const cleaned = type.trim();

  // Already standard format (e.g., 40HC, 20GP)
  if (/^\d{2}[A-Z]{2}$/.test(cleaned)) {
    return cleaned;
  }

  for (const { pattern, standard } of CONTAINER_TYPE_PATTERNS) {
    if (pattern.test(cleaned)) {
      return standard;
    }
  }

  // Return original if no match
  return cleaned;
}

// ============================================================================
// AI ANALYZER IMPLEMENTATION
// ============================================================================

export class AiAnalyzer implements IAiAnalyzer {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic();
  }

  /**
   * Analyze email and attachments using AI
   * @param threadContext - Optional context from previous emails in thread
   * @param threadPosition - Position in thread (1 = first, 2+ = reply/forward)
   *                         Position 2+ ignores subject (stale from forwarding)
   * @param modelOverride - Optional model override for escalation (e.g., 'claude-sonnet-4-20250514')
   * @param semanticContextSection - Optional pre-built semantic context section for prompt
   */
  async analyze(
    email: ProcessedEmail,
    attachmentText: string,
    threadContext?: ThreadContext,
    threadPosition: number = 1,
    modelOverride?: string,
    semanticContextSection?: string
  ): Promise<ShippingAnalysis> {
    const includeSubject = threadPosition === 1;
    const prompt = this.buildPrompt(email, attachmentText, threadContext, includeSubject, semanticContextSection);
    const response = await this.callAnthropic(prompt, modelOverride);
    return this.parseResponse(response, email.receivedAt, email.subject);
  }

  // ==========================================================================
  // PRIVATE HELPERS - Each < 20 lines
  // ==========================================================================

  private buildPrompt(
    email: ProcessedEmail,
    attachmentText: string,
    threadContext?: ThreadContext,
    includeSubject: boolean = true,
    semanticContextSection?: string
  ): string {
    const bodyPreview = email.bodyText.substring(0, AI_CONFIG.maxBodyChars);
    let prompt = buildAnalysisPrompt(
      email.subject,
      bodyPreview,
      attachmentText,
      email.receivedAt,
      threadContext,
      includeSubject
    );

    // Append semantic context if provided (similar emails, sender patterns, related docs)
    if (semanticContextSection) {
      prompt = prompt + '\n' + semanticContextSection;
    }

    return prompt;
  }

  private async callAnthropic(prompt: string, modelOverride?: string): Promise<Anthropic.Message> {
    const model = modelOverride || AI_CONFIG.model;
    if (modelOverride) {
      console.log(`[AiAnalyzer] Using escalated model: ${model}`);
    }
    return await this.anthropic.messages.create({
      model,
      max_tokens: AI_CONFIG.maxTokens,
      tools: [ANALYZE_TOOL_SCHEMA],
      tool_choice: { type: 'tool', name: 'analyze_freight_communication' },
      messages: [{ role: 'user', content: prompt }],
    });
  }

  private parseResponse(response: Anthropic.Message, emailDate?: Date, emailSubject?: string): ShippingAnalysis {
    const toolUse = response.content.find((c) => c.type === 'tool_use');
    if (!toolUse || toolUse.type !== 'tool_use') {
      throw new Error('No tool use in AI response');
    }

    // Normalize AI response BEFORE Zod validation
    // This fixes common enum mistakes like 'vgm' → 'vgm_confirmation'
    const normalizedInput = normalizeAiResponse(toolUse.input as Record<string, unknown>);

    // Parse the normalized response
    const parsed = analyzeShippingCommunicationSchema.parse(normalizedInput);

    // ========================================================================
    // DATE SWAP FIX: Detect and fix "2nd FEB'26" → 2026-01-02 bug
    // AI sometimes puts day in month position and month in day position
    // ========================================================================
    const subject = emailSubject || '';
    const dateSwapFixed = {
      etd: detectAndFixDateSwap(parsed.etd, subject),
      eta: detectAndFixDateSwap(parsed.eta, subject),
      si_cutoff: detectAndFixDateSwap(parsed.si_cutoff, subject),
      vgm_cutoff: detectAndFixDateSwap(parsed.vgm_cutoff, subject),
      cargo_cutoff: detectAndFixDateSwap(parsed.cargo_cutoff, subject),
      doc_cutoff: detectAndFixDateSwap(parsed.doc_cutoff, subject),
      last_free_day: detectAndFixDateSwap(parsed.last_free_day, subject),
      action_deadline: detectAndFixDateSwap(parsed.action_deadline, subject),
    };

    // Validate and correct dates using 3-layer defense
    // Layer 1: Year range (2024-2028)
    // Layer 2: Field-specific rules (LFD only from arrival docs)
    // Layer 3: Contextual validation (ETD < ETA < LFD)
    const validatedDates = validateExtractedDates(
      dateSwapFixed,
      emailDate,
      parsed.document_type // Pass document type for field-specific validation
    );

    // Check extraction quality - log warning if expected dates missing
    const { missing, coverage } = checkExpectedDates(parsed.document_type, validatedDates);
    if (missing.length > 0 && coverage < 80) {
      // Low coverage for key doc types is worth investigating
      console.warn(
        `[AiAnalyzer] Low date coverage (${coverage}%) for ${parsed.document_type}: missing ${missing.join(', ')}`
      );
    }

    // Return with validated dates (convert undefined to null for type safety)
    return {
      ...parsed,
      etd: validatedDates.etd ?? null,
      eta: validatedDates.eta ?? null,
      si_cutoff: validatedDates.si_cutoff ?? null,
      vgm_cutoff: validatedDates.vgm_cutoff ?? null,
      cargo_cutoff: validatedDates.cargo_cutoff ?? null,
      doc_cutoff: validatedDates.doc_cutoff ?? null,
      last_free_day: validatedDates.last_free_day ?? null,
      action_deadline: validatedDates.action_deadline ?? null,
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

export function createAiAnalyzer(): IAiAnalyzer {
  return new AiAnalyzer();
}
