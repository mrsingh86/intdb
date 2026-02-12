/**
 * Clear Service
 *
 * The core intelligence service for Clear by Intoglo.
 * Handles conversations, tool execution, and response generation.
 */

import Anthropic from '@anthropic-ai/sdk';
import { SupabaseClient } from '@supabase/supabase-js';
import { CLEAR_SYSTEM_PROMPT, CLEAR_TOOLS, CLEAR_MODEL, CLEAR_MAX_TOKENS } from './clear-prompt';
import { getCustomsDutyService } from '@/lib/agents/kam/tools/services/customs-duty-service';
import { getUsitcHtsService } from '@/lib/agents/kam/tools/services/usitc-hts-service';

// ============================================================================
// TYPES
// ============================================================================

export interface ClearMessage {
  role: 'user' | 'assistant';
  content: string;
  toolResults?: ClearToolResult[];
}

export interface ClearConversation {
  id: string;
  messages: ClearMessage[];
  createdAt: string;
  updatedAt: string;
}

export interface ClearResponse {
  message: string;
  sources?: string[];
  dutyBreakdown?: {
    hsCode: string;
    origin: string;
    baseDuty: number;
    section232: number;
    section301: number;
    reciprocal: number;
    total: number;
  };
  suggestions?: string[];
  toolResults?: ClearToolResult[];
}

export interface ClearToolResult {
  tool: string;
  input: Record<string, any>;
  result: any;
}

// ============================================================================
// SERVICE
// ============================================================================

export class ClearService {
  private anthropic: Anthropic;
  private dutyService = getCustomsDutyService();
  private htsService = getUsitcHtsService();
  private supabase: SupabaseClient | null = null;

  constructor(supabase?: SupabaseClient) {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
    this.supabase = supabase || null;
  }

  /**
   * Process a user message and generate a response
   */
  async chat(
    userMessage: string,
    conversationHistory: ClearMessage[] = []
  ): Promise<ClearResponse> {
    // Build messages array
    const messages: Anthropic.MessageParam[] = [
      ...conversationHistory.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      {
        role: 'user' as const,
        content: userMessage,
      },
    ];

    // Initial API call
    let response = await this.anthropic.messages.create({
      model: CLEAR_MODEL,
      max_tokens: CLEAR_MAX_TOKENS,
      system: CLEAR_SYSTEM_PROMPT,
      tools: CLEAR_TOOLS as Anthropic.Tool[],
      messages,
    });

    // Handle tool use loop
    const toolResults: ClearToolResult[] = [];

    while (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
      );

      const toolResultContents: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        const toolInput = toolUse.input as Record<string, any>;
        const result = await this.executeTool(toolUse.name, toolInput);
        toolResults.push({ tool: toolUse.name, input: toolInput, result });

        toolResultContents.push({
          type: 'tool_result',
          tool_use_id: toolUse.id,
          content: JSON.stringify(result, null, 2),
        });
      }

      // Continue conversation with tool results
      messages.push({
        role: 'assistant',
        content: response.content,
      });
      messages.push({
        role: 'user',
        content: toolResultContents,
      });

