/**
 * Learning Dashboard Classification Detail API
 *
 * GET /api/learning/classifications/[id] - Get classification details
 * PUT /api/learning/classifications/[id] - Submit correction or confirm
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: episode, error } = await supabase
      .from('learning_episodes')
      .select(`
        *,
        chronicle:chronicle_id (
          id,
          subject,
          from_address,
          document_type,
          summary,
          body_preview,
          occurred_at,
          shipment_id,
          has_action,
          action_description
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    // Get shipment stage if linked
    let shipmentStage = null;
    if (episode.chronicle?.shipment_id) {
      const { data: shipment } = await supabase
        .from('shipments')
        .select('stage')
        .eq('id', episode.chronicle.shipment_id)
        .single();
      shipmentStage = shipment?.stage;
    }

    // Get flow validation rules for context
    let flowRules = null;
    if (shipmentStage) {
      const { data: rules } = await supabase
        .from('flow_validation_rules')
        .select('document_type, rule_type')
        .eq('shipment_stage', shipmentStage);
      flowRules = rules;
    }

    return NextResponse.json({
      episode: {
        id: episode.id,
        chronicleId: episode.chronicle_id,
        subject: episode.chronicle?.subject,
        fromAddress: episode.chronicle?.from_address,
        bodyPreview: episode.chronicle?.body_preview,
        predictedDocumentType: episode.predicted_document_type,
        predictedHasAction: episode.predicted_has_action,
        currentDocumentType: episode.chronicle?.document_type,
        currentHasAction: episode.chronicle?.has_action,
        actionDescription: episode.chronicle?.action_description,
        confidence: episode.prediction_confidence,
        predictionMethod: episode.prediction_method,
        needsReview: episode.needs_review,
        reviewReason: episode.review_reason,
        wasCorrect: episode.was_correct,
        flowValidationPassed: episode.flow_validation_passed,
        flowValidationWarnings: episode.flow_validation_warnings,
        actionKeywordOverride: episode.action_keyword_override,
        actionKeywordMatched: episode.action_keyword_matched,
        shipmentId: episode.chronicle?.shipment_id,
        shipmentStage,
        occurredAt: episode.chronicle?.occurred_at,
        createdAt: episode.created_at,
      },
      flowRules,
    });
  } catch (error) {
    console.error('[Learning Classification Detail] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await request.json();

    const { action, corrected_document_type, corrected_has_action, reason } = body;

    if (!action || !['confirm', 'correct'].includes(action)) {
      return NextResponse.json(
        { error: 'Action must be "confirm" or "correct"' },
        { status: 400 }
      );
    }

    // Get current episode
    const { data: episode, error: fetchError } = await supabase
      .from('learning_episodes')
      .select('*, chronicle:chronicle_id(id, document_type, has_action)')
      .eq('id', id)
      .single();

    if (fetchError || !episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    if (action === 'confirm') {
      // Confirm the prediction was correct
      const { error: updateError } = await supabase
        .from('learning_episodes')
        .update({
          was_correct: true,
          reviewed_at: new Date().toISOString(),
          needs_review: false,
          correction_reason: reason || 'Confirmed as correct',
        })
        .eq('id', id);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      return NextResponse.json({ success: true, action: 'confirmed' });
    } else {
      // Correction - update both learning_episode and chronicle
      if (!corrected_document_type && corrected_has_action === undefined) {
        return NextResponse.json(
          { error: 'Must provide corrected_document_type or corrected_has_action' },
          { status: 400 }
        );
      }

      // Update learning episode
      const episodeUpdate: Record<string, unknown> = {
        was_correct: false,
        reviewed_at: new Date().toISOString(),
        needs_review: false,
        correction_reason: reason || 'Corrected by user',
      };

      if (corrected_document_type) {
        episodeUpdate.corrected_document_type = corrected_document_type;
      }
      if (corrected_has_action !== undefined) {
        episodeUpdate.corrected_has_action = corrected_has_action;
      }

      const { error: updateError } = await supabase
        .from('learning_episodes')
        .update(episodeUpdate)
        .eq('id', id);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      // Also update the chronicle record
      if (episode.chronicle?.id) {
        const chronicleUpdate: Record<string, unknown> = {};
        if (corrected_document_type) {
          chronicleUpdate.document_type = corrected_document_type;
        }
        if (corrected_has_action !== undefined) {
          chronicleUpdate.has_action = corrected_has_action;
        }

        if (Object.keys(chronicleUpdate).length > 0) {
          await supabase
            .from('chronicle')
            .update(chronicleUpdate)
            .eq('id', episode.chronicle.id);
        }
      }

      // Record pattern false positive if pattern was used
      if (episode.pattern_id && corrected_document_type) {
        try {
          await supabase.rpc('increment_pattern_false_positive', {
            p_pattern_id: episode.pattern_id,
          });
        } catch {
          console.warn('[Learning] increment_pattern_false_positive RPC not available');
        }
      }

      // Check if same sender_domain has been corrected to same type 3+ times
      // If so, suggest auto-creating a detection pattern
      let patternSuggestion = null;
      if (corrected_document_type && episode.sender_domain) {
        const { count } = await supabase
          .from('learning_episodes')
          .select('*', { count: 'exact', head: true })
          .eq('sender_domain', episode.sender_domain)
          .eq('corrected_document_type', corrected_document_type)
          .eq('was_correct', false);

        if (count && count >= 3) {
          // Check if pattern already exists for this domain+type
          const { data: existingPattern } = await supabase
            .from('detection_patterns')
            .select('id')
            .eq('document_type', corrected_document_type)
            .ilike('pattern', `%${episode.sender_domain}%`)
            .limit(1)
            .single();

          if (!existingPattern) {
            patternSuggestion = {
              senderDomain: episode.sender_domain,
              documentType: corrected_document_type,
              correctionCount: count,
              suggestedPattern: `@${episode.sender_domain.replace(/\./g, '\\.')}$`,
            };
          }
        }
      }

      return NextResponse.json({
        success: true,
        action: 'corrected',
        correctedDocumentType: corrected_document_type,
        correctedHasAction: corrected_has_action,
        patternSuggestion,
      });
    }
  } catch (error) {
    console.error('[Learning Classification Correct] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
