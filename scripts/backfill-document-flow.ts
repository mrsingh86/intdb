/**
 * Backfill Document Flow Tracking for Existing Classifications
 *
 * Updates existing document_classifications with:
 * - document_direction (inbound/outbound)
 * - sender_party_type
 * - receiver_party_type
 * - workflow_state
 * - requires_approval_from
 * - revision_type & revision_number
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://fdmcdbvkfdmrdowfjrcz.supabase.co',
  'sb_publishable_v9RFIqbeitIgL4y6MXPLNg_CyC2YwRm'
);

// Shipping line domain patterns
const SHIPPING_LINE_DOMAINS: Record<string, string> = {
  'maersk.com': 'Maersk',
  'apmterminals.com': 'Maersk',
  'hlag.com': 'Hapag-Lloyd',
  'service.hlag.com': 'Hapag-Lloyd',
  'msc.com': 'MSC',
  'medlog.com': 'MSC',
  'cma-cgm.com': 'CMA CGM',
  'cosco.com': 'COSCO',
  'oocl.com': 'OOCL',
  'evergreen-line.com': 'Evergreen',
  'one-line.com': 'ONE',
  'yml.com.tw': 'Yang Ming',
  'zim.com': 'ZIM',
};

type PartyType = 'shipping_line' | 'cha' | 'custom_broker' | 'consignee' | 'shipper' | 'forwarder' | 'intoglo' | 'agent' | 'unknown';

function detectSenderPartyType(senderEmail: string, subject: string): PartyType {
  const email = (senderEmail || '').toLowerCase();
  const lowerSubject = (subject || '').toLowerCase();

  for (const domain of Object.keys(SHIPPING_LINE_DOMAINS)) {
    if (email.includes(domain)) return 'shipping_line';
  }

  if (email.includes('intoglo.com')) return 'intoglo';
  if (['customs', 'clearance', 'cha', 'broker'].some(kw => lowerSubject.includes(kw) || email.includes(kw))) return 'cha';
  if (['duty', 'customs broker'].some(kw => lowerSubject.includes(kw))) return 'custom_broker';

  return 'unknown';
}

function extractRevisionInfo(subject: string): { revision_type: string; revision_number: number } {
  const upperSubject = (subject || '').toUpperCase();

  if (upperSubject.includes('CANCEL') || upperSubject.includes('VOID')) {
    return { revision_type: 'cancellation', revision_number: 0 };
  }

  const updateMatch = upperSubject.match(/(\d+)(?:ST|ND|RD|TH)\s*UPDATE/i);
  if (updateMatch) return { revision_type: 'update', revision_number: parseInt(updateMatch[1]) };

  if (upperSubject.includes('UPDATE') || upperSubject.includes('REVISED')) {
    return { revision_type: 'update', revision_number: 1 };
  }

  const amendmentMatch = upperSubject.match(/AMENDMENT\s*(\d+)?/i);
  if (amendmentMatch) return { revision_type: 'amendment', revision_number: amendmentMatch[1] ? parseInt(amendmentMatch[1]) : 1 };

  if (upperSubject.includes('AMEND') || upperSubject.includes('CHANGE')) {
    return { revision_type: 'amendment', revision_number: 1 };
  }

  return { revision_type: 'original', revision_number: 0 };
}

function getReceiverPartyType(documentType: string, senderPartyType: PartyType): PartyType {
  if (senderPartyType === 'shipping_line') {
    if (documentType === 'arrival_notice') return 'consignee';
    return 'shipper';
  }
  if (senderPartyType === 'cha' || senderPartyType === 'custom_broker') return 'shipper';
  if (senderPartyType === 'shipper') return 'intoglo';
  return 'intoglo';
}

function getWorkflowState(documentType: string, senderPartyType: PartyType): { state: string; requiresApprovalFrom: string | null } {
  if (senderPartyType === 'shipping_line') {
    if (documentType === 'booking_amendment') return { state: 'pending_approval', requiresApprovalFrom: 'shipper' };
    if (documentType === 'invoice' || documentType === 'freight_invoice') return { state: 'pending_approval', requiresApprovalFrom: 'shipper' };
    return { state: 'received', requiresApprovalFrom: null };
  }
  if (senderPartyType === 'cha' || senderPartyType === 'custom_broker') {
    return { state: 'pending_approval', requiresApprovalFrom: 'shipper' };
  }
  if (senderPartyType === 'shipper') return { state: 'approved', requiresApprovalFrom: null };
  return { state: 'received', requiresApprovalFrom: null };
}

async function backfill() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║              BACKFILL: Document Flow Tracking                                                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  // Get all classifications with their email data
  const { data: classifications, error } = await supabase
    .from('document_classifications')
    .select('id, email_id, document_type')
    .is('sender_party_type', null);

  if (error) {
    console.error('❌ Error fetching classifications:', error.message);
    return;
  }

  if (!classifications || classifications.length === 0) {
    console.log('✅ All classifications already have flow tracking data!');
    return;
  }

  console.log(`📊 Found ${classifications.length} classifications to update\n`);

  // Get email data for lookups
  const emailIds = classifications.map(c => c.email_id).filter(Boolean);
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, sender_email, subject')
    .in('id', emailIds);

  const emailMap = new Map(emails?.map(e => [e.id, e]) || []);

  let updated = 0;
  let failed = 0;

  for (const classification of classifications) {
    const email = emailMap.get(classification.email_id);
    if (!email) {
      failed++;
      continue;
    }

    const senderPartyType = detectSenderPartyType(email.sender_email, email.subject);
    const documentDirection = senderPartyType === 'intoglo' ? 'outbound' : 'inbound';
    const receiverPartyType = getReceiverPartyType(classification.document_type, senderPartyType);
    const workflowInfo = getWorkflowState(classification.document_type, senderPartyType);
    const revisionInfo = extractRevisionInfo(email.subject);

    const { error: updateError } = await supabase
      .from('document_classifications')
      .update({
        document_direction: documentDirection,
        sender_party_type: senderPartyType,
        receiver_party_type: receiverPartyType,
        workflow_state: workflowInfo.state,
        requires_approval_from: workflowInfo.requiresApprovalFrom,
        revision_type: revisionInfo.revision_type,
        revision_number: revisionInfo.revision_number
      })
      .eq('id', classification.id);

    if (updateError) {
      console.error(`  ❌ Failed to update ${classification.id}:`, updateError.message);
      failed++;
    } else {
      updated++;
    }
  }

  console.log('\n' + '═'.repeat(100));
  console.log('BACKFILL COMPLETE');
  console.log('═'.repeat(100));
  console.log(`\n✅ Updated: ${updated}`);
  console.log(`❌ Failed:  ${failed}`);
  console.log(`📊 Total:   ${classifications.length}\n`);

  // Show sample results
  const { data: sample } = await supabase
    .from('document_classifications')
    .select('document_type, sender_party_type, document_direction, workflow_state, revision_type')
    .not('sender_party_type', 'is', null)
    .limit(5);

  console.log('📋 Sample Results:');
  sample?.forEach(s => {
    console.log(`   ${s.document_type} | ${s.document_direction} from ${s.sender_party_type} | ${s.workflow_state} | ${s.revision_type}`);
  });
}

backfill().catch(console.error);
