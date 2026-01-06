/**
 * Sender-Aware Extractor Service
 *
 * Intelligent extraction service that:
 * 1. Detects sender category from email domain
 * 2. Loads sender-specific extraction configs from database
 * 3. Prioritizes extraction based on sender's typical entity patterns
 * 4. Uses deep regex patterns for customs, demurrage, inland entities
 *
 * Single Responsibility: Coordinate extraction based on sender context.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  SENDER_CATEGORY_PATTERNS,
  IT_NUMBER_PATTERNS,
  ISF_NUMBER_PATTERNS,
  AMS_NUMBER_PATTERNS,
  HS_CODE_PATTERNS,
  SEAL_NUMBER_PATTERNS,
  WEIGHT_PATTERNS,
  VOLUME_PATTERNS,
  PACKAGE_PATTERNS,
  CONTAINER_TYPE_PATTERNS,
  DEMURRAGE_DATE_KEYWORDS,
  FREE_TIME_PATTERNS,
  APPOINTMENT_PATTERNS,
  INLAND_LOCATION_PATTERNS,
  TEMPERATURE_PATTERNS,
  INCOTERMS_PATTERNS,
  AMOUNT_PATTERNS,
  REFERENCE_NUMBER_PATTERNS,
  DATE_PATTERNS,
  PatternDefinition,
  WeightPatternDefinition,
  AmountPatternDefinition,
  DemurrageDateKeyword,
} from './pattern-definitions';
import {
  RegexExtractor,
  ExtractionResult,
  DateExtractionResult,
} from './regex-extractors';

// ============================================================================
// Types
// ============================================================================

export type SenderCategory =
  | 'maersk'
  | 'hapag'
  | 'cma_cgm'
  | 'msc'
  | 'cosco'
  | 'one_line'
  | 'evergreen'
  | 'yang_ming'
  | 'customs_broker'
  | 'freight_forwarder'
  | 'terminal'
  | 'trucking'
  | 'rail'
  | 'other_carrier'
  | 'other';

export interface SenderExtractionConfig {
  entity_type_id: string;
  display_name: string;
  category: string;
  data_type: string;
  priority: number;
  is_required: boolean;
  confidence_threshold: number;
  is_critical: boolean;
  is_linkable: boolean;
}

export interface ExtractedEntity {
  entityType: string;
  entityValue: string;
  entityNormalized?: string;
  confidence: number;
  method: string;
  sourceType: 'email' | 'document';
  priority: number;
  isRequired: boolean;
  isCritical: boolean;
  isLinkable: boolean;
  context?: string;
  metadata?: Record<string, unknown>;
}

export interface SenderAwareExtractionInput {
  emailId: string;
  senderEmail: string;
  trueSenderEmail?: string;
  subject: string;
  bodyText: string;
  sourceType: 'email' | 'document';
  documentType?: string;
}

export interface SenderAwareExtractionResult {
  senderCategory: SenderCategory;
  extractions: ExtractedEntity[];
  metadata: {
    totalExtracted: number;
    requiredFound: number;
    requiredMissing: string[];
    criticalFound: number;
    linkableFound: number;
    avgConfidence: number;
    processingTimeMs: number;
  };
}

// ============================================================================
// False Positive Validators
// ============================================================================

/**
 * Check if a value looks like an Indian phone number.
 * Indian mobile numbers: 10 digits starting with 7, 8, or 9
 */
function isLikelyPhoneNumber(value: string): boolean {
  const cleanValue = value.replace(/[-\s]/g, '');

  // Indian mobile: 10 digits starting with 7, 8, or 9
  if (/^[789]\d{9}$/.test(cleanValue)) return true;

  // International format: starts with + or 00
  if (/^\+?\d{10,15}$/.test(cleanValue) && /^[789]/.test(cleanValue)) return true;

  return false;
}

/**
 * Check if a value looks like an HS code (not a booking number).
 * HS codes: 8 digits starting with specific chapter codes (01-97)
 */
function isLikelyHSCode(value: string): boolean {
  const cleanValue = value.replace(/[.\s-]/g, '');

  // HS codes are 6-10 digits, often with specific chapter prefixes
  // Common HS chapters for cargo: 73 (iron/steel), 84 (machinery), 85 (electrical), 94 (furniture)
  if (/^(73|84|85|94|39|72|40|87|61|62|63|69|70)\d{4,8}$/.test(cleanValue)) {
    return true;
  }

  return false;
}

