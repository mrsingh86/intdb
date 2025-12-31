/**
 * Show sample extractions for Invoice and B/L documents
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function showSamples() {
  // Get all PDFs with good extraction
  const { data: pdfs } = await supabase
    .from('raw_attachments')
    .select('filename, extracted_text')
    .not('extracted_text', 'is', null)
    .ilike('filename', '%.pdf')
    .limit(300);

  // ==================== INVOICE ====================
  console.log('');
  console.log('═'.repeat(80));
  console.log('                           INVOICE EXTRACTION');
  console.log('═'.repeat(80));

  let invoiceSample = null;
  for (const att of pdfs || []) {
    const text = att.extracted_text || '';
    const upper = text.toUpperCase();
    const fname = att.filename.toUpperCase();
    if (text.length > 1000 &&
        (fname.includes('INV') || upper.includes('INVOICE')) &&
        (upper.includes('AMOUNT') || upper.includes('TOTAL') || upper.includes('USD'))) {
      invoiceSample = att;
      break;
    }
  }

  if (invoiceSample) {
    console.log('');
    console.log('FILE:', invoiceSample.filename);
    console.log('TEXT LENGTH:', invoiceSample.extracted_text?.length, 'chars');
    console.log('─'.repeat(80));
    console.log(invoiceSample.extracted_text?.substring(0, 2500));
    console.log('');
    console.log('[... truncated ...]');
  } else {
    console.log('No invoice sample found');
  }

  // ==================== BILL OF LADING ====================
  console.log('');
  console.log('═'.repeat(80));
  console.log('                      BILL OF LADING EXTRACTION');
  console.log('═'.repeat(80));

  let blSample = null;
  for (const att of pdfs || []) {
    const text = att.extracted_text || '';
    const upper = text.toUpperCase();
    if (text.length > 1000 &&
        upper.includes('BILL OF LADING') &&
        upper.indexOf('SHIPPING INSTRUCTION') === -1 &&
        (upper.includes('SHIPPER') && upper.includes('CONSIGNEE'))) {
      blSample = att;
      break;
    }
  }

  if (blSample) {
    console.log('');
    console.log('FILE:', blSample.filename);
    console.log('TEXT LENGTH:', blSample.extracted_text?.length, 'chars');
    console.log('─'.repeat(80));
    console.log(blSample.extracted_text?.substring(0, 2500));
    console.log('');
    console.log('[... truncated ...]');
  } else {
    console.log('No B/L sample found');
  }

  // ==================== SHIPPING INSTRUCTION ====================
  console.log('');
  console.log('═'.repeat(80));
  console.log('                    SHIPPING INSTRUCTION EXTRACTION');
  console.log('═'.repeat(80));

  const { data: si } = await supabase
    .from('raw_attachments')
    .select('filename, extracted_text')
    .not('extracted_text', 'is', null)
    .ilike('filename', '%SI_%')
    .ilike('filename', '%.pdf')
    .order('extracted_at', { ascending: false })
    .limit(1);

  if (si && si[0] && si[0].extracted_text) {
    console.log('');
    console.log('FILE:', si[0].filename);
    console.log('TEXT LENGTH:', si[0].extracted_text.length, 'chars');
    console.log('─'.repeat(80));
    console.log(si[0].extracted_text.substring(0, 2000));
    console.log('');
    console.log('[... truncated ...]');
  }
}

showSamples().catch(console.error);
