import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Stage arrays for phase mapping (document-based workflow)
const PRE_DEPARTURE_STAGES = [
  // Booking phase
  'PENDING', 'REQUESTED', 'BOOKED', 'BOOKING_CONFIRMED', 'BOOKING_AMENDMENT', 'AMENDMENT',
  'BOOKING_CANCELLED', 'CANCELLED',
  // SI phase
  'SI_STAGE', 'SI_SUBMITTED', 'SI_CONFIRMED', 'SI_AMENDMENT',
  // Draft BL phase
  'DRAFT_BL', 'DRAFT_BL_ISSUED', 'DRAFT_BL_AMENDMENT',
  // Pre-departure operations
  'VGM', 'VGM_SUBMITTED', 'VGM_CONFIRMED',
  'CONTAINER_PICKUP', 'CONTAINER_RELEASE', 'EMPTY_PICKUP',
  'CARGO_RECEIVED', 'GATE_IN', 'TERMINAL_RECEIPT',
  'STUFFING', 'CARGO_CUTOFF',
];

const POST_DEPARTURE_STAGES = [
  // Final BL issued - cargo on water
  'BL_ISSUED', 'FINAL_BL', 'MBL_ISSUED', 'HBL_ISSUED', 'OBL_ISSUED',
  'ON_BOARD', 'ON_BOARD_BL',
  // Vessel departed
  'DEPARTED', 'SAILING', 'IN_TRANSIT', 'TRANSSHIPMENT',
  // Commercial documents / Invoice to customer
  'INVOICE', 'INVOICED', 'INVOICE_SENT', 'FREIGHT_INVOICE', 'COMMERCIAL_INVOICE',
  'DEBIT_NOTE', 'CREDIT_NOTE',
  // Tracking updates
  'VESSEL_UPDATE', 'ETA_UPDATE', 'SCHEDULE_UPDATE',
];

const PRE_ARRIVAL_STAGES = [
  // Arrival notification (ARRIVED in DB means arrival notice received, not actual arrival)
  'ARRIVED', 'ARRIVAL', 'ARRIVAL_NOTICE', 'PRE_ARRIVAL', 'ARRIVING', 'ARRIVAL_NOTIFICATION',
  // Customs preparation
  'CUSTOMS_ENTRY', 'DRAFT_ENTRY', 'ISF_FILED', 'IMPORT_DECLARATION',
  'CUSTOMS_PENDING', 'EXAM_ORDERED',
  // Delivery prep
  'DELIVERY_ORDER', 'DO_ISSUED', 'TELEX_RELEASE',
];

const POST_ARRIVAL_STAGES = [
  // Vessel discharged
  'VESSEL_ARRIVED', 'DISCHARGED', 'OFFLOADED',
  // Customs clearance
  'CUSTOMS', 'CUSTOMS_CLEARED', 'CLEARANCE', 'RELEASED',
  // Final mile
  'OUT_FOR_DELIVERY', 'IN_TRANSIT_DELIVERY',
  'GATE_OUT', 'CONTAINER_RELEASED',
  // Completed
  'DELIVERED', 'COMPLETED', 'POD_RECEIVED', 'PROOF_OF_DELIVERY',
  'EMPTY_RETURNED',
];

// Map stage to phase
function stageToPhase(stage: string | null): string {
  if (!stage) return 'pre_departure';
  const s = stage.toUpperCase().replace(/[- ]/g, '_');

  if (PRE_DEPARTURE_STAGES.includes(s)) return 'pre_departure';
  if (POST_DEPARTURE_STAGES.includes(s)) return 'post_departure';
  if (PRE_ARRIVAL_STAGES.includes(s)) return 'pre_arrival';
  if (POST_ARRIVAL_STAGES.includes(s)) return 'post_arrival';

  return 'pre_departure';
}

