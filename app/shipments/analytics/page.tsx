'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Ship,
  Package,
  Clock,
  AlertTriangle,
  CheckCircle,
  TrendingUp,
  Calendar,
  Anchor,
  RefreshCw
} from 'lucide-react';
import { Shipment } from '@/types/shipment';
import { isDateApproaching, isDateOverdue } from '@/components/tracking';

interface AnalyticsData {
  shipments: Shipment[];
  loading: boolean;
}

export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData>({ shipments: [], loading: true });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch('/api/shipments');
        const result = await response.json();
        setData({ shipments: result.shipments || [], loading: false });
      } catch (error) {
        console.error('Failed to fetch analytics:', error);
        setData(prev => ({ ...prev, loading: false }));
      }
    };
    fetchData();
  }, []);

  const analytics = useMemo(() => {
    const shipments = data.shipments;

    // Status breakdown
    const statusCounts = {
      draft: shipments.filter(s => s.status === 'draft').length,
      booked: shipments.filter(s => s.status === 'booked').length,
      in_transit: shipments.filter(s => s.status === 'in_transit').length,
      arrived: shipments.filter(s => s.status === 'arrived').length,
      delivered: shipments.filter(s => s.status === 'delivered').length,
      cancelled: shipments.filter(s => s.status === 'cancelled').length,
    };

    // Date urgency
    const overdueShipments = shipments.filter(s =>
      isDateOverdue(s.etd) || isDateOverdue(s.eta) ||
      isDateOverdue(s.si_cutoff) || isDateOverdue(s.vgm_cutoff) ||
      isDateOverdue(s.cargo_cutoff) || isDateOverdue(s.gate_cutoff)
    );

    const approachingShipments = shipments.filter(s =>
      isDateApproaching(s.etd) || isDateApproaching(s.eta) ||
      isDateApproaching(s.si_cutoff) || isDateApproaching(s.vgm_cutoff) ||
      isDateApproaching(s.cargo_cutoff) || isDateApproaching(s.gate_cutoff)
    );

    // Cutoffs breakdown (next 7 days)
    const now = new Date();
    const next7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const upcomingCutoffs = {
      si: shipments.filter(s => s.si_cutoff && new Date(s.si_cutoff) >= now && new Date(s.si_cutoff) <= next7Days).length,
      vgm: shipments.filter(s => s.vgm_cutoff && new Date(s.vgm_cutoff) >= now && new Date(s.vgm_cutoff) <= next7Days).length,
      cargo: shipments.filter(s => s.cargo_cutoff && new Date(s.cargo_cutoff) >= now && new Date(s.cargo_cutoff) <= next7Days).length,
      gate: shipments.filter(s => s.gate_cutoff && new Date(s.gate_cutoff) >= now && new Date(s.gate_cutoff) <= next7Days).length,
    };

    // Ports breakdown
    const portStats = {
      loading: new Map<string, number>(),
      discharge: new Map<string, number>(),
    };

    shipments.forEach(s => {
      if (s.port_of_loading) {
        portStats.loading.set(s.port_of_loading, (portStats.loading.get(s.port_of_loading) || 0) + 1);
      }
      if (s.port_of_discharge) {
        portStats.discharge.set(s.port_of_discharge, (portStats.discharge.get(s.port_of_discharge) || 0) + 1);
      }
    });

    const topLoadingPorts = Array.from(portStats.loading.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const topDischargePorts = Array.from(portStats.discharge.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Vessels breakdown
    const vesselStats = new Map<string, number>();
    shipments.forEach(s => {
      if (s.vessel_name) {
        vesselStats.set(s.vessel_name, (vesselStats.get(s.vessel_name) || 0) + 1);
      }
    });
    const topVessels = Array.from(vesselStats.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    // Monthly trend (last 6 months)
    const monthlyTrend: { month: string; count: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const monthKey = date.toISOString().slice(0, 7); // YYYY-MM
      const monthName = date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
      const count = shipments.filter(s => s.created_at?.slice(0, 7) === monthKey).length;
      monthlyTrend.push({ month: monthName, count });
    }

    // Data completeness
    const withBookingNumber = shipments.filter(s => s.booking_number).length;
    const withBLNumber = shipments.filter(s => s.bl_number).length;
    const withVessel = shipments.filter(s => s.vessel_name).length;
    const withPorts = shipments.filter(s => s.port_of_loading && s.port_of_discharge).length;
    const withDates = shipments.filter(s => s.etd && s.eta).length;

    return {
      total: shipments.length,
      statusCounts,
      overdueCount: overdueShipments.length,
      approachingCount: approachingShipments.length,
      upcomingCutoffs,
      topLoadingPorts,
      topDischargePorts,
      topVessels,
      monthlyTrend,
      completeness: {
        bookingNumber: shipments.length ? Math.round((withBookingNumber / shipments.length) * 100) : 0,
        blNumber: shipments.length ? Math.round((withBLNumber / shipments.length) * 100) : 0,
        vessel: shipments.length ? Math.round((withVessel / shipments.length) * 100) : 0,
        ports: shipments.length ? Math.round((withPorts / shipments.length) * 100) : 0,
        dates: shipments.length ? Math.round((withDates / shipments.length) * 100) : 0,
      },
    };
  }, [data.shipments]);

  if (data.loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
            <span className="ml-3 text-gray-600">Loading analytics...</span>
          </div>
        </div>
      </div>
    );
  }

  const maxTrendCount = Math.max(...analytics.monthlyTrend.map(t => t.count), 1);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <Link href="/shipments" className="flex items-center text-gray-600 hover:text-gray-900 mb-4">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Shipments
          </Link>
          <h1 className="text-3xl font-bold text-gray-900">Shipments Analytics</h1>
          <p className="text-gray-600 mt-1">Overview of {analytics.total} shipments</p>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-4 gap-6 mb-8">
          <SummaryCard
            icon={<Ship className="h-6 w-6 text-blue-600" />}
            label="Total Shipments"
            value={analytics.total}
            bgColor="bg-blue-50"
          />
          <SummaryCard
            icon={<TrendingUp className="h-6 w-6 text-green-600" />}
            label="In Transit"
            value={analytics.statusCounts.in_transit}
            bgColor="bg-green-50"
          />
          <SummaryCard
            icon={<Clock className="h-6 w-6 text-orange-600" />}
            label="Approaching Deadlines"
            value={analytics.approachingCount}
            bgColor="bg-orange-50"
          />
          <SummaryCard
            icon={<AlertTriangle className="h-6 w-6 text-red-600" />}
            label="Overdue"
            value={analytics.overdueCount}
            bgColor="bg-red-50"
          />
        </div>

        <div className="grid grid-cols-2 gap-6 mb-8">
          {/* Status Distribution */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Status Distribution</h2>
            <div className="space-y-3">
              <StatusBar label="Draft" count={analytics.statusCounts.draft} total={analytics.total} color="bg-gray-400" />
              <StatusBar label="Booked" count={analytics.statusCounts.booked} total={analytics.total} color="bg-blue-500" />
              <StatusBar label="In Transit" count={analytics.statusCounts.in_transit} total={analytics.total} color="bg-yellow-500" />
              <StatusBar label="Arrived" count={analytics.statusCounts.arrived} total={analytics.total} color="bg-purple-500" />
              <StatusBar label="Delivered" count={analytics.statusCounts.delivered} total={analytics.total} color="bg-green-500" />
              <StatusBar label="Cancelled" count={analytics.statusCounts.cancelled} total={analytics.total} color="bg-red-500" />
            </div>
          </div>

          {/* Upcoming Cutoffs */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Upcoming Cutoffs (Next 7 Days)</h2>
            <div className="grid grid-cols-2 gap-4">
              <CutoffCard label="SI Cutoff" count={analytics.upcomingCutoffs.si} icon={<Calendar className="h-5 w-5" />} />
              <CutoffCard label="VGM Cutoff" count={analytics.upcomingCutoffs.vgm} icon={<Package className="h-5 w-5" />} />
              <CutoffCard label="Cargo Cutoff" count={analytics.upcomingCutoffs.cargo} icon={<Package className="h-5 w-5" />} />
              <CutoffCard label="Gate Cutoff" count={analytics.upcomingCutoffs.gate} icon={<Anchor className="h-5 w-5" />} />
            </div>
          </div>
        </div>

        {/* Monthly Trend */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-lg font-semibold mb-4">Monthly Shipments Trend</h2>
          <div className="flex items-end justify-between h-48 gap-4">
            {analytics.monthlyTrend.map((trend, i) => (
              <div key={i} className="flex-1 flex flex-col items-center">
                <div className="w-full relative" style={{ height: '160px' }}>
                  <div
                    className="absolute bottom-0 w-full bg-blue-500 rounded-t transition-all duration-500"
                    style={{ height: `${(trend.count / maxTrendCount) * 100}%`, minHeight: trend.count > 0 ? '8px' : '0' }}
                  />
                </div>
                <div className="text-xs text-gray-500 mt-2">{trend.month}</div>
                <div className="text-sm font-medium">{trend.count}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-6 mb-8">
          {/* Top Loading Ports */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Top Loading Ports</h2>
            {analytics.topLoadingPorts.length === 0 ? (
              <p className="text-gray-400 text-sm">No data available</p>
            ) : (
              <div className="space-y-2">
                {analytics.topLoadingPorts.map(([port, count], i) => (
                  <div key={i} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                    <span className="text-sm text-gray-700">{port}</span>
                    <span className="text-sm font-medium bg-blue-100 text-blue-800 px-2 py-0.5 rounded">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top Discharge Ports */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Top Discharge Ports</h2>
            {analytics.topDischargePorts.length === 0 ? (
              <p className="text-gray-400 text-sm">No data available</p>
            ) : (
              <div className="space-y-2">
                {analytics.topDischargePorts.map(([port, count], i) => (
                  <div key={i} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                    <span className="text-sm text-gray-700">{port}</span>
                    <span className="text-sm font-medium bg-green-100 text-green-800 px-2 py-0.5 rounded">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top Vessels */}
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Top Vessels</h2>
            {analytics.topVessels.length === 0 ? (
              <p className="text-gray-400 text-sm">No data available</p>
            ) : (
              <div className="space-y-2">
                {analytics.topVessels.map(([vessel, count], i) => (
                  <div key={i} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                    <span className="text-sm text-gray-700 truncate flex-1 mr-2">{vessel}</span>
                    <span className="text-sm font-medium bg-purple-100 text-purple-800 px-2 py-0.5 rounded">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Data Completeness */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Data Completeness</h2>
          <div className="grid grid-cols-5 gap-6">
            <CompletenessGauge label="Booking #" percentage={analytics.completeness.bookingNumber} />
            <CompletenessGauge label="BL #" percentage={analytics.completeness.blNumber} />
            <CompletenessGauge label="Vessel" percentage={analytics.completeness.vessel} />
            <CompletenessGauge label="Ports" percentage={analytics.completeness.ports} />
            <CompletenessGauge label="ETD/ETA" percentage={analytics.completeness.dates} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  bgColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  bgColor: string;
}) {
  return (
    <div className={`${bgColor} rounded-lg p-6`}>
      <div className="flex items-center gap-3 mb-2">
        {icon}
        <span className="text-sm font-medium text-gray-600">{label}</span>
      </div>
      <div className="text-3xl font-bold text-gray-900">{value}</div>
    </div>
  );
}

function StatusBar({
  label,
  count,
  total,
  color,
}: {
  label: string;
  count: number;
  total: number;
  color: string;
}) {
  const percentage = total > 0 ? (count / total) * 100 : 0;

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium">{count} ({percentage.toFixed(0)}%)</span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} transition-all duration-500`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

function CutoffCard({
  label,
  count,
  icon,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
}) {
  const urgencyClass = count > 5 ? 'bg-red-50 border-red-200' :
                       count > 2 ? 'bg-orange-50 border-orange-200' :
                       count > 0 ? 'bg-yellow-50 border-yellow-200' :
                       'bg-gray-50 border-gray-200';

  return (
    <div className={`${urgencyClass} border rounded-lg p-4`}>
      <div className="flex items-center gap-2 text-gray-600 mb-1">
        {icon}
        <span className="text-sm">{label}</span>
      </div>
      <div className="text-2xl font-bold">{count}</div>
    </div>
  );
}

function CompletenessGauge({
  label,
  percentage,
}: {
  label: string;
  percentage: number;
}) {
  const colorClass = percentage >= 80 ? 'text-green-600' :
                     percentage >= 50 ? 'text-yellow-600' :
                     'text-red-600';

  const bgClass = percentage >= 80 ? 'stroke-green-500' :
                  percentage >= 50 ? 'stroke-yellow-500' :
                  'stroke-red-500';

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-20 h-20">
        <svg className="w-20 h-20 -rotate-90" viewBox="0 0 36 36">
          <circle
            className="stroke-gray-200"
            strokeWidth="3"
            fill="none"
            cx="18"
            cy="18"
            r="15.9155"
          />
          <circle
            className={bgClass}
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
            cx="18"
            cy="18"
            r="15.9155"
            strokeDasharray={`${percentage}, 100`}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-lg font-bold ${colorClass}`}>{percentage}%</span>
        </div>
      </div>
      <span className="text-sm text-gray-600 mt-2">{label}</span>
    </div>
  );
}
