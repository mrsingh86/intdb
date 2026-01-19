/**
 * Analyze PDF extraction quality by carrier and document type
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function analyzeExtractionQuality() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('PDF EXTRACTION QUALITY BY CARRIER & DOCUMENT TYPE');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  console.log('Loading data...');

  // Get emails with extracted PDFs
  const { data: attachments, error: attError } = await supabase
    .from('raw_attachments')
    .select('id, filename, extracted_text, email_id')
    .not('extracted_text', 'is', null)
    .ilike('filename', '%.pdf')
    .limit(500);

  if (attError || !attachments || attachments.length === 0) {
    console.log('No extracted PDFs found');
    return;
  }

  // Get email info for each attachment - batch in chunks of 100
  const emailIds = [...new Set(attachments.map(a => a.email_id))];
  console.log(`Found ${attachments.length} attachments, ${emailIds.length} unique emails`);

  // Batch fetch emails and classifications
  const allEmails: any[] = [];
  const allClassifications: any[] = [];
  const batchSize = 100;

  for (let i = 0; i < emailIds.length; i += batchSize) {
    const batch = emailIds.slice(i, i + batchSize);

    const [emailResult, classResult] = await Promise.all([
      supabase.from('raw_emails').select('id, subject, sender_email').in('id', batch),
      supabase.from('document_classifications').select('email_id, document_type, confidence_score').in('email_id', batch)
    ]);

    if (emailResult.data) allEmails.push(...emailResult.data);
    if (classResult.data) allClassifications.push(...classResult.data);
  }

  console.log(`Loaded ${allEmails.length} emails, ${allClassifications.length} classifications`);

  const emailMap: Record<string, any> = {};
  for (const e of allEmails) {
    emailMap[e.id] = e;
  }
  const classMap: Record<string, any> = {};
  for (const c of allClassifications) {
    classMap[c.email_id] = c;
  }

  // Debug: show first few senders
  console.log('Sample senders:');
  for (const att of attachments.slice(0, 3)) {
    const email = emailMap[att.email_id];
    console.log(`  - ${email?.sender_email}`);
  }
  console.log('');

  interface Stats {
    total: number;
    hasBooking: number;
    hasContainer: number;
    hasVessel: number;
    hasPort: number;
    hasDate: number;
    chars: number[];
  }

  // Group by carrier
  const byCarrier: Record<string, Stats> = {};
  const byDocType: Record<string, Stats> = {};

  for (const att of attachments) {
    const email = emailMap[att.email_id];
    const classification = classMap[att.email_id];

    const sender = email?.sender_email?.toLowerCase() || 'unknown';
    const docType = classification?.document_type || 'unclassified';
    const text = att.extracted_text || '';

    // Identify carrier from sender email and subject
    const subjectLower = email?.subject?.toLowerCase() || '';
    let carrier = 'other';
    if (sender.includes('hapag') || sender.includes('hlcl') || sender.includes('hlag')) {
      carrier = 'hapag-lloyd';
    }
    else if (sender.includes('maersk') || sender.includes('sealand') || subjectLower.includes('maersk')) carrier = 'maersk';
    else if (sender.includes('cma') || sender.includes('cgm') || subjectLower.includes('cma cgm')) carrier = 'cma-cgm';
    else if (sender.includes('msc.com') || subjectLower.includes('msc ')) carrier = 'msc';
    else if (sender.includes('cosco') || subjectLower.includes('cosco')) carrier = 'cosco';
    else if (sender.includes('one-line') || sender.includes('ocean-network') || subjectLower.includes('one line')) carrier = 'one';
    else if (sender.includes('evergreen') || sender.includes('greencompass')) carrier = 'evergreen';
    else if (sender.includes('intoglo')) carrier = 'intoglo-internal';

    // Quality metrics
    const hasBookingNum = /[A-Z]{3,4}\d{7,10}|\d{9,12}/i.test(text);
    const hasContainerNum = /[A-Z]{4}\d{7}/i.test(text);
    const hasVessel = /(vessel|ship|mv|vsl)[:\s]+[A-Z]/i.test(text);
    const hasPort = /(port|pol|pod|discharge|loading)[:\s]+[A-Z]/i.test(text);
    const hasDate = /\d{1,2}[-\/]\w{3}[-\/]\d{2,4}|\d{4}-\d{2}-\d{2}/i.test(text);
    const charCount = text.length;

    // Aggregate by carrier
    if (!byCarrier[carrier]) {
      byCarrier[carrier] = { total: 0, hasBooking: 0, hasContainer: 0, hasVessel: 0, hasPort: 0, hasDate: 0, chars: [] };
    }
    byCarrier[carrier].total++;
    if (hasBookingNum) byCarrier[carrier].hasBooking++;
    if (hasContainerNum) byCarrier[carrier].hasContainer++;
    if (hasVessel) byCarrier[carrier].hasVessel++;
    if (hasPort) byCarrier[carrier].hasPort++;
    if (hasDate) byCarrier[carrier].hasDate++;
    byCarrier[carrier].chars.push(charCount);

    // Aggregate by document type
    if (!byDocType[docType]) {
      byDocType[docType] = { total: 0, hasBooking: 0, hasContainer: 0, hasVessel: 0, hasPort: 0, hasDate: 0, chars: [] };
    }
    byDocType[docType].total++;
    if (hasBookingNum) byDocType[docType].hasBooking++;
    if (hasContainerNum) byDocType[docType].hasContainer++;
    if (hasVessel) byDocType[docType].hasVessel++;
    if (hasPort) byDocType[docType].hasPort++;
    if (hasDate) byDocType[docType].hasDate++;
    byDocType[docType].chars.push(charCount);
  }

  // Print carrier analysis
  console.log('BY SHIPPING LINE:');
  console.log('─'.repeat(100));
  console.log(
    'Carrier'.padEnd(18) +
    'PDFs'.padStart(6) +
    'Booking#'.padStart(11) +
    'Container'.padStart(11) +
    'Vessel'.padStart(9) +
    'Port'.padStart(8) +
    'Date'.padStart(8) +
    'Avg Chars'.padStart(12)
  );
  console.log('─'.repeat(100));

  const sortedCarriers = Object.entries(byCarrier).sort((a, b) => b[1].total - a[1].total);
  for (const [carrier, stats] of sortedCarriers) {
    const avgChars = Math.round(stats.chars.reduce((a, b) => a + b, 0) / stats.chars.length);
    const bookingPct = Math.round(stats.hasBooking / stats.total * 100);
    const containerPct = Math.round(stats.hasContainer / stats.total * 100);
    const vesselPct = Math.round(stats.hasVessel / stats.total * 100);
    const portPct = Math.round(stats.hasPort / stats.total * 100);
    const datePct = Math.round(stats.hasDate / stats.total * 100);

    console.log(
      carrier.padEnd(18) +
      String(stats.total).padStart(6) +
      (bookingPct + '%').padStart(11) +
      (containerPct + '%').padStart(11) +
      (vesselPct + '%').padStart(9) +
      (portPct + '%').padStart(8) +
      (datePct + '%').padStart(8) +
      String(avgChars).padStart(12)
    );
  }

  console.log('');
  console.log('BY DOCUMENT TYPE:');
  console.log('─'.repeat(100));
  console.log(
    'Document Type'.padEnd(25) +
    'PDFs'.padStart(6) +
    'Booking#'.padStart(11) +
    'Container'.padStart(11) +
    'Vessel'.padStart(9) +
    'Port'.padStart(8) +
    'Date'.padStart(8) +
    'Avg Chars'.padStart(12)
  );
  console.log('─'.repeat(100));

  const sortedDocTypes = Object.entries(byDocType).sort((a, b) => b[1].total - a[1].total).slice(0, 15);
  for (const [docType, stats] of sortedDocTypes) {
    const avgChars = Math.round(stats.chars.reduce((a, b) => a + b, 0) / stats.chars.length);
    const bookingPct = Math.round(stats.hasBooking / stats.total * 100);
    const containerPct = Math.round(stats.hasContainer / stats.total * 100);
    const vesselPct = Math.round(stats.hasVessel / stats.total * 100);
    const portPct = Math.round(stats.hasPort / stats.total * 100);
    const datePct = Math.round(stats.hasDate / stats.total * 100);

    console.log(
      docType.padEnd(25) +
      String(stats.total).padStart(6) +
      (bookingPct + '%').padStart(11) +
      (containerPct + '%').padStart(11) +
      (vesselPct + '%').padStart(9) +
      (portPct + '%').padStart(8) +
      (datePct + '%').padStart(8) +
      String(avgChars).padStart(12)
    );
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  // Show sample extractions from different carriers
  console.log('');
  console.log('SAMPLE EXTRACTIONS BY CARRIER:');
  console.log('═══════════════════════════════════════════════════════════════════════════════');

  const carrierSamples = ['hapag-lloyd', 'maersk', 'cma-cgm', 'msc'];

  for (const targetCarrier of carrierSamples) {
    // Find a sample for this carrier
    const sample = attachments.find(att => {
      const email = emailMap[att.email_id];
      const sender = email?.sender_email?.toLowerCase() || '';
      const subject = email?.subject?.toLowerCase() || '';

      if (targetCarrier === 'hapag-lloyd' && (sender.includes('hapag') || sender.includes('hlcl') || sender.includes('hlag'))) return true;
      if (targetCarrier === 'maersk' && (sender.includes('maersk') || sender.includes('sealand') || subject.includes('maersk'))) return true;
      if (targetCarrier === 'cma-cgm' && (sender.includes('cma') || sender.includes('cgm') || subject.includes('cma cgm'))) return true;
      if (targetCarrier === 'msc' && (sender.includes('msc.com') || subject.includes('msc '))) return true;
      return false;
    });

    if (sample) {
      const email = emailMap[sample.email_id];
      const text = sample.extracted_text || '';

      console.log('');
      console.log(`▶ ${targetCarrier.toUpperCase()}`);
      console.log('─'.repeat(60));
      console.log(`  Email: ${email?.subject?.substring(0, 50) || 'N/A'}...`);
      console.log(`  PDF: ${sample.filename}`);
      console.log(`  Characters: ${text.length}`);
      console.log(`  Preview:`);
      console.log('  ' + text.substring(0, 300).split('\n').slice(0, 8).join('\n  '));
      console.log('  ...');
    }
  }
}

analyzeExtractionQuality().catch(console.error);
