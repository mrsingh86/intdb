import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function run() {
  // Milestone 1: Email Linking Rate
  const { data: linkData } = await supabase.from('shipment_documents').select('email_id');
  const { count: totalEmails } = await supabase.from('raw_emails').select('*', { count: 'exact', head: true });
  const uniqueLinkedEmails = new Set(linkData?.map(d => d.email_id) || []).size;
  const linkRate = ((uniqueLinkedEmails / (totalEmails || 1)) * 100).toFixed(1);

  console.log('=== MILESTONE 1: Email Linking Rate ===');
  console.log('Linked emails:', uniqueLinkedEmails);
  console.log('Total emails:', totalEmails);
  console.log('Link rate:', linkRate + '%');

  // Milestone 2: Cutoff Coverage
  const { data: shipments } = await supabase.from('shipments').select('si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff');
  const total = shipments?.length || 0;
  const siCount = shipments?.filter(s => s.si_cutoff).length || 0;
  const vgmCount = shipments?.filter(s => s.vgm_cutoff).length || 0;
  const cargoCount = shipments?.filter(s => s.cargo_cutoff).length || 0;
  const gateCount = shipments?.filter(s => s.gate_cutoff).length || 0;

  console.log('');
  console.log('=== MILESTONE 2: Cutoff Date Coverage ===');
  console.log('Total shipments:', total);
  console.log('With SI cutoff:', siCount);
  console.log('With VGM cutoff:', vgmCount);
  console.log('With Cargo cutoff:', cargoCount);
  console.log('With Gate cutoff:', gateCount);

  // Milestone 3: Container Coverage
  const { data: containers } = await supabase.from('shipment_containers').select('shipment_id');
  const shipmentsWithContainers = new Set(containers?.map(c => c.shipment_id) || []).size;

  console.log('');
  console.log('=== MILESTONE 3: Container Coverage ===');
  console.log('Shipments with containers:', shipmentsWithContainers);
  console.log('Total shipments:', total);

  // Milestone 4: Insight Engine (replacing tasks/notifications)
  const { data: insights, count: insightCount } = await supabase
    .from('shipment_insights')
    .select('insight_type, status, shipment_id', { count: 'exact' });

  const insightsByStatus: Record<string, number> = {};
  const shipmentsWithInsights = new Set<string>();
  insights?.forEach(i => {
    const status = i.status || 'unknown';
    insightsByStatus[status] = (insightsByStatus[status] || 0) + 1;
    if (i.shipment_id) shipmentsWithInsights.add(i.shipment_id);
  });

  console.log('');
  console.log('=== MILESTONE 4: Insight Engine ===');
  console.log('Total insights:', insightCount || 0);
  console.log('Shipments with insights:', shipmentsWithInsights.size);
  console.log('By status:', JSON.stringify(insightsByStatus));

  // Summary
  console.log('');
  console.log('=== SUMMARY ===');
  console.log(`Linking: ${linkRate}% (target: 50%+)`);
  console.log(`Cutoffs: SI=${siCount}, VGM=${vgmCount}, Cargo=${cargoCount}, Gate=${gateCount}`);
  console.log(`Insights: ${insightCount || 0} total across ${shipmentsWithInsights.size} shipments`);
}

run().catch(console.error);
