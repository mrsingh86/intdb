import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Shipments that have booking_confirmation_shared but NOT booking_confirmation_received
const MISSING_RECEIVED = [
  'AMC2475643', 'AMC2475648', 'AMC2475813', 'AMC2482410',
  'CAD0845144', 'CAD0850107', 'CAD0850214',
  'CEI0329370',
  'COSU6435682540', 'COSU6438438920', 'COSU6438946680', 'COSU6438946700',
  'COSU6439083510', 'COSU6439083630',
  'EID0915030', 'EID0918049', 'EID0919146'
];

async function investigate() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('      INVESTIGATING SHIPMENTS MISSING booking_confirmation_received');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  for (const bookingNumber of MISSING_RECEIVED) {
    // Get shipment
    const { data: shipment } = await supabase
      .from('shipments')
      .select('id')
      .eq('booking_number', bookingNumber)
      .single();

    if (!shipment) {
      console.log(`[${bookingNumber}] NOT FOUND`);
      continue;
    }

    // Get all booking confirmation documents for this shipment
    const { data: docs } = await supabase
      .from('shipment_documents')
      .select(`
        document_type,
        email_id,
        raw_emails!inner(sender_email, true_sender_email, subject)
      `)
      .eq('shipment_id', shipment.id)
      .in('document_type', ['booking_confirmation', 'booking_amendment']);

    console.log(`\n[${bookingNumber}] - ${docs?.length || 0} booking docs found`);
    console.log('─'.repeat(70));

    for (const doc of docs || []) {
      const email = (doc as any).raw_emails || {};
      const sender = email.sender_email || '';
      const trueSender = email.true_sender_email || '';
      const subject = email.subject || '';

      // Check why this was detected as OUTBOUND
      const senderLower = sender.toLowerCase();
      const subjectLower = subject.toLowerCase();

      const isIntoglo = senderLower.includes('@intoglo.com') || senderLower.includes('@intoglo.in');
      const isForwarded = senderLower.includes('via operations') || senderLower.includes('via ops') || senderLower.includes('via pricing');

      const carrierPatterns = ['maersk', 'hapag', 'hlag', 'cma-cgm', 'cmacgm', 'msc.com', 'evergreen', 'oocl', 'cosco', 'yangming', 'one-line', 'zim'];
      const hasCarrierInSender = carrierPatterns.some(p => senderLower.includes(p));

      // Check carrier subject patterns
      const carrierSubjectPatterns = [
        /^booking confirmation\s*:\s*\d+/,
        /^bkg\s*#?\s*\d+/,
        /amendment.*booking/,
        /booking.*amendment/,
        /^\[hapag/,
        /^\[msc\]/,
        /^one booking/,
      ];
      const isCarrierSubject = carrierSubjectPatterns.some(p => p.test(subjectLower));

      // What direction would this be?
      let detectedDirection = 'INBOUND';
      if (isIntoglo && !isForwarded && !hasCarrierInSender && !isCarrierSubject) {
        detectedDirection = 'OUTBOUND';
      }

      console.log(`  Type: ${doc.document_type}`);
      console.log(`  Sender: ${sender}`);
      console.log(`  True Sender: ${trueSender || 'N/A'}`);
      console.log(`  Subject: ${subject.substring(0, 60)}...`);
      console.log(`  Detection: isIntoglo=${isIntoglo}, isForwarded=${isForwarded}, hasCarrier=${hasCarrierInSender}, carrierSubject=${isCarrierSubject}`);
      console.log(`  -> Direction: ${detectedDirection}`);
      console.log('');
    }
  }
}

investigate().catch(console.error);
