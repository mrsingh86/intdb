/**
 * Backfill Script: Process 1 Month of Emails
 *
 * Steps:
 * 1. Fetch emails from last 30 days
 * 2. Classify all emails
 * 3. Extract entities
 * 4. Link to shipments
 *
 * Cost estimate: ~$0.002 per email (using Claude Haiku)
 */

import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import Anthropic from '@anthropic-ai/sdk';
import GmailClient from '../utils/gmail-client';
import { supabase } from '../utils/supabase-client';

dotenv.config();

const LOOKBACK_DAYS = 30;
const HAIKU_MODEL = 'claude-3-5-haiku-20241022';
const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_CLASSIFICATION = process.argv.includes('--skip-classification');
const TEST_MODE = process.argv.includes('--test');
const TEST_LIMIT = 10; // Only process 10 emails in test mode

interface Stats {
  emailsFetched: number;
  emailsStored: number;
  emailsClassified: number;
  entitiesExtracted: number;
  attachmentsSaved: number;
  errors: string[];
  cost: number;
}

const stats: Stats = {
  emailsFetched: 0,
  emailsStored: 0,
  emailsClassified: 0,
  entitiesExtracted: 0,
  attachmentsSaved: 0,
  errors: [],
  cost: 0,
};

async function main() {
  console.log('='.repeat(60));
  console.log('EMAIL BACKFILL - LAST 30 DAYS');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : TEST_MODE ? 'TEST (10 emails)' : 'LIVE'}`);
  console.log(`Lookback: ${LOOKBACK_DAYS} days`);
  console.log('');

  // Initialize Gmail client
  const gmailClient = new GmailClient({
    client_id: process.env.GMAIL_CLIENT_ID!,
    client_secret: process.env.GMAIL_CLIENT_SECRET!,
    redirect_uri: process.env.GMAIL_REDIRECT_URI!,
    refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
  });

  // Step 1: Count and fetch emails
  console.log('STEP 1: Fetching emails from Gmail...');
  const emails = await fetchEmails(gmailClient);
  stats.emailsFetched = emails.length;
  console.log(`  Found ${emails.length} emails`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would process these emails:');
    emails.slice(0, 10).forEach((e, i) => {
      console.log(`  ${i + 1}. ${e.subject?.slice(0, 60)}...`);
    });
    if (emails.length > 10) {
      console.log(`  ... and ${emails.length - 10} more`);
    }

    const estimatedCost = emails.length * 0.002;
    console.log(`\nEstimated cost: $${estimatedCost.toFixed(2)}`);
    console.log('Run without --dry-run to process');
    return;
  }

  // Step 2: Store emails and attachments in database
  console.log('\nSTEP 2: Storing emails and attachments in database...');
  for (const email of emails) {
    try {
      const emailId = await storeEmail(email);
      stats.emailsStored++;

      // Save attachments if any (same logic as EmailIngestionAgent)
      if (email.attachments && email.attachments.length > 0 && emailId) {
        const saved = await saveAttachments(emailId, email.gmailMessageId, email.attachments);
        stats.attachmentsSaved += saved;
      }

      process.stdout.write('.');
    } catch (err: any) {
      if (!err.message?.includes('duplicate')) {
        stats.errors.push(`Store ${email.id}: ${err.message}`);
      }
    }
  }
  console.log(`\n  Stored ${stats.emailsStored} emails, ${stats.attachmentsSaved} attachments`);

  // Step 3: Classify emails
  if (!SKIP_CLASSIFICATION) {
    console.log('\nSTEP 3: Classifying emails...');
    await classifyEmails();
    console.log(`  Classified ${stats.emailsClassified} emails`);
  }

  // Step 4: Extract entities
  console.log('\nSTEP 4: Extracting entities...');
  await extractEntities();
  console.log(`  Extracted entities from ${stats.entitiesExtracted} emails`);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('BACKFILL COMPLETE');
  console.log('='.repeat(60));
  console.log(`Emails fetched: ${stats.emailsFetched}`);
  console.log(`Emails stored: ${stats.emailsStored}`);
  console.log(`Attachments saved: ${stats.attachmentsSaved}`);
  console.log(`Emails classified: ${stats.emailsClassified}`);
  console.log(`Entities extracted: ${stats.entitiesExtracted}`);
  console.log(`Estimated cost: $${stats.cost.toFixed(4)}`);

  if (stats.errors.length > 0) {
    console.log(`\nErrors (${stats.errors.length}):`);
    stats.errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
  }
}

async function fetchEmails(gmailClient: GmailClient): Promise<any[]> {
  const afterDate = new Date();
  afterDate.setDate(afterDate.getDate() - LOOKBACK_DAYS);
  const dateStr = afterDate.toISOString().split('T')[0];

  // Query for shipping-related emails (INCOMING + OUTGOING)
  const queries = [
    // === CARRIERS (incoming) ===
    `from:maersk.com after:${dateStr}`,
    `from:hapag-lloyd.com after:${dateStr}`,
    `from:hapag after:${dateStr}`,
    `from:hlag.com after:${dateStr}`,
    `from:msc.com after:${dateStr}`,
    `from:cma-cgm.com after:${dateStr}`,
    `from:one-line.com after:${dateStr}`,
    `from:evergreen-line.com after:${dateStr}`,
    `from:oocl.com after:${dateStr}`,
    `from:yangming.com after:${dateStr}`,
    `from:zim.com after:${dateStr}`,

    // === SUBJECT-BASED (both directions) ===
    `subject:"booking confirmation" after:${dateStr}`,
    `subject:"booking conf" after:${dateStr}`,
    `subject:"shipping instruction" after:${dateStr}`,
    `subject:"SI draft" after:${dateStr}`,
    `subject:"bill of lading" after:${dateStr}`,
    `subject:"B/L" after:${dateStr}`,
    `subject:"HBL" after:${dateStr}`,
    `subject:"MBL" after:${dateStr}`,
    `subject:"packing list" after:${dateStr}`,
    `subject:"commercial invoice" after:${dateStr}`,
    `subject:"arrival notice" after:${dateStr}`,
    `subject:"delivery order" after:${dateStr}`,
    `subject:"customs clearance" after:${dateStr}`,
    `subject:"VGM" after:${dateStr}`,

    // === OUTGOING - Sent folder ===
    `in:sent subject:"booking" after:${dateStr}`,
    `in:sent subject:"shipment" after:${dateStr}`,
    `in:sent subject:"BL" after:${dateStr}`,
    `in:sent subject:"invoice" after:${dateStr}`,
    `in:sent subject:"packing" after:${dateStr}`,

    // === PARTNERS (CHA, Customs Broker, Trucker) ===
    `subject:"customs" after:${dateStr}`,
    `subject:"CHA" after:${dateStr}`,
    `subject:"duty" after:${dateStr}`,
    `subject:"clearance" after:${dateStr}`,
    `subject:"transport" after:${dateStr}`,
    `subject:"pickup" after:${dateStr}`,
    `subject:"delivery" after:${dateStr}`,
    `subject:"container" after:${dateStr}`,

    // === BOOKING NUMBERS (catch specific shipment threads) ===
    `subject:MAEU after:${dateStr}`,
    `subject:HLCU after:${dateStr}`,
    `subject:MSCU after:${dateStr}`,
    `subject:CMAU after:${dateStr}`,
    `subject:ONEY after:${dateStr}`,
  ];

  const allMessageIds = new Set<string>();

  for (const query of queries) {
    try {
      // Paginate through ALL results for each query
      let pageToken: string | undefined;
      let queryTotal = 0;

      do {
        const result = await gmailClient.listMessages(query, 100, pageToken);
        result.messages?.forEach((id: string) => {
          allMessageIds.add(id);
          queryTotal++;
        });
        pageToken = result.nextPageToken;
      } while (pageToken);

      if (queryTotal > 100) {
        console.log(`    ${query.slice(0, 40)}... → ${queryTotal} emails (paginated)`);
      }
    } catch (err) {
      console.log(`  Query failed: ${query}`);
    }
  }

  console.log(`  Found ${allMessageIds.size} unique message IDs (with full pagination)`);

  // Fetch full email data
  const emails: any[] = [];
  let messageIds = Array.from(allMessageIds);

  // Limit in test mode
  if (TEST_MODE) {
    messageIds = messageIds.slice(0, TEST_LIMIT);
    console.log(`  [TEST MODE] Limited to ${TEST_LIMIT} emails`);
  }

  for (let i = 0; i < messageIds.length; i++) {
    try {
      const email = await gmailClient.getMessage(messageIds[i]);
      emails.push(email);

      if ((i + 1) % 50 === 0) {
        console.log(`  Fetched ${i + 1}/${messageIds.length} emails`);
      }
    } catch (err) {
      // Skip failed fetches
    }
  }

  return emails;
}

async function storeEmail(email: any): Promise<string | null> {
  // GmailClient returns parsed EmailData with these fields:
  // gmailMessageId, threadId, senderEmail, senderName, recipientEmails,
  // subject, bodyText, bodyHtml, snippet, headers, hasAttachments, labels, receivedAt

  // Match exact schema from EmailIngestionAgent.saveEmail()
  const emailRecord = {
    gmail_message_id: email.gmailMessageId,
    thread_id: email.threadId || null,
    sender_email: email.senderEmail || '',
    sender_name: email.senderName || null,
    true_sender_email: email.trueSenderEmail || null,
    recipient_emails: email.recipientEmails || [],
    subject: email.subject || '(no subject)',
    body_text: email.bodyText || null,
    body_html: email.bodyHtml || null,
    snippet: email.snippet || null,
    headers: email.headers || {},
    has_attachments: email.hasAttachments || false,
    attachment_count: email.attachmentCount || 0,
    labels: email.labels || [],
    received_at: email.receivedAt instanceof Date
      ? email.receivedAt.toISOString()
      : new Date().toISOString(),
    processing_status: 'pending',
  };

  // Try to insert, get existing if duplicate
  const { data, error } = await supabase
    .from('raw_emails')
    .upsert(emailRecord, { onConflict: 'gmail_message_id' })
    .select('id')
    .single();

  if (error && !error.message.includes('duplicate')) {
    throw error;
  }

  // If upsert returned data, use it; otherwise fetch by gmail_message_id
  if (data?.id) {
    return data.id;
  }

  // Fetch existing record ID
  const { data: existing } = await supabase
    .from('raw_emails')
    .select('id')
    .eq('gmail_message_id', email.gmailMessageId)
    .single();

  return existing?.id || null;
}

/**
 * Save attachments to raw_attachments table
 * Same logic as EmailIngestionAgent.saveAttachments()
 */
async function saveAttachments(
  emailId: string,
  gmailMessageId: string,
  attachments: any[]
): Promise<number> {
  let savedCount = 0;

  for (const attachment of attachments) {
    try {
      const storagePath = `gmail://${gmailMessageId}/${attachment.attachmentId}`;

      const attachmentRecord = {
        email_id: emailId,
        filename: (attachment.filename || 'unknown').substring(0, 200),
        mime_type: (attachment.mimeType || 'application/octet-stream').substring(0, 100),
        size_bytes: attachment.sizeBytes || attachment.size || 0,
        storage_path: storagePath.substring(0, 500),
        attachment_id: (attachment.attachmentId || '').substring(0, 500),
        extraction_status: 'pending',
      };

      const { error } = await supabase
        .from('raw_attachments')
        .insert(attachmentRecord);

      if (error) {
        // Skip duplicates silently
        if (error.code !== '23505') {
          console.log(`    Attachment error: ${error.message}`);
        }
      } else {
        savedCount++;
      }
    } catch (err: any) {
      // Log but continue with other attachments
      console.log(`    Attachment failed: ${err.message}`);
    }
  }

  return savedCount;
}

