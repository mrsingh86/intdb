/**
 * Extraction API Route
 *
 * Triggers comprehensive shipment extraction on emails.
 *
 * POST /api/extraction - Process emails
 * GET /api/extraction - Get extraction status/stats
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { EmailIngestionService } from '@/lib/services/email-ingestion-service';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

interface ExtractionRequest {
  emailIds?: string[];
  limit?: number;
  reprocess?: boolean;
  useAdvanced?: boolean;
}

interface ExtractionStats {
  totalEmails: number;
  processed: number;
  successful: number;
  failed: number;
  shipmentsCreated: number;
  shipmentsUpdated: number;
  fieldsExtracted: number;
}

/**
 * POST /api/extraction
 * Process emails through comprehensive extraction pipeline
 */
export async function POST(request: NextRequest) {
  const supabase = getSupabase();

  try {
    const body: ExtractionRequest = await request.json();
    const { emailIds, limit = 50, reprocess = false, useAdvanced = false } = body;

    // Initialize service
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      return NextResponse.json(
        { error: 'ANTHROPIC_API_KEY not configured' },
        { status: 500 }
      );
    }

    const ingestionService = new EmailIngestionService(
      supabase,
      anthropicKey,
      { useAdvancedModel: useAdvanced }
    );

    // Get emails to process
    let targetEmails: string[];

    if (emailIds && emailIds.length > 0) {
      targetEmails = emailIds;
    } else {
      // Get unprocessed emails
      targetEmails = await ingestionService.getUnprocessedEmails(limit);
    }

    if (targetEmails.length === 0) {
      return NextResponse.json({
        message: 'No emails to process',
        stats: {
          totalEmails: 0,
          processed: 0,
          successful: 0,
          failed: 0,
          shipmentsCreated: 0,
          shipmentsUpdated: 0,
          fieldsExtracted: 0
        }
      });
    }

    // Process emails
    const stats: ExtractionStats = {
      totalEmails: targetEmails.length,
      processed: 0,
      successful: 0,
      failed: 0,
      shipmentsCreated: 0,
      shipmentsUpdated: 0,
      fieldsExtracted: 0
    };

    const errors: Array<{ emailId: string; error: string }> = [];

    for (const emailId of targetEmails) {
      const result = await ingestionService.ingestEmail(emailId, {
        forceReprocess: reprocess,
        useAdvancedModel: useAdvanced
      });

      stats.processed++;

      if (result.success) {
        stats.successful++;
        stats.fieldsExtracted += result.fieldsExtracted;

        if (result.shipmentAction === 'created') {
          stats.shipmentsCreated++;
        } else if (result.shipmentAction === 'updated') {
          stats.shipmentsUpdated++;
        }
      } else {
        stats.failed++;
        if (result.error && result.error !== 'Already processed') {
          errors.push({ emailId, error: result.error });
        }
      }
    }

    return NextResponse.json({
      message: 'Extraction completed',
      stats,
      errors: errors.slice(0, 10) // Return first 10 errors
    });

  } catch (error: any) {
    console.error('[API:POST /extraction] Error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}

/**
 * GET /api/extraction
 * Get extraction statistics and data coverage
 */
export async function GET() {
  const supabase = getSupabase();

  try {
    // Get processing stats
    const [
      { count: totalEmails },
      { count: processedEmails },
      { count: failedEmails },
      { count: totalShipments },
      { count: withSiCutoff },
      { count: withVgmCutoff },
      { count: withCargoCutoff },
      { count: withEtd },
      { count: withEta },
      { count: totalEntities }
    ] = await Promise.all([
      supabase.from('raw_emails').select('*', { count: 'exact', head: true }),
      supabase.from('raw_emails').select('*', { count: 'exact', head: true }).eq('processing_status', 'processed'),
      supabase.from('raw_emails').select('*', { count: 'exact', head: true }).eq('processing_status', 'failed'),
      supabase.from('shipments').select('*', { count: 'exact', head: true }),
      supabase.from('shipments').select('*', { count: 'exact', head: true }).not('si_cutoff', 'is', null),
      supabase.from('shipments').select('*', { count: 'exact', head: true }).not('vgm_cutoff', 'is', null),
      supabase.from('shipments').select('*', { count: 'exact', head: true }).not('cargo_cutoff', 'is', null),
      supabase.from('shipments').select('*', { count: 'exact', head: true }).not('etd', 'is', null),
      supabase.from('shipments').select('*', { count: 'exact', head: true }).not('eta', 'is', null),
      supabase.from('entity_extractions').select('*', { count: 'exact', head: true })
    ]);

    const total = totalShipments || 1;

    return NextResponse.json({
      processing: {
        totalEmails: totalEmails || 0,
        processedEmails: processedEmails || 0,
        failedEmails: failedEmails || 0,
        pendingEmails: (totalEmails || 0) - (processedEmails || 0) - (failedEmails || 0)
      },
      shipments: {
        total: totalShipments || 0,
        withSiCutoff: withSiCutoff || 0,
        withVgmCutoff: withVgmCutoff || 0,
        withCargoCutoff: withCargoCutoff || 0,
        withEtd: withEtd || 0,
        withEta: withEta || 0
      },
      coverage: {
        siCutoff: ((withSiCutoff || 0) / total * 100).toFixed(1),
        vgmCutoff: ((withVgmCutoff || 0) / total * 100).toFixed(1),
        cargoCutoff: ((withCargoCutoff || 0) / total * 100).toFixed(1),
        etd: ((withEtd || 0) / total * 100).toFixed(1),
        eta: ((withEta || 0) / total * 100).toFixed(1)
      },
      entities: {
        total: totalEntities || 0
      }
    });

  } catch (error: any) {
    console.error('[API:GET /extraction] Error:', error);
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }
}
