/**
 * Chronicle Full Runner
 *
 * Comprehensive email processing with:
 * - Detailed logging at all pipeline stages
 * - 5-minute progress reports
 * - Shipment journey tracking
 * - Error classification and recovery
 *
 * Usage:
 *   npx tsx scripts/run-chronicle-full.ts --fresh    # Delete all data and reprocess
 *   npx tsx scripts/run-chronicle-full.ts --days 30  # Process last 30 days
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local' });

import * as fs from 'fs';
import * as path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ChronicleLogger, ShipmentStage } from '../lib/chronicle/chronicle-logger';
import { ChronicleGmailService, createChronicleGmailService } from '../lib/chronicle/gmail-service';
import { ProcessedEmail } from '../lib/chronicle/types';

// ============================================================================
// CONFIGURATION
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ============================================================================
// CLI PARSING
// ============================================================================

interface CliArgs {
  fresh: boolean;
  days: number;
  maxResults: number;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const result: CliArgs = {
    fresh: false,
    days: 30,
    maxResults: 2000,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--fresh') {
      result.fresh = true;
    } else if (arg === '--days' && args[i + 1]) {
      result.days = parseInt(args[++i]);
    } else if (arg === '--max' && args[i + 1]) {
      result.maxResults = parseInt(args[++i]);
    }
  }

  return result;
}

// ============================================================================
// DATABASE OPERATIONS
// ============================================================================

async function runMigration(): Promise<void> {
  console.log('[Setup] Running logging migration...');

  const migrationPath = path.join(__dirname, '../lib/chronicle/migration-logging.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf-8');

  // Split and execute statements
  const statements = migrationSql
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'));

  for (const statement of statements) {
    try {
      // Use rpc for DDL if available, otherwise just log
      const { error } = await supabase.rpc('exec_sql', { sql: statement + ';' }).single();
      if (error && !error.message.includes('already exists')) {
        // Ignore "already exists" errors
      }
    } catch {
      // Continue on error - some statements may fail if objects exist
    }
  }

  console.log('[Setup] Migration complete');
}

async function deleteAllData(): Promise<void> {
  console.log('[Setup] Deleting all existing data...');

  // Order matters due to foreign keys
  await supabase.from('shipment_events').delete().gte('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('chronicle_errors').delete().gte('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('chronicle_stage_metrics').delete().gte('id', '00000000-0000-0000-0000-000000000000');
  await supabase.from('chronicle_runs').delete().gte('id', '00000000-0000-0000-0000-000000000000');

  // Unlink chronicle from shipments
  await supabase.from('chronicle').update({ shipment_id: null, linked_by: null, linked_at: null }).gte('id', '00000000-0000-0000-0000-000000000000');

  // Delete shipments
  await supabase.from('shipments').delete().gte('id', '00000000-0000-0000-0000-000000000000');

  // Delete chronicle
  await supabase.from('chronicle').delete().gte('id', '00000000-0000-0000-0000-000000000000');

  console.log('[Setup] All data deleted');
}

// ============================================================================
// PDF EXTRACTION (with logging)
// ============================================================================

async function extractPdfText(
  buffer: Buffer,
  filename: string,
  logger: ChronicleLogger
): Promise<string> {
  const startTime = logger.logStageStart('pdf_extract');

  try {
    // Try pdf-parse first
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);

    if (data.text && data.text.trim().length > 100) {
      logger.logStageSuccess('pdf_extract', startTime, { text_extract: 1 });
      return data.text;
    }

    // Fall back to OCR
    return await extractWithOcr(buffer, filename, logger, startTime);
  } catch (error) {
    // Fall back to OCR on parse error
    console.log(`[PDF] Parse failed for ${filename}, trying OCR...`);
    return await extractWithOcr(buffer, filename, logger, startTime);
  }
}

async function extractWithOcr(
  buffer: Buffer,
  filename: string,
  logger: ChronicleLogger,
  startTime: number
): Promise<string> {
  try {
    const { execSync } = require('child_process');
    const os = require('os');
    const crypto = require('crypto');
    const Tesseract = require('tesseract.js');

    const tmpDir = os.tmpdir();
    const id = crypto.randomBytes(8).toString('hex');
    const pdfPath = path.join(tmpDir, `ocr-${id}.pdf`);
    const pngPrefix = path.join(tmpDir, `ocr-${id}`);

    fs.writeFileSync(pdfPath, buffer);

    // Convert PDF to images
    execSync(`pdftocairo -png -r 200 "${pdfPath}" "${pngPrefix}"`, {
      timeout: 30000,
    });

    // Find generated images
    const images = fs.readdirSync(tmpDir).filter((f: string) => f.startsWith(`ocr-${id}`) && f.endsWith('.png'));

    let text = '';
    for (const img of images) {
      const imgPath = path.join(tmpDir, img);
      const result = await Tesseract.recognize(imgPath, 'eng');
      text += result.data.text + '\n';
      fs.unlinkSync(imgPath);
    }

    fs.unlinkSync(pdfPath);

    console.log(`[OCR] Extracted ${text.length} chars from ${images.length} pages: ${filename}`);
    logger.logStageSuccess('pdf_extract', startTime, { ocr_count: 1, ocr_pages: images.length });

    return text;
  } catch (error) {
    logger.logStageFailure('ocr_extract', startTime, error as Error, { attachmentName: filename }, true);
    return '';
  }
}

// ============================================================================
// AI ANALYSIS (with logging)
// ============================================================================

async function analyzeWithAi(
  email: ProcessedEmail,
  attachmentText: string,
  logger: ChronicleLogger
): Promise<Record<string, unknown> | null> {
  const startTime = logger.logStageStart('ai_analysis');

  try {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic.default();

    const prompt = buildAiPrompt(email, attachmentText);

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type');
    }

    // Parse JSON from response
    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }

    const analysis = JSON.parse(jsonMatch[0]);
    logger.logStageSuccess('ai_analysis', startTime);

    return analysis;
  } catch (error) {
    logger.logStageFailure(
      'ai_analysis',
      startTime,
      error as Error,
      {
        gmailMessageId: email.gmailMessageId,
        subject: email.subject,
        sender: email.senderEmail,
      },
      true
    );
    return null;
  }
}

function buildAiPrompt(email: ProcessedEmail, attachmentText: string): string {
  return `You are a freight forwarding document analyst. Analyze this email and extract shipping intelligence.

EMAIL:
From: ${email.senderEmail}
Subject: ${email.subject}
Body: ${email.bodyText?.substring(0, 3000) || '(no body)'}

${attachmentText ? `ATTACHMENT TEXT:\n${attachmentText.substring(0, 3000)}` : ''}

Extract the following fields as JSON:
{
  "transport_mode": "ocean|air|road|rail|multimodal|unknown",
  "booking_number": "PURE NUMERIC ONLY (e.g., 2038256270) or null",
  "mbl_number": "CARRIER PREFIX + DIGITS (e.g., MAEU261683714) or null",
  "hbl_number": "string or null",
  "container_numbers": ["array of container numbers (4 letters + 7 digits)"],
  "work_order_number": "SEINUS* pattern or null",
  "reference_numbers": ["array of PO/reference numbers"],
  "document_type": "booking_confirmation|booking_request|shipping_instructions|draft_bl|final_bl|arrival_notice|delivery_order|pod_proof_of_delivery|invoice|work_order|rate_request|general_correspondence|unknown",
  "from_party": "ocean_carrier|trucker|nvocc|customs_broker|shipper|consignee|customer|intoglo|unknown",
  "vessel_name": "string or null",
  "voyage_number": "string or null",
  "carrier_name": "string or null",
  "etd": "YYYY-MM-DD or null",
  "eta": "YYYY-MM-DD or null",
  "pol_location": "port of loading or null",
  "pod_location": "port of discharge or null",
  "message_type": "confirmation|request|update|action_required|issue_reported|notification|unknown",
  "sentiment": "positive|neutral|negative|urgent",
  "summary": "one sentence summary (max 150 chars)",
  "has_action": true/false,
  "action_description": "what action is needed or null",
  "action_owner": "operations|documentation|finance|customer|carrier|trucker|broker|null",
  "action_deadline": "YYYY-MM-DD or null",
  "action_priority": "low|medium|high|critical|null",
  "has_issue": true/false,
  "issue_type": "delay|hold|damage|shortage|documentation|payment|capacity|rollover|detention|demurrage|other|null",
  "issue_description": "description of issue or null",
  "shipper_name": "shipper company name or null",
  "consignee_name": "consignee company name or null"
}

Return ONLY valid JSON, no markdown or explanation.`;
}

// ============================================================================
// DATABASE SAVE (with logging)
// ============================================================================

async function saveToChronicle(
  email: ProcessedEmail,
  analysis: Record<string, unknown>,
  logger: ChronicleLogger
): Promise<string | null> {
  const startTime = logger.logStageStart('db_save');

  try {
    const { data, error } = await supabase
      .from('chronicle')
      .insert({
        gmail_message_id: email.gmailMessageId,
        thread_id: email.threadId,
        direction: email.direction,
        from_party: analysis.from_party || 'unknown',
        from_address: email.senderEmail,
        transport_mode: analysis.transport_mode || 'unknown',
        booking_number: analysis.booking_number || null,
        mbl_number: analysis.mbl_number || null,
        hbl_number: analysis.hbl_number || null,
        container_numbers: analysis.container_numbers || [],
        work_order_number: analysis.work_order_number || null,
        reference_numbers: analysis.reference_numbers || [],
        document_type: analysis.document_type || 'unknown',
        vessel_name: analysis.vessel_name || null,
        voyage_number: analysis.voyage_number || null,
        carrier_name: analysis.carrier_name || null,
        origin_location: analysis.pol_location || null,
        destination_location: analysis.pod_location || null,
        etd: analysis.etd || null,
        eta: analysis.eta || null,
        message_type: analysis.message_type || 'unknown',
        sentiment: analysis.sentiment || 'neutral',
        summary: analysis.summary || 'No summary',
        has_action: analysis.has_action || false,
        action_description: analysis.action_description || null,
        action_owner: analysis.action_owner || null,
        action_deadline: analysis.action_deadline || null,
        action_priority: analysis.action_priority || null,
        has_issue: analysis.has_issue || false,
        issue_type: analysis.issue_type || null,
        issue_description: analysis.issue_description || null,
        subject: email.subject,
        snippet: email.snippet,
        body_preview: email.bodyText?.substring(0, 500) || '',
        attachments: email.attachments,
        ai_response: analysis,
        ai_model: 'claude-sonnet-4-20250514',
        occurred_at: email.receivedAt.toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      throw error;
    }

    logger.logStageSuccess('db_save', startTime);
    return data.id;
  } catch (error) {
    logger.logStageFailure(
      'db_save',
      startTime,
      error as Error,
      {
        gmailMessageId: email.gmailMessageId,
        subject: email.subject,
      },
      false
    );
    return null;
  }
}

// ============================================================================
// SHIPMENT LINKING & STAGE TRACKING
// ============================================================================

async function linkAndTrackShipment(
  chronicleId: string,
  analysis: Record<string, unknown>,
  email: ProcessedEmail,
  logger: ChronicleLogger
): Promise<void> {
  const startTime = logger.logStageStart('linking');

  try {
    // Try to find existing shipment
    let shipment = await findExistingShipment(analysis);

    if (shipment) {
      // Link chronicle to shipment
      await supabase
        .from('chronicle')
        .update({ shipment_id: shipment.id, linked_by: 'auto', linked_at: new Date().toISOString() })
        .eq('id', chronicleId);

      logger.logEmailLinked(shipment.id);

      // Check for stage progression
      const newStage = ChronicleLogger.detectShipmentStage(analysis.document_type as string);
      const currentStage = shipment.stage as ShipmentStage || 'PENDING';

      if (ChronicleLogger.isStageProgression(currentStage, newStage)) {
        await supabase
          .from('shipments')
          .update({ stage: newStage, stage_updated_at: new Date().toISOString() })
          .eq('id', shipment.id);

        logger.logStageChange(
          shipment.id,
          chronicleId,
          currentStage,
          newStage,
          analysis.document_type as string,
          email.receivedAt
        );
      }
    } else {
      // Create new shipment if we have identifiers
      if (analysis.booking_number || analysis.mbl_number || analysis.work_order_number) {
        const newShipment = await createShipment(analysis, email);
        if (newShipment) {
          await supabase
            .from('chronicle')
            .update({ shipment_id: newShipment.id, linked_by: 'created', linked_at: new Date().toISOString() })
            .eq('id', chronicleId);

          logger.logEmailLinked(newShipment.id);
          logger.logShipmentCreated(
            newShipment.id,
            chronicleId,
            analysis.document_type as string,
            email.receivedAt
          );
        }
      }
    }

    // Log actions and issues
    if (analysis.has_action && analysis.action_description) {
      const shipmentId = shipment?.id || (await getChronicleShipmentId(chronicleId));
      if (shipmentId) {
        logger.logActionDetected(
          shipmentId,
          chronicleId,
          analysis.action_owner as string | null,
          analysis.action_deadline as string | null,
          analysis.action_priority as string | null,
          analysis.action_description as string,
          analysis.document_type as string,
          email.receivedAt
        );
      }
    }

    if (analysis.has_issue && analysis.issue_type) {
      const shipmentId = shipment?.id || (await getChronicleShipmentId(chronicleId));
      if (shipmentId) {
        logger.logIssueDetected(
          shipmentId,
          chronicleId,
          analysis.issue_type as string,
          analysis.issue_description as string || '',
          analysis.document_type as string,
          email.receivedAt
        );
      }
    }

    logger.logStageSuccess('linking', startTime);
  } catch (error) {
    logger.logStageFailure('linking', startTime, error as Error, { gmailMessageId: email.gmailMessageId }, true);
  }
}

async function findExistingShipment(analysis: Record<string, unknown>): Promise<{ id: string; stage: string } | null> {
  // Try booking number
  if (analysis.booking_number) {
    const { data } = await supabase
      .from('shipments')
      .select('id, stage')
      .eq('booking_number', analysis.booking_number)
      .limit(1)
      .single();
    if (data) return data;
  }

  // Try MBL
  if (analysis.mbl_number) {
    const { data } = await supabase
      .from('shipments')
      .select('id, stage')
      .eq('mbl_number', analysis.mbl_number)
      .limit(1)
      .single();
    if (data) return data;
  }

  // Try SEINUS/work order
  if (analysis.work_order_number) {
    const { data } = await supabase
      .from('shipments')
      .select('id, stage')
      .eq('intoglo_reference', analysis.work_order_number)
      .limit(1)
      .single();
    if (data) return data;
  }

  return null;
}

async function createShipment(analysis: Record<string, unknown>, email: ProcessedEmail): Promise<{ id: string } | null> {
  const stage = ChronicleLogger.detectShipmentStage(analysis.document_type as string);

  const { data, error } = await supabase
    .from('shipments')
    .insert({
      booking_number: analysis.booking_number || null,
      mbl_number: analysis.mbl_number || null,
      bl_number: analysis.mbl_number || null,
      intoglo_reference: analysis.work_order_number || null,
      container_number_primary: (analysis.container_numbers as string[])?.[0] || null,
      vessel_name: analysis.vessel_name || null,
      voyage_number: analysis.voyage_number || null,
      carrier_name: analysis.carrier_name || null,
      etd: analysis.etd || null,
      eta: analysis.eta || null,
      stage,
      stage_updated_at: new Date().toISOString(),
      status: 'draft',
    })
    .select('id')
    .single();

  if (error) {
    console.error('[Shipment] Create error:', error.message);
    return null;
  }

  return data;
}

async function getChronicleShipmentId(chronicleId: string): Promise<string | null> {
  const { data } = await supabase
    .from('chronicle')
    .select('shipment_id')
    .eq('id', chronicleId)
    .single();
  return data?.shipment_id || null;
}

// ============================================================================
// MAIN PROCESSING
// ============================================================================

async function processEmail(
  email: ProcessedEmail,
  gmailService: ChronicleGmailService,
  logger: ChronicleLogger
): Promise<boolean> {
  // Check if already processed
  const { data: existing } = await supabase
    .from('chronicle')
    .select('id')
    .eq('gmail_message_id', email.gmailMessageId)
    .single();

  if (existing) {
    logger.logEmailProcessed(true, true);
    return true;
  }

  // Extract PDF attachments
  let attachmentText = '';
  for (const attachment of email.attachments) {
    if (attachment.mimeType === 'application/pdf' && attachment.attachmentId) {
      try {
        const content = await gmailService.fetchAttachmentContent(email.gmailMessageId, attachment.attachmentId);
        if (content) {
          const text = await extractPdfText(content, attachment.filename, logger);
          attachmentText += text + '\n';
        }
      } catch (error) {
        console.error(`[PDF] Failed to fetch attachment ${attachment.filename}`);
      }
    }
  }

  // AI Analysis
  const analysis = await analyzeWithAi(email, attachmentText, logger);
  if (!analysis) {
    logger.logEmailProcessed(false);
    return false;
  }

  // Save to database
  const chronicleId = await saveToChronicle(email, analysis, logger);
  if (!chronicleId) {
    logger.logEmailProcessed(false);
    return false;
  }

  // Link to shipment and track stage
  await linkAndTrackShipment(chronicleId, analysis, email, logger);

  logger.logEmailProcessed(true);
  return true;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('  CHRONICLE FULL PROCESSING');
  console.log('='.repeat(70) + '\n');

  const args = parseArgs();

  // Run migration
  await runMigration();

  // Delete data if fresh start
  if (args.fresh) {
    await deleteAllData();
  }

  // Initialize Gmail service
  let gmailService: ChronicleGmailService;
  try {
    gmailService = createChronicleGmailService();
    const connected = await gmailService.testConnection();
    if (!connected) {
      throw new Error('Gmail connection failed');
    }
  } catch (error) {
    console.error('[Setup] Gmail service error:', error);
    process.exit(1);
  }

  // Calculate date range
  const queryAfter = new Date(Date.now() - args.days * 24 * 60 * 60 * 1000);

  console.log(`[Setup] Fetching emails from last ${args.days} days...`);

  // Fetch emails
  const emails = await gmailService.fetchEmailsByTimestamp({
    after: queryAfter,
    maxResults: args.maxResults,
  });

  console.log(`[Setup] Found ${emails.length} emails to process\n`);

  // Initialize logger
  const logger = new ChronicleLogger(supabase);
  const runId = await logger.startRun({
    queryAfter,
    maxResults: args.maxResults,
    emailsTotal: emails.length,
  });

  // Process emails
  try {
    for (let i = 0; i < emails.length; i++) {
      const email = emails[i];

      try {
        await processEmail(email, gmailService, logger);
      } catch (error) {
        console.error(`[Error] Processing ${email.gmailMessageId}:`, (error as Error).message);
        logger.logEmailProcessed(false);
      }

      // Check for progress report
      await logger.checkAndReportProgress();
    }

    // Final progress report
    await logger.checkAndReportProgress(true);
    await logger.endRun('completed');
  } catch (error) {
    console.error('[Fatal]', error);
    await logger.endRun('failed');
    process.exit(1);
  }

  // Show final shipment stages
  await showShipmentStages();
}

async function showShipmentStages(): Promise<void> {
  const { data: stages } = await supabase
    .from('shipments')
    .select('stage');

  const counts: Record<string, number> = {};
  for (const s of stages || []) {
    counts[s.stage || 'UNKNOWN'] = (counts[s.stage || 'UNKNOWN'] || 0) + 1;
  }

  const order = ['PENDING', 'REQUESTED', 'BOOKED', 'SI_STAGE', 'DRAFT_BL', 'BL_ISSUED', 'ARRIVED', 'DELIVERED'];

  console.log('\n' + '='.repeat(70));
  console.log('  SHIPMENT STAGE DISTRIBUTION');
  console.log('='.repeat(70));

  for (const stage of order) {
    const count = counts[stage] || 0;
    if (count > 0) {
      const bar = '█'.repeat(Math.min(count, 40));
      console.log(`  ${stage.padEnd(12)} ${bar} ${count}`);
    }
  }

  console.log('='.repeat(70) + '\n');
}

// ============================================================================
// RUN
// ============================================================================

main()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
