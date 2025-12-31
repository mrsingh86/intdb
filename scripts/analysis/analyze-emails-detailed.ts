import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://fdmcdbvkfdmrdowfjrcz.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || 'sb_publishable_v9RFIqbeitIgL4y6MXPLNg_CyC2YwRm'
);

async function analyzeRawEmails() {
  console.log('='.repeat(80));
  console.log('RAW EMAILS DETAILED ANALYSIS');
  console.log('='.repeat(80));
  console.log();

  // Get sample emails to see structure
  const { data: sampleEmails, error: sampleError } = await supabase
    .from('raw_emails')
    .select('*')
    .limit(5);

  if (sampleError) {
    console.error('Error fetching sample emails:', sampleError);
    return;
  }

  console.log('SAMPLE EMAIL STRUCTURE:');
  console.log('-'.repeat(80));
  if (sampleEmails && sampleEmails.length > 0) {
    console.log('Columns found:', Object.keys(sampleEmails[0]));
    console.log();
    console.log('First email sample:');
    console.log(JSON.stringify(sampleEmails[0], null, 2));
  }
  console.log();

  // Get all columns
  const { data: allEmails } = await supabase
    .from('raw_emails')
    .select('*');

  if (!allEmails) {
    console.log('No emails found');
    return;
  }

  console.log('TOTAL EMAILS:', allEmails.length);
  console.log();

  // Analyze each column
  const columnAnalysis: Record<string, { populated: number; empty: number }> = {};
  
  const columns = Object.keys(allEmails[0] || {});
  
  for (const col of columns) {
    columnAnalysis[col] = { populated: 0, empty: 0 };
    
    for (const email of allEmails) {
      const value = email[col];
      if (value !== null && value !== undefined && value !== '') {
        if (typeof value === 'string' && value.trim().length > 0) {
          columnAnalysis[col].populated++;
        } else if (typeof value !== 'string') {
          columnAnalysis[col].populated++;
        } else {
          columnAnalysis[col].empty++;
        }
      } else {
        columnAnalysis[col].empty++;
      }
    }
  }

  console.log('COLUMN POPULATION ANALYSIS:');
  console.log('-'.repeat(80));
  console.log('Column'.padEnd(30), 'Populated'.padEnd(15), 'Empty'.padEnd(15), 'Coverage');
  console.log('-'.repeat(80));
  
  Object.entries(columnAnalysis)
    .sort((a, b) => b[1].populated - a[1].populated)
    .forEach(([col, stats]) => {
      const total = stats.populated + stats.empty;
      const coverage = (stats.populated / total * 100).toFixed(2);
      console.log(
        col.padEnd(30),
        stats.populated.toString().padEnd(15),
        stats.empty.toString().padEnd(15),
        coverage + '%'
      );
    });
  console.log();

  // Check for extraction-related columns
  const extractionColumns = columns.filter(col => 
    col.toLowerCase().includes('extract') || 
    col.toLowerCase().includes('entity') ||
    col.toLowerCase().includes('carrier') ||
    col.toLowerCase().includes('classification')
  );

  console.log('EXTRACTION-RELATED COLUMNS:');
  console.log('-'.repeat(80));
  extractionColumns.forEach(col => {
    console.log('  -', col);
  });
  console.log();

  // Sample values for key columns
  console.log('SAMPLE VALUES FOR KEY COLUMNS:');
  console.log('-'.repeat(80));
  
  const sampleSize = 3;
  for (const col of extractionColumns) {
    console.log('');
    console.log(col + ':');
    const samples = allEmails
      .filter(e => e[col] !== null && e[col] !== undefined && e[col] !== '')
      .slice(0, sampleSize);
    
    if (samples.length > 0) {
      samples.forEach((s, idx) => {
        const label = '  Sample ' + (idx + 1) + ':';
        console.log(label, typeof s[col] === 'object' ? JSON.stringify(s[col]) : s[col]);
      });
    } else {
      console.log('  No populated values found');
    }
  }
  console.log();
}

analyzeRawEmails().catch(console.error);
