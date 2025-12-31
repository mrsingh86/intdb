import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { withAuth } from '@/lib/auth/server-auth';

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
  created_at: string;
}

/**
 * GET /api/shipments/alerts
 *
 * Get alerts for shipments with approaching or overdue dates.
 * Requires authentication.
 */
export const GET = withAuth(async (request, { user }) => {
  try {
    const supabase = createClient();
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Get all active shipments (not delivered/cancelled)
    const { data: shipments, error } = await supabase
      .from('shipments')
      .select(`
        id,
        booking_number,
        bl_number,
        vessel_name,
        etd,
        eta,
        si_cutoff,
        vgm_cutoff,
        cargo_cutoff,
        gate_cutoff,
        status
      `)
      .not('status', 'in', '("delivered","cancelled")')
      .order('etd', { ascending: true, nullsFirst: false });

    if (error) {
      console.error('[API:GET /shipments/alerts] Query error:', error);
      return NextResponse.json({ error: 'Failed to fetch shipments' }, { status: 500 });
    }

    const alerts: Alert[] = [];

    for (const shipment of shipments || []) {
      const identifier = shipment.booking_number || shipment.bl_number || 'Unknown';

      // Check each date field
      const dateFields = [
        { field: 'etd', label: 'ETD (Departure)', value: shipment.etd },
        { field: 'eta', label: 'ETA (Arrival)', value: shipment.eta },
        { field: 'si_cutoff', label: 'SI Cutoff', value: shipment.si_cutoff },
        { field: 'vgm_cutoff', label: 'VGM Cutoff', value: shipment.vgm_cutoff },
        { field: 'cargo_cutoff', label: 'Cargo Cutoff', value: shipment.cargo_cutoff },
        { field: 'gate_cutoff', label: 'Gate Cutoff', value: shipment.gate_cutoff },
      ];

      for (const { field, label, value } of dateFields) {
        if (!value) continue;

        const date = new Date(value);
        const daysUntil = Math.ceil((date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

        // Overdue (past)
        if (date < now) {
          alerts.push({
            id: `${shipment.id}-${field}-overdue`,
            type: 'overdue',
            severity: 'critical',
            title: `${label} Overdue`,
            message: `${identifier} - ${label} was ${Math.abs(daysUntil)} day${Math.abs(daysUntil) !== 1 ? 's' : ''} ago`,
            shipment_id: shipment.id,
            booking_number: identifier,
            date_field: field,
            date_value: value,
            days_until: daysUntil,
            created_at: now.toISOString(),
          });
        }
        // Approaching (within 3 days)
        else if (date <= threeDaysFromNow) {
          const urgency = daysUntil === 0 ? 'Today' :
                          daysUntil === 1 ? 'Tomorrow' :
                          `In ${daysUntil} days`;

          alerts.push({
            id: `${shipment.id}-${field}-approaching`,
            type: 'approaching',
            severity: daysUntil <= 1 ? 'critical' : 'warning',
            title: `${label} ${urgency}`,
            message: `${identifier} - ${label} is ${urgency.toLowerCase()}`,
            shipment_id: shipment.id,
            booking_number: identifier,
            date_field: field,
            date_value: value,
            days_until: daysUntil,
            created_at: now.toISOString(),
          });
        }
      }
    }

    // Sort by severity (critical first) then by days_until
    alerts.sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;
      return (a.days_until || 0) - (b.days_until || 0);
    });

    // Summary stats
    const summary = {
      total: alerts.length,
      critical: alerts.filter(a => a.severity === 'critical').length,
      warning: alerts.filter(a => a.severity === 'warning').length,
      overdue: alerts.filter(a => a.type === 'overdue').length,
      approaching: alerts.filter(a => a.type === 'approaching').length,
    };

    return NextResponse.json({
      alerts,
      summary,
      generated_at: now.toISOString(),
    });
  } catch (error) {
    console.error('[API:GET /shipments/alerts] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});
