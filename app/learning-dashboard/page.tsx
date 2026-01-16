'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  RefreshCw,
  Check,
  X,
  ChevronLeft,
  ChevronRight,
  Activity,
  BookOpen,
  AlertTriangle,
  TrendingUp,
  Eye,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react';

// Types
interface Stats {
  patterns: {
    active: number;
    pending: number;
    newToday: number;
    disabledThisWeek: number;
  };
  classifications: {
    forReview: number;
    last24h: number;
  };
  accuracy: {
    rate: number;
    total: number;
    correct: number;
    period: string;
  };
}

interface Pattern {
  id: string;
  carrier_id: string;
  pattern_type: string;
  document_type: string;
  pattern: string;
  enabled: boolean;
  hit_count: number;
  false_positive_count: number;
  accuracy: number | null;
  source: string;
  created_at: string;
}

interface PendingPattern {
  id: string;
  carrier_id: string;
  pattern_type: string;
  document_type: string;
  pattern: string;
  sample_count: number;
  accuracy_rate: number;
  discovered_at: string;
  status: string;
}

interface Classification {
  id: string;
  chronicleId: string;
  subject: string;
  fromAddress: string;
  predictedDocumentType: string;
  currentDocumentType: string;
  confidence: number;
  predictionMethod: string;
  needsReview: boolean;
  reviewReason: string;
  shipmentStage: string | null;
  flowValidationPassed: boolean;
  occurredAt: string;
  // Priority fields for queue ordering
  reviewPriority: number;
  priorityFactors: Record<string, unknown>;
}

// Helper to get priority badge color and label
function getPriorityBadge(priority: number): { color: string; label: string } {
  if (priority >= 80) return { color: 'bg-red-100 text-red-700 border-red-200', label: 'URGENT' };
  if (priority >= 65) return { color: 'bg-orange-100 text-orange-700 border-orange-200', label: 'HIGH' };
  if (priority >= 50) return { color: 'bg-amber-100 text-amber-700 border-amber-200', label: 'MEDIUM' };
  return { color: 'bg-gray-100 text-gray-600 border-gray-200', label: 'LOW' };
}

// Tab type
type Tab = 'overview' | 'patterns' | 'pending' | 'classifications';

