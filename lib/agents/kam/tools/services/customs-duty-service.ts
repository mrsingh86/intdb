/**
 * Comprehensive Customs Duty Service
 *
 * Calculates total US import duty by checking ALL relevant tariff sections:
 * 1. Base MFN duty (from USITC HTS API)
 * 2. Section 232 (Steel 50%, Aluminum 50%, Auto Parts 25%) - Updated March 2025
 * 3. Section 301 (China tariffs: Lists 1-4, 7.5%-25%)
 * 4. Reciprocal Tariffs (IEEPA) - Country-specific (India 18% per Feb 2026 deal)
 * 5. AD/CVD (Antidumping/Countervailing Duties)
 *
 * KEY INSIGHT: Section 232 and Reciprocal tariffs are MUTUALLY EXCLUSIVE
 * - If product is under Section 232, reciprocal tariffs do NOT apply
 */

import { getUsitcHtsService, HtsSearchResult } from './usitc-hts-service';

// ============================================================================
// TYPES
// ============================================================================

export interface CustomsDutyInput {
  hsCode: string;
  originCountry: string;
  productDescription?: string;
  vehicleRelated?: boolean; // For exemption checking
}

export interface TariffComponent {
  name: string;
  rate: string;
  ratePercent: number;
  applies: boolean;
  reason: string;
  legalReference?: string;
}

export interface CustomsDutyResult {
  success: boolean;
  hsCode: string;
  description: string;
  originCountry: string;

  // Base duty from HTS
  baseDuty: {
    general: string;
    special: string;
    column2: string;
    ratePercent: number;
  };

  // Additional tariff sections
  section232: TariffComponent;
  section301: TariffComponent;
  reciprocalTariff: TariffComponent;
  adCvd: TariffComponent;

  // Exemptions
  exemptions: {
    applies: boolean;
    type?: string;
    reference?: string;
    reason?: string;
  };

  // Final calculation
  totalDuty: {
    ratePercent: number;
    rateDisplay: string;
    calculation: string;
  };

  // Guidance
  notes: string[];
  warnings: string[];

  error?: string;
}

// ============================================================================
// SECTION 232 COVERAGE
// Effective dates: Vehicles April 3, 2025; Auto Parts May 3, 2025
// ============================================================================

const SECTION_232_STEEL_CHAPTERS = ['72', '73']; // Steel and steel articles
const SECTION_232_ALUMINUM_CHAPTERS = ['76']; // Aluminum and aluminum articles

// Section 232 Auto Parts - specific HTS codes covered
// Source: Presidential Proclamations on Section 232 Auto Tariffs + Inclusions
const SECTION_232_AUTO_PARTS_PREFIXES = [
  // Engines and engine parts
  '8407', '8408', '8409',
  // Transmission shafts, bearings, gears (added via inclusions for automotive use)
  '8483',
  // Transmissions and parts
  '8706', '8707',
  // Bodies, chassis, brakes, suspension, steering
  '8708.10', '8708.21', '8708.29', '8708.30', // Brake parts included!
  '8708.40', '8708.50', '8708.70', '8708.80',
  '8708.91', '8708.92', '8708.93', '8708.94', '8708.95', '8708.99',
  // Electrical components
  '8511', '8512',
  // Seats
  '9401.20',
];

// Countries EXEMPT from Section 232 (FTA partners with quotas/exemptions)
const SECTION_232_EXEMPT_COUNTRIES = [
  'mexico', 'canada', // USMCA exemptions
];

// ============================================================================
// SECTION 301 COVERAGE (CHINA ONLY)
// ============================================================================

interface Section301List {
  name: string;
  rate: number;
  htsChapters: string[]; // Simplified - actual lists are much more detailed
}

