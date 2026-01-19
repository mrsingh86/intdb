/**
 * Run AI Summaries for Dashboard Shipments
 *
 * Generates intelligent summaries using Haiku with cross-shipment intelligence:
 * - Shipper behavior patterns
 * - Consignee risk profiles
 * - Carrier performance metrics
 * - Route intelligence
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);
const anthropic = new Anthropic();

// Parse command line args for parallel execution
const args = process.argv.slice(2);
const offsetArg = args.find(a => a.startsWith('--offset='));
const batchArg = args.find(a => a.startsWith('--batch='));
const OFFSET = offsetArg ? parseInt(offsetArg.split('=')[1]) : 0;
const MAX_SHIPMENTS = batchArg ? parseInt(batchArg.split('=')[1]) : 500;

// ============================================================================
// ZOD SCHEMA FOR AI OUTPUT VALIDATION
// ============================================================================

const AISummarySchema = z.object({
  narrative: z.string().min(20, 'Narrative too short').max(500, 'Narrative too long'),
  owner: z.string().min(1, 'Owner required'),
  ownerType: z.enum(['shipper', 'consignee', 'carrier', 'intoglo']),
  riskLevel: z.enum(['red', 'amber', 'green']),
  keyDeadline: z.string().optional().nullable(),
  keyInsight: z.string().optional().nullable(),
});

type AISummary = z.infer<typeof AISummarySchema>;

// ============================================================================
// DATE VALIDATION HELPERS
// ============================================================================

function computeDateUrgency(dateStr: string | null, label: string): { display: string; isPast: boolean; daysFromNow: number | null } {
  if (!dateStr) return { display: 'N/A', isPast: false, daysFromNow: null };

  const date = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  date.setHours(0, 0, 0, 0);

  const diffDays = Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const formatted = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  if (diffDays < -365) {
    // Date is more than a year in the past - likely bad data
    return { display: `${formatted} ⚠️ DATA ISSUE: ${Math.abs(diffDays)} days ago`, isPast: true, daysFromNow: diffDays };
  }
  if (diffDays < 0) {
    return { display: `${formatted} (${Math.abs(diffDays)}d ago)`, isPast: true, daysFromNow: diffDays };
  }
  if (diffDays === 0) {
    return { display: `${formatted} (TODAY)`, isPast: false, daysFromNow: 0 };
  }
  if (diffDays <= 3) {
    return { display: `${formatted} (${diffDays}d) ⚠️ URGENT`, isPast: false, daysFromNow: diffDays };
  }
  if (diffDays <= 7) {
    return { display: `${formatted} (${diffDays}d)`, isPast: false, daysFromNow: diffDays };
  }
  return { display: formatted, isPast: false, daysFromNow: diffDays };
}

function isValidProfileValue(value: any, minReasonable: number, maxReasonable: number): boolean {
  if (value === null || value === undefined) return false;
  const num = parseFloat(value);
  return !isNaN(num) && num >= minReasonable && num <= maxReasonable;
}

interface ShipmentContext {
  id: string;
  booking_number: string | null;
  mbl_number: string | null;
  port_of_loading_code: string | null;
  port_of_discharge_code: string | null;
  vessel_name: string | null;
  carrier_name: string | null;
  etd: string | null;
  eta: string | null;
  si_cutoff: string | null;
  vgm_cutoff: string | null;
  stage: string | null;
  shipper_name: string | null;
  consignee_name: string | null;
}

// ============================================================================
// PROFILE FETCHING
// ============================================================================

async function getShipperProfile(shipperName: string | null) {
  if (!shipperName) return null;
  const searchWord = shipperName.toLowerCase().split(' ').filter(w => w.length > 2)[0];
  if (!searchWord) return null;

  const { data } = await supabase
    .from('shipper_profiles')
    .select('*')
    .ilike('shipper_name_normalized', `%${searchWord}%`)
    .order('total_shipments', { ascending: false })
    .limit(1);

  return data?.[0] || null;
}

async function getConsigneeProfile(consigneeName: string | null) {
  if (!consigneeName) return null;
  const searchWord = consigneeName.toLowerCase().split(' ').filter(w => w.length > 2)[0];
  if (!searchWord) return null;

  const { data } = await supabase
    .from('consignee_profiles')
    .select('*')
    .ilike('consignee_name_normalized', `%${searchWord}%`)
    .order('total_shipments', { ascending: false })
    .limit(1);

  return data?.[0] || null;
}

async function getCarrierProfile(carrierName: string | null) {
  if (!carrierName) return null;
  const searchWord = carrierName.toLowerCase().split(' ').filter(w => w.length > 2)[0];
  if (!searchWord) return null;

  const { data } = await supabase
    .from('carrier_profiles')
    .select('*')
    .ilike('carrier_name_normalized', `%${searchWord}%`)
    .order('total_shipments', { ascending: false })
    .limit(1);

  return data?.[0] || null;
}

// ============================================================================
// AI SUMMARY GENERATION
// ============================================================================

const SYSTEM_PROMPT = `You are a freight operations analyst at Intoglo. Generate ONE tight paragraph per shipment.

## THE FORMULA (STRICT)
[Situation - what's happening now]. [Intelligence insight with numbers]. [Action + exact deadline].

## RULES
1. ONE paragraph only - no repetition, every word earns its place
2. USE EXACT DATES - "Jan 13" not "in a few days"
3. WEAVE intelligence into the narrative - don't list separately
4. Include TIMING insights - "typically submits 2.8 days before cutoff"
5. Flag DEVIATIONS - "unusual for Maersk (normally 1% rollover)"
6. Add RELATIONSHIP context - "across 47 shipments" or "first shipment, no history"
7. If ETD/ETA is in the PAST compared to Today's date, flag as "ETD passed - confirm current status"
8. If data looks wrong (negative days, impossible dates), note it as "data quality issue"

## EXAMPLES

Good: "SI pending for Jan 14 ETD. Idea Fasteners submits late 47% of the time (typically 2.8 days before cutoff across 47 shipments) - escalate today, don't wait until Jan 11."

Good: "Container at Savannah since Jan 6. Solo World has 15% detention history across 20 shipments - call for pickup ETA today, LFD Jan 10."

Good: "Loading delayed at Mundra since Dec 8. Unusual for Maersk (normally 1% rollover across 328 shipments) - escalate to carrier immediately."

Good: "First shipment with this consignee - no detention history available. Container arrived Jan 6, proactively confirm pickup to avoid surprises."

Bad (repetitive): "Container pickup pending. Consignee has detention history. Arrange pickup to avoid detention." ❌

## OUTPUT FORMAT (strict JSON)
{
  "narrative": "Single paragraph following the formula above",
  "owner": "Exact party name who needs to act (e.g., 'Idea Fasteners' or 'Intoglo')",
  "ownerType": "shipper|consignee|carrier|intoglo",
  "riskLevel": "red|amber|green",
  "keyDeadline": "The critical date (e.g., 'Jan 14 ETD' or 'Jan 10 LFD')",
  "keyInsight": "Single most important intelligence (e.g., '47% SI late rate' or '15% detention history')"
}

Return ONLY valid JSON.`;

async function generateSummary(shipment: ShipmentContext, chronicles: any[], profiles: any) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  // Compute date urgency with validation
  const etdUrgency = computeDateUrgency(shipment.etd, 'ETD');
  const etaUrgency = computeDateUrgency(shipment.eta, 'ETA');
  const siCutoffUrgency = computeDateUrgency(shipment.si_cutoff, 'SI Cutoff');
  const vgmCutoffUrgency = computeDateUrgency(shipment.vgm_cutoff, 'VGM Cutoff');

  // Build prompt with validated dates
  let prompt = `## SHIPMENT CONTEXT
Today: ${today}
Booking: ${shipment.booking_number || 'N/A'}
Route: ${shipment.port_of_loading_code || '?'} → ${shipment.port_of_discharge_code || '?'}
Carrier: ${shipment.carrier_name || 'N/A'}
Stage: ${shipment.stage || 'PENDING'}
Shipper: ${shipment.shipper_name || 'N/A'}
Consignee: ${shipment.consignee_name || 'N/A'}

## CRITICAL DATES (with urgency - TODAY is ${today})
ETD: ${etdUrgency.display}${etdUrgency.isPast ? ' ⚠️ PAST DATE' : ''}
ETA: ${etaUrgency.display}${etaUrgency.isPast ? ' ⚠️ PAST DATE' : ''}
SI Cutoff: ${siCutoffUrgency.display}${siCutoffUrgency.isPast ? ' ⚠️ OVERDUE' : ''}
VGM Cutoff: ${vgmCutoffUrgency.display}${vgmCutoffUrgency.isPast ? ' ⚠️ OVERDUE' : ''}`;

  // Add intelligence sections - Include timing patterns, relationship depth, and deviation context
  if (profiles.shipper) {
    const p = profiles.shipper;
    const shipments = p.total_shipments || 0;
    const relationshipDepth = shipments >= 20 ? 'strong history' : shipments >= 5 ? 'moderate history' : 'limited history';

    let intel = `SHIPPER: ${p.shipper_name} (${shipments} shipments - ${relationshipDepth})\n`;

    if (shipments <= 2) {
      intel += `⚠️ NEW RELATIONSHIP - First/second shipment, no reliable pattern yet\n`;
    } else {
      // SI late rate with actionable context (validate: 0-100%)
      if (isValidProfileValue(p.si_late_rate, 0, 100)) {
        const rate = parseFloat(p.si_late_rate);
        intel += `SI Late Rate: ${rate.toFixed(0)}% across ${shipments} shipments\n`;
        if (rate > 30) intel += `→ HIGH RISK: Follow up early, don't wait for cutoff\n`;
      }

      // Timing pattern - CRITICAL for action planning (validate: 0-30 days is reasonable)
      if (isValidProfileValue(p.avg_si_days_before_cutoff, 0, 30)) {
        const avgDays = parseFloat(p.avg_si_days_before_cutoff);
        intel += `Typical SI timing: ${avgDays.toFixed(1)} days before cutoff\n`;
        if (avgDays <= 2) intel += `→ LAST-MINUTE PATTERN: Expect submission very close to deadline\n`;
        else if (avgDays <= 4) intel += `→ Moderate buffer - follow up 5 days before cutoff\n`;
      }
    }
    prompt += `\n\n## ${intel}`;
  }

  if (profiles.consignee) {
    const p = profiles.consignee;
    const shipments = p.total_shipments || 0;
    const relationshipDepth = shipments >= 20 ? 'strong history' : shipments >= 5 ? 'moderate history' : 'limited history';

    let intel = `CONSIGNEE: ${p.consignee_name} (${shipments} shipments - ${relationshipDepth})\n`;

    if (shipments <= 2) {
      intel += `⚠️ NEW RELATIONSHIP - No detention/demurrage history available\n`;
      intel += `→ Proactively confirm pickup arrangements\n`;
    } else {
      // Detention with actionable context (validate: 0-100%)
      if (isValidProfileValue(p.detention_rate, 0, 100)) {
        const rate = parseFloat(p.detention_rate);
        intel += `Detention Rate: ${rate.toFixed(0)}% across ${shipments} shipments\n`;
        if (rate > 15) intel += `→ HIGH DETENTION RISK: Push for early pickup commitment\n`;
        else if (rate > 5) intel += `→ Moderate risk - monitor pickup timing\n`;
        else intel += `→ Good track record on pickups\n`;
      }

      // Demurrage (validate: 0-100%)
      if (isValidProfileValue(p.demurrage_rate, 0, 100) && parseFloat(p.demurrage_rate) > 10) {
        intel += `Demurrage Rate: ${parseFloat(p.demurrage_rate).toFixed(0)}% - customs clearance delays common\n`;
      }
    }
    prompt += `\n\n## ${intel}`;
  }

  if (profiles.carrier) {
    const p = profiles.carrier;
    const shipments = p.total_shipments || 0;

    let intel = `CARRIER: ${p.carrier_name} (${shipments} shipments with Intoglo)\n`;

    // Rollover rate with deviation context (validate: 0-100%)
    if (isValidProfileValue(p.rollover_rate, 0, 100)) {
      const rate = parseFloat(p.rollover_rate);
      intel += `Rollover Rate: ${rate.toFixed(1)}%\n`;
      if (rate <= 2) {
        intel += `→ RELIABLE CARRIER: If issues occur, flag as UNUSUAL - escalate quickly\n`;
      } else if (rate <= 5) {
        intel += `→ Generally reliable, minor rollover risk\n`;
      } else if (rate <= 10) {
        intel += `→ Moderate rollover risk - submit docs early\n`;
      } else {
        intel += `→ HIGH ROLLOVER RISK: Prioritize early document submission\n`;
      }
    }

    // Performance context (validate: 0-100)
    if (isValidProfileValue(p.performance_score, 0, 100)) {
      const score = parseFloat(p.performance_score);
      if (score >= 70) intel += `Performance Score: ${score.toFixed(0)}/100 (good)\n`;
      else if (score < 50) intel += `Performance Score: ${score.toFixed(0)}/100 (below average - expect issues)\n`;
    }
    prompt += `\n\n## ${intel}`;
  }

  // Add deviation detection hint if carrier is reliable but shipment has issues
  const hasIssues = chronicles.some(c => c.has_issue);
  if (profiles.carrier && isValidProfileValue(profiles.carrier.rollover_rate, 0, 5) && hasIssues) {
    const rate = parseFloat(profiles.carrier.rollover_rate);
    prompt += `\n\n## ⚠️ DEVIATION ALERT: This shipment has issues but ${profiles.carrier.carrier_name} is normally very reliable (${rate.toFixed(1)}% rollover). Flag this as unusual and escalate.`;
  }

  // Add data quality warnings if dates look wrong
  const dataIssues: string[] = [];
  if (etdUrgency.daysFromNow !== null && etdUrgency.daysFromNow < -365) {
    dataIssues.push(`ETD ${shipment.etd} is over a year in the past - likely data error`);
  }
  if (etaUrgency.daysFromNow !== null && etaUrgency.daysFromNow < -365) {
    dataIssues.push(`ETA ${shipment.eta} is over a year in the past - likely data error`);
  }
  if (dataIssues.length > 0) {
    prompt += `\n\n## ⚠️ DATA QUALITY ISSUES\n${dataIssues.join('\n')}\nMention these issues in your narrative.`;
  }

  // Add recent activity with full context
  if (chronicles.length > 0) {
    const recent = chronicles.slice(0, 12).map(c => {
      const date = new Date(c.occurred_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      const issue = c.has_issue ? ` [ISSUE: ${c.issue_type}${c.issue_description ? ' - ' + c.issue_description.slice(0, 50) : ''}]` : '';
      const action = c.has_action && !c.action_completed_at ? ` [PENDING ACTION: ${c.action_description?.slice(0, 50)}]` : '';
      const summary = c.summary || c.document_type;
      return `${date}: ${summary.slice(0, 100)}${issue}${action}`;
    }).join('\n');
    prompt += `\n\n## RECENT ACTIVITY (read carefully for context)\n${recent}`;
  }

  // Add open issues summary
  const openIssues = chronicles.filter(c => c.has_issue);
  if (openIssues.length > 0) {
    prompt += `\n\n## OPEN ISSUES (${openIssues.length})`;
    openIssues.slice(0, 5).forEach(c => {
      const date = new Date(c.occurred_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      prompt += `\n- ${date}: ${c.issue_type}${c.issue_description ? ': ' + c.issue_description.slice(0, 80) : ''}`;
    });
  }

  // Add pending actions
  const pendingActions = chronicles.filter(c => c.has_action && !c.action_completed_at);
  if (pendingActions.length > 0) {
    prompt += `\n\n## PENDING ACTIONS (${pendingActions.length})`;
    pendingActions.slice(0, 5).forEach(c => {
      const deadline = c.action_deadline ? new Date(c.action_deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'no deadline';
      prompt += `\n- ${c.action_description?.slice(0, 60)} (due: ${deadline})`;
    });
  }

  prompt += '\n\nAnalyze this shipment and return the JSON summary:';

  // Call AI
  const response = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);

      // Validate with Zod schema
      const validation = AISummarySchema.safeParse(parsed);
      if (!validation.success) {
        console.error('Zod validation failed:', validation.error.issues.map(i => `${i.path}: ${i.message}`).join(', '));
        // Try to salvage what we can - use defaults for missing fields
        return {
          summary: {
            narrative: parsed.narrative || parsed.story || 'Summary generation failed',
            owner: parsed.owner || 'Intoglo',
            ownerType: parsed.ownerType || 'intoglo',
            riskLevel: parsed.riskLevel || 'amber',
            keyDeadline: parsed.keyDeadline || null,
            keyInsight: parsed.keyInsight || null,
          } as AISummary,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        };
      }

      return {
        summary: validation.data,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };
    }
  } catch (e) {
    console.error('JSON parse error:', e);
  }

  return null;
}

async function saveSummary(shipmentId: string, result: any) {
  const { summary } = result;
  await supabase.from('shipment_ai_summaries').upsert({
    shipment_id: shipmentId,
    // New tight format
    narrative: summary.narrative,
    owner: summary.owner,
    owner_type: summary.ownerType,
    key_deadline: summary.keyDeadline,
    key_insight: summary.keyInsight,
    risk_level: summary.riskLevel,
    // Keep old fields for backwards compatibility (will be phased out)
    story: summary.narrative, // Map narrative to story for now
    risk_reason: summary.keyInsight, // Map key insight to risk reason
    action_owner: summary.owner,
    action_priority: summary.riskLevel === 'red' ? 'critical' : summary.riskLevel === 'amber' ? 'high' : 'medium',
    model_used: 'claude-3-5-haiku',
    input_tokens: result.inputTokens,
    output_tokens: result.outputTokens,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'shipment_id' });
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('═'.repeat(70));
  console.log('GENERATING AI SUMMARIES WITH INTELLIGENCE PROFILES');
  console.log('═'.repeat(70));

  // Get shipments that don't already have V2 summaries
  const { data: existingSummaryIds } = await supabase
    .from('shipment_ai_summaries')
    .select('shipment_id')
    .not('narrative', 'is', null);

  const existingIds = new Set((existingSummaryIds || []).map(s => s.shipment_id));
  console.log(`Already have V2 summaries for ${existingIds.size} shipments`);

  // Get ALL shipments, then filter to only those without summaries
  const { data: allShipments } = await supabase
    .from('shipments')
    .select(`
      id, booking_number, mbl_number,
      port_of_loading_code, port_of_discharge_code,
      vessel_name, carrier_name,
      etd, eta, si_cutoff, vgm_cutoff,
      stage, shipper_name, consignee_name
    `)
    .not('status', 'eq', 'cancelled')
    .order('etd', { ascending: true, nullsFirst: false });

  // Filter out already processed, apply offset and limit for parallel execution
  const shipmentsToProcess = (allShipments || [])
    .filter(s => !existingIds.has(s.id))
    .slice(OFFSET, OFFSET + MAX_SHIPMENTS);

  console.log(`Batch: offset=${OFFSET}, limit=${MAX_SHIPMENTS}`);
  console.log(`Found ${shipmentsToProcess.length} shipments needing V2 summaries\n`);

  let processed = 0;
  let failed = 0;
  let totalCost = 0;

  for (const shipment of shipmentsToProcess || []) {
    try {
      // Get chronicle data
      const { data: chronicles } = await supabase
        .from('chronicle')
        .select('*')
        .eq('shipment_id', shipment.id)
        .order('occurred_at', { ascending: false })
        .limit(15);

      if (!chronicles || chronicles.length === 0) {
        console.log(`⏭️  ${shipment.booking_number}: No chronicle data, skipping`);
        continue;
      }

      // Get profiles
      const [shipperProfile, consigneeProfile, carrierProfile] = await Promise.all([
        getShipperProfile(shipment.shipper_name),
        getConsigneeProfile(shipment.consignee_name),
        getCarrierProfile(shipment.carrier_name),
      ]);

      // Generate summary
      const result = await generateSummary(shipment, chronicles, {
        shipper: shipperProfile,
        consignee: consigneeProfile,
        carrier: carrierProfile,
      });

      if (result) {
        await saveSummary(shipment.id, result);
        const cost = (result.inputTokens * 0.80 + result.outputTokens * 4) / 1_000_000;
        totalCost += cost;
        processed++;

        const intel = [
          shipperProfile ? 'S' : '',
          consigneeProfile ? 'C' : '',
          carrierProfile ? 'K' : '',
        ].filter(Boolean).join('');

        console.log(`✓ ${shipment.booking_number}: ${result.summary.riskLevel.toUpperCase()} | Intel: [${intel || 'none'}] | $${cost.toFixed(4)}`);
      } else {
        failed++;
        console.log(`✗ ${shipment.booking_number}: Failed to generate`);
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (error) {
      failed++;
      console.error(`✗ ${shipment.booking_number}: Error -`, error);
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log(`DONE! Processed: ${processed}, Failed: ${failed}, Cost: $${totalCost.toFixed(4)}`);
  console.log('═'.repeat(70));
}

main().catch(console.error);
