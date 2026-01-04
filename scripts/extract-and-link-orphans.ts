/**
 * Extract entities from orphan broker documents and link to shipments
 *
 * The problem: Orphan documents exist but have no entity_extractions,
 * so they can't be matched to shipments via HBL/container.
 *
 * This script:
 * 1. Gets all orphan shipment_documents
 * 2. Fetches their raw_emails subjects
 * 3. Extracts entities (container, HBL, entry number) via regex
 * 4. Saves to entity_extractions table
 * 5. Links orphan docs to shipments via container/HBL match
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Extraction patterns for broker emails
const PATTERNS = {
  // Container: 4 letters + 7 digits (e.g., TCLU3379724)
  container: /\b([A-Z]{4}\d{7})\b/g,

  // HBL: Various formats used by carriers
  hbl: [
    /\bLUDSE(\d{4,})\b/i,           // LUDSE0360
    /\bSE(\d{10,})\b/i,             // SE1225003089
    /\bSWLLUD(\d{6,})\b/i,          // SWLLUD...
    /HBL[#:\s]*([A-Z0-9]{6,})/i,    // HBL# XXXX
  ],

  // Entry number: xxx-xxxxxxx-x (Portside format)
  entry_number: /\b(\d{3}-\d{7}-\d)(?:-(?:3461|7501))?\b/g,

  // Intoglo Deal ID (for reference, not for matching)
  deal_id: /\b(SEINUS\d{11}_I)\b/i,
};

interface ExtractedEntities {
  container_numbers: string[];
  hbl_numbers: string[];
  entry_numbers: string[];
  deal_id?: string;
}

function extractEntities(subject: string): ExtractedEntities {
  const result: ExtractedEntities = {
    container_numbers: [],
    hbl_numbers: [],
    entry_numbers: [],
  };

  // Container numbers
  const containerMatches = subject.match(PATTERNS.container);
  if (containerMatches) {
    result.container_numbers = [...new Set(containerMatches.map(c => c.toUpperCase()))];
  }

  // HBL numbers
  for (const pattern of PATTERNS.hbl) {
    const match = subject.match(pattern);
    if (match) {
      result.hbl_numbers.push(match[0].toUpperCase());
    }
  }
  result.hbl_numbers = [...new Set(result.hbl_numbers)];

  // Entry numbers
  const entryMatches = subject.match(PATTERNS.entry_number);
  if (entryMatches) {
    result.entry_numbers = [...new Set(entryMatches)];
  }

  // Deal ID (for logging, not used for matching)
  const dealMatch = subject.match(PATTERNS.deal_id);
  if (dealMatch) {
    result.deal_id = dealMatch[1];
  }

  return result;
}

async function main() {
  console.log('='.repeat(80));
  console.log('EXTRACT ENTITIES & LINK ORPHAN BROKER DOCUMENTS');
  console.log('='.repeat(80));

  // Step 1: Get orphan documents with their emails
  const { data: orphanDocs, error: docsError } = await supabase
    .from('shipment_documents')
    .select(`
      id,
      email_id,
      document_type,
      booking_number_extracted
    `)
    .is('shipment_id', null);

  if (docsError) {
    console.error('Error fetching orphan docs:', docsError);
    return;
  }

  console.log(`\nFound ${orphanDocs?.length || 0} orphan documents\n`);

  if (!orphanDocs || orphanDocs.length === 0) {
    console.log('No orphan documents to process');
    return;
  }

  // Get email subjects for these documents
  const emailIds = orphanDocs.map(d => d.email_id);
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject')
    .in('id', emailIds);

  const emailMap = new Map(emails?.map(e => [e.id, e.subject]) || []);

  // Step 2: Extract entities and save
  console.log('─'.repeat(80));
  console.log('EXTRACTING ENTITIES FROM SUBJECTS');
  console.log('─'.repeat(80));

  const allExtractions: any[] = [];
  let extractedCount = 0;

  for (const doc of orphanDocs) {
    const subject = emailMap.get(doc.email_id) || '';
    const entities = extractEntities(subject);

    const hasEntities =
      entities.container_numbers.length > 0 ||
      entities.hbl_numbers.length > 0 ||
      entities.entry_numbers.length > 0;

    if (hasEntities) {
      extractedCount++;
      console.log(`\n📧 ${doc.document_type} (${doc.id.substring(0, 8)})`);
      console.log(`   Subject: ${subject.substring(0, 70)}...`);

      for (const container of entities.container_numbers) {
        allExtractions.push({
          email_id: doc.email_id,
          entity_type: 'container_number',
          entity_value: container,
          confidence_score: 95,
          extraction_method: 'regex_subject_backfill',
        });
        console.log(`   ✅ Container: ${container}`);
      }

      for (const hbl of entities.hbl_numbers) {
        allExtractions.push({
          email_id: doc.email_id,
          entity_type: 'hbl_number',
          entity_value: hbl,
          confidence_score: 90,
          extraction_method: 'regex_subject_backfill',
        });
        console.log(`   ✅ HBL: ${hbl}`);
      }

      for (const entry of entities.entry_numbers) {
        allExtractions.push({
          email_id: doc.email_id,
          entity_type: 'entry_number',
          entity_value: entry,
          confidence_score: 95,
          extraction_method: 'regex_subject_backfill',
        });
        console.log(`   ✅ Entry: ${entry}`);
      }
    }
  }

  console.log(`\n\nExtracted entities from ${extractedCount} documents`);
  console.log(`Total extractions to save: ${allExtractions.length}`);

  // Save extractions (insert individually, ignore duplicates)
  if (allExtractions.length > 0) {
    let saved = 0;
    let skipped = 0;
    for (const extraction of allExtractions) {
      const { error } = await supabase.from('entity_extractions').insert(extraction);
      if (error) {
        skipped++;
      } else {
        saved++;
      }
    }
    console.log(`  ✅ Saved ${saved} extractions (${skipped} duplicates skipped)`);
  }

  // Step 3: Link orphan documents via container/HBL match
  console.log('\n' + '─'.repeat(80));
  console.log('LINKING ORPHAN DOCUMENTS TO SHIPMENTS');
  console.log('─'.repeat(80));

  // Get all shipments with their identifiers
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, hbl_number, container_numbers');

  console.log(`\nLoaded ${shipments?.length || 0} shipments for matching\n`);

  let linked = 0;
  let noMatch = 0;

  for (const doc of orphanDocs) {
    const subject = emailMap.get(doc.email_id) || '';
    const entities = extractEntities(subject);

    let matchedShipment: any = null;
    let matchedBy = '';

    // Try container match first (most reliable)
    if (!matchedShipment && entities.container_numbers.length > 0) {
      for (const container of entities.container_numbers) {
        matchedShipment = shipments?.find(s =>
          s.container_numbers?.includes(container)
        );
        if (matchedShipment) {
          matchedBy = `container ${container}`;
          break;
        }
      }
    }

    // Try HBL match
    if (!matchedShipment && entities.hbl_numbers.length > 0) {
      for (const hbl of entities.hbl_numbers) {
        matchedShipment = shipments?.find(s =>
          s.hbl_number && s.hbl_number.toUpperCase() === hbl.toUpperCase()
        );
        if (matchedShipment) {
          matchedBy = `HBL ${hbl}`;
          break;
        }
      }
    }

    if (matchedShipment) {
      // Update the orphan document
      const { error: updateError } = await supabase
        .from('shipment_documents')
        .update({
          shipment_id: matchedShipment.id,
          status: 'linked',
          updated_at: new Date().toISOString(),
        })
        .eq('id', doc.id);

      if (!updateError) {
        linked++;
        console.log(`  ✅ ${doc.document_type} → ${matchedShipment.booking_number} (via ${matchedBy})`);
      }
    } else if (entities.container_numbers.length > 0 || entities.hbl_numbers.length > 0) {
      noMatch++;
      console.log(`  ⚠️ ${doc.document_type}: No shipment found for containers=${entities.container_numbers.join(',')} hbl=${entities.hbl_numbers.join(',')}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log(`\nTotal orphan documents: ${orphanDocs.length}`);
  console.log(`Entities extracted: ${extractedCount}`);
  console.log(`Documents linked: ${linked}`);
  console.log(`No shipment match: ${noMatch}`);
}

main().catch(console.error);
