/**
 * Bot Notification Service
 *
 * Sends proactive notifications via Clawdbot to WhatsApp/Telegram.
 * Use this for alerts like:
 * - Overdue actions
 * - ETA changes detected
 * - Documents received
 * - Critical mismatches
 *
 * Following CLAUDE.md principles:
 * - Single Responsibility (Principle #3)
 * - Fail Fast (Principle #12)
 */

// =============================================================================
// TYPES
// =============================================================================

export interface NotificationPayload {
  message: string;
  channel?: 'whatsapp' | 'telegram' | 'slack';
  to?: string;  // Phone number or chat ID
  name?: string;  // Hook identifier for logs
  sessionKey?: string;  // For multi-turn conversations
}

export interface NotificationResult {
  success: boolean;
  error?: string;
}

export type AlertType =
  | 'overdue_action'
  | 'eta_change'
  | 'document_received'
  | 'data_mismatch'
  | 'arriving_soon'
  | 'vessel_change'
  | 'deadline_approaching';

export interface AlertConfig {
  type: AlertType;
  booking?: string;
  container?: string;
  details: string;
  severity: 'info' | 'warning' | 'critical';
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const CLAWDBOT_GATEWAY_URL = process.env.CLAWDBOT_GATEWAY_URL || 'http://127.0.0.1:18789';
const CLAWDBOT_HOOK_TOKEN = process.env.CLAWDBOT_HOOK_TOKEN;
const DEFAULT_CHANNEL = (process.env.BOT_DEFAULT_CHANNEL || 'whatsapp') as 'whatsapp' | 'telegram' | 'slack';
const OPS_GROUP_ID = process.env.BOT_OPS_GROUP_ID;  // Default WhatsApp group for alerts

// =============================================================================
// BOT NOTIFICATION SERVICE
// =============================================================================

export class BotNotificationService {
  private gatewayUrl: string;
  private hookToken: string | undefined;

  constructor(gatewayUrl?: string, hookToken?: string) {
    this.gatewayUrl = gatewayUrl || CLAWDBOT_GATEWAY_URL;
    this.hookToken = hookToken || CLAWDBOT_HOOK_TOKEN;
  }

  /**
   * Send a message via Clawdbot's agent hook
   */
  async sendMessage(payload: NotificationPayload): Promise<NotificationResult> {
    if (!this.hookToken) {
      return {
        success: false,
        error: 'Clawdbot hook token not configured',
      };
    }

    try {
      const response = await fetch(`${this.gatewayUrl}/hooks/agent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.hookToken}`,
        },
        body: JSON.stringify({
          message: payload.message,
          name: payload.name || 'IntogloBot',
          channel: payload.channel || DEFAULT_CHANNEL,
          to: payload.to || OPS_GROUP_ID,
          sessionKey: payload.sessionKey,
          deliver: true,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: `Clawdbot API error: ${response.status} - ${errorText}`,
        };
      }

      return { success: true };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to send notification',
      };
    }
  }

  /**
   * Send a formatted alert notification
   */
  async sendAlert(config: AlertConfig): Promise<NotificationResult> {
    const message = this.formatAlert(config);
    return this.sendMessage({
      message,
      name: `Alert:${config.type}`,
    });
  }

  /**
   * Send overdue actions summary
   */
  async sendOverdueSummary(actions: Array<{ booking: string; description: string; daysOverdue: number }>): Promise<NotificationResult> {
    if (actions.length === 0) {
      return { success: true };  // Nothing to send
    }

    let message = `🚨 *OVERDUE ACTIONS ALERT*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    message += `${actions.length} action(s) are overdue:\n\n`;

    for (const action of actions.slice(0, 10)) {
      message += `🔴 *${action.booking}*\n`;
      message += `   ${action.description}\n`;
      message += `   Overdue by ${action.daysOverdue} day(s)\n\n`;
    }

    if (actions.length > 10) {
      message += `_...and ${actions.length - 10} more_\n\n`;
    }

    message += `Reply \`pending\` to see full list.`;

    return this.sendMessage({
      message,
      name: 'Alert:overdue_summary',
    });
  }

  /**
   * Send ETA change notification
   */
  async sendEtaChange(
    booking: string,
    container: string,
    oldEta: string,
    newEta: string,
    daysDiff: number
  ): Promise<NotificationResult> {
    const direction = daysDiff > 0 ? 'delayed' : 'advanced';
    const emoji = daysDiff > 0 ? '⚠️' : '✅';

    let message = `${emoji} *ETA CHANGE DETECTED*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    message += `Booking: \`${booking}\`\n`;
    message += `Container: \`${container}\`\n\n`;
    message += `Old ETA: ${this.formatDate(oldEta)}\n`;
    message += `New ETA: ${this.formatDate(newEta)}\n\n`;
    message += `📅 Shipment ${direction} by *${Math.abs(daysDiff)} day(s)*\n\n`;
    message += `Reply \`status ${booking}\` for full details.`;

    return this.sendMessage({
      message,
      name: 'Alert:eta_change',
    });
  }

