/**
 * Cron Job: Pattern Cleanup
 *
 * Disables patterns with poor accuracy:
 * 1. Find patterns with >20 hits and >30% false positive rate
 * 2. Disable patterns (don't delete - keep for audit)
 * 3. Record in pattern_audit for tracking
 *
 * Schedule: Weekly (recommended)
 * Principles:
 * - Data-driven (accuracy tracked via hit_count/false_positive_count)
 * - Reversible (disabled, not deleted)
 * - Audit trail (pattern_audit table)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Configuration
const MIN_HIT_COUNT = 20;              // Minimum hits to evaluate
const MAX_FALSE_POSITIVE_RATE = 0.30;  // 30% false positive threshold
const MAX_PATTERNS_PER_RUN = 10;       // Limit patterns disabled per run

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Step 1: Find patterns with poor accuracy
    const { data: poorPatterns, error: queryError } = await supabase
      .from('detection_patterns')
      .select('id, pattern, document_type, carrier_id, hit_count, false_positive_count, enabled')
      .eq('enabled', true)
      .gt('hit_count', MIN_HIT_COUNT)
      .limit(100);

    if (queryError) {
      console.error('[Pattern Cleanup] Query error:', queryError.message);
      return NextResponse.json(
        { success: false, error: queryError.message },
        { status: 500 }
      );
    }

    // Filter to patterns exceeding false positive threshold
    const patternsToDisable = (poorPatterns || [])
      .filter(p => {
        const fpRate = (p.false_positive_count || 0) / (p.hit_count || 1);
        return fpRate > MAX_FALSE_POSITIVE_RATE;
      })
      .slice(0, MAX_PATTERNS_PER_RUN);

    if (patternsToDisable.length === 0) {
      console.log('[Pattern Cleanup] No patterns to disable');
      return NextResponse.json({
        success: true,
        duration_ms: Date.now() - startTime,
        stats: { patterns_disabled: 0, patterns_checked: poorPatterns?.length || 0 },
      });
    }

    console.log(`[Pattern Cleanup] Found ${patternsToDisable.length} patterns to disable`);

    // Step 2: Disable each pattern
    let disabled = 0;

    for (const pattern of patternsToDisable) {
      const fpRate = (pattern.false_positive_count || 0) / (pattern.hit_count || 1);
      const accuracyBefore = 1 - fpRate;

      // Disable the pattern
      const { error: updateError } = await supabase
        .from('detection_patterns')
        .update({ enabled: false })
        .eq('id', pattern.id);

      if (updateError) {
        console.error(`[Pattern Cleanup] Failed to disable pattern ${pattern.id}:`, updateError.message);
        continue;
      }

      // Step 3: Record in pattern_audit
      await supabase.from('pattern_audit').insert({
        action: 'disabled',
        pattern_id: pattern.id,
        pattern_template: pattern.pattern,
        document_type: pattern.document_type,
        carrier_id: pattern.carrier_id,
        sample_count: pattern.hit_count,
        accuracy_before: accuracyBefore,
        reason: `Poor accuracy: ${Math.round(accuracyBefore * 100)}% (${pattern.false_positive_count} false positives in ${pattern.hit_count} hits)`,
        source: 'auto_cleanup',
      });

      disabled++;
      console.log(`[Pattern Cleanup] Disabled: "${pattern.pattern}" (${Math.round(accuracyBefore * 100)}% accuracy)`);
    }

    console.log(`[Pattern Cleanup] Completed: ${disabled} patterns disabled`);

    return NextResponse.json({
      success: true,
      duration_ms: Date.now() - startTime,
      stats: {
        patterns_disabled: disabled,
        patterns_checked: poorPatterns?.length || 0,
      },
    });
  } catch (error) {
    console.error('[Pattern Cleanup] Fatal error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const maxDuration = 60;
