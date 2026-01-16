/**
 * Batch Test API
 *
 * Runs classification tests across different categories
 * to verify outcomes before full reclassification.
 *
 * GET /api/learning/batch-test
 * GET /api/learning/batch-test?skip_ai=true (faster, pattern-only)
 * GET /api/learning/batch-test?categories=form_13,vgm_subject (specific categories)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  createReclassificationTester,
  DEFAULT_TEST_CATEGORIES,
  TestCategory,
} from '@/lib/chronicle/reclassification-tester';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now();

  try {
    const searchParams = request.nextUrl.searchParams;
    const skipAi = searchParams.get('skip_ai') === 'true';
    const confidenceThreshold = parseInt(searchParams.get('confidence') || '85');
    const categoryFilter = searchParams.get('categories')?.split(',');

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Filter categories if specified
    let categories: TestCategory[] = DEFAULT_TEST_CATEGORIES;
    if (categoryFilter && categoryFilter.length > 0) {
      categories = DEFAULT_TEST_CATEGORIES.filter(c =>
        categoryFilter.includes(c.name)
      );
    }

    const tester = createReclassificationTester(supabase, { logToConsole: true });

    const report = await tester.runBatchTests(categories, {
      skipAi,
      confidenceThreshold,
    });

    return NextResponse.json({
      success: true,
      durationMs: Date.now() - startTime,
      report: {
        totalTested: report.totalTested,
        totalCategories: report.totalCategories,
        overallStats: report.overallStats,
        readyForFullReclassification: report.readyForFullReclassification,
        recommendations: report.recommendations,
        results: report.results.map(r => ({
          category: r.category,
          description: r.description,
          tested: r.tested,
          patternMatches: r.patternMatches,
          aiClassifications: r.aiClassifications,
          changed: r.changed,
          unchanged: r.unchanged,
          errors: r.errors,
          changeDetails: r.changeDetails,
        })),
      },
    });
  } catch (error) {
    console.error('[BatchTest] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        durationMs: Date.now() - startTime,
      },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes for full test
