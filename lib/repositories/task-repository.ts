/**
 * Task Repository
 *
 * Data access for Action Center tasks, templates, insights, and communications.
 * Follows repository pattern with deep module interface.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  ActionTask,
  TaskTemplate,
  TaskInsight,
  CommunicationLog,
  TaskActivityLog,
  TaskStatus,
  TaskCategory,
  NotificationPriority,
  UrgencyLevel,
  formatTaskNumber,
  calculateUrgencyLevel,
} from '@/types/intelligence-platform';

// ============================================================================
// INTERFACES
// ============================================================================

export interface TaskFilters {
  status?: TaskStatus[];
  category?: TaskCategory[];
  priority?: NotificationPriority[];
  urgencyLevel?: UrgencyLevel[];
  assignedTo?: string;
  shipmentId?: string;
  notificationId?: string;
  dueBefore?: string;
  dueAfter?: string;
  includeCompleted?: boolean;
}

export interface PaginationOptions {
  page: number;
  limit: number;
}

export interface TaskWithRelations extends ActionTask {
  template?: TaskTemplate;
  shipment?: {
    id: string;
    booking_number: string;
    vessel_name?: string;
    carrier_name?: string;
  };
  notification?: {
    id: string;
    title: string;
    priority: NotificationPriority;
  };
  stakeholder?: {
    id: string;
    party_name: string;
    party_type: string;
  };
  insights_count?: number;
  latest_activity?: TaskActivityLog;
}

export interface TaskStatistics {
  total: number;
  byStatus: Record<TaskStatus, number>;
  byPriority: Record<NotificationPriority, number>;
  byCategory: Record<string, number>;
  byUrgency: Record<UrgencyLevel, number>;
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  completedToday: number;
  avgCompletionTimeHours: number;
}

// ============================================================================
// REPOSITORY
// ============================================================================

export class TaskRepository {
  constructor(private supabase: SupabaseClient) {}

  // --------------------------------------------------------------------------
  // TASK TEMPLATES
  // --------------------------------------------------------------------------

  async getTemplates(activeOnly = true): Promise<TaskTemplate[]> {
    let query = this.supabase
      .from('task_templates')
      .select('*')
      .order('template_category', { ascending: true })
      .order('template_name', { ascending: true });

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch task templates: ${error.message}`);
    }

    return data || [];
  }

  async getTemplateByCode(code: string): Promise<TaskTemplate | null> {
    const { data, error } = await this.supabase
      .from('task_templates')
      .select('*')
      .eq('template_code', code)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to fetch template: ${error.message}`);
    }

    return data;
  }

  async createTemplate(template: Omit<TaskTemplate, 'id' | 'created_at' | 'updated_at'>): Promise<TaskTemplate> {
    const { data, error } = await this.supabase
      .from('task_templates')
      .insert(template)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create template: ${error.message}`);
    }

    return data;
  }

  // --------------------------------------------------------------------------
  // TASKS - CRUD
  // --------------------------------------------------------------------------

  async findById(id: string): Promise<TaskWithRelations | null> {
    const { data, error } = await this.supabase
      .from('action_tasks')
      .select(`
        *,
        template:task_templates(*),
        shipment:shipments(id, booking_number, vessel_name, carrier:carriers(carrier_name)),
        notification:notifications(id, title, priority),
        stakeholder:parties(id, party_name, party_type)
      `)
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to fetch task: ${error.message}`);
    }

    if (!data) return null;

    // Flatten carrier name
    const task = {
      ...data,
      shipment: data.shipment ? {
        ...data.shipment,
        carrier_name: data.shipment.carrier?.carrier_name,
      } : undefined,
    };

    return task as TaskWithRelations;
  }

  async findByTaskNumber(taskNumber: number): Promise<TaskWithRelations | null> {
    const { data, error } = await this.supabase
      .from('action_tasks')
      .select('id')
      .eq('task_number', taskNumber)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to fetch task: ${error.message}`);
    }

    if (!data) return null;

    return this.findById(data.id);
  }

  async findAll(
    filters: TaskFilters = {},
    pagination: PaginationOptions = { page: 1, limit: 20 }
  ): Promise<{ data: TaskWithRelations[]; total: number }> {
    const { page, limit } = pagination;
    const offset = (page - 1) * limit;

    let query = this.supabase
      .from('action_tasks')
      .select(`
        *,
        template:task_templates(template_code, template_name),
        shipment:shipments(id, booking_number, vessel_name),
        notification:notifications(id, title, priority)
      `, { count: 'exact' });

    // Apply filters
    if (filters.status && filters.status.length > 0) {
      query = query.in('status', filters.status);
    } else if (!filters.includeCompleted) {
      query = query.not('status', 'in', '("completed","dismissed")');
    }

    if (filters.category && filters.category.length > 0) {
      query = query.in('category', filters.category);
    }

    if (filters.priority && filters.priority.length > 0) {
      query = query.in('priority', filters.priority);
    }

    if (filters.assignedTo) {
      query = query.eq('assigned_to', filters.assignedTo);
    }

    if (filters.shipmentId) {
      query = query.eq('shipment_id', filters.shipmentId);
    }

    if (filters.notificationId) {
      query = query.eq('notification_id', filters.notificationId);
    }

    if (filters.dueBefore) {
      query = query.lte('due_date', filters.dueBefore);
    }

    if (filters.dueAfter) {
      query = query.gte('due_date', filters.dueAfter);
    }

    // Order by priority score descending, then due date
    query = query
      .order('priority_score', { ascending: false })
      .order('due_date', { ascending: true, nullsFirst: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch tasks: ${error.message}`);
    }

    // Calculate urgency level for each task
    const tasksWithUrgency = (data || []).map(task => ({
      ...task,
      urgency_level: calculateUrgencyLevel(task.due_date),
    }));

    // Filter by urgency level if specified (client-side since it's calculated)
    let filteredTasks = tasksWithUrgency;
    if (filters.urgencyLevel && filters.urgencyLevel.length > 0) {
      filteredTasks = tasksWithUrgency.filter(t =>
        filters.urgencyLevel!.includes(t.urgency_level as UrgencyLevel)
      );
    }

    return {
      data: filteredTasks as TaskWithRelations[],
      total: count || 0,
    };
  }

  async create(task: Omit<ActionTask, 'id' | 'task_number' | 'created_at' | 'updated_at'>): Promise<ActionTask> {
    const { data, error } = await this.supabase
      .from('action_tasks')
      .insert(task)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create task: ${error.message}`);
    }

    // Log activity
    await this.logActivity({
      task_id: data.id,
      activity_type: 'created',
      new_value: { title: data.title, priority: data.priority, category: data.category },
      is_system_action: true,
    });

    return data;
  }

  async update(id: string, updates: Partial<ActionTask>): Promise<ActionTask> {
    const { data, error } = await this.supabase
      .from('action_tasks')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update task: ${error.message}`);
    }

    return data;
  }

  // --------------------------------------------------------------------------
  // TASKS - STATUS MANAGEMENT
  // --------------------------------------------------------------------------

  async updateStatus(
    id: string,
    status: TaskStatus,
    userId?: string,
    notes?: string
  ): Promise<ActionTask> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`Task not found: ${id}`);
    }

    const updates: Partial<ActionTask> = {
      status,
      status_notes: notes,
    };

    if (status === 'completed') {
      updates.completed_at = new Date().toISOString();
      updates.completed_by = userId;
      updates.completion_notes = notes;
    }

    const task = await this.update(id, updates);

    // Log activity
    await this.logActivity({
      task_id: id,
      activity_type: 'status_changed',
      old_value: { status: existing.status },
      new_value: { status },
      change_reason: notes,
      performed_by: userId,
      is_system_action: !userId,
    });

    return task;
  }

  async assignTask(
    id: string,
    assigneeId: string,
    assigneeName: string,
    assignedBy?: string
  ): Promise<ActionTask> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`Task not found: ${id}`);
    }

    const task = await this.update(id, {
      assigned_to: assigneeId,
      assigned_to_name: assigneeName,
      assigned_at: new Date().toISOString(),
      status: existing.status === 'pending' ? 'in_progress' : existing.status,
    });

    // Log activity
    await this.logActivity({
      task_id: id,
      activity_type: 'assigned',
      old_value: { assigned_to: existing.assigned_to },
      new_value: { assigned_to: assigneeId, assigned_to_name: assigneeName },
      performed_by: assignedBy,
      is_system_action: false,
    });

    return task;
  }

  async unassignTask(id: string, performedBy?: string): Promise<ActionTask> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`Task not found: ${id}`);
    }

    const task = await this.update(id, {
      assigned_to: undefined,
      assigned_to_name: undefined,
      assigned_at: undefined,
    });

    // Log activity
    await this.logActivity({
      task_id: id,
      activity_type: 'unassigned',
      old_value: { assigned_to: existing.assigned_to },
      performed_by: performedBy,
      is_system_action: false,
    });

    return task;
  }

  async updatePriority(
    id: string,
    priority: NotificationPriority,
    priorityScore: number,
    priorityFactors: ActionTask['priority_factors'],
    reason?: string
  ): Promise<ActionTask> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`Task not found: ${id}`);
    }

    const task = await this.update(id, {
      priority,
      priority_score: priorityScore,
      priority_factors: priorityFactors,
    });

    // Log activity
    await this.logActivity({
      task_id: id,
      activity_type: 'priority_updated',
      old_value: { priority: existing.priority, priority_score: existing.priority_score },
      new_value: { priority, priority_score: priorityScore },
      change_reason: reason,
      is_system_action: true,
    });

    return task;
  }

  // --------------------------------------------------------------------------
  // TASK INSIGHTS
  // --------------------------------------------------------------------------

  async getInsights(taskId: string): Promise<TaskInsight[]> {
    const { data, error } = await this.supabase
      .from('task_insights')
      .select('*')
      .eq('task_id', taskId)
      .order('generated_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch insights: ${error.message}`);
    }

    return data || [];
  }

  async createInsight(insight: Omit<TaskInsight, 'id' | 'created_at'>): Promise<TaskInsight> {
    const { data, error } = await this.supabase
      .from('task_insights')
      .insert(insight)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create insight: ${error.message}`);
    }

    // Log activity
    await this.logActivity({
      task_id: insight.task_id,
      activity_type: 'insight_generated',
      new_value: { insight_type: insight.insight_type, title: insight.title },
      is_system_action: true,
    });

    return data;
  }

  // --------------------------------------------------------------------------
  // COMMUNICATION LOG
  // --------------------------------------------------------------------------

  async getCommunications(taskId: string): Promise<CommunicationLog[]> {
    const { data, error } = await this.supabase
      .from('communication_log')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch communications: ${error.message}`);
    }

    return data || [];
  }

  async createCommunication(communication: Omit<CommunicationLog, 'id' | 'created_at' | 'updated_at'>): Promise<CommunicationLog> {
    const { data, error } = await this.supabase
      .from('communication_log')
      .insert(communication)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create communication: ${error.message}`);
    }

    // Log activity if linked to task
    if (communication.task_id) {
      await this.logActivity({
        task_id: communication.task_id,
        activity_type: 'email_sent',
        new_value: { to: communication.to_emails, subject: communication.subject },
        performed_by: communication.sent_by,
        is_system_action: false,
      });
    }

    return data;
  }

  async updateCommunicationStatus(
    id: string,
    status: CommunicationLog['status'],
    details?: string
  ): Promise<CommunicationLog> {
    const updates: Partial<CommunicationLog> = {
      status,
      status_details: details,
      updated_at: new Date().toISOString(),
    };

    if (status === 'sent') {
      updates.sent_at = new Date().toISOString();
    }

    const { data, error } = await this.supabase
      .from('communication_log')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update communication: ${error.message}`);
    }

    return data;
  }

  // --------------------------------------------------------------------------
  // ACTIVITY LOG
  // --------------------------------------------------------------------------

  async getActivities(taskId: string, limit = 50): Promise<TaskActivityLog[]> {
    const { data, error } = await this.supabase
      .from('task_activity_log')
      .select('*')
      .eq('task_id', taskId)
      .order('performed_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch activities: ${error.message}`);
    }

    return data || [];
  }

  async logActivity(activity: Omit<TaskActivityLog, 'id' | 'performed_at'>): Promise<TaskActivityLog> {
    const { data, error } = await this.supabase
      .from('task_activity_log')
      .insert({
        ...activity,
        performed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to log activity: ${error.message}`);
    }

    return data;
  }

  // --------------------------------------------------------------------------
  // STATISTICS & DASHBOARD
  // --------------------------------------------------------------------------

  async getStatistics(): Promise<TaskStatistics> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
    const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7).toISOString();

    // Get all tasks
    const { data: allTasks, error } = await this.supabase
      .from('action_tasks')
      .select('id, status, priority, category, due_date, completed_at, created_at');

    if (error) {
      throw new Error(`Failed to fetch task statistics: ${error.message}`);
    }

    const tasks = allTasks || [];

    // Calculate statistics
    const byStatus: Record<TaskStatus, number> = {
      pending: 0,
      in_progress: 0,
      blocked: 0,
      completed: 0,
      dismissed: 0,
      failed: 0,
    };

    const byPriority: Record<NotificationPriority, number> = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    const byCategory: Record<string, number> = {};
    const byUrgency: Record<UrgencyLevel, number> = {
      overdue: 0,
      immediate: 0,
      today: 0,
      this_week: 0,
      later: 0,
      no_deadline: 0,
    };

    let overdue = 0;
    let dueToday = 0;
    let dueThisWeek = 0;
    let completedToday = 0;
    let totalCompletionTime = 0;
    let completedCount = 0;

    for (const task of tasks) {
      // By status
      byStatus[task.status as TaskStatus] = (byStatus[task.status as TaskStatus] || 0) + 1;

      // By priority
      byPriority[task.priority as NotificationPriority] = (byPriority[task.priority as NotificationPriority] || 0) + 1;

      // By category
      byCategory[task.category] = (byCategory[task.category] || 0) + 1;

      // By urgency
      const urgency = calculateUrgencyLevel(task.due_date);
      byUrgency[urgency] = (byUrgency[urgency] || 0) + 1;

      // Deadline metrics (only for active tasks)
      if (!['completed', 'dismissed'].includes(task.status) && task.due_date) {
        const dueDate = new Date(task.due_date);
        if (dueDate < now) {
          overdue++;
        } else if (task.due_date >= todayStart && task.due_date < todayEnd) {
          dueToday++;
        } else if (task.due_date < weekEnd) {
          dueThisWeek++;
        }
      }

      // Completed today
      if (task.status === 'completed' && task.completed_at) {
        if (task.completed_at >= todayStart && task.completed_at < todayEnd) {
          completedToday++;
        }

        // Calculate completion time
        const createdAt = new Date(task.created_at);
        const completedAt = new Date(task.completed_at);
        const hours = (completedAt.getTime() - createdAt.getTime()) / (1000 * 60 * 60);
        totalCompletionTime += hours;
        completedCount++;
      }
    }

    return {
      total: tasks.length,
      byStatus,
      byPriority,
      byCategory,
      byUrgency,
      overdue,
      dueToday,
      dueThisWeek,
      completedToday,
      avgCompletionTimeHours: completedCount > 0 ? totalCompletionTime / completedCount : 0,
    };
  }

  async getDashboardData(): Promise<{
    statistics: TaskStatistics;
    urgentTasks: TaskWithRelations[];
    recentlyCompleted: TaskWithRelations[];
    myTasks: TaskWithRelations[];
  }> {
    const statistics = await this.getStatistics();

    // Get urgent tasks (critical/high priority, not completed)
    const { data: urgentTasks } = await this.findAll(
      { priority: ['critical', 'high'], status: ['pending', 'in_progress'] },
      { page: 1, limit: 10 }
    );

    // Get recently completed
    const { data: recentlyCompleted } = await this.supabase
      .from('action_tasks')
      .select(`
        *,
        shipment:shipments(id, booking_number)
      `)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(5);

    return {
      statistics,
      urgentTasks,
      recentlyCompleted: recentlyCompleted || [],
      myTasks: [], // Would be populated based on current user
    };
  }

  // --------------------------------------------------------------------------
  // DUPLICATE CHECK
  // --------------------------------------------------------------------------

  async findExistingTask(
    templateCode: string,
    shipmentId?: string,
    notificationId?: string
  ): Promise<ActionTask | null> {
    let query = this.supabase
      .from('action_tasks')
      .select('*')
      .eq('template_code', templateCode)
      .not('status', 'in', '("completed","dismissed")');

    if (shipmentId) {
      query = query.eq('shipment_id', shipmentId);
    }

    if (notificationId) {
      query = query.eq('notification_id', notificationId);
    }

    const { data, error } = await query.maybeSingle();

    if (error) {
      throw new Error(`Failed to check existing task: ${error.message}`);
    }

    return data;
  }

  // --------------------------------------------------------------------------
  // BULK OPERATIONS
  // --------------------------------------------------------------------------

  async bulkUpdateStatus(
    ids: string[],
    status: TaskStatus,
    userId?: string
  ): Promise<number> {
    const { data, error } = await this.supabase
      .from('action_tasks')
      .update({
        status,
        updated_at: new Date().toISOString(),
        ...(status === 'completed' ? {
          completed_at: new Date().toISOString(),
          completed_by: userId,
        } : {}),
      })
      .in('id', ids)
      .select('id');

    if (error) {
      throw new Error(`Failed to bulk update tasks: ${error.message}`);
    }

    return data?.length || 0;
  }

  async getTasksForRecalculation(limit = 100): Promise<ActionTask[]> {
    const { data, error } = await this.supabase
      .from('action_tasks')
      .select('*')
      .not('status', 'in', '("completed","dismissed")')
      .order('updated_at', { ascending: true })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch tasks for recalculation: ${error.message}`);
    }

    return data || [];
  }
}
