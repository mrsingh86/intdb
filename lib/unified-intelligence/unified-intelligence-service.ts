/**
 * Unified Intelligence Service
 *
 * Main orchestrator that combines INTDB (email intelligence) with Carrier APIs
 * (Maersk, Hapag-Lloyd) to provide complete shipment visibility.
 *
 * Features:
 * - Single query for complete shipment status
 * - Cross-validation of email data vs carrier data
 * - Automatic carrier detection from container prefix
 * - Fallback when one source is unavailable
 *
 * Following CLAUDE.md principles:
 * - Deep Modules (Principle #8) - Simple interface, complex implementation
 * - Strategic Programming (Principle #4) - Invest in good design
 * - Single Responsibility (Principle #3) - Orchestration only
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type {
  UnifiedShipmentStatus,
  CarrierTrackingData,
  CarrierDeadlines,
  CarrierCharges,
  PendingAction,
  ApiResponse,
} from './types';
import { getIntdbQueryService, IntdbQueryService } from './intdb-query-service';
import { getCarrierApiService, CarrierApiService, detectCarrier } from './carrier-api-service';
import { getCrossValidationService, CrossValidationService } from './cross-validation-service';

// =============================================================================
// UNIFIED INTELLIGENCE SERVICE
// =============================================================================

export class UnifiedIntelligenceService {
  private intdbService: IntdbQueryService;
  private carrierService: CarrierApiService;
  private validationService: CrossValidationService;

  constructor(supabaseClient?: SupabaseClient) {
    this.intdbService = getIntdbQueryService(supabaseClient);
    this.carrierService = getCarrierApiService();
    this.validationService = getCrossValidationService();
  }

  // ===========================================================================
  // MAIN API
  // ===========================================================================

  /**
   * Get complete unified status for a shipment
   * Queries both INTDB and Carrier API, cross-validates, and merges
   */
  async getUnifiedStatus(reference: string): Promise<ApiResponse<UnifiedShipmentStatus>> {
    const normalizedRef = reference.trim().toUpperCase();
    const queriedAt = new Date().toISOString();

    // Query INTDB first to get shipment context
    const intdbResponse = await this.intdbService.getShipmentData(normalizedRef);
    const intdbData = intdbResponse.success ? intdbResponse.data! : null;

    // Determine container number for carrier API
    let containerNumber = normalizedRef;

    // If reference doesn't look like a container, try to get from INTDB
    if (intdbData?.containerNumbers.length) {
      containerNumber = intdbData.containerNumbers[0];
    }

    // Check if we can query carrier API
    const carrier = detectCarrier(containerNumber);
    let carrierData: CarrierTrackingData | null = null;

    if (carrier !== 'unknown') {
      const carrierResponse = await this.carrierService.getTrackingData(containerNumber);
      if (carrierResponse.success && carrierResponse.data) {
        carrierData = carrierResponse.data;
      }
    }

    // If neither source has data, return error
    if (!intdbData && !carrierData) {
      return {
        success: false,
        error: `No shipment found for reference: ${reference}`,
      };
    }

    // Cross-validate
    const validation = this.validationService.validate(intdbData, carrierData);

    // Merge data
    const merged = this.validationService.merge(intdbData, carrierData);

    // Build unified result
    const result: UnifiedShipmentStatus = {
      containerNumber: carrierData?.containerNumber || intdbData?.containerNumbers[0] || null,
      bookingNumber: intdbData?.bookingNumber || null,
      mblNumber: intdbData?.mblNumber || null,
      carrier: carrierData,
      intdb: intdbData,
      validation,
      merged,
      queriedAt,
      queryReference: normalizedRef,
    };

    return {
      success: true,
      data: result,
    };
  }

  /**
   * Get live tracking data only (Carrier API)
   */
  async getTrackingOnly(containerNumber: string): Promise<ApiResponse<CarrierTrackingData>> {
    return this.carrierService.getTrackingData(containerNumber);
  }

  /**
   * Get document status only (INTDB)
   */
  async getDocumentStatus(reference: string): Promise<ApiResponse<any>> {
    const response = await this.intdbService.getShipmentData(reference);

    if (!response.success || !response.data) {
      return response;
    }

    return {
      success: true,
      data: {
        bookingNumber: response.data.bookingNumber,
        documentsReceived: response.data.documentsReceived,
        documentsPending: response.data.documentsPending,
        documentCompletionRate: response.data.documentCompletionRate,
        pendingActions: response.data.pendingActions,
        overdueActions: response.data.overdueActions,
      },
    };
  }

  /**
   * Get deadline information (Maersk API)
   */
  async getDeadlines(bookingNumber: string): Promise<ApiResponse<CarrierDeadlines>> {
    return this.carrierService.getDeadlines(bookingNumber);
  }

  /**
   * Get demurrage & detention charges (Maersk API)
   * Requires MBL number, container is optional
   */
  async getCharges(mblNumber: string, containerNumber?: string): Promise<ApiResponse<CarrierCharges>> {
    return this.carrierService.getCharges(mblNumber, containerNumber);
  }

  /**
   * Get all pending actions across all shipments
   */
  async getAllPendingActions(): Promise<ApiResponse<PendingAction[]>> {
    return this.intdbService.getAllPendingActions();
  }

  /**
   * Get all shipments with data mismatches
   */
  async getMismatchedShipments(): Promise<ApiResponse<UnifiedShipmentStatus[]>> {
    // Get all shipments with issues from INTDB
    const issuesResponse = await this.intdbService.getShipmentsWithIssues();

    if (!issuesResponse.success) {
      return { success: false, error: issuesResponse.error };
    }

    // Get unique booking/container numbers
    const references = new Set<string>();
    for (const issue of issuesResponse.data || []) {
      if (issue.booking_number) references.add(issue.booking_number);
      if (issue.container_numbers) {
        issue.container_numbers.forEach((cn: string) => references.add(cn));
      }
    }

    // Check each for mismatches
    const mismatched: UnifiedShipmentStatus[] = [];

    for (const ref of Array.from(references).slice(0, 20)) {
      const status = await this.getUnifiedStatus(ref);
      if (status.success && status.data) {
        // Only include if there are validation alerts
        if (status.data.validation.alerts.length > 0) {
          mismatched.push(status.data);
        }
      }
    }

    return {
      success: true,
      data: mismatched,
    };
  }

  /**
   * Get all shipments for a customer
   */
  async getCustomerShipments(customerName: string): Promise<ApiResponse<any[]>> {
    return this.intdbService.getShipmentsByCustomer(customerName);
  }

  /**
   * Get today's schedule (arrivals and departures)
   */
  async getTodaySchedule(): Promise<ApiResponse<{ arrivals: any[]; departures: any[] }>> {
    return this.intdbService.getTodaySchedule();
  }

  /**
   * Get urgent items (overdue actions + critical alerts)
   */
  async getUrgentItems(): Promise<ApiResponse<any>> {
    const pendingResponse = await this.intdbService.getAllPendingActions();

    if (!pendingResponse.success) {
      return pendingResponse;
    }

    const allActions = pendingResponse.data || [];
    const overdueActions = allActions.filter((a) => a.isOverdue);
    const dueTodayActions = allActions.filter((a) => {
      if (!a.deadline) return false;
      const today = new Date().toISOString().split('T')[0];
      return a.deadline.startsWith(today);
    });

    return {
      success: true,
      data: {
        overdueCount: overdueActions.length,
        dueTodayCount: dueTodayActions.length,
        overdueActions: overdueActions.slice(0, 10),
        dueTodayActions: dueTodayActions.slice(0, 10),
      },
    };
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

let serviceInstance: UnifiedIntelligenceService | null = null;

export function getUnifiedIntelligenceService(
  supabaseClient?: SupabaseClient
): UnifiedIntelligenceService {
  if (!serviceInstance || supabaseClient) {
    serviceInstance = new UnifiedIntelligenceService(supabaseClient);
  }
  return serviceInstance;
}
