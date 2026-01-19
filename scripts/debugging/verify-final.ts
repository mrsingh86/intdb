import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  // Total shipments
  const { count: shipmentCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  // Total linked documents
  const { count: docCount } = await supabase
    .from('shipment_documents')
    .select('*', { count: 'exact', head: true });

  // Linked emails
  const { data: linkedEmails } = await supabase
    .from('shipment_documents')
    .select('email_id');
  const uniqueLinkedEmails = new Set(linkedEmails?.map(d => d.email_id) || []).size;

  // Total emails
  const { count: emailCount } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true });

  console.log('=== FINAL STATUS ===\n');
  console.log('Total Shipments:', shipmentCount);
  console.log('Total Documents Linked:', docCount);
  console.log('Unique Emails Linked:', uniqueLinkedEmails);
  console.log('Total Emails:', emailCount);
  console.log('Link Rate:', ((uniqueLinkedEmails / (emailCount || 1)) * 100).toFixed(1) + '%');
}
main().catch(console.error);
