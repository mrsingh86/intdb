import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { ShipmentRepository } from '@/lib/repositories/shipment-repository';
import { ShipmentStatus } from '@/types/shipment';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/shipments
 *
 * List shipments with filtering and pagination.
 * Includes conflict detection for multi-source dates.
 *
 * Filters:
 * - confirmed_only=true: Show only shipments with direct carrier booking confirmation
 *   (Uses is_direct_carrier_confirmed column - SINGLE SOURCE OF TRUTH)
 *
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();
    const shipmentRepo = new ShipmentRepository(supabase);

    const { filters, pagination, confirmedOnly } = parseShipmentFilters(request);

    // Add is_direct_carrier_confirmed filter if confirmed_only=true
    // This uses the SINGLE SOURCE OF TRUTH column instead of querying shipment_documents
    const enhancedFilters = confirmedOnly
      ? { ...filters, is_direct_carrier_confirmed: true }
      : filters;

    const result = await shipmentRepo.findAll(enhancedFilters, pagination);

    // Mark shipments missing voyage data as "incomplete"
    const filteredData = result.data.map(s => {
      const hasVoyageData = s.etd || s.eta || s.port_of_loading || s.port_of_discharge;
      return {
        ...s,
        is_incomplete: !hasVoyageData,
      };
    });

    // Get document counts for all shipments
    const shipmentIds = filteredData.map(s => s.id);
    const [conflictMap, documentCountMap] = await Promise.all([
      detectConflictsForShipments(supabase, shipmentIds),
      getDocumentCountsForShipments(supabase, shipmentIds),
    ]);

    const enrichedShipments = filteredData.map(s => ({
      ...s,
      hasDateConflict: conflictMap.get(s.id) || false,
      document_count: documentCountMap.get(s.id) || 0,
    }));

    return NextResponse.json({
      shipments: enrichedShipments,
      pagination: result.pagination,
    });
  } catch (error) {
    console.error('[API:GET /shipments] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

/**
 * Detect date conflicts for multiple shipments in one query
 */
async function detectConflictsForShipments(
  supabase: any,
  shipmentIds: string[]
): Promise<Map<string, boolean>> {
  const conflictMap = new Map<string, boolean>();

  if (shipmentIds.length === 0) return conflictMap;

  // Get all shipment documents
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('shipment_id, email_id')
    .in('shipment_id', shipmentIds);

  if (!docs || docs.length === 0) return conflictMap;

  const emailIds = docs.map((d: any) => d.email_id).filter(Boolean);

  if (emailIds.length === 0) return conflictMap;

  // Get ETD/ETA entities for all emails
  const { data: entities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_type, entity_value')
    .in('email_id', emailIds)
    .in('entity_type', ['etd', 'eta']);

  if (!entities || entities.length === 0) return conflictMap;

  // Build email -> shipment mapping
  const emailToShipment = new Map<string, string>();
  docs.forEach((d: any) => {
    if (d.email_id) emailToShipment.set(d.email_id, d.shipment_id);
  });

  // Group entities by shipment
  const shipmentDates = new Map<string, { etd: Set<string>; eta: Set<string> }>();

  entities.forEach((e: any) => {
    const shipmentId = emailToShipment.get(e.email_id);
    if (!shipmentId) return;

    if (!shipmentDates.has(shipmentId)) {
      shipmentDates.set(shipmentId, { etd: new Set(), eta: new Set() });
    }

    const dates = shipmentDates.get(shipmentId)!;
    const normalizedDate = normalizeDate(e.entity_value);

    if (e.entity_type === 'etd') {
      dates.etd.add(normalizedDate);
    } else if (e.entity_type === 'eta') {
      dates.eta.add(normalizedDate);
    }
  });

  // Detect conflicts (more than 1 unique date for ETD or ETA)
  shipmentDates.forEach((dates, shipmentId) => {
    const hasConflict = dates.etd.size > 1 || dates.eta.size > 1;
    conflictMap.set(shipmentId, hasConflict);
  });

  return conflictMap;
}

function normalizeDate(dateStr: string): string {
  try {
    return new Date(dateStr).toDateString();
  } catch {
    return dateStr;
  }
}

/**
 * Get document counts for multiple shipments
 */
async function getDocumentCountsForShipments(
  supabase: any,
  shipmentIds: string[]
): Promise<Map<string, number>> {
  const countMap = new Map<string, number>();

  if (shipmentIds.length === 0) return countMap;

  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('shipment_id')
    .in('shipment_id', shipmentIds);

  if (!docs) return countMap;

  for (const doc of docs) {
    const current = countMap.get(doc.shipment_id) || 0;
    countMap.set(doc.shipment_id, current + 1);
  }

  return countMap;
}

/**
 * POST /api/shipments
 *
 * Create a new shipment manually.
 * Requires authentication.
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();
    const shipmentRepo = new ShipmentRepository(supabase);

    const body = await request.json();

    // Validate required fields
    if (!body.booking_number && !body.bl_number && !body.container_number_primary) {
      return NextResponse.json(
        { error: 'At least one identifier required (booking_number, bl_number, or container_number_primary)' },
        { status: 400 }
      );
    }

    const shipment = await shipmentRepo.create(body);

    return NextResponse.json(shipment, { status: 201 });
  } catch (error) {
    console.error('[API:POST /shipments] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

/**
 * Parse shipment filters from request
 * Small helper function (< 20 lines)
 */
function parseShipmentFilters(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const statusParam = searchParams.get('status');
  const statusFilter = statusParam ? statusParam.split(',') as ShipmentStatus[] : undefined;

  return {
    filters: {
      status: statusFilter,
      carrier_id: searchParams.get('carrier_id') || undefined,
      shipper_id: searchParams.get('shipper_id') || undefined,
      consignee_id: searchParams.get('consignee_id') || undefined,
      search: searchParams.get('search') || undefined,
    },
    pagination: {
      page: parseInt(searchParams.get('page') || '1'),
      limit: parseInt(searchParams.get('limit') || '500'),
    },
    confirmedOnly: searchParams.get('confirmed_only') === 'true',
  };
}
