/**
 * Resync shipments with missing data from entity extractions
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function resyncMissingData() {
  console.log('RESYNCING SHIPMENTS WITH MISSING DATA');
  console.log('='.repeat(60));

  // Find shipments missing key fields
  const { data: incomplete } = await supabase
    .from('shipments')
    .select('id, booking_number, vessel_name, port_of_loading, port_of_discharge, etd, eta')
    .or('vessel_name.is.null,port_of_loading.is.null,etd.is.null')
    .limit(100);

  console.log(`Found ${incomplete?.length || 0} shipments with missing data`);
  let updated = 0;

  for (const ship of incomplete || []) {
    // Get linked documents
    const { data: docs } = await supabase
      .from('shipment_documents')
      .select('email_id')
      .eq('shipment_id', ship.id);

    if (!docs || docs.length === 0) continue;

    // Get entities from linked emails
    const emailIds = docs.map(d => d.email_id);
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .in('email_id', emailIds);

    if (!entities || entities.length === 0) continue;

    // Build updates
    const updates: Record<string, any> = {};
    const findEntity = (type: string) => entities.find(e => e.entity_type === type)?.entity_value;

    if (!ship.vessel_name && findEntity('vessel_name')) {
      updates.vessel_name = findEntity('vessel_name');
    }
    if (!ship.port_of_loading && findEntity('port_of_loading')) {
      updates.port_of_loading = findEntity('port_of_loading');
    }
    if (!ship.port_of_discharge && findEntity('port_of_discharge')) {
      updates.port_of_discharge = findEntity('port_of_discharge');
    }
    if (!ship.etd && findEntity('etd')) {
      const etd = findEntity('etd');
      if (etd) {
        const parsed = new Date(etd);
        if (!isNaN(parsed.getTime())) {
          updates.etd = parsed.toISOString();
        }
      }
    }
    if (!ship.eta && findEntity('eta')) {
      const eta = findEntity('eta');
      if (eta) {
        const parsed = new Date(eta);
        if (!isNaN(parsed.getTime())) {
          updates.eta = parsed.toISOString();
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      await supabase.from('shipments').update(updates).eq('id', ship.id);
      updated++;
      console.log(`Updated ${ship.booking_number}: ${Object.keys(updates).join(', ')}`);
    }
  }

  console.log('');
  console.log(`Updated ${updated} shipments`);
}

resyncMissingData().catch(console.error);