// Calculate journey progress from stage
function stageToProgress(stage: string | null): number {
  if (!stage) return 0;
  const s = stage.toUpperCase().replace(/[- ]/g, '_');

  // Pre-departure: 0-25%
  const preDepartureProgress: Record<string, number> = {
    'PENDING': 5, 'REQUESTED': 8, 'BOOKED': 12, 'BOOKING_CONFIRMED': 12,
    'SI_STAGE': 16, 'SI_SUBMITTED': 16, 'SI_CONFIRMED': 18,
    'DRAFT_BL': 20, 'VGM': 22, 'VGM_CONFIRMED': 23,
    'CONTAINER_PICKUP': 24, 'CARGO_RECEIVED': 25,
  };

  // Post-departure: 25-50%
  const postDepartureProgress: Record<string, number> = {
    'BL_ISSUED': 30, 'FINAL_BL': 32, 'ON_BOARD': 35,
    'DEPARTED': 40, 'SAILING': 42, 'IN_TRANSIT': 45,
    'TRANSSHIPMENT': 48, 'INVOICED': 50,
  };

  // Pre-arrival: 50-75%
  const preArrivalProgress: Record<string, number> = {
    'ARRIVED': 55, 'ARRIVAL': 55, 'ARRIVAL_NOTICE': 55, 'PRE_ARRIVAL': 58, 'ARRIVING': 60,
    'CUSTOMS_ENTRY': 65, 'DRAFT_ENTRY': 68, 'ISF_FILED': 70,
    'DELIVERY_ORDER': 72, 'DO_ISSUED': 74,
  };

  // Post-arrival: 75-100%
  const postArrivalProgress: Record<string, number> = {
    'DISCHARGED': 78, 'OFFLOADED': 80,
    'CUSTOMS': 82, 'CUSTOMS_CLEARED': 85, 'CLEARANCE': 88, 'RELEASED': 90,
    'OUT_FOR_DELIVERY': 92, 'GATE_OUT': 94,
    'DELIVERED': 100, 'COMPLETED': 100, 'POD_RECEIVED': 100,
  };

  return preDepartureProgress[s] || postDepartureProgress[s] ||
         preArrivalProgress[s] || postArrivalProgress[s] || 10;
}

