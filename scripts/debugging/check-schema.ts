import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

(async () => {
  // Check schema by trying to select all columns
  const { data, error } = await supabase
    .from('raw_emails')
    .select('*')
    .limit(1);

  if (error) {
    console.error('Error:', error);
    return;
  }

  console.log('Available columns:', data?.[0] ? Object.keys(data[0]) : 'No data');
})();