async function classifyEmails(): Promise<void> {
  const anthropic = new Anthropic();

  // Get ALL unclassified emails with pagination
  let allEmails: any[] = [];
  let offset = 0;
  const batchSize = 500;

  while (true) {
    const { data: batch } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email, body_text, snippet')
      .eq('processing_status', 'pending')
      .range(offset, offset + batchSize - 1);

    if (!batch || batch.length === 0) break;
    allEmails = allEmails.concat(batch);
    offset += batchSize;
    if (batch.length < batchSize) break;
  }

  if (allEmails.length === 0) {
    console.log('  No emails to classify');
    return;
  }

  console.log(`  Classifying ${allEmails.length} emails...`);

  for (const email of allEmails) {
    try {
      const classification = await classifyEmail(anthropic, email);

      if (classification) {
        // Store classification
        await supabase.from('document_classifications').insert({
          id: uuidv4(),
          email_id: email.id,
          document_type: classification.type,
          confidence_score: classification.confidence,
          classification_method: 'ai_backfill',
          model_name: HAIKU_MODEL,
        });

        // Update email status
        await supabase
          .from('raw_emails')
          .update({ processing_status: 'classified' })
          .eq('id', email.id);

        stats.emailsClassified++;
        stats.cost += 0.0008; // Estimated classification cost
        process.stdout.write('.');
      }
    } catch (err: any) {
      stats.errors.push(`Classify ${email.id}: ${err.message}`);
    }
  }
  console.log('');
}

