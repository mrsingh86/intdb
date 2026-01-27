import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { UnifiedIntelligenceService } from '@/lib/unified-intelligence';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

// Verify Slack request signature
async function verifySlackSignature(
  request: NextRequest,
  body: string
): Promise<boolean> {
  if (!SLACK_SIGNING_SECRET) {
    console.warn('SLACK_SIGNING_SECRET not configured, skipping verification');
    return true;
  }

  const timestamp = request.headers.get('x-slack-request-timestamp');
  const slackSignature = request.headers.get('x-slack-signature');

  if (!timestamp || !slackSignature) {
    return false;
  }

  // Check timestamp is within 5 minutes
  const currentTime = Math.floor(Date.now() / 1000);
  if (Math.abs(currentTime - parseInt(timestamp)) > 300) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(SLACK_SIGNING_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(sigBasestring));
  const mySignature = 'v0=' + Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

  return mySignature === slackSignature;
}

// Send message to Slack channel
async function sendSlackMessage(channel: string, text: string, threadTs?: string) {
  if (!SLACK_BOT_TOKEN) {
    console.error('SLACK_BOT_TOKEN not configured');
    return;
  }

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      channel,
      text,
      thread_ts: threadTs,
      mrkdwn: true,
    }),
  });

  const result = await response.json();
  if (!result.ok) {
    console.error('Slack API error:', result.error);
  }
  return result;
}

// Convert WhatsApp-style formatting to Slack mrkdwn
function convertToSlackFormat(text: string): string {
  return text
    // Bold: *text* stays the same in Slack
    // But WhatsApp uses *text* and Slack uses *text* - compatible!
    // Convert emoji headers to Slack format
    .replace(/^(.*?)$/gm, (line) => {
      // Keep emoji lines as-is, they work in Slack
      return line;
    });
}

// Parse command from message
function parseCommand(text: string): { command: string; args: string } {
  const trimmed = text.trim().toLowerCase();

  // Direct booking/container number (8-15 alphanumeric)
  if (/^[a-z0-9]{8,15}$/i.test(trimmed)) {
    return { command: 'status', args: text.trim() };
  }

  const parts = text.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');

  return { command, args };
}

export async function POST(request: NextRequest) {
  try {
    const bodyText = await request.text();

    // Verify Slack signature
    const isValid = await verifySlackSignature(request, bodyText);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    // Parse body (could be URL-encoded or JSON)
    let payload: any;
    if (bodyText.startsWith('{')) {
      payload = JSON.parse(bodyText);
    } else {
      const params = new URLSearchParams(bodyText);
      payload = Object.fromEntries(params);
    }

    // Handle URL verification challenge
    if (payload.type === 'url_verification') {
      return NextResponse.json({ challenge: payload.challenge });
    }

    // Handle slash command
    if (payload.command) {
      const command = payload.command.replace('/', '');
      const args = payload.text || '';
      const channelId = payload.channel_id;
      const userId = payload.user_id;

      // Acknowledge immediately (Slack requires response within 3s)
      // Process in background and send response via webhook
      processSlashCommand(command, args, channelId, userId, payload.response_url);

      return NextResponse.json({
        response_type: 'in_channel',
        text: ':hourglass_flowing_sand: Processing your request...',
      });
    }

    // Handle event subscription (mentions, DMs)
    if (payload.event) {
      const event = payload.event;

      // Ignore bot messages to prevent loops
      if (event.bot_id || event.subtype === 'bot_message') {
        return NextResponse.json({ ok: true });
      }

      // Handle app mentions or direct messages
      if (event.type === 'app_mention' || event.type === 'message') {
        const text = event.text?.replace(/<@[A-Z0-9]+>/g, '').trim() || '';
        const channelId = event.channel;
        const threadTs = event.thread_ts || event.ts;

        if (text) {
          processMessage(text, channelId, event.user, threadTs);
        }
      }

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Slack webhook error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Process slash command asynchronously
async function processSlashCommand(
  command: string,
  args: string,
  channelId: string,
  userId: string,
  responseUrl: string
) {
  try {
    const intelligence = new UnifiedIntelligenceService(supabase);
    let response: string;

    switch (command) {
      case 'pulse':
      case 'shipment': {
        const { command: subCommand, args: subArgs } = parseCommand(args);
        response = await processShipmentCommand(intelligence, subCommand, subArgs);
        break;
      }
      case 'status':
        response = await processShipmentCommand(intelligence, 'status', args);
        break;
      case 'track':
        response = await processShipmentCommand(intelligence, 'track', args);
        break;
      case 'pending':
        response = await processShipmentCommand(intelligence, 'pending', '');
        break;
      case 'urgent':
        response = await processShipmentCommand(intelligence, 'urgent', '');
        break;
      case 'today':
        response = await processShipmentCommand(intelligence, 'today', '');
        break;
      default:
        response = await processShipmentCommand(intelligence, command, args);
    }

    // Send response via response_url
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response_type: 'in_channel',
        text: convertToSlackFormat(response),
      }),
    });
  } catch (error) {
    console.error('Slash command error:', error);
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response_type: 'ephemeral',
        text: `:x: Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }),
    });
  }
}

// Process message asynchronously
async function processMessage(
  text: string,
  channelId: string,
  userId: string,
  threadTs: string
) {
  try {
    const intelligence = new UnifiedIntelligenceService(supabase);
    const { command, args } = parseCommand(text);
    const response = await processShipmentCommand(intelligence, command, args);

    await sendSlackMessage(channelId, convertToSlackFormat(response), threadTs);
  } catch (error) {
    console.error('Message processing error:', error);
    await sendSlackMessage(
      channelId,
      `:x: Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      threadTs
    );
  }
}

