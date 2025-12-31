import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/shipments/[id]/containers
 *
 * Get containers and their events for a shipment.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();

    // Get containers for this shipment
    const { data: containers, error: containersError } = await supabase
      .from('shipment_containers')
      .select('*')
      .eq('shipment_id', id)
      .order('created_at', { ascending: true });

    if (containersError) {
      console.error('[API:GET /shipments/[id]/containers] Containers error:', containersError);
      // Return empty array if table doesn't exist
      return NextResponse.json({
        containers: [],
        events: [],
        milestones: [],
      });
    }

    // Get events for this shipment
    const { data: events, error: eventsError } = await supabase
      .from('shipment_events')
      .select('*')
      .eq('shipment_id', id)
      .order('event_date', { ascending: true });

    if (eventsError) {
      console.error('[API:GET /shipments/[id]/containers] Events error:', eventsError);
    }

    // Separate milestones from regular events
    const allEvents = events || [];
    const milestones = allEvents.filter(e => e.is_milestone);
    const regularEvents = allEvents.filter(e => !e.is_milestone);

    // Also get the shipment's container_number_primary if containers array is empty
    if ((containers || []).length === 0) {
      const { data: shipment } = await supabase
        .from('shipments')
        .select('container_number_primary')
        .eq('id', id)
        .single();

      if (shipment?.container_number_primary) {
        // Add the primary container as a virtual container
        return NextResponse.json({
          containers: [{
            id: 'primary',
            shipment_id: id,
            container_number: shipment.container_number_primary,
            container_type: null,
            is_primary: true,
          }],
          events: regularEvents,
          milestones,
        });
      }
    }

    return NextResponse.json({
      containers: containers || [],
      events: regularEvents,
      milestones,
    });
  } catch (error) {
    console.error('[API:GET /shipments/[id]/containers] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
