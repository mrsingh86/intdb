import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * DELETE /api/shipments/delete-all
 *
 * Delete all shipments (for development/testing only).
 * Requires authentication.
 */
export const DELETE = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();

    // Delete link candidates first (foreign key dependency)
    await supabase
      .from('shipment_link_candidates')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    // Delete shipment documents
    await supabase
      .from('shipment_documents')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    // Delete shipments
    const { error } = await supabase
      .from('shipments')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (error) {
      console.error('[API:DELETE /shipments/delete-all] Error:', error);
      return NextResponse.json(
        { error: `Failed to delete shipments: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'All shipments deleted',
    });
  } catch (error: any) {
    console.error('[API:DELETE /shipments/delete-all] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
