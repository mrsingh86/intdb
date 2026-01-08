/**
 * Comprehensive Extraction Test with LLM Judge Validation
 *
 * Tests extraction across all sender categories and document types,
 * using LLM Judge to validate quality and identify pattern improvements.
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';
dotenv.config();

import {
  createSenderAwareExtractor,
  createSenderCategoryDetector,
  SenderCategory,
  ExtractedEntity,
} from '../../lib/services/extraction';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// ============================================================================
// Types
// ============================================================================

interface TestEmail {
  id: string;
  sender_email: string;
  true_sender_email: string | null;
  subject: string;
  body_text: string;
  document_type: string | null;
  email_type: string | null;
}

interface ExtractionTestResult {
  emailId: string;
  senderCategory: SenderCategory;
  documentType: string;
  emailType: string;
  extractionCount: number;
  extractions: ExtractedEntity[];
  judgeVerdict: 'approved' | 'needs_review' | 'rejected' | 'skipped';
  judgeScore: number;
  issues: Array<{ field: string; issue: string; severity: string }>;
  processingTimeMs: number;
}

interface CategoryStats {
  category: string;
  emailCount: number;
  totalExtractions: number;
  avgExtractionsPerEmail: number;
  avgConfidence: number;
  verdictCounts: { approved: number; needs_review: number; rejected: number; skipped: number };
  topEntityTypes: Array<{ type: string; count: number }>;
  commonIssues: Array<{ issue: string; count: number }>;
  patternRecommendations: string[];
}

// ============================================================================
// Data Fetching
// ============================================================================

async function fetchTestEmails(limit = 100): Promise<TestEmail[]> {
  const { data, error } = await supabase
    .from('raw_emails')
    .select(`
      id,
      sender_email,
      true_sender_email,
      subject,
      body_text,
      document_classifications (
        document_type,
        email_type
      )
    `)
    .not('body_text', 'is', null)
    .gt('body_text', '')
    .order('received_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching emails:', error);
    return [];
  }

  return (data || []).map((row: any) => ({
    id: row.id,
    sender_email: row.sender_email || '',
    true_sender_email: row.true_sender_email,
    subject: row.subject || '',
    body_text: row.body_text || '',
    document_type: row.document_classifications?.[0]?.document_type || 'unknown',
    email_type: row.document_classifications?.[0]?.email_type || 'unknown',
  }));
}

// ============================================================================
// LLM Judge (Simplified for Testing)
// ============================================================================

async function judgeExtraction(
  extractions: ExtractedEntity[],
  sourceContent: string,
  senderCategory: string
): Promise<{
  verdict: 'approved' | 'needs_review' | 'rejected';
  score: number;
  issues: Array<{ field: string; issue: string; severity: string }>;
  recommendations: string[];
}> {
  // Skip judge if no extractions or too few
  if (extractions.length === 0) {
    return {
      verdict: 'needs_review',
      score: 50,
      issues: [{ field: 'general', issue: 'No entities extracted', severity: 'warning' }],
      recommendations: ['Review source content for extractable entities'],
    };
  }

  // Build extraction summary
  const extractionSummary = extractions.slice(0, 15).map(e =>
    `${e.entityType}: "${e.entityValue}" (${e.confidence}%)`
  ).join('\n');

  const prompt = `You are validating shipping/logistics entity extraction quality.

## Sender Category: ${senderCategory}

## Extracted Entities:
${extractionSummary}

## Source Content (first 4000 chars):
${sourceContent.slice(0, 4000)}

## Validation Task:
1. Check if each extracted value ACTUALLY appears in the source content
2. Flag any hallucinated values (not in source)
3. Flag any misattributed values (wrong field type)
4. Assess overall extraction quality

## Critical Fields (highest priority):
- booking_number, container_number, bl_number, entry_number
- etd, eta, si_cutoff, vgm_cutoff
- port_of_loading, port_of_discharge

## Return JSON only:
{
  "verdict": "approved" | "needs_review" | "rejected",
  "score": <0-100>,
  "issues": [
    {"field": "<entity_type>", "issue": "<problem description>", "severity": "critical|warning|info"}
  ],
  "recommendations": ["<pattern improvement suggestions>"]
}

Scoring:
- 85-100: All critical fields correct, minor issues = approved
- 60-84: Some issues but usable = needs_review
- Below 60: Major errors = rejected`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);

    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        verdict: parsed.verdict || 'needs_review',
        score: parsed.score || 50,
        issues: parsed.issues || [],
        recommendations: parsed.recommendations || [],
      };
    }
  } catch (error: any) {
    console.error('Judge error:', error.message);
  }

  return {
    verdict: 'needs_review',
    score: 50,
    issues: [{ field: 'system', issue: 'Judge evaluation failed', severity: 'warning' }],
    recommendations: [],
  };
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runComprehensiveTest() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  COMPREHENSIVE EXTRACTION TEST WITH LLM JUDGE');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const detector = createSenderCategoryDetector();
  const extractor = createSenderAwareExtractor(supabase);

  // Fetch test emails
  console.log('Fetching test emails...');
  const emails = await fetchTestEmails(150);
  console.log(`Loaded ${emails.length} emails\n`);

  // Group by sender category
  const emailsByCategory: Record<string, TestEmail[]> = {};
  for (const email of emails) {
    const sender = email.true_sender_email || email.sender_email;
    const category = detector.detect(sender);
    if (!emailsByCategory[category]) emailsByCategory[category] = [];
    emailsByCategory[category].push(email);
  }

  console.log('Emails by Category:');
  for (const [cat, catEmails] of Object.entries(emailsByCategory)) {
    console.log(`  ${cat.padEnd(20)} ${catEmails.length}`);
  }
  console.log('');

  // Run extraction and judge on each category
  const allResults: ExtractionTestResult[] = [];
  const categoryStats: CategoryStats[] = [];

  for (const [category, catEmails] of Object.entries(emailsByCategory)) {
    console.log(`\n${'─'.repeat(65)}`);
    console.log(`Testing: ${category.toUpperCase()} (${catEmails.length} emails)`);
    console.log('─'.repeat(65));

    const categoryResults: ExtractionTestResult[] = [];
    const entityTypeCounts: Record<string, number> = {};
    const issueCounts: Record<string, number> = {};
    let totalConfidence = 0;
    let confCount = 0;

    // Test up to 10 emails per category
    const samplesToTest = catEmails.slice(0, 10);

    for (let i = 0; i < samplesToTest.length; i++) {
      const email = samplesToTest[i];
      const startTime = Date.now();

      try {
        // Run extraction
        const result = await extractor.extract({
          emailId: email.id,
          senderEmail: email.sender_email,
          trueSenderEmail: email.true_sender_email || undefined,
          subject: email.subject,
          bodyText: email.body_text.slice(0, 10000),
          sourceType: 'email',
        });

        // Count entity types
        for (const ext of result.extractions) {
          entityTypeCounts[ext.entityType] = (entityTypeCounts[ext.entityType] || 0) + 1;
          totalConfidence += ext.confidence;
          confCount++;
        }

        // Run LLM Judge (only on some for cost)
        let judgeResult = { verdict: 'skipped' as const, score: 0, issues: [] as any[], recommendations: [] as string[] };

        // Judge every 3rd email or if it has significant extractions
        if (i % 3 === 0 || result.extractions.length >= 5) {
          process.stdout.write(`  [${i + 1}/${samplesToTest.length}] Judging "${email.subject.slice(0, 40)}..."... `);

          judgeResult = await judgeExtraction(
            result.extractions,
            `Subject: ${email.subject}\n\n${email.body_text}`,
            category
          );

          console.log(`${judgeResult.verdict} (${judgeResult.score})`);

          // Count issues
          for (const issue of judgeResult.issues) {
            const key = `${issue.field}: ${issue.issue.slice(0, 50)}`;
            issueCounts[key] = (issueCounts[key] || 0) + 1;
          }
        } else {
          process.stdout.write(`  [${i + 1}/${samplesToTest.length}] "${email.subject.slice(0, 50)}..." → ${result.extractions.length} entities\n`);
        }

        categoryResults.push({
          emailId: email.id,
          senderCategory: category as SenderCategory,
          documentType: email.document_type || 'unknown',
          emailType: email.email_type || 'unknown',
          extractionCount: result.extractions.length,
          extractions: result.extractions,
          judgeVerdict: judgeResult.verdict,
          judgeScore: judgeResult.score,
          issues: judgeResult.issues,
          processingTimeMs: Date.now() - startTime,
        });

      } catch (error: any) {
        console.error(`  Error on ${email.id}: ${error.message}`);
      }
    }

    // Calculate category stats
    const verdictCounts = { approved: 0, needs_review: 0, rejected: 0, skipped: 0 };
    for (const r of categoryResults) {
      verdictCounts[r.judgeVerdict]++;
    }

    const topEntityTypes = Object.entries(entityTypeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([type, count]) => ({ type, count }));

    const commonIssues = Object.entries(issueCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([issue, count]) => ({ issue, count }));

    categoryStats.push({
      category,
      emailCount: samplesToTest.length,
      totalExtractions: categoryResults.reduce((s, r) => s + r.extractionCount, 0),
      avgExtractionsPerEmail: categoryResults.length > 0
        ? categoryResults.reduce((s, r) => s + r.extractionCount, 0) / categoryResults.length
        : 0,
      avgConfidence: confCount > 0 ? totalConfidence / confCount : 0,
      verdictCounts,
      topEntityTypes,
      commonIssues,
      patternRecommendations: [],
    });

    allResults.push(...categoryResults);
  }

  // Generate comprehensive report
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  EXTRACTION QUALITY REPORT');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Overall stats
  const totalEmails = allResults.length;
  const totalExtractions = allResults.reduce((s, r) => s + r.extractionCount, 0);
  const judgedResults = allResults.filter(r => r.judgeVerdict !== 'skipped');
  const approvedCount = allResults.filter(r => r.judgeVerdict === 'approved').length;
  const reviewCount = allResults.filter(r => r.judgeVerdict === 'needs_review').length;
  const rejectedCount = allResults.filter(r => r.judgeVerdict === 'rejected').length;

  console.log('OVERALL STATISTICS:');
  console.log(`  Emails Tested:      ${totalEmails}`);
  console.log(`  Total Extractions:  ${totalExtractions}`);
  console.log(`  Avg per Email:      ${(totalExtractions / totalEmails).toFixed(1)}`);
  console.log('');
  console.log('JUDGE VERDICTS (on judged samples):');
  console.log(`  ✓ Approved:      ${approvedCount} (${((approvedCount / judgedResults.length) * 100).toFixed(0)}%)`);
  console.log(`  ○ Needs Review:  ${reviewCount} (${((reviewCount / judgedResults.length) * 100).toFixed(0)}%)`);
  console.log(`  ✗ Rejected:      ${rejectedCount} (${((rejectedCount / judgedResults.length) * 100).toFixed(0)}%)`);

  // Per-category breakdown
  console.log('\n\nCATEGORY BREAKDOWN:\n');

  for (const stat of categoryStats) {
    const approvalRate = stat.verdictCounts.approved /
      (stat.verdictCounts.approved + stat.verdictCounts.needs_review + stat.verdictCounts.rejected) || 0;

    console.log(`┌─ ${stat.category.toUpperCase()}`);
    console.log(`│  Emails: ${stat.emailCount}, Extractions: ${stat.totalExtractions}, Avg/Email: ${stat.avgExtractionsPerEmail.toFixed(1)}`);
    console.log(`│  Avg Confidence: ${stat.avgConfidence.toFixed(0)}%`);
    console.log(`│  Approval Rate: ${(approvalRate * 100).toFixed(0)}%`);

    if (stat.topEntityTypes.length > 0) {
      console.log('│  Top Entities:');
      for (const et of stat.topEntityTypes.slice(0, 5)) {
        console.log(`│    ${et.type.padEnd(22)} ${et.count}`);
      }
    }

    if (stat.commonIssues.length > 0) {
      console.log('│  Issues Found:');
      for (const issue of stat.commonIssues) {
        console.log(`│    ⚠ ${issue.issue.slice(0, 50)}... (${issue.count}x)`);
      }
    }
    console.log('└─\n');
  }

  // Aggregate all issues for pattern recommendations
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  PATTERN IMPROVEMENT RECOMMENDATIONS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const allIssues: Record<string, number> = {};
  for (const result of allResults) {
    for (const issue of result.issues) {
      const key = `[${issue.severity}] ${issue.field}: ${issue.issue}`;
      allIssues[key] = (allIssues[key] || 0) + 1;
    }
  }

  const sortedIssues = Object.entries(allIssues)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  if (sortedIssues.length > 0) {
    console.log('Most Common Issues:\n');
    for (const [issue, count] of sortedIssues) {
      console.log(`  ${count}x  ${issue}`);
    }
  }

  // Entity type performance
  console.log('\n\nENTITY TYPE PERFORMANCE:\n');

  const entityPerformance: Record<string, { total: number; highConf: number; avgConf: number }> = {};

  for (const result of allResults) {
    for (const ext of result.extractions) {
      if (!entityPerformance[ext.entityType]) {
        entityPerformance[ext.entityType] = { total: 0, highConf: 0, avgConf: 0 };
      }
      entityPerformance[ext.entityType].total++;
      entityPerformance[ext.entityType].avgConf += ext.confidence;
      if (ext.confidence >= 90) entityPerformance[ext.entityType].highConf++;
    }
  }

  const sortedEntityPerf = Object.entries(entityPerformance)
    .map(([type, perf]) => ({
      type,
      total: perf.total,
      highConf: perf.highConf,
      avgConf: perf.avgConf / perf.total,
      highConfRate: perf.highConf / perf.total,
    }))
    .sort((a, b) => b.total - a.total);

  console.log('Entity Type                  Count  High-Conf  Avg-Conf  Success%');
  console.log('─'.repeat(65));

  for (const ep of sortedEntityPerf.slice(0, 15)) {
    console.log(
      `${ep.type.padEnd(28)} ${ep.total.toString().padStart(5)}  ` +
      `${ep.highConf.toString().padStart(9)}  ${ep.avgConf.toFixed(0).padStart(8)}%  ` +
      `${(ep.highConfRate * 100).toFixed(0).padStart(7)}%`
    );
  }

  // Sample detailed results
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  SAMPLE DETAILED RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const sampleResults = allResults
    .filter(r => r.judgeVerdict !== 'skipped' && r.extractionCount > 0)
    .slice(0, 8);

  for (const result of sampleResults) {
    const email = emails.find(e => e.id === result.emailId);
    const statusIcon = result.judgeVerdict === 'approved' ? '✓' :
                       result.judgeVerdict === 'rejected' ? '✗' : '○';

    console.log(`${statusIcon} [${result.senderCategory.toUpperCase()}] Score: ${result.judgeScore}`);
    console.log(`  Subject: ${email?.subject.slice(0, 65)}...`);
    console.log(`  Doc Type: ${result.documentType}, Email Type: ${result.emailType}`);
    console.log(`  Extractions (${result.extractionCount}):`);

    for (const ext of result.extractions.slice(0, 6)) {
      const confIcon = ext.confidence >= 90 ? '✓' : ext.confidence >= 75 ? '○' : '?';
      console.log(`    ${confIcon} ${ext.entityType.padEnd(20)} ${ext.entityValue.slice(0, 30).padEnd(30)} ${ext.confidence}%`);
    }

    if (result.issues.length > 0) {
      console.log(`  Issues:`);
      for (const issue of result.issues.slice(0, 3)) {
        console.log(`    ⚠ [${issue.severity}] ${issue.field}: ${issue.issue.slice(0, 50)}`);
      }
    }
    console.log('');
  }

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  TEST COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

runComprehensiveTest().catch(console.error);
