/**
 * Investigate Workflow State Coverage
 *
 * Deep analysis of why essential workflow states have low coverage:
 * - booking_confirmation_shared (should be ~100% after booking received)
 * - si_draft_received (should be high for shipments past SI stage)
 * - hbl_released (should be high for in-transit shipments)
 * - invoice_sent (should be high for billed shipments)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const PAGE_SIZE = 1000;

async function fetchAll<T = any>(table: string, select: string = '*'): Promise<T[]> {
  let allData: T[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (error) throw new Error(`${table}: ${error.message}`);

    if (data && data.length > 0) {
      allData = allData.concat(data as T[]);
      hasMore = data.length === PAGE_SIZE;
      page++;
    } else {
      hasMore = false;
    }
  }

  return allData;
}

interface Email {
  id: string;
  subject: string;
  sender_email: string;
  true_sender_email: string | null;
  body_text: string | null;
}

interface ShipmentDocument {
  id: string;
  shipment_id: string;
  email_id: string;
  document_type: string;
}

interface DocumentClassification {
  email_id: string;
  document_type: string;
  confidence_score: number;
}

interface Shipment {
  id: string;
  booking_number: string;
  workflow_state: string;
}

// Carrier detection patterns
const CARRIER_DOMAINS = [
  '@maersk.com', '@hapag-lloyd.com', '@hlag.com',
  '@cma-cgm.com', '@cmacgm.com', '@customer.cmacgm-group.com',
  '@msc.com', '@evergreen-marine.com', '@oocl.com',
  '@coscon.com', '@cosco.com', '@yangming.com', '@one-line.com', '@zim.com'
];

const INTOGLO_DOMAINS = ['@intoglo.com', '@intoglo.in'];

function isCarrierEmail(sender: string, trueSender: string | null): boolean {
  const check = (s: string) => CARRIER_DOMAINS.some(d => s.toLowerCase().includes(d));
  return check(trueSender || '') || check(sender);
}

function isIntogloEmail(sender: string): boolean {
  return INTOGLO_DOMAINS.some(d => sender.toLowerCase().includes(d));
}

function getDirection(sender: string, trueSender: string | null): 'inbound' | 'outbound' {
  if (isCarrierEmail(sender, trueSender)) return 'inbound';
  if (isIntogloEmail(sender)) return 'outbound';
  return 'inbound'; // Default to inbound for external parties
}

async function investigate() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('              WORKFLOW STATE COVERAGE INVESTIGATION');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Fetch all data
  console.log('Fetching data (with pagination)...');
  const [emails, shipmentDocs, classifications, shipments] = await Promise.all([
    fetchAll<Email>('raw_emails', 'id,subject,sender_email,true_sender_email'),
    fetchAll<ShipmentDocument>('shipment_documents', 'id,shipment_id,email_id,document_type'),
    fetchAll<DocumentClassification>('document_classifications', 'email_id,document_type,confidence_score'),
    fetchAll<Shipment>('shipments', 'id,booking_number,workflow_state'),
  ]);

  console.log(`  Emails: ${emails.length}`);
  console.log(`  Shipment Documents: ${shipmentDocs.length}`);
  console.log(`  Classifications: ${classifications.length}`);
  console.log(`  Shipments: ${shipments.length}`);
  console.log('');

  // Create lookups
  const emailMap = new Map(emails.map(e => [e.id, e]));
  const classificationMap = new Map(classifications.map(c => [c.email_id, c]));
  const shipmentMap = new Map(shipments.map(s => [s.id, s]));

  // Group documents by shipment
  const docsByShipment = new Map<string, ShipmentDocument[]>();
  for (const doc of shipmentDocs) {
    const existing = docsByShipment.get(doc.shipment_id) || [];
    existing.push(doc);
    docsByShipment.set(doc.shipment_id, existing);
  }

  // ========================================================================
  // ANALYSIS 1: Document Type Distribution with Direction
  // ========================================================================
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('1. DOCUMENT TYPE + DIRECTION DISTRIBUTION');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  const docTypeDirection: Record<string, { inbound: number; outbound: number }> = {};

  for (const doc of shipmentDocs) {
    const email = emailMap.get(doc.email_id);
    if (!email) continue;

    const direction = getDirection(email.sender_email, email.true_sender_email);
    const key = doc.document_type || 'unknown';

    if (!docTypeDirection[key]) {
      docTypeDirection[key] = { inbound: 0, outbound: 0 };
    }
    docTypeDirection[key][direction]++;
  }

  console.log('');
  console.log('Document Type'.padEnd(30) + 'Inbound'.padStart(10) + 'Outbound'.padStart(10) + '  Workflow State');
  console.log('─'.repeat(90));

  const workflowMapping: Record<string, { inbound?: string; outbound?: string }> = {
    'booking_confirmation': { inbound: 'booking_confirmation_received', outbound: 'booking_confirmation_shared' },
    'booking_amendment': { inbound: 'booking_confirmation_received', outbound: 'booking_confirmation_shared' },
    'shipping_instruction': { inbound: 'si_draft_received', outbound: 'si_submitted' },
    'si_submission': { inbound: 'si_confirmed', outbound: 'si_submitted' },
    'bill_of_lading': { inbound: 'mbl_draft_received', outbound: 'hbl_released' },
    'invoice': { inbound: 'commercial_invoice_received', outbound: 'invoice_sent' },
    'freight_invoice': { inbound: 'commercial_invoice_received', outbound: 'invoice_sent' },
    'arrival_notice': { inbound: 'arrival_notice_received', outbound: 'arrival_notice_shared' },
    'customs_document': { inbound: 'duty_invoice_received', outbound: 'duty_summary_shared' },
  };

  for (const [docType, counts] of Object.entries(docTypeDirection).sort((a, b) => (b[1].inbound + b[1].outbound) - (a[1].inbound + a[1].outbound))) {
    const mapping = workflowMapping[docType];
    const stateInfo = mapping
      ? `IN→${mapping.inbound || 'N/A'} | OUT→${mapping.outbound || 'N/A'}`
      : 'No mapping';
    console.log(
      docType.padEnd(30) +
      counts.inbound.toString().padStart(10) +
      counts.outbound.toString().padStart(10) +
      '  ' + stateInfo
    );
  }

  // ========================================================================
  // ANALYSIS 2: Investigate LOW COVERAGE states
  // ========================================================================
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('2. LOW COVERAGE INVESTIGATION');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // 2a. booking_confirmation_shared - needs booking_confirmation:outbound
  console.log('');
  console.log('─── 2a. booking_confirmation_shared ───');
  const bookingOutbound = shipmentDocs.filter(d => {
    if (d.document_type !== 'booking_confirmation' && d.document_type !== 'booking_amendment') return false;
    const email = emailMap.get(d.email_id);
    if (!email) return false;
    return getDirection(email.sender_email, email.true_sender_email) === 'outbound';
  });
  console.log(`Booking confirmations classified as OUTBOUND: ${bookingOutbound.length}`);

  // Check: How many shipments have ANY booking confirmation shared?
  const shipmentsWithBookingShared = new Set(bookingOutbound.map(d => d.shipment_id));
  console.log(`Shipments with booking_confirmation:outbound: ${shipmentsWithBookingShared.size} / ${shipments.length} (${((shipmentsWithBookingShared.size / shipments.length) * 100).toFixed(1)}%)`);

  // Sample some booking_confirmation emails to check direction logic
  console.log('');
  console.log('Sample booking_confirmation emails:');
  const bookingSamples = shipmentDocs
    .filter(d => d.document_type === 'booking_confirmation')
    .slice(0, 10);

  for (const doc of bookingSamples) {
    const email = emailMap.get(doc.email_id);
    if (!email) continue;
    const direction = getDirection(email.sender_email, email.true_sender_email);
    const shipment = shipmentMap.get(doc.shipment_id);
    console.log(`  [${direction.toUpperCase().padEnd(8)}] ${email.sender_email.substring(0, 35).padEnd(35)} | ${(shipment?.booking_number || 'N/A').substring(0, 12)}`);
    if (email.true_sender_email && email.true_sender_email !== email.sender_email) {
      console.log(`            true_sender: ${email.true_sender_email}`);
    }
  }

  // 2b. si_draft_received - needs shipping_instruction:inbound
  console.log('');
  console.log('─── 2b. si_draft_received ───');
  const siInbound = shipmentDocs.filter(d => {
    if (d.document_type !== 'shipping_instruction' && d.document_type !== 'si_submission' && d.document_type !== 'si_draft') return false;
    const email = emailMap.get(d.email_id);
    if (!email) return false;
    return getDirection(email.sender_email, email.true_sender_email) === 'inbound';
  });
  console.log(`SI documents classified as INBOUND: ${siInbound.length}`);

  const siOutbound = shipmentDocs.filter(d => {
    if (d.document_type !== 'shipping_instruction' && d.document_type !== 'si_submission') return false;
    const email = emailMap.get(d.email_id);
    if (!email) return false;
    return getDirection(email.sender_email, email.true_sender_email) === 'outbound';
  });
  console.log(`SI documents classified as OUTBOUND: ${siOutbound.length}`);

  // Sample SI emails
  console.log('');
  console.log('Sample SI emails:');
  const siSamples = shipmentDocs
    .filter(d => d.document_type === 'shipping_instruction' || d.document_type === 'si_submission')
    .slice(0, 8);

  for (const doc of siSamples) {
    const email = emailMap.get(doc.email_id);
    if (!email) continue;
    const direction = getDirection(email.sender_email, email.true_sender_email);
    console.log(`  [${direction.toUpperCase().padEnd(8)}] ${doc.document_type.padEnd(22)} | ${email.sender_email.substring(0, 40)}`);
    console.log(`            Subject: ${(email.subject || '').substring(0, 70)}`);
  }

  // 2c. hbl_released - needs bill_of_lading:outbound
  console.log('');
  console.log('─── 2c. hbl_released ───');
  const blOutbound = shipmentDocs.filter(d => {
    if (d.document_type !== 'bill_of_lading' && d.document_type !== 'house_bl' && d.document_type !== 'bl_draft') return false;
    const email = emailMap.get(d.email_id);
    if (!email) return false;
    return getDirection(email.sender_email, email.true_sender_email) === 'outbound';
  });
  console.log(`BL documents classified as OUTBOUND (hbl_released): ${blOutbound.length}`);

  const blInbound = shipmentDocs.filter(d => {
    if (d.document_type !== 'bill_of_lading') return false;
    const email = emailMap.get(d.email_id);
    if (!email) return false;
    return getDirection(email.sender_email, email.true_sender_email) === 'inbound';
  });
  console.log(`BL documents classified as INBOUND (mbl_draft_received): ${blInbound.length}`);

  // Sample BL emails
  console.log('');
  console.log('Sample BL emails:');
  const blSamples = shipmentDocs
    .filter(d => d.document_type === 'bill_of_lading')
    .slice(0, 10);

  for (const doc of blSamples) {
    const email = emailMap.get(doc.email_id);
    if (!email) continue;
    const direction = getDirection(email.sender_email, email.true_sender_email);
    console.log(`  [${direction.toUpperCase().padEnd(8)}] ${email.sender_email.substring(0, 45)}`);
    console.log(`            Subject: ${(email.subject || '').substring(0, 70)}`);
    if (email.true_sender_email && email.true_sender_email !== email.sender_email) {
      console.log(`            true_sender: ${email.true_sender_email}`);
    }
  }

  // 2d. invoice_sent - needs invoice:outbound or freight_invoice:outbound
  console.log('');
  console.log('─── 2d. invoice_sent ───');
  const invoiceOutbound = shipmentDocs.filter(d => {
    if (d.document_type !== 'invoice' && d.document_type !== 'freight_invoice') return false;
    const email = emailMap.get(d.email_id);
    if (!email) return false;
    return getDirection(email.sender_email, email.true_sender_email) === 'outbound';
  });
  console.log(`Invoice documents classified as OUTBOUND: ${invoiceOutbound.length}`);

  const invoiceInbound = shipmentDocs.filter(d => {
    if (d.document_type !== 'invoice' && d.document_type !== 'freight_invoice') return false;
    const email = emailMap.get(d.email_id);
    if (!email) return false;
    return getDirection(email.sender_email, email.true_sender_email) === 'inbound';
  });
  console.log(`Invoice documents classified as INBOUND: ${invoiceInbound.length}`);

  // Sample invoice emails
  console.log('');
  console.log('Sample invoice emails:');
  const invoiceSamples = shipmentDocs
    .filter(d => d.document_type === 'invoice' || d.document_type === 'freight_invoice')
    .slice(0, 8);

  for (const doc of invoiceSamples) {
    const email = emailMap.get(doc.email_id);
    if (!email) continue;
    const direction = getDirection(email.sender_email, email.true_sender_email);
    console.log(`  [${direction.toUpperCase().padEnd(8)}] ${doc.document_type.padEnd(15)} | ${email.sender_email.substring(0, 40)}`);
    console.log(`            Subject: ${(email.subject || '').substring(0, 70)}`);
  }

  // ========================================================================
  // ANALYSIS 3: Classification vs Linked Documents gap
  // ========================================================================
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('3. CLASSIFICATION vs LINKED DOCUMENTS GAP');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // Count classifications by type
  const classificationCounts: Record<string, number> = {};
  for (const c of classifications) {
    const type = c.document_type || 'unknown';
    classificationCounts[type] = (classificationCounts[type] || 0) + 1;
  }

  // Count linked documents by type
  const linkedCounts: Record<string, number> = {};
  for (const d of shipmentDocs) {
    const type = d.document_type || 'unknown';
    linkedCounts[type] = (linkedCounts[type] || 0) + 1;
  }

  console.log('');
  console.log('Document Type'.padEnd(30) + 'Classified'.padStart(12) + 'Linked'.padStart(10) + '  Gap'.padStart(8));
  console.log('─'.repeat(65));

  const allTypes = new Set([...Object.keys(classificationCounts), ...Object.keys(linkedCounts)]);
  for (const type of Array.from(allTypes).sort()) {
    const classified = classificationCounts[type] || 0;
    const linked = linkedCounts[type] || 0;
    const gap = classified - linked;
    if (classified > 0 || linked > 0) {
      console.log(
        type.padEnd(30) +
        classified.toString().padStart(12) +
        linked.toString().padStart(10) +
        (gap > 0 ? `+${gap}` : gap.toString()).padStart(8)
      );
    }
  }

  // ========================================================================
  // ANALYSIS 4: Emails with BL/SI/Invoice keywords NOT linked
  // ========================================================================
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('4. UNLINKED EMAILS WITH KEY DOCUMENT KEYWORDS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  const linkedEmailIds = new Set(shipmentDocs.map(d => d.email_id));

  // Find emails with HBL/BL keywords not linked
  const blKeywords = /\b(hbl|house\s*b\/l|bill\s*of\s*lading|draft\s*bl|bl\s*draft|telex\s*release)\b/i;
  const unlinkedBLEmails = emails.filter(e => {
    if (linkedEmailIds.has(e.id)) return false;
    return blKeywords.test(e.subject || '');
  });

  console.log('');
  console.log(`Emails with BL keywords NOT linked to shipments: ${unlinkedBLEmails.length}`);
  console.log('Samples:');
  unlinkedBLEmails.slice(0, 10).forEach(e => {
    console.log(`  [${e.sender_email.substring(0, 35).padEnd(35)}] ${(e.subject || '').substring(0, 60)}`);
  });

  // Find emails with SI keywords not linked
  const siKeywords = /\b(shipping\s*instruction|si\s*draft|si\s*submission|draft\s*si)\b/i;
  const unlinkedSIEmails = emails.filter(e => {
    if (linkedEmailIds.has(e.id)) return false;
    return siKeywords.test(e.subject || '');
  });

  console.log('');
  console.log(`Emails with SI keywords NOT linked to shipments: ${unlinkedSIEmails.length}`);
  unlinkedSIEmails.slice(0, 5).forEach(e => {
    console.log(`  [${e.sender_email.substring(0, 35).padEnd(35)}] ${(e.subject || '').substring(0, 60)}`);
  });

  // Find emails with Invoice keywords not linked
  const invoiceKeywords = /\b(freight\s*invoice|commercial\s*invoice|proforma|invoice\s*attached)\b/i;
  const unlinkedInvoiceEmails = emails.filter(e => {
    if (linkedEmailIds.has(e.id)) return false;
    return invoiceKeywords.test(e.subject || '');
  });

  console.log('');
  console.log(`Emails with Invoice keywords NOT linked to shipments: ${unlinkedInvoiceEmails.length}`);
  unlinkedInvoiceEmails.slice(0, 5).forEach(e => {
    console.log(`  [${e.sender_email.substring(0, 35).padEnd(35)}] ${(e.subject || '').substring(0, 60)}`);
  });

  // ========================================================================
  // SUMMARY
  // ========================================================================
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('5. ROOT CAUSE SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  console.log('FINDING 1: Direction Detection');
  console.log('  Booking confirmations: ' + (docTypeDirection['booking_confirmation']?.outbound || 0) + ' outbound vs ' + (docTypeDirection['booking_confirmation']?.inbound || 0) + ' inbound');
  console.log('  Bill of Lading: ' + (docTypeDirection['bill_of_lading']?.outbound || 0) + ' outbound vs ' + (docTypeDirection['bill_of_lading']?.inbound || 0) + ' inbound');
  console.log('  Shipping Instructions: ' + ((docTypeDirection['shipping_instruction']?.inbound || 0) + (docTypeDirection['si_submission']?.inbound || 0)) + ' inbound');
  console.log('  Invoices: ' + ((docTypeDirection['invoice']?.outbound || 0) + (docTypeDirection['freight_invoice']?.outbound || 0)) + ' outbound');

  console.log('');
  console.log('FINDING 2: Unlinked Documents');
  console.log('  BL emails not linked: ' + unlinkedBLEmails.length);
  console.log('  SI emails not linked: ' + unlinkedSIEmails.length);
  console.log('  Invoice emails not linked: ' + unlinkedInvoiceEmails.length);

  console.log('');
  console.log('FINDING 3: Classification Gap');
  const blClassified = classificationCounts['bill_of_lading'] || 0;
  const blLinked = linkedCounts['bill_of_lading'] || 0;
  console.log(`  BL: ${blClassified} classified, ${blLinked} linked (${blClassified - blLinked} unlinked)`);
}

investigate().catch(console.error);
