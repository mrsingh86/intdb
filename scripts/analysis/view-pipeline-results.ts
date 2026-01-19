/**
 * View Pipeline Results - Query and display data from classification and extraction tables
 */

import { supabase } from '../utils/supabase-client';

async function viewResults() {
  console.log('\n');
  console.log('╔════════════════════════════════════════════════════════════════════════════════════════════════╗');
  console.log('║                              DATABASE TABLE CONTENTS                                           ║');
  console.log('╚════════════════════════════════════════════════════════════════════════════════════════════════╝');

  // 1. RAW EMAILS
  console.log('\n📧 RAW_EMAILS TABLE:');
  console.log('─'.repeat(100));

  const { data: emails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, received_at')
    .order('received_at', { ascending: false })
    .limit(10);

  if (emails) {
    console.table(emails.map(e => ({
      ID: e.id.substring(0, 8) + '...',
      Subject: e.subject.substring(0, 40),
      From: e.sender_email,
      Received: new Date(e.received_at).toLocaleString()
    })));
  }

  // 2. DOCUMENT CLASSIFICATIONS
  console.log('\n🏷️  DOCUMENT_CLASSIFICATIONS TABLE:');
  console.log('─'.repeat(100));

  const { data: classifications } = await supabase
    .from('document_classifications')
    .select(`
      id,
      email_id,
      document_type,
      confidence_score,
      model_name,
      model_version,
      classification_reason,
      classified_at
    `)
    .order('classified_at', { ascending: false })
    .limit(10);

  if (classifications) {
    console.table(classifications.map(c => ({
      ID: c.id.substring(0, 8) + '...',
      Email_ID: c.email_id.substring(0, 8) + '...',
      Document_Type: c.document_type,
      Confidence: `${c.confidence_score}%`,
      Model: `${c.model_name}:${c.model_version}`,
      Classified_At: new Date(c.classified_at).toLocaleString()
    })));

    console.log('\n📝 Classification Details:\n');
    classifications.forEach((c, idx) => {
      console.log(`${idx + 1}. ${c.document_type} (${c.confidence_score}% confidence)`);
      console.log(`   Reasoning: ${c.classification_reason}`);
      console.log('');
    });
  }

  // 3. ENTITY EXTRACTIONS
  console.log('\n📊 ENTITY_EXTRACTIONS TABLE:');
  console.log('─'.repeat(100));

  const { data: extractions } = await supabase
    .from('entity_extractions')
    .select(`
      id,
      email_id,
      entity_type,
      entity_value,
      confidence_score,
      extraction_method,
      extracted_at
    `)
    .order('extracted_at', { ascending: false })
    .limit(20);

  if (extractions) {
    console.table(extractions.map(e => ({
      ID: e.id.substring(0, 8) + '...',
      Email_ID: e.email_id.substring(0, 8) + '...',
      Entity_Type: e.entity_type,
      Entity_Value: e.entity_value,
      Confidence: `${e.confidence_score}%`,
      Method: e.extraction_method
    })));
  }

  // 4. JOINED VIEW - Email with Classification and Extractions
  console.log('\n🔗 COMPLETE VIEW (Email → Classification → Extractions):');
  console.log('═'.repeat(100));

  const { data: completeView } = await supabase
    .from('raw_emails')
    .select(`
      id,
      subject,
      sender_email,
      document_classifications (
        document_type,
        confidence_score,
        classification_reason
      ),
      entity_extractions (
        entity_type,
        entity_value,
        confidence_score
      )
    `)
    .order('received_at', { ascending: false })
    .limit(5);

  if (completeView) {
    completeView.forEach((email, idx) => {
      console.log(`\n${idx + 1}. 📧 ${email.subject}`);
      console.log(`   From: ${email.sender_email}`);

      if (email.document_classifications && email.document_classifications.length > 0) {
        const classification = email.document_classifications[0];
        console.log(`   \n   🏷️  Classification: ${classification.document_type} (${classification.confidence_score}% confidence)`);
        console.log(`   Reason: ${classification.classification_reason}`);
      }

      if (email.entity_extractions && email.entity_extractions.length > 0) {
        console.log(`\n   📊 Extracted Entities:`);
        email.entity_extractions.forEach((entity: any) => {
          console.log(`      • ${entity.entity_type}: ${entity.entity_value} (${entity.confidence_score}% confidence)`);
        });
      }
      console.log('');
    });
  }

  // 5. STATISTICS
  console.log('\n📈 STATISTICS:');
  console.log('═'.repeat(100));

  const { count: emailCount } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true });

  const { count: classificationCount } = await supabase
    .from('document_classifications')
    .select('*', { count: 'exact', head: true });

  const { count: extractionCount } = await supabase
    .from('entity_extractions')
    .select('*', { count: 'exact', head: true });

  console.log(`Total Emails:           ${emailCount}`);
  console.log(`Total Classifications:  ${classificationCount}`);
  console.log(`Total Extractions:      ${extractionCount}`);
  console.log(`Avg Extractions/Email:  ${extractionCount && emailCount ? (extractionCount / emailCount).toFixed(2) : 0}`);
  console.log('');
}

viewResults().catch(console.error);
