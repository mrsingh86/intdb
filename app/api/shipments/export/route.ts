import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import * as XLSX from 'xlsx';
import { withAuth } from '@/lib/auth/server-auth';

/**
 * GET /api/shipments/export
 *
 * Export shipments data in CSV or Excel format.
 * Query params:
 *   - format: 'csv' | 'xlsx' (default: csv)
 *   - status: filter by status (comma-separated)
 *   - ids: specific shipment IDs to export (comma-separated)
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();
    const { searchParams } = new URL(request.url);

    const format = searchParams.get('format') || 'csv';
    const statusFilter = searchParams.get('status')?.split(',').filter(Boolean);
    const idFilter = searchParams.get('ids')?.split(',').filter(Boolean);

    // Build query
    let query = supabase
      .from('shipments')
      .select(`
        id,
        booking_number,
        bl_number,
        container_number_primary,
        vessel_name,
        voyage_number,
        port_of_loading,
        port_of_loading_code,
        port_of_discharge,
        port_of_discharge_code,
        place_of_receipt,
        place_of_delivery,
        etd,
        eta,
        atd,
        ata,
        cargo_ready_date,
        si_cutoff,
        vgm_cutoff,
        cargo_cutoff,
        gate_cutoff,
        commodity_description,
        total_weight,
        total_volume,
        weight_unit,
        volume_unit,
        incoterms,
        freight_terms,
        status,
        status_updated_at,
        created_at,
        updated_at
      `)
      .order('created_at', { ascending: false });

    // Apply filters
    if (statusFilter && statusFilter.length > 0) {
      query = query.in('status', statusFilter);
    }

    if (idFilter && idFilter.length > 0) {
      query = query.in('id', idFilter);
    }

    const { data: shipments, error } = await query;

    if (error) {
      console.error('[API:GET /shipments/export] Query error:', error);
      return NextResponse.json({ error: 'Failed to fetch shipments' }, { status: 500 });
    }

    if (!shipments || shipments.length === 0) {
      return NextResponse.json({ error: 'No shipments to export' }, { status: 404 });
    }

    // Transform data for export
    const exportData = shipments.map(s => ({
      'Booking Number': s.booking_number || '',
      'BL Number': s.bl_number || '',
      'Container Number': s.container_number_primary || '',
      'Vessel': s.vessel_name || '',
      'Voyage': s.voyage_number || '',
      'Port of Loading': s.port_of_loading || '',
      'POL Code': s.port_of_loading_code || '',
      'Port of Discharge': s.port_of_discharge || '',
      'POD Code': s.port_of_discharge_code || '',
      'Place of Receipt': s.place_of_receipt || '',
      'Place of Delivery': s.place_of_delivery || '',
      'ETD': formatDate(s.etd),
      'ETA': formatDate(s.eta),
      'ATD': formatDate(s.atd),
      'ATA': formatDate(s.ata),
      'Cargo Ready Date': formatDate(s.cargo_ready_date),
      'SI Cutoff': formatDateTime(s.si_cutoff),
      'VGM Cutoff': formatDateTime(s.vgm_cutoff),
      'Cargo Cutoff': formatDateTime(s.cargo_cutoff),
      'Gate Cutoff': formatDateTime(s.gate_cutoff),
      'Commodity': s.commodity_description || '',
      'Weight': s.total_weight ? `${s.total_weight} ${s.weight_unit || 'KG'}` : '',
      'Volume': s.total_volume ? `${s.total_volume} ${s.volume_unit || 'CBM'}` : '',
      'Incoterms': s.incoterms || '',
      'Freight Terms': s.freight_terms || '',
      'Status': formatStatus(s.status),
      'Created At': formatDateTime(s.created_at),
      'Updated At': formatDateTime(s.updated_at),
    }));

    // Create workbook
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Shipments');

    // Set column widths
    const colWidths = [
      { wch: 18 }, // Booking Number
      { wch: 18 }, // BL Number
      { wch: 15 }, // Container Number
      { wch: 20 }, // Vessel
      { wch: 10 }, // Voyage
      { wch: 20 }, // Port of Loading
      { wch: 10 }, // POL Code
      { wch: 20 }, // Port of Discharge
      { wch: 10 }, // POD Code
      { wch: 20 }, // Place of Receipt
      { wch: 20 }, // Place of Delivery
      { wch: 12 }, // ETD
      { wch: 12 }, // ETA
      { wch: 12 }, // ATD
      { wch: 12 }, // ATA
      { wch: 12 }, // Cargo Ready Date
      { wch: 18 }, // SI Cutoff
      { wch: 18 }, // VGM Cutoff
      { wch: 18 }, // Cargo Cutoff
      { wch: 18 }, // Gate Cutoff
      { wch: 30 }, // Commodity
      { wch: 12 }, // Weight
      { wch: 12 }, // Volume
      { wch: 10 }, // Incoterms
      { wch: 12 }, // Freight Terms
      { wch: 12 }, // Status
      { wch: 18 }, // Created At
      { wch: 18 }, // Updated At
    ];
    worksheet['!cols'] = colWidths;

    // Generate file
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `shipments-export-${timestamp}`;

    if (format === 'xlsx') {
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}.xlsx"`,
        },
      });
    } else {
      // CSV format
      const csvContent = XLSX.utils.sheet_to_csv(worksheet);

      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${filename}.csv"`,
        },
      });
    }
  } catch (error) {
    console.error('[API:GET /shipments/export] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});

function formatDate(date: string | null | undefined): string {
  if (!date) return '';
  try {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
    });
  } catch {
    return date;
  }
}

function formatDateTime(date: string | null | undefined): string {
  if (!date) return '';
  try {
    return new Date(date).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date;
  }
}

function formatStatus(status: string): string {
  return status.replace('_', ' ').toUpperCase();
}
