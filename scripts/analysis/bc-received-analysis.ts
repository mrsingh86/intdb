/**
 * Analyze booking_confirmation_received coverage
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const PAGE_SIZE = 1000;

async function fetchAll<T>(table: string, select: string): Promise<T[]> {
  let all: T[] = [];
  let page = 0;
  let hasMore = true;
  while (hasMore) {
    const { data } = await supabase.from(table).select(select).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (data && data.length > 0) {
      all = all.concat(data as T[]);
      hasMore = data.length === PAGE_SIZE;
      page++;
    } else {
      hasMore = false;
    }
  }
  return all;
}

async function main() {
  console.log('Fetching data...');

  const [shipments, docs, emails, classifications] = await Promise.all([
    fetchAll<{ id: string; booking_number: string }>('shipments', 'id,booking_number'),
    fetchAll<{ shipment_id: string; email_id: string; document_type: string }>('shipment_documents', 'shipment_id,email_id,document_type'),
    fetchAll<{ id: string; sender_email: string }>('raw_emails', 'id,sender_email'),
    fetchAll<{ email_id: string; document_type: string }>('document_classifications', 'email_id,document_type'),
  ]);

  console.log('Shipments:', shipments.length);
  console.log('Linked docs:', docs.length);
  console.log('Emails:', emails.length);
  console.log('Classifications:', classifications.length);

  // Create lookups
  const emailMap = new Map(emails.map(e => [e.id, e.sender_email || '']));
  const classMap = new Map(classifications.map(c => [c.email_id, c.document_type]));

  // Helper to check direction
  const isFromIntoglo = (sender: string): boolean => {
    const s = sender.toLowerCase();
    return s.includes('@intoglo.com') || s.includes('@intoglo.in');
  };

  const isFromCarrier = (sender: string): boolean => {
    const s = sender.toLowerCase();
    return s.includes('maersk') || s.includes('hlag') || s.includes('cma-cgm') ||
           s.includes('hapag') || s.includes('msc.com') || s.includes('evergreen') ||
           s.includes('cosco') || s.includes('one-line') || s.includes('yangming');
  };

  // Analyze BC documents
  const bcDocs = docs.filter(d => {
    const docType = classMap.get(d.email_id) || d.document_type;
    return docType === 'booking_confirmation' || docType === 'booking_amendment';
  });

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('     BOOKING CONFIRMATION ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Total BC/Amendment documents linked:', bcDocs.length);

  // Categorize by sender
  const categories = {
    fromCarrier: new Set<string>(),
    fromIntoglo: new Set<string>(),
    fromCustomer: new Set<string>(),
    unknownSender: new Set<string>(),
  };

  const senderDomains: Record<string, number> = {};

  for (const d of bcDocs) {
    const sender = emailMap.get(d.email_id) || '';
    const domain = sender.includes('@') ? sender.split('@')[1]?.toLowerCase().split('>')[0] : 'unknown';
    senderDomains[domain] = (senderDomains[domain] || 0) + 1;

    if (!sender || sender === '') {
      categories.unknownSender.add(d.shipment_id);
    } else if (isFromIntoglo(sender)) {
      categories.fromIntoglo.add(d.shipment_id);
    } else if (isFromCarrier(sender)) {
      categories.fromCarrier.add(d.shipment_id);
    } else {
      categories.fromCustomer.add(d.shipment_id);
    }
  }

  console.log('');
  console.log('BC Documents by sender domain:');
  console.log('─'.repeat(60));
  Object.entries(senderDomains)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([domain, count]) => {
      let type = '';
      if (domain.includes('intoglo')) type = '→ OUTBOUND (shared)';
      else if (domain.includes('maersk') || domain.includes('hlag') || domain.includes('cma')) type = '→ INBOUND (carrier)';
      else if (domain === 'unknown') type = '→ MISSING SENDER';
      else type = '→ INBOUND (customer/other)';
      console.log('  ' + domain.padEnd(30) + count.toString().padStart(5) + '  ' + type);
    });

  console.log('');
  console.log('Shipments by BC source (unique):');
  console.log('─'.repeat(60));
  console.log('  From carrier (INBOUND - received):'.padEnd(45) + categories.fromCarrier.size.toString().padStart(5));
  console.log('  From Intoglo (OUTBOUND - shared):'.padEnd(45) + categories.fromIntoglo.size.toString().padStart(5));
  console.log('  From customer/other (INBOUND):'.padEnd(45) + categories.fromCustomer.size.toString().padStart(5));
  console.log('  Unknown/missing sender:'.padEnd(45) + categories.unknownSender.size.toString().padStart(5));

  // Calculate coverage
  const totalShipments = shipments.length;
  const withBCReceived = new Set([...categories.fromCarrier, ...categories.fromCustomer]);
  const withBCShared = categories.fromIntoglo;

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('     COVERAGE SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Total shipments:', totalShipments);
  console.log('');
  console.log('booking_confirmation_received:'.padEnd(40) + withBCReceived.size.toString().padStart(5) + '  (' + ((withBCReceived.size / totalShipments) * 100).toFixed(0) + '%)');
  console.log('booking_confirmation_shared:'.padEnd(40) + withBCShared.size.toString().padStart(5) + '  (' + ((withBCShared.size / totalShipments) * 100).toFixed(0) + '%)');

  // Why not 100%?
  const missingReceived = shipments.filter(s => !withBCReceived.has(s.id));
  console.log('');
  console.log('Shipments WITHOUT BC received:', missingReceived.length);

  // Check if they have any BC at all
  const allBCShipments = new Set(bcDocs.map(d => d.shipment_id));
  const hasNoBCAtAll = missingReceived.filter(s => !allBCShipments.has(s.id));
  const hasBCButNotFromCarrier = missingReceived.filter(s => allBCShipments.has(s.id));

  console.log('  - Has NO BC linked at all:', hasNoBCAtAll.length);
  console.log('  - Has BC but only from Intoglo (shared only):', hasBCButNotFromCarrier.length);

  console.log('');
  console.log('ROOT CAUSE:');
  console.log('─'.repeat(60));
  console.log('Many shipments were created from the FORWARDED/SHARED email');
  console.log('(Intoglo sharing BC with customer) rather than the ORIGINAL');
  console.log('carrier email. The original carrier BC email may exist but');
  console.log('is not linked to the shipment.');
}

main().catch(console.error);
