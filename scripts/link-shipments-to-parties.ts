#!/usr/bin/env npx tsx
/**
 * Link Shipments to Parties
 * Matches shipments to parties by shipper_name and consignee_name
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function linkShipmentsToParties() {
  console.log('=== LINKING SHIPMENTS TO PARTIES ===\n');

  // Get all shipments with shipper/consignee names
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, shipper_name, consignee_name, shipper_id, consignee_id');

  console.log('Total shipments:', shipments?.length);

  // Get all parties
  const { data: parties } = await supabase
    .from('parties')
    .select('id, party_name, party_type');

  console.log('Total parties:', parties?.length);

  // Create lookup maps (case-insensitive)
  const partyByName = new Map<string, { id: string; party_name: string; party_type: string }>();
  parties?.forEach(p => {
    if (p.party_name) {
      partyByName.set(p.party_name.toLowerCase().trim(), p);
    }
  });

  let shipperLinked = 0;
  let consigneeLinked = 0;

  for (const s of shipments || []) {
    const updates: Record<string, string> = {};

    // Link shipper
    if (s.shipper_name && s.shipper_id === null) {
      const party = partyByName.get(s.shipper_name.toLowerCase().trim());
      if (party) {
        updates.shipper_id = party.id;
        shipperLinked++;
      }
    }

    // Link consignee
    if (s.consignee_name && s.consignee_id === null) {
      const party = partyByName.get(s.consignee_name.toLowerCase().trim());
      if (party) {
        updates.consignee_id = party.id;
        consigneeLinked++;
      }
    }

    if (Object.keys(updates).length > 0) {
      await supabase.from('shipments').update(updates).eq('id', s.id);
    }
  }

  console.log('\nShippers linked:', shipperLinked);
  console.log('Consignees linked:', consigneeLinked);

  // Update party shipment counts
  console.log('\nUpdating party shipment counts...');

  const { data: linkedShipments } = await supabase
    .from('shipments')
    .select('shipper_id, consignee_id');

  const partyCounts: Record<string, number> = {};

  linkedShipments?.forEach(s => {
    if (s.shipper_id) partyCounts[s.shipper_id] = (partyCounts[s.shipper_id] || 0) + 1;
    if (s.consignee_id) partyCounts[s.consignee_id] = (partyCounts[s.consignee_id] || 0) + 1;
  });

  // Update each party
  let updated = 0;
  for (const [partyId, count] of Object.entries(partyCounts)) {
    const { error } = await supabase
      .from('parties')
      .update({ total_shipments: count })
      .eq('id', partyId);
    if (!error) updated++;
  }

  console.log('Parties updated with shipment counts:', updated);
  console.log('\n=== DONE ===');
}

linkShipmentsToParties().catch(console.error);
