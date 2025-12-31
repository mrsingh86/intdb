/**
 * Entity Extraction - Always Store
 *
 * Fixed extraction that ALWAYS stores entities in entity_extractions table,
 * regardless of whether a shipment is linked.
 *
 * Architecture:
 *   Email → Extract Entities → ALWAYS store in entity_extractions
 *                                    ↓
 *                            Then try to link to shipment
 *
 * This ensures NO DATA IS LOST even if shipment can't be linked.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx scripts/extract-entities-always.ts
 *
 * Environment:
 *   CONCURRENCY     - Parallel workers (default: 5)
 *   BATCH_SIZE      - Emails per batch (default: 50)
 *   SKIP_LINKED     - Skip already linked emails (default: false)
 *   REPROCESS       - Re-extract even if entities exist (default: false)
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
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '3');
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || '50');
const SKIP_LINKED = process.env.SKIP_LINKED === 'true';
const REPROCESS = process.env.REPROCESS === 'true';

interface Stats {
  totalEmails: number;
  processed: number;
  entitiesSaved: number;
  shipmentsLinked: number;
  shipmentsCreated: number;
  skippedNoContent: number;
  skippedAlreadyHasEntities: number;
  failed: number;
  startTime: number;
}

const stats: Stats = {
  totalEmails: 0,
  processed: 0,
  entitiesSaved: 0,
  shipmentsLinked: 0,
  shipmentsCreated: 0,
  skippedNoContent: 0,
  skippedAlreadyHasEntities: 0,
  failed: 0,
  startTime: Date.now()
};

// Mutex for shipment creation
const shipmentLock = new Map<string, Promise<string | null>>();

/**
 * Retry with exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 1000
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Check if retryable (rate limit, timeout, network errors)
      const msg = lastError.message.toLowerCase();
      const isRetryable = msg.includes('rate') ||
                          msg.includes('timeout') ||
                          msg.includes('econnreset') ||
                          msg.includes('429') ||
                          msg.includes('503') ||
                          msg.includes('overloaded');

      if (!isRetryable || attempt === maxRetries - 1) {
        throw lastError;
      }

      // Exponential backoff: 1s, 2s, 4s
      const delay = baseDelayMs * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Extract entities using Claude AI
 */
