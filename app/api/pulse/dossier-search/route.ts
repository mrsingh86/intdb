/**
 * Pulse Dossier Search API - DEEP search within a shipment
 *
 * Searches ALL fields including:
 * - Identifiers (containers, MBL, HBL, work orders, etc.)
 * - Parties (shipper, consignee, carrier)
 * - Locations (origin, destination, ports)
 * - Content (subject, summary, full body preview)
 * - Attachments (extracted PDF text)
 * - Semantic search for concepts
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  classifyQuery,
  createEmbeddingService,
} from '@/lib/chronicle';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const embeddingService = createEmbeddingService(supabase);

interface SearchResult {
  id: string;
  type: 'email' | 'document';
  subject: string;
  sender: string;
  date: string;
  snippet: string;
  matchedField: string;
  matchedText: string;
  matchType: 'keyword' | 'semantic';
  similarity?: number;
  gmailLink?: string;
  emailViewUrl?: string;
  documentType?: string;
}

interface MatchInfo {
  field: string;
  category: string;
  value: string;
}

/**
 * Deep search across all fields of an email
 */
function deepSearchEmail(email: any, searchLower: string): MatchInfo | null {
  // 1. IDENTIFIERS - highest priority
  const identifierFields = [
    { field: 'container_numbers', category: 'identifier', isArray: true },
    { field: 'mbl_number', category: 'identifier' },
    { field: 'hbl_number', category: 'identifier' },
    { field: 'mawb_number', category: 'identifier' },
    { field: 'hawb_number', category: 'identifier' },
    { field: 'work_order_number', category: 'identifier' },
    { field: 'pro_number', category: 'identifier' },
    { field: 'invoice_number', category: 'identifier' },
    { field: 'reference_numbers', category: 'identifier', isArray: true },
  ];

  for (const { field, category, isArray } of identifierFields) {
    const value = email[field];
    if (isArray && Array.isArray(value)) {
      for (const item of value) {
        if (item && item.toLowerCase().includes(searchLower)) {
          return { field, category, value: item };
        }
      }
    } else if (value && value.toLowerCase().includes(searchLower)) {
      return { field, category, value };
    }
  }

  // 2. PARTIES
  const partyFields = [
    { field: 'shipper_name', category: 'party' },
    { field: 'consignee_name', category: 'party' },
    { field: 'notify_party_name', category: 'party' },
    { field: 'carrier_name', category: 'party' },
    { field: 'from_party', category: 'party' },
    { field: 'from_address', category: 'party' },
  ];

  for (const { field, category } of partyFields) {
    const value = email[field];
    if (value && value.toLowerCase().includes(searchLower)) {
      return { field, category, value };
    }
  }

  // 3. VESSEL & ROUTE
  const routeFields = [
    { field: 'vessel_name', category: 'route' },
    { field: 'voyage_number', category: 'route' },
    { field: 'flight_number', category: 'route' },
    { field: 'origin_location', category: 'route' },
    { field: 'destination_location', category: 'route' },
    { field: 'por_location', category: 'route' },
    { field: 'pol_location', category: 'route' },
    { field: 'pod_location', category: 'route' },
    { field: 'pofd_location', category: 'route' },
  ];

  for (const { field, category } of routeFields) {
    const value = email[field];
    if (value && value.toLowerCase().includes(searchLower)) {
      return { field, category, value };
    }
  }

  // 4. CONTENT - subject, summary, body
  if (email.subject && email.subject.toLowerCase().includes(searchLower)) {
    return { field: 'subject', category: 'content', value: email.subject };
  }

  if (email.summary && email.summary.toLowerCase().includes(searchLower)) {
    return { field: 'summary', category: 'content', value: email.summary };
  }

  if (email.body_preview && email.body_preview.toLowerCase().includes(searchLower)) {
    const idx = email.body_preview.toLowerCase().indexOf(searchLower);
    const start = Math.max(0, idx - 50);
    const end = Math.min(email.body_preview.length, idx + searchLower.length + 100);
    let snippet = email.body_preview.substring(start, end);
    if (start > 0) snippet = '...' + snippet;
    if (end < email.body_preview.length) snippet = snippet + '...';
    return { field: 'body', category: 'content', value: snippet };
  }

  // 5. DOCUMENT TYPE
  const docType = email.document_type?.replace(/_/g, ' ') || '';
  if (docType.toLowerCase().includes(searchLower)) {
    return { field: 'document_type', category: 'content', value: docType };
  }

  // 6. ISSUE & ACTION
  if (email.issue_description && email.issue_description.toLowerCase().includes(searchLower)) {
    return { field: 'issue_description', category: 'issue', value: email.issue_description };
  }

  if (email.action_description && email.action_description.toLowerCase().includes(searchLower)) {
    return { field: 'action_description', category: 'action', value: email.action_description };
  }

  // 7. COMMODITY
  if (email.commodity && email.commodity.toLowerCase().includes(searchLower)) {
    return { field: 'commodity', category: 'cargo', value: email.commodity };
  }

  // 8. ATTACHMENTS - Search extracted PDF text
  if (email.attachments && Array.isArray(email.attachments)) {
    for (const attachment of email.attachments) {
      const extractedText = attachment.extractedText || attachment.extracted_text || '';
      if (extractedText && extractedText.toLowerCase().includes(searchLower)) {
        const idx = extractedText.toLowerCase().indexOf(searchLower);
        const start = Math.max(0, idx - 50);
        const end = Math.min(extractedText.length, idx + searchLower.length + 100);
        let snippet = extractedText.substring(start, end);
        if (start > 0) snippet = '...' + snippet;
        if (end < extractedText.length) snippet = snippet + '...';
        const filename = attachment.filename || attachment.name || 'attachment';
        return { field: `attachment: ${filename}`, category: 'attachment', value: snippet };
      }
    }
  }

  return null;
}

