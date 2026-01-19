#!/usr/bin/env npx tsx
/**
 * Generate Notifications from Email Classifications
 * Creates notifications for arrival notices, booking amendments, etc.
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Document types that should generate notifications
const NOTIFICATION_TYPES: Record<string, { type: string; priority: string }> = {
  'arrival_notice': { type: 'arrival_notice', priority: 'high' },
  'booking_amendment': { type: 'booking_amendment', priority: 'high' },
  'vessel_delay': { type: 'vessel_delay', priority: 'critical' },
  'customs_clearance': { type: 'customs_update', priority: 'medium' },
  'rate_change': { type: 'rate_change', priority: 'medium' },
};

async function generateNotifications() {
  console.log('=== GENERATING NOTIFICATIONS FROM EMAILS ===\n');

  // Get existing notification email_ids to avoid duplicates
  const { data: existingNotifs } = await supabase
    .from('notifications')
    .select('email_id');

  const existingEmailIds = new Set(existingNotifs?.map(n => n.email_id));
  console.log('Existing notifications:', existingEmailIds.size);

  // Get document classifications that should generate notifications
  const docTypes = Object.keys(NOTIFICATION_TYPES);
  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('email_id, document_type, confidence_score')
    .in('document_type', docTypes);

  console.log('Classifications to process:', classifications?.length);

  // Get email details
  const emailIds = classifications?.map(c => c.email_id) || [];
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, received_at, body_text')
    .in('id', emailIds);

  const emailMap = new Map(emails?.map(e => [e.id, e]));

  // Get entity extractions for linking to shipments
  const { data: entities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_type, entity_value')
    .in('email_id', emailIds)
    .in('entity_type', ['booking_number', 'bl_number']);

  const emailToBooking = new Map<string, string>();
  entities?.forEach(e => {
    if (!emailToBooking.has(e.email_id)) {
      emailToBooking.set(e.email_id, e.entity_value.split(',')[0].trim());
    }
  });

  // Get shipments for linking
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number');

  const bookingToShipment = new Map<string, string>();
  const blToShipment = new Map<string, string>();
  shipments?.forEach(s => {
    if (s.booking_number) bookingToShipment.set(s.booking_number, s.id);
    if (s.bl_number) blToShipment.set(s.bl_number, s.id);
  });

  let created = 0;
  let skipped = 0;

  for (const c of classifications || []) {
    // Skip if notification already exists
    if (existingEmailIds.has(c.email_id)) {
      skipped++;
      continue;
    }

    const email = emailMap.get(c.email_id);
    if (!email) continue;

    const notifConfig = NOTIFICATION_TYPES[c.document_type];
    if (!notifConfig) continue;

    // Find linked shipment
    const booking = emailToBooking.get(c.email_id);
    let shipmentId = null;
    if (booking) {
      shipmentId = bookingToShipment.get(booking) || blToShipment.get(booking);
    }

    // Create summary from subject/body
    const summary = email.body_text?.substring(0, 200) || email.subject || 'No summary available';

    const { error } = await supabase.from('notifications').insert({
      email_id: c.email_id,
      notification_type: notifConfig.type,
      classification_confidence: c.confidence_score,
      shipment_id: shipmentId,
      title: email.subject?.substring(0, 500) || 'Notification',
      summary: summary,
      priority: notifConfig.priority,
      status: 'unread',
      received_at: email.received_at,
    });

    if (!error) {
      created++;
    }
  }

  console.log('\nNotifications created:', created);
  console.log('Skipped (already exist):', skipped);

  // Final count
  const { count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true });

  console.log('Total notifications now:', count);
}

generateNotifications().catch(console.error);