/**
 * Check if a value is a common garbage word.
 */
function isGarbageWord(value: string): boolean {
  const garbagePatterns = [
    /^(thanks|thank you|regards|best|dear|hi|hello)$/i,
    /^(is|at|to|from|the|and|or|for|with|by|in|on)$/i,
    /^(support|manager|team|group|department|dept)$/i,
    /^(email|mail|message|reply|forward|fwd)$/i,
    /^(gmail|yahoo|outlook|hotmail)$/i,
    /^[a-z]{1,2}$/i,  // Single or double letter
    /^=.*>$/,  // URL fragments
    /^\w+@\w+/,  // Email fragments
    /^https?:/i,  // URLs
    /^\d{1,3}$/,  // Very short numbers
  ];

  return garbagePatterns.some(p => p.test(value.trim()));
}

/**
 * Check if value is valid for container number (ISO 6346 format).
 */
function isValidContainerNumber(value: string): boolean {
  // Must be 11 chars: 4 letters + 7 digits
  const containerPattern = /^[A-Z]{4}\d{7}$/;
  return containerPattern.test(value.toUpperCase());
}

/**
 * Check if value exists in source text (prevents hallucinations).
 * Allows for minor formatting differences (spaces, case).
 */
function valueExistsInSource(value: string, sourceText: string): boolean {
  if (!value || !sourceText) return true; // Skip check if no source

  const normalizedValue = value.toLowerCase().replace(/[\s-]/g, '');
  const normalizedSource = sourceText.toLowerCase().replace(/[\s-]/g, '');

  // Direct substring match
  if (normalizedSource.includes(normalizedValue)) return true;

  // For alphanumeric values, try exact match with word boundaries
  if (/^[a-z0-9]+$/i.test(value)) {
    const regex = new RegExp(`\\b${value}\\b`, 'i');
    if (regex.test(sourceText)) return true;
  }

  return false;
}

/**
 * Validate extracted value based on entity type.
 * Returns true if value should be kept, false if it's a false positive.
 */