// Process shipment commands using unified intelligence
async function processShipmentCommand(
  intelligence: UnifiedIntelligenceService,
  command: string,
  args: string
): Promise<string> {
  switch (command) {
    case 'status': {
      if (!args) return ':warning: Please provide a booking or container number.\nUsage: `/pulse status 263805268`';
      const result = await intelligence.getUnifiedStatus(args);
      return formatStatusResponse(result);
    }
    case 'track': {
      if (!args) return ':warning: Please provide a container number.\nUsage: `/pulse track MRKU3692349`';
      const result = await intelligence.getTrackingOnly(args);
      return formatTrackingResponse(result);
    }
    case 'docs': {
      if (!args) return ':warning: Please provide a booking number.\nUsage: `/pulse docs 263805268`';
      const result = await intelligence.getDocumentStatus(args);
      return formatDocsResponse(result);
    }
    case 'pending': {
      const result = await intelligence.getAllPendingActions();
      return formatPendingResponse(result);
    }
    case 'urgent': {
      const result = await intelligence.getUrgentItems();
      return formatUrgentResponse(result);
    }
    case 'today': {
      const result = await intelligence.getTodaySchedule();
      return formatTodayResponse(result);
    }
    case 'mismatch': {
      const result = await intelligence.getMismatchedShipments();
      return formatMismatchResponse(result);
    }
    case 'customer': {
      if (!args) return ':warning: Please provide a customer name.\nUsage: `/pulse customer INTOGLO`';
      const result = await intelligence.getCustomerShipments(args);
      return formatCustomerResponse(result, args);
    }
    case 'help':
      return getHelpMessage();
    default:
      // Try as booking/container number
      if (/^[a-z0-9]{8,15}$/i.test(command)) {
        const result = await intelligence.getUnifiedStatus(command);
        return formatStatusResponse(result);
      }
      return getHelpMessage();
  }
}

