/**
 * Shipment Dossier Service
 *
 * Provides a COMPLETE view of a single shipment:
 * - All documents with access links
 * - Timeline of all events
 * - All cutoff dates
 * - Live tracking (if available)
 * - Cross-validation (carrier vs INTDB discrepancies)
 * - Escalations (customer/vendor issues)
 */

import { SupabaseClient, createClient } from '@supabase/supabase-js';

// =============================================================================
// TYPES
// =============================================================================

export interface ShipmentDossier {
  // Identity
  bookingNumber: string;
  mblNumber?: string;
  hblNumber?: string;
  containerNumbers: string[];

  // Parties
  shipper?: string;
  consignee?: string;
  carrier?: string;

  // Route
  pol?: string;
  pod?: string;
  vessel?: string;
  voyage?: string;

  // Status
  stage: string;
  healthScore: number;

  // Key Dates (from INTDB)
  dates: {
    etd?: string;
    eta?: string;
    atd?: string;
    ata?: string;
    cargoReady?: string;
    deliveryDate?: string;
  };

  // Cutoffs
  cutoffs: CutoffDate[];

  // Documents (with access)
  documents: DocumentRecord[];

  // Timeline
  timeline: TimelineEvent[];

  // Live Tracking (carrier API)
  liveTracking?: LiveTrackingData;

  // Demurrage & Detention (carrier API)
  dnd?: DnDCharges;

  // Discrepancies
  discrepancies: Discrepancy[];

  // Escalations
  escalations: Escalation[];

  // Stats
  emailCount: number;
  pendingActionsCount: number;
  pendingActionsList: PendingActionInfo[];
  documentCompletion: number;
}

export interface PendingActionInfo {
  description: string;
  owner?: string;
  deadline?: string;
  isOverdue: boolean;
}

export interface DocumentRecord {
  id: string;
  type: string;
  displayName: string;
  receivedAt: string;
  fromParty: string;
  subject: string;
  hasAttachment: boolean;
  gmailLink: string;
  attachmentUrl?: string;  // Direct link to view/download PDF attachment
  attachmentFilename?: string;
  emailViewUrl?: string;   // Direct link to view email content (when no attachment)
  snippet?: string;
}

export interface TimelineEvent {
  date: string;
  type: 'document' | 'milestone' | 'action' | 'communication';
  title: string;
  description?: string;
  party?: string;
  sentiment?: string;
}

export interface CutoffDate {
  type: string;
  displayName: string;
  date: string;
  status: 'passed' | 'today' | 'upcoming' | 'unknown';
  hoursRemaining?: number;
}

export interface LiveTrackingData {
  source: string;
  status: string;
  vessel?: string;
  location?: string;
  originPort?: string;
  destinationPort?: string;
  etd?: string;
  eta?: string;
  atd?: string;
  ata?: string;
  lastEvent?: string;
  lastEventDate?: string;
}

export interface Discrepancy {
  field: string;
  intdbValue: string;
  carrierValue?: string;
  otherValue?: string;
  severity: 'high' | 'medium' | 'low';
  recommendation: string;
}

export interface Escalation {
  type: 'customer' | 'vendor' | 'internal';
  severity: 'critical' | 'high' | 'medium';
  date: string;
  subject: string;
  from: string;
  snippet: string;
  gmailLink: string;
  emailViewUrl?: string;  // In-app email viewer
}

export interface DnDCharges {
  containerNumber: string;
  port: string;
  portCode: string;
  portFreeDays: number;
  detentionFreeDays: number;
  lastFreeDay?: string;
  demurrageCharges: number;
  detentionCharges: number;
  totalCharges: number;
  currency: string;
  chargeableDays: number;
  isFinalCharge: boolean;
  lastSyncAt: string;
}

// =============================================================================
// DOCUMENT TYPE MAPPINGS
// =============================================================================

const DOCUMENT_DISPLAY_NAMES: Record<string, string> = {
  'booking_confirmation': 'Booking Confirmation',
  'booking_amendment': 'Booking Amendment',
  'shipping_instructions': 'Shipping Instructions',
  'si_confirmation': 'SI Confirmation',
  'vgm_confirmation': 'VGM Confirmation',
  'draft_bl': 'Draft BL',
  'final_bl': 'Final BL',
  'telex_release': 'Telex Release',
  'arrival_notice': 'Arrival Notice',
  'delivery_order': 'Delivery Order',
  'customs_entry': 'Customs Entry',
  'isf_filing': 'ISF Filing',
  'invoice': 'Invoice',
  'commercial_invoice': 'Commercial Invoice',
  'packing_list': 'Packing List',
  'certificate_of_origin': 'Certificate of Origin',
  'general_correspondence': 'Correspondence',
  'internal_communication': 'Internal',
};

