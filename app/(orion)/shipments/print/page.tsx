'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Shipment } from '@/types/shipment';

function PrintContent() {
  const searchParams = useSearchParams();
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Get filter params
        const status = searchParams.get('status');
        const ids = searchParams.get('ids');

        let url = '/api/shipments';
        const params = new URLSearchParams();
        if (status) params.set('status', status);
        if (ids) params.set('ids', ids);
        if (params.toString()) url += `?${params.toString()}`;

        const response = await fetch(url);
        const data = await response.json();
        setShipments(data.shipments || []);
      } catch (error) {
        console.error('Failed to fetch shipments:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [searchParams]);

  useEffect(() => {
    // Auto-print when data is loaded
    if (!loading && shipments.length > 0) {
      setTimeout(() => {
        window.print();
      }, 500);
    }
  }, [loading, shipments]);

  const formatDate = (date: string | null | undefined) => {
    if (!date) return '-';
    try {
      return new Date(date).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
      });
    } catch {
      return date;
    }
  };

  const formatDateTime = (date: string | null | undefined) => {
    if (!date) return '-';
    try {
      return new Date(date).toLocaleString('en-US', {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return date;
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center">
        Loading shipments data...
      </div>
    );
  }

  if (shipments.length === 0) {
    return (
      <div className="p-8 text-center">
        No shipments to display.
      </div>
    );
  }

  return (
    <div className="print-container">
      <style jsx global>{`
        @media print {
          @page {
            size: landscape;
            margin: 0.5in;
          }
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .no-print {
            display: none !important;
          }
        }
        .print-container {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 10px;
          padding: 20px;
        }
        .print-header {
          text-align: center;
          margin-bottom: 20px;
          border-bottom: 2px solid #333;
          padding-bottom: 10px;
        }
        .print-header h1 {
          font-size: 18px;
          margin: 0 0 5px 0;
        }
        .print-header p {
          color: #666;
          margin: 0;
        }
        .print-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 9px;
        }
        .print-table th, .print-table td {
          border: 1px solid #ddd;
          padding: 4px 6px;
          text-align: left;
        }
        .print-table th {
          background-color: #f5f5f5;
          font-weight: 600;
          white-space: nowrap;
        }
        .print-table tr:nth-child(even) {
          background-color: #fafafa;
        }
        .status-badge {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 4px;
          font-size: 8px;
          font-weight: 500;
        }
        .status-draft { background-color: #e5e7eb; color: #374151; }
        .status-booked { background-color: #dbeafe; color: #1e40af; }
        .status-in_transit { background-color: #fef3c7; color: #92400e; }
        .status-arrived { background-color: #e9d5ff; color: #6b21a8; }
        .status-delivered { background-color: #d1fae5; color: #065f46; }
        .status-cancelled { background-color: #fee2e2; color: #991b1b; }
        .cutoff-list {
          font-size: 8px;
          line-height: 1.3;
        }
        .cutoff-item {
          white-space: nowrap;
        }
        .print-footer {
          margin-top: 20px;
          padding-top: 10px;
          border-top: 1px solid #ddd;
          text-align: center;
          font-size: 9px;
          color: #666;
        }
        .print-btn {
          position: fixed;
          top: 10px;
          right: 10px;
          padding: 8px 16px;
          background: #2563eb;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        .print-btn:hover {
          background: #1d4ed8;
        }
      `}</style>

      <button className="print-btn no-print" onClick={() => window.print()}>
        Print / Save as PDF
      </button>

      <div className="print-header">
        <h1>Shipments Report</h1>
        <p>Generated on {new Date().toLocaleString()} | Total: {shipments.length} shipments</p>
      </div>

      <table className="print-table">
        <thead>
          <tr>
            <th>Booking #</th>
            <th>BL #</th>
            <th>Vessel / Voyage</th>
            <th>Route</th>
            <th>ETD</th>
            <th>ETA</th>
            <th>Cutoffs</th>
            <th>Cargo</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {shipments.map((shipment) => (
            <tr key={shipment.id}>
              <td>{shipment.booking_number || '-'}</td>
              <td>{shipment.bl_number || '-'}</td>
              <td>
                {shipment.vessel_name || '-'}
                {shipment.voyage_number && <><br />{shipment.voyage_number}</>}
              </td>
              <td>
                {shipment.port_of_loading || '-'}
                {' → '}
                {shipment.port_of_discharge || '-'}
              </td>
              <td>{formatDate(shipment.etd)}</td>
              <td>{formatDate(shipment.eta)}</td>
              <td>
                <div className="cutoff-list">
                  {shipment.si_cutoff && (
                    <div className="cutoff-item">SI: {formatDateTime(shipment.si_cutoff)}</div>
                  )}
                  {shipment.vgm_cutoff && (
                    <div className="cutoff-item">VGM: {formatDateTime(shipment.vgm_cutoff)}</div>
                  )}
                  {shipment.cargo_cutoff && (
                    <div className="cutoff-item">Cargo: {formatDateTime(shipment.cargo_cutoff)}</div>
                  )}
                  {shipment.gate_cutoff && (
                    <div className="cutoff-item">Gate: {formatDateTime(shipment.gate_cutoff)}</div>
                  )}
                  {!shipment.si_cutoff && !shipment.vgm_cutoff && !shipment.cargo_cutoff && !shipment.gate_cutoff && '-'}
                </div>
              </td>
              <td>
                {shipment.commodity_description ? (
                  <>
                    {shipment.commodity_description.substring(0, 30)}
                    {shipment.commodity_description.length > 30 && '...'}
                    {shipment.total_weight && (
                      <><br />{shipment.total_weight} {shipment.weight_unit || 'KG'}</>
                    )}
                  </>
                ) : '-'}
              </td>
              <td>
                <span className={`status-badge status-${shipment.status}`}>
                  {shipment.status.replace('_', ' ').toUpperCase()}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="print-footer">
        <p>Freight Intelligence System - Confidential</p>
      </div>
    </div>
  );
}

export default function PrintPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center">Loading...</div>}>
      <PrintContent />
    </Suspense>
  );
}
