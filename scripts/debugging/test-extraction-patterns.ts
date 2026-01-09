/**
 * Test script to verify PDF extraction patterns work correctly
 *
 * Tests the new valuePatterns and validate functions in BOOKING_CONFIRMATION_SCHEMA
 */

import { BOOKING_CONFIRMATION_SCHEMA } from '../../lib/services/extraction/document-extraction-schemas';
import { DocumentTypeExtractor } from '../../lib/services/extraction/document-type-extractor';

// Sample booking confirmation text from actual PDF
const SAMPLE_BOOKING_TEXT = `
BOOKING AMENDMENT
2026-01-09 11:25 UTC
Booking No.: 263814897
Print Date:
Booked by Party: INTOGLO PRIVATE LIMITED.
Service Mode: CY/CY
TEAM CONTACT
From: Gurgaon,HARYANA,India
Contact Name:
Booked by Ref. No:To: Toronto,Ontario,Canada
Customer Cargo:
Service Contract: 299973976
Price Owner:
Business Unit: Maersk India (New Delhi)
INTOGLO PRIVATE LIMITED.
Commodity Description:
Named Account Customer:
Autoparts, car parts, vehicle parts, motorcycle
Allocation week: AllocationWeek-2026/4-VesselName-CORNELIA MAERSK-546
Block space plus

VESSEL: CORNELIA MAERSK
VOYAGE: 546
POL: INMUN (Mundra)
POD: CATOR (Toronto)
ETD: 25-JAN-2026
ETA: 15-FEB-2026

Container Type: 20GP
Quantity: 1
Weight: 15000 KG

CUTOFF DATES:
VGM Cut-off: 20-JAN-2026 18:00
SI Cut-off: 21-JAN-2026 12:00
Cargo Cut-off: 22-JAN-2026 06:00

Terms and Conditions apply. This booking is subject to the carrier's tariff and terms.
For any policy related matters concerning your shipment involving sanctions...
`;

// Garbage text that should NOT be extracted
const GARBAGE_TEXT = `
The vessel name and voyage details can be found in the latest booking confirmation.
ETD: ) of the first vessel in the latest booking confirmation
Port of Loading: policy sanctions involving carrier shipment
SI Cutoff: /CY
VGM: NGAPORE terminal
`;

async function testExtraction() {
  console.log('=== Testing BOOKING_CONFIRMATION_SCHEMA Extraction ===\n');

  const extractor = new DocumentTypeExtractor();

  // Test with good data
  console.log('--- Testing with VALID booking data ---');
  const result = extractor.extract('booking_confirmation', SAMPLE_BOOKING_TEXT);

  if (result) {
    console.log('\nExtracted fields:');
    for (const [key, val] of Object.entries(result.fields)) {
      console.log(`  ${key}: "${val.value}" (confidence: ${val.confidence})`);
    }
    console.log(`\nOverall confidence: ${result.confidence}`);
  } else {
    console.log('ERROR: No extraction result');
  }

  // Test with garbage data (should NOT extract)
  console.log('\n--- Testing with GARBAGE data (should reject) ---');
  const garbageResult = extractor.extract('booking_confirmation', GARBAGE_TEXT);

  if (garbageResult) {
    console.log('\nExtracted fields (should be empty or minimal):');
    for (const [key, val] of Object.entries(garbageResult.fields)) {
      console.log(`  ${key}: "${val.value}" (confidence: ${val.confidence})`);
    }

    if (Object.keys(garbageResult.fields).length === 0) {
      console.log('  ✅ SUCCESS: No garbage values extracted!');
    } else {
      console.log('  ⚠️ WARNING: Some values extracted from garbage text');
    }
  }

  // Test individual pattern validations
  console.log('\n--- Testing validate functions ---');

  const vesselField = BOOKING_CONFIRMATION_SCHEMA.fields.find(f => f.name === 'vessel_name');
  const etdField = BOOKING_CONFIRMATION_SCHEMA.fields.find(f => f.name === 'etd');
  const polField = BOOKING_CONFIRMATION_SCHEMA.fields.find(f => f.name === 'port_of_loading');

  // Test vessel validation
  if (vesselField?.validate) {
    const vesselTests = [
      { value: 'CORNELIA MAERSK', expected: true },
      { value: 'CMA CGM VERDI', expected: true },
      { value: 'Voyage 546', expected: false },
      { value: 'Load Discharge', expected: false },
      { value: 'OCEAN BILL', expected: false },
    ];

    console.log('Vessel name validation:');
    for (const test of vesselTests) {
      const result = vesselField.validate(test.value);
      const status = result === test.expected ? '✅' : '❌';
      console.log(`  ${status} "${test.value}" -> ${result} (expected ${test.expected})`);
    }
  }

  // Test ETD validation
  if (etdField?.validate) {
    const etdTests = [
      { value: '25-JAN-2026', expected: true },
      { value: '2026-01-25', expected: true },
      { value: '15/01/2026', expected: true },
      { value: ') of the first vessel', expected: false },
      { value: 'policy sanctions', expected: false },
    ];

    console.log('\nETD validation:');
    for (const test of etdTests) {
      const result = etdField.validate(test.value);
      const status = result === test.expected ? '✅' : '❌';
      console.log(`  ${status} "${test.value}" -> ${result} (expected ${test.expected})`);
    }
  }

  // Test POL validation
  if (polField?.validate) {
    const polTests = [
      { value: 'INMUN', expected: true },
      { value: 'NHAVA SHEVA', expected: true },
      { value: 'policy sanctions involving', expected: false },
      { value: 'carrier booking', expected: false },
    ];

    console.log('\nPort of Loading validation:');
    for (const test of polTests) {
      const result = polField.validate(test.value);
      const status = result === test.expected ? '✅' : '❌';
      console.log(`  ${status} "${test.value}" -> ${result} (expected ${test.expected})`);
    }
  }

  console.log('\n=== Test Complete ===');
}

testExtraction().catch(console.error);
