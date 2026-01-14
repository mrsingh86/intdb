/**
 * Debug HaikuSummaryService & RPC Functions
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Test 1: Direct table query (blocked by RLS)
    const { data: directShipments, error: directError } = await supabase
      .from('shipments')
      .select('id, booking_number')
      .limit(3);

    // Test 2: RPC function get_shipments_for_ai_summary
    const { data: rpcShipments, error: rpcError } = await supabase
      .rpc('get_shipments_for_ai_summary', { limit_count: 3 });

    // Test 3: If we got shipment IDs from RPC, test get_shipment_context_for_ai
    let contextTest = null;
    if (rpcShipments && rpcShipments.length > 0) {
      const testId = rpcShipments[0].shipment_id;
      const { data: contextData, error: contextError } = await supabase
        .rpc('get_shipment_context_for_ai', { p_shipment_id: testId });
      contextTest = {
        shipmentId: testId,
        data: contextData?.[0] || null,
        error: contextError?.message || null,
      };
    }

    // Test 4: Check chronicles exist for these shipments
    let chronicleTest = null;
    if (rpcShipments && rpcShipments.length > 0) {
      const testId = rpcShipments[0].shipment_id;
      const { data: chronicles, error: chronicleError } = await supabase
        .from('chronicle')
        .select('id, summary, document_type')
        .eq('shipment_id', testId)
        .limit(3);
      chronicleTest = {
        shipmentId: testId,
        count: chronicles?.length || 0,
        sample: chronicles?.slice(0, 2) || [],
        error: chronicleError?.message || null,
      };
    }

    return NextResponse.json({
      directQuery: {
        count: directShipments?.length || 0,
        error: directError?.message || null,
        sample: directShipments?.slice(0, 2),
      },
      rpcFunction: {
        count: rpcShipments?.length || 0,
        error: rpcError?.message || null,
        sample: rpcShipments?.slice(0, 2),
      },
      contextRpc: contextTest,
      chronicleData: chronicleTest,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}
