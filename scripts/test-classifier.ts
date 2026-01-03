/**
 * Document Classifier Test Script
 * Run: npx tsx scripts/test-classifier.ts
 */

import { classifyDocument, EmailClassificationInput } from '../lib/services/unified-classification-service';

interface TestCase {
  name: string;
  input: EmailClassificationInput;
  expected: {
    documentType: string;
    direction: 'inbound' | 'outbound';
    workflowState: string | null;
    source: string;
  };
}

// ===== CARRIER EMAILS (INBOUND) =====
const CARRIER_TESTS: TestCase[] = [
  {
    name: 'Maersk Booking Confirmation',
    input: {
      subject: 'Booking Confirmation : 263522431',
      senderEmail: 'in.export@maersk.com',
      attachmentFilenames: ['BC_263522431.pdf'],
    },
    expected: {
      documentType: 'booking_confirmation',
      direction: 'inbound',
      workflowState: 'booking_confirmation_received',
      source: 'attachment', // Attachment patterns have higher priority than subject
    },
  },
  {
    name: 'Maersk SI Submitted',
    input: {
      subject: 'SI submitted 262874542-27Dec2025 20:48:34 UTC',
      senderEmail: 'booking.confirmation@maersk.com',
    },
    expected: {
      documentType: 'si_confirmation',
      direction: 'inbound',
      workflowState: 'si_confirmed',
      source: 'carrier',
    },
  },
  {
    name: 'Maersk Arrival Notice',
    input: {
      subject: 'Arrival notice 261736030',
      senderEmail: 'in.import@maersk.com',
    },
    expected: {
      documentType: 'arrival_notice',
      direction: 'inbound',
      workflowState: 'arrival_notice_received',
      source: 'carrier',
    },
  },
  {
    name: 'COSCO Proforma BL (MBL Draft)',
    input: {
      subject: 'COSCON - Proforma Bill of Lading for COSU6436834960/Vessel: CMA CGM PHOENIX',
      senderEmail: 'docs@coscon.com',
      attachmentFilenames: ['6436834960-20251205095515.PDF'],
    },
    expected: {
      documentType: 'mbl_draft',
      direction: 'inbound',
      workflowState: 'mbl_draft_received',
      source: 'carrier',
    },
  },
];

// ===== INDIA CHA EMAILS (INBOUND) =====
const INDIA_CHA_TESTS: TestCase[] = [
  {
    name: 'CHA Checklist',
    input: {
      subject: 'Document Checklist for Shipment XYZ123',
      senderEmail: 'docs@abclogistics.in',
    },
    expected: {
      documentType: 'checklist',
      direction: 'inbound',
      workflowState: 'checklist_received',
      source: 'partner',
    },
  },
  {
    name: 'CHA Shipping Bill',
    input: {
      subject: 'Shipping Bill No. 1234567 - Export Clearance',
      senderEmail: 'customs@chapartner.in',
    },
    expected: {
      documentType: 'shipping_bill',
      direction: 'inbound',
      workflowState: 'customs_export_filed',
      source: 'partner',
    },
  },
  {
    name: 'CHA LEO Copy',
    input: {
      subject: 'LEO Copy - Let Export Order for SB 1234567',
      senderEmail: 'export@chapartner.in',
    },
    expected: {
      documentType: 'leo_copy',
      direction: 'inbound',
      workflowState: 'customs_export_cleared',
      source: 'partner',
    },
  },
  {
    name: 'CHA Out of Charge',
    input: {
      subject: 'OOC received for BE 9876543',
      senderEmail: 'customs@chapartner.in',
    },
    expected: {
      documentType: 'customs_clearance',
      direction: 'inbound',
      workflowState: 'cargo_released',
      source: 'partner',
    },
  },
];

// ===== US CUSTOMS BROKER EMAILS (INBOUND) =====
const US_BROKER_TESTS: TestCase[] = [
  {
    name: 'US Broker Draft Entry',
    input: {
      subject: 'Draft Entry for your review - HBL INTG123456',
      senderEmail: 'entry@usbroker.com',
    },
    expected: {
      documentType: 'draft_entry',
      direction: 'inbound',
      workflowState: 'entry_draft_received',
      source: 'partner',
    },
  },
  {
    name: 'US Broker Entry Summary 7501',
    input: {
      subject: 'Entry Summary 7501 filed - Entry #123-4567890',
      senderEmail: 'customs@usbroker.com',
    },
    expected: {
      documentType: 'entry_summary',
      direction: 'inbound',
      workflowState: 'entry_filed',
      source: 'partner',
    },
  },
  {
    name: 'US Broker ISF Filed',
    input: {
      subject: 'ISF Confirmation - Filing accepted',
      senderEmail: 'isf@usbroker.com',
    },
    expected: {
      documentType: 'isf_filing',
      direction: 'inbound',
      workflowState: 'isf_filed',
      source: 'partner',
    },
  },
];

