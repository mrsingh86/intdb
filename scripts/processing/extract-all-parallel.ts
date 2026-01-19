/**
 * Parallel Entity Extraction
 *
 * Fast, parallel extraction of entities from ALL emails.
 * - Runs multiple concurrent workers
 * - Creates shipments when booking found but no shipment exists
 * - Links emails to shipments
 * - Extracts from both email body and attachments
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx scripts/extract-all-parallel.ts
 *
 * Environment:
 *   CONCURRENCY     - Parallel workers (default: 5)
 *   MAX_TOTAL       - Max emails to process (default: all)
 *   START_OFFSET    - Start from offset (default: 0)
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Configuration
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '5');
const MAX_TOTAL = parseInt(process.env.MAX_TOTAL || '0') || null;
const START_OFFSET = parseInt(process.env.START_OFFSET || '0');
const ONLY_UNLINKED = process.env.ONLY_UNLINKED === 'true';

interface Stats {
  totalToProcess: number;
  processed: number;
  successful: number;
  failed: number;
  skipped: number;
  entitiesExtracted: number;
  shipmentsCreated: number;
  shipmentsLinked: number;
  startTime: number;
}

const stats: Stats = {
  totalToProcess: 0,
  processed: 0,
  successful: 0,
  failed: 0,
  skipped: 0,
  entitiesExtracted: 0,
  shipmentsCreated: 0,
  shipmentsLinked: 0,
  startTime: Date.now()
};

// Mutex for shipment creation to prevent duplicates
const shipmentCreationLock = new Map<string, Promise<string | null>>();

/**
 * Get emails in two groups for two-phase processing.
 * Phase 1: booking_confirmations (create shipments)
 * Phase 2: everything else (link to shipments)
 *
 * If ONLY_UNLINKED=true, filters out emails already in shipment_documents
 */
async function getEmailsByPhase(): Promise<{
  bookingConfirmations: string[];
  otherEmails: string[];
}> {
  console.log('Fetching emails by phase...');
  if (ONLY_UNLINKED) {
    console.log('  Mode: ONLY_UNLINKED - skipping already linked emails');
  }

  // Get already linked email IDs if ONLY_UNLINKED mode
  const linkedEmailIds = new Set<string>();
  if (ONLY_UNLINKED) {
    let offset = 0;
    while (true) {
      const { data } = await supabase
        .from('shipment_documents')
        .select('email_id')
        .range(offset, offset + 999);
      if (!data || data.length === 0) break;
      data.forEach(d => linkedEmailIds.add(d.email_id));
      offset += 1000;
      if (data.length < 1000) break;
    }
    console.log(`  Already linked: ${linkedEmailIds.size} emails (will skip)`);
  }

  // Phase 1: Get booking_confirmations (these create shipments)
  const bookingConfirmations: string[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('document_classifications')
      .select('email_id')
      .eq('document_type', 'booking_confirmation')
      .range(offset, offset + 999);

    if (error) throw new Error(`Failed to fetch booking confirmations: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const e of data) {
      // Skip if already linked (when ONLY_UNLINKED mode)
      if (ONLY_UNLINKED && linkedEmailIds.has(e.email_id)) continue;
      bookingConfirmations.push(e.email_id);
    }
    offset += 1000;
    if (data.length < 1000) break;
  }

  console.log(`  Phase 1: ${bookingConfirmations.length} booking confirmations`);

  // Phase 2: Get all other emails
  const otherEmails: string[] = [];
  const bookingSet = new Set(bookingConfirmations);
  offset = 0;

  while (true) {
    const { data, error } = await supabase
      .from('raw_emails')
      .select('id')
      .order('received_at', { ascending: true })
      .range(offset, offset + 999);

    if (error) throw new Error(`Failed to fetch emails: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const e of data) {
      // Skip booking confirmations (handled in phase 1)
      if (bookingSet.has(e.id)) continue;
      // Skip if already linked (when ONLY_UNLINKED mode)
      if (ONLY_UNLINKED && linkedEmailIds.has(e.id)) continue;
      otherEmails.push(e.id);
    }
    offset += 1000;
    if (data.length < 1000) break;
  }

  console.log(`  Phase 2: ${otherEmails.length} other documents`);

  return { bookingConfirmations, otherEmails };
}

