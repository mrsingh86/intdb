import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { withAuth } from '@/lib/auth/server-auth';

interface BackfillStats {
  documentsCreated: number;
  notificationsCreated: number;
  tasksCreated: number;
  errors: string[];
}

/**
 * POST /api/backfill
 *
 * Backfill Documents, Notifications, and Action Tasks from existing data.
 * This populates the new intelligence platform tables from existing raw_emails,
 * shipments, and document_classifications data.
 * Requires authentication.
 */
export const POST = withAuth(async (request, { user }) => {
  console.log('[Backfill] Starting intelligence platform backfill...');

  const stats: BackfillStats = {
    documentsCreated: 0,
    notificationsCreated: 0,
    tasksCreated: 0,
    errors: [],
  };

  try {
    const supabase = createClient();

    // Check existing data counts
    const { count: shipmentCount } = await supabase
      .from('shipments')
      .select('*', { count: 'exact', head: true });

    const { count: emailCount } = await supabase
      .from('raw_emails')
      .select('*', { count: 'exact', head: true });

    const { count: classificationCount } = await supabase
      .from('document_classifications')
      .select('*', { count: 'exact', head: true });

    console.log(`[Backfill] Found: ${shipmentCount} shipments, ${emailCount} emails, ${classificationCount} classifications`);

    // STEP 1: Create Document Lifecycle Records from shipments
    await backfillDocumentLifecycle(supabase, stats);

    // STEP 2: Create Notifications from classified emails
    await backfillNotifications(supabase, stats);

    // STEP 3: Generate Action Tasks
    await generateActionTasks(supabase, stats);

    console.log('[Backfill] Complete:', stats);

    return NextResponse.json({
      success: true,
      stats,
      message: `Created ${stats.documentsCreated} documents, ${stats.notificationsCreated} notifications, ${stats.tasksCreated} tasks`,
    });
  } catch (error) {
    console.error('[Backfill] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        stats
      },
      { status: 500 }
    );
  }
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function backfillDocumentLifecycle(supabase: any, stats: BackfillStats) {
  console.log('[Backfill] Step 1: Creating document lifecycle records...');

  try {
    // Get all shipments
    const { data: shipments, error: shipmentError } = await supabase
      .from('shipments')
      .select('id, booking_number, workflow_state, etd, eta, created_at')
      .order('created_at', { ascending: false });

    if (shipmentError) {
      stats.errors.push(`Failed to fetch shipments: ${shipmentError.message}`);
      return;
    }

    if (!shipments || shipments.length === 0) {
      console.log('[Backfill] No shipments found');
      return;
    }

    console.log(`[Backfill] Found ${shipments.length} shipments`);

    // Document types to create for each shipment
    const documentTypes = [
      'booking_confirmation',
      'shipping_instructions',
      'bill_of_lading',
      'commercial_invoice',
      'packing_list',
    ];

    for (const shipment of shipments) {
      // Map workflow state to document lifecycle status
      const workflowToLifecycle: Record<string, string> = {
        pending: 'draft',
        booking_confirmed: 'approved',
        si_submitted: 'sent',
        bl_received: 'acknowledged',
        shipped: 'acknowledged',
        delivered: 'acknowledged',
        cancelled: 'superseded',
      };

      const lifecycleStatus = workflowToLifecycle[shipment.workflow_state] || 'draft';

      // Create document lifecycle entries for each document type
      for (const docType of documentTypes) {
        // Check if already exists
        const { data: existing } = await supabase
          .from('document_lifecycle')
          .select('id')
          .eq('shipment_id', shipment.id)
          .eq('document_type', docType)
          .single();

        if (!existing) {
          // Determine status based on workflow and document type
          let docStatus = lifecycleStatus;
          let qualityScore = 85 + Math.random() * 15; // 85-100

          // Adjust based on document type and workflow
          if (docType === 'booking_confirmation' && shipment.workflow_state !== 'pending') {
            docStatus = 'acknowledged';
          } else if (docType === 'shipping_instructions') {
            if (shipment.workflow_state === 'pending' || shipment.workflow_state === 'booking_confirmed') {
              docStatus = 'draft';
              qualityScore = 60 + Math.random() * 20; // Lower for drafts
            }
          } else if (docType === 'bill_of_lading') {
            if (!['bl_received', 'shipped', 'delivered'].includes(shipment.workflow_state)) {
              continue; // Skip BL if not at that stage
            }
          }

          const { error: insertError } = await supabase
            .from('document_lifecycle')
            .insert({
              shipment_id: shipment.id,
              document_type: docType,
              lifecycle_status: docStatus,
              quality_score: Math.round(qualityScore * 100) / 100,
              due_date: shipment.etd,
              revision_count: 1,
              status_history: [{
                status: docStatus,
                changed_at: new Date().toISOString(),
                changed_by: 'system_backfill'
              }],
            });

          if (insertError) {
            if (!insertError.message.includes('duplicate')) {
              stats.errors.push(`Failed to create document for ${shipment.booking_number}: ${insertError.message}`);
            }
          } else {
            stats.documentsCreated++;
          }
        }
      }
    }

    console.log(`[Backfill] Created ${stats.documentsCreated} document lifecycle records`);
  } catch (error) {
    stats.errors.push(`Document backfill error: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function backfillNotifications(supabase: any, stats: BackfillStats) {
  console.log('[Backfill] Step 2: Creating notifications from classified emails...');

  try {
    // Get classified emails that look like notifications
    const { data: classifications, error: classError } = await supabase
      .from('document_classifications')
      .select(`
        id,
        email_id,
        document_type,
        confidence_score,
        raw_emails!inner (
          id,
          gmail_message_id,
          subject,
          sender_email,
          received_at,
          body_text
        )
      `)
      .order('created_at', { ascending: false });

    if (classError) {
      stats.errors.push(`Failed to fetch classifications: ${classError.message}`);
      return;
    }

    if (!classifications || classifications.length === 0) {
      console.log('[Backfill] No classifications found');
      return;
    }

    console.log(`[Backfill] Found ${classifications.length} classifications`);

    // Valid notification types from notification_type_configs table (migration 018)
    const validNotificationTypes = [
      'si_cutoff', 'vgm_cutoff', 'cargo_cutoff',
      'vessel_delay', 'rollover', 'vessel_omission',
      'port_congestion', 'equipment_shortage',
      'customs_hold', 'customs_clearance',
      'rate_increase', 'rate_restoration',
      'booking_amendment', 'arrival_notice', 'delivery_order',
      'payment_reminder', 'detention_alert'
    ];

    for (const classification of classifications) {
      const email = classification.raw_emails;
      if (!email) continue;

      // Notifications are OPERATIONAL ALERTS only, not regular documents
      // They should be from shipping lines, ports, customs about urgent issues
      // NOT: booking confirmations, invoices, BL drafts, SOB confirmations, amendments

      const subject = (email.subject || '').toUpperCase();
      const body = (email.body_text || '').toUpperCase();
      let notificationType: string | null = null;
      let priority = 'medium';
      let urgencyScore = 50;

      // CRITICAL: Rollover notices (cargo bumped to next vessel)
      if (subject.includes('ROLLOVER') || subject.includes('ROLLED OVER') ||
          subject.includes('CARGO ROLL') || body.includes('ROLLED TO NEXT VESSEL')) {
        notificationType = 'rollover';
        priority = 'critical';
        urgencyScore = 95;
      }
      // CRITICAL: Customs holds
      else if ((subject.includes('CUSTOMS') && (subject.includes('HOLD') || subject.includes('HELD'))) ||
               subject.includes('EXAMINATION ORDER') || subject.includes('CUSTOMS INSPECTION')) {
        notificationType = 'customs_hold';
        priority = 'critical';
        urgencyScore = 95;
      }
      // CRITICAL: Vessel omissions
      else if (subject.includes('PORT OMISSION') || subject.includes('PORT SKIP') ||
               subject.includes('WILL NOT CALL') || subject.includes('OMIT PORT')) {
        notificationType = 'vessel_omission';
        priority = 'critical';
        urgencyScore = 90;
      }
      // CRITICAL: Cargo cutoff reminders (not booking confirmations)
      else if ((subject.includes('CARGO CUTOFF') || subject.includes('GATE CLOSING')) &&
               !subject.includes('CONFIRMATION') && !subject.includes('CONFIRMED')) {
        notificationType = 'cargo_cutoff';
        priority = 'critical';
        urgencyScore = 90;
      }
      // HIGH: Vessel delays (not schedule updates)
      else if ((subject.includes('VESSEL DELAY') || subject.includes('DELAYED DEPARTURE') ||
                subject.includes('DELAY NOTIFICATION') || subject.includes('SCHEDULE DISRUPTION')) &&
               !subject.includes('UPDATE') && !subject.includes('CONFIRMATION')) {
        notificationType = 'vessel_delay';
        priority = 'high';
        urgencyScore = 75;
      }
      // HIGH: SI cutoff reminders (not SI submissions)
      else if ((subject.includes('SI CUTOFF') || subject.includes('SI CUT-OFF') ||
                subject.includes('SHIPPING INSTRUCTION DEADLINE')) &&
               !subject.includes('CONFIRMATION') && !subject.includes('SUBMITTED')) {
        notificationType = 'si_cutoff';
        priority = 'high';
        urgencyScore = 75;
      }
      // HIGH: VGM cutoff reminders
      else if ((subject.includes('VGM CUTOFF') || subject.includes('VGM CUT-OFF') ||
                subject.includes('VGM DEADLINE')) &&
               !subject.includes('CONFIRMATION') && !subject.includes('SUBMITTED')) {
        notificationType = 'vgm_cutoff';
        priority = 'high';
        urgencyScore = 75;
      }
      // HIGH: Detention/Demurrage alerts (financial urgency)
      else if (subject.includes('DETENTION') || subject.includes('DEMURRAGE') ||
               subject.includes('FREE TIME EXPIR') || subject.includes('STORAGE CHARGES')) {
        notificationType = 'detention_alert';
        priority = 'high';
        urgencyScore = 80;
      }
      // MEDIUM: Port congestion advisories
      else if (subject.includes('PORT CONGESTION') || subject.includes('TERMINAL CONGESTION') ||
               subject.includes('CONGESTION ADVISORY')) {
        notificationType = 'port_congestion';
        priority = 'medium';
        urgencyScore = 55;
      }
      // MEDIUM: Equipment shortage
      else if (subject.includes('EQUIPMENT SHORTAGE') || subject.includes('NO EQUIPMENT') ||
               subject.includes('CONTAINER SHORTAGE')) {
        notificationType = 'equipment_shortage';
        priority = 'medium';
        urgencyScore = 60;
      }
      // MEDIUM: Rate increase announcements (GRI)
      else if (subject.includes('RATE INCREASE') || subject.includes('GRI') ||
               subject.includes('GENERAL RATE INCREASE') || subject.includes('RATE RESTORATION')) {
        notificationType = 'rate_increase';
        priority = 'medium';
        urgencyScore = 50;
      }
      // MEDIUM: Customs submissions and issues (BSF forms, corrections needed)
      else if (subject.includes('BSF') || subject.includes('CUSTOMS SUBMISSION') ||
               subject.includes('CLOSE MESSAGE') || subject.includes('CUSTOMS CORRECTION') ||
               (subject.includes('CUSTOMS') && !subject.includes('INVOICE'))) {
        notificationType = 'customs_hold';
        priority = 'medium';
        urgencyScore = 65;
      }
      // MEDIUM: Rail transport notifications
      else if (subject.includes('RAILMENT') || subject.includes('RAIL CONFIRMATION') ||
               subject.includes('RAIL MOVEMENT') || subject.includes('TRAIN SCHEDULE')) {
        notificationType = 'vessel_delay'; // Reuse vessel_delay for rail (transport delays)
        priority = 'medium';
        urgencyScore = 55;
      }
      // MEDIUM: Port/ground rent related
      else if (subject.includes('GROUND RENT') || subject.includes('GATE IN') ||
               subject.includes('PORT REQUEST') || subject.includes('CONTAINER GATE')) {
        notificationType = 'detention_alert';
        priority = 'medium';
        urgencyScore = 60;
      }
      // MEDIUM: Arrival cargo notifications
      else if (subject.includes('ARRIVED CARGO') || subject.includes('CARGO ARRIVAL') ||
               subject.includes('ARRIVAL NOTICE')) {
        notificationType = 'arrival_notice';
        priority = 'medium';
        urgencyScore = 50;
      }

      // Skip emails that don't match OPERATIONAL ALERT patterns
      // Regular documents (booking confirmations, invoices, BL drafts, amendments) are NOT notifications
      if (!notificationType || !validNotificationTypes.includes(notificationType)) {
        continue;
      }

      // Check if already exists
      const { data: existing } = await supabase
        .from('notifications')
        .select('id')
        .eq('email_id', email.id)
        .single();

      if (!existing) {
        const { error: insertError } = await supabase
          .from('notifications')
          .insert({
            email_id: email.id,
            notification_type: notificationType,
            classification_confidence: classification.confidence_score,
            title: email.subject || 'Untitled Notification',
            summary: email.body_text?.substring(0, 500) || '',
            priority,
            urgency_score: urgencyScore,
            status: 'unread',
            received_at: email.received_at || new Date().toISOString(),
            extracted_data: {
              sender: email.sender_email,
              document_type: classification.document_type,
            },
          });

        if (insertError) {
          if (!insertError.message.includes('duplicate')) {
            stats.errors.push(`Failed to create notification: ${insertError.message}`);
          }
        } else {
          stats.notificationsCreated++;
        }
      }
    }

    console.log(`[Backfill] Created ${stats.notificationsCreated} notifications`);
  } catch (error) {
    stats.errors.push(`Notification backfill error: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function generateActionTasks(supabase: any, stats: BackfillStats) {
  console.log('[Backfill] Step 3: Generating action tasks...');

  try {
    // Get high-priority notifications without tasks
    const { data: notifications, error: notifError } = await supabase
      .from('notifications')
      .select('id, notification_type, title, priority, urgency_score, shipment_id')
      .in('priority', ['critical', 'high'])
      .eq('status', 'unread')
      .order('urgency_score', { ascending: false })
      .limit(50);

    if (notifError) {
      stats.errors.push(`Failed to fetch notifications: ${notifError.message}`);
      return;
    }

    console.log(`[Backfill] Found ${notifications?.length || 0} high-priority notifications`);

    // Generate tasks from notifications
    for (const notification of notifications || []) {
      // Check if task already exists for this notification
      const { data: existingTask } = await supabase
        .from('action_tasks')
        .select('id')
        .eq('notification_id', notification.id)
        .single();

      if (!existingTask) {
        // Generate task based on notification type (using valid types from migration 018)
        const taskConfig: Record<string, { title: string; category: string }> = {
          si_cutoff: { title: 'Submit Shipping Instructions', category: 'deadline' },
          vgm_cutoff: { title: 'Submit VGM Declaration', category: 'deadline' },
          cargo_cutoff: { title: 'Ensure Cargo Delivery', category: 'deadline' },
          vessel_delay: { title: 'Handle Vessel Delay', category: 'notification' },
          rollover: { title: 'Respond to Rollover Notice', category: 'notification' },
          vessel_omission: { title: 'Handle Port Omission', category: 'notification' },
          port_congestion: { title: 'Monitor Port Congestion', category: 'notification' },
          equipment_shortage: { title: 'Address Equipment Shortage', category: 'notification' },
          customs_hold: { title: 'Address Customs Hold', category: 'compliance' },
          customs_clearance: { title: 'Complete Customs Clearance', category: 'compliance' },
          rate_increase: { title: 'Review Rate Change', category: 'notification' },
          rate_restoration: { title: 'Review Rate Restoration', category: 'notification' },
          booking_amendment: { title: 'Review Booking Amendment', category: 'notification' },
          arrival_notice: { title: 'Process Arrival Notice', category: 'notification' },
          delivery_order: { title: 'Arrange Cargo Pickup', category: 'notification' },
          payment_reminder: { title: 'Process Payment', category: 'notification' },
          detention_alert: { title: 'Avoid Detention Charges', category: 'notification' },
        };

        const config = taskConfig[notification.notification_type] || {
          title: `Review: ${notification.title}`,
          category: 'notification'
        };

        // Calculate due date (2 days from now for critical, 5 days for high)
        const daysUntilDue = notification.priority === 'critical' ? 2 : 5;
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + daysUntilDue);

        const { error: insertError } = await supabase
          .from('action_tasks')
          .insert({
            notification_id: notification.id,
            shipment_id: notification.shipment_id,
            title: config.title,
            description: `Task generated from ${notification.notification_type}: ${notification.title}`,
            category: config.category,
            priority: notification.priority,
            priority_score: notification.urgency_score,
            priority_factors: {
              notification_severity: notification.urgency_score,
              deadline_urgency: notification.priority === 'critical' ? 90 : 60,
            },
            due_date: dueDate.toISOString(),
            urgency_level: notification.priority === 'critical' ? 'immediate' : 'today',
            status: 'pending',
          });

        if (insertError) {
          if (!insertError.message.includes('duplicate')) {
            stats.errors.push(`Failed to create task: ${insertError.message}`);
          }
        } else {
          stats.tasksCreated++;
        }
      }
    }

    // Also create tasks for shipments with approaching deadlines
    const { data: shipments, error: shipmentError } = await supabase
      .from('shipments')
      .select('id, booking_number, workflow_state, etd, si_cutoff, vgm_cutoff')
      .in('workflow_state', ['pending', 'booking_confirmed'])
      .not('etd', 'is', null);

    if (shipmentError) {
      console.log('[Backfill] Could not fetch shipments for deadline tasks');
    } else if (shipments && shipments.length > 0) {
      const now = new Date();
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

      for (const shipment of shipments) {
        // Check SI cutoff deadline
        if (shipment.si_cutoff) {
          const siCutoff = new Date(shipment.si_cutoff);
          if (siCutoff <= threeDaysFromNow && siCutoff > now) {
            const { data: existingTask } = await supabase
              .from('action_tasks')
              .select('id')
              .eq('shipment_id', shipment.id)
              .eq('category', 'deadline')
              .ilike('title', '%SI%')
              .single();

            if (!existingTask) {
              const daysUntil = Math.ceil((siCutoff.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
              const { error } = await supabase
                .from('action_tasks')
                .insert({
                  shipment_id: shipment.id,
                  title: `Submit SI for ${shipment.booking_number}`,
                  description: `SI cutoff is in ${daysUntil} day(s)`,
                  category: 'deadline',
                  priority: daysUntil <= 1 ? 'critical' : 'high',
                  priority_score: daysUntil <= 1 ? 95 : 80,
                  due_date: shipment.si_cutoff,
                  urgency_level: daysUntil <= 1 ? 'immediate' : 'today',
                  status: 'pending',
                });

              if (!error) stats.tasksCreated++;
            }
          }
        }

        // Check VGM cutoff deadline
        if (shipment.vgm_cutoff) {
          const vgmCutoff = new Date(shipment.vgm_cutoff);
          if (vgmCutoff <= threeDaysFromNow && vgmCutoff > now) {
            const { data: existingTask } = await supabase
              .from('action_tasks')
              .select('id')
              .eq('shipment_id', shipment.id)
              .eq('category', 'deadline')
              .ilike('title', '%VGM%')
              .single();

            if (!existingTask) {
              const daysUntil = Math.ceil((vgmCutoff.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
              const { error } = await supabase
                .from('action_tasks')
                .insert({
                  shipment_id: shipment.id,
                  title: `Submit VGM for ${shipment.booking_number}`,
                  description: `VGM cutoff is in ${daysUntil} day(s)`,
                  category: 'deadline',
                  priority: daysUntil <= 1 ? 'critical' : 'high',
                  priority_score: daysUntil <= 1 ? 95 : 80,
                  due_date: shipment.vgm_cutoff,
                  urgency_level: daysUntil <= 1 ? 'immediate' : 'today',
                  status: 'pending',
                });

              if (!error) stats.tasksCreated++;
            }
          }
        }
      }
    }

    console.log(`[Backfill] Created ${stats.tasksCreated} action tasks`);
  } catch (error) {
    stats.errors.push(`Task generation error: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

/**
 * DELETE /api/backfill
 *
 * Reset backfilled data (for testing purposes).
 * Requires authentication.
 */
export const DELETE = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();
    const url = new URL(request.url);
    const target = url.searchParams.get('target');

    const results: Record<string, number> = {};

    if (!target || target === 'all' || target === 'notifications') {
      // Delete all notifications
      const { data } = await supabase
        .from('notifications')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000')
        .select('id');
      results.notifications_deleted = data?.length || 0;
    }

    if (!target || target === 'all' || target === 'tasks') {
      // Delete all action tasks
      const { data } = await supabase
        .from('action_tasks')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000')
        .select('id');
      results.tasks_deleted = data?.length || 0;
    }

    if (target === 'documents') {
      // Delete document lifecycle (only if explicitly requested)
      const { data } = await supabase
        .from('document_lifecycle')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000')
        .select('id');
      results.documents_deleted = data?.length || 0;
    }

    return NextResponse.json({ success: true, results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
});

/**
 * GET /api/backfill
 *
 * Get current data counts for debugging.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();

    const [shipments, emails, classifications, documents, notifications, tasks] = await Promise.all([
      supabase.from('shipments').select('*', { count: 'exact', head: true }),
      supabase.from('raw_emails').select('*', { count: 'exact', head: true }),
      supabase.from('document_classifications').select('*', { count: 'exact', head: true }),
      supabase.from('document_lifecycle').select('*', { count: 'exact', head: true }),
      supabase.from('notifications').select('*', { count: 'exact', head: true }),
      supabase.from('action_tasks').select('*', { count: 'exact', head: true }),
    ]);

    return NextResponse.json({
      shipments: shipments.count || 0,
      raw_emails: emails.count || 0,
      document_classifications: classifications.count || 0,
      document_lifecycle: documents.count || 0,
      notifications: notifications.count || 0,
      action_tasks: tasks.count || 0,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
});
