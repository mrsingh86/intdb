/**
 * Seed initial stakeholders from existing data
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!
);

async function seedStakeholders() {
  console.log('=== Seeding Stakeholders ===\n');

  // 1. Check existing entity extractions
  const { data: entities } = await supabase
    .from('entity_extractions')
    .select('entity_type, entity_value')
    .limit(100);

  console.log('Entity extractions found:', entities?.length || 0);

  // Group by type
  const byType: Record<string, string[]> = {};
  for (const e of entities || []) {
    if (!byType[e.entity_type]) byType[e.entity_type] = [];
    if (e.entity_value) byType[e.entity_type].push(e.entity_value);
  }

  console.log('\nEntity types:');
  for (const [type, values] of Object.entries(byType)) {
    console.log(`  ${type}: ${values.length}`);
    values.slice(0, 2).forEach(v => console.log(`    - ${v.substring(0, 60)}`));
  }

  // 2. Seed shipping lines from known carriers
  const shippingLines = [
    {
      party_name: 'MAERSK LINE',
      party_type: 'shipping_line',
      email_domains: ['maersk.com', 'maerskline.com'],
      contact_email: 'booking@maersk.com',
      is_customer: false,
      total_shipments: 0,
    },
    {
      party_name: 'HAPAG-LLOYD',
      party_type: 'shipping_line',
      email_domains: ['hlag.com', 'hapag-lloyd.com', 'service.hlag.com'],
      contact_email: 'India@service.hlag.com',
      is_customer: false,
      total_shipments: 0,
    },
  ];

  console.log('\n--- Seeding Shipping Lines ---');
  for (const line of shippingLines) {
    // Check if exists
    const { data: existing } = await supabase
      .from('parties')
      .select('id, party_name')
      .eq('party_name', line.party_name)
      .single();

    if (existing) {
      console.log(`  Already exists: ${existing.party_name}`);
      continue;
    }

    const { data, error } = await supabase
      .from('parties')
      .insert(line)
      .select()
      .single();

    if (error) {
      console.log(`  Error creating ${line.party_name}: ${error.message}`);
    } else {
      console.log(`  Created: ${data.party_name} (${data.id})`);
    }
  }

  // 3. Extract shipper/consignee from entities if available
  const shipperNames = byType['shipper_name'] || byType['shipper'] || [];
  const consigneeNames = byType['consignee_name'] || byType['consignee'] || [];

  if (shipperNames.length > 0) {
    console.log('\n--- Seeding Shippers from Extractions ---');
    for (const name of [...new Set(shipperNames)].slice(0, 10)) {
      if (!name || name.length < 3) continue;
      const cleanName = name.toUpperCase().trim();

      // Check if exists
      const { data: existing } = await supabase
        .from('parties')
        .select('id')
        .eq('party_name', cleanName)
        .single();

      if (existing) {
        console.log(`  Already exists: ${cleanName}`);
        continue;
      }

      const { data, error } = await supabase
        .from('parties')
        .insert({
          party_name: cleanName,
          party_type: 'shipper',
          is_customer: true,
          customer_relationship: 'shipper_customer',
          total_shipments: 1,
        })
        .select()
        .single();

      if (error) {
        console.log(`  Error: ${error.message}`);
      } else {
        console.log(`  Created: ${data.party_name}`);
      }
    }
  }

  if (consigneeNames.length > 0) {
    console.log('\n--- Seeding Consignees from Extractions ---');
    for (const name of [...new Set(consigneeNames)].slice(0, 10)) {
      if (!name || name.length < 3) continue;
      const cleanName = name.toUpperCase().trim();

      // Check if exists
      const { data: existing } = await supabase
        .from('parties')
        .select('id')
        .eq('party_name', cleanName)
        .single();

      if (existing) {
        console.log(`  Already exists: ${cleanName}`);
        continue;
      }

      const { data, error } = await supabase
        .from('parties')
        .insert({
          party_name: cleanName,
          party_type: 'consignee',
          is_customer: true,
          customer_relationship: 'consignee_customer',
          total_shipments: 1,
        })
        .select()
        .single();

      if (error) {
        console.log(`  Error: ${error.message}`);
      } else {
        console.log(`  Created: ${data.party_name}`);
      }
    }
  }

  // 4. Final count
  const { count } = await supabase
    .from('parties')
    .select('*', { count: 'exact', head: true });

  console.log(`\n=== Done! Total stakeholders: ${count} ===`);
}

seedStakeholders().catch(console.error);
