import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

(async () => {
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('mime_type, extraction_status, filename')
    .order('mime_type');

  // Group by mime_type
  const grouped = attachments?.reduce((acc: any, att: any) => {
    if (!acc[att.mime_type]) {
      acc[att.mime_type] = { total: 0, pending: 0, completed: 0, failed: 0, examples: [] };
    }
    acc[att.mime_type].total++;
    acc[att.mime_type][att.extraction_status]++;
    if (acc[att.mime_type].examples.length < 3) {
      acc[att.mime_type].examples.push(att.filename);
    }
    return acc;
  }, {});

  console.log('=== ATTACHMENTS BY TYPE ===\n');
  Object.entries(grouped || {}).forEach(([mimeType, stats]: [string, any]) => {
    console.log(`${mimeType}:`);
    console.log(`  Total: ${stats.total}`);
    console.log(`  Pending: ${stats.pending}, Completed: ${stats.completed}, Failed: ${stats.failed}`);
    console.log(`  Examples: ${stats.examples.join(', ')}\n`);
  });
})();
