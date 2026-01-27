/**
 * Carrier API Service
 *
 * Unified client for Maersk and Hapag-Lloyd tracking APIs.
 * Auto-detects carrier from container prefix and routes to appropriate API.
 *
 * Following CLAUDE.md principles:
 * - Interface-Based Design (Principle #6)
 * - Deep Modules (Principle #8)
 * - Fail Fast (Principle #12)
 */

import type {
  CarrierCode,
  CarrierTrackingData,
  CarrierEvent,
  ShipmentStatus,
  CarrierDeadlines,
  CarrierCharges,
  ApiResponse,
} from './types';

// =============================================================================
// CARRIER DETECTION
// =============================================================================

const MAERSK_PREFIXES = ['MRKU', 'MAEU', 'MSCU', 'MSKU', 'MRSU', 'SEJJ', 'TLLU', 'TCLU', 'GESU'];
const HAPAG_PREFIXES = ['HLBU', 'HLXU', 'HAMU', 'UACU', 'TEMU', 'CMAU'];

export function detectCarrier(containerNumber: string): CarrierCode {
  const prefix = containerNumber.substring(0, 4).toUpperCase();

  if (MAERSK_PREFIXES.includes(prefix)) return 'maersk';
  if (HAPAG_PREFIXES.includes(prefix)) return 'hapag';

  return 'unknown';
}

// =============================================================================
// MAERSK AUTH
// =============================================================================

interface MaerskToken {
  access_token: string;
  expires_at: number;
}

let maerskTokenCache: MaerskToken | null = null;

async function getMaerskAccessToken(): Promise<string> {
  // Return cached token if valid
  if (maerskTokenCache && maerskTokenCache.expires_at > Date.now()) {
    return maerskTokenCache.access_token;
  }

  const consumerKey = process.env.MAERSK_CONSUMER_KEY;
  const consumerSecret = process.env.MAERSK_CONSUMER_SECRET;
  const customerKey = process.env.MAERSK_CUSTOMER_KEY;
  const tokenUrl = process.env.MAERSK_TOKEN_URL || 'https://api.maersk.com/customer-identity/oauth/v2/access_token';

  if (!consumerKey || !consumerSecret || !customerKey) {
    throw new Error('Maersk API credentials not configured');
  }

  const params = new URLSearchParams({
    client_id: customerKey,
    client_secret: consumerSecret,
    grant_type: 'client_credentials',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Consumer-Key': customerKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Maersk OAuth failed: ${response.status} - ${errorText}`);
  }

  const data = await response.json();

  // Cache with 5-minute buffer
  maerskTokenCache = {
    access_token: data.access_token,
    expires_at: Date.now() + (data.expires_in - 300) * 1000,
  };

  return data.access_token;
}

// =============================================================================
// MAERSK API CLIENT
// =============================================================================

async function maerskRequest<T>(endpoint: string, params: Record<string, string>): Promise<ApiResponse<T>> {
  const customerKey = process.env.MAERSK_CUSTOMER_KEY;
  const baseUrl = process.env.MAERSK_API_BASE_URL || 'https://api.maersk.com';

  if (!customerKey) {
    return { success: false, error: 'Maersk API not configured' };
  }

  try {
    const accessToken = await getMaerskAccessToken();
    const url = new URL(endpoint, baseUrl);
    Object.entries(params).forEach(([key, value]) => {
      if (value) url.searchParams.append(key, value);
    });

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Consumer-Key': customerKey,
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json',
      },
    });

    const responseText = await response.text();
    const data = responseText ? JSON.parse(responseText) : null;

    if (!response.ok) {
      return {
        success: false,
        error: data?.message || `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Maersk API request failed',
    };
  }
}

async function getMaerskTrackingEvents(containerNumber: string): Promise<ApiResponse<any[]>> {
  const response = await maerskRequest<{ events: any[] }>(
    '/track-and-trace-private/events',
    { equipmentReference: containerNumber }
  );

  if (response.success && response.data) {
    return { success: true, data: response.data.events || [] };
  }

  return response as unknown as ApiResponse<any[]>;
}

// =============================================================================
// HAPAG-LLOYD API CLIENT
// =============================================================================

async function hapagRequest<T>(params: Record<string, string>): Promise<ApiResponse<T>> {
  const clientId = process.env.HAPAG_CLIENT_ID;
  const clientSecret = process.env.HAPAG_CLIENT_SECRET;
  const baseUrl = process.env.HAPAG_API_BASE_URL || 'https://api.hlag.com/hlag/external/v2/events';

  if (!clientId || !clientSecret) {
    return { success: false, error: 'Hapag-Lloyd API not configured' };
  }

  try {
    // BaseUrl already includes /events, just add query params
    const url = new URL(baseUrl);
    Object.entries(params).forEach(([key, value]) => {
      if (value) url.searchParams.append(key, value);
    });

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'X-IBM-Client-Id': clientId,
        'X-IBM-Client-Secret': clientSecret,
        'Accept': 'application/json',
      },
    });

    const responseText = await response.text();
    const data = responseText ? JSON.parse(responseText) : null;

    if (!response.ok) {
      return {
        success: false,
        error: data?.message || `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    return { success: true, data };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Hapag-Lloyd API request failed',
    };
  }
}

