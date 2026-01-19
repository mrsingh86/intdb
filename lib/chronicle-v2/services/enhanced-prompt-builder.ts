/**
 * EnhancedPromptBuilder
 *
 * Builds the PRE-COMPUTED DATA section for AI prompts.
 * This module provides the anti-hallucination data layer.
 *
 * Key principle: AI reads these values as FACTS, not suggestions.
 * The prompt explicitly tells AI: "Use these values EXACTLY - do not recalculate."
 */

import {
  ShipmentIntelligence,
  RootCause,
  ResolutionBenchmark,
  CustomerDraftContext,
  DelayBreakdown,
} from './shipment-intelligence-service';

// ============================================================================
// ENHANCED SYSTEM PROMPT ADDITIONS
// ============================================================================

export const ENHANCED_SYSTEM_PROMPT_ADDITIONS = `

## CRITICAL: PRE-COMPUTED DATA (ANTI-HALLUCINATION RULES)

The prompt will include a "PRE-COMPUTED FACTS" section with values calculated by the system.
These are EXACT values from the database - you MUST use them as-is:

1. **SLA Status**: Use the provided hours_since_customer_update and sla_status EXACTLY
   - Do NOT say "approximately" or recalculate
   - Example: If it says "72 hours since update", say "72 hours" not "about 3 days"

2. **Escalation Level**: Use the provided L1/L2/L3 and escalate_to EXACTLY
   - Do NOT upgrade or downgrade based on your judgment
   - The rules engine already applied the correct logic

3. **Root Cause**: Use the provided category and subcategory if available
   - Example: If root_cause is "LOGISTICS/chassis_shortage", use that classification
   - Do NOT reclassify based on blocker description

4. **Benchmarks**: Reference the exact numbers provided
   - Example: "Similar issues resolved in avg 4.2 days (based on 36 cases)"
   - Do NOT round or estimate

5. **Financial Exposure**: Use the pre-calculated estimated_exposure_usd
   - Do NOT recalculate days × rate

## ENHANCED OUTPUT FORMAT

In addition to existing fields, include:

{
  // ... existing fields ...

  // P0: SLA (use pre-computed values)
  "slaStatus": "BREACHED|CRITICAL|AT_RISK|OK|NO_CONTACT",
  "hoursSinceCustomerUpdate": number,
  "slaSummary": "Customer waiting 72 hours for update - SLA breached",

  // P1: Escalation (use pre-computed values)
  "escalationLevel": "L1|L2|L3",
  "escalateTo": "Operations Team|Operations Manager|Leadership",
  "escalationReason": "Copy from pre-computed data",

  // P2: Root Cause (use pre-computed values)
  "rootCauseCategory": "CARRIER|PORT|CUSTOMS|CUSTOMER|LOGISTICS|INTOGLO|null",
  "rootCauseSubcategory": "e.g., chassis_shortage",
  "typicalResolutionDays": number or null,

  // P2: Benchmark reference (use pre-computed values)
  "benchmarkReference": "Similar issues: 4.2 days avg (36 cases)",

  // P0: Customer Draft (AI generates based on facts)
  "customerDraftSubject": "Update: Your Shipment [REF] - Status Update",
  "customerDraftBody": "Dear [Customer],\\n\\nWe wanted to update you on...",

  // P3: Confidence (AI self-assessment based on data completeness)
  "recommendationConfidence": "high|medium|low",
  "confidenceReason": "Based on data completeness score: 85/100"
}

## CUSTOMER DRAFT GUIDELINES

When generating customerDraftBody:
1. Use ONLY facts from the pre-computed data
2. Be professional and empathetic
3. Include:
   - Current status
   - Reason for delay (from root cause)
   - Expected resolution timeframe (from benchmark)
   - Next steps
   - Contact information if available
4. Do NOT promise specific dates unless explicitly provided
5. Do NOT blame any party
`;

// ============================================================================
// PROMPT SECTION BUILDERS
// ============================================================================

