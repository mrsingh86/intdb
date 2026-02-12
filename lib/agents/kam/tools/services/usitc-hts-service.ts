/**
 * USITC HTS Service
 *
 * Queries the US International Trade Commission Harmonized Tariff Schedule API
 * for real-time HS code classification and duty rates.
 *
 * API Endpoint: https://hts.usitc.gov/reststop/search?keyword=<query>
 */

// ============================================================================
// TYPES
// ============================================================================

export interface HtsApiResult {
  htsno: string;
  description: string;
  statisticalSuffix: string;
  indent: number;
  units: string;
  general: string;
  special: string;
  other: string;
  footnotes: string[];
  selector: string;
}

export interface HtsSearchResult {
  hsCode: string;
  description: string;
  generalDuty: string;
  specialDuty: string;
  otherDuty: string;
  units: string;
  indent: number;
  isCategory: boolean;
  footnotes: string[];
}

export interface HtsLookupResult {
  success: boolean;
  results: HtsSearchResult[];
  query: string;
  source: string;
  error?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const USITC_API_BASE = 'https://hts.usitc.gov/reststop';
const SEARCH_TIMEOUT_MS = 10000;

// ============================================================================
// SERVICE
// ============================================================================

export class UsitcHtsService {
  /**
   * Search for HS codes by keyword
   * Returns up to 100 matching tariff articles
   */
  async searchByKeyword(keyword: string): Promise<HtsLookupResult> {
    const cleanKeyword = keyword.trim().toLowerCase();

    if (!cleanKeyword || cleanKeyword.length < 2) {
      return {
        success: false,
        results: [],
        query: keyword,
        source: 'USITC HTS',
        error: 'Search query must be at least 2 characters',
      };
    }

    try {
      const url = `${USITC_API_BASE}/search?keyword=${encodeURIComponent(cleanKeyword)}`;
      console.log(`[UsitcHts] Searching: ${url}`);

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const data: HtsApiResult[] = await response.json();
      console.log(`[UsitcHts] Found ${data.length} results for "${keyword}"`);

      const results = data.map((item) => this.mapApiResult(item));

      return {
        success: true,
        results,
        query: keyword,
        source: 'USITC HTS API (Real-time)',
      };
    } catch (error: any) {
      console.error('[UsitcHts] Search error:', error.message);
      return {
        success: false,
        results: [],
        query: keyword,
        source: 'USITC HTS',
        error: error.message,
      };
    }
  }

  /**
   * Get specific HS code details by number
   * Uses the search API and filters for exact match
   * If 10-digit code has empty rates, looks up parent 8-digit heading
   */
  async getByHsCode(hsCode: string): Promise<HtsSearchResult | null> {
    // Remove dots and spaces for search
    const cleanCode = hsCode.replace(/[.\s]/g, '');

    // Search using the HS code as keyword
    const result = await this.searchByKeyword(cleanCode);

    if (!result.success || result.results.length === 0) {
      return null;
    }

    // Find exact or closest match
    const exactMatch = result.results.find(
      (r) => r.hsCode.replace(/[.\s]/g, '') === cleanCode
    );

    if (exactMatch) {
      // If duty rates are empty, look up parent heading
      if (!exactMatch.generalDuty && cleanCode.length > 8) {
        const parentCode = cleanCode.substring(0, 8);
        console.log(`[UsitcHts] 10-digit has no rates, looking up parent: ${parentCode}`);
        const parentResult = await this.getParentHeadingRates(parentCode, result.results);
        if (parentResult) {
          // Merge parent rates into exact match
          return {
            ...exactMatch,
            generalDuty: parentResult.generalDuty,
            specialDuty: parentResult.specialDuty,
            otherDuty: parentResult.otherDuty,
            footnotes: parentResult.footnotes,
          };
        }
      }
      return exactMatch;
    }

    // Return first result that starts with the code
    const startMatch = result.results.find((r) =>
      r.hsCode.replace(/[.\s]/g, '').startsWith(cleanCode)
    );

    if (startMatch) {
      return startMatch;
    }

    return null;
  }

