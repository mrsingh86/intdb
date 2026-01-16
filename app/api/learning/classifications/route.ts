/**
 * Learning Dashboard Classifications API
 *
 * GET /api/learning/classifications - List classifications for review
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const searchParams = request.nextUrl.searchParams;

    // Parse filters
    const filter = searchParams.get('filter') || 'all'; // all, needs_review, impossible, low_confidence, action_override
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    // Build query - ORDER BY PRIORITY (highest first), then by date
    let query = supabase
      .from('learning_episodes')
      .select(`
        *,
        chronicle:chronicle_id (
          id,
          subject,
          from_address,
          document_type,
          summary,
          occurred_at,
          shipment_id
        )
      `, { count: 'exact' })
      .is('reviewed_at', null)
      .order('review_priority', { ascending: false })
      .order('created_at', { ascending: false });

    // Apply filters
    if (filter === 'needs_review') {
      query = query.eq('needs_review', true);
    } else if (filter === 'impossible') {
      query = query.eq('review_reason', 'impossible_flow');
    } else if (filter === 'low_confidence') {
      query = query.eq('review_reason', 'low_confidence');
    } else if (filter === 'action_override') {
      query = query.eq('action_keyword_override', true);
    }

    // Pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Get shipment stages for linked classifications
    const shipmentIds = (data || [])
      .map(d => d.chronicle?.shipment_id)
      .filter(Boolean);

    let shipmentStages: Record<string, string> = {};
    if (shipmentIds.length > 0) {
      const { data: shipments } = await supabase
        .from('shipments')
        .select('id, stage')
        .in('id', shipmentIds);

      shipmentStages = Object.fromEntries(
        (shipments || []).map(s => [s.id, s.stage])
      );
    }

    // Format response - includes priority for queue ordering
    const classifications = (data || []).map(episode => ({
      id: episode.id,
      chronicleId: episode.chronicle_id,
      subject: episode.chronicle?.subject || 'Unknown',
      fromAddress: episode.chronicle?.from_address || 'Unknown',
      predictedDocumentType: episode.predicted_document_type,
      currentDocumentType: episode.chronicle?.document_type,
      confidence: episode.prediction_confidence,
      predictionMethod: episode.prediction_method,
      needsReview: episode.needs_review,
      reviewReason: episode.review_reason,
      wasCorrect: episode.was_correct,
      shipmentId: episode.chronicle?.shipment_id,
      shipmentStage: episode.chronicle?.shipment_id
        ? shipmentStages[episode.chronicle.shipment_id]
        : null,
      flowValidationPassed: episode.flow_validation_passed,
      flowValidationWarnings: episode.flow_validation_warnings,
      actionKeywordOverride: episode.action_keyword_override,
      actionKeywordMatched: episode.action_keyword_matched,
      occurredAt: episode.chronicle?.occurred_at,
      createdAt: episode.created_at,
      // Priority fields for queue ordering
      reviewPriority: episode.review_priority || 50,
      priorityFactors: episode.priority_factors || {},
    }));

    return NextResponse.json({
      classifications,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error('[Learning Classifications] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