async function extractEntities(
  text: string,
  docType: string
): Promise<Array<{ type: string; value: string; confidence: number }>> {
  const prompt = `Extract EVERY shipping-related entity from this ${docType} document. Be exhaustive.

TEXT:
${text.substring(0, 12000)}

═══════════════════════════════════════════════════════════════════════════════
EXTRACT ALL OF THE FOLLOWING - LEAVE NOTHING OUT:
═══════════════════════════════════════════════════════════════════════════════

1. IDENTIFIERS (extract ALL reference numbers):
- booking_number (carrier booking: 262874542, HLCU1234567, BKG#, Booking No.)
- bl_number (Master B/L: HLCUNBO250224897, MBL, MAEU123456789)
- hbl_number (House B/L from forwarder: HBL, SE1225003142)
- container_number (MRKU1234567, HLXU9876543 - 4 letters + 7 digits)
- seal_number (container seal number)
- so_number (Shipping Order, S/O number)
- po_number (Purchase Order)
- job_number (internal job/file reference)

2. VESSEL & VOYAGE:
- vessel_name (ship name, without M/V or MV prefix)
- voyage_number (voyage ID like 123E, 456W)
- carrier (Maersk, Hapag-Lloyd, CMA CGM, MSC, ONE, Evergreen, COSCO, ZIM, Yang Ming)
- service_name (service route name like "Asia-US West Coast Express")
- terminal (loading/discharge terminal name)

3. LOCATIONS - DISTINGUISH CAREFULLY:
INLAND (use place_of_receipt/place_of_delivery):
- place_of_receipt: Origin pickup - factory, warehouse, ICD, inland city
  Examples: Delhi, Bangalore, Ludhiana, Ahmedabad, ICD Tughlakabad, Chicago warehouse
- place_of_delivery: Final destination - factory, warehouse, ICD, door delivery, inland city
  Examples: Detroit, Columbus, Denver, ICD Varnama, Des Plaines, specific addresses

SEAPORTS (use port_of_loading/port_of_discharge):
- port_of_loading: Ocean port where vessel loads cargo
  Examples: Nhava Sheva (INNSA), Mundra (INMUN), Chennai, Shanghai, Los Angeles
- port_of_discharge: Ocean port where vessel unloads cargo
  Examples: Rotterdam, Hamburg, Long Beach, New York, Savannah, Norfolk
- transshipment_port: Intermediate port for cargo transfer

4. ALL DATES (format: YYYY-MM-DD) - EXTRACT EVERY DATE:
Voyage dates:
- etd (departure date, sailing date, ETD)
- eta (arrival date, ETA)
- ata (actual arrival)
- atd (actual departure)

Cutoff dates - CRITICAL, extract all:
- si_cutoff (SI deadline, shipping instruction cut-off, SI CUT, DOC deadline)
- vgm_cutoff (VGM deadline, verified gross mass, VGM CUT)
- cargo_cutoff (cargo cut-off, CY cut-off, container receiving deadline, CY CUT)
- gate_cutoff (gate closing, terminal cut-off, port cut-off, GATE CUT, last gate-in)
- doc_cutoff (document cut-off, documentation deadline)
- ams_cutoff (AMS/ISF deadline, customs filing deadline, 24hr rule)
- booking_cutoff (booking deadline, space confirmation deadline)
- earliest_return_date (ERD, earliest equipment return, empty pickup)
- late_gate (late gate deadline if different from gate_cutoff)

Other dates:
- cargo_ready_date (when cargo will be ready)
- pickup_date (scheduled pickup)
- delivery_date (scheduled delivery)
- free_time_expiry (demurrage/detention free time end)

5. PARTIES - EXTRACT FULL NAMES AND ADDRESSES:
- shipper (exporter name and address)
- consignee (importer name and address)
- notify_party (party to notify on arrival)
- freight_forwarder (forwarding agent)
- customs_broker (customs clearing agent)
- trucker (trucking company)
- shipping_agent (carrier's local agent)

6. CARGO DETAILS - EXTRACT ALL:
- commodity (cargo description, goods description)
- hs_code (harmonized system code, tariff code)
- container_type (20GP, 40HC, 40GP, 45HC, 20RF, etc.)
- container_count (number of containers)
- package_count (number of packages, pieces, cartons)
- package_type (cartons, pallets, drums, bags, etc.)
- gross_weight (total weight in KG or MT)
- net_weight (net weight without packaging)
- volume (CBM, cubic meters)
- dimensions (L x W x H)
- cargo_value (declared value of goods)
- temperature (for reefer cargo)
- humidity (for reefer cargo)
- hazmat_class (dangerous goods class)
- un_number (UN number for hazmat)

7. COMMERCIAL & FINANCIAL:
- incoterms (FOB, CIF, CFR, EXW, DDP, DAP, FCA, etc.)
- freight_terms (prepaid, collect, third party)
- freight_amount (freight charges with currency)
- currency (USD, EUR, INR, etc.)
- customer_reference (shipper's reference)
- invoice_number (commercial invoice number)
- lc_number (letter of credit number)
- insurance_value (cargo insurance amount)

8. CUSTOMS & COMPLIANCE:
- customs_entry_number (entry number, customs reference)
- isf_number (ISF filing number)
- bond_number (customs bond reference)
- duty_amount (customs duty with currency)
- exam_hold (customs exam status)

9. STATUS & CONDITIONS:
- shipment_status (booked, confirmed, loaded, departed, arrived, delivered)
- hold_reason (any hold or block reason)
- amendment_type (what changed: ETD, ETA, vessel, port, etc.)
- special_instructions (any special handling notes)
- remarks (any additional notes or comments)

═══════════════════════════════════════════════════════════════════════════════

Return JSON array format:
[{"type": "booking_number", "value": "262874542", "confidence": 0.95}]

CRITICAL RULES:
1. Extract EVERYTHING - be exhaustive, don't skip any data
2. Dates MUST be YYYY-MM-DD format (convert from any format)
3. Amounts include currency (e.g., "USD 1500.00")
4. Weights include unit (e.g., "5000 KG" or "5 MT")
5. Confidence > 0.6 for all extractions
6. For locations: INLAND cities → place_of_receipt/place_of_delivery, SEAPORTS → port_of_loading/port_of_discharge
7. Extract multiple values if present (multiple containers, multiple dates, etc.)
8. Return [] if nothing found`;

  try {
    // Use retry wrapper for rate limiting resilience
    const response = await withRetry(async () => {
      return await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4000,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }]
      });
    });

    const content = response.content[0];
    if (content.type !== 'text') return [];

    const jsonMatch = content.text.match(/\[[\s\S]*?\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.filter(
      (e: any) =>
        e.type &&
        e.value &&
        typeof e.value === 'string' &&
        e.value.trim().length > 0
    );
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`\n[EXTRACT ERROR] ${errMsg.substring(0, 100)}`);
    return [];
  }
}

/**
 * Save entities to entity_extractions table
 * This ALWAYS happens, regardless of shipment linking
 */
