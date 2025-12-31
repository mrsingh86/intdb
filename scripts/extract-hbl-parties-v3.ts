/**
 * Extract Shipper/Consignee from HBL Attachments v3
 *
 * FIXED: Correctly identifies actual shipper/consignee
 * - Ignores INTOGLO (the freight forwarder)
 * - Shipper = actual exporter
 * - Consignee = actual importer
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;

// INTOGLO variations to ignore
const FORWARDER_NAMES = [
  'INTOGLO',
  'INTOGLO PRIVATE LIMITED',
  'INTOGLO TECHNOLOGIES',
  'INTOGLO TECHNOLOGIES INC'
];

interface ExtractedParty {
  name: string;
  address: string | null;
  city: string | null;
  country: string | null;
}

interface HBLExtraction {
  shipper: ExtractedParty | null;
  consignee: ExtractedParty | null;
}

interface MatchedAttachment {
  attachment_id: string;
  email_id: string;
  filename: string;
  extracted_text: string;
  shipment_id: string;
}

// ============================================================================
// FIND MATCHED ATTACHMENTS
// ============================================================================

async function findMatchedHBLAttachments(supabase: SupabaseClient): Promise<MatchedAttachment[]> {
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, bl_number');

  const blMap = new Map<string, string>();
  const bookingMap = new Map<string, string>();

  for (const s of shipments || []) {
    if (s.bl_number) blMap.set(s.bl_number.toUpperCase(), s.id);
    if (s.booking_number) bookingMap.set(s.booking_number.toUpperCase(), s.id);
  }

  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename, extracted_text')
    .eq('mime_type', 'application/pdf')
    .not('extracted_text', 'is', null);

  const hblLike = (attachments || []).filter(a => {
    const text = (a.extracted_text || '').toUpperCase();
    return (text.includes('BILL OF LADING') || text.includes('B/L')) && text.length > 500;
  });

  const matched: MatchedAttachment[] = [];
  const processedShipments = new Set<string>();

  for (const a of hblLike) {
    const text = a.extracted_text.toUpperCase();
    let shipmentId: string | null = null;

    for (const [bl, id] of blMap.entries()) {
      if (text.includes(bl) && !processedShipments.has(id)) {
        shipmentId = id;
        break;
      }
    }

    if (!shipmentId) {
      for (const [booking, id] of bookingMap.entries()) {
        if (text.includes(booking) && !processedShipments.has(id)) {
          shipmentId = id;
          break;
        }
      }
    }

    if (shipmentId) {
      processedShipments.add(shipmentId);
      matched.push({
        attachment_id: a.id,
        email_id: a.email_id,
        filename: a.filename,
        extracted_text: a.extracted_text,
        shipment_id: shipmentId
      });
    }
  }

  return matched;
}

// ============================================================================
// AI EXTRACTION - IMPROVED PROMPT
// ============================================================================

async function extractPartiesFromHBL(
  anthropic: Anthropic,
  hblText: string
): Promise<HBLExtraction> {
  const prompt = `Extract the ACTUAL shipper and consignee from this Bill of Lading.

IMPORTANT RULES:
1. SHIPPER = The actual EXPORTER/MANUFACTURER sending the goods (NOT the freight forwarder)
2. CONSIGNEE = The actual IMPORTER/BUYER receiving the goods (NOT the freight forwarder)
3. IGNORE these names - they are the freight forwarder, not actual parties:
   - INTOGLO (any variation)
   - INTOGLO PRIVATE LIMITED
   - INTOGLO TECHNOLOGIES INC
   - Any name containing "INTOGLO"
4. Look for the FIRST company name after "SHIPPER" or at the very top
5. Look for the company after "CONSIGNEE" or "NOTIFY PARTY"
6. The shipper is usually an Indian company (manufacturer/exporter)
7. The consignee is usually a US company (importer/buyer)

BILL OF LADING TEXT:
${hblText.substring(0, 5000)}

Return JSON (use null if you cannot find actual shipper/consignee, DO NOT use INTOGLO):
{
  "shipper": {
    "name": "Actual exporter company name",
    "address": "Address or null",
    "city": "City or null",
    "country": "Country (like INDIA, USA, etc) or null"
  },
  "consignee": {
    "name": "Actual importer company name",
    "address": "Address or null",
    "city": "City or null",
    "country": "Country or null"
  }
}

Return ONLY the JSON.`;

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

  const result = JSON.parse(jsonMatch[0]) as HBLExtraction;

  // Double-check: reject if AI still returned INTOGLO
  if (result.shipper?.name) {
    const shipperUpper = result.shipper.name.toUpperCase();
    if (FORWARDER_NAMES.some(f => shipperUpper.includes(f.toUpperCase()))) {
      result.shipper = null;
    }
  }

  if (result.consignee?.name) {
    const consigneeUpper = result.consignee.name.toUpperCase();
    if (FORWARDER_NAMES.some(f => consigneeUpper.includes(f.toUpperCase()))) {
      result.consignee = null;
    }
  }

  return result;
}

// ============================================================================
// PARTY MANAGEMENT
// ============================================================================

async function findOrCreateParty(
  supabase: SupabaseClient,
  party: ExtractedParty,
  partyType: 'shipper' | 'consignee'
): Promise<string> {
  const normalizedName = party.name.trim().toUpperCase();

  if (normalizedName.length < 3) {
    throw new Error('Party name too short');
  }

  // Skip if it's INTOGLO
  if (FORWARDER_NAMES.some(f => normalizedName.includes(f.toUpperCase()))) {
    throw new Error('Skipping forwarder name');
  }

  const searchTerm = normalizedName.substring(0, Math.min(15, normalizedName.length));
  const { data: existing } = await supabase
    .from('parties')
    .select('id, party_name')
    .ilike('party_name', `%${searchTerm}%`)
    .limit(10);

  // Find close match (but not INTOGLO)
  const closeMatch = existing?.find(p => {
    const existingNorm = p.party_name.trim().toUpperCase();
    if (FORWARDER_NAMES.some(f => existingNorm.includes(f.toUpperCase()))) {
      return false; // Skip INTOGLO matches
    }
    return existingNorm === normalizedName ||
           existingNorm.startsWith(normalizedName.substring(0, 10)) ||
           normalizedName.startsWith(existingNorm.substring(0, 10));
  });

  if (closeMatch) {
    await supabase.from('parties').update({
      address: party.address || undefined,
      city: party.city || undefined,
      country: party.country || undefined,
      updated_at: new Date().toISOString()
    }).eq('id', closeMatch.id);
    return closeMatch.id;
  }

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

  if (error) throw new Error(`Failed to create party: ${error.message}`);
  return newParty.id;
}

// ============================================================================
// CLEAR OLD INTOGLO LINKS FIRST
// ============================================================================

async function clearIntogloLinks(supabase: SupabaseClient): Promise<number> {
  // Find INTOGLO party IDs
  const { data: intogloParties } = await supabase
    .from('parties')
    .select('id')
    .ilike('party_name', '%INTOGLO%');

  const intogloIds = (intogloParties || []).map(p => p.id);

  if (intogloIds.length === 0) return 0;

  console.log(`Found ${intogloIds.length} INTOGLO parties to unlink`);

  // Clear shipper_id where it's INTOGLO
  const { count: shipperCleared } = await supabase
    .from('shipments')
    .update({ shipper_id: null, updated_at: new Date().toISOString() })
    .in('shipper_id', intogloIds)
    .select('id', { count: 'exact', head: true });

  // Clear consignee_id where it's INTOGLO
  const { count: consigneeCleared } = await supabase
    .from('shipments')
    .update({ consignee_id: null, updated_at: new Date().toISOString() })
    .in('consignee_id', intogloIds)
    .select('id', { count: 'exact', head: true });

  return (shipperCleared || 0) + (consigneeCleared || 0);
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const anthropic = new Anthropic({ apiKey: ANTHROPIC_KEY });

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('EXTRACTING ACTUAL SHIPPER/CONSIGNEE FROM HBL (v3)');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');

  // Step 1: Clear INTOGLO links
  console.log('Step 1: Clearing INTOGLO links from shipments...');
  const cleared = await clearIntogloLinks(supabase);
  console.log(`Cleared ${cleared} INTOGLO links`);
  console.log('');

  // Step 2: Find matched HBL attachments
  console.log('Step 2: Finding HBL attachments...');
  const matched = await findMatchedHBLAttachments(supabase);
  console.log(`Found ${matched.length} unique shipment-HBL matches`);
  console.log('');

  // Step 3: Process each
  let success = 0;
  let errors = 0;

  for (let i = 0; i < matched.length; i++) {
    const attachment = matched[i];
    console.log(`[${i + 1}/${matched.length}] ${attachment.filename.substring(0, 50)}`);

    try {
      const extraction = await extractPartiesFromHBL(anthropic, attachment.extracted_text);

      let shipperId: string | null = null;
      let consigneeId: string | null = null;

      if (extraction.shipper?.name) {
        try {
          shipperId = await findOrCreateParty(supabase, extraction.shipper, 'shipper');
          console.log(`    ✓ Shipper: ${extraction.shipper.name.substring(0, 40)}`);
        } catch (e) {
          console.log(`    ✗ Shipper skipped: ${e instanceof Error ? e.message : 'error'}`);
        }
      }

      if (extraction.consignee?.name) {
        try {
          consigneeId = await findOrCreateParty(supabase, extraction.consignee, 'consignee');
          console.log(`    ✓ Consignee: ${extraction.consignee.name.substring(0, 40)}`);
        } catch (e) {
          console.log(`    ✗ Consignee skipped: ${e instanceof Error ? e.message : 'error'}`);
        }
      }

      // Update shipment
      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (shipperId) updates.shipper_id = shipperId;
      if (consigneeId) updates.consignee_id = consigneeId;

      if (shipperId || consigneeId) {
        await supabase.from('shipments').update(updates).eq('id', attachment.shipment_id);
        success++;
      }

      await new Promise(r => setTimeout(r, 300));

    } catch (error) {
      console.log(`    ERROR: ${error instanceof Error ? error.message : 'Unknown'}`);
      errors++;
    }

    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Success: ${success}`);
  console.log(`Errors: ${errors}`);
}

main().catch(console.error);
