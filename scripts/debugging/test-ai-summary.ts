/**
 * Test AI Summary Generation
 * Tests cross-shipment profiles impact on output quality
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import { HaikuSummaryService } from '../lib/chronicle-v2';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Test shipment ID - Hapag-Lloyd with real chassis issue
const TEST_SHIPMENT_ID = '1cfb2a63-e53b-472f-b030-c81c02189ada';

async function main() {
  console.log('═'.repeat(70));
  console.log('TESTING CROSS-SHIPMENT PROFILES IMPACT');
  console.log('═'.repeat(70));

  // Get shipment details
  const { data: shipment } = await supabase
    .from('shipments')
    .select('booking_number, shipper_name, consignee_name, carrier_name, port_of_loading_code, port_of_discharge_code')
    .eq('id', TEST_SHIPMENT_ID)
    .single();

  console.log('\n📦 SHIPMENT CONTEXT:');
  console.log(`   Booking: ${shipment?.booking_number}`);
  console.log(`   Shipper: ${shipment?.shipper_name}`);
  console.log(`   Consignee: ${shipment?.consignee_name}`);
  console.log(`   Carrier: ${shipment?.carrier_name}`);
  console.log(`   Route: ${shipment?.port_of_loading_code} → ${shipment?.port_of_discharge_code}`);

  // Check what profiles exist
  console.log('\n' + '─'.repeat(70));
  console.log('🔍 CHECKING CROSS-SHIPMENT PROFILES:');
  console.log('─'.repeat(70));

  // Shipper profile
  if (shipment?.shipper_name) {
    const searchWord = shipment.shipper_name.toLowerCase().split(' ').filter((w: string) => w.length > 2)[0];
    const { data: shipperProfile } = await supabase
      .from('shipper_profiles')
      .select('*')
      .ilike('shipper_name_normalized', `%${searchWord}%`)
      .order('total_shipments', { ascending: false })
      .limit(1);

    if (shipperProfile?.[0]) {
      const p = shipperProfile[0];
      console.log(`\n✅ SHIPPER PROFILE FOUND: ${p.shipper_name}`);
      console.log(`   Total Shipments: ${p.total_shipments}`);
      console.log(`   SI Late Rate: ${p.si_late_rate ? parseFloat(p.si_late_rate).toFixed(1) + '%' : 'N/A'}`);
      console.log(`   Avg SI Days Before Cutoff: ${p.avg_si_days_before_cutoff ? parseFloat(p.avg_si_days_before_cutoff).toFixed(1) : 'N/A'}`);
      console.log(`   Doc Issue Rate: ${p.doc_issue_rate ? parseFloat(p.doc_issue_rate).toFixed(1) + '%' : 'N/A'}`);
      console.log(`   Risk Score: ${p.risk_score || 'N/A'}`);
      console.log(`   Risk Factors: ${p.risk_factors?.join(', ') || 'None'}`);
    } else {
      console.log(`\n❌ NO SHIPPER PROFILE for: ${shipment.shipper_name}`);
    }
  }

  // Consignee profile
  if (shipment?.consignee_name) {
    const searchWord = shipment.consignee_name.toLowerCase().split(' ').filter((w: string) => w.length > 2)[0];
    const { data: consigneeProfile } = await supabase
      .from('consignee_profiles')
      .select('*')
      .ilike('consignee_name_normalized', `%${searchWord}%`)
      .order('total_shipments', { ascending: false })
      .limit(1);

    if (consigneeProfile?.[0]) {
      const p = consigneeProfile[0];
      console.log(`\n✅ CONSIGNEE PROFILE FOUND: ${p.consignee_name}`);
      console.log(`   Total Shipments: ${p.total_shipments}`);
      console.log(`   Detention Rate: ${p.detention_rate ? parseFloat(p.detention_rate).toFixed(1) + '%' : 'N/A'}`);
      console.log(`   Demurrage Rate: ${p.demurrage_rate ? parseFloat(p.demurrage_rate).toFixed(1) + '%' : 'N/A'}`);
      console.log(`   Customs Issue Rate: ${p.customs_issue_rate ? parseFloat(p.customs_issue_rate).toFixed(1) + '%' : 'N/A'}`);
      console.log(`   Risk Score: ${p.risk_score || 'N/A'}`);
    } else {
      console.log(`\n❌ NO CONSIGNEE PROFILE for: ${shipment.consignee_name}`);
    }
  }

  // Carrier profile
  if (shipment?.carrier_name) {
    const searchWord = shipment.carrier_name.toLowerCase().split(' ').filter((w: string) => w.length > 2)[0];
    const { data: carrierProfile } = await supabase
      .from('carrier_profiles')
      .select('*')
      .ilike('carrier_name_normalized', `%${searchWord}%`)
      .order('total_shipments', { ascending: false })
      .limit(1);

    if (carrierProfile?.[0]) {
      const p = carrierProfile[0];
      console.log(`\n✅ CARRIER PROFILE FOUND: ${p.carrier_name}`);
      console.log(`   Total Shipments: ${p.total_shipments}`);
      console.log(`   On-Time Departure: ${p.on_time_departure_rate ? parseFloat(p.on_time_departure_rate).toFixed(1) + '%' : 'N/A'}`);
      console.log(`   On-Time Arrival: ${p.on_time_arrival_rate ? parseFloat(p.on_time_arrival_rate).toFixed(1) + '%' : 'N/A'}`);
      console.log(`   Rollover Rate: ${p.rollover_rate ? parseFloat(p.rollover_rate).toFixed(1) + '%' : 'N/A'}`);
      console.log(`   Performance Score: ${p.performance_score || 'N/A'}`);
    } else {
      console.log(`\n❌ NO CARRIER PROFILE for: ${shipment.carrier_name}`);
    }
  }

  // Route profile
  if (shipment?.port_of_loading_code && shipment?.port_of_discharge_code) {
    const { data: routeProfile } = await supabase
      .from('route_profiles')
      .select('*')
      .eq('pol_code', shipment.port_of_loading_code)
      .eq('pod_code', shipment.port_of_discharge_code)
      .single();

    if (routeProfile) {
      console.log(`\n✅ ROUTE PROFILE FOUND: ${routeProfile.pol_code} → ${routeProfile.pod_code}`);
      console.log(`   Total Shipments: ${routeProfile.total_shipments}`);
      console.log(`   Scheduled Transit: ${routeProfile.scheduled_transit_days || 'N/A'} days`);
      console.log(`   Actual Avg Transit: ${routeProfile.actual_avg_transit_days ? parseFloat(routeProfile.actual_avg_transit_days).toFixed(1) : 'N/A'} days`);
      console.log(`   Transit Variance: ${routeProfile.transit_variance_days ? parseFloat(routeProfile.transit_variance_days).toFixed(1) : 'N/A'} days`);
      console.log(`   On-Time Rate: ${routeProfile.on_time_rate ? parseFloat(routeProfile.on_time_rate).toFixed(1) + '%' : 'N/A'}`);
      console.log(`   Best Carrier: ${routeProfile.best_carrier || 'N/A'}`);
    } else {
      console.log(`\n❌ NO ROUTE PROFILE for: ${shipment.port_of_loading_code} → ${shipment.port_of_discharge_code}`);
    }
  }

  // Now run the AI summary
  console.log('\n' + '═'.repeat(70));
  console.log('🚀 GENERATING AI SUMMARY...');
  console.log('═'.repeat(70));

  const service = new HaikuSummaryService(supabase);
  const startTime = Date.now();

  try {
    const result = await service.processShipment(TEST_SHIPMENT_ID);

    if (result) {
      const durationMs = Date.now() - startTime;

      console.log('\n📝 GENERATED SUMMARY:');
      console.log('─'.repeat(70));
      console.log(`\n${result.summary.story}\n`);
      console.log('─'.repeat(70));
      console.log(`Blocker: ${result.summary.currentBlocker || 'None'}`);
      console.log(`Blocker Owner: ${result.summary.blockerOwner || 'N/A'}`);
      console.log(`Next Action: ${result.summary.nextAction || 'None'}`);
      console.log(`Action Owner: ${result.summary.actionOwner || 'N/A'}`);
      console.log(`Priority: ${result.summary.actionPriority || 'N/A'}`);
      console.log(`Risk: ${result.summary.riskLevel?.toUpperCase()} - ${result.summary.riskReason || 'N/A'}`);
      console.log(`Financial: ${result.summary.financialImpact || 'None'}`);
      console.log(`Customer: ${result.summary.customerImpact || 'None'}`);

      console.log('\n📈 STATS:');
      console.log(`   Tokens: ${result.inputTokens} in / ${result.outputTokens} out`);
      console.log(`   Cost: $${result.cost.toFixed(4)}`);
      console.log(`   Time: ${durationMs}ms`);

      // Check if profile intelligence appears in ANY output field
      console.log('\n🔎 PROFILE INTELLIGENCE IN OUTPUT:');
      const allText = [
        result.summary.story,
        result.summary.riskReason,
        result.summary.currentBlocker,
        result.summary.nextAction,
        result.summary.financialImpact,
        result.summary.customerImpact
      ].filter(Boolean).join(' ').toLowerCase();

      const checks = [
        { label: 'Shipper SI late rate (47%)', found: allText.includes('47%') || allText.includes('late') || allText.includes('si late') },
        { label: 'Consignee detention (6%)', found: allText.includes('detention') || allText.includes('6%') },
        { label: 'Carrier rollover (1%)', found: allText.includes('rollover') || allText.includes('maersk') && allText.includes('reliable') },
        { label: 'Cross-shipment context', found: allText.includes('shipment') || allText.includes('history') || allText.includes('pattern') },
      ];
      for (const check of checks) {
        console.log(`   ${check.found ? '✅' : '❌'} ${check.label}`);
      }
    } else {
      console.log('❌ No result returned');
    }
  } catch (error) {
    console.error('❌ ERROR:', error);
  }

  console.log('\n' + '═'.repeat(70));
}

main().catch(console.error);
