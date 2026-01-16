/**
 * Reclassification Batch Tester
 *
 * Tests classification outcomes across different categories
 * before running full reclassification.
 *
 * Categories tested:
 * - By current document_type
 * - By sender domain
 * - By subject patterns
 * - By has_attachment status
 * - By thread position
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { createPatternMatcherService } from './pattern-matcher';
import { AiAnalyzer } from './ai-analyzer';
import { ReclassificationLogger, createReclassificationLogger } from './reclassification-logger';

export interface TestCategory {
  name: string;
  description: string;
  sampleSize: number;
  query: {
    column?: string;
    operator?: string;
    value?: string | number | boolean;
    sql?: string;
  };
}

export interface TestResult {
  category: string;
  description: string;
  sampleSize: number;
  tested: number;
  patternMatches: number;
  aiClassifications: number;
  changed: number;
  unchanged: number;
  errors: number;
  changeDetails: Array<{
    oldType: string;
    newType: string;
    count: number;
    samples: string[];
  }>;
  duration: number;
}

export interface BatchTestReport {
  startTime: Date;
  endTime: Date;
  totalTested: number;
  totalCategories: number;
  results: TestResult[];
  overallStats: {
    patternMatchRate: number;
    changeRate: number;
    errorRate: number;
  };
  recommendations: string[];
  readyForFullReclassification: boolean;
}

// Default test categories covering different permutations
export const DEFAULT_TEST_CATEGORIES: TestCategory[] = [
  // By document type (most common)
  { name: 'booking_confirmation', description: 'Booking confirmations', sampleSize: 20, query: { column: 'document_type', operator: 'eq', value: 'booking_confirmation' } },
  { name: 'general_correspondence', description: 'General emails', sampleSize: 20, query: { column: 'document_type', operator: 'eq', value: 'general_correspondence' } },
  { name: 'invoice', description: 'Invoices', sampleSize: 20, query: { column: 'document_type', operator: 'eq', value: 'invoice' } },
  { name: 'arrival_notice', description: 'Arrival notices', sampleSize: 20, query: { column: 'document_type', operator: 'eq', value: 'arrival_notice' } },
  { name: 'shipping_instructions', description: 'SI documents', sampleSize: 20, query: { column: 'document_type', operator: 'eq', value: 'shipping_instructions' } },
  { name: 'draft_bl', description: 'Draft BLs', sampleSize: 20, query: { column: 'document_type', operator: 'eq', value: 'draft_bl' } },

  // By sender domain (carriers vs internal)
  { name: 'maersk_sender', description: 'Emails from Maersk', sampleSize: 15, query: { column: 'from_address', operator: 'ilike', value: '%maersk%' } },
  { name: 'hapag_sender', description: 'Emails from Hapag', sampleSize: 15, query: { column: 'from_address', operator: 'ilike', value: '%hapag%' } },
  { name: 'intoglo_sender', description: 'Internal Intoglo emails', sampleSize: 15, query: { column: 'from_address', operator: 'ilike', value: '%intoglo%' } },

  // By subject patterns
  { name: 'form_13_subject', description: 'Form 13 in subject', sampleSize: 10, query: { column: 'subject', operator: 'ilike', value: '%form%13%' } },
  { name: 'vgm_subject', description: 'VGM in subject', sampleSize: 10, query: { column: 'subject', operator: 'ilike', value: '%vgm%' } },
  { name: 'booking_subject', description: 'Booking in subject', sampleSize: 15, query: { column: 'subject', operator: 'ilike', value: '%booking%' } },
  { name: 'otp_subject', description: 'OTP/passcode emails', sampleSize: 10, query: { column: 'subject', operator: 'ilike', value: '%passcode%' } },

  // By thread position (deep threads)
  { name: 're_prefix', description: 'Reply emails (RE:)', sampleSize: 20, query: { column: 'subject', operator: 'ilike', value: 'RE:%' } },
  { name: 'fwd_prefix', description: 'Forwarded emails (Fwd:)', sampleSize: 10, query: { column: 'subject', operator: 'ilike', value: 'Fwd:%' } },

  // Edge cases
  { name: 'system_notification', description: 'System notifications', sampleSize: 10, query: { column: 'document_type', operator: 'eq', value: 'system_notification' } },
  { name: 'exception_notice', description: 'Exception notices', sampleSize: 10, query: { column: 'document_type', operator: 'eq', value: 'exception_notice' } },
  { name: 'rate_request', description: 'Rate requests', sampleSize: 10, query: { column: 'document_type', operator: 'eq', value: 'rate_request' } },
];

export class ReclassificationTester {
  private supabase: SupabaseClient;
  private patternMatcher: ReturnType<typeof createPatternMatcherService>;
  private aiAnalyzer: AiAnalyzer;
  private logger: ReclassificationLogger;

  constructor(supabase: SupabaseClient, options?: { logToConsole?: boolean }) {
    this.supabase = supabase;
    this.patternMatcher = createPatternMatcherService(supabase);
    this.aiAnalyzer = new AiAnalyzer();
    this.logger = createReclassificationLogger({ logToConsole: options?.logToConsole ?? true });
  }

  async runBatchTests(
    categories: TestCategory[] = DEFAULT_TEST_CATEGORIES,
    options?: { skipAi?: boolean; confidenceThreshold?: number }
  ): Promise<BatchTestReport> {
    const startTime = new Date();
    const results: TestResult[] = [];
    const skipAi = options?.skipAi ?? false;
    const confidenceThreshold = options?.confidenceThreshold ?? 85;

    console.log('\n' + '='.repeat(70));
    console.log('       RECLASSIFICATION BATCH TESTING');
    console.log('='.repeat(70));
    console.log(`\nTesting ${categories.length} categories...`);
    console.log(`Skip AI: ${skipAi}, Confidence threshold: ${confidenceThreshold}`);

    for (const category of categories) {
      const result = await this.testCategory(category, { skipAi, confidenceThreshold });
      results.push(result);

      // Brief summary after each category
      console.log(`\n✓ ${category.name}: ${result.tested} tested, ${result.changed} changed (${result.patternMatches} pattern, ${result.aiClassifications} AI)`);
    }

    const endTime = new Date();
    const totalTested = results.reduce((sum, r) => sum + r.tested, 0);
    const totalPatternMatches = results.reduce((sum, r) => sum + r.patternMatches, 0);
    const totalChanged = results.reduce((sum, r) => sum + r.changed, 0);
    const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);

    const report: BatchTestReport = {
      startTime,
      endTime,
      totalTested,
      totalCategories: categories.length,
      results,
      overallStats: {
        patternMatchRate: totalTested > 0 ? (totalPatternMatches / totalTested) * 100 : 0,
        changeRate: totalTested > 0 ? (totalChanged / totalTested) * 100 : 0,
        errorRate: totalTested > 0 ? (totalErrors / totalTested) * 100 : 0,
      },
      recommendations: this.generateRecommendations(results),
      readyForFullReclassification: this.isReadyForFullReclassification(results),
    };

    this.printFinalReport(report);

    return report;
  }

  private async testCategory(
    category: TestCategory,
    options: { skipAi: boolean; confidenceThreshold: number }
  ): Promise<TestResult> {
    const categoryStart = Date.now();

    // Fetch sample records
    let query = this.supabase
      .from('chronicle')
      .select('id, gmail_message_id, subject, body_preview, from_address, attachments, document_type')
      .limit(category.sampleSize);

    if (category.query.column && category.query.operator && category.query.value !== undefined) {
      const { column, operator, value } = category.query;
      if (operator === 'eq') query = query.eq(column, value);
      else if (operator === 'ilike') query = query.ilike(column, value as string);
      else if (operator === 'gt') query = query.gt(column, value);
      else if (operator === 'lt') query = query.lt(column, value);
    }

    const { data: records, error } = await query;

    if (error || !records) {
      return {
        category: category.name,
        description: category.description,
        sampleSize: category.sampleSize,
        tested: 0,
        patternMatches: 0,
        aiClassifications: 0,
        changed: 0,
        unchanged: 0,
        errors: 1,
        changeDetails: [],
        duration: Date.now() - categoryStart,
      };
    }

    const changeMap = new Map<string, { count: number; samples: string[] }>();
    let patternMatches = 0;
    let aiClassifications = 0;
    let changed = 0;
    let errors = 0;

    for (const record of records) {
      try {
        // Try pattern matching first - build input directly from chronicle record
        const patternInput = {
          subject: record.subject || '',
          senderEmail: record.from_address || '',
          bodyText: record.body_preview || '',
          hasAttachment: Array.isArray(record.attachments) && record.attachments.length > 0,
          threadPosition: 1,
        };

        const patternResult = await this.patternMatcher.match(patternInput);

        let newType: string;
        let method: 'pattern' | 'ai';

        if (patternResult.matched && patternResult.confidence >= options.confidenceThreshold) {
          newType = patternResult.documentType!;
          method = 'pattern';
          patternMatches++;
        } else if (options.skipAi) {
          // Skip AI, keep original
          newType = record.document_type;
          method = 'pattern';
        } else {
          // Fall back to AI
          const attachmentText = (record.attachments || [])
            .filter((a: any) => a.extractedText)
            .map((a: any) => a.extractedText?.substring(0, 2000))
            .join('\n');

          const analysis = await this.aiAnalyzer.analyze(
            {
              gmailMessageId: record.gmail_message_id,
              threadId: '',
              subject: record.subject || '',
              bodyText: record.body_preview || '',
              senderEmail: record.from_address || '',
              senderName: '',
              recipientEmails: [],
              receivedAt: new Date(),
              direction: 'inbound',
              snippet: '',
              attachments: [],
            },
            attachmentText
          );

          newType = analysis.document_type;
          method = 'ai';
          aiClassifications++;
        }

        // Track changes
        if (record.document_type !== newType) {
          changed++;
          const key = `${record.document_type} → ${newType}`;
          const existing = changeMap.get(key) || { count: 0, samples: [] };
          existing.count++;
          if (existing.samples.length < 3) {
            existing.samples.push(record.subject?.substring(0, 60) || 'No subject');
          }
          changeMap.set(key, existing);
        }
      } catch (err) {
        errors++;
        console.error(`  Error testing ${record.id}:`, err instanceof Error ? err.message : err);
      }
    }

    const changeDetails = Array.from(changeMap.entries())
      .map(([key, data]) => {
        const [oldType, newType] = key.split(' → ');
        return { oldType, newType, count: data.count, samples: data.samples };
      })
      .sort((a, b) => b.count - a.count);

    return {
      category: category.name,
      description: category.description,
      sampleSize: category.sampleSize,
      tested: records.length,
      patternMatches,
      aiClassifications,
      changed,
      unchanged: records.length - changed,
      errors,
      changeDetails,
      duration: Date.now() - categoryStart,
    };
  }

  private generateRecommendations(results: TestResult[]): string[] {
    const recommendations: string[] = [];

    // Check error rates
    const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
    const totalTested = results.reduce((sum, r) => sum + r.tested, 0);
    const errorRate = totalTested > 0 ? (totalErrors / totalTested) * 100 : 0;

    if (errorRate > 5) {
      recommendations.push(`⚠️ High error rate (${errorRate.toFixed(1)}%). Investigate errors before full run.`);
    }

    // Check pattern match rate
    const totalPatternMatches = results.reduce((sum, r) => sum + r.patternMatches, 0);
    const patternRate = totalTested > 0 ? (totalPatternMatches / totalTested) * 100 : 0;

    if (patternRate < 20) {
      recommendations.push(`ℹ️ Low pattern match rate (${patternRate.toFixed(1)}%). Consider adding more patterns.`);
    } else if (patternRate > 80) {
      recommendations.push(`✓ Excellent pattern match rate (${patternRate.toFixed(1)}%). Most emails will be deterministic.`);
    }

    // Check change rates by category
    for (const result of results) {
      const changeRate = result.tested > 0 ? (result.changed / result.tested) * 100 : 0;
      if (changeRate > 50) {
        recommendations.push(`⚠️ High change rate in ${result.category} (${changeRate.toFixed(0)}%). Review changes.`);
      }
    }

    // Check for unexpected changes
    for (const result of results) {
      for (const change of result.changeDetails) {
        // Flag suspicious changes
        if (change.oldType === 'booking_confirmation' && change.newType === 'booking_request') {
          recommendations.push(`⚠️ ${change.count} booking_confirmation → booking_request. Verify this is correct.`);
        }
        if (change.oldType === 'invoice' && change.newType === 'general_correspondence') {
          recommendations.push(`⚠️ ${change.count} invoice → general_correspondence. May lose important docs.`);
        }
      }
    }

    if (recommendations.length === 0) {
      recommendations.push('✓ All tests passed. Safe to proceed with full reclassification.');
    }

    return recommendations;
  }

  private isReadyForFullReclassification(results: TestResult[]): boolean {
    const totalErrors = results.reduce((sum, r) => sum + r.errors, 0);
    const totalTested = results.reduce((sum, r) => sum + r.tested, 0);
    const errorRate = totalTested > 0 ? (totalErrors / totalTested) * 100 : 0;

    // Ready if error rate < 5%
    return errorRate < 5;
  }

  private printFinalReport(report: BatchTestReport): void {
    console.log('\n' + '='.repeat(70));
    console.log('       BATCH TEST FINAL REPORT');
    console.log('='.repeat(70));

    console.log(`\nDuration: ${((report.endTime.getTime() - report.startTime.getTime()) / 1000).toFixed(1)}s`);
    console.log(`Categories tested: ${report.totalCategories}`);
    console.log(`Total records tested: ${report.totalTested}`);

    console.log(`\nOverall Statistics:`);
    console.log(`  Pattern match rate: ${report.overallStats.patternMatchRate.toFixed(1)}%`);
    console.log(`  Change rate: ${report.overallStats.changeRate.toFixed(1)}%`);
    console.log(`  Error rate: ${report.overallStats.errorRate.toFixed(1)}%`);

    console.log(`\nTop Changes Across All Categories:`);
    const allChanges = new Map<string, number>();
    for (const result of report.results) {
      for (const change of result.changeDetails) {
        const key = `${change.oldType} → ${change.newType}`;
        allChanges.set(key, (allChanges.get(key) || 0) + change.count);
      }
    }
    const topChanges = Array.from(allChanges.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    for (const [change, count] of topChanges) {
      console.log(`  ${change}: ${count}`);
    }

    console.log(`\nRecommendations:`);
    for (const rec of report.recommendations) {
      console.log(`  ${rec}`);
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`  READY FOR FULL RECLASSIFICATION: ${report.readyForFullReclassification ? '✓ YES' : '✗ NO'}`);
    console.log('='.repeat(70) + '\n');
  }
}

export function createReclassificationTester(
  supabase: SupabaseClient,
  options?: { logToConsole?: boolean }
): ReclassificationTester {
  return new ReclassificationTester(supabase, options);
}