/**
 * Build the delay breakdown section for the prompt.
 * P4: Stage-aware delay calculation with appropriate reference dates.
 */
export function buildDelayBreakdownSection(delay: DelayBreakdown, stage: string | null): string {
  const parts: string[] = [];

  parts.push(`
### DELAY BREAKDOWN (Categorized by Stage)
- Delay Category: ${delay.delayCategory}
- Primary Delay Type: ${delay.primaryDelayType}
- Primary Delay: ${delay.primaryDelayDays} days
- Summary: ${delay.delaySummary}`);

  // Show cutoffs for pre-departure stages
  if (delay.delayCategory === 'PRE_DEPARTURE') {
    const cutoffLines: string[] = [];
    if (delay.cutoffs.siCutoff) {
      cutoffLines.push(`  - SI Cutoff: ${delay.cutoffs.siCutoff} [${delay.cutoffs.siStatus}]${delay.cutoffs.siDelayDays > 0 ? ` (${delay.cutoffs.siDelayDays} days overdue)` : ''}`);
    }
    if (delay.cutoffs.vgmCutoff) {
      cutoffLines.push(`  - VGM Cutoff: ${delay.cutoffs.vgmCutoff} [${delay.cutoffs.vgmStatus}]${delay.cutoffs.vgmDelayDays > 0 ? ` (${delay.cutoffs.vgmDelayDays} days overdue)` : ''}`);
    }
    if (delay.cutoffs.docCutoff) {
      cutoffLines.push(`  - Doc Cutoff: ${delay.cutoffs.docCutoff} [${delay.cutoffs.docStatus}]${delay.cutoffs.docDelayDays > 0 ? ` (${delay.cutoffs.docDelayDays} days overdue)` : ''}`);
    }
    if (delay.cutoffs.cargoCutoff) {
      cutoffLines.push(`  - Cargo Cutoff: ${delay.cutoffs.cargoCutoff} [${delay.cutoffs.cargoStatus}]${delay.cutoffs.cargoDelayDays > 0 ? ` (${delay.cutoffs.cargoDelayDays} days overdue)` : ''}`);
    }
    if (cutoffLines.length > 0) {
      parts.push(`
Cutoff Status:
${cutoffLines.join('\n')}`);
    }
  }

  // Show ETD for departure stages
  if (delay.delayCategory === 'DEPARTURE' && delay.etd) {
    parts.push(`
Departure Status:
  - ETD: ${delay.etd} (source: ${delay.etdSource || 'unknown'})
  - Departure Delay: ${delay.departureDelayDays > 0 ? `${delay.departureDelayDays} days past ETD` : 'On track'}`);
  }

  // Show ETA for transit/arrival stages
  if ((delay.delayCategory === 'TRANSIT' || delay.delayCategory === 'DELIVERY') && delay.eta) {
    parts.push(`
Arrival Status:
  - ETA: ${delay.eta} (source: ${delay.etaSource || 'unknown'})
  - Arrival Delay: ${delay.arrivalDelayDays > 0 ? `${delay.arrivalDelayDays} days past ETA` : 'On track'}`);
  }

  // Show delivery info for arrived shipments
  if (delay.delayCategory === 'DELIVERY') {
    if (delay.lastFreeDay) {
      parts.push(`
Delivery Status:
  - Last Free Day: ${delay.lastFreeDay}
  - Delivery Delay: ${delay.deliveryDelayDays > 0 ? `${delay.deliveryDelayDays} days past free time` : 'Within free time'}`);
    } else {
      parts.push(`
Delivery Status:
  - Delivery Delay: ${delay.deliveryDelayDays > 0 ? `${delay.deliveryDelayDays} days since arrival` : 'Awaiting delivery'}`);
    }
  }

  return parts.join('\n');
}

/**
 * Build the PRE-COMPUTED FACTS section for the prompt.
 * This section tells AI what values to use without recalculating.
 */
