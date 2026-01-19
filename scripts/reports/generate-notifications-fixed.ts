#!/usr/bin/env npx tsx
/**
 * Generate Notifications from Email Classifications
 * Fixed version with proper debugging
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
  'booking_confirmation': { type: 'booking_confirmation', priority: 'medium' },
};

async function generateNotifications() {
  console.log('=== GENERATING NOTIFICATIONS FROM EMAILS ===\n');

  // Get existing notification email_ids to avoid duplicates
  const { data: existingNotifs } = await supabase
    .from('notifications')
    .select('email_id');

  const existingEmailIds = new Set(existingNotifs?.map(n => n.email_id) || []);
  console.log('Existing notifications:', existingEmailIds.size);

  // Get document classifications that should generate notifications
  const docTypes = Object.keys(NOTIFICATION_TYPES);
  const { data: classifications, error: classError } = await supabase
    .from('document_classifications')
    .select('email_id, document_type, confidence_score')
    .in('document_type', docTypes);

  if (classError) {
    console.error('Error fetching classifications:', classError);
    return;
  }

  console.log('Classifications to process:', classifications?.length || 0);

  // Filter out already processed
  const newClassifications = classifications?.filter(c => {
    const isNew = !existingEmailIds.has(c.email_id);
    return isNew;
  }) || [];

  console.log('New classifications (not yet notified):', newClassifications.length);

  if (newClassifications.length === 0) {
    console.log('No new notifications to generate');
    return;
  }

  // Get email IDs for new classifications
  const emailIds = newClassifications.map(c => c.email_id);

  // Fetch emails in batches (Supabase has limits on IN clause)
  const emailMap = new Map<string, any>();
  const batchSize = 50;

  console.log('Fetching emails in batches...');
  for (let i = 0; i < emailIds.length; i += batchSize) {
    const batch = emailIds.slice(i, i + batchSize);
    const { data: emails, error: emailError } = await supabase
      .from('raw_emails')
      .select('id, subject, received_at, body_text')
      .in('id', batch);

    if (emailError) {
      console.error('Error fetching emails batch', i, ':', emailError.message);
      continue;
    }

    emails?.forEach(e => emailMap.set(e.id, e));
  }

  console.log('Emails fetched:', emailMap.size);

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

  // Prepare batch insert
  const notificationsToInsert: any[] = [];

  for (const c of newClassifications) {
    const email = emailMap.get(c.email_id);
    if (!email) {
      console.log('  Email not found:', c.email_id);
      continue;
    }

    const notifConfig = NOTIFICATION_TYPES[c.document_type];
    if (!notifConfig) {
      console.log('  No config for type:', c.document_type);
      continue;
    }

    // Find linked shipment
    const booking = emailToBooking.get(c.email_id);
    let shipmentId = null;
    if (booking) {
      shipmentId = bookingToShipment.get(booking) || blToShipment.get(booking);
    }

    // Create summary from subject/body
    const summary = email.body_text?.substring(0, 200) || email.subject || 'No summary available';

    notificationsToInsert.push({
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
  }

  console.log('\nPrepared notifications:', notificationsToInsert.length);

  // Batch insert in chunks of 100
  let created = 0;
  const chunkSize = 100;

  for (let i = 0; i < notificationsToInsert.length; i += chunkSize) {
    const chunk = notificationsToInsert.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from('notifications')
      .insert(chunk)
      .select();

    if (error) {
      console.error('Insert error at chunk', i, ':', error.message);
    } else {
      created += data?.length || 0;
      console.log(`  Inserted chunk ${i / chunkSize + 1}: ${data?.length || 0} notifications`);
    }
  }

  console.log('\nNotifications created:', created);

  // Final count
  const { count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true });

  console.log('Total notifications now:', count);
}

generateNotifications().catch(console.error);
