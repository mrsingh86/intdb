/**
 * Analyze Carrier Email Formats
 *
 * Examines email structure for Maersk, MSC, and other carriers
 * to understand their date/cutoff/deadline format patterns.
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function analyzeCarrierFormats() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         ANALYZE CARRIER EMAIL FORMATS                             ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Count emails by carrier
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, body_text')
    .order('received_at', { ascending: false });

  if (error || !emails) {
    console.error('Error fetching emails:', error);
    return;
  }

  // Categorize by carrier
  const carriers: Record<string, any[]> = {
    'Hapag-Lloyd': [],
    'Maersk': [],
    'MSC': [],
    'CMA CGM': [],
    'Intoglo': [],
    'Other': []
  };

  for (const email of emails) {
    const sender = email.sender_email?.toLowerCase() || '';
    if (sender.includes('hlag') || sender.includes('hapag')) {
      carriers['Hapag-Lloyd'].push(email);
    } else if (sender.includes('maersk')) {
      carriers['Maersk'].push(email);
    } else if (sender.includes('msc') || sender.includes('medlog')) {
      carriers['MSC'].push(email);
    } else if (sender.includes('cma-cgm') || sender.includes('cmacgm')) {
      carriers['CMA CGM'].push(email);
    } else if (sender.includes('intoglo')) {
      carriers['Intoglo'].push(email);
    } else {
      carriers['Other'].push(email);
    }
  }

  console.log('Email Distribution by Carrier:');
  console.log('─'.repeat(40));
  for (const [carrier, emails] of Object.entries(carriers)) {
    console.log(`  ${carrier.padEnd(15)} ${emails.length} emails`);
  }
  console.log('');

  // Analyze each carrier format
  for (const [carrier, emails] of Object.entries(carriers)) {
    if (emails.length === 0 || carrier === 'Intoglo' || carrier === 'Other') continue;

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`CARRIER: ${carrier} (${emails.length} emails)`);
    console.log('═'.repeat(70));

    // Sample up to 3 emails
    const samples = emails.slice(0, 3);

    for (let i = 0; i < samples.length; i++) {
      const email = samples[i];
      const body = email.body_text || '';

      console.log(`\n[Sample ${i + 1}] ${email.subject?.substring(0, 60)}...`);
      console.log(`From: ${email.sender_email}`);

      // Look for key sections
      const sections = {
        'Deadline/Cutoff': findSection(body, ['deadline', 'cut-off', 'cutoff', 'closing']),
        'Vessel/Voyage': findSection(body, ['vessel', 'voyage']),
        'ETD/ETA': findSection(body, ['etd', 'eta', 'departure', 'arrival']),
        'Container': findSection(body, ['container', 'equipment']),
        'Port': findSection(body, ['port of loading', 'port of discharge', 'pol', 'pod']),
      };

      for (const [sectionName, content] of Object.entries(sections)) {
        if (content) {
          console.log(`\n  📌 ${sectionName}:`);
          console.log(`     ${content.substring(0, 300)}...`);
        }
      }

      // Extract date patterns found
      const datePatterns = findDatePatterns(body);
      if (datePatterns.length > 0) {
        console.log(`\n  📅 Date Patterns Found:`);
        datePatterns.slice(0, 5).forEach(d => console.log(`     ${d}`));
      }
    }
  }

  console.log('\n\n' + '═'.repeat(70));
  console.log('RECOMMENDATIONS');
  console.log('═'.repeat(70));

  // Check what's missing from booking confirmations
  const { data: bookings } = await supabase
    .from('document_classifications')
    .select(`
      email_id,
      document_type,
      raw_emails!inner(subject, sender_email)
    `)
    .eq('document_type', 'booking_confirmation');

  if (bookings) {
    console.log(`\nBooking Confirmations: ${bookings.length}`);

    // Check entity extraction for each
    for (const booking of bookings.slice(0, 10)) {
      const { data: entities } = await supabase
        .from('entity_extractions')
        .select('entity_type, entity_value')
        .eq('email_id', booking.email_id);

      const entityTypes = entities?.map(e => e.entity_type) || [];
      const missing = ['etd', 'eta', 'si_cutoff', 'vgm_cutoff'].filter(t => !entityTypes.includes(t));

      if (missing.length > 0) {
        const sender = (booking as any).raw_emails?.sender_email || 'unknown';
        console.log(`\n  ❌ ${(booking as any).raw_emails?.subject?.substring(0, 50)}...`);
        console.log(`     Carrier: ${sender}`);
        console.log(`     Missing: ${missing.join(', ')}`);
        console.log(`     Has: ${entityTypes.join(', ')}`);
      }
    }
  }
}

function findSection(body: string, keywords: string[]): string | null {
  const lowerBody = body.toLowerCase();

  for (const keyword of keywords) {
    const idx = lowerBody.indexOf(keyword);
    if (idx !== -1) {
      return body.substring(idx, idx + 400).trim();
    }
  }
  return null;
}

function findDatePatterns(body: string): string[] {
  const patterns = [
    /\d{1,2}-[A-Za-z]{3}-\d{4}(?:\s+\d{2}:\d{2})?/g,  // DD-Mon-YYYY HH:MM
    /\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2})?/g,      // ISO format
    /\d{1,2}\/\d{1,2}\/\d{4}/g,                        // DD/MM/YYYY
    /[A-Za-z]{3}\s+\d{1,2},?\s+\d{4}/g,               // Mon DD, YYYY
  ];

  const found: string[] = [];
  for (const pattern of patterns) {
    const matches = body.match(pattern);
    if (matches) {
      found.push(...matches);
    }
  }
  return [...new Set(found)];
}

analyzeCarrierFormats().catch(console.error);
