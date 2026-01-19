import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

interface Shipment { id: string; booking_number: string; workflow_state: string }
interface Doc { shipment_id: string; email_id: string; document_type: string; created_at: string }
interface Email { id: string; sender_email: string; true_sender_email: string; subject: string; body_text: string; email_direction: string; received_at: string }
interface Attachment { email_id: string; filename: string; size_bytes: number }

async function showAllWorkstates() {
  const shipments = await getAllRows<Shipment>(supabase, 'shipments', 'id, booking_number, workflow_state');
  const docs = await getAllRows<Doc>(supabase, 'shipment_documents', 'shipment_id, email_id, document_type, created_at');
  const emails = await getAllRows<Email>(supabase, 'raw_emails', 'id, sender_email, true_sender_email, subject, body_text, email_direction, received_at');
  const attachments = await getAllRows<Attachment>(supabase, 'raw_attachments', 'email_id, filename, size_bytes');

  const emailMap = new Map(emails.map(e => [e.id, e]));
  const attachmentMap = new Map<string, Attachment[]>();
  attachments.forEach(a => {
    if (!attachmentMap.has(a.email_id)) attachmentMap.set(a.email_id, []);
    attachmentMap.get(a.email_id)!.push(a);
  });

  // Group shipments by workflow state
  const stateGroups: Record<string, Shipment[]> = {};
  shipments.forEach(s => {
    const state = s.workflow_state || 'null';
    if (!stateGroups[state]) stateGroups[state] = [];
    stateGroups[state].push(s);
  });

  // All states in order
  const allStates = [
    'booking_confirmation_received',
    'booking_confirmation_shared',
    'si_draft_received',
    'si_confirmed',
    'sob_received',
    'mbl_draft_received',
    'hbl_released',
    'invoice_sent',
    'arrival_notice_received',
    'arrival_notice_shared',
    'duty_invoice_received',
    'cargo_released',
  ];

  console.log('='.repeat(100));
  console.log('COMPLETE WORKFLOW STATE EXAMPLES');
  console.log('Generated:', new Date().toISOString());
  console.log('='.repeat(100));
  console.log('');

  for (const state of allStates) {
    const shipmentsInState = stateGroups[state] || [];

    console.log('');
    console.log('#'.repeat(100));
    console.log('STATE:', state.toUpperCase());
    console.log('Count:', shipmentsInState.length, 'shipments currently at this state');
    console.log('#'.repeat(100));

    if (shipmentsInState.length === 0) {
      console.log('  (No shipments currently at this state)');
      continue;
    }

    // Show 2 detailed examples per state
    for (const ship of shipmentsInState.slice(0, 2)) {
      console.log('');
      console.log('='.repeat(80));
      console.log('SHIPMENT:', ship.booking_number);
      console.log('='.repeat(80));

      // Get all documents for this shipment, sorted by date
      const shipDocs = docs
        .filter(d => d.shipment_id === ship.id)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      console.log('Total Documents:', shipDocs.length);
      console.log('');

      // Show each document
      for (let i = 0; i < Math.min(shipDocs.length, 4); i++) {
        const doc = shipDocs[i];
        const email = emailMap.get(doc.email_id);
        if (!email) continue;

        const atts = attachmentMap.get(doc.email_id) || [];

        console.log('-'.repeat(80));
        console.log('DOCUMENT', i + 1, 'of', shipDocs.length);
        console.log('-'.repeat(80));
        console.log('');
        console.log('Type:', doc.document_type);
        console.log('Direction:', email.email_direction?.toUpperCase());
        console.log('');
        console.log('FROM:', email.sender_email);
        if (email.true_sender_email) {
          console.log('TRUE SENDER:', email.true_sender_email);
        }
        console.log('');
        console.log('SUBJECT:', email.subject);
        console.log('');
        console.log('RECEIVED:', email.received_at);
        console.log('');

        // Body
        const body = (email.body_text || '').trim();
        if (body.length > 0) {
          console.log('BODY:');
          console.log('~'.repeat(60));
          const bodyPreview = body.substring(0, 800).split('\n').slice(0, 15).join('\n');
          console.log(bodyPreview);
          if (body.length > 800) console.log('... [truncated - ' + body.length + ' chars total]');
          console.log('~'.repeat(60));
        } else {
          console.log('BODY: (empty)');
        }

        // Attachments
        if (atts.length > 0) {
          console.log('');
          console.log('ATTACHMENTS:');
          atts.forEach(att => {
            const sizeKB = Math.round((att.size_bytes || 0) / 1024);
            console.log('  - ' + att.filename + ' (' + sizeKB + ' KB)');
          });
        }

        console.log('');
      }

      if (shipDocs.length > 4) {
        console.log('... and', shipDocs.length - 4, 'more documents');
      }
    }
  }

  // Summary
  console.log('');
  console.log('');
  console.log('='.repeat(100));
  console.log('SUMMARY');
  console.log('='.repeat(100));
  console.log('');
  console.log('State'.padEnd(40) + 'Current'.padStart(10) + 'Cumulative'.padStart(12));
  console.log('-'.repeat(62));

  // Calculate cumulative
  const STATE_ORDER: Record<string, number> = {
    'booking_confirmation_received': 10,
    'booking_confirmation_shared': 15,
    'si_draft_received': 30,
    'si_confirmed': 40,
    'sob_received': 60,
    'mbl_draft_received': 80,
    'hbl_released': 90,
    'invoice_sent': 95,
    'arrival_notice_received': 110,
    'arrival_notice_shared': 115,
    'duty_invoice_received': 130,
    'cargo_released': 160,
  };

  for (const state of allStates) {
    const current = (stateGroups[state] || []).length;
    const stateOrder = STATE_ORDER[state] || 0;

    let cumulative = 0;
    for (const ship of shipments) {
      const shipOrder = STATE_ORDER[ship.workflow_state] || 0;
      if (shipOrder >= stateOrder) cumulative++;
    }

    const pct = shipments.length > 0 ? Math.round((cumulative / shipments.length) * 100) : 0;
    console.log(state.padEnd(40) + current.toString().padStart(10) + (cumulative + ' (' + pct + '%)').padStart(12));
  }
}

showAllWorkstates();
