/**
 * Validated Pattern Discovery with LLM Judge
 *
 * 1. Defines EXPECTED entities per document type (freight domain knowledge)
 * 2. Validates classification quality before pattern extraction
 * 3. Discovers patterns only for expected entities
 * 4. Uses LLM Judge to validate patterns make sense
 *
 * Usage:
 *   npx tsx scripts/analysis/pattern-discovery-validated.ts
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

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  samplesPerType: 5,
  model: 'claude-sonnet-4-20250514',
  maxContentLength: 2000,
};

// ============================================================================
// EXPECTED ENTITIES PER DOCUMENT TYPE (Freight Forwarding Domain Knowledge)
// ============================================================================

interface EntitySchema {
  documentType: string;
  description: string;
  expectedEntities: {
    critical: string[];      // Must be present
    important: string[];     // Should be present
    optional: string[];      // Nice to have
  };
  subjectKeywords: string[]; // Keywords that should appear in subject
  contentKeywords: string[]; // Keywords that should appear in body
}

const ENTITY_SCHEMAS: EntitySchema[] = [
  {
    documentType: 'booking_confirmation',
    description: 'Carrier confirmation of cargo booking with vessel/voyage details',
    expectedEntities: {
      critical: ['booking_number', 'vessel_name', 'voyage_number'],
      important: ['etd', 'eta', 'pol', 'pod', 'container_type', 'si_cutoff', 'vgm_cutoff'],
      optional: ['cargo_cutoff', 'doc_cutoff', 'customer_reference', 'carrier'],
    },
    subjectKeywords: ['booking', 'confirmation', 'rate', 'HL-', 'BKG'],
    contentKeywords: ['booking', 'vessel', 'voyage', 'ETD', 'ETA', 'cut-off', 'cutoff'],
  },
  {
    documentType: 'arrival_notice',
    description: 'Notification that shipment has arrived or is arriving at destination',
    expectedEntities: {
      critical: ['mbl_number', 'container_number', 'eta'],
      important: ['hbl_number', 'ata', 'port_of_discharge', 'it_number', 'lfd'],
      optional: ['consignee', 'notify_party', 'pickup_number', 'terminal'],
    },
    subjectKeywords: ['arrival', 'notice', 'AN', 'MBL', 'HBL', 'container'],
    contentKeywords: ['arrival', 'ETA', 'ATA', 'discharge', 'terminal', 'IT#', 'LFD'],
  },
  {
    documentType: 'payment_receipt',
    description: 'Confirmation of payment received or payment transaction details',
    expectedEntities: {
      critical: ['payment_amount', 'invoice_number'],
      important: ['payment_date', 'transaction_id', 'payer_name'],
      optional: ['bank_reference', 'currency', 'payment_method'],
    },
    subjectKeywords: ['payment', 'receipt', 'paid', 'received', 'remittance'],
    contentKeywords: ['payment', 'paid', 'amount', 'received', 'transaction', 'bank'],
  },
  {
    documentType: 'invoice',
    description: 'Commercial or freight invoice requesting payment',
    expectedEntities: {
      critical: ['invoice_number', 'total_amount'],
      important: ['invoice_date', 'due_date', 'charges_breakdown'],
      optional: ['booking_reference', 'container_number', 'currency', 'tax_amount'],
    },
    subjectKeywords: ['invoice', 'INV', 'bill', 'statement'],
    contentKeywords: ['invoice', 'amount', 'charges', 'total', 'payment', 'due'],
  },
  {
    documentType: 'shipping_instruction',
    description: 'SI submission with shipper/consignee details for BL preparation',
    expectedEntities: {
      critical: ['booking_number', 'shipper_name', 'consignee_name'],
      important: ['bl_number', 'notify_party', 'vessel_name', 'container_number'],
      optional: ['port_of_loading', 'port_of_discharge', 'cargo_description', 'hs_code'],
    },
    subjectKeywords: ['SI', 'shipping instruction', 'submitted', 'amendment'],
    contentKeywords: ['shipper', 'consignee', 'notify', 'BL', 'booking', 'cargo'],
  },
  {
    documentType: 'bill_of_lading',
    description: 'BL document or draft for review/approval',
    expectedEntities: {
      critical: ['bl_number', 'shipper_name', 'consignee_name'],
      important: ['vessel_name', 'voyage_number', 'container_number', 'pol', 'pod'],
      optional: ['notify_party', 'cargo_description', 'weight', 'measurement'],
    },
    subjectKeywords: ['BL', 'B/L', 'bill of lading', 'draft', 'MBL', 'HBL'],
    contentKeywords: ['shipper', 'consignee', 'vessel', 'voyage', 'container', 'cargo'],
  },
  {
    documentType: 'work_order',
    description: 'Delivery/trucking work order with container pickup details',
    expectedEntities: {
      critical: ['container_number', 'pickup_location'],
      important: ['work_order_number', 'lfd', 'delivery_address', 'pickup_date'],
      optional: ['trucker_name', 'appointment_time', 'terminal', 'chassis_number'],
    },
    subjectKeywords: ['work order', 'WO', 'delivery', 'pickup', 'container'],
    contentKeywords: ['pickup', 'delivery', 'LFD', 'appointment', 'terminal', 'container'],
  },
  {
    documentType: 'sob_confirmation',
    description: 'Shipped on Board confirmation that cargo is loaded on vessel',
    expectedEntities: {
      critical: ['bl_number', 'vessel_name', 'on_board_date'],
      important: ['container_number', 'voyage_number', 'etd'],
      optional: ['seal_number', 'weight', 'measurement'],
    },
    subjectKeywords: ['SOB', 'shipped', 'on board', 'loaded', 'departed'],
    contentKeywords: ['shipped', 'on board', 'loaded', 'vessel', 'departed', 'sailing'],
  },
  {
    documentType: 'booking_amendment',
    description: 'Change/update to existing booking details',
    expectedEntities: {
      critical: ['booking_number', 'amendment_type'],
      important: ['old_value', 'new_value', 'vessel_name'],
      optional: ['amendment_fee', 'effective_date', 'reason'],
    },
    subjectKeywords: ['amendment', 'update', 'change', 'revision', 'modify'],
    contentKeywords: ['amendment', 'change', 'update', 'revised', 'new', 'old'],
  },
  {
    documentType: 'entry_summary',
    description: 'US Customs entry summary (CBP Form 7501)',
    expectedEntities: {
      critical: ['entry_number', 'entry_type'],
      important: ['duty_amount', 'entry_date', 'port_of_entry'],
      optional: ['importer_of_record', 'hts_code', 'bond_number'],
    },
    subjectKeywords: ['entry', 'summary', 'CBP', '7501', 'customs'],
    contentKeywords: ['entry', 'duty', 'customs', 'CBP', 'bond', 'importer'],
  },
  {
    documentType: 'delivery_order',
    description: 'Authorization to release/deliver cargo',
    expectedEntities: {
      critical: ['bl_number', 'container_number'],
      important: ['consignee_name', 'delivery_location', 'release_date'],
      optional: ['do_number', 'terminal', 'trucker_authorization'],
    },
    subjectKeywords: ['delivery order', 'DO', 'release', 'authorization'],
    contentKeywords: ['delivery', 'release', 'authorize', 'consignee', 'container'],
  },
  {
    documentType: 'hbl',
    description: 'House Bill of Lading from freight forwarder',
    expectedEntities: {
      critical: ['hbl_number', 'shipper_name', 'consignee_name'],
      important: ['mbl_number', 'vessel_name', 'container_number'],
      optional: ['notify_party', 'cargo_description', 'freight_charges'],
    },
    subjectKeywords: ['HBL', 'house BL', 'house bill'],
    contentKeywords: ['HBL', 'house', 'shipper', 'consignee', 'MBL', 'master'],
  },
  {
    documentType: 'hbl_draft',
    description: 'Draft House BL for review before final issuance',
    expectedEntities: {
      critical: ['hbl_number', 'shipper_name', 'consignee_name'],
      important: ['vessel_name', 'voyage_number', 'container_number'],
      optional: ['corrections_needed', 'approval_deadline'],
    },
    subjectKeywords: ['HBL', 'draft', 'review', 'approval'],
    contentKeywords: ['draft', 'review', 'approve', 'correct', 'shipper', 'consignee'],
  },
  {
    documentType: 'shipping_bill',
    description: 'Export customs declaration document (India specific)',
    expectedEntities: {
      critical: ['shipping_bill_number', 'exporter_name'],
      important: ['booking_number', 'container_number', 'let_export_date'],
      optional: ['iec_code', 'fob_value', 'port_of_loading'],
    },
    subjectKeywords: ['SB', 'shipping bill', 'LEO', 'export'],
    contentKeywords: ['shipping bill', 'SB No', 'LEO', 'exporter', 'customs'],
  },
];

// ============================================================================
// Types
// ============================================================================

interface EmailSample {
  id: string;
  subject: string;
  body_text: string;
  sender_email: string;
  document_type: string;
  email_type: string;
  confidence_score: number;
}

interface ValidationResult {
  isValid: boolean;
  matchedKeywords: string[];
  missingKeywords: string[];
  confidenceAdjustment: number;
  issues: string[];
}

interface DiscoveredPattern {
  documentType: string;
  entitySchema: EntitySchema;
  patterns: {
    entity: string;
    priority: 'critical' | 'important' | 'optional';
    subjectPatterns: PatternMatch[];
    bodyPatterns: PatternMatch[];
  }[];
  validationStats: {
    samplesAnalyzed: number;
    validSamples: number;
    invalidSamples: number;
    invalidReasons: string[];
  };
  overallConfidence: number;
  notes: string[];
}

interface PatternMatch {
  pattern: string;
  examples: string[];
  confidence: number;
}

// ============================================================================
// Step 1: Validate Classification Quality
// ============================================================================

function validateClassification(sample: EmailSample, schema: EntitySchema): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    matchedKeywords: [],
    missingKeywords: [],
    confidenceAdjustment: 0,
    issues: [],
  };

  const subjectLower = (sample.subject || '').toLowerCase();
  const bodyLower = (sample.body_text || '').toLowerCase().substring(0, 3000);
  const combinedText = `${subjectLower} ${bodyLower}`;

  // Check subject keywords
  for (const keyword of schema.subjectKeywords) {
    if (subjectLower.includes(keyword.toLowerCase())) {
      result.matchedKeywords.push(`subject:${keyword}`);
    }
  }

  // Check content keywords
  for (const keyword of schema.contentKeywords) {
    if (combinedText.includes(keyword.toLowerCase())) {
      result.matchedKeywords.push(`body:${keyword}`);
    }
  }

  // Calculate match ratio
  const totalKeywords = schema.subjectKeywords.length + schema.contentKeywords.length;
  const matchRatio = result.matchedKeywords.length / totalKeywords;

  // Determine validity
  if (matchRatio < 0.2) {
    result.isValid = false;
    result.issues.push(`Low keyword match (${(matchRatio * 100).toFixed(0)}%): likely misclassified`);
  } else if (matchRatio < 0.4) {
    result.confidenceAdjustment = -20;
    result.issues.push(`Moderate keyword match (${(matchRatio * 100).toFixed(0)}%)`);
  }

  // Check for obvious misclassification patterns
  const misclassificationChecks: { pattern: RegExp; shouldNotBe: string[] }[] = [
    { pattern: /payment.*receipt|paid.*amount|remittance/i, shouldNotBe: ['booking_confirmation', 'arrival_notice', 'work_order'] },
    { pattern: /arrival.*notice|AN\s*#|eta.*ata/i, shouldNotBe: ['payment_receipt', 'invoice', 'booking_confirmation'] },
    { pattern: /booking.*confirm|HL-\d{8}|BKG.*NO/i, shouldNotBe: ['payment_receipt', 'arrival_notice', 'invoice'] },
    { pattern: /work.*order|WO.*#|delivery.*schedul/i, shouldNotBe: ['payment_receipt', 'booking_confirmation', 'invoice'] },
  ];

  for (const check of misclassificationChecks) {
    if (check.pattern.test(combinedText) && check.shouldNotBe.includes(sample.document_type)) {
      result.isValid = false;
      result.issues.push(`Content suggests different document type (pattern: ${check.pattern.source})`);
    }
  }

  return result;
}

// ============================================================================
// Step 2: Fetch and Validate Samples
// ============================================================================

async function fetchValidatedSamples(schema: EntitySchema): Promise<{ valid: EmailSample[]; invalid: EmailSample[] }> {
  const { data: samples, error } = await supabase
    .from('document_classifications')
    .select(`
      email_id,
      document_type,
      email_type,
      confidence_score,
      raw_emails!inner (
        id,
        subject,
        body_text,
        sender_email
      )
    `)
    .eq('document_type', schema.documentType)
    .order('confidence_score', { ascending: false })
    .limit(CONFIG.samplesPerType * 2); // Fetch extra in case some are invalid

  if (error || !samples) {
    console.log(`  ⚠️ Error fetching ${schema.documentType}: ${error?.message}`);
    return { valid: [], invalid: [] };
  }

  const valid: EmailSample[] = [];
  const invalid: EmailSample[] = [];

  for (const s of samples) {
    const email = (s as any).raw_emails;
    const sample: EmailSample = {
      id: s.email_id,
      subject: email?.subject || '',
      body_text: email?.body_text || '',
      sender_email: email?.sender_email || '',
      document_type: s.document_type,
      email_type: s.email_type,
      confidence_score: s.confidence_score || 0,
    };

    const validation = validateClassification(sample, schema);

    if (validation.isValid) {
      valid.push(sample);
    } else {
      invalid.push(sample);
      console.log(`    ❌ Invalid: "${sample.subject.substring(0, 50)}..." - ${validation.issues.join(', ')}`);
    }

    if (valid.length >= CONFIG.samplesPerType) break;
  }

  return { valid, invalid };
}

// ============================================================================
// Step 3: Discover Patterns with LLM
// ============================================================================

async function discoverPatterns(schema: EntitySchema, samples: EmailSample[]): Promise<DiscoveredPattern['patterns']> {
  if (samples.length === 0) return [];

  const samplesText = samples.map((s, i) => `
--- SAMPLE ${i + 1} ---
Subject: ${s.subject}
Body: ${s.body_text?.substring(0, CONFIG.maxContentLength) || 'N/A'}
`).join('\n');

  const entitiesText = [
    `CRITICAL (must extract): ${schema.expectedEntities.critical.join(', ')}`,
    `IMPORTANT (should extract): ${schema.expectedEntities.important.join(', ')}`,
    `OPTIONAL (nice to have): ${schema.expectedEntities.optional.join(', ')}`,
  ].join('\n');

  const prompt = `You are a freight forwarding expert. Analyze these ${samples.length} "${schema.documentType}" emails.

DOCUMENT DESCRIPTION: ${schema.description}

ENTITIES TO FIND PATTERNS FOR:
${entitiesText}

${samplesText}

For EACH entity listed above, find regex patterns in subject line and email body.

Return ONLY valid JSON:
\`\`\`json
{
  "patterns": [
    {
      "entity": "booking_number",
      "priority": "critical",
      "subjectPatterns": [{"pattern": "BKG.*?(\\\\d{9})", "examples": ["BKG: 123456789"], "confidence": 90}],
      "bodyPatterns": [{"pattern": "Booking No\\\\.?:?\\\\s*(\\\\d{9})", "examples": ["Booking No: 123456789"], "confidence": 85}]
    }
  ],
  "notes": ["Hapag-Lloyd uses HL- prefix", "Maersk uses 9-digit numbers"]
}
\`\`\`

Important:
- Only include patterns you actually found in the samples
- Use double backslash for regex escaping in JSON
- Include real examples from the samples
- Set confidence based on how consistent the pattern is across samples`;

  try {
    const response = await anthropic.messages.create({
      model: CONFIG.model,
      max_tokens: 2048,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      const parsed = JSON.parse(jsonStr);
      return parsed.patterns || [];
    }
  } catch (error: any) {
    console.log(`    ❌ LLM Error: ${error.message}`);
  }

  return [];
}

// ============================================================================
// Step 4: LLM Judge - Validate Patterns Make Sense
// ============================================================================

async function judgePatterns(
  schema: EntitySchema,
  patterns: DiscoveredPattern['patterns'],
  samples: EmailSample[]
): Promise<{ isValid: boolean; issues: string[]; confidence: number }> {
  if (patterns.length === 0) {
    return { isValid: false, issues: ['No patterns discovered'], confidence: 0 };
  }

  const patternsText = patterns.map(p =>
    `- ${p.entity} (${p.priority}): ${p.subjectPatterns.length} subject, ${p.bodyPatterns.length} body patterns`
  ).join('\n');

  const prompt = `You are a freight forwarding QA expert. Validate these extraction patterns for "${schema.documentType}".

DOCUMENT TYPE: ${schema.documentType}
DESCRIPTION: ${schema.description}

EXPECTED ENTITIES:
- Critical: ${schema.expectedEntities.critical.join(', ')}
- Important: ${schema.expectedEntities.important.join(', ')}

DISCOVERED PATTERNS:
${patternsText}

SAMPLE SUBJECTS:
${samples.slice(0, 3).map(s => `- ${s.subject}`).join('\n')}

Evaluate:
1. Do the patterns match expected entities for this document type?
2. Are critical entities covered?
3. Any patterns that seem wrong for this document type?

Return ONLY JSON:
\`\`\`json
{
  "isValid": true,
  "issues": ["Missing pattern for vessel_name", "booking_number pattern looks correct"],
  "confidence": 85,
  "criticalCoverage": 2,
  "criticalTotal": 3
}
\`\`\``;

  try {
    const response = await anthropic.messages.create({
      model: CONFIG.model,
      max_tokens: 1024,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/) || text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const jsonStr = jsonMatch[1] || jsonMatch[0];
      return JSON.parse(jsonStr);
    }
  } catch (error: any) {
    console.log(`    ❌ Judge Error: ${error.message}`);
  }

  return { isValid: true, issues: ['Judge evaluation failed'], confidence: 50 };
}

// ============================================================================
// Step 5: Save Results
// ============================================================================

function saveResults(results: DiscoveredPattern[]): void {
  const outputDir = path.join(__dirname, 'output');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Save full JSON
  const jsonPath = path.join(outputDir, 'validated-patterns.json');
  fs.writeFileSync(jsonPath, JSON.stringify(results, null, 2));

  // Generate summary
  let summary = `# Validated Extraction Patterns

Generated: ${new Date().toISOString()}

## Overview

| Document Type | Valid Samples | Confidence | Critical Entities | Patterns Found |
|--------------|---------------|------------|-------------------|----------------|
`;

  for (const r of results) {
    const criticalPatterns = r.patterns.filter(p => p.priority === 'critical').length;
    const criticalTotal = r.entitySchema.expectedEntities.critical.length;
    summary += `| ${r.documentType} | ${r.validationStats.validSamples}/${r.validationStats.samplesAnalyzed} | ${r.overallConfidence}% | ${criticalPatterns}/${criticalTotal} | ${r.patterns.length} |\n`;
  }

  summary += '\n## Entity Patterns by Document Type\n\n';

  for (const r of results) {
    summary += `### ${r.documentType}\n\n`;
    summary += `**Description:** ${r.entitySchema.description}\n\n`;

    if (r.validationStats.invalidReasons.length > 0) {
      summary += `**⚠️ Classification Issues:** ${r.validationStats.invalidReasons.slice(0, 3).join('; ')}\n\n`;
    }

    summary += '| Entity | Priority | Subject Pattern | Body Pattern | Confidence |\n';
    summary += '|--------|----------|-----------------|--------------|------------|\n';

    for (const p of r.patterns) {
      const subj = p.subjectPatterns[0]?.pattern || '-';
      const body = p.bodyPatterns[0]?.pattern || '-';
      const conf = Math.max(
        p.subjectPatterns[0]?.confidence || 0,
        p.bodyPatterns[0]?.confidence || 0
      );
      summary += `| ${p.entity} | ${p.priority} | \`${subj.substring(0, 30)}\` | \`${body.substring(0, 30)}\` | ${conf}% |\n`;
    }

    if (r.notes.length > 0) {
      summary += `\n**Notes:** ${r.notes.join('; ')}\n`;
    }

    summary += '\n---\n\n';
  }

  const summaryPath = path.join(outputDir, 'validated-patterns-summary.md');
  fs.writeFileSync(summaryPath, summary);

  console.log(`\n💾 Results saved to:`);
  console.log(`   - ${jsonPath}`);
  console.log(`   - ${summaryPath}`);
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  VALIDATED PATTERN DISCOVERY');
  console.log('  With Classification Quality Check & LLM Judge');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const results: DiscoveredPattern[] = [];
  const startTime = Date.now();

  for (let i = 0; i < ENTITY_SCHEMAS.length; i++) {
    const schema = ENTITY_SCHEMAS[i];
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);

    console.log(`\n[${i + 1}/${ENTITY_SCHEMAS.length}] ${schema.documentType} (${elapsed}s)`);
    console.log(`  Expected: ${schema.expectedEntities.critical.join(', ')}`);

    // Step 1: Fetch and validate samples
    console.log('  📥 Fetching and validating samples...');
    const { valid, invalid } = await fetchValidatedSamples(schema);

    if (valid.length === 0) {
      console.log(`  ⚠️ No valid samples found for ${schema.documentType}`);
      results.push({
        documentType: schema.documentType,
        entitySchema: schema,
        patterns: [],
        validationStats: {
          samplesAnalyzed: valid.length + invalid.length,
          validSamples: 0,
          invalidSamples: invalid.length,
          invalidReasons: invalid.map(s => s.subject.substring(0, 50)),
        },
        overallConfidence: 0,
        notes: ['No valid samples - classification quality issue'],
      });
      continue;
    }

    console.log(`  ✅ ${valid.length} valid, ${invalid.length} invalid samples`);

    // Step 2: Discover patterns
    console.log('  🔍 Discovering patterns...');
    const patterns = await discoverPatterns(schema, valid);
    console.log(`  📊 Found ${patterns.length} entity patterns`);

    // Step 3: Judge patterns
    console.log('  ⚖️ Validating with LLM Judge...');
    const judgement = await judgePatterns(schema, patterns, valid);
    console.log(`  ${judgement.isValid ? '✅' : '⚠️'} Confidence: ${judgement.confidence}%`);

    if (judgement.issues.length > 0) {
      judgement.issues.slice(0, 2).forEach(issue => console.log(`     - ${issue}`));
    }

    results.push({
      documentType: schema.documentType,
      entitySchema: schema,
      patterns,
      validationStats: {
        samplesAnalyzed: valid.length + invalid.length,
        validSamples: valid.length,
        invalidSamples: invalid.length,
        invalidReasons: invalid.map(s => s.subject.substring(0, 50)),
      },
      overallConfidence: judgement.confidence,
      notes: judgement.issues,
    });

    // Save incrementally
    saveResults(results);

    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(0);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log(`  ✅ ANALYSIS COMPLETE in ${totalTime}s`);
  console.log(`  Document types analyzed: ${results.length}`);
  console.log(`  With valid patterns: ${results.filter(r => r.patterns.length > 0).length}`);
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
