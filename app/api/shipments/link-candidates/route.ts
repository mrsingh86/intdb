import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { ShipmentLinkCandidateRepository } from '@/lib/repositories/shipment-link-candidate-repository';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/shipments/link-candidates
 *
 * Get all pending link candidates for review.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();
    const candidateRepo = new ShipmentLinkCandidateRepository(supabase);

    // Use new method that includes email data for deduplication
    const candidates = await candidateRepo.findPendingWithEmailData();

    return NextResponse.json({ candidates });
  } catch (error) {
    console.error('[API:GET /link-candidates] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

/**
 * POST /api/shipments/link-candidates
 *
 * Confirm or reject a link candidate.
 * Requires authentication.
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();
    const candidateRepo = new ShipmentLinkCandidateRepository(supabase);

    const body = await request.json();
    const { candidate_id, user_id, action, reason } = body;

    if (action === 'reject') {
      // Reject the link candidate
      const result = await candidateRepo.reject(candidate_id, reason);
      return NextResponse.json({ success: true, result });
    } else {
      // Confirm the link candidate (default action)
      const result = await candidateRepo.confirm(candidate_id, user_id);
      return NextResponse.json({ success: true, result });
    }
  } catch (error) {
    console.error('[API:POST /link-candidates] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
