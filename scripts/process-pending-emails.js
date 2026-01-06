/**
 * Process pending broker emails using the orchestrator directly
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Import the orchestrator - need to use dynamic import for ESM
async function main() {
  console.log('='.repeat(100));
  console.log('PROCESSING PENDING BROKER EMAILS');
  console.log('='.repeat(100));

  // Get pending broker emails
  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email')
    .eq('processing_status', 'pending')
    .or('sender_email.ilike.%portside%,sender_email.ilike.%artemus%,sender_email.ilike.%sssusainc%,sender_email.ilike.%CHBentries%')
    .order('received_at', { ascending: false })
    .limit(20);

  console.log(`\nFound ${emails?.length || 0} pending broker emails\n`);

  if (!emails || emails.length === 0) {
    console.log('No pending emails to process');
    return;
  }

  // Process each email using the classification and extraction flow
  for (const email of emails) {
    console.log('─'.repeat(70));
    console.log('Processing:', email.id.substring(0, 8));
    console.log('Subject:', (email.subject || '').substring(0, 60));

    try {
      // 1. Get full email content
      const { data: fullEmail } = await supabase
        .from('raw_emails')
        .select('*')
        .eq('id', email.id)
        .single();

      // 2. Get attachments
      const { data: attachments } = await supabase
        .from('raw_attachments')
        .select('filename, extracted_text')
        .eq('email_id', email.id);

      const attachmentFilenames = attachments?.map(a => a.filename).filter(Boolean) || [];
      const attachmentContent = attachments
        ?.filter(a => a.extracted_text && a.extracted_text.length > 50)
        .map(a => a.extracted_text)
        .join('\n\n') || '';

      // 3. Classify using full content (attachments → body → subject)
      const subject = fullEmail.subject || '';
      const bodyText = fullEmail.body_text || '';
      const isReply = /^(re|fw|fwd):\s/i.test(subject);

      // Full classification: attachments first, then body, then subject
      const classification = classifyEmail({
        subject,
        bodyText,
        attachmentFilenames,
        attachmentContent,
        isReply
      });

      if (classification) {
        console.log(`  ✅ Classified: ${classification.type} (${classification.confidence}%) [${classification.source}]`);

        // Save classification
        await supabase.from('document_classifications').insert({
          email_id: email.id,
          document_type: classification.type,
          confidence_score: classification.confidence,
          model_name: 'regex-classifier',
          model_version: '1.0',
          classification_reason: `${classification.source} pattern match${classification.matchedPattern ? ': ' + classification.matchedPattern : ''}`,
          matched_patterns: [classification.type],
          classified_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        });
      }

      // 4. Extract entities from subject
      const entities = extractIdentifiers(subject);
      const entityRecords = [];

      if (entities.booking_number) {
        entityRecords.push({
          email_id: email.id,
          entity_type: 'booking_number',
          entity_value: entities.booking_number,
          confidence_score: 85,
          extraction_method: 'regex_subject'
        });
      }
      if (entities.hbl_number) {
        entityRecords.push({
          email_id: email.id,
          entity_type: 'hbl_number',
          entity_value: entities.hbl_number,
          confidence_score: 80,
          extraction_method: 'regex_subject'
        });
      }
      if (entities.container_number) {
        entityRecords.push({
          email_id: email.id,
          entity_type: 'container_number',
          entity_value: entities.container_number,
          confidence_score: 85,
          extraction_method: 'regex_subject'
        });
      }
      if (entities.entry_number) {
        entityRecords.push({
          email_id: email.id,
          entity_type: 'entry_number',
          entity_value: entities.entry_number,
          confidence_score: 80,
          extraction_method: 'regex_subject'
        });
      }

      if (entityRecords.length > 0) {
        await supabase.from('entity_extractions').insert(entityRecords);
        console.log(`  ✅ Extracted: ${entityRecords.map(e => e.entity_type).join(', ')}`);
      }

      // 5. Try to link to shipment or create orphan document
      if (classification) {
        let shipmentId = null;
        let matchedBy = null;

        // Try HBL first
        if (entities.hbl_number) {
          const { data: match } = await supabase
            .from('shipments')
            .select('id')
            .eq('hbl_number', entities.hbl_number)
            .single();
          if (match) {
            shipmentId = match.id;
            matchedBy = 'hbl';
          }
        }

        // Try booking number
        if (!shipmentId && entities.booking_number) {
          const { data: match } = await supabase
            .from('shipments')
            .select('id')
            .eq('booking_number', entities.booking_number)
            .single();
          if (match) {
            shipmentId = match.id;
            matchedBy = 'booking';
          }
        }

        // Try container number
        if (!shipmentId && entities.container_number) {
          const { data: match } = await supabase
            .from('shipments')
            .select('id')
            .contains('container_numbers', [entities.container_number])
            .limit(1);
          if (match && match.length > 0) {
            shipmentId = match[0].id;
            matchedBy = 'container';
          }
        }

        // Create document record
        await supabase.from('shipment_documents').insert({
          email_id: email.id,
          shipment_id: shipmentId,
          document_type: classification.type,
          booking_number_extracted: entities.booking_number || null,
          status: shipmentId ? 'linked' : 'pending_link',
          created_at: new Date().toISOString()
        });

        if (shipmentId) {
          console.log(`  ✅ Linked to shipment via ${matchedBy}`);
        } else {
          console.log(`  📋 Created orphan document (pending link)`);
        }
      }

      // 6. Update processing status
      await supabase
        .from('raw_emails')
        .update({ processing_status: 'processed' })
        .eq('id', email.id);

      console.log(`  ✅ Processed`);

    } catch (err) {
      console.log(`  ❌ Error:`, err.message);
      await supabase
        .from('raw_emails')
        .update({
          processing_status: 'failed',
          processing_error: err.message
        })
        .eq('id', email.id);
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log('PROCESSING COMPLETE');
  console.log('='.repeat(100));
}

// ============================================================================
// FULL CLASSIFICATION (mirrors production UnifiedClassificationService)
// Priority: 1. Attachments → 2. Body → 3. Subject
// ============================================================================

function classifyEmail({ subject, bodyText, attachmentFilenames, attachmentContent, isReply }) {
  const cleanedSubject = subject.replace(/^(RE|Re|FW|Fw|FWD|Fwd):\s*/gi, '').trim();

  // ===== STEP 1: Attachment filename patterns (95% confidence) =====
  if (attachmentFilenames && attachmentFilenames.length > 0) {
    const attachmentResult = classifyByAttachment(attachmentFilenames);
    if (attachmentResult) {
      return { ...attachmentResult, source: 'attachment' };
    }
  }

  // ===== STEP 2: Body/Content patterns (90% confidence) =====
  // For thread replies, body is more reliable than subject
  const content = `${bodyText || ''} ${attachmentContent || ''}`.toLowerCase();
  if (content.length > 50) {
    const contentResult = classifyByContent(content);
    if (contentResult) {
      return { ...contentResult, source: 'body' };
    }
  }

  // ===== STEP 3: Subject patterns (85-95% confidence) =====
  const subjectResult = classifyBySubject(cleanedSubject);
  if (subjectResult) {
    return { ...subjectResult, source: 'subject' };
  }

  return null;
}

