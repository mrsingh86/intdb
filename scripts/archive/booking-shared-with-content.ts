import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

interface Shipment { id: string; booking_number: string; workflow_state: string }
interface Doc { shipment_id: string; email_id: string; document_type: string }
interface Email { id: string; sender_email: string; true_sender_email: string; subject: string; body_text: string; email_direction: string }
interface Attachment { email_id: string; filename: string; content_type: string; size_bytes: number; extracted_text: string }

async function findBestSamples() {
  const shipments = await getAllRows<Shipment>(supabase, 'shipments', 'id, booking_number, workflow_state');
  const sharedShipments = shipments.filter(s => s.workflow_state === 'booking_confirmation_shared');

  const docs = await getAllRows<Doc>(supabase, 'shipment_documents', 'shipment_id, email_id, document_type');
  const emails = await getAllRows<Email>(supabase, 'raw_emails', 'id, sender_email, true_sender_email, subject, body_text, email_direction');
  const attachments = await getAllRows<Attachment>(supabase, 'raw_attachments', 'email_id, filename, content_type, size_bytes, extracted_text');

  const emailMap = new Map(emails.map(e => [e.id, e]));
  const attachmentMap = new Map<string, Attachment[]>();
  attachments.forEach(a => {
    if (!attachmentMap.has(a.email_id)) attachmentMap.set(a.email_id, []);
    attachmentMap.get(a.email_id)!.push(a);
  });

  console.log('================================================================================');
  console.log('BOOKING_CONFIRMATION_SHARED - Samples with Content');
  console.log('================================================================================\n');

  // Find emails with body OR attachments with extracted text
  let count = 0;
  for (const ship of sharedShipments) {
    if (count >= 3) break;

    const shipDocs = docs.filter(d => d.shipment_id === ship.id);
    for (const doc of shipDocs) {
      const email = emailMap.get(doc.email_id);
      if (!email) continue;

      const atts = attachmentMap.get(doc.email_id) || [];
      const bodyLen = email.body_text?.length || 0;
      const hasExtractedText = atts.some(a => a.extracted_text && a.extracted_text.length > 100);

      if (bodyLen < 100 && !hasExtractedText) continue;

      console.log('================================================================================');
      console.log('SHIPMENT:', ship.booking_number);
      console.log('================================================================================');
      console.log('');
      console.log('FROM:', email.sender_email);
      if (email.true_sender_email) console.log('TRUE SENDER:', email.true_sender_email);
      console.log('DIRECTION:', email.email_direction);
      console.log('DOC TYPE:', doc.document_type);
      console.log('');
      console.log('SUBJECT:', email.subject);
      console.log('');

      if (bodyLen > 50) {
        console.log('EMAIL BODY:');
        console.log('─'.repeat(60));
        console.log(email.body_text.substring(0, 2000));
        if (bodyLen > 2000) console.log('... [truncated]');
        console.log('─'.repeat(60));
      }

      if (atts.length > 0) {
        console.log('');
        console.log('ATTACHMENTS (' + atts.length + '):');
        for (const att of atts) {
          const sizeKB = Math.round((att.size_bytes || 0) / 1024);
          console.log('  📎 ' + att.filename + ' (' + sizeKB + ' KB)');
          if (att.extracted_text && att.extracted_text.length > 50) {
            console.log('');
            console.log('  ─── EXTRACTED PDF TEXT ───');
            const lines = att.extracted_text.substring(0, 2000).split('\n');
            lines.forEach(line => console.log('  ' + line));
            if (att.extracted_text.length > 2000) console.log('  ... [truncated]');
            console.log('  ─── END PDF TEXT ───');
          }
        }
      }

      count++;
      console.log('\n');
      break;
    }
  }

  if (count === 0) {
    console.log('No samples found with body content or extracted PDF text.');
    console.log('\nShowing first 3 shipments anyway:\n');

    for (const ship of sharedShipments.slice(0, 3)) {
      const shipDocs = docs.filter(d => d.shipment_id === ship.id);
      const doc = shipDocs[0];
      if (!doc) continue;

      const email = emailMap.get(doc.email_id);
      if (!email) continue;

      const atts = attachmentMap.get(doc.email_id) || [];

      console.log('─'.repeat(80));
      console.log('SHIPMENT:', ship.booking_number);
      console.log('FROM:', email.sender_email);
      console.log('SUBJECT:', email.subject);
      console.log('ATTACHMENTS:', atts.map(a => a.filename).join(', ') || 'None');
      console.log('');
    }
  }
}

findBestSamples();
