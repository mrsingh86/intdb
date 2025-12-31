#!/usr/bin/env npx tsx
/**
 * Entity Extraction Script
 * Runs classification on unclassified emails and extracts entities
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('Using Supabase URL:', supabaseUrl);

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  console.error('SUPABASE_URL:', supabaseUrl);
  console.error('Has key:', !!supabaseKey);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const anthropic = new Anthropic();

const BATCH_SIZE = 50;
const EXTRACTABLE_TYPES = [
  'booking_confirmation',
  'shipping_instruction',
  'si_draft',
  'bill_of_lading',
  'arrival_notice',
  'vgm_confirmation',
  'packing_list',
  'commercial_invoice'
];

interface Email {
  id: string;
  subject: string;
  body_text: string;
  sender_email: string;
}

interface Classification {
  id: string;
  email_id: string;
  document_type: string;
  confidence_score: number;
}

async function classifyEmail(email: Email): Promise<{ document_type: string; confidence: number }> {
  const prompt = `Classify this shipping/logistics email into ONE of these categories:
- booking_confirmation: Carrier confirmation of booking
- shipping_instruction: SI or shipping instruction documents
- si_draft: Draft SI for review
- bill_of_lading: BL, HBL, MBL documents
- arrival_notice: Arrival notifications
- vgm_confirmation: Verified Gross Mass confirmations
- packing_list: Packing lists
- commercial_invoice: Commercial invoices
- customs_clearance: Customs-related documents
- rate_quote: Rate quotes
- delivery_order: Delivery orders
- general_correspondence: Other shipping communication
- marketing: Marketing/promotional
- internal: Internal communication
- unknown: Cannot classify

Email Subject: ${email.subject}
Email From: ${email.sender_email}
Email Body (first 2000 chars): ${(email.body_text || '').substring(0, 2000)}

Respond with JSON only: {"document_type": "...", "confidence": 0.85}`;

  const response = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 100,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  try {
    const match = text.match(/\{[^}]+\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
  } catch (e) {
    // Parse error
  }
  return { document_type: 'unknown', confidence: 0.5 };
}

async function extractEntities(email: Email, documentType: string): Promise<Record<string, any>> {
  const prompt = `Extract shipping entities from this ${documentType} email.

Email Subject: ${email.subject}
Email From: ${email.sender_email}
Email Body: ${(email.body_text || '').substring(0, 3000)}

Extract these fields (use null if not found):
- booking_number: Carrier booking reference
- bl_number: Bill of lading number
- vessel_name: Ship name
- voyage_number: Voyage ID
- container_numbers: Array of container IDs
- port_of_loading: Origin port
- port_of_discharge: Destination port
- etd: Estimated time of departure (ISO date)
- eta: Estimated time of arrival (ISO date)
- shipper_name: Shipper company
- consignee_name: Consignee company
- commodity: Cargo description
- weight_kg: Weight in KG
- container_count: Number of containers

Respond with JSON only.`;

  const response = await anthropic.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
  } catch (e) {
    // Parse error
  }
  return {};
}

async function fetchAllIds(table: string, column: string = 'id'): Promise<string[]> {
  const allIds: string[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(column)
      .range(offset, offset + pageSize - 1);

    if (error || !data || data.length === 0) break;

    allIds.push(...data.map((r: any) => r[column]));

    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return allIds;
}

async function main() {
  console.log('============================================================');
  console.log('ENTITY EXTRACTION - INTDB PROJECT');
  console.log('============================================================');

  // Step 1: Get all email IDs with pagination
  console.log('\nFetching all email IDs...');
  const allEmailIds = await fetchAllIds('raw_emails', 'id');

  console.log('Fetching existing classifications...');
  const classifiedEmailIds = await fetchAllIds('document_classifications', 'email_id');

  const classifiedIds = new Set(classifiedEmailIds);
  const unclassifiedIds = allEmailIds.filter(id => !classifiedIds.has(id));

  console.log(`\nTotal emails: ${allEmailIds.length}`);
  console.log(`Already classified: ${classifiedIds.size}`);
  console.log(`Need classification: ${unclassifiedIds.length}`);

  // Step 2: Classify emails in batches
  let classified = 0;
  let extracted = 0;
  const errors: string[] = [];

  for (let i = 0; i < unclassifiedIds.length; i += BATCH_SIZE) {
    const batchIds = unclassifiedIds.slice(i, i + BATCH_SIZE);
    console.log(`\nClassifying batch ${Math.floor(i/BATCH_SIZE) + 1} (${batchIds.length} emails)...`);

    // Fetch full email data
    const { data: emails, error: fetchError } = await supabase
      .from('raw_emails')
      .select('id, subject, body_text, sender_email')
      .in('id', batchIds);

    if (fetchError) {
      console.log(`  Fetch error: ${fetchError.message}`);
      continue;
    }
    console.log(`  Fetched ${emails?.length || 0} emails`);

    for (const email of emails || []) {
      try {
        // Classify
        console.log(`  Processing: ${email.subject?.substring(0, 50)}...`);
        const result = await classifyEmail(email);
        console.log(`  -> ${result.document_type} (${result.confidence})`);

        // Save classification
        const insertData = {
          email_id: email.id,
          document_type: result.document_type,
          confidence_score: result.confidence,
          model_name: 'claude-3-5-haiku-20241022',
          model_version: '20241022',
          classified_at: new Date().toISOString()
        };

        const { data: classif, error: classifError } = await supabase
          .from('document_classifications')
          .insert(insertData)
          .select()
          .single();

        if (classifError) {
          console.log(`  INSERT ERROR: ${classifError.message}`);
          console.log(`  Insert data: ${JSON.stringify(insertData)}`);
          errors.push(`Classify ${email.id}: ${classifError.message}`);
          continue;
        }
        console.log(`  SAVED classification ${classif?.id}`);

        classified++;
        process.stdout.write('.');

        // Extract entities if extractable type
        if (EXTRACTABLE_TYPES.includes(result.document_type) && result.confidence >= 0.7) {
          const entities = await extractEntities(email, result.document_type);

          // Insert each entity as separate row (EAV pattern)
          let entityCount = 0;
          for (const [entityType, entityValue] of Object.entries(entities)) {
            if (entityValue === null || entityValue === undefined || entityValue === '') continue;

            // Handle arrays (like container_numbers)
            const values = Array.isArray(entityValue) ? entityValue : [entityValue];

            for (const val of values) {
              if (!val) continue;

              const { error: extractError } = await supabase
                .from('entity_extractions')
                .insert({
                  email_id: email.id,
                  classification_id: classif.id,
                  source_document_type: result.document_type,
                  entity_type: entityType,
                  entity_value: String(val),
                  extraction_method: 'ai_claude_haiku',
                  confidence_score: result.confidence,
                  extracted_at: new Date().toISOString()
                });

              if (extractError) {
                console.log(`  Entity error: ${extractError.message}`);
              } else {
                entityCount++;
              }
            }
          }

          if (entityCount > 0) {
            extracted += entityCount;
            console.log(`  Extracted ${entityCount} entities`);
          }
        }

        // Update raw_email status
        await supabase
          .from('raw_emails')
          .update({ processing_status: 'classified' })
          .eq('id', email.id);

      } catch (error: any) {
        errors.push(`Process ${email.id}: ${error.message}`);
      }
    }
  }

  console.log('\n');
  console.log('============================================================');
  console.log('EXTRACTION COMPLETE');
  console.log('============================================================');
  console.log(`Emails classified: ${classified}`);
  console.log(`Entities extracted: ${extracted}`);
  console.log(`Errors: ${errors.length}`);

  if (errors.length > 0) {
    console.log('\nFirst 10 errors:');
    errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
  }

  // Cost estimate
  const classifyCost = classified * 0.0008;
  const extractCost = extracted * 0.0014;
  console.log(`\nEstimated cost: $${(classifyCost + extractCost).toFixed(4)}`);
}

main().catch(console.error);
