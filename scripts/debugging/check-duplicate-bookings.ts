import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY!
);

async function checkDuplicates() {
  // Check for duplicate booking numbers
  const { data: shipments, error } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state, created_at')
    .order('booking_number');

  if (error) {
    console.error('Error:', error);
    return;
  }

  // Group by booking_number
  const byBooking: Record<string, any[]> = {};
  for (const s of shipments || []) {
    const key = s.booking_number || 'NULL';
    if (!byBooking[key]) byBooking[key] = [];
    byBooking[key].push(s);
  }

  // Find duplicates
  const bookingKeys = Object.keys(byBooking);
  const duplicates = bookingKeys.filter(k => byBooking[k].length > 1);

  console.log('Total shipments:', shipments?.length);
  console.log('Unique booking numbers:', bookingKeys.length);
  console.log('Booking numbers with duplicates:', duplicates.length);

  if (duplicates.length > 0) {
    console.log('\nDuplicate booking numbers:');
    for (const booking of duplicates) {
      const arr = byBooking[booking];
      console.log('  ' + booking + ': ' + arr.length + ' shipments');
      for (const s of arr) {
        console.log('    - ' + s.id.slice(0,8) + ' | state: ' + s.workflow_state + ' | created: ' + s.created_at);
      }
    }
  }

  // Count by workflow state
  const byState: Record<string, number> = {};
  for (const s of shipments || []) {
    const state = s.workflow_state || 'null';
    byState[state] = (byState[state] || 0) + 1;
  }
  console.log('\nBy workflow state:');
  const stateEntries = Object.entries(byState).sort((a, b) => b[1] - a[1]);
  for (const [state, count] of stateEntries) {
    console.log('  ' + state + ': ' + count);
  }
}

checkDuplicates();
