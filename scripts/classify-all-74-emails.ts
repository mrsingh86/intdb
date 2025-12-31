/**
 * Classify All 74 Emails and Extract Entities
 * Processes all emails in raw_emails table
 */

import { supabase } from '../utils/supabase-client';
import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const HAIKU_MODEL = 'claude-3-5-haiku-20241022';

interface ClassificationResult {
  document_type: string;
  confidence_score: number;
  classification_reason: string;
  revision_type?: 'original' | 'update' | 'amendment' | 'cancellation';
  revision_number?: number;
}

interface EntityResult {
  entity_type: string;
  entity_value: string;
  confidence_score: number;
}

/**
 * Extract revision type and number from email subject
 * Detects patterns like "3RD UPDATE", "AMENDMENT 2", "REVISED"
 */
function extractRevisionInfo(subject: string): { revision_type: 'original' | 'update' | 'amendment' | 'cancellation'; revision_number: number } {
  const upperSubject = subject.toUpperCase();

  // Check for cancellation
  if (upperSubject.includes('CANCEL') || upperSubject.includes('VOID')) {
    return { revision_type: 'cancellation', revision_number: 0 };
  }

  // Check for numbered updates: "1ST UPDATE", "2ND UPDATE", "3RD UPDATE", etc.
  const updateMatch = upperSubject.match(/(\d+)(?:ST|ND|RD|TH)\s*UPDATE/i);
  if (updateMatch) {
    return { revision_type: 'update', revision_number: parseInt(updateMatch[1]) };
  }

  // Check for "UPDATE" without number
  if (upperSubject.includes('UPDATE') || upperSubject.includes('REVISED') || upperSubject.includes('REVISION')) {
    return { revision_type: 'update', revision_number: 1 };
  }

  // Check for amendment
  const amendmentMatch = upperSubject.match(/AMENDMENT\s*(\d+)?/i);
  if (amendmentMatch) {
    return { revision_type: 'amendment', revision_number: amendmentMatch[1] ? parseInt(amendmentMatch[1]) : 1 };
  }

  if (upperSubject.includes('AMEND') || upperSubject.includes('CHANGE')) {
    return { revision_type: 'amendment', revision_number: 1 };
  }

  // Default: original document
  return { revision_type: 'original', revision_number: 0 };
}

/**
 * Shipping line domain patterns for party type detection
 */
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

const CHA_KEYWORDS = ['customs', 'clearance', 'cha', 'broker'];
const CUSTOM_BROKER_KEYWORDS = ['duty', 'customs broker', 'cbsa', 'customs duty'];

type PartyType = 'shipping_line' | 'cha' | 'custom_broker' | 'consignee' | 'shipper' | 'forwarder' | 'intoglo' | 'agent' | 'unknown';

/**
 * Detect sender party type from email address and subject
 */
function detectSenderPartyType(senderEmail: string, subject: string): PartyType {
  const email = senderEmail.toLowerCase();
  const lowerSubject = subject.toLowerCase();

  // Check for shipping line domains
  for (const [domain, _carrier] of Object.entries(SHIPPING_LINE_DOMAINS)) {
    if (email.includes(domain)) {
      return 'shipping_line';
    }
  }

  // Check for Intoglo
  if (email.includes('intoglo.com')) {
    return 'intoglo';
  }

  // Check for CHA keywords in subject or email
  if (CHA_KEYWORDS.some(kw => lowerSubject.includes(kw) || email.includes(kw))) {
    return 'cha';
  }

  // Check for custom broker keywords
  if (CUSTOM_BROKER_KEYWORDS.some(kw => lowerSubject.includes(kw))) {
    return 'custom_broker';
  }

  return 'unknown';
}

/**
 * Determine document direction based on sender
 * Inbound = document coming TO Intoglo
 * Outbound = document sent FROM Intoglo
 */
function detectDocumentDirection(senderPartyType: PartyType): 'inbound' | 'outbound' | 'internal' {
  if (senderPartyType === 'intoglo') {
    return 'outbound';
  }
  return 'inbound';
}

/**
 * Determine default workflow state based on document type and sender
 */
