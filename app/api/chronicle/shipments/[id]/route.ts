import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Stage arrays for phase mapping (document-based workflow)
const PRE_DEPARTURE_STAGES = [
  'PENDING', 'REQUESTED', 'BOOKED', 'BOOKING_CONFIRMED', 'BOOKING_AMENDMENT', 'AMENDMENT',
  'BOOKING_CANCELLED', 'CANCELLED',
  'SI_STAGE', 'SI_SUBMITTED', 'SI_CONFIRMED', 'SI_AMENDMENT',
  'DRAFT_BL', 'DRAFT_BL_ISSUED', 'DRAFT_BL_AMENDMENT',
  'VGM', 'VGM_SUBMITTED', 'VGM_CONFIRMED',
  'CONTAINER_PICKUP', 'CONTAINER_RELEASE', 'EMPTY_PICKUP',
  'CARGO_RECEIVED', 'GATE_IN', 'TERMINAL_RECEIPT', 'STUFFING', 'CARGO_CUTOFF',
];

const POST_DEPARTURE_STAGES = [
  'BL_ISSUED', 'FINAL_BL', 'MBL_ISSUED', 'HBL_ISSUED', 'OBL_ISSUED',
  'ON_BOARD', 'ON_BOARD_BL',
  'DEPARTED', 'SAILING', 'IN_TRANSIT', 'TRANSSHIPMENT',
  // Invoice to customer
  'INVOICE', 'INVOICED', 'INVOICE_SENT', 'FREIGHT_INVOICE', 'COMMERCIAL_INVOICE',
  'DEBIT_NOTE', 'CREDIT_NOTE',
  'VESSEL_UPDATE', 'ETA_UPDATE', 'SCHEDULE_UPDATE',
];

const PRE_ARRIVAL_STAGES = [
  // Arrival notification (ARRIVED in DB means arrival notice received, not actual arrival)
  'ARRIVED', 'ARRIVAL', 'ARRIVAL_NOTICE', 'PRE_ARRIVAL', 'ARRIVING', 'ARRIVAL_NOTIFICATION',
  'CUSTOMS_ENTRY', 'DRAFT_ENTRY', 'ISF_FILED', 'IMPORT_DECLARATION',
  'CUSTOMS_PENDING', 'EXAM_ORDERED',
  'DELIVERY_ORDER', 'DO_ISSUED', 'TELEX_RELEASE',
];

