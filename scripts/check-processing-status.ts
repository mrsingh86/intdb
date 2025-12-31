import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jkvlggqkccozyouvipso.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImprdmxnZ3FrY2NvenlvdXZpcHNvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MzM0OTU5MSwiZXhwIjoyMDc4OTI1NTkxfQ.tPe-CS4zRZSksZa_PAIOAsMOYLiNCT7eon3crO_LgKY';

const supabase = createClient(supabaseUrl, supabaseKey);

(async () => {
  console.log('=== EMAIL PROCESSING STATUS ===\n');

  // Count emails
  const { count: totalEmails } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true });

  // Count classified
  const { count: classified } = await supabase
    .from('document_classifications')
    .select('*', { count: 'exact', head: true });

  // Count entities extracted
  const { count: entities } = await supabase
    .from('entity_extractions')
    .select('*', { count: 'exact', head: true });

  console.log(`Total Emails:           ${totalEmails || 0}`);
  console.log(`Classified:             ${classified || 0}`);
  console.log(`Entities Extracted:     ${entities || 0}`);
  console.log(`Needs Classification:   ${(totalEmails || 0) - (classified || 0)}`);

  console.log('\n✓ Ready to run classification and entity extraction!');
})();