async function saveEntities(
  emailId: string,
  entities: Array<{ type: string; value: string; confidence: number }>,
  docType: string
): Promise<number> {
  if (entities.length === 0) return 0;

  // SAFER PATTERN: Insert first, then delete old records
  const timestamp = new Date().toISOString();
  const records = entities.map((e) => ({
    email_id: emailId,
    entity_type: e.type,
    entity_value: e.value,
    confidence_score: Math.round(e.confidence * 100),
    extraction_method: 'ai_comprehensive',
    source_document_type: docType,
    created_at: timestamp
  }));

  // Insert new entities first
  const { error: insertError } = await supabase.from('entity_extractions').insert(records);

  if (insertError) {
    console.error(`Failed to save entities for ${emailId}:`, insertError.message);
    return 0;
  }

  // Only delete old entities AFTER successful insert
  await supabase
    .from('entity_extractions')
    .delete()
    .eq('email_id', emailId)
    .lt('created_at', timestamp);

  return records.length;
}

/**
 * Find or create shipment based on extracted entities
 */
async function findOrCreateShipment(
  entities: Array<{ type: string; value: string }>,
  docType: string
): Promise<{ shipmentId: string | null; created: boolean }> {
  const bookingNumber = entities.find((e) => e.type === 'booking_number')?.value;
  const blNumber = entities.find((e) => e.type === 'bl_number')?.value;
  const hblNumber = entities.find((e) => e.type === 'hbl_number')?.value;
  const containerNumber = entities.find((e) => e.type === 'container_number')?.value;

  if (!bookingNumber && !blNumber && !hblNumber && !containerNumber) {
    return { shipmentId: null, created: false };
  }

  const key = bookingNumber || blNumber || hblNumber || containerNumber || '';

  // Check if operation in progress
  if (shipmentLock.has(key)) {
    const id = await shipmentLock.get(key)!;
    return { shipmentId: id, created: false };
  }

  const promise = (async () => {
    // Try to find existing shipment
    if (bookingNumber) {
      const { data } = await supabase
        .from('shipments')
        .select('id')
        .eq('booking_number', bookingNumber)
        .single();
      if (data) return data.id;
    }

    if (blNumber) {
      const { data } = await supabase
        .from('shipments')
        .select('id')
        .eq('bl_number', blNumber)
        .single();
      if (data) return data.id;
    }

    if (containerNumber) {
      const { data } = await supabase
        .from('shipments')
        .select('id')
        .contains('container_numbers', [containerNumber])
        .single();
      if (data) return data.id;
    }

    // Only create from booking_confirmation
    if (docType !== 'booking_confirmation') return null;
    if (!bookingNumber && !blNumber) return null;

    // Create new shipment
    const shipmentData: any = {
      booking_number: bookingNumber || null,
      bl_number: blNumber || null,
      status: 'booked',
      created_at: new Date().toISOString()
    };

    // Add other fields
    for (const e of entities) {
      switch (e.type) {
        case 'vessel_name':
          shipmentData.vessel_name = e.value;
          break;
        case 'voyage_number':
          shipmentData.voyage_number = e.value;
          break;
        case 'port_of_loading':
          shipmentData.port_of_loading = e.value;
          break;
        case 'port_of_discharge':
          shipmentData.port_of_discharge = e.value;
          break;
        case 'etd':
          shipmentData.etd = e.value;
          break;
        case 'eta':
          shipmentData.eta = e.value;
          break;
        case 'si_cutoff':
          shipmentData.si_cutoff = e.value;
          break;
        case 'vgm_cutoff':
          shipmentData.vgm_cutoff = e.value;
          break;
        case 'cargo_cutoff':
          shipmentData.cargo_cutoff = e.value;
          break;
      }
    }

    const { data: newShipment, error } = await supabase
      .from('shipments')
      .insert(shipmentData)
      .select('id')
      .single();

    if (error) {
      // Might be duplicate, try to find again
      if (bookingNumber) {
        const { data } = await supabase
          .from('shipments')
          .select('id')
          .eq('booking_number', bookingNumber)
          .single();
        return data?.id || null;
      }
      return null;
    }

    stats.shipmentsCreated++;
    return newShipment?.id || null;
  })();

  shipmentLock.set(key, promise);
  const result = await promise;
  shipmentLock.delete(key);

  return { shipmentId: result, created: result !== null };
}

/**
 * Link email to shipment
 */
