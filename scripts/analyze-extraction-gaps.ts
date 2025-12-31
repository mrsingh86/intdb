/**
 * Analyze PDF extraction gaps and opportunities for improvement
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function analyzeGaps() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('PDF EXTRACTION - CURRENT STATE & IMPROVEMENT OPPORTUNITIES');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // 1. COVERAGE ANALYSIS
  console.log('1. COVERAGE ANALYSIS');
  console.log('─'.repeat(70));

  const { count: totalPdfs } = await supabase
    .from('raw_attachments')
    .select('*', { count: 'exact', head: true })
    .ilike('filename', '%.pdf');

  const { count: extractedPdfs } = await supabase
    .from('raw_attachments')
    .select('*', { count: 'exact', head: true })
    .ilike('filename', '%.pdf')
    .not('extracted_text', 'is', null);

  const missingCount = (totalPdfs || 0) - (extractedPdfs || 0);

  console.log(`  Total PDFs:           ${totalPdfs}`);
  console.log(`  With extracted text:  ${extractedPdfs} (${Math.round((extractedPdfs || 0) / (totalPdfs || 1) * 100)}%)`);
  console.log(`  Missing extraction:   ${missingCount} (${Math.round(missingCount / (totalPdfs || 1) * 100)}%)`);
  console.log('');

  // 2. WHY ARE EXTRACTIONS MISSING?
  console.log('2. WHY ARE EXTRACTIONS MISSING?');
  console.log('─'.repeat(70));

  const { data: missingPdfs } = await supabase
    .from('raw_attachments')
    .select('id, filename, file_size, storage_path, extraction_status')
    .ilike('filename', '%.pdf')
    .is('extracted_text', null)
    .limit(500);

  let hasStoragePath = 0;
  let hasNoStoragePath = 0;
  const statusCounts: Record<string, number> = {};

  for (const pdf of missingPdfs || []) {
    if (pdf.storage_path) hasStoragePath++;
    else hasNoStoragePath++;

    const status = pdf.extraction_status || 'null';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  console.log(`  Have storage_path (can fetch from Gmail): ${hasStoragePath}`);
  console.log(`  No storage_path (cannot fetch):           ${hasNoStoragePath}`);
  console.log('');
  console.log('  Extraction status breakdown:');
  for (const [status, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${status}: ${count}`);
  }
  console.log('');

  // 3. QUALITY OF CURRENT EXTRACTIONS
  console.log('3. QUALITY OF CURRENT EXTRACTIONS');
  console.log('─'.repeat(70));

  const { data: extractedSamples } = await supabase
    .from('raw_attachments')
    .select('id, filename, extracted_text, file_size')
    .ilike('filename', '%.pdf')
    .not('extracted_text', 'is', null)
    .limit(700);

  let minimal = 0;
  let short = 0;
  let medium = 0;
  let excellent = 0;
  let potentialScanned = 0;

  for (const att of extractedSamples || []) {
    const textLen = att.extracted_text?.length || 0;
    const fileSize = att.file_size || 0;

    if (textLen < 100) {
      minimal++;
      // Large file but minimal text = likely scanned
      if (fileSize > 50000) potentialScanned++;
    } else if (textLen < 500) {
      short++;
    } else if (textLen < 2000) {
      medium++;
    } else {
      excellent++;
    }
  }

  console.log(`  Minimal (<100 chars):     ${minimal}`);
  console.log(`  Short (100-500 chars):    ${short}`);
  console.log(`  Medium (500-2000 chars):  ${medium}`);
  console.log(`  Excellent (>2000 chars):  ${excellent}`);
  console.log('');
  console.log(`  Potential scanned PDFs (large file, minimal text): ${potentialScanned}`);
  console.log('');

  // 4. CHECK WHAT DATA IS BEING MISSED
  console.log('4. WHAT KEY DATA MIGHT BE MISSING?');
  console.log('─'.repeat(70));

  // Sample some extracted texts and check for common fields
  const { data: qualitySamples } = await supabase
    .from('raw_attachments')
    .select('extracted_text')
    .ilike('filename', '%.pdf')
    .not('extracted_text', 'is', null)
    .limit(200);

  let hasBookingNum = 0;
  let hasContainerNum = 0;
  let hasVessel = 0;
  let hasPort = 0;
  let hasDate = 0;
  let hasWeight = 0;
  let hasAddress = 0;
  let hasAmount = 0;

  for (const s of qualitySamples || []) {
    const text = s.extracted_text || '';
    if (/[A-Z]{3,4}\d{7,10}|\d{9,12}/i.test(text)) hasBookingNum++;
    if (/[A-Z]{4}\d{7}/i.test(text)) hasContainerNum++;
    if (/(vessel|ship|mv|vsl)[:\s]+[A-Z]/i.test(text)) hasVessel++;
    if (/(port|pol|pod|discharge|loading)[:\s]+[A-Z]/i.test(text)) hasPort++;
    if (/\d{1,2}[-/]\w{3}[-/]\d{2,4}|\d{4}-\d{2}-\d{2}/i.test(text)) hasDate++;
    if (/(weight|gross|net|kg|kgs|lbs)[:\s]+[\d,.]+/i.test(text)) hasWeight++;
    if (/\d{5,6}|street|road|ave|city|state/i.test(text)) hasAddress++;
    if (/(usd|inr|eur|\$|₹|€)[:\s]*[\d,.]+|[\d,.]+\s*(usd|inr|eur)/i.test(text)) hasAmount++;
  }

  const total = qualitySamples?.length || 1;
  console.log(`  Field extraction rates (from ${total} samples):`);
  console.log(`    Booking numbers:  ${Math.round(hasBookingNum / total * 100)}%`);
  console.log(`    Container numbers: ${Math.round(hasContainerNum / total * 100)}%`);
  console.log(`    Vessel names:     ${Math.round(hasVessel / total * 100)}%`);
  console.log(`    Port names:       ${Math.round(hasPort / total * 100)}%`);
  console.log(`    Dates:            ${Math.round(hasDate / total * 100)}%`);
  console.log(`    Weights:          ${Math.round(hasWeight / total * 100)}%`);
  console.log(`    Addresses:        ${Math.round(hasAddress / total * 100)}%`);
  console.log(`    Amounts/Currency: ${Math.round(hasAmount / total * 100)}%`);
  console.log('');

  // 5. RECOMMENDATIONS
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('RECOMMENDATIONS FOR IMPROVEMENT');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  console.log('IMMEDIATE (Quick Wins):');
  console.log('─'.repeat(70));
  console.log('  1. Extract remaining 72% of PDFs via Gmail API');
  console.log('     - Have storage_path reference, just need to download & extract');
  console.log('     - Estimated: ~1,678 PDFs');
  console.log('');

  console.log('MEDIUM TERM (Better Quality):');
  console.log('─'.repeat(70));
  console.log('  2. Add OCR for scanned PDFs');
  console.log('     - Use Tesseract.js or Google Vision API');
  console.log('     - Detects image-based PDFs and runs OCR');
  console.log('');
  console.log('  3. Table extraction');
  console.log('     - Use pdf-table-extractor or Tabula');
  console.log('     - Better structure for invoices, cargo manifests');
  console.log('');
  console.log('  4. Layout-aware extraction');
  console.log('     - Use pdfplumber or pdf2json');
  console.log('     - Preserves columns, headers, forms');
  console.log('');

  console.log('ADVANCED (AI-Powered):');
  console.log('─'.repeat(70));
  console.log('  5. Claude Vision for complex PDFs');
  console.log('     - Send PDF as image to Claude');
  console.log('     - AI extracts structured data');
  console.log('     - Best for forms, stamps, handwriting');
  console.log('');
  console.log('  6. Fine-tuned extraction prompts');
  console.log('     - Document-type specific prompts');
  console.log('     - "Extract BL fields: shipper, consignee, marks..."');
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

analyzeGaps().catch(console.error);
