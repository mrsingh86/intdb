import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Complete STATE_ORDER from database
const STATE_ORDER: Record<string, number> = {
  'booking_confirmation_received': 10,
  'booking_confirmation_shared': 15,
  'commercial_invoice_received': 20,
  'packing_list_received': 25,
  'si_draft_received': 30,
  'si_draft_sent': 32,
  'checklist_received': 40,
  'checklist_shared': 42,
  'checklist_shipper_approved': 44,
  'checklist_approved': 46,
  'shipping_bill_received': 48,
  'si_submitted': 55,
  'si_confirmed': 60,
  'vgm_submitted': 65,
  'vgm_confirmed': 68,
  'container_gated_in': 72,
  'sob_received': 80,
  'sob_shared': 85,
  'vessel_departed': 90,
  'isf_filed': 100,
  'isf_confirmed': 105,
  'mbl_draft_received': 110,
  'mbl_approved': 115,
  'mbl_received': 118,
  'bl_received': 119,
  'hbl_draft_sent': 120,
  'hbl_approved': 125,
  'hbl_released': 130,
  'hbl_shared': 132,
  'invoice_sent': 135,
  'invoice_paid': 140,
  'docs_sent_to_broker': 150,
  'entry_draft_received': 153,
  'entry_draft_shared': 156,
  'entry_customer_approved': 159,
  'entry_approved': 162,
  'entry_filed': 165,
  'entry_summary_received': 168,
  'entry_summary_shared': 172,
  'arrival_notice_received': 180,
  'arrival_notice_shared': 185,
  'customs_cleared': 190,
  'cargo_released': 192,
  'duty_invoice_received': 195,
  'duty_summary_shared': 200,
  'delivery_order_received': 205,
  'delivery_order_shared': 210,
  'container_released': 220,
  'out_for_delivery': 225,
  'delivered': 230,
  'pod_received': 235,
  'empty_returned': 240,
  'shipment_closed': 245,
  'booking_cancelled': 999,
};

// States to display (key milestones) - organized by shipment phase
const DISPLAY_STATES = [
  // Pre-Shipment
  'booking_confirmation_received',
  'booking_confirmation_shared',
  'si_draft_received',           // SI draft from shipper
  'si_draft_sent',               // SI draft sent to carrier
  'si_confirmed',
  'vgm_submitted',               // VGM submission
  'container_gated_in',          // Container gated in at port
  'checklist_received',          // Checklist from CHA
  'checklist_shared',            // Checklist sent to shipper
  'shipping_bill_received',      // LEO/Shipping bill from CHA

  // In-Transit
  'sob_received',
  'sob_shared',                  // SOB shared with customer
  'bl_received',
  'hbl_draft_sent',
  'hbl_shared',
  'invoice_sent',

  // Arrival & Customs
  'arrival_notice_received',
  'arrival_notice_shared',
  'isf_filed',                   // ISF submission (US imports)
  'entry_draft_received',        // Draft entry from customs broker
  'entry_draft_shared',          // Draft entry shared to shipper/consignee
  'entry_summary_received',      // Entry summary from customs broker
  'entry_summary_shared',        // Entry summary shared to customer
  'duty_invoice_received',       // Duty invoice from customs broker
  'duty_summary_shared',         // Duty invoice shared with customer

  // Delivery
  'cargo_released',
  'delivery_order_shared',       // DO shared with trucker
  'container_released',          // Container released notification
  'pod_received',

  // Cancellation
  'booking_cancelled',           // Booking was cancelled
];

