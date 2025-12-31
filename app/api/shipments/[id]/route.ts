import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { ShipmentRepository } from '@/lib/repositories/shipment-repository';
import { ShipmentDocumentRepository } from '@/lib/repositories/shipment-document-repository';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/shipments/[id]
 *
 * Get shipment details with linked documents, classifications, and stakeholders.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();
    const shipmentRepo = new ShipmentRepository(supabase);
    const documentRepo = new ShipmentDocumentRepository(supabase);

    // Fetch shipment and documents in parallel
    const [shipment, documents] = await Promise.all([
      shipmentRepo.findById(id),
      documentRepo.findByShipmentIdWithClassification(id),
    ]);

    // Fetch stakeholders - try linked parties first, fallback to flat columns
    const stakeholderIds = [
      shipment.shipper_id,
      shipment.consignee_id,
      shipment.carrier_id,
    ].filter(Boolean);

    let stakeholders: Record<string, any> = {};

    // First, try to fetch from linked parties table
    if (stakeholderIds.length > 0) {
      const { data: parties } = await supabase
        .from('parties')
        .select('id, party_name, party_type, contact_email, contact_phone, address, city, country, reliability_score, response_time_avg_hours, total_shipments, is_customer')
        .in('id', stakeholderIds);

      if (parties) {
        for (const party of parties) {
          if (party.id === shipment.shipper_id) stakeholders.shipper = party;
          if (party.id === shipment.consignee_id) stakeholders.consignee = party;
          if (party.id === shipment.carrier_id) stakeholders.carrier = party;
        }
      }
    }

    // Fallback: Use flat columns if IDs not linked
    // Cast to access flat columns that may not be in strict Shipment type
    const s = shipment as unknown as Record<string, unknown>;
    if (!stakeholders.shipper && s.shipper_name) {
      stakeholders.shipper = {
        party_name: s.shipper_name as string,
        address: s.shipper_address as string | undefined,
        party_type: 'shipper',
      };
    }
    if (!stakeholders.consignee && s.consignee_name) {
      stakeholders.consignee = {
        party_name: s.consignee_name as string,
        address: s.consignee_address as string | undefined,
        party_type: 'consignee',
      };
    }
    if (!stakeholders.notify_party && s.notify_party_name) {
      stakeholders.notify_party = {
        party_name: s.notify_party_name as string,
        address: s.notify_party_address as string | undefined,
        party_type: 'notify_party',
      };
    }

    // Fetch carrier info if available
    let carrier = null;
    if (shipment.carrier_id) {
      const { data: carrierData } = await supabase
        .from('carriers')
        .select('id, carrier_name, carrier_code, carrier_type')
        .eq('id', shipment.carrier_id)
        .single();
      carrier = carrierData;
    }

    return NextResponse.json({
      shipment,
      documents,
      stakeholders,
      carrier,
    });
  } catch (error: any) {
    console.error('[API:GET /shipments/[id]] Error:', error);

    // Handle not found errors
    if (error.name === 'ShipmentNotFoundError') {
      return NextResponse.json(
        { error: `Shipment not found` },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

/**
 * PATCH /api/shipments/[id]
 *
 * Update shipment details.
 * Requires authentication.
 */
export const PATCH = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();
    const shipmentRepo = new ShipmentRepository(supabase);

    const updates = await request.json();

    const shipment = await shipmentRepo.update(id, updates);

    return NextResponse.json(shipment);
  } catch (error: any) {
    console.error('[API:PATCH /shipments/[id]] Error:', error);

    if (error.name === 'ShipmentNotFoundError') {
      return NextResponse.json(
        { error: `Shipment not found` },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
