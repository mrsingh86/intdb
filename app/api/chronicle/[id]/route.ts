import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: chronicleId } = await params;

    // Fetch chronicle record with linked shipment
    const { data: chronicle, error } = await supabase
      .from('chronicle')
      .select(`
        id,
        gmail_message_id,
        email_subject,
        email_from,
        email_to,
        email_date,
        document_type,
        document_subtype,
        carrier_id,
        classification_confidence,
        classification_reasoning,
        extracted_data,
        shipment_id,
        linked_by,
        link_confidence,
        actions_detected,
        issues_detected,
        processing_status,
        processing_error,
        processed_at,
        created_at,
        shipments:shipment_id (
          id,
          booking_number,
          bl_number,
          vessel_name,
          status,
          workflow_state
        )
      `)
      .eq('id', chronicleId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json({ error: 'Chronicle not found' }, { status: 404 });
      }
      throw error;
    }

    // Transform the response
    const response = {
      chronicle: {
        ...chronicle,
        shipment: chronicle.shipments,
        shipments: undefined,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching chronicle:', error);
    return NextResponse.json(
      { error: 'Failed to fetch chronicle' },
      { status: 500 }
    );
  }
}