const POST_ARRIVAL_STAGES = [
  // Vessel discharged
  'VESSEL_ARRIVED', 'DISCHARGED', 'OFFLOADED',
  'CUSTOMS', 'CUSTOMS_CLEARED', 'CLEARANCE', 'RELEASED',
  'OUT_FOR_DELIVERY', 'IN_TRANSIT_DELIVERY',
  'GATE_OUT', 'CONTAINER_RELEASED',
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

  const progressMap: Record<string, number> = {
    // Pre-departure: 0-25%
    'PENDING': 5, 'REQUESTED': 8, 'BOOKED': 12, 'BOOKING_CONFIRMED': 12,
    'SI_STAGE': 16, 'SI_SUBMITTED': 16, 'SI_CONFIRMED': 18,
    'DRAFT_BL': 20, 'VGM': 22, 'VGM_CONFIRMED': 23,
    'CONTAINER_PICKUP': 24, 'CARGO_RECEIVED': 25,
    // Post-departure: 25-50%
    'BL_ISSUED': 30, 'FINAL_BL': 32, 'ON_BOARD': 35,
    'DEPARTED': 40, 'SAILING': 42, 'IN_TRANSIT': 45,
    'TRANSSHIPMENT': 48, 'INVOICED': 50,
    // Pre-arrival: 50-75%
    'ARRIVED': 55, 'ARRIVAL': 55, 'ARRIVAL_NOTICE': 55, 'PRE_ARRIVAL': 58, 'ARRIVING': 60,
    'CUSTOMS_ENTRY': 65, 'DRAFT_ENTRY': 68, 'ISF_FILED': 70,
    'DELIVERY_ORDER': 72, 'DO_ISSUED': 74,
    // Post-arrival: 75-100%
    'DISCHARGED': 78, 'OFFLOADED': 80,
    'CUSTOMS': 82, 'CUSTOMS_CLEARED': 85, 'CLEARANCE': 88, 'RELEASED': 90,
    'OUT_FOR_DELIVERY': 92, 'GATE_OUT': 94,
    'DELIVERED': 100, 'COMPLETED': 100, 'POD_RECEIVED': 100,
  };

  return progressMap[s] || 10;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const now = new Date();

    // Get shipment details
    const { data: shipment, error: shipmentError } = await supabase
      .from('shipments')
      .select(`
        id,
        booking_number,
        bl_number,
        shipper_name,
        consignee_name,
        notify_party_name,
        vessel_name,
        voyage_number,
        port_of_loading,
        port_of_loading_code,
        port_of_discharge,
        port_of_discharge_code,
        place_of_receipt,
        place_of_delivery,
        etd,
        eta,
        atd,
        ata,
        stage,
        carrier_name,
        si_cutoff,
        vgm_cutoff,
        cargo_cutoff,
        container_numbers,
        cargo_description,
        commodity_description,
        incoterms,
        created_at,
        updated_at,
        status
      `)
      .eq('id', id)
      .single();

    if (shipmentError) {
      if (shipmentError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Shipment not found' }, { status: 404 });
      }
      throw shipmentError;
    }

    const phase = stageToPhase(shipment.stage);
    const progress = stageToProgress(shipment.stage);

    // Get chronicle documents linked to this shipment
    const { data: chronicles } = await supabase
      .from('chronicle')
      .select(`
        id,
        gmail_message_id,
        subject,
        from_address,
        occurred_at,
        document_type,
        carrier_name,
        ai_confidence,
        summary,
        has_action,
        action_description,
        attachments,
        created_at
      `)
      .eq('shipment_id', id)
      .order('occurred_at', { ascending: true });

    // Get shipment events
    const { data: events } = await supabase
      .from('shipment_events')
      .select('id, event_type, event_date, location, description, source_type, created_at')
      .eq('shipment_id', id)
      .order('event_date', { ascending: true });

    // Get AI summary for intelligence display
    const { data: aiSummary } = await supabase
      .from('shipment_ai_summaries')
      .select(`
        story,
        narrative,
        current_blocker,
        blocker_owner,
        blocker_type,
        next_action,
        action_owner,
        action_contact,
        financial_impact,
        documented_charges,
        estimated_detention,
        customer_impact,
        customer_action_required,
        risk_level,
        risk_reason,
        days_overdue,
        escalation_count,
        days_since_activity,
        issue_count,
        urgent_message_count,
        carrier_performance,
        shipper_risk_signal,
        key_insight,
        key_deadline,
        intelligence_warnings,
        updated_at
      `)
      .eq('shipment_id', id)
      .single();

    // Get escalation details for deep dive
    const { data: escalations } = await supabase
      .from('chronicle')
      .select('id, occurred_at, from_party, issue_type, summary')
      .eq('shipment_id', id)
      .eq('message_type', 'escalation')
      .order('occurred_at', { ascending: false });

    // Get issues for deep dive
    const { data: issues } = await supabase
      .from('chronicle')
      .select('id, occurred_at, message_type, issue_type, from_party, summary')
      .eq('shipment_id', id)
      .eq('has_issue', true)
      .order('occurred_at', { ascending: false });

    // Get urgent/negative messages for deep dive
    const { data: urgentMessages } = await supabase
      .from('chronicle')
      .select('id, occurred_at, message_type, sentiment, from_party, summary')
      .eq('shipment_id', id)
      .in('sentiment', ['urgent', 'negative'])
      .order('occurred_at', { ascending: false });

    // Build journey chapters from chronicle data
    const chapters = buildJourneyChapters(chronicles || [], events || [], phase);

    // Calculate cutoffs
    const cutoffs = buildCutoffData(shipment, now);

    // Build routing visualization data
    const routing = {
      originInland: shipment.place_of_receipt,
      portOfLoading: shipment.port_of_loading,
      portOfLoadingCode: shipment.port_of_loading_code,
      vesselName: shipment.vessel_name,
      voyageNumber: shipment.voyage_number,
      portOfDischarge: shipment.port_of_discharge,
      portOfDischargeCode: shipment.port_of_discharge_code,
      destinationInland: shipment.place_of_delivery,
      currentPhase: phase,
      journeyProgress: progress,
    };

    // Transform response
    const response = {
      shipment: {
        id: shipment.id,
        bookingNumber: shipment.booking_number || shipment.bl_number || shipment.id.slice(0, 8),
        blNumber: shipment.bl_number,
        shipper: shipment.shipper_name,
        consignee: shipment.consignee_name,
        notifyParty: shipment.notify_party_name,
        vessel: shipment.vessel_name,
        voyage: shipment.voyage_number,
        carrier: shipment.carrier_name,
        phase: phase,
        stage: shipment.stage || 'PENDING',
        journeyProgress: progress,
        cargo: {
          description: shipment.cargo_description,
          commodity: shipment.commodity_description,
          containerCount: shipment.container_numbers?.length || 0,
          incoterm: shipment.incoterms,
        },
        dates: {
          etd: shipment.etd,
          eta: shipment.eta,
          actualDeparture: shipment.atd,
          actualArrival: shipment.ata,
        },
        createdAt: shipment.created_at,
        updatedAt: shipment.updated_at,
        status: shipment.status,
      },
      routing,
      cutoffs,
      containers: (shipment.container_numbers || []).map((num: string, i: number) => ({
        number: num,
        type: '40HC',
        seal: null,
        weight: null,
        status: null,
      })),
      chapters,
      chronicles: chronicles?.map(c => ({
        id: c.id,
        messageId: c.gmail_message_id,
        subject: c.subject,
        sender: c.from_address,
        receivedAt: c.occurred_at,
        documentType: c.document_type,
        carrier: c.carrier_name,
        confidence: c.ai_confidence || 85,
        summary: c.summary,
        hasAction: c.has_action,
        actionDescription: c.action_description,
        hasAttachments: c.attachments && Array.isArray(c.attachments) && c.attachments.length > 0,
        attachmentCount: c.attachments?.length || 0,
      })) || [],
      events: events?.map(e => ({
        id: e.id,
        type: e.event_type,
        date: e.event_date,
        location: e.location,
        description: e.description,
        source: e.source_type,
      })) || [],
      // AI Intelligence Summary
      aiSummary: aiSummary ? {
        story: aiSummary.story,
        narrative: aiSummary.narrative,
        currentBlocker: aiSummary.current_blocker,
        blockerOwner: aiSummary.blocker_owner,
        blockerType: aiSummary.blocker_type,
        nextAction: aiSummary.next_action,
        actionOwner: aiSummary.action_owner,
        actionContact: aiSummary.action_contact,
        financialImpact: aiSummary.financial_impact,
        documentedCharges: aiSummary.documented_charges,
        estimatedDetention: aiSummary.estimated_detention,
        customerImpact: aiSummary.customer_impact,
        customerActionRequired: aiSummary.customer_action_required,
        riskLevel: aiSummary.risk_level,
        riskReason: aiSummary.risk_reason,
        daysOverdue: aiSummary.days_overdue,
        escalationCount: aiSummary.escalation_count,
        daysSinceActivity: aiSummary.days_since_activity,
        issueCount: aiSummary.issue_count,
        urgentMessageCount: aiSummary.urgent_message_count,
        carrierPerformance: aiSummary.carrier_performance,
        shipperRiskSignal: aiSummary.shipper_risk_signal,
        keyInsight: aiSummary.key_insight,
        keyDeadline: aiSummary.key_deadline,
        intelligenceWarnings: aiSummary.intelligence_warnings,
        updatedAt: aiSummary.updated_at,
      } : null,
      // Deep Dive Data
      deepDive: {
        escalations: escalations?.map(e => ({
          id: e.id,
          date: e.occurred_at,
          fromParty: e.from_party,
          issueType: e.issue_type,
          summary: e.summary,
        })) || [],
        issues: issues?.map(i => ({
          id: i.id,
          date: i.occurred_at,
          messageType: i.message_type,
          issueType: i.issue_type,
          fromParty: i.from_party,
          summary: i.summary,
        })) || [],
        urgentMessages: urgentMessages?.map(u => ({
          id: u.id,
          date: u.occurred_at,
          messageType: u.message_type,
          sentiment: u.sentiment,
          fromParty: u.from_party,
          summary: u.summary,
        })) || [],
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching shipment:', error);
    return NextResponse.json({ error: 'Failed to fetch shipment' }, { status: 500 });
  }
}

interface ChronicleDoc {
  id: string;
  document_type: string | null;
  occurred_at: string | null;
  subject: string | null;
  from_address: string | null;
  ai_confidence: number | null;
}

interface ShipmentEvent {
  id: string;
  event_type: string;
  event_date: string | null;
  location: string | null;
  description: string | null;
}

interface Chapter {
  id: string;
  phase: string;
  title: string;
  subtitle: string;
  status: 'completed' | 'active' | 'upcoming';
  documents: Array<{
    id: string;
    type: string;
    subject: string;
    date: string;
    confidence: number;
  }>;
  events: Array<{
    id: string;
    type: string;
    date: string;
    description: string;
  }>;
  summary: string;
}

function buildJourneyChapters(
  chronicles: ChronicleDoc[],
  events: ShipmentEvent[],
  currentPhase: string
): Chapter[] {
  const phaseOrder = ['pre_departure', 'post_departure', 'pre_arrival', 'post_arrival'];
  const currentPhaseIndex = phaseOrder.indexOf(currentPhase);

  const chapterConfig = [
    {
      phase: 'pre_departure',
      title: 'Pre-Departure',
      subtitle: 'Booking & Documentation',
      docTypes: [
        'booking_confirmation', 'booking_amendment', 'booking_cancellation',
        'shipping_instructions', 'si_confirmation', 'si_amendment',
        'draft_bl', 'draft_bl_amendment',
        'vgm', 'vgm_confirmation',
        'container_pickup', 'cargo_receipt', 'gate_in',
      ],
      eventTypes: ['booking_created', 'si_submitted', 'vgm_submitted', 'cargo_received', 'gate_in'],
    },
    {
      phase: 'post_departure',
      title: 'Post-Departure',
      subtitle: 'Cargo On Water',
      docTypes: [
        'final_bl', 'master_bl', 'house_bl', 'on_board_bl',
        'departure_notice', 'vessel_schedule',
        'commercial_invoice', 'freight_invoice',
        'tracking_update', 'eta_update',
      ],
      eventTypes: ['departed', 'vessel_departed', 'transshipment', 'eta_update'],
    },
    {
      phase: 'pre_arrival',
      title: 'Pre-Arrival',
      subtitle: 'Arrival Preparation',
      docTypes: [
        'arrival_notice', 'pre_arrival_notice',
        'customs_entry', 'draft_entry', 'isf_filing', 'import_declaration',
        'delivery_order', 'telex_release',
      ],
      eventTypes: ['arriving', 'customs_filed', 'do_issued'],
    },
    {
      phase: 'post_arrival',
      title: 'Post-Arrival',
      subtitle: 'Delivery & Completion',
      docTypes: [
        'customs_clearance', 'release_order',
        'delivery_confirmation', 'pod', 'proof_of_delivery',
        'final_invoice', 'debit_note', 'credit_note',
        'empty_return',
      ],
      eventTypes: ['arrived', 'vessel_arrived', 'customs_cleared', 'released', 'out_for_delivery', 'delivered', 'pod_received'],
    },
  ];

  return chapterConfig.map((config, index) => {
    const phaseIndex = phaseOrder.indexOf(config.phase);
    let status: 'completed' | 'active' | 'upcoming';

    if (phaseIndex < currentPhaseIndex) {
      status = 'completed';
    } else if (phaseIndex === currentPhaseIndex) {
      status = 'active';
    } else {
      status = 'upcoming';
    }

    const chapterDocs = chronicles
      .filter(c => c.document_type && config.docTypes.includes(c.document_type))
      .map(c => ({
        id: c.id,
        type: c.document_type || 'unknown',
        subject: c.subject || 'No subject',
        date: c.occurred_at || '',
        confidence: c.ai_confidence || 85,
      }));

    const chapterEvents = events
      .filter(e => config.eventTypes.includes(e.event_type))
      .map(e => ({
        id: e.id,
        type: e.event_type,
        date: e.event_date || '',
        description: e.description || e.event_type,
      }));

    const summaryParts = [];
    if (chapterDocs.length > 0) {
      summaryParts.push(`${chapterDocs.length} document${chapterDocs.length > 1 ? 's' : ''}`);
    }
    if (chapterEvents.length > 0) {
      summaryParts.push(`${chapterEvents.length} event${chapterEvents.length > 1 ? 's' : ''}`);
    }

    return {
      id: config.phase,
      phase: config.phase,
      title: config.title,
      subtitle: config.subtitle,
      status,
      documents: chapterDocs,
      events: chapterEvents,
      summary: summaryParts.length > 0 ? summaryParts.join(', ') : 'No activity yet',
    };
  });
}

interface CutoffData {
  type: string;
  label: string;
  date: string | null;
  daysRemaining: number | null;
  hoursRemaining: number | null;
  status: 'safe' | 'warning' | 'urgent' | 'overdue' | 'submitted' | 'unknown';
}

function buildCutoffData(
  shipment: { si_cutoff: string | null; vgm_cutoff: string | null; cargo_cutoff?: string | null },
  now: Date
): CutoffData[] {
  const cutoffs: CutoffData[] = [];

  const calculateCutoff = (
    type: string,
    label: string,
    dateStr: string | null
  ): CutoffData => {
    if (!dateStr) {
      return { type, label, date: null, daysRemaining: null, hoursRemaining: null, status: 'unknown' };
    }

    const cutoffDate = new Date(dateStr);
    const diffMs = cutoffDate.getTime() - now.getTime();
    const hoursRemaining = Math.floor(diffMs / (1000 * 60 * 60));
    const daysRemaining = Math.floor(hoursRemaining / 24);

    let status: CutoffData['status'];
    if (daysRemaining < 0) {
      status = 'overdue';
    } else if (daysRemaining <= 1) {
      status = 'urgent';
    } else if (daysRemaining <= 3) {
      status = 'warning';
    } else {
      status = 'safe';
    }

    return { type, label, date: dateStr, daysRemaining, hoursRemaining, status };
  };

  cutoffs.push(calculateCutoff('si', 'SI Cutoff', shipment.si_cutoff));
  cutoffs.push(calculateCutoff('vgm', 'VGM Cutoff', shipment.vgm_cutoff));
  if (shipment.cargo_cutoff) {
    cutoffs.push(calculateCutoff('cargo', 'Cargo Cutoff', shipment.cargo_cutoff));
  }

  return cutoffs;
}
