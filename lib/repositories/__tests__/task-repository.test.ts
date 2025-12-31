/**
 * Task Repository Tests
 *
 * Tests for ActionTask CRUD operations, status management,
 * insights, communications, and statistics.
 */

import { TaskRepository, TaskFilters } from '../task-repository';

// Mock Supabase client
const mockSelect = jest.fn();
const mockInsert = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockEq = jest.fn();
const mockIn = jest.fn();
const mockNot = jest.fn();
const mockOrder = jest.fn();
const mockRange = jest.fn();
const mockLimit = jest.fn();
const mockSingle = jest.fn();
const mockMaybeSingle = jest.fn();
const mockLte = jest.fn();
const mockGte = jest.fn();

const createMockChain = () => ({
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
  eq: mockEq,
  in: mockIn,
  not: mockNot,
  order: mockOrder,
  range: mockRange,
  limit: mockLimit,
  single: mockSingle,
  maybeSingle: mockMaybeSingle,
  lte: mockLte,
  gte: mockGte,
});

const mockFrom = jest.fn(() => createMockChain());

const mockSupabase = {
  from: mockFrom,
} as any;

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();

  // Setup default chain behavior
  mockSelect.mockReturnValue(createMockChain());
  mockInsert.mockReturnValue(createMockChain());
  mockUpdate.mockReturnValue(createMockChain());
  mockDelete.mockReturnValue(createMockChain());
  mockEq.mockReturnValue(createMockChain());
  mockIn.mockReturnValue(createMockChain());
  mockNot.mockReturnValue(createMockChain());
  mockOrder.mockReturnValue(createMockChain());
  mockRange.mockReturnValue(createMockChain());
  mockLimit.mockReturnValue(createMockChain());
  mockLte.mockReturnValue(createMockChain());
  mockGte.mockReturnValue(createMockChain());
});

