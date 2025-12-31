import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://fdmcdbvkfdmrdowfjrcz.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || 'sb_publishable_v9RFIqbeitIgL4y6MXPLNg_CyC2YwRm'
);

async function analyzeExtractions() {
  console.log('='.repeat(80));
  console.log('EMAIL EXTRACTION COVERAGE ANALYSIS');
  console.log('='.repeat(80));
  console.log();

  // Get all emails
  const { data: allEmails } = await supabase
    .from('raw_emails')
    .select('*');

  if (!allEmails) {
    console.log('No emails found');
    return;
  }

  console.log('1. OVERVIEW');
  console.log('-'.repeat(80));
  console.log('Total emails in raw_emails table:', allEmails.length);
  console.log();

  // Check processing status
  const statusBreakdown: Record<string, number> = {};
  for (const email of allEmails) {
    const status = email.processing_status || 'null';
    statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
  }

  console.log('2. PROCESSING STATUS BREAKDOWN');
  console.log('-'.repeat(80));
  Object.entries(statusBreakdown)
    .sort((a, b) => b[1] - a[1])
    .forEach(([status, count]) => {
      const pct = (count / allEmails.length * 100).toFixed(2);
      console.log(status.padEnd(30), count.toString().padEnd(10), pct + '%');
    });
  console.log();

  // Check attachments
  const withAttachments = allEmails.filter(e => e.has_attachments === true).length;
  const withoutAttachments = allEmails.filter(e => e.has_attachments === false).length;
  
  console.log('3. ATTACHMENT STATISTICS');
  console.log('-'.repeat(80));
  console.log('Emails with attachments:', withAttachments, '(' + (withAttachments / allEmails.length * 100).toFixed(2) + '%)');
  console.log('Emails without attachments:', withoutAttachments, '(' + (withoutAttachments / allEmails.length * 100).toFixed(2) + '%)');
  console.log();

  // Check body content
  const withBodyText = allEmails.filter(e => e.body_text && e.body_text.trim().length > 0).length;
  const withBodyHtml = allEmails.filter(e => e.body_html && e.body_html.trim().length > 0).length;
  
  console.log('4. BODY CONTENT STATISTICS');
  console.log('-'.repeat(80));
  console.log('Emails with body_text:', withBodyText, '(' + (withBodyText / allEmails.length * 100).toFixed(2) + '%)');
  console.log('Emails with body_html:', withBodyHtml, '(' + (withBodyHtml / allEmails.length * 100).toFixed(2) + '%)');
  console.log();

  // Check for related extraction tables
  console.log('5. CHECKING FOR RELATED TABLES');
  console.log('-'.repeat(80));
  
  const tablesToCheck = ['entity_extractions', 'email_extractions', 'document_extractions', 'shipments', 'bookings'];
  
  for (const table of tablesToCheck) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });
    
    if (!error) {
      console.log(table.padEnd(30), 'EXISTS - Row count:', count || 0);
    }
  }
  console.log();

  // Sample some emails to see common patterns
  const sampleProcessed = allEmails
    .filter(e => e.processing_status === 'processed')
    .slice(0, 3);
  
  const samplePending = allEmails
    .filter(e => e.processing_status === 'pending' || !e.processing_status)
    .slice(0, 3);

  console.log('6. SAMPLE PROCESSED EMAILS');
  console.log('-'.repeat(80));
  if (sampleProcessed.length > 0) {
    sampleProcessed.forEach((email, idx) => {
      console.log('');
      console.log('Email ' + (idx + 1) + ':');
      console.log('  Subject:', email.subject?.substring(0, 100));
      console.log('  Sender:', email.sender_email);
      console.log('  Has attachments:', email.has_attachments);
      console.log('  Processing status:', email.processing_status);
    });
  } else {
    console.log('No processed emails found');
  }
  console.log();

  console.log('7. SAMPLE UNPROCESSED/PENDING EMAILS');
  console.log('-'.repeat(80));
  if (samplePending.length > 0) {
    samplePending.forEach((email, idx) => {
      console.log('');
      console.log('Email ' + (idx + 1) + ':');
      console.log('  Subject:', email.subject?.substring(0, 100));
      console.log('  Sender:', email.sender_email);
      console.log('  Has attachments:', email.has_attachments);
      console.log('  Processing status:', email.processing_status);
      console.log('  Processing error:', email.processing_error?.substring(0, 100) || 'none');
    });
  } else {
    console.log('No pending emails found');
  }
  console.log();

  // Check for errors
  const withErrors = allEmails.filter(e => e.processing_error && e.processing_error.trim().length > 0);
  
  console.log('8. PROCESSING ERRORS');
  console.log('-'.repeat(80));
  console.log('Emails with processing errors:', withErrors.length);
  
  if (withErrors.length > 0) {
    // Group by error type
    const errorTypes: Record<string, number> = {};
    for (const email of withErrors) {
      const errorMsg = email.processing_error || '';
      const errorKey = errorMsg.substring(0, 50);
      errorTypes[errorKey] = (errorTypes[errorKey] || 0) + 1;
    }
    
    console.log('');
    console.log('Top error messages:');
    Object.entries(errorTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .forEach(([error, count]) => {
        console.log('  -', error, '(' + count + ' emails)');
      });
  }
  console.log();
}

analyzeExtractions().catch(console.error);
