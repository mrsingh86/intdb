/**
 * AskService - Conversational AI for Shipment Intelligence
 *
 * Builds context for the AI to answer questions about shipments.
 * Supports multiple modes:
 * - chat: General questions about specific shipments
 * - briefing: Daily overview of urgent items
 * - celebrate: Highlight departures and deliveries
 * - draft: Generate professional communications
 */

import Anthropic from '@anthropic-ai/sdk';
import { SupabaseClient } from '@supabase/supabase-js';

// =============================================================================
// TYPES
// =============================================================================

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type AskMode = 'chat' | 'briefing' | 'celebrate' | 'draft';

export interface AskRequest {
  message: string;
  conversationHistory?: ChatMessage[];
  mode?: AskMode;
}

interface ShipmentSummary {
  id: string;
  booking_number: string | null;
  bl_number: string | null;
  shipper_name: string | null;
  consignee_name: string | null;
  carrier_name: string | null;
  vessel_name: string | null;
  port_of_loading: string | null;
  port_of_loading_code: string | null;
  port_of_discharge: string | null;
  port_of_discharge_code: string | null;
  etd: string | null;
  eta: string | null;
  stage: string | null;
  // AI Summary fields
  narrative: string | null;
  risk_level: string | null;
  risk_reason: string | null;
  current_blocker: string | null;
  blocker_owner: string | null;
  next_action: string | null;
  action_owner: string | null;
  documented_charges: string | null;
  estimated_detention: string | null;
  days_overdue: number | null;
  escalation_count: number | null;
  issue_count: number | null;
}

interface RecentChronicle {
  occurred_at: string;
  direction: string;
  from_party: string;
  summary: string;
  has_issue: boolean;
  issue_type: string | null;
  has_action: boolean;
  action_description: string | null;
  sentiment: string | null;
}

// =============================================================================
// SYSTEM PROMPTS
// =============================================================================

const BASE_SYSTEM_PROMPT = `You are Chronicle AI, Intoglo's freight operations assistant.

PERSONALITY:
- You're a knowledgeable colleague who knows every shipment's story
- Be conversational and direct, not robotic
- Celebrate successes enthusiastically
- Be honest about problems but always suggest solutions
- Use specific names, dates, and amounts - be precise

FORMATTING:
- Use markdown for formatting responses
- Use **bold** for important info (booking numbers, deadlines, amounts)
- Use bullet points for lists
- Keep responses concise but complete
- When mentioning a shipment, include its booking number

CAPABILITIES:
1. Answer questions about any shipment's status
2. Explain blockers and recommend actions
3. Calculate and explain financial exposure
4. Draft professional emails
5. Provide daily briefings
6. Celebrate departures and deliveries!

DOMAIN KNOWLEDGE:
- Parties: shipper (exporter), consignee (importer), carrier (shipping line), intoglo (us - the freight forwarder)
- Stages: PENDING → BOOKED → SI_SUBMITTED → DRAFT_BL → BL_ISSUED → DEPARTED → IN_TRANSIT → ARRIVED → DELIVERED
- Documents: Booking Confirmation, SI (Shipping Instructions), BL (Bill of Lading), Arrival Notice, Delivery Order
- Cutoffs: SI Cutoff, VGM Cutoff, Cargo Cutoff - all must be met before vessel departure
- Financial: Detention (container held beyond free time), Demurrage (port storage charges)`;

const BRIEFING_PROMPT = `${BASE_SYSTEM_PROMPT}

MODE: DAILY BRIEFING
You're providing a morning briefing to the ops team.

Structure your response:
1. **Quick Summary** - How many shipments need attention
2. **Critical (Red)** - Shipments requiring immediate action
3. **Attention (Amber)** - Shipments to watch closely
4. **Good News** - Recent departures and deliveries

Be specific with booking numbers, parties, and deadlines.
End with a motivating note for the team!`;

