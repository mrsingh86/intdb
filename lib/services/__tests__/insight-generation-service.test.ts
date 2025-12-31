/**
 * Insight Generation Service Tests
 *
 * Tests for generating AI-powered insights for tasks including
 * why recommended, risk assessment, deadline impact, stakeholder context,
 * and suggested actions.
 */

import { InsightGenerationService } from '../insight-generation-service';

// Create chainable mock for Supabase
const createChainableMock = () => {
  let resolveValue: any = { data: null, error: null };

  const chain: any = {
    _setResolveValue: (value: any) => { resolveValue = value; },
    then: (resolve: any, reject?: any) => Promise.resolve(resolveValue).then(resolve, reject),
  };

  const methods = ['select', 'insert', 'update', 'eq', 'in', 'order', 'single', 'limit'];
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
    findById: jest.fn(),
    createInsight: jest.fn(),
  })),
}));

const createMockTask = (overrides = {}) => ({
  id: 'task-1',
  title: 'Test Task',
  category: 'deadline',
  priority: 'high',
  priority_score: 75,
  status: 'pending',
  due_date: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), // 2 days from now
  shipment_id: 'ship-1',
  notification_id: null,
  stakeholder_id: null,
  priority_factors: {
    deadline_urgency: { score: 30, max: 35, reason: 'Due in 48 hours' },
    financial_impact: { score: 15, max: 20, reason: 'Standard impact' },
    notification_severity: { score: 10, max: 15, reason: 'Standard' },
    stakeholder_importance: { score: 10, max: 15, reason: 'Standard' },
    historical_pattern: { score: 5, max: 10, reason: 'No issues' },
    document_criticality: { score: 5, max: 5, reason: 'Standard' },
  },
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockChain = createChainableMock();
  mockFrom.mockReturnValue(mockChain);
});