// Attachment filename patterns
function classifyByAttachment(filenames) {
  const patterns = [
    // Customs/Broker documents
    { pattern: /7501/i, type: 'entry_summary', confidence: 95 },
    { pattern: /3461/i, type: 'draft_entry', confidence: 95 },
    { pattern: /entry[-_\s]?summary/i, type: 'entry_summary', confidence: 95 },
    { pattern: /duty[-_\s]?invoice|customs[-_\s]?invoice/i, type: 'duty_invoice', confidence: 95 },
    { pattern: /cargo[-_\s]?release/i, type: 'customs_clearance', confidence: 95 },
    { pattern: /delivery[-_\s]?order|DO[-_]?\d/i, type: 'delivery_order', confidence: 95 },
    { pattern: /arrival[-_\s]?notice/i, type: 'arrival_notice', confidence: 95 },
    { pattern: /isf/i, type: 'isf_filing', confidence: 90 },
    { pattern: /ams/i, type: 'ams_filing', confidence: 90 },
    // Shipping documents
    { pattern: /booking[-_\s]?confirm/i, type: 'booking_confirmation', confidence: 95 },
    { pattern: /bill[-_\s]?of[-_\s]?lading|B[\/]?L/i, type: 'bill_of_lading', confidence: 95 },
    { pattern: /shipping[-_\s]?instruction|SI[-_]/i, type: 'shipping_instruction', confidence: 95 },
    { pattern: /commercial[-_\s]?invoice/i, type: 'commercial_invoice', confidence: 95 },
    { pattern: /packing[-_\s]?list/i, type: 'packing_list', confidence: 95 },
  ];

  for (const filename of filenames) {
    for (const { pattern, type, confidence } of patterns) {
      if (pattern.test(filename)) {
        return { type, confidence, matchedPattern: filename };
      }
    }
  }
  return null;
}

