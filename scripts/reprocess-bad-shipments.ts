import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { EmailProcessingOrchestrator } from '../lib/services/email-processing-orchestrator';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anthropicKey = process.env.ANTHROPIC_API_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const BAD_BOOKING_NUMBERS = [
  '263375454',
  '263325925',
  '263453241',
  '263522096',
  'MAEU263368698',
  '263441600',
  '263375571',
  '263368883',
  '263522475',
  '263522385',
  '263522003',
  '263522431',
  '263455422',
  '263805268',
  'CEI0329370',
  'CAD0850107',
  'AMC2479273',
  'AMC2475648',
];

async function main() {
  console.log(`=== REPROCESSING ${BAD_BOOKING_NUMBERS.length} SHIPMENTS WITH BAD DATA ===\n`);

  const orchestrator = new EmailProcessingOrchestrator(supabaseUrl, supabaseKey, anthropicKey);
  await orchestrator.initialize();

  for (const bookingNumber of BAD_BOOKING_NUMBERS) {
    console.log(`\n--- Processing ${bookingNumber} ---`);

    // Get shipment
    const { data: shipment } = await supabase
      .from('shipments')
      .select('id, created_from_email_id, vessel_name, etd, eta, port_of_loading, port_of_discharge')
      .eq('booking_number', bookingNumber)
      .single();

    if (!shipment) {
      console.log('Shipment not found');
      continue;
    }

    console.log('Current data:');
    console.log('  Vessel:', shipment.vessel_name);
    console.log('  ETD:', shipment.etd);
    console.log('  ETA:', shipment.eta);
    console.log('  POL:', shipment.port_of_loading);
    console.log('  POD:', shipment.port_of_discharge);

    if (!shipment.created_from_email_id) {
      console.log('No source email ID - skipping');
      continue;
    }

    // Get source email with PDF
    const { data: email } = await supabase
      .from('raw_emails')
      .select('id, subject, true_sender_email, sender_email')
      .eq('id', shipment.created_from_email_id)
      .single();

    if (!email) {
      console.log('Source email not found');
      continue;
    }

    // Get PDF attachment
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('id, filename, extracted_text')
      .eq('email_id', email.id)
      .ilike('filename', '%.pdf%');

    const pdfAtt = attachments?.find(a => a.extracted_text);
    if (!pdfAtt) {
      console.log('No PDF with extracted text found');
      continue;
    }

    console.log('Re-extracting from PDF:', pdfAtt.filename);

    // Reset the email to pending and reprocess
    await supabase
      .from('raw_emails')
      .update({ processing_status: 'pending' })
      .eq('id', email.id);

    try {
      const result = await orchestrator.processEmail(email.id);
      console.log('Reprocess result:', result.success ? 'SUCCESS' : 'FAILED', result.error || '');

      // Check new values
      const { data: updated } = await supabase
        .from('shipments')
        .select('vessel_name, etd, eta, port_of_loading, port_of_discharge')
        .eq('id', shipment.id)
        .single();

      if (updated) {
        console.log('Updated data:');
        console.log('  Vessel:', updated.vessel_name);
        console.log('  ETD:', updated.etd);
        console.log('  ETA:', updated.eta);
        console.log('  POL:', updated.port_of_loading);
        console.log('  POD:', updated.port_of_discharge);

        // Check if ETD is still in the past
        const etdYear = updated.etd ? parseInt(updated.etd.substring(0, 4)) : null;
        if (etdYear && etdYear < 2024) {
          console.log('⚠️ STILL BAD: ETD is still from before 2024!');
        } else if (updated.etd) {
          console.log('✅ ETD now looks correct');
        }
      }
    } catch (err: any) {
      console.log('Error:', err.message);
    }
  }

  console.log('\n=== DONE ===');
}

main().catch(console.error);
