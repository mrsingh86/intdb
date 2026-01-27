/**
 * Cross-Validation Service
 *
 * Compares INTDB (email intelligence) data with Carrier API (live tracking)
 * data to detect discrepancies, mismatches, and data quality issues.
 *
 * Following CLAUDE.md principles:
 * - Single Responsibility (Principle #3)
 * - Fail Fast (Principle #12)
 */

import type {
  IntdbShipmentData,
  CarrierTrackingData,
  ValidationResult,
  ValidationAlert,
  MergedShipmentData,
  ShipmentStatus,
} from './types';

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  // Maximum days difference before flagging ETA/ETD mismatch
  MAX_DATE_MISMATCH_DAYS: 2,

  // Minimum days before ETA to trigger "arriving soon" alert
  ARRIVING_SOON_DAYS: 3,

  // Days after which missing carrier data is considered an issue
  MISSING_CARRIER_GRACE_DAYS: 7,
};

// =============================================================================
// CROSS-VALIDATION SERVICE
// =============================================================================

export class CrossValidationService {
  /**
   * Validate and compare INTDB data with Carrier API data
   */
  validate(
    intdb: IntdbShipmentData | null,
    carrier: CarrierTrackingData | null
  ): ValidationResult {
    const alerts: ValidationAlert[] = [];

    // Initialize result
    const result: ValidationResult = {
      isValid: true,
      etaMatch: true,
      etaMismatchDays: null,
      etdMatch: true,
      etdMismatchDays: null,
      vesselMatch: true,
      vesselMismatchDetails: null,
      missingInCarrier: carrier === null || !carrier.apiSuccess,
      missingInIntdb: intdb === null,
      alerts: [],
    };

    // Check if both sources have data
    if (!intdb && !carrier) {
      alerts.push({
        severity: 'critical',
        type: 'MISSING_DATA',
        message: 'No data found in either INTDB or Carrier API',
        details: null,
      });
      result.isValid = false;
      result.alerts = alerts;
      return result;
    }

    // Missing in carrier API
    if (result.missingInCarrier && intdb) {
      const daysSinceFirstEmail = this.daysBetween(intdb.firstEmailDate, new Date().toISOString());

      if (daysSinceFirstEmail > CONFIG.MISSING_CARRIER_GRACE_DAYS) {
        alerts.push({
          severity: 'warning',
          type: 'MISSING_DATA',
          message: 'Container not found in carrier API',
          details: `Booking exists in INTDB since ${intdb.firstEmailDate} but no tracking events from carrier. Container may not be gated-in yet.`,
        });
      } else {
        alerts.push({
          severity: 'info',
          type: 'MISSING_DATA',
          message: 'Awaiting carrier tracking data',
          details: 'Booking is recent, tracking events may appear after container gate-in.',
        });
      }
    }

    // Missing in INTDB
    if (result.missingInIntdb && carrier) {
      alerts.push({
        severity: 'warning',
        type: 'MISSING_DATA',
        message: 'Container tracking exists but no email records in INTDB',
        details: 'Carrier API has tracking data but no corresponding emails found.',
      });
    }

    // Compare dates and vessel if both sources have data
    if (intdb && carrier && carrier.apiSuccess) {
      // ETA validation
      if (intdb.eta && carrier.eta) {
        const mismatchDays = this.daysBetween(intdb.eta, carrier.eta);
        result.etaMismatchDays = mismatchDays;

        if (Math.abs(mismatchDays) > CONFIG.MAX_DATE_MISMATCH_DAYS) {
          result.etaMatch = false;
          result.isValid = false;

          const direction = mismatchDays > 0 ? 'later' : 'earlier';
          alerts.push({
            severity: 'critical',
            type: 'ETA_MISMATCH',
            message: `ETA mismatch: Carrier says ${Math.abs(mismatchDays)} days ${direction}`,
            details: `INTDB (from email): ${this.formatDate(intdb.eta)}, Carrier API: ${this.formatDate(carrier.eta)}`,
          });
        }
      }

      // ETD validation
      if (intdb.etd && carrier.etd) {
        const mismatchDays = this.daysBetween(intdb.etd, carrier.etd);
        result.etdMismatchDays = mismatchDays;

        if (Math.abs(mismatchDays) > CONFIG.MAX_DATE_MISMATCH_DAYS) {
          result.etdMatch = false;

          const direction = mismatchDays > 0 ? 'later' : 'earlier';
          alerts.push({
            severity: 'warning',
            type: 'ETD_MISMATCH',
            message: `ETD mismatch: Carrier says ${Math.abs(mismatchDays)} days ${direction}`,
            details: `INTDB (from email): ${this.formatDate(intdb.etd)}, Carrier API: ${this.formatDate(carrier.etd)}`,
          });
        }
      }

      // Vessel validation
      if (intdb.vesselName && carrier.vesselName) {
        const intdbVessel = this.normalizeVesselName(intdb.vesselName);
        const carrierVessel = this.normalizeVesselName(carrier.vesselName);

        if (intdbVessel !== carrierVessel) {
          result.vesselMatch = false;
          result.vesselMismatchDetails = `INTDB: ${intdb.vesselName}, Carrier: ${carrier.vesselName}`;

          alerts.push({
            severity: 'warning',
            type: 'VESSEL_CHANGE',
            message: 'Vessel name differs between sources',
            details: result.vesselMismatchDetails,
          });
        }
      }

      // Check for delays
      if (carrier.status === 'ON_WATER' && carrier.eta) {
        const daysToEta = this.daysBetween(new Date().toISOString(), carrier.eta);

        if (daysToEta <= CONFIG.ARRIVING_SOON_DAYS && daysToEta > 0) {
          alerts.push({
            severity: 'info',
            type: 'DELAY_DETECTED',
            message: `Arriving soon: ${daysToEta} days to ETA`,
            details: `Expected arrival: ${this.formatDate(carrier.eta)}`,
          });
        }
      }
    }

    // Check for overdue actions in INTDB
    if (intdb && intdb.overdueActions.length > 0) {
      alerts.push({
        severity: 'critical',
        type: 'OVERDUE_ACTION',
        message: `${intdb.overdueActions.length} overdue action(s)`,
        details: intdb.overdueActions
          .slice(0, 3)
          .map((a) => a.description)
          .join(', '),
      });
      result.isValid = false;
    }

    result.alerts = alerts;
    return result;
  }

