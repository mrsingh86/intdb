/**
 * Notification Repository Tests
 *
 * Tests for notification type configs, notifications CRUD,
 * status updates, actions, and statistics.
 */

import { NotificationRepository } from '../notification-repository';

// Create a reusable mock chain that returns itself for chaining
// This mock supports the Supabase pattern where the chain is awaitable
const createChainableMock = () => {
  let resolveValue: any = { data: null, error: null, count: 0 };

  const chain: any = {
    // Method to set what the chain resolves to when awaited
    _setResolveValue: (value: any) => { resolveValue = value; },
    // Make the chain thenable (awaitable)
    then: (resolve: any, reject?: any) => Promise.resolve(resolveValue).then(resolve, reject),
  };

  const methods = [
    'select', 'insert', 'update', 'delete',
    'eq', 'in', 'or', 'not', 'order', 'range', 'limit',
    'single', 'lte', 'gte', 'maybeSingle'
  ];

  methods.forEach(method => {
    chain[method] = jest.fn().mockReturnValue(chain);
  });

  return chain;
};

let mockChain: ReturnType<typeof createChainableMock>;
const mockFrom = jest.fn();

const mockSupabase = {
  from: mockFrom,
} as any;

beforeEach(() => {
  jest.clearAllMocks();
  mockChain = createChainableMock();
  mockFrom.mockReturnValue(mockChain);
});

