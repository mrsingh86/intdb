/**
 * Document Classifier Comprehensive Tests
 *
 * Tests all classification scenarios:
 * - All partners (Carriers, CHA, US Broker, Truckers, Clients, Intoglo)
 * - All document types
 * - Both directions (INBOUND/OUTBOUND)
 * - All workflow states
 */

import { classifyDocument, EmailClassificationInput } from '../unified-classification-service';

// ============================================================================
// TEST DATA: Sample Emails by Partner & Document Type
// ============================================================================

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

// ===== CARRIER EMAILS (INBOUND via ops group) =====
const CARRIER_TESTS: TestCase[] = [
  // Maersk
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
      source: 'carrier',
    },
  },
  {
    name: 'Maersk Booking Amendment',
    input: {
      subject: 'Booking Amendment : 262266445',
      senderEmail: 'in.export@maersk.com',
    },
    expected: {
      documentType: 'booking_amendment',
      direction: 'inbound',
      workflowState: 'booking_confirmation_received',
      source: 'carrier',
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
    name: 'Maersk Invoice',
    input: {
      subject: 'New invoice GJ26IN2500375201 (BL 262175704)',
      senderEmail: 'invoices@maersk.com',
    },
    expected: {
      documentType: 'invoice',
      direction: 'inbound',
      workflowState: 'commercial_invoice_received',
      source: 'carrier',
    },
  },

  // Hapag-Lloyd
  {
    name: 'Hapag Booking Confirmation',
    input: {
      subject: 'HL-22970937 USNYC NORTHP',
      senderEmail: 'booking@hlag.com',
      attachmentFilenames: ['HL-22970937 USSAV RESILIENT BC 3RD UPDATE.PDF'],
    },
    expected: {
      documentType: 'booking_confirmation',
      direction: 'inbound',
      workflowState: 'booking_confirmation_received',
      source: 'carrier',
    },
  },
  {
    name: 'Hapag SI Submitted',
    input: {
      subject: 'Shipping Instruction Submitted Sh#19207547',
      senderEmail: 'si@hlag.com',
    },
    expected: {
      documentType: 'si_confirmation',
      direction: 'inbound',
      workflowState: 'si_confirmed',
      source: 'carrier',
    },
  },
  {
    name: 'Hapag Arrival Alert',
    input: {
      subject: 'ALERT - Bill of lading HLCUBO12509ARSP4 DP 670651 POD USPEF Estimated date of discharge',
      senderEmail: 'alerts@hlag.com',
    },
    expected: {
      documentType: 'arrival_notice',
      direction: 'inbound',
      workflowState: 'arrival_notice_received',
      source: 'carrier',
    },
  },

  // CMA CGM
  {
    name: 'CMA CGM Booking Confirmation',
    input: {
      subject: 'CMA CGM - Booking confirmation available – CEI0329370 -  - 0INLLW1MA',
      senderEmail: 'noreply@cma-cgm.com',
      attachmentFilenames: ['BKGCONF_CEI0329370.pdf'],
    },
    expected: {
      documentType: 'booking_confirmation',
      direction: 'inbound',
      workflowState: 'booking_confirmation_received',
      source: 'carrier',
    },
  },
  {
    name: 'CMA CGM SI Submitted',
    input: {
      subject: 'CMA CGM - Shipping instruction submitted - AMC2475643',
      senderEmail: 'si@cma-cgm.com',
    },
    expected: {
      documentType: 'si_confirmation',
      direction: 'inbound',
      workflowState: 'si_confirmed',
      source: 'carrier',
    },
  },
  {
    name: 'CMA CGM Arrival Notice',
    input: {
      subject: 'CMA CGM - Arrival notice available - AMC2459902',
      senderEmail: 'arrivals@cma-cgm.com',
    },
    expected: {
      documentType: 'arrival_notice',
      direction: 'inbound',
      workflowState: 'arrival_notice_received',
      source: 'carrier',
    },
  },

  // COSCO
  {
    name: 'COSCO Booking Confirmation',
    input: {
      subject: 'Cosco Shipping Line Booking Confirmation - COSU6439083630 / Booking Office: MRA',
      senderEmail: 'booking@coscon.com',
      attachmentFilenames: ['6439083630.pdf'],
    },
    expected: {
      documentType: 'booking_confirmation',
      direction: 'inbound',
      workflowState: 'booking_confirmation_received',
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
    name: 'CHA Bill of Entry',
    input: {
      subject: 'Bill of Entry No. 9876543 - Import Clearance',
      senderEmail: 'import@chapartner.in',
    },
    expected: {
      documentType: 'bill_of_entry',
      direction: 'inbound',
      workflowState: 'customs_import_filed',
      source: 'partner',
    },
  },
  {
    name: 'CHA Duty Invoice',
    input: {
      subject: 'Duty Invoice - IGST Payment for BE 9876543',
      senderEmail: 'accounts@chapartner.in',
    },
    expected: {
      documentType: 'duty_invoice',
      direction: 'inbound',
      workflowState: 'duty_invoice_received',
      source: 'partner',
    },
  },
  {
    name: 'CHA Out of Charge',
    input: {
      subject: 'OOC - Out of Charge received for BE 9876543',
      senderEmail: 'customs@chapartner.in',
    },
    expected: {
      documentType: 'customs_clearance',
      direction: 'inbound',
      workflowState: 'cargo_released',
      source: 'partner',
    },
  },
  {
    name: 'CHA Exam Notice',
    input: {
      subject: 'Customs Hold - Container MSKU1234567 under examination',
      senderEmail: 'customs@chapartner.in',
    },
    expected: {
      documentType: 'exam_notice',
      direction: 'inbound',
      workflowState: 'customs_hold',
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
  {
    name: 'US Broker CBP Release',
    input: {
      subject: 'CBP Release - Entry cleared',
      senderEmail: 'release@usbroker.com',
    },
    expected: {
      documentType: 'customs_clearance',
      direction: 'inbound',
      workflowState: 'cargo_released',
      source: 'partner',
    },
  },
  {
    name: 'US Broker FDA Hold',
    input: {
      subject: 'FDA Hold - Container requires inspection',
      senderEmail: 'compliance@usbroker.com',
    },
    expected: {
      documentType: 'exam_notice',
      direction: 'inbound',
      workflowState: 'customs_hold',
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
    name: 'Trucker Delivery Confirmation',
    input: {
      subject: 'Delivery Done - Container unloaded at warehouse',
      senderEmail: 'ops@trucker.com',
    },
    expected: {
      documentType: 'delivery_confirmation',
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

// ===== CLIENT/SHIPPER EMAILS (INBOUND) =====
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
  {
    name: 'Client Packing List',
    input: {
      subject: 'Packing List for container MSKU1234567',
      senderEmail: 'logistics@shipper.com',
    },
    expected: {
      documentType: 'packing_list',
      direction: 'inbound',
      workflowState: 'documents_received',
      source: 'partner',
    },
  },
  {
    name: 'Client Certificate of Origin',
    input: {
      subject: 'COO - Certificate of Origin enclosed',
      senderEmail: 'export@shipper.com',
    },
    expected: {
      documentType: 'certificate',
      direction: 'inbound',
      workflowState: 'documents_received',
      source: 'partner',
    },
  },
];

// ===== INTOGLO OUTBOUND EMAILS =====
const INTOGLO_OUTBOUND_TESTS: TestCase[] = [
  {
    name: 'Intoglo Booking Confirmation Shared',
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
    name: 'Intoglo Arrival Notice Shared',
    input: {
      subject: 'Arrival Notice - Vessel ETA 25-Dec-2025',
      senderEmail: 'ops@intoglo.in',
    },
    expected: {
      documentType: 'arrival_notice',
      direction: 'outbound',
      workflowState: 'arrival_notice_shared',
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
  {
    name: 'Intoglo SI Confirmation',
    input: {
      subject: 'SI Confirmed - Shipping instructions accepted',
      senderEmail: 'docs@intoglo.com',
    },
    expected: {
      documentType: 'si_confirmation',
      direction: 'outbound',
      workflowState: 'si_confirmed',
      source: 'intoglo',
    },
  },
];

// ===== ATTACHMENT-BASED CLASSIFICATION =====
const ATTACHMENT_TESTS: TestCase[] = [
  {
    name: 'POD from attachment filename',
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
    name: 'Commercial Invoice from attachment',
    input: {
      subject: 'Please find attached',
      senderEmail: 'shipper@company.com',
      attachmentFilenames: ['Commercial_Invoice_2025.pdf'],
    },
    expected: {
      documentType: 'commercial_invoice',
      direction: 'inbound',
      workflowState: 'commercial_invoice_received',
      source: 'attachment',
    },
  },
  {
    name: 'Entry Summary 7501 from attachment',
    input: {
      subject: 'Customs documents',
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

// ===== BODY CONTENT CLASSIFICATION =====
const BODY_TESTS: TestCase[] = [
  {
    name: 'POD from body content',
    input: {
      subject: 'Delivery update',
      senderEmail: 'driver@trucker.com',
      bodyText: 'PFA the POD for container MSKU1234567. Delivery completed successfully.',
    },
    expected: {
      documentType: 'proof_of_delivery',
      direction: 'inbound',
      workflowState: 'pod_received',
      source: 'body',
    },
  },
  {
    name: 'SI from body content',
    input: {
      subject: 'Shipment details',
      senderEmail: 'export@shipper.com',
      bodyText: 'Please find attached the SI for booking BKG123456.',
    },
    expected: {
      documentType: 'si_draft',
      direction: 'inbound',
      workflowState: 'si_draft_received',
      source: 'body',
    },
  },
  {
    name: 'Customs cleared from body',
    input: {
      subject: 'Shipment status',
      senderEmail: 'customs@chapartner.in',
      bodyText: 'Good news - customs has been cleared and out of charge received.',
    },
    expected: {
      documentType: 'customs_clearance',
      direction: 'inbound',
      workflowState: 'cargo_released',
      source: 'body',
    },
  },
];

// ============================================================================
// TEST RUNNER
// ============================================================================

function runTests(testCases: TestCase[], category: string): {
  passed: number;
  failed: number;
  results: Array<{
    name: string;
    passed: boolean;
    expected: unknown;
    actual: unknown;
  }>;
} {
  let passed = 0;
  let failed = 0;
  const results: Array<{ name: string; passed: boolean; expected: unknown; actual: unknown }> = [];

  for (const tc of testCases) {
    const result = classifyDocument(tc.input);

    const matches =
      result.documentType === tc.expected.documentType &&
      result.direction === tc.expected.direction &&
      result.workflowState === tc.expected.workflowState &&
      result.source === tc.expected.source;

    if (matches) {
      passed++;
      results.push({ name: tc.name, passed: true, expected: tc.expected, actual: result });
    } else {
      failed++;
      results.push({
        name: tc.name,
        passed: false,
        expected: tc.expected,
        actual: {
          documentType: result.documentType,
          direction: result.direction,
          workflowState: result.workflowState,
          source: result.source,
        },
      });
    }
  }

  return { passed, failed, results };
}

// ============================================================================
// MAIN TEST EXECUTION
// ============================================================================

describe('Document Classifier - Comprehensive Tests', () => {
  describe('Carrier Emails (INBOUND)', () => {
    const { results } = runTests(CARRIER_TESTS, 'Carriers');

    test.each(results)('$name', ({ passed, expected, actual }) => {
      if (!passed) {
        console.log('Expected:', JSON.stringify(expected, null, 2));
        console.log('Actual:', JSON.stringify(actual, null, 2));
      }
      expect(passed).toBe(true);
    });
  });

  describe('India CHA Emails (INBOUND)', () => {
    const { results } = runTests(INDIA_CHA_TESTS, 'India CHA');

    test.each(results)('$name', ({ passed, expected, actual }) => {
      if (!passed) {
        console.log('Expected:', JSON.stringify(expected, null, 2));
        console.log('Actual:', JSON.stringify(actual, null, 2));
      }
      expect(passed).toBe(true);
    });
  });

  describe('US Customs Broker Emails (INBOUND)', () => {
    const { results } = runTests(US_BROKER_TESTS, 'US Broker');

    test.each(results)('$name', ({ passed, expected, actual }) => {
      if (!passed) {
        console.log('Expected:', JSON.stringify(expected, null, 2));
        console.log('Actual:', JSON.stringify(actual, null, 2));
      }
      expect(passed).toBe(true);
    });
  });

  describe('Trucker Emails (INBOUND)', () => {
    const { results } = runTests(TRUCKER_TESTS, 'Truckers');

    test.each(results)('$name', ({ passed, expected, actual }) => {
      if (!passed) {
        console.log('Expected:', JSON.stringify(expected, null, 2));
        console.log('Actual:', JSON.stringify(actual, null, 2));
      }
      expect(passed).toBe(true);
    });
  });

  describe('Client/Shipper Emails (INBOUND)', () => {
    const { results } = runTests(CLIENT_TESTS, 'Clients');

    test.each(results)('$name', ({ passed, expected, actual }) => {
      if (!passed) {
        console.log('Expected:', JSON.stringify(expected, null, 2));
        console.log('Actual:', JSON.stringify(actual, null, 2));
      }
      expect(passed).toBe(true);
    });
  });

  describe('Intoglo Outbound Emails', () => {
    const { results } = runTests(INTOGLO_OUTBOUND_TESTS, 'Intoglo');

    test.each(results)('$name', ({ passed, expected, actual }) => {
      if (!passed) {
        console.log('Expected:', JSON.stringify(expected, null, 2));
        console.log('Actual:', JSON.stringify(actual, null, 2));
      }
      expect(passed).toBe(true);
    });
  });

  describe('Attachment-Based Classification', () => {
    const { results } = runTests(ATTACHMENT_TESTS, 'Attachments');

    test.each(results)('$name', ({ passed, expected, actual }) => {
      if (!passed) {
        console.log('Expected:', JSON.stringify(expected, null, 2));
        console.log('Actual:', JSON.stringify(actual, null, 2));
      }
      expect(passed).toBe(true);
    });
  });

  describe('Body Content Classification', () => {
    const { results } = runTests(BODY_TESTS, 'Body');

    test.each(results)('$name', ({ passed, expected, actual }) => {
      if (!passed) {
        console.log('Expected:', JSON.stringify(expected, null, 2));
        console.log('Actual:', JSON.stringify(actual, null, 2));
      }
      expect(passed).toBe(true);
    });
  });
});

// ============================================================================
// SUMMARY REPORT
// ============================================================================

export function generateTestSummary(): void {
  console.log('\n========================================');
  console.log('DOCUMENT CLASSIFIER TEST SUMMARY');
  console.log('========================================\n');

  const categories = [
    { name: 'Carrier Emails (INBOUND)', tests: CARRIER_TESTS },
    { name: 'India CHA Emails (INBOUND)', tests: INDIA_CHA_TESTS },
    { name: 'US Customs Broker (INBOUND)', tests: US_BROKER_TESTS },
    { name: 'Trucker Emails (INBOUND)', tests: TRUCKER_TESTS },
    { name: 'Client/Shipper (INBOUND)', tests: CLIENT_TESTS },
    { name: 'Intoglo Outbound', tests: INTOGLO_OUTBOUND_TESTS },
    { name: 'Attachment-Based', tests: ATTACHMENT_TESTS },
    { name: 'Body Content', tests: BODY_TESTS },
  ];

  let totalPassed = 0;
  let totalFailed = 0;

  for (const { name, tests } of categories) {
    const { passed, failed, results } = runTests(tests, name);
    totalPassed += passed;
    totalFailed += failed;

    const status = failed === 0 ? '✅' : '❌';
    console.log(`${status} ${name}: ${passed}/${passed + failed} passed`);

    if (failed > 0) {
      for (const r of results) {
        if (!r.passed) {
          console.log(`   ❌ ${r.name}`);
          console.log(`      Expected: ${JSON.stringify(r.expected)}`);
          console.log(`      Actual:   ${JSON.stringify(r.actual)}`);
        }
      }
    }
  }

  console.log('\n----------------------------------------');
  console.log(`TOTAL: ${totalPassed}/${totalPassed + totalFailed} tests passed`);
  console.log('========================================\n');
}

// Run summary when file is executed directly
if (require.main === module) {
  generateTestSummary();
}
