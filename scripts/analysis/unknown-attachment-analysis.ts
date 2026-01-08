/**
 * Analyze Unknown Classification vs Attachment Correlation
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

async function getAllData() {
  const allData: any[] = [];
  let offset = 0;
  const batchSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('document_classifications')
      .select(`
        document_type,
        raw_emails!inner (
          has_attachments,
          attachment_count
        )
      `)
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error('Error:', error);
      break;
    }
    if (!data || data.length === 0) break;

    allData.push(...data);
    offset += batchSize;
    if (data.length < batchSize) break;
  }

  return allData;
}

async function main() {
  console.log('Fetching all data...');
  const data = await getAllData();
  console.log(`Total rows: ${data.length}\n`);

  let unknownWithAttach = 0;
  let unknownWithoutAttach = 0;
  let knownWithAttach = 0;
  let knownWithoutAttach = 0;

  for (const row of data) {
    const email = row.raw_emails;
    const hasAttach = email.has_attachments === true;
    const isUnknown = row.document_type === 'unknown';

    if (isUnknown && hasAttach) {
      unknownWithAttach++;
    } else if (isUnknown && hasAttach === false) {
      unknownWithoutAttach++;
    } else if (isUnknown === false && hasAttach) {
      knownWithAttach++;
    } else if (isUnknown === false && hasAttach === false) {
      knownWithoutAttach++;
    }
  }

  const totalUnknown = unknownWithAttach + unknownWithoutAttach;
  const totalKnown = knownWithAttach + knownWithoutAttach;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  UNKNOWN CLASSIFICATION vs ATTACHMENT ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('UNKNOWN Document Type:');
  console.log(`  With Attachments:     ${unknownWithAttach.toString().padStart(5)} (${((unknownWithAttach/totalUnknown)*100).toFixed(1)}%)`);
  console.log(`  Without Attachments:  ${unknownWithoutAttach.toString().padStart(5)} (${((unknownWithoutAttach/totalUnknown)*100).toFixed(1)}%)`);
  console.log(`  Total Unknown:        ${totalUnknown.toString().padStart(5)}\n`);

  console.log('KNOWN Document Types:');
  console.log(`  With Attachments:     ${knownWithAttach.toString().padStart(5)} (${((knownWithAttach/totalKnown)*100).toFixed(1)}%)`);
  console.log(`  Without Attachments:  ${knownWithoutAttach.toString().padStart(5)} (${((knownWithoutAttach/totalKnown)*100).toFixed(1)}%)`);
  console.log(`  Total Known:          ${totalKnown.toString().padStart(5)}\n`);

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  CONCLUSION');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const unknownAttachRate = (unknownWithAttach/totalUnknown)*100;
  const knownAttachRate = (knownWithAttach/totalKnown)*100;

  console.log('Attachment Rate:');
  console.log(`  Unknown types:  ${unknownAttachRate.toFixed(1)}% have attachments`);
  console.log(`  Known types:    ${knownAttachRate.toFixed(1)}% have attachments\n`);

  if (unknownWithoutAttach > unknownWithAttach) {
    const pct = ((unknownWithoutAttach/totalUnknown)*100).toFixed(0);
    console.log(`✓ CONFIRMED: ${pct}% of UNKNOWN are emails WITHOUT attachments`);
  } else {
    const pct = ((unknownWithAttach/totalUnknown)*100).toFixed(0);
    console.log(`✗ OPPOSITE: ${pct}% of UNKNOWN DO have attachments`);
    console.log('  These are emails with attachments that did not match filename patterns');
  }
}

main().catch(console.error);