describe('NotificationRepository', () => {
  let repository: NotificationRepository;

  beforeEach(() => {
    repository = new NotificationRepository(mockSupabase);
  });

  describe('getNotificationTypeConfigs', () => {
    it('should fetch active notification type configs', async () => {
      const mockConfigs = [
        { notification_type: 'deadline_advisory', display_name: 'Deadline Advisory', is_active: true },
        { notification_type: 'rate_change', display_name: 'Rate Change', is_active: true },
      ];

      mockChain.eq.mockResolvedValue({ data: mockConfigs, error: null });

      const result = await repository.getNotificationTypeConfigs();

      expect(mockFrom).toHaveBeenCalledWith('notification_type_configs');
      expect(result).toEqual(mockConfigs);
    });

    it('should fetch all configs when activeOnly is false', async () => {
      const mockConfigs = [
        { notification_type: 'deadline_advisory', is_active: true },
        { notification_type: 'old_type', is_active: false },
      ];

      mockChain._setResolveValue({ data: mockConfigs, error: null });

      const result = await repository.getNotificationTypeConfigs(false);

      expect(result).toHaveLength(2);
    });

    it('should throw error on database failure', async () => {
      mockChain.eq.mockResolvedValue({ data: null, error: { message: 'Database error' } });

      await expect(repository.getNotificationTypeConfigs())
        .rejects.toThrow('Failed to fetch notification type configs');
    });
  });

  describe('getNotificationTypeConfig', () => {
    it('should fetch config by notification type', async () => {
      const mockConfig = { notification_type: 'deadline_advisory', display_name: 'Deadline' };
      mockChain.single.mockResolvedValue({ data: mockConfig, error: null });

      const result = await repository.getNotificationTypeConfig('deadline_advisory');

      expect(result).toEqual(mockConfig);
    });

    it('should return null when not found', async () => {
      mockChain.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

      const result = await repository.getNotificationTypeConfig('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findById', () => {
    it('should fetch notification by ID', async () => {
      const mockNotification = {
        id: 'notif-1',
        title: 'SI Deadline Approaching',
        status: 'unread',
        priority: 'high',
      };

      mockChain.single.mockResolvedValue({ data: mockNotification, error: null });

      const result = await repository.findById('notif-1');

      expect(mockFrom).toHaveBeenCalledWith('notifications');
      expect(result).toEqual(mockNotification);
    });

    it('should return null when notification not found', async () => {
      mockChain.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

      const result = await repository.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findByEmailId', () => {
    it('should fetch notification by email ID', async () => {
      const mockNotification = { id: 'notif-1', email_id: 'email-1' };
      mockChain.single.mockResolvedValue({ data: mockNotification, error: null });

      const result = await repository.findByEmailId('email-1');

      expect(mockChain.eq).toHaveBeenCalledWith('email_id', 'email-1');
      expect(result).toEqual(mockNotification);
    });
  });

  describe('findAll', () => {
    it('should fetch notifications with filters', async () => {
      const mockNotifications = [
        { id: 'n1', status: 'unread', priority: 'high' },
        { id: 'n2', status: 'unread', priority: 'critical' },
      ];

      mockChain.range.mockResolvedValue({ data: mockNotifications, error: null, count: 2 });

      const result = await repository.findAll(
        { priority: ['high', 'critical'] },
        { page: 1, limit: 10 }
      );

      expect(result.data).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('should apply status filter', async () => {
      mockChain.range.mockResolvedValue({ data: [], error: null, count: 0 });

      await repository.findAll({ status: 'unread' }, { page: 1, limit: 10 });

      expect(mockChain.eq).toHaveBeenCalledWith('status', 'unread');
    });

    it('should apply shipmentId filter', async () => {
      mockChain.range.mockResolvedValue({ data: [], error: null, count: 0 });

      await repository.findAll({ shipmentId: 'ship-1' }, { page: 1, limit: 10 });

      expect(mockChain.eq).toHaveBeenCalledWith('shipment_id', 'ship-1');
    });

    it('should throw error on database failure', async () => {
      mockChain.range.mockResolvedValue({ data: null, error: { message: 'Database error' } });

      await expect(repository.findAll({}, { page: 1, limit: 10 }))
        .rejects.toThrow('Failed to fetch notifications');
    });
  });

  describe('findUnread', () => {
    it('should fetch unread notifications', async () => {
      const mockUnread = [
        { id: 'n1', status: 'unread', urgency_score: 80 },
        { id: 'n2', status: 'unread', urgency_score: 70 },
      ];

      mockChain.limit.mockResolvedValue({ data: mockUnread, error: null });

      const result = await repository.findUnread();

      expect(mockChain.eq).toHaveBeenCalledWith('status', 'unread');
      expect(result).toHaveLength(2);
    });
  });

  describe('findByShipment', () => {
    it('should fetch notifications for a shipment', async () => {
      const mockNotifications = [
        { id: 'n1', shipment_id: 'ship-1', notification_type: 'deadline_advisory' },
      ];

      mockChain.order.mockResolvedValue({ data: mockNotifications, error: null });

      const result = await repository.findByShipment('ship-1');

      expect(mockChain.eq).toHaveBeenCalledWith('shipment_id', 'ship-1');
      expect(result).toHaveLength(1);
    });
  });

  describe('create', () => {
    it('should create a new notification', async () => {
      const newNotification = {
        email_id: 'email-1',
        notification_type: 'deadline_advisory',
        title: 'SI Deadline',
        status: 'unread',
        priority: 'high',
      };

      const createdNotification = { id: 'notif-1', ...newNotification };
      mockChain.single.mockResolvedValue({ data: createdNotification, error: null });

      const result = await repository.create(newNotification as any);

      expect(mockFrom).toHaveBeenCalledWith('notifications');
      expect(result.id).toBe('notif-1');
    });

    it('should throw error when creation fails', async () => {
      mockChain.single.mockResolvedValue({ data: null, error: { message: 'Insert failed' } });

      await expect(repository.create({} as any))
        .rejects.toThrow('Failed to create notification');
    });
  });

  describe('update', () => {
    it('should update notification', async () => {
      const updated = { id: 'notif-1', status: 'read' };
      mockChain.single.mockResolvedValue({ data: updated, error: null });

      const result = await repository.update('notif-1', { status: 'read' });

      expect(mockChain.update).toHaveBeenCalled();
      expect(result.status).toBe('read');
    });
  });

  describe('updateStatus', () => {
    it('should update notification status with timestamp', async () => {
      const updated = {
        id: 'notif-1',
        status: 'acknowledged',
        status_changed_at: expect.any(String),
      };

      mockChain.single.mockResolvedValue({ data: updated, error: null });

      const result = await repository.updateStatus('notif-1', 'acknowledged', 'user-1');

      expect(result.status).toBe('acknowledged');
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      const updated = { id: 'notif-1', status: 'read' };
      mockChain.single.mockResolvedValue({ data: updated, error: null });

      const result = await repository.markAsRead('notif-1');

      expect(result.status).toBe('read');
    });
  });

  describe('acknowledge', () => {
    it('should acknowledge notification', async () => {
      const updated = { id: 'notif-1', status: 'acknowledged' };
      mockChain.single.mockResolvedValue({ data: updated, error: null });

      const result = await repository.acknowledge('notif-1');

      expect(result.status).toBe('acknowledged');
    });
  });

  describe('bulkUpdateStatus', () => {
    it('should update multiple notifications', async () => {
      const updated = [{ id: 'n1' }, { id: 'n2' }];
      mockChain.select.mockResolvedValue({ data: updated, error: null });

      const result = await repository.bulkUpdateStatus(['n1', 'n2'], 'read', 'user-1');

      expect(result).toBe(2);
    });
  });

  describe('getActions', () => {
    it('should fetch actions for a notification', async () => {
      const mockActions = [
        { id: 'a1', notification_id: 'n1', action_type: 'viewed' },
        { id: 'a2', notification_id: 'n1', action_type: 'acknowledged' },
      ];

      mockChain.order.mockResolvedValue({ data: mockActions, error: null });

      const result = await repository.getActions('n1');

      expect(mockFrom).toHaveBeenCalledWith('notification_actions');
      expect(result).toHaveLength(2);
    });
  });

  describe('createAction', () => {
    it('should create notification action', async () => {
      const action = { notification_id: 'n1', action_type: 'acknowledged', performed_by: 'user-1' };
      const created = { id: 'a1', ...action };

      mockChain.single.mockResolvedValue({ data: created, error: null });

      const result = await repository.createAction(action as any);

      expect(mockFrom).toHaveBeenCalledWith('notification_actions');
      expect(result.id).toBe('a1');
    });
  });

  describe('getStatistics', () => {
    it('should calculate notification statistics', async () => {
      const mockNotifications = [
        { status: 'unread', priority: 'high', notification_type: 'deadline_advisory', urgency_score: 80, deadline_date: null },
        { status: 'unread', priority: 'critical', notification_type: 'rollover_notice', urgency_score: 90, deadline_date: null },
        { status: 'read', priority: 'medium', notification_type: 'deadline_advisory', urgency_score: 50, deadline_date: null },
      ];

      const mockConfigs = [
        { notification_type: 'deadline_advisory', category: 'deadline' },
        { notification_type: 'rollover_notice', category: 'vessel' },
      ];

      mockChain.select.mockResolvedValueOnce({ data: mockNotifications, error: null });
      mockChain.select.mockResolvedValueOnce({ data: mockConfigs, error: null });

      const result = await repository.getStatistics();

      expect(result.total).toBe(3);
      expect(result.unread).toBe(2);
      expect(result.byStatus.unread).toBe(2);
      expect(result.byStatus.read).toBe(1);
      expect(result.byPriority.high).toBe(1);
      expect(result.byPriority.critical).toBe(1);
      expect(result.urgentCount).toBe(2); // urgency_score >= 70
    });

    it('should count overdue deadlines', async () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString(); // Yesterday

      const mockNotifications = [
        { status: 'unread', priority: 'high', notification_type: 'deadline', urgency_score: 80, deadline_date: pastDate },
      ];

      const mockConfigs: any[] = [];

      mockChain.select.mockResolvedValueOnce({ data: mockNotifications, error: null });
      mockChain.select.mockResolvedValueOnce({ data: mockConfigs, error: null });

      const result = await repository.getStatistics();

      expect(result.overdueDeadlines).toBe(1);
    });
  });
});