async function classifyEmail(anthropic: Anthropic, email: any): Promise<{ type: string; confidence: number } | null> {
  const prompt = `Classify this shipping email into ONE of these document types:
- booking_confirmation
- shipping_instruction (SI)
- bill_of_lading (BL/HBL/MBL)
- packing_list
- commercial_invoice
- arrival_notice
- delivery_order
- customs_clearance
- rate_notification
- vessel_schedule
- amendment_notice
- general_correspondence

Email:
Subject: ${email.subject}
From: ${email.sender_email}
Content: ${(email.body_text || email.snippet || '').slice(0, 2000)}

Respond with JSON only: {"type": "document_type", "confidence": 85}`;

  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 100,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const match = text.match(/\{[^}]+\}/);

  if (match) {
    return JSON.parse(match[0]);
  }
  return null;
}

async function extractEntities(): Promise<void> {
  const anthropic = new Anthropic();

  // Get ALL classified emails that need entity extraction with pagination
  let allClassifications: any[] = [];
  let offset = 0;
  const batchSize = 500;

  while (true) {
    const { data: batch } = await supabase
      .from('document_classifications')
      .select(`
        id,
        email_id,
        document_type,
        raw_emails!inner(id, subject, body_text, snippet)
      `)
      .in('document_type', ['booking_confirmation', 'shipping_instruction', 'bill_of_lading', 'packing_list', 'arrival_notice'])
      .range(offset, offset + batchSize - 1);

    if (!batch || batch.length === 0) break;
    allClassifications = allClassifications.concat(batch);
    offset += batchSize;
    if (batch.length < batchSize) break;
  }

  if (allClassifications.length === 0) {
    console.log('  No emails to extract');
    return;
  }

  console.log(`  Extracting from ${allClassifications.length} emails...`);

  for (const cls of allClassifications) {
    try {
      // Check if already extracted
      const { count } = await supabase
        .from('entity_extractions')
        .select('id', { count: 'exact', head: true })
        .eq('classification_id', cls.id);

      if (count && count > 0) continue;

      const email = (cls as any).raw_emails;
      const entities = await extractEmailEntities(anthropic, email, cls.document_type);

      if (entities && entities.length > 0) {
        const records = entities.map((e: any) => ({
          id: uuidv4(),
          email_id: cls.email_id,
          classification_id: cls.id,
          entity_type: e.type,
          entity_value: e.value,
          confidence_score: e.confidence || 90,
          extraction_method: 'ai_backfill',
          source_document_type: cls.document_type,
          is_from_latest_revision: true,
        }));

        await supabase.from('entity_extractions').insert(records);
        stats.entitiesExtracted++;
        stats.cost += 0.0014; // Estimated extraction cost
        process.stdout.write('.');
      }
    } catch (err: any) {
      stats.errors.push(`Extract ${cls.id}: ${err.message}`);
    }
  }
  console.log('');
}

