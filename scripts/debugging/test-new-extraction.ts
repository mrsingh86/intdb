import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { EmailProcessingOrchestrator } from '../lib/services/email-processing-orchestrator';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const anthropicKey = process.env.ANTHROPIC_API_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Check pending emails
  const { data: pending, count: pendingCount } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, received_at, true_sender_email', { count: 'exact' })
    .in('processing_status', ['pending', 'classified'])
    .order('received_at', { ascending: false })
    .limit(10);

  console.log('=== PENDING EMAILS ===');
  console.log('Total pending:', pendingCount);

  for (const e of pending || []) {
    console.log('---');
    console.log('ID:', e.id.substring(0, 8) + '...');
    console.log('Subject:', e.subject?.substring(0, 70));
    console.log('From:', e.true_sender_email || e.sender_email);
    console.log('Received:', e.received_at);
  }

  // If we have pending emails, process one to test
  if (pending && pending.length > 0) {
    const testEmail = pending[0];
    console.log('\n=== TESTING NEW EXTRACTION ===');
    console.log('Processing email:', testEmail.id.substring(0, 8) + '...');
    console.log('Subject:', testEmail.subject);

    const orchestrator = new EmailProcessingOrchestrator(supabaseUrl, supabaseKey, anthropicKey);
    await orchestrator.initialize();

    const result = await orchestrator.processEmail(testEmail.id);

    console.log('\n=== RESULT ===');
    console.log('Success:', result.success);
    console.log('Stage:', result.stage);
    console.log('Shipment ID:', result.shipmentId);
    console.log('Fields extracted:', result.fieldsExtracted);
    if (result.error) {
      console.log('Error:', result.error);
    }

    // If shipment was created/updated, show the extracted data
    if (result.shipmentId) {
      const { data: shipment } = await supabase
        .from('shipments')
        .select('*')
        .eq('id', result.shipmentId)
        .single();

      console.log('\n=== SHIPMENT DATA ===');
      console.log('Booking #:', shipment?.booking_number);
      console.log('Vessel:', shipment?.vessel_name);
      console.log('ETD:', shipment?.etd);
      console.log('ETA:', shipment?.eta);
      console.log('POL:', shipment?.port_of_loading);
      console.log('POD:', shipment?.port_of_discharge);
      console.log('SI Cutoff:', shipment?.si_cutoff);
      console.log('VGM Cutoff:', shipment?.vgm_cutoff);
      console.log('Cargo Cutoff:', shipment?.cargo_cutoff);
      console.log('Gate Cutoff:', shipment?.gate_cutoff);
    }

    // Check entity_extractions for this email
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value, confidence_score')
      .eq('email_id', testEmail.id);

    console.log('\n=== EXTRACTED ENTITIES ===');
    for (const e of entities || []) {
      console.log(`${e.entity_type}: ${e.entity_value} (${e.confidence_score}%)`);
    }
  } else {
    console.log('\nNo pending emails to test. Checking recent processed...');

    // Show recent shipments instead
    const { data: recentShipments } = await supabase
      .from('shipments')
      .select('id, booking_number, vessel_name, etd, port_of_loading, port_of_discharge, created_at')
      .order('created_at', { ascending: false })
      .limit(5);

    console.log('\n=== RECENT SHIPMENTS ===');
    for (const s of recentShipments || []) {
      console.log('---');
      console.log('Booking:', s.booking_number);
      console.log('Vessel:', s.vessel_name);
      console.log('Route:', s.port_of_loading, '→', s.port_of_discharge);
      console.log('ETD:', s.etd);
    }
  }
}

main().catch(console.error);
