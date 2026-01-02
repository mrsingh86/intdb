/**
 * Investigate why booking_confirmation_received is not 100%
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function isInbound(sender: string | null): boolean {
  if (!sender) return false;
  const s = sender.toLowerCase();
  // Inbound = NOT from Intoglo (i.e., from carrier or external party)
  return !s.includes('@intoglo.com') && !s.includes('@intoglo.in');
}

async function main() {
  // Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, carrier_name, source_email_id');

  // Get all shipment_documents
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('shipment_id, email_id, document_type');

  // Get email senders and classifications
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, sender_email, subject');

  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('email_id, document_type');

  // Create lookups
  const emailMap = new Map(emails?.map(e => [e.id, e]) || []);
  const classMap = new Map(classifications?.map(c => [c.email_id, c.document_type]) || []);

  // Find shipments with inbound vs outbound booking confirmations
  const shipmentsWithBCReceived = new Set<string>();
  const shipmentsWithBCShared = new Set<string>();

  for (const d of docs || []) {
    const email = emailMap.get(d.email_id);
    const docType = classMap.get(d.email_id) || d.document_type;

    if (docType === 'booking_confirmation' || docType === 'booking_amendment') {
      if (isInbound(email?.sender_email)) {
        shipmentsWithBCReceived.add(d.shipment_id);
      } else {
        shipmentsWithBCShared.add(d.shipment_id);
      }
    }
  }

  // Analyze missing
  interface MissingShipment {
    id: string;
    booking: string | null;
    carrier: string | null;
    hasShared: boolean;
    sourceEmailSender: string;
    sourceSubject: string;
  }

  const missingBCReceived: MissingShipment[] = [];
  for (const s of shipments || []) {
    if (!shipmentsWithBCReceived.has(s.id)) {
      const hasShared = shipmentsWithBCShared.has(s.id);
      const sourceEmail = emailMap.get(s.source_email_id);
      missingBCReceived.push({
        id: s.id,
        booking: s.booking_number,
        carrier: s.carrier_name,
        hasShared,
        sourceEmailSender: sourceEmail?.sender_email?.substring(0, 50) || 'N/A',
        sourceSubject: sourceEmail?.subject?.substring(0, 60) || 'N/A'
      });
    }
  }

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('     WHY booking_confirmation_received IS NOT 100%');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Total shipments:', shipments?.length);
  console.log('With BC received (inbound from carrier):', shipmentsWithBCReceived.size);
  console.log('With BC shared (outbound to customer):', shipmentsWithBCShared.size);
  console.log('Missing BC received:', missingBCReceived.length);
  console.log('');

  // Analyze the missing ones
  const hasSharedOnly = missingBCReceived.filter(m => m.hasShared);
  const hasNeither = missingBCReceived.filter(m => !m.hasShared);

  console.log('BREAKDOWN OF MISSING:');
  console.log('─'.repeat(60));
  console.log('Has BC shared but NOT received:', hasSharedOnly.length);
  console.log('Has NEITHER received nor shared:', hasNeither.length);
  console.log('');

  // Analyze source emails of missing shipments
  console.log('SOURCE EMAIL ANALYSIS:');
  console.log('─'.repeat(60));
  console.log('');
  console.log('These shipments have BC shared to customer, but the ORIGINAL');
  console.log('booking confirmation FROM the carrier is not linked.');
  console.log('');
  console.log('Possible reasons:');
  console.log('1. Original BC email exists but not linked to shipment');
  console.log('2. BC was received via different channel (not email)');
  console.log('3. Shipment created from forwarded/shared email, not original');
  console.log('');

  // Sample shipments with shared but not received
  console.log('SAMPLE: Shipments with BC shared but NOT received:');
  console.log('─'.repeat(70));
  for (const m of hasSharedOnly.slice(0, 10)) {
    console.log('');
    console.log('  Booking:', m.booking);
    console.log('  Carrier:', m.carrier);
    console.log('  Source Email Sender:', m.sourceEmailSender);
    console.log('  Source Subject:', m.sourceSubject);
  }

  // Check if there are unlinked BC emails from carriers
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('     CHECKING FOR UNLINKED CARRIER BC EMAILS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // Get all BC classified emails
  const bcEmails = classifications?.filter(c =>
    c.document_type === 'booking_confirmation' || c.document_type === 'booking_amendment'
  ) || [];

  // Get linked email IDs
  const linkedEmailIds = new Set(docs?.map(d => d.email_id) || []);

  // Find unlinked BC emails that are inbound
  const unlinkedInboundBC: Array<{email_id: string; sender: string; subject: string}> = [];
  for (const bc of bcEmails) {
    if (!linkedEmailIds.has(bc.email_id)) {
      const email = emailMap.get(bc.email_id);
      if (email && isInbound(email.sender_email)) {
        unlinkedInboundBC.push({
          email_id: bc.email_id,
          sender: email.sender_email || '',
          subject: email.subject || ''
        });
      }
    }
  }

  console.log('');
  console.log('Unlinked inbound BC emails (from carriers):', unlinkedInboundBC.length);
  console.log('');

  if (unlinkedInboundBC.length > 0) {
    console.log('These carrier BC emails exist but are NOT linked to any shipment:');
    console.log('─'.repeat(70));
    for (const e of unlinkedInboundBC.slice(0, 10)) {
      console.log('');
      console.log('  Sender:', e.sender.substring(0, 50));
      console.log('  Subject:', e.subject.substring(0, 60));
    }
  }
}

main().catch(console.error);