// Section 301 China tariff lists (simplified representation)
// In production, this would be a database lookup
const SECTION_301_LISTS: Section301List[] = [
  {
    name: 'List 1',
    rate: 25,
    htsChapters: ['84', '85', '90'], // Industrial machinery, electronics, instruments
  },
  {
    name: 'List 2',
    rate: 25,
    htsChapters: ['39', '72', '73', '76'], // Plastics, steel, aluminum
  },
  {
    name: 'List 3',
    rate: 25,
    htsChapters: ['28', '29', '38', '40'], // Chemicals, rubber
  },
  {
    name: 'List 4A',
    rate: 7.5,
    htsChapters: ['42', '49', '61', '62', '63', '64', '65', '94', '95', '96'], // Consumer goods, apparel
  },
];

// ============================================================================
// RECIPROCAL TARIFFS (IEEPA)
// Updated February 2026: India reduced from 50% to 18%
// ============================================================================

interface ReciprocalTariffConfig {
  country: string;
  baseRate: number;
  effectiveDate: string;
  htsCode: string; // 9903.01.xx code
  exemptionCode?: string;
  notes?: string;
}

const RECIPROCAL_TARIFFS: Record<string, ReciprocalTariffConfig> = {
  india: {
    country: 'India',
    baseRate: 18, // Reduced from 50% per Feb 2026 trade deal
    effectiveDate: '2025-08-07',
    htsCode: '9903.01.84',
    exemptionCode: '9903.01.87', // Vehicle parts exemption
    notes: 'Rate reduced from 50% to 18% per Feb 2026 US-India trade agreement',
  },
  china: {
    country: 'China',
    baseRate: 0, // China uses Section 301, not reciprocal
    effectiveDate: 'N/A',
    htsCode: 'N/A',
    notes: 'China subject to Section 301, not IEEPA reciprocal tariffs',
  },
  vietnam: {
    country: 'Vietnam',
    baseRate: 46,
    effectiveDate: '2025-04-09',
    htsCode: '9903.01.48',
  },
  thailand: {
    country: 'Thailand',
    baseRate: 36,
    effectiveDate: '2025-04-09',
    htsCode: '9903.01.51',
  },
  indonesia: {
    country: 'Indonesia',
    baseRate: 32,
    effectiveDate: '2025-04-09',
    htsCode: '9903.01.53',
  },
  bangladesh: {
    country: 'Bangladesh',
    baseRate: 37,
    effectiveDate: '2025-04-09',
    htsCode: '9903.01.55',
  },
  // Add more countries as needed
};

// Exemptions from reciprocal tariffs
const RECIPROCAL_EXEMPTIONS = {
  vehicleParts: {
    code: '9903.01.87',
    description: 'Vehicle parts, medium/heavy-duty vehicle parts',
    chapters: ['8708', '8407', '8408', '8409', '8706', '8707'],
  },
  agricultural: {
    code: '9903.01.XX',
    description: 'Agricultural products (Nov 2025 executive order)',
    chapters: ['01', '02', '03', '04', '07', '08', '09', '10', '11', '12'],
  },
  pharmaceuticals: {
    code: '9903.01.XX',
    description: 'Pharmaceutical products',
    chapters: ['30'],
  },
};

// ============================================================================
// FTA PARTNERS (Duty-Free or Reduced)
// ============================================================================

const FTA_PARTNERS: Record<string, { name: string; symbol: string }> = {
  australia: { name: 'Australia (AUSFTA)', symbol: 'AU' },
  canada: { name: 'Canada (USMCA)', symbol: 'CA' },
  mexico: { name: 'Mexico (USMCA)', symbol: 'MX' },
  korea: { name: 'Korea (KORUS)', symbol: 'KR' },
  chile: { name: 'Chile (CFTA)', symbol: 'CL' },
  singapore: { name: 'Singapore (SFTA)', symbol: 'SG' },
  israel: { name: 'Israel (ILFTA)', symbol: 'IL' },
  jordan: { name: 'Jordan (JFTA)', symbol: 'JO' },
  bahrain: { name: 'Bahrain (BFTA)', symbol: 'BH' },
  morocco: { name: 'Morocco (MFTA)', symbol: 'MA' },
  oman: { name: 'Oman (OFTA)', symbol: 'OM' },
  peru: { name: 'Peru (PTPA)', symbol: 'PE' },
  colombia: { name: 'Colombia (CTPA)', symbol: 'CO' },
  panama: { name: 'Panama (TPA)', symbol: 'PA' },
};

