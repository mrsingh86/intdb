#!/usr/bin/env npx tsx
/**
 * Analyze document types for shipments missing cutoffs
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function analyze() {
  // Get shipments missing ALL cutoffs
  const { data: missing } = await supabase
    .from('shipments')
    .select('id, booking_number')
    .is('si_cutoff', null)
    .is('vgm_cutoff', null)
    .is('cargo_cutoff', null);

  console.log('=== SHIPMENTS MISSING ALL CUTOFFS: ' + (missing?.length || 0) + ' ===\n');

  const stats = {
    hasBookingConfirmation: 0,
    onlyOtherDocTypes: 0,
    noRelatedEmails: 0,
    total: missing?.length || 0
  };

  const docTypeCounts: Record<string, number> = {};

  for (const shipment of missing || []) {
    const bn = shipment.booking_number;
    if (!bn || bn.length < 6) {
      stats.noRelatedEmails++;
      continue;
    }

    // Find related emails
    const searchTerm = bn.substring(0, 8);
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id')
      .or(`subject.ilike.%${searchTerm}%,body_text.ilike.%${searchTerm}%`)
      .limit(10);

    if (!emails || emails.length === 0) {
      stats.noRelatedEmails++;
      continue;
    }

    // Get document types for these emails
    const emailIds = emails.map(e => e.id);
    const { data: classifications } = await supabase
      .from('document_classifications')
      .select('document_type')
      .in('email_id', emailIds);

    const types = classifications?.map(c => c.document_type) || [];
    types.forEach(t => {
      docTypeCounts[t] = (docTypeCounts[t] || 0) + 1;
    });

    if (types.includes('booking_confirmation')) {
      stats.hasBookingConfirmation++;
    } else {
      stats.onlyOtherDocTypes++;
    }
  }

  console.log('BREAKDOWN:');
  console.log('  Has booking_confirmation but no cutoffs:', stats.hasBookingConfirmation);
  console.log('  Only has other document types:', stats.onlyOtherDocTypes);
  console.log('  No related emails found:', stats.noRelatedEmails);

  console.log('\nDOCUMENT TYPE DISTRIBUTION:');
  Object.entries(docTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => console.log('  ' + type + ': ' + count));

  // Now focus on shipments that HAVE booking confirmations but STILL no cutoffs
  console.log('\n=== SHIPMENTS WITH BOOKING CONF BUT NO CUTOFFS ===');
  console.log('(These are the extraction failures)\n');

  let sampled = 0;
  for (const shipment of missing || []) {
    if (sampled >= 10) break;
    const bn = shipment.booking_number;
    if (!bn || bn.length < 6) continue;

    const searchTerm = bn.substring(0, 8);
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, subject, body_text')
      .or(`subject.ilike.%${searchTerm}%`)
      .limit(5);

    if (!emails || emails.length === 0) continue;

    const emailIds = emails.map(e => e.id);
    const { data: classifications } = await supabase
      .from('document_classifications')
      .select('document_type, email_id')
      .in('email_id', emailIds);

    const hasBookingConf = classifications?.some(c => c.document_type === 'booking_confirmation');
    if (!hasBookingConf) continue;

    sampled++;
    const bcEmail = emails.find(e =>
      classifications?.find(c => c.email_id === e.id && c.document_type === 'booking_confirmation')
    );

    console.log(`${sampled}. Booking: ${bn}`);
    if (bcEmail) {
      console.log('   Subject:', bcEmail.subject?.substring(0, 70));
      const body = bcEmail.body_text || '';
      const hasEmbeddedPdf = body.includes('=== ') && body.includes('.pdf');
      const hasCutoffKw = body.toLowerCase().includes('cut') || body.toLowerCase().includes('closing');
      console.log('   Body length:', body.length);
      console.log('   Has embedded PDF:', hasEmbeddedPdf);
      console.log('   Has cutoff keywords:', hasCutoffKw);

      if (hasCutoffKw) {
        // Extract sample cutoff text
        const lines = body.split('\n');
        const cutoffLines = lines.filter(l =>
          l.toLowerCase().includes('cut') || l.toLowerCase().includes('closing')
        ).slice(0, 3);
        cutoffLines.forEach(l => console.log('     >', l.trim().substring(0, 80)));
      }
    }
    console.log('');
  }
}

analyze().catch(console.error);
