/**
 * Investigate Linking Process
 * Analyzes how emails are linked to shipments and identifies gaps
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

async function investigateLinking() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                    LINKING PROCESS INVESTIGATION');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // 1. Current state
  const { count: totalEmails } = await supabase.from('raw_emails').select('*', { count: 'exact', head: true });
  const { count: totalShipments } = await supabase.from('shipments').select('*', { count: 'exact', head: true });
  const { count: totalLinks } = await supabase.from('shipment_documents').select('*', { count: 'exact', head: true });

  console.log('CURRENT STATE:');
  console.log('─'.repeat(60));
  console.log('  Total emails:         ', totalEmails);
  console.log('  Total shipments:      ', totalShipments);
  console.log('  Total links:          ', totalLinks);
  console.log('');

  // 2. Emails linked vs unlinked
  const { data: links } = await supabase.from('shipment_documents').select('email_id, shipment_id');
  const linkedEmailIds = new Set(links?.map(l => l.email_id) || []);

  console.log('LINKING COVERAGE:');
  console.log('─'.repeat(60));
  console.log('  Emails linked:        ', linkedEmailIds.size, '(' + Math.round(linkedEmailIds.size / (totalEmails || 1) * 100) + '%)');
  console.log('  Emails NOT linked:    ', (totalEmails || 0) - linkedEmailIds.size);
  console.log('');

  // 3. How links were created
  const { data: linkMethods } = await supabase.from('shipment_documents').select('link_method');
  const byMethod: Record<string, number> = {};
  for (const l of linkMethods || []) {
    const method = l.link_method || 'null';
    byMethod[method] = (byMethod[method] || 0) + 1;
  }

  console.log('LINK METHODS:');
  console.log('─'.repeat(60));
  for (const [method, count] of Object.entries(byMethod).sort((a, b) => (b[1] as number) - (a[1] as number))) {
    console.log('  ' + method.padEnd(20) + count);
  }
  console.log('');

  // 4. Shipments with vs without emails
  const shipmentIdsWithLinks = new Set(links?.map(l => l.shipment_id) || []);

  const { data: allShipments } = await supabase.from('shipments').select('id, booking_number');
  const shipmentsWithoutEmails = (allShipments || []).filter(s => !shipmentIdsWithLinks.has(s.id));

  console.log('SHIPMENT COVERAGE:');
  console.log('─'.repeat(60));
  console.log('  Shipments with emails:    ', shipmentIdsWithLinks.size);
  console.log('  Shipments without emails: ', shipmentsWithoutEmails.length);
  console.log('');

  // 5. Check entity extractions for linkable info
  const { data: entities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_type, entity_value')
    .in('entity_type', ['booking_number', 'bl_number']);

  const emailsWithBookingRef = new Set<string>();
  const bookingNumbers = new Set<string>();
  const blNumbers = new Set<string>();

  for (const e of entities || []) {
    emailsWithBookingRef.add(e.email_id);
    if (e.entity_type === 'booking_number') bookingNumbers.add(e.entity_value);
    if (e.entity_type === 'bl_number') blNumbers.add(e.entity_value);
  }

  console.log('LINKABLE ENTITIES:');
  console.log('─'.repeat(60));
  console.log('  Emails with booking/BL ref: ', emailsWithBookingRef.size);
  console.log('  Unique booking numbers:     ', bookingNumbers.size);
  console.log('  Unique BL numbers:          ', blNumbers.size);
  console.log('');

  // 6. Gap analysis - emails with refs but not linked
  const emailsWithRefsNotLinked = [...emailsWithBookingRef].filter(id => !linkedEmailIds.has(id));
  console.log('GAP ANALYSIS:');
  console.log('─'.repeat(60));
  console.log('  Emails with refs but NOT linked: ', emailsWithRefsNotLinked.length);
  console.log('');

  // 7. Why not linked? Check if shipments exist for their refs
  console.log('WHY NOT LINKED (sample of 10):');
  console.log('─'.repeat(60));

  let withShipment = 0;
  let withoutShipment = 0;

  for (const emailId of emailsWithRefsNotLinked.slice(0, 20)) {
    // Get email's booking ref
    const { data: emailEntities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', emailId)
      .in('entity_type', ['booking_number', 'bl_number']);

    const bookingNum = emailEntities?.find(e => e.entity_type === 'booking_number')?.entity_value;
    const blNum = emailEntities?.find(e => e.entity_type === 'bl_number')?.entity_value;

    // Check if shipment exists
    let shipmentExists = false;
    if (bookingNum) {
      const { data } = await supabase.from('shipments').select('id').eq('booking_number', bookingNum).single();
      if (data) shipmentExists = true;
    }
    if (!shipmentExists && blNum) {
      const { data } = await supabase.from('shipments').select('id').eq('bl_number', blNum).single();
      if (data) shipmentExists = true;
    }

    if (shipmentExists) withShipment++;
    else withoutShipment++;

    if (emailsWithRefsNotLinked.indexOf(emailId) < 10) {
      console.log('  Email:', emailId.substring(0, 8) + '...');
      console.log('    Booking#:', bookingNum || 'N/A');
      console.log('    BL#:', blNum || 'N/A');
      console.log('    Shipment exists:', shipmentExists ? 'YES - Should be linked!' : 'NO - Need to create shipment');
      console.log('');
    }
  }

  console.log('SAMPLE BREAKDOWN (first 20):');
  console.log('─'.repeat(60));
  console.log('  Has shipment (need to link):     ', withShipment);
  console.log('  No shipment (need to create):    ', withoutShipment);
  console.log('');

  // 8. Summary of shipments without booking numbers in entity_extractions
  const allBookingNumbers = [...bookingNumbers];
  const { data: existingShipments } = await supabase
    .from('shipments')
    .select('booking_number')
    .in('booking_number', allBookingNumbers.slice(0, 500)); // Check first 500

  const existingBookingNums = new Set(existingShipments?.map(s => s.booking_number) || []);
  const missingShipments = allBookingNumbers.filter(bn => !existingBookingNums.has(bn));

  console.log('MISSING SHIPMENTS:');
  console.log('─'.repeat(60));
  console.log('  Booking numbers in entities:  ', bookingNumbers.size);
  console.log('  With existing shipment:       ', existingBookingNums.size);
  console.log('  WITHOUT shipment (need create):', missingShipments.length);
  if (missingShipments.length > 0) {
    console.log('  Sample missing:', missingShipments.slice(0, 5).join(', '));
  }
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('DIAGNOSIS:');
  console.log('─'.repeat(60));
  if (emailsWithRefsNotLinked.length > 0) {
    console.log('  Problem: ' + emailsWithRefsNotLinked.length + ' emails have booking/BL refs but are NOT linked');
    console.log('');
    console.log('  Causes:');
    console.log('    1. Shipment does not exist for the booking number');
    console.log('    2. Linking service was not run after entity extraction');
    console.log('');
    console.log('  Fix:');
    console.log('    1. Create missing shipments from booking_confirmation emails');
    console.log('    2. Run linking service to connect emails to shipments');
  } else {
    console.log('  All emails with booking refs are linked!');
  }
  console.log('');
}

investigateLinking().catch(console.error);
