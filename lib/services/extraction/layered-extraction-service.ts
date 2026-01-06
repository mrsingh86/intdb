/**
 * Layered Extraction Service
 *
 * Implements a cost-effective, high-accuracy extraction strategy:
 * 1. Regex-First: Run deterministic patterns (fast, high confidence)
 * 2. Gap Analysis: Identify missing/low-confidence fields
 * 3. AI Validation: Fill gaps using AI (targeted, not full extraction)
 * 4. Confidence Merge: Prioritize high-confidence results
 *
 * Design Principles:
 * - Deep Module: Simple extract() interface, complex layered implementation
 * - Single Responsibility: Orchestration layer only, delegates to extractors
 * - Configuration Over Code: Confidence thresholds from pattern-definitions
 */

import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import {
  RegexExtractor,
  RegexExtractionResults,
  ExtractionResult,
  DateExtractionResult,
  CutoffExtractionResult,
  ExtractorInput,
} from './regex-extractors';
import {
  CONFIDENCE_THRESHOLDS,
  CRITICAL_FIELDS,
  IMPORTANT_FIELDS,
} from './pattern-definitions';
import { ShipmentData } from '../shipment-extraction-service';
import { EntityType, ExtractionMethod } from '@/types/email-intelligence';

// ============================================================================
// Types
// ============================================================================

export interface LayeredExtractionInput {
  emailId: string;
  subject: string;
  bodyText: string;
  pdfContent?: string;
  carrier?: string;
  documentType?: string;
}

export interface LayeredExtractionResult {
  success: boolean;
  data: ExtractedData | null;
  error?: string;
  metadata: ExtractionMetadata;
}

export interface ExtractedData {
  // Primary Identifiers
  booking_number: string | null;
  bl_number: string | null;
  mbl_number: string | null;
  hbl_number: string | null;
  container_numbers: string[];
  entry_number: string | null;

  // Carrier & Voyage
  carrier: string | null;
  vessel_name: string | null;
  voyage_number: string | null;

  // Routing
  port_of_loading: string | null;
  port_of_loading_code: string | null;
  port_of_discharge: string | null;
  port_of_discharge_code: string | null;
  place_of_receipt: string | null;
  place_of_delivery: string | null;

  // Dates
  etd: string | null;
  eta: string | null;

  // Cutoffs
  si_cutoff: string | null;
  vgm_cutoff: string | null;
  cargo_cutoff: string | null;
  gate_cutoff: string | null;
  doc_cutoff: string | null;

  // Parties (AI only - too complex for regex)
  shipper_name: string | null;
  consignee_name: string | null;
  notify_party: string | null;

  // Cargo (AI only)
  commodity_description: string | null;
  container_type: string | null;
  weight_kg: number | null;
  volume_cbm: number | null;
  incoterms: string | null;
}

export interface ExtractionMetadata {
  processingTime: number;
  regexTime: number;
  aiTime: number;
  regexFieldCount: number;
  aiFieldCount: number;
  totalFieldCount: number;
  regexConfidence: number;
  overallConfidence: number;
  strategy: 'regex_only' | 'regex_plus_ai' | 'ai_fallback';
  fieldSources: Record<string, 'regex' | 'ai' | 'regex_subject'>;
  aiCalled: boolean;
  aiReason?: string;
}

interface FieldExtraction {
  value: string | number | string[] | null;
  confidence: number;
  source: 'regex' | 'regex_subject' | 'ai';
}

// ============================================================================
// Service Implementation
// ============================================================================

