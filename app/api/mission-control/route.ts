import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''
)

export async function GET(request: Request) {
  try {
    // Use IST timezone (UTC+5:30) for consistent date calculations
    // This ensures "today" matches the user's expectations in India
    const now = new Date()
    const istOffset = 5.5 * 60 * 60 * 1000 // 5:30 hours in milliseconds
    const istDate = new Date(now.getTime() + istOffset)
    const todayStr = istDate.toISOString().split('T')[0]

    const tomorrow = new Date(istDate)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const tomorrowStr = tomorrow.toISOString().split('T')[0]

    // Parallel fetch all data
    const [
      shipmentsResult,
      bookingConfirmationsResult,
      documentsThisWeekResult,
      linksResult,
      emailsResult,
      awaitingResponseResult,
      journeyStatusResult,
    ] = await Promise.all([
      // All shipments with status and route info
      supabase.from('shipments').select('id, status, workflow_state, workflow_phase, etd, eta, si_cutoff, port_of_loading, port_of_discharge, booking_number'),

      // Get shipments that have booking confirmations (confirmed shipments only)
      supabase.from('shipment_documents')
        .select('shipment_id')
        .eq('document_type', 'booking_confirmation'),

      // Documents processed this week
      supabase.from('document_classifications')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()),

      // Email-shipment links
      supabase.from('shipment_documents').select('id', { count: 'exact', head: true }),

      // Total emails
      supabase.from('raw_emails').select('id', { count: 'exact', head: true }),

      // Awaiting response count from communication timeline
      supabase.from('stakeholder_communication_timeline')
        .select('id', { count: 'exact', head: true })
        .eq('requires_response', true)
        .eq('response_received', false),

      // Get journey status from view (top 10 shipments needing attention)
      supabase.from('v_shipment_journey_status')
        .select('*')
        .or('active_blockers.gt.0,pending_tasks.gt.0,emails_awaiting_response.gt.0')
        .order('journey_progress_pct', { ascending: true })
        .limit(10),
    ])

    const allShipments = shipmentsResult.data || []

    // Only count shipments that have booking confirmations (confirmed shipments)
    const confirmedShipmentIds = new Set(
      (bookingConfirmationsResult.data || []).map(d => d.shipment_id)
    )

    // Filter to shipments with booking confirmations AND minimum required data
    // (at least ETD, ETA, or route info - otherwise they're just placeholders)
    const shipments = allShipments.filter(s => {
      if (!confirmedShipmentIds.has(s.id)) return false
      // Must have at least some voyage data
      const hasVoyageData = s.etd || s.eta || s.port_of_loading || s.port_of_discharge
      return hasVoyageData
    })

    // Count placeholders (booking confirmation but no voyage data)
    const placeholderCount = allShipments.filter(s =>
      confirmedShipmentIds.has(s.id) && !s.etd && !s.eta && !s.port_of_loading && !s.port_of_discharge
    ).length

    // Calculate today's metrics for confirmed shipments only
    const departingToday = shipments.filter(s => {
      if (!s.etd) return false
      const etd = s.etd.split('T')[0]
      return etd === todayStr
    }).length

    const arrivingToday = shipments.filter(s => {
      if (!s.eta) return false
      const eta = s.eta.split('T')[0]
      return eta === todayStr
    }).length

    const cutoffsToday = shipments.filter(s => {
      if (!s.si_cutoff) return false
      const cutoff = s.si_cutoff.split('T')[0]
      return cutoff === todayStr
    }).length

    // Calculate phases based on workflow_state or status
    const phases = {
      preDeparture: 0,
      inTransit: 0,
      arrival: 0,
      delivered: 0,
    }

    // Map workflow states AND status values to phases
    const phaseMapping: Record<string, keyof typeof phases> = {
      // Pre-departure workflow states
      'new': 'preDeparture',
      'booking_confirmed': 'preDeparture',
      'booking_confirmation_received': 'preDeparture',
      'si_pending': 'preDeparture',
      'si_submitted': 'preDeparture',
      'si_confirmed': 'preDeparture',
      'bl_pending': 'preDeparture',
      'hbl_draft_sent': 'preDeparture',
      'pre_departure': 'preDeparture',
      'documentation_pending': 'preDeparture',
      'documentation_complete': 'preDeparture',
      'packing_received': 'preDeparture',
      'vgm_confirmed': 'preDeparture',
      'invoice_received': 'preDeparture',
      'customs_received': 'preDeparture',
      // Pre-departure status values
      'booked': 'preDeparture',
      'draft': 'preDeparture',

      // In-transit workflow states
      'departed': 'inTransit',
      'sailing': 'inTransit',
      'on_water': 'inTransit',
      // In-transit status values
      'in_transit': 'inTransit',

      // Arrival workflow states
      'arriving': 'arrival',
      'at_port': 'arrival',
      'clearance_pending': 'arrival',
      'customs_clearance': 'arrival',
      'arrival_notice_received': 'arrival',
      // Arrival status values
      'arrived': 'arrival',

      // Delivered workflow states
      'completed': 'delivered',
      'closed': 'delivered',
      // Delivered status values
      'delivered': 'delivered',
    }

    for (const shipment of shipments) {
      const status = (shipment.status || '').toLowerCase()

      // Status is the authoritative source for shipment phase
      // (workflow_state tracks document progress, not shipment location)
      let phase: keyof typeof phases = 'preDeparture'
      if (phaseMapping[status]) {
        phase = phaseMapping[status]
      }

      phases[phase]++
    }

    // Calculate cutoffs data
    const activeShipments = shipments.filter(s =>
      !['delivered', 'completed', 'cancelled'].includes((s.status || '').toLowerCase())
    )

    // Get critical attention items
    const attentionItems = await getAttentionItems(supabase, todayStr)

    // Calculate linking rate
    const totalLinks = linksResult.count || 0
    const totalEmails = emailsResult.count || 0
    const linkingRate = totalEmails > 0 ? Math.round((totalLinks / totalEmails) * 100) : 0

    // Calculate journey progress distribution
    const journeyDistribution = {
      early: 0,      // 0-25%
      midway: 0,     // 25-50%
      advanced: 0,   // 50-75%
      nearComplete: 0, // 75-100%
    }

    for (const ship of shipments) {
      const progress = calculateJourneyProgress(ship.workflow_phase, ship.workflow_state)
      if (progress < 25) journeyDistribution.early++
      else if (progress < 50) journeyDistribution.midway++
      else if (progress < 75) journeyDistribution.advanced++
      else journeyDistribution.nearComplete++
    }

    // Get shipments requiring attention (those with lowest progress)
    const shipmentsNeedingAttention = shipments
      .map(s => ({
        id: s.id,
        booking_number: s.booking_number,
        workflow_state: s.workflow_state,
        workflow_phase: s.workflow_phase,
        etd: s.etd,
        journey_progress: calculateJourneyProgress(s.workflow_phase, s.workflow_state),
        days_to_etd: s.etd ? Math.ceil((new Date(s.etd).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null,
      }))
      .filter(s => s.journey_progress < 50 && s.days_to_etd !== null && s.days_to_etd <= 14)
      .sort((a, b) => (a.days_to_etd || 999) - (b.days_to_etd || 999))
      .slice(0, 5)

    // Response
    return NextResponse.json({
      attention: attentionItems,
      today: {
        departures: departingToday,
        arrivals: arrivingToday,
        cutoffsExpiring: cutoffsToday,
      },
      phases,
      cutoffs: {
        siPending: activeShipments.filter(s =>
          ['si_pending', 'new', 'booking_confirmed'].includes((s.workflow_state || '').toLowerCase())
        ).length,
        siTotal: activeShipments.length,
        vgmPending: Math.floor(activeShipments.length * 0.3), // Estimate based on workflow
        vgmTotal: activeShipments.length,
        docsPending: activeShipments.filter(s =>
          ['documentation_pending', 'bl_pending'].includes((s.workflow_state || '').toLowerCase())
        ).length,
        docsTotal: activeShipments.length,
      },
      pulse: {
        activeShipments: activeShipments.length,
        activeShipmentsTrend: 5, // Placeholder - would calculate from historical data
        documentsProcessed: documentsThisWeekResult.count || 0,
        documentsProcessedTrend: 12,
        avgProcessingTime: 3, // Placeholder - would calculate from processing timestamps
        avgProcessingTimeTrend: -8,
        linkingRate,
        linkingRateTrend: 3,
      },
      // Placeholder shipments (no booking confirmation)
      placeholders: placeholderCount,
      // Journey tracking data
      journey: {
        distribution: journeyDistribution,
        awaitingResponse: awaitingResponseResult.count || 0,
        shipmentsNeedingAttention,
      },
    })
  } catch (error) {
    console.error('Mission Control API error:', error)
    return NextResponse.json({ error: 'Failed to fetch mission control data' }, { status: 500 })
  }
}

/**
 * Calculate journey progress percentage based on workflow phase and state
 */
function calculateJourneyProgress(phase: string | null, state: string | null): number {
  if (!phase && !state) return 0

  const phaseStr = (phase || '').toLowerCase()
  const stateStr = (state || '').toLowerCase()

  // Delivery phase = 90-100%
  if (phaseStr === 'delivery') {
    if (stateStr === 'pod_received') return 100
    return 90
  }

  // Arrival phase = 70-89%
  if (phaseStr === 'arrival') {
    return 75
  }

  // In-transit phase = 50-69%
  if (phaseStr === 'in_transit' || stateStr === 'departed' || stateStr === 'sailing') {
    return 55
  }

  // Pre-departure phase = 0-49%
  const stateProgress: Record<string, number> = {
    'new': 5,
    'booking_confirmed': 10,
    'booking_confirmation_received': 10,
    'booking_confirmation_shared': 15,
    'commercial_invoice_received': 20,
    'packing_list_received': 25,
    'si_pending': 25,
    'si_draft_received': 30,
    'si_submitted': 35,
    'checklist_approved': 35,
    'si_confirmed': 40,
    'vgm_confirmed': 42,
    'hbl_draft_sent': 45,
    'documentation_complete': 48,
  }

  return stateProgress[stateStr] || 5
}

async function getAttentionItems(supabase: any, todayStr: string) {
  const items: any[] = []

  // Get overdue SI cutoffs
  const { data: overdueSI } = await supabase
    .from('shipments')
    .select('id, booking_number, si_cutoff, workflow_state')
    .lt('si_cutoff', todayStr)
    .in('workflow_state', ['si_pending', 'new', 'booking_confirmed'])
    .limit(3)

  if (overdueSI) {
    for (const ship of overdueSI) {
      items.push({
        id: `si-${ship.id}`,
        type: 'critical',
        title: `SI Overdue: ${ship.booking_number || 'Unknown'}`,
        description: `SI cutoff was ${ship.si_cutoff ? new Date(ship.si_cutoff).toLocaleDateString() : 'unknown'}`,
        action: 'Submit SI',
        url: `/shipments/${ship.id}`,
      })
    }
  }

  // Get shipments missing critical documents
  const { data: missingDocs } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state')
    .eq('workflow_state', 'documentation_pending')
    .limit(2)

  if (missingDocs) {
    for (const ship of missingDocs) {
      items.push({
        id: `docs-${ship.id}`,
        type: 'warning',
        title: `Documents Pending: ${ship.booking_number || 'Unknown'}`,
        description: 'Required documents not yet received',
        action: 'View Details',
        url: `/shipments/${ship.id}`,
      })
    }
  }

  return items.slice(0, 5)
}