// State labels for display
const STATE_LABELS: Record<string, string> = {
  // Pre-Shipment
  'booking_confirmation_received': 'BC Received',
  'booking_confirmation_shared': 'BC Shared',
  'si_draft_received': 'SI Draft Received',
  'si_draft_sent': 'SI Draft Sent',
  'si_confirmed': 'SI Confirmed',
  'vgm_submitted': 'VGM Submitted',
  'checklist_received': 'Checklist Received',
  'checklist_shared': 'Checklist Shared',
  'shipping_bill_received': 'LEO/SB Received',

  // In-Transit
  'sob_received': 'SOB Received',
  'sob_shared': 'SOB Shared',
  'bl_received': 'BL Received',
  'hbl_draft_sent': 'HBL Draft Sent',
  'hbl_shared': 'HBL Shared',
  'invoice_sent': 'Invoice Sent',

  // Arrival & Customs
  'arrival_notice_received': 'AN Received',
  'arrival_notice_shared': 'AN Shared',
  'entry_draft_received': 'Entry Draft Received',
  'entry_draft_shared': 'Entry Draft Shared',
  'entry_summary_received': 'Entry Summary Received',
  'entry_summary_shared': 'Entry Summary Shared',
  'duty_invoice_received': 'Duty Invoice Received',
  'duty_summary_shared': 'Duty Invoice Shared',

  // Delivery
  'cargo_released': 'Cargo Released',
  'delivery_order_shared': 'DO Shared',
  'container_released': 'Container Released',
  'pod_received': 'POD Received',

  // Container & Compliance
  'container_gated_in': 'Container Gated In',
  'isf_filed': 'ISF Filed',

  // Cancellation
  'booking_cancelled': 'Booking Cancelled',
};

interface Shipment {
  id: string;
  workflow_state: string | null;
}

interface Doc {
  shipment_id: string;
  email_id: string;
  document_type: string;
}

interface Email {
  id: string;
  received_at: string;
  sender_email: string | null;
  email_direction: string | null;
  subject: string | null;
}

/**
 * Map workflow states to document types and required direction.
 * This enables tracking by ACTUAL documents received, not cumulative state order.
 *
 * Document types from shipment_documents table:
 * - booking_confirmation, booking_amendment, booking_cancellation
 * - shipping_instruction, si_draft, si_submission
 * - bill_of_lading, sob_confirmation, vgm_submission
 * - invoice, freight_invoice, arrival_notice, shipment_notice
 * - customs_document, container_release, delivery_order
 * - checklist, shipping_bill, leo_copy (India CHA)
 * - draft_entry, entry_summary, duty_invoice (US Customs Broker)
 */
const STATE_TO_DOCUMENTS: Record<string, { types: string[]; direction: 'inbound' | 'outbound' | 'any' }> = {
  // Pre-Shipment
  'booking_confirmation_received': { types: ['booking_confirmation', 'booking_amendment'], direction: 'inbound' },
  'booking_confirmation_shared': { types: ['booking_confirmation', 'booking_amendment'], direction: 'outbound' },
  'si_draft_received': { types: ['si_draft', 'shipping_instruction', 'si_submission'], direction: 'inbound' },
  'si_draft_sent': { types: ['si_draft', 'shipping_instruction'], direction: 'outbound' },
  'si_confirmed': { types: ['si_confirmation'], direction: 'inbound' },
  'vgm_submitted': { types: ['vgm_submission', 'vgm_confirmation'], direction: 'inbound' },

  // India Export (CHA)
  'checklist_received': { types: ['checklist'], direction: 'inbound' },
  'checklist_shared': { types: ['checklist'], direction: 'outbound' },
  'shipping_bill_received': { types: ['shipping_bill', 'leo_copy'], direction: 'inbound' },

  // In-Transit
  'sob_received': { types: ['sob_confirmation'], direction: 'inbound' },
  'sob_shared': { types: ['sob_confirmation'], direction: 'outbound' },
  'bl_received': { types: ['bill_of_lading', 'hbl_draft'], direction: 'inbound' },
  'hbl_draft_sent': { types: ['bill_of_lading', 'hbl_draft'], direction: 'outbound' },
  'hbl_shared': { types: ['bill_of_lading'], direction: 'outbound' },
  'invoice_sent': { types: ['invoice', 'freight_invoice'], direction: 'outbound' },

  // Arrival
  'arrival_notice_received': { types: ['arrival_notice'], direction: 'inbound' },
  'arrival_notice_shared': { types: ['arrival_notice'], direction: 'outbound' },

  // US Customs (Broker)
  'entry_draft_received': { types: ['draft_entry', 'customs_document'], direction: 'inbound' },
  'entry_draft_shared': { types: ['draft_entry'], direction: 'outbound' },
  'entry_summary_received': { types: ['entry_summary'], direction: 'inbound' },
  'entry_summary_shared': { types: ['entry_summary'], direction: 'outbound' },
  'duty_invoice_received': { types: ['duty_invoice', 'customs_document'], direction: 'inbound' },
  'duty_summary_shared': { types: ['duty_invoice', 'customs_document'], direction: 'outbound' },

  // Delivery
  'cargo_released': { types: ['container_release', 'delivery_order'], direction: 'inbound' },
  'delivery_order_shared': { types: ['delivery_order'], direction: 'outbound' },
  'container_released': { types: ['container_release'], direction: 'outbound' },
  'pod_received': { types: ['proof_of_delivery', 'pod_confirmation'], direction: 'inbound' },

  // Container & Compliance
  'container_gated_in': { types: ['gate_in_confirmation'], direction: 'inbound' },
  'isf_filed': { types: ['isf_submission'], direction: 'inbound' },

  // Cancellation
  'booking_cancelled': { types: ['booking_cancellation'], direction: 'any' },
};