describe('InsightGenerationService', () => {
  let service: InsightGenerationService;
  let mockRepository: any;

  beforeEach(() => {
    service = new InsightGenerationService(mockSupabase);
    mockRepository = (service as any).repository;
  });

  describe('generateInsightsForTask', () => {
    it('should throw error if task not found', async () => {
      mockRepository.findById.mockResolvedValue(null);

      await expect(service.generateInsightsForTask('nonexistent'))
        .rejects.toThrow('Task not found: nonexistent');
    });

    it('should generate multiple insights for a task', async () => {
      const mockTask = createMockTask();
      mockRepository.findById.mockResolvedValue(mockTask);
      mockRepository.createInsight.mockImplementation((insight: any) => ({
        id: `insight-${Date.now()}`,
        ...insight,
      }));

      // Mock shipment fetch
      mockChain._setResolveValue({
        data: {
          booking_number: 'BK123',
          vessel_name: 'Test Vessel',
          container_count: 3,
        },
        error: null,
      });

      const insights = await service.generateInsightsForTask('task-1');

      expect(insights.length).toBeGreaterThan(0);
      expect(mockRepository.createInsight).toHaveBeenCalled();
    });

    it('should handle missing shipment gracefully', async () => {
      const mockTask = createMockTask({ shipment_id: null });
      mockRepository.findById.mockResolvedValue(mockTask);
      mockRepository.createInsight.mockImplementation((insight: any) => ({
        id: `insight-${Date.now()}`,
        ...insight,
      }));

      const insights = await service.generateInsightsForTask('task-1');

      expect(insights.length).toBeGreaterThan(0);
    });
  });

  describe('generateWhyRecommended', () => {
    it('should include deadline urgency when score is high', async () => {
      const mockTask = createMockTask({
        priority_factors: {
          deadline_urgency: { score: 30, max: 35, reason: 'Due in 24 hours' },
          financial_impact: { score: 5, max: 20, reason: 'Low impact' },
          notification_severity: { score: 0, max: 15, reason: 'None' },
          stakeholder_importance: { score: 5, max: 15, reason: 'Standard' },
          historical_pattern: { score: 0, max: 10, reason: 'No data' },
          document_criticality: { score: 0, max: 5, reason: 'None' },
        },
      });

      mockRepository.findById.mockResolvedValue(mockTask);
      mockRepository.createInsight.mockImplementation((insight: any) => ({
        id: `insight-${Date.now()}`,
        ...insight,
      }));

      const insights = await service.generateInsightsForTask('task-1');
      const whyInsight = insights.find(i => i.insight_type === 'why_recommended');

      expect(whyInsight).toBeDefined();
      expect(whyInsight?.content).toContain('Deadline urgency');
    });
  });

  describe('generateRiskAssessment', () => {
    it('should return critical risk for overdue tasks', async () => {
      const mockTask = createMockTask({
        due_date: new Date(Date.now() - 86400000).toISOString(), // Yesterday
      });

      mockRepository.findById.mockResolvedValue(mockTask);
      mockRepository.createInsight.mockImplementation((insight: any) => ({
        id: `insight-${Date.now()}`,
        ...insight,
      }));

      const insights = await service.generateInsightsForTask('task-1');
      const riskInsight = insights.find(i => i.insight_type === 'risk_assessment');

      expect(riskInsight).toBeDefined();
      expect(riskInsight?.content).toContain('OVERDUE');
      expect(riskInsight?.supporting_data.risk_level).toBe('critical');
    });

    it('should assess stakeholder reliability risk', async () => {
      const mockTask = createMockTask({ stakeholder_id: 'stake-1' });

      mockRepository.findById.mockResolvedValue(mockTask);
      mockRepository.createInsight.mockImplementation((insight: any) => ({
        id: `insight-${Date.now()}`,
        ...insight,
      }));

      // Mock stakeholder with low reliability
      mockChain._setResolveValue({
        data: {
          party_name: 'Low Reliability Corp',
          party_type: 'shipper',
          is_customer: true,
          reliability_score: 50,
          total_shipments: 10,
        },
        error: null,
      });

      const insights = await service.generateInsightsForTask('task-1');
      const riskInsight = insights.find(i => i.insight_type === 'risk_assessment');

      expect(riskInsight).toBeDefined();
      expect(riskInsight?.content).toContain('low reliability score');
    });
  });

  describe('generateDeadlineImpact', () => {
    it('should not generate insight if no due date', async () => {
      const mockTask = createMockTask({ due_date: null });

      mockRepository.findById.mockResolvedValue(mockTask);
      mockRepository.createInsight.mockImplementation((insight: any) => ({
        id: `insight-${Date.now()}`,
        ...insight,
      }));

      const insights = await service.generateInsightsForTask('task-1');
      const deadlineInsight = insights.find(i => i.insight_type === 'deadline_impact');

      expect(deadlineInsight).toBeUndefined();
    });

    it('should generate urgent message for imminent deadline', async () => {
      const mockTask = createMockTask({
        due_date: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(), // 12 hours
      });

      mockRepository.findById.mockResolvedValue(mockTask);
      mockRepository.createInsight.mockImplementation((insight: any) => ({
        id: `insight-${Date.now()}`,
        ...insight,
      }));

      const insights = await service.generateInsightsForTask('task-1');
      const deadlineInsight = insights.find(i => i.insight_type === 'deadline_impact');

      expect(deadlineInsight).toBeDefined();
      expect(deadlineInsight?.content).toContain('hours');
      expect(deadlineInsight?.content).toContain('remaining');
    });
  });

  describe('generateStakeholderContext', () => {
    it('should not generate insight if no stakeholder', async () => {
      const mockTask = createMockTask({ stakeholder_id: null });

      mockRepository.findById.mockResolvedValue(mockTask);
      mockRepository.createInsight.mockImplementation((insight: any) => ({
        id: `insight-${Date.now()}`,
        ...insight,
      }));

      const insights = await service.generateInsightsForTask('task-1');
      const stakeholderInsight = insights.find(i => i.insight_type === 'stakeholder_context');

      expect(stakeholderInsight).toBeUndefined();
    });

    it('should include customer tier for customer stakeholders', async () => {
      const mockTask = createMockTask({ stakeholder_id: 'stake-1' });

      mockRepository.findById.mockResolvedValue(mockTask);
      mockRepository.createInsight.mockImplementation((insight: any) => ({
        id: `insight-${Date.now()}`,
        ...insight,
      }));

      mockChain._setResolveValue({
        data: {
          party_name: 'Platinum Corp',
          party_type: 'shipper',
          is_customer: true,
          priority_tier: 'platinum',
          reliability_score: 95,
          total_shipments: 100,
        },
        error: null,
      });

      const insights = await service.generateInsightsForTask('task-1');
      const stakeholderInsight = insights.find(i => i.insight_type === 'stakeholder_context');

      expect(stakeholderInsight).toBeDefined();
      expect(stakeholderInsight?.content).toContain('Platinum');
      expect(stakeholderInsight?.content).toContain('Customer Status');
    });
  });

  describe('generateSuggestedAction', () => {
    it('should generate deadline-specific steps for deadline tasks', async () => {
      const mockTask = createMockTask({ category: 'deadline' });

      mockRepository.findById.mockResolvedValue(mockTask);
      mockRepository.createInsight.mockImplementation((insight: any) => ({
        id: `insight-${Date.now()}`,
        ...insight,
      }));

      const insights = await service.generateInsightsForTask('task-1');
      const actionInsight = insights.find(i => i.insight_type === 'suggested_action');

      expect(actionInsight).toBeDefined();
      expect(actionInsight?.content).toContain('documentation');
      expect(actionInsight?.content).toContain('Submit');
    });

    it('should generate notification-specific steps for rollover', async () => {
      const mockTask = createMockTask({
        category: 'notification',
        notification_id: 'notif-1',
      });

      mockRepository.findById.mockResolvedValue(mockTask);
      mockRepository.createInsight.mockImplementation((insight: any) => ({
        id: `insight-${Date.now()}`,
        ...insight,
      }));

      mockChain._setResolveValue({
        data: {
          title: 'Rollover Notice',
          priority: 'high',
          notification_type: 'rollover',
        },
        error: null,
      });

      const insights = await service.generateInsightsForTask('task-1');
      const actionInsight = insights.find(i => i.insight_type === 'suggested_action');

      expect(actionInsight).toBeDefined();
      expect(actionInsight?.content).toContain('rollover');
    });

    it('should generate document-specific steps for document tasks', async () => {
      const mockTask = createMockTask({ category: 'document' });

      mockRepository.findById.mockResolvedValue(mockTask);
      mockRepository.createInsight.mockImplementation((insight: any) => ({
        id: `insight-${Date.now()}`,
        ...insight,
      }));

      const insights = await service.generateInsightsForTask('task-1');
      const actionInsight = insights.find(i => i.insight_type === 'suggested_action');

      expect(actionInsight).toBeDefined();
      expect(actionInsight?.content).toContain('Download');
      expect(actionInsight?.content).toContain('review');
    });
  });
});