function getDefaultWorkflowState(
  documentType: string,
  senderPartyType: PartyType
): { state: string; requiresApprovalFrom: PartyType | null } {
  // Documents from shipping lines
  if (senderPartyType === 'shipping_line') {
    if (documentType === 'booking_amendment') {
      return { state: 'pending_approval', requiresApprovalFrom: 'shipper' };
    }
    if (documentType === 'invoice' || documentType === 'freight_invoice') {
      return { state: 'pending_approval', requiresApprovalFrom: 'shipper' };
    }
    return { state: 'received', requiresApprovalFrom: null };
  }

  // Documents from CHA
  if (senderPartyType === 'cha') {
    return { state: 'pending_approval', requiresApprovalFrom: 'shipper' };
  }

  // Documents from custom broker
  if (senderPartyType === 'custom_broker') {
    return { state: 'pending_approval', requiresApprovalFrom: 'shipper' };
  }

  // Documents from shipper (approvals)
  if (senderPartyType === 'shipper') {
    return { state: 'approved', requiresApprovalFrom: null };
  }

  return { state: 'received', requiresApprovalFrom: null };
}

/**
 * Determine receiver party type based on document type and sender
 */
function getReceiverPartyType(documentType: string, senderPartyType: PartyType): PartyType {
  // If from shipping line, receiver depends on document type
  if (senderPartyType === 'shipping_line') {
    if (documentType === 'arrival_notice') {
      return 'consignee';
    }
    return 'shipper';
  }

  // If from CHA or custom broker, goes to shipper for approval
  if (senderPartyType === 'cha' || senderPartyType === 'custom_broker') {
    return 'shipper';
  }

  // If from shipper (approval), goes back to original sender
  if (senderPartyType === 'shipper') {
    return 'intoglo'; // Intoglo will forward to appropriate party
  }

  return 'intoglo';
}

async function classifyEmail(email: any): Promise<ClassificationResult> {
  const prompt = `Classify this shipping/logistics email:

Subject: ${email.subject}
From: ${email.sender_email}
Body: ${email.body_text?.substring(0, 1000) || email.snippet || 'No content'}

Classify as one of:
- booking_confirmation: Booking confirmation from shipping line
- booking_amendment: Changes to existing booking
- shipping_instruction: SI/VGM submission
- bill_of_lading: BL issuance or amendment
- arrival_notice: Container arrival notification
- delivery_order: DO issuance
- customs_document: Customs clearance documents
- detention_notice: Container detention/demurrage
- invoice: Freight or service invoice
- other: Other document types

Return JSON only:
{
  "document_type": "type",
  "confidence_score": 85,
  "classification_reason": "brief reason"
}`;

  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 500,
    temperature: 0.1,
    messages: [{ role: 'user', content: prompt }]
  });

  const content = response.content[0];
  if (content.type === 'text') {
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  }

  return {
    document_type: 'other',
    confidence_score: 50,
    classification_reason: 'Failed to parse response'
  };
}

async function extractEntities(email: any, classification: ClassificationResult): Promise<EntityResult[]> {
  const content = email.body_text || email.snippet || '';

  // Extract more content and specifically look for deadline sections
  const fullContent = content.substring(0, 4000);

  // Try to find deadline table section for better extraction
  const deadlineIdx = content.toLowerCase().indexOf('deadline');
  const deadlineSection = deadlineIdx > 0
    ? content.substring(deadlineIdx, deadlineIdx + 1500)
    : '';

  const prompt = `Extract shipping entities from this email. Pay special attention to deadline/cutoff tables.

Subject: ${email.subject}
Content: ${fullContent}
${deadlineSection ? `\nDeadline Section:\n${deadlineSection}` : ''}

IMPORTANT: Look for deadline tables with patterns like:
- "Shipping instruction closing" or "SI" → extract as si_cutoff (date/time)
- "VGM cut-off" → extract as vgm_cutoff (date/time)
- "FCL delivery cut-off" or "Cargo cut-off" → extract as cargo_cutoff (date/time)
- "Gate cut-off" → extract as gate_cutoff (date/time)
- Dates appear as "DD-Mon-YYYY HH:MM" (e.g., "25-Dec-2025 10:00")

Extract and return JSON array of entities:
[
  {"entity_type": "booking_number", "entity_value": "ABC123", "confidence_score": 95},
  {"entity_type": "si_cutoff", "entity_value": "2025-12-25T10:00:00", "confidence_score": 90}
]

Entity types: booking_number, bl_number, container_number, vessel_name, voyage_number, port_of_loading, port_of_discharge, etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff, gate_cutoff

For dates, convert to ISO format: YYYY-MM-DDTHH:MM:SS
Return empty array [] if no entities found.`;

  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1000,
    temperature: 0.1,
    messages: [{ role: 'user', content: prompt }]
  });

  const responseContent = response.content[0];
  if (responseContent.type === 'text') {
    const jsonMatch = responseContent.text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  }

  return [];
}

