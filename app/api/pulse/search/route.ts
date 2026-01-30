/**
 * Pulse Search API - Smart Universal Search
 *
 * Uses UnifiedSearchService for intelligent query routing:
 * - Identifiers (booking/MBL/container) → Keyword search → Single dossier
 * - Party names → Hybrid search → List of shipments
 * - Port codes/names → Keyword/Hybrid → List of shipments
 * - Concepts → Semantic search → Relevant emails
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getShipmentDossierService } from '@/lib/unified-intelligence/shipment-dossier-service';
import {
  classifyQuery,
  createEmbeddingService,
  createUnifiedSearchService,
} from '@/lib/chronicle';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Initialize services
const embeddingService = createEmbeddingService(supabase);
const unifiedSearch = createUnifiedSearchService(supabase, embeddingService);

interface ShipmentSummary {
  bookingNumber: string;
  mblNumber?: string;
  shipper?: string;
  consignee?: string;
  pol?: string;
  pod?: string;
  vessel?: string;
  etd?: string;
  eta?: string;
  stage: string;
  emailCount: number;
  containerCount: number;
  siCutoff?: string;
  vgmCutoff?: string;
}

/**
 * Aggregate search results into unique shipments
 */
function aggregateToShipments(results: any[]): ShipmentSummary[] {
  const shipmentMap = new Map<string, ShipmentSummary>();

  for (const row of results) {
    const booking = row.bookingNumber;
    if (!booking || typeof booking !== 'string') continue;

    // Clean booking number
    const cleanBooking = booking.replace(/[\[\]"]/g, '').trim();
    if (!cleanBooking || cleanBooking.length < 5) continue;

    if (!shipmentMap.has(cleanBooking)) {
      shipmentMap.set(cleanBooking, {
        bookingNumber: cleanBooking,
        mblNumber: row.mblNumber || undefined,
        shipper: row.shipperName || undefined,
        consignee: row.consigneeName || undefined,
        pol: row.polLocation || undefined,
        pod: row.podLocation || undefined,
        vessel: row.vesselName || undefined,
        etd: row.etd || undefined,
        eta: row.eta || undefined,
        stage: 'UNKNOWN',
        emailCount: 1,
        containerCount: 0,
        siCutoff: row.siCutoff || undefined,
        vgmCutoff: row.vgmCutoff || undefined,
      });
    } else {
      const existing = shipmentMap.get(cleanBooking)!;
      existing.emailCount++;

      // Use most recent non-null values
      if (row.mblNumber && !existing.mblNumber) existing.mblNumber = row.mblNumber;
      if (row.shipperName && !existing.shipper) existing.shipper = row.shipperName;
      if (row.consigneeName && !existing.consignee) existing.consignee = row.consigneeName;
      if (row.polLocation && !existing.pol) existing.pol = row.polLocation;
      if (row.podLocation && !existing.pod) existing.pod = row.podLocation;
      if (row.vesselName && !existing.vessel) existing.vessel = row.vesselName;
      if (row.etd && !existing.etd) existing.etd = row.etd;
      if (row.eta && !existing.eta) existing.eta = row.eta;
    }
  }

  // Determine stage based on dates
  const now = new Date();
  for (const s of shipmentMap.values()) {
    if (s.eta) {
      const eta = new Date(s.eta);
      if (eta < now) {
        s.stage = 'ARRIVED';
      } else if (s.etd) {
        const etd = new Date(s.etd);
        s.stage = etd < now ? 'IN_TRANSIT' : 'PENDING';
      }
    } else if (s.etd) {
      const etd = new Date(s.etd);
      s.stage = etd < now ? 'IN_TRANSIT' : 'PENDING';
    }
  }

  // Convert to array and sort by ETD
  const shipments = Array.from(shipmentMap.values());
  shipments.sort((a, b) => {
    const dateA = a.etd ? new Date(a.etd).getTime() : 0;
    const dateB = b.etd ? new Date(b.etd).getTime() : 0;
    return dateB - dateA;
  });

  return shipments.slice(0, 50);
}

/**
 * Fetch additional shipment details for search results
 */
async function enrichSearchResults(bookingNumbers: string[]): Promise<Map<string, any>> {
  if (bookingNumbers.length === 0) return new Map();

  const { data } = await supabase
    .from('chronicle')
    .select(`
      booking_number,
      mbl_number,
      shipper_name,
      consignee_name,
      pol_location,
      pod_location,
      vessel_name,
      etd,
      eta,
      si_cutoff,
      vgm_cutoff
    `)
    .in('booking_number', bookingNumbers)
    .not('booking_number', 'is', null);

  const enrichMap = new Map<string, any>();
  for (const row of data || []) {
    if (row.booking_number && !enrichMap.has(row.booking_number)) {
      enrichMap.set(row.booking_number, {
        shipperName: row.shipper_name,
        consigneeName: row.consignee_name,
        polLocation: row.pol_location,
        podLocation: row.pod_location,
        vesselName: row.vessel_name,
        etd: row.etd,
        eta: row.eta,
        siCutoff: row.si_cutoff,
        vgmCutoff: row.vgm_cutoff,
      });
    }
  }
  return enrichMap;
}

export async function POST(request: NextRequest) {
  try {
    const { query, bookingNumber } = await request.json();

    // If bookingNumber is provided, fetch specific dossier (from list click)
    if (bookingNumber) {
      const dossierService = getShipmentDossierService();
      const dossier = await dossierService.getShipmentDossier(bookingNumber);

      if (!dossier) {
        return NextResponse.json(
          { success: false, error: `No shipment found for "${bookingNumber}"` },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true, type: 'single', dossier });
    }

    // Process the search query
    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Search query required' },
        { status: 400 }
      );
    }

    const searchQuery = query.trim();

    // Use UnifiedSearchService for intelligent routing
    const searchResponse = await unifiedSearch.search(searchQuery, { limit: 100 });
    const classification = searchResponse.query;

    console.log(`[Pulse Search] Query "${searchQuery}" → ${classification.queryType}/${classification.searchStrategy} (${searchResponse.totalFound} results in ${searchResponse.searchTime}ms)`);

    // For direct identifiers (booking, container, MBL), get single dossier
    if (['booking_number', 'container_number', 'mbl_number', 'hbl_number'].includes(classification.queryType)) {
      const dossierService = getShipmentDossierService();
      const dossier = await dossierService.getShipmentDossier(searchQuery);

      if (!dossier) {
        // Try to find via search results
        if (searchResponse.results.length > 0 && searchResponse.results[0].bookingNumber) {
          const firstBooking = searchResponse.results[0].bookingNumber;
          const fallbackDossier = await dossierService.getShipmentDossier(firstBooking);
          if (fallbackDossier) {
            return NextResponse.json({ success: true, type: 'single', dossier: fallbackDossier });
          }
        }

        return NextResponse.json(
          { success: false, error: `No shipment found for "${searchQuery}"` },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true, type: 'single', dossier });
    }

    // For other queries, return list of shipments
    if (searchResponse.results.length === 0) {
      return NextResponse.json(
        { success: false, error: `No shipments found for "${searchQuery}"` },
        { status: 404 }
      );
    }

    // Get unique booking numbers and enrich
    const bookingNumbers = [...new Set(
      searchResponse.results
        .map(r => r.bookingNumber)
        .filter((b): b is string => !!b)
    )];

    const enrichedData = await enrichSearchResults(bookingNumbers);

    // Build shipment summaries
    const resultsWithDetails = searchResponse.results.map(r => ({
      bookingNumber: r.bookingNumber,
      mblNumber: r.mblNumber,
      ...enrichedData.get(r.bookingNumber || ''),
    }));

    const shipments = aggregateToShipments(resultsWithDetails);

    // If only one result, return full dossier directly
    if (shipments.length === 1) {
      const dossierService = getShipmentDossierService();
      const dossier = await dossierService.getShipmentDossier(shipments[0].bookingNumber);

      if (dossier) {
        return NextResponse.json({ success: true, type: 'single', dossier });
      }
    }

    return NextResponse.json({
      success: true,
      type: 'list',
      query: searchQuery,
      queryType: classification.queryType,
      searchStrategy: classification.searchStrategy,
      confidence: classification.confidence,
      searchTimeMs: searchResponse.searchTime,
      count: shipments.length,
      shipments,
    });
  } catch (error) {
    console.error('[Pulse Search] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to search shipment' },
      { status: 500 }
    );
  }
}
