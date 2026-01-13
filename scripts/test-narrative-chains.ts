/**
 * Test script to run NarrativeChainService on a few shipments
 * and display the generated chains.
 *
 * Run with: npx tsx scripts/test-narrative-chains.ts
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { createClient } from '@supabase/supabase-js';
import { NarrativeChainService } from '../lib/chronicle-v2/services/narrative-chain-service.js';

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const chainService = new NarrativeChainService(supabase);

  // Test shipment IDs (from query)
  const testShipmentIds = [
    'dd63951e-9bac-4598-847d-248156987470',
    '367d83e9-db72-4c1d-b964-b1b2bdd01471',
    'fae48196-78c2-4de9-908b-a7c284199885',
  ];

  console.log('='.repeat(80));
  console.log('TESTING NARRATIVE CHAIN DETECTION');
  console.log('='.repeat(80));
  console.log('');

  for (const shipmentId of testShipmentIds) {
    // Get shipment info
    const { data: shipment } = await supabase
      .from('shipments')
      .select('booking_number, mbl_number, shipper_name, consignee_name')
      .eq('id', shipmentId)
      .single();

    console.log('-'.repeat(80));
    console.log(`SHIPMENT: ${shipment?.booking_number || shipment?.mbl_number || shipmentId}`);
    console.log(`  Shipper: ${shipment?.shipper_name || 'N/A'}`);
    console.log(`  Consignee: ${shipment?.consignee_name || 'N/A'}`);
    console.log('-'.repeat(80));

    // Detect chains (this is the rule-based analysis)
    const chains = await chainService.detectChainsForShipment(shipmentId);

    if (chains.length === 0) {
      console.log('  No chains detected for this shipment.');
      console.log('');
      continue;
    }

    for (const chain of chains) {
      console.log('');
      console.log(`  CHAIN: ${chain.chainType.toUpperCase()}`);
      console.log(`  Headline: ${chain.narrativeHeadline}`);
      console.log(`  Summary: ${chain.narrativeSummary}`);
      console.log(`  Status: ${chain.chainStatus}`);
      console.log(`  Current State: ${chain.currentState}`);
      console.log(`  Current Party: ${chain.currentStateParty || 'N/A'}`);
      console.log(`  Days in State: ${chain.daysInCurrentState}`);
      console.log(`  Confidence: ${chain.confidenceScore}%`);
      if (chain.impact.delayDays) {
        console.log(`  Delay Impact: ${chain.impact.delayDays} days`);
      }
      if (chain.resolution.deadline) {
        console.log(`  Resolution Deadline: ${chain.resolution.deadline}`);
      }
    }
    console.log('');
  }

  console.log('='.repeat(80));
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));
}

main().catch(console.error);
