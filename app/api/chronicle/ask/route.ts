import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { AskService } from '@/lib/chronicle-v2/services';
import type { AskMode, ChatMessage } from '@/lib/chronicle-v2/services';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface AskRequestBody {
  message: string;
  conversationHistory?: ChatMessage[];
  mode?: AskMode;
}

/**
 * POST /api/chronicle/ask
 *
 * Conversational AI endpoint for shipment intelligence.
 * Returns Server-Sent Events stream for real-time response.
 */
export async function POST(request: NextRequest) {
  try {
    const body: AskRequestBody = await request.json();
    const { message, conversationHistory, mode } = body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return new Response(
        JSON.stringify({ error: 'Message is required' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const askService = new AskService(supabase);

    // Create a readable stream for SSE
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of askService.chat({
            message: message.trim(),
            conversationHistory,
            mode,
          })) {
            // Send each chunk as SSE data
            const data = JSON.stringify({ type: 'text', content: chunk });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }

          // Send done signal
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
          controller.close();
        } catch (error) {
          console.error('[Ask API] Stream error:', error);
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: 'error', content: errorMsg })}\n\n`)
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error) {
    console.error('[Ask API] Error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to process request' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
