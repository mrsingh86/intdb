/**
 * Pattern Discovery with Opus 4.5
 *
 * Analyzes real emails grouped by (documentType, senderCategory, emailType)
 * to discover extraction patterns using a freight forwarding expert persona.
 *
 * Usage:
 *   npx tsx scripts/analysis/pattern-discovery-opus.ts
 *
 * Output:
 *   - Console: Pattern analysis results
 *   - File: scripts/analysis/output/discovered-patterns.json
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// ============================================================================
// Configuration
// ============================================================================

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

// Analysis configuration
const CONFIG = {
  samplesPerGroup: 5,         // Emails to analyze per (docType, senderCat, emailType)
  maxGroups: 20,              // Max groups to analyze
  model: 'claude-sonnet-4-20250514', // Sonnet for faster analysis
  batchSize: 50,              // Database fetch batch size
  maxEmailBodyLength: 1500,   // Truncate email body
  maxPdfLength: 1500,         // Truncate PDF content
};

// ============================================================================
// Types
// ============================================================================

interface EmailSample {
  id: string;
  subject: string;
  body_text: string;
  sender_email: string;
  true_sender_email: string;
  document_type: string;
  sender_category: string;
  email_type: string;
  carrier?: string;
  pdf_content?: string;
}

interface PatternGroup {
  documentType: string;
  senderCategory: string;
  emailType: string;
  carrier?: string;
  count: number;
  samples: EmailSample[];
}

interface DiscoveredPattern {
  group: {
    documentType: string;
    senderCategory: string;
    emailType: string;
    carrier?: string;
  };
  emailPatterns: {
    subjectPatterns: RegexPattern[];
    bodyPatterns: FieldPattern[];
    tablePatterns: TablePattern[];
  };
  pdfPatterns: {
    fieldPatterns: FieldPattern[];
    tablePatterns: TablePattern[];
  };
  keyFields: string[];
  extractionPriority: 'email_first' | 'pdf_first' | 'combined';
  notes: string[];
  confidence: number;
}

interface RegexPattern {
  field: string;
  pattern: string;
  confidence: number;
  examples: string[];
}

interface FieldPattern {
  field: string;
  labelPatterns: string[];
  valuePatterns: string[];
  contextKeywords: string[];
  confidence: number;
}

interface TablePattern {
  tableType: string;
  headerPatterns: string[];
  columnMapping: Record<string, string>;
  confidence: number;
}

// ============================================================================
// Helper: Carrier Detection
// ============================================================================

function detectCarrierFromEmail(senderEmail?: string, bodyText?: string): string | undefined {
  const text = `${senderEmail || ''} ${bodyText || ''}`.toLowerCase();

  const carriers: Record<string, RegExp[]> = {
    'maersk': [/maersk/i, /maeu/i, /msku/i],
    'hapag-lloyd': [/hapag/i, /hlag/i, /hlcu/i],
    'cma-cgm': [/cma.*cgm/i, /cmau/i],
    'msc': [/\bmsc\b/i, /mscu/i],
    'cosco': [/cosco/i, /cosu/i],
    'one': [/ocean.*network/i, /oney/i],
    'evergreen': [/evergreen/i, /eglv/i],
  };

  for (const [carrier, patterns] of Object.entries(carriers)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return carrier;
      }
    }
  }

  return undefined;
}

// ============================================================================
// Step 1: Fetch and Group Emails
// ============================================================================

async function fetchEmailGroups(): Promise<PatternGroup[]> {
  console.log('\n📊 Step 1: Fetching email distribution...\n');

  // First, get the distribution of classified emails
  // Using actual columns: document_type, sender_party_type, document_direction
  const { data: distribution, error: distError } = await supabase
    .from('document_classifications')
    .select(`
      document_type,
      sender_party_type,
      document_direction
    `)
    .not('document_type', 'is', null)
    .not('document_type', 'eq', 'unknown')
    .not('document_type', 'eq', 'not_shipping')
    .limit(5000);

  if (distError) {
    console.error('Error fetching distribution:', distError);
    return [];
  }

  // Group by (documentType, senderPartyType, direction)
  const groupMap = new Map<string, { count: number; emailIds: string[] }>();

  for (const row of distribution || []) {
    // Use sender_party_type as senderCategory proxy, document_direction as emailType proxy
    const key = `${row.document_type}|${row.sender_party_type || 'unknown'}|${row.document_direction || 'unknown'}`;

    if (!groupMap.has(key)) {
      groupMap.set(key, { count: 0, emailIds: [] });
    }
    groupMap.get(key)!.count++;
  }

  // Sort by count and take top groups
  const sortedGroups = Array.from(groupMap.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, CONFIG.maxGroups);

  console.log(`Found ${sortedGroups.length} email groups:\n`);

  for (const [key, value] of sortedGroups) {
    const [docType, senderCat, emailType] = key.split('|');
    console.log(`  ${docType} | ${senderCat} | ${emailType}: ${value.count} emails`);
  }

  // Now fetch samples for each group
  const patternGroups: PatternGroup[] = [];

  for (const [key, value] of sortedGroups) {
    const [docType, senderPartyType, direction] = key.split('|');

    // Fetch sample emails for this group
    let query = supabase
      .from('document_classifications')
      .select(`
        email_id,
        document_type,
        sender_party_type,
        document_direction,
        raw_emails!inner (
          id,
          subject,
          body_text,
          sender_email,
          true_sender_email
        )
      `)
      .eq('document_type', docType);

    // Handle null/unknown values properly
    if (senderPartyType === 'unknown' || senderPartyType === 'null') {
      query = query.is('sender_party_type', null);
    } else {
      query = query.eq('sender_party_type', senderPartyType);
    }

    if (direction === 'unknown' || direction === 'null') {
      query = query.is('document_direction', null);
    } else {
      query = query.eq('document_direction', direction);
    }

    const { data: samples, error: sampleError } = await query.limit(CONFIG.samplesPerGroup);

    if (sampleError || !samples?.length) {
      console.log(`  ⚠️ No samples for ${key}: ${sampleError?.message || 'no data'}`);
      continue;
    }

    const filteredSamples = samples.slice(0, CONFIG.samplesPerGroup);

    if (filteredSamples.length === 0) continue;

    // Fetch PDF content for samples
    const emailIds = filteredSamples.map(s => s.email_id);
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('email_id, extracted_text')
      .in('email_id', emailIds)
      .ilike('filename', '%.pdf');

    const pdfMap = new Map<string, string>();
    for (const att of attachments || []) {
      if (att.extracted_text) {
        pdfMap.set(att.email_id, att.extracted_text);
      }
    }

    // Build samples
    const emailSamples: EmailSample[] = filteredSamples.map(s => {
      const email = (s as any).raw_emails;
      return {
        id: s.email_id,
        subject: email?.subject || '',
        body_text: email?.body_text || '',
        sender_email: email?.sender_email || '',
        true_sender_email: email?.true_sender_email || '',
        document_type: s.document_type,
        sender_category: s.sender_party_type || 'unknown',
        email_type: s.document_direction || 'unknown',
        carrier: detectCarrierFromEmail(email?.sender_email, email?.body_text),
        pdf_content: pdfMap.get(s.email_id),
      };
    });

    patternGroups.push({
      documentType: docType,
      senderCategory: senderPartyType,
      emailType: direction,
      carrier: emailSamples[0]?.carrier,
      count: value.count,
      samples: emailSamples,
    });
  }

  console.log(`\n✅ Prepared ${patternGroups.length} groups for analysis\n`);
  return patternGroups;
}

// ============================================================================
// Step 2: Analyze Patterns with Opus 4.5
// ============================================================================

async function analyzeGroupPatterns(group: PatternGroup): Promise<DiscoveredPattern | null> {
  console.log(`\n🔍 Analyzing: ${group.documentType} | ${group.senderCategory} | ${group.emailType}`);
  console.log(`   Samples: ${group.samples.length}, Total in DB: ${group.count}`);

  // Build analysis prompt
  const prompt = buildAnalysisPrompt(group);

  try {
    const response = await anthropic.messages.create({
      model: CONFIG.model,
      max_tokens: 2048,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // Parse JSON response
    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);

      return {
        group: {
          documentType: group.documentType,
          senderCategory: group.senderCategory,
          emailType: group.emailType,
          carrier: group.carrier,
        },
        ...parsed,
      };
    }

    console.log('   ⚠️ Could not parse response');
    return null;

  } catch (error: any) {
    console.error(`   ❌ Error: ${error.message}`);
    return null;
  }
}

function buildAnalysisPrompt(group: PatternGroup): string {
  const samplesText = group.samples.map((s, i) => `
--- SAMPLE ${i + 1} ---
Subject: ${s.subject}
Sender: ${s.sender_email}

BODY:
${(s.body_text || '').substring(0, CONFIG.maxEmailBodyLength)}

${s.pdf_content ? `PDF:
${s.pdf_content.substring(0, CONFIG.maxPdfLength)}` : ''}
`).join('\n');

  return `You are a freight forwarding expert. Analyze these ${group.samples.length} ${group.documentType} emails (${group.senderCategory}, ${group.emailType}).

${samplesText}

Extract patterns for: subject line regex, body field labels, and key fields.

Return ONLY JSON:
\`\`\`json
{
  "emailPatterns": {
    "subjectPatterns": [{"field": "booking_number", "pattern": "regex", "confidence": 90, "examples": []}],
    "bodyPatterns": [{"field": "etd", "labelPatterns": ["ETD:"], "valuePatterns": ["\\\\d{2}-[A-Z]{3}-\\\\d{4}"], "contextKeywords": [], "confidence": 85}],
    "tablePatterns": []
  },
  "pdfPatterns": {"fieldPatterns": [], "tablePatterns": []},
  "keyFields": ["booking_number", "vessel", "etd"],
  "extractionPriority": "email_first",
  "notes": [],
  "confidence": 85
}
\`\`\`

Use actual patterns from samples. Double-escape regex in JSON.`;
}

// ============================================================================
// Step 3: Save Results
// ============================================================================

function saveResults(patterns: DiscoveredPattern[]): void {
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'discovered-patterns.json');
  fs.writeFileSync(outputPath, JSON.stringify(patterns, null, 2));
  console.log(`\n💾 Results saved to: ${outputPath}`);

  // Also generate a summary
  const summaryPath = path.join(outputDir, 'pattern-summary.md');
  const summary = generateSummary(patterns);
  fs.writeFileSync(summaryPath, summary);
  console.log(`📄 Summary saved to: ${summaryPath}`);
}

function generateSummary(patterns: DiscoveredPattern[]): string {
  let md = `# Discovered Extraction Patterns

Generated: ${new Date().toISOString()}

## Overview

| Document Type | Sender Category | Email Type | Confidence | Key Fields |
|--------------|-----------------|------------|------------|------------|
`;

  for (const p of patterns) {
    md += `| ${p.group.documentType} | ${p.group.senderCategory} | ${p.group.emailType} | ${p.confidence}% | ${p.keyFields.slice(0, 3).join(', ')} |\n`;
  }

  md += '\n## Pattern Details\n\n';

  for (const p of patterns) {
    md += `### ${p.group.documentType} (${p.group.senderCategory})\n\n`;
    md += `**Email Type:** ${p.group.emailType}\n`;
    md += `**Confidence:** ${p.confidence}%\n`;
    md += `**Extraction Priority:** ${p.extractionPriority}\n\n`;

    if (p.emailPatterns.subjectPatterns.length > 0) {
      md += '#### Subject Patterns\n\n';
      for (const sp of p.emailPatterns.subjectPatterns) {
        md += `- **${sp.field}**: \`${sp.pattern}\` (${sp.confidence}%)\n`;
      }
      md += '\n';
    }

    if (p.emailPatterns.bodyPatterns.length > 0) {
      md += '#### Body Patterns\n\n';
      for (const bp of p.emailPatterns.bodyPatterns) {
        md += `- **${bp.field}**: Labels: ${bp.labelPatterns.join(', ')} (${bp.confidence}%)\n`;
      }
      md += '\n';
    }

    if (p.notes.length > 0) {
      md += '#### Notes\n\n';
      for (const note of p.notes) {
        md += `- ${note}\n`;
      }
      md += '\n';
    }

    md += '---\n\n';
  }

  return md;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  PATTERN DISCOVERY (Sonnet - Fast Mode)');
  console.log('  Freight Forwarding Expert Analysis');
  console.log('═══════════════════════════════════════════════════════════════');

  // Step 1: Fetch and group emails
  const groups = await fetchEmailGroups();

  if (groups.length === 0) {
    console.log('❌ No email groups found');
    return;
  }

  // Step 2: Analyze each group with Sonnet (with incremental saves)
  console.log('\n🧠 Starting Sonnet analysis...\n');
  const discoveredPatterns: DiscoveredPattern[] = [];
  const startTime = Date.now();

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    console.log(`\n[${i + 1}/${groups.length}] ${group.documentType} | ${group.senderCategory} | ${group.emailType} (${elapsed}s elapsed)`);

    const pattern = await analyzeGroupPatterns(group);
    if (pattern) {
      discoveredPatterns.push(pattern);
      console.log(`   ✅ ${pattern.emailPatterns.subjectPatterns.length} subject, ${pattern.emailPatterns.bodyPatterns.length} body patterns`);

      // Save incrementally after each successful analysis
      saveResults(discoveredPatterns);
    }

    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  ✅ ANALYSIS COMPLETE in ${totalTime}s`);
  console.log(`  Analyzed: ${groups.length} groups`);
  console.log(`  Discovered: ${discoveredPatterns.length} pattern sets`);
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
