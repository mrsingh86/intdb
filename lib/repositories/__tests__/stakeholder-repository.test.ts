/**
 * Stakeholder Repository Tests
 *
 * Tests for Party CRUD, behavior metrics, sentiment logs,
 * extraction queue, relationships, and statistics.
 */

import { StakeholderRepository, StakeholderNotFoundError, DuplicateStakeholderError } from '../stakeholder-repository';

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
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'in', 'or', 'not', 'order', 'range', 'limit',
    'single', 'ilike', 'contains', 'gte', 'lte', 'maybeSingle'
  ];

  methods.forEach(method => {
    chain[method] = jest.fn().mockReturnValue(chain);
  });

  return chain;
};

let mockChain: ReturnType<typeof createChainableMock>;
const mockFrom = jest.fn();
const mockRpc = jest.fn();

const mockSupabase = {
  from: mockFrom,
  rpc: mockRpc,
} as any;

beforeEach(() => {
  jest.clearAllMocks();
  mockChain = createChainableMock();
  mockFrom.mockReturnValue(mockChain);
});

describe('StakeholderRepository', () => {
  let repository: StakeholderRepository;

  beforeEach(() => {
    repository = new StakeholderRepository(mockSupabase);
  });

  describe('findAll', () => {
    it('should fetch stakeholders with pagination', async () => {
      const mockParties = [
        { id: '1', party_name: 'Acme Corp', party_type: 'shipper' },
        { id: '2', party_name: 'Global Imports', party_type: 'consignee' },
      ];

      mockChain._setResolveValue({ data: mockParties, error: null, count: 50 });

      const result = await repository.findAll({}, { page: 1, limit: 10 });

      expect(mockFrom).toHaveBeenCalledWith('parties');
      expect(result.data).toEqual(mockParties);
      expect(result.pagination.total).toBe(50);
      expect(result.pagination.totalPages).toBe(5);
    });

    it('should apply party_type filter', async () => {
      mockChain._setResolveValue({ data: [], error: null, count: 0 });

      await repository.findAll({ party_type: ['shipper', 'consignee'] }, { page: 1, limit: 10 });

      expect(mockChain.in).toHaveBeenCalledWith('party_type', ['shipper', 'consignee']);
    });

    it('should apply is_customer filter', async () => {
      mockChain._setResolveValue({ data: [], error: null, count: 0 });

      await repository.findAll({ is_customer: true }, { page: 1, limit: 10 });

      expect(mockChain.eq).toHaveBeenCalledWith('is_customer', true);
    });

    it('should throw error on database failure', async () => {
      mockChain._setResolveValue({ data: null, error: { message: 'Database error' } });

      await expect(repository.findAll({}, { page: 1, limit: 10 }))
        .rejects.toThrow('Failed to fetch stakeholders');
    });
  });

  describe('findById', () => {
    it('should fetch stakeholder by ID', async () => {
      const mockParty = { id: 'party-1', party_name: 'Acme Corp' };
      mockChain.single.mockResolvedValue({ data: mockParty, error: null });

      const result = await repository.findById('party-1');

      expect(mockFrom).toHaveBeenCalledWith('parties');
      expect(result).toEqual(mockParty);
    });

    it('should throw StakeholderNotFoundError when not found', async () => {
      mockChain.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

      await expect(repository.findById('nonexistent'))
        .rejects.toThrow(StakeholderNotFoundError);
    });
  });

  describe('findByName', () => {
    it('should search stakeholders by name', async () => {
      const mockParties = [
        { id: '1', party_name: 'Acme Corp' },
        { id: '2', party_name: 'Acme Industries' },
      ];

      mockChain.limit.mockResolvedValue({ data: mockParties, error: null });

      const result = await repository.findByName('Acme');

      expect(mockChain.ilike).toHaveBeenCalledWith('party_name', '%Acme%');
      expect(result).toHaveLength(2);
    });
  });

  describe('findByExactName', () => {
    it('should find stakeholder by exact name', async () => {
      const mockParty = { id: '1', party_name: 'Acme Corp', party_type: 'shipper' };
      mockChain.single.mockResolvedValue({ data: mockParty, error: null });

      const result = await repository.findByExactName('Acme Corp', 'shipper');

      expect(mockChain.eq).toHaveBeenCalledWith('party_name', 'Acme Corp');
      expect(result).toEqual(mockParty);
    });

    it('should return null when not found', async () => {
      mockChain.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });

      const result = await repository.findByExactName('Nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findByEmailDomain', () => {
    it('should find stakeholders by email domain', async () => {
      const mockParties = [{ id: '1', email_domains: ['acme.com'] }];
      mockChain.contains.mockResolvedValue({ data: mockParties, error: null });

      const result = await repository.findByEmailDomain('acme.com');

      expect(mockChain.contains).toHaveBeenCalledWith('email_domains', ['acme.com']);
      expect(result).toHaveLength(1);
    });
  });

  describe('findCustomers', () => {
    it('should fetch all customers', async () => {
      const mockCustomers = [
        { id: '1', party_name: 'Customer A', is_customer: true },
        { id: '2', party_name: 'Customer B', is_customer: true },
      ];

      mockChain.order.mockResolvedValue({ data: mockCustomers, error: null });

      const result = await repository.findCustomers();

      expect(mockChain.eq).toHaveBeenCalledWith('is_customer', true);
      expect(result).toHaveLength(2);
    });
  });

  describe('create', () => {
    it('should create a new stakeholder', async () => {
      const newParty = { party_name: 'New Corp', party_type: 'shipper' };
      const createdParty = { id: 'party-1', ...newParty };

      mockChain.single.mockResolvedValue({ data: createdParty, error: null });

      const result = await repository.create(newParty);

      expect(mockFrom).toHaveBeenCalledWith('parties');
      expect(result.id).toBe('party-1');
    });

    it('should throw DuplicateStakeholderError on conflict', async () => {
      mockChain.single.mockResolvedValue({ data: null, error: { code: '23505', message: 'Duplicate' } });

      await expect(repository.create({ party_name: 'Existing' }))
        .rejects.toThrow(DuplicateStakeholderError);
    });
  });

  describe('update', () => {
    it('should update existing stakeholder', async () => {
      const updatedParty = { id: 'party-1', party_name: 'Updated Name' };
      mockChain.single.mockResolvedValue({ data: updatedParty, error: null });

      const result = await repository.update('party-1', { party_name: 'Updated Name' });

      expect(mockChain.update).toHaveBeenCalled();
      expect(result.party_name).toBe('Updated Name');
    });
  });

  describe('getBehaviorMetrics', () => {
    it('should fetch behavior metrics for a stakeholder', async () => {
      const mockMetrics = [
        { id: 'm1', party_id: 'p1', metric_period: 'monthly', shipment_count: 10 },
      ];

      mockChain.limit.mockResolvedValue({ data: mockMetrics, error: null });

      const result = await repository.getBehaviorMetrics('p1');

      expect(mockFrom).toHaveBeenCalledWith('stakeholder_behavior_metrics');
      expect(result).toHaveLength(1);
    });
  });

  describe('saveBehaviorMetrics', () => {
    it('should save behavior metrics', async () => {
      const metrics = {
        party_id: 'p1',
        metric_period: 'monthly',
        period_start: '2025-01-01',
        shipment_count: 15,
      };

      const savedMetrics = { id: 'm1', ...metrics };
      mockChain.single.mockResolvedValue({ data: savedMetrics, error: null });

      const result = await repository.saveBehaviorMetrics(metrics as any);

      expect(mockFrom).toHaveBeenCalledWith('stakeholder_behavior_metrics');
      expect(result.id).toBe('m1');
    });
  });

  describe('getSentimentLogs', () => {
    it('should fetch sentiment logs', async () => {
      const mockLogs = [
        { id: 'l1', party_id: 'p1', sentiment: 'positive', sentiment_score: 0.8 },
      ];

      mockChain.limit.mockResolvedValue({ data: mockLogs, error: null });

      const result = await repository.getSentimentLogs('p1');

      expect(mockFrom).toHaveBeenCalledWith('stakeholder_sentiment_log');
      expect(result).toHaveLength(1);
    });
  });

  describe('getAverageSentimentScore', () => {
    it('should calculate average sentiment score', async () => {
      const mockLogs = [
        { sentiment_score: 0.8 },
        { sentiment_score: 0.6 },
        { sentiment_score: 0.7 },
      ];

      mockChain.limit.mockResolvedValue({ data: mockLogs, error: null });

      const result = await repository.getAverageSentimentScore('p1');

      expect(result).toBeCloseTo(0.7, 1);
    });

    it('should return null when no logs exist', async () => {
      mockChain.limit.mockResolvedValue({ data: [], error: null });

      const result = await repository.getAverageSentimentScore('p1');

      expect(result).toBeNull();
    });
  });

  describe('getPendingExtractions', () => {
    it('should fetch pending extractions', async () => {
      const mockQueue = [
        { id: 'q1', email_id: 'e1', extraction_status: 'pending' },
      ];

      mockChain.limit.mockResolvedValue({ data: mockQueue, error: null });

      const result = await repository.getPendingExtractions();

      expect(mockFrom).toHaveBeenCalledWith('stakeholder_extraction_queue');
      expect(mockChain.eq).toHaveBeenCalledWith('extraction_status', 'pending');
      expect(result).toHaveLength(1);
    });
  });

  describe('queueForExtraction', () => {
    it('should add email to extraction queue', async () => {
      const queueEntry = { id: 'q1', email_id: 'e1', extraction_status: 'pending' };
      mockChain.single.mockResolvedValue({ data: queueEntry, error: null });

      const result = await repository.queueForExtraction('e1');

      expect(mockFrom).toHaveBeenCalledWith('stakeholder_extraction_queue');
      expect(result.email_id).toBe('e1');
    });
  });

  describe('getRelationships', () => {
    it('should fetch relationships for a stakeholder', async () => {
      const mockRelationships = [
        { id: 'r1', party_a_id: 'p1', party_b_id: 'p2', relationship_type: 'shipper_consignee' },
      ];

      mockChain.order.mockResolvedValue({ data: mockRelationships, error: null });

      const result = await repository.getRelationships('p1');

      expect(mockFrom).toHaveBeenCalledWith('stakeholder_relationships');
      expect(result).toHaveLength(1);
    });
  });

  describe('getStatistics', () => {
    it('should calculate stakeholder statistics', async () => {
      const mockParties = [
        { party_type: 'shipper', is_customer: true, reliability_score: 80 },
        { party_type: 'shipper', is_customer: false, reliability_score: 70 },
        { party_type: 'consignee', is_customer: true, reliability_score: 90 },
      ];

      mockChain.select.mockResolvedValue({ data: mockParties, error: null });

      const result = await repository.getStatistics();

      expect(result.totalStakeholders).toBe(3);
      expect(result.totalCustomers).toBe(2);
      expect(result.byType.shipper).toBe(2);
      expect(result.byType.consignee).toBe(1);
      expect(result.avgReliabilityScore).toBe(80);
    });
  });
});
