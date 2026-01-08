/**
 * Opus 4.5 Analysis: Entity Extraction Architecture
 *
 * Analyzes the codebase and suggests architecture for:
 * - Separate email content extraction vs document content extraction
 * - Storage buckets connected by identifier
 * - Precise logic for each type
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || '' });

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  OPUS 4.5 ANALYSIS: Entity Extraction Architecture');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1. Gather current state
  console.log('📊 Gathering current architecture...\n');

  // Get current entity_extractions table structure
  const { data: sampleExtraction } = await supabase
    .from('entity_extractions')
    .select('*')
    .limit(1);

  const extractionColumns = sampleExtraction?.[0] ? Object.keys(sampleExtraction[0]) : [];

  // Get sample extractions to understand data
  const { data: sampleData } = await supabase
    .from('entity_extractions')
    .select('*')
    .limit(5);

  // Read relevant source files
  const filesToAnalyze = [
    'lib/services/shipment-extraction-service.ts',
    'lib/services/extraction/layered-extraction-service.ts',
    'lib/services/extraction/regex-extractors.ts',
    'lib/services/extraction/pattern-definitions.ts',
  ];

  const sourceCode: Record<string, string> = {};
  for (const file of filesToAnalyze) {
    const fullPath = path.join(process.cwd(), file);
    if (fs.existsSync(fullPath)) {
      sourceCode[file] = fs.readFileSync(fullPath, 'utf-8').substring(0, 5000);
    }
  }

  // Get document type distribution
  const { data: docTypes } = await supabase
    .from('document_classifications')
    .select('document_type')
    .not('document_type', 'is', null)
    .limit(1000);

  const docTypeCount: Record<string, number> = {};
  for (const d of docTypes || []) {
    docTypeCount[d.document_type] = (docTypeCount[d.document_type] || 0) + 1;
  }

  // 2. Build analysis prompt
  console.log('🧠 Analyzing with Opus 4.5...\n');

  const prompt = `You are a senior software architect specializing in freight forwarding systems and document intelligence platforms.

## Current State Analysis

### Database: entity_extractions table
Columns: ${extractionColumns.join(', ')}

Sample data:
${JSON.stringify(sampleData?.slice(0, 2), null, 2)}

### Document Types in System
${Object.entries(docTypeCount).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([type, count]) => `- ${type}: ${count} emails`).join('\n')}

### Current Extraction Code Snippets
${Object.entries(sourceCode).map(([file, code]) => `
--- ${file} ---
${code}
`).join('\n')}

## Architecture Question

The user wants to know if entity extraction should be split into:
1. **Email Content Extraction** - Extracting entities from email subject/body
2. **Document Content Extraction** - Extracting entities from PDF attachments

With separate storage buckets connected by an identifier.

## Your Task

Analyze and provide a detailed recommendation:

1. **Should extraction be separated?**
   - Pros and cons
   - What entities are typically in emails vs documents?

2. **Proposed Data Model**
   - Table schemas for email_extractions vs document_extractions
   - How to link them (foreign keys, identifiers)
   - Common fields vs type-specific fields

3. **Extraction Logic Differences**
   - What patterns work for emails?
   - What patterns work for PDFs?
   - Should AI be used differently for each?

4. **Document Type Specific Considerations**
   - For booking_confirmation: what's in email vs PDF?
   - For arrival_notice: what's in email vs PDF?
   - For invoice: what's in email vs PDF?
   - etc.

5. **Recommended Architecture**
   - Service structure
   - Data flow diagram (ASCII)
   - Migration strategy from current state

Provide concrete, actionable recommendations with code structure examples.`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 8192,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const analysisText = response.content[0].type === 'text' ? response.content[0].text : '';

    // Save the analysis
    const outputPath = path.join(__dirname, 'output', 'extraction-architecture-analysis.md');
    fs.writeFileSync(outputPath, `# Entity Extraction Architecture Analysis

Generated: ${new Date().toISOString()}
Model: Claude Opus 4.5

---

${analysisText}
`);

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  ANALYSIS COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`\nSaved to: ${outputPath}\n`);

    // Print key sections
    console.log(analysisText);

  } catch (error: any) {
    console.error('Error during analysis:', error.message);
  }
}

main().catch(console.error);
