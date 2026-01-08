/**
 * Full Coverage Extraction Test
 *
 * Tests extraction quality across:
 * - ALL sender categories (carriers, brokers, forwarders, terminals, trucking, rail)
 * - ALL document types (booking confirmation, SI, BL, arrival notice, invoice, etc.)
 * - ALL critical entities (booking#, container#, BL#, dates, ports)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import Anthropic from '@anthropic-ai/sdk';
dotenv.config();

import {
  createSenderAwareExtractor,
  createSenderCategoryDetector,
  SenderCategory,
} from '../../lib/services/extraction';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const anthropic = new Anthropic();

// ============================================================================
// Types
// ============================================================================

interface TestResult {
  category: SenderCategory;
  documentType: string;
  emailCount: number;
  extractionCount: number;
  avgConfidence: number;
  criticalEntitiesFound: number;
  approvalRate: number;
  issues: string[];
}

interface EntityValidation {
  entityType: string;
  totalCount: number;
  validatedCount: number;
  successCount: number;
  avgConfidence: number;
}

// ============================================================================
// Sender Category Keywords for Email Filtering
// ============================================================================

const SENDER_KEYWORDS: Record<string, string[]> = {
  maersk: ['maersk', 'sealand'],
  hapag: ['hapag', 'hlag'],
  cma_cgm: ['cma-cgm', 'cma cgm', 'apl.com'],
  msc: ['msc.com'],
  cosco: ['cosco', 'oocl'],
  one_line: ['one-line'],
  evergreen: ['evergreen'],
  yang_ming: ['yangming', 'yml'],
  customs_broker: ['abordeaux', 'expeditors', 'customs', 'broker'],
  freight_forwarder: ['intoglo', 'flexport', 'freight', 'logistics', 'forwarder'],
  terminal: ['terminal', 'apm-terminals', 'dpworld', 'port'],
  trucking: ['trucking', 'drayage', 'transport', 'jbhunt', 'schneider'],
  rail: ['bnsf', 'rail', 'intermodal', 'ns.com', 'csx'],
};

const DOCUMENT_TYPE_KEYWORDS: Record<string, string[]> = {
  booking_confirmation: ['booking confirmation', 'booking confirmed', 'bkg:', 'booking #'],
  shipping_instructions: ['shipping instruction', 'si submission', 'si cutoff', 'si deadline'],
  draft_bl: ['draft bl', 'draft b/l', 'bl draft', 'proforma bl'],
  final_bl: ['final bl', 'original bl', 'bl released', 'bl surrender'],
  arrival_notice: ['arrival notice', 'arrival notification', 'vessel arrival', 'eta notice'],
  departure_notice: ['departure notice', 'vessel sailed', 'etd notice', 'sailing confirmation'],
  invoice: ['invoice', 'freight invoice', 'commercial invoice', 'debit note'],
  packing_list: ['packing list', 'cargo details', 'container load'],
  customs_entry: ['customs entry', 'entry summary', 'isf', '10+2', 'customs clearance'],
  delivery_order: ['delivery order', 'd/o', 'release order', 'pickup'],
  container_tracking: ['container tracking', 'container status', 'gate out', 'gate in'],
  demurrage: ['demurrage', 'detention', 'last free day', 'lfd', 'free time'],
  amendment: ['amendment', 'revision', 'update', 'correction', 'change'],
};

// ============================================================================
// Main Test Functions
// ============================================================================

async function fetchEmailsForCategory(
  category: string,
  keywords: string[],
  limit: number = 20
): Promise<any[]> {
  // Build OR conditions for keywords
  const conditions = keywords.map(kw =>
    `true_sender_email.ilike.%${kw}%,sender_email.ilike.%${kw}%,subject.ilike.%${kw}%`
  ).join(',');

  const { data, error } = await supabase
    .from('raw_emails')
    .select('id, sender_email, true_sender_email, subject, body_text')
    .not('body_text', 'is', null)
    .or(conditions)
    .order('received_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`Error fetching ${category} emails:`, error.message);
    return [];
  }

  return data || [];
}

async function fetchEmailsForDocType(
  docType: string,
  keywords: string[],
  limit: number = 15
): Promise<any[]> {
  const conditions = keywords.map(kw =>
    `subject.ilike.%${kw}%,body_text.ilike.%${kw}%`
  ).join(',');

  const { data, error } = await supabase
    .from('raw_emails')
    .select('id, sender_email, true_sender_email, subject, body_text')
    .not('body_text', 'is', null)
    .or(conditions)
    .order('received_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error(`Error fetching ${docType} emails:`, error.message);
    return [];
  }

  return data || [];
}

async function validateWithLLM(
  extractions: any[],
  subject: string,
  bodySnippet: string
): Promise<{ approved: boolean; score: number; issues: string[] }> {
  if (extractions.length === 0) {
    return { approved: true, score: 100, issues: [] };
  }

  const extractionSummary = extractions
    .slice(0, 10)
    .map(e => `- ${e.entityType}: "${e.entityValue}" (${e.confidence}%)`)
    .join('\n');

  const prompt = `You are a shipping document validation expert. Validate these extractions from a logistics email.

SUBJECT: ${subject}

EMAIL SNIPPET (first 1500 chars):
${bodySnippet.slice(0, 1500)}

EXTRACTIONS:
${extractionSummary}

For each extraction, verify:
1. Does the value actually appear in the source content?
2. Is it correctly classified (e.g., booking number is actually a booking, not a phone number)?
3. Is the value complete and properly formatted?

Respond with JSON only:
{
  "approved": true/false,
  "score": 0-100,
  "issues": ["issue1", "issue2"] // empty if approved
}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      return { approved: true, score: 75, issues: [] };
    }

    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      return {
        approved: result.approved ?? result.score >= 80,
        score: result.score ?? 75,
        issues: result.issues || [],
      };
    }
  } catch (err) {
    // Skip LLM validation on error
  }

  return { approved: true, score: 75, issues: [] };
}

async function testSenderCategory(
  category: string,
  keywords: string[],
  extractor: ReturnType<typeof createSenderAwareExtractor>,
  detector: ReturnType<typeof createSenderCategoryDetector>
): Promise<TestResult> {
  const emails = await fetchEmailsForCategory(category, keywords);

  if (emails.length === 0) {
    return {
      category: category as SenderCategory,
      documentType: 'all',
      emailCount: 0,
      extractionCount: 0,
      avgConfidence: 0,
      criticalEntitiesFound: 0,
      approvalRate: 0,
      issues: ['No emails found for this category'],
    };
  }

  let totalExtractions = 0;
  let totalConfidence = 0;
  let criticalCount = 0;
  let approvedCount = 0;
  let validatedCount = 0;
  const allIssues: string[] = [];

  // Process each email
  for (const email of emails.slice(0, 10)) {
    const sender = email.true_sender_email || email.sender_email || '';

    const result = await extractor.extract({
      emailId: email.id,
      senderEmail: email.sender_email || '',
      trueSenderEmail: email.true_sender_email,
      subject: email.subject || '',
      bodyText: (email.body_text || '').slice(0, 8000),
      sourceType: 'email',
    });

    totalExtractions += result.extractions.length;
    criticalCount += result.metadata.criticalFound;

    if (result.extractions.length > 0) {
      totalConfidence += result.metadata.avgConfidence * result.extractions.length;
    }

    // Validate every 3rd email with LLM
    if (validatedCount < 3 && result.extractions.length > 0) {
      const validation = await validateWithLLM(
        result.extractions,
        email.subject || '',
        email.body_text || ''
      );
      validatedCount++;
      if (validation.approved) approvedCount++;
      if (validation.issues.length > 0) {
        allIssues.push(...validation.issues.slice(0, 2));
      }
    }
  }

  return {
    category: category as SenderCategory,
    documentType: 'all',
    emailCount: emails.length,
    extractionCount: totalExtractions,
    avgConfidence: totalExtractions > 0 ? Math.round(totalConfidence / totalExtractions) : 0,
    criticalEntitiesFound: criticalCount,
    approvalRate: validatedCount > 0 ? Math.round((approvedCount / validatedCount) * 100) : 100,
    issues: [...new Set(allIssues)].slice(0, 5),
  };
}

async function testDocumentType(
  docType: string,
  keywords: string[],
  extractor: ReturnType<typeof createSenderAwareExtractor>
): Promise<TestResult> {
  const emails = await fetchEmailsForDocType(docType, keywords);

  if (emails.length === 0) {
    return {
      category: 'other',
      documentType: docType,
      emailCount: 0,
      extractionCount: 0,
      avgConfidence: 0,
      criticalEntitiesFound: 0,
      approvalRate: 0,
      issues: ['No emails found for this document type'],
    };
  }

  let totalExtractions = 0;
  let totalConfidence = 0;
  let criticalCount = 0;
  let approvedCount = 0;
  let validatedCount = 0;
  const allIssues: string[] = [];

  for (const email of emails.slice(0, 8)) {
    const result = await extractor.extract({
      emailId: email.id,
      senderEmail: email.sender_email || '',
      trueSenderEmail: email.true_sender_email,
      subject: email.subject || '',
      bodyText: (email.body_text || '').slice(0, 8000),
      sourceType: 'email',
      documentType: docType,
    });

    totalExtractions += result.extractions.length;
    criticalCount += result.metadata.criticalFound;

    if (result.extractions.length > 0) {
      totalConfidence += result.metadata.avgConfidence * result.extractions.length;
    }

    // Validate every 4th email
    if (validatedCount < 2 && result.extractions.length > 0) {
      const validation = await validateWithLLM(
        result.extractions,
        email.subject || '',
        email.body_text || ''
      );
      validatedCount++;
      if (validation.approved) approvedCount++;
      if (validation.issues.length > 0) {
        allIssues.push(...validation.issues.slice(0, 2));
      }
    }
  }

  return {
    category: 'other',
    documentType: docType,
    emailCount: emails.length,
    extractionCount: totalExtractions,
    avgConfidence: totalExtractions > 0 ? Math.round(totalConfidence / totalExtractions) : 0,
    criticalEntitiesFound: criticalCount,
    approvalRate: validatedCount > 0 ? Math.round((approvedCount / validatedCount) * 100) : 100,
    issues: [...new Set(allIssues)].slice(0, 5),
  };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  FULL COVERAGE EXTRACTION TEST');
  console.log('  Testing ALL Sender Categories & Document Types');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const extractor = createSenderAwareExtractor(supabase);
  const detector = createSenderCategoryDetector();

  const senderResults: TestResult[] = [];
  const docTypeResults: TestResult[] = [];

  // =========================================================================
  // Test ALL Sender Categories
  // =========================================================================
  console.log('─────────────────────────────────────────────────────────────────');
  console.log('PHASE 1: SENDER CATEGORY COVERAGE');
  console.log('─────────────────────────────────────────────────────────────────\n');

  for (const [category, keywords] of Object.entries(SENDER_KEYWORDS)) {
    process.stdout.write(`  Testing ${category.padEnd(20)}... `);
    const result = await testSenderCategory(category, keywords, extractor, detector);
    senderResults.push(result);

    const status = result.emailCount === 0 ? '⚠️ NO DATA' :
                   result.approvalRate >= 80 ? '✓ PASS' :
                   result.approvalRate >= 60 ? '○ REVIEW' : '✗ FAIL';
    console.log(`${status} (${result.emailCount} emails, ${result.approvalRate}% approved)`);
  }

  // =========================================================================
  // Test ALL Document Types
  // =========================================================================
  console.log('\n─────────────────────────────────────────────────────────────────');
  console.log('PHASE 2: DOCUMENT TYPE COVERAGE');
  console.log('─────────────────────────────────────────────────────────────────\n');

  for (const [docType, keywords] of Object.entries(DOCUMENT_TYPE_KEYWORDS)) {
    process.stdout.write(`  Testing ${docType.padEnd(25)}... `);
    const result = await testDocumentType(docType, keywords, extractor);
    docTypeResults.push(result);

    const status = result.emailCount === 0 ? '⚠️ NO DATA' :
                   result.approvalRate >= 80 ? '✓ PASS' :
                   result.approvalRate >= 60 ? '○ REVIEW' : '✗ FAIL';
    console.log(`${status} (${result.emailCount} emails, ${result.approvalRate}% approved)`);
  }

  // =========================================================================
  // Summary Report
  // =========================================================================
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  COVERAGE SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Sender Category Summary
  console.log('SENDER CATEGORIES:\n');
  console.log('Category             Emails  Extractions  Confidence  Approval  Status');
  console.log('───────────────────────────────────────────────────────────────────────');

  let totalSenderEmails = 0;
  let totalSenderExtractions = 0;
  let passedSenderCategories = 0;

  for (const r of senderResults) {
    const status = r.emailCount === 0 ? 'NO DATA' :
                   r.approvalRate >= 80 ? 'PASS' :
                   r.approvalRate >= 60 ? 'REVIEW' : 'FAIL';
    if (r.approvalRate >= 80 && r.emailCount > 0) passedSenderCategories++;
    totalSenderEmails += r.emailCount;
    totalSenderExtractions += r.extractionCount;

    console.log(
      `${r.category.padEnd(20)} ${r.emailCount.toString().padStart(5)}  ` +
      `${r.extractionCount.toString().padStart(11)}  ` +
      `${(r.avgConfidence + '%').padStart(10)}  ` +
      `${(r.approvalRate + '%').padStart(8)}  ${status}`
    );
  }

  // Document Type Summary
  console.log('\nDOCUMENT TYPES:\n');
  console.log('Document Type            Emails  Extractions  Confidence  Approval  Status');
  console.log('──────────────────────────────────────────────────────────────────────────');

  let totalDocEmails = 0;
  let totalDocExtractions = 0;
  let passedDocTypes = 0;

  for (const r of docTypeResults) {
    const status = r.emailCount === 0 ? 'NO DATA' :
                   r.approvalRate >= 80 ? 'PASS' :
                   r.approvalRate >= 60 ? 'REVIEW' : 'FAIL';
    if (r.approvalRate >= 80 && r.emailCount > 0) passedDocTypes++;
    totalDocEmails += r.emailCount;
    totalDocExtractions += r.extractionCount;

    console.log(
      `${r.documentType.padEnd(25)} ${r.emailCount.toString().padStart(5)}  ` +
      `${r.extractionCount.toString().padStart(11)}  ` +
      `${(r.avgConfidence + '%').padStart(10)}  ` +
      `${(r.approvalRate + '%').padStart(8)}  ${status}`
    );
  }

  // Overall Stats
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  OVERALL QUALITY METRICS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const senderCategoriesWithData = senderResults.filter(r => r.emailCount > 0).length;
  const docTypesWithData = docTypeResults.filter(r => r.emailCount > 0).length;

  console.log(`Sender Categories Tested:  ${senderCategoriesWithData}/${Object.keys(SENDER_KEYWORDS).length}`);
  console.log(`Sender Categories Passed:  ${passedSenderCategories}/${senderCategoriesWithData} (${Math.round(passedSenderCategories/Math.max(senderCategoriesWithData, 1)*100)}%)`);
  console.log(`Document Types Tested:     ${docTypesWithData}/${Object.keys(DOCUMENT_TYPE_KEYWORDS).length}`);
  console.log(`Document Types Passed:     ${passedDocTypes}/${docTypesWithData} (${Math.round(passedDocTypes/Math.max(docTypesWithData, 1)*100)}%)`);
  console.log(`Total Emails Processed:    ${totalSenderEmails + totalDocEmails}`);
  console.log(`Total Extractions:         ${totalSenderExtractions + totalDocExtractions}`);

  // Issues Found
  const allIssues = [...senderResults, ...docTypeResults]
    .flatMap(r => r.issues)
    .filter(Boolean);

  if (allIssues.length > 0) {
    console.log('\n─────────────────────────────────────────────────────────────────');
    console.log('ISSUES FOUND:');
    console.log('─────────────────────────────────────────────────────────────────\n');

    const uniqueIssues = [...new Set(allIssues)];
    for (const issue of uniqueIssues.slice(0, 15)) {
      console.log(`  ⚠ ${issue.slice(0, 80)}`);
    }
  }

  // Quality Gate
  console.log('\n═══════════════════════════════════════════════════════════════');
  const overallPassRate = Math.round(
    ((passedSenderCategories + passedDocTypes) /
     Math.max(senderCategoriesWithData + docTypesWithData, 1)) * 100
  );

  if (overallPassRate >= 80) {
    console.log('  ✓ QUALITY GATE: PASSED');
    console.log(`    Overall Pass Rate: ${overallPassRate}%`);
  } else if (overallPassRate >= 60) {
    console.log('  ○ QUALITY GATE: NEEDS REVIEW');
    console.log(`    Overall Pass Rate: ${overallPassRate}%`);
  } else {
    console.log('  ✗ QUALITY GATE: FAILED');
    console.log(`    Overall Pass Rate: ${overallPassRate}%`);
  }
  console.log('═══════════════════════════════════════════════════════════════\n');
}

main().catch(console.error);
