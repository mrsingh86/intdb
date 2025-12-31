import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { ShipmentRepository } from '@/lib/repositories/shipment-repository';
import { ShipmentDocumentRepository } from '@/lib/repositories/shipment-document-repository';
import { ShipmentLinkCandidateRepository } from '@/lib/repositories/shipment-link-candidate-repository';
import { EntityRepository } from '@/lib/repositories/entity-repository';
import { ClassificationRepository } from '@/lib/repositories/classification-repository';
import { ShipmentLinkingService } from '@/lib/services/shipment-linking-service';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * POST /api/shipments/resync
 *
 * Resync shipment fields from extracted entities.
 * Use when shipments have missing data that exists in entity extractions.
 * Also recalculates status based on document types and dates.
 * Requires authentication.
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();

    // Initialize repositories
    const shipmentRepo = new ShipmentRepository(supabase);
    const documentRepo = new ShipmentDocumentRepository(supabase);
    const linkCandidateRepo = new ShipmentLinkCandidateRepository(supabase);
    const entityRepo = new EntityRepository(supabase);
    const classificationRepo = new ClassificationRepository(supabase);

    // Initialize linking service with classification repo for intelligent status
    const linkingService = new ShipmentLinkingService(
      shipmentRepo,
      documentRepo,
      linkCandidateRepo,
      entityRepo,
      classificationRepo
    );

    const body = await request.json().catch(() => ({}));
    const { shipment_id } = body;

    // Resync single shipment
    if (shipment_id) {
      const result = await linkingService.resyncShipmentFromLinkedEmails(shipment_id);
      return NextResponse.json({
        success: true,
        ...result,
      });
    }

    // Resync ALL shipments
    const result = await linkingService.resyncAllShipments();

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('[API:POST /shipments/resync] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
