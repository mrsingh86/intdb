import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://fdmcdbvkfdmrdowfjrcz.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || 'sb_publishable_v9RFIqbeitIgL4y6MXPLNg_CyC2YwRm'
);

async function analyzeEntityExtractions() {
  console.log('='.repeat(80));
  console.log('ENTITY EXTRACTIONS DETAILED ANALYSIS');
  console.log('='.repeat(80));
  console.log();

  // Get entity extractions
  const { data: extractions } = await supabase
    .from('entity_extractions')
    .select('*')
    .limit(10);

  if (extractions && extractions.length > 0) {
    console.log('1. ENTITY_EXTRACTIONS TABLE STRUCTURE');
    console.log('-'.repeat(80));
    console.log('Columns:', Object.keys(extractions[0]));
    console.log();
    console.log('Sample extraction:');
    console.log(JSON.stringify(extractions[0], null, 2));
    console.log();
  }

  // Get all extractions with counts by email
  const { data: allExtractions } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_type, entity_value');

  if (!allExtractions) {
    console.log('No extractions found');
    return;
  }

  // Count extractions per email
  const extractionsPerEmail: Record<string, number> = {};
  for (const ext of allExtractions) {
    if (ext.email_id) {
      extractionsPerEmail[ext.email_id] = (extractionsPerEmail[ext.email_id] || 0) + 1;
    }
  }

  console.log('2. EXTRACTION COVERAGE');
  console.log('-'.repeat(80));
  console.log('Total extractions:', allExtractions.length);
  console.log('Unique emails with extractions:', Object.keys(extractionsPerEmail).length);
  console.log();

  // Get total emails
  const { count: totalEmails } = await supabase
    .from('raw_emails')
    .select('id', { count: 'exact', head: true });

  const coverage = (Object.keys(extractionsPerEmail).length / (totalEmails || 1) * 100).toFixed(2);
  console.log('Coverage: ' + Object.keys(extractionsPerEmail).length + ' / ' + totalEmails + ' = ' + coverage + '%');
  console.log();

  // Count by entity type
  const entityTypeCounts: Record<string, number> = {};
  for (const ext of allExtractions) {
    const type = ext.entity_type || 'unknown';
    entityTypeCounts[type] = (entityTypeCounts[type] || 0) + 1;
  }

  console.log('3. ENTITY TYPES EXTRACTED');
  console.log('-'.repeat(80));
  Object.entries(entityTypeCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([type, count]) => {
      console.log(type.padEnd(30), count.toString());
    });
  console.log();

  // Get emails WITHOUT extractions
  const { data: allEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, has_attachments, processing_status');

  if (!allEmails) return;

  const emailsWithoutExtractions = allEmails.filter(e => !extractionsPerEmail[e.id]);

  console.log('4. EMAILS WITHOUT EXTRACTIONS');
  console.log('-'.repeat(80));
  console.log('Count:', emailsWithoutExtractions.length);
  console.log();

  // Analyze emails without extractions by status
  const statusBreakdown: Record<string, number> = {};
  for (const email of emailsWithoutExtractions) {
    const status = email.processing_status || 'null';
    statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
  }

  console.log('Status breakdown of emails WITHOUT extractions:');
  Object.entries(statusBreakdown)
    .sort((a, b) => b[1] - a[1])
    .forEach(([status, count]) => {
      const pct = (count / emailsWithoutExtractions.length * 100).toFixed(2);
      console.log('  ' + status.padEnd(30), count.toString().padEnd(10), pct + '%');
    });
  console.log();

  // Analyze emails without extractions by attachments
  const withAttachments = emailsWithoutExtractions.filter(e => e.has_attachments).length;
  const withoutAttachments = emailsWithoutExtractions.filter(e => !e.has_attachments).length;

  console.log('Attachment breakdown of emails WITHOUT extractions:');
  console.log('  With attachments:', withAttachments, '(' + (withAttachments / emailsWithoutExtractions.length * 100).toFixed(2) + '%)');
  console.log('  Without attachments:', withoutAttachments, '(' + (withoutAttachments / emailsWithoutExtractions.length * 100).toFixed(2) + '%)');
  console.log();

  // Sample emails without extractions
  console.log('5. SAMPLE EMAILS WITHOUT EXTRACTIONS');
  console.log('-'.repeat(80));
  emailsWithoutExtractions.slice(0, 10).forEach((email, idx) => {
    console.log('');
    console.log('Email ' + (idx + 1) + ':');
    console.log('  Subject:', email.subject?.substring(0, 100));
    console.log('  Sender:', email.sender_email);
    console.log('  Has attachments:', email.has_attachments);
    console.log('  Status:', email.processing_status);
  });
  console.log();

  // Analyze emails WITH extractions
  const emailsWithExtractions = allEmails.filter(e => extractionsPerEmail[e.id]);
  
  console.log('6. EMAILS WITH EXTRACTIONS');
  console.log('-'.repeat(80));
  console.log('Count:', emailsWithExtractions.length);
  console.log();

  // Status breakdown
  const withExtStatusBreakdown: Record<string, number> = {};
  for (const email of emailsWithExtractions) {
    const status = email.processing_status || 'null';
    withExtStatusBreakdown[status] = (withExtStatusBreakdown[status] || 0) + 1;
  }

  console.log('Status breakdown of emails WITH extractions:');
  Object.entries(withExtStatusBreakdown)
    .sort((a, b) => b[1] - a[1])
    .forEach(([status, count]) => {
      const pct = (count / emailsWithExtractions.length * 100).toFixed(2);
      console.log('  ' + status.padEnd(30), count.toString().padEnd(10), pct + '%');
    });
  console.log();

  // Sender analysis for emails without extractions
  const senderBreakdown: Record<string, number> = {};
  for (const email of emailsWithoutExtractions) {
    const sender = email.sender_email || 'unknown';
    senderBreakdown[sender] = (senderBreakdown[sender] || 0) + 1;
  }

  console.log('7. TOP SENDERS OF EMAILS WITHOUT EXTRACTIONS');
  console.log('-'.repeat(80));
  Object.entries(senderBreakdown)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .forEach(([sender, count]) => {
      console.log(sender.padEnd(50), count.toString());
    });
  console.log();
}

analyzeEntityExtractions().catch(console.error);
