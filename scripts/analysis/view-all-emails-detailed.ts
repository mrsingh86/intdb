/**
 * View Detailed Results - Show complete data flow for ALL emails
 */

import { supabase } from '../utils/supabase-client';

async function viewAllEmailsDetailed() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                     COMPLETE DATA FLOW FOR ALL EMAILS (RAW → CLASSIFICATION → EXTRACTION)      ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝');

  // Fetch all emails with their classifications and extractions
  const { data: emails } = await supabase
    .from('raw_emails')
    .select(`
      id,
      subject,
      sender_email,
      sender_name,
      body_text,
      received_at,
      has_attachments,
      attachment_count,
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
    .limit(10);

  if (!emails || emails.length === 0) {
    console.log('No emails found in database');
    return;
  }

  // Display each email in detail
  emails.forEach((email, idx) => {
    console.log('\n');
    console.log('═'.repeat(100));
    console.log(`EMAIL ${idx + 1} of ${emails.length}`);
    console.log('═'.repeat(100));

    // STEP 1: RAW EMAIL DATA
    console.log('\n📧 STEP 1: RAW_EMAILS TABLE (Input)');
    console.log('─'.repeat(100));
    console.log(`  ID:              ${email.id}`);
    console.log(`  Subject:         ${email.subject}`);
    console.log(`  From:            ${email.sender_email}${email.sender_name ? ' (' + email.sender_name + ')' : ''}`);
    console.log(`  Received:        ${new Date(email.received_at).toLocaleString()}`);
    console.log(`  Has Attachments: ${email.has_attachments ? 'Yes (' + email.attachment_count + ')' : 'No'}`);
    console.log(`  Body Length:     ${email.body_text?.length || 0} characters`);

    if (email.body_text && email.body_text.length > 0) {
      console.log(`\n  Body Preview:`);
      const preview = email.body_text.substring(0, 300);
      console.log(`  "${preview}${email.body_text.length > 300 ? '...' : ''}"`);
    } else {
      console.log(`\n  Body:            (empty)`);
    }

    // STEP 2: CLASSIFICATION
    console.log('\n🏷️  STEP 2: DOCUMENT_CLASSIFICATIONS TABLE (AI Classification)');
    console.log('─'.repeat(100));

    if (email.document_classifications && email.document_classifications.length > 0) {
      const classification = email.document_classifications[0];
      console.log(`  Classification ID:  ${classification.id}`);
      console.log(`  Email ID (link):    ${email.id}`);
      console.log(`  Document Type:      ${classification.document_type}`);
      console.log(`  Confidence:         ${classification.confidence_score}%`);
      console.log(`  Model:              ${classification.model_name}:${classification.model_version}`);
      console.log(`  Classified At:      ${new Date(classification.classified_at).toLocaleString()}`);
      console.log(`\n  AI Reasoning:`);
      console.log(`  "${classification.classification_reason}"`);

      if (classification.matched_patterns) {
        console.log(`\n  Processing Metadata:`);
        const metadata = classification.matched_patterns as any;
        if (metadata.input_tokens) {
          console.log(`    Input Tokens:     ${metadata.input_tokens}`);
          console.log(`    Output Tokens:    ${metadata.output_tokens}`);
          console.log(`    Processing Time:  ${metadata.processing_time_ms}ms`);

          // Calculate cost
          const cost = (metadata.input_tokens / 1_000_000) * 0.80 + (metadata.output_tokens / 1_000_000) * 4.00;
          console.log(`    Cost:             $${cost.toFixed(6)}`);
        }
      }
    } else {
      console.log(`  ⚠️  No classification found for this email`);
    }

    // STEP 3: ENTITY EXTRACTIONS
    console.log('\n📊 STEP 3: ENTITY_EXTRACTIONS TABLE (AI Extraction)');
    console.log('─'.repeat(100));

    if (email.entity_extractions && email.entity_extractions.length > 0) {
      console.log(`  ${email.entity_extractions.length} entities extracted from email ${email.id}:\n`);

      email.entity_extractions.forEach((entity: any, entityIdx: number) => {
        console.log(`  ${entityIdx + 1}. ${entity.entity_type.padEnd(30)} ${entity.entity_value.padEnd(25)} (${entity.confidence_score}% confidence)`);
        console.log(`     Extraction ID:    ${entity.id}`);
        console.log(`     Method:           ${entity.extraction_method}`);
        console.log(`     Extracted At:     ${new Date(entity.extracted_at).toLocaleString()}`);
        console.log('');
      });
    } else {
      console.log(`  ℹ️  No entities extracted from this email`);
      console.log(`     (Likely due to: low confidence classification, empty body, or no relevant data)`);
    }

    console.log('\n' + '─'.repeat(100));
  });

  // Summary statistics
  console.log('\n\n');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                                        SUMMARY STATISTICS                                       ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const totalEmails = emails.length;
  const emailsWithClassification = emails.filter(e => e.document_classifications && e.document_classifications.length > 0).length;
  const emailsWithExtractions = emails.filter(e => e.entity_extractions && e.entity_extractions.length > 0).length;
  const totalExtractions = emails.reduce((sum, e) => sum + (e.entity_extractions?.length || 0), 0);
  const avgExtractions = totalExtractions / totalEmails;

  // Count by document type
  const documentTypeCounts: Record<string, number> = {};
  emails.forEach(e => {
    if (e.document_classifications && e.document_classifications.length > 0) {
      const docType = e.document_classifications[0].document_type;
      documentTypeCounts[docType] = (documentTypeCounts[docType] || 0) + 1;
    }
  });

  // Average confidence by document type
  const avgConfidenceByType: Record<string, { total: number; count: number }> = {};
  emails.forEach(e => {
    if (e.document_classifications && e.document_classifications.length > 0) {
      const classification = e.document_classifications[0];
      const docType = classification.document_type;
      if (!avgConfidenceByType[docType]) {
        avgConfidenceByType[docType] = { total: 0, count: 0 };
      }
      avgConfidenceByType[docType].total += parseFloat(classification.confidence_score.toString());
      avgConfidenceByType[docType].count += 1;
    }
  });

  console.log(`📧 Total Emails Processed:              ${totalEmails}`);
  console.log(`🏷️  Emails with Classification:         ${emailsWithClassification} (${(emailsWithClassification / totalEmails * 100).toFixed(1)}%)`);
  console.log(`📊 Emails with Entity Extractions:      ${emailsWithExtractions} (${(emailsWithExtractions / totalEmails * 100).toFixed(1)}%)`);
  console.log(`📈 Total Entities Extracted:            ${totalExtractions}`);
  console.log(`📈 Average Entities per Email:          ${avgExtractions.toFixed(2)}`);
  console.log('');

  console.log('📋 Document Type Breakdown:');
  console.log('─'.repeat(100));
  Object.entries(documentTypeCounts).forEach(([docType, count]) => {
    const avgConf = avgConfidenceByType[docType];
    const avgConfidence = avgConf ? (avgConf.total / avgConf.count).toFixed(1) : 0;
    console.log(`  ${docType.padEnd(25)} ${count} emails (avg confidence: ${avgConfidence}%)`);
  });
  console.log('');

  // Entity type breakdown
  const entityTypeCounts: Record<string, number> = {};
  emails.forEach(e => {
    if (e.entity_extractions) {
      e.entity_extractions.forEach((entity: any) => {
        entityTypeCounts[entity.entity_type] = (entityTypeCounts[entity.entity_type] || 0) + 1;
      });
    }
  });

  if (Object.keys(entityTypeCounts).length > 0) {
    console.log('📊 Entity Type Breakdown:');
    console.log('─'.repeat(100));
    Object.entries(entityTypeCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([entityType, count]) => {
        console.log(`  ${entityType.padEnd(30)} ${count} extracted`);
      });
    console.log('');
  }

  console.log('✅ All data successfully retrieved from database!');
  console.log('');
}

viewAllEmailsDetailed().catch(console.error);