/**
 * Carrier keywords in subject lines that indicate inbound emails
 */
const CARRIER_SUBJECT_PATTERNS = [
  /\bmaersk\b/i,
  /\bhapag[-\s]?lloyd\b/i,
  /\bcma[-\s]?cgm\b/i,
  /\bcosco\b/i,
  /\bevergreen\b/i,
  /\bmsc\b/i,
  /\bone[-\s]?line\b/i,
  /\byangming\b/i,
  /\byang\s*ming\b/i,
  /\boocl\b/i,
  /\bzim\b/i,
  /\bpil\b/i,
  /\bapl\b/i,
  /\bhyundai\b/i,
  /\bhmm\b/i,
  /booking\s*confirmation/i,
  /booking\s*amendment/i,
  /shipment\s*notice/i,
  /\bbooking\s*#?\s*:?\s*\d/i,
  /\b(COSU|MAEU|HLCU|CMAU|EGLV|MSCU|ONEY|YMLU)\d{6,}/i, // Carrier booking prefixes
];

/**
 * Carrier keywords in sender/true sender that indicate inbound
 */
const CARRIER_SENDER_KEYWORDS = [
  'maersk', 'hapag', 'hlag', 'cma-cgm', 'cma cgm', 'cosco', 'coscon',
  'evergreen', 'msc', 'one-line', 'yangming', 'oocl', 'zim', 'pil', 'apl',
  'hyundai', 'hmm', 'noreply', 'no-reply', 'donotreply', 'please-no-reply',
  'iris-', 'website', 'cenfact', 'in.export', 'in.import', 'export@',
  'import@', 'booking@', 'service.hlag', 'arihant', 'aarish'
];

/**
 * Extract true sender from "X via Y <email>" pattern
 */
