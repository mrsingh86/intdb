/**
 * Bot Command Handlers
 *
 * Formats unified intelligence data for WhatsApp/Telegram display.
 * Supports the internal ops team bot commands.
 *
 * Commands:
 * - status <reference>  - Full unified status
 * - track <container>   - Live tracking only
 * - docs <reference>    - Document status
 * - pending             - All pending actions
 * - deadlines <booking> - Cutoff dates
 * - charges <container> - D&D charges
 * - mismatch            - Data discrepancies
 * - customer <name>     - Customer shipments
 * - urgent              - Overdue + critical items
 * - today               - Today's schedule
 * - help                - Command list
 *
 * Following CLAUDE.md principles:
 * - Small Functions (Principle #17)
 * - Single Responsibility (Principle #3)
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type {
  CommandResult,
  UnifiedShipmentStatus,
  CarrierTrackingData,
  CarrierCharges,
  PendingAction,
  ValidationAlert,
} from './types';
import { getUnifiedIntelligenceService, UnifiedIntelligenceService } from './unified-intelligence-service';
import { getOpsIntelligenceService, OpsIntelligenceService } from './ops-intelligence-service';
import { getShipmentDossierService, ShipmentDossierService, ShipmentDossier } from './shipment-dossier-service';

// =============================================================================
// BOT COMMAND HANDLER
// =============================================================================

export class BotCommandHandler {
  private service: UnifiedIntelligenceService;
  private opsService: OpsIntelligenceService;
  private dossierService: ShipmentDossierService;

  constructor(supabaseClient?: SupabaseClient) {
    this.service = getUnifiedIntelligenceService(supabaseClient);
    this.opsService = getOpsIntelligenceService(supabaseClient);
    this.dossierService = getShipmentDossierService(supabaseClient);
  }

  /**
   * Parse and execute a bot command
   */
  async handleCommand(input: string): Promise<CommandResult> {
    const trimmed = input.trim();
    const parts = trimmed.split(/\s+/);
    const command = parts[0].toLowerCase().replace('@bot', '').replace('/', '');
    const args = parts.slice(1).join(' ');

    switch (command) {
      case 'status':
        return this.handleStatus(args);
      case 'track':
        return this.handleTrack(args);
      case 'docs':
        return this.handleDocs(args);
      case 'pending':
        return this.handlePending();
      case 'deadlines':
        return this.handleDeadlines(args);
      case 'charges':
        return this.handleCharges(args);
      case 'mismatch':
        return this.handleMismatchNew();
      case 'customer':
        return this.handleCustomer(args);
      case 'urgent':
        return this.handleUrgent();
      case 'today':
        return this.handleToday();
      case 'dashboard':
      case 'dash':
        return this.handleDashboard();
      case 'risk':
      case 'health':
        return this.handleRisk();
      case 'blockers':
      case 'blocked':
        return this.handleBlockers();
      case 'cutoffs':
        return this.handleCutoffs();
      case 'timeline':
        return this.handleTimeline(args);
      case 'help':
        return this.handleHelp();
      default:
        // If input looks like a booking/container number, treat as status query
        if (/^[A-Z0-9]{8,15}$/i.test(trimmed)) {
          return this.handleStatus(trimmed);
        }
        return this.handleHelp();
    }
  }

  // ===========================================================================
  // COMMAND HANDLERS
  // ===========================================================================

  /**
   * COMPREHENSIVE SHIPMENT DOSSIER
   * Shows everything about a shipment in one view
   */
  private async handleStatus(reference: string): Promise<CommandResult> {
    if (!reference) {
      return {
        success: false,
        command: 'status',
        message: '❌ Please provide a booking number, container, or MBL.\n\nExample: `status 262226938`',
      };
    }

    try {
      const dossier = await this.dossierService.getShipmentDossier(reference);

      if (!dossier) {
        return {
          success: false,
          command: 'status',
          message: `❌ No shipment found for: ${reference}`,
        };
      }

      return {
        success: true,
        command: 'status',
        message: this.formatDossier(dossier),
        buttons: [
          { label: '📍 Track', callback: `track ${dossier.containerNumbers[0] || reference}` },
          { label: '📄 Timeline', callback: `timeline ${reference}` },
          { label: '💰 Charges', callback: `charges ${dossier.containerNumbers[0] || reference}` },
        ],
      };
    } catch (error) {
      return {
        success: false,
        command: 'status',
        message: `❌ Error fetching shipment: ${error}`,
      };
    }
  }

  /**
   * Format comprehensive shipment dossier
   */
  private formatDossier(d: ShipmentDossier): string {
    let msg = '';

    // ═══════════════════════════════════════════════════════════════════════
    // HEADER
    // ═══════════════════════════════════════════════════════════════════════
    msg += `📦 *SHIPMENT DOSSIER*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    // Identifiers
    msg += `*Booking:* \`${d.bookingNumber}\`\n`;
    if (d.mblNumber) msg += `*MBL:* \`${d.mblNumber}\`\n`;
    if (d.containerNumbers.length > 0) {
      msg += `*Container(s):* ${d.containerNumbers.map(c => `\`${c}\``).join(', ')}\n`;
    }
    msg += '\n';

    // Stage & Health
    const healthEmoji = d.healthScore >= 80 ? '🟢' : d.healthScore >= 60 ? '🟡' : d.healthScore >= 40 ? '🟠' : '🔴';
    msg += `*Stage:* ${d.stage} | *Health:* ${healthEmoji} ${d.healthScore}/100\n\n`;

    // ═══════════════════════════════════════════════════════════════════════
    // PARTIES & ROUTE
    // ═══════════════════════════════════════════════════════════════════════
    msg += `*ROUTE & PARTIES*\n`;
    if (d.shipper) msg += `├ Shipper: ${d.shipper}\n`;
    if (d.consignee) msg += `├ Consignee: ${d.consignee}\n`;
    if (d.carrier) msg += `├ Carrier: ${d.carrier}\n`;
    if (d.pol && d.pod) msg += `├ Route: ${d.pol} → ${d.pod}\n`;
    if (d.vessel) msg += `└ Vessel: ${d.vessel}${d.voyage ? ` / ${d.voyage}` : ''}\n`;
    msg += '\n';

    // ═══════════════════════════════════════════════════════════════════════
    // KEY DATES
    // ═══════════════════════════════════════════════════════════════════════
    msg += `*KEY DATES*\n`;
    if (d.dates.etd) {
      const sailed = d.dates.atd ? ' ✅ SAILED' : '';
      msg += `├ ETD: ${this.formatDate(d.dates.etd)}${sailed}\n`;
    }
    if (d.dates.eta) {
      const arrived = d.dates.ata ? ' ✅ ARRIVED' : '';
      msg += `├ ETA: ${this.formatDate(d.dates.eta)}${arrived}\n`;
    }
    if (d.dates.atd) msg += `├ ATD: ${this.formatDate(d.dates.atd)}\n`;
    if (d.dates.ata) msg += `├ ATA: ${this.formatDate(d.dates.ata)}\n`;
    msg += '\n';

    // ═══════════════════════════════════════════════════════════════════════
    // CUTOFFS
    // ═══════════════════════════════════════════════════════════════════════
    if (d.cutoffs.length > 0) {
      msg += `*CUTOFFS*\n`;
      for (const c of d.cutoffs) {
        const icon = c.status === 'passed' ? '✅' : c.status === 'today' ? '🔴' : '⏰';
        const dateStr = this.formatDateShort(c.date);
        const status = c.status === 'passed' ? `${dateStr} ✓` :
                       c.status === 'today' ? `${dateStr} (${c.hoursRemaining}h left)` :
                       dateStr;
        msg += `├ ${icon} ${c.displayName}: ${status}\n`;
      }
      msg += '\n';
    }

    // ═══════════════════════════════════════════════════════════════════════
    // LIVE TRACKING
    // ═══════════════════════════════════════════════════════════════════════
    if (d.liveTracking) {
      const lt = d.liveTracking;
      msg += `*LIVE TRACKING* (${lt.source})\n`;
      msg += `├ Status: ${this.getStatusEmoji(lt.status)} ${lt.status}\n`;
      if (lt.location) msg += `├ Location: ${lt.location}\n`;
      if (lt.lastEvent) msg += `└ Last: ${lt.lastEvent}\n`;
      msg += '\n';
    }

    // ═══════════════════════════════════════════════════════════════════════
    // D&D CHARGES (when available)
    // ═══════════════════════════════════════════════════════════════════════
    if (d.dnd) {
      const dnd = d.dnd;
      msg += `*💰 D&D CHARGES*\n`;

      // Show free time info
      if (dnd.lastFreeDay) {
        const lastFree = new Date(dnd.lastFreeDay);
        const now = new Date();
        const daysLeft = Math.ceil((lastFree.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        if (daysLeft > 0) {
          msg += `├ LFD: ${this.formatDateShort(dnd.lastFreeDay)} (${daysLeft} days left)\n`;
        } else {
          msg += `├ LFD: ${this.formatDateShort(dnd.lastFreeDay)} 🔴 EXPIRED\n`;
        }
      }

      // Show charges
      if (dnd.totalCharges > 0) {
        msg += `├ Demurrage: ${dnd.currency} ${dnd.demurrageCharges.toFixed(0)}\n`;
        msg += `├ Detention: ${dnd.currency} ${dnd.detentionCharges.toFixed(0)}\n`;
        msg += `└ *Total: ${dnd.currency} ${dnd.totalCharges.toFixed(0)}*`;
        if (dnd.isFinalCharge) {
          msg += ` ✅`;
        } else {
          msg += ` ⚠️ accruing`;
        }
        msg += '\n';
      } else {
        // No charges yet
        if (dnd.portFreeDays > 0) {
          msg += `├ Port Free: ${dnd.portFreeDays} days\n`;
        }
        if (dnd.detentionFreeDays > 0) {
          msg += `├ Det. Free: ${dnd.detentionFreeDays} days\n`;
        }
        msg += `└ No charges ✅\n`;
      }
      msg += '\n';
    }

    // ═══════════════════════════════════════════════════════════════════════
    // DOCUMENTS (clickable)
    // ═══════════════════════════════════════════════════════════════════════
    msg += `*DOCUMENTS* (${d.documents.length} | ${d.documentCompletion}% complete)\n`;

    // Group by received vs pending - all clickable
    const docTypes = new Set(d.documents.map(doc => doc.type));
    const requiredDocs = ['booking_confirmation', 'shipping_instructions', 'draft_bl', 'final_bl', 'arrival_notice'];

    for (const doc of d.documents.slice(0, 8)) {
      const date = new Date(doc.receivedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const icon = doc.hasAttachment ? '📎' : '📄';
      const url = doc.attachmentUrl || doc.emailViewUrl || doc.gmailLink;
      msg += `├ ✅ [${icon} ${doc.displayName}](${url}) (${date})\n`;
    }

    // Show pending docs
    for (const req of requiredDocs) {
      if (!docTypes.has(req)) {
        const name = this.getDocDisplayName(req);
        msg += `├ ⏳ ${name}\n`;
      }
    }
    msg += '\n';

    // ═══════════════════════════════════════════════════════════════════════
    // DISCREPANCIES (Cross-validation results)
    // ═══════════════════════════════════════════════════════════════════════
    if (d.discrepancies.length > 0) {
      msg += `*⚠️ DATA CONFLICTS*\n`;
      for (const disc of d.discrepancies.slice(0, 5)) {
        const severity = disc.severity === 'high' ? '🔴' : '🟡';
        if (disc.carrierValue) {
          msg += `${severity} *${disc.field}*\n`;
          msg += `├ INTDB: ${disc.intdbValue}\n`;
          msg += `├ Carrier: ${disc.carrierValue}\n`;
          msg += `└ ${disc.recommendation}\n`;
        } else if (disc.otherValue) {
          msg += `${severity} *${disc.field}*\n`;
          msg += `├ ${disc.intdbValue}\n`;
          msg += `├ ${disc.otherValue}\n`;
          msg += `└ ${disc.recommendation}\n`;
        } else {
          msg += `${severity} *${disc.field}*: ${disc.intdbValue}\n`;
          msg += `└ ${disc.recommendation}\n`;
        }
      }
      msg += '\n';
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ESCALATIONS (with meaningful details)
    // ═══════════════════════════════════════════════════════════════════════
    if (d.escalations.length > 0) {
      msg += `*🚨 ESCALATIONS* (${d.escalations.length})\n`;
      for (const esc of d.escalations.slice(0, 3)) {
        const icon = esc.type === 'customer' ? '👤' : esc.type === 'vendor' ? '🏢' : '📧';
        const date = new Date(esc.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        const severity = esc.severity === 'critical' ? '🔴' : '🟠';
        // Show subject if meaningful, otherwise show snippet
        const displayText = esc.subject.length > 15 && !esc.subject.startsWith('Issue:')
          ? esc.subject.slice(0, 50)
          : esc.snippet?.slice(0, 60) || esc.subject.slice(0, 50);
        msg += `├ ${icon}${severity} ${displayText}\n`;
        // Only show from if it's external (not intoglo)
        if (!esc.from.includes('intoglo')) {
          msg += `│  → ${esc.from} (${date})\n`;
        } else {
          msg += `│  → ${date}\n`;
        }
      }
      msg += '\n';
    }

    // ═══════════════════════════════════════════════════════════════════════
    // UPCOMING ACTIONS (future only, no overdue)
    // ═══════════════════════════════════════════════════════════════════════
    if (d.pendingActionsCount > 0) {
      msg += `*⏳ UPCOMING ACTIONS* (${d.pendingActionsCount})\n`;
      for (const action of d.pendingActionsList.slice(0, 5)) {
        const deadlineText = action.deadline ? ` (${this.formatDateShort(action.deadline)})` : '';
        const ownerText = action.owner ? ` [${action.owner}]` : '';
        msg += `• ${action.description}${deadlineText}${ownerText}\n`;
      }
      msg += '\n';
    }

    // ═══════════════════════════════════════════════════════════════════════
    // BLOCKERS & SUMMARY
    // ═══════════════════════════════════════════════════════════════════════
    const blockers: string[] = [];

    // Check for missing critical documents
    const receivedDocTypes = new Set(d.documents.map(doc => doc.type));
    if (d.stage === 'BOOKED' && !receivedDocTypes.has('shipping_instructions')) {
      blockers.push('SI not submitted');
    }
    if (d.stage === 'SI_SUBMITTED' && !receivedDocTypes.has('draft_bl')) {
      blockers.push('Awaiting Draft BL');
    }
    if (receivedDocTypes.has('draft_bl') && !receivedDocTypes.has('final_bl')) {
      blockers.push('Final BL pending');
    }

    // Check for escalations
    if (d.escalations.length > 0) {
      blockers.push(`${d.escalations.length} escalation(s) need attention`);
    }

    // Check for discrepancies
    const criticalDisc = d.discrepancies.filter(disc => disc.severity === 'high');
    if (criticalDisc.length > 0) {
      blockers.push(`${criticalDisc.length} data conflict(s)`);
    }

    if (blockers.length > 0) {
      msg += `*🚧 BLOCKERS*\n`;
      for (const b of blockers) {
        msg += `• ${b}\n`;
      }
      msg += '\n';
    }

    // Stats footer
    msg += `📧 ${d.emailCount} emails in thread`;

    return msg;
  }

  private getDocDisplayName(type: string): string {
    const names: Record<string, string> = {
      'booking_confirmation': 'Booking Confirmation',
      'shipping_instructions': 'Shipping Instructions',
      'draft_bl': 'Draft BL',
      'final_bl': 'Final BL',
      'arrival_notice': 'Arrival Notice',
      'delivery_order': 'Delivery Order',
    };
    return names[type] || type;
  }

  /**
   * Live tracking only
   */
  private async handleTrack(input: string): Promise<CommandResult> {
    if (!input) {
      return {
        success: false,
        command: 'track',
        message: '❌ Please provide a container number.\n\nExample: `track MRKU9073779`',
      };
    }

    // Check if input looks like a booking number (numeric) vs container (alphanumeric with carrier prefix)
    const isBookingNumber = /^\d{6,15}$/.test(input);
    let containerNumber = input;

    if (isBookingNumber) {
      // Look up container from booking number via status
      const statusResponse = await this.service.getUnifiedStatus(input);
      if (statusResponse.success && statusResponse.data?.containerNumber) {
        containerNumber = statusResponse.data.containerNumber;
      } else {
        return {
          success: false,
          command: 'track',
          message: `❌ No container found for booking ${input}.\n\nTry: \`status ${input}\` for full details`,
        };
      }
    }

    const response = await this.service.getTrackingOnly(containerNumber);

    if (!response.success || !response.data) {
      return {
        success: false,
        command: 'track',
        message: `❌ ${response.error || 'Container not found in carrier API'}`,
      };
    }

    return {
      success: true,
      command: 'track',
      message: this.formatTracking(response.data),
    };
  }

  /**
   * Timeline - Carrier API events chronologically
   */
  private async handleTimeline(reference: string): Promise<CommandResult> {
    if (!reference) {
      return {
        success: false,
        command: 'timeline',
        message: '❌ Please provide a booking or container number.\n\nExample: `timeline 262226938`',
      };
    }

    try {
      // Get dossier to find container number
      const dossier = await this.dossierService.getShipmentDossier(reference);

      if (!dossier) {
        return {
          success: false,
          command: 'timeline',
          message: `❌ No shipment found for: ${reference}`,
        };
      }

      const containerNumber = dossier.containerNumbers[0];
      if (!containerNumber) {
        return {
          success: false,
          command: 'timeline',
          message: `❌ No container found for: ${reference}`,
        };
      }

      // Get carrier tracking data
      const trackingResponse = await this.service.getTrackingOnly(containerNumber);

      if (!trackingResponse.success || !trackingResponse.data) {
        return {
          success: false,
          command: 'timeline',
          message: `❌ ${trackingResponse.error || 'Tracking not available'}`,
        };
      }

      return {
        success: true,
        command: 'timeline',
        message: this.formatTimeline(trackingResponse.data, dossier.bookingNumber),
      };
    } catch (error) {
      return {
        success: false,
        command: 'timeline',
        message: `❌ Error: ${error}`,
      };
    }
  }

  /**
   * Format timeline from carrier events
   */
  private formatTimeline(data: CarrierTrackingData, bookingNumber: string): string {
    let msg = `📅 *CARRIER TIMELINE*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Booking: ${bookingNumber}\n`;
    msg += `Container: ${data.containerNumber}\n`;
    msg += `Source: ${data.source === 'maersk' ? 'Maersk' : 'Hapag-Lloyd'} API\n\n`;

    if (data.recentEvents.length === 0) {
      msg += `No events found.\n`;
      return msg;
    }

    // Group events by date
    const eventsByDate: Record<string, typeof data.recentEvents> = {};
    for (const event of data.recentEvents) {
      const date = new Date(event.eventDateTime).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      if (!eventsByDate[date]) eventsByDate[date] = [];
      eventsByDate[date].push(event);
    }

    // Format events
    for (const [date, events] of Object.entries(eventsByDate)) {
      msg += `*${date}*\n`;
      for (const event of events) {
        const time = new Date(event.eventDateTime).toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        });
        const icon = this.getEventIcon(event.eventType, event.eventCode);
        const classifier = event.eventClassifier === 'ACT' ? '' : ` (${event.eventClassifier})`;
        msg += `  ${icon} ${time} - ${event.description}${classifier}\n`;
      }
      msg += '\n';
    }

    msg += `🔄 Last sync: ${this.formatTime(data.lastSyncAt)}`;
    return msg;
  }

  private getEventIcon(eventType: string, eventCode: string): string {
    if (eventType === 'TRANSPORT') {
      return eventCode === 'ARRI' ? '📍' : '🚢';
    }
    if (eventType === 'EQUIPMENT') {
      const icons: Record<string, string> = {
        'LOAD': '📦',
        'DISC': '📦',
        'GTIN': '🚪',
        'GTOT': '🚪',
        'STUF': '📥',
        'STRP': '📤',
      };
      return icons[eventCode] || '📦';
    }
    if (eventType === 'SHIPMENT') {
      return '📄';
    }
    return '•';
  }

  /**
   * Document status - combines INTDB docs with carrier SHIPMENT events
   */
  private async handleDocs(reference: string): Promise<CommandResult> {
    if (!reference) {
      return {
        success: false,
        command: 'docs',
        message: '❌ Please provide a booking number.\n\nExample: `docs 262226938`',
      };
    }

    try {
      // Get dossier for INTDB documents
      const dossier = await this.dossierService.getShipmentDossier(reference);

      if (!dossier) {
        return {
          success: false,
          command: 'docs',
          message: `❌ No shipment found for: ${reference}`,
        };
      }

      // Get carrier tracking for SHIPMENT events (document events)
      let carrierDocEvents: any[] = [];
      const containerNumber = dossier.containerNumbers[0];
      if (containerNumber) {
        const trackingResponse = await this.service.getTrackingOnly(containerNumber);
        if (trackingResponse.success && trackingResponse.data) {
          carrierDocEvents = trackingResponse.data.recentEvents.filter(
            e => e.eventType === 'SHIPMENT'
          );
        }
      }

      // All documents are now clickable inline - no need for separate buttons
      return {
        success: true,
        command: 'docs',
        message: this.formatDocsWithCarrier(dossier, carrierDocEvents),
      };
    } catch (error) {
      return {
        success: false,
        command: 'docs',
        message: `❌ Error: ${error}`,
      };
    }
  }

  private getDocShortName(type: string): string {
    const shortNames: Record<string, string> = {
      'final_bl': 'Final BL',
      'draft_bl': 'Draft BL',
      'shipping_instructions': 'SI',
      'arrival_notice': 'Arrival',
      'delivery_order': 'DO',
      'vgm_confirmation': 'VGM',
      'booking_confirmation': 'Booking',
    };
    return shortNames[type] || type;
  }

  /**
   * Format documents - merges INTDB docs with carrier events
   * All documents are clickable inline (using markdown links for web)
   */
  private formatDocsWithCarrier(dossier: ShipmentDossier, carrierEvents: any[]): string {
    let msg = `📄 *DOCUMENT STATUS*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Booking: ${dossier.bookingNumber}\n`;
    msg += `Completion: ${dossier.documentCompletion}%\n\n`;

    // Parse carrier events into meaningful milestones
    const carrierMilestones = this.parseCarrierDocMilestones(carrierEvents);

    // Key documents with carrier status merged
    const keyDocs = ['draft_bl', 'final_bl', 'shipping_instructions', 'vgm_confirmation', 'arrival_notice', 'delivery_order'];
    const keyDocsReceived = dossier.documents.filter(d => keyDocs.includes(d.type));
    const otherDocs = dossier.documents.filter(d => !keyDocs.includes(d.type));

    // KEY DOCUMENTS with carrier status - clickable
    if (keyDocsReceived.length > 0) {
      msg += `*📋 KEY DOCUMENTS*\n`;
      for (const doc of keyDocsReceived) {
        const date = this.formatDateShort(doc.receivedAt);
        const carrierStatus = this.getCarrierStatusForDoc(doc, carrierMilestones);
        const icon = doc.hasAttachment ? '📎' : '📄';
        const url = doc.attachmentUrl || doc.emailViewUrl || doc.gmailLink;

        msg += `├ ✅ [${icon} ${doc.displayName}](${url}) (${date})\n`;
        msg += `│  ↳ ${doc.fromParty}`;
        if (carrierStatus) {
          msg += ` • ${carrierStatus}`;
        }
        msg += `\n`;
      }
      msg += '\n';
    }

    // CARRIER BL STATUS (key milestones only)
    if (carrierMilestones.length > 0) {
      msg += `*🚢 CARRIER BL STATUS* (Live)\n`;
      for (const milestone of carrierMilestones) {
        msg += `├ ${milestone.icon} ${milestone.name} (${milestone.date})\n`;
      }
      msg += '\n';
    }

    // OTHER DOCUMENTS - expanded and clickable
    if (otherDocs.length > 0) {
      msg += `*📥 OTHER DOCUMENTS* (${otherDocs.length})\n`;
      for (const doc of otherDocs) {
        const date = this.formatDateShort(doc.receivedAt);
        const icon = doc.hasAttachment ? '📎' : '📄';
        const url = doc.attachmentUrl || doc.emailViewUrl || doc.gmailLink;
        msg += `├ [${icon} ${doc.displayName}](${url}) (${date})\n`;
      }
      msg += '\n';
    }

    // PENDING DOCUMENTS
    const requiredDocs = ['booking_confirmation', 'shipping_instructions', 'draft_bl', 'final_bl', 'arrival_notice'];
    const receivedTypes = new Set(dossier.documents.map(d => d.type));
    const pending = requiredDocs.filter(d => !receivedTypes.has(d));

    if (pending.length > 0) {
      msg += `*⏳ PENDING*\n`;
      for (const docType of pending) {
        const name = this.getDocDisplayName(docType);
        msg += `├ ⚪ ${name}\n`;
      }
    }

    return msg;
  }

  /**
   * Parse carrier SHIPMENT events into meaningful milestones
   */
  private parseCarrierDocMilestones(events: any[]): Array<{
    code: string;
    name: string;
    date: string;
    icon: string;
  }> {
    // Map event codes to meaningful names
    const codeMap: Record<string, { name: string; icon: string; priority: number }> = {
      'DRFT': { name: 'Draft BL Created', icon: '📝', priority: 1 },
      'RECE': { name: 'Documents Received', icon: '📥', priority: 2 },
      'APPR': { name: 'BL Approved', icon: '✅', priority: 3 },
      'ISSU': { name: 'BL Issued', icon: '📄', priority: 4 },
      'CONF': { name: 'BL Confirmed', icon: '✅', priority: 5 },
      'RELS': { name: 'Telex Released', icon: '🔓', priority: 6 },
      'SURR': { name: 'BL Surrendered', icon: '🔓', priority: 7 },
      'PENA': { name: 'Pending Approval', icon: '⏳', priority: 0 },
    };

    const milestones: Array<{ code: string; name: string; date: string; icon: string; priority: number }> = [];
    const seenCodes = new Set<string>();

    for (const event of events) {
      const code = event.eventCode;
      if (!code || seenCodes.has(code)) continue;

      const mapping = codeMap[code];
      if (!mapping) continue;

      // Skip generic "Received" if we have more specific events
      if (code === 'RECE' && events.some(e => ['DRFT', 'ISSU', 'APPR'].includes(e.eventCode))) {
        continue;
      }

      seenCodes.add(code);
      milestones.push({
        code,
        name: mapping.name,
        date: this.formatDateShort(event.eventDateTime),
        icon: mapping.icon,
        priority: mapping.priority,
      });
    }

    // Sort by priority (most important first)
    return milestones.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Get carrier status annotation for a document
   */
  private getCarrierStatusForDoc(
    doc: { type: string; receivedAt: string },
    milestones: Array<{ code: string; name: string; date: string; icon: string }>
  ): string | null {
    // Match document type to carrier milestone
    if (doc.type === 'draft_bl') {
      const issued = milestones.find(m => m.code === 'ISSU');
      if (issued) return `✅ Issued ${issued.date}`;
      const draft = milestones.find(m => m.code === 'DRFT');
      if (draft) return `📝 Created ${draft.date}`;
    }

    if (doc.type === 'final_bl') {
      const released = milestones.find(m => ['RELS', 'SURR'].includes(m.code));
      if (released) return `🔓 Released`;
      const confirmed = milestones.find(m => m.code === 'CONF');
      if (confirmed) return `✅ Confirmed`;
      return '📄 Issued';
    }

    if (doc.type === 'shipping_instructions') {
      const received = milestones.find(m => m.code === 'RECE');
      if (received) return `✅ Carrier received`;
    }

    return null;
  }

  private formatDateShort(dateStr: string): string {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  }

  /**
   * All pending actions
   */
  private async handlePending(): Promise<CommandResult> {
    const response = await this.service.getAllPendingActions();

    if (!response.success) {
      return {
        success: false,
        command: 'pending',
        message: `❌ ${response.error}`,
      };
    }

    return {
      success: true,
      command: 'pending',
      message: this.formatPendingActions(response.data || []),
    };
  }

  /**
   * Deadline information
   */
  private async handleDeadlines(bookingNumber: string): Promise<CommandResult> {
    if (!bookingNumber) {
      return {
        success: false,
        command: 'deadlines',
        message: '❌ Please provide a booking number.\n\nExample: `deadlines 262226938`',
      };
    }

    const response = await this.service.getDeadlines(bookingNumber);

    if (!response.success || !response.data) {
      return {
        success: false,
        command: 'deadlines',
        message: `❌ ${response.error || 'Deadlines not available (Maersk only)'}`,
      };
    }

    return {
      success: true,
      command: 'deadlines',
      message: this.formatDeadlines(response.data),
    };
  }

  /**
   * Demurrage & Detention charges
   * Requires MBL number - will look up from booking if needed
   * Only available for Maersk shipments
   */
  private async handleCharges(reference: string): Promise<CommandResult> {
    if (!reference) {
      return {
        success: false,
        command: 'charges',
        message: '❌ Please provide a booking number or MBL.\n\nExample: `charges 262226938` or `charges MAEU2622269383`',
      };
    }

    try {
      // Get dossier to find MBL and carrier
      const dossier = await this.dossierService.getShipmentDossier(reference);

      if (!dossier) {
        return {
          success: false,
          command: 'charges',
          message: `❌ No shipment found for: ${reference}`,
        };
      }

      // Check carrier - D&D API only available for Maersk
      if (dossier.carrier && dossier.carrier !== 'Maersk') {
        return {
          success: false,
          command: 'charges',
          message: `❌ D&D charges only available for Maersk shipments.\n\nThis shipment is with ${dossier.carrier}.`,
        };
      }

      const mblNumber = dossier.mblNumber;
      if (!mblNumber) {
        return {
          success: false,
          command: 'charges',
          message: `❌ No MBL found for booking ${dossier.bookingNumber}.\n\nD&D charges require MBL number.`,
        };
      }

      const containerNumber = dossier.containerNumbers[0];
      const response = await this.service.getCharges(mblNumber, containerNumber);

      if (!response.success || !response.data) {
        // Provide more helpful error messages
        const errorMsg = response.error || '';
        let displayError = 'Charges not available';

        if (errorMsg.includes('Validation')) {
          displayError = 'Shipment not eligible for D&D lookup (may be delivered or closed)';
        } else if (errorMsg.includes('not configured')) {
          displayError = 'Maersk API not configured';
        } else if (errorMsg) {
          displayError = errorMsg;
        }

        return {
          success: false,
          command: 'charges',
          message: `❌ ${displayError}\n\nMBL: ${mblNumber}`,
        };
      }

      return {
        success: true,
        command: 'charges',
        message: this.formatChargesEnhanced(response.data, dossier),
      };
    } catch (error) {
      return {
        success: false,
        command: 'charges',
        message: `❌ Error: ${error}`,
      };
    }
  }

  /**
   * Format charges with enhanced details
   */
  private formatChargesEnhanced(charges: CarrierCharges, dossier: ShipmentDossier): string {
    let msg = `💰 *DEMURRAGE & DETENTION*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Booking: ${dossier.bookingNumber}\n`;
    msg += `MBL: ${dossier.mblNumber}\n`;
    msg += `Container: ${charges.containerNumber}\n`;
    msg += `Port: ${charges.port} (${charges.portCode})\n\n`;

    // Free time status
    msg += `*📅 FREE TIME*\n`;
    msg += `├ Port Free Days: ${charges.portFreeDays}\n`;
    msg += `├ Detention Free Days: ${charges.detentionFreeDays}\n`;
    if (charges.lastFreeDay) {
      const lastFree = new Date(charges.lastFreeDay);
      const now = new Date();
      const daysLeft = Math.ceil((lastFree.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      const status = daysLeft > 0 ? `${daysLeft} days left` : `EXPIRED ${Math.abs(daysLeft)} days ago`;
      msg += `└ Last Free Day: ${this.formatDate(charges.lastFreeDay)} (${status})\n\n`;
    } else {
      msg += '\n';
    }

    // Charges
    msg += `*💵 CHARGES*\n`;
    msg += `├ Demurrage: ${charges.currency} ${charges.demurrageCharges.toFixed(2)}\n`;
    msg += `├ Detention: ${charges.currency} ${charges.detentionCharges.toFixed(2)}\n`;
    msg += `├ Chargeable Days: ${charges.chargeableDays}\n`;
    msg += `└ *TOTAL: ${charges.currency} ${charges.totalCharges.toFixed(2)}*\n\n`;

    // Final charge indicator
    if (charges.isFinalCharge) {
      msg += `✅ Final charges (container returned)\n`;
    } else {
      msg += `⚠️ Charges accruing (container not returned)\n`;
    }

    msg += `\n🔄 Last sync: ${this.formatTime(charges.lastSyncAt)}`;
    return msg;
  }

  /**
   * Legacy charges handler (now calls enhanced version internally)
   */
  private async handleChargesLegacy(containerNumber: string): Promise<CommandResult> {
    const response = await this.service.getCharges(containerNumber);

    if (!response.success || !response.data) {
      return {
        success: false,
        command: 'charges',
        message: `❌ ${response.error || 'Charges not available (Maersk only)'}`,
      };
    }

    return {
      success: true,
      command: 'charges',
      message: this.formatCharges(response.data),
    };
  }

  /**
   * Data mismatches
   */
  private async handleMismatch(): Promise<CommandResult> {
    const response = await this.service.getMismatchedShipments();

    if (!response.success) {
      return {
        success: false,
        command: 'mismatch',
        message: `❌ ${response.error}`,
      };
    }

    return {
      success: true,
      command: 'mismatch',
      message: this.formatMismatches(response.data || []),
    };
  }

  /**
   * Customer shipments
   */
  private async handleCustomer(customerName: string): Promise<CommandResult> {
    if (!customerName) {
      return {
        success: false,
        command: 'customer',
        message: '❌ Please provide a customer name.\n\nExample: `customer ABC Exports`',
      };
    }

    const response = await this.service.getCustomerShipments(customerName);

    if (!response.success) {
      return {
        success: false,
        command: 'customer',
        message: `❌ ${response.error}`,
      };
    }

    return {
      success: true,
      command: 'customer',
      message: this.formatCustomerShipments(customerName, response.data || []),
    };
  }

  /**
   * Urgent items
   */
  private async handleUrgent(): Promise<CommandResult> {
    const response = await this.service.getUrgentItems();

    if (!response.success) {
      return {
        success: false,
        command: 'urgent',
        message: `❌ ${response.error}`,
      };
    }

    return {
      success: true,
      command: 'urgent',
      message: this.formatUrgent(response.data),
    };
  }

  /**
   * Today's schedule
   */
  private async handleToday(): Promise<CommandResult> {
    const response = await this.service.getTodaySchedule();

    if (!response.success) {
      return {
        success: false,
        command: 'today',
        message: `❌ ${response.error}`,
      };
    }

    return {
      success: true,
      command: 'today',
      message: this.formatTodaySchedule(response.data!),
    };
  }

  /**
   * Dashboard - Priority overview
   */
  private async handleDashboard(): Promise<CommandResult> {
    try {
      const dashboard = await this.opsService.getDashboard();

      let msg = `📊 *OPS DASHBOARD*\n━━━━━━━━━━━━━━━━━━━━\n\n`;

      // Risk summary
      msg += `*SHIPMENT RISK*\n`;
      msg += `🔴 Critical: ${dashboard.critical}\n`;
      msg += `🟠 High: ${dashboard.high}\n`;
      msg += `🟡 Medium: ${dashboard.medium}\n`;
      msg += `🟢 Low: ${dashboard.low}\n\n`;

      // Today's numbers
      msg += `*TODAY*\n`;
      msg += `📅 Cutoffs due: ${dashboard.cutoffsToday}\n`;
      msg += `⚠️ Overdue actions: ${dashboard.overdueActions}\n`;
      msg += `🛫 Departing: ${dashboard.departingToday}\n`;
      msg += `🛬 Arriving: ${dashboard.arrivingToday}\n\n`;

      // Top critical
      if (dashboard.topCritical.length > 0) {
        msg += `*TOP CRITICAL*\n`;
        for (const s of dashboard.topCritical.slice(0, 3)) {
          const topIssue = s.issues[0]?.description || 'Multiple issues';
          msg += `• ${s.bookingNumber}: ${topIssue}\n`;
        }
      }

      return { success: true, command: 'dashboard', message: msg.trim() };
    } catch (error) {
      return { success: false, command: 'dashboard', message: `❌ ${error}` };
    }
  }

  /**
   * Risk/Health - At-risk shipments
   */
  private async handleRisk(): Promise<CommandResult> {
    try {
      const healthScores = await this.opsService.getHealthScores(15);

      if (healthScores.length === 0) {
        return { success: true, command: 'risk', message: '✅ No at-risk shipments found.' };
      }

      let msg = `🚨 *AT-RISK SHIPMENTS*\n━━━━━━━━━━━━━━━━━━━━\n\n`;

      const critical = healthScores.filter(s => s.riskLevel === 'critical');
      const high = healthScores.filter(s => s.riskLevel === 'high');

      if (critical.length > 0) {
        msg += `*🔴 CRITICAL* (${critical.length})\n`;
        for (const s of critical.slice(0, 5)) {
          msg += `\n*${s.bookingNumber}* (Score: ${s.healthScore})\n`;
          msg += `  Stage: ${s.stage}\n`;
          for (const issue of s.issues.slice(0, 2)) {
            const icon = issue.severity === 'critical' ? '🔴' : issue.severity === 'high' ? '🟠' : '🟡';
            msg += `  ${icon} ${issue.description}\n`;
          }
        }
        msg += '\n';
      }

      if (high.length > 0) {
        msg += `*🟠 HIGH RISK* (${high.length})\n`;
        for (const s of high.slice(0, 5)) {
          msg += `• ${s.bookingNumber}: ${s.issues[0]?.description || 'Multiple issues'}\n`;
        }
      }

      return { success: true, command: 'risk', message: msg.trim() };
    } catch (error) {
      return { success: false, command: 'risk', message: `❌ ${error}` };
    }
  }

  /**
   * Blockers - What's blocking shipments
   */
  private async handleBlockers(): Promise<CommandResult> {
    try {
      const blockers = await this.opsService.getBlockers();

      if (blockers.length === 0) {
        return { success: true, command: 'blockers', message: '✅ No blockers found. All shipments progressing.' };
      }

      let msg = `🚧 *SHIPMENT BLOCKERS*\n━━━━━━━━━━━━━━━━━━━━\n\n`;

      // Group by blocker type
      const byType: Record<string, typeof blockers> = {};
      for (const b of blockers) {
        const key = b.blockerType;
        if (!byType[key]) byType[key] = [];
        byType[key].push(b);
      }

      // Missing documents
      if (byType['missing_document']) {
        msg += `*📄 MISSING DOCUMENTS*\n`;
        for (const b of byType['missing_document'].slice(0, 5)) {
          msg += `• ${b.bookingNumber}: ${b.description}\n`;
          msg += `  Owner: ${b.owner} | Stage: ${b.stage}\n`;
        }
        msg += '\n';
      }

      // Overdue actions
      if (byType['overdue_action']) {
        msg += `*⏰ OVERDUE ACTIONS*\n`;
        for (const b of byType['overdue_action'].slice(0, 5)) {
          const overdue = b.daysOverdue ? ` (${b.daysOverdue}d overdue)` : '';
          msg += `• ${b.bookingNumber}: ${b.description}${overdue}\n`;
          msg += `  Owner: ${b.owner}\n`;
        }
      }

      return { success: true, command: 'blockers', message: msg.trim() };
    } catch (error) {
      return { success: false, command: 'blockers', message: `❌ ${error}` };
    }
  }

  /**
   * Cutoffs - Deadline monitoring
   */
  private async handleCutoffs(): Promise<CommandResult> {
    try {
      const cutoffs = await this.opsService.getCutoffAlerts();

      if (cutoffs.length === 0) {
        return { success: true, command: 'cutoffs', message: '✅ No urgent cutoffs in the next 7 days.' };
      }

      let msg = `⏰ *CUTOFF DEADLINES*\n━━━━━━━━━━━━━━━━━━━━\n\n`;

      const overdue = cutoffs.filter(c => c.urgency === 'overdue');
      const today = cutoffs.filter(c => c.urgency === 'today');
      const tomorrow = cutoffs.filter(c => c.urgency === 'tomorrow');
      const thisWeek = cutoffs.filter(c => c.urgency === 'this_week');

      if (overdue.length > 0) {
        msg += `*🔴 OVERDUE*\n`;
        for (const c of overdue.slice(0, 5)) {
          const type = c.cutoffType.replace('_cutoff', '').toUpperCase();
          msg += `• ${c.bookingNumber}: ${type} (${Math.abs(c.hoursRemaining)}h ago)\n`;
        }
        msg += '\n';
      }

      if (today.length > 0) {
        msg += `*🟠 TODAY*\n`;
        for (const c of today.slice(0, 5)) {
          const type = c.cutoffType.replace('_cutoff', '').toUpperCase();
          msg += `• ${c.bookingNumber}: ${type} in ${c.hoursRemaining}h\n`;
        }
        msg += '\n';
      }

      if (tomorrow.length > 0) {
        msg += `*🟡 TOMORROW*\n`;
        for (const c of tomorrow.slice(0, 5)) {
          const type = c.cutoffType.replace('_cutoff', '').toUpperCase();
          msg += `• ${c.bookingNumber}: ${type}\n`;
        }
        msg += '\n';
      }

      if (thisWeek.length > 0) {
        msg += `*🟢 THIS WEEK* (${thisWeek.length} more)\n`;
      }

      return { success: true, command: 'cutoffs', message: msg.trim() };
    } catch (error) {
      return { success: false, command: 'cutoffs', message: `❌ ${error}` };
    }
  }

  /**
   * Mismatch - Real data conflicts (not just missing data)
   */
  private async handleMismatchNew(): Promise<CommandResult> {
    try {
      const mismatches = await this.opsService.getRealMismatches();

      if (mismatches.length === 0) {
        return { success: true, command: 'mismatch', message: '✅ No data conflicts found. All data is consistent.' };
      }

      let msg = `⚠️ *DATA CONFLICTS*\n━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `Found ${mismatches.length} shipment(s) with conflicting data\n\n`;

      for (const m of mismatches.slice(0, 8)) {
        msg += `*${m.bookingNumber}* - ${m.field} conflict\n`;
        for (const v of m.values.slice(0, 2)) {
          const date = new Date(v.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          msg += `  • "${v.value}" (${v.source || 'email'}, ${date})\n`;
        }
        msg += `  → ${m.recommendation}\n\n`;
      }

      return { success: true, command: 'mismatch', message: msg.trim() };
    } catch (error) {
      return { success: false, command: 'mismatch', message: `❌ ${error}` };
    }
  }

  /**
   * Help message
   */
  private handleHelp(): CommandResult {
    return {
      success: true,
      command: 'help',
      message: `📖 *SHIPMENT PULSE*
━━━━━━━━━━━━━━━━━━━━

*Quick Views*
\`dashboard\` - Priority overview
\`risk\` - At-risk shipments
\`blockers\` - What's blocking progress
\`cutoffs\` - Upcoming deadlines

*Shipment Info*
\`status <ref>\` - Full shipment status
\`track <container>\` - Live tracking
\`docs <booking>\` - Document status

*Operations*
\`pending\` - All pending actions
\`urgent\` - Overdue & critical items
\`today\` - Today's arrivals/departures
\`mismatch\` - Data discrepancies

*Carrier APIs*
\`deadlines <booking>\` - Cutoff dates
\`charges <container>\` - D&D charges

*Search*
\`customer <name>\` - Customer's shipments

*Tip:* You can also just send a booking/container number directly!`,
    };
  }

  // ===========================================================================
  // FORMATTERS
  // ===========================================================================

  private formatUnifiedStatus(status: UnifiedShipmentStatus): string {
    const { carrier, intdb, validation, merged } = status;

    let msg = `📦 *UNIFIED STATUS*\n━━━━━━━━━━━━━━━━━━━━\n`;

    // Identifiers
    if (status.bookingNumber) msg += `Booking: \`${status.bookingNumber}\`\n`;
    if (status.mblNumber) msg += `MBL: \`${status.mblNumber}\`\n`;
    if (status.containerNumber) msg += `Container: \`${status.containerNumber}\`\n`;
    msg += '\n';

    // Carrier data (live)
    if (carrier && carrier.apiSuccess) {
      const statusEmoji = this.getStatusEmoji(carrier.status);
      msg += `🔴 *CARRIER API* (${carrier.source} - Live)\n`;
      msg += `├─ Status: ${statusEmoji} ${carrier.status}\n`;
      if (carrier.vesselName) msg += `├─ Vessel: ${carrier.vesselName}\n`;
      if (carrier.currentLocation) msg += `├─ Location: ${carrier.currentLocation}\n`;
      if (carrier.etd) msg += `├─ ETD: ${this.formatDate(carrier.etd)}${carrier.atd ? ' ✅ SAILED' : ''}\n`;
      if (carrier.eta) msg += `└─ ETA: ${this.formatDate(carrier.eta)}${carrier.ata ? ' ✅ ARRIVED' : ''}\n`;
      msg += '\n';
    }

    // INTDB data
    if (intdb) {
      msg += `🔵 *INTDB* (Email Intelligence)\n`;
      if (intdb.shipperName) msg += `├─ Shipper: ${intdb.shipperName}\n`;
      if (intdb.consigneeName) msg += `├─ Consignee: ${intdb.consigneeName}\n`;
      msg += `├─ ${intdb.emailCount} emails in thread\n`;
      msg += `└─ Docs: ${intdb.documentCompletionRate}% complete\n`;
      msg += '\n';
    }

    // Cross-validation
    if (validation.alerts.length > 0) {
      msg += `⚠️ *ALERTS*\n`;
      for (const alert of validation.alerts.slice(0, 3)) {
        const emoji = alert.severity === 'critical' ? '🔴' : alert.severity === 'warning' ? '🟡' : 'ℹ️';
        msg += `${emoji} ${alert.message}\n`;
      }
      msg += '\n';
    }

    // Document checklist
    if (intdb) {
      msg += `📋 *DOCUMENTS*\n`;
      for (const doc of intdb.documentsReceived.slice(0, 5)) {
        msg += `✅ ${doc.displayName}\n`;
      }
      for (const doc of intdb.documentsPending.slice(0, 3)) {
        msg += `⏳ ${doc}\n`;
      }
      msg += '\n';
    }

    // Pending actions
    if (intdb && intdb.pendingActions.length > 0) {
      msg += `⚡ *PENDING ACTIONS* (${intdb.pendingActions.length})\n`;
      for (const action of intdb.pendingActions.slice(0, 3)) {
        const deadline = action.deadline ? ` - due ${this.formatDate(action.deadline)}` : '';
        msg += `• ${action.description}${deadline}\n`;
      }
    }

    return msg.trim();
  }

  private formatTracking(data: CarrierTrackingData): string {
    const statusEmoji = this.getStatusEmoji(data.status);

    let msg = `📍 *LIVE TRACKING* - ${data.containerNumber}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Source: ${data.source === 'maersk' ? 'Maersk' : 'Hapag-Lloyd'} API\n\n`;

    msg += `Status: ${statusEmoji} *${data.status}*\n`;
    if (data.vesselName) msg += `Vessel: ${data.vesselName}\n`;
    if (data.voyageNumber) msg += `Voyage: ${data.voyageNumber}\n`;
    msg += '\n';

    msg += `📅 *Key Dates*\n`;
    if (data.atd) msg += `• ATD: ${this.formatDate(data.atd)} ✅\n`;
    else if (data.etd) msg += `• ETD: ${this.formatDate(data.etd)}\n`;
    if (data.ata) msg += `• ATA: ${this.formatDate(data.ata)} ✅\n`;
    else if (data.eta) msg += `• ETA: ${this.formatDate(data.eta)}\n`;
    msg += '\n';

    msg += `📍 *Recent Events*\n`;
    for (const event of data.recentEvents.slice(0, 5)) {
      const date = new Date(event.eventDateTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const classifier = event.eventClassifier === 'ACT' ? '' : ` (${event.eventClassifier})`;
      msg += `${date} • ${event.description}${classifier}\n`;
    }

    msg += `\n🔄 Last sync: ${this.formatTime(data.lastSyncAt)}`;

    return msg;
  }

  private formatDocumentStatus(data: any): string {
    let msg = `📄 *DOCUMENT STATUS*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    if (data.bookingNumber) msg += `Booking: ${data.bookingNumber}\n`;
    msg += `Completion: ${data.documentCompletionRate}%\n\n`;

    msg += `✅ *RECEIVED*\n`;
    for (const doc of data.documentsReceived) {
      const date = this.formatDate(doc.receivedAt);
      msg += `• ${doc.displayName} (${date})\n`;
    }
    msg += '\n';

    msg += `⏳ *PENDING*\n`;
    for (const doc of data.documentsPending) {
      msg += `• ${doc}\n`;
    }

    if (data.pendingActions.length > 0) {
      msg += `\n⚡ *ACTIONS REQUIRED* (${data.pendingActions.length})\n`;
      for (const action of data.pendingActions.slice(0, 5)) {
        msg += `• ${action.description}\n`;
      }
    }

    return msg;
  }

  private formatPendingActions(actions: PendingAction[]): string {
    if (actions.length === 0) {
      return `✅ *No pending actions!*\n\nAll caught up.`;
    }

    const overdue = actions.filter((a) => a.isOverdue);
    const dueToday = actions.filter((a) => {
      if (!a.deadline) return false;
      const today = new Date().toISOString().split('T')[0];
      return a.deadline.startsWith(today) && !a.isOverdue;
    });
    const upcoming = actions.filter((a) => !a.isOverdue && !dueToday.includes(a));

    let msg = `⚡ *PENDING ACTIONS* (${actions.length})\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (overdue.length > 0) {
      msg += `🔴 *OVERDUE* (${overdue.length})\n`;
      for (const a of overdue.slice(0, 5)) {
        msg += `• ${a.bookingNumber || 'N/A'}: ${a.description}\n`;
      }
      msg += '\n';
    }

    if (dueToday.length > 0) {
      msg += `🟡 *DUE TODAY* (${dueToday.length})\n`;
      for (const a of dueToday.slice(0, 5)) {
        msg += `• ${a.bookingNumber || 'N/A'}: ${a.description}\n`;
      }
      msg += '\n';
    }

    if (upcoming.length > 0) {
      msg += `🟢 *UPCOMING* (${upcoming.length})\n`;
      for (const a of upcoming.slice(0, 5)) {
        const deadline = a.deadline ? ` (${this.formatDate(a.deadline)})` : '';
        msg += `• ${a.bookingNumber || 'N/A'}: ${a.description}${deadline}\n`;
      }
    }

    return msg;
  }

  private formatDeadlines(data: any): string {
    let msg = `⏰ *DEADLINES*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Booking: ${data.bookingNumber}\n`;
    if (data.terminal) msg += `Terminal: ${data.terminal}\n`;
    msg += '\n';

    const completed = data.deadlines.filter((d: any) => d.status === 'COMPLETED');
    const upcoming = data.deadlines.filter((d: any) => d.status === 'UPCOMING');
    const overdue = data.deadlines.filter((d: any) => d.status === 'OVERDUE');

    if (completed.length > 0) {
      msg += `✅ *COMPLETED*\n`;
      for (const d of completed) {
        msg += `• ${d.type}: ${this.formatDateTime(d.dateTime)}\n`;
      }
      msg += '\n';
    }

    if (upcoming.length > 0) {
      msg += `⏳ *UPCOMING*\n`;
      for (const d of upcoming) {
        msg += `• ${d.type}: ${this.formatDateTime(d.dateTime)}\n`;
      }
      msg += '\n';
    }

    if (overdue.length > 0) {
      msg += `❌ *OVERDUE*\n`;
      for (const d of overdue) {
        msg += `• ${d.type}: ${this.formatDateTime(d.dateTime)} ⚠️\n`;
      }
    }

    return msg;
  }

  private formatCharges(data: any): string {
    let msg = `💰 *DEMURRAGE & DETENTION*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Container: ${data.containerNumber}\n`;
    msg += `Port: ${data.port} (${data.portCode})\n\n`;

    msg += `*FREE TIME*\n`;
    msg += `• Port Free Days: ${data.portFreeDays}\n`;
    msg += `• Detention Free Days: ${data.detentionFreeDays}\n`;
    if (data.lastFreeDay) msg += `• LFD: ${this.formatDate(data.lastFreeDay)} ⚠️\n`;
    msg += '\n';

    msg += `*CURRENT CHARGES*\n`;
    msg += `• Demurrage: ${data.currency} ${data.demurrageCharges.toFixed(2)}\n`;
    msg += `• Detention: ${data.currency} ${data.detentionCharges.toFixed(2)}\n`;
    msg += `• *Total: ${data.currency} ${data.totalCharges.toFixed(2)}*\n`;
    if (data.chargeableDays > 0) {
      msg += `• Chargeable Days: ${data.chargeableDays}\n`;
    }

    return msg;
  }

  private formatMismatches(mismatches: UnifiedShipmentStatus[]): string {
    if (mismatches.length === 0) {
      return `✅ *No data mismatches found!*\n\nAll shipments are in sync.`;
    }

    let msg = `⚠️ *DATA MISMATCHES* (${mismatches.length})\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    for (const m of mismatches.slice(0, 10)) {
      const ref = m.bookingNumber || m.containerNumber || 'Unknown';
      msg += `*${ref}*\n`;
      for (const alert of m.validation.alerts.slice(0, 2)) {
        msg += `  ${alert.message}\n`;
      }
      msg += '\n';
    }

    return msg;
  }

  private formatCustomerShipments(customerName: string, shipments: any[]): string {
    if (shipments.length === 0) {
      return `❌ No shipments found for "${customerName}"`;
    }

    let msg = `👤 *SHIPMENTS FOR ${customerName.toUpperCase()}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Found: ${shipments.length} shipment(s)\n\n`;

    for (const s of shipments.slice(0, 10)) {
      msg += `📦 *${s.bookingNumber || s.mblNumber || 'N/A'}*\n`;
      if (s.containerNumbers?.length) {
        msg += `   Containers: ${s.containerNumbers.slice(0, 2).join(', ')}\n`;
      }
      msg += `   Route: ${s.polLocation || '?'} → ${s.podLocation || '?'}\n`;
      if (s.eta) msg += `   ETA: ${this.formatDate(s.eta)}\n`;
      msg += '\n';
    }

    return msg;
  }

  private formatUrgent(data: any): string {
    let msg = `🚨 *URGENT ITEMS*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Overdue: ${data.overdueCount}\n`;
    msg += `Due Today: ${data.dueTodayCount}\n\n`;

    if (data.overdueActions.length > 0) {
      msg += `🔴 *OVERDUE*\n`;
      for (const a of data.overdueActions.slice(0, 5)) {
        const ref = a.bookingNumber || a.mblNumber || a.containerNumber || 'Unlinked';
        msg += `• ${ref}: ${a.description}\n`;
      }
      msg += '\n';
    }

    if (data.dueTodayActions.length > 0) {
      msg += `🟡 *DUE TODAY*\n`;
      for (const a of data.dueTodayActions.slice(0, 5)) {
        const ref = a.bookingNumber || a.mblNumber || a.containerNumber || 'Unlinked';
        msg += `• ${ref}: ${a.description}\n`;
      }
    }

    if (data.overdueCount === 0 && data.dueTodayCount === 0) {
      msg = `✅ *All clear!*\n\nNo urgent items.`;
    }

    return msg;
  }

  private formatTodaySchedule(data: { arrivals: any[]; departures: any[] }): string {
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });

    let msg = `📅 *TODAY'S SCHEDULE*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `${today}\n\n`;

    msg += `🛫 *DEPARTURES* (${data.departures.length})\n`;
    if (data.departures.length === 0) {
      msg += `None scheduled\n`;
    } else {
      for (const d of data.departures.slice(0, 5)) {
        const ref = d.booking_number || d.mbl_number || d.bookingNumber || d.mblNumber || 'N/A';
        const pol = d.pol_location || d.polLocation || '?';
        const pod = d.pod_location || d.podLocation || '?';
        const vessel = d.vessel_name || d.vesselName;
        msg += `• ${ref}: ${pol} → ${pod}\n`;
        if (vessel) msg += `  Vessel: ${vessel}\n`;
      }
    }
    msg += '\n';

    msg += `🛬 *ARRIVALS* (${data.arrivals.length})\n`;
    if (data.arrivals.length === 0) {
      msg += `None scheduled\n`;
    } else {
      for (const a of data.arrivals.slice(0, 5)) {
        const ref = a.booking_number || a.mbl_number || a.bookingNumber || a.mblNumber || 'N/A';
        const pol = a.pol_location || a.polLocation || '?';
        const pod = a.pod_location || a.podLocation || '?';
        const vessel = a.vessel_name || a.vesselName;
        msg += `• ${ref}: ${pol} → ${pod}\n`;
        if (vessel) msg += `  Vessel: ${vessel}\n`;
      }
    }

    return msg;
  }

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  private getStatusEmoji(status: string): string {
    const emojis: Record<string, string> = {
      NOT_SAILED: '⏳',
      ON_WATER: '🚢',
      ARRIVED: '📍',
      INLAND_DELIVERY: '🚛',
      DELIVERED: '✅',
      UNKNOWN: '❓',
    };
    return emojis[status] || '❓';
  }

  private formatDate(dateStr: string | null): string {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  private formatDateTime(dateStr: string | null): string {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private formatTime(dateStr: string | null): string {
    if (!dateStr) return 'N/A';
    const date = new Date(dateStr);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

let handlerInstance: BotCommandHandler | null = null;

export function getBotCommandHandler(supabaseClient?: SupabaseClient): BotCommandHandler {
  if (!handlerInstance || supabaseClient) {
    handlerInstance = new BotCommandHandler(supabaseClient);
  }
  return handlerInstance;
}
