/**
 * Show examples of L1, L2, L3 escalation levels
 * Run: npx tsx scripts/debugging/show-escalation-examples.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Import the intelligence service
import { ShipmentIntelligenceService } from '../../lib/chronicle-v2/services/shipment-intelligence-service';

async function getExamplesForLevel(level: string, count: number = 5) {
  console.log('\n' + '='.repeat(80));
  console.log(`ESCALATION LEVEL: ${level}`);
  console.log('='.repeat(80));

  const service = new ShipmentIntelligenceService(supabase);

  // Query the intelligence view for this escalation level
  const { data: shipments, error } = await supabase
    .from('v_shipment_intelligence')
    .select('*')
    .eq('escalation_level', level)
    .order('priority_score', { ascending: false })
    .limit(count);

  if (error) {
    console.log('Error:', error.message);
    return;
  }

  if (!shipments || shipments.length === 0) {
    console.log(`No ${level} escalations found`);
    return;
  }

  console.log(`Found ${shipments.length} examples\n`);

  for (let i = 0; i < shipments.length; i++) {
    const intel = shipments[i];

    console.log('-'.repeat(80));
    console.log(`Example ${i + 1}: ${intel.intoglo_reference || intel.shipment_id.slice(0, 8)}`);
    console.log('-'.repeat(80));

    // Basic info
    console.log('\n📦 SHIPMENT INFO:');
    console.log(`   Reference: ${intel.intoglo_reference || 'N/A'}`);
    console.log(`   Stage: ${intel.stage || 'N/A'}`);
    console.log(`   Shipper: ${intel.shipper_name || 'N/A'}`);
    console.log(`   Carrier: ${intel.carrier_name || 'N/A'}`);

    // SLA Status
    console.log('\n⏱️ SLA STATUS:');
    console.log(`   Status: ${intel.sla_status || 'N/A'}`);
    console.log(`   Hours Since Customer Update: ${intel.hours_since_customer_update ?? 'N/A'}`);
    console.log(`   Hours Awaiting Response: ${intel.hours_awaiting_response ?? 'N/A'}`);
    console.log(`   Response Pending: ${intel.response_pending ? 'YES' : 'No'}`);
    console.log(`   Unanswered Customer Emails: ${intel.unanswered_customer_emails || 0}`);

    // Escalation details
    console.log('\n🚨 ESCALATION:');
    console.log(`   Level: ${intel.escalation_level}`);
    console.log(`   Escalate To: ${intel.escalate_to || 'N/A'}`);
    console.log(`   Reason: ${intel.escalation_reason || 'N/A'}`);
    console.log(`   Days Overdue: ${intel.days_overdue ?? 'N/A'}`);
    console.log(`   Estimated Exposure: $${(intel.estimated_exposure_usd || 0).toLocaleString()}`);
    console.log(`   Priority Score: ${intel.priority_score || 0}`);

    // Blocker
    console.log('\n🔴 BLOCKER:');
    console.log(`   Current Blocker: ${intel.current_blocker || 'None'}`);
    console.log(`   Blocker Owner: ${intel.blocker_owner || 'N/A'}`);
    console.log(`   Risk Level: ${intel.risk_level || 'N/A'}`);

    // Get root cause match
    if (intel.current_blocker) {
      const rootCause = await service.matchRootCause(intel.current_blocker);
      if (rootCause) {
        console.log('\n🔍 ROOT CAUSE:');
        console.log(`   Category: ${rootCause.category}`);
        console.log(`   Subcategory: ${rootCause.subcategory}`);
        console.log(`   Typical Resolution: ${rootCause.typicalResolutionDays ?? 'Unknown'} days`);
        console.log(`   Resolution Owner: ${rootCause.resolutionOwner}`);
        console.log(`   Requires Customer Action: ${rootCause.requiresCustomerAction ? 'YES' : 'No'}`);
        console.log(`   Match Confidence: ${rootCause.matchConfidence}`);
      }
    }

    // Issue/urgency counts
    console.log('\n📊 METRICS:');
    console.log(`   Escalation Count: ${intel.escalation_count || 0}`);
    console.log(`   Issue Count: ${intel.issue_count || 0}`);
    console.log(`   Urgent Message Count: ${intel.urgent_message_count || 0}`);

    console.log('');
  }
}

async function main() {
  console.log('========================================');
  console.log('ESCALATION LEVEL EXAMPLES (L1, L2, L3)');
  console.log('========================================');

  // Get summary counts first
  const { data: counts } = await supabase
    .from('v_shipment_intelligence')
    .select('escalation_level');

  if (counts) {
    const levelCounts: Record<string, number> = { L1: 0, L2: 0, L3: 0 };
    for (const c of counts) {
      if (c.escalation_level) {
        levelCounts[c.escalation_level] = (levelCounts[c.escalation_level] || 0) + 1;
      }
    }
    console.log('\nDistribution:');
    console.log(`  L1 (Normal): ${levelCounts.L1 || 0} shipments`);
    console.log(`  L2 (Elevated): ${levelCounts.L2 || 0} shipments`);
    console.log(`  L3 (Critical): ${levelCounts.L3 || 0} shipments`);
  }

  // Get examples for each level
  await getExamplesForLevel('L1', 3);
  await getExamplesForLevel('L2', 3);
  await getExamplesForLevel('L3', 5);

  console.log('\n✅ Done!');
}

main().catch(console.error);