function extractTrueSender(senderEmail: string): { trueSender: string | null; isVia: boolean } {
  if (!senderEmail) return { trueSender: null, isVia: false };

  // Pattern: "Something via GroupName <email@domain.com>"
  const viaMatch = senderEmail.match(/^['"]?(.+?)['"]?\s+via\s+/i);
  if (viaMatch) {
    return {
      trueSender: viaMatch[1].trim().replace(/^['"]|['"]$/g, ''),
      isVia: true
    };
  }

  return { trueSender: null, isVia: false };
}

/**
 * Detect email direction using TRUE sender (via pattern) and subject line
 *
 * Logic:
 * 1. Parse "X via Y" pattern - if X matches carrier keywords, it's inbound
 * 2. Check subject line for carrier patterns (handles manual forwards)
 * 3. For Intoglo senders: use subject to determine direction (don't trust email_direction)
 * 4. For non-Intoglo senders: inbound
 *
 * NOTE: We DON'T blindly trust email_direction because it was set incorrectly
 * for many forwarded carrier emails from ops@intoglo.com
 */
function getDirection(email: Email): 'inbound' | 'outbound' {
  const sender = (email.sender_email || '').toLowerCase();
  const subject = (email.subject || '').toLowerCase();

  // 1. Parse "via" pattern to get TRUE sender
  const { trueSender, isVia } = extractTrueSender(email.sender_email || '');

  if (isVia && trueSender) {
    // Check if true sender is a carrier
    const trueSenderLower = trueSender.toLowerCase();
    if (CARRIER_SENDER_KEYWORDS.some(kw => trueSenderLower.includes(kw))) {
      return 'inbound';
    }
  }

  // 2. For Intoglo senders, check if it's a forwarded carrier email
  if (sender.includes('@intoglo.com') || sender.includes('@intoglo.in')) {
    // Skip replies - these are Intoglo staff replying to customers (outbound)
    // Replies start with "Re:", "RE:", "Fwd:", etc.
    const isReply = /^(re|fw|fwd):/i.test(subject.trim());

    // Maersk BC forwarded via ops@intoglo.com (without "via" display name)
    // Subject format: "Booking Confirmation : 263825330" or "Booking Amendment : 263638404"
    // Only match if NOT a reply and subject starts with exact carrier format
    if (!isReply && sender === 'ops@intoglo.com' && /^booking\s+(confirmation|amendment)\s*:/i.test(subject)) {
      return 'inbound';
    }

    // COSCO IRIS system (ops@intoglo.com forwards these)
    if (!isReply && /IRIS/i.test(sender) && /booking\s*confirm/i.test(subject)) {
      return 'inbound';
    }

    // ODeX carrier platform notifications (not replies)
    if (!isReply && /\bODeX:/i.test(subject)) {
      return 'inbound';
    }

    // Trust email_direction from database for all other Intoglo emails
    // This was set correctly by direction-detector.ts
    if (email.email_direction) {
      return email.email_direction as 'inbound' | 'outbound';
    }
    return 'outbound';
  }

  // 3. Non-Intoglo sender = inbound (carrier or third party)
  return 'inbound';
}

function getWeekStart(dateStr: string): Date {
  const d = new Date(dateStr);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function getWeekEnd(weekStart: Date): Date {
  const end = new Date(weekStart);
  end.setDate(end.getDate() + 6);
  return end;
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function getMonthName(date: Date): string {
  return date.toLocaleString('default', { month: 'short' });
}

async function getAllRows<T>(table: string, select: string): Promise<T[]> {
  const PAGE_SIZE = 1000;
  let allRows: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allRows = allRows.concat(data as T[]);
      offset += PAGE_SIZE;
      if (data.length < PAGE_SIZE) hasMore = false;
    }
  }

  return allRows;
}

export async function GET(request: Request) {
  try {
    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const weeksParam = searchParams.get('weeks');
    const maxWeeks = weeksParam ? parseInt(weeksParam, 10) : 8; // Default to last 8 weeks

    // Load all data with pagination
    const [shipments, docs, emails] = await Promise.all([
      getAllRows<Shipment>('shipments', 'id, workflow_state'),
      getAllRows<Doc>('shipment_documents', 'shipment_id, email_id, document_type'),
      getAllRows<Email>('raw_emails', 'id, received_at, sender_email, email_direction, subject'),
    ]);

    const emailMap = new Map(emails.map(e => [e.id, e]));
    const shipmentMap = new Map(shipments.map(s => [s.id, s]));

    // Build shipment document index: shipmentId -> Set of "docType:direction"
    const shipmentDocIndex = new Map<string, Set<string>>();
    for (const doc of docs) {
      const email = emailMap.get(doc.email_id);
      if (!email) continue;

      const direction = getDirection(email);
      const key = `${doc.document_type}:${direction}`;

      if (!shipmentDocIndex.has(doc.shipment_id)) {
        shipmentDocIndex.set(doc.shipment_id, new Set());
      }
      shipmentDocIndex.get(doc.shipment_id)!.add(key);
    }

    // Find earliest booking confirmation email date for each shipment
    const shipmentBookingDate = new Map<string, string>();
    for (const doc of docs) {
      if (doc.document_type === 'booking_confirmation' || doc.document_type === 'booking_amendment') {
        const email = emailMap.get(doc.email_id);
        if (!email || !email.received_at) continue;

        const receivedAt = new Date(email.received_at);
        const existing = shipmentBookingDate.get(doc.shipment_id);
        if (!existing || receivedAt < new Date(existing)) {
          shipmentBookingDate.set(doc.shipment_id, email.received_at);
        }
      }
    }

    // Group by week
    const byWeek = new Map<string, Shipment[]>();
    for (const [shipmentId, bookingDate] of shipmentBookingDate) {
      const shipment = shipmentMap.get(shipmentId);
      if (!shipment) continue;
      const weekStart = formatDate(getWeekStart(bookingDate));
      if (!byWeek.has(weekStart)) byWeek.set(weekStart, []);
      byWeek.get(weekStart)!.push(shipment);
    }

    // Sort weeks and apply rolling window
    const allWeeks = Array.from(byWeek.keys()).sort();
    const weeks = maxWeeks > 0 ? allWeeks.slice(-maxWeeks) : allWeeks;

    // Build week info
    const weekInfo = weeks.map(weekStartStr => {
      const weekStart = new Date(weekStartStr);
      const weekEnd = getWeekEnd(weekStart);
      return {
        key: weekStartStr,
        month: getMonthName(weekStart),
        startDate: formatDate(weekStart),
        endDate: formatDate(weekEnd),
        startDay: weekStart.getDate(),
        endDay: weekEnd.getDate(),
        shipmentCount: byWeek.get(weekStartStr)!.length,
      };
    });

    // Calculate state data for each week using DOCUMENT-BASED tracking
    const stateData: Record<string, { count: number; percentage: number }[]> = {};

    /**
     * Check if a shipment has reached a state by checking its documents.
     * A state is reached if the shipment has ANY document of the required types
     * with the required direction.
     */
    function hasReachedState(shipmentId: string, state: string): boolean {
      const docConfig = STATE_TO_DOCUMENTS[state];
      if (!docConfig) return false;

      const shipmentDocs = shipmentDocIndex.get(shipmentId);
      if (!shipmentDocs) return false;

      // Check if shipment has any matching document type with correct direction
      for (const docType of docConfig.types) {
        const key = `${docType}:${docConfig.direction}`;
        if (shipmentDocs.has(key)) {
          return true;
        }
      }
      return false;
    }

    for (const state of DISPLAY_STATES) {
      stateData[state] = [];

      for (const weekKey of weeks) {
        const cohort = byWeek.get(weekKey)!;
        const total = cohort.length;

        let reached = 0;
        for (const s of cohort) {
          if (hasReachedState(s.id, state)) {
            reached++;
          }
        }

        const percentage = total > 0 ? Math.round((reached / total) * 100) : 0;
        stateData[state].push({ count: reached, percentage });
      }

      // Add total column
      const allShipments = weeks.flatMap(w => byWeek.get(w)!);
      const allTotal = allShipments.length;
      let totalReached = 0;
      for (const s of allShipments) {
        if (hasReachedState(s.id, state)) {
          totalReached++;
        }
      }
      const totalPct = allTotal > 0 ? Math.round((totalReached / allTotal) * 100) : 0;
      stateData[state].push({ count: totalReached, percentage: totalPct });
    }

    // Group weeks by month for header
    const monthGroups: { month: string; weeks: number }[] = [];
    let currentMonth = '';
    let currentCount = 0;

    for (const week of weekInfo) {
      if (week.month !== currentMonth) {
        if (currentMonth) {
          monthGroups.push({ month: currentMonth, weeks: currentCount });
        }
        currentMonth = week.month;
        currentCount = 1;
      } else {
        currentCount++;
      }
    }
    if (currentMonth) {
      monthGroups.push({ month: currentMonth, weeks: currentCount });
    }
    // Add "Total" as last month group
    monthGroups.push({ month: 'Total', weeks: 1 });

    return NextResponse.json({
      weeks: weekInfo,
      monthGroups,
      states: DISPLAY_STATES.map(state => ({
        key: state,
        label: STATE_LABELS[state] || state.replace(/_/g, ' '),
      })),
      data: stateData,
      totalShipments: Array.from(byWeek.values()).flat().length,
    });
  } catch (error) {
    console.error('Error fetching workflow cohort:', error);
    return NextResponse.json(
      { error: 'Failed to fetch workflow cohort data' },
      { status: 500 }
    );
  }
}
