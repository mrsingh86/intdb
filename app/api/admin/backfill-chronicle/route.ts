/**
 * Admin: Backfill Chronicle from raw_emails
 *
 * Processes existing raw_emails through the Chronicle AI pipeline
 * instead of fetching fresh from Gmail.
 *
 * Usage: GET /api/admin/backfill-chronicle?limit=100&offset=0
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { FREIGHT_FORWARDER_PROMPT } from '@/lib/chronicle/prompts/freight-forwarder.prompt';

// Configuration
const BATCH_SIZE = 50;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get('limit') || '100');
  const offset = parseInt(searchParams.get('offset') || '0');
  const startTime = Date.now();

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const anthropicKey = process.env.ANTHROPIC_API_KEY;

    if (!supabaseUrl || !supabaseKey || !anthropicKey) {
      return NextResponse.json({ error: 'Missing config' }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const anthropic = new Anthropic({ apiKey: anthropicKey });

    // Get raw_emails that don't have chronicle records yet
    const { data: emails, error: fetchError } = await supabase
      .from('raw_emails')
      .select(`
        id,
        gmail_message_id,
        thread_id,
        subject,
        sender_email,
        recipient_emails,
        body_text,
        received_at
      `)
      .order('received_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (fetchError) throw fetchError;

    console.log(`[Backfill] Processing ${emails?.length || 0} emails (offset: ${offset})`);

    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    let linked = 0;

    for (const email of emails || []) {
      try {
        // Check if already in chronicle
        const { data: existing } = await supabase
          .from('chronicle')
          .select('id')
          .eq('gmail_message_id', email.gmail_message_id)
          .single();

        if (existing) {
          skipped++;
          continue;
        }

        // Get attachment text if available
        const { data: attachments } = await supabase
          .from('raw_attachments')
          .select('extracted_text, filename')
          .eq('email_id', email.id)
          .not('extracted_text', 'is', null);

        const attachmentText = attachments
          ?.map(a => `[${a.filename}]\n${a.extracted_text}`)
          .join('\n\n') || '';

        // Call Claude AI
        const aiResponse = await analyzeWithClaude(anthropic, {
          subject: email.subject || '',
          body: (email.body_text || '').slice(0, 4000),
          attachmentText: attachmentText.slice(0, 8000),
          senderEmail: email.sender_email || '',
        });

        if (!aiResponse) {
          failed++;
          continue;
        }

        // Determine direction
        const intogloEmails = ['ops@intoglo.com', 'export@intoglo.com', 'import@intoglo.com'];
        const direction = intogloEmails.some(e =>
          email.sender_email?.toLowerCase().includes(e.split('@')[0])
        ) ? 'outbound' : 'inbound';

        // Insert chronicle record
        const { data: chronicle, error: insertError } = await supabase
          .from('chronicle')
          .insert({
            gmail_message_id: email.gmail_message_id,
            thread_id: email.thread_id,
            subject: email.subject,
            snippet: (email.body_text || '').slice(0, 200),
            body_preview: (email.body_text || '').slice(0, 1000),
            from_address: email.sender_email,
            direction,
            occurred_at: email.received_at,
            // AI extracted fields
            document_type: aiResponse.document_type,
            from_party: aiResponse.from_party,
            message_type: aiResponse.message_type,
            sentiment: aiResponse.sentiment,
            summary: aiResponse.summary,
            booking_number: aiResponse.booking_number,
            mbl_number: aiResponse.mbl_number,
            hbl_number: aiResponse.hbl_number,
            container_numbers: aiResponse.container_numbers,
            work_order_number: aiResponse.work_order_number,
            pol_location: aiResponse.por_location || aiResponse.pol_location,
            pod_location: aiResponse.pod_location || aiResponse.pofd_location,
            etd: aiResponse.etd,
            eta: aiResponse.eta,
            si_cutoff: aiResponse.si_cutoff,
            vgm_cutoff: aiResponse.vgm_cutoff,
            cargo_cutoff: aiResponse.cargo_cutoff,
            has_action: aiResponse.has_action || false,
            action_description: aiResponse.action_description,
            action_priority: aiResponse.action_priority,
            has_issue: aiResponse.has_issue || false,
            issue_type: aiResponse.issue_type,
            issue_description: aiResponse.issue_description,
            ai_model: 'claude-3-5-haiku-latest',
            ai_response: aiResponse,
          })
          .select('id')
          .single();

        if (insertError) {
          console.error(`[Backfill] Insert failed:`, insertError.message);
          failed++;
          continue;
        }

        succeeded++;

        // Link to shipment
        if (chronicle?.id) {
          const { data: linkResult } = await supabase
            .rpc('link_chronicle_to_shipment', { chronicle_id: chronicle.id });

          if (linkResult && linkResult.length > 0 && linkResult[0].shipment_id) {
            linked++;
          }
        }

        processed++;

        // Progress log
        if (processed % 10 === 0) {
          console.log(`[Backfill] Progress: ${processed}/${emails?.length} (${succeeded} ok, ${failed} failed, ${skipped} skipped)`);
        }

      } catch (error) {
        console.error(`[Backfill] Error processing email ${email.gmail_message_id}:`, error);
        failed++;
      }
    }

    return NextResponse.json({
      success: true,
      duration_ms: Date.now() - startTime,
      stats: {
        total: emails?.length || 0,
        processed,
        succeeded,
        failed,
        skipped,
        linked,
        next_offset: offset + limit,
      },
    });

  } catch (error) {
    console.error('[Backfill] Fatal error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

async function analyzeWithClaude(
  anthropic: Anthropic,
  data: { subject: string; body: string; attachmentText: string; senderEmail: string }
): Promise<Record<string, any> | null> {
  try {
    const content = `
Subject: ${data.subject}
From: ${data.senderEmail}

Body:
${data.body}

${data.attachmentText ? `Attachments:\n${data.attachmentText}` : ''}
`.trim();

    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 2000,
      tools: [FREIGHT_FORWARDER_PROMPT],
      tool_choice: { type: 'tool', name: 'analyze_shipping_email' },
      messages: [
        {
          role: 'user',
          content: `Analyze this freight forwarding email and extract all relevant information:\n\n${content}`,
        },
      ],
    });

    // Extract tool result
    const toolUse = response.content.find(block => block.type === 'tool_use');
    if (toolUse && toolUse.type === 'tool_use') {
      return toolUse.input as Record<string, any>;
    }

    return null;
  } catch (error) {
    console.error('[Backfill] Claude API error:', error);
    return null;
  }
}

export const runtime = 'nodejs';
export const maxDuration = 300;
