/**
 * Clear Chat API
 *
 * POST /api/clear/chat
 * Main endpoint for Clear conversations
 */

import { NextRequest, NextResponse } from 'next/server';
import { getClearService } from '@/lib/clear';
import { createClient } from '@/utils/supabase/server';

// Use shared admin client from utils (handles service role key)
const supabase = createClient();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, conversationId, userId, conversationHistory } = body;

    if (!message) {
      return NextResponse.json({ error: 'Message required' }, { status: 400 });
    }

    // Check rate limit if userId provided
    if (userId) {
      const withinLimit = await checkUsageLimit(userId);
      if (!withinLimit) {
        return NextResponse.json(
          { error: 'Daily query limit reached. Upgrade for more queries.' },
          { status: 429 }
        );
      }
    }

    // Get conversation history - priority: 1) client-provided, 2) database, 3) empty
    let history: { role: 'user' | 'assistant'; content: string }[] = [];

    // Option 1: Use client-provided conversation history (for stateless mode)
    if (conversationHistory && Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      history = conversationHistory.slice(-20).map((m: { role: string; content: string }) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
      console.log(`[Clear Chat] Using client-provided history: ${history.length} messages`);
    }
    // Option 2: Load from database if conversationId provided
    else if (conversationId) {
      console.log(`[Clear Chat] Loading history for conversation: ${conversationId}`);
      const { data: messages, error: historyError } = await supabase
        .from('clear_messages')
        .select('role, content')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .limit(20);

      if (historyError) {
        console.warn('[Clear Chat] Failed to load history:', historyError.message);
      } else if (messages && messages.length > 0) {
        history = messages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }));
        console.log(`[Clear Chat] Loaded ${history.length} messages from database`);
      } else {
        console.log('[Clear Chat] No history found for conversation');
      }
    } else {
      console.log('[Clear Chat] No conversationId or history provided - starting fresh');
    }

    // Call Clear service with Supabase client for database features
    const clearService = getClearService(supabase);
    const response = await clearService.chat(message, history);

    // Store conversation and messages if userId provided
    let newConversationId = conversationId;
    if (userId) {
      try {
        newConversationId = await storeConversation(
          userId,
          conversationId,
          message,
          response
        );
        // Increment usage counter
        await incrementUsage(userId);
      } catch (storageError: any) {
        // Log storage error but don't fail the request
        // This allows the chat to work even if RLS blocks storage
        console.warn('[Clear Chat] Storage failed (RLS?):', storageError.message);
      }
    }

    return NextResponse.json({
      success: true,
      conversationId: newConversationId,
      response: {
        message: response.message,
        dutyBreakdown: response.dutyBreakdown,
        sources: response.sources,
        suggestions: response.suggestions || [],
      },
    });
  } catch (error: any) {
    console.error('[Clear Chat API] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Chat failed' },
      { status: 500 }
    );
  }
}

async function storeConversation(
  userId: string,
  conversationId: string | null,
  userMessage: string,
  response: any
): Promise<string> {
  let convId = conversationId;

  // Create new conversation if needed
  if (!convId) {
    const title =
      userMessage.length > 50
        ? userMessage.substring(0, 50) + '...'
        : userMessage;

    const { data: conv, error } = await supabase
      .from('clear_conversations')
      .insert({
        user_id: userId,
        title,
        last_message_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('[Clear] Failed to create conversation:', error);
      throw error;
    }
    convId = conv.id;
  } else {
    // Update last message time
    await supabase
      .from('clear_conversations')
      .update({ last_message_at: new Date().toISOString() })
      .eq('id', convId);
  }

  // Store user message
  await supabase.from('clear_messages').insert({
    conversation_id: convId,
    role: 'user',
    content: userMessage,
  });

  // Store assistant response with tool results for context persistence
  const toolCalls = response.toolResults?.map((t: { tool: string; input: Record<string, any> }) => ({
    name: t.tool,
    input: t.input,
  }));
  const toolResults = response.toolResults?.map((t: { tool: string; result: any }) => ({
    tool: t.tool,
    result: t.result,
  }));

  await supabase.from('clear_messages').insert({
    conversation_id: convId,
    role: 'assistant',
    content: response.message,
    duty_breakdown: response.dutyBreakdown,
    sources: response.sources,
    tool_calls: toolCalls || null,
    tool_results: toolResults || null,
  });

  return convId!;
}

async function checkUsageLimit(userId: string): Promise<boolean> {
  const today = new Date().toISOString().split('T')[0];
  const DEFAULT_DAILY_LIMIT = 10; // Default for unregistered users

  // Get user's daily limit
  const { data: user } = await supabase
    .from('clear_users')
    .select('daily_query_limit')
    .eq('id', userId)
    .single();

  // Use default limit if user doesn't exist (guest/anonymous)
  const dailyLimit = user?.daily_query_limit || DEFAULT_DAILY_LIMIT;

  // Get today's usage
  const { data: usage } = await supabase
    .from('clear_usage')
    .select('queries_count')
    .eq('user_id', userId)
    .eq('usage_date', today)
    .single();

  const queriesUsed = usage?.queries_count || 0;
  return queriesUsed < dailyLimit;
}

async function incrementUsage(userId: string): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  // Upsert usage record
  const { data: existing } = await supabase
    .from('clear_usage')
    .select('id, queries_count, messages_count')
    .eq('user_id', userId)
    .eq('usage_date', today)
    .single();

  if (existing) {
    await supabase
      .from('clear_usage')
      .update({
        queries_count: (existing.queries_count || 0) + 1,
        messages_count: (existing.messages_count || 0) + 2, // user + assistant
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
  } else {
    await supabase.from('clear_usage').insert({
      user_id: userId,
      usage_date: today,
      queries_count: 1,
      messages_count: 2,
    });
  }
}
