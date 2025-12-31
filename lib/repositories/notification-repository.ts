/**
 * Notification Repository
 *
 * Data access layer for notification management including:
 * - Notification type configurations
 * - Classified notifications
 * - Notification actions
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  Notification,
  NotificationTypeConfig,
  NotificationAction,
  NotificationStatus,
  NotificationPriority,
  NotificationCategory,
} from '@/types/intelligence-platform';

export interface NotificationFilters {
  notificationType?: string;
  category?: NotificationCategory;
  status?: NotificationStatus | NotificationStatus[];
  priority?: NotificationPriority | NotificationPriority[];
  shipmentId?: string;
  carrierId?: string;
  unreadOnly?: boolean;
  hasDeadline?: boolean;
  deadlineBefore?: string;
  receivedAfter?: string;
}

export interface NotificationStats {
  total: number;
  unread: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  byCategory: Record<string, number>;
  urgentCount: number;
  overdueDeadlines: number;
}

export class NotificationRepository {
  constructor(private supabase: SupabaseClient) {}

  // ============================================================================
  // NOTIFICATION TYPE CONFIGS
  // ============================================================================

  async getNotificationTypeConfigs(
    activeOnly: boolean = true
  ): Promise<NotificationTypeConfig[]> {
    let query = this.supabase
      .from('notification_type_configs')
      .select('*')
      .order('category')
      .order('display_name');

    if (activeOnly) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to fetch notification type configs: ${error.message}`);
    }

    return data || [];
  }

  async getNotificationTypeConfig(
    notificationType: string
  ): Promise<NotificationTypeConfig | null> {
    const { data, error } = await this.supabase
      .from('notification_type_configs')
      .select('*')
      .eq('notification_type', notificationType)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to fetch notification type config: ${error.message}`);
    }

    return data;
  }

  async getConfigsByCategory(
    category: NotificationCategory
  ): Promise<NotificationTypeConfig[]> {
    const { data, error } = await this.supabase
      .from('notification_type_configs')
      .select('*')
      .eq('category', category)
      .eq('is_active', true)
      .order('display_name');

    if (error) {
      throw new Error(`Failed to fetch configs by category: ${error.message}`);
    }

    return data || [];
  }

  // ============================================================================
  // NOTIFICATIONS CRUD
  // ============================================================================

  async findById(id: string): Promise<Notification | null> {
    const { data, error } = await this.supabase
      .from('notifications')
      .select('*')
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to fetch notification: ${error.message}`);
    }

    return data;
  }

  async findByEmailId(emailId: string): Promise<Notification | null> {
    const { data, error } = await this.supabase
      .from('notifications')
      .select('*')
      .eq('email_id', emailId)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to fetch notification by email: ${error.message}`);
    }

    return data;
  }

  async findAll(
    filters: NotificationFilters = {},
    pagination?: { page: number; limit: number }
  ): Promise<{ data: Notification[]; total: number }> {
    let query = this.supabase
      .from('notifications')
      .select('*', { count: 'exact' });

    if (filters.notificationType) {
      query = query.eq('notification_type', filters.notificationType);
    }

    if (filters.status) {
      if (Array.isArray(filters.status)) {
        query = query.in('status', filters.status);
      } else {
        query = query.eq('status', filters.status);
      }
    }

    if (filters.priority) {
      if (Array.isArray(filters.priority)) {
        query = query.in('priority', filters.priority);
      } else {
        query = query.eq('priority', filters.priority);
      }
    }

    if (filters.shipmentId) {
      query = query.eq('shipment_id', filters.shipmentId);
    }

    if (filters.carrierId) {
      query = query.eq('carrier_id', filters.carrierId);
    }

    if (filters.unreadOnly) {
      query = query.eq('status', 'unread');
    }

    if (filters.hasDeadline) {
      query = query.not('deadline_date', 'is', null);
    }

    if (filters.deadlineBefore) {
      query = query.lte('deadline_date', filters.deadlineBefore);
    }

    if (filters.receivedAfter) {
      query = query.gte('received_at', filters.receivedAfter);
    }

    // Filter by category (requires joining with notification_type_configs)
    if (filters.category) {
      // Get all notification types for this category
      const { data: typeConfigs } = await this.supabase
        .from('notification_type_configs')
        .select('notification_type')
        .eq('category', filters.category);

      if (typeConfigs && typeConfigs.length > 0) {
        const notificationTypes = typeConfigs.map(c => c.notification_type);
        query = query.in('notification_type', notificationTypes);
      } else {
        // No types for this category, return empty
        return { data: [], total: 0 };
      }
    }

    // Order by urgency and received date
    query = query
      .order('urgency_score', { ascending: false, nullsFirst: false })
      .order('received_at', { ascending: false });

    if (pagination) {
      const offset = (pagination.page - 1) * pagination.limit;
      query = query.range(offset, offset + pagination.limit - 1);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch notifications: ${error.message}`);
    }

    return { data: data || [], total: count || 0 };
  }

  async findUnread(limit: number = 20): Promise<Notification[]> {
    const { data, error } = await this.supabase
      .from('notifications')
      .select('*')
      .eq('status', 'unread')
      .order('urgency_score', { ascending: false, nullsFirst: false })
      .order('received_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch unread notifications: ${error.message}`);
    }

    return data || [];
  }

  async findByShipment(shipmentId: string): Promise<Notification[]> {
    const { data, error } = await this.supabase
      .from('notifications')
      .select('*')
      .eq('shipment_id', shipmentId)
      .order('received_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch notifications by shipment: ${error.message}`);
    }

    return data || [];
  }

  async create(
    notification: Omit<Notification, 'id' | 'created_at' | 'processed_at'>
  ): Promise<Notification> {
    const { data, error } = await this.supabase
      .from('notifications')
      .insert({
        ...notification,
        processed_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create notification: ${error.message}`);
    }

    return data;
  }

  async update(
    id: string,
    updates: Partial<Notification>
  ): Promise<Notification> {
    const { data, error } = await this.supabase
      .from('notifications')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update notification: ${error.message}`);
    }

    return data;
  }

  async updateStatus(
    id: string,
    status: NotificationStatus,
    changedBy?: string
  ): Promise<Notification> {
    return this.update(id, {
      status,
      status_changed_at: new Date().toISOString(),
      status_changed_by: changedBy,
    });
  }

  async markAsRead(id: string, userId?: string): Promise<Notification> {
    return this.updateStatus(id, 'read', userId);
  }

  async acknowledge(id: string, userId?: string): Promise<Notification> {
    return this.updateStatus(id, 'acknowledged', userId);
  }

  async dismiss(id: string, userId?: string): Promise<Notification> {
    return this.updateStatus(id, 'dismissed', userId);
  }

  async markActioned(id: string, userId?: string): Promise<Notification> {
    return this.updateStatus(id, 'actioned', userId);
  }

  async bulkUpdateStatus(
    ids: string[],
    status: NotificationStatus,
    changedBy?: string
  ): Promise<number> {
    const { data, error } = await this.supabase
      .from('notifications')
      .update({
        status,
        status_changed_at: new Date().toISOString(),
        status_changed_by: changedBy,
      })
      .in('id', ids)
      .select('id');

    if (error) {
      throw new Error(`Failed to bulk update notifications: ${error.message}`);
    }

    return data?.length || 0;
  }

  // ============================================================================
  // NOTIFICATION ACTIONS
  // ============================================================================

  async getActions(notificationId: string): Promise<NotificationAction[]> {
    const { data, error } = await this.supabase
      .from('notification_actions')
      .select('*')
      .eq('notification_id', notificationId)
      .order('performed_at', { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch notification actions: ${error.message}`);
    }

    return data || [];
  }

  async createAction(
    action: Omit<NotificationAction, 'id' | 'performed_at'>
  ): Promise<NotificationAction> {
    const { data, error } = await this.supabase
      .from('notification_actions')
      .insert(action)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create notification action: ${error.message}`);
    }

    return data;
  }

  // ============================================================================
  // STATISTICS
  // ============================================================================

  async getStatistics(): Promise<NotificationStats> {
    const { data: notifications, error } = await this.supabase
      .from('notifications')
      .select('status, priority, notification_type, urgency_score, deadline_date');

    if (error) {
      throw new Error(`Failed to fetch notification statistics: ${error.message}`);
    }

    const now = new Date();
    const stats: NotificationStats = {
      total: notifications?.length || 0,
      unread: 0,
      byStatus: {},
      byPriority: {},
      byCategory: {},
      urgentCount: 0,
      overdueDeadlines: 0,
    };

    for (const n of notifications || []) {
      // By status
      stats.byStatus[n.status] = (stats.byStatus[n.status] || 0) + 1;
      if (n.status === 'unread') stats.unread++;

      // By priority
      stats.byPriority[n.priority] = (stats.byPriority[n.priority] || 0) + 1;

      // Urgent (score >= 70)
      if (n.urgency_score && n.urgency_score >= 70) {
        stats.urgentCount++;
      }

      // Overdue deadlines
      if (n.deadline_date && new Date(n.deadline_date) < now && n.status !== 'actioned') {
        stats.overdueDeadlines++;
      }
    }

    // Get category stats from type configs
    const { data: configs } = await this.supabase
      .from('notification_type_configs')
      .select('notification_type, category');

    const typeToCategory: Record<string, string> = {};
    for (const config of configs || []) {
      typeToCategory[config.notification_type] = config.category;
    }

    for (const n of notifications || []) {
      const category = typeToCategory[n.notification_type] || 'general';
      stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
    }

    return stats;
  }

  async getDashboardData(): Promise<{
    statistics: NotificationStats;
    recentNotifications: Notification[];
    urgentNotifications: Notification[];
    typeBreakdown: Array<{ type: string; displayName: string; count: number }>;
  }> {
    const [statistics, recentResult, urgentResult] = await Promise.all([
      this.getStatistics(),
      this.findAll({ unreadOnly: true }, { page: 1, limit: 10 }),
      this.findAll({ priority: ['critical', 'high'] }, { page: 1, limit: 5 }),
    ]);

    // Get type breakdown
    const { data: typeData } = await this.supabase
      .from('notifications')
      .select('notification_type');

    const typeCounts: Record<string, number> = {};
    for (const n of typeData || []) {
      typeCounts[n.notification_type] = (typeCounts[n.notification_type] || 0) + 1;
    }

    const { data: typeConfigs } = await this.supabase
      .from('notification_type_configs')
      .select('notification_type, display_name');

    const typeBreakdown = Object.entries(typeCounts)
      .map(([type, count]) => {
        const config = typeConfigs?.find(c => c.notification_type === type);
        return {
          type,
          displayName: config?.display_name || type,
          count,
        };
      })
      .sort((a, b) => b.count - a.count);

    return {
      statistics,
      recentNotifications: recentResult.data,
      urgentNotifications: urgentResult.data,
      typeBreakdown,
    };
  }
}
