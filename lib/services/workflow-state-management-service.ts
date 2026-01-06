/**
 * Workflow State Management Service
 *
 * SINGLE SOURCE OF TRUTH for workflow states.
 *
 * This service consolidates all workflow-related logic:
 * - State definitions and ordering
 * - Document type to state mappings
 * - Classification patterns
 * - Direction detection
 * - Backfill logic
 * - Verification/diagnostics
 *
 * Usage:
 *   const service = new WorkflowStateManagementService(supabase);
 *
 *   // Add a new workflow state
 *   service.addState({
 *     key: 'checklist_received',
 *     label: 'Checklist Received',
 *     order: 40,
 *     documentTypes: ['checklist'],
 *     direction: 'inbound',
 *     classificationPatterns: [
 *       /\bchecklist\s+(attached|for|ready)/i,
 *       /\bexport\s+checklist/i,
 *     ],
 *   });
 *
 *   // Run full verification
 *   const report = await service.verify();
 *
 *   // Backfill workflow states
 *   await service.backfillFromDocuments();
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { getAllRows } from '../utils/supabase-pagination';
import { ShipmentRepository } from '@/lib/repositories';

// ============================================================================
// Types
// ============================================================================

export interface WorkflowStateDefinition {
  key: string;
  label: string;
  order: number;
  phase: 'pre_shipment' | 'in_transit' | 'arrival' | 'delivery';
  documentTypes: string[];
  direction: 'inbound' | 'outbound' | 'any';
  classificationPatterns: RegExp[];
  /** States that must be reached before this one (validation) */
  prerequisites?: string[];
}

export interface VerificationReport {
  totalShipments: number;
  totalDocuments: number;
  totalEmails: number;
  stateDistribution: Record<string, number>;
  documentTypeDistribution: Record<string, { inbound: number; outbound: number }>;
  stateAnalysis: Array<{
    state: string;
    label: string;
    expectedDocs: number;
    actualDocs: number;
    linkedToShipments: number;
    unlinkedEmails: number;
    currentStateCount: number;
    gap: string;
  }>;
  recommendations: string[];
}

export interface BackfillResult {
  updated: number;
  skipped: number;
  errors: number;
  changes: Array<{ shipmentId: string; bookingNumber: string; oldState: string; newState: string }>;
}

// ============================================================================
// State Definitions
// ============================================================================

/**
 * Complete workflow state definitions
 * Add new states here - this is the SINGLE SOURCE OF TRUTH
 */