  /**
   * Merge INTDB and Carrier data into best-available values
   */
  merge(
    intdb: IntdbShipmentData | null,
    carrier: CarrierTrackingData | null
  ): MergedShipmentData {
    const merged: MergedShipmentData = {
      // Prefer carrier API for live tracking data
      status: carrier?.status || 'UNKNOWN',
      currentLocation: carrier?.currentLocation || null,
      vesselName: carrier?.vesselName || intdb?.vesselName || null,

      // Prefer carrier for dates (source of truth)
      etd: carrier?.etd || carrier?.atd || intdb?.etd || null,
      etdSource: carrier?.etd || carrier?.atd ? 'carrier' : intdb?.etd ? 'intdb' : null,
      eta: carrier?.eta || carrier?.ata || intdb?.eta || null,
      etaSource: carrier?.eta || carrier?.ata ? 'carrier' : intdb?.eta ? 'intdb' : null,

      // Routing: merge from both
      originPort: carrier?.originPort || intdb?.polLocation || null,
      destinationPort: carrier?.destinationPort || intdb?.podLocation || null,

      // Parties: INTDB only
      shipperName: intdb?.shipperName || null,
      consigneeName: intdb?.consigneeName || null,

      // Progress calculations
      journeyProgressPercent: null,
      daysToEta: null,

      // INTDB action data
      documentCompletionRate: intdb?.documentCompletionRate || 0,
      pendingActionCount: intdb?.pendingActions.length || 0,
      overdueActionCount: intdb?.overdueActions.length || 0,
    };

    // Calculate journey progress
    if (merged.etd && merged.eta && carrier?.status) {
      const progress = this.calculateJourneyProgress(
        merged.etd,
        merged.eta,
        carrier.atd,
        carrier.ata,
        carrier.status
      );
      merged.journeyProgressPercent = progress.percent;
      merged.daysToEta = progress.daysToEta;
    }

    return merged;
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  /**
   * Calculate days between two dates (positive if date2 > date1)
   */
  private daysBetween(date1: string | null, date2: string | null): number {
    if (!date1 || !date2) return 0;

    const d1 = new Date(date1);
    const d2 = new Date(date2);
    const diffTime = d2.getTime() - d1.getTime();
    return Math.round(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Format date for display
   */
  private formatDate(dateStr: string | null): string {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  /**
   * Normalize vessel name for comparison
   */
  private normalizeVesselName(name: string): string {
    return name
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .replace(/[^A-Z0-9 ]/g, '')
      .trim();
  }

  /**
   * Calculate journey progress percentage and days to ETA
   */
  private calculateJourneyProgress(
    etd: string,
    eta: string,
    atd: string | null,
    ata: string | null,
    status: ShipmentStatus
  ): { percent: number; daysToEta: number | null } {
    const now = new Date();

    // If delivered, 100%
    if (status === 'DELIVERED') {
      return { percent: 100, daysToEta: 0 };
    }

    // If arrived but not delivered
    if (status === 'ARRIVED' || status === 'INLAND_DELIVERY') {
      return { percent: 90, daysToEta: 0 };
    }

    // If not sailed, 0%
    if (status === 'NOT_SAILED') {
      const departureDate = new Date(etd);
      const daysToDepart = this.daysBetween(now.toISOString(), etd);
      return { percent: 0, daysToEta: null };
    }

    // On water - calculate progress
    const departureDate = new Date(atd || etd);
    const arrivalDate = new Date(eta);
    const totalJourneyMs = arrivalDate.getTime() - departureDate.getTime();
    const elapsedMs = now.getTime() - departureDate.getTime();

    if (totalJourneyMs <= 0) {
      return { percent: 50, daysToEta: null };
    }

    const percent = Math.min(Math.max(Math.round((elapsedMs / totalJourneyMs) * 100), 0), 100);
    const daysToEta = Math.max(0, this.daysBetween(now.toISOString(), eta));

    return { percent, daysToEta };
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

let serviceInstance: CrossValidationService | null = null;

export function getCrossValidationService(): CrossValidationService {
  if (!serviceInstance) {
    serviceInstance = new CrossValidationService();
  }
  return serviceInstance;
}
