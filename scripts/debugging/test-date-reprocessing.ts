/**
 * Test Date Reprocessing
 *
 * Runs AI analysis on a few sample emails marked for reprocessing
 * to verify the improved prompt extracts dates correctly.
 */

import { createClient } from '@supabase/supabase-js';
import { AiAnalyzer } from '../../lib/chronicle/ai-analyzer';
import { ChronicleRepository } from '../../lib/chronicle/chronicle-repository';
import { AI_CONFIG } from '../../lib/chronicle/prompts/freight-forwarder.prompt';
import 'dotenv/config';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

interface SampleChronicle {
  id: string;
  gmail_message_id: string;
  thread_id: string;
  subject: string;
  body_preview: string;
  attachments: Array<{ extractedText?: string; filename?: string }>;
  occurred_at: string;
  document_type: string;
  etd: string | null;
  eta: string | null;
  last_free_day: string | null;
  si_cutoff: string | null;
  vgm_cutoff: string | null;
}

async function testReprocessing() {
  console.log('='.repeat(80));
  console.log('DATE REPROCESSING TEST');
  console.log('='.repeat(80));

  const aiAnalyzer = new AiAnalyzer();
  const repository = new ChronicleRepository(supabase);

  // Test specific emails with dates in body text
  const testIds = [
    'b585b989-5a50-4597-90c3-0dc1d92d293f', // arrival_notice with "ETA 23 Jan" in body
    'e38ac04e-bcd0-4661-aaa9-67d6f7eeee2e', // arrival_notice with ETA already
    '1ca0b007-ee3c-4cb3-8431-c83551c3695b', // arrival_notice with LFD already
  ];

  console.log(`\nTesting ${testIds.length} specific emails with dates in body text\n`);

  const { data: samples, error } = await supabase
    .from('chronicle')
    .select('id, gmail_message_id, thread_id, subject, body_preview, attachments, occurred_at, document_type, etd, eta, last_free_day, si_cutoff, vgm_cutoff')
    .in('id', testIds);

  if (error) {
    console.error('Error fetching samples:', error);
    return;
  }

  for (const sample of (samples || []) as SampleChronicle[]) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Chronicle ID: ${sample.id}`);
    console.log(`Doc Type: ${sample.document_type}`);
    console.log(`Subject: ${sample.subject?.substring(0, 60)}...`);
    console.log(`Body Preview: ${sample.body_preview?.substring(0, 150)}...`);
    console.log(`\nCURRENT VALUES:`);
    console.log(`  ETD: ${sample.etd || 'NULL'}`);
    console.log(`  ETA: ${sample.eta || 'NULL'}`);
    console.log(`  LFD: ${sample.last_free_day || 'NULL'}`);
    console.log(`  SI Cutoff: ${sample.si_cutoff || 'NULL'}`);
    console.log(`  VGM Cutoff: ${sample.vgm_cutoff || 'NULL'}`);

    try {
      // Get thread context
      const threadContext = await repository.getThreadContext(
        sample.thread_id,
        new Date(sample.occurred_at)
      );

      // Build attachment text
      const attachmentText = sample.attachments
        ?.filter((a: { extractedText?: string }) => a.extractedText)
        .map((a: { extractedText?: string; filename?: string }) =>
          `\n=== ${a.filename || 'attachment'} ===\n${a.extractedText?.substring(0, AI_CONFIG.maxAttachmentChars)}\n`
        )
        .join('') || '';

      // Run AI analysis
      const analysis = await aiAnalyzer.analyze(
        {
          gmailMessageId: sample.gmail_message_id,
          threadId: sample.thread_id,
          subject: sample.subject,
          bodyText: sample.body_preview || '',
          senderEmail: '',
          senderName: '',
          recipientEmails: [],
          receivedAt: new Date(sample.occurred_at),
          direction: 'inbound' as const,
          snippet: '',
          attachments: [],
        },
        attachmentText,
        threadContext || undefined
      );

      console.log(`\nNEW EXTRACTED VALUES:`);
      console.log(`  ETD: ${analysis.etd || 'NULL'}`);
      console.log(`  ETA: ${analysis.eta || 'NULL'}`);
      console.log(`  LFD: ${analysis.last_free_day || 'NULL'}`);
      console.log(`  SI Cutoff: ${analysis.si_cutoff || 'NULL'}`);
      console.log(`  VGM Cutoff: ${analysis.vgm_cutoff || 'NULL'}`);
      console.log(`  Cargo Cutoff: ${analysis.cargo_cutoff || 'NULL'}`);
      console.log(`  Doc Cutoff: ${analysis.doc_cutoff || 'NULL'}`);

      // Show what changed
      const changes: string[] = [];
      if (sample.etd !== analysis.etd) changes.push(`ETD: ${sample.etd} → ${analysis.etd}`);
      if (sample.eta !== analysis.eta) changes.push(`ETA: ${sample.eta} → ${analysis.eta}`);
      if (sample.last_free_day !== analysis.last_free_day) changes.push(`LFD: ${sample.last_free_day} → ${analysis.last_free_day}`);
      if (sample.si_cutoff !== analysis.si_cutoff) changes.push(`SI: ${sample.si_cutoff} → ${analysis.si_cutoff}`);
      if (sample.vgm_cutoff !== analysis.vgm_cutoff) changes.push(`VGM: ${sample.vgm_cutoff} → ${analysis.vgm_cutoff}`);

      if (changes.length > 0) {
        console.log(`\nCHANGES DETECTED:`);
        changes.forEach(c => console.log(`  ✓ ${c}`));
      } else {
        console.log(`\nNO CHANGES (dates unchanged)`);
      }

    } catch (err) {
      console.error(`\nERROR processing:`, err);
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));
}

testReprocessing().catch(console.error);