describe('TaskRepository', () => {
  let repository: TaskRepository;

  beforeEach(() => {
    repository = new TaskRepository(mockSupabase);
  });

  describe('getTemplates', () => {
    it('should fetch active templates by default', async () => {
      const mockTemplates = [
        { id: '1', template_code: 'si_cutoff', template_name: 'SI Cutoff', is_active: true },
        { id: '2', template_code: 'vgm_cutoff', template_name: 'VGM Cutoff', is_active: true },
      ];

      mockEq.mockResolvedValue({ data: mockTemplates, error: null });

      const result = await repository.getTemplates();

      expect(mockFrom).toHaveBeenCalledWith('task_templates');
      expect(result).toEqual(mockTemplates);
    });

    it('should fetch all templates when activeOnly is false', async () => {
      const mockTemplates = [
        { id: '1', template_code: 'si_cutoff', is_active: true },
        { id: '2', template_code: 'old_template', is_active: false },
      ];

      // Chain: select -> order -> order (returns data)
      mockOrder.mockReturnValueOnce(createMockChain());
      mockOrder.mockResolvedValueOnce({ data: mockTemplates, error: null });

      const result = await repository.getTemplates(false);

      expect(mockFrom).toHaveBeenCalledWith('task_templates');
      expect(result).toEqual(mockTemplates);
    });

    it('should throw error on database failure', async () => {
      mockEq.mockResolvedValue({ data: null, error: { message: 'Database error' } });

      await expect(repository.getTemplates()).rejects.toThrow('Failed to fetch task templates');
    });
  });

  describe('getTemplateByCode', () => {
    it('should fetch template by code', async () => {
      const mockTemplate = { id: '1', template_code: 'si_cutoff', template_name: 'SI Cutoff' };

      mockSingle.mockResolvedValue({ data: mockTemplate, error: null });

      const result = await repository.getTemplateByCode('si_cutoff');

      expect(mockFrom).toHaveBeenCalledWith('task_templates');
      expect(result).toEqual(mockTemplate);
    });

    it('should return null when template not found', async () => {
      mockSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116', message: 'Not found' } });

      const result = await repository.getTemplateByCode('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a new task', async () => {
      const newTask = {
        title: 'Submit SI for Booking 123',
        description: 'Submit shipping instruction',
        category: 'deadline' as const,
        priority: 'high' as const,
        priority_score: 75,
        status: 'pending' as const,
        shipment_id: 'shipment-123',
      };

      const createdTask = { id: 'task-1', task_number: 1, ...newTask };

      // Mock for insert
      mockSingle.mockResolvedValueOnce({ data: createdTask, error: null });
      // Mock for activity log
      mockSingle.mockResolvedValueOnce({ data: { id: 'log-1' }, error: null });

      const result = await repository.create(newTask);

      expect(mockFrom).toHaveBeenCalledWith('action_tasks');
      expect(result).toEqual(createdTask);
    });

    it('should throw error when creation fails', async () => {
      mockSingle.mockResolvedValue({ data: null, error: { message: 'Insert failed' } });

      await expect(repository.create({
        title: 'Test',
        category: 'deadline',
        priority: 'medium',
        status: 'pending',
      } as any)).rejects.toThrow('Failed to create task');
    });
  });

  describe('findById', () => {
    it('should fetch task with relations', async () => {
      const mockTask = {
        id: 'task-1',
        title: 'Test Task',
        status: 'pending',
        shipment: { id: 's1', booking_number: 'BK123', carrier: { carrier_name: 'Maersk' } },
        notification: { id: 'n1', title: 'Notice', priority: 'high' },
      };

      mockSingle.mockResolvedValue({ data: mockTask, error: null });

      const result = await repository.findById('task-1');

      expect(mockFrom).toHaveBeenCalledWith('action_tasks');
      expect(result).toBeDefined();
      expect(result?.shipment?.carrier_name).toBe('Maersk');
    });

    it('should return null when task not found', async () => {
      mockSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

      const result = await repository.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('should update task status to completed', async () => {
      const existingTask = { id: 'task-1', status: 'in_progress', title: 'Test' };
      const updatedTask = { ...existingTask, status: 'completed', completed_at: expect.any(String) };

      // Mock findById
      mockSingle.mockResolvedValueOnce({ data: existingTask, error: null });
      // Mock update
      mockSingle.mockResolvedValueOnce({ data: updatedTask, error: null });
      // Mock activity log
      mockSingle.mockResolvedValueOnce({ data: { id: 'log-1' }, error: null });

      const result = await repository.updateStatus('task-1', 'completed', 'user-1', 'Done');

      expect(result.status).toBe('completed');
    });

    it('should throw error when task not found', async () => {
      mockSingle.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

      await expect(repository.updateStatus('nonexistent', 'completed')).rejects.toThrow('Task not found');
    });
  });

  describe('assignTask', () => {
    it('should assign task and update status to in_progress', async () => {
      const existingTask = { id: 'task-1', status: 'pending', assigned_to: null };
      const updatedTask = {
        ...existingTask,
        status: 'in_progress',
        assigned_to: 'user-1',
        assigned_to_name: 'John Doe',
      };

      mockSingle.mockResolvedValueOnce({ data: existingTask, error: null });
      mockSingle.mockResolvedValueOnce({ data: updatedTask, error: null });
      mockSingle.mockResolvedValueOnce({ data: { id: 'log-1' }, error: null });

      const result = await repository.assignTask('task-1', 'user-1', 'John Doe');

      expect(result.assigned_to).toBe('user-1');
      expect(result.status).toBe('in_progress');
    });
  });

  describe('getStatistics', () => {
    it('should calculate task statistics', async () => {
      const mockTasks = [
        { id: '1', status: 'pending', priority: 'high', category: 'deadline', due_date: null, completed_at: null, created_at: '2025-01-01' },
        { id: '2', status: 'completed', priority: 'medium', category: 'document', due_date: '2025-01-10', completed_at: '2025-01-05', created_at: '2025-01-01' },
        { id: '3', status: 'in_progress', priority: 'critical', category: 'deadline', due_date: '2025-01-02', completed_at: null, created_at: '2025-01-01' },
      ];

      mockSelect.mockResolvedValue({ data: mockTasks, error: null });

      const result = await repository.getStatistics();

      expect(result.total).toBe(3);
      expect(result.byStatus.pending).toBe(1);
      expect(result.byStatus.completed).toBe(1);
      expect(result.byStatus.in_progress).toBe(1);
      expect(result.byPriority.high).toBe(1);
      expect(result.byPriority.critical).toBe(1);
    });
  });

  describe('findExistingTask', () => {
    it('should find existing task by template and shipment', async () => {
      const mockTask = { id: 'task-1', template_code: 'si_cutoff', shipment_id: 's1' };

      mockMaybeSingle.mockResolvedValue({ data: mockTask, error: null });

      const result = await repository.findExistingTask('si_cutoff', 's1');

      expect(result).toEqual(mockTask);
    });

    it('should return null when no existing task', async () => {
      mockMaybeSingle.mockResolvedValue({ data: null, error: null });

      const result = await repository.findExistingTask('si_cutoff', 's1');

      expect(result).toBeNull();
    });
  });

  describe('bulkUpdateStatus', () => {
    it('should update multiple tasks', async () => {
      const updatedTasks = [{ id: 'task-1' }, { id: 'task-2' }];

      mockSelect.mockResolvedValue({ data: updatedTasks, error: null });

      const result = await repository.bulkUpdateStatus(['task-1', 'task-2'], 'completed', 'user-1');

      expect(result).toBe(2);
    });
  });

  describe('createInsight', () => {
    it('should create task insight', async () => {
      const insight = {
        task_id: 'task-1',
        insight_type: 'why_recommended',
        title: 'Deadline approaching',
        content: 'The SI cutoff is in 2 days',
        confidence_score: 0.95,
      };

      const createdInsight = { id: 'insight-1', ...insight };

      mockSingle.mockResolvedValueOnce({ data: createdInsight, error: null });
      mockSingle.mockResolvedValueOnce({ data: { id: 'log-1' }, error: null });

      const result = await repository.createInsight(insight as any);

      expect(mockFrom).toHaveBeenCalledWith('task_insights');
      expect(result.id).toBe('insight-1');
    });
  });

  describe('getCommunications', () => {
    it('should fetch communications for a task', async () => {
      const mockComms = [
        { id: 'comm-1', task_id: 'task-1', subject: 'RE: SI Submission', status: 'sent' },
        { id: 'comm-2', task_id: 'task-1', subject: 'SI Submission', status: 'sent' },
      ];

      // Chain: select -> eq -> order (returns data)
      mockOrder.mockResolvedValueOnce({ data: mockComms, error: null });

      const result = await repository.getCommunications('task-1');

      expect(mockFrom).toHaveBeenCalledWith('communication_log');
      expect(result).toHaveLength(2);
    });
  });
});
