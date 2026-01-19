'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Check, SkipForward, ChevronLeft, ChevronRight, FileText, Mail } from 'lucide-react';
import { DOCUMENT_TYPE_LABELS } from '@/lib/chronicle-v2/constants';

interface ReviewRecord {
  id: string;
  subject: string;
  document_type: string;
  summary: string;
  from_party: string;
  from_address: string;
  occurred_at: string;
  review_status: string | null;
  review_reason: string | null;
  original_document_type: string | null;
}

interface ReviewStats {
  total: number;
  pending: number;
  reviewed: number;
  skipped: number;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

// Get all document types for dropdown
const DOCUMENT_TYPES = Object.keys(DOCUMENT_TYPE_LABELS);

export default function ClassificationReviewPage() {
  const [records, setRecords] = useState<ReviewRecord[]>([]);
  const [stats, setStats] = useState<ReviewStats>({ total: 0, pending: 0, reviewed: 0, skipped: 0 });
  const [pagination, setPagination] = useState<Pagination>({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedTypes, setSelectedTypes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        pageSize: pagination.pageSize.toString(),
        status: statusFilter,
        documentType: typeFilter,
      });

      const res = await fetch(`/api/classification-review?${params}`);
      const data = await res.json();

      if (data.error) {
        console.error('API error:', data.error);
        return;
      }

      setRecords(data.records);
      setStats(data.stats);
      setPagination(data.pagination);

      // Initialize selected types
      const initial: Record<string, string> = {};
      data.records.forEach((r: ReviewRecord) => {
        initial[r.id] = r.document_type;
      });
      setSelectedTypes(initial);
    } catch (error) {
      console.error('Fetch error:', error);
    } finally {
      setLoading(false);
    }
  }, [pagination.page, statusFilter, typeFilter]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const handleSave = async (id: string) => {
    setSaving(id);
    try {
      const newType = selectedTypes[id];
      const res = await fetch('/api/classification-review', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'review', newDocumentType: newType }),
      });

      const data = await res.json();
      if (data.success) {
        // Remove from list
        setRecords(prev => prev.filter(r => r.id !== id));
        setStats(prev => ({
          ...prev,
          pending: Math.max(0, prev.pending - 1),
          reviewed: prev.reviewed + 1,
        }));
      }
    } catch (error) {
      console.error('Save error:', error);
    } finally {
      setSaving(null);
    }
  };

  const handleSkip = async (id: string) => {
    setSaving(id);
    try {
      const res = await fetch('/api/classification-review', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'skip' }),
      });

      const data = await res.json();
      if (data.success) {
        setRecords(prev => prev.filter(r => r.id !== id));
        setStats(prev => ({
          ...prev,
          pending: Math.max(0, prev.pending - 1),
          skipped: prev.skipped + 1,
        }));
      }
    } catch (error) {
      console.error('Skip error:', error);
    } finally {
      setSaving(null);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Classification Review</h1>
            <p className="text-gray-500 text-sm mt-1">Review and correct flagged document classifications</p>
          </div>
          <button
            onClick={() => fetchRecords()}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-2xl font-semibold text-gray-900">{stats.total}</div>
            <div className="text-sm text-gray-500">Total Flagged</div>
          </div>
          <div className="bg-white rounded-lg border border-amber-200 p-4 bg-amber-50">
            <div className="text-2xl font-semibold text-amber-700">{stats.pending}</div>
            <div className="text-sm text-amber-600">Pending</div>
          </div>
          <div className="bg-white rounded-lg border border-green-200 p-4 bg-green-50">
            <div className="text-2xl font-semibold text-green-700">{stats.reviewed}</div>
            <div className="text-sm text-green-600">Reviewed</div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="text-2xl font-semibold text-gray-500">{stats.skipped}</div>
            <div className="text-sm text-gray-400">Skipped</div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-4 mb-4">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPagination(prev => ({ ...prev, page: 1 }));
            }}
            className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm"
          >
            <option value="pending">Pending Review</option>
            <option value="reviewed">Already Reviewed</option>
            <option value="skipped">Skipped</option>
            <option value="all">All</option>
          </select>

          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPagination(prev => ({ ...prev, page: 1 }));
            }}
            className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm"
          >
            <option value="all">All Document Types</option>
            {DOCUMENT_TYPES.map(type => (
              <option key={type} value={type}>{DOCUMENT_TYPE_LABELS[type]}</option>
            ))}
          </select>
        </div>

        {/* Records List */}
        <div className="space-y-3">
          {loading && records.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
              Loading...
            </div>
          ) : records.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500">
              No records to review
            </div>
          ) : (
            records.map((record) => (
              <div
                key={record.id}
                className="bg-white rounded-lg border border-gray-200 p-4 hover:border-gray-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <Mail className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <span className="font-medium text-gray-900 truncate">{record.subject}</span>
                    </div>
                    <div className="text-sm text-gray-600 mb-2 line-clamp-2">
                      {record.summary || 'No summary available'}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-gray-400">
                      <span>{record.from_party}</span>
                      <span>{formatDate(record.occurred_at)}</span>
                      {record.review_reason && (
                        <span className="text-amber-500">Reason: {record.review_reason}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-gray-400">Current</span>
                      <span className="text-sm font-medium text-blue-600">
                        {DOCUMENT_TYPE_LABELS[record.document_type] || record.document_type}
                      </span>
                    </div>

                    <div className="text-gray-300">→</div>

                    <select
                      value={selectedTypes[record.id] || record.document_type}
                      onChange={(e) => setSelectedTypes(prev => ({ ...prev, [record.id]: e.target.value }))}
                      className="px-3 py-2 border border-gray-200 rounded-lg bg-white text-sm min-w-[180px]"
                    >
                      {DOCUMENT_TYPES.map(type => (
                        <option key={type} value={type}>{DOCUMENT_TYPE_LABELS[type]}</option>
                      ))}
                    </select>

                    <button
                      onClick={() => handleSave(record.id)}
                      disabled={saving === record.id}
                      className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors text-sm"
                    >
                      <Check className="w-4 h-4" />
                      Save
                    </button>

                    <button
                      onClick={() => handleSkip(record.id)}
                      disabled={saving === record.id}
                      className="flex items-center gap-1 px-3 py-2 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors text-sm"
                    >
                      <SkipForward className="w-4 h-4" />
                      Skip
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Pagination */}
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between mt-6">
            <div className="text-sm text-gray-500">
              Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                disabled={pagination.page <= 1}
                className="flex items-center gap-1 px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 text-sm"
              >
                <ChevronLeft className="w-4 h-4" />
                Previous
              </button>
              <button
                onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                disabled={pagination.page >= pagination.totalPages}
                className="flex items-center gap-1 px-3 py-2 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 text-sm"
              >
                Next
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