function formatStatusResponse(result: any): string {
  if (!result.success || !result.data) {
    return `:x: *Not Found*\nNo shipment found for: ${result.error || 'unknown reference'}`;
  }

  const data = result.data;
  let msg = `:ship: *Shipment Status: ${data.bookingNumber || data.containerNumber || data.queryReference}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;

  if (data.intdb) {
    const d = data.intdb;
    msg += `*Carrier:* ${d.carrier || 'N/A'}\n`;
    msg += `*Shipper:* ${d.shipper || 'N/A'}\n`;
    msg += `*Consignee:* ${d.consignee || 'N/A'}\n`;
    msg += `*POL:* ${d.pol || 'N/A'} → *POD:* ${d.pod || 'N/A'}\n`;
    if (d.containerNumbers?.length) msg += `*Container:* ${d.containerNumbers[0]}\n`;
    if (d.vesselName) msg += `*Vessel:* ${d.vesselName}\n`;
    if (d.etd) msg += `*ETD:* ${d.etd}\n`;
    if (d.eta) msg += `*ETA:* ${d.eta}\n`;
  }

  if (data.carrier) {
    msg += `\n:satellite: *Live Tracking*\n`;
    const t = data.carrier;
    if (t.currentStatus) msg += `*Status:* ${t.currentStatus}\n`;
    if (t.currentLocation) msg += `*Location:* ${t.currentLocation}\n`;
    if (t.events?.length) {
      const lastEvent = t.events[0];
      msg += `*Last Event:* ${lastEvent.description} @ ${lastEvent.location}\n`;
    }
  }

  if (data.validation?.alerts?.length) {
    msg += `\n:warning: *Alerts*\n`;
    data.validation.alerts.forEach((alert: any) => {
      msg += `• ${alert.message}\n`;
    });
  }

  return msg;
}

function formatTrackingResponse(result: any): string {
  if (!result.success || !result.data) {
    return `:x: *Not Found*\nNo tracking data for container: ${result.error || 'unknown'}`;
  }

  const t = result.data;
  let msg = `:satellite: *Container Tracking: ${t.containerNumber}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;

  msg += `*Carrier:* ${t.carrier || 'N/A'}\n`;
  msg += `*Status:* ${t.currentStatus || 'N/A'}\n`;
  msg += `*Location:* ${t.currentLocation || 'N/A'}\n`;

  if (t.events && t.events.length > 0) {
    msg += `\n*Recent Events:*\n`;
    t.events.slice(0, 5).forEach((e: any) => {
      const time = e.timestamp ? new Date(e.timestamp).toLocaleString() : 'N/A';
      msg += `• ${time}: ${e.description} @ ${e.location}\n`;
    });
  }

  return msg;
}

function formatDocsResponse(result: any): string {
  if (!result.success || !result.data) {
    return `:x: *Not Found*\nNo documents found for: ${result.error || 'unknown'}`;
  }

  const data = result.data;
  let msg = `:page_facing_up: *Document Status: ${data.bookingNumber || 'N/A'}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;

  const received = data.documentsReceived || [];
  const pending = data.documentsPending || [];

  msg += `*Received (${received.length}):*\n`;
  received.forEach((doc: string) => {
    msg += `:white_check_mark: ${doc}\n`;
  });

  if (pending.length > 0) {
    msg += `\n*Pending (${pending.length}):*\n`;
    pending.forEach((doc: string) => {
      msg += `:x: ${doc}\n`;
    });
  }

  const completion = data.documentCompletionRate || 0;
  msg += `\n*Completion:* ${Math.round(completion)}%`;

  return msg;
}

function formatPendingResponse(result: any): string {
  if (!result.success) {
    return `:x: Error fetching pending actions: ${result.error}`;
  }

  const items = result.data || [];
  if (items.length === 0) {
    return `:white_check_mark: *No Pending Actions*\nAll caught up!`;
  }

  let msg = `:clipboard: *Pending Actions (${items.length})*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;

  items.slice(0, 10).forEach((item: any) => {
    msg += `• *${item.bookingNumber || item.reference}*: ${item.actionType || item.action}\n`;
    if (item.deadline) msg += `  :clock3: Due: ${item.deadline}\n`;
    if (item.isOverdue) msg += `  :warning: OVERDUE\n`;
  });

  if (items.length > 10) {
    msg += `\n_...and ${items.length - 10} more_`;
  }

  return msg;
}

