import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  // Get shipments with only outbound booking confirmations
  const shipments = await getAllRows<{id: string; booking_number: string}>(
    supabase, 'shipments', 'id, booking_number'
  );
  
  const docs = await getAllRows<{shipment_id: string; document_type: string; email_id: string}>(
    supabase, 'shipment_documents', 'shipment_id, document_type, email_id'
  );
  
  const emails = await getAllRows<{id: string; email_direction: string}>(
    supabase, 'raw_emails', 'id, email_direction'
  );
  
  const emailDir = new Map(emails.map(e => [e.id, e.email_direction]));
  
  // Get inbound booking confirmations from document_classifications
  const classifications = await getAllRows<{email_id: string; document_type: string}>(
    supabase, 'document_classifications', 'email_id, document_type'
  );
  
  const inboundBookingEmails = classifications
    .filter(c => c.document_type === 'booking_confirmation')
    .filter(c => emailDir.get(c.email_id) === 'inbound')
    .map(c => c.email_id);
  
  console.log('=== INBOUND BOOKING CONFIRMATION EMAILS ===');
  console.log('Total inbound booking conf emails:', inboundBookingEmails.length);
  
  // How many are linked to shipments?
  const linkedEmailIds = new Set(docs.map(d => d.email_id));
  const linkedInbound = inboundBookingEmails.filter(id => linkedEmailIds.has(id));
  const unlinkedInbound = inboundBookingEmails.filter(id => !linkedEmailIds.has(id));
  
  console.log('Linked to shipments:', linkedInbound.length);
  console.log('NOT linked to shipments:', unlinkedInbound.length);
  
  // These unlinked inbound emails should be linked!
  console.log('\n=== CONCLUSION ===');
  console.log(unlinkedInbound.length + ' inbound booking confirmations exist but are not linked to any shipment');
  console.log('These emails need to be linked to their respective shipments');
}

check();
