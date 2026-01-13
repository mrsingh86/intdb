/**
 * Attention Score Calculator
 *
 * Higher score = needs more attention = appears higher in list.
 *
 * Philosophy: "Calm by default, clear when needed"
 * - Issues and overdue items get highest scores
 * - Upcoming deadlines increase urgency
 * - Stale shipments with no activity decrease in priority
 */

import type { AttentionComponents, SignalTier } from './types';
import { SCORE_WEIGHTS, getSignalTier } from './constants';

/**
 * Calculate attention score from shipment components.
 *
 * Score breakdown:
 * - Active issue: +100 base, +50 for delay type
 * - Pending actions: +10 each
 * - Overdue actions: +40 each
 * - Critical priority action: +80
 * - ETD within 7 days: +25, within 3 days: +50, within 1 day: +75
 * - Cutoff overdue: +100, within 1 day: +60, within 3 days: +30
 * - Stale (>3 days no activity): -20, (>7 days): -40
 */
export function calculateAttentionScore(components: AttentionComponents): number {
  let score = 0;

  // Issue scoring (highest priority)
  if (components.hasActiveIssue) {
    score += SCORE_WEIGHTS.ACTIVE_ISSUE;

    // Add severity bonus for specific issue types
    for (const issueType of components.issueTypes) {
      const type = issueType?.toLowerCase();
      if (type === 'delay') score += SCORE_WEIGHTS.ISSUE_DELAY;
      else if (type === 'rollover') score += SCORE_WEIGHTS.ISSUE_ROLLOVER;
      else if (type === 'hold') score += SCORE_WEIGHTS.ISSUE_HOLD;
      else if (type === 'documentation') score += SCORE_WEIGHTS.ISSUE_DOCUMENTATION;
      else if (type === 'customs') score += SCORE_WEIGHTS.ISSUE_CUSTOMS;
      else if (type === 'damage') score += SCORE_WEIGHTS.ISSUE_DAMAGE;
    }
  }

  // Action scoring
  score += components.pendingActions * SCORE_WEIGHTS.PENDING_ACTION;
  score += components.overdueActions * SCORE_WEIGHTS.OVERDUE_ACTION;

  // Action priority bonus
  switch (components.maxActionPriority) {
    case 'critical':
      score += SCORE_WEIGHTS.ACTION_PRIORITY_CRITICAL;
      break;
    case 'high':
      score += SCORE_WEIGHTS.ACTION_PRIORITY_HIGH;
      break;
    case 'medium':
      score += SCORE_WEIGHTS.ACTION_PRIORITY_MEDIUM;
      break;
    case 'low':
      score += SCORE_WEIGHTS.ACTION_PRIORITY_LOW;
      break;
  }

  // ETD urgency (only if ETD is in the future)
  if (components.daysToEtd !== null && components.daysToEtd >= 0) {
    if (components.daysToEtd <= 1) {
      score += SCORE_WEIGHTS.ETD_WITHIN_1_DAY;
    } else if (components.daysToEtd <= 3) {
      score += SCORE_WEIGHTS.ETD_WITHIN_3_DAYS;
    } else if (components.daysToEtd <= 7) {
      score += SCORE_WEIGHTS.ETD_WITHIN_7_DAYS;
    }
  }

  // Cutoff urgency
  switch (components.cutoffStatus) {
    case 'overdue':
      score += SCORE_WEIGHTS.CUTOFF_OVERDUE;
      break;
    case 'urgent':
      score += SCORE_WEIGHTS.CUTOFF_WITHIN_1_DAY;
      break;
    case 'warning':
      score += SCORE_WEIGHTS.CUTOFF_WITHIN_3_DAYS;
      break;
  }

  // Activity decay (penalize stale shipments)
  if (components.daysSinceActivity > 7) {
    score += SCORE_WEIGHTS.STALE_7_DAYS;
  } else if (components.daysSinceActivity > 3) {
    score += SCORE_WEIGHTS.STALE_3_DAYS;
  }

  // Ensure score doesn't go negative
  return Math.max(0, score);
}

/**
 * Calculate attention score and return with tier classification.
 */
export function calculateAttentionWithTier(components: AttentionComponents): {
  score: number;
  tier: SignalTier;
} {
  const score = calculateAttentionScore(components);
  return {
    score,
    tier: getSignalTier(score),
  };
}

/**
 * Determine cutoff status based on days remaining.
 */
export function getCutoffStatus(
  daysRemaining: number | null
): 'safe' | 'warning' | 'urgent' | 'overdue' | null {
  if (daysRemaining === null) return null;
  if (daysRemaining < 0) return 'overdue';
  if (daysRemaining <= 1) return 'urgent';
  if (daysRemaining <= 3) return 'warning';
  return 'safe';
}

/**
 * Find the nearest cutoff from multiple dates.
 */
export function findNearestCutoff(
  cutoffs: { type: string; date: string | null }[]
): { type: string; date: string; daysRemaining: number } | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let nearest: { type: string; date: string; daysRemaining: number } | null = null;

  for (const cutoff of cutoffs) {
    if (!cutoff.date) continue;

    const cutoffDate = new Date(cutoff.date);
    cutoffDate.setHours(0, 0, 0, 0);

    const daysRemaining = Math.ceil((cutoffDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    // Only consider future or today cutoffs, or overdue ones
    if (!nearest || daysRemaining < nearest.daysRemaining) {
      nearest = {
        type: cutoff.type,
        date: cutoff.date,
        daysRemaining,
      };
    }
  }

  return nearest;
}

/**
 * Calculate days between two dates (negative if in past).
 */
export function daysBetween(fromDate: Date, toDate: Date | string | null): number | null {
  if (!toDate) return null;

  const from = new Date(fromDate);
  from.setHours(0, 0, 0, 0);

  const to = new Date(toDate);
  to.setHours(0, 0, 0, 0);

  return Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Build attention components from raw shipment data.
 * This is the bridge between database fields and the scoring algorithm.
 */
export function buildAttentionComponents(data: {
  issueCount: number;
  issueTypes: string[] | null;
  pendingActions: number;
  overdueActions: number;
  maxPriority: string | null;
  lastActivity: string | null;
  etd: string | null;
  siCutoff: string | null;
  vgmCutoff: string | null;
  cargoCutoff: string | null;
}): AttentionComponents {
  const today = new Date();

  // Calculate days since last activity
  const daysSinceActivity = data.lastActivity
    ? Math.max(0, daysBetween(new Date(data.lastActivity), today) || 0)
    : 999;

  // Calculate days to ETD
  const daysToEtd = data.etd ? daysBetween(today, data.etd) : null;

  // Find nearest cutoff and determine status
  const cutoffs = [
    { type: 'si', date: data.siCutoff },
    { type: 'vgm', date: data.vgmCutoff },
    { type: 'cargo', date: data.cargoCutoff },
  ];

  const nearestCutoff = findNearestCutoff(cutoffs);
  const cutoffStatus = nearestCutoff ? getCutoffStatus(nearestCutoff.daysRemaining) : null;

  return {
    hasActiveIssue: data.issueCount > 0,
    issueTypes: data.issueTypes || [],
    pendingActions: data.pendingActions,
    overdueActions: data.overdueActions,
    maxActionPriority: (data.maxPriority as AttentionComponents['maxActionPriority']) || null,
    daysSinceActivity,
    daysToEtd,
    cutoffStatus,
    nearestCutoffDays: nearestCutoff?.daysRemaining ?? null,
  };
}
