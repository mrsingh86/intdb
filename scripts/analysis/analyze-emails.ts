import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://fdmcdbvkfdmrdowfjrcz.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || 'sb_publishable_v9RFIqbeitIgL4y6MXPLNg_CyC2YwRm'
);

async function analyzeRawEmails() {
  console.log('='.repeat(80));
  console.log('RAW EMAILS EXTRACTION ANALYSIS');
  console.log('='.repeat(80));
  console.log();

  // 1. Overall statistics
  const { count: totalCount } = await supabase
    .from('raw_emails')
    .select('id', { count: 'exact', head: true });
  
  const { count: extractionsCount } = await supabase
    .from('raw_emails')
    .select('id', { count: 'exact', head: true })
    .not('entity_extractions', 'is', null);

  console.log('1. OVERALL STATISTICS');
  console.log('-'.repeat(80));
  console.log('Total emails:', totalCount || 0);
  console.log('Emails with extractions:', extractionsCount || 0);
  const coverage = ((extractionsCount || 0) / (totalCount || 1) * 100).toFixed(2);
  console.log('Extraction coverage:', coverage + '%');
  console.log();

  // 2. Body text analysis
  const { data: allEmails } = await supabase
    .from('raw_emails')
    .select('id, body_text, body_html');
  
  let hasBodyText = 0;
  let hasBodyHtml = 0;
  let hasNeither = 0;
  
  if (allEmails) {
    for (const email of allEmails) {
      const hasText = email.body_text && email.body_text.trim().length > 0;
      const hasHtml = email.body_html && email.body_html.trim().length > 0;
      
      if (hasText) hasBodyText++;
      if (hasHtml) hasBodyHtml++;
      if (!hasText && !hasHtml) hasNeither++;
    }
  }
  
  const total = allEmails?.length || 0;
  console.log('2. BODY CONTENT ANALYSIS');
  console.log('-'.repeat(80));
  console.log('Emails with body_text:', hasBodyText, '(' + (hasBodyText / total * 100).toFixed(2) + '%)');
  console.log('Emails with body_html:', hasBodyHtml, '(' + (hasBodyHtml / total * 100).toFixed(2) + '%)');
  console.log('Emails with neither:', hasNeither, '(' + (hasNeither / total * 100).toFixed(2) + '%)');
  console.log();

  // 3. Carrier breakdown
  const { data: carrierStats } = await supabase
    .from('raw_emails')
    .select('carrier_id, entity_extractions');
  
  const carrierBreakdown: Record<string, { total: number; withExtractions: number }> = {};
  
  if (carrierStats) {
    for (const email of carrierStats) {
      const carrier = email.carrier_id || 'unknown';
      if (!carrierBreakdown[carrier]) {
        carrierBreakdown[carrier] = { total: 0, withExtractions: 0 };
      }
      carrierBreakdown[carrier].total++;
      if (email.entity_extractions) {
        carrierBreakdown[carrier].withExtractions++;
      }
    }
  }

  console.log('3. CARRIER EXTRACTION COVERAGE');
  console.log('-'.repeat(80));
  console.log('Carrier'.padEnd(20), 'Total'.padEnd(10), 'Extracted'.padEnd(12), 'Coverage');
  console.log('-'.repeat(80));
  
  Object.entries(carrierBreakdown)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([carrier, stats]) => {
      const cov = (stats.withExtractions / stats.total * 100).toFixed(2);
      console.log(
        carrier.padEnd(20),
        stats.total.toString().padEnd(10),
        stats.withExtractions.toString().padEnd(12),
        cov + '%'
      );
    });
  console.log();

  // 4. Document classification analysis
  const { data: docClassifications } = await supabase
    .from('raw_emails')
    .select('document_classification, entity_extractions');
  
  const classificationBreakdown: Record<string, { total: number; withExtractions: number }> = {};
  
  if (docClassifications) {
    for (const email of docClassifications) {
      const docType = email.document_classification || 'unclassified';
      if (!classificationBreakdown[docType]) {
        classificationBreakdown[docType] = { total: 0, withExtractions: 0 };
      }
      classificationBreakdown[docType].total++;
      if (email.entity_extractions) {
        classificationBreakdown[docType].withExtractions++;
      }
    }
  }

  console.log('4. DOCUMENT TYPE EXTRACTION COVERAGE');
  console.log('-'.repeat(80));
  console.log('Document Type'.padEnd(30), 'Total'.padEnd(10), 'Extracted'.padEnd(12), 'Coverage');
  console.log('-'.repeat(80));
  
  Object.entries(classificationBreakdown)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([docType, stats]) => {
      const cov = (stats.withExtractions / stats.total * 100).toFixed(2);
      console.log(
        docType.padEnd(30),
        stats.total.toString().padEnd(10),
        stats.withExtractions.toString().padEnd(12),
        cov + '%'
      );
    });
  console.log();
}

analyzeRawEmails().catch(console.error);