// Body/content patterns (for thread replies)
function classifyByContent(content) {
  const patterns = [
    // High specificity content patterns
    { patterns: [/entry\s+summary/i, /7501\s+form/i], type: 'entry_summary', confidence: 90 },
    { patterns: [/cargo\s+release/i, /released\s+for\s+delivery/i], type: 'customs_clearance', confidence: 90 },
    { patterns: [/duty\s+amount|total\s+duty/i], type: 'duty_invoice', confidence: 90 },
    { patterns: [/isf\s+(?:filing|error|submitted)/i], type: 'isf_filing', confidence: 90 },
    { patterns: [/ams\s+(?:filing|error|submitted)/i], type: 'ams_filing', confidence: 90 },
    { patterns: [/delivery\s+order/i, /release\s+cargo\s+to/i], type: 'delivery_order', confidence: 90 },
    { patterns: [/arrival\s+notice/i, /vessel\s+arrived/i], type: 'arrival_notice', confidence: 90 },
    // SI/BL patterns
    { patterns: [/draft\s+(?:bl|bill\s+of\s+lading)/i], type: 'draft_bl', confidence: 90 },
    { patterns: [/shipping\s+instruction/i, /si\s+confirmation/i], type: 'shipping_instruction', confidence: 90 },
  ];

  for (const { patterns: pats, type, confidence } of patterns) {
    if (pats.some(p => p.test(content))) {
      return { type, confidence };
    }
  }
  return null;
}

// Subject patterns (original)
function classifyBySubject(subject) {
  const patterns = [
    // Portside
    { pattern: /\d{3}-\d{7}-\d-3461\b/, type: 'draft_entry', confidence: 95 },
    { pattern: /\d{3}-\d{7}-\d-7501\b/, type: 'entry_summary', confidence: 95 },
    { pattern: /\b7501\b/, type: 'entry_summary', confidence: 85 },
    { pattern: /^Invoice-\d{6,}/i, type: 'duty_invoice', confidence: 95 },
    { pattern: /Cargo\s+Release/i, type: 'customs_clearance', confidence: 95 },
    // Artemus
    { pattern: /ENTRY\s*\d{1,3}[A-Z]{1,3}[-\s]*\d{8}/i, type: 'entry_summary', confidence: 90 },
    { pattern: /ISF\s+ERROR/i, type: 'isf_filing', confidence: 90 },
    { pattern: /AMS\s+ERROR/i, type: 'ams_filing', confidence: 90 },
    { pattern: /E-Manifest/i, type: 'manifest', confidence: 85 },
    // General
    { pattern: /PRE-ALERT/i, type: 'pre_alert', confidence: 85 },
    { pattern: /Arrival\s+Notice/i, type: 'arrival_notice', confidence: 90 },
    { pattern: /Work\s+Order/i, type: 'work_order', confidence: 90 },
    { pattern: /Payment\s+Receipt/i, type: 'payment_receipt', confidence: 90 },
    { pattern: /Delivery\s+Order/i, type: 'delivery_order', confidence: 90 },
  ];

  for (const { pattern, type, confidence } of patterns) {
    if (pattern.test(subject)) {
      return { type, confidence };
    }
  }
  return null;
}

// Extraction patterns
function extractIdentifiers(subject) {
  const result = {};

  // Booking/Deal ID
  const dealMatch = subject.match(/\b([A-Z]{5,7}\d{8,12}_I)\b/);
  if (dealMatch) result.booking_number = dealMatch[1].toUpperCase();

  // Container
  const containerMatch = subject.match(/\b([A-Z]{4}\d{7})\b/);
  if (containerMatch) result.container_number = containerMatch[1].toUpperCase();

  // Entry number
  const entryMatch = subject.match(/ENTRY\s*(\d{1,3}[A-Z]{1,3}[-\s]*\d{8})/i) ||
                     subject.match(/\b(\d{3}-\d{7}-\d)(?:-\d{4})?\b/);
  if (entryMatch) result.entry_number = entryMatch[1].replace(/\s+/g, '').toUpperCase();

  // HBL
  const hblMatch = subject.match(/HBL[#:\s]+([A-Z]{2}\d{10,})/i) ||
                   subject.match(/\b(SE\d{10,})\b/i) ||
                   subject.match(/HBL(?:\s*NO\.?)?:?\s*([A-Z0-9]{6,})/i) ||
                   subject.match(/\b(SWLLUD\d{6,})\b/i) ||
                   subject.match(/\b(LUDSE\d{4,})\b/i);
  if (hblMatch) result.hbl_number = hblMatch[1].toUpperCase();

  return result;
}

main().catch(console.error);
