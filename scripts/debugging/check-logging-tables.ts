import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing credentials');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function check() {
  console.log('=== CHECKING LOGGING TABLES ===\n');

  // Check chronicle_runs
  const { data: runs, error: runsErr } = await supabase.from('chronicle_runs').select('*').limit(5);
  if (runsErr) {
    console.log('chronicle_runs: TABLE NOT FOUND -', runsErr.message);
  } else {
    console.log('chronicle_runs: EXISTS, rows:', runs?.length || 0);
    if (runs?.[0]) {
      console.log('  Latest run:');
      console.log('    status:', runs[0].status);
      console.log('    emails_total:', runs[0].emails_total);
      console.log('    emails_processed:', runs[0].emails_processed);
      console.log('    emails_succeeded:', runs[0].emails_succeeded);
      console.log('    shipments_created:', runs[0].shipments_created);
    }
  }

  // Check chronicle_errors
  const { data: errors, error: errErr } = await supabase.from('chronicle_errors').select('*').limit(5);
  if (errErr) {
    console.log('\nchronicle_errors: TABLE NOT FOUND -', errErr.message);
  } else {
    console.log('\nchronicle_errors: EXISTS, rows:', errors?.length || 0);
    if (errors?.[0]) {
      console.log('  Sample error:', errors[0].error_type, '-', errors[0].error_message?.substring(0, 100));
    }
  }

  // Check chronicle_stage_metrics
  const { data: metrics, error: metErr } = await supabase.from('chronicle_stage_metrics').select('*').limit(10);
  if (metErr) {
    console.log('\nchronicle_stage_metrics: TABLE NOT FOUND -', metErr.message);
  } else {
    console.log('\nchronicle_stage_metrics: EXISTS, rows:', metrics?.length || 0);
    for (const m of metrics || []) {
      console.log(`  ${m.stage}: success=${m.success_count} fail=${m.failure_count} avg=${m.avg_duration_ms}ms`);
    }
  }

  // Check shipment_events
  const { data: events, error: evtErr } = await supabase.from('shipment_events').select('*').limit(5);
  if (evtErr) {
    console.log('\nshipment_events: TABLE NOT FOUND -', evtErr.message);
  } else {
    console.log('\nshipment_events: EXISTS, rows:', events?.length || 0);
    for (const e of (events || []).slice(0, 3)) {
      console.log(`  ${e.event_type}: ${e.event_description?.substring(0, 60)}`);
    }
  }

  // Check if shipments has stage column
  const { data: shipments, error: shipErr } = await supabase.from('shipments').select('id, stage, booking_number').limit(3);
  if (shipErr) {
    console.log('\nshipments table error:', shipErr.message);
  } else {
    console.log('\nshipments with stage:');
    for (const s of shipments || []) {
      console.log(`  ${s.booking_number || s.id}: stage=${s.stage}`);
    }
  }

  // Count totals
  const { count: chronicleCount } = await supabase.from('chronicle').select('*', { count: 'exact', head: true });
  const { count: shipmentCount } = await supabase.from('shipments').select('*', { count: 'exact', head: true });

  console.log('\n=== TOTALS ===');
  console.log('Chronicle records:', chronicleCount);
  console.log('Shipments:', shipmentCount);
}

check()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Error:', e);
    process.exit(1);
  });