export function buildPreComputedSection(intel: ShipmentIntelligence): string {
  const parts: string[] = [];

  parts.push(`
## PRE-COMPUTED FACTS (Use these EXACTLY - do not recalculate)

### SLA STATUS
- Status: ${intel.sla.slaStatus}
- Hours since last customer update: ${intel.sla.hoursSinceCustomerUpdate ?? 'N/A (no outbound contact)'}
- Hours awaiting response: ${intel.sla.hoursAwaitingResponse ?? 'N/A'}
- Response pending from Intoglo: ${intel.sla.responsePending ? 'YES - customer waiting' : 'No'}
- Unanswered customer emails: ${intel.sla.unansweredCustomerEmails}
- Next SLA deadline: ${intel.sla.nextSlaDeadline ? new Date(intel.sla.nextSlaDeadline).toLocaleString() : 'N/A'}`);

  parts.push(`
### ESCALATION LEVEL
- Level: ${intel.escalation.escalationLevel}
- Escalate to: ${intel.escalation.escalateTo}
- Reason: ${intel.escalation.escalationReason}
- Days overdue: ${intel.escalation.daysOverdue ?? 'Not overdue'}
- Estimated exposure: $${intel.escalation.estimatedExposureUsd.toLocaleString()}
- Escalation count: ${intel.escalation.escalationCount}
- Open issues: ${intel.escalation.issueCount}
- Urgent messages: ${intel.escalation.urgentMessageCount}
- Priority score: ${intel.escalation.priorityScore}`);

  // P4: Delay Breakdown
  if (intel.delayBreakdown) {
    parts.push(buildDelayBreakdownSection(intel.delayBreakdown, intel.stage));
  }

  if (intel.rootCause) {
    parts.push(`
### ROOT CAUSE CLASSIFICATION
- Category: ${intel.rootCause.category}
- Subcategory: ${intel.rootCause.subcategory}
- Typical resolution: ${intel.rootCause.typicalResolutionDays ?? 'Unknown'} days
- Resolution owner: ${intel.rootCause.resolutionOwner}
- Requires customer action: ${intel.rootCause.requiresCustomerAction ? 'YES' : 'No'}
- Match confidence: ${intel.rootCause.matchConfidence}`);
  }

  if (intel.benchmarks.length > 0) {
    const benchmarkLines = intel.benchmarks.slice(0, 3).map(b =>
      `- ${b.benchmarkSource}: ${b.avgDays} days avg (${b.sampleSize} cases, ${b.confidence} confidence)`
    ).join('\n');
    parts.push(`
### RESOLUTION BENCHMARKS (Similar cases)
${benchmarkLines}`);
  }

  parts.push(`
### DATA QUALITY
- Data completeness score: ${intel.dataCompletenessScore}/100
- Recommendation confidence: ${intel.dataCompletenessScore >= 80 ? 'high' : intel.dataCompletenessScore >= 50 ? 'medium' : 'low'}

IMPORTANT: Use the values above EXACTLY in your output. Do not recalculate or estimate.`);

  return parts.join('\n');
}

/**
 * Build customer draft context section.
 */
export function buildCustomerDraftSection(context: CustomerDraftContext): string {
  return `
## CUSTOMER DRAFT CONTEXT (Generate email using these facts)

- Shipment Reference: ${context.shipmentReference}
- Customer Name: ${context.customerName}
- Current Status: ${context.currentStatus}
- Delay Reason: ${context.delayReason || 'Under investigation'}
- Days Overdue: ${context.daysOverdue ?? 'Not overdue'}
- Estimated Exposure: ${context.estimatedExposure ? '$' + context.estimatedExposure.toLocaleString() : 'N/A'}
- Customer Email: ${context.contactEmail || 'Not available'}

Generate a professional customer update email using ONLY these facts.
Do NOT invent additional details or make promises not supported by data.`;
}

// ============================================================================
// OUTPUT VALIDATION
// ============================================================================

/**
 * Validate and correct AI output against pre-computed values.
 * This is the POST-VALIDATION layer - ensures AI didn't hallucinate.
 */
