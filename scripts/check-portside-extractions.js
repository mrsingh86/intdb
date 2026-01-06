require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  console.log('='.repeat(100));
  console.log('CHECKING PORTSIDE EMAIL EXTRACTIONS');
  console.log('='.repeat(100));

  // Get Portside emails
  const { data: allEmails } = await supabase
    .from('raw_emails')
    .select('id, sender_email, subject')
    .order('received_at', { ascending: false });

  const portsideEmails = allEmails?.filter(e =>
    (e.sender_email || '').toLowerCase().includes('portside')
  ) || [];

  const portsideIds = portsideEmails.map(e => e.id);

  // Check entity_extractions
  console.log('\n=== ENTITY EXTRACTIONS ===');
  const { data: extractions } = await supabase
    .from('entity_extractions')
    .select('*')
    .in('email_id', portsideIds);

  console.log('Portside emails with entity_extractions:', extractions?.length || 0);

  if (extractions?.length) {
    for (const e of extractions) {
      const email = portsideEmails.find(em => em.id === e.email_id);
      console.log('\n' + '─'.repeat(80));
      console.log('Email:', email?.subject?.substring(0, 70));
      console.log('Booking#:', e.booking_number);
      console.log('BL#:', e.bl_number);
      console.log('Container#:', e.container_number);
    }
  }

  // Check document_classifications
  console.log('\n\n=== DOCUMENT CLASSIFICATIONS ===');
  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('*')
    .in('email_id', portsideIds);

  console.log('Portside emails with document_classifications:', classifications?.length || 0);

  if (classifications?.length) {
    for (const c of classifications) {
      const email = portsideEmails.find(em => em.id === c.email_id);
      console.log('\n' + '─'.repeat(80));
      console.log('Email:', email?.subject?.substring(0, 70));
      console.log('Document Type:', c.document_type);
      console.log('Confidence:', c.confidence_score);
      console.log('Method:', c.classification_method);
    }
  }

  // Check if booking numbers in Portside subjects match existing shipments
  console.log('\n\n=== BOOKING NUMBER MATCHING ===');

  // Extract booking numbers from Portside subjects
  // Pattern: Cust. Ref. SEINUS26112502782_I or CR#: SECNUS08122502815_I
  const bookingPattern = /(?:Cust\.?\s*Ref\.?|CR#):?\s*([A-Z0-9_]+)/i;

  for (const email of portsideEmails) {
    const match = (email.subject || '').match(bookingPattern);
    if (match) {
      const bookingNumber = match[1];
      console.log('\n' + '─'.repeat(60));
      console.log('Subject:', email.subject?.substring(0, 70));
      console.log('Extracted Booking#:', bookingNumber);

      // Check if this booking exists in shipments
      const { data: shipment } = await supabase
        .from('shipments')
        .select('id, booking_number, status')
        .eq('booking_number', bookingNumber)
        .single();

      if (shipment) {
        console.log('  ✅ SHIPMENT FOUND:', shipment.id.substring(0, 8) + '...', 'Status:', shipment.status);
      } else {
        console.log('  ❌ NO MATCHING SHIPMENT');
      }
    }
  }

  // SUMMARY
  console.log('\n\n=== SUMMARY ===');
  console.log('='.repeat(100));
  console.log('\nPortside emails:', portsideEmails.length);
  console.log('With entity_extractions:', extractions?.length || 0);
  console.log('With document_classifications:', classifications?.length || 0);

  console.log('\n\nRECOMMENDED FIXES:');
  console.log('1. Add portsidecustoms.com to known broker domains');
  console.log('2. Extract booking# from "Cust. Ref." or "CR#" in subject');
  console.log('3. Store in entity_extractions for backfill to link');
  console.log('4. Create document in shipment_documents with proper type');

  console.log('\n' + '='.repeat(100));
}

check().catch(console.error);