const CELEBRATE_PROMPT = `${BASE_SYSTEM_PROMPT}

MODE: CELEBRATION
You're celebrating the wins! Be genuinely enthusiastic about:
- Departures - cargo successfully loaded and sailing
- Deliveries - shipments completed successfully
- Milestones - BL issued, customs cleared, etc.

Use positive, energetic language. Make the team feel good about their work!
Include specific details (booking numbers, routes, customers) to make it personal.`;

const DRAFT_PROMPT = `${BASE_SYSTEM_PROMPT}

MODE: EMAIL DRAFTING
Generate professional emails based on shipment context.

Email Guidelines:
- Start with appropriate greeting
- Be clear and concise
- Include relevant details (booking#, vessel, dates)
- Specify what action is needed and by when
- Close professionally

Return the email in a clear format that can be copied.`;

// =============================================================================
// SERVICE CLASS
// =============================================================================

export class AskService {
  private anthropic: Anthropic;
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.anthropic = new Anthropic();
    this.supabase = supabase;
  }

  // ===========================================================================
  // CONTEXT BUILDING
  // ===========================================================================

  /**
   * Extract shipment identifiers from user message
   * Looks for booking numbers, BL numbers, container numbers
   */
  private extractShipmentIdentifiers(message: string): string[] {
    const identifiers: string[] = [];

    // Common patterns for booking/BL numbers
    // e.g., "37860708", "HLCUSHA241234567", "MAEU123456789"
    const patterns = [
      /\b\d{6,10}\b/g,                     // Numeric booking numbers
      /\b[A-Z]{4}\d{7,10}\b/gi,            // Carrier prefix + numbers
      /\b[A-Z]{3}U\d{7}\b/gi,              // Container numbers
    ];

    for (const pattern of patterns) {
      const matches = message.match(pattern);
      if (matches) {
        identifiers.push(...matches.map(m => m.toUpperCase()));
      }
    }

    return [...new Set(identifiers)];
  }

  /**
   * Search for shipments matching the identifiers
   */
  private async findShipments(identifiers: string[]): Promise<ShipmentSummary[]> {
    if (identifiers.length === 0) return [];

    const shipments: ShipmentSummary[] = [];

    for (const id of identifiers) {
      const { data } = await this.supabase
        .from('shipments')
        .select(`
          id, booking_number, bl_number, shipper_name, consignee_name,
          carrier_name, vessel_name, port_of_loading, port_of_loading_code,
          port_of_discharge, port_of_discharge_code, etd, eta, stage
        `)
        .or(`booking_number.ilike.%${id}%,bl_number.ilike.%${id}%,mbl_number.ilike.%${id}%,hbl_number.ilike.%${id}%`)
        .limit(3);

      if (data && data.length > 0) {
        // Get AI summaries for these shipments
        const shipmentIds = data.map(s => s.id);
        const { data: summaries } = await this.supabase
          .from('shipment_ai_summaries')
          .select('*')
          .in('shipment_id', shipmentIds);

        const summaryMap = new Map(summaries?.map(s => [s.shipment_id, s]) || []);

        for (const ship of data) {
          const summary = summaryMap.get(ship.id);
          shipments.push({
            ...ship,
            narrative: summary?.narrative || null,
            risk_level: summary?.risk_level || null,
            risk_reason: summary?.risk_reason || null,
            current_blocker: summary?.current_blocker || null,
            blocker_owner: summary?.blocker_owner || null,
            next_action: summary?.next_action || null,
            action_owner: summary?.action_owner || null,
            documented_charges: summary?.documented_charges || null,
            estimated_detention: summary?.estimated_detention || null,
            days_overdue: summary?.days_overdue || null,
            escalation_count: summary?.escalation_count || null,
            issue_count: summary?.issue_count || null,
          });
        }
      }
    }

    return shipments;
  }

  /**
   * Get recent chronicle entries for a shipment
   */
  private async getRecentChronicles(shipmentId: string, limit: number = 10): Promise<RecentChronicle[]> {
    const { data } = await this.supabase
      .from('chronicle')
      .select(`
        occurred_at, direction, from_party, summary,
        has_issue, issue_type, has_action, action_description, sentiment
      `)
      .eq('shipment_id', shipmentId)
      .order('occurred_at', { ascending: false })
      .limit(limit);

    return data || [];
  }

  /**
   * Get shipments needing attention (for briefing mode)
   */
  private async getShipmentsForBriefing(): Promise<{
    critical: ShipmentSummary[];
    attention: ShipmentSummary[];
    departures: ShipmentSummary[];
    arrivals: ShipmentSummary[];
  }> {
    const today = new Date();
    const threeDaysAgo = new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000);
    const threeDaysAhead = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);

    // Get shipments with AI summaries
    const { data: summaries } = await this.supabase
      .from('shipment_ai_summaries')
      .select(`
        shipment_id, narrative, risk_level, risk_reason, current_blocker,
        blocker_owner, next_action, action_owner, documented_charges,
        estimated_detention, days_overdue, escalation_count, issue_count
      `)
      .in('risk_level', ['red', 'amber'])
      .order('risk_level', { ascending: true })
      .limit(50);

    const shipmentIds = summaries?.map(s => s.shipment_id) || [];

    // Get shipment details
    const { data: shipments } = await this.supabase
      .from('shipments')
      .select(`
        id, booking_number, bl_number, shipper_name, consignee_name,
        carrier_name, vessel_name, port_of_loading, port_of_loading_code,
        port_of_discharge, port_of_discharge_code, etd, eta, stage
      `)
      .in('id', shipmentIds);

    const shipmentMap = new Map(shipments?.map(s => [s.id, s]) || []);

    const critical: ShipmentSummary[] = [];
    const attention: ShipmentSummary[] = [];

    for (const summary of summaries || []) {
      const ship = shipmentMap.get(summary.shipment_id);
      if (!ship) continue;

      const combined: ShipmentSummary = {
        ...ship,
        narrative: summary.narrative,
        risk_level: summary.risk_level,
        risk_reason: summary.risk_reason,
        current_blocker: summary.current_blocker,
        blocker_owner: summary.blocker_owner,
        next_action: summary.next_action,
        action_owner: summary.action_owner,
        documented_charges: summary.documented_charges,
        estimated_detention: summary.estimated_detention,
        days_overdue: summary.days_overdue,
        escalation_count: summary.escalation_count,
        issue_count: summary.issue_count,
      };

      if (summary.risk_level === 'red') {
        critical.push(combined);
      } else {
        attention.push(combined);
      }
    }

    // Get recent departures (DEPARTED in last 3 days)
    const { data: departedShipments } = await this.supabase
      .from('shipments')
      .select(`
        id, booking_number, bl_number, shipper_name, consignee_name,
        carrier_name, vessel_name, port_of_loading, port_of_loading_code,
        port_of_discharge, port_of_discharge_code, etd, eta, stage
      `)
      .in('stage', ['DEPARTED', 'IN_TRANSIT', 'SAILING'])
      .gte('etd', threeDaysAgo.toISOString().split('T')[0])
      .lte('etd', today.toISOString().split('T')[0])
      .limit(10);

    // Get recent arrivals (ARRIVED/DELIVERED in last 3 days)
    const { data: arrivedShipments } = await this.supabase
      .from('shipments')
      .select(`
        id, booking_number, bl_number, shipper_name, consignee_name,
        carrier_name, vessel_name, port_of_loading, port_of_loading_code,
        port_of_discharge, port_of_discharge_code, etd, eta, stage
      `)
      .in('stage', ['ARRIVED', 'DELIVERED', 'COMPLETED', 'CUSTOMS_CLEARED'])
      .gte('eta', threeDaysAgo.toISOString().split('T')[0])
      .lte('eta', threeDaysAhead.toISOString().split('T')[0])
      .limit(10);

    const mapToSummary = (ship: {
      id: string;
      booking_number: string | null;
      bl_number: string | null;
      shipper_name: string | null;
      consignee_name: string | null;
      carrier_name: string | null;
      vessel_name: string | null;
      port_of_loading: string | null;
      port_of_loading_code: string | null;
      port_of_discharge: string | null;
      port_of_discharge_code: string | null;
      etd: string | null;
      eta: string | null;
      stage: string | null;
    }): ShipmentSummary => ({
      ...ship,
      narrative: null,
      risk_level: 'green',
      risk_reason: null,
      current_blocker: null,
      blocker_owner: null,
      next_action: null,
      action_owner: null,
      documented_charges: null,
      estimated_detention: null,
      days_overdue: null,
      escalation_count: null,
      issue_count: null,
    });

    return {
      critical: critical.slice(0, 10),
      attention: attention.slice(0, 10),
      departures: (departedShipments || []).map(mapToSummary),
      arrivals: (arrivedShipments || []).map(mapToSummary),
    };
  }

  /**
   * Get shipments for celebration mode
   */
  private async getShipmentsForCelebration(): Promise<{
    departures: ShipmentSummary[];
    arrivals: ShipmentSummary[];
    completed: ShipmentSummary[];
  }> {
    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Recent departures
    const { data: departures } = await this.supabase
      .from('shipments')
      .select(`
        id, booking_number, bl_number, shipper_name, consignee_name,
        carrier_name, vessel_name, port_of_loading, port_of_loading_code,
        port_of_discharge, port_of_discharge_code, etd, eta, stage
      `)
      .in('stage', ['DEPARTED', 'IN_TRANSIT', 'SAILING'])
      .gte('etd', yesterday.toISOString().split('T')[0])
      .order('etd', { ascending: false })
      .limit(15);

    // Recent arrivals
    const { data: arrivals } = await this.supabase
      .from('shipments')
      .select(`
        id, booking_number, bl_number, shipper_name, consignee_name,
        carrier_name, vessel_name, port_of_loading, port_of_loading_code,
        port_of_discharge, port_of_discharge_code, etd, eta, stage
      `)
      .in('stage', ['ARRIVED', 'CUSTOMS_CLEARED'])
      .gte('eta', sevenDaysAgo.toISOString().split('T')[0])
      .order('eta', { ascending: false })
      .limit(15);

    // Completed deliveries
    const { data: completed } = await this.supabase
      .from('shipments')
      .select(`
        id, booking_number, bl_number, shipper_name, consignee_name,
        carrier_name, vessel_name, port_of_loading, port_of_loading_code,
        port_of_discharge, port_of_discharge_code, etd, eta, stage
      `)
      .in('stage', ['DELIVERED', 'COMPLETED'])
      .gte('eta', sevenDaysAgo.toISOString().split('T')[0])
      .order('eta', { ascending: false })
      .limit(15);

    const mapToSummary = (ship: {
      id: string;
      booking_number: string | null;
      bl_number: string | null;
      shipper_name: string | null;
      consignee_name: string | null;
      carrier_name: string | null;
      vessel_name: string | null;
      port_of_loading: string | null;
      port_of_loading_code: string | null;
      port_of_discharge: string | null;
      port_of_discharge_code: string | null;
      etd: string | null;
      eta: string | null;
      stage: string | null;
    }): ShipmentSummary => ({
      ...ship,
      narrative: null,
      risk_level: 'green',
      risk_reason: null,
      current_blocker: null,
      blocker_owner: null,
      next_action: null,
      action_owner: null,
      documented_charges: null,
      estimated_detention: null,
      days_overdue: null,
      escalation_count: null,
      issue_count: null,
    });

    return {
      departures: (departures || []).map(mapToSummary),
      arrivals: (arrivals || []).map(mapToSummary),
      completed: (completed || []).map(mapToSummary),
    };
  }

  // ===========================================================================
  // PROMPT BUILDING
  // ===========================================================================

  private formatDate(dateStr: string | null): string {
    if (!dateStr) return 'TBD';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  private formatShipmentContext(shipment: ShipmentSummary, chronicles?: RecentChronicle[]): string {
    const lines: string[] = [];

    lines.push(`## Shipment: ${shipment.booking_number || shipment.bl_number || 'Unknown'}`);
    lines.push(`Route: ${shipment.port_of_loading_code || shipment.port_of_loading || '?'} → ${shipment.port_of_discharge_code || shipment.port_of_discharge || '?'}`);
    lines.push(`Carrier: ${shipment.carrier_name || 'N/A'} | Vessel: ${shipment.vessel_name || 'TBD'}`);
    lines.push(`ETD: ${this.formatDate(shipment.etd)} | ETA: ${this.formatDate(shipment.eta)}`);
    lines.push(`Stage: ${shipment.stage || 'PENDING'}`);
    lines.push(`Shipper: ${shipment.shipper_name || 'N/A'}`);
    lines.push(`Consignee: ${shipment.consignee_name || 'N/A'}`);

    if (shipment.narrative) {
      lines.push(`\n**AI Summary:** ${shipment.narrative}`);
    }
    if (shipment.risk_level) {
      lines.push(`**Risk:** ${shipment.risk_level.toUpperCase()}${shipment.risk_reason ? ` - ${shipment.risk_reason}` : ''}`);
    }
    if (shipment.current_blocker) {
      lines.push(`**Blocker:** ${shipment.current_blocker} (${shipment.blocker_owner || 'unknown owner'})`);
    }
    if (shipment.next_action) {
      lines.push(`**Next Action:** ${shipment.next_action} (${shipment.action_owner || 'TBD'})`);
    }
    if (shipment.documented_charges) {
      lines.push(`**Charges:** ${shipment.documented_charges}`);
    }
    if (shipment.estimated_detention) {
      lines.push(`**Detention:** ${shipment.estimated_detention}`);
    }

    if (chronicles && chronicles.length > 0) {
      lines.push('\n**Recent Communications:**');
      for (const c of chronicles.slice(0, 5)) {
        const date = this.formatDate(c.occurred_at);
        const issue = c.has_issue ? ` [ISSUE: ${c.issue_type}]` : '';
        const action = c.has_action ? ` [ACTION: ${c.action_description?.slice(0, 30)}...]` : '';
        lines.push(`- ${date}: ${c.from_party} - ${c.summary.slice(0, 60)}${issue}${action}`);
      }
    }

    return lines.join('\n');
  }

  private formatBriefingContext(data: {
    critical: ShipmentSummary[];
    attention: ShipmentSummary[];
    departures: ShipmentSummary[];
    arrivals: ShipmentSummary[];
  }): string {
    const lines: string[] = [];
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });

    lines.push(`## Daily Briefing - ${today}`);
    lines.push(`\nTotal shipments needing attention: ${data.critical.length + data.attention.length}`);

    if (data.critical.length > 0) {
      lines.push('\n### CRITICAL (Red) - Immediate Action Required');
      for (const s of data.critical) {
        lines.push(`- **${s.booking_number}** (${s.carrier_name}): ${s.shipper_name} → ${s.consignee_name}`);
        lines.push(`  ${s.port_of_loading_code} → ${s.port_of_discharge_code} | ${s.narrative || s.risk_reason || 'Needs attention'}`);
      }
    }

    if (data.attention.length > 0) {
      lines.push('\n### ATTENTION (Amber) - Monitor Closely');
      for (const s of data.attention) {
        lines.push(`- **${s.booking_number}** (${s.carrier_name}): ${s.narrative || s.risk_reason || 'Watch this one'}`);
      }
    }

    if (data.departures.length > 0) {
      lines.push('\n### Recent Departures');
      for (const s of data.departures) {
        lines.push(`- **${s.booking_number}**: ${s.vessel_name} departed ${this.formatDate(s.etd)} from ${s.port_of_loading_code}`);
      }
    }

    if (data.arrivals.length > 0) {
      lines.push('\n### Recent/Upcoming Arrivals');
      for (const s of data.arrivals) {
        lines.push(`- **${s.booking_number}**: Arriving ${this.formatDate(s.eta)} at ${s.port_of_discharge_code}`);
      }
    }

    return lines.join('\n');
  }

  private formatCelebrationContext(data: {
    departures: ShipmentSummary[];
    arrivals: ShipmentSummary[];
    completed: ShipmentSummary[];
  }): string {
    const lines: string[] = [];

    lines.push('## Wins to Celebrate!');

    if (data.departures.length > 0) {
      lines.push('\n### Set Sail - Recent Departures');
      for (const s of data.departures) {
        lines.push(`- **${s.booking_number}**: ${s.vessel_name} departed from ${s.port_of_loading} on ${this.formatDate(s.etd)}`);
        lines.push(`  ${s.shipper_name} → ${s.consignee_name} | Carrier: ${s.carrier_name}`);
      }
    }

    if (data.arrivals.length > 0) {
      lines.push('\n### Safe Harbor - Recent Arrivals');
      for (const s of data.arrivals) {
        lines.push(`- **${s.booking_number}**: Arrived at ${s.port_of_discharge} on ${this.formatDate(s.eta)}`);
        lines.push(`  ${s.shipper_name} → ${s.consignee_name} | Carrier: ${s.carrier_name}`);
      }
    }

    if (data.completed.length > 0) {
      lines.push('\n### Mission Complete - Delivered');
      for (const s of data.completed) {
        lines.push(`- **${s.booking_number}**: Successfully delivered to ${s.consignee_name}`);
        lines.push(`  Route: ${s.port_of_loading_code} → ${s.port_of_discharge_code} | ${s.carrier_name}`);
      }
    }

    return lines.join('\n');
  }

  // ===========================================================================
  // MAIN API
  // ===========================================================================

  /**
   * Process a chat request and return a streaming response
   */
  async *chat(request: AskRequest): AsyncGenerator<string, void, unknown> {
    const { message, conversationHistory = [], mode = 'chat' } = request;

    // Determine system prompt based on mode
    let systemPrompt = BASE_SYSTEM_PROMPT;
    let contextPrompt = '';

    if (mode === 'briefing') {
      systemPrompt = BRIEFING_PROMPT;
      const data = await this.getShipmentsForBriefing();
      contextPrompt = this.formatBriefingContext(data);
    } else if (mode === 'celebrate') {
      systemPrompt = CELEBRATE_PROMPT;
      const data = await this.getShipmentsForCelebration();
      contextPrompt = this.formatCelebrationContext(data);
    } else if (mode === 'draft') {
      systemPrompt = DRAFT_PROMPT;
      // For draft mode, we need shipment context from the message
      const identifiers = this.extractShipmentIdentifiers(message);
      const shipments = await this.findShipments(identifiers);
      if (shipments.length > 0) {
        const chronicles = await this.getRecentChronicles(shipments[0].id);
        contextPrompt = this.formatShipmentContext(shipments[0], chronicles);
      }
    } else {
      // Chat mode - find relevant shipments
      const identifiers = this.extractShipmentIdentifiers(message);
      const shipments = await this.findShipments(identifiers);

      if (shipments.length > 0) {
        const contextParts: string[] = [];
        for (const ship of shipments.slice(0, 3)) {
          const chronicles = await this.getRecentChronicles(ship.id, 5);
          contextParts.push(this.formatShipmentContext(ship, chronicles));
        }
        contextPrompt = contextParts.join('\n\n---\n\n');
      }
    }

    // Build messages array
    const messages: Anthropic.MessageParam[] = [];

    // Add conversation history
    for (const msg of conversationHistory.slice(-10)) {
      messages.push({
        role: msg.role,
        content: msg.content,
      });
    }

    // Add current message with context
    const userContent = contextPrompt
      ? `${contextPrompt}\n\n---\n\nUser Question: ${message}`
      : message;

    messages.push({
      role: 'user',
      content: userContent,
    });

    // Create streaming response
    const stream = await this.anthropic.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });

    // Yield chunks as they arrive
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        yield event.delta.text;
      }
    }
  }

  /**
   * Get a non-streaming response (for simpler use cases)
   */
  async ask(request: AskRequest): Promise<string> {
    const chunks: string[] = [];
    for await (const chunk of this.chat(request)) {
      chunks.push(chunk);
    }
    return chunks.join('');
  }
}