async function extractWithClaude(
  text: string,
  docType: string
): Promise<Array<{type: string, value: string, confidence?: number}>> {
  const prompt = `Extract shipping entities from this ${docType} email/document.

TEXT:
${text.substring(0, 8000)}

Extract these entities if present:
- booking_number (carrier booking reference like 262874542)
- bl_number (Master Bill of Lading like HLCUNBO250224897)
- hbl_number (House Bill of Lading, freight forwarder's B/L)
- container_number (like MRKU1234567)
- vessel_name (ship name)
- voyage_number (voyage ID)
- port_of_loading (origin port)
- port_of_discharge (destination port)
- etd (departure date YYYY-MM-DD)
- eta (arrival date YYYY-MM-DD)
- si_cutoff (SI deadline YYYY-MM-DD)
- vgm_cutoff (VGM deadline YYYY-MM-DD)
- cargo_cutoff (cargo deadline YYYY-MM-DD)
- shipper (shipper company)
- consignee (consignee company)
- carrier (shipping line name)

Return JSON array:
[{"type": "booking_number", "value": "262874542", "confidence": 0.95}]

Rules:
- Only confident values (>80%)
- Dates: YYYY-MM-DD format
- Return [] if none found`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0];
    if (content.type !== 'text') return [];

    const jsonMatch = content.text.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.filter((e: any) =>
      e.type && e.value && typeof e.value === 'string' && e.value.trim().length > 0
    );
  } catch {
    return [];
  }
}

/**
 * Find existing shipment or create new one.
 *
 * LINKING: Can link by booking_number, bl_number (MBL), hbl_number, OR container_number
 * - Container number is the common link between MBL, HBL, and shipment
 * - All four are valid references for linking emails to shipments
 *
 * CREATION: Only from booking_confirmation
 * - Booking confirmation is the sole authoritative source for shipment creation
 * - MBL, HBL, amendments, invoices should LINK only, not create
 */
async function findOrCreateShipment(
  bookingNumber: string | undefined,
  blNumber: string | undefined,
  hblNumber: string | undefined,
  containerNumber: string | undefined,
  entities: Array<{type: string, value: string}>,
  docType: string
): Promise<{ shipmentId: string | null, created: boolean }> {
  // Need at least one reference to link
  if (!bookingNumber && !blNumber && !hblNumber && !containerNumber) {
    return { shipmentId: null, created: false };
  }

  const key = bookingNumber || blNumber || hblNumber || containerNumber || '';

  // Check if creation already in progress for this key
  if (shipmentCreationLock.has(key)) {
    const id = await shipmentCreationLock.get(key)!;
    return { shipmentId: id, created: false };
  }

  const creationPromise = (async () => {
    // Try to find existing shipment by booking_number (most specific)
    if (bookingNumber) {
      const { data } = await supabase
        .from('shipments')
        .select('id')
        .eq('booking_number', bookingNumber)
        .single();
      if (data) return data.id;
    }

    // Try by bl_number (MBL)
    if (blNumber) {
      const { data } = await supabase
        .from('shipments')
        .select('id')
        .eq('bl_number', blNumber)
        .single();
      if (data) return data.id;
    }

    // Try by hbl_number (House B/L links to shipment, doesn't create)
    if (hblNumber) {
      const { data } = await supabase
        .from('shipments')
        .select('id')
        .eq('hbl_number', hblNumber)
        .single();
      if (data) return data.id;
    }

    // Try by container_number (common link between MBL, HBL, and shipment)
    // Container can link to shipment even if booking/BL not in this email
    if (containerNumber) {
      // First check container_number_primary
      const { data: primaryMatch } = await supabase
        .from('shipments')
        .select('id')
        .eq('container_number_primary', containerNumber)
        .single();
      if (primaryMatch) return primaryMatch.id;

      // Then check container_numbers array
      const { data: arrayMatch } = await supabase
        .from('shipments')
        .select('id')
        .contains('container_numbers', [containerNumber])
        .single();
      if (arrayMatch) return arrayMatch.id;
    }

    // No existing shipment found
    // Only create from booking_confirmation (sole authoritative source)
    const canCreate = docType === 'booking_confirmation';
    if (!canCreate) return null;

    if (!bookingNumber && !blNumber) return null; // Need at least one reference to create

    const shipmentData: any = {
      booking_number: bookingNumber,
      bl_number: blNumber || null,
      status: 'booked',
      created_at: new Date().toISOString()
    };

    // Add other fields from entities
    for (const e of entities) {
      switch (e.type) {
        case 'vessel_name': shipmentData.vessel_name = e.value; break;
        case 'voyage_number': shipmentData.voyage_number = e.value; break;
        case 'port_of_loading': shipmentData.port_of_loading = e.value; break;
        case 'port_of_discharge': shipmentData.port_of_discharge = e.value; break;
        case 'etd': shipmentData.etd = e.value; break;
        case 'eta': shipmentData.eta = e.value; break;
        case 'si_cutoff': shipmentData.si_cutoff = e.value; break;
        case 'vgm_cutoff': shipmentData.vgm_cutoff = e.value; break;
        case 'cargo_cutoff': shipmentData.cargo_cutoff = e.value; break;
        case 'carrier':
          // Try to find carrier in database
          const { data: carrier } = await supabase
            .from('carriers')
            .select('id')
            .ilike('name', `%${e.value}%`)
            .limit(1)
            .single();
          if (carrier) shipmentData.carrier_id = carrier.id;
          break;
      }
    }

    const { data: newShipment, error } = await supabase
      .from('shipments')
      .insert(shipmentData)
      .select('id')
      .single();

    if (error) {
      // Might be duplicate - try to find again
      if (bookingNumber) {
        const { data } = await supabase
          .from('shipments')
          .select('id')
          .eq('booking_number', bookingNumber)
          .single();
        if (data) return data.id;
      }
      return null;
    }

    stats.shipmentsCreated++;
    return newShipment?.id || null;
  })();

  shipmentCreationLock.set(key, creationPromise);
  const result = await creationPromise;
  shipmentCreationLock.delete(key);

  return result;
}

