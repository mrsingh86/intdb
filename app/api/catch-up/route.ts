/**
 * Catch-Up API
 *
 * Processes accumulated data through the registry pipeline.
 * Used for catch-up operations after new registries are deployed.
 *
 * ENDPOINTS:
 * GET /api/catch-up - Get statistics for all registries
 * POST /api/catch-up?action=email - Register emails in Email Registry
 * POST /api/catch-up?action=document - Process documents in Document Registry
 * POST /api/catch-up?action=stakeholder - Process stakeholders
 * POST /api/catch-up?action=shipment - Link shipments
 * POST /api/catch-up?action=workstate - Backfill workflow state history
 * POST /api/catch-up?action=full - Run full registry pipeline
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createEmailRegistryService } from '@/lib/services/registry/email-registry-service';
import { createStakeholderRegistryService } from '@/lib/services/registry/stakeholder-registry-service';
import { createShipmentRegistryService } from '@/lib/services/registry/shipment-registry-service';
import { createWorkstateRegistryService } from '@/lib/services/registry/workstate-registry-service';
import { createDocumentRegistryService } from '@/lib/services/document-registry-service';
import { createFlaggingOrchestrator } from '@/lib/services/flagging-orchestrator';
import { createHash } from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

/**
 * GET /api/catch-up - Get catch-up status and statistics
 */
