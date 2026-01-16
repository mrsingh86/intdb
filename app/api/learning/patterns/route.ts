/**
 * Learning Dashboard Patterns API
 *
 * GET /api/learning/patterns - List patterns with filters
 * POST /api/learning/patterns - Create new pattern
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
    const enabled = searchParams.get('enabled');
    const carrierId = searchParams.get('carrier_id');
    const documentType = searchParams.get('document_type');
    const source = searchParams.get('source');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    // Build query
    let query = supabase
      .from('detection_patterns')
      .select('*', { count: 'exact' })
      .order('hit_count', { ascending: false, nullsFirst: false });

    if (enabled !== null) {
      query = query.eq('enabled', enabled === 'true');
    }
    if (carrierId) {
      query = query.eq('carrier_id', carrierId);
    }
    if (documentType) {
      query = query.eq('document_type', documentType);
    }
    if (source) {
      query = query.eq('source', source);
    }

    // Pagination
    const offset = (page - 1) * limit;
    query = query.range(offset, offset + limit - 1);

    const { data, count, error } = await query;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Calculate accuracy for each pattern
    const patternsWithAccuracy = (data || []).map(p => ({
      ...p,
      accuracy: p.hit_count > 0
        ? Math.round((1 - (p.false_positive_count || 0) / p.hit_count) * 100)
        : null,
    }));

    return NextResponse.json({
      patterns: patternsWithAccuracy,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    });
  } catch (error) {
    console.error('[Learning Patterns] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await request.json();

    // Validate required fields
    const { carrier_id, pattern_type, document_type, pattern, confidence_base } = body;
    if (!carrier_id || !pattern_type || !document_type || !pattern) {
      return NextResponse.json(
        { error: 'Missing required fields: carrier_id, pattern_type, document_type, pattern' },
        { status: 400 }
      );
    }

    // Insert pattern
    const { data, error } = await supabase
      .from('detection_patterns')
      .insert({
        carrier_id,
        pattern_type,
        document_type,
        pattern,
        pattern_flags: body.pattern_flags || 'i',
        priority: body.priority || 50,
        confidence_base: confidence_base || 85,
        enabled: true,
        source: 'manual',
        notes: body.notes,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Record in audit
    await supabase.from('pattern_audit').insert({
      action: 'approved',
      pattern_id: data.id,
      pattern_template: pattern,
      document_type,
      carrier_id,
      reason: 'Manually created',
      source: 'manual',
    });

    return NextResponse.json({ pattern: data }, { status: 201 });
  } catch (error) {
    console.error('[Learning Patterns] Create error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