export function validateAgainstPreComputed(
  aiOutput: any,
  intel: ShipmentIntelligence
): any {
  const corrected = { ...aiOutput };

  // Correct SLA values if AI deviated
  if (intel.sla.slaStatus !== 'NO_CONTACT') {
    corrected.slaStatus = intel.sla.slaStatus;
    corrected.hoursSinceCustomerUpdate = intel.sla.hoursSinceCustomerUpdate;
  }

  // Correct escalation level if AI deviated
  corrected.escalationLevel = intel.escalation.escalationLevel;
  corrected.escalateTo = intel.escalation.escalateTo;
  corrected.escalationReason = intel.escalation.escalationReason;

  // Correct root cause if available and AI deviated
  if (intel.rootCause) {
    corrected.rootCauseCategory = intel.rootCause.category;
    corrected.rootCauseSubcategory = intel.rootCause.subcategory;
    corrected.typicalResolutionDays = intel.rootCause.typicalResolutionDays;
  }

  // Correct financial exposure
  if (intel.escalation.estimatedExposureUsd > 0) {
    // Ensure AI's financial impact includes the pre-computed exposure
    const exposure = intel.escalation.estimatedExposureUsd;
    if (!corrected.estimatedDetention?.includes(String(exposure))) {
      corrected.estimatedDetention = `${intel.escalation.daysOverdue} days × $150/day = $${exposure} detention`;
    }
  }

  // Set confidence based on data completeness
  corrected.recommendationConfidence =
    intel.dataCompletenessScore >= 80 ? 'high' :
    intel.dataCompletenessScore >= 50 ? 'medium' : 'low';

  // Add benchmark reference if available
  if (intel.benchmarks.length > 0) {
    const best = intel.benchmarks[0];
    corrected.benchmarkReference = `Similar issues: ${best.avgDays} days avg (${best.sampleSize} cases)`;
  }

  return corrected;
}

// ============================================================================
// CUSTOMER DRAFT TEMPLATES
// ============================================================================

export const CUSTOMER_DRAFT_TEMPLATES = {
  delay_update: {
    subject: 'Update: Your Shipment {reference} - Delivery Status',
    opening: 'We wanted to provide you with an update on your shipment.',
    delay_reasons: {
      'CARRIER': 'due to carrier scheduling adjustments',
      'PORT': 'due to port congestion',
      'CUSTOMS': 'pending customs clearance',
      'CUSTOMER': 'awaiting required documentation',
      'LOGISTICS': 'due to local logistics constraints',
      'INTOGLO': 'as we coordinate final arrangements',
    },
  },

  escalation_acknowledgment: {
    subject: 'Priority Update: Your Shipment {reference}',
    opening: 'We understand the urgency of your shipment and have escalated this matter.',
  },

  resolution_update: {
    subject: 'Good News: Your Shipment {reference} - Issue Resolved',
    opening: 'We are pleased to inform you that the issue affecting your shipment has been resolved.',
  },
};

/**
 * Generate a customer draft using templates and context.
 * AI can refine this, but structure comes from templates.
 */
export function generateCustomerDraftPrompt(
  context: CustomerDraftContext,
  escalationLevel: string
): string {
  const template = escalationLevel === 'L3'
    ? CUSTOMER_DRAFT_TEMPLATES.escalation_acknowledgment
    : CUSTOMER_DRAFT_TEMPLATES.delay_update;

  return `
Generate a professional customer email:

TEMPLATE:
Subject: ${template.subject.replace('{reference}', context.shipmentReference)}
Opening: ${template.opening}

FACTS TO INCLUDE:
- Shipment: ${context.shipmentReference}
- Status: ${context.currentStatus}
- Delay Reason: ${context.delayReason || 'Under investigation'}
${context.daysOverdue ? `- Delay Duration: ${context.daysOverdue} days` : ''}

TONE: Professional, empathetic, solution-focused
LENGTH: 3-4 sentences
DO NOT: Make promises about specific dates, blame any party, use jargon`;
}