async function linkEmailToShipment(
  emailId: string,
  shipmentId: string,
  docType: string
): Promise<boolean> {
  // Check if already linked
  const { data: existing } = await supabase
    .from('shipment_documents')
    .select('id')
    .eq('shipment_id', shipmentId)
    .eq('email_id', emailId)
    .single();

  if (existing) return true;

  const { error } = await supabase
    .from('shipment_documents')
    .insert({
      shipment_id: shipmentId,
      email_id: emailId,
      document_type: docType,
      link_method: 'ai',
      created_at: new Date().toISOString()
    });

  return !error;
}

async function processEmail(emailId: string): Promise<void> {
  try {
    // Get email
    const { data: email } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email, body_text, snippet')
      .eq('id', emailId)
      .single();

    if (!email) {
      stats.failed++;
      return;
    }

    // Get classification
    const { data: classification } = await supabase
      .from('document_classifications')
      .select('document_type')
      .eq('email_id', emailId)
      .single();

    const docType = classification?.document_type || 'unknown';

    // Skip non-shipping
    if (docType === 'not_shipping' || docType === 'unknown') {
      stats.skipped++;
      return;
    }

    // Get attachment text
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('filename, extracted_text')
      .eq('email_id', emailId)
      .not('extracted_text', 'is', null);

    const attachmentText = attachments?.map(a => `[${a.filename}]\n${a.extracted_text}`).join('\n\n') || '';

    // Prepare text
    const fullText = [
      `Subject: ${email.subject || ''}`,
      `From: ${email.sender_email || ''}`,
      `Body: ${email.body_text || email.snippet || ''}`,
      attachmentText ? `\n--- ATTACHMENTS ---\n${attachmentText}` : ''
    ].join('\n');

    if (fullText.length < 50) {
      stats.skipped++;
      return;
    }

    // Extract entities
    const entities = await extractWithClaude(fullText, docType);

    if (entities.length === 0) {
      stats.skipped++;
      return;
    }

    // Delete old entities
    await supabase.from('entity_extractions').delete().eq('email_id', emailId);

    // Save new entities
    const entitiesToInsert = entities.map(e => ({
      email_id: emailId,
      entity_type: e.type,
      entity_value: e.value,
      confidence: e.confidence || 0.9,
      extraction_method: 'ai',
      source: 'email_body',
      created_at: new Date().toISOString()
    }));

    await supabase.from('entity_extractions').insert(entitiesToInsert);
    stats.entitiesExtracted += entities.length;

    // Find or create shipment (link by booking, MBL, HBL, or container)
    const bookingNumber = entities.find(e => e.type === 'booking_number')?.value;
    const blNumber = entities.find(e => e.type === 'bl_number')?.value;
    const hblNumber = entities.find(e => e.type === 'hbl_number')?.value;
    const containerNumber = entities.find(e => e.type === 'container_number')?.value;

    const { shipmentId, created } = await findOrCreateShipment(
      bookingNumber, blNumber, hblNumber, containerNumber, entities, docType
    );

    if (shipmentId) {
      const linked = await linkEmailToShipment(emailId, shipmentId, docType);
      if (linked) stats.shipmentsLinked++;
    }

    stats.successful++;

  } catch (error) {
    stats.failed++;
  }
}

