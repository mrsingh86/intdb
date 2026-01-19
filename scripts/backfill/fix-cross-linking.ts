/**
 * Fix Cross-Linking: Email should link to ONE shipment only
 *
 * Problem: Emails with multiple booking numbers get linked to ALL matching shipments
 * Solution: Keep only the BEST link per email, remove duplicates
 *
 * Priority for keeping link:
 * 1. Shipment was CREATED from this email (created_from_email_id matches)
 * 2. Booking number appears in email SUBJECT (primary identifier)
 * 3. Highest link_confidence_score
 * 4. Earliest created link
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

interface LinkInfo {
  id: string;
  email_id: string;
  shipment_id: string;
  document_type: string;
  link_confidence_score: number;
  created_at: string;
}

async function fixCrossLinking(): Promise<void> {
  console.log('='.repeat(60));
  console.log('FIX CROSS-LINKING: One Email → One Shipment');
  console.log('='.repeat(60));

  // Step 1: Find all links (paginate to handle large datasets)
  let allLinks: LinkInfo[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data: batch } = await supabase
      .from('shipment_documents')
      .select('id, email_id, shipment_id, document_type, link_confidence_score, created_at')
      .not('email_id', 'is', null)
      .range(offset, offset + pageSize - 1);

    if (!batch || batch.length === 0) break;
    allLinks = allLinks.concat(batch as LinkInfo[]);
    offset += pageSize;
    console.log(`Loaded ${allLinks.length} links...`);
    if (batch.length < pageSize) break;
  }

  console.log(`Total links loaded: ${allLinks.length}`);

  const emailLinks: Record<string, LinkInfo[]> = {};
  for (const link of allLinks || []) {
    if (!emailLinks[link.email_id]) emailLinks[link.email_id] = [];
    emailLinks[link.email_id].push(link as LinkInfo);
  }

  // Find emails with multiple links
  const crossLinked = Object.entries(emailLinks).filter(([_, links]) => links.length > 1);
  console.log(`\nFound ${crossLinked.length} emails linked to multiple shipments\n`);

  if (crossLinked.length === 0) {
    console.log('No cross-linking issues found!');
    return;
  }

  // Step 2: Get shipment info for priority determination
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, created_from_email_id');

  const shipmentInfo = new Map<string, { booking_number: string; created_from_email_id: string | null }>();
  for (const s of shipments || []) {
    shipmentInfo.set(s.id, {
      booking_number: s.booking_number,
      created_from_email_id: s.created_from_email_id,
    });
  }

  // Step 3: Get email subjects for booking number detection
  const crossLinkedEmailIds = crossLinked.map(([emailId]) => emailId);
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject')
    .in('id', crossLinkedEmailIds);

  const emailSubjects = new Map<string, string>();
  for (const e of emails || []) {
    emailSubjects.set(e.id, e.subject || '');
  }

  // Step 4: Process each cross-linked email
  let fixed = 0;
  let linksRemoved = 0;
  const removedByReason: Record<string, number> = {};

  for (const [emailId, links] of crossLinked) {
    const subject = emailSubjects.get(emailId) || '';

    // Score each link
    const scoredLinks = links.map(link => {
      const shipment = shipmentInfo.get(link.shipment_id);
      let score = 0;
      let reason = '';

      // Priority 1: Shipment was created from this email (score: 1000)
      if (shipment?.created_from_email_id === emailId) {
        score += 1000;
        reason = 'created_from_email';
      }

      // Priority 2: Booking number in subject (score: 100)
      if (shipment?.booking_number && subject.includes(shipment.booking_number)) {
        score += 100;
        if (!reason) reason = 'booking_in_subject';
      }

      // Priority 3: Link confidence (score: 0-100)
      score += link.link_confidence_score || 0;

      // Priority 4: Earlier created (lower score for later links)
      // Already sorted by created_at ascending, so first link gets natural advantage

      return { ...link, score, reason: reason || 'confidence_only' };
    });

    // Sort by score descending
    scoredLinks.sort((a, b) => b.score - a.score);

    // Keep the best link, remove others
    const bestLink = scoredLinks[0];
    const linksToRemove = scoredLinks.slice(1);

    if (linksToRemove.length > 0) {
      const idsToRemove = linksToRemove.map(l => l.id);

      const { error } = await supabase
        .from('shipment_documents')
        .delete()
        .in('id', idsToRemove);

      if (!error) {
        fixed++;
        linksRemoved += linksToRemove.length;

        // Track removal reasons
        for (const removed of linksToRemove) {
          const reason = `kept:${bestLink.reason}`;
          removedByReason[reason] = (removedByReason[reason] || 0) + 1;
        }

        if (fixed <= 5) {
          console.log(`Email ${emailId.substring(0, 8)}...:`);
          console.log(`  Subject: ${subject.substring(0, 50)}...`);
          console.log(`  KEPT: ${shipmentInfo.get(bestLink.shipment_id)?.booking_number} (score: ${bestLink.score}, reason: ${bestLink.reason})`);
          console.log(`  REMOVED: ${linksToRemove.length} links`);
          for (const r of linksToRemove) {
            console.log(`    - ${shipmentInfo.get(r.shipment_id)?.booking_number} (score: ${r.score})`);
          }
          console.log('');
        }
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('CROSS-LINKING FIX COMPLETE');
  console.log('='.repeat(60));
  console.log(`Emails fixed: ${fixed}`);
  console.log(`Total links removed: ${linksRemoved}`);
  console.log('\nRemoval breakdown:');
  for (const [reason, count] of Object.entries(removedByReason).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${reason}: ${count}`);
  }

  // Verify: Check remaining cross-links
  console.log('\nVerifying...');
  const { data: verifyLinks } = await supabase
    .from('shipment_documents')
    .select('email_id, shipment_id')
    .not('email_id', 'is', null);

  const verifyEmailShipments: Record<string, Set<string>> = {};
  for (const l of verifyLinks || []) {
    if (!verifyEmailShipments[l.email_id]) verifyEmailShipments[l.email_id] = new Set();
    verifyEmailShipments[l.email_id].add(l.shipment_id);
  }

  const remainingCrossLinks = Object.values(verifyEmailShipments).filter(s => s.size > 1).length;
  console.log(`Remaining cross-linked emails: ${remainingCrossLinks}`);
}

fixCrossLinking().catch(console.error);
