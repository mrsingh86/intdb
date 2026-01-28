/**
 * Pulse Search API - Smart Universal Search
 *
 * Detects query type and returns appropriate results:
 * - Booking/MBL/Container → Single dossier
 * - Port code/Party name → List of matching shipments
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getShipmentDossierService } from '@/lib/unified-intelligence/shipment-dossier-service';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Query type detection
type QueryType = 'booking' | 'container' | 'mbl' | 'port' | 'party';

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

// Known port codes for freight forwarding (Indian and US ports)
const KNOWN_PORTS = new Set([
  // India
  'INNSA', 'INMUN', 'INPAV', 'INCHE', 'INKOL', 'INBOM', 'INDEL', 'INBLR', 'INHYD',
  'INMAA', 'INCCJ', 'INTUT', 'INKTP', 'INLUH', 'INGIT',
  // USA
  'USNYC', 'USLAX', 'USOAK', 'USSEA', 'USHOU', 'USSAV', 'USNEW', 'USBAL', 'USMIA',
  'USCHI', 'USATL', 'USEWK', 'USEWR', 'USLGB', 'USSFO',
  // Other major ports
  'SGSIN', 'CNSHA', 'CNYTN', 'HKHKG', 'KRPUS', 'JPYOK', 'DEHAM', 'NLRTM', 'GBLES', 'AEJEA',
]);

function detectQueryType(query: string): QueryType {
  const q = query.trim().toUpperCase();

  // Container: 4 letters + 7 digits (e.g., MRSU7283866)
  if (/^[A-Z]{4}\d{7}$/.test(q)) {
    return 'container';
  }

  // MBL: Carrier prefix + numbers (e.g., MAEU262822342, HLCU123456789)
  if (/^(MAEU|HLCU|MSCU|OOLU|COSU|CMDU|EGLV|YMLU|ZIMU)[A-Z0-9]+$/.test(q)) {
    return 'mbl';
  }

  // Port code: Must be a known port code (not just any 2-5 letter word)
  if (KNOWN_PORTS.has(q)) {
    return 'port';
  }

  // Booking number: Mostly digits, possibly with some letters (e.g., 262822342)
  if (/^\d{6,15}$/.test(q) || /^[A-Z]{0,3}\d{6,15}$/.test(q)) {
    return 'booking';
  }

  // Default: Treat as party name search
  return 'party';
}

async function searchByPartyOrPort(query: string, queryType: QueryType): Promise<ShipmentSummary[]> {
  const searchTerm = query.trim();
  const pattern = `%${searchTerm}%`;

  let data: any[] | null = null;
  let error: any = null;

  // Apply filters based on query type
  if (queryType === 'port') {
    // Search both POL and POD using raw SQL for reliable ILIKE
    const result = await supabase
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
        container_numbers,
        occurred_at,
        si_cutoff,
        vgm_cutoff
      `)
      .not('booking_number', 'is', null)
      .or(`pol_location.ilike.${pattern},pod_location.ilike.${pattern}`)
      .order('occurred_at', { ascending: false })
      .limit(500);
    data = result.data;
    error = result.error;
  } else {
    // Party name search - use two separate queries and merge for reliability
    const [shipperResult, consigneeResult] = await Promise.all([
      supabase
        .from('chronicle')
        .select(`booking_number, mbl_number, shipper_name, consignee_name, pol_location, pod_location, vessel_name, etd, eta, container_numbers, occurred_at, si_cutoff, vgm_cutoff`)
        .not('booking_number', 'is', null)
        .ilike('shipper_name', pattern)
        .order('occurred_at', { ascending: false })
        .limit(300),
      supabase
        .from('chronicle')
        .select(`booking_number, mbl_number, shipper_name, consignee_name, pol_location, pod_location, vessel_name, etd, eta, container_numbers, occurred_at, si_cutoff, vgm_cutoff`)
        .not('booking_number', 'is', null)
        .ilike('consignee_name', pattern)
        .order('occurred_at', { ascending: false })
        .limit(300),
    ]);

    error = shipperResult.error || consigneeResult.error;
    data = [...(shipperResult.data || []), ...(consigneeResult.data || [])];
  }

  if (error) {
    console.error('[Pulse Search] Query error:', error);
    return [];
  }

  console.log(`[Pulse Search] Query "${searchTerm}" (${queryType}) returned ${data?.length || 0} rows`);

  // Aggregate by booking number to get unique shipments
  const shipmentMap = new Map<string, ShipmentSummary>();

  for (const row of data || []) {
    const booking = row.booking_number;
    if (!booking || typeof booking !== 'string') continue;

    // Clean booking number (remove array brackets if present)
    const cleanBooking = booking.replace(/[\[\]"]/g, '').trim();
    if (!cleanBooking || cleanBooking.length < 5) continue;

    if (!shipmentMap.has(cleanBooking)) {
      shipmentMap.set(cleanBooking, {
        bookingNumber: cleanBooking,
        mblNumber: row.mbl_number || undefined,
        shipper: row.shipper_name || undefined,
        consignee: row.consignee_name || undefined,
        pol: row.pol_location || undefined,
        pod: row.pod_location || undefined,
        vessel: row.vessel_name || undefined,
        etd: row.etd || undefined,
        eta: row.eta || undefined,
        stage: 'UNKNOWN',
        emailCount: 1,
        containerCount: row.container_numbers?.length || 0,
        siCutoff: row.si_cutoff || undefined,
        vgmCutoff: row.vgm_cutoff || undefined,
      });
    } else {
      // Update with latest data and increment count
      const existing = shipmentMap.get(cleanBooking)!;
      existing.emailCount++;

      // Use most recent non-null values
      if (row.mbl_number && !existing.mblNumber) existing.mblNumber = row.mbl_number;
      if (row.shipper_name && !existing.shipper) existing.shipper = row.shipper_name;
      if (row.consignee_name && !existing.consignee) existing.consignee = row.consignee_name;
      if (row.pol_location && !existing.pol) existing.pol = row.pol_location;
      if (row.pod_location && !existing.pod) existing.pod = row.pod_location;
      if (row.vessel_name && !existing.vessel) existing.vessel = row.vessel_name;
      if (row.etd && !existing.etd) existing.etd = row.etd;
      if (row.eta && !existing.eta) existing.eta = row.eta;
      if (row.si_cutoff && !existing.siCutoff) existing.siCutoff = row.si_cutoff;
      if (row.vgm_cutoff && !existing.vgmCutoff) existing.vgmCutoff = row.vgm_cutoff;
      if (row.container_numbers?.length > existing.containerCount) {
        existing.containerCount = row.container_numbers.length;
      }
    }
  }

  // Convert to array and sort by ETD (most recent first)
  const shipments = Array.from(shipmentMap.values());
  shipments.sort((a, b) => {
    const dateA = a.etd ? new Date(a.etd).getTime() : 0;
    const dateB = b.etd ? new Date(b.etd).getTime() : 0;
    return dateB - dateA;
  });

  // Determine stage based on dates
  const now = new Date();
  for (const s of shipments) {
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

  return shipments.slice(0, 50); // Limit to 50 results
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

    // Otherwise, process the search query
    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Search query required' },
        { status: 400 }
      );
    }

    const searchQuery = query.trim();
    const queryType = detectQueryType(searchQuery);

    // For direct identifiers, get single dossier
    if (queryType === 'booking' || queryType === 'container' || queryType === 'mbl') {
      const dossierService = getShipmentDossierService();
      const dossier = await dossierService.getShipmentDossier(searchQuery);

      if (!dossier) {
        return NextResponse.json(
          { success: false, error: `No shipment found for "${searchQuery}"` },
          { status: 404 }
        );
      }

      return NextResponse.json({ success: true, type: 'single', dossier });
    }

    // For port/party search, return list
    const shipments = await searchByPartyOrPort(searchQuery, queryType);

    if (shipments.length === 0) {
      return NextResponse.json(
        { success: false, error: `No shipments found for "${searchQuery}"` },
        { status: 404 }
      );
    }

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
      queryType,
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
