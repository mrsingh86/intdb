import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function showSamples() {
  console.log('========================================================================');
  console.log('              EMAIL SAMPLES BY WORKFLOW STATE                           ');
  console.log('========================================================================\n');

  // Get shipments grouped by workflow state
  const shipments = await getAllRows<{id: string; booking_number: string; workflow_state: string}>(
    supabase, 'shipments', 'id, booking_number, workflow_state'
  );

  // Get shipment documents
  const docs = await getAllRows<{shipment_id: string; email_id: string; document_type: string}>(
    supabase, 'shipment_documents', 'shipment_id, email_id, document_type'
  );

  // Get emails
  const emails = await getAllRows<{id: string; sender_email: string; true_sender_email: string; subject: string; body_text: string; email_direction: string}>(
    supabase, 'raw_emails', 'id, sender_email, true_sender_email, subject, body_text, email_direction'
  );
  const emailMap = new Map(emails.map(e => [e.id, e]));

  // Group by workflow state
  const stateGroups: Record<string, typeof shipments> = {};
  shipments.forEach(s => {
    const state = s.workflow_state || 'null';
    if (!stateGroups[state]) stateGroups[state] = [];
    stateGroups[state].push(s);
  });

  // Key states to show
  const keyStates = [
    'booking_confirmation_received',
    'booking_confirmation_shared',
    'si_draft_received',
    'sob_received',
    'hbl_released',
    'invoice_sent',
    'arrival_notice_shared',
    'cargo_released',
  ];

  for (const state of keyStates) {
    const shipmentsInState = stateGroups[state] || [];
    if (shipmentsInState.length === 0) continue;

    console.log('========================================================================');
    console.log('STATE: ' + state.toUpperCase());
    console.log('Shipments: ' + shipmentsInState.length);
    console.log('========================================================================\n');

    // Get first 2 shipments in this state
    for (const ship of shipmentsInState.slice(0, 2)) {
      console.log('--- Shipment: ' + ship.booking_number + ' ---');

      // Get documents for this shipment
      const shipDocs = docs.filter(d => d.shipment_id === ship.id);

      // Show first email that likely triggered this state
      const relevantDoc = shipDocs[0];
      if (relevantDoc) {
        const email = emailMap.get(relevantDoc.email_id);
        if (email) {
          console.log('Document Type: ' + relevantDoc.document_type);
          console.log('Direction: ' + email.email_direction);
          console.log('Sender: ' + (email.sender_email || 'N/A'));
          console.log('True Sender: ' + (email.true_sender_email || 'N/A'));
          console.log('Subject: ' + (email.subject || 'N/A').substring(0, 80));
          const bodyPreview = (email.body_text || '').replace(/\s+/g, ' ').substring(0, 150);
          console.log('Body Preview: ' + bodyPreview + '...');
        }
      }
      console.log('');
    }
  }
}

showSamples();
