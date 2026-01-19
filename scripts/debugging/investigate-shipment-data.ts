/**
 * Investigation Script: Trace shipment data flow from Layer 2 to Layer 3
 *
 * This script will:
 * 1. Pick a sample shipment and trace its data
 * 2. Check what entities exist in Layer 2
 * 3. Compare what was saved in Layer 3
 * 4. Identify where data is being lost
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { parseEntityDate } from '../lib/utils/date-parser';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function investigateShipment(bookingNumber?: string) {
  console.log('=== SHIPMENT DATA INVESTIGATION ===\n');

  // Step 1: Get a sample shipment
  let shipment;
  if (bookingNumber) {
    const { data } = await supabase
      .from('shipments')
      .select('*')
      .eq('booking_number', bookingNumber)
      .single();
    shipment = data;
  } else {
    // Get first few shipments to see what's in there
    const { data } = await supabase
      .from('shipments')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(5);

    console.log('Sample shipments in database:');
    data?.forEach((s: any) => {
      console.log(`- Booking #${s.booking_number || 'MISSING'}, BL #${s.bl_number || 'MISSING'}, ` +
                  `ETD: ${s.etd || 'MISSING'}, ETA: ${s.eta || 'MISSING'}, ` +
                  `Status: ${s.status}, Created from email: ${s.created_from_email_id}`);
    });

    shipment = data?.[0];
  }

  if (!shipment) {
    console.log('No shipments found!');
    return;
  }

  console.log('\n--- Selected Shipment for Investigation ---');
  console.log('ID:', shipment.id);
  console.log('Booking #:', shipment.booking_number || 'MISSING');
  console.log('BL #:', shipment.bl_number || 'MISSING');
  console.log('Container #:', shipment.container_number_primary || 'MISSING');
  console.log('ETD:', shipment.etd || 'MISSING');
  console.log('ETA:', shipment.eta || 'MISSING');
  console.log('ATD:', shipment.atd || 'MISSING');
  console.log('ATA:', shipment.ata || 'MISSING');
  console.log('POL:', shipment.port_of_loading || 'MISSING');
  console.log('POD:', shipment.port_of_discharge || 'MISSING');
  console.log('Vessel:', shipment.vessel_name || 'MISSING');
  console.log('Voyage:', shipment.voyage_number || 'MISSING');
  console.log('Status:', shipment.status);
  console.log('Created from email:', shipment.created_from_email_id);

  // Step 2: If created from email, check what entities exist in Layer 2
  if (shipment.created_from_email_id) {
    console.log('\n--- Layer 2 Entities for this Email ---');
    const { data: entities, error } = await supabase
      .from('entity_extractions')
      .select('*')
      .eq('email_id', shipment.created_from_email_id)
      .order('entity_type');

    if (error) {
      console.log('Error fetching entities:', error);
    } else if (entities && entities.length > 0) {
      console.log(`Found ${entities.length} entities:`);

      // Group entities by type
      const groupedEntities = entities.reduce((acc: any, entity: any) => {
        if (!acc[entity.entity_type]) {
          acc[entity.entity_type] = [];
        }
        acc[entity.entity_type].push({
          value: entity.entity_value,
          confidence: entity.confidence_score
        });
        return acc;
      }, {});

      // Display grouped entities
      Object.entries(groupedEntities).forEach(([type, values]: [string, any]) => {
        console.log(`\n${type}:`);
        values.forEach((v: any) => {
          console.log(`  - "${v.value}" (confidence: ${v.confidence})`);
        });
      });

      // Test date parsing on actual entity values
      console.log('\n--- Testing Date Parsing ---');
      const etdEntity = entities.find(e => e.entity_type === 'etd');
      const etaEntity = entities.find(e => e.entity_type === 'eta');

      if (etdEntity) {
        const parsed = parseEntityDate(etdEntity.entity_value);
        console.log(`ETD: "${etdEntity.entity_value}" -> ${parsed || 'FAILED TO PARSE'}`);
      }

      if (etaEntity) {
        const parsed = parseEntityDate(etaEntity.entity_value);
        console.log(`ETA: "${etaEntity.entity_value}" -> ${parsed || 'FAILED TO PARSE'}`);
      }
    } else {
      console.log('No entities found for this email!');
    }

    // Step 3: Check the original email data
    console.log('\n--- Original Email Data ---');
    const { data: email } = await supabase
      .from('raw_emails')
      .select('gmail_message_id, sender_email, subject, body_snippet, created_at')
      .eq('gmail_message_id', shipment.created_from_email_id)
      .single();

    if (email) {
      console.log('Gmail ID:', email.gmail_message_id);
      console.log('Sender:', email.sender_email);
      console.log('Subject:', email.subject);
      console.log('Snippet:', email.body_snippet?.substring(0, 100) + '...');
      console.log('Received:', email.created_at);
    }

    // Step 4: Check if there are linked documents
    console.log('\n--- Linked Documents ---');
    const { data: documents } = await supabase
      .from('shipment_documents')
      .select('*')
      .eq('shipment_id', shipment.id);

    if (documents && documents.length > 0) {
      console.log(`Found ${documents.length} linked documents`);
      documents.forEach((doc: any) => {
        console.log(`- Email: ${doc.email_id}, Type: ${doc.document_type}, Confidence: ${doc.link_confidence_score}`);
      });
    } else {
      console.log('No documents linked to this shipment');
    }
  }

  // Step 5: Check for other emails that might have entities for this booking
  if (shipment.booking_number) {
    console.log(`\n--- Other Emails with Booking #${shipment.booking_number} ---`);
    const { data: otherEntities } = await supabase
      .from('entity_extractions')
      .select('email_id, entity_value, confidence_score')
      .eq('entity_type', 'booking_number')
      .eq('entity_value', shipment.booking_number);

    if (otherEntities && otherEntities.length > 0) {
      console.log(`Found ${otherEntities.length} emails with this booking number`);

      // For each email, check what other entities it has
      for (const entity of otherEntities) {
        console.log(`\nEmail: ${entity.email_id}`);

        const { data: allEntities } = await supabase
          .from('entity_extractions')
          .select('entity_type, entity_value')
          .eq('email_id', entity.email_id)
          .in('entity_type', ['etd', 'eta', 'port_of_loading', 'port_of_discharge']);

        allEntities?.forEach(e => {
          console.log(`  - ${e.entity_type}: ${e.entity_value}`);
        });
      }
    }
  }
}

// Run investigation
async function main() {
  // First, let's see what's in the database
  console.log('=== DATABASE OVERVIEW ===\n');

  const { count: shipmentCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  const { count: entityCount } = await supabase
    .from('entity_extractions')
    .select('*', { count: 'exact', head: true });

  const { count: emailCount } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true });

  console.log(`Total shipments: ${shipmentCount}`);
  console.log(`Total entity extractions: ${entityCount}`);
  console.log(`Total emails: ${emailCount}`);

  // Investigate specific booking number if provided, otherwise use first shipment
  const bookingToInvestigate = process.argv[2];

  console.log('\n');
  await investigateShipment(bookingToInvestigate);

  process.exit(0);
}

main().catch(console.error);