const WORKFLOW_STATES: WorkflowStateDefinition[] = [
  // ========== PRE-SHIPMENT ==========
  {
    key: 'booking_confirmation_received',
    label: 'BC Received',
    order: 10,
    phase: 'pre_shipment',
    documentTypes: ['booking_confirmation', 'booking_amendment'],
    direction: 'inbound',
    classificationPatterns: [
      /\bbooking\s+(confirmation|confirmed)\b/i,
      /\byour\s+booking\s+(has\s+been\s+)?confirmed\b/i,
    ],
  },
  {
    key: 'booking_confirmation_shared',
    label: 'BC Shared',
    order: 15,
    phase: 'pre_shipment',
    documentTypes: ['booking_confirmation', 'booking_amendment'],
    direction: 'outbound',
    classificationPatterns: [],
  },
  {
    key: 'si_draft_received',
    label: 'SI Draft Received',
    order: 30,
    phase: 'pre_shipment',
    documentTypes: ['si_draft', 'shipping_instruction'],
    direction: 'inbound',
    classificationPatterns: [
      /\bshipping\s+instruction/i,
      /\bSI\s+(draft|attached|for\s+review)/i,
    ],
  },
  {
    key: 'si_draft_sent',
    label: 'SI Draft Sent',
    order: 32,
    phase: 'pre_shipment',
    documentTypes: ['si_draft', 'shipping_instruction'],
    direction: 'outbound',
    classificationPatterns: [],
  },
  {
    key: 'checklist_received',
    label: 'Checklist Received',
    order: 40,
    phase: 'pre_shipment',
    documentTypes: ['checklist'],
    direction: 'inbound',
    classificationPatterns: [
      /\bchecklist\s+(attached|for|ready)/i,
      /\bexport\s+checklist/i,
      /\bCHA\s+checklist/i,
      /\bchecklist\s+for\s+approval/i,
    ],
  },
  {
    key: 'checklist_shared',
    label: 'Checklist Shared',
    order: 42,
    phase: 'pre_shipment',
    documentTypes: ['checklist'],
    direction: 'outbound',
    classificationPatterns: [],
  },
  {
    key: 'shipping_bill_received',
    label: 'LEO/SB Received',
    order: 48,
    phase: 'pre_shipment',
    documentTypes: ['shipping_bill', 'leo_copy'],
    direction: 'inbound',
    classificationPatterns: [
      /\bshipping\s+bill\s+(copy|number|attached)/i,
      /\bSB\s+(copy|no\.?|number)/i,
      /\bLEO\s+(copy|attached|received)/i,
      /\blet\s+export\s+order/i,
    ],
  },
  {
    key: 'si_confirmed',
    label: 'SI Confirmed',
    order: 60,
    phase: 'pre_shipment',
    documentTypes: ['si_submission', 'si_confirmation'],
    direction: 'inbound',
    classificationPatterns: [
      /\bSI\s+(confirmed|submitted|received)/i,
    ],
  },
  {
    key: 'vgm_submitted',
    label: 'VGM Submitted',
    order: 65,
    phase: 'pre_shipment',
    documentTypes: ['vgm_submission', 'vgm_confirmation'],
    direction: 'inbound',
    classificationPatterns: [
      /\bVGM\s+(submitted|confirmed|received)/i,
    ],
  },

  // ========== IN-TRANSIT ==========
  {
    key: 'sob_received',
    label: 'SOB Received',
    order: 80,
    phase: 'in_transit',
    documentTypes: ['sob_confirmation'],
    direction: 'inbound',
    classificationPatterns: [
      /\bSOB\s+(confirmation|confirmed)/i,
      /\bshipped\s+on\s+board/i,
    ],
  },
  {
    key: 'bl_received',
    label: 'BL Received',
    order: 119,
    phase: 'in_transit',
    documentTypes: ['bill_of_lading', 'house_bl'],
    direction: 'inbound',
    classificationPatterns: [
      /\b(bill\s+of\s+lading|B\/L)\s+(attached|copy|draft)/i,
    ],
  },
  {
    key: 'hbl_draft_sent',
    label: 'HBL Draft Sent',
    order: 120,
    phase: 'in_transit',
    documentTypes: ['bill_of_lading', 'house_bl', 'hbl_draft'],
    direction: 'outbound',
    classificationPatterns: [],
  },
  {
    key: 'hbl_shared',
    label: 'HBL Shared',
    order: 132,
    phase: 'in_transit',
    documentTypes: ['bill_of_lading', 'house_bl'],
    direction: 'outbound',
    classificationPatterns: [],
  },
  {
    key: 'invoice_sent',
    label: 'Invoice Sent',
    order: 135,
    phase: 'in_transit',
    documentTypes: ['invoice', 'freight_invoice'],
    direction: 'outbound',
    classificationPatterns: [],
  },

  // ========== ARRIVAL & CUSTOMS ==========
  {
    key: 'entry_draft_received',
    label: 'Entry Draft Received',
    order: 153,
    phase: 'arrival',
    documentTypes: ['draft_entry', 'customs_document'],
    direction: 'inbound',
    classificationPatterns: [
      /\bdraft\s+entry/i,
      /\bentry\s+draft/i,
      /\b7501\s+draft/i,
      /\bcustoms\s+entry\s+(draft|for\s+review)/i,
      /\bentry\s+for\s+(review|approval)/i,
      /\bentry\s+approval\s+required/i,
      /\bentry\s+\d*[A-Z]{2,3}[- ]?\d+.*pre-?alert/i,
    ],
  },
  {
    key: 'entry_draft_shared',
    label: 'Entry Draft Shared',
    order: 156,
    phase: 'arrival',
    documentTypes: ['draft_entry'],
    direction: 'outbound',
    classificationPatterns: [],
  },
  {
    key: 'entry_summary_received',
    label: 'Entry Summary Received',
    order: 168,
    phase: 'arrival',
    documentTypes: ['entry_summary'],
    direction: 'inbound',
    classificationPatterns: [
      /\bentry\s+summary/i,
      /\b7501\s+(filed|submitted|summary)/i,
      /\bfiled\s+entry/i,
      /\bcustoms\s+entry\s+(filed|released)/i,
      /\d+-\d+-\d+-7501\b/,
      /\b\d{3}-\d{7}-\d-7501\b/,
    ],
  },
  {
    key: 'entry_summary_shared',
    label: 'Entry Summary Shared',
    order: 172,
    phase: 'arrival',
    documentTypes: ['entry_summary'],
    direction: 'outbound',
    classificationPatterns: [],
  },
  {
    key: 'arrival_notice_received',
    label: 'AN Received',
    order: 180,
    phase: 'arrival',
    documentTypes: ['arrival_notice', 'shipment_notice'],
    direction: 'inbound',
    classificationPatterns: [
      /\barrival\s+notice/i,
      /\bAN\s+(attached|copy)/i,
    ],
  },
  {
    key: 'arrival_notice_shared',
    label: 'AN Shared',
    order: 185,
    phase: 'arrival',
    documentTypes: ['arrival_notice'],
    direction: 'outbound',
    classificationPatterns: [],
  },
  {
    key: 'cargo_released',
    label: 'Cargo Released',
    order: 192,
    phase: 'arrival',
    documentTypes: ['container_release'],
    direction: 'inbound',
    classificationPatterns: [
      /\bcargo\s+released/i,
      /\bcontainer\s+release/i,
    ],
  },
  {
    key: 'duty_invoice_received',
    label: 'Duty Invoice Received',
    order: 195,
    phase: 'arrival',
    documentTypes: ['duty_invoice'],
    direction: 'inbound',
    classificationPatterns: [
      /\bduty\s+invoice/i,
      /\bduty\s+(payment|statement)/i,
      /\bduty\s+bill\b/i,
      /\brequest\s+for\s+duty/i,
      /\bcustoms\s+duty/i,
    ],
  },
  {
    key: 'duty_summary_shared',
    label: 'Duty Invoice Shared',
    order: 200,
    phase: 'arrival',
    documentTypes: ['duty_invoice'],
    direction: 'outbound',
    classificationPatterns: [
      /\bduty\s+summary\s+approval/i,
    ],
  },

  // ========== DELIVERY ==========
  {
    key: 'delivery_order_received',
    label: 'DO Received',
    order: 205,
    phase: 'delivery',
    documentTypes: ['delivery_order'],
    direction: 'inbound',
    classificationPatterns: [
      /\bdelivery\s+order/i,
      /\bDO\s+(attached|copy)/i,
    ],
  },
  {
    key: 'delivery_order_shared',
    label: 'DO Shared',
    order: 210,
    phase: 'delivery',
    documentTypes: ['delivery_order'],
    direction: 'outbound',
    classificationPatterns: [],
  },
  {
    key: 'container_released',
    label: 'Container Released',
    order: 220,
    phase: 'delivery',
    documentTypes: ['container_release'],
    direction: 'outbound',
    classificationPatterns: [],
  },
  {
    key: 'pod_received',
    label: 'POD Received',
    order: 235,
    phase: 'delivery',
    documentTypes: ['proof_of_delivery', 'pod_confirmation'],
    direction: 'inbound',
    classificationPatterns: [
      /\bproof\s+of\s+delivery/i,
      /\bPOD\s+(attached|confirmed|received)/i,
    ],
  },
];

