/**
 * View Complete Pipeline for SENT Emails Only
 * Shows: Raw Email Data → AI Classification → Entity Extraction
 */

import { supabase } from '../utils/supabase-client';

async function viewSentEmailsPipeline() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                  SENT EMAILS - COMPLETE DATA PIPELINE (RAW → CLASSIFY → EXTRACT)              ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  // Fetch sent emails (those with SENT label or from ops@intoglo.com)
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select(`
      id,
      subject,
      sender_email,
      sender_name,
      recipient_emails,
      body_text,
      snippet,
      received_at,
      has_attachments,
      attachment_count,
      labels,
      document_classifications (
        id,
        document_type,
        confidence_score,
        model_name,
        model_version,
        classification_reason,
        matched_patterns,
        classified_at
      ),
      entity_extractions (
        id,
        entity_type,
        entity_value,
        confidence_score,
        extraction_method,
        extracted_at
      )
    `)
    .order('received_at', { ascending: false })
    .limit(15);

  if (error) {
    console.error('Error:', error);
    return;
  }

  if (!emails || emails.length === 0) {
    console.log('No emails found');
    return;
  }

  // Filter to only sent emails (those with body_text or meaningful content)
  const sentEmails = emails.filter(e =>
    (e.body_text && e.body_text.length > 100) ||
    (e.subject && !e.subject.includes('Failed to fetch'))
  );

  sentEmails.forEach((email, idx) => {
    console.log('\n═'.repeat(100));
    console.log(`SENT EMAIL ${idx + 1} of ${sentEmails.length}`);
    console.log('═'.repeat(100));

    // STEP 1: RAW EMAIL DATA
    console.log('\n📧 STEP 1: RAW EMAIL DATA (Stored in raw_emails table)');
    console.log('─'.repeat(100));
    console.log(`Email ID:        ${email.id}`);
    console.log(`Subject:         ${email.subject}`);
    console.log(`From:            ${email.sender_email}${email.sender_name ? ' (' + email.sender_name + ')' : ''}`);
    console.log(`To:              ${email.recipient_emails?.join(', ') || 'N/A'}`);
    console.log(`Received:        ${new Date(email.received_at).toLocaleString()}`);
    console.log(`Has Attachments: ${email.has_attachments ? 'Yes (' + email.attachment_count + ' files)' : 'No'}`);
    console.log(`Labels:          ${email.labels?.join(', ') || 'None'}`);

    if (email.snippet) {
      console.log(`\nEmail Snippet:`);
      console.log(`"${email.snippet}"`);
    }

    console.log(`\nBody Length:     ${email.body_text?.length || 0} characters`);

    if (email.body_text && email.body_text.length > 0) {
      console.log(`\n📄 FULL EMAIL BODY:`);
      console.log('─'.repeat(100));
      const bodyPreview = email.body_text.substring(0, 2000);
      console.log(bodyPreview);
      if (email.body_text.length > 2000) {
        console.log(`\n... (showing first 2,000 of ${email.body_text.length} total characters)`);
      }
    }

    // STEP 2: AI CLASSIFICATION
    console.log('\n🏷️  STEP 2: AI CLASSIFICATION (Stored in document_classifications table)');
    console.log('─'.repeat(100));

    if (email.document_classifications && email.document_classifications.length > 0) {
      const classification = email.document_classifications[0];
      console.log(`Classification ID:  ${classification.id}`);
      console.log(`Document Type:      ${classification.document_type}`);
      console.log(`Confidence Score:   ${classification.confidence_score}%`);
      console.log(`AI Model Used:      ${classification.model_name}:${classification.model_version}`);
      console.log(`Classified At:      ${new Date(classification.classified_at).toLocaleString()}`);

      console.log(`\n💭 AI Reasoning:`);
      console.log(`"${classification.classification_reason}"`);

      if (classification.matched_patterns) {
        const metadata = classification.matched_patterns as any;
        if (metadata.input_tokens) {
          console.log(`\n📊 Processing Metrics:`);
          console.log(`   Input Tokens:     ${metadata.input_tokens}`);
          console.log(`   Output Tokens:    ${metadata.output_tokens}`);
          console.log(`   Processing Time:  ${metadata.processing_time_ms}ms`);
          const cost = (metadata.input_tokens / 1_000_000) * 0.80 + (metadata.output_tokens / 1_000_000) * 4.00;
          console.log(`   Cost:             $${cost.toFixed(6)}`);
        }
      }
    } else {
      console.log('⚠️  No classification performed yet');
    }

    // STEP 3: ENTITY EXTRACTION
    console.log('\n📊 STEP 3: ENTITY EXTRACTION (Stored in entity_extractions table)');
    console.log('─'.repeat(100));

    if (email.entity_extractions && email.entity_extractions.length > 0) {
      console.log(`\n✅ Extracted ${email.entity_extractions.length} entities from this email:\n`);

      email.entity_extractions.forEach((entity: any, entityIdx: number) => {
        console.log(`${entityIdx + 1}. ${entity.entity_type.toUpperCase()}`);
        console.log(`   Value:            ${entity.entity_value}`);
        console.log(`   Confidence:       ${entity.confidence_score}%`);
        console.log(`   Extraction ID:    ${entity.id}`);
        console.log(`   Method:           ${entity.extraction_method}`);
        console.log(`   Extracted At:     ${new Date(entity.extracted_at).toLocaleString()}`);
        console.log('');
      });
    } else {
      console.log('ℹ️  No entities extracted (likely due to low confidence or empty body)');
    }

    console.log('─'.repeat(100));
  });

  // SUMMARY
  console.log('\n\n╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                      PIPELINE SUMMARY                                          ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  const withClassification = sentEmails.filter(e => e.document_classifications && e.document_classifications.length > 0).length;
  const withExtractions = sentEmails.filter(e => e.entity_extractions && e.entity_extractions.length > 0).length;
  const totalEntities = sentEmails.reduce((sum, e) => sum + (e.entity_extractions?.length || 0), 0);

  console.log(`📧 Total Sent Emails Shown:         ${sentEmails.length}`);
  console.log(`🏷️  With AI Classification:         ${withClassification} (${(withClassification / sentEmails.length * 100).toFixed(1)}%)`);
  console.log(`📊 With Entity Extraction:          ${withExtractions} (${(withExtractions / sentEmails.length * 100).toFixed(1)}%)`);
  console.log(`📈 Total Entities Extracted:        ${totalEntities}`);
  console.log(`📈 Average Entities per Email:      ${(totalEntities / sentEmails.length).toFixed(2)}`);
  console.log('');

  // Document type breakdown
  const docTypes: Record<string, number> = {};
  sentEmails.forEach(e => {
    if (e.document_classifications && e.document_classifications.length > 0) {
      const docType = e.document_classifications[0].document_type;
      docTypes[docType] = (docTypes[docType] || 0) + 1;
    }
  });

  console.log('📋 Document Types Found:');
  Object.entries(docTypes).forEach(([type, count]) => {
    console.log(`   ${type.padEnd(25)} ${count} emails`);
  });

  console.log('\n✅ Complete pipeline visualization finished!\n');
}

viewSentEmailsPipeline().catch(console.error);
