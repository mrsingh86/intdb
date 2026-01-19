import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function showBookingSharedDetails() {
  // Get shipments in booking_confirmation_shared state
  const shipments = await getAllRows<{id: string; booking_number: string; workflow_state: string}>(
    supabase, 'shipments', 'id, booking_number, workflow_state'
  );
  const sharedShipments = shipments.filter(s => s.workflow_state === 'booking_confirmation_shared');

  console.log('='.repeat(80));
  console.log('BOOKING_CONFIRMATION_SHARED - Detailed Email Samples');
  console.log('='.repeat(80));
  console.log('Total shipments in this state:', sharedShipments.length);
  console.log('');

  // Get docs and emails
  const docs = await getAllRows<{shipment_id: string; email_id: string; document_type: string}>(
    supabase, 'shipment_documents', 'shipment_id, email_id, document_type'
  );
  const emails = await getAllRows<{id: string; sender_email: string; true_sender_email: string; subject: string; body_text: string; email_direction: string}>(
    supabase, 'raw_emails', 'id, sender_email, true_sender_email, subject, body_text, email_direction'
  );
  const attachments = await getAllRows<{email_id: string; filename: string; content_type: string; size_bytes: number}>(
    supabase, 'raw_attachments', 'email_id, filename, content_type, size_bytes'
  );

  const emailMap = new Map(emails.map(e => [e.id, e]));
  const attachmentMap = new Map<string, typeof attachments>();
  attachments.forEach(a => {
    if (!attachmentMap.has(a.email_id)) attachmentMap.set(a.email_id, []);
    attachmentMap.get(a.email_id)!.push(a);
  });

  // Show 5 detailed samples
  for (const ship of sharedShipments.slice(0, 5)) {
    console.log('-'.repeat(80));
    console.log('SHIPMENT:', ship.booking_number);
    console.log('-'.repeat(80));

    const shipDocs = docs.filter(d => d.shipment_id === ship.id);
    const seenEmails = new Set<string>();

    for (const doc of shipDocs.slice(0, 2)) {
      if (seenEmails.has(doc.email_id)) continue;
      seenEmails.add(doc.email_id);

      const email = emailMap.get(doc.email_id);
      if (!email) continue;

      console.log('');
      console.log('Document Type:', doc.document_type);
      console.log('Direction:', email.email_direction);
      console.log('');
      console.log('FROM:', email.sender_email);
      if (email.true_sender_email) {
        console.log('TRUE SENDER:', email.true_sender_email);
      }
      console.log('');
      console.log('SUBJECT:', email.subject);
      console.log('');
      console.log('BODY:');
      console.log('-'.repeat(40));
      const body = (email.body_text || '').trim();
      // Show first 1500 chars of body
      console.log(body.substring(0, 1500));
      if (body.length > 1500) console.log('... [truncated]');
      console.log('-'.repeat(40));

      // Show attachments
      const emailAttachments = attachmentMap.get(doc.email_id) || [];
      if (emailAttachments.length > 0) {
        console.log('');
        console.log('ATTACHMENTS (' + emailAttachments.length + '):');
        emailAttachments.forEach(att => {
          const sizeKB = att.size_bytes ? Math.round(att.size_bytes / 1024) : 'N/A';
          console.log('  - ' + att.filename + ' (' + att.content_type + ', ' + sizeKB + ' KB)');
        });
      } else {
        console.log('');
        console.log('ATTACHMENTS: None');
      }
    }
    console.log('');
  }
}

showBookingSharedDetails();
