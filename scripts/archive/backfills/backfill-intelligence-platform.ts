/**
 * Backfill Script for Orion Intelligence Platform
 *
 * Populates Documents, Notifications, and Action Center from existing data:
 * 1. Creates document_lifecycle records from shipment documents
 * 2. Classifies emails as notifications
 * 3. Generates action tasks from notifications and deadlines
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

interface BackfillStats {
  documentsCreated: number;
  notificationsCreated: number;
  tasksCreated: number;
  errors: string[];
}

async function main() {
  console.log('='.repeat(60));
  console.log('ORION INTELLIGENCE PLATFORM - DATA BACKFILL');
  console.log('='.repeat(60));

  const stats: BackfillStats = {
    documentsCreated: 0,
    notificationsCreated: 0,
    tasksCreated: 0,
    errors: [],
  };

  // Check existing data
  console.log('\n📊 Checking existing data...\n');

  const { count: shipmentCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });
  console.log(`  Shipments: ${shipmentCount || 0}`);

  const { count: emailCount } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true });
  console.log(`  Raw Emails: ${emailCount || 0}`);

  const { count: classificationCount } = await supabase
    .from('document_classifications')
    .select('*', { count: 'exact', head: true });
  console.log(`  Classified Emails: ${classificationCount || 0}`);

  const { count: docLifecycleCount } = await supabase
    .from('document_lifecycle')
    .select('*', { count: 'exact', head: true });
  console.log(`  Document Lifecycle (current): ${docLifecycleCount || 0}`);

  const { count: notificationCount } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true });
  console.log(`  Notifications (current): ${notificationCount || 0}`);

  const { count: taskCount } = await supabase
    .from('action_tasks')
    .select('*', { count: 'exact', head: true });
  console.log(`  Action Tasks (current): ${taskCount || 0}`);

  // Step 1: Backfill Document Lifecycle from shipments
  console.log('\n' + '='.repeat(60));
  console.log('STEP 1: Creating Document Lifecycle Records');
  console.log('='.repeat(60));

  await backfillDocumentLifecycle(stats);

  // Step 2: Backfill Notifications from classified emails
  console.log('\n' + '='.repeat(60));
  console.log('STEP 2: Creating Notifications from Emails');
  console.log('='.repeat(60));

  await backfillNotifications(stats);

  // Step 3: Generate Action Tasks
  console.log('\n' + '='.repeat(60));
  console.log('STEP 3: Generating Action Tasks');
  console.log('='.repeat(60));

  await generateActionTasks(stats);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`\n✅ Documents created: ${stats.documentsCreated}`);
  console.log(`✅ Notifications created: ${stats.notificationsCreated}`);
  console.log(`✅ Tasks created: ${stats.tasksCreated}`);

  if (stats.errors.length > 0) {
    console.log(`\n⚠️ Errors (${stats.errors.length}):`);
    stats.errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
    if (stats.errors.length > 10) {
      console.log(`  ... and ${stats.errors.length - 10} more`);
    }
  }
}

async function backfillDocumentLifecycle(stats: BackfillStats) {
  // Get shipments with their document info
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select(`
      id,
      booking_number,
      workflow_state,
      si_cutoff_date,
      vgm_cutoff_date,
      etd,
      created_at
    `)
    .not('booking_number', 'is', null)
    .limit(100);

  if (error) {
    stats.errors.push(`Failed to fetch shipments: ${error.message}`);
    console.log(`  ❌ Error fetching shipments: ${error.message}`);
    return;
  }

  console.log(`  Found ${shipments?.length || 0} shipments to process`);

  for (const shipment of shipments || []) {
    try {
      // Create document lifecycle records for common document types based on workflow state
      const documentTypes = getDocumentTypesForWorkflowState(shipment.workflow_state);

      for (const docType of documentTypes) {
        // Check if already exists
        const { data: existing } = await supabase
          .from('document_lifecycle')
          .select('id')
          .eq('shipment_id', shipment.id)
          .eq('document_type', docType.type)
          .single();

        if (existing) continue;

        // Create lifecycle record
        const { error: insertError } = await supabase
          .from('document_lifecycle')
          .insert({
            shipment_id: shipment.id,
            document_type: docType.type,
            lifecycle_status: docType.status,
            quality_score: docType.qualityScore,
            due_date: getDueDate(shipment, docType.type),
            received_at: shipment.created_at,
            status_history: [{
              status: docType.status,
              changed_at: new Date().toISOString(),
              changed_by: 'backfill_script',
            }],
          });

        if (insertError) {
          stats.errors.push(`Doc lifecycle for ${shipment.booking_number}: ${insertError.message}`);
        } else {
          stats.documentsCreated++;
        }
      }
    } catch (e: any) {
      stats.errors.push(`Shipment ${shipment.booking_number}: ${e.message}`);
    }
  }

  console.log(`  ✅ Created ${stats.documentsCreated} document lifecycle records`);
}

function getDocumentTypesForWorkflowState(workflowState: string): Array<{type: string, status: string, qualityScore: number}> {
  const docs: Array<{type: string, status: string, qualityScore: number}> = [];

  // Booking confirmation always exists if we have a shipment
  docs.push({ type: 'booking_confirmation', status: 'acknowledged', qualityScore: 95 });

  switch (workflowState) {
    case 'si_submitted':
    case 'si_confirmed':
    case 'documentation_complete':
    case 'cargo_delivered':
    case 'completed':
      docs.push({ type: 'si_draft', status: 'approved', qualityScore: 88 });
      docs.push({ type: 'si_final', status: 'sent', qualityScore: 92 });
      break;
    case 'si_pending':
      docs.push({ type: 'si_draft', status: 'draft', qualityScore: 65 });
      break;
    case 'booking_confirmed':
      // Just booking confirmation
      break;
  }

  if (['documentation_complete', 'cargo_delivered', 'completed'].includes(workflowState)) {
    docs.push({ type: 'hbl', status: 'acknowledged', qualityScore: 90 });
  }

  return docs;
}

function getDueDate(shipment: any, docType: string): string | null {
  switch (docType) {
    case 'si_draft':
    case 'si_final':
      return shipment.si_cutoff_date || null;
    case 'vgm':
      return shipment.vgm_cutoff_date || null;
    default:
      return null;
  }
}

async function backfillNotifications(stats: BackfillStats) {
  // Get classified emails that look like notifications
  const { data: classifications, error } = await supabase
    .from('document_classifications')
    .select(`
      id,
      email_id,
      document_type,
      document_subtype,
      confidence_score,
      booking_number,
      raw_emails!inner (
        id,
        gmail_message_id,
        subject,
        sender_email,
        received_at,
        body_text
      )
    `)
    .in('document_type', [
      'deadline_advisory',
      'vessel_schedule_change',
      'rate_notification',
      'amendment_confirmation',
      'rollover_notice',
      'arrival_notice',
      'customs_notification',
    ])
    .limit(100);

  if (error) {
    stats.errors.push(`Failed to fetch classifications: ${error.message}`);
    console.log(`  ❌ Error fetching classifications: ${error.message}`);
    return;
  }

  console.log(`  Found ${classifications?.length || 0} notification-type emails`);

  // Get notification type configs
  const { data: typeConfigs } = await supabase
    .from('notification_type_configs')
    .select('*');

  const configMap = new Map(typeConfigs?.map(c => [c.notification_type, c]) || []);

  for (const classification of classifications || []) {
    try {
      const email = (classification as any).raw_emails;
      if (!email) continue;

      // Check if notification already exists for this email
      const { data: existing } = await supabase
        .from('notifications')
        .select('id')
        .eq('email_id', email.id)
        .single();

      if (existing) continue;

      // Map document type to notification type
      const notificationType = mapToNotificationType(classification.document_type);
      const config = configMap.get(notificationType);

      // Find linked shipment
      let shipmentId = null;
      if (classification.booking_number) {
        const { data: shipment } = await supabase
          .from('shipments')
          .select('id')
          .eq('booking_number', classification.booking_number)
          .single();
        shipmentId = shipment?.id;
      }

      // Calculate priority and urgency
      const { priority, urgencyScore } = calculateNotificationPriority(
        notificationType,
        config,
        email.subject
      );

      // Extract deadline if mentioned
      const deadlineDate = extractDeadlineFromSubject(email.subject);

      // Create notification
      const { error: insertError } = await supabase
        .from('notifications')
        .insert({
          email_id: email.id,
          notification_type: notificationType,
          classification_confidence: classification.confidence_score,
          shipment_id: shipmentId,
          title: email.subject?.substring(0, 500) || 'Notification',
          summary: generateSummary(email.subject, classification.document_type),
          extracted_data: {
            booking_number: classification.booking_number,
            document_type: classification.document_type,
            document_subtype: classification.document_subtype,
          },
          priority,
          urgency_score: urgencyScore,
          deadline_date: deadlineDate,
          status: 'unread',
          received_at: email.received_at,
        });

      if (insertError) {
        stats.errors.push(`Notification for ${email.gmail_message_id}: ${insertError.message}`);
      } else {
        stats.notificationsCreated++;
      }
    } catch (e: any) {
      stats.errors.push(`Classification ${classification.id}: ${e.message}`);
    }
  }

  console.log(`  ✅ Created ${stats.notificationsCreated} notifications`);
}

function mapToNotificationType(documentType: string): string {
  const mapping: Record<string, string> = {
    'deadline_advisory': 'deadline_advisory',
    'vessel_schedule_change': 'vessel_delay',
    'rate_notification': 'rate_change',
    'amendment_confirmation': 'amendment_confirmation',
    'rollover_notice': 'rollover',
    'arrival_notice': 'arrival_notice',
    'customs_notification': 'customs_hold',
  };
  return mapping[documentType] || 'general_notification';
}

function calculateNotificationPriority(
  notificationType: string,
  config: any,
  subject: string
): { priority: string; urgencyScore: number } {
  // Default priorities by type
  const typePriorities: Record<string, { priority: string; urgency: number }> = {
    rollover: { priority: 'critical', urgency: 95 },
    customs_hold: { priority: 'critical', urgency: 90 },
    vessel_delay: { priority: 'high', urgency: 75 },
    deadline_advisory: { priority: 'high', urgency: 80 },
    rate_change: { priority: 'medium', urgency: 50 },
    arrival_notice: { priority: 'medium', urgency: 60 },
    amendment_confirmation: { priority: 'low', urgency: 30 },
    general_notification: { priority: 'low', urgency: 25 },
  };

  const defaults = typePriorities[notificationType] || { priority: 'medium', urgency: 50 };

  // Boost urgency if subject contains urgent keywords
  let urgencyScore = defaults.urgency;
  const urgentKeywords = ['urgent', 'immediate', 'asap', 'critical', 'deadline'];
  if (urgentKeywords.some(kw => subject?.toLowerCase().includes(kw))) {
    urgencyScore = Math.min(100, urgencyScore + 15);
  }

  return {
    priority: config?.default_priority || defaults.priority,
    urgencyScore,
  };
}

function extractDeadlineFromSubject(subject: string): string | null {
  if (!subject) return null;

  // Look for date patterns
  const datePatterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
    /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
  ];

  for (const pattern of datePatterns) {
    const match = subject.match(pattern);
    if (match) {
      try {
        const dateStr = match[0];
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          return date.toISOString();
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  return null;
}

function generateSummary(subject: string, documentType: string): string {
  const typeDescriptions: Record<string, string> = {
    deadline_advisory: 'Deadline notification requiring action',
    vessel_schedule_change: 'Vessel schedule has been updated',
    rate_notification: 'Rate change notification',
    amendment_confirmation: 'Booking amendment has been confirmed',
    rollover_notice: 'Shipment has been rolled over to next vessel',
    arrival_notice: 'Cargo arrival notification',
    customs_notification: 'Customs-related notification requiring attention',
  };

  return typeDescriptions[documentType] || `Notification: ${subject?.substring(0, 100) || 'No subject'}`;
}

async function generateActionTasks(stats: BackfillStats) {
  // Get notifications without tasks
  const { data: notifications, error } = await supabase
    .from('notifications')
    .select('*')
    .in('priority', ['critical', 'high'])
    .eq('status', 'unread')
    .limit(50);

  if (error) {
    stats.errors.push(`Failed to fetch notifications: ${error.message}`);
    console.log(`  ❌ Error fetching notifications: ${error.message}`);
    return;
  }

  console.log(`  Found ${notifications?.length || 0} high-priority notifications`);

  // Get task templates
  const { data: templates } = await supabase
    .from('task_templates')
    .select('*');

  const templateMap = new Map(templates?.map(t => [t.template_code, t]) || []);

  for (const notification of notifications || []) {
    try {
      // Check if task already exists
      const { data: existing } = await supabase
        .from('action_tasks')
        .select('id')
        .eq('notification_id', notification.id)
        .single();

      if (existing) continue;

      // Get template for this notification type
      const templateCode = getTemplateForNotificationType(notification.notification_type);
      const template = templateMap.get(templateCode);

      // Calculate priority score
      const priorityScore = calculateTaskPriorityScore(notification);

      // Determine urgency level
      const urgencyLevel = getUrgencyLevel(notification.deadline_date);

      // Create task
      const { error: insertError } = await supabase
        .from('action_tasks')
        .insert({
          template_id: template?.id,
          shipment_id: notification.shipment_id,
          notification_id: notification.id,
          title: generateTaskTitle(notification, template),
          description: generateTaskDescription(notification),
          category: template?.template_category || 'notification',
          priority: notification.priority,
          priority_score: priorityScore,
          priority_factors: {
            notification_severity: { weight: 15, score: notification.urgency_score, reason: notification.notification_type },
            deadline_urgency: { weight: 35, score: urgencyLevel === 'immediate' ? 100 : urgencyLevel === 'today' ? 80 : 50 },
          },
          due_date: notification.deadline_date || getDefaultDueDate(notification.priority),
          urgency_level: urgencyLevel,
          status: 'pending',
        });

      if (insertError) {
        stats.errors.push(`Task for notification ${notification.id}: ${insertError.message}`);
      } else {
        stats.tasksCreated++;
      }
    } catch (e: any) {
      stats.errors.push(`Notification ${notification.id}: ${e.message}`);
    }
  }

  // Also create tasks for approaching deadlines
  await generateDeadlineTasks(stats);

  console.log(`  ✅ Created ${stats.tasksCreated} action tasks`);
}

function getTemplateForNotificationType(notificationType: string): string {
  const mapping: Record<string, string> = {
    rollover: 'respond_rollover',
    customs_hold: 'address_customs_hold',
    vessel_delay: 'notify_delay',
    deadline_advisory: 'submit_si',
    arrival_notice: 'share_arrival_notice',
    rate_change: 'review_rate_change',
  };
  return mapping[notificationType] || 'review_notification';
}

function calculateTaskPriorityScore(notification: any): number {
  let score = 50;

  // Priority factor
  if (notification.priority === 'critical') score += 35;
  else if (notification.priority === 'high') score += 25;
  else if (notification.priority === 'medium') score += 10;

  // Urgency score factor
  score += (notification.urgency_score || 50) * 0.15;

  // Deadline factor
  if (notification.deadline_date) {
    const daysUntil = Math.floor((new Date(notification.deadline_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (daysUntil < 0) score += 20; // Overdue
    else if (daysUntil < 1) score += 15;
    else if (daysUntil < 3) score += 10;
  }

  return Math.min(100, Math.max(0, Math.round(score)));
}

function getUrgencyLevel(deadlineDate: string | null): 'immediate' | 'today' | 'this_week' | 'later' {
  if (!deadlineDate) return 'this_week';

  const deadline = new Date(deadlineDate);
  const now = new Date();
  const hoursUntil = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);

  if (hoursUntil < 0) return 'immediate';
  if (hoursUntil < 24) return 'today';
  if (hoursUntil < 168) return 'this_week';
  return 'later';
}

function generateTaskTitle(notification: any, template: any): string {
  if (template?.default_title_template) {
    return template.default_title_template
      .replace('{notification_type}', notification.notification_type?.replace(/_/g, ' ') || 'notification')
      .replace('{booking_number}', notification.extracted_data?.booking_number || 'N/A');
  }

  const titles: Record<string, string> = {
    rollover: 'Respond to Rollover Notice',
    customs_hold: 'Address Customs Hold',
    vessel_delay: 'Review Vessel Delay Impact',
    deadline_advisory: 'Action Required: Deadline Approaching',
    arrival_notice: 'Process Arrival Notice',
    rate_change: 'Review Rate Change',
  };

  return titles[notification.notification_type] || `Review: ${notification.title?.substring(0, 50) || 'Notification'}`;
}

function generateTaskDescription(notification: any): string {
  return `${notification.summary || 'Review this notification and take appropriate action.'}\n\nSource: ${notification.notification_type?.replace(/_/g, ' ')}\nPriority: ${notification.priority}\nReceived: ${new Date(notification.received_at).toLocaleDateString()}`;
}

function getDefaultDueDate(priority: string): string {
  const now = new Date();
  switch (priority) {
    case 'critical':
      now.setHours(now.getHours() + 4);
      break;
    case 'high':
      now.setDate(now.getDate() + 1);
      break;
    case 'medium':
      now.setDate(now.getDate() + 3);
      break;
    default:
      now.setDate(now.getDate() + 7);
  }
  return now.toISOString();
}

async function generateDeadlineTasks(stats: BackfillStats) {
  // Find shipments with approaching SI cutoff dates
  const threeDaysFromNow = new Date();
  threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, si_cutoff_date, vgm_cutoff_date, vessel_name')
    .lte('si_cutoff_date', threeDaysFromNow.toISOString())
    .gte('si_cutoff_date', new Date().toISOString())
    .in('workflow_state', ['booking_confirmed', 'si_pending'])
    .limit(20);

  for (const shipment of shipments || []) {
    // Check if task already exists
    const { data: existing } = await supabase
      .from('action_tasks')
      .select('id')
      .eq('shipment_id', shipment.id)
      .eq('category', 'deadline')
      .single();

    if (existing) continue;

    const daysUntil = Math.floor((new Date(shipment.si_cutoff_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24));

    const { error: insertError } = await supabase
      .from('action_tasks')
      .insert({
        shipment_id: shipment.id,
        title: `Submit SI for ${shipment.booking_number}`,
        description: `SI cutoff deadline approaching in ${daysUntil} day(s). Vessel: ${shipment.vessel_name || 'TBD'}`,
        category: 'deadline',
        priority: daysUntil <= 1 ? 'critical' : 'high',
        priority_score: daysUntil <= 1 ? 90 : 75,
        priority_factors: {
          deadline_urgency: { weight: 35, score: daysUntil <= 1 ? 100 : 80, reason: `${daysUntil} days until SI cutoff` },
        },
        due_date: shipment.si_cutoff_date,
        urgency_level: daysUntil <= 1 ? 'immediate' : 'today',
        status: 'pending',
      });

    if (!insertError) {
      stats.tasksCreated++;
    }
  }
}

main().catch(console.error);
