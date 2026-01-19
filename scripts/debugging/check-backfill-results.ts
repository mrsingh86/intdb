/**
 * Check Backfill Results
 * Verifies stakeholder data was stored properly
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function check() {
  console.log('=== CHECKING BACKFILL RESULTS ===\n');

  // 1. Check entity_extractions for backfill entries
  const { data: entities, count: entityCount } = await supabase
    .from('entity_extractions')
    .select('entity_type, entity_value, extraction_method, created_at', { count: 'exact' })
    .eq('extraction_method', 'ai_backfill')
    .order('created_at', { ascending: false })
    .limit(100);

  console.log(`1. ENTITY_EXTRACTIONS (ai_backfill): ${entityCount || 0} records\n`);

  if (entities && entities.length > 0) {
    // Group by entity_type
    const byType: Record<string, number> = {};
    entities.forEach(e => {
      byType[e.entity_type] = (byType[e.entity_type] || 0) + 1;
    });
    console.log('   By type (from sample):');
    Object.entries(byType).forEach(([type, count]) => {
      console.log(`     ${type}: ${count}`);
    });
    console.log('\n   Sample values:');
    entities.slice(0, 15).forEach(e => {
      const val = e.entity_value?.substring(0, 45) || '';
      console.log(`     ${e.entity_type.padEnd(20)} ${val}`);
    });
  } else {
    console.log('   ❌ NO ai_backfill entities found!');
  }

  // 2. Check shipments with stakeholder names (recently updated)
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: recentShipments } = await supabase
    .from('shipments')
    .select('id, booking_number, shipper_name, consignee_name, notify_party_name, updated_at')
    .gte('updated_at', oneHourAgo)
    .not('shipper_name', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(20);

  console.log(`\n2. SHIPMENTS updated in last hour with stakeholders: ${recentShipments?.length || 0}\n`);

  if (recentShipments && recentShipments.length > 0) {
    console.log('   Recent updates:');
    recentShipments.slice(0, 10).forEach(s => {
      const shipper = s.shipper_name?.substring(0, 25) || '(none)';
      const consignee = s.consignee_name?.substring(0, 25) || '(none)';
      console.log(`     ${(s.booking_number || s.id.substring(0,8)).padEnd(15)} ${shipper.padEnd(27)} → ${consignee}`);
    });
  }

  // 3. Overall counts
  const { count: shipperCount } = await supabase
    .from('shipments')
    .select('id', { count: 'exact', head: true })
    .not('shipper_name', 'is', null);

  const { count: consigneeCount } = await supabase
    .from('shipments')
    .select('id', { count: 'exact', head: true })
    .not('consignee_name', 'is', null);

  const { count: notifyCount } = await supabase
    .from('shipments')
    .select('id', { count: 'exact', head: true })
    .not('notify_party_name', 'is', null);

  const { count: totalShipments } = await supabase
    .from('shipments')
    .select('id', { count: 'exact', head: true });

  console.log('\n3. OVERALL SHIPMENT STAKEHOLDER COVERAGE:');
  console.log(`   Total shipments:        ${totalShipments}`);
  console.log(`   With shipper_name:      ${shipperCount} (${((shipperCount || 0) / (totalShipments || 1) * 100).toFixed(1)}%)`);
  console.log(`   With consignee_name:    ${consigneeCount} (${((consigneeCount || 0) / (totalShipments || 1) * 100).toFixed(1)}%)`);
  console.log(`   With notify_party_name: ${notifyCount} (${((notifyCount || 0) / (totalShipments || 1) * 100).toFixed(1)}%)`);

  // 4. Check backfill task status
  console.log('\n4. BACKFILL STATUS:');
  const { count: backfillShipperEntities } = await supabase
    .from('entity_extractions')
    .select('id', { count: 'exact', head: true })
    .eq('extraction_method', 'ai_backfill')
    .eq('entity_type', 'shipper_name');

  const { count: backfillConsigneeEntities } = await supabase
    .from('entity_extractions')
    .select('id', { count: 'exact', head: true })
    .eq('extraction_method', 'ai_backfill')
    .eq('entity_type', 'consignee_name');

  console.log(`   Backfill shipper entities:   ${backfillShipperEntities || 0}`);
  console.log(`   Backfill consignee entities: ${backfillConsigneeEntities || 0}`);
}

check().catch(console.error);
