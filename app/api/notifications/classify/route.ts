import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { NotificationClassificationService } from '@/lib/services/notification-classification-service';
import { NotificationRepository } from '@/lib/repositories/notification-repository';

/**
 * POST /api/notifications/classify
 *
 * Classify emails and create notifications.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const classificationService = new NotificationClassificationService(supabase);

    const body = await request.json();
    const action = body.action || 'process_batch';

    switch (action) {
      case 'process_batch':
        // Process unclassified emails
        const limit = body.limit || 100;
        const result = await classificationService.processUnclassifiedEmails(limit);
        return NextResponse.json(result);

      case 'classify_email':
        // Classify a single email
        if (!body.email) {
          return NextResponse.json(
            { error: 'email object is required' },
            { status: 400 }
          );
        }

        const classification = await classificationService.classifyEmail(body.email);
        return NextResponse.json({ classification });

      case 'classify_and_create':
        // Classify and create notification for a single email
        if (!body.email) {
          return NextResponse.json(
            { error: 'email object is required' },
            { status: 400 }
          );
        }

        const notification = await classificationService.classifyAndCreateNotification(body.email);
        return NextResponse.json({ notification });

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('[API:POST /notifications/classify] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/notifications/classify
 *
 * Get notification type configurations.
 */
export async function GET() {
  try {
    const supabase = createClient();
    const repository = new NotificationRepository(supabase);

    const configs = await repository.getNotificationTypeConfigs();

    return NextResponse.json({ configs });
  } catch (error) {
    console.error('[API:GET /notifications/classify] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
