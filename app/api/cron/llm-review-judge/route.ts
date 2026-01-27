/**
 * Cron Job: LLM Review Judge
 *
 * Replaces manual human review with intelligent LLM-based quality checking:
 * 1. Fetches emails flagged for review (needs_review = true)
 * 2. Uses Haiku to judge if classification is correct
 * 3. Auto-approves correct classifications
 * 4. Flags genuinely wrong ones with specific feedback
 * 5. Updates learning_episodes with feedback for continuous improvement
 *
 * Schedule: Weekly (recommended)
 * Cost: ~$0.01 per 100 emails (Haiku is very cheap)
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

// Configuration
const BATCH_SIZE = 50;           // Emails to review per run
const MODEL = 'claude-3-5-haiku-latest';
const MAX_TOKENS = 500;

interface ReviewResult {
  is_correct: boolean;
  confidence: number;
  corrected_document_type?: string;
  reasoning: string;
}

interface ChronicleRecord {
  id: string;
  subject: string;
  summary: string;
  document_type: string;
  from_address: string;
  body_preview?: string;
  review_reason?: string;
}

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
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
    }

    if (!anthropicKey) {
      return NextResponse.json({ error: 'Missing Anthropic API key' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    // Step 1: Fetch emails needing review
    const { data: recordsToReview, error: queryError } = await supabase
      .from('chronicle')
      .select('id, subject, summary, document_type, from_address, body_preview, review_reason')
      .eq('needs_review', true)
      .is('reviewed_at', null)
      .order('created_at', { ascending: false })
      .limit(BATCH_SIZE);

    if (queryError) {
      console.error('[LLM Judge] Query error:', queryError.message);
      return NextResponse.json({ success: false, error: queryError.message }, { status: 500 });
    }

    if (!recordsToReview || recordsToReview.length === 0) {
      console.log('[LLM Judge] No records to review');
      return NextResponse.json({
        success: true,
        duration_ms: Date.now() - startTime,
        stats: { reviewed: 0, approved: 0, flagged: 0 },
      });
    }

    console.log(`[LLM Judge] Reviewing ${recordsToReview.length} emails`);

    // Step 2: Review each email with LLM
    const stats = { reviewed: 0, approved: 0, flagged: 0, errors: 0 };

    for (const record of recordsToReview as ChronicleRecord[]) {
      try {
        const result = await judgeClassification(anthropic, record);
        stats.reviewed++;

        if (result.is_correct) {
          // Auto-approve correct classification
          await supabase
            .from('chronicle')
            .update({
              needs_review: false,
              reviewed_at: new Date().toISOString(),
              review_status: 'reviewed',
            })
            .eq('id', record.id);

          // Update learning_episodes to mark as correct
          await supabase
            .from('learning_episodes')
            .update({ was_correct: true })
            .eq('chronicle_id', record.id)
            .is('was_correct', null);

          stats.approved++;
          console.log(`[LLM Judge] ✓ Approved: ${record.subject.slice(0, 50)}...`);
        } else {
          // Flag with specific feedback
          const { error: updateError } = await supabase
            .from('chronicle')
            .update({
              needs_review: true,
              review_status: 'pending',
              review_reason: `LLM: ${result.reasoning.slice(0, 200)}`,
              review_priority: result.confidence < 50 ? 1 : 2,
            })
            .eq('id', record.id);

          if (updateError) {
            console.error(`[LLM Judge] Failed to update chronicle ${record.id}:`, updateError.message);
          }

          // Update learning_episodes to mark as incorrect
          const { error: leError } = await supabase
            .from('learning_episodes')
            .update({
              was_correct: false,
              actual_document_type: result.corrected_document_type || record.document_type,
            })
            .eq('chronicle_id', record.id)
            .is('was_correct', null);

          if (leError) {
            console.error(`[LLM Judge] Failed to update learning_episode for ${record.id}:`, leError.message);
          }

          stats.flagged++;
          console.log(`[LLM Judge] ✗ Flagged: ${record.subject.slice(0, 50)}... (${result.reasoning.slice(0, 50)})`);
        }
      } catch (error) {
        stats.errors++;
        console.error(`[LLM Judge] Error reviewing ${record.id}:`, error);
      }
    }

    console.log(`[LLM Judge] Complete: ${stats.approved} approved, ${stats.flagged} flagged, ${stats.errors} errors`);

    return NextResponse.json({
      success: true,
      duration_ms: Date.now() - startTime,
      stats,
    });
  } catch (error) {
    console.error('[LLM Judge] Fatal error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

async function judgeClassification(
  anthropic: Anthropic,
  record: ChronicleRecord
): Promise<ReviewResult> {
  const prompt = buildJudgePrompt(record);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
    tools: [
      {
        name: 'classification_judgment',
        description: 'Judge whether an email classification is correct',
        input_schema: {
          type: 'object' as const,
          properties: {
            is_correct: {
              type: 'boolean',
              description: 'Whether the document_type classification is correct',
            },
            confidence: {
              type: 'number',
              description: 'Confidence in judgment (0-100)',
            },
            corrected_document_type: {
              type: 'string',
              description: 'If incorrect, the correct document type',
            },
            reasoning: {
              type: 'string',
              description: 'Brief explanation of judgment',
            },
          },
          required: ['is_correct', 'confidence', 'reasoning'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'classification_judgment' },
  });

  // Extract tool use result
  const toolUse = response.content.find(block => block.type === 'tool_use');
  if (toolUse && toolUse.type === 'tool_use') {
    return toolUse.input as ReviewResult;
  }

  // Fallback if no tool use (shouldn't happen with tool_choice)
  return {
    is_correct: true,
    confidence: 50,
    reasoning: 'Unable to determine - defaulting to approved',
  };
}

function buildJudgePrompt(record: ChronicleRecord): string {
  return `You are a freight forwarding document classification expert. Judge whether this email was classified correctly.

EMAIL DETAILS:
- Subject: ${record.subject}
- From: ${record.from_address}
- Summary: ${record.summary || 'No summary'}
- Body Preview: ${record.body_preview?.slice(0, 500) || 'No body'}

CURRENT CLASSIFICATION: ${record.document_type}

VALID DOCUMENT TYPES:
- booking_confirmation: Initial booking confirmation from carrier
- booking_amendment: Changes to existing booking
- booking_cancellation: Booking cancellation notification
- shipping_instructions: SI submission or request
- si_confirmation: SI confirmed by carrier
- draft_bl: Draft Bill of Lading for review
- final_bl: Final/original BL issued
- telex_release: Telex/seaway release confirmation
- arrival_notice: Arrival notification at destination
- delivery_order: Delivery order/release
- vgm_confirmation: VGM submission confirmation
- invoice: Freight/commercial invoice
- customs_entry: Customs documentation
- sob_confirmation: Shipped on board confirmation
- tracking_update: Generic tracking/status update
- rate_request: Rate quotation request
- general_correspondence: General business email
- notification: System notification (non-actionable)
- spam: Marketing/promotional/unrelated
- unknown: Cannot determine

JUDGMENT CRITERIA:
1. Does the document_type match the email content?
2. Is the summary accurate for this type of email?
3. Would a freight forwarder agree with this classification?

Be LENIENT - approve if the classification is reasonable, even if not perfect.
Only flag if the classification is clearly WRONG.`;
}

export const runtime = 'nodejs';
export const maxDuration = 120;
