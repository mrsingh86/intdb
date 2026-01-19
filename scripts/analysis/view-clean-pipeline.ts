/**
 * Clean Pipeline View - Visual representation of data flow
 */

import { supabase } from '../utils/supabase-client';

async function viewCleanPipeline() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                        COMPLETE DATA PIPELINE: RAW → CLASSIFY → EXTRACT                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select(`
      id,
      subject,
      sender_email,
      sender_name,
      body_text,
      snippet,
      received_at,
      document_classifications (
        id,
        document_type,
        confidence_score,
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
    .limit(20);

  if (error || !emails) {
    console.error('Error:', error);
    return;
  }

  // Filter to meaningful emails only (exclude "Failed to fetch" spam)
  const meaningfulEmails = emails.filter(e =>
    e.subject && !e.subject.includes('Failed to fetch')
  ).slice(0, 5);  // Show top 5

  if (meaningfulEmails.length === 0) {
    console.log('\n⚠️  No meaningful emails found. All recent emails appear to be "Failed to fetch" errors.\n');
    return;
  }

  meaningfulEmails.forEach((email, idx) => {
    console.log('\n' + '═'.repeat(100));
    console.log(`EMAIL ${idx + 1} of ${meaningfulEmails.length}: ${email.subject?.substring(0, 70)}`);
    console.log('═'.repeat(100) + '\n');

    // STEP 1: RAW EMAIL
    console.log('  📧 STEP 1: RAW_EMAILS TABLE');
    console.log('  ' + '─'.repeat(97));
    console.log(`    ID:       ${email.id}`);
    console.log(`    Subject:  ${email.subject}`);
    console.log(`    From:     ${email.sender_email}${email.sender_name ? ' (' + email.sender_name + ')' : ''}`);
    console.log(`    Received: ${new Date(email.received_at).toLocaleString()}`);
    console.log(`    Body:     ${email.body_text?.length || 0} characters`);

    if (email.body_text && email.body_text.length > 0) {
      console.log('\n    Email Content:');
      const lines = email.body_text.substring(0, 500).split('\n').slice(0, 10);
      lines.forEach((line: string) => {
        if (line.trim()) console.log(`    "${line.trim()}"`);
      });
      if (email.body_text.length > 500) {
        console.log(`    ... (${email.body_text.length} total characters)`);
      }
    } else if (email.snippet) {
      console.log(`\n    Snippet: "${email.snippet}"`);
    }

    // STEP 2: CLASSIFICATION
    console.log('\n  🏷️  STEP 2: DOCUMENT_CLASSIFICATIONS TABLE');
    console.log('  ' + '─'.repeat(97));

    if (email.document_classifications && email.document_classifications.length > 0) {
      const c = email.document_classifications[0];
      console.log(`    Classification ID:  ${c.id}`);
      console.log(`    Email ID (link):    ${email.id.substring(0, 12)}... → Links to raw email\n`);

      const confidenceLabel = c.confidence_score >= 85 ? '✅ HIGH CONFIDENCE' :
                             c.confidence_score >= 50 ? '⚠️  MEDIUM CONFIDENCE' :
                             '❌ LOW CONFIDENCE';
      console.log(`    Document Type:      ${c.document_type}`);
      console.log(`    Confidence:         ${c.confidence_score}% ${confidenceLabel}`);
      console.log(`    Model:              claude-3-5-haiku:20241022`);

      console.log('\n    AI Reasoning:');
      const reasoning = c.classification_reason || 'No reasoning provided';
      const reasoningLines = reasoning.match(/.{1,90}/g) || [reasoning];
      reasoningLines.forEach((line: string) => console.log(`    "${line}"`));

      if (c.matched_patterns) {
        const meta = c.matched_patterns as any;
        if (meta.input_tokens) {
          console.log('\n    Processing:');
          console.log(`      Input Tokens:     ${meta.input_tokens}`);
          console.log(`      Output Tokens:    ${meta.output_tokens}`);
          console.log(`      Time:             ${(meta.processing_time_ms / 1000).toFixed(3)} seconds`);
          const cost = (meta.input_tokens / 1_000_000) * 0.80 + (meta.output_tokens / 1_000_000) * 4.00;
          console.log(`      Cost:             $${cost.toFixed(6)}`);
        }
      }
    } else {
      console.log('    ⚠️  Not yet classified');
    }

    // STEP 3: ENTITIES
    console.log('\n  📊 STEP 3: ENTITY_EXTRACTIONS TABLE');
    console.log('  ' + '─'.repeat(97));

    if (email.entity_extractions && email.entity_extractions.length > 0) {
      // Remove duplicates based on entity_type and entity_value
      const uniqueEntities = email.entity_extractions.reduce((acc: any[], curr: any) => {
        const exists = acc.find(e =>
          e.entity_type === curr.entity_type &&
          e.entity_value === curr.entity_value
        );
        if (!exists) acc.push(curr);
        return acc;
      }, []);

      console.log(`    ${uniqueEntities.length} entities extracted from email ${email.id.substring(0, 12)}...:\n`);

      uniqueEntities.forEach((entity: any, i: number) => {
        const confidenceLabel = entity.confidence_score >= 70 ? '✅' :
                               entity.confidence_score >= 40 ? '⚠️' : '❌';

        console.log(`    ${i + 1}. ${entity.entity_type.padEnd(24)} ${entity.entity_value.padEnd(20)} (${entity.confidence_score}% ${confidenceLabel})`);
        console.log(`       ID: ${entity.id.substring(0, 12)}...  |  Method: ${entity.extraction_method}  |  Extracted: ${new Date(entity.extracted_at).toLocaleString()}`);
        console.log('');
      });
    } else {
      console.log('    ℹ️  No entities extracted (likely low confidence or empty body)\n');
    }
  });

  // SUMMARY
  console.log('\n' + '═'.repeat(100));
  console.log('SUMMARY STATISTICS');
  console.log('═'.repeat(100));

  const withClass = meaningfulEmails.filter(e => e.document_classifications?.length > 0).length;
  const withEntities = meaningfulEmails.filter(e => e.entity_extractions?.length > 0).length;

  // Count unique entities
  const allUniqueEntities = meaningfulEmails.reduce((count, email) => {
    if (!email.entity_extractions) return count;
    const unique = email.entity_extractions.reduce((acc: any[], curr: any) => {
      const exists = acc.find(e =>
        e.entity_type === curr.entity_type &&
        e.entity_value === curr.entity_value
      );
      if (!exists) acc.push(curr);
      return acc;
    }, []);
    return count + unique.length;
  }, 0);

  console.log(`\n📧 Emails Shown:              ${meaningfulEmails.length}`);
  console.log(`🏷️  Successfully Classified:    ${withClass} (${(withClass/meaningfulEmails.length*100).toFixed(0)}%)`);
  console.log(`📊 With Entities Extracted:   ${withEntities} (${(withEntities/meaningfulEmails.length*100).toFixed(0)}%)`);
  console.log(`📈 Total Unique Entities:     ${allUniqueEntities}`);
  console.log(`📈 Avg Entities per Email:    ${(allUniqueEntities/meaningfulEmails.length).toFixed(1)}\n`);

  // Document types
  const docTypes: Record<string, number> = {};
  meaningfulEmails.forEach(e => {
    if (e.document_classifications && e.document_classifications.length > 0) {
      const type = e.document_classifications[0].document_type;
      docTypes[type] = (docTypes[type] || 0) + 1;
    }
  });

  if (Object.keys(docTypes).length > 0) {
    console.log('📋 Document Types:');
    Object.entries(docTypes)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`   • ${type.padEnd(25)} ${count} email${count > 1 ? 's' : ''}`);
      });
  }

  console.log('\n✅ Pipeline visualization complete!\n');
}

viewCleanPipeline().catch(console.error);
