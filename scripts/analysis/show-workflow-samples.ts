/**
 * Show sample emails for each workflow state
 */
import { supabase, fetchByIds, isIntoglo } from './lib/supabase';

const getWorkflowState = (docType: string, outbound: boolean): string | null => {
  const mappings: Record<string, string> = {
    'booking_confirmation:inbound': 'booking_confirmation_received',
    'booking_amendment:inbound': 'booking_confirmation_received',
    'booking_confirmation:outbound': 'booking_confirmation_shared',
    'booking_amendment:outbound': 'booking_confirmation_shared',
    'invoice:inbound': 'commercial_invoice_received',
    'invoice:outbound': 'invoice_sent',
    'freight_invoice:inbound': 'commercial_invoice_received',
    'freight_invoice:outbound': 'invoice_sent',
    'shipping_instruction:inbound': 'si_confirmed',
    'shipping_instruction:outbound': 'si_submitted',
    'si_draft:inbound': 'si_draft_received',
    'si_draft:outbound': 'si_draft_shared',
    'si_submission:inbound': 'si_confirmed',
    'si_submission:outbound': 'si_submitted',
    'bill_of_lading:inbound': 'carrier_bl_received',
    'bill_of_lading:outbound': 'hbl_released',
    'hbl_draft:inbound': 'hbl_draft_received',
    'hbl_draft:outbound': 'hbl_draft_shared',
    'sob_confirmation:inbound': 'vessel_departed',
    'sob_confirmation:outbound': 'vessel_departed',
    'arrival_notice:inbound': 'arrival_notice_received',
    'arrival_notice:outbound': 'arrival_notice_shared',
    'customs_document:inbound': 'customs_invoice_received',
    'customs_document:outbound': 'duty_summary_shared',
    'delivery_order:inbound': 'cargo_released',
    'delivery_order:outbound': 'cargo_released',
    'container_release:inbound': 'cargo_released',
    'container_release:outbound': 'cargo_released',
    'vgm_submission:inbound': 'vgm_submitted',
    'vgm_submission:outbound': 'vgm_submitted',
  };
  return mappings[`${docType}:${outbound ? 'outbound' : 'inbound'}`] || null;
};

async function main() {
  console.log('Fetching workflow samples...\n');

  // Get active shipment IDs
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id')
    .not('status', 'in', '(cancelled,completed,delivered)');

  const shipmentIds = shipments?.map(s => s.id) || [];

  // Get shipment_documents for active shipments (batch to avoid limits)
  const allDocs: Array<{ email_id: string; document_type: string }> = [];
  for (let i = 0; i < shipmentIds.length; i += 50) {
    const batch = shipmentIds.slice(i, i + 50);
    const { data } = await supabase
      .from('shipment_documents')
      .select('email_id, document_type')
      .in('shipment_id', batch);
    if (data) allDocs.push(...data);
  }

  const emailIds = [...new Set(allDocs.map(d => d.email_id).filter(Boolean))];

  // Get emails
  const emails = await fetchByIds<{ id: string; subject: string; body_text: string; sender_email: string }>(
    'raw_emails',
    'id, subject, body_text, sender_email',
    'id',
    emailIds
  );

  const emailMap = new Map(emails.map(e => [e.id, e]));

  // Group by workflow state
  const byState: Record<string, Array<{ subject: string; body: string; dir: string }>> = {};

  for (const doc of allDocs) {
    const email = emailMap.get(doc.email_id);
    if (!email) continue;

    const outbound = isIntoglo(email.sender_email);
    const state = getWorkflowState(doc.document_type, outbound);
    if (!state) continue;

    if (!byState[state]) byState[state] = [];
    if (byState[state].length < 2) {
      byState[state].push({
        subject: email.subject || '(no subject)',
        body: (email.body_text || '').substring(0, 500),
        dir: outbound ? 'OUT' : 'IN',
      });
    }
  }

  // Print samples
  const phases: Record<string, string[]> = {
    'PRE-DEPARTURE': [
      'booking_confirmation_received',
      'booking_confirmation_shared',
      'commercial_invoice_received',
      'si_draft_received',
      'si_draft_shared',
      'si_submitted',
      'si_confirmed',
      'vgm_submitted',
      'carrier_bl_received',
      'hbl_draft_shared',
      'hbl_released',
    ],
    'IN-TRANSIT': ['vessel_departed', 'invoice_sent'],
    'ARRIVAL': [
      'arrival_notice_received',
      'arrival_notice_shared',
      'customs_invoice_received',
      'duty_summary_shared',
      'cargo_released',
    ],
  };

  for (const [phase, states] of Object.entries(phases)) {
    console.log('\n' + '═'.repeat(80));
    console.log(phase);
    console.log('═'.repeat(80));

    for (const state of states) {
      const samples = byState[state];
      if (!samples || samples.length === 0) {
        console.log('\n--- ' + state.toUpperCase() + ' --- (no samples)');
        continue;
      }

      console.log('\n--- ' + state.toUpperCase() + ' ---');
      for (const s of samples) {
        console.log('\n[' + s.dir + '] Subject: ' + s.subject);
        const cleanBody = s.body.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
        console.log('Body: ' + cleanBody.substring(0, 250) + '...');
      }
    }
  }
}

main().catch(console.error);
