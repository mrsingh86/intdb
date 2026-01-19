import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function check() {
  const { data } = await supabase
    .from('shipments')
    .select('booking_number, etd, eta, port_of_loading, port_of_discharge')
    .not('etd', 'is', null)
    .limit(15);

  console.log('\nShipments with ETD/ETA:\n');
  data?.forEach(s => {
    const etd = s.etd ? new Date(s.etd).toLocaleDateString() : '-';
    const eta = s.eta ? new Date(s.eta).toLocaleDateString() : '-';
    const transit = s.etd && s.eta
      ? Math.round((new Date(s.eta).getTime() - new Date(s.etd).getTime()) / (1000*60*60*24))
      : '?';
    console.log(`${s.booking_number} | ETD: ${etd} | ETA: ${eta} | Transit: ${transit} days`);
    console.log(`  Route: ${s.port_of_loading || '?'} → ${s.port_of_discharge || '?'}`);
  });

  // Also check entity_extractions for ETD/ETA values
  console.log('\n\nEntity extractions for etd/eta:\n');
  const { data: entities } = await supabase
    .from('entity_extractions')
    .select('entity_type, entity_value, email_id')
    .in('entity_type', ['etd', 'eta', 'departure_date', 'arrival_date'])
    .limit(20);

  entities?.forEach(e => {
    console.log(`${e.entity_type}: ${e.entity_value}`);
  });
}

check().catch(console.error);
