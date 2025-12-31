import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/utils/supabase/server';
import { TaskRepository } from '@/lib/repositories/task-repository';
import { TaskGenerationService } from '@/lib/services/task-generation-service';
import { TaskStatus, TaskCategory, NotificationPriority, UrgencyLevel } from '@/types/intelligence-platform';
import { ValidationError } from '@/lib/validation';
import { withAuth, AuthenticatedUser } from '@/lib/auth/server-auth';

// ============================================================================
// Input Validation Schemas
// ============================================================================

const TaskFiltersSchema = z.object({
  status: z.string().optional(),
  category: z.string().optional(),
  priority: z.string().optional(),
  urgency: z.string().optional(),
  shipment_id: z.string().uuid().optional(),
  notification_id: z.string().uuid().optional(),
  assigned_to: z.string().uuid().optional(),
  include_completed: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const CreateTaskSchema = z.object({
  action: z.literal('create').optional().default('create'),
  title: z.string().min(1).max(500),
  description: z.string().max(2000).optional(),
  category: z.enum(['deadline', 'document', 'notification', 'compliance', 'operational']).optional().default('operational'),
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  shipment_id: z.string().uuid().optional(),
  notification_id: z.string().uuid().optional(),
  stakeholder_id: z.string().uuid().optional(),
  due_date: z.string().datetime().optional(),
  assigned_to: z.string().uuid().optional(),
  assigned_to_name: z.string().max(200).optional(),
});

const GenerateFromNotificationSchema = z.object({
  action: z.literal('generate_from_notification'),
  notification_id: z.string().uuid(),
  context: z.record(z.unknown()).optional(),
});

const GenerateDeadlineTasksSchema = z.object({
  action: z.literal('generate_deadline_tasks'),
});

const BulkStatusUpdateSchema = z.object({
  action: z.literal('bulk_status_update'),
  ids: z.array(z.string().uuid()).min(1).max(100),
  status: z.enum(['pending', 'in_progress', 'completed', 'dismissed']),
  user_id: z.string().uuid().optional(),
});

const PostBodySchema = z.discriminatedUnion('action', [
  CreateTaskSchema,
  GenerateFromNotificationSchema,
  GenerateDeadlineTasksSchema,
  BulkStatusUpdateSchema,
]).or(CreateTaskSchema); // Allow create without explicit action

/**
 * GET /api/tasks
 *
 * List tasks with filtering and pagination.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();
    const repository = new TaskRepository(supabase);

    // Parse and validate query parameters
    const searchParams = request.nextUrl.searchParams;
    const params: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      params[key] = value;
    });

    const validation = TaskFiltersSchema.safeParse(params);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Invalid query parameters',
          details: validation.error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      );
    }

    const validated = validation.data;

    // Parse comma-separated filters
    const status = validated.status
      ? (validated.status.split(',') as TaskStatus[])
      : undefined;
    const category = validated.category
      ? (validated.category.split(',') as TaskCategory[])
      : undefined;
    const priority = validated.priority
      ? (validated.priority.split(',') as NotificationPriority[])
      : undefined;
    const urgencyLevel = validated.urgency
      ? (validated.urgency.split(',') as UrgencyLevel[])
      : undefined;
    const includeCompleted = validated.include_completed === 'true';

    const result = await repository.findAll(
      {
        status,
        category,
        priority,
        urgencyLevel,
        shipmentId: validated.shipment_id,
        notificationId: validated.notification_id,
        assignedTo: validated.assigned_to,
        includeCompleted,
      },
      { page: validated.page, limit: validated.limit }
    );

    return NextResponse.json({
      tasks: result.data,
      pagination: {
        page: validated.page,
        limit: validated.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / validated.limit),
      },
    });
  } catch (error) {
    console.error('[API:GET /tasks] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

/**
 * POST /api/tasks
 *
 * Create a task or perform bulk operations.
 * Requires authentication.
 */
export const POST = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();
    const repository = new TaskRepository(supabase);
    const generationService = new TaskGenerationService(supabase);

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

    // Handle action-less body as create action
    const bodyWithAction =
      typeof body === 'object' && body !== null && !('action' in body)
        ? { ...body, action: 'create' }
        : body;

    const validation = PostBodySchema.safeParse(bodyWithAction);
    if (!validation.success) {
      return NextResponse.json(
        {
          error: 'Invalid request body',
          details: validation.error.errors.map((e) => ({
            field: e.path.join('.'),
            message: e.message,
          })),
        },
        { status: 400 }
      );
    }

    const validated = validation.data;
    const action = 'action' in validated ? validated.action : 'create';

    switch (action) {
      case 'create': {
        const createData = validated as z.infer<typeof CreateTaskSchema>;

        const result = await generationService.generateManualTask(
          createData.title,
          createData.description || '',
          createData.category || 'operational',
          {
            shipmentId: createData.shipment_id,
            notificationId: createData.notification_id,
            stakeholderId: createData.stakeholder_id,
          },
          {
            priority: createData.priority,
            dueDate: createData.due_date,
            assignTo: createData.assigned_to,
            assignToName: createData.assigned_to_name,
          }
        );

        return NextResponse.json({ task: result.task });
      }

      case 'generate_from_notification': {
        const genData = validated as z.infer<typeof GenerateFromNotificationSchema>;

        const { data: notification, error: notifError } = await supabase
          .from('notifications')
          .select('*')
          .eq('id', genData.notification_id)
          .single();

        if (notifError || !notification) {
          return NextResponse.json(
            { error: 'Notification not found' },
            { status: 404 }
          );
        }

        const genResult = await generationService.generateFromNotification(
          notification,
          genData.context || {}
        );

        return NextResponse.json(genResult);
      }

      case 'generate_deadline_tasks': {
        const deadlineResult = await generationService.generateDeadlineTasks();
        return NextResponse.json(deadlineResult);
      }

      case 'bulk_status_update': {
        const bulkData = validated as z.infer<typeof BulkStatusUpdateSchema>;

        const updated = await repository.bulkUpdateStatus(
          bulkData.ids,
          bulkData.status as TaskStatus,
          bulkData.user_id
        );

        return NextResponse.json({ updated });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('[API:POST /tasks] Error:', error);
    if (error instanceof ValidationError) {
      return NextResponse.json(error.toJSON(), { status: 400 });
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
