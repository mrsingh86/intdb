/**
 * Cutoff Extraction Service
 *
 * Extracts shipping cutoff dates (SI, VGM, Cargo, Gate) from emails and attachments
 * using AI-powered extraction with Claude.
 *
 * Principles:
 * - Interface-based design
 * - Single Responsibility: Only cutoff extraction
 * - Deep module with simple interface
 * - Information hiding
 */

import { SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

// ============================================================================
// Types
// ============================================================================

export interface Shipment {
  id: string;
  booking_number: string | null;
  bl_number: string | null;
  si_cutoff: string | null;
  vgm_cutoff: string | null;
  cargo_cutoff: string | null;
  gate_cutoff: string | null;
  etd: string | null;
  eta: string | null;
  vessel_name: string | null;
}

export interface ExtractedCutoffs {
  booking_number: string | null;
  etd: string | null;
  eta: string | null;
  si_cutoff: string | null;
  vgm_cutoff: string | null;
  cargo_cutoff: string | null;
  gate_cutoff: string | null;
  vessel_name: string | null;
}

export interface ExtractionResult {
  shipmentId: string;
  success: boolean;
  updatedFields: string[];
  error?: string;
}

export interface ExtractionStats {
  shipmentsProcessed: number;
  shipmentsUpdated: number;
  cutoffsAdded: {
    si: number;
    vgm: number;
    cargo: number;
    gate: number;
  };
}

// ============================================================================
// Booking Number Matcher
// ============================================================================

export class BookingNumberMatcher {
  private lookup: Map<string, Shipment> = new Map();

  constructor(shipments: Shipment[]) {
    this.buildLookup(shipments);
  }

  private buildLookup(shipments: Shipment[]): void {
    for (const shipment of shipments) {
      if (shipment.booking_number) {
        this.addVariants(shipment.booking_number, shipment);
      }
      if (shipment.bl_number) {
        this.addVariants(shipment.bl_number, shipment);
      }
    }
  }

  private addVariants(identifier: string, shipment: Shipment): void {
    // Exact match (case insensitive)
    this.lookup.set(identifier, shipment);
    this.lookup.set(identifier.toUpperCase(), shipment);
    this.lookup.set(identifier.toLowerCase(), shipment);

    // Digits only for 8+ digit numbers
    const numOnly = identifier.replace(/\D/g, '');
    if (numOnly.length >= 8) {
      this.lookup.set(numOnly, shipment);
    }

    // HL- prefix variations (Hapag-Lloyd)
    if (identifier.startsWith('HL-')) {
      this.lookup.set(identifier.substring(3), shipment);
    } else if (/^\d{8}$/.test(identifier)) {
      this.lookup.set('HL-' + identifier, shipment);
    }

    // COSU prefix (COSCO)
    if (identifier.startsWith('COSU')) {
      this.lookup.set(identifier.substring(4), shipment);
    }
  }

  /**
   * Extract booking number candidates from text
   */
  extractCandidates(text: string): string[] {
    const candidates: string[] = [];

    // HL-XXXXXXXX (Hapag-Lloyd)
    for (const m of text.matchAll(/HL-?(\d{8})/gi)) {
      candidates.push(m[1]);
      candidates.push('HL-' + m[1]);
    }

    // Our Reference field
    const ourRefMatch = text.match(/Our Reference[:\s]+(\d{8,})/i);
    if (ourRefMatch) candidates.push(ourRefMatch[1]);

    // 8-10 digit numbers
    for (const m of text.matchAll(/\b(\d{8,10})\b/g)) {
      candidates.push(m[1]);
    }

    // COSU (COSCO)
    for (const m of text.matchAll(/COSU(\d+)/gi)) {
      candidates.push('COSU' + m[1]);
    }

    // CEI/AMC (CMA CGM)
    for (const m of text.matchAll(/(CEI\d+|AMC\d+)/gi)) {
      candidates.push(m[1].toUpperCase());
    }

    // 9-digit Maersk (26XXXXXXX)
    for (const m of text.matchAll(/\b(26\d{7})\b/g)) {
      candidates.push(m[1]);
    }

    return [...new Set(candidates)];
  }

  /**
   * Find shipment by booking candidates
   */
  findShipment(candidates: string[]): { shipment: Shipment; matchedOn: string } | null {
    for (const candidate of candidates) {
      const shipment = this.lookup.get(candidate) || this.lookup.get(candidate.toUpperCase());
      if (shipment) {
        return { shipment, matchedOn: candidate };
      }
    }
    return null;
  }

  get size(): number {
    return this.lookup.size;
  }
}

// ============================================================================
// Cutoff Extractor (AI-powered)
// ============================================================================

export class CutoffExtractor {
  private anthropic: Anthropic;

  private static readonly EXTRACTION_PROMPT = `Extract shipping cutoff dates from this document.

LOOK FOR THESE SPECIFIC CUTOFF DATES:
1. SI Cutoff: "SI closing", "Shipping Instruction closing", "Documentation deadline", "SI Cut-off"
2. VGM Cutoff: "VGM cut-off", "VGM deadline", "VGM submission deadline"
3. Cargo Cutoff: "FCL delivery cut-off", "Cargo cut-off", "CY cut-off", "CY Closing", "Container Yard Cutoff"
4. Gate Cutoff: "Gate cut-off", "Gate closing"

Also extract:
- Booking number (8+ digits, or with prefix like COSU, MAEU, HL-)
- ETD (departure date)
- ETA (arrival date)
- Vessel name

Return ONLY valid JSON:
{
  "booking_number": "string or null",
  "etd": "YYYY-MM-DD or null",
  "eta": "YYYY-MM-DD or null",
  "si_cutoff": "YYYY-MM-DD or null",
  "vgm_cutoff": "YYYY-MM-DD or null",
  "cargo_cutoff": "YYYY-MM-DD or null",
  "gate_cutoff": "YYYY-MM-DD or null",
  "vessel_name": "string or null"
}

Convert dates like "25-Dec-2025" to YYYY-MM-DD format.

DOCUMENT:
`;

  constructor(apiKey: string) {
    this.anthropic = new Anthropic({ apiKey });
  }

  /**
   * Extract cutoffs from content using AI
   */
  async extract(content: string): Promise<ExtractedCutoffs | null> {
    if (content.length < 300) return null;

    try {
      const response = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: CutoffExtractor.EXTRACTION_PROMPT + content.substring(0, 15000)
        }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);

      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return this.normalizeExtractedData(parsed);
      }
    } catch (error: any) {
      console.error(`AI extraction error: ${error.message}`);
    }

    return null;
  }

  private normalizeExtractedData(data: any): ExtractedCutoffs {
    const dateFields = ['etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff'];

    for (const field of dateFields) {
      if (data[field] === 'null' || data[field] === '') {
        data[field] = null;
      } else if (data[field]) {
        data[field] = this.convertToISODate(data[field]);
      }
    }

    for (const field of ['booking_number', 'vessel_name']) {
      if (data[field] === 'null' || data[field] === '') {
        data[field] = null;
      }
    }

    return data as ExtractedCutoffs;
  }

  private convertToISODate(dateStr: string): string | null {
    if (!dateStr) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

    const monthMap: Record<string, string> = {
      'jan': '01', 'feb': '02', 'mar': '03', 'apr': '04', 'may': '05', 'jun': '06',
      'jul': '07', 'aug': '08', 'sep': '09', 'oct': '10', 'nov': '11', 'dec': '12'
    };

    // DD-MMM-YYYY
    const dmmyMatch = dateStr.match(/(\d{1,2})[-\/]([A-Za-z]{3})[-\/](\d{4})/);
    if (dmmyMatch) {
      const day = dmmyMatch[1].padStart(2, '0');
      const month = monthMap[dmmyMatch[2].toLowerCase()];
      if (month) return `${dmmyMatch[3]}-${month}-${day}`;
    }

    // DD/MM/YYYY
    const ddmmMatch = dateStr.match(/(\d{2})[-\/](\d{2})[-\/](\d{4})/);
    if (ddmmMatch) {
      const [, day, month, year] = ddmmMatch;
      if (parseInt(month) <= 12) return `${year}-${month}-${day}`;
    }

    // YYYY-MM-DD with time
    const isoMatch = dateStr.match(/(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) return isoMatch[1];

    return null;
  }
}