      response = await this.anthropic.messages.create({
        model: CLEAR_MODEL,
        max_tokens: CLEAR_MAX_TOKENS,
        system: CLEAR_SYSTEM_PROMPT,
        tools: CLEAR_TOOLS as Anthropic.Tool[],
        messages,
      });
    }

    // Extract final text response
    const textBlocks = response.content.filter(
      (block): block is Anthropic.TextBlock => block.type === 'text'
    );
    const responseText = textBlocks.map((block) => block.text).join('\n');

    // Build response object
    const clearResponse: ClearResponse = {
      message: responseText,
      toolResults, // Include for storage in database
    };

    // Collect sources from all tool results
    const sources = new Set<string>();

    // Extract duty breakdown and sources
    const dutyResult = toolResults.find((r) => r.tool === 'lookup_customs_duty');
    if (dutyResult?.result?.success) {
      const data = dutyResult.result.data;
      clearResponse.dutyBreakdown = {
        hsCode: data.hsCode,
        origin: data.originCountry,
        baseDuty: data.baseDuty?.ratePercent || 0,
        section232: data.section232?.ratePercent || 0,
        section301: data.section301?.ratePercent || 0,
        reciprocal: data.reciprocalTariff?.ratePercent || 0,
        total: data.totalDuty?.ratePercent || 0,
      };
      sources.add('USITC HTS Database');
      sources.add('US Trade Representative');
    }

    // Collect sources from HS code lookup
    const hsCodeResult = toolResults.find((r) => r.tool === 'lookup_hs_code');
    if (hsCodeResult?.result?.source) {
      sources.add(hsCodeResult.result.source);
    }

    // Collect sources from web search
    const webResult = toolResults.find((r) => r.tool === 'web_search');
    if (webResult?.result?.results) {
      webResult.result.results.forEach((r: { source?: string }) => {
        if (r.source) sources.add(r.source);
      });
    }

    // Collect sources from landed cost
    const landedResult = toolResults.find((r) => r.tool === 'calculate_landed_cost');
    if (landedResult?.result?.success) {
      sources.add('CBP Fee Schedule');
      sources.add('USITC HTS Database');
    }

    if (sources.size > 0) {
      clearResponse.sources = Array.from(sources);
    }

    // Generate contextual suggestions
    clearResponse.suggestions = this.generateSuggestions(toolResults, clearResponse.dutyBreakdown);

    return clearResponse;
  }

  /**
   * Generate contextual follow-up suggestions
   */
  private generateSuggestions(
    toolResults: ClearToolResult[],
    dutyBreakdown?: ClearResponse['dutyBreakdown']
  ): string[] {
    const suggestions: string[] = [];

    // If duty is high, suggest alternatives
    if (dutyBreakdown && dutyBreakdown.total > 20) {
      suggestions.push('Can I reduce this duty with an FTA?');
      suggestions.push('What documents do I need to claim exemptions?');
    }

    // If Section 232 applies
    if (dutyBreakdown && dutyBreakdown.section232 > 0) {
      suggestions.push('How can I qualify for USMCA exemption?');
    }

    // If product from China
    if (dutyBreakdown && dutyBreakdown.origin?.toLowerCase() === 'china') {
      suggestions.push('What if I source from Vietnam instead?');
    }

    // If product from India
    if (dutyBreakdown && dutyBreakdown.origin?.toLowerCase() === 'india') {
      suggestions.push('What products are exempt under the India deal?');
    }

    // If no landed cost calculated yet
    if (!toolResults.find((t) => t.tool === 'calculate_landed_cost') && dutyBreakdown) {
      suggestions.push('Calculate total landed cost');
    }

    // If HS code was looked up, offer duty calculation
    const hsLookup = toolResults.find((t) => t.tool === 'lookup_hs_code');
    if (hsLookup?.result?.matches?.length > 0 && !dutyBreakdown) {
      suggestions.push('Calculate duty for this HS code');
    }

    return suggestions.slice(0, 3); // Max 3 suggestions
  }

  /**
   * Execute a tool and return the result
   */
  private async executeTool(toolName: string, input: Record<string, any>): Promise<any> {
    try {
      switch (toolName) {
        case 'lookup_customs_duty':
          return await this.lookupCustomsDuty(input);

        case 'lookup_hs_code':
          return await this.lookupHsCode(input);

        case 'web_search':
          return await this.webSearch(input);

        case 'calculate_landed_cost':
          return await this.calculateLandedCost(input);

        default:
          return { error: `Unknown tool: ${toolName}` };
      }
    } catch (error: any) {
      console.error(`[Clear] Tool error (${toolName}):`, error.message);
      return { error: error.message };
    }
  }

  /**
   * Lookup comprehensive customs duty
   */
  private async lookupCustomsDuty(input: Record<string, any>) {
    const result = await this.dutyService.calculateDuty({
      hsCode: input.hs_code,
      originCountry: input.origin_country,
      productDescription: input.product_description,
      vehicleRelated: input.vehicle_related,
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    return {
      success: true,
      data: {
        hsCode: result.hsCode,
        description: result.description,
        originCountry: result.originCountry,
        baseDuty: result.baseDuty,
        section232: result.section232,
        section301: result.section301,
        reciprocalTariff: result.reciprocalTariff,
        exemptions: result.exemptions,
        totalDuty: result.totalDuty,
        notes: result.notes,
        warnings: result.warnings,
      },
    };
  }

  /**
   * Lookup HS code by product description
   */
  private async lookupHsCode(input: Record<string, any>) {
    const result = await this.htsService.smartSearch(input.product_description);

    if (!result.success || result.results.length === 0) {
      return {
        success: false,
        error: result.error || 'No matching HS codes found',
        suggestion: 'Try using more specific product terms or check https://hts.usitc.gov/',
      };
    }

    // Return top matches
    return {
      success: true,
      matches: result.results.slice(0, 5).map((r) => ({
        hsCode: r.hsCode,
        description: r.description,
        dutyRate: r.generalDuty,
        specialPrograms: r.specialDuty,
      })),
      source: result.source,
    };
  }

  /**
   * Web search for trade news
   * Queries database for curated trade news, falls back to hardcoded data
   */
  private async webSearch(input: Record<string, any>) {
    const query = input.query.toLowerCase();

    // Try database first if available
    if (this.supabase) {
      try {
        const dbResults = await this.searchTradeNewsDB(query);
        if (dbResults.length > 0) {
          return {
            success: true,
            results: dbResults,
            source: 'Clear Trade News Database',
            note: 'Information based on latest available data. Check Federal Register for authoritative text.',
          };
        }
      } catch (error) {
        console.warn('[Clear] Database search failed, using fallback:', error);
      }
    }

    // Fallback to hardcoded results
    return this.searchTradeNewsFallback(query);
  }

  /**
   * Search trade news from database
   */
  private async searchTradeNewsDB(query: string): Promise<Array<{
    title: string;
    source: string;
    date: string;
    summary: string;
  }>> {
    if (!this.supabase) return [];

    const searchTerms = query.split(' ').filter((w) => w.length > 2);

    const { data, error } = await this.supabase
      .from('clear_trade_news')
      .select('title, source, published_date, summary, keywords')
      .eq('is_active', true)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString().split('T')[0]}`)
      .order('priority', { ascending: false })
      .order('published_date', { ascending: false })
      .limit(10);

    if (error || !data) {
      console.warn('[Clear] Trade news query error:', error?.message);
      return [];
    }

    // Filter by keyword matching
    const filtered = data.filter((item) => {
      const keywords = item.keywords as string[] || [];
      return searchTerms.some((term) =>
        keywords.some((kw) => kw.includes(term)) ||
        item.title.toLowerCase().includes(term) ||
        item.summary.toLowerCase().includes(term)
      );
    });

    return filtered.slice(0, 5).map((item) => ({
      title: item.title,
      source: item.source,
      date: item.published_date,
      summary: item.summary,
    }));
  }

  /**
   * Fallback hardcoded trade news search
   */
  private searchTradeNewsFallback(query: string) {
    const results: Array<{ title: string; source: string; date: string; summary: string }> = [];

    // India tariffs and trade deal
    if (query.includes('india') && (query.includes('tariff') || query.includes('deal') || query.includes('executive order') || query.includes('trade'))) {
      results.push(
        {
          title: 'Trump Removes India\'s 25% Russia-Related Tariff After Deal',
          source: 'Bloomberg',
          date: 'February 6, 2026',
          summary: 'President Trump signed executive order removing the 25% Russia oil penalty on Indian imports. Reciprocal tariff reduced to 18%.',
        },
        {
          title: 'India Reciprocal Tariff Now 18%',
          source: 'US Trade Representative',
          date: 'February 7, 2026',
          summary: 'India\'s reciprocal tariff is now 18% after removal of the 25% Russia penalty. Section 232 tariffs (steel 50%, aluminum 50%, auto 25%) still apply separately.',
        },
        {
          title: 'India Zero-Duty Exemptions',
          source: 'White House',
          date: 'February 6, 2026',
          summary: 'Zero duty on: gems, diamonds, pharmaceuticals, smartphones, tea, coffee, aircraft parts under India-US trade framework.',
        }
      );
    }

    // China tariffs
    if (query.includes('china') && (query.includes('tariff') || query.includes('301') || query.includes('trade'))) {
      results.push(
        {
          title: 'Section 301 Tariffs on China Remain at 25%',
          source: 'USTR',
          date: 'January 2026',
          summary: 'Section 301 tariffs on Lists 1-3 remain at 25%. List 4A at 7.5%. No exemptions currently active for most products.',
        },
        {
          title: 'China Reciprocal Tariff at 145%',
          source: 'Federal Register',
          date: 'February 2026',
          summary: 'China faces reciprocal tariff of 145% under IEEPA authorities, among the highest imposed on any trading partner.',
        }
      );
    }

    // Section 232 auto parts
    if (query.includes('section 232') || query.includes('auto') || query.includes('automobile')) {
      results.push(
        {
          title: 'Section 232 Auto Parts Tariffs Effective',
          source: 'White House',
          date: 'May 3, 2025',
          summary: '25% tariff on automobile parts including engines, transmissions, brakes from non-USMCA countries.',
        },
        {
          title: 'USMCA Auto Parts Exemption',
          source: 'CBP',
          date: '2025',
          summary: 'Auto parts with 75%+ USMCA regional value content exempt from Section 232 tariffs.',
        }
      );
    }

    // Steel and aluminum - UPDATED with correct rates
    if (query.includes('steel') || query.includes('aluminum') || query.includes('232')) {
      results.push(
        {
          title: 'Section 232 Steel and Aluminum Tariffs Increased',
          source: 'Commerce Department',
          date: 'March 2025',
          summary: 'Steel (Ch. 72-73) at 50%, Aluminum (Ch. 76) at 50% globally. UK retains preferential 25% rate. USMCA exempt.',
        }
      );
    }

    // USMCA
    if (query.includes('usmca') || query.includes('mexico') || query.includes('canada')) {
      results.push(
        {
          title: 'USMCA Preferential Treatment',
          source: 'CBP',
          date: '2025',
          summary: 'USMCA provides duty-free treatment for qualifying goods. Requires certificate of origin and 75% regional value content for autos.',
        }
      );
    }

    // Reciprocal tariffs general
    if (query.includes('reciprocal') || query.includes('ieepa') || (query.includes('country') && query.includes('tariff'))) {
      results.push(
        {
          title: 'Reciprocal Tariff Rates by Country',
          source: 'White House',
          date: 'February 2026',
          summary: 'IEEPA reciprocal tariffs: China 145%, India 18%, EU 20%, Japan 24%, Vietnam 46%. Agricultural products exempt.',
        }
      );
    }

    // Exemptions
    if (query.includes('exempt') || query.includes('agricultural') || query.includes('exception')) {
      results.push(
        {
          title: 'Agricultural Products Exempt from Reciprocal Tariffs',
          source: 'White House Executive Order',
          date: 'November 2025',
          summary: 'All agricultural products (HTS Ch. 1-24) exempt from reciprocal tariffs.',
        }
      );
    }

    if (results.length > 0) {
      return {
        success: true,
        results,
        note: 'Information based on latest available data. Check Federal Register for authoritative text.',
      };
    }

    return {
      success: true,
      results: [],
      note: 'No specific results found. For authoritative information, check federalregister.gov or ustr.gov.',
      suggestion: 'Try searching for "India tariff", "Section 232 auto", "China 301", or "USMCA exemption".',
    };
  }

  /**
   * Calculate landed cost
   */
  private async calculateLandedCost(input: Record<string, any>) {
    const { product_value, hs_code, origin_country, destination_port, destination_city } = input;

    // Get duty rate
    const dutyResult = await this.dutyService.calculateDuty({
      hsCode: hs_code,
      originCountry: origin_country,
    });

    if (!dutyResult.success) {
      return { success: false, error: dutyResult.error };
    }

    const dutyRate = dutyResult.totalDuty.ratePercent / 100;
    const dutyAmount = product_value * dutyRate;

    // Merchandise Processing Fee (0.3464% of value, min $31.67, max $614.35)
    const mpfRate = 0.003464;
    let mpf = product_value * mpfRate;
    mpf = Math.max(31.67, Math.min(614.35, mpf));

    // Harbor Maintenance Fee (0.125% of value)
    const hmfRate = 0.00125;
    const hmf = product_value * hmfRate;

    // Customs bond (estimate)
    const bondEstimate = 180;

    // Trucking estimate based on destination
    let truckingEstimate = 0;
    if (destination_city) {
      // Rough estimates from major ports
      const truckingRates: Record<string, number> = {
        'los angeles': 500,
        'long beach': 500,
        'new york': 600,
        'newark': 600,
        'savannah': 550,
        'chicago': 1200,
        'detroit': 1400,
        'atlanta': 800,
        'dallas': 1100,
        'phoenix': 900,
      };
      const cityLower = destination_city.toLowerCase();
      truckingEstimate = truckingRates[cityLower] || 800;
    }

    const totalLanded = product_value + dutyAmount + mpf + hmf + bondEstimate + truckingEstimate;

    return {
      success: true,
      breakdown: {
        productValue: product_value,
        duty: {
          rate: `${dutyResult.totalDuty.ratePercent}%`,
          amount: Math.round(dutyAmount * 100) / 100,
          calculation: dutyResult.totalDuty.calculation,
        },
        mpf: Math.round(mpf * 100) / 100,
        hmf: Math.round(hmf * 100) / 100,
        customsBond: bondEstimate,
        trucking: truckingEstimate,
        totalLanded: Math.round(totalLanded * 100) / 100,
      },
      notes: dutyResult.notes,
    };
  }
}

// ============================================================================
// FACTORY
// ============================================================================

let serviceInstance: ClearService | null = null;

export function getClearService(supabase?: SupabaseClient): ClearService {
  // If supabase provided, create new instance with it
  if (supabase) {
    return new ClearService(supabase);
  }
  // Otherwise use singleton without database
  if (!serviceInstance) {
    serviceInstance = new ClearService();
  }
  return serviceInstance;
}