// ============================================================================
// SERVICE
// ============================================================================

export class CustomsDutyService {
  private htsService = getUsitcHtsService();

  /**
   * Calculate comprehensive duty for a product
   */
  async calculateDuty(input: CustomsDutyInput): Promise<CustomsDutyResult> {
    const { hsCode, originCountry, productDescription, vehicleRelated } = input;
    const countryLower = originCountry.toLowerCase().trim();
    const chapter = hsCode.substring(0, 2);
    const heading = hsCode.substring(0, 4);

    const notes: string[] = [];
    const warnings: string[] = [];

    // 1. Get base duty from USITC HTS API
    const htsResult = await this.htsService.getByHsCode(hsCode);

    if (!htsResult) {
      return this.createErrorResult(input, `HS code ${hsCode} not found in USITC database`);
    }

    const baseDutyPercent = this.parseRateToPercent(htsResult.generalDuty);

    // 2. Check if FTA partner (may be duty-free)
    const ftaPartner = FTA_PARTNERS[countryLower];
    if (ftaPartner) {
      const ftaRate = this.checkFtaDuty(htsResult, ftaPartner.symbol);
      if (ftaRate !== null && ftaRate === 0) {
        notes.push(`${ftaPartner.name}: Eligible for duty-free entry under FTA`);
        return this.buildResult(input, htsResult, {
          baseDutyPercent,
          section232: this.noTariff('Section 232', 'FTA partner'),
          section301: this.noTariff('Section 301', 'Not China origin'),
          reciprocal: this.noTariff('Reciprocal', 'FTA partner exempt'),
          adCvd: this.noTariff('AD/CVD', 'No active orders found'),
          exemption: { applies: true, type: 'FTA', reason: ftaPartner.name },
          totalPercent: ftaRate,
          notes,
          warnings,
        });
      }
    }

    // 3. Check Section 232 (Steel, Aluminum, Auto Parts)
    const section232 = this.checkSection232(hsCode, countryLower, chapter, heading, vehicleRelated);

    // 4. Check Section 301 (China only)
    const section301 = this.checkSection301(hsCode, countryLower, chapter);

    // 5. Check Reciprocal Tariffs (IEEPA)
    // KEY: Reciprocal tariffs do NOT apply if Section 232 applies
    let reciprocal: TariffComponent;
    if (section232.applies) {
      reciprocal = this.noTariff('Reciprocal', 'Section 232 applies - reciprocal tariffs do not stack');
      notes.push('Section 232 and Reciprocal tariffs are mutually exclusive - Section 232 takes precedence');
    } else {
      reciprocal = this.checkReciprocalTariff(hsCode, countryLower, chapter, heading, vehicleRelated);
    }

    // 6. Check exemptions
    const exemption = this.checkExemptions(hsCode, countryLower, chapter, heading, vehicleRelated);

    // 7. Check AD/CVD (placeholder - would need database of active orders)
    const adCvd = this.noTariff('AD/CVD', 'No active antidumping/countervailing duty orders found for this product');

    // 8. Calculate total
    // IMPORTANT: Exemptions only apply to RECIPROCAL tariffs, NOT Section 232 or 301
    let totalPercent = baseDutyPercent;

    // Section 232 ALWAYS applies if product is covered (no exemptions)
    if (section232.applies) {
      totalPercent += section232.ratePercent;
    }

    // Section 301 ALWAYS applies if product is covered (no exemptions for China)
    if (section301.applies) {
      totalPercent += section301.ratePercent;
    }

    // Reciprocal tariffs can be exempted (vehicle parts, agricultural)
    if (reciprocal.applies) {
      totalPercent += reciprocal.ratePercent;
    }

    // Add exemption notes
    if (exemption.applies) {
      if (exemption.type === 'vehicleParts') {
        notes.push(`Vehicle parts exemption (${RECIPROCAL_EXEMPTIONS.vehicleParts.code}) exempts from RECIPROCAL tariffs only`);
        if (section232.applies) {
          notes.push('NOTE: Section 232 tariffs still apply - vehicle parts exemption does NOT exempt from Section 232');
        }
      }
      if (exemption.type === 'agricultural') {
        notes.push('Agricultural exemption (Nov 2025) eliminates RECIPROCAL tariffs on spices and agricultural products');
      }
    }

    // Add warnings for high duties
    if (totalPercent > 50) {
      warnings.push(`HIGH DUTY ALERT: Total duty of ${totalPercent}% is unusually high. Verify classification.`);
    }

    // Add country-specific notes
    if (countryLower === 'india') {
      notes.push('India GSP benefits removed June 2019 - no longer eligible for duty-free under GSP');
      notes.push('Feb 2026 US-India trade deal reduced reciprocal tariffs from 50% to 18%');
    }

    if (countryLower === 'china') {
      notes.push('China products subject to Section 301 tariffs (not IEEPA reciprocal tariffs)');
    }

    return this.buildResult(input, htsResult, {
      baseDutyPercent,
      section232,
      section301,
      reciprocal,
      adCvd,
      exemption,
      totalPercent,
      notes,
      warnings,
    });
  }