/**
 * Format field name for display
 */
function formatFieldName(field: string): string {
  return field
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
}

export async function POST(request: NextRequest) {
  console.log('[Dossier Search API] Deep search request received');
  try {
    const body = await request.json();
    const { bookingNumber, keyword } = body;

    if (!bookingNumber || !keyword) {
      return NextResponse.json(
        { success: false, error: 'Booking number and keyword required' },
        { status: 400 }
      );
    }

    const searchTerm = keyword.trim();
    if (searchTerm.length < 2) {
      return NextResponse.json(
        { success: false, error: 'Search term too short' },
        { status: 400 }
      );
    }

    // Classify the query to determine search strategy
    const classification = classifyQuery(searchTerm);
    const useSemanticSearch = classification.searchStrategy === 'semantic' ||
                              classification.searchStrategy === 'hybrid';

    console.log(`[Dossier Search] DEEP "${searchTerm}" → ${classification.queryType}/${classification.searchStrategy}`);

    const results: SearchResult[] = [];

    // Fetch ALL fields for deep search
    const { data: emails, error } = await supabase
      .from('chronicle')
      .select(`
        id,
        gmail_message_id,
        subject,
        from_address,
        from_party,
        body_preview,
        snippet,
        summary,
        occurred_at,
        document_type,
        attachments,
        container_numbers,
        mbl_number,
        hbl_number,
        mawb_number,
        hawb_number,
        work_order_number,
        pro_number,
        invoice_number,
        reference_numbers,
        shipper_name,
        consignee_name,
        notify_party_name,
        carrier_name,
        vessel_name,
        voyage_number,
        flight_number,
        origin_location,
        destination_location,
        por_location,
        pol_location,
        pod_location,
        pofd_location,
        issue_description,
        action_description,
        commodity
      `)
      .eq('booking_number', bookingNumber)
      .order('occurred_at', { ascending: false });

    if (error) {
      console.error('[Dossier Search API] Query error:', error);
      return NextResponse.json(
        { success: false, error: 'Search failed', details: error.message },
        { status: 500 }
      );
    }

    console.log('[Dossier Search API] Found', emails?.length || 0, 'emails for booking', bookingNumber);

    // Deep keyword matching
    const searchLower = searchTerm.toLowerCase();
    const keywordMatchedIds = new Set<string>();

    for (const email of emails || []) {
      const match = deepSearchEmail(email, searchLower);

      if (match) {
        keywordMatchedIds.add(email.id);
        const hasAttachment = email.attachments && Array.isArray(email.attachments) && email.attachments.length > 0;

        results.push({
          id: email.id,
          type: hasAttachment ? 'document' : 'email',
          subject: email.subject || '(No subject)',
          sender: email.from_party || email.from_address || 'Unknown',
          date: email.occurred_at,
          snippet: match.value,
          matchedField: formatFieldName(match.field),
          matchedText: `${match.category}: ${match.field}`,
          matchType: 'keyword',
          gmailLink: email.gmail_message_id ? `https://mail.google.com/mail/u/0/#inbox/${email.gmail_message_id}` : undefined,
          emailViewUrl: `/api/chronicle-v2/email-view/${email.id}`,
          documentType: email.document_type,
        });
      }
    }

    // Add semantic search for conceptual/hybrid queries
    if (useSemanticSearch && embeddingService) {
      try {
        const bookingEmailIds = new Set((emails || []).map(e => e.id));

        const semanticResults = await embeddingService.searchGlobal(searchTerm, {
          limit: 50,
          minSimilarity: 0.60, // Lower threshold for deeper results
        });

        for (const sr of semanticResults) {
          if (bookingEmailIds.has(sr.id) && !keywordMatchedIds.has(sr.id)) {
            const email = (emails || []).find(e => e.id === sr.id);
            if (email) {
              const hasAttachment = email.attachments && Array.isArray(email.attachments) && email.attachments.length > 0;

              results.push({
                id: email.id,
                type: hasAttachment ? 'document' : 'email',
                subject: email.subject || '(No subject)',
                sender: email.from_party || email.from_address || 'Unknown',
                date: email.occurred_at,
                snippet: email.summary || email.snippet || '',
                matchedField: 'Semantic Match',
                matchedText: `${Math.round(sr.similarity * 100)}% similar`,
                matchType: 'semantic',
                similarity: sr.similarity,
                gmailLink: email.gmail_message_id ? `https://mail.google.com/mail/u/0/#inbox/${email.gmail_message_id}` : undefined,
                emailViewUrl: `/api/chronicle-v2/email-view/${email.id}`,
                documentType: email.document_type,
              });
            }
          }
        }
      } catch (semanticError) {
        console.warn('[Dossier Search] Semantic search failed:', semanticError);
      }
    }

    // Sort: identifiers first, then other keywords, then semantic, then by date
    const categoryPriority: Record<string, number> = {
      'identifier': 1,
      'party': 2,
      'route': 3,
      'content': 4,
      'attachment': 5,
      'issue': 6,
      'action': 7,
      'cargo': 8,
    };

    results.sort((a, b) => {
      // Keyword before semantic
      if (a.matchType !== b.matchType) {
        return a.matchType === 'keyword' ? -1 : 1;
      }
      // Within keyword, sort by category priority
      if (a.matchType === 'keyword' && b.matchType === 'keyword') {
        const catA = a.matchedText.split(':')[0] || 'content';
        const catB = b.matchedText.split(':')[0] || 'content';
        const prioA = categoryPriority[catA] || 99;
        const prioB = categoryPriority[catB] || 99;
        if (prioA !== prioB) return prioA - prioB;
      }
      // Then by date
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

    // Group results by match category for summary
    const matchSummary: Record<string, number> = {};
    for (const r of results) {
      if (r.matchType === 'keyword') {
        const cat = r.matchedText.split(':')[0] || 'other';
        matchSummary[cat] = (matchSummary[cat] || 0) + 1;
      }
    }

    return NextResponse.json({
      success: true,
      keyword: searchTerm,
      queryType: classification.queryType,
      searchStrategy: classification.searchStrategy,
      searchDepth: 'deep',
      count: results.length,
      keywordMatches: results.filter(r => r.matchType === 'keyword').length,
      semanticMatches: results.filter(r => r.matchType === 'semantic').length,
      matchSummary,
      fieldsSearched: [
        'identifiers (containers, MBL, HBL, work orders, invoices)',
        'parties (shipper, consignee, carrier)',
        'routes (vessel, ports, origin, destination)',
        'content (subject, summary, body)',
        'attachments (extracted PDF text)',
        'issues & actions',
      ],
      results,
    });
  } catch (error) {
    console.error('[Dossier Search] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Search failed' },
      { status: 500 }
    );
  }
}
