/**
 * @deprecated This API route is deprecated. Use /api/chronicle-v2/ endpoints instead.
 * This V1 route will be removed in a future release.
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Map stage to phase (document-based workflow)
// Phases represent the shipment lifecycle based on documents received

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
  const s = stage.toUpperCase();
  const progressMap: Record<string, number> = {
    'PENDING': 5,
    'REQUESTED': 10,
    'BOOKED': 20,
    'SI_STAGE': 30,
    'DRAFT_BL': 40,
    'BL_ISSUED': 50,
    'DEPARTED': 60,
    'IN_TRANSIT': 65,
    'SAILING': 70,
    'ARRIVED': 80,
    'ARRIVAL': 80,
    'CUSTOMS': 85,
    'CLEARANCE': 90,
    'DELIVERED': 100,
    'COMPLETED': 100,
  };
  return progressMap[s] || 10;
}

export async function GET() {
  try {
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get shipments
    const { data: shipments, error: shipmentsError } = await supabase
      .from('shipments')
      .select('id, stage, etd, eta, booking_number, bl_number, si_cutoff, vgm_cutoff, vessel_name')
      .not('status', 'eq', 'cancelled');

    if (shipmentsError) throw shipmentsError;

    // Calculate totals by phase
    const totals = {
      active: shipments?.length || 0,
      preDeparture: 0,
      postDeparture: 0,
      preArrival: 0,
      postArrival: 0,
    };

    // Calculate journey distribution
    const distribution = {
      early: 0,      // 0-25%
      midway: 0,     // 25-50%
      advanced: 0,   // 50-75%
      nearComplete: 0, // 75-100%
    };

    // Calculate cutoffs
    const cutoffs: {
      urgent: Array<{
        shipmentId: string;
        bookingNumber: string;
        cutoffType: string;
        cutoffDate: string;
        daysRemaining: number;
        hoursRemaining: number;
      }>;
      siPending: number;
      vgmPending: number;
    } = {
      urgent: [],
      siPending: 0,
      vgmPending: 0,
    };

    // Shipments needing attention
    const attention: Array<{
      id: string;
      bookingNumber: string;
      stage: string;
      journeyProgress: number;
      daysToEtd: number | null;
    }> = [];

    let totalProgress = 0;

    shipments?.forEach((ship) => {
      const phase = stageToPhase(ship.stage);
      const progress = stageToProgress(ship.stage);
      totalProgress += progress;

      // Count by phase
      if (phase === 'pre_departure') totals.preDeparture++;
      else if (phase === 'post_departure') totals.postDeparture++;
      else if (phase === 'pre_arrival') totals.preArrival++;
      else if (phase === 'post_arrival') totals.postArrival++;

      // Journey distribution
      if (progress < 25) distribution.early++;
      else if (progress < 50) distribution.midway++;
      else if (progress < 75) distribution.advanced++;
      else distribution.nearComplete++;

      // Check cutoffs
      const checkCutoff = (cutoffDate: string | null, type: string) => {
        if (!cutoffDate) return;
        const cutoff = new Date(cutoffDate);
        const diffMs = cutoff.getTime() - now.getTime();
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);

        if (diffDays <= 5 && diffDays >= -2) {
          cutoffs.urgent.push({
            shipmentId: ship.id,
            bookingNumber: ship.booking_number || ship.bl_number || ship.id.slice(0, 8),
            cutoffType: type,
            cutoffDate: cutoffDate,
            daysRemaining: diffDays,
            hoursRemaining: diffHours,
          });
        }

        if (type === 'si' && diffDays > 0) cutoffs.siPending++;
        if (type === 'vgm' && diffDays > 0) cutoffs.vgmPending++;
      };

      checkCutoff(ship.si_cutoff, 'si');
      checkCutoff(ship.vgm_cutoff, 'vgm');

      // Check if needs attention (low progress + ETD soon)
      if (progress < 50 && ship.etd) {
        const etd = new Date(ship.etd);
        const daysToEtd = Math.floor((etd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysToEtd <= 14 && daysToEtd >= 0) {
          attention.push({
            id: ship.id,
            bookingNumber: ship.booking_number || ship.bl_number || ship.id.slice(0, 8),
            stage: ship.stage || 'PENDING',
            journeyProgress: progress,
            daysToEtd,
          });
        }
      }
    });

    // Sort cutoffs by urgency
    cutoffs.urgent.sort((a, b) => a.hoursRemaining - b.hoursRemaining);

    // Sort attention by ETD (soonest first)
    attention.sort((a, b) => (a.daysToEtd || 999) - (b.daysToEtd || 999));

    // Get recent activity from chronicle
    const { count: processedCount } = await supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', yesterday.toISOString());

    const { count: linkedCount } = await supabase
      .from('chronicle')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', yesterday.toISOString())
      .not('shipment_id', 'is', null);

    const { count: createdCount } = await supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', yesterday.toISOString());

    return NextResponse.json({
      totals,
      journey: {
        distribution,
        averageProgress: shipments?.length ? Math.round(totalProgress / shipments.length) : 0,
      },
      cutoffs,
      attention: attention.slice(0, 10),
      recentActivity: {
        newEmails: processedCount || 0,
        processed: processedCount || 0,
        linked: linkedCount || 0,
        shipmentsCreated: createdCount || 0,
      },
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    return NextResponse.json({ error: 'Failed to fetch dashboard' }, { status: 500 });
  }
}