// Map phase filter to stages
function phaseToStages(phase: string): string[] {
  switch (phase) {
    case 'pre_departure':
      return PRE_DEPARTURE_STAGES;
    case 'post_departure':
      return POST_DEPARTURE_STAGES;
    case 'pre_arrival':
      return PRE_ARRIVAL_STAGES;
    case 'post_arrival':
      return POST_ARRIVAL_STAGES;
    default:
      return [];
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q') || '';
    const phase = searchParams.get('phase') || '';
    const sort = searchParams.get('sort') || 'etd';
    const order = searchParams.get('order') || 'asc';
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '50');
    const dateWindow = parseInt(searchParams.get('dateWindow') || '0'); // ±days filter (0 = no filter)

    const now = new Date();

    // Build query
    let query = supabase
      .from('shipments')
      .select(`
        id,
        booking_number,
        bl_number,
        shipper_name,
        consignee_name,
        vessel_name,
        voyage_number,
        port_of_loading,
        port_of_loading_code,
        port_of_discharge,
        port_of_discharge_code,
        etd,
        eta,
        stage,
        carrier_name,
        si_cutoff,
        vgm_cutoff,
        created_at,
        status
      `, { count: 'exact' })
      .not('status', 'eq', 'cancelled');

    // Apply search filter
    if (q) {
      query = query.or(`booking_number.ilike.%${q}%,bl_number.ilike.%${q}%,vessel_name.ilike.%${q}%,shipper_name.ilike.%${q}%,consignee_name.ilike.%${q}%`);
    }

    // Apply phase filter by mapping to stages
    if (phase) {
      const stages = phaseToStages(phase);
      if (stages.length > 0) {
        query = query.in('stage', stages);
      }
    }

    // Apply sorting
    const sortMap: Record<string, string> = {
      booking_number: 'booking_number',
      created_at: 'created_at',
      etd: 'etd',
      eta: 'eta',
    };
    const sortColumn = sortMap[sort] || 'etd';

    let shipments: Array<{
      id: string; booking_number: string | null; bl_number: string | null;
      shipper_name: string | null; consignee_name: string | null; vessel_name: string | null;
      voyage_number: string | null; port_of_loading: string | null; port_of_loading_code: string | null;
      port_of_discharge: string | null; port_of_discharge_code: string | null;
      etd: string | null; eta: string | null; stage: string | null; carrier_name: string | null;
      si_cutoff: string | null; vgm_cutoff: string | null; created_at: string; status: string | null;
    }> = [];

    if (dateWindow > 0) {
      // Filter by ±dateWindow days (for Arrival/Departure tabs)
      const daysAgo = new Date(Date.now() - dateWindow * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      const daysAhead = new Date(Date.now() + dateWindow * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

      let dateQuery = supabase
        .from('shipments')
        .select(`
          id, booking_number, bl_number, shipper_name, consignee_name, vessel_name,
          voyage_number, port_of_loading, port_of_loading_code, port_of_discharge,
          port_of_discharge_code, etd, eta, stage, carrier_name, si_cutoff, vgm_cutoff,
          created_at, status
        `)
        .not('status', 'eq', 'cancelled');

      // Filter by date range based on sort column
      if (sortColumn === 'eta') {
        dateQuery = dateQuery.gte('eta', daysAgo).lte('eta', daysAhead);
      } else {
        dateQuery = dateQuery.gte('etd', daysAgo).lte('etd', daysAhead);
      }

      if (q) {
        dateQuery = dateQuery.or(`booking_number.ilike.%${q}%,bl_number.ilike.%${q}%,vessel_name.ilike.%${q}%,shipper_name.ilike.%${q}%,consignee_name.ilike.%${q}%`);
      }

      dateQuery = dateQuery.order(sortColumn, { ascending: order === 'asc', nullsFirst: false }).limit(pageSize);

      const { data } = await dateQuery;
      shipments = data || [];
    } else {
      // No date filter (for All tab) - return all shipments
      let allQuery = supabase
        .from('shipments')
        .select(`
          id, booking_number, bl_number, shipper_name, consignee_name, vessel_name,
          voyage_number, port_of_loading, port_of_loading_code, port_of_discharge,
          port_of_discharge_code, etd, eta, stage, carrier_name, si_cutoff, vgm_cutoff,
          created_at, status
        `)
        .not('status', 'eq', 'cancelled');

      if (q) {
        allQuery = allQuery.or(`booking_number.ilike.%${q}%,bl_number.ilike.%${q}%,vessel_name.ilike.%${q}%,shipper_name.ilike.%${q}%,consignee_name.ilike.%${q}%`);
      }

      allQuery = allQuery.order(sortColumn, { ascending: order === 'asc', nullsFirst: false }).limit(pageSize);

      const { data } = await allQuery;
      shipments = data || [];
    }

    const count = shipments.length;

    // Get document counts for each shipment
    const shipmentIds = shipments?.map(s => s.id) || [];
    const { data: documentCounts } = await supabase
      .from('chronicle')
      .select('shipment_id')
      .in('shipment_id', shipmentIds);

    const docCountMap = new Map<string, number>();
    documentCounts?.forEach(d => {
      const count = docCountMap.get(d.shipment_id) || 0;
      docCountMap.set(d.shipment_id, count + 1);
    });

    // Get AI summaries for intelligence signals
    const { data: aiSummaries } = await supabase
      .from('shipment_ai_summaries')
      .select(`
        shipment_id,
        risk_level,
        risk_reason,
        days_overdue,
        escalation_count,
        issue_count,
        urgent_message_count,
        days_since_activity,
        current_blocker,
        blocker_owner,
        blocker_type,
        narrative,
        key_insight,
        next_action,
        action_owner,
        action_priority,
        action_contact,
        documented_charges,
        estimated_detention,
        sla_status,
        sla_breach_reason,
        hours_since_customer_update,
        escalation_level,
        escalate_to,
        escalation_reason,
        root_cause_category,
        root_cause_subcategory,
        predicted_risks,
        customer_draft_subject,
        customer_draft_body,
        priority_score
      `)
      .in('shipment_id', shipmentIds);

    const summaryMap = new Map<string, NonNullable<typeof aiSummaries>[number]>();
    aiSummaries?.forEach(s => summaryMap.set(s.shipment_id, s));

    // Transform to response format
    const transformedShipments = shipments?.map(ship => {
      const siCutoff = ship.si_cutoff ? new Date(ship.si_cutoff) : null;
      const vgmCutoff = ship.vgm_cutoff ? new Date(ship.vgm_cutoff) : null;
      const phase = stageToPhase(ship.stage);
      const progress = stageToProgress(ship.stage);
      const summary = summaryMap.get(ship.id);

      return {
        id: ship.id,
        bookingNumber: ship.booking_number || ship.bl_number || ship.id.slice(0, 8),
        blNumber: ship.bl_number,
        shipper: ship.shipper_name,
        consignee: ship.consignee_name,
        vesselName: ship.vessel_name,
        pol: ship.port_of_loading,
        polCode: ship.port_of_loading_code,
        pod: ship.port_of_discharge,
        podCode: ship.port_of_discharge_code,
        etd: ship.etd,
        eta: ship.eta,
        phase: phase,
        stage: ship.stage || 'PENDING',
        journeyProgress: progress,
        documentsCount: docCountMap.get(ship.id) || 0,
        cutoffs: {
          si: siCutoff ? {
            date: ship.si_cutoff,
            daysRemaining: Math.floor((siCutoff.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
          } : undefined,
          vgm: vgmCutoff ? {
            date: ship.vgm_cutoff,
            daysRemaining: Math.floor((vgmCutoff.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
          } : undefined,
        },
        carrier: ship.carrier_name,
        createdAt: ship.created_at,
        // AI Intelligence signals
        aiSummary: summary ? {
          riskLevel: summary.risk_level,
          riskReason: summary.risk_reason,
          daysOverdue: summary.days_overdue,
          escalationCount: summary.escalation_count,
          issueCount: summary.issue_count,
          urgentCount: summary.urgent_message_count,
          daysSinceActivity: summary.days_since_activity,
          currentBlocker: summary.current_blocker,
          blockerOwner: summary.blocker_owner,
          blockerType: summary.blocker_type,
          narrative: summary.narrative,
          keyInsight: summary.key_insight,
          nextAction: summary.next_action,
          nextActionOwner: summary.action_owner,
          actionPriority: summary.action_priority,
          actionContact: summary.action_contact,
          financialImpact: {
            documentedCharges: summary.documented_charges,
            estimatedDetention: summary.estimated_detention,
          },
          // SLA & Escalation
          slaStatus: summary.sla_status,
          slaBreachReason: summary.sla_breach_reason,
          hoursSinceCustomerUpdate: summary.hours_since_customer_update,
          escalationLevel: summary.escalation_level,
          escalateTo: summary.escalate_to,
          escalationReason: summary.escalation_reason,
          // Root Cause
          rootCauseCategory: summary.root_cause_category,
          rootCauseSubcategory: summary.root_cause_subcategory,
          // Predictions & Drafts
          predictedRisks: summary.predicted_risks,
          customerDraftSubject: summary.customer_draft_subject,
          customerDraftBody: summary.customer_draft_body,
          priorityScore: summary.priority_score,
        } : null,
      };
    }) || [];

    return NextResponse.json({
      shipments: transformedShipments,
      total: count || 0,
      page,
      pageSize,
      filters: {
        phases: ['pre_departure', 'post_departure', 'pre_arrival', 'post_arrival'],
        carriers: [],
      },
    });
  } catch (error) {
    console.error('Error fetching shipments:', error);
    return NextResponse.json({ error: 'Failed to fetch shipments' }, { status: 500 });
  }
}
