/**
 * Show Shipment Timeline with Documents and Cutoffs
 *
 * Displays:
 * - All documents linked to each shipment with version/revision
 * - Sender/recipient info
 * - All cutoff dates clearly formatted
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '---';
  const date = new Date(dateStr);
  // Format as YYYY-MM-DD HH:MM (local time)
  return date.toLocaleDateString('en-CA') + ' ' +
         date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDateOnly(dateStr: string | null): string {
  if (!dateStr) return '---';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-CA'); // YYYY-MM-DD format
}

async function showShipmentTimeline() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║         SHIPMENT TIMELINE WITH DOCUMENTS & CUTOFFS                                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  // Get all shipments with cutoffs
  const { data: shipments } = await supabase
    .from('shipments')
    .select('*')
    .order('booking_number');

  for (const shipment of shipments || []) {
    // Get linked documents with email details
    const { data: docs } = await supabase
      .from('shipment_documents')
      .select(`
        id,
        document_type,
        is_primary,
        email_id,
        linked_at
      `)
      .eq('shipment_id', shipment.id)
      .order('linked_at', { ascending: true });

    // Get email details for each doc
    const emailIds = docs?.map(d => d.email_id) || [];
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email, received_at')
      .in('id', emailIds);

    const emailMap = new Map(emails?.map(e => [e.id, e]) || []);

    // Header
    console.log('═'.repeat(120));
    console.log(`BOOKING: ${shipment.booking_number}  |  Status: ${shipment.status?.toUpperCase()}`);
    console.log('═'.repeat(120));

    // Cutoffs section
    console.log('\n┌─ SCHEDULE & CUTOFFS ─────────────────────────────────────────────────────────────────────────────────────┐');
    console.log(`│  ETD:          ${formatDateOnly(shipment.etd).padEnd(12)} │  ETA:          ${formatDateOnly(shipment.eta).padEnd(12)}                                    │`);
    console.log('├──────────────────────────────────────────────────────────────────────────────────────────────────────────┤');
    console.log(`│  SI Cutoff:    ${formatDate(shipment.si_cutoff).padEnd(20)}                                                                  │`);
    console.log(`│  VGM Cutoff:   ${formatDate(shipment.vgm_cutoff).padEnd(20)}                                                                  │`);
    console.log(`│  Cargo Cutoff: ${formatDate(shipment.cargo_cutoff).padEnd(20)}                                                                  │`);
    console.log(`│  Gate Cutoff:  ${formatDate(shipment.gate_cutoff).padEnd(20)}                                                                  │`);
    console.log('└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘');

    // Documents section
    console.log('\n┌─ LINKED DOCUMENTS ────────────────────────────────────────────────────────────────────────────────────────┐');
    console.log('│  Ver │ Type                    │ Received           │ From                          │ Subject            │');
    console.log('├──────┼─────────────────────────┼────────────────────┼───────────────────────────────┼────────────────────┤');

    // Sort documents by received date
    const sortedDocs = (docs || []).map(doc => ({
      ...doc,
      email: emailMap.get(doc.email_id)
    })).sort((a, b) => {
      const dateA = a.email?.received_at ? new Date(a.email.received_at).getTime() : 0;
      const dateB = b.email?.received_at ? new Date(b.email.received_at).getTime() : 0;
      return dateA - dateB;
    });

    // Track versions by document type
    const versionCounters: Record<string, number> = {};

    for (const doc of sortedDocs) {
      const email = doc.email;
      if (!email) continue;

      // Increment version counter for this document type
      const docType = doc.document_type;
      versionCounters[docType] = (versionCounters[docType] || 0) + 1;
      const version = versionCounters[docType];

      // Extract revision from subject if available (e.g., "2ND UPDATE", "3RD UPDATE")
      const revisionMatch = email.subject?.match(/(\d+)(?:ST|ND|RD|TH)\s+UPDATE/i);
      const revision = revisionMatch ? `v${revisionMatch[1]}` : `v${version}`;

      const primary = doc.is_primary ? '★' : ' ';
      const type = docType.substring(0, 22).padEnd(22);
      const received = formatDate(email.received_at).substring(0, 18).padEnd(18);
      const sender = email.sender_email.substring(0, 28).padEnd(28);
      const subject = email.subject?.substring(0, 18).padEnd(18) || 'N/A'.padEnd(18);

      console.log(`│ ${primary}${revision.padEnd(3)} │ ${type} │ ${received} │ ${sender} │ ${subject} │`);
    }

    console.log('└──────┴─────────────────────────┴────────────────────┴───────────────────────────────┴────────────────────┘');
    console.log('');
  }

  // Summary of cutoffs
  console.log('\n');
  console.log('═'.repeat(120));
  console.log('CUTOFFS SUMMARY (All Shipments with Cutoffs)');
  console.log('═'.repeat(120));
  console.log('');
  console.log('┌──────────────────┬──────────────┬──────────────┬─────────────────────┬─────────────────────┬─────────────────────┐');
  console.log('│ Booking          │ ETD          │ ETA          │ SI Cutoff           │ VGM Cutoff          │ Cargo Cutoff        │');
  console.log('├──────────────────┼──────────────┼──────────────┼─────────────────────┼─────────────────────┼─────────────────────┤');

  for (const shipment of (shipments || []).filter(s => s.si_cutoff || s.vgm_cutoff || s.cargo_cutoff)) {
    const bn = shipment.booking_number.substring(0, 16).padEnd(16);
    const etd = formatDateOnly(shipment.etd).padEnd(12);
    const eta = formatDateOnly(shipment.eta).padEnd(12);
    const si = formatDate(shipment.si_cutoff).padEnd(19);
    const vgm = formatDate(shipment.vgm_cutoff).padEnd(19);
    const cargo = formatDate(shipment.cargo_cutoff).padEnd(19);

    console.log(`│ ${bn} │ ${etd} │ ${eta} │ ${si} │ ${vgm} │ ${cargo} │`);
  }

  console.log('└──────────────────┴──────────────┴──────────────┴─────────────────────┴─────────────────────┴─────────────────────┘');
}

showShipmentTimeline().catch(console.error);