function validateExtraction(entityType: string, value: string, context?: string, sourceText?: string): boolean {
  // Skip empty values
  if (!value || value.trim().length < 2) return false;

  // Skip garbage words
  if (isGarbageWord(value)) return false;

  // Verify value exists in source (prevents hallucinations)
  if (sourceText && !valueExistsInSource(value, sourceText)) {
    return false;
  }

  // Entity-specific validation
  switch (entityType) {
    case 'booking_number':
      // Reject if looks like phone number
      if (isLikelyPhoneNumber(value)) return false;
      // Reject if looks like HS code
      if (isLikelyHSCode(value)) return false;
      // Check context for phone-related keywords
      if (context?.match(/(?:phone|mobile|cell|tel|fax|contact|call)\s*[:=]?\s*$/i)) return false;
      // Check context for +91 prefix
      if (context?.match(/\+91[-\s]?$/)) return false;
      break;

    case 'container_number':
      // Must match ISO 6346 format
      if (!isValidContainerNumber(value)) return false;
      break;

    case 'seal_number':
      // Reject if matches container pattern (MAEU, HLCU, etc.)
      if (/^(MAEU|MSKU|HLCU|HLXU|CMAU|COSU|MSCU|TCLU|TRLU)\d+$/i.test(value)) return false;
      break;

    case 'voyage_number':
      // Must contain at least one digit
      if (!/\d/.test(value)) return false;
      // Reject common non-voyage words
      if (/^(solutions?|service|express|shipping|lines?)$/i.test(value)) return false;
      break;

    case 'vessel_name':
      // Must be at least 3 chars and not contain common non-vessel words
      if (value.length < 3) return false;
      // Reject common sentence fragments
      if (/\b(for the|is the|of the|to the|from the|eta is|etd is)\b/i.test(value)) return false;
      // Reject if all lowercase (vessel names are typically capitalized)
      if (value === value.toLowerCase()) return false;
      // Reject if contains only common words
      if (/^(the|a|an|month|year|day|time)\b/i.test(value)) return false;
      break;

    case 'entry_number':
      // Must follow entry format (digits with dashes)
      if (!/^\d{3}[-\s]?\d{7,8}[-\s]?\d?$/.test(value) && !/^[A-Z0-9]{3}-\d{8}$/.test(value)) {
        return false;
      }
      break;

    case 'appointment_number':
      // Must contain digits
      if (!/\d/.test(value)) return false;
      break;

    case 'port_of_loading':
    case 'port_of_discharge':
    case 'place_of_receipt':
    case 'place_of_delivery':
    case 'inland_destination':
      // Must be at least 3 chars and start with capital letter
      if (value.length < 3 || !/^[A-Z]/.test(value)) return false;
      // Reject fragments and partial words
      if (/^(t |ing |ion |er |ed |ort |tion |ment |ager |team |port )/.test(value.toLowerCase())) return false;
      // Reject if contains common non-place words
      if (/\b(manager|team|solutions|support|department|dept|group|services?)\b/i.test(value)) return false;
      // Reject if too many words (likely a sentence fragment)
      if (value.split(/\s+/).length > 4) return false;
      // Reject if contains special characters (except comma, period, hyphen)
      if (/[<>=@#$%^&*(){}[\]|\\]/.test(value)) return false;
      // Reject newlines
      if (/[\n\r]/.test(value)) return false;
      break;

    default:
      break;
  }

  return true;
}

// ============================================================================
// Sender Category Detector
// ============================================================================

export class SenderCategoryDetector {
  /**
   * Detect sender category from email address.
   */
  detect(senderEmail: string): SenderCategory {
    const email = senderEmail.toLowerCase();
    const domain = email.split('@')[1] || '';

    for (const [category, patterns] of Object.entries(SENDER_CATEGORY_PATTERNS)) {
      for (const pattern of patterns) {
        if (pattern.test(email) || pattern.test(domain)) {
          return category as SenderCategory;
        }
      }
    }

    // Check for carrier-like domains
    if (domain.includes('line') || domain.includes('shipping')) {
      return 'other_carrier';
    }

    return 'other';
  }

  /**
   * Detect with fallback to true sender.
   */
  detectWithFallback(senderEmail: string, trueSenderEmail?: string): SenderCategory {
    // Try true sender first (more accurate)
    if (trueSenderEmail) {
      const trueSenderCategory = this.detect(trueSenderEmail);
      if (trueSenderCategory !== 'other') {
        return trueSenderCategory;
      }
    }

    return this.detect(senderEmail);
  }
}

// ============================================================================
// Sender-Aware Extractor
// ============================================================================

export class SenderAwareExtractor {
  private categoryDetector: SenderCategoryDetector;
  private regexExtractor: RegexExtractor;
  private configCache: Map<string, SenderExtractionConfig[]> = new Map();

  constructor(private supabase: SupabaseClient) {
    this.categoryDetector = new SenderCategoryDetector();
    this.regexExtractor = new RegexExtractor();
  }

  /**
   * Extract entities with sender-aware prioritization.
   */
  async extract(input: SenderAwareExtractionInput): Promise<SenderAwareExtractionResult> {
    const startTime = Date.now();

    // 1. Detect sender category
    const senderCategory = this.categoryDetector.detectWithFallback(
      input.senderEmail,
      input.trueSenderEmail
    );

    // 2. Load sender-specific config
    const config = await this.loadConfig(senderCategory, input.sourceType);

    // 3. Run base regex extraction
    const baseResults = this.regexExtractor.extract({
      subject: input.subject,
      bodyText: input.bodyText,
    });

    // 4. Run deep extraction for sender-specific entities
    const deepResults = await this.runDeepExtraction(input, config);

    // 5. Merge and prioritize results with source verification
    const sourceText = `${input.subject}\n${input.bodyText}`;
    const extractions = this.mergeAndPrioritize(baseResults, deepResults, config, input.sourceType, sourceText);

    // 6. Calculate metadata
    const requiredConfigs = config.filter((c) => c.is_required);
    const requiredTypes = new Set(requiredConfigs.map((c) => c.entity_type_id));
    const foundTypes = new Set(extractions.map((e) => e.entityType));
    const requiredMissing = Array.from(requiredTypes).filter((t) => !foundTypes.has(t));

    return {
      senderCategory,
      extractions,
      metadata: {
        totalExtracted: extractions.length,
        requiredFound: requiredConfigs.filter((c) => foundTypes.has(c.entity_type_id)).length,
        requiredMissing,
        criticalFound: extractions.filter((e) => e.isCritical).length,
        linkableFound: extractions.filter((e) => e.isLinkable).length,
        avgConfidence:
          extractions.length > 0
            ? Math.round(extractions.reduce((sum, e) => sum + e.confidence, 0) / extractions.length)
            : 0,
        processingTimeMs: Date.now() - startTime,
      },
    };
  }

  /**
   * Load sender-specific extraction config from database.
   */
  private async loadConfig(
    senderCategory: SenderCategory,
    sourceType: 'email' | 'document'
  ): Promise<SenderExtractionConfig[]> {
    const cacheKey = `${senderCategory}:${sourceType}`;

    if (this.configCache.has(cacheKey)) {
      return this.configCache.get(cacheKey)!;
    }

    const { data, error } = await this.supabase.rpc('get_extraction_config', {
      p_sender_category: senderCategory,
      p_source_type: sourceType,
    });

    if (error) {
      console.error('[SenderAwareExtractor] Error loading config:', error);
      // Fallback to 'other' category
      return this.loadConfig('other', sourceType);
    }

    const config = (data || []) as SenderExtractionConfig[];
    this.configCache.set(cacheKey, config);
    return config;
  }

  /**
   * Run deep extraction for sender-specific entity types.
   */
  private async runDeepExtraction(
    input: SenderAwareExtractionInput,
    config: SenderExtractionConfig[]
  ): Promise<ExtractedEntity[]> {
    const extractions: ExtractedEntity[] = [];
    const text = `${input.subject}\n${input.bodyText}`;
    const configTypes = new Set(config.map((c) => c.entity_type_id));

    // IT Number (Customs)
    if (configTypes.has('it_number')) {
      const itResults = this.extractWithPatterns(text, IT_NUMBER_PATTERNS);
      for (const r of itResults) {
        extractions.push(this.toExtractedEntity('it_number', r, input.sourceType, config));
      }
    }

    // ISF Number
    if (configTypes.has('isf_number')) {
      const isfResults = this.extractWithPatterns(text, ISF_NUMBER_PATTERNS);
      for (const r of isfResults) {
        extractions.push(this.toExtractedEntity('isf_number', r, input.sourceType, config));
      }
    }

    // AMS Number
    if (configTypes.has('ams_number')) {
      const amsResults = this.extractWithPatterns(text, AMS_NUMBER_PATTERNS);
      for (const r of amsResults) {
        extractions.push(this.toExtractedEntity('ams_number', r, input.sourceType, config));
      }
    }

    // HS Code
    if (configTypes.has('hs_code')) {
      const hsResults = this.extractWithPatterns(text, HS_CODE_PATTERNS);
      for (const r of hsResults) {
        extractions.push(this.toExtractedEntity('hs_code', r, input.sourceType, config));
      }
    }

    // Seal Number
    if (configTypes.has('seal_number')) {
      const sealResults = this.extractWithPatterns(text, SEAL_NUMBER_PATTERNS);
      for (const r of sealResults) {
        extractions.push(this.toExtractedEntity('seal_number', r, input.sourceType, config));
      }
    }

    // Container Type
    if (configTypes.has('container_type')) {
      const typeResults = this.extractWithPatterns(text, CONTAINER_TYPE_PATTERNS);
      for (const r of typeResults) {
        extractions.push(this.toExtractedEntity('container_type', r, input.sourceType, config));
      }
    }

    // Weights (gross, net, tare, vgm)
    this.extractWeights(text, configTypes, extractions, input.sourceType, config);

    // Volume (CBM)
    if (configTypes.has('volume_cbm')) {
      const volResults = this.extractWithPatterns(text, VOLUME_PATTERNS);
      for (const r of volResults) {
        extractions.push(this.toExtractedEntity('volume_cbm', r, input.sourceType, config));
      }
    }

    // Package Count
    if (configTypes.has('package_count')) {
      const pkgResults = this.extractWithPatterns(text, PACKAGE_PATTERNS);
      for (const r of pkgResults) {
        extractions.push(this.toExtractedEntity('package_count', r, input.sourceType, config));
      }
    }

    // Free Time Days
    if (configTypes.has('free_time_days')) {
      const ftResults = this.extractWithPatterns(text, FREE_TIME_PATTERNS);
      for (const r of ftResults) {
        extractions.push(this.toExtractedEntity('free_time_days', r, input.sourceType, config));
      }
    }

    // Demurrage Dates (LFD, cargo available, etc.)
    this.extractDemurrageDates(text, configTypes, extractions, input.sourceType, config);

    // Appointment Number
    if (configTypes.has('appointment_number')) {
      const apptResults = this.extractWithPatterns(text, APPOINTMENT_PATTERNS);
      for (const r of apptResults) {
        extractions.push(this.toExtractedEntity('appointment_number', r, input.sourceType, config));
      }
    }

    // Inland Locations
    this.extractInlandLocations(text, configTypes, extractions, input.sourceType, config);

    // Temperature
    if (configTypes.has('temperature_setting')) {
      const tempResults = this.extractWithPatterns(text, TEMPERATURE_PATTERNS);
      for (const r of tempResults) {
        extractions.push(this.toExtractedEntity('temperature_setting', r, input.sourceType, config));
      }
    }

    // Incoterms
    if (configTypes.has('incoterms')) {
      const incResults = this.extractWithPatterns(text, INCOTERMS_PATTERNS);
      for (const r of incResults) {
        extractions.push(this.toExtractedEntity('incoterms', r, input.sourceType, config));
      }
    }

    // Financial Amounts
    this.extractAmounts(text, configTypes, extractions, input.sourceType, config);

    // Reference Numbers (PO, Job, Invoice)
    this.extractReferences(text, configTypes, extractions, input.sourceType, config);

    return extractions;
  }

  /**
   * Extract weights by type.
   */
  private extractWeights(
    text: string,
    configTypes: Set<string>,
    extractions: ExtractedEntity[],
    sourceType: 'email' | 'document',
    config: SenderExtractionConfig[]
  ): void {
    const weightTypeMap: Record<string, string> = {
      gross: 'gross_weight_kg',
      net: 'net_weight_kg',
      tare: 'tare_weight_kg',
      vgm: 'vgm_weight_kg',
    };

    for (const pattern of WEIGHT_PATTERNS) {
      const entityType = weightTypeMap[pattern.weightType];
      if (!entityType || !configTypes.has(entityType)) continue;

      pattern.pattern.lastIndex = 0;
      const match = pattern.pattern.exec(text);
      if (match) {
        const value = match[pattern.captureGroup || 1] || match[0];
        extractions.push(
          this.toExtractedEntity(
            entityType,
            {
              value: value.replace(/,/g, ''),
              confidence: pattern.confidence,
              method: 'regex',
              pattern: pattern.description,
            },
            sourceType,
            config
          )
        );
      }
    }
  }

  /**
   * Extract demurrage-related dates.
   */
  private extractDemurrageDates(
    text: string,
    configTypes: Set<string>,
    extractions: ExtractedEntity[],
    sourceType: 'email' | 'document',
    config: SenderExtractionConfig[]
  ): void {
    for (const demDef of DEMURRAGE_DATE_KEYWORDS) {
      if (!configTypes.has(demDef.fieldName)) continue;

      for (const keyword of demDef.keywords) {
        keyword.lastIndex = 0;
        const keywordMatch = keyword.exec(text);
        if (keywordMatch) {
          // Look for date after keyword
          const afterKeyword = text.slice(keywordMatch.index + keywordMatch[0].length, keywordMatch.index + keywordMatch[0].length + 100);
          const dateResult = this.findFirstDate(afterKeyword);
          if (dateResult) {
            extractions.push(
              this.toExtractedEntity(
                demDef.fieldName,
                {
                  value: dateResult.value,
                  confidence: (dateResult.confidence + demDef.confidence) / 2,
                  method: 'regex',
                  pattern: `${demDef.fieldName} with date`,
                },
                sourceType,
                config
              )
            );
            break;
          }
        }
      }
    }
  }

  /**
   * Extract inland location types.
   */
  private extractInlandLocations(
    text: string,
    configTypes: Set<string>,
    extractions: ExtractedEntity[],
    sourceType: 'email' | 'document',
    config: SenderExtractionConfig[]
  ): void {
    const locationFields = ['inland_destination', 'ramp_location', 'warehouse_location', 'depot_location'];

    for (const field of locationFields) {
      if (!configTypes.has(field)) continue;

      const results = this.extractWithPatterns(text, INLAND_LOCATION_PATTERNS);
      for (const r of results) {
        extractions.push(this.toExtractedEntity(field, r, sourceType, config));
      }
    }
  }

  /**
   * Extract financial amounts.
   */
  private extractAmounts(
    text: string,
    configTypes: Set<string>,
    extractions: ExtractedEntity[],
    sourceType: 'email' | 'document',
    config: SenderExtractionConfig[]
  ): void {
    const amountTypeMap: Record<string, string> = {
      freight: 'freight_amount',
      demurrage: 'demurrage_amount',
      detention: 'detention_amount',
      total: 'total_amount',
    };

    for (const pattern of AMOUNT_PATTERNS) {
      if (!pattern.amountType) continue;

      const entityType = amountTypeMap[pattern.amountType];
      if (!entityType || !configTypes.has(entityType)) continue;

      pattern.pattern.lastIndex = 0;
      const match = pattern.pattern.exec(text);
      if (match) {
        const value = match[pattern.captureGroup || 1] || match[0];
        extractions.push(
          this.toExtractedEntity(
            entityType,
            {
              value: value.replace(/,/g, ''),
              confidence: pattern.confidence,
              method: 'regex',
              pattern: pattern.description,
            },
            sourceType,
            config
          )
        );
      }
    }
  }

  /**
   * Extract reference numbers.
   */
  private extractReferences(
    text: string,
    configTypes: Set<string>,
    extractions: ExtractedEntity[],
    sourceType: 'email' | 'document',
    config: SenderExtractionConfig[]
  ): void {
    const refFields = ['po_number', 'job_number', 'invoice_number', 'reference_number'];

    for (const field of refFields) {
      if (!configTypes.has(field)) continue;

      const results = this.extractWithPatterns(text, REFERENCE_NUMBER_PATTERNS);
      for (const r of results) {
        // Map based on pattern description
        if (r.pattern?.includes('PO') && field === 'po_number') {
          extractions.push(this.toExtractedEntity(field, r, sourceType, config));
        } else if (r.pattern?.includes('Job') && field === 'job_number') {
          extractions.push(this.toExtractedEntity(field, r, sourceType, config));
        } else if (r.pattern?.includes('Invoice') && field === 'invoice_number') {
          extractions.push(this.toExtractedEntity(field, r, sourceType, config));
        }
      }
    }
  }

  /**
   * Generic pattern extraction helper.
   */
  private extractWithPatterns(text: string, patterns: PatternDefinition[]): ExtractionResult[] {
    const results: ExtractionResult[] = [];
    const seen = new Set<string>();

    for (const patternDef of patterns) {
      patternDef.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = patternDef.pattern.exec(text)) !== null) {
        const captureGroup = patternDef.captureGroup ?? 1;
        const value = (match[captureGroup] ?? match[0]).trim();

        if (!seen.has(value)) {
          results.push({
            value,
            confidence: patternDef.confidence,
            method: 'regex',
            pattern: patternDef.description,
            position: match.index,
            context: text.slice(Math.max(0, match.index - 30), match.index + value.length + 30),
          });
          seen.add(value);
        }

        if (match[0].length === 0) {
          patternDef.pattern.lastIndex++;
        }
      }
    }

    return results;
  }

  /**
   * Find first date in text.
   */
  private findFirstDate(text: string): DateExtractionResult | null {
    for (const patternDef of DATE_PATTERNS) {
      patternDef.pattern.lastIndex = 0;
      const match = patternDef.pattern.exec(text);
      if (match) {
        return {
          value: match[0],
          confidence: patternDef.confidence,
          method: 'regex',
          pattern: patternDef.description,
          parsedDate: match[1] || match[0],
          hasTime: patternDef.hasTime ?? false,
        };
      }
    }
    return null;
  }

  /**
   * Convert extraction result to entity with config metadata.
   */
  private toExtractedEntity(
    entityType: string,
    result: ExtractionResult,
    sourceType: 'email' | 'document',
    config: SenderExtractionConfig[]
  ): ExtractedEntity {
    const entityConfig = config.find((c) => c.entity_type_id === entityType);

    return {
      entityType,
      entityValue: result.value,
      confidence: result.confidence,
      method: result.method || 'regex',
      sourceType,
      priority: entityConfig?.priority ?? 50,
      isRequired: entityConfig?.is_required ?? false,
      isCritical: entityConfig?.is_critical ?? false,
      isLinkable: entityConfig?.is_linkable ?? false,
      context: result.context,
    };
  }

  /**
   * Merge base and deep extractions, prioritize by config.
   * Applies validation to filter out false positives and hallucinations.
   */
  private mergeAndPrioritize(
    baseResults: ReturnType<RegexExtractor['extract']>,
    deepResults: ExtractedEntity[],
    config: SenderExtractionConfig[],
    sourceType: 'email' | 'document',
    sourceText: string
  ): ExtractedEntity[] {
    const extractions: ExtractedEntity[] = [];
    const seen = new Set<string>();

    // Convert base results to ExtractedEntity format with validation
    const baseToEntity = (type: string, results: ExtractionResult[]): void => {
      for (const r of results) {
        // Validate extraction to filter false positives and verify source
        if (!validateExtraction(type, r.value, r.context, sourceText)) {
          continue;
        }

        const key = `${type}:${r.value}`;
        if (!seen.has(key)) {
          extractions.push(this.toExtractedEntity(type, r, sourceType, config));
          seen.add(key);
        }
      }
    };

    // Add base results
    baseToEntity('booking_number', baseResults.bookingNumbers);
    baseToEntity('container_number', baseResults.containerNumbers);
    baseToEntity('bl_number', baseResults.blNumbers);
    baseToEntity('entry_number', baseResults.entryNumbers);

    // Add single-value extractions with source verification
    if (baseResults.etd && validateExtraction('etd', baseResults.etd.value, undefined, sourceText)) {
      extractions.push(this.toExtractedEntity('etd', baseResults.etd, sourceType, config));
    }
    if (baseResults.eta && validateExtraction('eta', baseResults.eta.value, undefined, sourceText)) {
      extractions.push(this.toExtractedEntity('eta', baseResults.eta, sourceType, config));
    }
    if (baseResults.portOfLoading && validateExtraction('port_of_loading', baseResults.portOfLoading.value, undefined, sourceText)) {
      extractions.push(this.toExtractedEntity('port_of_loading', baseResults.portOfLoading, sourceType, config));
    }
    if (baseResults.portOfDischarge && validateExtraction('port_of_discharge', baseResults.portOfDischarge.value, undefined, sourceText)) {
      extractions.push(this.toExtractedEntity('port_of_discharge', baseResults.portOfDischarge, sourceType, config));
    }
    if (baseResults.vessel && validateExtraction('vessel_name', baseResults.vessel.value, undefined, sourceText)) {
      extractions.push(this.toExtractedEntity('vessel_name', baseResults.vessel, sourceType, config));
    }
    if (baseResults.voyage && validateExtraction('voyage_number', baseResults.voyage.value, undefined, sourceText)) {
      extractions.push(this.toExtractedEntity('voyage_number', baseResults.voyage, sourceType, config));
    }
    if (baseResults.placeOfReceipt && validateExtraction('place_of_receipt', baseResults.placeOfReceipt.value, undefined, sourceText)) {
      extractions.push(this.toExtractedEntity('place_of_receipt', baseResults.placeOfReceipt, sourceType, config));
    }
    if (baseResults.placeOfDelivery && validateExtraction('place_of_delivery', baseResults.placeOfDelivery.value, undefined, sourceText)) {
      extractions.push(this.toExtractedEntity('place_of_delivery', baseResults.placeOfDelivery, sourceType, config));
    }

    // Add cutoffs
    for (const cutoff of baseResults.cutoffs) {
      extractions.push(
        this.toExtractedEntity(
          cutoff.cutoffType,
          { value: cutoff.value, confidence: cutoff.confidence, method: 'regex' },
          sourceType,
          config
        )
      );
    }

    // Add deep results with validation and source verification (avoid duplicates)
    for (const entity of deepResults) {
      // Validate before adding with source verification
      if (!validateExtraction(entity.entityType, entity.entityValue, entity.context, sourceText)) {
        continue;
      }

      const key = `${entity.entityType}:${entity.entityValue}`;
      if (!seen.has(key)) {
        extractions.push(entity);
        seen.add(key);
      }
    }

    // Sort by priority (highest first), then by confidence
    return extractions.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.confidence - a.confidence;
    });
  }

  /**
   * Clear config cache (for testing or config updates).
   */
  clearCache(): void {
    this.configCache.clear();
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createSenderAwareExtractor(supabase: SupabaseClient): SenderAwareExtractor {
  return new SenderAwareExtractor(supabase);
}

export function createSenderCategoryDetector(): SenderCategoryDetector {
  return new SenderCategoryDetector();
}
