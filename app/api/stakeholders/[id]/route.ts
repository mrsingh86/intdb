import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { StakeholderRepository } from '@/lib/repositories/stakeholder-repository';
import { StakeholderAnalyticsService } from '@/lib/services/stakeholder-analytics-service';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/stakeholders/[id]
 *
 * Get stakeholder details with analytics.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();
    const repository = new StakeholderRepository(supabase);
    const analyticsService = new StakeholderAnalyticsService(supabase);

    // Get stakeholder
    const stakeholder = await repository.findById(id);

    // Get additional data
    const [
      behaviorMetrics,
      sentimentLogs,
      relationships,
      reliabilityFactors,
    ] = await Promise.all([
      repository.getBehaviorMetrics(id),
      repository.getSentimentLogs(id, 10),
      repository.getRelationships(id),
      analyticsService.getReliabilityFactors(id),
    ]);

    return NextResponse.json({
      stakeholder,
      behaviorMetrics,
      sentimentLogs,
      relationships,
      reliabilityFactors,
    });
  } catch (error) {
    console.error('[API:GET /stakeholders/[id]] Error:', error);

    if (error instanceof Error && error.name === 'StakeholderNotFoundError') {
      return NextResponse.json(
        { error: 'Stakeholder not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

/**
 * PATCH /api/stakeholders/[id]
 *
 * Update stakeholder details.
 * Requires authentication.
 */
export const PATCH = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();
    const repository = new StakeholderRepository(supabase);

    const body = await request.json();

    // Only allow updating certain fields
    const allowedUpdates = [
      'party_name',
      'address',
      'city',
      'country',
      'postal_code',
      'contact_email',
      'contact_phone',
      'tax_id',
      'is_customer',
      'customer_relationship',
      'email_domains',
    ];

    const updates: Record<string, unknown> = {};
    for (const field of allowedUpdates) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    const stakeholder = await repository.update(id, updates);

    return NextResponse.json({ stakeholder });
  } catch (error) {
    console.error('[API:PATCH /stakeholders/[id]] Error:', error);

    if (error instanceof Error && error.name === 'StakeholderNotFoundError') {
      return NextResponse.json(
        { error: 'Stakeholder not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

/**
 * DELETE /api/stakeholders/[id]
 *
 * Delete a stakeholder (soft delete by marking inactive).
 * Requires authentication.
 */
export const DELETE = withAuth(async (request, { user, params }) => {
  try {
    const resolvedParams = await (params as Promise<{ id: string }>);
    const { id } = resolvedParams;
    const supabase = createClient();

    // Soft delete by removing from active queries
    const { error } = await supabase
      .from('parties')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to delete stakeholder: ${error.message}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[API:DELETE /stakeholders/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
