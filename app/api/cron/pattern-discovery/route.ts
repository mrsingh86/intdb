/**
 * Cron Job: Pattern Discovery
 *
 * Discovers new patterns from repeated AI classifications:
 * 1. Find subject patterns that appear 10+ times with 90%+ accuracy
 * 2. Create pending patterns for human review
 * 3. Record in pattern_audit for tracking
 *
 * Schedule: Daily (recommended) or weekly
 * Principles:
 * - Flow-based learning (patterns discovered from AI success)
 * - Human approval required (pending_patterns table)
 * - Audit trail (pattern_audit table)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Configuration
const MIN_OCCURRENCES = 10;       // Minimum times pattern must appear
const MIN_ACCURACY = 0.90;        // Minimum accuracy rate (90%)
const MAX_PATTERNS_PER_RUN = 20;  // Limit patterns discovered per run
const MIN_PATTERN_LENGTH = 15;    // Reject patterns shorter than this
const MIN_QUALITY_SCORE = 40;     // Reject patterns below this quality score

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

    // Step 1: Find pattern candidates from learning_episodes
    // Group by normalized subject pattern and document_type
    const { data: candidates, error: queryError } = await supabase.rpc('discover_pattern_candidates', {
      min_occurrences: MIN_OCCURRENCES,
      min_accuracy: MIN_ACCURACY,
      max_patterns: MAX_PATTERNS_PER_RUN,
    });

    // If RPC doesn't exist yet, fall back to direct query
    let patternCandidates = candidates;
    if (queryError?.message?.includes('does not exist')) {
      console.log('[Pattern Discovery] RPC not found, using direct query');
      patternCandidates = await discoverPatternsDirectly(supabase);
    }

    if (!patternCandidates || patternCandidates.length === 0) {
      console.log('[Pattern Discovery] No pattern candidates found');
      return NextResponse.json({
        success: true,
        duration_ms: Date.now() - startTime,
        stats: { patterns_discovered: 0, already_exist: 0 },
      });
    }

    console.log(`[Pattern Discovery] Found ${patternCandidates.length} candidates`);

    // Step 2: Check which patterns already exist
    let discovered = 0;
    let alreadyExist = 0;
    const batchId = crypto.randomUUID();

    for (const candidate of patternCandidates) {
      // Check if pattern already exists in detection_patterns
      const { data: existing } = await supabase
        .from('detection_patterns')
        .select('id')
        .eq('pattern', candidate.pattern_template)
        .eq('document_type', candidate.document_type)
        .single();

      if (existing) {
        alreadyExist++;
        continue;
      }

      // Check if already in pending_patterns
      const { data: pending } = await supabase
        .from('pending_patterns')
        .select('id')
        .eq('pattern', candidate.pattern_template)
        .eq('document_type', candidate.document_type)
        .single();

      if (pending) {
        alreadyExist++;
        continue;
      }

      // Calculate quality score for this pattern
      const qualityScore = calculatePatternQuality(
        candidate.pattern_template,
        candidate.occurrences,
        candidate.accuracy_rate
      );

      // Skip low-quality patterns
      if (qualityScore < MIN_QUALITY_SCORE) {
        console.log(`[Pattern Discovery] Skipping low-quality pattern (${qualityScore}): "${candidate.pattern_template}"`);
        continue;
      }

      // Step 3: Insert into pending_patterns for review
      const { error: insertError } = await supabase
        .from('pending_patterns')
        .insert({
          carrier_id: 'discovered',
          pattern_type: 'subject',
          document_type: candidate.document_type,
          pattern: candidate.pattern_template,
          pattern_flags: 'i',
          sample_count: candidate.occurrences,
          accuracy_rate: candidate.accuracy_rate,
          sample_chronicle_ids: candidate.sample_ids || [],
          discovery_batch_id: batchId,
          status: 'pending',
          pattern_quality_score: qualityScore,
          rejection_risk_factors: getPatternRiskFactors(candidate.pattern_template),
        });

      if (insertError) {
        console.error('[Pattern Discovery] Insert error:', insertError.message);
        continue;
      }

      // Step 4: Record in pattern_audit
      await supabase.from('pattern_audit').insert({
        action: 'discovered',
        pattern_template: candidate.pattern_template,
        document_type: candidate.document_type,
        carrier_id: 'discovered',
        sample_count: candidate.occurrences,
        accuracy_after: candidate.accuracy_rate,
        reason: `Auto-discovered from ${candidate.occurrences} AI classifications`,
        source: 'auto_discovery',
      });

      discovered++;
      console.log(`[Pattern Discovery] Discovered: "${candidate.pattern_template}" → ${candidate.document_type}`);
    }

    console.log(`[Pattern Discovery] Completed: ${discovered} discovered, ${alreadyExist} already exist`);

    return NextResponse.json({
      success: true,
      duration_ms: Date.now() - startTime,
      stats: {
        patterns_discovered: discovered,
        already_exist: alreadyExist,
        batch_id: batchId,
      },
    });
  } catch (error) {
    console.error('[Pattern Discovery] Fatal error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * Direct query fallback for pattern discovery
 * Used when the RPC function doesn't exist
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function discoverPatternsDirectly(supabase: any) {
  // Get learning episodes with chronicle subject
  const { data: episodes } = await supabase
    .from('learning_episodes')
    .select(`
      id,
      chronicle_id,
      predicted_document_type,
      was_correct,
      prediction_method
    `)
    .eq('prediction_method', 'ai')
    .eq('was_correct', true)
    .limit(1000);

  if (!episodes || episodes.length === 0) return [];

  // Get subjects from chronicle
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chronicleIds = episodes.map((e: any) => e.chronicle_id).filter(Boolean);
  const { data: chronicles } = await supabase
    .from('chronicle')
    .select('id, subject')
    .in('id', chronicleIds);

  if (!chronicles) return [];

  // Build map of chronicle_id to subject
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const subjectMap = new Map(chronicles.map((c: any) => [c.id, c.subject]));

  // Normalize subjects and group
  const patterns = new Map<string, {
    document_type: string;
    count: number;
    correct: number;
    ids: string[];
  }>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const episode of episodes as any[]) {
    const subject = subjectMap.get(episode.chronicle_id) as string | undefined;
    if (!subject) continue;

    // Normalize subject: replace numbers with N, remove specific dates
    const normalized = normalizeSubjectToPattern(subject);

    // Skip empty patterns (too short after normalization)
    if (!normalized || normalized.length < MIN_PATTERN_LENGTH) continue;

    const key = `${normalized}|||${episode.predicted_document_type}`;

    if (!patterns.has(key)) {
      patterns.set(key, {
        document_type: episode.predicted_document_type,
        count: 0,
        correct: 0,
        ids: [],
      });
    }

    const p = patterns.get(key)!;
    p.count++;
    if (episode.was_correct) p.correct++;
    if (p.ids.length < 5) p.ids.push(episode.chronicle_id);
  }

  // Filter to candidates meeting threshold
  const candidates = Array.from(patterns.entries())
    .filter(([, p]) => p.count >= MIN_OCCURRENCES && (p.correct / p.count) >= MIN_ACCURACY)
    .map(([key, p]) => ({
      pattern_template: key.split('|||')[0],
      document_type: p.document_type,
      occurrences: p.count,
      accuracy_rate: p.correct / p.count,
      sample_ids: p.ids,
    }))
    .slice(0, MAX_PATTERNS_PER_RUN);

  return candidates;
}

/**
 * Normalize subject line to a pattern template
 * IMPROVED: Better handling of reply chains, container numbers, booking numbers
 */
