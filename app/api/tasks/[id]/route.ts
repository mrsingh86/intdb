import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { TaskRepository } from '@/lib/repositories/task-repository';
import { TaskPriorityService } from '@/lib/services/task-priority-service';
import { InsightGenerationService } from '@/lib/services/insight-generation-service';
import { TaskStatus, NotificationPriority } from '@/types/intelligence-platform';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/tasks/[id]
 *
 * Get a specific task with related data.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = createClient();
    const repository = new TaskRepository(supabase);

    const task = await repository.findById(id);

    if (!task) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    // Get related data
    const [insights, communications, activities] = await Promise.all([
      repository.getInsights(id),
      repository.getCommunications(id),
      repository.getActivities(id, 20),
    ]);

    return NextResponse.json({
      task,
      insights,
      communications,
      activities,
    });
  } catch (error) {
    console.error('[API:GET /tasks/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/tasks/[id]
 *
 * Update a task.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = createClient();
    const repository = new TaskRepository(supabase);

    const body = await request.json();

    // Check if task exists
    const existing = await repository.findById(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    // Handle specific update types
    if (body.status !== undefined) {
      const task = await repository.updateStatus(
        id,
        body.status as TaskStatus,
        body.user_id,
        body.notes
      );
      return NextResponse.json({ task });
    }

    if (body.assigned_to !== undefined) {
      if (body.assigned_to === null) {
        const task = await repository.unassignTask(id, body.user_id);
        return NextResponse.json({ task });
      } else {
        const task = await repository.assignTask(
          id,
          body.assigned_to,
          body.assigned_to_name || 'Unknown',
          body.user_id
        );
        return NextResponse.json({ task });
      }
    }

    // General update
    const task = await repository.update(id, body);
    return NextResponse.json({ task });
  } catch (error) {
    console.error('[API:PATCH /tasks/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/tasks/[id]
 *
 * Perform actions on a task.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = createClient();
    const repository = new TaskRepository(supabase);

    const body = await request.json();
    const action = body.action;

    // Verify task exists
    const existing = await repository.findById(id);
    if (!existing) {
      return NextResponse.json(
        { error: 'Task not found' },
        { status: 404 }
      );
    }

    switch (action) {
      case 'complete':
        const completedTask = await repository.updateStatus(
          id,
          'completed',
          body.user_id,
          body.notes
        );
        return NextResponse.json({ task: completedTask });

      case 'dismiss':
        const dismissedTask = await repository.updateStatus(
          id,
          'dismissed',
          body.user_id,
          body.notes
        );
        return NextResponse.json({ task: dismissedTask });

      case 'start':
        const startedTask = await repository.updateStatus(
          id,
          'in_progress',
          body.user_id
        );
        return NextResponse.json({ task: startedTask });

      case 'block':
        const blockedTask = await repository.updateStatus(
          id,
          'blocked',
          body.user_id,
          body.notes
        );
        return NextResponse.json({ task: blockedTask });

      case 'assign':
        if (!body.assigned_to) {
          return NextResponse.json(
            { error: 'assigned_to is required' },
            { status: 400 }
          );
        }
        const assignedTask = await repository.assignTask(
          id,
          body.assigned_to,
          body.assigned_to_name || 'Unknown',
          body.user_id
        );
        return NextResponse.json({ task: assignedTask });

      case 'unassign':
        const unassignedTask = await repository.unassignTask(id, body.user_id);
        return NextResponse.json({ task: unassignedTask });

      case 'recalculate_priority':
        const priorityService = new TaskPriorityService(supabase);
        const { priority, score, factors } = await priorityService.recalculatePriority(existing);
        const updatedTask = await repository.updatePriority(
          id,
          priority,
          score,
          factors,
          'Manual recalculation'
        );
        return NextResponse.json({
          task: updatedTask,
          priority_details: { priority, score, factors },
        });

      case 'generate_insights':
        const insightService = new InsightGenerationService(supabase);
        const insights = await insightService.generateInsightsForTask(id);
        return NextResponse.json({ insights });

      case 'add_comment':
        await repository.logActivity({
          task_id: id,
          activity_type: 'comment_added',
          new_value: { comment: body.comment },
          performed_by: body.user_id,
          performed_by_name: body.user_name,
          is_system_action: false,
        });
        return NextResponse.json({ success: true });

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('[API:POST /tasks/[id]] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
