/**
 * Extract ETD from Hapag-Lloyd Vessel Section
 *
 * Hapag-Lloyd booking confirmations have ETD/ETA in the Vessel section:
 * Vessel
 * NAGOYA EXPRESS
 * DP Voyage: 672483
 * ...
 * 27-Dec-2025 23:00  ← ETD
 * 31-Jan-2026 13:00  ← ETA
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

// Parse DD-Mon-YYYY format to ISO
function parseHapagDate(dateStr: string): string | null {
  const match = dateStr.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})\s*(\d{2}:\d{2})?/);
  if (!match) return null;

  const [_, day, monthAbbr, year, time] = match;
  const months: Record<string, string> = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
    'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
    'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
  };

  const month = months[monthAbbr];
  if (!month) return null;

  const timeStr = time || '00:00';
  return `${year}-${month}-${day.padStart(2, '0')}T${timeStr}:00`;
}

async function extractEtdFromVesselSection() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         EXTRACT ETD FROM HAPAG-LLOYD VESSEL SECTION               ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Find Hapag-Lloyd booking confirmations without ETD
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select(`
      id,
      subject,
      body_text,
      document_classifications!inner(id, document_type)
    `)
    .like('subject', 'HL-%')
    .eq('document_classifications.document_type', 'booking_confirmation');

  if (error || !emails) {
    console.error('Error fetching emails:', error);
    return;
  }

  console.log(`Found ${emails.length} Hapag-Lloyd booking confirmations\n`);

  let processed = 0;
  let extracted = 0;

  for (const email of emails) {
    const bodyText = email.body_text || '';

    // Check if ETD already extracted
    const { data: existingEtd } = await supabase
      .from('entity_extractions')
      .select('id')
      .eq('email_id', email.id)
      .eq('entity_type', 'etd')
      .single();

    if (existingEtd) {
      console.log(`[${processed + 1}/${emails.length}] ${email.subject?.substring(0, 40)}... - ETD exists, skipping`);
      processed++;
      continue;
    }

    // Find Vessel section and extract dates
    const vesselIdx = bodyText.indexOf('Vessel');
    if (vesselIdx === -1) {
      console.log(`[${processed + 1}/${emails.length}] ${email.subject?.substring(0, 40)}... - No Vessel section`);
      processed++;
      continue;
    }

    const vesselSection = bodyText.substring(vesselIdx, vesselIdx + 500);

    // Find all DD-Mon-YYYY dates in vessel section
    const datePattern = /(\d{1,2}-[A-Za-z]{3}-\d{4})\s*\n?\s*(\d{2}:\d{2})?/g;
    const dates: string[] = [];
    let match;

    while ((match = datePattern.exec(vesselSection)) !== null) {
      const dateStr = match[1] + (match[2] ? ' ' + match[2] : '');
      const parsed = parseHapagDate(dateStr);
      if (parsed) dates.push(parsed);
    }

    if (dates.length < 2) {
      console.log(`[${processed + 1}/${emails.length}] ${email.subject?.substring(0, 40)}... - Less than 2 dates found`);
      processed++;
      continue;
    }

    // First date is ETD, second is ETA
    const etd = dates[0];
    const eta = dates[1];

    console.log(`[${processed + 1}/${emails.length}] ${email.subject?.substring(0, 40)}...`);
    console.log(`  ETD: ${etd}, ETA: ${eta}`);

    // Get classification ID
    const classificationId = (email as any).document_classifications[0]?.id;

    // Insert ETD entity
    const { error: etdError } = await supabase
      .from('entity_extractions')
      .insert({
        email_id: email.id,
        classification_id: classificationId,
        entity_type: 'etd',
        entity_value: etd,
        confidence_score: 90,
        extraction_method: 'pattern_extraction',
        source_document_type: 'booking_confirmation'
      });

    if (!etdError) {
      extracted++;
      console.log(`  ✅ ETD extracted`);
    } else {
      console.error(`  ❌ Error:`, etdError.message);
    }

    processed++;
  }

  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                         SUMMARY                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
  console.log(`✅ Emails processed:  ${processed}`);
  console.log(`✅ ETDs extracted:    ${extracted}`);
  console.log('\n🎉 Done! Run shipment resync to update shipments.\n');
}

extractEtdFromVesselSection().catch(console.error);