function formatUrgentResponse(result: any): string {
  if (!result.success || !result.data) {
    return `:x: Error fetching urgent items: ${result.error}`;
  }

  const data = result.data;
  const overdueCount = data.overdueCount || 0;
  const dueTodayCount = data.dueTodayCount || 0;

  if (overdueCount === 0 && dueTodayCount === 0) {
    return `:white_check_mark: *No Urgent Items*\nNothing critical right now!`;
  }

  let msg = `:rotating_light: *Urgent Items*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `*Overdue:* ${overdueCount} | *Due Today:* ${dueTodayCount}\n\n`;

  if (data.overdueActions?.length > 0) {
    msg += `*Overdue:*\n`;
    data.overdueActions.forEach((item: any) => {
      msg += `• *${item.bookingNumber || item.reference}*: ${item.actionType || item.action}\n`;
    });
  }

  if (data.dueTodayActions?.length > 0) {
    msg += `\n*Due Today:*\n`;
    data.dueTodayActions.forEach((item: any) => {
      msg += `• *${item.bookingNumber || item.reference}*: ${item.actionType || item.action}\n`;
    });
  }

  return msg;
}

function formatTodayResponse(result: any): string {
  if (!result.success || !result.data) {
    return `:x: Error fetching today's schedule: ${result.error}`;
  }

  const arrivals = result.data.arrivals || [];
  const departures = result.data.departures || [];

  if (arrivals.length === 0 && departures.length === 0) {
    return `:calendar: *Today's Movements*\nNo arrivals or departures scheduled for today.`;
  }

  let msg = `:calendar: *Today's Movements*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;

  if (departures.length > 0) {
    msg += `\n:ship: *Departures (${departures.length})*\n`;
    departures.forEach((d: any) => {
      msg += `• ${d.bookingNumber || d.booking_number} - ${d.vessel || d.vessel_name || 'N/A'} @ ${d.port || d.pol || 'N/A'}\n`;
    });
  }

  if (arrivals.length > 0) {
    msg += `\n:anchor: *Arrivals (${arrivals.length})*\n`;
    arrivals.forEach((a: any) => {
      msg += `• ${a.bookingNumber || a.booking_number} - ${a.vessel || a.vessel_name || 'N/A'} @ ${a.port || a.pod || 'N/A'}\n`;
    });
  }

  return msg;
}

function formatMismatchResponse(result: any): string {
  if (!result.success) {
    return `:x: Error checking mismatches: ${result.error}`;
  }

  const mismatches = result.data || [];
  if (mismatches.length === 0) {
    return `:white_check_mark: *No Data Mismatches*\nAll data is consistent!`;
  }

  let msg = `:warning: *Data Mismatches (${mismatches.length})*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;

  mismatches.slice(0, 10).forEach((m: any) => {
    msg += `• *${m.bookingNumber || m.containerNumber || 'Unknown'}*\n`;
    if (m.validation?.alerts) {
      m.validation.alerts.forEach((alert: any) => {
        msg += `  :exclamation: ${alert.message}\n`;
      });
    }
  });

  if (mismatches.length > 10) {
    msg += `\n_...and ${mismatches.length - 10} more_`;
  }

  return msg;
}

function formatCustomerResponse(result: any, customerName: string): string {
  if (!result.success) {
    return `:x: Error searching customer: ${result.error}`;
  }

  const shipments = result.data || [];
  if (shipments.length === 0) {
    return `:x: *No Shipments Found*\nNo active shipments for customer: ${customerName}`;
  }

  let msg = `:office: *Shipments for ${customerName} (${shipments.length})*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━━\n`;

  shipments.slice(0, 10).forEach((s: any) => {
    msg += `• *${s.booking_number || s.bookingNumber}* - ${s.status || 'N/A'}\n`;
    msg += `  ${s.pol || 'N/A'} → ${s.pod || 'N/A'}\n`;
  });

  if (shipments.length > 10) {
    msg += `\n_...and ${shipments.length - 10} more_`;
  }

  return msg;
}

function getHelpMessage(): string {
  return `:ship: *Shipment Pulse - Commands*
━━━━━━━━━━━━━━━━━━━━━━

*Status & Tracking*
\`/pulse status <booking>\` - Full shipment status
\`/pulse track <container>\` - Live container tracking
\`/pulse docs <booking>\` - Document completion

*Operations*
\`/pulse pending\` - All pending actions
\`/pulse urgent\` - Overdue & critical items
\`/pulse today\` - Today's arrivals/departures

*Search*
\`/pulse customer <name>\` - Search by customer
\`/pulse mismatch\` - Data discrepancies

*Quick Tip:* Just type a booking number directly!
\`/pulse 263805268\``;
}
