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
  PendingAction,
  ValidationAlert,
} from './types';
import { getUnifiedIntelligenceService, UnifiedIntelligenceService } from './unified-intelligence-service';

// =============================================================================
// BOT COMMAND HANDLER
// =============================================================================

export class BotCommandHandler {
  private service: UnifiedIntelligenceService;

  constructor(supabaseClient?: SupabaseClient) {
    this.service = getUnifiedIntelligenceService(supabaseClient);
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
        return this.handleMismatch();
      case 'customer':
        return this.handleCustomer(args);
      case 'urgent':
        return this.handleUrgent();
      case 'today':
        return this.handleToday();
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
   * Full unified status
   */
  private async handleStatus(reference: string): Promise<CommandResult> {
    if (!reference) {
      return {
        success: false,
        command: 'status',
        message: '❌ Please provide a booking number, container, or MBL.\n\nExample: `status 262226938`',
      };
    }

    const response = await this.service.getUnifiedStatus(reference);

    if (!response.success || !response.data) {
      return {
        success: false,
        command: 'status',
        message: `❌ ${response.error || 'Shipment not found'}`,
      };
    }

    return {
      success: true,
      command: 'status',
      message: this.formatUnifiedStatus(response.data),
      buttons: [
        { label: '📍 Track', callback: `track ${reference}` },
        { label: '📄 Docs', callback: `docs ${reference}` },
        { label: '💰 Charges', callback: `charges ${reference}` },
      ],
    };
  }

  /**
   * Live tracking only
   */
  private async handleTrack(containerNumber: string): Promise<CommandResult> {
    if (!containerNumber) {
      return {
        success: false,
        command: 'track',
        message: '❌ Please provide a container number.\n\nExample: `track MRKU9073779`',
      };
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
   * Document status
   */
  private async handleDocs(reference: string): Promise<CommandResult> {
    if (!reference) {
      return {
        success: false,
        command: 'docs',
        message: '❌ Please provide a booking number.\n\nExample: `docs 262226938`',
      };
    }

    const response = await this.service.getDocumentStatus(reference);

    if (!response.success || !response.data) {
      return {
        success: false,
        command: 'docs',
        message: `❌ ${response.error || 'Shipment not found'}`,
      };
    }

    return {
      success: true,
      command: 'docs',
      message: this.formatDocumentStatus(response.data),
    };
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
   */
  private async handleCharges(containerNumber: string): Promise<CommandResult> {
    if (!containerNumber) {
      return {
        success: false,
        command: 'charges',
        message: '❌ Please provide a container number.\n\nExample: `charges MRKU9073779`',
      };
    }

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
   * Help message
   */
  private handleHelp(): CommandResult {
    return {
      success: true,
      command: 'help',
      message: `📖 *INTOGLO BOT COMMANDS*
━━━━━━━━━━━━━━━━━━━━

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
        msg += `• ${a.bookingNumber}: ${a.description}\n`;
      }
      msg += '\n';
    }

    if (data.dueTodayActions.length > 0) {
      msg += `🟡 *DUE TODAY*\n`;
      for (const a of data.dueTodayActions.slice(0, 5)) {
        msg += `• ${a.bookingNumber}: ${a.description}\n`;
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
        msg += `• ${d.bookingNumber}: ${d.polLocation} → ${d.podLocation}\n`;
        if (d.vesselName) msg += `  Vessel: ${d.vesselName}\n`;
      }
    }
    msg += '\n';

    msg += `🛬 *ARRIVALS* (${data.arrivals.length})\n`;
    if (data.arrivals.length === 0) {
      msg += `None scheduled\n`;
    } else {
      for (const a of data.arrivals.slice(0, 5)) {
        msg += `• ${a.bookingNumber}: ${a.polLocation} → ${a.podLocation}\n`;
        if (a.vesselName) msg += `  Vessel: ${a.vesselName}\n`;
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
