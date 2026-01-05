/**
 * Fix SI and SOB Workflow State Misclassifications
 *
 * Issues found:
 * 1. 11 carrier emails (service.hlag.com, cma-cgm.com) have si_draft_received → should be si_confirmed
 * 2. 2 customer emails have si_confirmed → should be si_draft_received
 * 3. 22 sob_confirmation documents have si_draft_received → should be sob_received
 *
 * Run: npx tsx scripts/fix-si-sob-workflow-states.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Carrier domain patterns
const CARRIER_DOMAINS = [
  'maersk.com', 'sealand.com', 'hapag-lloyd.com', 'hlag.com', 'hlag.cloud',
  'service.hlag.com', 'cma-cgm.com', 'cmacgm-group.com', 'apl.com',
  'coscon.com', 'oocl.com', 'evergreen-line.com', 'one-line.com',
  'yangming.com', 'zim.com', 'msc.com', 'hamburgsud.com'
];

function isCarrierSender(email: string | null): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  return CARRIER_DOMAINS.some(d => lower.includes(d));
}

function isIntogloSender(email: string | null): boolean {
  if (!email) return false;
  const lower = email.toLowerCase();
  return lower.includes('@intoglo.com') || lower.includes('@intoglo.in');
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════════');
  console.log('           FIX SI & SOB WORKFLOW STATE MISCLASSIFICATIONS');
  console.log('═══════════════════════════════════════════════════════════════════════════════════\n');

  // Fetch all SI-related classifications
  const { data: siDocs, error: siError } = await supabase
    .from('document_classifications')
    .select('id, email_id, document_type, workflow_state, document_direction')
    .in('workflow_state', ['si_draft_received', 'si_confirmed'])
    .order('created_at', { ascending: false });

  if (siError) {
    console.error('Error fetching SI docs:', siError);
    return;
  }

  // Fetch SOB misclassified as si_draft_received
  const { data: sobDocs, error: sobError } = await supabase
    .from('document_classifications')
    .select('id, email_id, document_type, workflow_state')
    .eq('document_type', 'sob_confirmation')
    .neq('workflow_state', 'sob_received');

  if (sobError) {
    console.error('Error fetching SOB docs:', sobError);
    return;
  }

  // Get all unique email IDs
  const allEmailIds = [
    ...siDocs!.map(d => d.email_id),
    ...sobDocs!.map(d => d.email_id)
  ];
  const uniqueEmailIds = [...new Set(allEmailIds)];

  // Fetch emails in batches
  const emails: Record<string, { sender_email: string }> = {};
  const batchSize = 100;

  for (let i = 0; i < uniqueEmailIds.length; i += batchSize) {
    const batch = uniqueEmailIds.slice(i, i + batchSize);
    const { data: emailBatch } = await supabase
      .from('raw_emails')
      .select('id, sender_email')
      .in('id', batch);

    emailBatch?.forEach(e => {
      emails[e.id] = { sender_email: e.sender_email };
    });
  }

  console.log(`Total SI classifications: ${siDocs!.length}`);
  console.log(`Total SOB misclassified: ${sobDocs!.length}`);
  console.log(`Total emails fetched: ${Object.keys(emails).length}\n`);

  // === FIX 1: SOB misclassifications ===
  console.log('=== FIX 1: SOB Confirmation → sob_received ===\n');

  const sobFixes: { id: string; from: string; to: string }[] = [];
  for (const doc of sobDocs!) {
    if (doc.workflow_state !== 'sob_received') {
      sobFixes.push({
        id: doc.id,
        from: doc.workflow_state,
        to: 'sob_received'
      });
    }
  }

  console.log(`SOB fixes needed: ${sobFixes.length}`);

  // === FIX 2: SI sender-based corrections ===
  console.log('\n=== FIX 2: SI Sender-Based Corrections ===\n');

  const siFixes: { id: string; from: string; to: string; sender: string; reason: string }[] = [];

  for (const doc of siDocs!) {
    const email = emails[doc.email_id];
    if (!email) continue;

    const sender = email.sender_email;
    const isCarrier = isCarrierSender(sender);
    const isIntoglo = isIntogloSender(sender);

    // Skip outbound (from Intoglo)
    if (isIntoglo) continue;

    // Check SI documents
    const siDocTypes = ['shipping_instruction', 'si_draft', 'si_submission'];
    if (siDocTypes.includes(doc.document_type)) {
      if (doc.workflow_state === 'si_draft_received' && isCarrier) {
        // Carrier email marked as si_draft_received → should be si_confirmed
        siFixes.push({
          id: doc.id,
          from: 'si_draft_received',
          to: 'si_confirmed',
          sender,
          reason: 'From carrier - should be SI confirmation'
        });
      } else if (doc.workflow_state === 'si_confirmed' && !isCarrier && !isIntoglo) {
        // Customer email marked as si_confirmed → should be si_draft_received
        siFixes.push({
          id: doc.id,
          from: 'si_confirmed',
          to: 'si_draft_received',
          sender,
          reason: 'From customer - should be SI draft'
        });
      }
    }
  }

  console.log(`SI fixes needed: ${siFixes.length}`);

  if (siFixes.length > 0) {
    console.log('\nSI fixes to apply:');
    siFixes.forEach((fix, i) => {
      console.log(`  ${i + 1}. ${fix.from} → ${fix.to}`);
      console.log(`     Sender: ${fix.sender}`);
      console.log(`     Reason: ${fix.reason}`);
    });
  }

  // === APPLY FIXES ===
  console.log('\n═══════════════════════════════════════════════════════════════════════════════════');
  console.log('                           APPLYING FIXES');
  console.log('═══════════════════════════════════════════════════════════════════════════════════\n');

  let sobFixed = 0;
  let siFixed = 0;

  // Apply SOB fixes
  for (const fix of sobFixes) {
    const { error } = await supabase
      .from('document_classifications')
      .update({ workflow_state: fix.to })
      .eq('id', fix.id);

    if (error) {
      console.error(`Failed to fix SOB ${fix.id}:`, error.message);
    } else {
      sobFixed++;
    }
  }

  // Apply SI fixes
  for (const fix of siFixes) {
    const { error } = await supabase
      .from('document_classifications')
      .update({ workflow_state: fix.to })
      .eq('id', fix.id);

    if (error) {
      console.error(`Failed to fix SI ${fix.id}:`, error.message);
    } else {
      siFixed++;
    }
  }

  console.log(`SOB fixes applied: ${sobFixed}/${sobFixes.length}`);
  console.log(`SI fixes applied: ${siFixed}/${siFixes.length}`);

  console.log('\n═══════════════════════════════════════════════════════════════════════════════════');
  console.log('                           SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════════\n');
  console.log(`Total fixes applied: ${sobFixed + siFixed}`);
  console.log('  - SOB confirmation → sob_received:', sobFixed);
  console.log('  - SI sender-based corrections:', siFixed);
  console.log('\nDone!');
}

main().catch(console.error);