// ============================================================================
// Cutoff Extraction Service (Main Service)
// ============================================================================

export class CutoffExtractionService {
  private supabase: SupabaseClient;
  private extractor: CutoffExtractor;
  private static readonly DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

  constructor(supabase: SupabaseClient, anthropicApiKey: string) {
    this.supabase = supabase;
    this.extractor = new CutoffExtractor(anthropicApiKey);
  }

  /**
   * Extract cutoffs for a single shipment from an email
   */
  async extractForShipment(
    shipment: Shipment,
    emailContent: string
  ): Promise<ExtractionResult> {
    try {
      const extracted = await this.extractor.extract(emailContent);

      if (!extracted) {
        return {
          shipmentId: shipment.id,
          success: false,
          updatedFields: [],
          error: 'No data extracted'
        };
      }

      const updates = this.buildUpdates(shipment, extracted);

      if (Object.keys(updates).length === 0) {
        return {
          shipmentId: shipment.id,
          success: true,
          updatedFields: [],
        };
      }

      updates.updated_at = new Date().toISOString();

      const { error } = await this.supabase
        .from('shipments')
        .update(updates)
        .eq('id', shipment.id);

      if (error) {
        return {
          shipmentId: shipment.id,
          success: false,
          updatedFields: [],
          error: error.message
        };
      }

      return {
        shipmentId: shipment.id,
        success: true,
        updatedFields: Object.keys(updates).filter(k => k !== 'updated_at'),
      };
    } catch (error: any) {
      return {
        shipmentId: shipment.id,
        success: false,
        updatedFields: [],
        error: error.message
      };
    }
  }

