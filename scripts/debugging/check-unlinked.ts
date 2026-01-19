import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function main() {
  // Check link candidates
  const { data: candidates, count } = await supabase
    .from('shipment_link_candidates')
    .select('*', { count: 'exact' });

  console.log('Link candidates count:', count);
  
  if (candidates && candidates.length > 0) {
    console.log('\nCandidates:');
    for (const c of candidates) {
      console.log('  - status:', c.status, 'confidence:', c.confidence_score);
    }
  }

  // Check how many emails are classified but NOT linked
  const { data: allEmails } = await supabase.from('raw_emails').select('id');
  const { data: linkedDocs } = await supabase.from('shipment_documents').select('email_id');
  const { data: classifications } = await supabase.from('document_classifications').select('email_id, document_type');

  const linkedSet = new Set(linkedDocs?.map(d => d.email_id).filter(Boolean));
  const classifiedMap = new Map(classifications?.map(c => [c.email_id, c.document_type]));

  let classifiedNotLinked = 0;
  let shippingNotLinked = 0;
  const unlinkedByType = new Map<string, number>();

  for (const e of allEmails || []) {
    const docType = classifiedMap.get(e.id);
    if (docType && !linkedSet.has(e.id)) {
      classifiedNotLinked++;
      if (docType !== 'not_shipping' && docType !== 'unknown' && docType !== 'general_correspondence') {
        shippingNotLinked++;
        unlinkedByType.set(docType, (unlinkedByType.get(docType) || 0) + 1);
      }
    }
  }

  console.log('\nEmails classified but NOT linked:', classifiedNotLinked);
  console.log('Shipping docs not linked (excl non-shipping/unknown/correspondence):', shippingNotLinked);
  console.log('\nUnlinked by document type:');
  [...unlinkedByType.entries()].sort((a,b) => b[1] - a[1]).forEach(([type, count]) => {
    console.log('  ' + type + ': ' + count);
  });
}

main().catch(console.error);
