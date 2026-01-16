/**
 * Learning Dashboard Stats API
 *
 * GET /api/learning/stats
 * Returns overview metrics for the learning dashboard
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch stats in parallel
    const [
      patternsResult,
      pendingPatternsResult,
      classificationsForReviewResult,
      recentClassificationsResult,
      accuracyResult,
    ] = await Promise.all([
      // Active patterns count
      supabase
        .from('detection_patterns')
        .select('id', { count: 'exact', head: true })
        .eq('enabled', true),

      // Pending patterns (discovered, awaiting approval)
      supabase
        .from('pending_patterns')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),

      // Classifications needing review
      supabase
        .from('learning_episodes')
        .select('id', { count: 'exact', head: true })
        .eq('needs_review', true)
        .is('reviewed_at', null),

      // Recent classifications (last 24h)
      supabase
        .from('learning_episodes')
        .select('id, was_correct', { count: 'exact' })
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),

      // Overall accuracy (last 7 days)
      supabase
        .from('learning_episodes')
        .select('was_correct')
        .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
    ]);

    // Calculate accuracy
    const accuracyData = accuracyResult.data || [];
    const totalClassifications = accuracyData.length;
    const correctClassifications = accuracyData.filter(e => e.was_correct).length;
    const accuracyRate = totalClassifications > 0
      ? Math.round((correctClassifications / totalClassifications) * 1000) / 10
      : 0;

    // Recent patterns added (last 24h)
    const { count: newPatternsToday } = await supabase
      .from('pattern_audit')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'discovered')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

    // Patterns disabled (last 7 days)
    const { count: patternsDisabledWeek } = await supabase
      .from('pattern_audit')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'disabled')
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

    return NextResponse.json({
      patterns: {
        active: patternsResult.count || 0,
        pending: pendingPatternsResult.count || 0,
        newToday: newPatternsToday || 0,
        disabledThisWeek: patternsDisabledWeek || 0,
      },
      classifications: {
        forReview: classificationsForReviewResult.count || 0,
        last24h: recentClassificationsResult.count || 0,
      },
      accuracy: {
        rate: accuracyRate,
        total: totalClassifications,
        correct: correctClassifications,
        period: '7 days',
      },
    });
  } catch (error) {
    console.error('[Learning Stats] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