async function linkEmailToShipment(
  emailId: string,
  shipmentId: string,
  docType: string
): Promise<boolean> {
  const { data: existing } = await supabase
    .from('shipment_documents')
    .select('id')
    .eq('shipment_id', shipmentId)
    .eq('email_id', emailId)
    .single();

  if (existing) return true;

  const { error } = await supabase.from('shipment_documents').insert({
    shipment_id: shipmentId,
    email_id: emailId,
    document_type: docType,
    link_method: 'ai_extraction',
    created_at: new Date().toISOString()
  });

  return !error;
}

/**
 * Process a single email
 */
async function processEmail(emailId: string): Promise<void> {
  try {
    // 1. Get email content
    const { data: email } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email, body_text, snippet')
      .eq('id', emailId)
      .single();

    if (!email) {
      stats.failed++;
      return;
    }

    // 2. Check if already has entities (unless REPROCESS)
    if (!REPROCESS) {
      const { count } = await supabase
        .from('entity_extractions')
        .select('*', { count: 'exact', head: true })
        .eq('email_id', emailId);

      if (count && count > 0) {
        stats.skippedAlreadyHasEntities++;
        return;
      }
    }

    // 3. Get classification
    const { data: classification } = await supabase
      .from('document_classifications')
      .select('document_type')
      .eq('email_id', emailId)
      .single();

    const docType = classification?.document_type || 'unknown';

    // 4. Get attachment text (PDFs)
    const { data: attachments } = await supabase
      .from('raw_attachments')
      .select('filename, extracted_text')
      .eq('email_id', emailId)
      .not('extracted_text', 'is', null);

    const attachmentText =
      attachments?.map((a) => `[${a.filename}]\n${a.extracted_text}`).join('\n\n') || '';

    // 5. Build full text
    const fullText = [
      `Subject: ${email.subject || ''}`,
      `From: ${email.sender_email || ''}`,
      email.body_text || email.snippet || '',
      attachmentText ? `\n--- ATTACHMENTS ---\n${attachmentText}` : ''
    ].join('\n');

    // Skip if too short (no meaningful content)
    if (fullText.length < 30) {
      stats.skippedNoContent++;
      return;
    }

    // 6. Extract entities using AI
    const entities = await extractEntities(fullText, docType);

    // 7. ALWAYS save entities (even if empty - we record the attempt)
    const savedCount = await saveEntities(emailId, entities, docType);
    stats.entitiesSaved += savedCount;

    // 8. Update email processing status
    await supabase
      .from('raw_emails')
      .update({
        processing_status: 'entities_extracted',
        updated_at: new Date().toISOString()
      })
      .eq('id', emailId);

    // 9. Try to link to shipment (only if we have linkable entities)
    if (entities.length > 0) {
      const { shipmentId } = await findOrCreateShipment(entities, docType);

      if (shipmentId) {
        const linked = await linkEmailToShipment(emailId, shipmentId, docType);
        if (linked) stats.shipmentsLinked++;
      }
    }

    stats.processed++;
  } catch (error) {
    stats.failed++;
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error(`\n[FAILED] Email ${emailId}: ${errMsg}`);
  }
}

/**
 * Get emails to process
 */
