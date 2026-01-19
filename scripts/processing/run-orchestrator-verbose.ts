import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

const supabase = createClient(supabaseUrl, supabaseKey);

import EmailProcessingOrchestrator from '../lib/services/email-processing-orchestrator';

async function run() {
  const emailId = 'b452d434-da84-44c2-b486-fd4e4838c409';

  // Reset email
  await supabase
    .from('raw_emails')
    .update({ processing_status: 'pending' })
    .eq('id', emailId);

  // Delete classifications so it re-runs
  await supabase.from('email_classifications').delete().eq('email_id', emailId);
  await supabase.from('attachment_classifications').delete().eq('email_id', emailId);
  await supabase.from('email_extractions').delete().eq('email_id', emailId);

  console.log('=== RUNNING ORCHESTRATOR DIRECTLY ===\n');

  // Create orchestrator
  const orchestrator = new EmailProcessingOrchestrator(supabaseUrl, supabaseKey);
  await orchestrator.initialize();

  console.log('Orchestrator initialized. Processing email...\n');

  try {
    const result = await orchestrator.processEmail(emailId);

    console.log('\n=== ORCHESTRATOR RESULT ===');
    console.log(JSON.stringify(result, null, 2));

    // Check if shipment was created
    const { data: shipment } = await supabase
      .from('shipments')
      .select('id, booking_number, carrier_id')
      .eq('booking_number', 'COSU6441569540')
      .single();

    console.log('\n=== SHIPMENT CHECK ===');
    console.log('Shipment:', shipment || 'NOT FOUND');

    // Check email_shipment_links
    const { data: links } = await supabase
      .from('email_shipment_links')
      .select('*')
      .eq('email_id', emailId);

    console.log('\nLinks:', links?.length || 0);
    if (links && links.length > 0) {
      console.log(JSON.stringify(links[0], null, 2));
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

run().catch(console.error);
