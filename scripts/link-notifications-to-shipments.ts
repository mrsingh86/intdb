#!/usr/bin/env npx tsx
/**
 * Link Notifications to Shipments
 * Matches notifications to shipments by booking_number or bl_number from entity extractions
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('=== LINKING NOTIFICATIONS TO SHIPMENTS ===\n');

  // Get all notifications
  const { data: notifications, error: notifError } = await supabase
    .from('notifications')
    .select('id, email_id, title, summary, shipment_id');

  if (notifError) {
    console.error('Error fetching notifications:', notifError.message);
    return;
  }

  console.log('Total notifications:', notifications?.length || 0);
  const unlinked = (notifications || []).filter(n => n.shipment_id === null);
  console.log('Unlinked notifications:', unlinked.length);

  if (unlinked.length === 0) {
    console.log('All notifications are already linked or no notifications exist.');
    return;
  }

  // Get entity extractions for booking numbers
  const emailIds = unlinked.map(n => n.email_id).filter(Boolean);

  if (emailIds.length === 0) {
    console.log('No email_ids to look up.');
    return;
  }

  const { data: entities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_type, entity_value')
    .in('email_id', emailIds)
    .in('entity_type', ['booking_number', 'bl_number']);

  console.log('Entity extractions found:', entities?.length || 0);

  // Map email_id to booking numbers
  const emailToBooking = new Map<string, { booking: string | null; bl: string | null }>();
  for (const e of (entities || [])) {
    if (!emailToBooking.has(e.email_id)) {
      emailToBooking.set(e.email_id, { booking: null, bl: null });
    }
    const data = emailToBooking.get(e.email_id)!;
    if (e.entity_type === 'booking_number') {
      data.booking = e.entity_value;
    } else if (e.entity_type === 'bl_number') {
      data.bl = e.entity_value;
    }
  }

  // Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number');

  const bookingToShipment = new Map<string, string>();
  const blToShipment = new Map<string, string>();
  for (const s of (shipments || [])) {
    if (s.booking_number) bookingToShipment.set(s.booking_number, s.id);
    if (s.bl_number) blToShipment.set(s.bl_number, s.id);
  }

  console.log('Shipments with booking numbers:', bookingToShipment.size);
  console.log('Shipments with BL numbers:', blToShipment.size);

  // Link notifications
  let linked = 0;
  for (const notif of unlinked) {
    const data = emailToBooking.get(notif.email_id);
    let shipmentId: string | null = null;

    if (data?.booking && bookingToShipment.has(data.booking)) {
      shipmentId = bookingToShipment.get(data.booking)!;
    } else if (data?.bl && blToShipment.has(data.bl)) {
      shipmentId = blToShipment.get(data.bl)!;
    }

    if (shipmentId) {
      const { error } = await supabase
        .from('notifications')
        .update({ shipment_id: shipmentId })
        .eq('id', notif.id);

      if (!error) {
        linked++;
        console.log('Linked:', notif.title?.substring(0, 50));
      } else {
        console.error('Error linking notification:', error.message);
      }
    }
  }

  console.log('\n=== RESULTS ===');
  console.log('Notifications linked:', linked);
  console.log('Remaining unlinked:', unlinked.length - linked);
}

main().catch(console.error);