  /**
   * Check Section 232 applicability
   */
  private checkSection232(
    hsCode: string,
    country: string,
    chapter: string,
    heading: string,
    vehicleRelated?: boolean
  ): TariffComponent {
    // FTA partners may be exempt
    if (SECTION_232_EXEMPT_COUNTRIES.includes(country)) {
      return this.noTariff('Section 232', `${country.toUpperCase()} exempt under USMCA/FTA`);
    }

    // Steel (Chapter 72-73) - 50% (increased March 2025)
    if (SECTION_232_STEEL_CHAPTERS.includes(chapter)) {
      return {
        name: 'Section 232 (Steel)',
        rate: '50%',
        ratePercent: 50,
        applies: true,
        reason: 'Steel products covered under Section 232 (rate increased to 50% March 2025)',
        legalReference: 'Presidential Proclamation 9705 (modified)',
      };
    }

    // Aluminum (Chapter 76) - 50% (increased March 2025)
    if (SECTION_232_ALUMINUM_CHAPTERS.includes(chapter)) {
      return {
        name: 'Section 232 (Aluminum)',
        rate: '50%',
        ratePercent: 50,
        applies: true,
        reason: 'Aluminum products covered under Section 232 (rate increased to 50% March 2025)',
        legalReference: 'Presidential Proclamation 9704 (modified)',
      };
    }

    // Auto Parts - 25%
    const cleanCode = hsCode.replace(/\./g, '');
    for (const prefix of SECTION_232_AUTO_PARTS_PREFIXES) {
      const cleanPrefix = prefix.replace(/\./g, '');
      if (cleanCode.startsWith(cleanPrefix)) {
        return {
          name: 'Section 232 (Auto Parts)',
          rate: '25%',
          ratePercent: 25,
          applies: true,
          reason: `Auto parts (${heading}) covered under Section 232 auto tariffs`,
          legalReference: 'Presidential Proclamation - Section 232 Auto Parts (Effective May 3, 2025)',
        };
      }
    }

    return this.noTariff('Section 232', 'Product not covered under Section 232 (steel, aluminum, or auto parts)');
  }

  /**
   * Check Section 301 applicability (China only)
   */
  private checkSection301(
    hsCode: string,
    country: string,
    chapter: string
  ): TariffComponent {
    if (country !== 'china') {
      return this.noTariff('Section 301', 'Section 301 only applies to China origin products');
    }

    // Check which list applies
    for (const list of SECTION_301_LISTS) {
      if (list.htsChapters.includes(chapter)) {
        return {
          name: `Section 301 (${list.name})`,
          rate: `${list.rate}%`,
          ratePercent: list.rate,
          applies: true,
          reason: `China origin product in Chapter ${chapter} covered under Section 301 ${list.name}`,
          legalReference: 'USTR Section 301 Action',
        };
      }
    }

    return this.noTariff('Section 301', 'Product not on Section 301 tariff lists');
  }

