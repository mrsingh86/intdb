/**
 * Clawdbot Webhook Endpoint
 *
 * Receives messages from Clawdbot and processes them using the
 * Unified Intelligence Service for shipment queries.
 *
 * Authentication: Bearer token or x-clawdbot-token header
 *
 * POST /api/bot/webhook
 * {
 *   "message": "status 262226938",
 *   "sender": "+919876543210",
 *   "channel": "whatsapp",
 *   "sessionKey": "optional-session-id"
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "reply": "📦 *UNIFIED STATUS*...",
 *   "buttons": [{ "label": "📍 Track", "callback": "track 262226938" }]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getBotCommandHandler } from '@/lib/unified-intelligence';

// =============================================================================
// TYPES
// =============================================================================

interface WebhookRequest {
  message: string;
  sender?: string;
  channel?: 'whatsapp' | 'telegram' | 'slack' | 'discord' | 'signal';
  sessionKey?: string;
  metadata?: Record<string, unknown>;
}

interface WebhookResponse {
  success: boolean;
  reply: string;
  buttons?: Array<{ label: string; callback: string }>;
  error?: string;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const WEBHOOK_TOKEN = process.env.CLAWDBOT_WEBHOOK_TOKEN;
const ALLOWED_SENDERS = process.env.BOT_ALLOWED_SENDERS?.split(',') || [];

// =============================================================================
// AUTHENTICATION
// =============================================================================

function verifyAuth(request: NextRequest): { valid: boolean; error?: string } {
  // Skip auth in development if no token configured
  if (!WEBHOOK_TOKEN && process.env.NODE_ENV === 'development') {
    return { valid: true };
  }

  if (!WEBHOOK_TOKEN) {
    return { valid: false, error: 'Webhook token not configured' };
  }

  // Check Bearer token
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    if (token === WEBHOOK_TOKEN) {
      return { valid: true };
    }
  }

  // Check x-clawdbot-token header
  const customToken = request.headers.get('x-clawdbot-token');
  if (customToken === WEBHOOK_TOKEN) {
    return { valid: true };
  }

  return { valid: false, error: 'Invalid or missing authentication' };
}

// =============================================================================
// SENDER VALIDATION
// =============================================================================

function isAllowedSender(sender: string | undefined): boolean {
  // If no allowlist configured, allow all (for internal testing)
  if (ALLOWED_SENDERS.length === 0) {
    return true;
  }

  if (!sender) {
    return false;
  }

  // Normalize phone number (remove spaces, dashes)
  const normalized = sender.replace(/[\s\-\(\)]/g, '');

  return ALLOWED_SENDERS.some((allowed) => {
    const normalizedAllowed = allowed.trim().replace(/[\s\-\(\)]/g, '');
    return normalized.endsWith(normalizedAllowed) || normalizedAllowed.endsWith(normalized);
  });
}

// =============================================================================
// SUPABASE CLIENT
// =============================================================================

function getSupabaseClient() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase configuration');
  }

  return createClient(supabaseUrl, supabaseKey);
}

// =============================================================================
// REQUEST LOGGING
// =============================================================================

async function logRequest(
  supabase: ReturnType<typeof createClient>,
  request: WebhookRequest,
  response: WebhookResponse,
  processingTimeMs: number
) {
  try {
    await supabase.from('bot_request_logs').insert({
      message: request.message,
      sender: request.sender || null,
      channel: request.channel || 'unknown',
      session_key: request.sessionKey || null,
      response_success: response.success,
      response_preview: response.reply.slice(0, 500),
      processing_time_ms: processingTimeMs,
      created_at: new Date().toISOString(),
    });
  } catch {
    // Logging failure should not break the response
    console.error('[Bot Webhook] Failed to log request');
  }
}

// =============================================================================
// POST HANDLER
// =============================================================================

export async function POST(request: NextRequest): Promise<NextResponse<WebhookResponse>> {
  const startTime = Date.now();

  // Verify authentication
  const auth = verifyAuth(request);
  if (!auth.valid) {
    return NextResponse.json(
      { success: false, reply: '', error: auth.error },
      { status: 401 }
    );
  }

  // Parse request body
  let body: WebhookRequest;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, reply: '', error: 'Invalid JSON body' },
      { status: 400 }
    );
  }

  // Validate message
  if (!body.message || typeof body.message !== 'string') {
    return NextResponse.json(
      { success: false, reply: '', error: 'Message is required' },
      { status: 400 }
    );
  }

  // Check sender allowlist (optional - for restricting to internal team)
  if (!isAllowedSender(body.sender)) {
    return NextResponse.json(
      {
        success: false,
        reply: '🔒 Sorry, this bot is currently available only for the internal ops team.',
        error: 'Sender not in allowlist',
      },
      { status: 403 }
    );
  }

  try {
    // Initialize services
    const supabase = getSupabaseClient();
    const botHandler = getBotCommandHandler(supabase);

    // Process the command
    const result = await botHandler.handleCommand(body.message);

    const response: WebhookResponse = {
      success: result.success,
      reply: result.message,
      buttons: result.buttons,
    };

    // Log the request (async, non-blocking)
    const processingTime = Date.now() - startTime;
    logRequest(supabase, body, response, processingTime).catch(() => {});

    return NextResponse.json(response);
  } catch (error) {
    console.error('[Bot Webhook] Error processing command:', error);

    return NextResponse.json(
      {
        success: false,
        reply: '❌ Sorry, something went wrong. Please try again.',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// =============================================================================
// GET HANDLER (Health Check)
// =============================================================================

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    status: 'ok',
    service: 'intoglo-bot',
    version: '1.0.0',
    commands: [
      'status <ref>',
      'track <container>',
      'docs <booking>',
      'pending',
      'urgent',
      'today',
      'mismatch',
      'deadlines <booking>',
      'charges <container>',
      'customer <name>',
      'help',
    ],
  });
}
