/**
 * Task Generation Service Tests
 *
 * Tests for generating tasks from notifications, deadlines,
 * documents, and manual creation.
 */

import { TaskGenerationService } from '../task-generation-service';

// Create chainable mock for Supabase
const createChainableMock = () => {
  let resolveValue: any = { data: null, error: null };

  const chain: any = {
    _setResolveValue: (value: any) => { resolveValue = value; },
    then: (resolve: any, reject?: any) => Promise.resolve(resolveValue).then(resolve, reject),
  };

  const methods = ['select', 'insert', 'update', 'eq', 'in', 'or', 'not', 'order', 'single', 'maybeSingle', 'limit', 'range'];
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

// Mock TaskRepository
jest.mock('@/lib/repositories/task-repository', () => ({
  TaskRepository: jest.fn().mockImplementation(() => ({
    findExistingTask: jest.fn(),
    getTemplateByCode: jest.fn(),
    create: jest.fn(),
    createInsight: jest.fn(),
  })),
}));

// Mock TaskPriorityService
jest.mock('@/lib/services/task-priority-service', () => ({
  TaskPriorityService: jest.fn().mockImplementation(() => ({
    calculatePriority: jest.fn().mockResolvedValue({
      priority: 'high',
      score: 75,
      factors: {
        deadline_urgency: { score: 30, max: 35, reason: 'Due in 24 hours' },
        financial_impact: { score: 15, max: 20, reason: 'Standard impact' },
        notification_severity: { score: 10, max: 15, reason: 'Standard' },
        stakeholder_importance: { score: 10, max: 15, reason: 'Standard' },
        historical_pattern: { score: 5, max: 10, reason: 'No issues' },
        document_criticality: { score: 5, max: 5, reason: 'Standard' },
      },
    }),
  })),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockChain = createChainableMock();
  mockFrom.mockReturnValue(mockChain);
});

describe('TaskGenerationService', () => {
  let service: TaskGenerationService;
  let mockRepository: any;
  let mockPriorityService: any;

  beforeEach(() => {
    service = new TaskGenerationService(mockSupabase);
    // Access mocked dependencies
    mockRepository = (service as any).repository;
    mockPriorityService = (service as any).priorityService;
  });

  describe('generateFromNotification', () => {
    it('should skip if notification type does not auto-generate tasks', async () => {
      mockChain._setResolveValue({ data: { auto_generate_task: false }, error: null });

      const notification = {
        id: 'notif-1',
        notification_type: 'info_only',
        shipment_id: 'ship-1',
        priority: 'low',
      } as any;

      const result = await service.generateFromNotification(notification);

      expect(result.generated).toBe(false);
      expect(result.reason).toBe('Notification type does not auto-generate tasks');
    });

    it('should skip if task already exists', async () => {
      mockChain._setResolveValue({
        data: { auto_generate_task: true, task_template_code: 'respond_rollover' },
        error: null,
      });
      mockRepository.findExistingTask.mockResolvedValue({ id: 'existing-task' });

      const notification = {
        id: 'notif-1',
        notification_type: 'rollover',
        shipment_id: 'ship-1',
        priority: 'high',
      } as any;

      const result = await service.generateFromNotification(notification);

      expect(result.generated).toBe(false);
      expect(result.reason).toBe('Task already exists for this notification');
      expect(result.existingTaskId).toBe('existing-task');
    });

    it('should generate task for notification', async () => {
      mockChain._setResolveValue({
        data: { auto_generate_task: true, task_template_code: 'respond_rollover' },
        error: null,
      });
      mockRepository.findExistingTask.mockResolvedValue(null);
      mockRepository.getTemplateByCode.mockResolvedValue({
        id: 'tmpl-1',
        default_title_template: 'Respond to Rollover: {booking_number}',
        template_category: 'notification',
      });
      mockRepository.create.mockResolvedValue({
        id: 'task-1',
        title: 'Respond to Rollover: BK123',
        status: 'pending',
      });

      const notification = {
        id: 'notif-1',
        notification_type: 'rollover',
        shipment_id: 'ship-1',
        priority: 'high',
      } as any;

      const result = await service.generateFromNotification(notification, {
        bookingNumber: 'BK123',
      });

      expect(result.generated).toBe(true);
      expect(result.task).toBeDefined();
      expect(result.task?.id).toBe('task-1');
    });
  });

  describe('generateFromDeadline', () => {
    it('should skip if task already exists', async () => {
      mockRepository.findExistingTask.mockResolvedValue({ id: 'existing-task' });

      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const result = await service.generateFromDeadline(
        'ship-1',
        'si_cutoff',
        futureDate
      );

      expect(result.generated).toBe(false);
      expect(result.reason).toBe('Task already exists for this deadline');
    });

    it('should skip if deadline has passed', async () => {
      mockRepository.findExistingTask.mockResolvedValue(null);

      const pastDate = new Date(Date.now() - 86400000).toISOString();
      const result = await service.generateFromDeadline(
        'ship-1',
        'si_cutoff',
        pastDate
      );

      expect(result.generated).toBe(false);
      expect(result.reason).toBe('Deadline has already passed');
    });

    it('should generate task for approaching deadline', async () => {
      mockRepository.findExistingTask.mockResolvedValue(null);
      mockRepository.getTemplateByCode.mockResolvedValue({
        id: 'tmpl-1',
        default_title_template: 'Submit SI: {booking_number}',
        template_category: 'deadline',
      });
      mockRepository.create.mockResolvedValue({
        id: 'task-1',
        title: 'Submit SI: BK123',
        status: 'pending',
      });

      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const result = await service.generateFromDeadline(
        'ship-1',
        'si_cutoff',
        futureDate,
        { bookingNumber: 'BK123' }
      );

      expect(result.generated).toBe(true);
      expect(result.task).toBeDefined();
    });
  });

  describe('generateFromDocument', () => {
    it('should generate review task for received document', async () => {
      mockRepository.findExistingTask.mockResolvedValue(null);
      mockRepository.getTemplateByCode.mockResolvedValue(null);
      mockRepository.create.mockResolvedValue({
        id: 'task-1',
        title: 'Review SI Draft: BK123',
        status: 'pending',
      });

      const result = await service.generateFromDocument(
        'ship-1',
        'si_draft',
        'received',
        { bookingNumber: 'BK123' }
      );

      expect(result.generated).toBe(true);
      expect(result.reason).toBe('Task generated for received document');
    });

    it('should generate request task for missing document', async () => {
      mockRepository.findExistingTask.mockResolvedValue(null);
      mockRepository.getTemplateByCode.mockResolvedValue(null);
      mockRepository.create.mockResolvedValue({
        id: 'task-1',
        title: 'Request BL',
        status: 'pending',
      });

      const result = await service.generateFromDocument(
        'ship-1',
        'bl',
        'missing'
      );

      expect(result.generated).toBe(true);
      expect(result.reason).toBe('Task generated for missing document');
    });
  });

  describe('generateManualTask', () => {
    it('should create manual task with custom title', async () => {
      mockRepository.create.mockResolvedValue({
        id: 'task-1',
        title: 'Custom Task',
        description: 'Custom description',
        status: 'pending',
      });

      const result = await service.generateManualTask(
        'Custom Task',
        'Custom description',
        'operational',
        { shipmentId: 'ship-1' }
      );

      expect(result.generated).toBe(true);
      expect(result.task?.title).toBe('Custom Task');
    });

    it('should create assigned task with in_progress status', async () => {
      mockRepository.create.mockResolvedValue({
        id: 'task-1',
        title: 'Assigned Task',
        status: 'in_progress',
        assigned_to: 'user-1',
      });

      const result = await service.generateManualTask(
        'Assigned Task',
        'Description',
        'operational',
        {},
        { assignTo: 'user-1', assignToName: 'John Doe' }
      );

      expect(result.generated).toBe(true);
      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'in_progress',
          assigned_to: 'user-1',
          assigned_to_name: 'John Doe',
        })
      );
    });
  });

  describe('generateDeadlineTasks', () => {
    it('should return empty result when no shipments found', async () => {
      mockChain._setResolveValue({ data: [], error: null });

      const result = await service.generateDeadlineTasks();

      expect(result.generated).toBe(0);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle database errors gracefully', async () => {
      mockChain._setResolveValue({ data: null, error: { message: 'Database error' } });

      const result = await service.generateDeadlineTasks();

      expect(result.errors).toContain('Failed to fetch shipments: Database error');
    });
  });
});
