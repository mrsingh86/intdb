/**
 * Repair Shipment Links
 *
 * Identifies and fixes cross-linked documents:
 * 1. Verifies each linked doc belongs to the correct shipment
 * 2. Removes docs that reference different booking numbers
 * 3. Reports misclassified docs for review
 *
 * Usage:
 *   npx tsx scripts/repair-shipment-links.ts              # Dry run
 *   npx tsx scripts/repair-shipment-links.ts --execute    # Execute repairs
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const DRY_RUN = !process.argv.includes('--execute');

// Booking number patterns to extract from subjects
const BOOKING_PATTERNS = [
  /\b(\d{9,12})\b/g,                           // Maersk/MSC numeric (9-12 digits)
  /\b([A-Z]{4}\d{7,10})\b/g,                   // COSCO/Evergreen (COSU, EGLV + digits)
  /\b(HL[-]?\d{8})\b/gi,                       // Hapag-Lloyd (HL-12345678)
  /\b([A-Z]{2,4}[-]?\d{6,10})\b/g,             // Generic carrier prefix
  /BKG[:#\s]*([A-Z0-9-]+)/gi,                  // BKG #XXX or BKG: XXX
  /BOOKING[:#\s]*([A-Z0-9-]+)/gi,              // BOOKING #XXX
  /\b(CAD\d{7})\b/gi,                          // CAD bookings
  /\b(DELF\d{8})\b/gi,                         // DELF bookings
  /\b(SSE\d{10})\b/gi,                         // SSE bookings
];

// Container number pattern
const CONTAINER_PATTERN = /\b([A-Z]{4}\d{7})\b/g;

// BL number patterns
const BL_PATTERNS = [
  /\b(HLCU[A-Z0-9]+)\b/gi,
  /\b(MAEU[A-Z0-9]+)\b/gi,
  /\b(COSU[A-Z0-9]+)\b/gi,
  /\b([A-Z]{4}\d{9,12})\b/g,
];

interface CrossLinkIssue {
  docId: string;
  emailId: string;
  shipmentId: string;
  shipmentBooking: string;
  documentType: string;
  subject: string;
  foundBookings: string[];
  foundContainers: string[];
  issue: string;
  action: 'remove' | 'review' | 'keep';
}

interface MisclassificationIssue {
  docId: string;
  emailId: string;
  documentType: string;
  subject: string;
  suggestedType: string;
  reason: string;
}

interface RepairStats {
  totalDocs: number;
  docsChecked: number;
  crossLinksFound: number;
  crossLinksRemoved: number;
  misclassifications: number;
  shipmentsAffected: number;
}

async function main() {
  console.log('REPAIR SHIPMENT LINKS');
  console.log('='.repeat(70));
  console.log('Mode:', DRY_RUN ? 'DRY RUN (use --execute to apply)' : 'EXECUTING');
  console.log('');

  const stats: RepairStats = {
    totalDocs: 0,
    docsChecked: 0,
    crossLinksFound: 0,
    crossLinksRemoved: 0,
    misclassifications: 0,
    shipmentsAffected: 0,
  };

  const crossLinkIssues: CrossLinkIssue[] = [];
  const misclassifications: MisclassificationIssue[] = [];
  const affectedShipments = new Set<string>();

  // Step 1: Get all shipment documents with email and shipment info
  console.log('Step 1: Loading shipment documents...');

  let allDocs: any[] = [];
  let offset = 0;
  const pageSize = 500;

  while (true) {
    const { data: batch } = await supabase
      .from('shipment_documents')
      .select(`
        id,
        shipment_id,
        document_type,
        email_id,
        shipments!shipment_documents_shipment_id_fkey(booking_number, bl_number, container_numbers),
        raw_emails!shipment_documents_email_id_fkey(subject, body_text, is_response, thread_id)
      `)
      .not('shipment_id', 'is', null)
      .not('email_id', 'is', null)
      .range(offset, offset + pageSize - 1);

    if (!batch || batch.length === 0) break;
    allDocs = allDocs.concat(batch);
    offset += pageSize;
    if (batch.length < pageSize) break;
  }

  stats.totalDocs = allDocs.length;
  console.log(`  Loaded ${allDocs.length} documents with shipment links`);
  console.log('');

  // Step 2: Check each document for cross-linking
  console.log('Step 2: Checking for cross-linked documents...');

  for (const doc of allDocs) {
    const shipment = (doc as any).shipments;
    const email = (doc as any).raw_emails;

    if (!shipment?.booking_number || !email?.subject) continue;
    stats.docsChecked++;

    const shipmentBooking = shipment.booking_number.toUpperCase();
    const shipmentBL = shipment.bl_number?.toUpperCase();
    const shipmentContainers = (shipment.container_numbers || []).map((c: string) => c.toUpperCase());

    const subject = email.subject || '';
    const subjectUpper = subject.toUpperCase();

    // Extract identifiers from subject
    const foundBookings = extractBookings(subject);
    const foundContainers = extractContainers(subject);
    const foundBLs = extractBLs(subject);

    // Check if this document belongs to this shipment
    const belongsToShipment = checkBelongsToShipment(
      shipmentBooking,
      shipmentBL,
      shipmentContainers,
      foundBookings,
      foundContainers,
      foundBLs,
      subjectUpper
    );

    if (!belongsToShipment.belongs) {
      stats.crossLinksFound++;
      affectedShipments.add(shipment.booking_number);

      crossLinkIssues.push({
        docId: doc.id,
        emailId: doc.email_id,
        shipmentId: doc.shipment_id,
        shipmentBooking: shipment.booking_number,
        documentType: doc.document_type,
        subject: subject.substring(0, 60),
        foundBookings,
        foundContainers,
        issue: belongsToShipment.reason,
        action: belongsToShipment.action,
      });
    }

    // Check for misclassifications
    const misclass = checkMisclassification(doc.document_type, subject);
    if (misclass) {
      stats.misclassifications++;
      misclassifications.push({
        docId: doc.id,
        emailId: doc.email_id,
        documentType: doc.document_type,
        subject: subject.substring(0, 60),
        suggestedType: misclass.suggestedType,
        reason: misclass.reason,
      });
    }
  }

  stats.shipmentsAffected = affectedShipments.size;

  console.log(`  Checked: ${stats.docsChecked}`);
  console.log(`  Cross-links found: ${stats.crossLinksFound}`);
  console.log(`  Misclassifications: ${stats.misclassifications}`);
  console.log('');

  // Step 3: Show cross-link issues
  console.log('Step 3: Cross-Link Issues');
  console.log('-'.repeat(70));

  const toRemove = crossLinkIssues.filter(i => i.action === 'remove');
  const toReview = crossLinkIssues.filter(i => i.action === 'review');

  console.log(`\nTO REMOVE (${toRemove.length} docs - clearly wrong shipment):`);
  for (const issue of toRemove.slice(0, 20)) {
    console.log(`  ${issue.shipmentBooking} | ${issue.documentType.padEnd(20)} | ${issue.subject}`);
    console.log(`    Issue: ${issue.issue}`);
    if (issue.foundBookings.length > 0) {
      console.log(`    Found bookings: ${issue.foundBookings.join(', ')}`);
    }
  }
  if (toRemove.length > 20) {
    console.log(`  ... and ${toRemove.length - 20} more`);
  }

  console.log(`\nTO REVIEW (${toReview.length} docs - need manual verification):`);
  for (const issue of toReview.slice(0, 10)) {
    console.log(`  ${issue.shipmentBooking} | ${issue.documentType.padEnd(20)} | ${issue.subject}`);
    console.log(`    Issue: ${issue.issue}`);
  }
  if (toReview.length > 10) {
    console.log(`  ... and ${toReview.length - 10} more`);
  }

  // Step 4: Show misclassifications
  console.log('\nStep 4: Misclassification Issues');
  console.log('-'.repeat(70));

  for (const issue of misclassifications.slice(0, 15)) {
    console.log(`  ${issue.documentType.padEnd(25)} → ${issue.suggestedType.padEnd(25)}`);
    console.log(`    Subject: ${issue.subject}`);
    console.log(`    Reason: ${issue.reason}`);
  }
  if (misclassifications.length > 15) {
    console.log(`  ... and ${misclassifications.length - 15} more`);
  }

  // Step 5: Execute repairs
  if (!DRY_RUN && toRemove.length > 0) {
    console.log('\nStep 5: Executing repairs...');

    const idsToRemove = toRemove.map(i => i.docId);
    const batchSize = 100;

    for (let i = 0; i < idsToRemove.length; i += batchSize) {
      const batch = idsToRemove.slice(i, i + batchSize);
      const { error } = await supabase
        .from('shipment_documents')
        .delete()
        .in('id', batch);

      if (error) {
        console.error(`  Error removing batch: ${error.message}`);
      } else {
        stats.crossLinksRemoved += batch.length;
        console.log(`  Removed ${stats.crossLinksRemoved}/${idsToRemove.length}`);
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total documents: ${stats.totalDocs}`);
  console.log(`Documents checked: ${stats.docsChecked}`);
  console.log(`Cross-links found: ${stats.crossLinksFound}`);
  console.log(`  - To remove: ${toRemove.length}`);
  console.log(`  - To review: ${toReview.length}`);
  console.log(`Misclassifications: ${stats.misclassifications}`);
  console.log(`Shipments affected: ${stats.shipmentsAffected}`);

  if (DRY_RUN) {
    console.log('\nDRY RUN - No changes made. Run with --execute to remove cross-links.');
  } else {
    console.log(`\nRemoved: ${stats.crossLinksRemoved} cross-linked documents`);
  }

  // Output affected shipments for re-analysis
  if (affectedShipments.size > 0) {
    console.log('\nAffected shipments (for re-analysis):');
    console.log([...affectedShipments].slice(0, 20).join(', '));
  }
}

function extractBookings(text: string): string[] {
  const bookings = new Set<string>();

  for (const pattern of BOOKING_PATTERNS) {
    const matches = text.matchAll(new RegExp(pattern));
    for (const match of matches) {
      const booking = match[1]?.toUpperCase();
      if (booking && booking.length >= 6 && booking.length <= 15) {
        // Filter out common false positives
        if (!isLikelyNotBooking(booking)) {
          bookings.add(booking);
        }
      }
    }
  }

  return [...bookings];
}

function extractContainers(text: string): string[] {
  const containers = new Set<string>();
  const matches = text.matchAll(CONTAINER_PATTERN);

  for (const match of matches) {
    containers.add(match[1].toUpperCase());
  }

  return [...containers];
}

function extractBLs(text: string): string[] {
  const bls = new Set<string>();

  for (const pattern of BL_PATTERNS) {
    const matches = text.matchAll(new RegExp(pattern));
    for (const match of matches) {
      bls.add(match[1].toUpperCase());
    }
  }

  return [...bls];
}

function isLikelyNotBooking(value: string): boolean {
  // Filter out dates, zip codes, phone numbers, etc.
  if (/^\d{5}$/.test(value)) return true; // ZIP code
  if (/^\d{4}[-/]\d{2}[-/]\d{2}$/.test(value)) return true; // Date
  if (/^20\d{2}$/.test(value)) return true; // Year
  if (/^\d{10}$/.test(value) && value.startsWith('1')) return true; // Phone
  return false;
}

function checkBelongsToShipment(
  shipmentBooking: string,
  shipmentBL: string | undefined,
  shipmentContainers: string[],
  foundBookings: string[],
  foundContainers: string[],
  foundBLs: string[],
  subjectUpper: string
): { belongs: boolean; reason: string; action: 'remove' | 'review' | 'keep' } {

  // Direct booking match in subject
  if (subjectUpper.includes(shipmentBooking)) {
    return { belongs: true, reason: '', action: 'keep' };
  }

  // BL match
  if (shipmentBL && subjectUpper.includes(shipmentBL)) {
    return { belongs: true, reason: '', action: 'keep' };
  }

  // Container match
  for (const container of shipmentContainers) {
    if (subjectUpper.includes(container)) {
      return { belongs: true, reason: '', action: 'keep' };
    }
  }

  // Check if found bookings match
  for (const found of foundBookings) {
    if (found === shipmentBooking) {
      return { belongs: true, reason: '', action: 'keep' };
    }
  }

  // Check if found containers match
  for (const found of foundContainers) {
    if (shipmentContainers.includes(found)) {
      return { belongs: true, reason: '', action: 'keep' };
    }
  }

  // No match found - determine if clearly wrong or needs review
  if (foundBookings.length > 0) {
    // Subject has different booking numbers
    return {
      belongs: false,
      reason: `Subject contains different booking(s): ${foundBookings.join(', ')}`,
      action: 'remove',
    };
  }

  if (foundContainers.length > 0 && shipmentContainers.length > 0) {
    // Subject has containers but none match
    return {
      belongs: false,
      reason: `Subject has containers ${foundContainers.join(', ')} but shipment has ${shipmentContainers.join(', ')}`,
      action: 'review',
    };
  }

  // No identifiers in subject - could be general email
  if (subjectUpper.includes('DAILY') || subjectUpper.includes('SUMMARY') || subjectUpper.includes('REPORT')) {
    return {
      belongs: false,
      reason: 'Generic report/summary email - likely wrong link',
      action: 'remove',
    };
  }

  // No clear identifiers - needs review
  return {
    belongs: false,
    reason: 'No matching identifiers found in subject',
    action: 'review',
  };
}

function checkMisclassification(docType: string, subject: string): { suggestedType: string; reason: string } | null {
  const subjectLower = subject.toLowerCase();

  // Arrival notice but subject suggests booking
  if (docType === 'arrival_notice') {
    if (subjectLower.includes('booking') && !subjectLower.includes('arrival')) {
      return { suggestedType: 'booking_confirmation', reason: 'Subject mentions booking, not arrival' };
    }
    if (subjectLower.includes('cut off') || subjectLower.includes('cutoff')) {
      return { suggestedType: 'booking_confirmation', reason: 'Subject mentions cutoff - likely booking update' };
    }
  }

  // Delivery order but no delivery keywords
  if (docType === 'delivery_order') {
    if (!subjectLower.includes('delivery') && !subjectLower.includes('d/o') && !subjectLower.includes('release')) {
      if (subjectLower.includes('booking')) {
        return { suggestedType: 'booking_confirmation', reason: 'Subject mentions booking, not delivery' };
      }
      if (subjectLower.includes('invoice')) {
        return { suggestedType: 'invoice', reason: 'Subject mentions invoice' };
      }
    }
  }

  // SOB/Departed but subject suggests different
  if (docType === 'sob_confirmation' || docType === 'shipment_notice') {
    if (subjectLower.includes('gate') && subjectLower.includes('in')) {
      return { suggestedType: 'gate_in_confirmation', reason: 'Subject mentions gate-in, not departure' };
    }
    if (subjectLower.includes('booking') && !subjectLower.includes('sob') && !subjectLower.includes('shipped')) {
      return { suggestedType: 'booking_confirmation', reason: 'Subject mentions booking, not SOB' };
    }
  }

  // SI draft but subject suggests BL
  if (docType === 'si_draft') {
    if (subjectLower.includes('b/l') || subjectLower.includes('bill of lading') || subjectLower.includes('hbl')) {
      return { suggestedType: 'hbl_draft', reason: 'Subject mentions B/L, not SI' };
    }
  }

  return null;
}

main().catch(console.error);