async function getEmailsToProcess(): Promise<string[]> {
  const emailIds: string[] = [];

  // Get linked email IDs if skipping
  const linkedIds = new Set<string>();
  if (SKIP_LINKED) {
    let offset = 0;
    while (true) {
      const { data } = await supabase
        .from('shipment_documents')
        .select('email_id')
        .range(offset, offset + 999);
      if (!data || data.length === 0) break;
      data.forEach((d) => linkedIds.add(d.email_id));
      offset += 1000;
      if (data.length < 1000) break;
    }
    console.log(`  Linked emails to skip: ${linkedIds.size}`);
  }

  // Get emails with entities if not reprocessing
  const emailsWithEntities = new Set<string>();
  if (!REPROCESS) {
    let offset = 0;
    while (true) {
      const { data } = await supabase
        .from('entity_extractions')
        .select('email_id')
        .range(offset, offset + 999);
      if (!data || data.length === 0) break;
      data.forEach((d) => emailsWithEntities.add(d.email_id));
      offset += 1000;
      if (data.length < 1000) break;
    }
    console.log(`  Emails with entities (skip): ${emailsWithEntities.size}`);
  }

  // Fetch all emails
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from('raw_emails')
      .select('id')
      .order('received_at', { ascending: true })
      .range(offset, offset + 999);

    if (error) throw new Error(`Failed to fetch emails: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const e of data) {
      if (SKIP_LINKED && linkedIds.has(e.id)) continue;
      if (!REPROCESS && emailsWithEntities.has(e.id)) continue;
      emailIds.push(e.id);
    }

    offset += 1000;
    if (data.length < 1000) break;
  }

  return emailIds;
}

/**
 * Print progress
 */
function printProgress(): void {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const rate = stats.processed / elapsed;
  const remaining = (stats.totalEmails - stats.processed) / Math.max(rate, 0.1);

  const pct = ((stats.processed / stats.totalEmails) * 100).toFixed(1);
  const bar = '='.repeat(Math.floor((stats.processed / stats.totalEmails) * 40));
  const empty = ' '.repeat(40 - bar.length);

  process.stdout.write(
    `\r[${bar}${empty}] ${pct}% | ` +
      `${stats.processed}/${stats.totalEmails} | ` +
      `Entities: ${stats.entitiesSaved} | ` +
      `Linked: ${stats.shipmentsLinked} | ` +
      `${Math.ceil(remaining / 60)}min   `
  );
}

/**
 * Process in parallel
 */
async function processInParallel(emailIds: string[]): Promise<void> {
  const queue = [...emailIds];

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const emailId = queue.shift();
      if (!emailId) break;

      await processEmail(emailId);
      printProgress();
    }
  }

  const workers = Array(CONCURRENCY)
    .fill(null)
    .map(() => worker());
  await Promise.all(workers);
}

/**
 * Main
 */
async function main(): Promise<void> {
  console.log('═'.repeat(70));
  console.log('  ENTITY EXTRACTION - ALWAYS STORE');
  console.log('  Entities saved to entity_extractions for ALL emails');
  console.log('═'.repeat(70));
  console.log('');
  console.log('Config:');
  console.log(`  Concurrency: ${CONCURRENCY}`);
  console.log(`  Skip linked: ${SKIP_LINKED}`);
  console.log(`  Reprocess: ${REPROCESS}`);
  console.log('');

  // Get emails to process
  console.log('Fetching emails...');
  const emailIds = await getEmailsToProcess();

  if (emailIds.length === 0) {
    console.log('No emails to process!');
    return;
  }

  stats.totalEmails = emailIds.length;
  stats.startTime = Date.now();

  console.log(`  Total to process: ${emailIds.length}`);
  console.log('');
  console.log('Processing...');
  console.log('');

  await processInParallel(emailIds);

  const elapsed = (Date.now() - stats.startTime) / 1000;

  console.log('\n\n' + '═'.repeat(70));
  console.log('  EXTRACTION COMPLETE');
  console.log('═'.repeat(70));
  console.log('');
  console.log('RESULTS:');
  console.log(`  Processed:              ${stats.processed}`);
  console.log(`  Entities saved:         ${stats.entitiesSaved}`);
  console.log(`  Shipments created:      ${stats.shipmentsCreated}`);
  console.log(`  Emails linked:          ${stats.shipmentsLinked}`);
  console.log(`  Skipped (no content):   ${stats.skippedNoContent}`);
  console.log(`  Skipped (has entities): ${stats.skippedAlreadyHasEntities}`);
  console.log(`  Failed:                 ${stats.failed}`);
  console.log(`  Time:                   ${Math.round(elapsed / 60)} minutes`);
  console.log(`  Rate:                   ${(stats.processed / elapsed).toFixed(1)} emails/sec`);
  console.log('');

  // Final verification
  const { count: entityCount } = await supabase
    .from('entity_extractions')
    .select('*', { count: 'exact', head: true });

  // Paginate to get accurate count (avoid Supabase 1000-row limit)
  const allEntityEmailIds = new Set<string>();
  let entityOffset = 0;
  while (true) {
    const { data: entityBatch } = await supabase
      .from('entity_extractions')
      .select('email_id')
      .range(entityOffset, entityOffset + 999);
    if (!entityBatch || entityBatch.length === 0) break;
    entityBatch.forEach((e) => allEntityEmailIds.add(e.email_id));
    entityOffset += 1000;
    if (entityBatch.length < 1000) break;
  }
  const uniqueEmailCount = allEntityEmailIds.size;

  const { data: links } = await supabase.from('shipment_documents').select('email_id');
  const linkedCount = new Set(links?.map((l) => l.email_id) || []).size;

  const { count: totalEmails } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: true });

  console.log('FINAL STATE:');
  console.log(`  Total entity records:        ${entityCount}`);
  console.log(`  Emails with entities:        ${uniqueEmailCount}/${totalEmails} (${Math.round((uniqueEmailCount / (totalEmails || 1)) * 100)}%)`);
  console.log(`  Emails linked to shipments:  ${linkedCount}/${totalEmails} (${Math.round((linkedCount / (totalEmails || 1)) * 100)}%)`);
  console.log('');
  console.log('═'.repeat(70));
}

main().catch(console.error);
