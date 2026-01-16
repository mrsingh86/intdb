/**
 * Reprocess Test API
 *
 * Reprocesses emails marked with needs_reanalysis=true
 * Uses pattern matching first, then AI fallback
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { createPatternMatcherService } from '../../../../lib/chronicle';
import { AiAnalyzer } from '../../../../lib/chronicle/ai-analyzer';

const BATCH_SIZE = 10;

export async function GET(request: Request) {
  const startTime = Date.now();

  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || String(BATCH_SIZE));
    const dryRun = searchParams.get('dry_run') === 'true';

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Get chronicles needing reanalysis
    const { data: chronicles, error } = await supabase
      .from('chronicle')
      .select('id, gmail_message_id, subject, body_preview, from_address, attachments, occurred_at')
      .eq('needs_reanalysis', true)
      .order('occurred_at', { ascending: true })
      .limit(limit);

    if (error) throw error;
    if (!chronicles || chronicles.length === 0) {
      return NextResponse.json({ message: 'No emails to reprocess', count: 0 });
    }

    // Initialize services
    const patternMatcher = createPatternMatcherService(supabase);
    const aiAnalyzer = new AiAnalyzer();

    const results: Array<{
      id: string;
      subject: string;
      method: 'pattern' | 'ai';
      oldType?: string;
      newType: string;
      confidence: number;
      patternMatched?: string;
    }> = [];

    // Get baseline for comparison
    const { data: baseline } = await supabase
      .from('reanalysis_test_baseline')
      .select('chronicle_id, original_document_type')
      .in('chronicle_id', chronicles.map(c => c.id));

    const baselineMap = new Map(
      (baseline || []).map(b => [b.chronicle_id, b.original_document_type])
    );

    for (const chronicle of chronicles) {
      try {
        // Try pattern matching first - build input directly from chronicle record
        const patternInput = {
          subject: chronicle.subject || '',
          senderEmail: chronicle.from_address || '',
          bodyText: chronicle.body_preview || '',
          hasAttachment: Array.isArray(chronicle.attachments) && chronicle.attachments.length > 0,
          threadPosition: 1,
        };

        const patternResult = await patternMatcher.match(patternInput);

        let newDocType: string;
        let method: 'pattern' | 'ai';
        let confidence: number;
        let patternMatched: string | undefined;

        if (patternResult.matched && patternResult.confidence >= 85) {
          // Use pattern match
          newDocType = patternResult.documentType!;
          method = 'pattern';
          confidence = patternResult.confidence;
          patternMatched = patternResult.matchedPattern ?? undefined;
        } else {
          // Fall back to AI
          const attachmentText = (chronicle.attachments || [])
            .filter((a: any) => a.extractedText)
            .map((a: any) => a.extractedText)
            .join('\n');

          const analysis = await aiAnalyzer.analyze(
            {
              gmailMessageId: chronicle.gmail_message_id,
              threadId: '',
              subject: chronicle.subject || '',
              bodyText: chronicle.body_preview || '',
              senderEmail: chronicle.from_address || '',
              senderName: '',
              recipientEmails: [],
              receivedAt: new Date(chronicle.occurred_at),
              direction: 'inbound',
              snippet: '',
              attachments: [],
            },
            attachmentText
          );

          newDocType = analysis.document_type;
          method = 'ai';
          confidence = 75; // Default AI confidence
        }

        results.push({
          id: chronicle.id,
          subject: chronicle.subject?.substring(0, 60) || '',
          method,
          oldType: baselineMap.get(chronicle.id),
          newType: newDocType,
          confidence,
          patternMatched,
        });

        // Update chronicle if not dry run
        if (!dryRun) {
          await supabase
            .from('chronicle')
            .update({
              document_type: newDocType,
              needs_reanalysis: false,
              reanalyzed_at: new Date().toISOString(),
            })
            .eq('id', chronicle.id);
        }

      } catch (err) {
        console.error(`[Reprocess] Error for ${chronicle.id}:`, err);
        results.push({
          id: chronicle.id,
          subject: chronicle.subject?.substring(0, 60) || '',
          method: 'ai',
          oldType: baselineMap.get(chronicle.id),
          newType: 'ERROR',
          confidence: 0,
        });
      }
    }

    // Calculate stats
    const patternMatches = results.filter(r => r.method === 'pattern').length;
    const aiMatches = results.filter(r => r.method === 'ai').length;
    const changed = results.filter(r => r.oldType && r.oldType !== r.newType).length;
    const unchanged = results.filter(r => r.oldType && r.oldType === r.newType).length;

    return NextResponse.json({
      success: true,
      dryRun,
      stats: {
        total: results.length,
        patternMatches,
        aiMatches,
        changed,
        unchanged,
        durationMs: Date.now() - startTime,
      },
      results,
    });

  } catch (error) {
    console.error('[Reprocess] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const maxDuration = 120;