// ===== TRUCKER EMAILS (INBOUND) =====
const TRUCKER_TESTS: TestCase[] = [
  {
    name: 'Trucker POD',
    input: {
      subject: 'POD - Delivery completed for MSKU1234567',
      senderEmail: 'dispatch@trucker.com',
    },
    expected: {
      documentType: 'proof_of_delivery',
      direction: 'inbound',
      workflowState: 'pod_received',
      source: 'partner',
    },
  },
  {
    name: 'Trucker Gate-in Confirmation',
    input: {
      subject: 'Gate-in confirmed - Container arrived at CFS',
      senderEmail: 'operations@trucker.com',
    },
    expected: {
      documentType: 'gate_in_confirmation',
      direction: 'inbound',
      workflowState: 'gate_in_confirmed',
      source: 'partner',
    },
  },
  {
    name: 'Trucker Empty Return',
    input: {
      subject: 'Empty Return - Container returned to depot',
      senderEmail: 'fleet@trucker.com',
    },
    expected: {
      documentType: 'empty_return',
      direction: 'inbound',
      workflowState: 'empty_returned',
      source: 'partner',
    },
  },
];

// ===== CLIENT EMAILS (INBOUND) =====
const CLIENT_TESTS: TestCase[] = [
  {
    name: 'Client SI Draft',
    input: {
      subject: 'SI attached for booking BKG123456',
      senderEmail: 'export@shipper.com',
    },
    expected: {
      documentType: 'si_draft',
      direction: 'inbound',
      workflowState: 'si_draft_received',
      source: 'partner',
    },
  },
  {
    name: 'Client Commercial Invoice',
    input: {
      subject: 'Commercial Invoice for shipment to USA',
      senderEmail: 'accounts@shipper.com',
    },
    expected: {
      documentType: 'commercial_invoice',
      direction: 'inbound',
      workflowState: 'commercial_invoice_received',
      source: 'partner',
    },
  },
];

// ===== INTOGLO OUTBOUND EMAILS =====
const INTOGLO_TESTS: TestCase[] = [
  {
    name: 'Intoglo Booking Shared',
    input: {
      subject: 'Booking Confirmation - MSKU1234567',
      senderEmail: 'rahul@intoglo.com',
    },
    expected: {
      documentType: 'booking_confirmation',
      direction: 'outbound',
      workflowState: 'booking_confirmation_shared',
      source: 'intoglo',
    },
  },
  {
    name: 'Intoglo HBL Draft Sent',
    input: {
      subject: 'Draft HBL for your review - INTG123456',
      senderEmail: 'docs@intoglo.com',
    },
    expected: {
      documentType: 'hbl_draft',
      direction: 'outbound',
      workflowState: 'hbl_draft_sent',
      source: 'intoglo',
    },
  },
  {
    name: 'Intoglo HBL Released',
    input: {
      subject: 'HBL Released - Final documents attached',
      senderEmail: 'docs@intoglo.com',
    },
    expected: {
      documentType: 'hbl_release',
      direction: 'outbound',
      workflowState: 'hbl_released',
      source: 'intoglo',
    },
  },
  {
    name: 'Intoglo Checklist Shared',
    input: {
      subject: 'Export Checklist - Documents required',
      senderEmail: 'exports@intoglo.com',
    },
    expected: {
      documentType: 'checklist',
      direction: 'outbound',
      workflowState: 'checklist_shared',
      source: 'intoglo',
    },
  },
  {
    name: 'Intoglo Draft Entry Shared',
    input: {
      subject: 'Draft Entry for your approval',
      senderEmail: 'imports@intoglo.com',
    },
    expected: {
      documentType: 'draft_entry',
      direction: 'outbound',
      workflowState: 'entry_draft_shared',
      source: 'intoglo',
    },
  },
  {
    name: 'Intoglo Duty Summary Shared',
    input: {
      subject: 'Duty Summary - Import charges for your shipment',
      senderEmail: 'accounts@intoglo.com',
    },
    expected: {
      documentType: 'duty_summary',
      direction: 'outbound',
      workflowState: 'duty_summary_shared',
      source: 'intoglo',
    },
  },
  {
    name: 'Intoglo Invoice Sent',
    input: {
      subject: 'Freight Invoice #INV-2025-001234',
      senderEmail: 'accounts@intoglo.com',
    },
    expected: {
      documentType: 'freight_invoice',
      direction: 'outbound',
      workflowState: 'invoice_sent',
      source: 'intoglo',
    },
  },
];

