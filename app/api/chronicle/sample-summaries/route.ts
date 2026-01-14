/**
 * Sample AI Summaries API
 *
 * Get sample AI summaries to evaluate quality.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get 5 sample AI summaries
    const { data: summaries, error } = await supabase
      .from('shipment_ai_summaries')
      .select('*')
      .not('story', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(5);

    if (error) throw error;

    // Get shipment details via RPC (bypasses RLS)
    const shipmentMap = new Map();
    for (const s of summaries || []) {
      const { data } = await supabase
        .rpc('get_shipment_context_for_ai', { p_shipment_id: s.shipment_id });
      if (data?.[0]?.shipment_data) {
        shipmentMap.set(s.shipment_id, data[0].shipment_data);
      }
    }

    // Format output
    const formatted = summaries?.map((s: any, i: number) => {
      const ship = shipmentMap.get(s.shipment_id);
      return {
        index: i + 1,
        shipment: {
          booking: ship?.booking_number || 'N/A',
          mbl: ship?.mbl_number || 'N/A',
          carrier: ship?.carrier_name || 'N/A',
          shipper: ship?.shipper_name || 'N/A',
          consignee: ship?.consignee_name || 'N/A',
          stage: ship?.stage || 'N/A',
          route: `${ship?.port_of_loading || '?'} → ${ship?.port_of_discharge || '?'}`,
        },
        aiSummary: {
          story: s.story,
          currentBlocker: s.current_blocker,
          nextAction: s.next_action,
          riskLevel: s.risk_level,
          riskReason: s.risk_reason,
          financialImpact: s.financial_impact,
          customerImpact: s.customer_impact,
          chronicleCount: s.chronicle_count,
          generatedAt: s.updated_at,
        },
      };
    });

    return NextResponse.json({
      success: true,
      count: formatted?.length || 0,
      summaries: formatted,
    });
  } catch (error) {
    console.error('[Sample Summaries] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