export async function GET() {
  try {
    // Get counts in parallel
    const [
      totalEmailsResult,
      emailsNoSenderIdResult,
      totalAttachmentsResult,
      unregisteredAttResult,
      totalShipmentsResult,
      shipmentsNoWorkstateResult,
      totalSendersResult,
      totalHistoryResult,
    ] = await Promise.all([
      supabase.from('raw_emails').select('*', { count: 'exact', head: true }),
      supabase.from('raw_emails').select('*', { count: 'exact', head: true }).is('sender_id', null),
      supabase.from('raw_attachments').select('*', { count: 'exact', head: true }).eq('is_business_document', true),
      supabase.from('raw_attachments').select('*', { count: 'exact', head: true })
        .eq('is_business_document', true)
        .is('document_version_id', null),
      supabase.from('shipments').select('*', { count: 'exact', head: true }),
      supabase.from('shipments').select('*', { count: 'exact', head: true }).is('workflow_state', null),
      supabase.from('email_senders').select('*', { count: 'exact', head: true }),
      supabase.from('workflow_state_history').select('*', { count: 'exact', head: true }),
    ]);

    return NextResponse.json({
      statistics: {
        emails: {
          total: totalEmailsResult.count || 0,
          missingInRegistry: emailsNoSenderIdResult.count || 0,
          inRegistry: (totalEmailsResult.count || 0) - (emailsNoSenderIdResult.count || 0),
        },
        documents: {
          businessDocuments: totalAttachmentsResult.count || 0,
          unregistered: unregisteredAttResult.count || 0,
          registered: (totalAttachmentsResult.count || 0) - (unregisteredAttResult.count || 0),
        },
        shipments: {
          total: totalShipmentsResult.count || 0,
          missingWorkstate: shipmentsNoWorkstateResult.count || 0,
          withWorkstate: (totalShipmentsResult.count || 0) - (shipmentsNoWorkstateResult.count || 0),
        },
        registries: {
          emailSenders: totalSendersResult.count || 0,
          workstateHistory: totalHistoryResult.count || 0,
        },
      },
      actions: {
        email: {
          available: (emailsNoSenderIdResult.count || 0) > 0,
          count: emailsNoSenderIdResult.count || 0,
          endpoint: 'POST /api/catch-up?action=email',
        },
        document: {
          available: (unregisteredAttResult.count || 0) > 0,
          count: unregisteredAttResult.count || 0,
          endpoint: 'POST /api/catch-up?action=document',
        },
        workstate: {
          available: (shipmentsNoWorkstateResult.count || 0) > 0,
          count: shipmentsNoWorkstateResult.count || 0,
          endpoint: 'POST /api/catch-up?action=workstate',
        },
      },
    });
  } catch (error) {
    console.error('[CatchUp] Status error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/catch-up - Run catch-up processing
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'email';
    const limit = parseInt(searchParams.get('limit') || '100');

    switch (action) {
      case 'email':
        return await runEmailRegistryCatchUp(limit);

      case 'document':
        return await runDocumentRegistryCatchUp(limit);

      case 'flagging':
        return await runFlaggingCatchUp(limit);

      case 'workstate':
        return await runWorkstateCatchUp(limit);

      case 'full':
        return NextResponse.json({
          message: 'Full pipeline catch-up',
          hint: 'Run actions in order: flagging → document → email → workstate',
          order: [
            'POST /api/catch-up?action=flagging',
            'POST /api/catch-up?action=document',
            'POST /api/catch-up?action=email',
            'POST /api/catch-up?action=workstate',
          ],
        });

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}. Use 'email', 'document', 'flagging', or 'workstate'` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('[CatchUp] Processing error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * Run Email Registry catch-up
 */
async function runEmailRegistryCatchUp(limit: number) {
  const emailRegistry = createEmailRegistryService(supabase);

  // Find emails without sender_id
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, sender_email, sender_name, thread_id, subject, email_direction')
    .is('sender_id', null)
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: `Query error: ${error.message}` }, { status: 500 });
  }

  if (!emails || emails.length === 0) {
    return NextResponse.json({
      action: 'email',
      message: 'No unregistered emails to process',
      processed: 0,
    });
  }

  const stats = {
    processed: 0,
    newSenders: 0,
    existingSenders: 0,
    errors: 0,
  };

  for (const email of emails) {
    try {
      const result = await emailRegistry.registerEmail({
        emailId: email.id,
        senderEmail: email.sender_email,
        senderName: email.sender_name,
        threadId: email.thread_id,
        subject: email.subject,
        direction: email.email_direction || 'inbound',
      });

      stats.processed++;
      if (result.isNewSender) {
        stats.newSenders++;
      } else {
        stats.existingSenders++;
      }
    } catch {
      stats.errors++;
    }

    // Rate limiting
    if (stats.processed % 50 === 0) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return NextResponse.json({
    action: 'email',
    processed: stats.processed,
    newSenders: stats.newSenders,
    existingSenders: stats.existingSenders,
    errors: stats.errors,
  });
}

/**
 * Run Document Registry catch-up
 */
async function runDocumentRegistryCatchUp(limit: number) {
  const documentRegistry = createDocumentRegistryService(supabase);

  // Find unregistered business document attachments
  const { data: attachments, error } = await supabase
    .from('raw_attachments')
    .select(`
      id,
      email_id,
      filename,
      extracted_text,
      size_bytes,
      raw_emails!inner(received_at)
    `)
    .eq('is_business_document', true)
    .is('document_version_id', null)
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: `Query error: ${error.message}` }, { status: 500 });
  }

  if (!attachments || attachments.length === 0) {
    return NextResponse.json({
      action: 'document',
      message: 'No unregistered attachments to process',
      processed: 0,
    });
  }

  const stats = {
    processed: 0,
    newDocuments: 0,
    newVersions: 0,
    duplicates: 0,
    noReference: 0,
    errors: 0,
  };

  for (const att of attachments) {
    try {
      stats.processed++;

      // Compute content hash
      const contentHash = createHash('sha256')
        .update(`${att.filename}|${att.size_bytes}|${(att.extracted_text || '').substring(0, 2000)}`)
        .digest('hex');

      // Get classification from attachment_classifications if available
      const { data: classification } = await supabase
        .from('attachment_classifications')
        .select('document_type, confidence')
        .eq('attachment_id', att.id)
        .single();

      const email = att.raw_emails as { received_at?: string };
      const result = await documentRegistry.registerAttachment(
        att.id,
        contentHash,
        att.filename,
        att.extracted_text,
        att.email_id,
        email?.received_at || new Date().toISOString(),
        classification
          ? {
              documentType: classification.document_type || 'other',
              confidence: (classification.confidence || 0) * 100,
            }
          : undefined
      );

      if (result.success) {
        if (result.isNewDocument) stats.newDocuments++;
        if (result.isNewVersion) stats.newVersions++;
        if (result.isDuplicate) stats.duplicates++;
        if (!result.documentId) stats.noReference++;
      } else {
        stats.errors++;
      }
    } catch {
      stats.errors++;
    }

    // Rate limiting
    if (stats.processed % 50 === 0) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return NextResponse.json({
    action: 'document',
    processed: stats.processed,
    newDocuments: stats.newDocuments,
    newVersions: stats.newVersions,
    duplicates: stats.duplicates,
    noReference: stats.noReference,
    errors: stats.errors,
  });
}

/**
 * Run Flagging catch-up
 */
async function runFlaggingCatchUp(limit: number) {
  const flaggingOrchestrator = createFlaggingOrchestrator(supabase);

  // Find unflagged emails
  const { data: unflaggedEmails, error } = await supabase
    .from('raw_emails')
    .select('id')
    .is('clean_subject', null)
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: `Query error: ${error.message}` }, { status: 500 });
  }

  if (!unflaggedEmails || unflaggedEmails.length === 0) {
    return NextResponse.json({
      action: 'flagging',
      message: 'No unflagged emails to process',
      processed: 0,
    });
  }

  const emailIds = unflaggedEmails.map((e) => e.id);
  const result = await flaggingOrchestrator.flagBatch(emailIds);

  return NextResponse.json({
    action: 'flagging',
    processed: result.processed,
    success: result.success,
    failed: result.failed,
    businessAttachmentsFound: result.businessAttachmentsFound,
    signatureImagesFiltered: result.signatureImagesFiltered,
  });
}

/**
 * Run Workstate Registry catch-up
 */
async function runWorkstateCatchUp(limit: number) {
  const workstateRegistry = createWorkstateRegistryService(supabase);

  // Find shipments without workflow_state
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select(`
      id,
      booking_number,
      status,
      shipment_documents(
        document_type,
        document_id,
        raw_attachments!inner(email_id)
      )
    `)
    .is('workflow_state', null)
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: `Query error: ${error.message}` }, { status: 500 });
  }

  if (!shipments || shipments.length === 0) {
    return NextResponse.json({
      action: 'workstate',
      message: 'No shipments missing workflow state',
      processed: 0,
    });
  }

  const stats = {
    processed: 0,
    statesSet: 0,
    historyCreated: 0,
    errors: 0,
  };

  for (const shipment of shipments) {
    try {
      stats.processed++;

      // Determine initial state based on linked documents
      // Note: raw_attachments is an array from the join
      const docs = shipment.shipment_documents as Array<{
        document_type: string;
        document_id: string;
        raw_attachments: Array<{ email_id: string }>;
      }> | null;

      // Find the most advanced document type
      const docPriority = [
        'final_bl', 'draft_bl', 'si_confirmation', 'shipping_instructions',
        'booking_confirmation', 'booking_request'
      ];

      let bestDocType = 'booking_confirmation';
      let sourceEmailId: string | undefined;

      for (const priority of docPriority) {
        const doc = docs?.find((d) => d.document_type === priority);
        if (doc) {
          bestDocType = priority;
          // raw_attachments is an array, get first item's email_id
          sourceEmailId = doc.raw_attachments?.[0]?.email_id;
          break;
        }
      }

      // Record initial state transition
      if (sourceEmailId) {
        const result = await workstateRegistry.recordTransition({
          shipmentId: shipment.id,
          documentType: bestDocType,
          direction: 'inbound',
          sourceEmailId: sourceEmailId,
          transitionReason: 'Backfill from existing documents',
        });

        if (result.transitionRecorded) {
          stats.statesSet++;
          stats.historyCreated++;
        }
      } else {
        // Set state directly without history if no source email
        await supabase
          .from('shipments')
          .update({ workflow_state: shipment.status || 'pending' })
          .eq('id', shipment.id);
        stats.statesSet++;
      }
    } catch {
      stats.errors++;
    }

    // Rate limiting
    if (stats.processed % 20 === 0) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  return NextResponse.json({
    action: 'workstate',
    processed: stats.processed,
    statesSet: stats.statesSet,
    historyCreated: stats.historyCreated,
    errors: stats.errors,
  });
}
