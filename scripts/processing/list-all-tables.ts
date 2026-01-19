import { createClient } from '@supabase/supabase-js';

const project2 = createClient(
  'https://fdmcdbvkfdmrdowfjrcz.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkbWNkYnZrZmRtcmRvd2ZqcmN6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzMxMTI4NSwiZXhwIjoyMDc4ODg3Mjg1fQ.bFblX9iooMq5S2I7kMPWoQ_d8Iu-FQ9kz-vYaClvh_k'
);

(async () => {
  console.log('=== CHECKING PROJECT 2 (fdmcdbvkfdmrdowfjrcz) ===\n');

  // List all tables
  const { data: tables, error } = await project2
    .from('information_schema.tables')
    .select('table_name')
    .eq('table_schema', 'public')
    .order('table_name');

  if (error) {
    console.error('Error:', error);
  } else {
    console.log('All tables in public schema:');
    tables?.forEach(t => console.log(`  - ${t.table_name}`));
  }

  // Try email_notifications table
  console.log('\nChecking email_notifications:');
  const { count: notifications } = await project2
    .from('email_notifications')
    .select('*', { count: 'exact', head: true });
  console.log(`  Count: ${notifications || 0}`);

  // Try bookings table
  console.log('\nChecking bookings:');
  const { count: bookings } = await project2
    .from('bookings')
    .select('*', { count: 'exact', head: true });
  console.log(`  Count: ${bookings || 0}`);
})();
