'use client';

import { useState } from 'react';
import {
  Lightbulb,
  AlertTriangle,
  TrendingUp,
  Target,
  ChevronDown,
  ChevronUp,
  ThumbsUp,
  ThumbsDown,
  Clock,
  Sparkles,
} from 'lucide-react';

// ============================================================================
// TYPES
// ============================================================================

interface Insight {
  id: string;
  insight_type: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  recommended_action?: string;
  source: 'rules' | 'ai' | 'hybrid';
  confidence: number;
  priority_boost: number;
  status: string;
  created_at: string;
}

interface InsightsCardProps {
  shipmentId?: string;
  taskId?: string;
  insights?: Insight[];
  loading?: boolean;
  onFeedback?: (insightId: string, helpful: boolean) => void;
  onAcknowledge?: (insightId: string) => void;
  compact?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SEVERITY_STYLES: Record<string, { bg: string; text: string; border: string; icon: string }> = {
  critical: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', icon: 'text-red-500' },
  high: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', icon: 'text-orange-500' },
  medium: { bg: 'bg-yellow-50', text: 'text-yellow-700', border: 'border-yellow-200', icon: 'text-yellow-500' },
  low: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', icon: 'text-blue-500' },
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  risk: AlertTriangle,
  pattern: TrendingUp,
  prediction: Target,
  recommendation: Lightbulb,
  rule_detected: AlertTriangle,
};

const SOURCE_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  rules: { label: 'Rules', icon: Target },
  ai: { label: 'AI', icon: Sparkles },
  hybrid: { label: 'AI+Rules', icon: Sparkles },
};

// ============================================================================
// COMPONENT
// ============================================================================

export function InsightsCard({
  insights = [],
  loading = false,
  onFeedback,
  onAcknowledge,
  compact = false,
}: InsightsCardProps) {
  const [expanded, setExpanded] = useState(!compact);
  const [expandedInsights, setExpandedInsights] = useState<Set<string>>(new Set());

  const toggleInsight = (id: string) => {
    setExpandedInsights(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Calculate total boost
  const totalBoost = insights.reduce((sum, i) => sum + (i.priority_boost || 0), 0);
  const criticalCount = insights.filter(i => i.severity === 'critical').length;
  const highCount = insights.filter(i => i.severity === 'high').length;

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center gap-2 mb-3">
          <Lightbulb className="h-5 w-5 text-yellow-500" />
          <h3 className="text-sm font-semibold text-gray-900">AI Insights</h3>
        </div>
        <div className="animate-pulse space-y-2">
          <div className="h-4 bg-gray-100 rounded w-3/4"></div>
          <div className="h-4 bg-gray-100 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (insights.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center gap-2 mb-2">
          <Lightbulb className="h-5 w-5 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900">AI Insights</h3>
        </div>
        <p className="text-sm text-gray-500">No insights detected for this shipment.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-yellow-100 rounded-lg">
            <Lightbulb className="h-5 w-5 text-yellow-600" />
          </div>
          <div className="text-left">
            <h3 className="text-sm font-semibold text-gray-900">
              AI Insights
              <span className="ml-2 text-xs font-normal text-gray-500">
                {insights.length} detected
              </span>
            </h3>
            <div className="flex items-center gap-2 mt-0.5">
              {criticalCount > 0 && (
                <span className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full">
                  {criticalCount} critical
                </span>
              )}
              {highCount > 0 && (
                <span className="text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full">
                  {highCount} high
                </span>
              )}
              {totalBoost > 0 && (
                <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full">
                  +{totalBoost} priority
                </span>
              )}
            </div>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="h-5 w-5 text-gray-400" />
        ) : (
          <ChevronDown className="h-5 w-5 text-gray-400" />
        )}
      </button>

      {/* Insights List */}
      {expanded && (
        <div className="border-t border-gray-100 divide-y divide-gray-100">
          {insights.map((insight) => {
            const styles = SEVERITY_STYLES[insight.severity] || SEVERITY_STYLES.medium;
            const TypeIcon = TYPE_ICONS[insight.insight_type] || Lightbulb;
            const sourceInfo = SOURCE_LABELS[insight.source] || SOURCE_LABELS.rules;
            const isExpanded = expandedInsights.has(insight.id);

            return (
              <div key={insight.id} className={`${styles.bg}`}>
                {/* Insight Header */}
                <button
                  onClick={() => toggleInsight(insight.id)}
                  className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-white/50 transition"
                >
                  <TypeIcon className={`h-5 w-5 mt-0.5 flex-shrink-0 ${styles.icon}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${styles.bg} ${styles.text} border ${styles.border}`}>
                        {insight.severity}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 flex items-center gap-1">
                        <sourceInfo.icon className="h-3 w-3" />
                        {sourceInfo.label}
                      </span>
                      {insight.priority_boost > 0 && (
                        <span className="text-xs text-purple-600">
                          +{insight.priority_boost} priority
                        </span>
                      )}
                    </div>
                    <h4 className={`text-sm font-medium mt-1 ${styles.text}`}>
                      {insight.title}
                    </h4>
                    {!isExpanded && (
                      <p className="text-xs text-gray-600 mt-1 line-clamp-1">
                        {insight.description}
                      </p>
                    )}
                  </div>
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
                  )}
                </button>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="px-4 pb-4 pl-12">
                    <p className="text-sm text-gray-700 mb-3">
                      {insight.description}
                    </p>

                    {insight.recommended_action && (
                      <div className="bg-white rounded-lg p-3 mb-3 border border-gray-200">
                        <div className="flex items-center gap-2 text-xs font-medium text-gray-500 mb-1">
                          <Target className="h-3 w-3" />
                          Recommended Action
                        </div>
                        <p className="text-sm text-gray-900">{insight.recommended_action}</p>
                      </div>
                    )}

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Clock className="h-3 w-3" />
                        {new Date(insight.created_at).toLocaleString()}
                        <span className="text-gray-300">•</span>
                        <span>{Math.round(insight.confidence * 100)}% confidence</span>
                      </div>

                      {onFeedback && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500">Helpful?</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onFeedback(insight.id, true);
                            }}
                            className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded"
                            title="Yes, helpful"
                          >
                            <ThumbsUp className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onFeedback(insight.id, false);
                            }}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                            title="Not helpful"
                          >
                            <ThumbsDown className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </div>

                    {onAcknowledge && insight.status === 'active' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onAcknowledge(insight.id);
                        }}
                        className="mt-3 w-full py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition"
                      >
                        Acknowledge Insight
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// COMPACT VARIANT
// ============================================================================

export function InsightsBadge({ insights = [] }: { insights?: Insight[] }) {
  const criticalCount = insights.filter(i => i.severity === 'critical').length;
  const highCount = insights.filter(i => i.severity === 'high').length;
  const totalBoost = insights.reduce((sum, i) => sum + (i.priority_boost || 0), 0);

  if (insights.length === 0) return null;

  return (
    <div className="flex items-center gap-1">
      <Sparkles className="h-4 w-4 text-yellow-500" />
      <span className="text-xs text-gray-500">{insights.length}</span>
      {criticalCount > 0 && (
        <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded">
          {criticalCount}!
        </span>
      )}
      {totalBoost > 0 && (
        <span className="text-xs text-purple-600">+{totalBoost}</span>
      )}
    </div>
  );
}
