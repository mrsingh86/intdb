import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/utils/supabase/server';
import { NotificationRepository } from '@/lib/repositories/notification-repository';
import { NotificationStatus, NotificationPriority, NotificationCategory } from '@/types/intelligence-platform';
import { withAuth } from '@/lib/auth/server-auth';

// ============================================================================
// Input Validation Schemas
// ============================================================================

const NotificationFiltersSchema = z.object({
  type: z.string().max(100).optional(),
  category: z.enum(['deadline', 'carrier', 'customs', 'operational', 'rate']).optional(),
  status: z.string().optional(), // comma-separated list
  priority: z.string().optional(), // comma-separated list
  shipment_id: z.string().uuid().optional(),
  unread_only: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const BulkStatusUpdateSchema = z.object({
  action: z.literal('bulk_status_update'),
  ids: z.array(z.string().uuid()).min(1).max(100),
  status: z.enum(['unread', 'read', 'acknowledged', 'actioned', 'dismissed']),
  changed_by: z.string().uuid().optional(),
});

/**
 * GET /api/notifications
 *
 * List notifications with filtering and pagination.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();
    const repository = new NotificationRepository(supabase);

    // Parse and validate query parameters
    const searchParams = request.nextUrl.searchParams;
    const params: Record<string, string> = {};
    searchParams.forEach((value, key) => { params[key] = value; });

    const validation = NotificationFiltersSchema.safeParse(params);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Invalid query parameters',
          details: validation.error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      );
    }

    const validated = validation.data;

    // Parse comma-separated filters
    const notificationType = validated.type || undefined;
    const category = validated.category as NotificationCategory | undefined;
    const status = validated.status
      ? (validated.status.split(',') as NotificationStatus[])
      : undefined;
    const priority = validated.priority
      ? (validated.priority.split(',') as NotificationPriority[])
      : undefined;
    const shipmentId = validated.shipment_id || undefined;
    const unreadOnly = validated.unread_only === 'true';
    const page = validated.page;
    const limit = validated.limit;

    const result = await repository.findAll(
      {
        notificationType,
        category,
        status,
        priority,
        shipmentId,
        unreadOnly: unreadOnly || undefined,
      },
      { page, limit }
    );

    return NextResponse.json({
      notifications: result.data,
      pagination: {
        page,
        limit,
        total: result.total,
        totalPages: Math.ceil(result.total / limit),
      },
    });
  } catch (error) {
    console.error('[API:GET /notifications] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

/**
 * POST /api/notifications
 *
 * Bulk status update for notifications.
 * Requires authentication.
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();
    const repository = new NotificationRepository(supabase);

    // Parse and validate request body
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    const validation = BulkStatusUpdateSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: validation.error.errors.map(e => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      );
    }

    const validated = validation.data;

    const updated = await repository.bulkUpdateStatus(
      validated.ids,
      validated.status as NotificationStatus,
      validated.changed_by || user.id
    );

    return NextResponse.json({ updated });
  } catch (error) {
    console.error('[API:POST /notifications] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
