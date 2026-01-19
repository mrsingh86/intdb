/**
 * Extract Shipper/Consignee from HBL Attachments v2
 *
 * This script:
 * 1. Finds HBL attachments that match shipments (by BL or booking number)
 * 2. Uses AI to extract shipper/consignee from HBL text
 * 3. Creates/updates parties in database
 * 4. Links parties to shipments
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

// ============================================================================
// CONFIGURATION
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;

const BATCH_SIZE = 50; // Process 50 at a time

// ============================================================================
// TYPES
// ============================================================================

interface ExtractedParty {
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
}

interface HBLExtraction {
  shipper: ExtractedParty | null;
  consignee: ExtractedParty | null;
  notify_party: ExtractedParty | null;
}

interface MatchedAttachment {
  attachment_id: string;
  email_id: string;
  filename: string;
  extracted_text: string;
  shipment_id: string;
  match_type: string;
  match_value: string;
}

// ============================================================================
// FIND MATCHED ATTACHMENTS
// ============================================================================

async function findMatchedHBLAttachments(supabase: SupabaseClient): Promise<MatchedAttachment[]> {
  // Get all shipments with BL and booking numbers
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number, shipper_id, consignee_id');

  const blMap = new Map<string, { id: string; hasParties: boolean }>();
  const bookingMap = new Map<string, { id: string; hasParties: boolean }>();

  for (const s of shipments || []) {
    const hasParties = !!(s.shipper_id || s.consignee_id);
    if (s.bl_number) blMap.set(s.bl_number.toUpperCase(), { id: s.id, hasParties });
    if (s.booking_number) bookingMap.set(s.booking_number.toUpperCase(), { id: s.id, hasParties });
  }

  // Get HBL-like PDF attachments
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename, extracted_text')
    .eq('mime_type', 'application/pdf')
    .not('extracted_text', 'is', null);

  const hblLike = (attachments || []).filter(a => {
    const text = (a.extracted_text || '').toUpperCase();
    return (
      text.includes('BILL OF LADING') ||
      (text.includes('SHIPPER') && text.includes('CONSIGNEE'))
    ) && text.length > 500;
  });

  // Match to shipments
  const matched: MatchedAttachment[] = [];
  const processedShipments = new Set<string>();

  for (const a of hblLike) {
    const text = a.extracted_text.toUpperCase();
    let shipmentId: string | null = null;
    let matchType: string | null = null;
    let matchValue: string | null = null;

    // Check BL numbers
    for (const [bl, info] of blMap.entries()) {
      if (text.includes(bl) && !processedShipments.has(info.id)) {
        shipmentId = info.id;
        matchType = 'bl_number';
        matchValue = bl;
        break;
      }
    }

    // Check booking numbers if no BL match
    if (!shipmentId) {
      for (const [booking, info] of bookingMap.entries()) {
        if (text.includes(booking) && !processedShipments.has(info.id)) {
          shipmentId = info.id;
          matchType = 'booking_number';
          matchValue = booking;
          break;
        }
      }
    }

    if (shipmentId && matchType && matchValue) {
      processedShipments.add(shipmentId);
      matched.push({
        attachment_id: a.id,
        email_id: a.email_id,
        filename: a.filename,
        extracted_text: a.extracted_text,
        shipment_id: shipmentId,
        match_type: matchType,
        match_value: matchValue
      });
    }
  }

  return matched;
}

// ============================================================================
// AI EXTRACTION
// ============================================================================

async function extractPartiesFromHBL(
  anthropic: Anthropic,
  hblText: string
): Promise<HBLExtraction> {
  const prompt = `Extract shipper, consignee, and notify party from this Bill of Lading.

BILL OF LADING TEXT:
${hblText.substring(0, 6000)}

Return JSON:
{
  "shipper": {
    "name": "Company name exactly as written",
    "address": "Full address or null",
    "city": "City or null",
    "country": "Country or null"
  },
  "consignee": {
    "name": "Company name exactly as written",
    "address": "Full address or null",
    "city": "City or null",
    "country": "Country or null"
  },
  "notify_party": {
    "name": "Company name or null if not present",
    "address": "Address or null",
    "city": "City or null",
    "country": "Country or null"
  }
}

Rules:
- Shipper = exporter/sender (usually at top)
- Consignee = importer/receiver
- Use EXACT names as written
- Return ONLY JSON, no other text`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1500,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);

  if (!jsonMatch) {
    throw new Error('AI did not return valid JSON');
  }

  return JSON.parse(jsonMatch[0]) as HBLExtraction;
}

// ============================================================================
// PARTY MANAGEMENT
// ============================================================================

async function findOrCreateParty(
  supabase: SupabaseClient,
  party: ExtractedParty,
  partyType: 'shipper' | 'consignee' | 'notify_party'
): Promise<string> {
  const normalizedName = party.name.trim().toUpperCase();

  // Skip if name is too short or invalid
  if (normalizedName.length < 3) {
    throw new Error('Party name too short');
  }

  // Try to find existing party
  const searchTerm = normalizedName.substring(0, Math.min(20, normalizedName.length));
  const { data: existing } = await supabase
    .from('parties')
    .select('id, party_name')
    .ilike('party_name', `%${searchTerm}%`)
    .limit(10);

  // Find close match
  const closeMatch = existing?.find(p => {
    const existingNorm = p.party_name.trim().toUpperCase();
    return existingNorm === normalizedName ||
           existingNorm.startsWith(normalizedName.substring(0, 15)) ||
           normalizedName.startsWith(existingNorm.substring(0, 15));
  });

  if (closeMatch) {
    // Update with new info if available
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (party.address) updates.address = party.address;
    if (party.city) updates.city = party.city;
    if (party.country) updates.country = party.country;

    await supabase.from('parties').update(updates).eq('id', closeMatch.id);
    return closeMatch.id;
  }

  // Create new party
  const { data: newParty, error } = await supabase
    .from('parties')
    .insert({
      party_name: party.name,
      party_type: partyType,
      address: party.address,
      city: party.city,
      country: party.country,
      is_customer: partyType === 'shipper',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .select('id')
    .single();

  if (error) {
    throw new Error(`Failed to create party: ${error.message}`);
  }

  return newParty.id;
}

// ============================================================================
// MAIN PROCESSING
// ============================================================================

async function processHBLAttachments(): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('EXTRACTING SHIPPER/CONSIGNEE FROM HBL ATTACHMENTS');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  // Find matched attachments
  console.log('Finding HBL attachments matched to shipments...');
  const matched = await findMatchedHBLAttachments(supabase);
  console.log(`Found ${matched.length} unique shipment-attachment matches`);
  console.log('');

  // Process in batches
  let processed = 0;
  let success = 0;
  let errors = 0;
  let partiesCreated = 0;

  for (let i = 0; i < matched.length; i++) {
    const attachment = matched[i];
    processed++;

    console.log(`[${processed}/${matched.length}] ${attachment.filename.substring(0, 50)}`);
    console.log(`    Shipment: ${attachment.shipment_id.substring(0, 8)} | ${attachment.match_type}: ${attachment.match_value}`);

    try {
      // Extract parties using AI
      const extraction = await extractPartiesFromHBL(anthropic, attachment.extracted_text);

      // Create/update parties and get IDs
      let shipperId: string | null = null;
      let consigneeId: string | null = null;
      let notifyPartyId: string | null = null;

      if (extraction.shipper?.name) {
        shipperId = await findOrCreateParty(supabase, extraction.shipper, 'shipper');
        partiesCreated++;
        console.log(`    Shipper: ${extraction.shipper.name.substring(0, 40)}`);
      }

      if (extraction.consignee?.name) {
        consigneeId = await findOrCreateParty(supabase, extraction.consignee, 'consignee');
        partiesCreated++;
        console.log(`    Consignee: ${extraction.consignee.name.substring(0, 40)}`);
      }

      if (extraction.notify_party?.name) {
        notifyPartyId = await findOrCreateParty(supabase, extraction.notify_party, 'notify_party');
        partiesCreated++;
      }

      // Update shipment with party IDs
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (shipperId) updates.shipper_id = shipperId;
      if (consigneeId) updates.consignee_id = consigneeId;
      if (notifyPartyId) updates.notify_party_id = notifyPartyId;

      const { error: updateError } = await supabase
        .from('shipments')
        .update(updates)
        .eq('id', attachment.shipment_id);

      if (updateError) {
        console.log(`    ERROR updating shipment: ${updateError.message}`);
        errors++;
      } else {
        console.log(`    ✓ Linked to shipment`);
        success++;
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, 300));

    } catch (error) {
      console.log(`    ERROR: ${error instanceof Error ? error.message : 'Unknown'}`);
      errors++;
    }

    console.log('');
  }

  // Summary
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Processed: ${processed}`);
  console.log(`Success: ${success}`);
  console.log(`Errors: ${errors}`);
  console.log(`Parties created/updated: ${partiesCreated}`);
}

// ============================================================================
// RUN
// ============================================================================

processHBLAttachments().catch(console.error);
