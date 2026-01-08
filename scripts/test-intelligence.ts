#!/usr/bin/env npx tsx
/**
 * Test script for intelligence services
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import {
  createEmailIntelligenceService,
  createShipmentIntelligenceService,
} from '../lib/services/intelligence';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function testEnhancedExtraction() {
  console.log('=== Testing Enhanced Entity-Aware Extraction ===\n');

  // Find emails that have entity extractions (booking numbers)
  const { data: emailsWithEntities } = await supabase
    .from('email_extractions')
    .select('email_id')
    .eq('entity_type', 'booking_number')
    .limit(5);

  if (!emailsWithEntities || emailsWithEntities.length === 0) {
    console.log('No emails with booking numbers found');
    return;
  }

  console.log('Testing on', emailsWithEntities.length, 'emails with booking numbers\n');

  const service = createEmailIntelligenceService(supabase);

  for (const row of emailsWithEntities) {
    console.log('Processing:', row.email_id.substring(0, 8));

    const result = await service.extractIntelligence(row.email_id, { forceReprocess: true });

    if (result) {
      console.log('  Booking:', result.primary_booking_number || 'N/A');
      console.log('  Sentiment:', result.sentiment);
      console.log('  Urgency:', result.urgency);
      console.log('  Summary:', result.one_line_summary?.substring(0, 80) || 'N/A');
      console.log('  Action:', result.action_summary?.substring(0, 60) || 'None');
      console.log('');
    }
  }

  // Show sample from database
  const { data: sample } = await supabase
    .from('email_intelligence')
    .select('email_id, primary_booking_number, one_line_summary, action_summary')
    .not('primary_booking_number', 'is', null)
    .limit(3);

  console.log('=== Sample from DB with Booking Numbers ===');
  for (const s of sample || []) {
    console.log('Email:', s.email_id.substring(0, 8));
    console.log('  Booking:', s.primary_booking_number);
    console.log('  Summary:', s.one_line_summary?.substring(0, 100) || 'N/A');
    console.log('  Action:', s.action_summary?.substring(0, 80) || 'None');
    console.log('');
  }
}

async function testWithShipments() {
  console.log('=== Testing with Shipment Links ===\n');

  // Get emails linked to shipments
  const { data: linkedEmails } = await supabase
    .from('shipment_documents')
    .select('email_id, shipment_id')
    .not('email_id', 'is', null)
    .limit(5);

  if (!linkedEmails || linkedEmails.length === 0) {
    console.log('No linked emails found');
    return;
  }

  console.log('Processing', linkedEmails.length, 'emails with shipment links...\n');

  const emailService = createEmailIntelligenceService(supabase);
  const shipmentService = createShipmentIntelligenceService(supabase);

  const shipmentIds = new Set<string>();

  for (const link of linkedEmails) {
    try {
      const result = await emailService.extractIntelligence(link.email_id, { forceReprocess: true });
      if (result) {
        // Update shipment_id
        await supabase
          .from('email_intelligence')
          .update({ shipment_id: link.shipment_id })
          .eq('email_id', link.email_id);

        shipmentIds.add(link.shipment_id);
        console.log('Email:', link.email_id.substring(0, 8),
          '| Booking:', result.primary_booking_number || 'N/A',
          '| Sentiment:', result.sentiment);
      }
    } catch (err) {
      console.error('Error:', link.email_id, err);
    }
  }

  // Aggregate shipments
  console.log('\n=== Aggregating Shipment Intelligence ===\n');

  for (const shipmentId of shipmentIds) {
    const intel = await shipmentService.updateShipmentIntelligence(shipmentId);
    if (intel) {
      console.log('Shipment:', shipmentId.substring(0, 8));
      console.log('  Status:', intel.status_summary?.substring(0, 60) || 'N/A');
      console.log('  Needs attention:', intel.needs_attention);
      console.log('');
    }
  }
}

// Run based on args
const args = process.argv.slice(2);
if (args.includes('--shipments')) {
  testWithShipments().catch(console.error);
} else {
  testEnhancedExtraction().catch(console.error);
}
