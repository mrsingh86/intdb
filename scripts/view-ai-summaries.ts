/**
 * View AI Summaries for Verification
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const { data, error } = await supabase
    .from('shipment_ai_summaries')
    .select(`
      shipment_id,
      risk_level,
      risk_reason,
      story,
      intelligence_warnings,
      current_blocker,
      blocker_owner,
      next_action,
      action_owner,
      action_priority,
      financial_impact,
      customer_impact,
      updated_at,
      shipments!inner (
        booking_number,
        mbl_number,
        shipper_name,
        consignee_name,
        carrier_name,
        vessel_name,
        port_of_loading,
        port_of_loading_code,
        port_of_discharge,
        port_of_discharge_code,
        etd,
        eta,
        stage,
        status
      )
    `)
    .order('updated_at', { ascending: false })
    .limit(15);

  if (error) {
    console.error('Error:', error);
    return;
  }

  // Show all summaries
  const valid = data || [];

  // Sort by risk level for display
  const sorted = valid.sort((a, b) => {
    const order = { red: 0, amber: 1, green: 2 };
    return (order[a.risk_level as keyof typeof order] || 3) - (order[b.risk_level as keyof typeof order] || 3);
  });

  for (const row of sorted) {
    const s = row.shipments as any;
    const riskIcon = row.risk_level === 'red' ? '🔴 RED' : row.risk_level === 'amber' ? '🟡 AMBER' : '🟢 GREEN';

    console.log('═'.repeat(80));
    console.log(`BOOKING: ${s.booking_number}`);
    console.log('═'.repeat(80));
    console.log(`Shipper:    ${s.shipper_name || 'N/A'}`);
    console.log(`Consignee:  ${s.consignee_name || 'N/A'}`);
    console.log(`Carrier:    ${s.carrier_name || 'N/A'}`);
    console.log(`Vessel:     ${s.vessel_name || 'N/A'}`);
    console.log(`Route:      ${s.port_of_loading || s.port_of_loading_code || '?'} → ${s.port_of_discharge || s.port_of_discharge_code || '?'}`);
    console.log(`ETD:        ${s.etd || 'N/A'}`);
    console.log(`ETA:        ${s.eta || 'N/A'}`);
    console.log(`Stage:      ${s.stage || 'N/A'}`);
    console.log('─'.repeat(80));
    console.log(`RISK:       ${riskIcon}`);
    console.log(`REASON:     ${row.risk_reason}`);
    console.log('─'.repeat(80));
    console.log('STORY:');
    console.log(row.story);
    const warnings = row.intelligence_warnings as string[] | null;
    if (warnings && warnings.length > 0) {
      console.log('─'.repeat(80));
      console.log('INTELLIGENCE WARNINGS:');
      warnings.forEach(w => console.log(`  • ${w}`));
    }
    console.log('─'.repeat(80));
    if (row.current_blocker) {
      console.log(`BLOCKER:       ${row.current_blocker}`);
      console.log(`BLOCKER OWNER: ${row.blocker_owner}`);
      console.log('─'.repeat(80));
    }
    console.log(`NEXT ACTION:   ${row.next_action}`);
    console.log(`ACTION OWNER:  ${row.action_owner}`);
    console.log(`PRIORITY:      ${row.action_priority}`);
    if (row.financial_impact) console.log(`FINANCIAL:     ${row.financial_impact}`);
    if (row.customer_impact) console.log(`CUSTOMER:      ${row.customer_impact}`);
    console.log('\n');
  }

  console.log(`Total valid summaries: ${sorted.length}`);
}

main().catch(console.error);
