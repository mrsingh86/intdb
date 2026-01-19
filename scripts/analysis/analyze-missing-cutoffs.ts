#!/usr/bin/env npx tsx
/**
 * Analyze why shipments are missing cutoffs
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function analyzeGaps() {
  // Get shipments missing ALL cutoffs
  const { data: missing } = await supabase
    .from('shipments')
    .select('id, booking_number')
    .is('si_cutoff', null)
    .is('vgm_cutoff', null)
    .is('cargo_cutoff', null);

  console.log('Shipments missing ALL cutoffs:', missing?.length);

  // Get entity extractions for these shipments
  const bookingNumbers = missing?.map(s => s.booking_number).filter(Boolean) || [];

  const { data: extractions } = await supabase
    .from('entity_extractions')
    .select('email_id, booking_number')
    .in('booking_number', bookingNumbers.slice(0, 100));

  console.log('Linked emails via entity_extraction:', extractions?.length);

  // Get document classifications for linked emails
  const emailIds = [...new Set(extractions?.map(e => e.email_id) || [])];

  if (emailIds.length > 0) {
    const { data: classifications } = await supabase
      .from('document_classifications')
      .select('document_type')
      .in('email_id', emailIds);

    // Count by type
    const byType: Record<string, number> = {};
    classifications?.forEach(c => {
      byType[c.document_type] = (byType[c.document_type] || 0) + 1;
    });

    console.log('\nDocument types for missing cutoff shipments:');
    Object.entries(byType)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => console.log('  ' + type + ': ' + count));
  }

  // Count shipments with no related emails
  let noEmailCount = 0;
  let hasEmailNoCutoffs = 0;

  console.log('\n=== ANALYZING EACH SHIPMENT ===');

  for (const shipment of (missing || []).slice(0, 50)) {
    const bn = shipment.booking_number;
    if (!bn || bn.length < 6) {
      noEmailCount++;
      continue;
    }

    // Search for emails with this booking number
    const searchTerm = bn.substring(0, 8);
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, subject, body_text')
      .or(`subject.ilike.%${searchTerm}%,body_text.ilike.%${searchTerm}%`)
      .limit(3);

    if (!emails || emails.length === 0) {
      noEmailCount++;
    } else {
      hasEmailNoCutoffs++;

      // Check if emails have cutoff keywords
      let hasCutoffKeywords = false;
      for (const email of emails) {
        const text = (email.body_text || '').toLowerCase();
        if (text.includes('cut-off') || text.includes('cutoff') || text.includes('closing')) {
          hasCutoffKeywords = true;
          break;
        }
      }

      if (hasEmailNoCutoffs <= 5) {
        console.log(`\n${bn}:`);
        console.log('  Emails found:', emails.length);
        console.log('  Has cutoff keywords:', hasCutoffKeywords);
        emails.forEach(e => console.log('  Subject:', e.subject?.substring(0, 60)));
      }
    }
  }

  console.log('\n=== SUMMARY (first 50) ===');
  console.log('No related emails:', noEmailCount);
  console.log('Has emails but no cutoffs extracted:', hasEmailNoCutoffs);

  // Get booking confirmations count
  const { count: bcCount } = await supabase
    .from('document_classifications')
    .select('*', { count: 'exact', head: true })
    .eq('document_type', 'booking_confirmation');

  console.log('\nTotal booking confirmations in system:', bcCount);
}

analyzeGaps().catch(console.error);