export class LayeredExtractionService {
  private regexExtractor: RegexExtractor;
  private anthropic: Anthropic;
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient, anthropicApiKey: string) {
    this.supabase = supabase;
    this.regexExtractor = new RegexExtractor();
    this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
  }

  /**
   * Main extraction entry point - implements layered strategy
   */
  async extract(input: LayeredExtractionInput): Promise<LayeredExtractionResult> {
    const startTime = Date.now();
    let regexTime = 0;
    let aiTime = 0;

    try {
      // Combine content for extraction
      const combinedText = `${input.subject}\n${input.bodyText}\n${input.pdfContent || ''}`;
      const extractorInput: ExtractorInput = {
        subject: input.subject,
        bodyText: `${input.bodyText}\n${input.pdfContent || ''}`,
        carrier: input.carrier,
      };

      // =====================================================================
      // LAYER 1: Regex Extraction (Fast, Deterministic)
      // =====================================================================
      const regexStartTime = Date.now();
      const regexResults = this.regexExtractor.extract(extractorInput);
      regexTime = Date.now() - regexStartTime;

      // Convert regex results to field extractions
      const extractedFields = this.convertRegexToFields(regexResults);

      // Calculate regex coverage
      const regexCoverage = this.calculateCoverage(extractedFields);
      const regexConfidence = this.calculateOverallConfidence(extractedFields);

      // =====================================================================
      // LAYER 2: Gap Analysis - Determine if AI is needed
      // =====================================================================
      const gaps = this.identifyGaps(extractedFields, input.documentType);
      const needsAI = this.shouldCallAI(gaps, regexConfidence, input.documentType);

      let aiFields: Map<string, FieldExtraction> = new Map();
      let aiReason: string | undefined;

      // =====================================================================
      // LAYER 3: AI Extraction (Targeted, Cost-Effective)
      // =====================================================================
      if (needsAI.shouldCall) {
        aiReason = needsAI.reason;
        const aiStartTime = Date.now();

        // Only request AI for missing/low-confidence fields
        aiFields = await this.extractWithAI(
          combinedText,
          gaps,
          input.carrier || regexResults.carrier || 'unknown',
          input.documentType
        );

        aiTime = Date.now() - aiStartTime;
      }

      // =====================================================================
      // LAYER 4: Confidence-Based Merge
      // =====================================================================
      const mergedFields = this.mergeExtractions(extractedFields, aiFields);

      // Build final extracted data
      const data = this.buildExtractedData(mergedFields);

      // Build metadata
      const fieldSources: Record<string, 'regex' | 'ai' | 'regex_subject'> = {};
      let regexFieldCount = 0;
      let aiFieldCount = 0;

      for (const [field, extraction] of mergedFields.entries()) {
        if (extraction.value !== null) {
          fieldSources[field] = extraction.source;
          if (extraction.source === 'ai') {
            aiFieldCount++;
          } else {
            regexFieldCount++;
          }
        }
      }

      const metadata: ExtractionMetadata = {
        processingTime: Date.now() - startTime,
        regexTime,
        aiTime,
        regexFieldCount,
        aiFieldCount,
        totalFieldCount: regexFieldCount + aiFieldCount,
        regexConfidence,
        overallConfidence: this.calculateOverallConfidence(mergedFields),
        strategy: needsAI.shouldCall ? 'regex_plus_ai' : 'regex_only',
        fieldSources,
        aiCalled: needsAI.shouldCall,
        aiReason,
      };

      return {
        success: true,
        data,
        metadata,
      };

    } catch (error: any) {
      return {
        success: false,
        data: null,
        error: error.message,
        metadata: {
          processingTime: Date.now() - startTime,
          regexTime,
          aiTime,
          regexFieldCount: 0,
          aiFieldCount: 0,
          totalFieldCount: 0,
          regexConfidence: 0,
          overallConfidence: 0,
          strategy: 'ai_fallback',
          fieldSources: {},
          aiCalled: false,
        },
      };
    }
  }

  /**
   * Convert regex extraction results to field extraction map
   */
  private convertRegexToFields(
    results: RegexExtractionResults
  ): Map<string, FieldExtraction> {
    const fields = new Map<string, FieldExtraction>();

    // Helper to get best result from array
    const getBest = (arr: ExtractionResult[]): FieldExtraction | null => {
      if (!arr.length) return null;
      const best = arr[0]; // Already sorted by confidence
      return {
        value: best.value,
        confidence: best.confidence,
        source: best.method,
      };
    };

    // Helper for date results
    const getDateBest = (result: DateExtractionResult | null): FieldExtraction | null => {
      if (!result) return null;
      return {
        value: result.parsedDate,
        confidence: result.confidence,
        source: result.method,
      };
    };

    // Helper for port results
    const getPortBest = (result: ExtractionResult | null): FieldExtraction | null => {
      if (!result) return null;
      return {
        value: result.value,
        confidence: result.confidence,
        source: result.method,
      };
    };

    // Carrier
    if (results.carrier) {
      fields.set('carrier', { value: results.carrier, confidence: 90, source: 'regex' });
    }

    // Identifiers
    const bookingBest = getBest(results.bookingNumbers);
    if (bookingBest) fields.set('booking_number', bookingBest);

    // Container numbers (collect all high-confidence)
    const containers = results.containerNumbers
      .filter(c => c.confidence >= CONFIDENCE_THRESHOLDS.MEDIUM)
      .map(c => c.value);
    if (containers.length) {
      fields.set('container_numbers', {
        value: containers,
        confidence: results.containerNumbers[0]?.confidence || 0,
        source: results.containerNumbers[0]?.method || 'regex',
      });
    }

    // BL numbers
    const blBest = getBest(results.blNumbers);
    if (blBest) fields.set('bl_number', blBest);

    // Entry numbers
    const entryBest = getBest(results.entryNumbers);
    if (entryBest) fields.set('entry_number', entryBest);

    // Dates
    const etdBest = getDateBest(results.etd);
    if (etdBest) fields.set('etd', etdBest);

    const etaBest = getDateBest(results.eta);
    if (etaBest) fields.set('eta', etaBest);

    // Cutoffs
    for (const cutoff of results.cutoffs) {
      fields.set(cutoff.cutoffType, {
        value: cutoff.parsedDate,
        confidence: cutoff.confidence,
        source: cutoff.method,
      });
    }

    // Ports
    const polBest = getPortBest(results.portOfLoading);
    if (polBest) fields.set('port_of_loading', polBest);

    const polCodeBest = getPortBest(results.portOfLoadingCode);
    if (polCodeBest) fields.set('port_of_loading_code', polCodeBest);

    const podBest = getPortBest(results.portOfDischarge);
    if (podBest) fields.set('port_of_discharge', podBest);

    const podCodeBest = getPortBest(results.portOfDischargeCode);
    if (podCodeBest) fields.set('port_of_discharge_code', podCodeBest);

    const porBest = getPortBest(results.placeOfReceipt);
    if (porBest) fields.set('place_of_receipt', porBest);

    const podlBest = getPortBest(results.placeOfDelivery);
    if (podlBest) fields.set('place_of_delivery', podlBest);

    // Vessel & Voyage
    const vesselBest = getPortBest(results.vessel);
    if (vesselBest) fields.set('vessel_name', vesselBest);

    const voyageBest = getPortBest(results.voyage);
    if (voyageBest) fields.set('voyage_number', voyageBest);

    return fields;
  }

  /**
   * Calculate coverage percentage of critical fields
   */
  private calculateCoverage(fields: Map<string, FieldExtraction>): number {
    let covered = 0;
    for (const field of CRITICAL_FIELDS) {
      const extraction = fields.get(field);
      if (extraction && extraction.confidence >= CONFIDENCE_THRESHOLDS.MEDIUM) {
        covered++;
      }
    }
    return (covered / CRITICAL_FIELDS.length) * 100;
  }

  /**
   * Calculate overall confidence score
   */
  private calculateOverallConfidence(fields: Map<string, FieldExtraction>): number {
    let totalWeight = 0;
    let weightedSum = 0;

    // Critical fields: weight 3
    for (const field of CRITICAL_FIELDS) {
      const extraction = fields.get(field);
      if (extraction && extraction.value !== null) {
        weightedSum += extraction.confidence * 3;
        totalWeight += 3;
      }
    }

    // Important fields: weight 2
    for (const field of IMPORTANT_FIELDS) {
      const extraction = fields.get(field);
      if (extraction && extraction.value !== null) {
        weightedSum += extraction.confidence * 2;
        totalWeight += 2;
      }
    }

    // Other fields: weight 1
    for (const [field, extraction] of fields) {
      if (
        !CRITICAL_FIELDS.includes(field as any) &&
        !IMPORTANT_FIELDS.includes(field as any) &&
        extraction.value !== null
      ) {
        weightedSum += extraction.confidence;
        totalWeight += 1;
      }
    }

    return totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;
  }

  /**
   * Identify gaps in extraction that need AI
   */
  private identifyGaps(
    fields: Map<string, FieldExtraction>,
    documentType?: string
  ): string[] {
    const gaps: string[] = [];

    // Always check critical fields
    for (const field of CRITICAL_FIELDS) {
      const extraction = fields.get(field);
      if (!extraction || extraction.confidence < CONFIDENCE_THRESHOLDS.MEDIUM) {
        gaps.push(field);
      }
    }

    // Check important fields
    for (const field of IMPORTANT_FIELDS) {
      const extraction = fields.get(field);
      if (!extraction || extraction.confidence < CONFIDENCE_THRESHOLDS.LOW) {
        gaps.push(field);
      }
    }

    // Document-type specific requirements
    if (documentType === 'bill_of_lading' || documentType === 'hbl' || documentType === 'hbl_draft') {
      // BL documents need party information
      const partyFields = ['shipper_name', 'consignee_name', 'notify_party'];
      for (const field of partyFields) {
        if (!fields.has(field)) {
          gaps.push(field);
        }
      }
    }

    return gaps;
  }

  /**
   * Determine if AI should be called based on gaps and confidence
   */
  private shouldCallAI(
    gaps: string[],
    regexConfidence: number,
    documentType?: string
  ): { shouldCall: boolean; reason: string } {
    // Always call AI if too many critical gaps
    const criticalGaps = gaps.filter(g =>
      CRITICAL_FIELDS.includes(g as any)
    ).length;

    if (criticalGaps >= 3) {
      return {
        shouldCall: true,
        reason: `${criticalGaps} critical fields missing`,
      };
    }

    // Always call AI for documents that need party extraction
    if (documentType === 'hbl' || documentType === 'hbl_draft' || documentType === 'si_draft') {
      return {
        shouldCall: true,
        reason: `Document type ${documentType} requires party extraction`,
      };
    }

    // Call AI if confidence is too low
    if (regexConfidence < CONFIDENCE_THRESHOLDS.MEDIUM) {
      return {
        shouldCall: true,
        reason: `Low regex confidence: ${regexConfidence}%`,
      };
    }

    // Don't call AI if we have good coverage
    if (gaps.length <= 2 && regexConfidence >= CONFIDENCE_THRESHOLDS.MEDIUM_HIGH) {
      return {
        shouldCall: false,
        reason: 'Sufficient regex coverage',
      };
    }

    // Default: call AI if significant gaps
    if (gaps.length > 3) {
      return {
        shouldCall: true,
        reason: `${gaps.length} fields need AI validation`,
      };
    }

    return {
      shouldCall: false,
      reason: 'Acceptable regex extraction',
    };
  }

  /**
   * Call AI for targeted extraction of missing fields
   */
  private async extractWithAI(
    content: string,
    gaps: string[],
    carrier: string,
    documentType?: string
  ): Promise<Map<string, FieldExtraction>> {
    const fields = new Map<string, FieldExtraction>();

    // Build targeted prompt
    const prompt = this.buildTargetedPrompt(gaps, carrier, documentType, content);

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307', // Use Haiku for cost efficiency
        max_tokens: 2048,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const extracted = JSON.parse(jsonMatch[0]);

        // Convert AI results to field extractions
        for (const gap of gaps) {
          if (extracted[gap] !== null && extracted[gap] !== undefined) {
            fields.set(gap, {
              value: extracted[gap],
              confidence: 78, // AI extractions get baseline confidence
              source: 'ai',
            });
          }
        }
      }
    } catch (error: any) {
      console.error('[LayeredExtractionService] AI extraction error:', error.message);
    }

    return fields;
  }

  /**
   * Build targeted AI prompt for specific fields
   */
  private buildTargetedPrompt(
    gaps: string[],
    carrier: string,
    documentType: string | undefined,
    content: string
  ): string {
    const fieldDescriptions: Record<string, string> = {
      booking_number: 'Carrier booking reference number',
      bl_number: 'Bill of Lading number',
      mbl_number: 'Master Bill of Lading number',
      hbl_number: 'House Bill of Lading number',
      container_number: 'Container numbers (array)',
      entry_number: 'Customs entry number',
      vessel_name: 'Ship/vessel name (without M/V prefix)',
      voyage_number: 'Voyage reference number',
      port_of_loading: 'Origin seaport name',
      port_of_loading_code: 'Origin port UN/LOCODE (5 chars)',
      port_of_discharge: 'Destination seaport name',
      port_of_discharge_code: 'Destination port UN/LOCODE (5 chars)',
      place_of_receipt: 'Inland origin location (ICD, warehouse)',
      place_of_delivery: 'Inland destination location',
      etd: 'Estimated departure date (YYYY-MM-DD)',
      eta: 'Estimated arrival date (YYYY-MM-DD)',
      si_cutoff: 'Shipping instruction deadline (YYYY-MM-DD)',
      vgm_cutoff: 'VGM submission deadline (YYYY-MM-DD)',
      cargo_cutoff: 'Cargo delivery deadline (YYYY-MM-DD)',
      gate_cutoff: 'Terminal gate closing (YYYY-MM-DD)',
      doc_cutoff: 'Documentation deadline (YYYY-MM-DD)',
      shipper_name: 'Exporter/shipper company name',
      consignee_name: 'Importer/consignee company name',
      notify_party: 'Notify party name',
      commodity_description: 'Description of goods',
      container_type: 'Container size/type (20GP, 40HC, etc.)',
      weight_kg: 'Total weight in kilograms (number)',
      volume_cbm: 'Total volume in CBM (number)',
      incoterms: 'Trade terms (FOB, CIF, etc.)',
    };

    const fieldsToExtract = gaps
      .map(g => `- ${g}: ${fieldDescriptions[g] || g}`)
      .join('\n');

    const carrierHint = carrier !== 'unknown'
      ? `\nCarrier: ${carrier.toUpperCase()}`
      : '';

    const docHint = documentType
      ? `\nDocument Type: ${documentType}`
      : '';

    return `Extract ONLY these specific fields from the shipping document.
${carrierHint}${docHint}

FIELDS TO EXTRACT:
${fieldsToExtract}

RULES:
- Return null for any field not found
- Dates must be YYYY-MM-DD format
- Numbers should be numeric (not strings)
- Arrays should be JSON arrays

CONTENT:
${content.substring(0, 10000)}

Return ONLY valid JSON with the requested fields:`;
  }

  /**
   * Merge regex and AI extractions, prioritizing higher confidence
   */
  private mergeExtractions(
    regexFields: Map<string, FieldExtraction>,
    aiFields: Map<string, FieldExtraction>
  ): Map<string, FieldExtraction> {
    const merged = new Map<string, FieldExtraction>(regexFields);

    for (const [field, aiExtraction] of aiFields) {
      const regexExtraction = merged.get(field);

      // Use AI if no regex result or regex confidence is too low
      if (!regexExtraction) {
        merged.set(field, aiExtraction);
      } else if (
        regexExtraction.confidence < CONFIDENCE_THRESHOLDS.MEDIUM &&
        aiExtraction.confidence >= regexExtraction.confidence
      ) {
        // AI fills low-confidence regex gaps
        merged.set(field, aiExtraction);
      }
      // Otherwise keep regex (higher confidence)
    }

    return merged;
  }

  /**
   * Build final extracted data from merged fields
   */
  private buildExtractedData(fields: Map<string, FieldExtraction>): ExtractedData {
    const getValue = <T>(field: string, defaultValue: T): T => {
      const extraction = fields.get(field);
      return extraction?.value as T ?? defaultValue;
    };

    return {
      booking_number: getValue('booking_number', null),
      bl_number: getValue('bl_number', null),
      mbl_number: getValue('mbl_number', null),
      hbl_number: getValue('hbl_number', null),
      container_numbers: getValue('container_numbers', []),
      entry_number: getValue('entry_number', null),
      carrier: getValue('carrier', null),
      vessel_name: getValue('vessel_name', null),
      voyage_number: getValue('voyage_number', null),
      port_of_loading: getValue('port_of_loading', null),
      port_of_loading_code: getValue('port_of_loading_code', null),
      port_of_discharge: getValue('port_of_discharge', null),
      port_of_discharge_code: getValue('port_of_discharge_code', null),
      place_of_receipt: getValue('place_of_receipt', null),
      place_of_delivery: getValue('place_of_delivery', null),
      etd: getValue('etd', null),
      eta: getValue('eta', null),
      si_cutoff: getValue('si_cutoff', null),
      vgm_cutoff: getValue('vgm_cutoff', null),
      cargo_cutoff: getValue('cargo_cutoff', null),
      gate_cutoff: getValue('gate_cutoff', null),
      doc_cutoff: getValue('doc_cutoff', null),
      shipper_name: getValue('shipper_name', null),
      consignee_name: getValue('consignee_name', null),
      notify_party: getValue('notify_party', null),
      commodity_description: getValue('commodity_description', null),
      container_type: getValue('container_type', null),
      weight_kg: getValue('weight_kg', null),
      volume_cbm: getValue('volume_cbm', null),
      incoterms: getValue('incoterms', null),
    };
  }

  /**
   * Convert extracted data to entity records for database storage
   */
  toEntityRecords(
    data: ExtractedData,
    emailId: string,
    metadata: ExtractionMetadata
  ): Array<{
    email_id: string;
    entity_type: EntityType;
    entity_value: string;
    confidence_score: number;
    extraction_method: ExtractionMethod;
  }> {
    const records: Array<{
      email_id: string;
      entity_type: EntityType;
      entity_value: string;
      confidence_score: number;
      extraction_method: ExtractionMethod;
    }> = [];

    const addEntity = (type: EntityType, value: string | number | null, field: string) => {
      if (value !== null && value !== undefined) {
        const source = metadata.fieldSources[field] || 'ai';
        const method: ExtractionMethod = source === 'ai' ? 'ai' : 'regex';

        records.push({
          email_id: emailId,
          entity_type: type,
          entity_value: String(value),
          confidence_score: metadata.overallConfidence,
          extraction_method: method,
        });
      }
    };

    // Map fields to entity types
    addEntity('booking_number', data.booking_number, 'booking_number');
    addEntity('bl_number', data.bl_number, 'bl_number');
    addEntity('mbl_number', data.mbl_number, 'mbl_number');
    addEntity('hbl_number', data.hbl_number, 'hbl_number');
    addEntity('entry_number', data.entry_number, 'entry_number');
    addEntity('carrier', data.carrier, 'carrier');
    addEntity('vessel_name', data.vessel_name, 'vessel_name');
    addEntity('voyage_number', data.voyage_number, 'voyage_number');
    addEntity('port_of_loading', data.port_of_loading, 'port_of_loading');
    addEntity('port_of_loading_code', data.port_of_loading_code, 'port_of_loading_code');
    addEntity('port_of_discharge', data.port_of_discharge, 'port_of_discharge');
    addEntity('port_of_discharge_code', data.port_of_discharge_code, 'port_of_discharge_code');
    addEntity('place_of_receipt', data.place_of_receipt, 'place_of_receipt');
    addEntity('place_of_delivery', data.place_of_delivery, 'place_of_delivery');
    addEntity('etd', data.etd, 'etd');
    addEntity('eta', data.eta, 'eta');
    addEntity('si_cutoff', data.si_cutoff, 'si_cutoff');
    addEntity('vgm_cutoff', data.vgm_cutoff, 'vgm_cutoff');
    addEntity('cargo_cutoff', data.cargo_cutoff, 'cargo_cutoff');
    addEntity('gate_cutoff', data.gate_cutoff, 'gate_cutoff');
    addEntity('doc_cutoff', data.doc_cutoff, 'doc_cutoff');
    addEntity('shipper_name', data.shipper_name, 'shipper_name');
    addEntity('consignee_name', data.consignee_name, 'consignee_name');
    addEntity('notify_party', data.notify_party, 'notify_party');
    addEntity('commodity', data.commodity_description, 'commodity_description');
    addEntity('incoterms', data.incoterms, 'incoterms');
    addEntity('weight', data.weight_kg, 'weight_kg');
    addEntity('volume', data.volume_cbm, 'volume_cbm');

    // Container numbers
    for (const container of data.container_numbers) {
      addEntity('container_number', container, 'container_numbers');
    }

    return records;
  }

  /**
   * Convert to ShipmentData format for compatibility
   */
  toShipmentData(data: ExtractedData, metadata: ExtractionMetadata): Partial<ShipmentData> {
    return {
      booking_number: data.booking_number,
      bl_number: data.bl_number,
      mbl_number: data.mbl_number,
      hbl_number: data.hbl_number,
      container_numbers: data.container_numbers,
      carrier_name: data.carrier,
      vessel_name: data.vessel_name,
      voyage_number: data.voyage_number,
      port_of_loading: data.port_of_loading,
      port_of_loading_code: data.port_of_loading_code,
      port_of_discharge: data.port_of_discharge,
      port_of_discharge_code: data.port_of_discharge_code,
      place_of_receipt: data.place_of_receipt,
      place_of_delivery: data.place_of_delivery,
      etd: data.etd,
      eta: data.eta,
      si_cutoff: data.si_cutoff,
      vgm_cutoff: data.vgm_cutoff,
      cargo_cutoff: data.cargo_cutoff,
      gate_cutoff: data.gate_cutoff,
      doc_cutoff: data.doc_cutoff,
      shipper_name: data.shipper_name,
      consignee_name: data.consignee_name,
      notify_party: data.notify_party,
      commodity_description: data.commodity_description,
      container_type: data.container_type,
      weight_kg: data.weight_kg,
      volume_cbm: data.volume_cbm,
      incoterms: data.incoterms,
      entry_number: data.entry_number,
      extraction_confidence: metadata.overallConfidence,
      extraction_source: metadata.aiCalled ? 'combined' : 'email_body',
      fields_extracted: Object.keys(metadata.fieldSources),
      raw_content_length: 0,
    };
  }
}

export default LayeredExtractionService;