  /**
   * Get duty rates from parent 8-digit heading
   */
  private async getParentHeadingRates(
    parentCode: string,
    existingResults: HtsSearchResult[]
  ): Promise<HtsSearchResult | null> {
    // First check if parent is in existing results
    const parentInResults = existingResults.find(
      (r) => r.hsCode.replace(/[.\s]/g, '') === parentCode && r.generalDuty
    );

    if (parentInResults) {
      return parentInResults;
    }

    // Otherwise search for parent heading
    const parentResult = await this.searchByKeyword(parentCode);
    if (parentResult.success && parentResult.results.length > 0) {
      // Find the exact 8-digit heading with rates
      return parentResult.results.find(
        (r) => r.hsCode.replace(/[.\s]/g, '') === parentCode && r.generalDuty
      ) || null;
    }

    return null;
  }

  /**
   * Multi-step search for better classification
   * Searches with multiple keyword variations
   */
  async smartSearch(productDescription: string): Promise<HtsLookupResult> {
    // Extract key terms from description
    const keywords = this.extractSearchTerms(productDescription);

    console.log(`[UsitcHts] Smart search with terms: ${keywords.join(', ')}`);

    // Try each keyword until we get results
    for (const keyword of keywords) {
      const result = await this.searchByKeyword(keyword);

      if (result.success && result.results.length > 0) {
        // Filter to most relevant results (indent > 0 means actual items, not categories)
        const actualItems = result.results.filter(
          (r) => !r.isCategory && r.generalDuty
        );

        if (actualItems.length > 0) {
          return {
            ...result,
            results: actualItems.slice(0, 10), // Top 10 most relevant
          };
        }
      }
    }

    // If no results, try with the full description
    const fullResult = await this.searchByKeyword(productDescription);

    if (fullResult.success && fullResult.results.length > 0) {
      return fullResult;
    }

    return {
      success: false,
      results: [],
      query: productDescription,
      source: 'USITC HTS API',
      error: `No HS codes found for "${productDescription}". Try more specific product terms.`,
    };
  }

  /**
   * Map API result to our internal format
   */
  private mapApiResult(item: HtsApiResult): HtsSearchResult {
    const hasRates = Boolean(item.general || item.special || item.other);

    return {
      hsCode: item.htsno || '',
      description: this.cleanDescription(item.description),
      generalDuty: item.general || '',
      specialDuty: item.special || '',
      otherDuty: item.other || '',
      units: item.units || '',
      indent: item.indent || 0,
      isCategory: !hasRates || item.indent === 0,
      footnotes: item.footnotes || [],
    };
  }

  /**
   * Clean HTML and extra whitespace from description
   */
  private cleanDescription(desc: string): string {
    if (!desc) return '';

    return desc
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ') // Replace HTML spaces
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Extract search terms from product description
   */
  private extractSearchTerms(description: string): string[] {
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'from',
      'as',
      'is',
      'are',
      'was',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'could',
      'should',
      'may',
      'might',
      'must',
      'shall',
      'can',
      'need',
      'dare',
      'ought',
      'used',
      'made',
      'make',
      'type',
      'kind',
      'new',
      'used',
      'other',
    ]);

    const words = description
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 2 && !stopWords.has(word));

    // Priority: longer/more specific words first
    const sorted = words.sort((a, b) => b.length - a.length);

    // Return unique terms
    const unique = Array.from(new Set(sorted));

    // Also add compound terms (first 2-3 words together)
    if (words.length >= 2) {
      unique.unshift(words.slice(0, 2).join(' '));
    }
    if (words.length >= 3) {
      unique.unshift(words.slice(0, 3).join(' '));
    }

    return unique.slice(0, 5); // Top 5 search terms
  }
}

// ============================================================================
// FACTORY
// ============================================================================

let serviceInstance: UsitcHtsService | null = null;

export function getUsitcHtsService(): UsitcHtsService {
  if (!serviceInstance) {
    serviceInstance = new UsitcHtsService();
  }
  return serviceInstance;
}
