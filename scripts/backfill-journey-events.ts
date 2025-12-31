/**
 * Backfill Journey Events Script
 *
 * Populates shipment_journey_events and stakeholder_communication_timeline
 * tables from existing data:
 * - Document lifecycle events
 * - Workflow state changes
 * - Email communications
 *
 * Run after migration 021 and email reprocessing.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const BATCH_SIZE = 100;

interface JourneyEvent {
  shipment_id: string;
  event_category: string;
  event_type: string;
  event_description: string;
  direction?: string;
  party_id?: string;
  party_name?: string;
  email_id?: string;
  document_lifecycle_id?: string;
  workflow_state_before?: string;
  workflow_state_after?: string;
  occurred_at: string;
}

interface CommunicationTimelineEntry {
  party_id?: string;
  shipment_id?: string;
  direction: string;
  communication_type: string;
  email_id?: string;
  subject?: string;
  summary?: string;
  document_type?: string;
  requires_response: boolean;
  response_due_date?: string;
  occurred_at: string;
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                    BACKFILL JOURNEY EVENTS & TIMELINE');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  const startTime = Date.now();
  let totalJourneyEvents = 0;
  let totalTimelineEntries = 0;

  // Step 1: Backfill document lifecycle events
  console.log('Step 1: Backfilling document lifecycle events...');
  totalJourneyEvents += await backfillDocumentEvents();

  // Step 2: Backfill email communications
  console.log('\nStep 2: Backfilling email communications...');
  const { journeyCount, timelineCount } = await backfillEmailCommunications();
  totalJourneyEvents += journeyCount;
  totalTimelineEntries += timelineCount;

  // Step 3: Backfill blocker events
  console.log('\nStep 3: Creating blocker events from existing blockers...');
  totalJourneyEvents += await backfillBlockerEvents();

  // Step 4: Detect and create blockers for shipments missing critical documents
  console.log('\nStep 4: Detecting blockers for active shipments...');
  await detectBlockersForActiveShipments();

  const elapsed = Math.round((Date.now() - startTime) / 1000);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                              BACKFILL COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Journey events created:    ${totalJourneyEvents}`);
  console.log(`  Timeline entries created:  ${totalTimelineEntries}`);
  console.log(`  Time:                      ${elapsed}s`);
  console.log('');
}

async function backfillDocumentEvents(): Promise<number> {
  let created = 0;
  let offset = 0;

  while (true) {
    const { data: docs, error } = await supabase
      .from('document_lifecycle')
      .select(`
        id,
        shipment_id,
        document_type,
        lifecycle_status,
        received_at,
        approved_at,
        sent_at,
        status_history
      `)
      .not('shipment_id', 'is', null)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error('Error fetching documents:', error.message);
      break;
    }

    if (!docs || docs.length === 0) break;

    const events: JourneyEvent[] = [];

    for (const doc of docs) {
      // Document received event
      if (doc.received_at) {
        events.push({
          shipment_id: doc.shipment_id,
          event_category: 'document',
          event_type: 'document_received',
          event_description: `${formatDocType(doc.document_type)} received`,
          direction: 'inward',
          document_lifecycle_id: doc.id,
          occurred_at: doc.received_at,
        });
      }

      // Document approved event
      if (doc.approved_at && doc.lifecycle_status === 'approved') {
        events.push({
          shipment_id: doc.shipment_id,
          event_category: 'document',
          event_type: 'document_approved',
          event_description: `${formatDocType(doc.document_type)} approved`,
          direction: 'internal',
          document_lifecycle_id: doc.id,
          occurred_at: doc.approved_at,
        });
      }

      // Document sent event
      if (doc.sent_at && doc.lifecycle_status === 'sent') {
        events.push({
          shipment_id: doc.shipment_id,
          event_category: 'document',
          event_type: 'document_sent',
          event_description: `${formatDocType(doc.document_type)} sent to stakeholder`,
          direction: 'outward',
          document_lifecycle_id: doc.id,
          occurred_at: doc.sent_at,
        });
      }
    }

    if (events.length > 0) {
      const { error: insertError } = await supabase
        .from('shipment_journey_events')
        .upsert(events, { onConflict: 'id', ignoreDuplicates: true });

      if (insertError) {
        console.error('Error inserting events:', insertError.message);
      } else {
        created += events.length;
      }
    }

    offset += BATCH_SIZE;
    process.stdout.write(`  Processed ${offset} documents, created ${created} events\r`);

    if (docs.length < BATCH_SIZE) break;
  }

  console.log(`  Processed ${offset} documents, created ${created} events`);
  return created;
}

async function backfillEmailCommunications(): Promise<{ journeyCount: number; timelineCount: number }> {
  let journeyCount = 0;
  let timelineCount = 0;
  let offset = 0;

  while (true) {
    // Get emails linked to shipments
    const { data: emails, error } = await supabase
      .from('raw_emails')
      .select(`
        id,
        sender_email,
        subject,
        snippet,
        received_at,
        shipment_documents!inner(shipment_id),
        document_classifications(document_type)
      `)
      .range(offset, offset + BATCH_SIZE - 1);

    if (error) {
      console.error('Error fetching emails:', error.message);
      break;
    }

    if (!emails || emails.length === 0) break;

    const journeyEvents: JourneyEvent[] = [];
    const timelineEntries: CommunicationTimelineEntry[] = [];

    for (const email of emails) {
      const shipmentId = (email.shipment_documents as any[])?.[0]?.shipment_id;
      if (!shipmentId) continue;

      const docType = (email.document_classifications as any[])?.[0]?.document_type;
      const isOutbound = email.sender_email?.includes('@intoglo.com');
      const direction = isOutbound ? 'outbound' : 'inbound';

      // Journey event
      journeyEvents.push({
        shipment_id: shipmentId,
        event_category: 'communication',
        event_type: isOutbound ? 'email_sent' : 'email_received',
        event_description: email.subject || 'Email communication',
        direction: isOutbound ? 'outward' : 'inward',
        email_id: email.id,
        occurred_at: email.received_at,
      });

      // Timeline entry
      timelineEntries.push({
        shipment_id: shipmentId,
        direction,
        communication_type: 'email',
        email_id: email.id,
        subject: email.subject,
        summary: email.snippet?.substring(0, 200),
        document_type: docType,
        requires_response: !isOutbound && docType ? true : false,
        occurred_at: email.received_at,
      });
    }

    // Insert journey events
    if (journeyEvents.length > 0) {
      const { error: journeyError } = await supabase
        .from('shipment_journey_events')
        .upsert(journeyEvents, { onConflict: 'id', ignoreDuplicates: true });

      if (!journeyError) {
        journeyCount += journeyEvents.length;
      }
    }

    // Insert timeline entries
    if (timelineEntries.length > 0) {
      const { error: timelineError } = await supabase
        .from('stakeholder_communication_timeline')
        .upsert(timelineEntries, { onConflict: 'id', ignoreDuplicates: true });

      if (!timelineError) {
        timelineCount += timelineEntries.length;
      }
    }

    offset += BATCH_SIZE;
    process.stdout.write(`  Processed ${offset} emails\r`);

    if (emails.length < BATCH_SIZE) break;
  }

  console.log(`  Created ${journeyCount} journey events, ${timelineCount} timeline entries`);
  return { journeyCount, timelineCount };
}

async function backfillBlockerEvents(): Promise<number> {
  // Get all existing blockers
  const { data: blockers, error } = await supabase
    .from('shipment_blockers')
    .select('id, shipment_id, blocker_type, blocker_description, blocked_since, is_resolved, resolved_at');

  if (error || !blockers) {
    console.error('Error fetching blockers:', error?.message);
    return 0;
  }

  const events: JourneyEvent[] = [];

  for (const blocker of blockers) {
    // Blocker created event
    events.push({
      shipment_id: blocker.shipment_id,
      event_category: 'blocker',
      event_type: 'blocker_created',
      event_description: `Blocker: ${blocker.blocker_description}`,
      direction: 'internal',
      occurred_at: blocker.blocked_since,
    });

    // Blocker resolved event
    if (blocker.is_resolved && blocker.resolved_at) {
      events.push({
        shipment_id: blocker.shipment_id,
        event_category: 'blocker',
        event_type: 'blocker_resolved',
        event_description: `Resolved: ${blocker.blocker_description}`,
        direction: 'internal',
        occurred_at: blocker.resolved_at,
      });
    }
  }

  if (events.length > 0) {
    const { error: insertError } = await supabase
      .from('shipment_journey_events')
      .upsert(events, { onConflict: 'id', ignoreDuplicates: true });

    if (insertError) {
      console.error('Error inserting blocker events:', insertError.message);
      return 0;
    }
  }

  console.log(`  Created ${events.length} blocker events from ${blockers.length} blockers`);
  return events.length;
}

async function detectBlockersForActiveShipments(): Promise<void> {
  // Get active shipments
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select('id')
    .in('status', ['booked', 'in_transit'])
    .limit(500);

  if (error || !shipments) {
    console.error('Error fetching shipments:', error?.message);
    return;
  }

  let blockersCreated = 0;

  for (const shipment of shipments) {
    // Use the database function to detect blockers
    const { data, error: fnError } = await supabase
      .rpc('detect_shipment_blockers', { p_shipment_id: shipment.id });

    if (!fnError && data > 0) {
      blockersCreated += data;
    }
  }

  console.log(`  Detected ${blockersCreated} new blockers for ${shipments.length} active shipments`);
}

function formatDocType(docType: string): string {
  return docType
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

main().catch(console.error);
