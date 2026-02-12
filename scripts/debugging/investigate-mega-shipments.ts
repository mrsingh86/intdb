import * as dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(process.cwd(), '.env') });
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function investigate(bookingNumber: string): Promise<void> {
  console.log('='.repeat(60));
  console.log(`INVESTIGATE: ${bookingNumber}`);
  console.log('='.repeat(60));

  const { data: shipments, error: shipErr } = await supabase
    .from('shipments')
    .select('id, booking_number, mbl_number, carrier_name, created_at')
    .eq('booking_number', bookingNumber);

  if (shipErr) {
    console.log('Error:', shipErr.message);
    return;
  }
  if (!shipments || shipments.length === 0) {
    console.log('NOT FOUND - trying ilike...');
    const { data: fuzzy } = await supabase
      .from('shipments')
      .select('id, booking_number')
      .ilike('booking_number', `%${bookingNumber}%`)
      .limit(5);
    console.log('Fuzzy results:', JSON.stringify(fuzzy));
    return;
  }
  const shipment = shipments[0];
  console.log('Shipment:', JSON.stringify(shipment, null, 2));

  // Fetch all chronicles
  const { data: chronicles } = await supabase
    .from('chronicle')
    .select('id, linked_by, thread_id, document_type, subject, booking_number, occurred_at')
    .eq('shipment_id', shipment.id)
    .order('occurred_at', { ascending: true });

  if (!chronicles) return;

  console.log(`\nTotal chronicles: ${chronicles.length}`);

  // By linked_by
  const byMethod: Record<string, number> = {};
  for (const c of chronicles) {
    const m = c.linked_by || 'unknown';
    byMethod[m] = (byMethod[m] || 0) + 1;
  }
  console.log('\nBy linking method:');
  for (const [m, ct] of Object.entries(byMethod).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${m}: ${ct}`);
  }

  // By document_type
  const byDoc: Record<string, number> = {};
  for (const c of chronicles) {
    const d = c.document_type || 'null';
    byDoc[d] = (byDoc[d] || 0) + 1;
  }
  console.log('\nBy document_type:');
  for (const [d, ct] of Object.entries(byDoc).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${d}: ${ct}`);
  }

  // Unique threads
  const threads = new Set(chronicles.map(c => c.thread_id));
  console.log(`\nUnique Gmail threads: ${threads.size}`);

  // Unique booking numbers stored
  const bookings = new Set(chronicles.map(c => c.booking_number).filter(Boolean));
  console.log(`Unique booking numbers in chronicles: ${bookings.size}`);
  for (const b of bookings) console.log(`  ${b}`);

  // Date range
  const dates = chronicles.map(c => c.occurred_at).filter(Boolean).sort();
  console.log(`\nDate range: ${dates[0]?.substring(0, 10)} → ${dates[dates.length - 1]?.substring(0, 10)}`);

  // Sample subjects
  console.log('\nFirst 5 subjects:');
  for (const c of chronicles.slice(0, 5)) {
    console.log(`  [${c.linked_by || '?'}] ${(c.subject || '').substring(0, 90)}`);
  }
  console.log('\nLast 5 subjects:');
  for (const c of chronicles.slice(-5)) {
    console.log(`  [${c.linked_by || '?'}] ${(c.subject || '').substring(0, 90)}`);
  }

  // Thread-linked breakdown
  const threadLinked = chronicles.filter(c => c.linked_by === 'thread');
  const threadMatchBooking = threadLinked.filter(c => c.booking_number === bookingNumber).length;
  const threadDiffBooking = threadLinked.filter(c => c.booking_number && c.booking_number !== bookingNumber).length;
  const threadNullBooking = threadLinked.filter(c => !c.booking_number).length;
  console.log(`\nThread-linked breakdown (${threadLinked.length} total):`);
  console.log(`  Booking matches shipment: ${threadMatchBooking}`);
  console.log(`  Booking DIFFERS from shipment: ${threadDiffBooking}`);
  console.log(`  Booking is NULL: ${threadNullBooking}`);

  // Top threads by chronicle count
  const threadCounts: Record<string, number> = {};
  for (const c of chronicles) {
    threadCounts[c.thread_id] = (threadCounts[c.thread_id] || 0) + 1;
  }
  const topThreads = Object.entries(threadCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log(`\nTop 10 threads by chronicle count:`);
  for (const [tid, ct] of topThreads) {
    // Get a sample subject from this thread
    const sample = chronicles.find(c => c.thread_id === tid);
    console.log(`  ${tid.substring(0, 16)}... (${ct} records): ${(sample?.subject || '').substring(0, 70)}`);
  }
}

async function main(): Promise<void> {
  await investigate('8810432530');
  console.log('\n\n');
  await investigate('7006150312');
}

main().catch(console.error);