export default function LearningDashboardPage() {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<Stats | null>(null);

  // Pattern state
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [patternPage, setPatternPage] = useState(1);
  const [patternTotal, setPatternTotal] = useState(0);
  const [patternFilter, setPatternFilter] = useState<'all' | 'enabled' | 'disabled'>('all');

  // Pending pattern state
  const [pendingPatterns, setPendingPatterns] = useState<PendingPattern[]>([]);
  const [pendingPage, setPendingPage] = useState(1);
  const [pendingTotal, setPendingTotal] = useState(0);

  // Classification state
  const [classifications, setClassifications] = useState<Classification[]>([]);
  const [classPage, setClassPage] = useState(1);
  const [classTotal, setClassTotal] = useState(0);
  const [classFilter, setClassFilter] = useState<string>('needs_review');

  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Fetch stats
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/learning/stats');
      const data = await res.json();
      if (!data.error) {
        setStats(data);
      }
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  }, []);

  // Fetch patterns
  const fetchPatterns = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: patternPage.toString(),
        limit: '20',
      });
      if (patternFilter !== 'all') {
        params.set('enabled', patternFilter === 'enabled' ? 'true' : 'false');
      }

      const res = await fetch(`/api/learning/patterns?${params}`);
      const data = await res.json();
      if (!data.error) {
        setPatterns(data.patterns);
        setPatternTotal(data.pagination.total);
      }
    } catch (error) {
      console.error('Failed to fetch patterns:', error);
    } finally {
      setLoading(false);
    }
  }, [patternPage, patternFilter]);

  // Fetch pending patterns
  const fetchPendingPatterns = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pendingPage.toString(),
        limit: '20',
      });

      const res = await fetch(`/api/learning/patterns/pending?${params}`);
      const data = await res.json();
      if (!data.error) {
        setPendingPatterns(data.patterns);
        setPendingTotal(data.pagination.total);
      }
    } catch (error) {
      console.error('Failed to fetch pending patterns:', error);
    } finally {
      setLoading(false);
    }
  }, [pendingPage]);

  // Fetch classifications
  const fetchClassifications = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: classPage.toString(),
        limit: '20',
        filter: classFilter,
      });

      const res = await fetch(`/api/learning/classifications?${params}`);
      const data = await res.json();
      if (!data.error) {
        setClassifications(data.classifications);
        setClassTotal(data.pagination.total);
      }
    } catch (error) {
      console.error('Failed to fetch classifications:', error);
    } finally {
      setLoading(false);
    }
  }, [classPage, classFilter]);

  // Initial load
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Tab-based data loading
  useEffect(() => {
    if (activeTab === 'patterns') {
      fetchPatterns();
    } else if (activeTab === 'pending') {
      fetchPendingPatterns();
    } else if (activeTab === 'classifications') {
      fetchClassifications();
    }
  }, [activeTab, fetchPatterns, fetchPendingPatterns, fetchClassifications]);

  // Handle pending pattern action
  const handlePendingAction = async (id: string, action: 'approve' | 'reject') => {
    setActionLoading(id);
    try {
      const res = await fetch('/api/learning/patterns/pending', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });

      const data = await res.json();
      if (data.success) {
        setPendingPatterns(prev => prev.filter(p => p.id !== id));
        fetchStats(); // Refresh stats
      }
    } catch (error) {
      console.error('Action failed:', error);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle pattern toggle
  const handlePatternToggle = async (id: string, enabled: boolean) => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/learning/patterns/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });

      const data = await res.json();
      if (data.pattern) {
        setPatterns(prev => prev.map(p => p.id === id ? { ...p, enabled } : p));
      }
    } catch (error) {
      console.error('Toggle failed:', error);
    } finally {
      setActionLoading(null);
    }
  };

  // Handle classification confirm
  const handleClassificationAction = async (id: string, action: 'confirm' | 'correct') => {
    setActionLoading(id);
    try {
      const res = await fetch(`/api/learning/classifications/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });

      const data = await res.json();
      if (data.success) {
        setClassifications(prev => prev.filter(c => c.id !== id));
        fetchStats();
      }
    } catch (error) {
      console.error('Action failed:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Learning Dashboard</h1>
            <p className="text-gray-500 text-sm mt-1">
              Monitor and manage classification patterns and learning
            </p>
          </div>
          <button
            onClick={() => {
              fetchStats();
              if (activeTab === 'patterns') fetchPatterns();
              else if (activeTab === 'pending') fetchPendingPatterns();
              else if (activeTab === 'classifications') fetchClassifications();
            }}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Stats Cards */}
        {stats && (
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <BookOpen className="w-4 h-4 text-blue-500" />
                <span className="text-sm text-gray-500">Patterns</span>
              </div>
              <div className="text-2xl font-semibold text-gray-900">{stats.patterns.active}</div>
              <div className="text-xs text-gray-400">
                +{stats.patterns.newToday} today | {stats.patterns.pending} pending
              </div>
            </div>

            <div className="bg-white rounded-lg border border-amber-200 p-4 bg-amber-50">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span className="text-sm text-amber-600">For Review</span>
              </div>
              <div className="text-2xl font-semibold text-amber-700">{stats.classifications.forReview}</div>
              <div className="text-xs text-amber-500">
                {stats.classifications.last24h} processed today
              </div>
            </div>

            <div className="bg-white rounded-lg border border-green-200 p-4 bg-green-50">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-green-500" />
                <span className="text-sm text-green-600">Accuracy</span>
              </div>
              <div className="text-2xl font-semibold text-green-700">{stats.accuracy.rate}%</div>
              <div className="text-xs text-green-500">
                {stats.accuracy.correct}/{stats.accuracy.total} ({stats.accuracy.period})
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-purple-500" />
                <span className="text-sm text-gray-500">Cleanup</span>
              </div>
              <div className="text-2xl font-semibold text-gray-900">{stats.patterns.disabledThisWeek}</div>
              <div className="text-xs text-gray-400">patterns disabled this week</div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-lg w-fit">
          {(['overview', 'patterns', 'pending', 'classifications'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab === 'overview' && 'Overview'}
              {tab === 'patterns' && 'Patterns'}
              {tab === 'pending' && `Pending (${stats?.patterns.pending || 0})`}
              {tab === 'classifications' && `For Review (${stats?.classifications.forReview || 0})`}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        <div className="bg-white rounded-lg border border-gray-200">
          {/* Overview Tab */}
          {activeTab === 'overview' && stats && (
            <div className="p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">System Overview</h2>
              <div className="grid grid-cols-2 gap-6">
                <div className="border border-gray-200 rounded-lg p-4">
                  <h3 className="font-medium text-gray-700 mb-3">Pattern Performance</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Active patterns</span>
                      <span className="font-medium">{stats.patterns.active}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Pending approval</span>
                      <span className="font-medium text-amber-600">{stats.patterns.pending}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Disabled this week</span>
                      <span className="font-medium text-red-600">{stats.patterns.disabledThisWeek}</span>
                    </div>
                  </div>
                </div>

                <div className="border border-gray-200 rounded-lg p-4">
                  <h3 className="font-medium text-gray-700 mb-3">Classification Quality</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-500">7-day accuracy</span>
                      <span className="font-medium text-green-600">{stats.accuracy.rate}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Total classifications</span>
                      <span className="font-medium">{stats.accuracy.total}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-500">Awaiting review</span>
                      <span className="font-medium text-amber-600">{stats.classifications.forReview}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Patterns Tab */}
          {activeTab === 'patterns' && (
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Detection Patterns</h2>
                <select
                  value={patternFilter}
                  onChange={(e) => {
                    setPatternFilter(e.target.value as 'all' | 'enabled' | 'disabled');
                    setPatternPage(1);
                  }}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
                >
                  <option value="all">All Patterns</option>
                  <option value="enabled">Enabled Only</option>
                  <option value="disabled">Disabled Only</option>
                </select>
              </div>

              <div className="space-y-2">
                {patterns.map(pattern => (
                  <div
                    key={pattern.id}
                    className={`border rounded-lg p-4 ${pattern.enabled ? 'border-gray-200' : 'border-gray-100 bg-gray-50'}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <code className="text-sm bg-gray-100 px-2 py-1 rounded">{pattern.pattern}</code>
                          <span className="text-xs text-gray-400">→</span>
                          <span className="text-sm font-medium text-blue-600">{pattern.document_type}</span>
                        </div>
                        <div className="flex items-center gap-4 text-xs text-gray-400">
                          <span>{pattern.carrier_id}</span>
                          <span>Hits: {pattern.hit_count || 0}</span>
                          <span>Accuracy: {pattern.accuracy !== null ? `${pattern.accuracy}%` : 'N/A'}</span>
                          <span>Source: {pattern.source}</span>
                        </div>
                      </div>
                      <button
                        onClick={() => handlePatternToggle(pattern.id, !pattern.enabled)}
                        disabled={actionLoading === pattern.id}
                        className={`px-3 py-1 rounded text-sm ${
                          pattern.enabled
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                        }`}
                      >
                        {pattern.enabled ? 'Enabled' : 'Disabled'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination */}
              {patternTotal > 20 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <span className="text-sm text-gray-500">
                    Page {patternPage} of {Math.ceil(patternTotal / 20)}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPatternPage(p => Math.max(1, p - 1))}
                      disabled={patternPage <= 1}
                      className="px-3 py-1 border rounded text-sm disabled:opacity-50"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setPatternPage(p => p + 1)}
                      disabled={patternPage >= Math.ceil(patternTotal / 20)}
                      className="px-3 py-1 border rounded text-sm disabled:opacity-50"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Pending Patterns Tab */}
          {activeTab === 'pending' && (
            <div className="p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Auto-Discovered Patterns</h2>
              <p className="text-sm text-gray-500 mb-4">
                These patterns were discovered from repeated AI classifications. Review and approve or reject.
              </p>

              {pendingPatterns.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No pending patterns to review
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingPatterns.map(pattern => (
                    <div key={pattern.id} className="border border-amber-200 bg-amber-50 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <code className="text-sm bg-white px-2 py-1 rounded">{pattern.pattern}</code>
                            <span className="text-xs text-gray-400">→</span>
                            <span className="text-sm font-medium text-blue-600">{pattern.document_type}</span>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-gray-500">
                            <span>Discovered from {pattern.sample_count} classifications</span>
                            <span>Accuracy: {Math.round(pattern.accuracy_rate * 100)}%</span>
                            <span>{formatDate(pattern.discovered_at)}</span>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => handlePendingAction(pattern.id, 'approve')}
                            disabled={actionLoading === pattern.id}
                            className="flex items-center gap-1 px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
                          >
                            <ThumbsUp className="w-4 h-4" />
                            Approve
                          </button>
                          <button
                            onClick={() => handlePendingAction(pattern.id, 'reject')}
                            disabled={actionLoading === pattern.id}
                            className="flex items-center gap-1 px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700 disabled:opacity-50"
                          >
                            <ThumbsDown className="w-4 h-4" />
                            Reject
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Classifications Tab */}
          {activeTab === 'classifications' && (
            <div className="p-6">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Classifications for Review</h2>
                <select
                  value={classFilter}
                  onChange={(e) => {
                    setClassFilter(e.target.value);
                    setClassPage(1);
                  }}
                  className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
                >
                  <option value="needs_review">Needs Review</option>
                  <option value="impossible">Impossible Flow</option>
                  <option value="low_confidence">Low Confidence</option>
                  <option value="action_override">Action Override</option>
                  <option value="all">All</option>
                </select>
              </div>

              {classifications.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  No classifications to review
                </div>
              ) : (
                <div className="space-y-3">
                  {classifications.map(classification => {
                    const priorityBadge = getPriorityBadge(classification.reviewPriority || 50);
                    return (
                      <div key={classification.id} className="border border-gray-200 rounded-lg p-4">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              {/* Priority Badge */}
                              <span className={`text-xs px-2 py-0.5 rounded border font-medium ${priorityBadge.color}`}>
                                {priorityBadge.label}
                              </span>
                              <span className="text-xs text-gray-400">P{classification.reviewPriority || 50}</span>
                            </div>
                            <div className="font-medium text-gray-900 mb-1 truncate">
                              {classification.subject}
                            </div>
                            <div className="flex items-center gap-2 mb-2">
                              <span className="text-sm text-gray-600">
                                AI: <span className="font-medium">{classification.predictedDocumentType}</span>
                              </span>
                              {classification.confidence && (
                                <span className={`text-xs px-2 py-0.5 rounded ${
                                  classification.confidence >= 80 ? 'bg-green-100 text-green-700' :
                                  classification.confidence >= 60 ? 'bg-amber-100 text-amber-700' :
                                  'bg-red-100 text-red-700'
                                }`}>
                                  {classification.confidence}%
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-4 text-xs text-gray-400">
                              <span>{classification.fromAddress}</span>
                              {classification.shipmentStage && (
                                <span>Stage: {classification.shipmentStage}</span>
                              )}
                              {classification.reviewReason && (
                                <span className="text-amber-500">Reason: {classification.reviewReason}</span>
                              )}
                              <span>{formatDate(classification.occurredAt)}</span>
                            </div>
                          </div>
                          <div className="flex gap-2 ml-4">
                            <button
                              onClick={() => handleClassificationAction(classification.id, 'confirm')}
                              disabled={actionLoading === classification.id}
                              className="flex items-center gap-1 px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
                            >
                              <Check className="w-4 h-4" />
                              Correct
                            </button>
                            <button
                              onClick={() => window.open(`/api/learning/classifications/${classification.id}`, '_blank')}
                              className="flex items-center gap-1 px-3 py-1 border border-gray-200 rounded text-sm hover:bg-gray-50"
                            >
                              <Eye className="w-4 h-4" />
                              Details
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Pagination */}
              {classTotal > 20 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <span className="text-sm text-gray-500">
                    Page {classPage} of {Math.ceil(classTotal / 20)}
                  </span>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setClassPage(p => Math.max(1, p - 1))}
                      disabled={classPage <= 1}
                      className="px-3 py-1 border rounded text-sm disabled:opacity-50"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => setClassPage(p => p + 1)}
                      disabled={classPage >= Math.ceil(classTotal / 20)}
                      className="px-3 py-1 border rounded text-sm disabled:opacity-50"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
