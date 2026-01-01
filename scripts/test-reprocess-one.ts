import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { EmailProcessingOrchestrator } from '../lib/services/email-processing-orchestrator';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anthropicKey = process.env.ANTHROPIC_API_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const bookingNumber = '263375454';
  console.log(`Testing reprocess for booking ${bookingNumber}\n`);

  // Get shipment
  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, created_from_email_id, vessel_name, etd, eta, port_of_loading, port_of_discharge')
    .eq('booking_number', bookingNumber)
    .single();

  if (!shipment) {
    console.log('Shipment not found');
    return;
  }

  console.log('BEFORE:');
  console.log('  Vessel:', shipment.vessel_name);
  console.log('  ETD:', shipment.etd);
  console.log('  ETA:', shipment.eta);
  console.log('  POL:', shipment.port_of_loading);
  console.log('  POD:', shipment.port_of_discharge);

  // Reset email to pending
  await supabase
    .from('raw_emails')
    .update({ processing_status: 'pending' })
    .eq('id', shipment.created_from_email_id);

  // Reprocess
  const orchestrator = new EmailProcessingOrchestrator(supabaseUrl, supabaseKey, anthropicKey);
  await orchestrator.initialize();

  const result = await orchestrator.processEmail(shipment.created_from_email_id);
  console.log('\nReprocess result:', result.success ? 'SUCCESS' : 'FAILED', result.error || '');

  // Check updated values
  const { data: updated } = await supabase
    .from('shipments')
    .select('vessel_name, etd, eta, port_of_loading, port_of_discharge')
    .eq('id', shipment.id)
    .single();

  console.log('\nAFTER:');
  console.log('  Vessel:', updated?.vessel_name);
  console.log('  ETD:', updated?.etd);
  console.log('  ETA:', updated?.eta);
  console.log('  POL:', updated?.port_of_loading);
  console.log('  POD:', updated?.port_of_discharge);

  // Validate
  const etdYear = updated?.etd ? parseInt(updated.etd.substring(0, 4)) : null;
  if (etdYear && etdYear >= 2024) {
    console.log('\n✅ SUCCESS: Data looks correct!');
  } else {
    console.log('\n⚠️ STILL BAD: Data still has issues');
  }
}

main().catch(console.error);