function normalizeSubjectToPattern(subject: string): string {
  let normalized = subject
    // STEP 1: Aggressively remove ALL reply/forward prefixes (including nested)
    .replace(/^(?:RE:\s*|FW:\s*|Fwd:\s*)+/gi, '')

    // STEP 2: Replace container numbers (4 letters + 7 digits) with placeholder
    .replace(/\b[A-Z]{4}\d{7}\b/g, 'CONTAINER')

    // STEP 3: Replace booking/BL numbers (various formats)
    // Maersk format: 10+ digits
    .replace(/\b\d{10,}\b/g, 'BOOKING_NUM')
    // Alphanumeric booking: letters followed by digits
    .replace(/\b[A-Z]{2,4}\d{6,}\b/g, 'BOOKING_NUM')
    // Generic long numbers (6-9 digits)
    .replace(/\b\d{6,9}\b/g, 'REF_NUM')

    // STEP 4: Replace dates in various formats
    // ISO: 2024-01-15
    .replace(/\b\d{4}[-/]\d{2}[-/]\d{2}\b/g, 'DATE')
    // US/EU: 01/15/2024 or 15/01/2024
    .replace(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g, 'DATE')
    // Month names: Jan 15, 2024 or 15 Jan 2024
    .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2},?\s*\d{0,4}\b/gi, 'DATE')
    .replace(/\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?,?\s*\d{0,4}\b/gi, 'DATE')

    // STEP 5: Replace small numbers (likely not identifying)
    .replace(/\b\d{1,3}\b/g, '#')

    // STEP 6: Normalize whitespace and trim
    .replace(/\s+/g, ' ')
    .trim();

  // STEP 7: If pattern is too short after normalization, it's probably noise
  if (normalized.length < MIN_PATTERN_LENGTH) {
    return ''; // Will be filtered out
  }

  return normalized;
}