async function getHapagTrackingEvents(containerNumber: string): Promise<ApiResponse<any[]>> {
  const response = await hapagRequest<any[]>({ equipmentReference: containerNumber });
  return response;
}

// =============================================================================
// CARRIER API SERVICE
// =============================================================================

export class CarrierApiService {
  /**
   * Get tracking data for a container from the appropriate carrier API
   */
  async getTrackingData(containerNumber: string): Promise<ApiResponse<CarrierTrackingData>> {
    const carrier = detectCarrier(containerNumber);

    if (carrier === 'unknown') {
      return {
        success: false,
        error: `Unable to detect carrier for container ${containerNumber}. Supported prefixes: ${[...MAERSK_PREFIXES, ...HAPAG_PREFIXES].join(', ')}`,
      };
    }

    // Get events from appropriate API
    const eventsResponse = carrier === 'maersk'
      ? await getMaerskTrackingEvents(containerNumber)
      : await getHapagTrackingEvents(containerNumber);

    if (!eventsResponse.success || !eventsResponse.data) {
      return {
        success: false,
        error: eventsResponse.error || 'Failed to retrieve tracking events',
      };
    }

    // Analyze events to build tracking data
    const trackingData = this.analyzeEvents(
      eventsResponse.data,
      containerNumber,
      carrier
    );

    return {
      success: true,
      data: trackingData,
    };
  }

  /**
   * Get deadline information (Maersk only)
   */
  async getDeadlines(bookingNumber: string): Promise<ApiResponse<CarrierDeadlines>> {
    const response = await maerskRequest<any>(
      '/deadlines',
      { carrierBookingReference: bookingNumber }
    );

    if (!response.success || !response.data) {
      return {
        success: false,
        error: response.error || 'Failed to retrieve deadlines',
      };
    }

    // Transform to our format
    const deadlines = this.transformDeadlines(response.data, bookingNumber);

    return {
      success: true,
      data: deadlines,
    };
  }

