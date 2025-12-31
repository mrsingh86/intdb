import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { NotificationRepository } from '@/lib/repositories/notification-repository';
import { NotificationStatus } from '@/types/intelligence-platform';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/notifications/[id]
 *
 * Get a specific notification with actions.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = createClient();
    const repository = new NotificationRepository(supabase);

    const notification = await repository.findById(id);

    if (!notification) {
      return NextResponse.json(
        { error: 'Notification not found' },
        { status: 404 }
      );
    }

    // Get actions
    const actions = await repository.getActions(id);

    return NextResponse.json({
      notification,
      actions,
    });
  } catch (error) {
    console.error('[API:GET /notifications/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/notifications/[id]
 *
 * Update a notification (status, etc.).
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = createClient();
    const repository = new NotificationRepository(supabase);

    const body = await request.json();

    // Check if notification exists
    const existing = await repository.findById(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Notification not found' },
        { status: 404 }
      );
    }

    // Handle status update
    if (body.status) {
      const notification = await repository.updateStatus(
        id,
        body.status as NotificationStatus,
        body.changed_by
      );
      return NextResponse.json({ notification });
    }

    // General update
    const notification = await repository.update(id, body);
    return NextResponse.json({ notification });
  } catch (error) {
    console.error('[API:PATCH /notifications/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/notifications/[id]
 *
 * Perform actions on a notification.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = createClient();
    const repository = new NotificationRepository(supabase);

    const body = await request.json();
    const action = body.action;

    // Verify notification exists
    const existing = await repository.findById(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Notification not found' },
        { status: 404 }
      );
    }

    switch (action) {
      case 'mark_read':
        const readNotification = await repository.markAsRead(id, body.user_id);
        return NextResponse.json({ notification: readNotification });

      case 'acknowledge':
        const ackNotification = await repository.acknowledge(id, body.user_id);
        // Create action record
        await repository.createAction({
          notification_id: id,
          action_type: 'acknowledged',
          performed_by: body.user_id,
          performed_by_name: body.user_name,
          notes: body.notes,
          action_details: {},
        });
        return NextResponse.json({ notification: ackNotification });

      case 'dismiss':
        const dismissNotification = await repository.dismiss(id, body.user_id);
        await repository.createAction({
          notification_id: id,
          action_type: 'dismissed',
          performed_by: body.user_id,
          performed_by_name: body.user_name,
          notes: body.notes,
          action_details: {},
        });
        return NextResponse.json({ notification: dismissNotification });

      case 'mark_actioned':
        const actionedNotification = await repository.markActioned(id, body.user_id);
        await repository.createAction({
          notification_id: id,
          action_type: 'resolved',
          performed_by: body.user_id,
          performed_by_name: body.user_name,
          notes: body.notes,
          action_details: body.details || {},
        });
        return NextResponse.json({ notification: actionedNotification });

      case 'add_comment':
        await repository.createAction({
          notification_id: id,
          action_type: 'commented',
          performed_by: body.user_id,
          performed_by_name: body.user_name,
          notes: body.comment,
          action_details: {},
        });
        return NextResponse.json({ success: true });

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('[API:POST /notifications/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
