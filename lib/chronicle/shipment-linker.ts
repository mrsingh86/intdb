/**
 * Shipment Linker
 *
 * Links chronicle records to shipments and manages stage progression.
 * Extracted from ChronicleService (P2-15 God class decomposition).
 *
 * Responsibilities:
 * - Link chronicles to existing shipments (or create new ones)
 * - Track shipment stage progression
 * - Auto-resolve pending actions
 * - Log actions and issues
 * - Validate booking numbers before shipment creation
 *
 * Following CLAUDE.md principles:
 * - Single Responsibility (Principle #3) - only shipment linking logic
 * - Small Functions < 20 lines (Principle #17)
 * - Fail Fast (Principle #12) - rejects garbage booking numbers
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  ProcessedEmail,
  ShippingAnalysis,
} from './types';
import { IChronicleRepository } from './interfaces';
import { ChronicleLogger, ShipmentStage } from './chronicle-logger';
import {
  ActionAutoResolveService,
} from './action-auto-resolve-service';
import { ShipmentContext } from './unified-action-service';

const MAX_CHRONICLES_PER_SHIPMENT = 200;

export class ShipmentLinker {
  constructor(
    private supabase: SupabaseClient,
    private repository: IChronicleRepository,
    private actionAutoResolveService: ActionAutoResolveService,
    private logger: ChronicleLogger | null = null,
  ) {}

  setLogger(logger: ChronicleLogger): void {
    this.logger = logger;
  }

  /**
   * Link chronicle to shipment and track stage progression.
   * Returns shipmentStage for flow validation.
   */
  async linkAndTrackShipment(
    chronicleId: string,
    analysis: ShippingAnalysis,
    email: ProcessedEmail
  ): Promise<{ shipmentId?: string; linkedBy?: string; shipmentStage?: string }> {
    const linkStart = this.logger?.logStageStart('linking') || 0;

    try {
      const { shipmentId, linkedBy } = await this.repository.linkToShipment(chronicleId);

      let finalShipmentId = shipmentId;
      let finalLinkedBy = linkedBy;
      let shipmentStage: string | undefined;

      if (shipmentId) {
        // Cap mega-threads: skip stage update if shipment already has too many chronicles
        const { count } = await this.supabase
          .from('chronicle')
          .select('*', { count: 'exact', head: true })
          .eq('shipment_id', shipmentId);

        if (count && count >= MAX_CHRONICLES_PER_SHIPMENT) {
          console.warn(`[ShipmentLinker] Mega-thread cap: shipment ${shipmentId} already has ${count} linked chronicles, skipping stage update`);
          return { shipmentId, linkedBy, shipmentStage: undefined };
        }

        this.logger?.logEmailLinked(shipmentId);
        shipmentStage = await this.checkAndUpdateShipmentStage(shipmentId, chronicleId, analysis, email);
      } else if (this.hasIdentifiers(analysis)) {
        const newShipment = await this.createShipmentFromAnalysis(analysis, email);
        if (newShipment) {
          await this.linkChronicleToShipment(chronicleId, newShipment.id);
          this.logger?.logEmailLinked(newShipment.id);
          this.logger?.logShipmentCreated(newShipment.id, chronicleId, analysis.document_type, email.receivedAt);
          finalShipmentId = newShipment.id;
          finalLinkedBy = 'created';
          shipmentStage = ChronicleLogger.detectShipmentStage(analysis.document_type);
        }
      }

      // Auto-resolve pending actions when trigger documents arrive
      if (finalShipmentId) {
        const autoResolveResult = await this.actionAutoResolveService.resolveActionsForDocument(
          finalShipmentId,
          analysis.document_type
        );
        if (autoResolveResult.resolvedCount > 0) {
          console.log(`[ShipmentLinker] Auto-resolved ${autoResolveResult.resolvedCount} action(s) for ${analysis.document_type}`);
        }
      }

      // Log actions and issues
      if (finalShipmentId) {
        await this.logActionsAndIssues(finalShipmentId, chronicleId, analysis, email);
      }

      this.logger?.logStageSuccess('linking', linkStart);
      return { shipmentId: finalShipmentId, linkedBy: finalLinkedBy, shipmentStage };
    } catch (error) {
      this.logger?.logStageFailure('linking', linkStart, error as Error, {
        gmailMessageId: email.gmailMessageId,
      }, true);
      return {};
    }
  }

  /**
   * Get shipment context by identifiers for precise action deadline calculations.
   * Looks up existing shipment by booking/BL/container and fetches cutoff dates.
   */
  async getShipmentContextByIdentifiers(
    analysis: ShippingAnalysis
  ): Promise<ShipmentContext | null> {
    try {
      const conditions: string[] = [];
      if (analysis.booking_number) conditions.push(`booking_number.eq.${analysis.booking_number}`);
      if (analysis.mbl_number) conditions.push(`mbl_number.eq.${analysis.mbl_number}`);
      if (analysis.container_numbers?.length) {
        conditions.push(`container_number_primary.eq.${analysis.container_numbers[0]}`);
      }

      if (conditions.length === 0) return null;

      const { data: shipment } = await this.supabase
        .from('shipments')
        .select('id, stage, customer_name, booking_number, si_cutoff, vgm_cutoff, cargo_cutoff, eta')
        .or(conditions.join(','))
        .limit(1)
        .single();

      if (!shipment) return null;

      return {
        shipmentId: shipment.id,
        stage: shipment.stage,
        customerName: shipment.customer_name,
        bookingNumber: shipment.booking_number,
        siCutoff: shipment.si_cutoff ? new Date(shipment.si_cutoff) : null,
        vgmCutoff: shipment.vgm_cutoff ? new Date(shipment.vgm_cutoff) : null,
        cargoCutoff: shipment.cargo_cutoff ? new Date(shipment.cargo_cutoff) : null,
        eta: shipment.eta ? new Date(shipment.eta) : null,
      };
    } catch {
      return null;
    }
  }

  // Reject garbage booking numbers that the AI sometimes extracts from document keywords
  isValidBookingNumber(bn: string | null | undefined): boolean {
    if (!bn) return false;
    const cleaned = bn.trim().toUpperCase();
    if (cleaned.length < 4) return false;
    const GARBAGE_KEYWORDS = [
      'CONFIRMATION', 'CANCELLATION', 'STUFFING', 'UNKNOWN', 'NONE', 'TBD',
      'N/A', 'NA', 'NULL', 'PENDING', 'DRAFT', 'AMENDMENT', 'UPDATE',
      'NOTIFICATION', 'APPROVAL', 'REQUEST', 'BOOKING', 'SHIPMENT',
    ];
    if (GARBAGE_KEYWORDS.includes(cleaned)) return false;
    // Must be alphanumeric (with hyphens/slashes/dots allowed)
    if (!/^[A-Za-z0-9\-_/.]+$/.test(cleaned)) return false;
    // Must contain at least one digit (real booking numbers always have digits)
    if (!/\d/.test(cleaned)) return false;
    return true;
  }

  private hasIdentifiers(analysis: ShippingAnalysis): boolean {
    return !!(analysis.booking_number || analysis.mbl_number || analysis.work_order_number);
  }

  private async checkAndUpdateShipmentStage(
    shipmentId: string,
    chronicleId: string,
    analysis: ShippingAnalysis,
    email: ProcessedEmail
  ): Promise<string | undefined> {
    const { data: shipment } = await this.supabase
      .from('shipments')
      .select('stage')
      .eq('id', shipmentId)
      .single();

    if (!shipment) return undefined;

    const currentStage = (shipment.stage as ShipmentStage) || 'PENDING';
    const newStage = ChronicleLogger.detectShipmentStage(analysis.document_type);

    if (ChronicleLogger.isStageProgression(currentStage, newStage)) {
      await this.supabase
        .from('shipments')
        .update({ stage: newStage, stage_updated_at: new Date().toISOString() })
        .eq('id', shipmentId);

      this.logger?.logStageChange(shipmentId, chronicleId, currentStage, newStage, analysis.document_type, email.receivedAt);
    }

    return currentStage;
  }

  private async createShipmentFromAnalysis(
    analysis: ShippingAnalysis,
    email: ProcessedEmail
  ): Promise<{ id: string } | null> {
    if (!this.isValidBookingNumber(analysis.booking_number) &&
        !analysis.mbl_number &&
        !analysis.container_numbers?.length) {
      console.warn(`[ShipmentLinker] Skipping shipment creation - no valid identifiers. booking_number="${analysis.booking_number}"`);
      return null;
    }

    const stage = ChronicleLogger.detectShipmentStage(analysis.document_type);

    const { data, error } = await this.supabase
      .from('shipments')
      .insert({
        booking_number: this.isValidBookingNumber(analysis.booking_number) ? analysis.booking_number : null,
        mbl_number: analysis.mbl_number || null,
        bl_number: analysis.mbl_number || null,
        intoglo_reference: analysis.work_order_number || null,
        container_number_primary: analysis.container_numbers?.[0] || null,
        vessel_name: analysis.vessel_name || null,
        voyage_number: analysis.voyage_number || null,
        carrier_name: analysis.carrier_name || null,
        etd: analysis.etd || null,
        eta: analysis.eta || null,
        stage,
        stage_updated_at: new Date().toISOString(),
        status: 'draft',
      })
      .select('id')
      .single();

    if (error) {
      console.error('[ShipmentLinker] Shipment create error:', error.message);
      return null;
    }
    return data;
  }

  private async linkChronicleToShipment(chronicleId: string, shipmentId: string): Promise<void> {
    await this.supabase
      .from('chronicle')
      .update({
        shipment_id: shipmentId,
        linked_by: 'created',
        linked_at: new Date().toISOString(),
      })
      .eq('id', chronicleId);
  }

  private async logActionsAndIssues(
    shipmentId: string,
    chronicleId: string,
    analysis: ShippingAnalysis,
    email: ProcessedEmail
  ): Promise<void> {
    if (analysis.has_action && analysis.action_description) {
      this.logger?.logActionDetected(
        shipmentId, chronicleId,
        analysis.action_owner || null,
        analysis.action_deadline || null,
        analysis.action_priority || null,
        analysis.action_description,
        analysis.document_type,
        email.receivedAt
      );
    }

    if (analysis.has_issue && analysis.issue_type) {
      this.logger?.logIssueDetected(
        shipmentId, chronicleId,
        analysis.issue_type,
        analysis.issue_description || '',
        analysis.document_type,
        email.receivedAt
      );
    }
  }
}

export function createShipmentLinker(
  supabase: SupabaseClient,
  repository: IChronicleRepository,
  actionAutoResolveService: ActionAutoResolveService,
  logger?: ChronicleLogger
): ShipmentLinker {
  return new ShipmentLinker(supabase, repository, actionAutoResolveService, logger || null);
}