// ===== ATTACHMENT-BASED =====
const ATTACHMENT_TESTS: TestCase[] = [
  {
    name: 'POD from attachment',
    input: {
      subject: 'Documents attached',
      senderEmail: 'unknown@logistics.com',
      attachmentFilenames: ['POD_MSKU1234567.pdf'],
    },
    expected: {
      documentType: 'proof_of_delivery',
      direction: 'inbound',
      workflowState: 'pod_received',
      source: 'attachment',
    },
  },
  {
    name: 'Entry Summary from attachment',
    input: {
      subject: 'Customs docs',
      senderEmail: 'broker@usbroker.com',
      attachmentFilenames: ['7501_Entry_123456.pdf'],
    },
    expected: {
      documentType: 'entry_summary',
      direction: 'inbound',
      workflowState: 'entry_filed',
      source: 'attachment',
    },
  },
];

// ===== BODY CONTENT =====
const BODY_TESTS: TestCase[] = [
  {
    name: 'POD from body',
    input: {
      subject: 'Delivery update',
      senderEmail: 'driver@trucker.com',
      bodyText: 'PFA the POD for container MSKU1234567.',
    },
    expected: {
      documentType: 'proof_of_delivery',
      direction: 'inbound',
      workflowState: 'pod_received',
      source: 'body',
    },
  },
  {
    name: 'SI from body',
    input: {
      subject: 'Shipment details',
      senderEmail: 'export@shipper.com',
      bodyText: 'Please find attached the SI for booking.',
    },
    expected: {
      documentType: 'si_draft',
      direction: 'inbound',
      workflowState: 'si_draft_received',
      source: 'body',
    },
  },
];

// ============================================================================
// RUN TESTS
// ============================================================================

function runTests(tests: TestCase[], category: string) {
  console.log(`\n=== ${category} ===`);
  let passed = 0, failed = 0;

  for (const tc of tests) {
    const result = classifyDocument(tc.input);
    const ok =
      result.documentType === tc.expected.documentType &&
      result.direction === tc.expected.direction &&
      result.workflowState === tc.expected.workflowState &&
      result.source === tc.expected.source;

    if (ok) {
      console.log(`  ✅ ${tc.name}`);
      passed++;
    } else {
      console.log(`  ❌ ${tc.name}`);
      console.log(`     Expected: ${tc.expected.documentType} | ${tc.expected.direction} | ${tc.expected.workflowState} | ${tc.expected.source}`);
      console.log(`     Got:      ${result.documentType} | ${result.direction} | ${result.workflowState} | ${result.source}`);
      failed++;
    }
  }

  return { passed, failed };
}

// Main
console.log('\n========================================');
console.log('DOCUMENT CLASSIFIER COMPREHENSIVE TEST');
console.log('========================================');

const allTests = [
  { name: 'CARRIER EMAILS (INBOUND)', tests: CARRIER_TESTS },
  { name: 'INDIA CHA (INBOUND)', tests: INDIA_CHA_TESTS },
  { name: 'US CUSTOMS BROKER (INBOUND)', tests: US_BROKER_TESTS },
  { name: 'TRUCKER (INBOUND)', tests: TRUCKER_TESTS },
  { name: 'CLIENT/SHIPPER (INBOUND)', tests: CLIENT_TESTS },
  { name: 'INTOGLO (OUTBOUND)', tests: INTOGLO_TESTS },
  { name: 'ATTACHMENT-BASED', tests: ATTACHMENT_TESTS },
  { name: 'BODY CONTENT', tests: BODY_TESTS },
];

let totalPassed = 0, totalFailed = 0;
for (const { name, tests } of allTests) {
  const { passed, failed } = runTests(tests, name);
  totalPassed += passed;
  totalFailed += failed;
}

console.log('\n========================================');
console.log(`TOTAL: ${totalPassed} passed, ${totalFailed} failed`);
console.log(`PASS RATE: ${((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(1)}%`);
console.log('========================================\n');