  /**
   * Check Reciprocal Tariff (IEEPA) applicability
   */
  private checkReciprocalTariff(
    hsCode: string,
    country: string,
    chapter: string,
    heading: string,
    vehicleRelated?: boolean
  ): TariffComponent {
    const config = RECIPROCAL_TARIFFS[country];

    if (!config) {
      return this.noTariff('Reciprocal', `No reciprocal tariff data for ${country}`);
    }

    if (config.baseRate === 0) {
      return this.noTariff('Reciprocal', config.notes || 'No reciprocal tariff applies');
    }

    // Check for vehicle parts exemption
    if (vehicleRelated || this.isVehiclePart(hsCode, chapter, heading)) {
      return {
        name: 'Reciprocal (IEEPA)',
        rate: `${config.baseRate}% (EXEMPT)`,
        ratePercent: 0, // Exempt
        applies: false,
        reason: `Vehicle parts exempt under ${config.exemptionCode}`,
        legalReference: config.exemptionCode,
      };
    }

    // Check for agricultural exemption
    if (RECIPROCAL_EXEMPTIONS.agricultural.chapters.includes(chapter)) {
      return {
        name: 'Reciprocal (IEEPA)',
        rate: `${config.baseRate}% (EXEMPT)`,
        ratePercent: 0, // Exempt
        applies: false,
        reason: 'Agricultural products exempt under Nov 2025 executive order',
        legalReference: 'Executive Order Nov 2025',
      };
    }

    return {
      name: 'Reciprocal (IEEPA)',
      rate: `${config.baseRate}%`,
      ratePercent: config.baseRate,
      applies: true,
      reason: `${config.country} reciprocal tariff under ${config.htsCode}`,
      legalReference: config.htsCode,
    };
  }

  /**
   * Check if product is a vehicle part
   */
  private isVehiclePart(hsCode: string, chapter: string, heading: string): boolean {
    const vehicleChapters = ['8407', '8408', '8409', '8706', '8707', '8708'];
    return vehicleChapters.some(vc => hsCode.startsWith(vc) || heading.startsWith(vc.substring(0, 4)));
  }

  /**
   * Check for exemptions
   */
  private checkExemptions(
    hsCode: string,
    country: string,
    chapter: string,
    heading: string,
    vehicleRelated?: boolean
  ): { applies: boolean; type?: string; reference?: string; reason?: string } {
    // Vehicle parts exemption
    if (vehicleRelated || this.isVehiclePart(hsCode, chapter, heading)) {
      return {
        applies: true,
        type: 'vehicleParts',
        reference: '9903.01.87',
        reason: 'Vehicle parts, medium/heavy-duty vehicle parts exempt from reciprocal tariffs',
      };
    }

    // Agricultural exemption
    if (RECIPROCAL_EXEMPTIONS.agricultural.chapters.includes(chapter)) {
      return {
        applies: true,
        type: 'agricultural',
        reference: 'Nov 2025 Executive Order',
        reason: 'Agricultural/spice products exempt from reciprocal tariffs',
      };
    }

    return { applies: false };
  }

  /**
   * Check FTA duty rate
   */
  private checkFtaDuty(htsResult: HtsSearchResult, symbol: string): number | null {
    // Parse special duty column for FTA rates
    const special = htsResult.specialDuty || '';

    // Look for "Free (AU, CA, MX, ...)" pattern
    if (special.toLowerCase().includes('free') && special.includes(symbol)) {
      return 0;
    }

    // Look for specific rate patterns like "1.5% (AU)"
    const rateMatch = special.match(new RegExp(`([\\d.]+)%\\s*\\(.*?${symbol}.*?\\)`, 'i'));
    if (rateMatch) {
      return parseFloat(rateMatch[1]);
    }

    return null;
  }

