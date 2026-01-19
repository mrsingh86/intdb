#!/usr/bin/env npx tsx
/**
 * Test entity extraction on a few emails
 */

import dotenv from 'dotenv';
dotenv.config();

import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function testExtraction() {
  // Get booking confirmation emails
  const { data: classifications } = await supabase
    .from('document_classifications')
    .select('email_id')
    .eq('document_type', 'booking_confirmation');

  if (!classifications || classifications.length === 0) {
    console.log('No booking confirmation emails found');
    return;
  }

  const emailIds = classifications.map(c => c.email_id);

  // Get emails with content
  const { data: allEmails } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text')
    .in('id', emailIds);

  const emailsWithContent = allEmails?.filter(e => e.body_text && e.body_text.length > 100) || [];
  console.log(`Found ${emailsWithContent.length} emails with body content\n`);

  // Process first 3
  for (const emailData of emailsWithContent.slice(0, 3)) {
    console.log('\n' + '═'.repeat(70));
    console.log('Subject:', emailData.subject?.substring(0, 70));
    console.log('Body length:', emailData.body_text?.length || 0);

    // Build prompt
    const bodyPreview = (emailData.body_text || '').substring(0, 5000);
    const prompt = `Extract shipping information from this booking confirmation email.

SUBJECT: ${emailData.subject || 'N/A'}

EMAIL CONTENT:
${bodyPreview}

EXTRACTION RULES:
1. VESSEL NAME: Look for "Vessel:", "V/N:", "MV", "Mother Vessel:"
2. VOYAGE: Look for "Voyage:", "Voy:" - usually alphanumeric
3. PORT OF LOADING: Look for "POL:", "Load Port:", sea port name
4. PORT OF DISCHARGE: Look for "POD:", "Discharge Port:", sea port name
5. ETD/ETA: Look for dates for OCEAN vessel, format as YYYY-MM-DD
6. CUTOFFS: SI/VGM/Cargo cutoffs, format as YYYY-MM-DD
7. SHIPPER/CONSIGNEE: Company names
8. BOOKING NUMBER: Various formats

Return ONLY valid JSON (no markdown):
{
  "booking_number": "string or null",
  "vessel_name": "string or null",
  "voyage_number": "string or null",
  "port_of_loading": "string or null",
  "port_of_discharge": "string or null",
  "etd": "YYYY-MM-DD or null",
  "eta": "YYYY-MM-DD or null",
  "si_cutoff": "YYYY-MM-DD or null",
  "vgm_cutoff": "YYYY-MM-DD or null",
  "cargo_cutoff": "YYYY-MM-DD or null",
  "shipper_name": "string or null",
  "consignee_name": "string or null",
  "confidence": 0-100
}`;

    console.log('\nCalling Claude Haiku...');

    try {
      const response = await anthropic.messages.create({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: 1000,
        temperature: 0.1,
        messages: [{ role: 'user', content: prompt }]
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        console.log('No text response');
        continue;
      }

      // Parse JSON
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        console.log('\nExtracted:');
        console.log('  Booking:', parsed.booking_number || '-');
        console.log('  Vessel:', parsed.vessel_name || '-');
        console.log('  Voyage:', parsed.voyage_number || '-');
        console.log('  POL:', parsed.port_of_loading || '-');
        console.log('  POD:', parsed.port_of_discharge || '-');
        console.log('  ETD:', parsed.etd || '-');
        console.log('  ETA:', parsed.eta || '-');
        console.log('  SI Cutoff:', parsed.si_cutoff || '-');
        console.log('  VGM Cutoff:', parsed.vgm_cutoff || '-');
        console.log('  Cargo Cutoff:', parsed.cargo_cutoff || '-');
        console.log('  Shipper:', parsed.shipper_name || '-');
        console.log('  Consignee:', parsed.consignee_name || '-');
        console.log('  Confidence:', parsed.confidence || '-');
      } else {
        console.log('Could not parse JSON from response');
        console.log(content.text);
      }
    } catch (error: unknown) {
      console.error('Error:', error instanceof Error ? error.message : 'Unknown');
    }

    // Rate limit
    await new Promise(r => setTimeout(r, 1000));
  }
}

testExtraction().catch(console.error);
