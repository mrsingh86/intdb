/**
 * View Outgoing Emails from Intoglo Team
 * Shows emails SENT by @intoglo.com to external parties
 */

import { supabase } from '../utils/supabase-client';

async function viewOutgoingEmails() {
  console.log('\n╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                    OUTGOING EMAILS FROM INTOGLO TEAM → EXTERNAL PARTIES                        ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝\n');

  // Fetch emails sent FROM @intoglo.com addresses
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
      labels,
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
    .ilike('sender_email', '%@intoglo.com%')
    .order('received_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error('Error:', error);
    return;
  }

  if (!emails || emails.length === 0) {
    console.log('No outgoing emails found from @intoglo.com addresses\n');
    return;
  }

  console.log(`Found ${emails.length} outgoing emails from Intoglo team\n`);

  emails.forEach((email, idx) => {
    console.log('═'.repeat(100));
    console.log(`OUTGOING EMAIL ${idx + 1} of ${emails.length}`);
    console.log('═'.repeat(100) + '\n');

    // STEP 1: RAW EMAIL
    console.log('  📧 STEP 1: RAW_EMAILS TABLE (Outgoing Email Data)');
    console.log('  ' + '─'.repeat(97));
    console.log(`    ID:       ${email.id}`);
    console.log(`    Subject:  ${email.subject}`);
    console.log(`    FROM:     ${email.sender_email}${email.sender_name ? ' (' + email.sender_name + ')' : ''} 📤 INTOGLO`);
    console.log(`    TO:       ${email.recipient_emails?.slice(0, 3).join(', ') || 'N/A'}`);
    if (email.recipient_emails && email.recipient_emails.length > 3) {
      console.log(`              ... and ${email.recipient_emails.length - 3} more`);
    }
    console.log(`    Sent:     ${new Date(email.received_at).toLocaleString()}`);
    console.log(`    Labels:   ${email.labels?.join(', ') || 'None'}`);
    console.log(`    Body:     ${email.body_text?.length || 0} characters`);

    // Show email type based on labels
    if (email.labels?.includes('SENT')) {
      console.log(`    Type:     ✉️  SENT EMAIL (Outgoing from Intoglo)`);
    }

    if (email.snippet) {
      console.log(`\n    Snippet:`);
      console.log(`    "${email.snippet.substring(0, 200)}${email.snippet.length > 200 ? '...' : ''}"`);
    }

    if (email.body_text && email.body_text.length > 0) {
      console.log(`\n    📄 Email Body (First 1000 chars):`);
      console.log('    ' + '─'.repeat(93));
      const lines = email.body_text.substring(0, 1000).split('\n').slice(0, 15);
      lines.forEach((line: string) => {
        if (line.trim()) console.log(`    ${line.substring(0, 90)}`);
      });
      if (email.body_text.length > 1000) {
        console.log(`    ... (${email.body_text.length} total characters)`);
      }
    }

    // STEP 2: CLASSIFICATION
    console.log('\n  🏷️  STEP 2: AI DOCUMENT CLASSIFICATION');
    console.log('  ' + '─'.repeat(97));

    if (email.document_classifications && email.document_classifications.length > 0) {
      const c = email.document_classifications[0];
      const confidenceLabel = c.confidence_score >= 85 ? '✅ HIGH' :
                             c.confidence_score >= 50 ? '⚠️  MEDIUM' : '❌ LOW';

      console.log(`    Document Type:      ${c.document_type}`);
      console.log(`    Confidence:         ${c.confidence_score}% ${confidenceLabel}`);
      console.log(`    Classification ID:  ${c.id.substring(0, 12)}...`);

      console.log(`\n    💭 AI Reasoning:`);
      const reasoning = c.classification_reason || 'No reasoning provided';
      const reasoningLines = reasoning.match(/.{1,85}/g) || [reasoning];
      reasoningLines.slice(0, 3).forEach((line: string) => console.log(`       "${line}"`));

      if (c.matched_patterns) {
        const meta = c.matched_patterns as any;
        if (meta.input_tokens) {
          const cost = (meta.input_tokens / 1_000_000) * 0.80 + (meta.output_tokens / 1_000_000) * 4.00;
          console.log(`\n    Processing: ${meta.input_tokens} input tokens, ${meta.output_tokens} output tokens, $${cost.toFixed(6)}`);
        }
      }
    } else {
      console.log('    ⚠️  Not yet classified');
    }

    // STEP 3: ENTITIES
    console.log('\n  📊 STEP 3: ENTITY EXTRACTION');
    console.log('  ' + '─'.repeat(97));

    if (email.entity_extractions && email.entity_extractions.length > 0) {
      // Remove duplicates
      const uniqueEntities = email.entity_extractions.reduce((acc: any[], curr: any) => {
        const exists = acc.find(e =>
          e.entity_type === curr.entity_type &&
          e.entity_value === curr.entity_value
        );
        if (!exists) acc.push(curr);
        return acc;
      }, []);

      console.log(`    ✅ ${uniqueEntities.length} entities extracted:\n`);

      uniqueEntities.forEach((entity: any, i: number) => {
        const confidenceIcon = entity.confidence_score >= 70 ? '✅' :
                               entity.confidence_score >= 40 ? '⚠️' : '❌';
        console.log(`    ${i + 1}. ${entity.entity_type.padEnd(24)} ${entity.entity_value.padEnd(25)} (${entity.confidence_score}% ${confidenceIcon})`);
      });
    } else {
      console.log('    ℹ️  No entities extracted');
    }

    console.log('\n');
  });

  // Summary
  console.log('═'.repeat(100));
  console.log('SUMMARY');
  console.log('═'.repeat(100));

  const withClass = emails.filter(e => e.document_classifications?.length > 0).length;
  const withEntities = emails.filter(e => e.entity_extractions?.length > 0).length;
  const totalUniqueEntities = emails.reduce((count, email) => {
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

  console.log(`\n📧 Outgoing Emails:           ${emails.length}`);
  console.log(`🏷️  Classified:                ${withClass} (${(withClass/emails.length*100).toFixed(0)}%)`);
  console.log(`📊 With Entities:             ${withEntities} (${(withEntities/emails.length*100).toFixed(0)}%)`);
  console.log(`📈 Total Unique Entities:     ${totalUniqueEntities}`);

  // Document types
  const docTypes: Record<string, number> = {};
  emails.forEach(e => {
    if (e.document_classifications && e.document_classifications.length > 0) {
      const type = e.document_classifications[0].document_type;
      docTypes[type] = (docTypes[type] || 0) + 1;
    }
  });

  if (Object.keys(docTypes).length > 0) {
    console.log(`\n📋 Document Types Detected:`);
    Object.entries(docTypes)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`   • ${type.padEnd(25)} ${count} email${count > 1 ? 's' : ''}`);
      });
  }

  console.log('\n✅ Analysis complete!\n');
}

viewOutgoingEmails().catch(console.error);