// ============================================================================
// Service
// ============================================================================

export class WorkflowStateManagementService {
  private states: Map<string, WorkflowStateDefinition> = new Map();
  private stateOrder: Map<string, number> = new Map();
  private shipmentRepository: ShipmentRepository;

  constructor(private supabase: SupabaseClient) {
    this.shipmentRepository = new ShipmentRepository(supabase);
    // Initialize with default states
    for (const state of WORKFLOW_STATES) {
      this.states.set(state.key, state);
      this.stateOrder.set(state.key, state.order);
    }
  }

  // --------------------------------------------------------------------------
  // State Management
  // --------------------------------------------------------------------------

  /**
   * Add a new workflow state (for extensibility)
   */
  addState(state: WorkflowStateDefinition): void {
    this.states.set(state.key, state);
    this.stateOrder.set(state.key, state.order);
  }

  /**
   * Get all states sorted by order
   */
  getAllStates(): WorkflowStateDefinition[] {
    return Array.from(this.states.values()).sort((a, b) => a.order - b.order);
  }

  /**
   * Get state by key
   */
  getState(key: string): WorkflowStateDefinition | undefined {
    return this.states.get(key);
  }

  /**
   * Get state order (for comparisons)
   */
  getStateOrder(key: string): number {
    return this.stateOrder.get(key) || 0;
  }

  // --------------------------------------------------------------------------
  // Classification
  // --------------------------------------------------------------------------

