/**
 * Show Missing Document Alerts
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function showAlerts() {
  // Get all alerts with shipment info
  const { data: alerts, count } = await supabase
    .from('missing_document_alerts')
    .select('*, shipments(booking_number)', { count: 'exact' })
    .order('created_at', { ascending: false });

  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('                              MISSING DOCUMENT ALERTS');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('Total alerts:', count);
  console.log('');

  // Group by document type
  const byDocType: Record<string, any[]> = {};
  for (const alert of alerts || []) {
    const docType = alert.document_type;
    if (!byDocType[docType]) byDocType[docType] = [];
    byDocType[docType].push(alert);
  }

  console.log('BY DOCUMENT TYPE:');
  console.log('─'.repeat(60));
  for (const [docType, items] of Object.entries(byDocType).sort((a, b) => b[1].length - a[1].length)) {
    const pct = Math.round((items.length / (count || 1)) * 100);
    const bar = '█'.repeat(Math.floor(pct / 2));
    console.log(`  ${docType.padEnd(25)} │ ${String(items.length).padStart(3)} (${String(pct).padStart(2)}%) ${bar}`);
  }

  // Group by status
  const byStatus: Record<string, number> = {};
  for (const alert of alerts || []) {
    const status = alert.alert_status || 'unknown';
    byStatus[status] = (byStatus[status] || 0) + 1;
  }

  console.log('');
  console.log('BY STATUS:');
  console.log('─'.repeat(60));
  for (const [status, cnt] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status.padEnd(20)} │ ${cnt}`);
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('ALERT DETAILS (showing all):');
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('BOOKING #'.padEnd(25) + '│ MISSING DOCUMENT'.padEnd(25) + '│ STATUS'.padEnd(12) + '│ REASON');
  console.log('─'.repeat(25) + '┼' + '─'.repeat(25) + '┼' + '─'.repeat(12) + '┼' + '─'.repeat(40));

  for (const alert of alerts || []) {
    const booking = (alert.shipments as any)?.booking_number || 'N/A';
    const docType = alert.document_type || '';
    const status = alert.alert_status || '';
    const desc = (alert.document_description || '').replace('Missing prerequisite: ', '');

    console.log(
      booking.substring(0, 23).padEnd(25) + '│ ' +
      docType.padEnd(24) + '│ ' +
      status.padEnd(11) + '│ ' +
      desc.substring(0, 40)
    );
  }

  console.log('─'.repeat(25) + '┴' + '─'.repeat(25) + '┴' + '─'.repeat(12) + '┴' + '─'.repeat(40));
  console.log('');
  console.log(`Total: ${count} alerts`);
  console.log('════════════════════════════════════════════════════════════════════════════════════════════════════');
}

showAlerts().catch(console.error);