const STAGE_ORDER: Record<string, number> = {
  'PENDING': 1,
  'BOOKED': 2,
  'SI_SUBMITTED': 3,
  'SI_CONFIRMED': 4,
  'DRAFT_BL': 5,
  'BL_ISSUED': 6,
  'DEPARTED': 7,
  'IN_TRANSIT': 8,
  'ARRIVED': 9,
  'DELIVERED': 10,
};

// =============================================================================
// SERVICE
// =============================================================================

export class ShipmentDossierService {
  private supabase: SupabaseClient;
  private gmailBaseUrl = 'https://mail.google.com/mail/u/0/#inbox/';

  constructor(supabaseClient?: SupabaseClient) {
    if (supabaseClient) {
      this.supabase = supabaseClient;
    } else {
      const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) throw new Error('Missing Supabase configuration');
      this.supabase = createClient(url, key);
    }
  }

  // ===========================================================================
  // MAIN METHOD
  // ===========================================================================

  async getShipmentDossier(reference: string): Promise<ShipmentDossier | null> {
    // Fetch all chronicle records for this shipment
    const records = await this.fetchChronicleRecords(reference);

    if (records.length === 0) {
      return null;
    }

    // Extract identifiers from records (with smart validation)
    const bookingNumber = this.extractFirst(records, 'booking_number') || reference;
    const mblNumber = this.extractMblNumber(records);
    const hblNumber = this.extractHblNumber(records);
    const containerNumbers = this.extractContainers(records);

    // Build dossier
    const dossier: ShipmentDossier = {
      bookingNumber,
      mblNumber,
      hblNumber,
      containerNumbers,

      shipper: this.extractFirst(records, 'shipper_name'),
      consignee: this.extractFirst(records, 'consignee_name'),
      carrier: this.detectCarrier(records),

      pol: this.extractFirst(records, 'pol_location'),
      pod: this.extractFirst(records, 'pod_location'),
      vessel: this.extractFirst(records, 'vessel_name'),
      voyage: this.extractFirst(records, 'voyage_number'),

      stage: this.determineStage(records),
      healthScore: this.calculateHealth(records),

      dates: this.extractDates(records),
      cutoffs: this.extractCutoffs(records),
      documents: this.buildDocumentList(records),
      timeline: this.buildTimeline(records),
      discrepancies: this.findDiscrepancies(records),
      escalations: this.findEscalations(records),

      emailCount: records.length,
      pendingActionsList: this.extractPendingActions(records),
      pendingActionsCount: 0,  // Will be set below after filtering stale actions
      documentCompletion: this.calculateDocumentCompletion(records),
    };

    // Set count from filtered list (excludes stale actions)
    dossier.pendingActionsCount = dossier.pendingActionsList.length;

    // Try to get live tracking
    const primaryContainer = containerNumbers[0];
    if (primaryContainer) {
      dossier.liveTracking = await this.fetchLiveTracking(primaryContainer);

      // Cross-validate and OVERRIDE with carrier data when available
      if (dossier.liveTracking) {
        this.crossValidateAndOverride(dossier);
      }
    }

    // Try to get D&D charges (requires MBL number, Maersk only)
    if (mblNumber && dossier.carrier === 'Maersk') {
      dossier.dnd = await this.fetchDnDCharges(mblNumber, primaryContainer);
    }

    return dossier;
  }

  // ===========================================================================
  // DATA FETCHING
  // ===========================================================================

  private async fetchChronicleRecords(reference: string): Promise<any[]> {
    // Try multiple identifiers
    const { data, error } = await this.supabase
      .from('chronicle')
      .select(`
        id,
        gmail_message_id,
        thread_id,
        booking_number,
        mbl_number,
        hbl_number,
        container_numbers,
        document_type,
        message_type,
        from_party,
        from_address,
        subject,
        snippet,
        shipper_name,
        consignee_name,
        vessel_name,
        voyage_number,
        pol_location,
        pod_location,
        etd,
        eta,
        atd,
        ata,
        si_cutoff,
        vgm_cutoff,
        doc_cutoff,
        cargo_cutoff,
        has_action,
        action_description,
        action_deadline,
        action_completed_at,
        action_owner,
        has_issue,
        issue_type,
        issue_description,
        sentiment,
        summary,
        attachments,
        occurred_at,
        created_at
      `)
      .or(`booking_number.eq.${reference},mbl_number.eq.${reference},container_numbers.cs.{${reference}}`)
      .order('occurred_at', { ascending: true });

    if (error) {
      console.error('[Dossier] Query error:', error);
      return [];
    }

    return data || [];
  }

  private async fetchLiveTracking(containerNumber: string): Promise<LiveTrackingData | undefined> {
    // Check if container looks like Maersk/Hapag
    const prefix = containerNumber.substring(0, 4).toUpperCase();
    const maerskPrefixes = ['MRKU', 'MAEU', 'MSCU', 'MSKU', 'MRSU'];
    const hapagPrefixes = ['HLBU', 'HLXU', 'HAMU'];

    if (!maerskPrefixes.includes(prefix) && !hapagPrefixes.includes(prefix)) {
      return undefined;
    }

    // Try to call carrier API service
    try {
      const { getCarrierApiService } = await import('./carrier-api-service');
      const carrierService = getCarrierApiService();
      const response = await carrierService.getTrackingData(containerNumber);

      if (response.success && response.data) {
        const d = response.data;
        const events = d.recentEvents || [];

        // Sort events by date to find the most recent
        const sortedEvents = [...events].sort((a, b) => {
          const dateA = new Date(a.eventDateTime || 0).getTime();
          const dateB = new Date(b.eventDateTime || 0).getTime();
          return dateB - dateA; // Most recent first
        });

        const latestEvent = sortedEvents[0];

        // For delivered/arrived shipments, use destination location
        let location = d.currentLocation;
        if (d.status === 'DELIVERED' || d.status === 'ARRIVED') {
          // Priority: destinationPort > extract from lastEvent > currentLocation
          if (d.destinationPort) {
            location = d.destinationPort;
          } else if (latestEvent?.description) {
            // Extract location from "Arrived at Newark - Maher Terminal"
            const match = latestEvent.description.match(/(?:arrived at|discharged at)\s+(.+)/i);
            if (match) {
              location = match[1];
            }
          }
        }

        return {
          source: d.source,
          status: d.status,
          vessel: d.vesselName || undefined,
          location: location || undefined,
          originPort: d.originPort || undefined,
          destinationPort: d.destinationPort || undefined,
          etd: d.etd || undefined,
          eta: d.eta || undefined,
          atd: d.atd || undefined,
          ata: d.ata || undefined,
          lastEvent: latestEvent?.description,
          lastEventDate: latestEvent?.eventDateTime,
        };
      }
    } catch (e) {
      console.error('[Dossier] Tracking error:', e);
    }

    return undefined;
  }

  /**
   * Fetch D&D charges from Maersk API
   * Only available for Maersk shipments with MBL number
   */
  private async fetchDnDCharges(
    mblNumber: string,
    containerNumber?: string
  ): Promise<DnDCharges | undefined> {
    try {
      const { getCarrierApiService } = await import('./carrier-api-service');
      const carrierService = getCarrierApiService();
      const response = await carrierService.getCharges(mblNumber, containerNumber);

      if (response.success && response.data) {
        const c = response.data;
        return {
          containerNumber: c.containerNumber,
          port: c.port,
          portCode: c.portCode,
          portFreeDays: c.portFreeDays,
          detentionFreeDays: c.detentionFreeDays,
          lastFreeDay: c.lastFreeDay || undefined,
          demurrageCharges: c.demurrageCharges,
          detentionCharges: c.detentionCharges,
          totalCharges: c.totalCharges,
          currency: c.currency,
          chargeableDays: c.chargeableDays,
          isFinalCharge: c.isFinalCharge,
          lastSyncAt: c.lastSyncAt,
        };
      }
    } catch (e) {
      // D&D is optional - don't fail if it's not available
      console.log('[Dossier] D&D not available:', e);
    }

    return undefined;
  }

  // ===========================================================================
  // DATA EXTRACTION
  // ===========================================================================

  private extractFirst(records: any[], field: string): string | undefined {
    // Get most recent non-null value
    for (let i = records.length - 1; i >= 0; i--) {
      if (records[i][field]) {
        return records[i][field];
      }
    }
    return undefined;
  }

  /**
   * Extract MBL number with format validation
   * MBL format: Carrier prefix (4 letters) + numbers, e.g., MAEU262822342, HLCU123456789
   */
  private extractMblNumber(records: any[]): string | undefined {
    const mblPrefixes = ['MAEU', 'HLCU', 'MSCU', 'OOLU', 'COSU', 'CMDU', 'EGLV', 'ONEYC', 'YMLU', 'ZIMU'];
    const mblPattern = /^[A-Z]{4}\d{6,12}$/;

    // First pass: find properly formatted MBL
    for (let i = records.length - 1; i >= 0; i--) {
      const val = records[i].mbl_number;
      if (val && typeof val === 'string') {
        const upper = val.toUpperCase().trim();
        // Check if starts with known carrier prefix or matches MBL pattern
        if (mblPrefixes.some(p => upper.startsWith(p)) || mblPattern.test(upper)) {
          return val;
        }
      }
    }

    // Fallback: return any non-HBL-looking value
    for (let i = records.length - 1; i >= 0; i--) {
      const val = records[i].mbl_number;
      if (val && typeof val === 'string') {
        // Skip if it looks like Intoglo HBL (SE + numbers)
        if (/^SE\d+/.test(val.toUpperCase())) continue;
        return val;
      }
    }

    return undefined;
  }

  /**
   * Extract HBL number with format validation
   * Intoglo HBL format: SE + date code + sequence, e.g., SE1225003104
   */
  private extractHblNumber(records: any[]): string | undefined {
    // First pass: find properly formatted Intoglo HBL
    for (let i = records.length - 1; i >= 0; i--) {
      const val = records[i].hbl_number;
      if (val && typeof val === 'string') {
        // Intoglo HBL pattern: SE + 10 digits
        if (/^SE\d{10}$/.test(val.toUpperCase())) {
          return val;
        }
      }
    }

    // Fallback: return any HBL that doesn't look like MBL
    const mblPrefixes = ['MAEU', 'HLCU', 'MSCU', 'OOLU', 'COSU', 'CMDU', 'EGLV'];
    for (let i = records.length - 1; i >= 0; i--) {
      const val = records[i].hbl_number;
      if (val && typeof val === 'string') {
        const upper = val.toUpperCase();
        // Skip if it looks like MBL
        if (mblPrefixes.some(p => upper.startsWith(p))) continue;
        return val;
      }
    }

    return undefined;
  }

  private extractContainers(records: any[]): string[] {
    const containers = new Set<string>();
    // Valid container format: 4 letters + 7 digits
    const validFormat = /^[A-Z]{4}\d{7}$/;
    // Test data patterns to exclude
    const testPatterns = ['1234567', '7654321', '0000000', '9999999'];

    for (const r of records) {
      if (r.container_numbers && Array.isArray(r.container_numbers)) {
        for (const c of r.container_numbers) {
          if (!c || typeof c !== 'string') continue;

          const upper = c.toUpperCase().trim();

          // Skip invalid formats
          if (!validFormat.test(upper)) continue;

          // Skip UNKNOWN variants
          if (upper.includes('UNKNOWN')) continue;

          // Skip test data (ends with common test patterns)
          const digits = upper.slice(-7);
          if (testPatterns.includes(digits)) continue;

          containers.add(upper);
        }
      }
    }
    return [...containers];
  }

  private detectCarrier(records: any[]): string | undefined {
    for (const r of records) {
      const from = r.from_address?.toLowerCase() || '';
      if (from.includes('maersk')) return 'Maersk';
      if (from.includes('hapag')) return 'Hapag-Lloyd';
      if (from.includes('msc')) return 'MSC';
      if (from.includes('cma')) return 'CMA CGM';
      if (from.includes('cosco')) return 'COSCO';
      if (from.includes('evergreen')) return 'Evergreen';
    }
    return undefined;
  }

  private extractDates(records: any[]): ShipmentDossier['dates'] {
    return {
      etd: this.extractFirst(records, 'etd'),
      eta: this.extractFirst(records, 'eta'),
      atd: this.extractFirst(records, 'atd'),
      ata: this.extractFirst(records, 'ata'),
    };
  }

  private extractCutoffs(records: any[]): CutoffDate[] {
    const cutoffs: CutoffDate[] = [];
    const now = new Date();

    // Get all document types that exist for this shipment
    const existingDocTypes = new Set(
      records.map(r => r.document_type).filter(Boolean)
    );

    // Map cutoff type to document types that indicate completion
    const cutoffCompletionDocs: Record<string, string[]> = {
      'si_cutoff': ['shipping_instructions', 'si_confirmation'],
      'vgm_cutoff': ['vgm_confirmation'],
      'doc_cutoff': ['draft_bl', 'final_bl'],
      'cargo_cutoff': ['gate_in', 'container_loaded', 'sob_confirmation'],
    };

    const cutoffFields = [
      { field: 'si_cutoff', name: 'SI Cutoff' },
      { field: 'vgm_cutoff', name: 'VGM Cutoff' },
      { field: 'doc_cutoff', name: 'Doc Cutoff' },
      { field: 'cargo_cutoff', name: 'Cargo Cutoff' },
    ];

    for (const cf of cutoffFields) {
      const value = this.extractFirst(records, cf.field);
      if (value) {
        const date = new Date(value);
        const hoursRemaining = (date.getTime() - now.getTime()) / (1000 * 60 * 60);

        // Check if this cutoff is completed by looking for relevant documents
        const completionDocs = cutoffCompletionDocs[cf.field] || [];
        const isCompleted = completionDocs.some(docType => existingDocTypes.has(docType));

        let status: CutoffDate['status'];
        if (isCompleted) {
          // Cutoff completed - document exists
          status = 'upcoming'; // Show as done/upcoming, not passed
        } else if (hoursRemaining < 0) {
          status = 'passed'; // Actually missed - no completion doc
        } else if (hoursRemaining < 24) {
          status = 'today';
        } else {
          status = 'upcoming';
        }

        cutoffs.push({
          type: cf.field,
          displayName: cf.name,
          date: value,
          status,
          hoursRemaining: Math.round(hoursRemaining),
          completed: isCompleted,
        } as CutoffDate & { completed?: boolean });
      }
    }

    return cutoffs;
  }

  // ===========================================================================
  // DOCUMENT LIST
  // ===========================================================================

  private buildDocumentList(records: any[]): DocumentRecord[] {
    const docs: DocumentRecord[] = [];
    const seenTypes = new Set<string>();

    // Important document types in order
    const docPriority: Record<string, number> = {
      'booking_confirmation': 1,
      'booking_amendment': 2,
      'shipping_instructions': 3,
      'si_confirmation': 4,
      'vgm_confirmation': 5,
      'draft_bl': 6,
      'final_bl': 7,
      'telex_release': 8,
      'arrival_notice': 9,
      'delivery_order': 10,
      'customs_entry': 11,
      'invoice': 12,
    };

    // Sort by date descending (most recent first for each type)
    const sorted = [...records].sort((a, b) =>
      new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
    );

    for (const r of sorted) {
      if (!r.document_type || r.document_type === 'unknown') continue;

      // Skip generic correspondence, checklists, etc for the main list
      const skipTypes = ['general_correspondence', 'internal_communication', 'checklist', 'shipping_bill'];
      if (skipTypes.includes(r.document_type)) continue;

      // Keep only the most recent of each document type
      if (seenTypes.has(r.document_type)) continue;
      seenTypes.add(r.document_type);

      // Check for PDF attachments
      const attachment = this.findPdfAttachment(r.attachments, r.gmail_message_id);

      docs.push({
        id: r.id,
        type: r.document_type,
        displayName: DOCUMENT_DISPLAY_NAMES[r.document_type] || r.document_type.replace(/_/g, ' '),
        receivedAt: r.occurred_at,
        fromParty: r.from_party || 'unknown',
        subject: r.subject || '',
        hasAttachment: !!attachment,
        gmailLink: this.buildGmailLink(r.gmail_message_id),
        attachmentUrl: attachment?.url,
        attachmentFilename: attachment?.filename,
        emailViewUrl: `/api/chronicle-v2/email-view/${r.id}`,  // Always provide email view as fallback
        snippet: r.snippet?.substring(0, 150),
      });
    }

    // Sort by document priority
    docs.sort((a, b) => {
      const pa = docPriority[a.type] || 99;
      const pb = docPriority[b.type] || 99;
      return pa - pb;
    });

    return docs;
  }

  private buildGmailLink(messageId: string): string {
    if (!messageId) return '#';
    // Gmail message ID needs to be converted to thread view
    return `${this.gmailBaseUrl}${messageId}`;
  }

  /**
   * Find the first PDF attachment from the attachments JSONB
   * Returns attachment URL and filename if found
   */
  private findPdfAttachment(
    attachments: any[] | null,
    messageId: string
  ): { url: string; filename: string } | null {
    if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
      return null;
    }

    // Find first PDF attachment
    const pdfAttachment = attachments.find(
      (att) => att.mimeType === 'application/pdf' && att.attachmentId
    );

    if (!pdfAttachment) {
      // Fallback to any attachment with an ID
      const anyAttachment = attachments.find((att) => att.attachmentId);
      if (!anyAttachment) return null;

      return {
        url: `/api/chronicle-v2/attachments/${messageId}/${anyAttachment.attachmentId}?filename=${encodeURIComponent(anyAttachment.filename || 'document')}`,
        filename: anyAttachment.filename || 'document',
      };
    }

    return {
      url: `/api/chronicle-v2/attachments/${messageId}/${pdfAttachment.attachmentId}?filename=${encodeURIComponent(pdfAttachment.filename || 'document.pdf')}`,
      filename: pdfAttachment.filename || 'document.pdf',
    };
  }

  // ===========================================================================
  // TIMELINE
  // ===========================================================================

  private buildTimeline(records: any[]): TimelineEvent[] {
    const events: TimelineEvent[] = [];

    // Sort by date
    const sorted = [...records].sort((a, b) =>
      new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime()
    );

    for (const r of sorted) {
      const docName = DOCUMENT_DISPLAY_NAMES[r.document_type] || r.document_type;

      events.push({
        date: r.occurred_at,
        type: r.message_type === 'action_required' ? 'action' : 'document',
        title: docName,
        description: r.summary || r.subject,
        party: r.from_party,
        sentiment: r.sentiment,
      });
    }

    return events;
  }

  // ===========================================================================
  // DISCREPANCIES
  // ===========================================================================

  private findDiscrepancies(records: any[]): Discrepancy[] {
    const discrepancies: Discrepancy[] = [];

    // Authority ranking for documents (higher = more authoritative)
    const docAuthority: Record<string, number> = {
      'final_bl': 10,
      'draft_bl': 9,
      'si_confirmation': 8,
      'booking_amendment': 7,
      'booking_confirmation': 6,
      'arrival_notice': 5,
    };

    // Check for conflicting values within INTDB records
    // Skip vessel_name and pod_location - often has bad data, carrier cross-validation is more accurate
    const fields = ['etd', 'eta'];

    for (const field of fields) {
      const values = records
        .filter(r => r[field])
        .map(r => ({
          value: r[field],
          date: r.occurred_at,
          type: r.document_type,
          authority: docAuthority[r.document_type] || 1,
        }))
        .sort((a, b) => b.authority - a.authority || new Date(b.date).getTime() - new Date(a.date).getTime());

      // Normalize values for comparison (trim, lowercase for vessel)
      const normalizedUnique = [...new Set(values.map(v =>
        field === 'vessel_name' ? v.value?.toLowerCase().trim() : v.value
      ))];

      if (normalizedUnique.length > 1 && values.length >= 2) {
        const latest = values[0];
        const earlier = values.find(v => v.value !== latest.value);

        if (earlier) {
          // Map field to display name
          const fieldNames: Record<string, string> = {
            'etd': 'ETD',
            'eta': 'ETA',
            'vessel_name': 'Vessel',
            'pod_location': 'POD',
          };
          const fieldName = fieldNames[field] || field;

          // Format value - only use date formatting for date fields
          const isDateField = field === 'etd' || field === 'eta';
          const formatValue = (val: string) => isDateField ? this.formatDateShort(val) : val;

          discrepancies.push({
            field: fieldName,
            intdbValue: `${formatValue(latest.value)} (${latest.type || 'latest'})`,
            otherValue: `${formatValue(earlier.value)} (${earlier.type || 'earlier'})`,
            severity: isDateField ? 'high' : 'medium',
            recommendation: `Using ${latest.type || 'most recent'} value`,
          });
        }
      }
    }

    return discrepancies;
  }

  private formatDateShort(value: string): string {
    if (!value) return 'N/A';
    // If it looks like a date, format it
    if (value.includes('-') || value.includes('/')) {
      try {
        return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      } catch {
        return value;
      }
    }
    return value;
  }

  /**
   * Cross-validate INTDB data against carrier API and flag discrepancies.
   * Carrier API is the source of truth for dates and location.
   */
  private crossValidateAndOverride(dossier: ShipmentDossier): void {
    if (!dossier.liveTracking) return;

    const lt = dossier.liveTracking;
    const intdb = dossier.dates;

    // ETD vs ATD - Compare INTDB ETD with carrier's actual departure
    if (intdb.etd && lt.atd) {
      const intdbDate = intdb.etd.split('T')[0];
      const carrierDate = lt.atd.split('T')[0];
      if (intdbDate !== carrierDate) {
        dossier.discrepancies.push({
          field: 'ETD/ATD',
          intdbValue: `${this.formatDateShort(intdb.etd)} (INTDB)`,
          carrierValue: `${this.formatDateShort(lt.atd)} (Carrier ATD)`,
          severity: 'high',
          recommendation: 'Carrier shows different departure date',
        });
      }
      // Override with carrier truth
      dossier.dates.atd = lt.atd;
    }

    // ETA vs ATA - Compare INTDB ETA with carrier's actual arrival
    if (intdb.eta && lt.ata) {
      const intdbDate = intdb.eta.split('T')[0];
      const carrierDate = lt.ata.split('T')[0];
      if (intdbDate !== carrierDate) {
        dossier.discrepancies.push({
          field: 'ETA/ATA',
          intdbValue: `${this.formatDateShort(intdb.eta)} (INTDB)`,
          carrierValue: `${this.formatDateShort(lt.ata)} (Carrier ATA)`,
          severity: 'high',
          recommendation: 'Carrier shows different arrival date - INTDB may be wrong',
        });
      }
      // Override with carrier truth
      dossier.dates.ata = lt.ata;
    }

    // POD validation - Compare INTDB POD against carrier's destinationPort (not location!)
    if (dossier.pod && lt.destinationPort) {
      const carrierDest = lt.destinationPort.toLowerCase();
      const intdbPod = dossier.pod.toLowerCase();

      // Map port codes to names for comparison
      const portMappings: Record<string, string[]> = {
        'usnyc': ['newark', 'new york', 'nyc', 'maher', 'usnyc'],
        'uschs': ['charleston', 'uschs'],
        'uslax': ['los angeles', 'long beach', 'uslax'],
        'innsa': ['nhava sheva', 'jawaharlal nehru', 'jnpt', 'innsa', 'india'],
        'sgsin': ['singapore', 'sgsin'],
        'cnsha': ['shanghai', 'cnsha'],
        'cnytn': ['yantian', 'cnytn'],
        'hkhkg': ['hong kong', 'hkhkg'],
      };

      // Find which port the carrier destination matches
      let carrierPortCode: string | null = null;
      for (const [code, hints] of Object.entries(portMappings)) {
        if (hints.some(h => carrierDest.includes(h))) {
          carrierPortCode = code.toUpperCase();
          break;
        }
      }

      // Find which port INTDB POD matches
      let intdbPortCode: string | null = null;
      for (const [code, hints] of Object.entries(portMappings)) {
        if (hints.some(h => intdbPod.includes(h)) || intdbPod.includes(code)) {
          intdbPortCode = code.toUpperCase();
          break;
        }
      }

      // Flag mismatch if different ports
      if (carrierPortCode && intdbPortCode && carrierPortCode !== intdbPortCode) {
        dossier.discrepancies.push({
          field: 'POD',
          intdbValue: `${dossier.pod} (${intdbPortCode})`,
          carrierValue: `${lt.destinationPort} (${carrierPortCode})`,
          severity: 'high',
          recommendation: `INTDB shows ${intdbPortCode}, Carrier shows ${carrierPortCode}`,
        });
      }
    }

    // Vessel validation
    if (dossier.vessel && lt.vessel) {
      const intdbVessel = dossier.vessel.toLowerCase().replace(/[^a-z0-9]/g, '');
      const carrierVessel = lt.vessel.toLowerCase().replace(/[^a-z0-9]/g, '');

      if (!carrierVessel.includes(intdbVessel) && !intdbVessel.includes(carrierVessel)) {
        dossier.discrepancies.push({
          field: 'Vessel',
          intdbValue: dossier.vessel,
          carrierValue: lt.vessel,
          severity: 'medium',
          recommendation: 'Vessel name differs from carrier',
        });
      }
    }
  }

  // ===========================================================================
  // ESCALATIONS
  // ===========================================================================

  private findEscalations(records: any[]): Escalation[] {
    const escalations: Escalation[] = [];

    for (const r of records) {
      // Check for urgent/negative sentiment (skip internal Intoglo emails)
      if ((r.sentiment === 'urgent' || r.sentiment === 'negative') &&
          !r.from_address?.includes('intoglo.com')) {
        escalations.push({
          type: this.getEscalationType(r.from_party, r.from_address),
          severity: r.sentiment === 'urgent' ? 'critical' : 'high',
          date: r.occurred_at,
          subject: r.subject,
          from: r.from_address || r.from_party,
          snippet: r.snippet || r.summary || '',
          gmailLink: this.buildGmailLink(r.gmail_message_id),
          emailViewUrl: `/api/chronicle-v2/email-view/${r.id}`,
        });
      }

      // Check for issues - only include if there's meaningful description
      if (r.has_issue && r.issue_description && r.issue_description.length > 10) {
        escalations.push({
          type: 'internal',
          severity: 'high',
          date: r.occurred_at,
          subject: r.issue_description.substring(0, 80),
          from: r.from_party || 'system',
          snippet: r.summary || r.snippet || '',
          gmailLink: this.buildGmailLink(r.gmail_message_id),
          emailViewUrl: `/api/chronicle-v2/email-view/${r.id}`,
        });
      }
    }

    // Sort by date descending (most recent first)
    return escalations.sort((a, b) =>
      new Date(b.date).getTime() - new Date(a.date).getTime()
    ).slice(0, 10);
  }

  private getEscalationType(fromParty: string, fromAddress?: string): Escalation['type'] {
    // Internal Intoglo emails are internal, not customer/vendor
    if (fromAddress?.includes('intoglo.com')) {
      return 'internal';
    }

    if (fromParty === 'customer' || fromParty === 'shipper' || fromParty === 'consignee') {
      return 'customer';
    }
    if (fromParty === 'carrier' || fromParty === 'trucker' || fromParty === 'broker') {
      return 'vendor';
    }
    return 'internal';
  }

  // ===========================================================================
  // STAGE & HEALTH
  // ===========================================================================

  private determineStage(records: any[]): string {
    const docTypes = new Set(records.map(r => r.document_type).filter(Boolean));

    if (docTypes.has('delivery_order') || docTypes.has('pod_proof_of_delivery')) {
      return 'DELIVERED';
    }
    if (docTypes.has('arrival_notice')) {
      return 'ARRIVED';
    }
    if (docTypes.has('final_bl') || docTypes.has('telex_release')) {
      return 'DEPARTED';
    }
    if (docTypes.has('draft_bl')) {
      return 'DRAFT_BL';
    }
    if (docTypes.has('si_confirmation')) {
      return 'SI_CONFIRMED';
    }
    if (docTypes.has('shipping_instructions')) {
      return 'SI_SUBMITTED';
    }
    if (docTypes.has('booking_confirmation')) {
      return 'BOOKED';
    }
    return 'PENDING';
  }

  private calculateHealth(records: any[]): number {
    let score = 100;

    const pendingActions = records.filter(r => r.has_action && !r.action_completed_at);
    const now = new Date();

    // Deduct for overdue actions (max 30 points total)
    let overdueDeduction = 0;
    for (const action of pendingActions) {
      if (action.action_deadline) {
        const deadline = new Date(action.action_deadline);
        const daysOverdue = Math.floor((now.getTime() - deadline.getTime()) / (1000 * 60 * 60 * 24));
        if (daysOverdue > 0) {
          overdueDeduction += 3; // 3 points per overdue action
        }
      }
    }
    score -= Math.min(overdueDeduction, 30);

    // Deduct for negative sentiment from external parties only (max 15 points)
    const negativeSentiments = records.filter(r =>
      (r.sentiment === 'negative' || r.sentiment === 'urgent') &&
      !r.from_address?.includes('intoglo.com')
    );
    score -= Math.min(negativeSentiments.length * 5, 15);

    // Deduct for issues (max 15 points)
    const issues = records.filter(r => r.has_issue);
    score -= Math.min(issues.length * 5, 15);

    return Math.max(0, Math.min(100, score));
  }

  private calculateDocumentCompletion(records: any[]): number {
    const requiredDocs = ['booking_confirmation', 'shipping_instructions', 'draft_bl', 'final_bl'];
    const received = new Set(records.map(r => r.document_type).filter(Boolean));

    let count = 0;
    for (const doc of requiredDocs) {
      if (received.has(doc)) count++;
    }

    return Math.round((count / requiredDocs.length) * 100);
  }

  private extractPendingActions(records: any[]): PendingActionInfo[] {
    const now = new Date();
    const actions: PendingActionInfo[] = [];

    for (const r of records) {
      if (r.has_action && !r.action_completed_at && r.action_description) {
        const deadline = r.action_deadline ? new Date(r.action_deadline) : null;

        // Only show future actions (upcoming) or actions without deadline
        // Skip all overdue actions - they need manual cleanup
        if (deadline && deadline < now) {
          continue;
        }

        actions.push({
          description: r.action_description,
          owner: r.action_owner || undefined,
          deadline: r.action_deadline || undefined,
          isOverdue: false,  // Never overdue since we filter them out
        });
      }
    }

    // Sort by deadline (soonest first)
    return actions.sort((a, b) => {
      if (a.deadline && b.deadline) {
        return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
      }
      if (a.deadline) return -1;  // Actions with deadline first
      if (b.deadline) return 1;
      return 0;
    });
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private formatDate(dateStr: string): string {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
}

// =============================================================================
// FACTORY
// =============================================================================

let instance: ShipmentDossierService | null = null;

export function getShipmentDossierService(supabase?: SupabaseClient): ShipmentDossierService {
  if (!instance || supabase) {
    instance = new ShipmentDossierService(supabase);
  }
  return instance;
}