  /**
   * Classify an email subject to a document type
   */
  classifySubject(subject: string): { documentType: string; stateKey: string } | null {
    for (const state of this.states.values()) {
      for (const pattern of state.classificationPatterns) {
        if (pattern.test(subject)) {
          return {
            documentType: state.documentTypes[0],
            stateKey: state.key,
          };
        }
      }
    }
    return null;
  }

  /**
   * Get all classification patterns (for use in unified-classification-service)
   */
  getClassificationPatterns(): Array<{ pattern: RegExp; type: string; confidence: number }> {
    const patterns: Array<{ pattern: RegExp; type: string; confidence: number }> = [];
    for (const state of this.states.values()) {
      for (const pattern of state.classificationPatterns) {
        patterns.push({
          pattern,
          type: state.documentTypes[0],
          confidence: 90,
        });
      }
    }
    return patterns;
  }

  // --------------------------------------------------------------------------
  // Direction Detection
  // --------------------------------------------------------------------------

  /**
   * Carrier patterns in subject lines that indicate inbound emails
   */
  private static readonly CARRIER_SUBJECT_PATTERNS = [
    /\bmaersk\b/i, /\bhapag/i, /\bcma.?cgm\b/i, /\bcosco\b/i, /\bevergreen\b/i,
    /\bmsc\b/i, /\bone.?line\b/i, /\byangming\b/i, /\boocl\b/i, /\bzim\b/i,
    /booking\s*confirmation/i, /booking\s*amendment/i, /shipment\s*notice/i,
  ];

  private static readonly CARRIER_SENDER_KEYWORDS = [
    'maersk', 'hapag', 'hlag', 'cma-cgm', 'cma cgm', 'cosco', 'coscon',
    'evergreen', 'msc', 'one-line', 'yangming', 'oocl', 'zim', 'pil', 'apl',
    'noreply', 'no-reply', 'donotreply', 'please-no-reply', 'iris-', 'website',
    'cenfact', 'in.export', 'in.import', 'export', 'import', 'booking', 'service.hlag',
  ];