async function processAllEmails() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         CLASSIFY & EXTRACT ALL 74 EMAILS                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Fetch all emails
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('*')
    .order('received_at', { ascending: false });

  if (error || !emails) {
    console.error('❌ Error fetching emails:', error);
    return;
  }

  console.log(`📧 Found ${emails.length} emails to process\n`);

  let processed = 0;
  let classified = 0;
  let entitiesExtracted = 0;

  for (const email of emails) {
    try {
      console.log(`\n[${processed + 1}/${emails.length}] Processing: ${email.subject}`);

      // Check if already classified
      const { data: existing } = await supabase
        .from('document_classifications')
        .select('id')
        .eq('email_id', email.id)
        .single();

      if (existing) {
        console.log('  ⏭️  Already classified - skipping');
        processed++;
        continue;
      }

      // Classify
      console.log('  🤖 Classifying...');
      const classification = await classifyEmail(email);

      // Extract revision info from subject
      const revisionInfo = extractRevisionInfo(email.subject || '');

      // Detect document flow information
      const senderPartyType = detectSenderPartyType(email.sender_email || '', email.subject || '');
      const documentDirection = detectDocumentDirection(senderPartyType);
      const receiverPartyType = getReceiverPartyType(classification.document_type, senderPartyType);
      const workflowInfo = getDefaultWorkflowState(classification.document_type, senderPartyType);

      // Save classification with revision tracking AND flow tracking
      const { data: classRecord, error: classError } = await supabase
        .from('document_classifications')
        .insert({
          email_id: email.id,
          document_type: classification.document_type,
          confidence_score: classification.confidence_score,
          model_name: HAIKU_MODEL,
          model_version: '2024-10-22',
          classification_reason: classification.classification_reason,
          // Revision tracking
          revision_type: revisionInfo.revision_type,
          revision_number: revisionInfo.revision_number,
          // Document flow tracking
          document_direction: documentDirection,
          sender_party_type: senderPartyType,
          receiver_party_type: receiverPartyType,
          workflow_state: workflowInfo.state,
          requires_approval_from: workflowInfo.requiresApprovalFrom
        })
        .select()
        .single();

      if (classError) {
        console.error('  ❌ Classification failed:', classError.message);
        processed++;
        continue;
      }

      console.log(`  ✅ Classified as: ${classification.document_type} (${classification.confidence_score}%)`);
      if (revisionInfo.revision_type !== 'original') {
        console.log(`  📝 Revision: ${revisionInfo.revision_type} #${revisionInfo.revision_number}`);
      }
      console.log(`  📨 Flow: ${documentDirection.toUpperCase()} from ${senderPartyType} → ${receiverPartyType}`);
      if (workflowInfo.requiresApprovalFrom) {
        console.log(`  ⏳ Status: ${workflowInfo.state} (needs ${workflowInfo.requiresApprovalFrom} approval)`);
      }
      classified++;

      // Extract entities
      console.log('  🔍 Extracting entities...');
      const entities = await extractEntities(email, classification);

      if (entities.length > 0) {
        const entityRecords = entities.map(e => ({
          email_id: email.id,
          classification_id: classRecord.id,
          entity_type: e.entity_type,
          entity_value: e.entity_value,
          confidence_score: e.confidence_score,
          extraction_method: 'ai_extraction',
          // Phase 1: Track source document type for multi-source conflict detection
          source_document_type: classification.document_type
        }));

        const { error: entityError } = await supabase
          .from('entity_extractions')
          .insert(entityRecords);

        if (!entityError) {
          console.log(`  ✅ Extracted ${entities.length} entities`);
          entitiesExtracted += entities.length;
        }
      } else {
        console.log('  ℹ️  No entities found');
      }

      processed++;

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (error: any) {
      console.error(`  ❌ Error:`, error.message);
      processed++;
    }
  }

  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                         SUMMARY                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
  console.log(`✅ Emails processed:       ${processed}`);
  console.log(`✅ Emails classified:      ${classified}`);
  console.log(`✅ Entities extracted:     ${entitiesExtracted}`);
  console.log('\n🎉 Done! Your feedback system is now ready to use.\n');
}

processAllEmails().catch(console.error);