async function extractEmailEntities(anthropic: Anthropic, email: any, docType: string): Promise<any[]> {
  const fieldsToExtract = getFieldsForDocType(docType);

  const prompt = `Extract these fields from the shipping email:
${fieldsToExtract.map(f => `- ${f}`).join('\n')}

Email:
Subject: ${email.subject}
Content: ${(email.body_text || email.snippet || '').slice(0, 3000)}

Respond with JSON array only: [{"type": "field_name", "value": "extracted_value", "confidence": 90}]
Only include fields you can confidently extract.`;

  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const match = text.match(/\[[\s\S]*\]/);

  if (match) {
    return JSON.parse(match[0]);
  }
  return [];
}

function getFieldsForDocType(docType: string): string[] {
  const fields: Record<string, string[]> = {
    booking_confirmation: ['booking_number', 'vessel_name', 'voyage_number', 'port_of_loading', 'port_of_discharge', 'etd', 'eta', 'cargo_cutoff', 'si_cutoff'],
    shipping_instruction: ['booking_number', 'shipper_name', 'consignee_name', 'notify_party', 'cargo_description', 'gross_weight', 'container_count'],
    bill_of_lading: ['bl_number', 'booking_number', 'shipper_name', 'consignee_name', 'vessel_name', 'port_of_loading', 'port_of_discharge'],
    packing_list: ['invoice_number', 'total_packages', 'gross_weight', 'net_weight', 'cargo_description', 'dimensions'],
    arrival_notice: ['bl_number', 'vessel_name', 'eta', 'port_of_discharge', 'container_numbers', 'free_time_expiry'],
  };
  return fields[docType] || ['booking_number', 'vessel_name', 'eta'];
}

// Helper functions
function extractEmail(str: string): string {
  const match = str.match(/<([^>]+)>/) || str.match(/([^\s<]+@[^\s>]+)/);
  return match ? match[1] : str;
}

function extractName(str: string): string {
  const match = str.match(/^([^<]+)</);
  return match ? match[1].trim().replace(/"/g, '') : '';
}

function extractBody(email: any): string {
  const parts = email.payload?.parts || [];
  for (const part of parts) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
  }
  if (email.payload?.body?.data) {
    return Buffer.from(email.payload.body.data, 'base64').toString('utf-8');
  }
  return '';
}

function extractBodyHtml(email: any): string {
  const parts = email.payload?.parts || [];
  for (const part of parts) {
    if (part.mimeType === 'text/html' && part.body?.data) {
      return Buffer.from(part.body.data, 'base64').toString('utf-8');
    }
  }
  return '';
}

main().catch(console.error);
