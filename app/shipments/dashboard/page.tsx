'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Ship,
  Package,
  Clock,
  AlertTriangle,
  CheckCircle,
  Calendar,
  RefreshCw,
  ArrowRight,
  Bell,
  FileSearch,
  BarChart3,
  Download,
  Eye,
  FileText,
  Anchor,
  CircleCheckBig
} from 'lucide-react';
import { Shipment } from '@/types/shipment';
import { isDateApproaching, isDateOverdue } from '@/components/tracking';

interface Alert {
  id: string;
  type: 'overdue' | 'approaching';
  severity: 'critical' | 'warning';
  title: string;
  shipment_id: string;
  date_field: string;
  date_value: string;
}

export default function ShipmentsDashboardPage() {
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [resyncing, setResyncing] = useState(false);
  const [processing, setProcessing] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [shipmentsRes, alertsRes] = await Promise.all([
        fetch('/api/shipments?limit=500'),  // Fetch all shipments for dashboard stats
        fetch('/api/shipments/alerts')
      ]);

      if (shipmentsRes.ok) {
        const data = await shipmentsRes.json();
        setShipments(data.shipments || []);
      }

      if (alertsRes.ok) {
        const alertData = await alertsRes.json();
        setAlerts(alertData.alerts || []);
      }
    } catch (error) {
      console.error('Failed to fetch dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const stats = useMemo(() => {
    const now = new Date();
    const next7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    return {
      total: shipments.length,
      draft: shipments.filter(s => s.status === 'draft').length,
      booked: shipments.filter(s => s.status === 'booked').length,
      inTransit: shipments.filter(s => s.status === 'in_transit').length,
      delivered: shipments.filter(s => s.status === 'delivered').length,
      overdue: shipments.filter(s =>
        isDateOverdue(s.etd) || isDateOverdue(s.eta) ||
        isDateOverdue(s.si_cutoff) || isDateOverdue(s.vgm_cutoff) ||
        isDateOverdue(s.cargo_cutoff) || isDateOverdue(s.gate_cutoff)
      ).length,
      approaching: shipments.filter(s =>
        isDateApproaching(s.etd) || isDateApproaching(s.eta) ||
        isDateApproaching(s.si_cutoff) || isDateApproaching(s.vgm_cutoff) ||
        isDateApproaching(s.cargo_cutoff) || isDateApproaching(s.gate_cutoff)
      ).length,
      cutoffsThisWeek: shipments.filter(s => {
        const cutoffs = [s.si_cutoff, s.vgm_cutoff, s.cargo_cutoff, s.gate_cutoff].filter(Boolean);
        return cutoffs.some(c => {
          const d = new Date(c!);
          return d >= now && d <= next7Days;
        });
      }).length
    };
  }, [shipments]);

  // Workflow state breakdown - all document milestones
  const workflowStats = useMemo(() => {
    const countByState = (state: string) => shipments.filter(s => s.workflow_state === state).length;
    const countByPhase = (phase: string) => shipments.filter(s => s.workflow_phase === phase).length;

    return {
      // By phase
      pre_departure: countByPhase('pre_departure'),
      in_transit: countByPhase('in_transit'),
      arrival: countByPhase('arrival'),
      delivery: countByPhase('delivery'),
      // Pre-departure states - UPDATED to match actual DB values
      booking_received: countByState('booking_confirmation_received'),
      booking_confirmed: countByState('booking_confirmed'),
      packing_received: countByState('packing_received'),
      vgm_confirmed: countByState('vgm_confirmed'),
      si_draft_received: countByState('si_draft_received'),
      si_confirmed: countByState('si_confirmed'),
      // In-transit states - UPDATED to match actual DB values
      hbl_draft_sent: countByState('hbl_draft_sent'),
      invoice_received: countByState('invoice_received'),
      hbl_released: countByState('hbl_released'),
      // Arrival states - UPDATED to match actual DB values
      arrival_notice: countByState('arrival_notice_received'),
      customs_received: countByState('customs_received'),
      delivery_ordered: countByState('delivery_ordered'),
      // No workflow
      no_workflow: shipments.filter(s => !s.workflow_state).length,
    };
  }, [shipments]);

  const recentShipments = useMemo(() => {
    return [...shipments]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5);
  }, [shipments]);

  const urgentCutoffs = useMemo(() => {
    const now = new Date();
    const allCutoffs: { shipmentId: string; bookingNumber: string; type: string; date: Date }[] = [];

    shipments.forEach(s => {
      const cutoffTypes = [
        { type: 'SI', date: s.si_cutoff },
        { type: 'VGM', date: s.vgm_cutoff },
        { type: 'Cargo', date: s.cargo_cutoff },
        { type: 'Gate', date: s.gate_cutoff }
      ];

      cutoffTypes.forEach(({ type, date }) => {
        if (date) {
          const d = new Date(date);
          if (d >= now) {
            allCutoffs.push({
              shipmentId: s.id,
              bookingNumber: s.booking_number || 'N/A',
              type,
              date: d
            });
          }
        }
      });
    });

    return allCutoffs
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 8);
  }, [shipments]);

  // Upcoming departures (ETD)
  const upcomingDepartures = useMemo(() => {
    const now = new Date();
    return shipments
      .filter(s => s.etd && new Date(s.etd) >= now)
      .map(s => ({
        shipmentId: s.id,
        bookingNumber: s.booking_number || 'N/A',
        vessel: s.vessel_name || '-',
        port: s.port_of_loading || '-',
        date: new Date(s.etd!)
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 8);
  }, [shipments]);

  // Upcoming arrivals (ETA)
  const upcomingArrivals = useMemo(() => {
    const now = new Date();
    return shipments
      .filter(s => s.eta && new Date(s.eta) >= now)
      .map(s => ({
        shipmentId: s.id,
        bookingNumber: s.booking_number || 'N/A',
        vessel: s.vessel_name || '-',
        port: s.port_of_discharge || '-',
        date: new Date(s.eta!)
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime())
      .slice(0, 8);
  }, [shipments]);

  const resyncData = async () => {
    setResyncing(true);
    try {
      await fetch('/api/shipments/resync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      await fetchData();
    } catch (error) {
      console.error('Failed to resync:', error);
    } finally {
      setResyncing(false);
    }
  };

  const runAILinking = async () => {
    setProcessing(true);
    try {
      await fetch('/api/shipments/process-linking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      await fetchData();
    } catch (error) {
      console.error('Failed to run AI linking:', error);
    } finally {
      setProcessing(false);
    }
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getDaysUntil = (date: Date) => {
    const now = new Date();
    const diff = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return `${diff} days`;
  };

  const getUrgencyColor = (date: Date) => {
    const now = new Date();
    const diff = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diff <= 1) return 'text-red-600 bg-red-50';
    if (diff <= 3) return 'text-orange-600 bg-orange-50';
    return 'text-blue-600 bg-blue-50';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-8 w-8 animate-spin text-blue-600" />
            <span className="ml-3 text-gray-600">Loading dashboard...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Shipments Dashboard</h1>
            <p className="text-gray-500 mt-1">Overview of your shipment operations</p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={resyncData}
              disabled={resyncing}
              className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 flex items-center gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${resyncing ? 'animate-spin' : ''}`} />
              {resyncing ? 'Syncing...' : 'Sync Data'}
            </button>
            <button
              onClick={runAILinking}
              disabled={processing}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              <Ship className={`h-4 w-4 ${processing ? 'animate-pulse' : ''}`} />
              {processing ? 'Processing...' : 'Run AI Linking'}
            </button>
          </div>
        </div>

        {/* Workflow Breakdown & Quick Actions */}
        <div className="grid grid-cols-3 gap-6 mb-8">
          {/* Workflow Breakdown */}
          <div className="col-span-2 bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-semibold text-gray-900">Workflow Breakdown</h2>
                <span className="text-2xl font-bold text-gray-900">{stats.total}</span>
                <span className="text-sm text-gray-500">total shipments</span>
              </div>
              <Link
                href="/shipments/analytics"
                className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
              >
                View Analytics <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            {/* Phases with All Document Milestones */}
            <div className="grid grid-cols-4 gap-4">
              {/* Pre-Departure */}
              <div className="bg-blue-50 rounded-lg p-3">
                <Link href="/shipments?workflow_phase=pre_departure" className="flex items-center justify-between mb-2 hover:opacity-80">
                  <div className="flex items-center gap-1.5">
                    <FileText className="h-4 w-4 text-blue-600" />
                    <span className="text-xs font-semibold text-blue-700 uppercase">Pre-Departure</span>
                  </div>
                  <span className="text-lg font-bold text-blue-700">{workflowStats.pre_departure}</span>
                </Link>
                <div className="space-y-0.5 text-xs">
                  <WorkflowStatRow label="Booking (Rcvd)" value={workflowStats.booking_received} color="blue" state="booking_confirmation_received" />
                  <WorkflowStatRow label="Booking (OK)" value={workflowStats.booking_confirmed} color="blue" state="booking_confirmed" />
                  <WorkflowStatRow label="Packing (Rcvd)" value={workflowStats.packing_received} color="blue" state="packing_received" />
                  <WorkflowStatRow label="VGM (OK)" value={workflowStats.vgm_confirmed} color="blue" state="vgm_confirmed" />
                  <WorkflowStatRow label="SI Draft (Rcvd)" value={workflowStats.si_draft_received} color="blue" state="si_draft_received" />
                  <WorkflowStatRow label="SI (Confirmed)" value={workflowStats.si_confirmed} color="blue" state="si_confirmed" />
                </div>
              </div>

              {/* In Transit */}
              <div className="bg-yellow-50 rounded-lg p-3">
                <Link href="/shipments?workflow_phase=in_transit" className="flex items-center justify-between mb-2 hover:opacity-80">
                  <div className="flex items-center gap-1.5">
                    <Ship className="h-4 w-4 text-yellow-600" />
                    <span className="text-xs font-semibold text-yellow-700 uppercase">In Transit</span>
                  </div>
                  <span className="text-lg font-bold text-yellow-700">{workflowStats.in_transit}</span>
                </Link>
                <div className="space-y-0.5 text-xs">
                  <WorkflowStatRow label="HBL Draft (Sent)" value={workflowStats.hbl_draft_sent} color="yellow" state="hbl_draft_sent" />
                  <WorkflowStatRow label="Invoice (Rcvd)" value={workflowStats.invoice_received} color="yellow" state="invoice_received" />
                  <WorkflowStatRow label="HBL (Released)" value={workflowStats.hbl_released} color="yellow" state="hbl_released" />
                </div>
              </div>

              {/* Arrival */}
              <div className="bg-purple-50 rounded-lg p-3">
                <Link href="/shipments?workflow_phase=arrival" className="flex items-center justify-between mb-2 hover:opacity-80">
                  <div className="flex items-center gap-1.5">
                    <Anchor className="h-4 w-4 text-purple-600" />
                    <span className="text-xs font-semibold text-purple-700 uppercase">Arrival</span>
                  </div>
                  <span className="text-lg font-bold text-purple-700">{workflowStats.arrival}</span>
                </Link>
                <div className="space-y-0.5 text-xs">
                  <WorkflowStatRow label="Arrival (Rcvd)" value={workflowStats.arrival_notice} color="purple" state="arrival_notice_received" />
                  <WorkflowStatRow label="Customs (Rcvd)" value={workflowStats.customs_received} color="purple" state="customs_received" />
                  <WorkflowStatRow label="Delivery Order" value={workflowStats.delivery_ordered} color="purple" state="delivery_ordered" />
                </div>
              </div>

              {/* Delivered */}
              <div className="bg-green-50 rounded-lg p-3">
                <Link href="/shipments?workflow_phase=delivery" className="flex items-center justify-between mb-2 hover:opacity-80">
                  <div className="flex items-center gap-1.5">
                    <CircleCheckBig className="h-4 w-4 text-green-600" />
                    <span className="text-xs font-semibold text-green-700 uppercase">Delivered</span>
                  </div>
                  <span className="text-lg font-bold text-green-700">{workflowStats.delivery}</span>
                </Link>
                <div className="space-y-0.5 text-xs text-gray-400 text-center py-2">
                  No deliveries yet
                </div>
              </div>
            </div>

            {workflowStats.no_workflow > 0 && (
              <div className="mt-3 text-xs text-gray-400 text-center">
                {workflowStats.no_workflow} shipment{workflowStats.no_workflow !== 1 ? 's' : ''} without workflow state
              </div>
            )}
          </div>

          {/* Quick Actions */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h2>
            <div className="space-y-3">
              <QuickActionButton
                href="/shipments"
                icon={<Eye className="h-4 w-4" />}
                label="View All Shipments"
              />
              <QuickActionButton
                href="/shipments/link-review"
                icon={<FileSearch className="h-4 w-4" />}
                label="Review Link Candidates"
              />
              <QuickActionButton
                href="/shipments/analytics"
                icon={<BarChart3 className="h-4 w-4" />}
                label="View Analytics"
              />
              <QuickActionButton
                href="/api/shipments/export?format=xlsx"
                icon={<Download className="h-4 w-4" />}
                label="Export to Excel"
                download
              />
            </div>
          </div>
        </div>

        {/* Alerts */}
        <div className="mb-8">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-gray-600" />
                <h2 className="text-lg font-semibold text-gray-900">Active Alerts</h2>
                {alerts.length > 0 && (
                  <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full">
                    {alerts.length}
                  </span>
                )}
              </div>
            </div>
            {alerts.length === 0 ? (
              <div className="text-center py-6 text-gray-500">
                <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                <p>No active alerts - All shipments are on track</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3 max-h-48 overflow-y-auto">
                {alerts.slice(0, 6).map((alert) => (
                  <Link
                    key={alert.id}
                    href={`/shipments/${alert.shipment_id}`}
                    className={`
                      block p-3 rounded-lg border-l-4 hover:bg-gray-50 transition-colors
                      ${alert.severity === 'critical' ? 'border-l-red-500 bg-red-50' : 'border-l-orange-500 bg-orange-50'}
                    `}
                  >
                    <div className="flex items-center gap-2">
                      {alert.type === 'overdue' ? (
                        <AlertTriangle className="h-4 w-4 text-red-500 flex-shrink-0" />
                      ) : (
                        <Clock className="h-4 w-4 text-orange-500 flex-shrink-0" />
                      )}
                      <span className="font-medium text-sm text-gray-900 truncate">
                        {alert.title}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mt-1 ml-6">
                      {alert.date_field}: {new Date(alert.date_value).toLocaleDateString()}
                    </p>
                  </Link>
                ))}
              </div>
            )}
            {alerts.length > 6 && (
              <Link
                href="/shipments?dateFilter=approaching"
                className="block text-center text-sm text-blue-600 hover:text-blue-800 pt-3 border-t mt-3"
              >
                View all {alerts.length} alerts
              </Link>
            )}
          </div>
        </div>

        {/* Upcoming Cutoffs, Departures & Arrivals */}
        <div className="grid grid-cols-3 gap-6 mb-8">
          {/* Upcoming Cutoffs */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-orange-600" />
                <h2 className="text-lg font-semibold text-gray-900">Upcoming Cutoffs</h2>
              </div>
            </div>
            {urgentCutoffs.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Calendar className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                <p>No upcoming cutoffs</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {urgentCutoffs.map((cutoff, i) => (
                  <Link
                    key={i}
                    href={`/shipments/${cutoff.shipmentId}`}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`px-2 py-1 text-xs font-medium rounded ${getUrgencyColor(cutoff.date)}`}>
                        {cutoff.type}
                      </span>
                      <span className="text-sm text-gray-900 font-medium truncate max-w-24">
                        {cutoff.bookingNumber}
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-gray-600">{formatDate(cutoff.date)}</div>
                      <div className={`text-xs ${cutoff.date.getTime() - Date.now() < 2 * 24 * 60 * 60 * 1000 ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                        {getDaysUntil(cutoff.date)}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Upcoming Departures */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <Ship className="h-5 w-5 text-blue-600" />
                <h2 className="text-lg font-semibold text-gray-900">Upcoming Departures</h2>
              </div>
            </div>
            {upcomingDepartures.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Ship className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                <p>No upcoming departures</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {upcomingDepartures.map((dep, i) => (
                  <Link
                    key={i}
                    href={`/shipments/${dep.shipmentId}`}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-900 font-medium truncate">
                        {dep.bookingNumber}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {dep.port}
                      </div>
                    </div>
                    <div className="text-right ml-2">
                      <div className="text-sm text-gray-600">{formatDate(dep.date)}</div>
                      <div className={`text-xs ${dep.date.getTime() - Date.now() < 2 * 24 * 60 * 60 * 1000 ? 'text-blue-600 font-medium' : 'text-gray-500'}`}>
                        {getDaysUntil(dep.date)}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Upcoming Arrivals */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-green-600" />
                <h2 className="text-lg font-semibold text-gray-900">Upcoming Arrivals</h2>
              </div>
            </div>
            {upcomingArrivals.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <Package className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                <p>No upcoming arrivals</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {upcomingArrivals.map((arr, i) => (
                  <Link
                    key={i}
                    href={`/shipments/${arr.shipmentId}`}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-gray-900 font-medium truncate">
                        {arr.bookingNumber}
                      </div>
                      <div className="text-xs text-gray-500 truncate">
                        {arr.port}
                      </div>
                    </div>
                    <div className="text-right ml-2">
                      <div className="text-sm text-gray-600">{formatDate(arr.date)}</div>
                      <div className={`text-xs ${arr.date.getTime() - Date.now() < 2 * 24 * 60 * 60 * 1000 ? 'text-green-600 font-medium' : 'text-gray-500'}`}>
                        {getDaysUntil(arr.date)}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Shipments */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Recent Shipments</h2>
            <Link
              href="/shipments"
              className="text-sm text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              View All <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          {recentShipments.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <Ship className="h-8 w-8 mx-auto mb-2 text-gray-400" />
              <p>No shipments yet</p>
              <p className="text-sm">Run AI Linking to create shipments from emails</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <th className="pb-3">Booking #</th>
                    <th className="pb-3 w-16">Vessel</th>
                    <th className="pb-3">Route</th>
                    <th className="pb-3">ETD</th>
                    <th className="pb-3">Status</th>
                    <th className="pb-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recentShipments.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="py-3 font-medium text-gray-900">
                        {s.booking_number || '-'}
                      </td>
                      <td className="py-3 text-gray-600 w-16 max-w-16 truncate" title={s.vessel_name || ''}>
                        {s.vessel_name || '-'}
                      </td>
                      <td className="py-3 text-gray-600">
                        {s.port_of_loading && s.port_of_discharge
                          ? `${s.port_of_loading} → ${s.port_of_discharge}`
                          : '-'}
                      </td>
                      <td className="py-3 text-gray-600">
                        {s.etd ? new Date(s.etd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '-'}
                      </td>
                      <td className="py-3">
                        <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(s.status)}`}>
                          {s.status.replace('_', ' ').toUpperCase()}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <Link
                          href={`/shipments/${s.id}`}
                          className="text-blue-600 hover:text-blue-800 text-sm"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusPill({
  label,
  value,
  color,
  subtitle
}: {
  label: string;
  value: number;
  color: string;
  subtitle?: string;
}) {
  const colorClasses: Record<string, string> = {
    gray: 'bg-gray-100 text-gray-700',
    blue: 'bg-blue-100 text-blue-700',
    yellow: 'bg-yellow-100 text-yellow-700',
    green: 'bg-green-100 text-green-700',
    purple: 'bg-purple-100 text-purple-700'
  };

  return (
    <div className={`rounded-lg p-4 text-center ${colorClasses[color]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs font-medium">{label}</div>
      {subtitle && <div className="text-xs opacity-75">{subtitle}</div>}
    </div>
  );
}

function QuickActionButton({
  href,
  icon,
  label,
  download = false
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  download?: boolean;
}) {
  if (download) {
    return (
      <a
        href={href}
        download
        className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors text-gray-700"
      >
        {icon}
        <span className="text-sm font-medium">{label}</span>
      </a>
    );
  }

  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors text-gray-700"
    >
      {icon}
      <span className="text-sm font-medium">{label}</span>
    </Link>
  );
}

function getStatusColor(status: string): string {
  switch (status) {
    case 'draft': return 'bg-gray-100 text-gray-700';
    case 'booked': return 'bg-blue-100 text-blue-700';
    case 'in_transit': return 'bg-yellow-100 text-yellow-700';
    case 'arrived': return 'bg-purple-100 text-purple-700';
    case 'delivered': return 'bg-green-100 text-green-700';
    case 'cancelled': return 'bg-red-100 text-red-700';
    default: return 'bg-gray-100 text-gray-700';
  }
}

function WorkflowStatRow({
  label,
  value,
  color,
  state
}: {
  label: string;
  value: number;
  color: string;
  state: string;
}) {
  const dotColors: Record<string, string> = {
    blue: 'bg-blue-500',
    yellow: 'bg-yellow-500',
    purple: 'bg-purple-500',
    green: 'bg-green-500',
    gray: 'bg-gray-400'
  };

  return (
    <Link
      href={`/shipments?workflow_state=${state}`}
      className="flex items-center justify-between py-1 hover:bg-white/50 rounded px-1 -mx-1 transition-colors cursor-pointer"
    >
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${dotColors[color] || 'bg-gray-400'}`} />
        <span className="text-gray-600 hover:text-gray-900">{label}</span>
      </div>
      <span className="font-semibold text-gray-900">{value}</span>
    </Link>
  );
}
