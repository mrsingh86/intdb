/**
 * Insight Context Gatherer
 *
 * Collects ALL relevant data for insight generation.
 * This is Stage 1 of the Insight Engine pipeline.
 *
 * Data sources collected:
 * - Shipment details (dates, parties, status)
 * - Document lifecycle (received, missing, quality)
 * - Stakeholder profiles (reliability, history)
 * - Related shipments (cross-shipment risks)
 * - Historical patterns (delays, amendments)
 * - Active notifications
 * - Communication context
 *
 * Principles:
 * - Single Responsibility: Only data collection
 * - Deep Module: Simple interface, complex implementation
 * - Parallel Fetching: Performance optimization
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  InsightContext,
  ShipmentContext,
  ShipmentDates,
  ShipmentParties,
  ShipmentFinancials,
  DocumentContext,
  DocumentInfo,
  QualityIssue,
  Amendment,
  StakeholderContext,
  StakeholderProfile,
  CarrierProfile,
  RelatedShipmentsContext,
  ShipmentSummary,
  HistoricalPatterns,
  NotificationContext,
  NotificationInfo,
  CommunicationContext,
  InsightSeverity,
  JourneyContext,
  ShipmentBlocker,
  JourneyEvent,
  CommunicationTimelineEntry,
  BlockerType,
  BlockerSeverity,
} from '@/types/insight';

// ============================================================================
// CONSTANTS
// ============================================================================

const CRITICAL_DOCUMENTS = [
  'shipping_instruction',
  'bill_of_lading',
  'commercial_invoice',
  'packing_list',
];

const DAYS_FOR_RELATED_SHIPMENTS = 30;
const DAYS_FOR_RECENT_COMMUNICATIONS = 14;
const RECENT_AMENDMENTS_DAYS = 7;
const JOURNEY_EVENTS_DAYS = 30;

// ============================================================================
// SERVICE CLASS
// ============================================================================

export class InsightContextGatherer {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Gather complete context for insight generation
   * Uses parallel fetching for performance
   */
  async gatherContext(shipmentId: string): Promise<InsightContext> {
    // Stage 1: Fetch core shipment data (needed by other fetches)
    const shipment = await this.fetchShipmentData(shipmentId);

    // Stage 2: Parallel fetch all context data
    const [
      documents,
      stakeholders,
      related,
      history,
      notifications,
      communications,
      journey,
    ] = await Promise.all([
      this.fetchDocumentContext(shipmentId),
      this.fetchStakeholderProfiles(shipment),
      this.fetchRelatedShipments(shipment),
      this.fetchHistoricalPatterns(shipment),
      this.fetchNotifications(shipmentId),
      this.fetchCommunicationContext(shipmentId, shipment),
      this.fetchJourneyContext(shipmentId),
    ]);

    return {
      shipment,
      documents,
      stakeholders,
      related,
      history,
      notifications,
      communications,
      journey,
    };
  }

  // --------------------------------------------------------------------------
  // SHIPMENT DATA
  // --------------------------------------------------------------------------

  private async fetchShipmentData(shipmentId: string): Promise<ShipmentContext> {
    const { data, error } = await this.supabase
      .from('shipments')
      .select(`
        id,
        booking_number,
        bl_number,
        status,
        workflow_state,
        workflow_phase,
        etd,
        eta,
        atd,
        ata,
        si_cutoff,
        vgm_cutoff,
        cargo_cutoff,
        gate_cutoff,
        cargo_ready_date,
        shipper_id,
        consignee_id,
        carrier_id,
        notify_party_id,
        port_of_loading,
        port_of_loading_code,
        port_of_discharge,
        port_of_discharge_code,
        vessel_name,
        carrier:carriers(carrier_name)
      `)
      .eq('id', shipmentId)
      .single();

    if (error || !data) {
      throw new Error(`Shipment not found: ${shipmentId}`);
    }

    const dates: ShipmentDates = {
      etd: data.etd ? new Date(data.etd) : null,
      eta: data.eta ? new Date(data.eta) : null,
      atd: data.atd ? new Date(data.atd) : null,
      ata: data.ata ? new Date(data.ata) : null,
      si_cutoff: data.si_cutoff ? new Date(data.si_cutoff) : null,
      vgm_cutoff: data.vgm_cutoff ? new Date(data.vgm_cutoff) : null,
      cargo_cutoff: data.cargo_cutoff ? new Date(data.cargo_cutoff) : null,
      gate_cutoff: data.gate_cutoff ? new Date(data.gate_cutoff) : null,
      cargo_ready_date: data.cargo_ready_date ? new Date(data.cargo_ready_date) : null,
    };

    const parties: ShipmentParties = {
      shipper_id: data.shipper_id,
      consignee_id: data.consignee_id,
      carrier_id: data.carrier_id,
      notify_party_id: data.notify_party_id,
    };

    // Fetch financials separately
    const financials = await this.fetchShipmentFinancials(shipmentId);

    return {
      id: data.id,
      booking_number: data.booking_number,
      bl_number: data.bl_number,
      status: data.status,
      workflow_state: data.workflow_state,
      workflow_phase: data.workflow_phase,
      dates,
      parties,
      financials,
      port_of_loading: data.port_of_loading,
      port_of_loading_code: data.port_of_loading_code,
      port_of_discharge: data.port_of_discharge,
      port_of_discharge_code: data.port_of_discharge_code,
      carrier_name: (data.carrier as { carrier_name?: string })?.carrier_name || null,
      vessel_name: data.vessel_name,
    };
  }

  private async fetchShipmentFinancials(shipmentId: string): Promise<ShipmentFinancials> {
    const { data: financials } = await this.supabase
      .from('shipment_financials')
      .select('amount, payment_status')
      .eq('shipment_id', shipmentId);

    const totalInvoiced = financials?.reduce((sum, f) => sum + (f.amount || 0), 0) || 0;
    const totalPaid = financials
      ?.filter(f => f.payment_status === 'paid')
      .reduce((sum, f) => sum + (f.amount || 0), 0) || 0;

    // Try to get shipper tier
    const { data: shipment } = await this.supabase
      .from('shipments')
      .select('shipper_id')
      .eq('id', shipmentId)
      .single();

    let customerTier: string | null = null;
    if (shipment?.shipper_id) {
      const { data: party } = await this.supabase
        .from('parties')
        .select('priority_tier')
        .eq('id', shipment.shipper_id)
        .single();
      customerTier = party?.priority_tier || null;
    }

    return {
      estimated_value: null, // Not tracked directly
      customer_tier: customerTier,
      total_invoiced: totalInvoiced,
      total_paid: totalPaid,
    };
  }

  // --------------------------------------------------------------------------
  // DOCUMENT CONTEXT
  // --------------------------------------------------------------------------

  private async fetchDocumentContext(shipmentId: string): Promise<DocumentContext> {
    // Get received documents
    const { data: lifecycles } = await this.supabase
      .from('document_lifecycle')
      .select('document_type, lifecycle_status, quality_score, received_at, missing_fields')
      .eq('shipment_id', shipmentId);

    const received: DocumentInfo[] = (lifecycles || []).map(doc => ({
      document_type: doc.document_type,
      lifecycle_status: doc.lifecycle_status,
      quality_score: doc.quality_score,
      received_at: doc.received_at ? new Date(doc.received_at) : null,
      missing_fields: doc.missing_fields || [],
    }));

    // Determine missing critical documents
    const receivedTypes = new Set(received.map(d => d.document_type));
    const missing = CRITICAL_DOCUMENTS.filter(type => !receivedTypes.has(type));

    // Find quality issues
    const qualityIssues: QualityIssue[] = [];
    for (const doc of received) {
      if (doc.quality_score !== null && doc.quality_score < 70) {
        qualityIssues.push({
          document_type: doc.document_type,
          field: 'overall_quality',
          severity: doc.quality_score < 50 ? 'critical' : 'high',
          description: `Quality score ${doc.quality_score}/100`,
        });
      }
      for (const field of doc.missing_fields) {
        qualityIssues.push({
          document_type: doc.document_type,
          field,
          severity: this.classifyMissingFieldSeverity(doc.document_type, field),
          description: `Missing required field: ${field}`,
        });
      }
    }

    // Get recent amendments
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - RECENT_AMENDMENTS_DAYS);

    const { data: revisions } = await this.supabase
      .from('document_lifecycle')
      .select('document_type, updated_at, status_history')
      .eq('shipment_id', shipmentId)
      .gte('updated_at', sevenDaysAgo.toISOString());

    const recentAmendments: Amendment[] = (revisions || [])
      .filter(r => r.status_history && r.status_history.length > 1)
      .map(r => ({
        document_type: r.document_type,
        amended_at: new Date(r.updated_at),
        changed_fields: [], // Would need to parse status_history for details
      }));

    return {
      received,
      missing,
      quality_issues: qualityIssues,
      recent_amendments: recentAmendments,
    };
  }

  private classifyMissingFieldSeverity(docType: string, field: string): InsightSeverity {
    const criticalFields = ['shipper_name', 'consignee_name', 'bl_number', 'booking_number'];
    const highFields = ['vessel_name', 'etd', 'eta', 'port_of_loading', 'port_of_discharge'];

    if (criticalFields.includes(field)) return 'critical';
    if (highFields.includes(field)) return 'high';
    return 'medium';
  }

  // --------------------------------------------------------------------------
  // STAKEHOLDER PROFILES
  // --------------------------------------------------------------------------

  private async fetchStakeholderProfiles(shipment: ShipmentContext): Promise<StakeholderContext> {
    const [shipper, consignee, carrier, notifyParty] = await Promise.all([
      shipment.parties.shipper_id
        ? this.fetchPartyProfile(shipment.parties.shipper_id)
        : Promise.resolve(null),
      shipment.parties.consignee_id
        ? this.fetchPartyProfile(shipment.parties.consignee_id)
        : Promise.resolve(null),
      shipment.parties.carrier_id
        ? this.fetchCarrierProfile(shipment.parties.carrier_id)
        : Promise.resolve(null),
      shipment.parties.notify_party_id
        ? this.fetchPartyProfile(shipment.parties.notify_party_id)
        : Promise.resolve(null),
    ]);

    return { shipper, consignee, carrier, notify_party: notifyParty };
  }

  private async fetchPartyProfile(partyId: string): Promise<StakeholderProfile | null> {
    const { data: party } = await this.supabase
      .from('parties')
      .select(`
        id,
        party_name,
        party_type,
        reliability_score,
        response_time_avg_hours,
        documentation_quality_score,
        total_shipments,
        total_revenue,
        is_customer,
        priority_tier
      `)
      .eq('id', partyId)
      .single();

    if (!party) return null;

    // Get recent issues for this party
    const { data: recentNotifications } = await this.supabase
      .from('notifications')
      .select('title, priority')
      .or(`stakeholder_id.eq.${partyId}`)
      .eq('priority', 'critical')
      .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
      .limit(5);

    const recentIssues = (recentNotifications || []).map(n => n.title);

    return {
      id: party.id,
      name: party.party_name,
      party_type: party.party_type,
      reliability_score: party.reliability_score,
      response_time_avg_hours: party.response_time_avg_hours,
      documentation_quality_score: party.documentation_quality_score,
      total_shipments: party.total_shipments || 0,
      total_revenue: party.total_revenue,
      is_customer: party.is_customer || false,
      customer_tier: party.priority_tier,
      recent_issues: recentIssues,
    };
  }

  private async fetchCarrierProfile(carrierId: string): Promise<CarrierProfile | null> {
    const { data: carrier } = await this.supabase
      .from('carriers')
      .select('id, carrier_name')
      .eq('id', carrierId)
      .single();

    if (!carrier) return null;

    // Calculate rollover rate from notifications
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const { count: totalBookings } = await this.supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true })
      .eq('carrier_id', carrierId)
      .gte('created_at', thirtyDaysAgo.toISOString());

    const { count: rollovers } = await this.supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('carrier_id', carrierId)
      .eq('notification_type', 'rollover')
      .gte('created_at', thirtyDaysAgo.toISOString());

    const rolloverRate = totalBookings && totalBookings > 0
      ? (rollovers || 0) / totalBookings
      : null;

    // Calculate on-time rate from delivered shipments
    const { data: deliveredShipments } = await this.supabase
      .from('shipments')
      .select('eta, ata')
      .eq('carrier_id', carrierId)
      .eq('status', 'delivered')
      .not('eta', 'is', null)
      .not('ata', 'is', null)
      .gte('ata', thirtyDaysAgo.toISOString())
      .limit(100);

    let onTimeRate: number | null = null;
    if (deliveredShipments && deliveredShipments.length > 0) {
      const onTime = deliveredShipments.filter(s => {
        const eta = new Date(s.eta);
        const ata = new Date(s.ata);
        return ata <= eta;
      }).length;
      onTimeRate = onTime / deliveredShipments.length;
    }

    return {
      id: carrier.id,
      name: carrier.carrier_name,
      rollover_rate_30d: rolloverRate,
      on_time_rate: onTimeRate,
      total_bookings_30d: totalBookings || 0,
    };
  }

  // --------------------------------------------------------------------------
  // RELATED SHIPMENTS
  // --------------------------------------------------------------------------

  private async fetchRelatedShipments(
    shipment: ShipmentContext
  ): Promise<RelatedShipmentsContext> {
    const now = new Date();
    const thresholdDate = new Date(now);
    thresholdDate.setDate(thresholdDate.getDate() - DAYS_FOR_RELATED_SHIPMENTS);

    const [
      sameShipperActive,
      sameConsigneeActive,
      sameRouteRecent,
      sameCarrierRecent,
      sameWeekArrivals,
    ] = await Promise.all([
      this.fetchShipmentsByParty('shipper_id', shipment.parties.shipper_id, shipment.id),
      this.fetchShipmentsByParty('consignee_id', shipment.parties.consignee_id, shipment.id),
      this.fetchShipmentsByRoute(
        shipment.port_of_loading_code,
        shipment.port_of_discharge_code,
        shipment.id
      ),
      this.fetchShipmentsByCarrier(shipment.parties.carrier_id, shipment.id),
      this.fetchShipmentsArrivingSameWeek(shipment.dates.eta, shipment.id),
    ]);

    return {
      same_shipper_active: sameShipperActive,
      same_consignee_active: sameConsigneeActive,
      same_route_recent: sameRouteRecent,
      same_carrier_recent: sameCarrierRecent,
      same_week_arrivals: sameWeekArrivals,
    };
  }

  private async fetchShipmentsByParty(
    field: 'shipper_id' | 'consignee_id',
    partyId: string | null,
    excludeId: string
  ): Promise<ShipmentSummary[]> {
    if (!partyId) return [];

    const { data } = await this.supabase
      .from('shipments')
      .select('id, booking_number, status, etd, eta, port_of_discharge')
      .eq(field, partyId)
      .neq('id', excludeId)
      .in('status', ['booked', 'in_transit'])
      .limit(10);

    return (data || []).map(s => ({
      id: s.id,
      booking_number: s.booking_number,
      status: s.status,
      etd: s.etd ? new Date(s.etd) : null,
      eta: s.eta ? new Date(s.eta) : null,
      value: null,
      port_of_discharge: s.port_of_discharge,
    }));
  }

  private async fetchShipmentsByRoute(
    polCode: string | null,
    podCode: string | null,
    excludeId: string
  ): Promise<ShipmentSummary[]> {
    if (!polCode || !podCode) return [];

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data } = await this.supabase
      .from('shipments')
      .select('id, booking_number, status, etd, eta, port_of_discharge')
      .eq('port_of_loading_code', polCode)
      .eq('port_of_discharge_code', podCode)
      .neq('id', excludeId)
      .gte('created_at', thirtyDaysAgo.toISOString())
      .limit(10);

    return (data || []).map(s => ({
      id: s.id,
      booking_number: s.booking_number,
      status: s.status,
      etd: s.etd ? new Date(s.etd) : null,
      eta: s.eta ? new Date(s.eta) : null,
      value: null,
      port_of_discharge: s.port_of_discharge,
    }));
  }

  private async fetchShipmentsByCarrier(
    carrierId: string | null,
    excludeId: string
  ): Promise<ShipmentSummary[]> {
    if (!carrierId) return [];

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data } = await this.supabase
      .from('shipments')
      .select('id, booking_number, status, etd, eta, port_of_discharge')
      .eq('carrier_id', carrierId)
      .neq('id', excludeId)
      .gte('created_at', thirtyDaysAgo.toISOString())
      .limit(10);

    return (data || []).map(s => ({
      id: s.id,
      booking_number: s.booking_number,
      status: s.status,
      etd: s.etd ? new Date(s.etd) : null,
      eta: s.eta ? new Date(s.eta) : null,
      value: null,
      port_of_discharge: s.port_of_discharge,
    }));
  }

  private async fetchShipmentsArrivingSameWeek(
    eta: Date | null,
    excludeId: string
  ): Promise<ShipmentSummary[]> {
    if (!eta) return [];

    const weekStart = new Date(eta);
    weekStart.setDate(weekStart.getDate() - 3);
    const weekEnd = new Date(eta);
    weekEnd.setDate(weekEnd.getDate() + 3);

    const { data } = await this.supabase
      .from('shipments')
      .select('id, booking_number, status, etd, eta, port_of_discharge')
      .neq('id', excludeId)
      .gte('eta', weekStart.toISOString())
      .lte('eta', weekEnd.toISOString())
      .limit(20);

    return (data || []).map(s => ({
      id: s.id,
      booking_number: s.booking_number,
      status: s.status,
      etd: s.etd ? new Date(s.etd) : null,
      eta: s.eta ? new Date(s.eta) : null,
      value: null,
      port_of_discharge: s.port_of_discharge,
    }));
  }

  // --------------------------------------------------------------------------
  // HISTORICAL PATTERNS
  // --------------------------------------------------------------------------

  private async fetchHistoricalPatterns(
    shipment: ShipmentContext
  ): Promise<HistoricalPatterns> {
    const [
      shipperSiDelay,
      shipperAmendmentRate,
      carrierRolloverRate,
      routeAvgDelay,
      consigneeRejectionRate,
    ] = await Promise.all([
      this.calculateShipperSiDelay(shipment.parties.shipper_id),
      this.calculateShipperAmendmentRate(shipment.parties.shipper_id),
      this.calculateCarrierRolloverRate(shipment.parties.carrier_id),
      this.calculateRouteAvgDelay(
        shipment.port_of_loading_code,
        shipment.port_of_discharge_code
      ),
      this.calculateConsigneeRejectionRate(shipment.parties.consignee_id),
    ]);

    return {
      shipper_avg_si_delay_days: shipperSiDelay,
      shipper_amendment_rate: shipperAmendmentRate,
      carrier_rollover_rate_30d: carrierRolloverRate,
      route_avg_delay_days: routeAvgDelay,
      consignee_rejection_rate: consigneeRejectionRate,
    };
  }

  private async calculateShipperSiDelay(shipperId: string | null): Promise<number | null> {
    if (!shipperId) return null;

    // Get past shipments with SI data
    const { data } = await this.supabase
      .from('shipments')
      .select('si_cutoff')
      .eq('shipper_id', shipperId)
      .not('si_cutoff', 'is', null)
      .limit(50);

    // Would need SI received date to calculate actual delay
    // For now, return null as we don't have that data
    return null;
  }

  private async calculateShipperAmendmentRate(shipperId: string | null): Promise<number | null> {
    if (!shipperId) return null;

    const { data: shipments } = await this.supabase
      .from('shipments')
      .select('id')
      .eq('shipper_id', shipperId)
      .limit(100);

    if (!shipments || shipments.length === 0) return null;

    const shipmentIds = shipments.map(s => s.id);

    const { data: lifecycles } = await this.supabase
      .from('document_lifecycle')
      .select('status_history')
      .in('shipment_id', shipmentIds);

    if (!lifecycles || lifecycles.length === 0) return null;

    const withAmendments = lifecycles.filter(l =>
      l.status_history && l.status_history.length > 1
    ).length;

    return withAmendments / lifecycles.length;
  }

  private async calculateCarrierRolloverRate(carrierId: string | null): Promise<number | null> {
    if (!carrierId) return null;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const { count: totalBookings } = await this.supabase
      .from('shipments')
      .select('id', { count: 'exact', head: true })
      .eq('carrier_id', carrierId)
      .gte('created_at', thirtyDaysAgo.toISOString());

    const { count: rollovers } = await this.supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('carrier_id', carrierId)
      .eq('notification_type', 'rollover')
      .gte('created_at', thirtyDaysAgo.toISOString());

    if (!totalBookings || totalBookings === 0) return null;

    return (rollovers || 0) / totalBookings;
  }

  private async calculateRouteAvgDelay(
    polCode: string | null,
    podCode: string | null
  ): Promise<number | null> {
    if (!polCode || !podCode) return null;

    const { data } = await this.supabase
      .from('shipments')
      .select('eta, ata')
      .eq('port_of_loading_code', polCode)
      .eq('port_of_discharge_code', podCode)
      .eq('status', 'delivered')
      .not('eta', 'is', null)
      .not('ata', 'is', null)
      .limit(50);

    if (!data || data.length === 0) return null;

    const delays = data.map(s => {
      const eta = new Date(s.eta);
      const ata = new Date(s.ata);
      return (ata.getTime() - eta.getTime()) / (1000 * 60 * 60 * 24);
    });

    return delays.reduce((sum, d) => sum + d, 0) / delays.length;
  }

  private async calculateConsigneeRejectionRate(
    consigneeId: string | null
  ): Promise<number | null> {
    if (!consigneeId) return null;

    // Would need rejection tracking - not currently in schema
    return null;
  }

  // --------------------------------------------------------------------------
  // NOTIFICATIONS
  // --------------------------------------------------------------------------

  private async fetchNotifications(shipmentId: string): Promise<NotificationContext> {
    const { data: allNotifications } = await this.supabase
      .from('notifications')
      .select('id, notification_type, priority, title, status, received_at')
      .eq('shipment_id', shipmentId)
      .order('received_at', { ascending: false });

    const pending: NotificationInfo[] = (allNotifications || [])
      .filter(n => n.status === 'pending' || n.status === 'unread')
      .map(n => ({
        id: n.id,
        notification_type: n.notification_type,
        priority: n.priority,
        title: n.title,
        status: n.status,
        received_at: new Date(n.received_at),
      }));

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentCritical: NotificationInfo[] = (allNotifications || [])
      .filter(
        n =>
          n.priority === 'critical' &&
          new Date(n.received_at) >= sevenDaysAgo
      )
      .map(n => ({
        id: n.id,
        notification_type: n.notification_type,
        priority: n.priority,
        title: n.title,
        status: n.status,
        received_at: new Date(n.received_at),
      }));

    return { pending, recent_critical: recentCritical };
  }

  // --------------------------------------------------------------------------
  // COMMUNICATION CONTEXT
  // --------------------------------------------------------------------------

  private async fetchCommunicationContext(
    shipmentId: string,
    shipment: ShipmentContext
  ): Promise<CommunicationContext> {
    // Get linked emails for this shipment
    const { data: shipmentDocs } = await this.supabase
      .from('shipment_documents')
      .select('email_id')
      .eq('shipment_id', shipmentId);

    const emailIds = (shipmentDocs || []).map(d => d.email_id);

    if (emailIds.length === 0) {
      return {
        last_response_from_shipper: null,
        last_response_from_consignee: null,
        unanswered_emails_count: 0,
        thread_sentiment: null,
        days_since_last_communication: null,
      };
    }

    // Get email details
    const { data: emails } = await this.supabase
      .from('raw_emails')
      .select('id, sender_email, received_at')
      .in('id', emailIds)
      .order('received_at', { ascending: false });

    // Get shipper email domains
    let shipperDomains: string[] = [];
    if (shipment.parties.shipper_id) {
      const { data: shipper } = await this.supabase
        .from('parties')
        .select('email_domains')
        .eq('id', shipment.parties.shipper_id)
        .single();
      shipperDomains = shipper?.email_domains || [];
    }

    // Get consignee email domains
    let consigneeDomains: string[] = [];
    if (shipment.parties.consignee_id) {
      const { data: consignee } = await this.supabase
        .from('parties')
        .select('email_domains')
        .eq('id', shipment.parties.consignee_id)
        .single();
      consigneeDomains = consignee?.email_domains || [];
    }

    // Find last responses
    let lastResponseFromShipper: Date | null = null;
    let lastResponseFromConsignee: Date | null = null;

    for (const email of emails || []) {
      const senderDomain = email.sender_email?.split('@')[1];
      if (senderDomain) {
        if (shipperDomains.includes(senderDomain) && !lastResponseFromShipper) {
          lastResponseFromShipper = new Date(email.received_at);
        }
        if (consigneeDomains.includes(senderDomain) && !lastResponseFromConsignee) {
          lastResponseFromConsignee = new Date(email.received_at);
        }
      }
      if (lastResponseFromShipper && lastResponseFromConsignee) break;
    }

    // Calculate days since last communication
    let daysSinceLastCommunication: number | null = null;
    if (emails && emails.length > 0) {
      const lastEmail = new Date(emails[0].received_at);
      daysSinceLastCommunication = Math.floor(
        (Date.now() - lastEmail.getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    return {
      last_response_from_shipper: lastResponseFromShipper,
      last_response_from_consignee: lastResponseFromConsignee,
      unanswered_emails_count: 0, // Would need thread analysis
      thread_sentiment: null, // Would need AI analysis
      days_since_last_communication: daysSinceLastCommunication,
    };
  }

  // --------------------------------------------------------------------------
  // JOURNEY CONTEXT (Migration 021)
  // --------------------------------------------------------------------------

  private async fetchJourneyContext(shipmentId: string): Promise<JourneyContext> {
    const [blockers, recentEvents, communicationTimeline, stats] = await Promise.all([
      this.fetchActiveBlockers(shipmentId),
      this.fetchRecentJourneyEvents(shipmentId),
      this.fetchCommunicationTimeline(shipmentId),
      this.fetchJourneyStats(shipmentId),
    ]);

    return {
      blockers,
      recent_events: recentEvents,
      communication_timeline: communicationTimeline,
      stats,
    };
  }

  private async fetchActiveBlockers(shipmentId: string): Promise<ShipmentBlocker[]> {
    const { data, error } = await this.supabase
      .from('shipment_blockers')
      .select(`
        id,
        blocker_type,
        blocker_description,
        severity,
        blocked_since,
        blocking_milestone,
        responsible_party_id,
        is_resolved
      `)
      .eq('shipment_id', shipmentId)
      .eq('is_resolved', false)
      .order('blocked_since', { ascending: true });

    if (error || !data) return [];

    return data.map(b => ({
      id: b.id,
      blocker_type: b.blocker_type as BlockerType,
      blocker_description: b.blocker_description || '',
      severity: b.severity as BlockerSeverity,
      blocked_since: new Date(b.blocked_since),
      blocking_milestone: b.blocking_milestone || undefined,
      responsible_party_id: b.responsible_party_id || undefined,
      is_resolved: b.is_resolved,
    }));
  }

  private async fetchRecentJourneyEvents(shipmentId: string): Promise<JourneyEvent[]> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - JOURNEY_EVENTS_DAYS);

    const { data, error } = await this.supabase
      .from('shipment_journey_events')
      .select(`
        id,
        event_type,
        event_description,
        occurred_at,
        source_document_type,
        source_email_id
      `)
      .eq('shipment_id', shipmentId)
      .gte('occurred_at', thirtyDaysAgo.toISOString())
      .order('occurred_at', { ascending: false })
      .limit(50);

    if (error || !data) return [];

    return data.map(e => ({
      id: e.id,
      event_type: e.event_type,
      event_description: e.event_description || '',
      occurred_at: new Date(e.occurred_at),
      source_document_type: e.source_document_type || undefined,
      source_email_id: e.source_email_id || undefined,
    }));
  }

  private async fetchCommunicationTimeline(
    shipmentId: string
  ): Promise<CommunicationTimelineEntry[]> {
    const { data, error } = await this.supabase
      .from('stakeholder_communication_timeline')
      .select(`
        id,
        party_id,
        direction,
        communication_type,
        summary,
        occurred_at,
        requires_response,
        response_received,
        parties:party_id(party_name)
      `)
      .eq('shipment_id', shipmentId)
      .order('occurred_at', { ascending: false })
      .limit(30);

    if (error || !data) return [];

    return data.map(c => ({
      id: c.id,
      stakeholder_id: c.party_id || '',
      stakeholder_name: (c.parties as { party_name?: string })?.party_name || 'Unknown',
      direction: c.direction as 'inbound' | 'outbound',
      communication_type: c.communication_type as 'email' | 'document' | 'notification',
      summary: c.summary || '',
      sent_at: new Date(c.occurred_at),
      requires_response: c.requires_response || false,
      response_received: c.response_received || false,
    }));
  }

  private async fetchJourneyStats(shipmentId: string): Promise<JourneyContext['stats']> {
    // Get resolved blockers count
    const { count: resolvedBlockers } = await this.supabase
      .from('shipment_blockers')
      .select('id', { count: 'exact', head: true })
      .eq('shipment_id', shipmentId)
      .eq('is_resolved', true);

    // Calculate average blocker resolution time
    const { data: resolvedBlockerData } = await this.supabase
      .from('shipment_blockers')
      .select('blocked_since, resolved_at')
      .eq('shipment_id', shipmentId)
      .eq('is_resolved', true)
      .not('resolved_at', 'is', null);

    let avgBlockerResolutionHours: number | null = null;
    if (resolvedBlockerData && resolvedBlockerData.length > 0) {
      const totalHours = resolvedBlockerData.reduce((sum, b) => {
        const blocked = new Date(b.blocked_since).getTime();
        const resolved = new Date(b.resolved_at).getTime();
        return sum + (resolved - blocked) / (1000 * 60 * 60);
      }, 0);
      avgBlockerResolutionHours = Math.round(totalHours / resolvedBlockerData.length);
    }

    // Get latest milestone (events with category 'milestone')
    const { data: latestEvent } = await this.supabase
      .from('shipment_journey_events')
      .select('event_type, occurred_at')
      .eq('shipment_id', shipmentId)
      .eq('event_category', 'milestone')
      .order('occurred_at', { ascending: false })
      .limit(1)
      .single();

    let daysSinceLastMilestone: number | null = null;
    let currentMilestone: string | null = null;

    if (latestEvent) {
      currentMilestone = latestEvent.event_type;
      daysSinceLastMilestone = Math.floor(
        (Date.now() - new Date(latestEvent.occurred_at).getTime()) / (1000 * 60 * 60 * 24)
      );
    }

    return {
      total_blockers_resolved: resolvedBlockers || 0,
      avg_blocker_resolution_hours: avgBlockerResolutionHours,
      days_since_last_milestone: daysSinceLastMilestone,
      current_milestone: currentMilestone,
    };
  }
}
