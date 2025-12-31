import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { StakeholderExtractionService } from '@/lib/services/stakeholder-extraction-service';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * POST /api/stakeholders/extract
 *
 * Trigger stakeholder extraction from emails and documents.
 * Requires authentication.
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();
    const extractionService = new StakeholderExtractionService(supabase);

    const body = await request.json();
    const action = body.action || 'process_queue';

    switch (action) {
      case 'process_queue': {
        // Process pending extractions from queue
        const batchSize = body.batch_size || 50;
        const result = await extractionService.processExtractionQueue(batchSize);
        return NextResponse.json({
          action: 'process_queue',
          result,
        });
      }

      case 'queue_unprocessed': {
        // Queue all unprocessed emails
        const queued = await extractionService.queueUnprocessedEmails();
        return NextResponse.json({
          action: 'queue_unprocessed',
          queued,
        });
      }

      case 'extract_shipment': {
        // Extract stakeholders from a specific shipment's documents
        if (!body.shipment_id) {
          return NextResponse.json(
            { error: 'shipment_id is required for extract_shipment action' },
            { status: 400 }
          );
        }
        const result = await extractionService.extractFromShipmentDocuments(body.shipment_id);
        return NextResponse.json({
          action: 'extract_shipment',
          shipment_id: body.shipment_id,
          result: {
            extracted: result.extracted.length,
            matched: result.matched.length,
            created: result.created.length,
            relationships: result.relationships.length,
          },
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('[API:POST /stakeholders/extract] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
