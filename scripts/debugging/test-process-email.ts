import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

const supabase = createClient(supabaseUrl, supabaseKey);

// Import orchestrator
import EmailProcessingOrchestrator from '../lib/services/email-processing-orchestrator';

async function test() {
  const emailId = '1712c66b-4dd5-4129-8f48-c49918101671';

  // Reset email to pending
  await supabase
    .from('raw_emails')
    .update({ processing_status: 'pending' })
    .eq('id', emailId);

  console.log('=== Testing Email Processing Orchestrator ===\n');
  console.log('Email ID:', emailId);

  // Create orchestrator with URL and key
  const orchestrator = new EmailProcessingOrchestrator(supabaseUrl, supabaseKey);
  await orchestrator.initialize();

  console.log('\nProcessing email...\n');

  // Process the email
  try {
    const result = await orchestrator.processEmail(emailId);
    console.log('\n=== RESULT ===');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error:', error);
  }

  // Check for shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, carrier_id')
    .eq('booking_number', '264231500');

  console.log('\n=== SHIPMENTS ===');
  console.log('Count:', shipments?.length || 0);
  if (shipments && shipments.length > 0) {
    shipments.forEach(s => {
      console.log('  ID:', s.id);
      console.log('  Booking #:', s.booking_number);
    });
  }
}

test().catch(console.error);
