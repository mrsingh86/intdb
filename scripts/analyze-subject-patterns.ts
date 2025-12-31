#!/usr/bin/env npx tsx
/**
 * Analyze shipping line subject patterns for deterministic classification
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('╔════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║            SHIPPING LINE SUBJECT PATTERN ANALYSIS                              ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════╝\n');

  // Get all emails from shipping lines
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email');

  const shippingLines: Record<string, { emails: any[]; patterns: Record<string, number> }> = {
    'Maersk': { emails: [], patterns: {} },
    'Hapag-Lloyd': { emails: [], patterns: {} },
    'CMA CGM': { emails: [], patterns: {} },
    'COSCO': { emails: [], patterns: {} },
    'MSC': { emails: [], patterns: {} },
  };

  // Categorize by shipping line
  for (const e of emails || []) {
    const sender = (e.true_sender_email || e.sender_email || '').toLowerCase();

    if (sender.includes('maersk.com')) {
      shippingLines['Maersk'].emails.push(e);
    } else if (sender.includes('hapag') || sender.includes('hlag')) {
      shippingLines['Hapag-Lloyd'].emails.push(e);
    } else if (sender.includes('cma-cgm')) {
      shippingLines['CMA CGM'].emails.push(e);
    } else if (sender.includes('coscon')) {
      shippingLines['COSCO'].emails.push(e);
    } else if (sender.includes('msc.com')) {
      shippingLines['MSC'].emails.push(e);
    }
  }

  // Analyze patterns for each shipping line
  for (const [carrier, data] of Object.entries(shippingLines)) {
    console.log('\n' + '═'.repeat(80));
    console.log('📧 ' + carrier + ' (' + data.emails.length + ' emails)');
    console.log('═'.repeat(80));

    // Extract subject prefixes/patterns
    const subjectStarts: Record<string, number> = {};
    const keywordCounts: Record<string, number> = {};

    for (const e of data.emails) {
      const subject = e.subject || '';

      // First 30 chars normalized
      let prefix = subject.substring(0, 40).trim();
      // Remove booking numbers
      prefix = prefix.replace(/[A-Z0-9]{8,}/g, 'XXX');
      prefix = prefix.replace(/\d{6,}/g, 'NNN');

      subjectStarts[prefix] = (subjectStarts[prefix] || 0) + 1;

      // Keywords
      const lower = subject.toLowerCase();
      const keywords = [
        'booking confirmation', 'booking confirmed', 'booking request',
        'amendment', 'update', 'revised', 'cancellation', 'cancelled',
        'arrival notice', 'shipping instruction', 'si draft', 'bill of lading',
        'invoice', 'vgm', 'container', 'vessel', 'schedule'
      ];

      for (const kw of keywords) {
        if (lower.includes(kw)) {
          keywordCounts[kw] = (keywordCounts[kw] || 0) + 1;
        }
      }
    }

    // Show top patterns
    console.log('\nTop Subject Patterns:');
    const sortedPatterns = Object.entries(subjectStarts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15);

    for (const [pattern, count] of sortedPatterns) {
      console.log('  [' + count + '] ' + pattern);
    }

    // Show keyword distribution
    console.log('\nKeyword Distribution:');
    const sortedKeywords = Object.entries(keywordCounts)
      .sort((a, b) => b[1] - a[1]);

    for (const [kw, count] of sortedKeywords) {
      const pct = Math.round((count / data.emails.length) * 100);
      console.log('  ' + kw.padEnd(25) + ': ' + count + ' (' + pct + '%)');
    }
  }

  // Propose deterministic rules
  console.log('\n\n' + '═'.repeat(80));
  console.log('📋 PROPOSED DETERMINISTIC CLASSIFICATION RULES');
  console.log('═'.repeat(80));

  console.log(`
MAERSK:
  booking_confirmation: subject matches "Booking Confirmation" from maersk.com
  booking_amendment: subject contains "amendment" OR "revised" OR "update" from maersk.com
  arrival_notice: subject contains "Arrival Notice" from maersk.com

HAPAG-LLOYD:
  booking_confirmation: subject matches HL-XXXXXXX pattern from hlag.com
  booking_amendment: subject contains number + "amendment" from hlag.com
  invoice: PDF filename starts with "INVP" from hlag.com

CMA CGM:
  booking_confirmation: subject starts with "CMA CGM - Booking confirmation" from cma-cgm.com
  booking_amendment: subject contains "amendment" from cma-cgm.com
  arrival_notice: subject contains "Arrival Notice" from cma-cgm.com

COSCO:
  booking_confirmation: subject starts with "Cosco Shipping Line Booking Confirmation" from coscon.com
  arrival_notice: subject contains "Shipment Notice" from coscon.com

MSC:
  booking_confirmation: subject contains booking number pattern from msc.com
`);
}

main().catch(console.error);
