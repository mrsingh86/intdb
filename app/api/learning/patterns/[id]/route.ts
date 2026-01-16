/**
 * Learning Dashboard Pattern Detail API
 *
 * GET /api/learning/patterns/[id] - Get pattern details
 * PUT /api/learning/patterns/[id] - Update/enable/disable pattern
 * DELETE /api/learning/patterns/[id] - Delete pattern
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

    const { data, error } = await supabase
      .from('detection_patterns')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }

    // Get audit history for this pattern
    const { data: auditHistory } = await supabase
      .from('pattern_audit')
      .select('*')
      .eq('pattern_id', id)
      .order('created_at', { ascending: false })
      .limit(10);

    return NextResponse.json({
      pattern: data,
      accuracy: data.hit_count > 0
        ? Math.round((1 - (data.false_positive_count || 0) / data.hit_count) * 100)
        : null,
      auditHistory: auditHistory || [],
    });
  } catch (error) {
    console.error('[Learning Pattern Detail] Error:', error);
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

    // Get current pattern state
    const { data: currentPattern } = await supabase
      .from('detection_patterns')
      .select('*')
      .eq('id', id)
      .single();

    if (!currentPattern) {
      return NextResponse.json({ error: 'Pattern not found' }, { status: 404 });
    }

    // Build update object
    const updates: Record<string, unknown> = {};
    const allowedFields = ['enabled', 'pattern', 'document_type', 'confidence_base', 'priority', 'notes'];
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    // Update pattern
    const { data, error } = await supabase
      .from('detection_patterns')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Determine audit action
    let action = 'modified';
    let reason = body.reason || 'Manual update';
    if (body.enabled === true && !currentPattern.enabled) {
      action = 're-enabled';
      reason = body.reason || 'Re-enabled pattern';
    } else if (body.enabled === false && currentPattern.enabled) {
      action = 'disabled';
      reason = body.reason || 'Manually disabled';
    }

    // Record in audit
    await supabase.from('pattern_audit').insert({
      action,
      pattern_id: id,
      pattern_template: data.pattern,
      document_type: data.document_type,
      carrier_id: data.carrier_id,
      reason,
      source: 'manual',
    });

    return NextResponse.json({ pattern: data });
  } catch (error) {
    console.error('[Learning Pattern Update] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json({ error: 'Missing Supabase config' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get pattern before deletion for audit
    const { data: pattern } = await supabase
      .from('detection_patterns')
      .select('*')
      .eq('id', id)
      .single();

    if (!pattern) {
      return NextResponse.json({ error: 'Pattern not found' }, { status: 404 });
    }

    // Record audit before deletion (so pattern_id is still valid)
    await supabase.from('pattern_audit').insert({
      action: 'deleted',
      pattern_id: id,
      pattern_template: pattern.pattern,
      document_type: pattern.document_type,
      carrier_id: pattern.carrier_id,
      reason: 'Manually deleted',
      source: 'manual',
    });

    // Delete pattern
    const { error } = await supabase
      .from('detection_patterns')
      .delete()
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Learning Pattern Delete] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
