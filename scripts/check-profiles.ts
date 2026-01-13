import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  // Check shipper profiles
  const { data: shippers } = await supabase
    .from('shipper_profiles')
    .select('shipper_name, total_shipments, si_late_rate, risk_score')
    .order('total_shipments', { ascending: false })
    .limit(5);
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('SHIPPER PROFILES (Cross-shipment behavior):');
  console.log('═══════════════════════════════════════════════════════════════');
  for (const s of shippers || []) {
    console.log(`${s.shipper_name}`);
    console.log(`  Shipments: ${s.total_shipments} | SI Late Rate: ${s.si_late_rate}% | Risk Score: ${s.risk_score}/100`);
  }

  // Check consignee profiles
  const { data: consignees } = await supabase
    .from('consignee_profiles')
    .select('consignee_name, total_shipments, detention_rate, demurrage_rate, risk_score')
    .order('total_shipments', { ascending: false })
    .limit(5);
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('CONSIGNEE PROFILES (Destination behavior):');
  console.log('═══════════════════════════════════════════════════════════════');
  for (const c of consignees || []) {
    console.log(`${c.consignee_name}`);
    console.log(`  Shipments: ${c.total_shipments} | Detention: ${c.detention_rate}% | Demurrage: ${c.demurrage_rate}% | Risk: ${c.risk_score}/100`);
  }

  // Check carrier profiles
  const { data: carriers } = await supabase
    .from('carrier_profiles')
    .select('carrier_name, total_shipments, on_time_departure_rate, rollover_rate, performance_score')
    .order('total_shipments', { ascending: false })
    .limit(5);
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('CARRIER PROFILES (Shipping line performance):');
  console.log('═══════════════════════════════════════════════════════════════');
  for (const c of carriers || []) {
    console.log(`${c.carrier_name}`);
    console.log(`  Shipments: ${c.total_shipments} | On-Time: ${c.on_time_departure_rate}% | Rollover: ${c.rollover_rate}% | Score: ${c.performance_score}/100`);
  }

  // Check route profiles
  const { data: routes } = await supabase
    .from('route_profiles')
    .select('pol_code, pod_code, total_shipments, on_time_rate, transit_variance_days')
    .order('total_shipments', { ascending: false })
    .limit(5);
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('ROUTE PROFILES (Lane intelligence):');
  console.log('═══════════════════════════════════════════════════════════════');
  if (routes && routes.length > 0) {
    for (const r of routes) {
      console.log(`${r.pol_code} → ${r.pod_code}`);
      console.log(`  Shipments: ${r.total_shipments} | On-Time: ${r.on_time_rate}% | Transit Variance: ${r.transit_variance_days} days`);
    }
  } else {
    console.log('No route profiles computed (port codes may not be populated)');
  }

  // Summary
  const { count: shipperCount } = await supabase.from('shipper_profiles').select('*', { count: 'exact', head: true });
  const { count: consigneeCount } = await supabase.from('consignee_profiles').select('*', { count: 'exact', head: true });
  const { count: carrierCount } = await supabase.from('carrier_profiles').select('*', { count: 'exact', head: true });
  const { count: routeCount } = await supabase.from('route_profiles').select('*', { count: 'exact', head: true });

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('PROFILE SUMMARY:');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Shippers:   ${shipperCount} profiles`);
  console.log(`Consignees: ${consigneeCount} profiles`);
  console.log(`Carriers:   ${carrierCount} profiles`);
  console.log(`Routes:     ${routeCount} profiles`);
}

main().catch(console.error);
