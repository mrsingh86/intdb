/**
 * Extract Shipper/Consignee from HBL Attachments
 *
 * This script:
 * 1. Finds all HBL-classified emails
 * 2. Gets their PDF attachments with extracted text
 * 3. Uses AI to extract shipper/consignee from HBL text
 * 4. Creates/updates parties in database
 * 5. Links parties to shipments
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

// ============================================================================
// CONFIGURATION
// ============================================================================

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;

const HBL_DOCUMENT_TYPES = ['hbl_draft', 'hbl_final', 'bl_draft', 'bl_release', 'house_bl'];

// ============================================================================
// TYPES
// ============================================================================

interface ExtractedParty {
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
  contact_email: string | null;
  contact_phone: string | null;
}

interface HBLExtraction {
  shipper: ExtractedParty | null;
  consignee: ExtractedParty | null;
  notify_party: ExtractedParty | null;
  bl_number: string | null;
  booking_number: string | null;
}

interface ProcessingStats {
  hbl_emails_found: number;
  attachments_with_text: number;
  extractions_successful: number;
  parties_created: number;
  parties_updated: number;
  shipments_linked: number;
  errors: number;
}

// ============================================================================
// AI EXTRACTION
// ============================================================================

async function extractPartiesFromHBL(
  anthropic: Anthropic,
  hblText: string
): Promise<HBLExtraction> {
  const prompt = `Extract shipper, consignee, and notify party information from this Bill of Lading document.

BILL OF LADING TEXT:
${hblText.substring(0, 8000)}

Extract and return JSON with this exact structure:
{
  "shipper": {
    "name": "Company name",
    "address": "Street address",
    "city": "City name",
    "country": "Country name",
    "contact_email": "email if present or null",
    "contact_phone": "phone if present or null"
  },
  "consignee": {
    "name": "Company name",
    "address": "Street address",
    "city": "City name",
    "country": "Country name",
    "contact_email": "email if present or null",
    "contact_phone": "phone if present or null"
  },
  "notify_party": {
    "name": "Company name or null if not present",
    "address": "Street address or null",
    "city": "City name or null",
    "country": "Country name or null",
    "contact_email": "email if present or null",
    "contact_phone": "phone if present or null"
  },
  "bl_number": "BL/HBL number if found or null",
  "booking_number": "Booking number if found or null"
}

Rules:
- Extract EXACT names as written (preserve case)
- For addresses, combine street/building into one field
- If a field is not present, use null
- Shipper is usually at the top, labeled "SHIPPER" or "EXPORTER"
- Consignee is usually labeled "CONSIGNEE" or "IMPORT TO"
- Notify party is labeled "NOTIFY PARTY" or similar
- Return ONLY the JSON, no other text`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
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
// PARTY MATCHING & CREATION
// ============================================================================

async function findOrCreateParty(
  supabase: SupabaseClient,
  party: ExtractedParty,
  partyType: 'shipper' | 'consignee' | 'notify_party'
): Promise<string> {
  // Normalize name for matching
  const normalizedName = party.name.trim().toUpperCase();

  // Try to find existing party by name (fuzzy match)
  const { data: existing } = await supabase
    .from('parties')
    .select('id, party_name')
    .ilike('party_name', `%${normalizedName.substring(0, 20)}%`)
    .limit(5);

  // Check for close match
  const closeMatch = existing?.find(p => {
    const existingNorm = p.party_name.trim().toUpperCase();
    return existingNorm === normalizedName ||
           existingNorm.includes(normalizedName.substring(0, 15)) ||
           normalizedName.includes(existingNorm.substring(0, 15));
  });

  if (closeMatch) {
    // Update existing party with new info
    await supabase
      .from('parties')
      .update({
        address: party.address || undefined,
        city: party.city || undefined,
        country: party.country || undefined,
        contact_email: party.contact_email || undefined,
        contact_phone: party.contact_phone || undefined,
        updated_at: new Date().toISOString()
      })
      .eq('id', closeMatch.id);

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
      contact_email: party.contact_email,
      contact_phone: party.contact_phone,
      is_customer: partyType === 'shipper', // Shippers are typically customers
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
// SHIPMENT LINKING
// ============================================================================

async function linkPartiesToShipment(
  supabase: SupabaseClient,
  extraction: HBLExtraction,
  shipperId: string | null,
  consigneeId: string | null,
  notifyPartyId: string | null
): Promise<boolean> {
  // Find shipment by BL number or booking number
  let shipmentId: string | null = null;

  if (extraction.bl_number) {
    const { data } = await supabase
      .from('shipments')
      .select('id')
      .eq('bl_number', extraction.bl_number)
      .single();
    shipmentId = data?.id || null;
  }

  if (!shipmentId && extraction.booking_number) {
    const { data } = await supabase
      .from('shipments')
      .select('id')
      .eq('booking_number', extraction.booking_number)
      .single();
    shipmentId = data?.id || null;
  }

  if (!shipmentId) {
    console.log('    No matching shipment found for BL:', extraction.bl_number, 'Booking:', extraction.booking_number);
    return false;
  }

  // Update shipment with party IDs
  const updates: Record<string, string> = {};
  if (shipperId) updates.shipper_id = shipperId;
  if (consigneeId) updates.consignee_id = consigneeId;
  if (notifyPartyId) updates.notify_party_id = notifyPartyId;
  updates.updated_at = new Date().toISOString();

  const { error } = await supabase
    .from('shipments')
    .update(updates)
    .eq('id', shipmentId);

  if (error) {
    console.log('    Failed to update shipment:', error.message);
    return false;
  }

  console.log('    Linked to shipment:', shipmentId.substring(0, 8));
  return true;
}

// ============================================================================
// MAIN PROCESSING
// ============================================================================

async function processHBLAttachments(): Promise<ProcessingStats> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const stats: ProcessingStats = {
    hbl_emails_found: 0,
    attachments_with_text: 0,
    extractions_successful: 0,
    parties_created: 0,
    parties_updated: 0,
    shipments_linked: 0,
    errors: 0
  };

  console.log('═══════════════════════════════════════════════════════');
  console.log('EXTRACTING SHIPPER/CONSIGNEE FROM HBL ATTACHMENTS');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');

  // Step 1: Get HBL classified emails
  const { data: hblDocs } = await supabase
    .from('document_classifications')
    .select('email_id')
    .in('document_type', HBL_DOCUMENT_TYPES);

  const hblEmailIds = [...new Set((hblDocs || []).map(d => d.email_id))];
  stats.hbl_emails_found = hblEmailIds.length;
  console.log(`Found ${hblEmailIds.length} HBL-classified emails`);

  // Step 2: Get PDF attachments with extracted text
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename, extracted_text')
    .in('email_id', hblEmailIds)
    .eq('mime_type', 'application/pdf')
    .not('extracted_text', 'is', null);

  const validAttachments = (attachments || []).filter(
    a => a.extracted_text && a.extracted_text.length > 200
  );
  stats.attachments_with_text = validAttachments.length;
  console.log(`Found ${validAttachments.length} PDF attachments with extracted text`);
  console.log('');

  // Step 3: Process each attachment
  for (let i = 0; i < validAttachments.length; i++) {
    const attachment = validAttachments[i];
    console.log(`[${i + 1}/${validAttachments.length}] Processing: ${attachment.filename}`);

    try {
      // Extract parties using AI
      const extraction = await extractPartiesFromHBL(anthropic, attachment.extracted_text);
      stats.extractions_successful++;

      console.log('  Extracted:');
      if (extraction.shipper) console.log('    Shipper:', extraction.shipper.name);
      if (extraction.consignee) console.log('    Consignee:', extraction.consignee.name);
      if (extraction.notify_party?.name) console.log('    Notify:', extraction.notify_party.name);
      console.log('    BL#:', extraction.bl_number || 'N/A');
      console.log('    Booking#:', extraction.booking_number || 'N/A');

      // Create/update parties
      let shipperId: string | null = null;
      let consigneeId: string | null = null;
      let notifyPartyId: string | null = null;

      if (extraction.shipper) {
        shipperId = await findOrCreateParty(supabase, extraction.shipper, 'shipper');
        stats.parties_created++;
      }

      if (extraction.consignee) {
        consigneeId = await findOrCreateParty(supabase, extraction.consignee, 'consignee');
        stats.parties_created++;
      }

      if (extraction.notify_party?.name) {
        notifyPartyId = await findOrCreateParty(supabase, extraction.notify_party, 'notify_party');
        stats.parties_created++;
      }

      // Link to shipment
      const linked = await linkPartiesToShipment(
        supabase,
        extraction,
        shipperId,
        consigneeId,
        notifyPartyId
      );

      if (linked) {
        stats.shipments_linked++;
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, 500));

    } catch (error) {
      console.log('  ERROR:', error instanceof Error ? error.message : 'Unknown error');
      stats.errors++;
    }

    console.log('');
  }

  return stats;
}

// ============================================================================
// RUN
// ============================================================================

async function main() {
  const startTime = Date.now();

  try {
    const stats = await processHBLAttachments();

    console.log('═══════════════════════════════════════════════════════');
    console.log('EXTRACTION COMPLETE');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('Statistics:');
    console.log('  HBL emails found:', stats.hbl_emails_found);
    console.log('  Attachments with text:', stats.attachments_with_text);
    console.log('  Successful extractions:', stats.extractions_successful);
    console.log('  Parties created/updated:', stats.parties_created);
    console.log('  Shipments linked:', stats.shipments_linked);
    console.log('  Errors:', stats.errors);
    console.log('');
    console.log('Duration:', Math.round((Date.now() - startTime) / 1000), 'seconds');

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

main();
