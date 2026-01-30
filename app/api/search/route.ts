/**
 * General Search API - Site-wide search
 *
 * Searches across:
 * - Chronicle (emails) - using UnifiedSearchService
 * - Shipments
 * - Stakeholders
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  createEmbeddingService,
  createUnifiedSearchService,
} from '@/lib/chronicle';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );
}

interface SearchResult {
  id: string;
  type: 'shipment' | 'document' | 'email' | 'stakeholder';
  title: string;
  subtitle: string;
  url: string;
  matchType?: 'keyword' | 'semantic' | 'both';
  score?: number;
}

export async function GET(request: NextRequest) {
  const supabase = getSupabase();

  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q');

    if (!query || query.length < 2) {
      return NextResponse.json({ results: [] });
    }

    const searchTerm = query.toLowerCase();
    const results: SearchResult[] = [];

    // Initialize unified search for chronicle
    const embeddingService = createEmbeddingService(supabase);
    const unifiedSearch = createUnifiedSearchService(supabase, embeddingService);

    // Run all searches in parallel
    const [shipmentResults, stakeholderResults, chronicleResults] = await Promise.all([
      // Search shipments (booking number, BL number, status)
      supabase
        .from('shipments')
        .select('id, booking_number, bl_number, status, workflow_state')
        .or(`booking_number.ilike.%${searchTerm}%,bl_number.ilike.%${searchTerm}%`)
        .limit(5),

      // Search stakeholders (name, email)
      supabase
        .from('parties')
        .select('id, name, email, party_type')
        .or(`name.ilike.%${searchTerm}%,email.ilike.%${searchTerm}%`)
        .limit(5),

      // Search chronicle using unified search
      unifiedSearch.search(query, { limit: 10 }),
    ]);

    // Process shipment results
    if (shipmentResults.data) {
      results.push(...shipmentResults.data.map(s => ({
        id: s.id,
        type: 'shipment' as const,
        title: s.booking_number || s.bl_number || 'Unknown',
        subtitle: `${s.status || 'No status'} - ${s.workflow_state || 'No state'}`,
        url: `/shipments/${s.id}`,
      })));
    }

    // Process stakeholder results
    if (stakeholderResults.data) {
      results.push(...stakeholderResults.data.map(s => ({
        id: s.id,
        type: 'stakeholder' as const,
        title: s.name || 'Unknown',
        subtitle: `${s.party_type || 'Unknown type'} - ${s.email || 'No email'}`,
        url: `/stakeholders/${s.id}`,
      })));
    }

    // Process chronicle results (emails/documents)
    if (chronicleResults.results.length > 0) {
      results.push(...chronicleResults.results.slice(0, 5).map(c => ({
        id: c.chronicleId,
        type: ((c.documentType?.includes('bl') || c.documentType?.includes('invoice')) ? 'document' : 'email') as 'document' | 'email',
        title: c.subject || 'No subject',
        subtitle: `${c.documentType?.replace(/_/g, ' ') || 'Email'} - ${c.fromAddress || 'Unknown sender'}`,
        url: `/chronicle/${c.chronicleId}`,
        matchType: c.matchType,
        score: c.score,
      })));
    }

    // Sort by relevance (exact matches first, then by score)
    results.sort((a, b) => {
      // Exact title matches first
      const aExact = a.title.toLowerCase().includes(searchTerm) ? 0 : 1;
      const bExact = b.title.toLowerCase().includes(searchTerm) ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;

      // Then by score if available
      const aScore = a.score || 0;
      const bScore = b.score || 0;
      return bScore - aScore;
    });

    return NextResponse.json({
      results: results.slice(0, 15),
      query,
      searchStrategy: chronicleResults.strategy,
      queryType: chronicleResults.query.queryType,
    });
  } catch (error) {
    console.error('Search error:', error);
    return NextResponse.json({ error: 'Search failed', results: [] }, { status: 500 });
  }
}