/**
 * Calculate quality score for a discovered pattern (0-100)
 * Higher = more likely to be useful
 */
function calculatePatternQuality(
  pattern: string,
  sampleCount: number,
  accuracyRate: number
): number {
  let quality = 50;

  // Base quality from accuracy (+0-30)
  quality += Math.floor(accuracyRate * 30);

  // Volume bonus (+5-15)
  if (sampleCount >= 50) quality += 15;
  else if (sampleCount >= 20) quality += 10;
  else if (sampleCount >= 10) quality += 5;

  // PENALTIES for noise indicators

  // Too short (< 15 chars)
  if (pattern.length < 15) quality -= 25;

  // Starts with placeholder (too generic)
  if (/^(BOOKING_NUM|REF_NUM|CONTAINER|DATE|#)/.test(pattern)) quality -= 20;

  // Mostly placeholders (> 50% of length)
  const withoutPlaceholders = pattern.replace(/BOOKING_NUM|REF_NUM|CONTAINER|DATE|#/g, '');
  if (withoutPlaceholders.length < pattern.length * 0.5) quality -= 30;

  // Contains only common/generic words
  if (/^(update|notification|notice|alert|reminder|information|message)\s*$/i.test(pattern)) {
    quality -= 40;
  }

  // BONUSES for good patterns

  // Contains carrier name (specific pattern)
  if (/maersk|hapag|cma|msc|evergreen|cosco|one line|yang ming|oocl|hamburg|zim/i.test(pattern)) {
    quality += 10;
  }

  // Contains document type keywords (specific pattern)
  if (/booking|confirmation|invoice|bl|waybill|vgm|si|instruction|arrival|departure/i.test(pattern)) {
    quality += 5;
  }

  // Container number placeholder present (good structure)
  if (pattern.includes('CONTAINER')) quality += 5;

  return Math.max(0, Math.min(100, quality));
}

/**
 * Get risk factors for a pattern (for UI display)
 */
function getPatternRiskFactors(pattern: string): Record<string, string> {
  const risks: Record<string, string> = {};

  if (pattern.length < 20) {
    risks.short_pattern = 'Pattern may be too generic';
  }

  if (/^(BOOKING_NUM|REF_NUM|CONTAINER|DATE)/.test(pattern)) {
    risks.starts_with_placeholder = 'Pattern starts with variable part';
  }

  const withoutPlaceholders = pattern.replace(/BOOKING_NUM|REF_NUM|CONTAINER|DATE|#/g, '');
  if (withoutPlaceholders.length < pattern.length * 0.5) {
    risks.mostly_placeholders = 'Pattern is mostly variable content';
  }

  if (!/maersk|hapag|cma|msc|evergreen|cosco|booking|confirmation|invoice|bl|vgm/i.test(pattern)) {
    risks.no_specific_keywords = 'No carrier or document keywords found';
  }

  return risks;
}

export const runtime = 'nodejs';
export const maxDuration = 60;
