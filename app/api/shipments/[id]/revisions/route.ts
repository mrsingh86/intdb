import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/shipments/[id]/revisions
 *
 * Get booking revision history for a shipment.
 * Uses the booking_number from the shipment to look up revisions.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();

    // First get the shipment to find the booking number
    const { data: shipment, error: shipmentError } = await supabase
      .from('shipments')
      .select('booking_number')
      .eq('id', id)
      .single();

    if (shipmentError || !shipment) {
      return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });
    }

    if (!shipment.booking_number) {
      return NextResponse.json({
        revisions: [],
        message: 'No booking number associated with this shipment',
      });
    }

    // Get revisions from the view
    const { data: revisions, error: revisionsError } = await supabase
      .from('v_booking_revision_history')
      .select('*')
      .eq('booking_number', shipment.booking_number)
      .order('revision_number', { ascending: true });

    if (revisionsError) {
      console.error('[API:GET /shipments/[id]/revisions] Query error:', revisionsError);
      // If view doesn't exist, try the base table
      const { data: baseRevisions, error: baseError } = await supabase
        .from('booking_revisions')
        .select(`
          booking_number,
          revision_number,
          revision_type,
          vessel_name,
          voyage_number,
          etd,
          eta,
          port_of_loading,
          port_of_discharge,
          changed_fields,
          created_at
        `)
        .eq('booking_number', shipment.booking_number)
        .order('revision_number', { ascending: true });

      if (baseError) {
        console.error('[API:GET /shipments/[id]/revisions] Base query error:', baseError);
        return NextResponse.json({ error: 'Failed to fetch revisions' }, { status: 500 });
      }

      return NextResponse.json({
        booking_number: shipment.booking_number,
        revisions: baseRevisions || [],
        source: 'booking_revisions',
      });
    }

    return NextResponse.json({
      booking_number: shipment.booking_number,
      revisions: revisions || [],
      source: 'v_booking_revision_history',
    });
  } catch (error) {
    console.error('[API:GET /shipments/[id]/revisions] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
