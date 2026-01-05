import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// US Port codes from Hapag-Lloyd subject lines
const US_PORTS: Record<string, { name: string; code: string }> = {
  'USORF': { name: 'NORFOLK', code: 'USORF' },
  'USSAV': { name: 'SAVANNAH', code: 'USSAV' },
  'USNYC': { name: 'NEW YORK', code: 'USNYC' },
  'USCHS': { name: 'CHARLESTON', code: 'USCHS' },
  'USLAX': { name: 'LOS ANGELES', code: 'USLAX' },
  'USLGB': { name: 'LONG BEACH', code: 'USLGB' },
  'USHOU': { name: 'HOUSTON', code: 'USHOU' },
};

async function fix() {
  console.log('Fixing POL/POD pairs...\n');

  // Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, port_of_loading, port_of_discharge, created_from_email_id');

  if (!shipments) {
    console.log('No shipments found');
    return;
  }

  // Find shipments with same POL/POD or Indian POD
  const needsFix = shipments.filter(s => {
    const pol = (s.port_of_loading || '').toUpperCase();
    const pod = (s.port_of_discharge || '').toUpperCase();
    // Same port or POD is Indian port (should be US for exports)
    return pol === pod ||
           pod.includes('MUNDRA') || pod.includes('INMUN') ||
           pod.includes('DELHI') || pod.includes('INDEL') ||
           pod.includes('NHAVA') || pod.includes('INNSA');
  });

  console.log(`Shipments needing fix: ${needsFix.length}\n`);

  // Get related emails
  const emailIds = needsFix.map(s => s.created_from_email_id).filter(Boolean);
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text')
    .in('id', emailIds);

  const emailMap = new Map(emails?.map(e => [e.id, e]) || []);

  let fixed = 0;

  for (const shipment of needsFix) {
    const email = emailMap.get(shipment.created_from_email_id);
    if (!email) continue;

    const subject = email.subject || '';
    const body = email.body_text || '';

    console.log(`${shipment.booking_number}:`);
    console.log(`  Current: ${shipment.port_of_loading} → ${shipment.port_of_discharge}`);
    console.log(`  Subject: ${subject.substring(0, 60)}`);

    // Extract US port from subject (e.g., "HL-20262609 USORF UFLEX")
    const usPortMatch = subject.match(/\b(US[A-Z]{3})\b/);

    if (usPortMatch) {
      const portCode = usPortMatch[1];
      const portInfo = US_PORTS[portCode];

      if (portInfo) {
        const { error } = await supabase
          .from('shipments')
          .update({
            port_of_loading: 'MUNDRA',
            port_of_loading_code: 'INMUN',
            port_of_discharge: portInfo.name,
            port_of_discharge_code: portInfo.code
          })
          .eq('id', shipment.id);

        if (!error) {
          console.log(`  ✓ Fixed: MUNDRA → ${portInfo.name}\n`);
          fixed++;
        } else {
          console.log(`  ❌ Error: ${error.message}\n`);
        }
        continue;
      }
    }

    // Try to extract from body if not in subject
    // Look for patterns like "SAVANNAH, GA" or "NEW YORK, NY" or port codes
    const bodyPortMatch = body.match(/(?:SAVANNAH|NORFOLK|NEW YORK|CHARLESTON|LOS ANGELES|LONG BEACH)/i);
    if (bodyPortMatch) {
      const portName = bodyPortMatch[0].toUpperCase();
      const portEntry = Object.entries(US_PORTS).find(([, v]) => v.name === portName);

      if (portEntry) {
        const { error } = await supabase
          .from('shipments')
          .update({
            port_of_loading: 'MUNDRA',
            port_of_loading_code: 'INMUN',
            port_of_discharge: portEntry[1].name,
            port_of_discharge_code: portEntry[0]
          })
          .eq('id', shipment.id);

        if (!error) {
          console.log(`  ✓ Fixed from body: MUNDRA → ${portEntry[1].name}\n`);
          fixed++;
        }
        continue;
      }
    }

    console.log(`  ⚠️ Could not determine destination port\n`);
  }

  console.log(`════════════════════════════════════════`);
  console.log(`Fixed ${fixed}/${needsFix.length} shipments`);
}

fix().catch(console.error);