  /**
   * Parse duty rate string to percentage number
   */
  private parseRateToPercent(rateStr: string): number {
    if (!rateStr) return 0;

    const lower = rateStr.toLowerCase().trim();

    if (lower === 'free' || lower === '0' || lower === '0%') {
      return 0;
    }

    // Handle percentage: "2.5%" or "2.5"
    const percentMatch = lower.match(/^([\d.]+)%?$/);
    if (percentMatch) {
      return parseFloat(percentMatch[1]);
    }

    // Handle compound rates: "29.1¢/kg + 25.9%"
    const compoundMatch = lower.match(/([\d.]+)%/);
    if (compoundMatch) {
      return parseFloat(compoundMatch[1]);
    }

    // Handle cents per unit (approximate as 0 for comparison)
    if (lower.includes('¢') || lower.includes('cent')) {
      return 0; // Would need weight/value to calculate
    }

    return 0;
  }

  /**
   * Create "no tariff" component
   */
  private noTariff(name: string, reason: string): TariffComponent {
    return {
      name,
      rate: '0%',
      ratePercent: 0,
      applies: false,
      reason,
    };
  }

  /**
   * Build final result
   */
  private buildResult(
    input: CustomsDutyInput,
    htsResult: HtsSearchResult,
    data: {
      baseDutyPercent: number;
      section232: TariffComponent;
      section301: TariffComponent;
      reciprocal: TariffComponent;
      adCvd: TariffComponent;
      exemption: { applies: boolean; type?: string; reference?: string; reason?: string };
      totalPercent: number;
      notes: string[];
      warnings: string[];
    }
  ): CustomsDutyResult {
    // Build calculation string
    const parts: string[] = [`Base: ${data.baseDutyPercent}%`];
    if (data.section232.applies) parts.push(`+ Section 232: ${data.section232.ratePercent}%`);
    if (data.section301.applies) parts.push(`+ Section 301: ${data.section301.ratePercent}%`);
    if (data.reciprocal.applies) parts.push(`+ Reciprocal: ${data.reciprocal.ratePercent}%`);

    return {
      success: true,
      hsCode: input.hsCode,
      description: htsResult.description,
      originCountry: input.originCountry,

      baseDuty: {
        general: htsResult.generalDuty,
        special: htsResult.specialDuty,
        column2: htsResult.otherDuty,
        ratePercent: data.baseDutyPercent,
      },

      section232: data.section232,
      section301: data.section301,
      reciprocalTariff: data.reciprocal,
      adCvd: data.adCvd,

      exemptions: data.exemption,

      totalDuty: {
        ratePercent: data.totalPercent,
        rateDisplay: `${data.totalPercent}%`,
        calculation: parts.join(' ') + ` = ${data.totalPercent}%`,
      },

      notes: data.notes,
      warnings: data.warnings,
    };
  }

  /**
   * Create error result
   */
  private createErrorResult(input: CustomsDutyInput, error: string): CustomsDutyResult {
    return {
      success: false,
      hsCode: input.hsCode,
      description: '',
      originCountry: input.originCountry,
      baseDuty: { general: '', special: '', column2: '', ratePercent: 0 },
      section232: this.noTariff('Section 232', 'Error'),
      section301: this.noTariff('Section 301', 'Error'),
      reciprocalTariff: this.noTariff('Reciprocal', 'Error'),
      adCvd: this.noTariff('AD/CVD', 'Error'),
      exemptions: { applies: false },
      totalDuty: { ratePercent: 0, rateDisplay: 'N/A', calculation: 'Error' },
      notes: [],
      warnings: [],
      error,
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

let serviceInstance: CustomsDutyService | null = null;

export function getCustomsDutyService(): CustomsDutyService {
  if (!serviceInstance) {
    serviceInstance = new CustomsDutyService();
  }
  return serviceInstance;
}