  /**
   * Extract cutoffs for all shipments missing cutoffs
   */
  async extractAll(options: {
    onProgress?: (processed: number, total: number, updated: number) => void;
    rateLimit?: number; // ms between API calls
  } = {}): Promise<ExtractionStats> {
    const { onProgress, rateLimit = 150 } = options;

    const stats: ExtractionStats = {
      shipmentsProcessed: 0,
      shipmentsUpdated: 0,
      cutoffsAdded: { si: 0, vgm: 0, cargo: 0, gate: 0 },
    };

    // Load shipments needing cutoffs
    const { data: allShipments } = await this.supabase.from('shipments').select('*');
    const shipmentsNeedingCutoffs = allShipments?.filter(s =>
      s.si_cutoff === null || s.vgm_cutoff === null || s.cargo_cutoff === null
    ) || [];

    // Build matcher
    const matcher = new BookingNumberMatcher(shipmentsNeedingCutoffs);

    // Load relevant emails
    const { data: emails } = await this.supabase
      .from('raw_emails')
      .select('id, subject, body_text')
      .or('body_text.ilike.%=== %.pdf ===%,body_text.ilike.%cut-off%,body_text.ilike.%cutoff%,body_text.ilike.%deadline%')
      .order('received_at', { ascending: false });

    // Load PDF attachments
    const { data: attachments } = await this.supabase
      .from('raw_attachments')
      .select('email_id, extracted_text')
      .ilike('mime_type', '%pdf%')
      .not('extracted_text', 'is', null);

    const attachmentsByEmail = new Map<string, string[]>();
    for (const att of attachments || []) {
      if (att.extracted_text && att.extracted_text.length > 200) {
        const texts = attachmentsByEmail.get(att.email_id) || [];
        texts.push(att.extracted_text);
        attachmentsByEmail.set(att.email_id, texts);
      }
    }

    const updatedShipmentIds = new Set<string>();

    // Process emails
    for (const email of emails || []) {
      stats.shipmentsProcessed++;

      if (onProgress && stats.shipmentsProcessed % 50 === 0) {
        onProgress(stats.shipmentsProcessed, emails?.length || 0, stats.shipmentsUpdated);
      }

      const subject = email.subject || '';
      const body = email.body_text || '';

      // Combine with PDF text
      let combinedContent = body;
      const pdfTexts = attachmentsByEmail.get(email.id) || [];
      for (const pdfText of pdfTexts) {
        combinedContent += '\n\n' + pdfText;
      }

      if (combinedContent.length < 400) continue;

      // Find matching shipment
      const candidates = matcher.extractCandidates(subject + ' ' + combinedContent);
      const match = matcher.findShipment(candidates);
      if (!match) continue;

      const { shipment } = match;

      // Skip already processed
      if (updatedShipmentIds.has(shipment.id)) continue;
      if (shipment.si_cutoff && shipment.vgm_cutoff && shipment.cargo_cutoff) continue;

      // Extract
      const result = await this.extractForShipment(shipment, combinedContent);

      if (result.success && result.updatedFields.length > 0) {
        stats.shipmentsUpdated++;
        updatedShipmentIds.add(shipment.id);

        for (const field of result.updatedFields) {
          if (field === 'si_cutoff') stats.cutoffsAdded.si++;
          if (field === 'vgm_cutoff') stats.cutoffsAdded.vgm++;
          if (field === 'cargo_cutoff') stats.cutoffsAdded.cargo++;
          if (field === 'gate_cutoff') stats.cutoffsAdded.gate++;
        }
      }

      await new Promise(r => setTimeout(r, rateLimit));
    }

    return stats;
  }

  private buildUpdates(shipment: Shipment, extracted: ExtractedCutoffs): Record<string, any> {
    const updates: Record<string, any> = {};

    if (!shipment.etd && extracted.etd && CutoffExtractionService.DATE_REGEX.test(extracted.etd)) {
      updates.etd = extracted.etd;
    }
    if (!shipment.eta && extracted.eta && CutoffExtractionService.DATE_REGEX.test(extracted.eta)) {
      updates.eta = extracted.eta;
    }
    if (!shipment.si_cutoff && extracted.si_cutoff && CutoffExtractionService.DATE_REGEX.test(extracted.si_cutoff)) {
      updates.si_cutoff = extracted.si_cutoff;
    }
    if (!shipment.vgm_cutoff && extracted.vgm_cutoff && CutoffExtractionService.DATE_REGEX.test(extracted.vgm_cutoff)) {
      updates.vgm_cutoff = extracted.vgm_cutoff;
    }
    if (!shipment.cargo_cutoff && extracted.cargo_cutoff && CutoffExtractionService.DATE_REGEX.test(extracted.cargo_cutoff)) {
      updates.cargo_cutoff = extracted.cargo_cutoff;
    }
    if (!shipment.gate_cutoff && extracted.gate_cutoff && CutoffExtractionService.DATE_REGEX.test(extracted.gate_cutoff)) {
      updates.gate_cutoff = extracted.gate_cutoff;
    }
    if (!shipment.vessel_name && extracted.vessel_name) {
      updates.vessel_name = extracted.vessel_name;
    }

    return updates;
  }
}