  /**
   * Detect email direction using TRUE sender (via pattern) and subject line
   *
   * NOTE: We DON'T blindly trust email_direction because it was set incorrectly
   * for many forwarded carrier emails from ops@intoglo.com
   */
  getDirection(
    senderEmail: string | null,
    emailDirection?: string | null,
    subject?: string | null
  ): 'inbound' | 'outbound' {
    const sender = (senderEmail || '').toLowerCase();
    const subj = (subject || '').toLowerCase();

    // 1. Parse "via" pattern to get TRUE sender
    const viaMatch = (senderEmail || '').match(/^['"]?(.+?)['"]?\s+via\s+/i);
    if (viaMatch) {
      const trueSender = viaMatch[1].toLowerCase();
      if (WorkflowStateManagementService.CARRIER_SENDER_KEYWORDS.some(kw => trueSender.includes(kw))) {
        return 'inbound';
      }
    }

    // 2. For Intoglo senders, check subject for carrier patterns
    if (sender.includes('@intoglo.com') || sender.includes('@intoglo.in')) {
      if (WorkflowStateManagementService.CARRIER_SUBJECT_PATTERNS.some(p => p.test(subj))) {
        return 'inbound';
      }
      // Carrier booking number patterns
      if (/\b26\d{7}\b/.test(subj)) return 'inbound';  // Maersk
      if (/\bCOSU\d{6,}/i.test(subj)) return 'inbound';  // COSCO
      if (/\b(AMC|CEI|EID|CAD)\d{6,}/i.test(subj)) return 'inbound';  // CMA CGM
      if (/\bHL(CU|CL)?\d{6,}/i.test(subj)) return 'inbound';  // Hapag

      // Fall back to email_direction if set
      if (emailDirection) return emailDirection as 'inbound' | 'outbound';
      return 'outbound';
    }

    // 3. Non-Intoglo sender = inbound
    return 'inbound';
  }

  // --------------------------------------------------------------------------
  // State Determination
  // --------------------------------------------------------------------------

  /**
   * Determine workflow state from document type and direction
   */
  getWorkflowStateFromDocument(documentType: string, direction: 'inbound' | 'outbound'): string | null {
    for (const state of this.states.values()) {
      if (state.documentTypes.includes(documentType)) {
        if (state.direction === 'any' || state.direction === direction) {
          return state.key;
        }
      }
    }
    return null;
  }

  /**
   * Find the highest workflow state a shipment should be at based on its documents
   */
  async calculateHighestState(
    shipmentId: string,
    docs: Array<{ document_type: string; email_id: string }>,
    emailMap: Map<string, { sender_email: string | null; email_direction: string | null; subject?: string | null }>
  ): Promise<string | null> {
    let highestOrder = 0;
    let highestState: string | null = null;

    for (const doc of docs) {
      const email = emailMap.get(doc.email_id);
      if (!email) continue;

      const direction = this.getDirection(email.sender_email, email.email_direction, email.subject);
      const state = this.getWorkflowStateFromDocument(doc.document_type, direction);

      if (state) {
        const order = this.getStateOrder(state);
        if (order > highestOrder) {
          highestOrder = order;
          highestState = state;
        }
      }
    }

    return highestState;
  }

  // --------------------------------------------------------------------------
  // Backfill
  // --------------------------------------------------------------------------

  /**
   * Backfill workflow_state for all shipments based on their documents
   */
  async backfillFromDocuments(): Promise<BackfillResult> {
    console.log('=== BACKFILL WORKFLOW STATES ===\n');

    // Load data
    const [shipments, docs, emails] = await Promise.all([
      getAllRows<{ id: string; booking_number: string; workflow_state: string | null }>(
        this.supabase, 'shipments', 'id, booking_number, workflow_state'
      ),
      getAllRows<{ shipment_id: string; email_id: string; document_type: string }>(
        this.supabase, 'shipment_documents', 'shipment_id, email_id, document_type'
      ),
      getAllRows<{ id: string; subject: string | null; sender_email: string | null; email_direction: string | null }>(
        this.supabase, 'raw_emails', 'id, subject, sender_email, email_direction'
      ),
    ]);

    console.log(`Loaded: ${shipments.length} shipments, ${docs.length} documents, ${emails.length} emails\n`);

    const emailMap = new Map(emails.map(e => [e.id, e]));

    // Group docs by shipment
    const shipmentDocs = new Map<string, Array<{ document_type: string; email_id: string }>>();
    for (const doc of docs) {
      if (!shipmentDocs.has(doc.shipment_id)) {
        shipmentDocs.set(doc.shipment_id, []);
      }
      shipmentDocs.get(doc.shipment_id)!.push(doc);
    }

    const result: BackfillResult = {
      updated: 0,
      skipped: 0,
      errors: 0,
      changes: [],
    };

    for (const shipment of shipments) {
      const docList = shipmentDocs.get(shipment.id) || [];
      const newState = await this.calculateHighestState(shipment.id, docList, emailMap);

      if (!newState) {
        result.skipped++;
        continue;
      }

      const currentOrder = this.getStateOrder(shipment.workflow_state || '');
      const newOrder = this.getStateOrder(newState);

      if (newOrder > currentOrder) {
        try {
          await this.shipmentRepository.update(shipment.id, { workflow_state: newState });
          result.updated++;
          result.changes.push({
            shipmentId: shipment.id,
            bookingNumber: shipment.booking_number,
            oldState: shipment.workflow_state || 'NULL',
            newState,
          });
        } catch {
          result.errors++;
        }
      } else {
        result.skipped++;
      }
    }

    return result;
  }

  // --------------------------------------------------------------------------
  // Verification
  // --------------------------------------------------------------------------

  /**
   * Run full verification and return diagnostic report
   */
  async verify(): Promise<VerificationReport> {
    console.log('=== WORKFLOW STATE VERIFICATION ===\n');

    // Load data
    const [shipments, docs, emails] = await Promise.all([
      getAllRows<{ id: string; workflow_state: string | null }>(
        this.supabase, 'shipments', 'id, workflow_state'
      ),
      getAllRows<{ shipment_id: string; email_id: string; document_type: string }>(
        this.supabase, 'shipment_documents', 'shipment_id, email_id, document_type'
      ),
      getAllRows<{ id: string; subject: string; sender_email: string | null; email_direction: string | null }>(
        this.supabase, 'raw_emails', 'id, subject, sender_email, email_direction'
      ),
    ]);

    const linkedEmailIds = new Set(docs.map(d => d.email_id));
    const emailMap = new Map(emails.map(e => [e.id, e]));

    // State distribution
    const stateDistribution: Record<string, number> = {};
    for (const s of shipments) {
      const state = s.workflow_state || 'NULL';
      stateDistribution[state] = (stateDistribution[state] || 0) + 1;
    }

    // Document type distribution with direction
    const docTypeDistribution: Record<string, { inbound: number; outbound: number }> = {};
    for (const doc of docs) {
      const email = emailMap.get(doc.email_id);
      const direction = this.getDirection(email?.sender_email || null, email?.email_direction, email?.subject);

      if (!docTypeDistribution[doc.document_type]) {
        docTypeDistribution[doc.document_type] = { inbound: 0, outbound: 0 };
      }
      docTypeDistribution[doc.document_type][direction]++;
    }

    // Per-state analysis
    const stateAnalysis: VerificationReport['stateAnalysis'] = [];

    for (const state of this.getAllStates()) {
      // Count emails matching classification patterns
      let matchingEmails = 0;
      let unlinkedEmails = 0;

      for (const email of emails) {
        let matches = false;
        for (const pattern of state.classificationPatterns) {
          if (pattern.test(email.subject || '')) {
            matches = true;
            break;
          }
        }
        if (matches) {
          matchingEmails++;
          if (!linkedEmailIds.has(email.id)) {
            unlinkedEmails++;
          }
        }
      }

      // Count documents of this type
      let linkedDocs = 0;
      for (const doc of docs) {
        if (state.documentTypes.includes(doc.document_type)) {
          const email = emailMap.get(doc.email_id);
          const direction = this.getDirection(email?.sender_email || null, email?.email_direction, email?.subject);
          if (state.direction === 'any' || state.direction === direction) {
            linkedDocs++;
          }
        }
      }

      // Current state count
      const currentStateCount = stateDistribution[state.key] || 0;

      // Determine gap
      let gap = 'OK';
      if (unlinkedEmails > 0 && linkedDocs === 0) {
        gap = `LINKING GAP: ${unlinkedEmails} emails not linked`;
      } else if (matchingEmails === 0 && state.classificationPatterns.length > 0) {
        gap = 'NO MATCHES: Check patterns';
      } else if (linkedDocs > 0 && currentStateCount === 0) {
        gap = 'BACKFILL NEEDED: Docs exist but no shipments at this state';
      }

      stateAnalysis.push({
        state: state.key,
        label: state.label,
        expectedDocs: matchingEmails,
        actualDocs: linkedDocs,
        linkedToShipments: linkedDocs,
        unlinkedEmails,
        currentStateCount,
        gap,
      });
    }

    // Generate recommendations
    const recommendations: string[] = [];
    for (const analysis of stateAnalysis) {
      if (analysis.gap.startsWith('LINKING GAP')) {
        recommendations.push(`Link ${analysis.unlinkedEmails} unlinked ${analysis.label} emails by thread or reference`);
      }
      if (analysis.gap.startsWith('BACKFILL NEEDED')) {
        recommendations.push(`Run backfillFromDocuments() to update workflow_state for ${analysis.label}`);
      }
    }

    return {
      totalShipments: shipments.length,
      totalDocuments: docs.length,
      totalEmails: emails.length,
      stateDistribution,
      documentTypeDistribution: docTypeDistribution,
      stateAnalysis,
      recommendations,
    };
  }

  /**
   * Print verification report to console
   */
  printReport(report: VerificationReport): void {
    console.log('=== WORKFLOW STATE VERIFICATION REPORT ===\n');
    console.log(`Shipments: ${report.totalShipments}`);
    console.log(`Documents: ${report.totalDocuments}`);
    console.log(`Emails: ${report.totalEmails}\n`);

    console.log('=== STATE ANALYSIS ===\n');
    console.log('State                      Docs  Linked  Unlinked  Current  Status');
    console.log('─'.repeat(75));

    for (const analysis of report.stateAnalysis) {
      const status = analysis.gap === 'OK' ? '✓' : '⚠';
      console.log(
        `${analysis.label.padEnd(25)} ${analysis.expectedDocs.toString().padStart(4)}  ` +
        `${analysis.linkedToShipments.toString().padStart(6)}  ` +
        `${analysis.unlinkedEmails.toString().padStart(8)}  ` +
        `${analysis.currentStateCount.toString().padStart(7)}  ${status} ${analysis.gap !== 'OK' ? analysis.gap : ''}`
      );
    }

    if (report.recommendations.length > 0) {
      console.log('\n=== RECOMMENDATIONS ===\n');
      report.recommendations.forEach((r, i) => {
        console.log(`${i + 1}. ${r}`);
      });
    }
  }
}

// Export singleton for convenience
export const WORKFLOW_STATES_CONFIG = WORKFLOW_STATES;