  /**
   * Send document received notification
   */
  async sendDocumentReceived(
    booking: string,
    documentType: string,
    from: string
  ): Promise<NotificationResult> {
    const docName = this.getDocumentDisplayName(documentType);

    let message = `📄 *DOCUMENT RECEIVED*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    message += `Booking: \`${booking}\`\n`;
    message += `Document: *${docName}*\n`;
    message += `From: ${from}\n\n`;
    message += `Reply \`docs ${booking}\` to see document status.`;

    return this.sendMessage({
      message,
      name: 'Alert:document_received',
    });
  }

  /**
   * Send arriving soon notification
   */
  async sendArrivingSoon(
    bookings: Array<{ booking: string; container: string; eta: string; daysToEta: number; port: string }>
  ): Promise<NotificationResult> {
    if (bookings.length === 0) {
      return { success: true };
    }

    let message = `🛬 *ARRIVING SOON*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n\n`;
    message += `${bookings.length} shipment(s) arriving within 3 days:\n\n`;

    for (const b of bookings.slice(0, 5)) {
      message += `📦 *${b.booking}*\n`;
      message += `   Container: ${b.container}\n`;
      message += `   ETA: ${this.formatDate(b.eta)} (${b.daysToEta} day${b.daysToEta !== 1 ? 's' : ''})\n`;
      message += `   Port: ${b.port}\n\n`;
    }

    if (bookings.length > 5) {
      message += `_...and ${bookings.length - 5} more_\n\n`;
    }

    message += `Reply \`today\` for full schedule.`;

    return this.sendMessage({
      message,
      name: 'Alert:arriving_soon',
    });
  }

  /**
   * Send daily summary
   */
  async sendDailySummary(stats: {
    pendingActions: number;
    overdueActions: number;
    arrivingToday: number;
    departingToday: number;
    dataMismatches: number;
  }): Promise<NotificationResult> {
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });

    let message = `📊 *DAILY SUMMARY*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n`;
    message += `${today}\n\n`;

    // Status indicators
    const overdueEmoji = stats.overdueActions > 0 ? '🔴' : '🟢';
    const mismatchEmoji = stats.dataMismatches > 0 ? '🟡' : '🟢';

    message += `${overdueEmoji} Overdue: *${stats.overdueActions}*\n`;
    message += `⏳ Pending: *${stats.pendingActions}*\n`;
    message += `${mismatchEmoji} Mismatches: *${stats.dataMismatches}*\n\n`;

    message += `🛫 Departing today: *${stats.departingToday}*\n`;
    message += `🛬 Arriving today: *${stats.arrivingToday}*\n\n`;

    if (stats.overdueActions > 0) {
      message += `⚠️ _${stats.overdueActions} overdue action(s) need attention!_\n`;
      message += `Reply \`urgent\` for details.\n`;
    } else {
      message += `✅ All caught up!`;
    }

    return this.sendMessage({
      message,
      name: 'DailySummary',
    });
  }

  // ===========================================================================
  // PRIVATE HELPERS
  // ===========================================================================

  private formatAlert(config: AlertConfig): string {
    const severityEmoji = {
      info: 'ℹ️',
      warning: '⚠️',
      critical: '🚨',
    }[config.severity];

    const typeLabel = {
      overdue_action: 'OVERDUE ACTION',
      eta_change: 'ETA CHANGE',
      document_received: 'DOCUMENT RECEIVED',
      data_mismatch: 'DATA MISMATCH',
      arriving_soon: 'ARRIVING SOON',
      vessel_change: 'VESSEL CHANGE',
      deadline_approaching: 'DEADLINE APPROACHING',
    }[config.type];

    let message = `${severityEmoji} *${typeLabel}*\n`;
    message += `━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (config.booking) {
      message += `Booking: \`${config.booking}\`\n`;
    }
    if (config.container) {
      message += `Container: \`${config.container}\`\n`;
    }

    message += `\n${config.details}`;

    return message;
  }

  private formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  private getDocumentDisplayName(type: string): string {
    const names: Record<string, string> = {
      booking_confirmation: 'Booking Confirmation',
      booking_amendment: 'Booking Amendment',
      shipping_instructions: 'Shipping Instructions',
      si_confirmation: 'SI Confirmation',
      vgm_confirmation: 'VGM Confirmation',
      draft_bl: 'Draft BL',
      final_bl: 'Final BL',
      house_bl: 'House BL',
      telex_release: 'Telex Release',
      arrival_notice: 'Arrival Notice',
      delivery_order: 'Delivery Order',
      customs_entry: 'Customs Entry',
      invoice: 'Invoice',
    };
    return names[type] || type;
  }
}

// =============================================================================
// FACTORY FUNCTION
// =============================================================================

let serviceInstance: BotNotificationService | null = null;

export function getBotNotificationService(
  gatewayUrl?: string,
  hookToken?: string
): BotNotificationService {
  if (!serviceInstance || gatewayUrl || hookToken) {
    serviceInstance = new BotNotificationService(gatewayUrl, hookToken);
  }
  return serviceInstance;
}
