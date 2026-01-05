import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// The remaining missing booking numbers
const MISSING_BOOKINGS = [
  '263606660', '263651607'
];

// Fields that are timestamps and might have bad data
const TIMESTAMP_FIELDS = ['etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff'];

function isValidTimestamp(value: string): boolean {
  if (!value) return false;

  // Check if it's a valid ISO date or parseable date
  const date = new Date(value);
  return !isNaN(date.getTime());
}

function sanitizeTimestamp(value: string): string | null {
  if (!value) return null;

  // Try direct parse first
  const direct = new Date(value);
  if (!isNaN(direct.getTime())) {
    return direct.toISOString();
  }

  // Common patterns that fail:
  // "THU 0200 HRS" - day + time without date
  // "SUN 16:00 hrs" - day + time without date
  // "Tue 30 23:00" - incomplete date

  // These are relative times without actual dates - skip them
  return null;
}

async function lookupCarrierId(carrierName: string): Promise<string | null> {
  const { data } = await supabase
    .from('carriers')
    .select('id')
    .ilike('carrier_name', `%${carrierName}%`)
    .limit(1)
    .single();
  return data?.id || null;
}

function detectCarrierName(email: string): string | null {
  const domain = (email || '').toLowerCase();
  if (domain.includes('maersk')) return 'Maersk';
  if (domain.includes('hlag') || domain.includes('hapag')) return 'Hapag-Lloyd';
  if (domain.includes('cma') || domain.includes('cmacgm')) return 'CMA CGM';
  if (domain.includes('msc.com')) return 'MSC';
  if (domain.includes('cosco') || domain.includes('coscon')) return 'COSCO';
  if (domain.includes('oocl')) return 'OOCL';
  if (domain.includes('one-line')) return 'ONE';
  if (domain.includes('evergreen')) return 'Evergreen';
  if (domain.includes('yangming')) return 'Yang Ming';
  if (domain.includes('zim')) return 'ZIM';
  return null;
}

async function fixMissingShipments() {
  console.log('='.repeat(60));
  console.log('FIXING 12 MISSING SHIPMENTS');
  console.log('='.repeat(60));

  let created = 0;
  let errors: string[] = [];

  // Get all booking confirmations with these booking numbers
  for (const bookingNumber of MISSING_BOOKINGS) {
    console.log(`\nProcessing: ${bookingNumber}`);

    // Find email with this booking number
    const { data: entityMatch } = await supabase
      .from('entity_extractions')
      .select('email_id')
      .eq('entity_type', 'booking_number')
      .eq('entity_value', bookingNumber)
      .limit(1)
      .single();

    if (!entityMatch) {
      errors.push(`${bookingNumber}: No email found with this booking number`);
      continue;
    }

    // Get email details
    const { data: email } = await supabase
      .from('raw_emails')
      .select('id, sender_email, true_sender_email, received_at')
      .eq('id', entityMatch.email_id)
      .single();

    if (!email) {
      errors.push(`${bookingNumber}: Email not found`);
      continue;
    }

    // Get all entities for this email
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', email.id);

    // Build shipment data, sanitizing timestamps
    const shipmentData: Record<string, any> = {
      booking_number: bookingNumber,
      status: 'booked',
      created_from_email_id: email.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // Add carrier
    const carrierName = detectCarrierName(email.true_sender_email || email.sender_email);
    if (carrierName) {
      const carrierId = await lookupCarrierId(carrierName);
      if (carrierId) shipmentData.carrier_id = carrierId;
    }

    // Process entities
    for (const entity of entities || []) {
      const value = entity.entity_value;
      const type = entity.entity_type;

      // Handle timestamp fields specially
      if (TIMESTAMP_FIELDS.includes(type)) {
        const sanitized = sanitizeTimestamp(value);
        if (sanitized) {
          shipmentData[type] = sanitized;
        } else {
          console.log(`  ⚠️  Skipping invalid ${type}: "${value}"`);
        }
        continue;
      }

      // Handle other fields
      switch (type) {
        case 'bl_number': shipmentData.bl_number = value; break;
        case 'container_number':
          if (!shipmentData.container_number_primary) {
            shipmentData.container_number_primary = value;
          }
          break;
        case 'vessel_name': shipmentData.vessel_name = value; break;
        case 'voyage_number': shipmentData.voyage_number = value; break;
        case 'port_of_loading': shipmentData.port_of_loading = value; break;
        case 'port_of_loading_code': shipmentData.port_of_loading_code = value; break;
        case 'port_of_discharge': shipmentData.port_of_discharge = value; break;
        case 'port_of_discharge_code': shipmentData.port_of_discharge_code = value; break;
        case 'shipper': shipmentData.shipper_name = value; break;
        case 'consignee': shipmentData.consignee_name = value; break;
        case 'commodity': shipmentData.commodity_description = value; break;
      }
    }

    // Check if shipment already exists
    const { data: existing } = await supabase
      .from('shipments')
      .select('id')
      .eq('booking_number', bookingNumber)
      .single();

    if (existing) {
      console.log(`  ✓ Already exists`);
      continue;
    }

    // Create shipment
    const { data: newShipment, error: insertError } = await supabase
      .from('shipments')
      .insert(shipmentData)
      .select('id')
      .single();

    if (insertError) {
      errors.push(`${bookingNumber}: ${insertError.message}`);
      console.log(`  ❌ Error: ${insertError.message}`);
    } else {
      created++;
      console.log(`  ✅ Created shipment ${newShipment.id}`);

      // Link document
      await supabase.from('shipment_documents').insert({
        email_id: email.id,
        shipment_id: newShipment.id,
        document_type: 'booking_confirmation',
        link_method: 'ai',
        link_confidence_score: 100,
      });
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`Created: ${created}`);
  console.log(`Errors: ${errors.length}`);

  if (errors.length > 0) {
    console.log('\nErrors:');
    errors.forEach(e => console.log(`  - ${e}`));
  }

  // Final count
  const { count } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });
  console.log(`\nTotal shipments now: ${count}`);
}

fixMissingShipments().catch(console.error);
