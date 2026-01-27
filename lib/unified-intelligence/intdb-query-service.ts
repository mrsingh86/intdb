/**
 * INTDB Query Service
 *
 * Queries the chronicle table for email-based shipment intelligence.
 * Aggregates documents, actions, and communication data for a shipment.
 *
 * Following CLAUDE.md principles:
 * - Deep Modules (Principle #8)
 * - Repository Pattern (Data Access)
 * - Never Return Null (Principle #20)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  IntdbShipmentData,
  DocumentStatus,
  PendingAction,
  ApiResponse,
} from './types';

// =============================================================================
// DOCUMENT TYPE MAPPING
// =============================================================================

const DOCUMENT_DISPLAY_NAMES: Record<string, string> = {
  booking_confirmation: 'Booking Confirmation',
  booking_amendment: 'Booking Amendment',
  shipping_instructions: 'Shipping Instructions',
  si_confirmation: 'SI Confirmation',
  vgm_confirmation: 'VGM Confirmation',
  draft_bl: 'Draft BL',
  final_bl: 'Final BL',
  house_bl: 'House BL',
  telex_release: 'Telex Release',
  arrival_notice: 'Arrival Notice',
  delivery_order: 'Delivery Order',
  customs_entry: 'Customs Entry',
  invoice: 'Invoice',
  pod_proof_of_delivery: 'Proof of Delivery',
};

const EXPECTED_DOCUMENTS = [
  'booking_confirmation',
  'shipping_instructions',
  'vgm_confirmation',
  'draft_bl',
  'final_bl',
  'arrival_notice',
  'delivery_order',
];

// =============================================================================
// INTDB QUERY SERVICE
// =============================================================================

export class IntdbQueryService {
  private supabase: SupabaseClient;

  constructor(supabaseClient?: SupabaseClient) {
    if (supabaseClient) {
      this.supabase = supabaseClient;
    } else {
      const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!supabaseUrl || !supabaseKey) {
        throw new Error('Missing Supabase configuration');
      }

      this.supabase = createClient(supabaseUrl, supabaseKey);
    }
  }

  /**
   * Query shipment data by any reference (booking, MBL, container)
   */
  async getShipmentData(reference: string): Promise<ApiResponse<IntdbShipmentData>> {
    const normalizedRef = reference.trim().toUpperCase();

    // Query chronicle for all matching records
    const { data: chronicles, error } = await this.supabase
      .from('chronicle')
      .select(`
        id,
        booking_number,
        mbl_number,
        hbl_number,
        container_numbers,
        document_type,
        message_type,
        sentiment,
        summary,
        has_action,
        action_description,
        action_owner,
        action_deadline,
        action_priority,
        action_completed_at,
        has_issue,
        issue_type,
        issue_description,
        shipper_name,
        shipper_address,
        consignee_name,
        consignee_address,
        notify_party_name,
        pol_location,
        pod_location,
        vessel_name,
        voyage_number,
        etd,
        eta,
        last_free_day,
        occurred_at,
        created_at
      `)
      .or(`booking_number.ilike.%${normalizedRef}%,mbl_number.ilike.%${normalizedRef}%,container_numbers.cs.{${normalizedRef}}`)
      .order('occurred_at', { ascending: false })
      .limit(100);

    if (error) {
      return {
        success: false,
        error: `Database error: ${error.message}`,
      };
    }

    if (!chronicles || chronicles.length === 0) {
      return {
        success: false,
        error: `No shipment found for reference: ${reference}`,
      };
    }

    // Aggregate data from all chronicle records
    const aggregated = this.aggregateChronicleData(chronicles);

    return {
      success: true,
      data: aggregated,
    };
  }

  /**
   * Get all pending actions across all shipments
   */
  async getAllPendingActions(limit: number = 50): Promise<ApiResponse<PendingAction[]>> {
    const { data, error } = await this.supabase
      .from('chronicle')
      .select(`
        id,
        booking_number,
        document_type,
        action_description,
        action_owner,
        action_deadline,
        action_priority,
        created_at
      `)
      .eq('has_action', true)
      .is('action_completed_at', null)
      .order('action_deadline', { ascending: true, nullsFirst: false })
      .limit(limit);

    if (error) {
      return {
        success: false,
        error: `Database error: ${error.message}`,
      };
    }

    const now = new Date();
    const actions: PendingAction[] = (data || []).map((row) => ({
      id: row.id,
      description: row.action_description || `Action for ${row.document_type}`,
      documentType: row.document_type,
      owner: row.action_owner,
      deadline: row.action_deadline,
      priority: row.action_priority || 'medium',
      createdAt: row.created_at,
      bookingNumber: row.booking_number,
      isOverdue: row.action_deadline ? new Date(row.action_deadline) < now : false,
    }));

    return {
      success: true,
      data: actions,
    };
  }

  /**
   * Get shipments with data mismatches or issues
   */
  async getShipmentsWithIssues(): Promise<ApiResponse<any[]>> {
    const { data, error } = await this.supabase
      .from('chronicle')
      .select(`
        booking_number,
        mbl_number,
        container_numbers,
        has_issue,
        issue_type,
        issue_description,
        sentiment,
        occurred_at
      `)
      .eq('has_issue', true)
      .order('occurred_at', { ascending: false })
      .limit(50);

    if (error) {
      return {
        success: false,
        error: `Database error: ${error.message}`,
      };
    }

    return {
      success: true,
      data: data || [],
    };
  }

  /**
   * Get all shipments for a customer
   */
  async getShipmentsByCustomer(customerName: string): Promise<ApiResponse<any[]>> {
    const { data, error } = await this.supabase
      .from('chronicle')
      .select(`
        booking_number,
        mbl_number,
        container_numbers,
        shipper_name,
        consignee_name,
        pol_location,
        pod_location,
        etd,
        eta,
        document_type,
        occurred_at
      `)
      .or(`shipper_name.ilike.%${customerName}%,consignee_name.ilike.%${customerName}%`)
      .order('occurred_at', { ascending: false })
      .limit(100);

    if (error) {
      return {
        success: false,
        error: `Database error: ${error.message}`,
      };
    }

    // Group by booking number
    const shipments = this.groupByBooking(data || []);

    return {
      success: true,
      data: shipments,
    };
  }

  /**
   * Get today's expected arrivals and departures
   */
  async getTodaySchedule(): Promise<ApiResponse<{ arrivals: any[]; departures: any[] }>> {
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];

    // ETD today
    const { data: departures, error: deptError } = await this.supabase
      .from('chronicle')
      .select(`
        booking_number,
        mbl_number,
        container_numbers,
        vessel_name,
        pol_location,
        pod_location,
        etd
      `)
      .gte('etd', today)
      .lt('etd', tomorrow)
      .order('etd', { ascending: true })
      .limit(20);

    // ETA today
    const { data: arrivals, error: arrError } = await this.supabase
      .from('chronicle')
      .select(`
        booking_number,
        mbl_number,
        container_numbers,
        vessel_name,
        pol_location,
        pod_location,
        eta
      `)
      .gte('eta', today)
      .lt('eta', tomorrow)
      .order('eta', { ascending: true })
      .limit(20);

    if (deptError || arrError) {
      return {
        success: false,
        error: `Database error: ${deptError?.message || arrError?.message}`,
      };
    }

    return {
      success: true,
      data: {
        arrivals: this.deduplicateByBooking(arrivals || []),
        departures: this.deduplicateByBooking(departures || []),
      },
    };
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Aggregate multiple chronicle records into unified shipment data
   */
  private aggregateChronicleData(chronicles: any[]): IntdbShipmentData {
    const now = new Date();

    // Get latest values (chronicles are sorted by occurred_at DESC)
    const latest = chronicles[0];

    // Collect all unique container numbers
    const allContainers = new Set<string>();
    chronicles.forEach((c) => {
      if (c.container_numbers) {
        c.container_numbers.forEach((cn: string) => allContainers.add(cn));
      }
    });

    // Collect document types received
    const documentTypesReceived = new Set<string>();
    chronicles.forEach((c) => {
      if (c.document_type && DOCUMENT_DISPLAY_NAMES[c.document_type]) {
        documentTypesReceived.add(c.document_type);
      }
    });

    // Build document status list
    const documentsReceived: DocumentStatus[] = [];
    const documentsPending: string[] = [];

    for (const docType of EXPECTED_DOCUMENTS) {
      if (documentTypesReceived.has(docType)) {
        const doc = chronicles.find((c) => c.document_type === docType);
        documentsReceived.push({
          type: docType,
          displayName: DOCUMENT_DISPLAY_NAMES[docType] || docType,
          receivedAt: doc?.occurred_at || doc?.created_at,
          status: 'RECEIVED',
        });
      } else {
        documentsPending.push(DOCUMENT_DISPLAY_NAMES[docType] || docType);
      }
    }

    // Collect pending actions
    const pendingActions: PendingAction[] = [];
    const overdueActions: PendingAction[] = [];

    chronicles.forEach((c) => {
      if (c.has_action && !c.action_completed_at) {
        const isOverdue = c.action_deadline ? new Date(c.action_deadline) < now : false;
        const action: PendingAction = {
          id: c.id,
          description: c.action_description || `Action for ${c.document_type}`,
          documentType: c.document_type,
          owner: c.action_owner,
          deadline: c.action_deadline,
          priority: c.action_priority || 'medium',
          createdAt: c.created_at,
          bookingNumber: c.booking_number,
          isOverdue,
        };

        if (isOverdue) {
          overdueActions.push(action);
        } else {
          pendingActions.push(action);
        }
      }
    });

    // Check for issues
    const issueChronicles = chronicles.filter((c) => c.has_issue);
    const issueDescriptions = issueChronicles
      .map((c) => c.issue_description)
      .filter(Boolean);

    // Check for urgent emails
    const hasUrgentEmails = chronicles.some((c) => c.sentiment === 'urgent');

    // Find best values (prefer most recent non-null)
    const findBestValue = (field: string) => {
      const record = chronicles.find((c) => c[field] != null);
      return record ? record[field] : null;
    };

    // Calculate document completion rate
    const completionRate = Math.round(
      (documentsReceived.length / EXPECTED_DOCUMENTS.length) * 100
    );

    return {
      // Identifiers
      bookingNumber: findBestValue('booking_number'),
      mblNumber: findBestValue('mbl_number'),
      hblNumber: findBestValue('hbl_number'),
      containerNumbers: Array.from(allContainers),

      // Parties
      shipperName: findBestValue('shipper_name'),
      shipperAddress: findBestValue('shipper_address'),
      consigneeName: findBestValue('consignee_name'),
      consigneeAddress: findBestValue('consignee_address'),
      notifyPartyName: findBestValue('notify_party_name'),

      // Routing
      polLocation: findBestValue('pol_location'),
      podLocation: findBestValue('pod_location'),

      // Vessel
      vesselName: findBestValue('vessel_name'),
      voyageNumber: findBestValue('voyage_number'),

      // Dates
      etd: findBestValue('etd'),
      eta: findBestValue('eta'),
      lastFreeDay: findBestValue('last_free_day'),

      // Documents
      documentsReceived,
      documentsPending,
      documentCompletionRate: completionRate,

      // Actions
      pendingActions,
      overdueActions,

      // Communication
      emailCount: chronicles.length,
      lastEmailDate: latest?.occurred_at || latest?.created_at,
      lastEmailSummary: latest?.summary,
      hasUrgentEmails,
      hasIssues: issueChronicles.length > 0,
      issueDescriptions,

      // Metadata
      firstEmailDate: chronicles[chronicles.length - 1]?.occurred_at,
      dataSource: 'intdb',
    };
  }

  /**
   * Group records by booking number
   */
  private groupByBooking(records: any[]): any[] {
    const groups = new Map<string, any>();

    for (const record of records) {
      const key = record.booking_number || record.mbl_number || 'unknown';
      if (!groups.has(key)) {
        groups.set(key, {
          bookingNumber: record.booking_number,
          mblNumber: record.mbl_number,
          containerNumbers: [],
          shipperName: record.shipper_name,
          consigneeName: record.consignee_name,
          polLocation: record.pol_location,
          podLocation: record.pod_location,
          etd: record.etd,
          eta: record.eta,
          emailCount: 0,
          lastActivity: record.occurred_at,
        });
      }

      const group = groups.get(key)!;
      group.emailCount++;

      if (record.container_numbers) {
        record.container_numbers.forEach((cn: string) => {
          if (!group.containerNumbers.includes(cn)) {
            group.containerNumbers.push(cn);
          }
        });
      }
    }

    return Array.from(groups.values());
  }

  /**
   * Deduplicate records by booking number
   */
  private deduplicateByBooking(records: any[]): any[] {
    const seen = new Set<string>();
    return records.filter((r) => {
      const key = r.booking_number || r.mbl_number;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

let serviceInstance: IntdbQueryService | null = null;

export function getIntdbQueryService(supabaseClient?: SupabaseClient): IntdbQueryService {
  if (!serviceInstance || supabaseClient) {
    serviceInstance = new IntdbQueryService(supabaseClient);
  }
  return serviceInstance;
}