function printProgress(): void {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const rate = stats.processed / elapsed;
  const remaining = (stats.totalToProcess - stats.processed) / rate;

  const percent = ((stats.processed / stats.totalToProcess) * 100).toFixed(1);
  const bar = '='.repeat(Math.floor(stats.processed / stats.totalToProcess * 40));
  const empty = ' '.repeat(40 - bar.length);

  process.stdout.write(
    `\r[${bar}${empty}] ${percent}% | ` +
    `${stats.processed}/${stats.totalToProcess} | ` +
    `Entities: ${stats.entitiesExtracted} | ` +
    `Shipments: +${stats.shipmentsCreated} ~${stats.shipmentsLinked} | ` +
    `${Math.ceil(remaining / 60)}min   `
  );
}

async function processInParallel(emailIds: string[]): Promise<void> {
  const queue = [...emailIds];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const emailId = queue.shift();
      if (!emailId) break;

      await processEmail(emailId);
      stats.processed++;
      printProgress();
    }
  }

  // Start workers
  const workers = Array(CONCURRENCY).fill(null).map(() => worker());
  await Promise.all(workers);
}

async function main(): Promise<void> {
  console.log('═'.repeat(70));
  console.log('  PARALLEL ENTITY EXTRACTION (Two-Phase)');
  console.log(`  ${CONCURRENCY} concurrent workers - Creates + Links shipments`);
  console.log('═'.repeat(70));
  console.log('');

  // Get emails in two groups
  const { bookingConfirmations, otherEmails } = await getEmailsByPhase();

  // Apply limits if set
  let phase1Emails = bookingConfirmations;
  let phase2Emails = otherEmails;

  if (MAX_TOTAL) {
    const total = phase1Emails.length + phase2Emails.length;
    if (total > MAX_TOTAL) {
      // Prioritize booking confirmations
      if (phase1Emails.length >= MAX_TOTAL) {
        phase1Emails = phase1Emails.slice(0, MAX_TOTAL);
        phase2Emails = [];
      } else {
        phase2Emails = phase2Emails.slice(0, MAX_TOTAL - phase1Emails.length);
      }
      console.log(`Limited to ${MAX_TOTAL} emails total`);
    }
  }

  stats.totalToProcess = phase1Emails.length + phase2Emails.length;
  stats.startTime = Date.now();

  // PHASE 1: Process all booking_confirmations first (creates shipments)
  if (phase1Emails.length > 0) {
    console.log(`\n─── PHASE 1: Booking Confirmations (${phase1Emails.length}) ───`);
    console.log('Creating shipments...\n');
    await processInParallel(phase1Emails);
    console.log('\n');
  }

  // PHASE 2: Process all other emails (links to existing shipments)
  if (phase2Emails.length > 0) {
    console.log(`─── PHASE 2: Other Documents (${phase2Emails.length}) ───`);
    console.log('Linking to shipments...\n');
    await processInParallel(phase2Emails);
  }

  const elapsed = (Date.now() - stats.startTime) / 1000;

  console.log('\n\n' + '═'.repeat(70));
  console.log('  EXTRACTION COMPLETE');
  console.log('═'.repeat(70));
  console.log('');
  console.log('RESULTS:');
  console.log(`  Processed:          ${stats.processed}`);
  console.log(`  With Entities:      ${stats.successful}`);
  console.log(`  Skipped:            ${stats.skipped}`);
  console.log(`  Failed:             ${stats.failed}`);
  console.log(`  Entities Extracted: ${stats.entitiesExtracted}`);
  console.log(`  Shipments Created:  ${stats.shipmentsCreated}`);
  console.log(`  Emails Linked:      ${stats.shipmentsLinked}`);
  console.log(`  Time:               ${Math.round(elapsed / 60)} minutes`);
  console.log(`  Rate:               ${(stats.processed / elapsed).toFixed(1)} emails/sec`);
  console.log('');

  // Final verification
  const { data: entityData } = await supabase.from('entity_extractions').select('email_id');
  const uniqueEmails = new Set(entityData?.map(e => e.email_id) || []).size;

  const { data: links } = await supabase.from('shipment_documents').select('email_id');
  const linkedEmails = new Set(links?.map(l => l.email_id) || []).size;

  const { count: shipmentCount } = await supabase.from('shipments').select('*', { count: 'exact', head: true });

  console.log('FINAL STATE:');
  console.log(`  Total entity records:        ${entityData?.length || 0}`);
  console.log(`  Unique emails with entities: ${uniqueEmails}`);
  console.log(`  Emails linked to shipments:  ${linkedEmails}`);
  console.log(`  Total shipments:             ${shipmentCount}`);
  console.log('');
  console.log('═'.repeat(70));
}

main().catch(console.error);