  /**
   * Get demurrage & detention charges (Maersk only)
   */
  async getCharges(containerNumber: string): Promise<ApiResponse<CarrierCharges>> {
    const response = await maerskRequest<any>(
      '/demurrage-and-detention',
      { equipmentReference: containerNumber }
    );

    if (!response.success || !response.data) {
      return {
        success: false,
        error: response.error || 'Failed to retrieve charges',
      };
    }

    // Transform to our format
    const charges = this.transformCharges(response.data, containerNumber);

    return {
      success: true,
      data: charges,
    };
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Analyze tracking events to determine shipment status
   */
  private analyzeEvents(
    events: any[],
    containerNumber: string,
    carrier: CarrierCode
  ): CarrierTrackingData {
    const now = new Date().toISOString();

    // Default response
    const result: CarrierTrackingData = {
      source: carrier,
      containerNumber,
      status: 'UNKNOWN',
      currentLocation: null,
      originPort: null,
      destinationPort: null,
      vesselName: null,
      voyageNumber: null,
      vesselImo: null,
      etd: null,
      atd: null,
      eta: null,
      ata: null,
      totalEvents: events.length,
      recentEvents: [],
      lastSyncAt: now,
      apiSuccess: true,
      apiError: null,
    };

    if (events.length === 0) {
      result.status = 'NOT_SAILED';
      return result;
    }

    // Sort events by date (oldest first for analysis)
    const sortedEvents = [...events].sort(
      (a, b) => new Date(a.eventDateTime).getTime() - new Date(b.eventDateTime).getTime()
    );

    // Filter vessel transport events
    const vesselEvents = sortedEvents.filter(
      (e) => e.eventType === 'TRANSPORT' && e.transportCall?.modeOfTransport === 'VESSEL'
    );

    // Find departures and arrivals
    const departures = vesselEvents.filter((e) => e.transportEventTypeCode === 'DEPA');
    const arrivals = vesselEvents.filter((e) => e.transportEventTypeCode === 'ARRI');

    // Extract departure info
    if (departures.length > 0) {
      const actualDeparture = departures.find((e) => e.eventClassifierCode === 'ACT');
      const plannedDeparture = departures.find((e) => ['PLN', 'EST'].includes(e.eventClassifierCode));

      if (actualDeparture) {
        result.atd = actualDeparture.eventDateTime;
      }
      if (plannedDeparture) {
        result.etd = plannedDeparture.eventDateTime;
      }

      const firstDeparture = departures[0];
      result.originPort = firstDeparture.transportCall?.location?.locationName || null;
    }

    // Extract arrival info
    if (arrivals.length > 0) {
      const actualArrival = arrivals.find((e) => e.eventClassifierCode === 'ACT');
      const plannedArrival = arrivals.find((e) => ['PLN', 'EST'].includes(e.eventClassifierCode));

      if (actualArrival) {
        result.ata = actualArrival.eventDateTime;
      }
      if (plannedArrival) {
        result.eta = plannedArrival.eventDateTime;
      }

      // Use first arrival after first departure as destination
      if (departures.length > 0) {
        const firstDeptTime = new Date(departures[0].eventDateTime).getTime();
        const firstArrivalAfterDept = arrivals.find(
          (e) => new Date(e.eventDateTime).getTime() > firstDeptTime
        );
        if (firstArrivalAfterDept) {
          result.destinationPort = firstArrivalAfterDept.transportCall?.location?.locationName || null;
        }
      }
    }

    // Extract vessel info from latest vessel event
    if (vesselEvents.length > 0) {
      const latestVesselEvent = vesselEvents[vesselEvents.length - 1];
      result.vesselName = latestVesselEvent.transportCall?.vessel?.vesselName || null;
      result.voyageNumber = latestVesselEvent.transportCall?.exportVoyageNumber || null;
      result.vesselImo = latestVesselEvent.transportCall?.vessel?.vesselIMONumber?.toString() || null;
    }

    // Determine status
    result.status = this.determineStatus(events, result);

    // Get current location from most recent event
    const latestEvent = events[0]; // Events are sorted newest first from API
    result.currentLocation =
      latestEvent?.transportCall?.location?.locationName ||
      latestEvent?.eventLocation?.locationName ||
      null;

    // Extract recent events for display
    result.recentEvents = events.slice(0, 10).map((e) => this.formatEvent(e));

    return result;
  }

  /**
   * Determine shipment status from events
   */
  private determineStatus(events: any[], trackingData: CarrierTrackingData): ShipmentStatus {
    const hasAtd = trackingData.atd !== null;
    const hasAta = trackingData.ata !== null;

    if (!hasAtd) {
      return 'NOT_SAILED';
    }

    if (!hasAta) {
      return 'ON_WATER';
    }

    // Check for gate-out at destination
    const gateOutEvents = events.filter(
      (e) =>
        e.eventType === 'EQUIPMENT' &&
        e.equipmentEventTypeCode === 'GTOT' &&
        e.eventClassifierCode === 'ACT'
    );

    if (gateOutEvents.length === 0) {
      return 'ARRIVED';
    }

    // Check for inland transport
    const inlandTransportEvents = events.filter(
      (e) =>
        e.eventType === 'TRANSPORT' &&
        e.transportCall?.modeOfTransport &&
        e.transportCall.modeOfTransport !== 'VESSEL' &&
        e.eventClassifierCode === 'ACT'
    );

    if (inlandTransportEvents.length > 0) {
      return 'INLAND_DELIVERY';
    }

    return 'DELIVERED';
  }

  /**
   * Format a single event for display
   */
  private formatEvent(event: any): CarrierEvent {
    let description = 'Event';

    if (event.eventType === 'TRANSPORT') {
      const location = event.transportCall?.location?.locationName || 'Unknown';
      description = event.transportEventTypeCode === 'ARRI'
        ? `Arrived at ${location}`
        : `Departed from ${location}`;
    } else if (event.eventType === 'EQUIPMENT') {
      const location =
        event.transportCall?.location?.locationName ||
        event.eventLocation?.locationName ||
        'Unknown';
      const codeNames: Record<string, string> = {
        LOAD: 'Loaded',
        DISC: 'Discharged',
        GTIN: 'Gated in',
        GTOT: 'Gated out',
        STUF: 'Stuffed',
        STRP: 'Stripped',
      };
      description = `${codeNames[event.equipmentEventTypeCode] || event.equipmentEventTypeCode} at ${location}`;
    } else if (event.eventType === 'SHIPMENT') {
      const codeNames: Record<string, string> = {
        RECE: 'Received',
        APPR: 'Approved',
        ISSU: 'Issued',
        CONF: 'Confirmed',
      };
      description = `Document ${codeNames[event.shipmentEventTypeCode] || event.shipmentEventTypeCode}`;
    }

    return {
      eventDateTime: event.eventDateTime,
      eventType: event.eventType,
      eventCode:
        event.transportEventTypeCode ||
        event.equipmentEventTypeCode ||
        event.shipmentEventTypeCode ||
        '',
      eventClassifier: event.eventClassifierCode,
      location:
        event.transportCall?.location?.locationName ||
        event.eventLocation?.locationName ||
        null,
      description,
    };
  }

  /**
   * Transform Maersk deadlines response to our format
   */
  private transformDeadlines(data: any, bookingNumber: string): CarrierDeadlines {
    const now = new Date();
    const deadlines: CarrierDeadlines['deadlines'] = [];

    // Map deadline types
    const deadlineMapping: Record<string, string> = {
      'SI Cutoff': 'SI_CUTOFF',
      'VGM Cutoff': 'VGM_CUTOFF',
      'Cargo Cutoff': 'CARGO_CUTOFF',
      'Documentation Cutoff': 'DOC_CUTOFF',
      'AMS Cutoff': 'AMS_CUTOFF',
    };

    if (data.deadlines && Array.isArray(data.deadlines)) {
      for (const d of data.deadlines) {
        const type = deadlineMapping[d.deadlineName] || d.deadlineName;
        const deadlineDate = new Date(d.deadlineDateTime);
        const status = deadlineDate < now ? 'OVERDUE' : 'UPCOMING';

        deadlines.push({
          type: type as any,
          dateTime: d.deadlineDateTime,
          status,
          completedAt: null, // API doesn't provide this
        });
      }
    }

    return {
      bookingNumber,
      carrier: 'maersk',
      deadlines,
      terminal: data.terminalName || null,
      lastSyncAt: now.toISOString(),
    };
  }

  /**
   * Transform Maersk D&D response to our format
   */
  private transformCharges(data: any, containerNumber: string): CarrierCharges {
    return {
      containerNumber,
      carrier: 'maersk',
      port: data.terminalName || '',
      portCode: data.UNLocationCode || '',
      portFreeDays: data.portFreeDays || 0,
      detentionFreeDays: data.detentionFreeDays || 0,
      lastFreeDay: data.lastFreeDay || null,
      demurrageCharges: data.demurrageAmount || 0,
      detentionCharges: data.detentionAmount || 0,
      totalCharges: (data.demurrageAmount || 0) + (data.detentionAmount || 0),
      currency: data.currency || 'USD',
      chargeableDays: data.chargeableDays || 0,
      rateSchedule: data.rateSchedule || [],
      isFinalCharge: data.isFinalCharge || false,
      lastSyncAt: new Date().toISOString(),
    };
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

let serviceInstance: CarrierApiService | null = null;

export function getCarrierApiService(): CarrierApiService {
  if (!serviceInstance) {
    serviceInstance = new CarrierApiService();
  }
  return serviceInstance;
}
