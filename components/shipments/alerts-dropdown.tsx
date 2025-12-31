'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Bell,
  AlertTriangle,
  Clock,
  X,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';

interface Alert {
  id: string;
  type: 'overdue' | 'approaching' | 'conflict';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  shipment_id: string;
  booking_number?: string;
  date_field: string;
  date_value: string;
  days_until?: number;
}

interface AlertsSummary {
  total: number;
  critical: number;
  warning: number;
  overdue: number;
  approaching: number;
}

export function AlertsDropdown() {
  const [isOpen, setIsOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [summary, setSummary] = useState<AlertsSummary>({ total: 0, critical: 0, warning: 0, overdue: 0, approaching: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchAlerts();
    // Refresh alerts every 5 minutes
    const interval = setInterval(fetchAlerts, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  const fetchAlerts = async () => {
    try {
      const response = await fetch('/api/shipments/alerts');
      if (response.ok) {
        const data = await response.json();
        setAlerts(data.alerts || []);
        setSummary(data.summary || { total: 0, critical: 0, warning: 0, overdue: 0, approaching: 0 });
      }
    } catch (error) {
      console.error('Failed to fetch alerts:', error);
    } finally {
      setLoading(false);
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-50 border-red-200 text-red-800';
      case 'warning':
        return 'bg-orange-50 border-orange-200 text-orange-800';
      default:
        return 'bg-blue-50 border-blue-200 text-blue-800';
    }
  };

  const getSeverityIcon = (severity: string, type: string) => {
    if (type === 'overdue') {
      return <AlertTriangle className="h-4 w-4 text-red-500" />;
    }
    if (severity === 'critical') {
      return <AlertCircle className="h-4 w-4 text-red-500" />;
    }
    return <Clock className="h-4 w-4 text-orange-500" />;
  };

  const formatDate = (date: string) => {
    try {
      return new Date(date).toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return date;
    }
  };

  const hasAlerts = summary.total > 0;
  const hasCritical = summary.critical > 0;

  return (
    <div className="relative z-50">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          relative p-2 rounded-lg transition-colors
          ${hasAlerts
            ? hasCritical
              ? 'bg-red-100 text-red-700 hover:bg-red-200'
              : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }
        `}
        title={`${summary.total} alert${summary.total !== 1 ? 's' : ''}`}
      >
        <Bell className="h-5 w-5" />
        {hasAlerts && (
          <span className={`
            absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center
            text-xs font-bold rounded-full px-1
            ${hasCritical ? 'bg-red-600 text-white' : 'bg-orange-600 text-white'}
          `}>
            {summary.total > 99 ? '99+' : summary.total}
          </span>
        )}
      </button>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />
          <div className="absolute right-0 mt-2 w-96 bg-white rounded-lg shadow-lg border border-gray-200 z-50 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-gray-600" />
                <h3 className="font-semibold text-gray-900">Alerts</h3>
                {summary.total > 0 && (
                  <span className="px-2 py-0.5 text-xs bg-gray-200 text-gray-700 rounded-full">
                    {summary.total}
                  </span>
                )}
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-gray-200 rounded"
              >
                <X className="h-4 w-4 text-gray-500" />
              </button>
            </div>

            {/* Summary */}
            {summary.total > 0 && (
              <div className="p-3 bg-gray-50 border-b border-gray-200 flex gap-4 text-xs">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-red-500 rounded-full" />
                  {summary.critical} Critical
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 bg-orange-500 rounded-full" />
                  {summary.warning} Warning
                </span>
                <span className="text-gray-400">|</span>
                <span className="text-gray-500">
                  {summary.overdue} Overdue, {summary.approaching} Approaching
                </span>
              </div>
            )}

            {/* Alerts List */}
            <div className="max-h-96 overflow-y-auto">
              {loading ? (
                <div className="p-8 text-center text-gray-500">
                  Loading alerts...
                </div>
              ) : alerts.length === 0 ? (
                <div className="p-8 text-center">
                  <Bell className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-gray-500">No alerts</p>
                  <p className="text-xs text-gray-400">All shipments are on track</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-100">
                  {alerts.slice(0, 10).map((alert) => (
                    <Link
                      key={alert.id}
                      href={`/shipments/${alert.shipment_id}`}
                      onClick={() => setIsOpen(false)}
                      className={`
                        block p-4 hover:bg-gray-50 transition-colors
                        ${alert.severity === 'critical' ? 'border-l-4 border-l-red-500' :
                          alert.severity === 'warning' ? 'border-l-4 border-l-orange-500' :
                          'border-l-4 border-l-blue-500'}
                      `}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 mt-0.5">
                          {getSeverityIcon(alert.severity, alert.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-sm text-gray-900 truncate">
                              {alert.title}
                            </span>
                            <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                          </div>
                          <p className="text-sm text-gray-600 truncate">
                            {alert.message}
                          </p>
                          <p className="text-xs text-gray-400 mt-1">
                            {formatDate(alert.date_value)}
                          </p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            {alerts.length > 10 && (
              <div className="p-3 border-t border-gray-200 bg-gray-50 text-center">
                <Link
                  href="/shipments?dateFilter=approaching"
                  onClick={() => setIsOpen(false)}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  View all {alerts.length} alerts
                </Link>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
