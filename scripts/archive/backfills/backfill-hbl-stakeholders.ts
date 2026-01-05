/**
 * Backfill HBL Stakeholders
 *
 * Re-extracts shipper/consignee/notify_party from existing BL/HBL/SI documents
 * using the new document-type specific extraction hints.
 *
 * Usage:
 *   npx tsx scripts/backfill-hbl-stakeholders.ts [--dry-run] [--limit N]
 *
 * Options:
 *   --dry-run   Show what would be updated without making changes
 *   --limit N   Process only N emails (default: all)
 */

import { createClient } from '@supabase/supabase-js';
import { ShipmentExtractionService } from '../lib/services/shipment-extraction-service';
import * as dotenv from 'dotenv';

// Try .env.local first, then .env
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;

if (!SUPABASE_URL || !SUPABASE_KEY || !ANTHROPIC_KEY) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Document types that should have stakeholder info (real customer data)
// Only HBL documents for this backfill
const STAKEHOLDER_DOC_TYPES = [
  'hbl_draft',
  'hbl',
];

interface BackfillResult {
  emailId: string;
  documentType: string;
  shipmentId: string | null;
  extracted: {
    shipper_name: string | null;
    consignee_name: string | null;
    notify_party: string | null;
  };
  updated: boolean;
  error?: string;
}

async function getEmailsToBackfill(limit?: number): Promise<Array<{
  email_id: string;
  document_type: string;
  shipment_id: string | null;
  subject: string;
  body_text: string;
  sender_email: string;
  true_sender_email: string | null;
}>> {
  // Find emails with BL/SI document types that are linked to shipments
  // and where the shipment is missing stakeholder info
  const query = supabase
    .from('document_classifications')
    .select(`
      email_id,
      document_type,
      raw_emails!inner(
        id,
        subject,
        body_text,
        sender_email,
        true_sender_email
      ),
      shipment_documents(
        shipment_id,
        shipments(
          id,
          shipper_name,
          consignee_name,
          notify_party_name
        )
      )
    `)
    .in('document_type', STAKEHOLDER_DOC_TYPES)
    .order('created_at', { ascending: false });

  if (limit) {
    query.limit(limit);
  }

  const { data, error } = await query;

  if (error) {
    console.error('Error fetching emails:', error);
    return [];
  }

  // Filter to emails linked to shipments missing stakeholder info
  const results: Array<{
    email_id: string;
    document_type: string;
    shipment_id: string | null;
    subject: string;
    body_text: string;
    sender_email: string;
    true_sender_email: string | null;
  }> = [];

  for (const row of data || []) {
    const email = row.raw_emails as any;
    const shipmentDocs = row.shipment_documents as any[];

    // Get linked shipment (if any)
    let shipmentId: string | null = null;
    let needsStakeholders = false;

    if (shipmentDocs && shipmentDocs.length > 0) {
      const shipmentDoc = shipmentDocs[0];
      if (shipmentDoc.shipments) {
        const shipment = shipmentDoc.shipments;
        shipmentId = shipment.id;
        // Check if missing any stakeholder info
        needsStakeholders = !shipment.shipper_name || !shipment.consignee_name;
      }
    }

    // Include if has linked shipment that needs stakeholders
    // OR if no shipment link (we still want to extract for entity_extractions)
    if (needsStakeholders || !shipmentId) {
      results.push({
        email_id: row.email_id,
        document_type: row.document_type,
        shipment_id: shipmentId,
        subject: email.subject || '',
        body_text: email.body_text || '',
        sender_email: email.sender_email || '',
        true_sender_email: email.true_sender_email,
      });
    }
  }

  return results;
}

async function getPdfContent(emailId: string): Promise<string> {
  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('filename, extracted_text, mime_type')
    .eq('email_id', emailId);

  let pdfContent = '';
  for (const att of attachments || []) {
    const isPdf = att.mime_type?.includes('pdf') || att.filename?.toLowerCase().endsWith('.pdf');
    if (att.extracted_text && isPdf) {
      pdfContent += `\n--- ${att.filename} ---\n${att.extracted_text}\n`;
    }
  }

  return pdfContent;
}

function detectCarrier(senderEmail: string, content: string): string {
  const combined = `${senderEmail} ${content}`.toLowerCase();

  if (combined.includes('hapag') || combined.includes('hlag') || combined.includes('hlcu')) {
    return 'hapag-lloyd';
  }
  if (combined.includes('maersk') || combined.includes('maeu') || combined.includes('msku')) {
    return 'maersk';
  }
  if (combined.includes('cma-cgm') || combined.includes('cma cgm') || combined.includes('cmau')) {
    return 'cma-cgm';
  }
  if (combined.includes('msc') && !combined.includes('misc')) {
    return 'msc';
  }
  if (combined.includes('cosco') || combined.includes('cosu')) {
    return 'cosco';
  }

  return 'default';
}

async function backfillEmail(
  email: {
    email_id: string;
    document_type: string;
    shipment_id: string | null;
    subject: string;
    body_text: string;
    sender_email: string;
    true_sender_email: string | null;
  },
  extractionService: ShipmentExtractionService,
  dryRun: boolean
): Promise<BackfillResult> {
  const result: BackfillResult = {
    emailId: email.email_id,
    documentType: email.document_type,
    shipmentId: email.shipment_id,
    extracted: {
      shipper_name: null,
      consignee_name: null,
      notify_party: null,
    },
    updated: false,
  };

  try {
    // Get PDF content
    const pdfContent = await getPdfContent(email.email_id);

    // Detect carrier
    const carrier = detectCarrier(
      email.true_sender_email || email.sender_email,
      `${email.subject} ${email.body_text} ${pdfContent}`
    );

    // Extract with document-type hints
    const extractionResult = await extractionService.extractFromContent({
      emailId: email.email_id,
      subject: email.subject,
      bodyText: email.body_text,
      pdfContent,
      carrier,
      documentType: email.document_type,  // This triggers HBL-specific extraction
    });

    if (!extractionResult.success || !extractionResult.data) {
      result.error = extractionResult.error || 'Extraction failed';
      return result;
    }

    const data = extractionResult.data;
    result.extracted = {
      shipper_name: data.shipper_name,
      consignee_name: data.consignee_name,
      notify_party: data.notify_party,
    };

    // Check if we found any stakeholder info
    const hasStakeholders = data.shipper_name || data.consignee_name || data.notify_party;

    if (!hasStakeholders) {
      result.error = 'No stakeholder info found in document';
      return result;
    }

    if (dryRun) {
      result.updated = false;
      return result;
    }

    // Skip Intoglo (our own company)
    const isIntoglo = (name: string | null | undefined): boolean => {
      if (!name) return false;
      return name.toLowerCase().includes('intoglo');
    };

    // Update entity_extractions
    const entities: Array<{
      email_id: string;
      entity_type: string;
      entity_value: string;
      confidence_score: number;
      extraction_method: string;
    }> = [];

    if (data.shipper_name && !isIntoglo(data.shipper_name)) {
      entities.push({
        email_id: email.email_id,
        entity_type: 'shipper_name',
        entity_value: data.shipper_name,
        confidence_score: 85,
        extraction_method: 'ai_backfill',
      });
    }
    if (data.shipper_address && !isIntoglo(data.shipper_name)) {
      entities.push({
        email_id: email.email_id,
        entity_type: 'shipper_address',
        entity_value: data.shipper_address,
        confidence_score: 85,
        extraction_method: 'ai_backfill',
      });
    }
    if (data.consignee_name && !isIntoglo(data.consignee_name)) {
      entities.push({
        email_id: email.email_id,
        entity_type: 'consignee_name',
        entity_value: data.consignee_name,
        confidence_score: 85,
        extraction_method: 'ai_backfill',
      });
    }
    if (data.consignee_address && !isIntoglo(data.consignee_name)) {
      entities.push({
        email_id: email.email_id,
        entity_type: 'consignee_address',
        entity_value: data.consignee_address,
        confidence_score: 85,
        extraction_method: 'ai_backfill',
      });
    }
    if (data.notify_party && !isIntoglo(data.notify_party)) {
      entities.push({
        email_id: email.email_id,
        entity_type: 'notify_party',
        entity_value: data.notify_party,
        confidence_score: 85,
        extraction_method: 'ai_backfill',
      });
    }

    if (entities.length > 0) {
      // Delete existing stakeholder entities for this email first
      // (no unique constraint exists, so upsert won't work)
      await supabase
        .from('entity_extractions')
        .delete()
        .eq('email_id', email.email_id)
        .in('entity_type', ['shipper_name', 'shipper_address', 'consignee_name', 'consignee_address', 'notify_party']);

      // Insert new entities
      const { error } = await supabase
        .from('entity_extractions')
        .insert(entities);

      if (error) {
        console.error(`\n  Error inserting entities for ${email.email_id}: ${error.message}`);
      }
    }

    // Update shipment if linked (skip Intoglo)
    if (email.shipment_id) {
      const updateData: Record<string, string> = {};

      if (data.shipper_name && !isIntoglo(data.shipper_name)) {
        updateData.shipper_name = data.shipper_name;
      }
      if (data.shipper_address && !isIntoglo(data.shipper_name)) {
        updateData.shipper_address = data.shipper_address;
      }
      if (data.consignee_name && !isIntoglo(data.consignee_name)) {
        updateData.consignee_name = data.consignee_name;
      }
      if (data.consignee_address && !isIntoglo(data.consignee_name)) {
        updateData.consignee_address = data.consignee_address;
      }
      if (data.notify_party && !isIntoglo(data.notify_party)) {
        updateData.notify_party_name = data.notify_party;
      }
      if (data.notify_party_address && !isIntoglo(data.notify_party)) {
        updateData.notify_party_address = data.notify_party_address;
      }

      if (Object.keys(updateData).length > 0) {
        updateData.updated_at = new Date().toISOString();

        await supabase
          .from('shipments')
          .update(updateData)
          .eq('id', email.shipment_id);
      }
    }

    result.updated = true;
    return result;

  } catch (error: any) {
    result.error = error.message;
    return result;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex !== -1 ? parseInt(args[limitIndex + 1], 10) : undefined;

  console.log('='.repeat(60));
  console.log('HBL Stakeholder Backfill Script');
  console.log('='.repeat(60));
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log(`Limit: ${limit || 'all'}`);
  console.log('');

  // Initialize extraction service with Haiku for speed and cost
  const extractionService = new ShipmentExtractionService(
    supabase,
    ANTHROPIC_KEY,
    { useAdvancedModel: false }  // Use Haiku - 10x cheaper, faster
  );

  // Get emails to backfill
  console.log('Finding emails to backfill...');
  const emails = await getEmailsToBackfill(limit);
  console.log(`Found ${emails.length} emails with BL/SI documents\n`);

  if (emails.length === 0) {
    console.log('No emails need backfilling.');
    return;
  }

  // Process emails in parallel batches for speed
  const results: BackfillResult[] = [];
  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  const BATCH_SIZE = 5;  // Process 5 emails in parallel

  for (let i = 0; i < emails.length; i += BATCH_SIZE) {
    const batch = emails.slice(i, i + BATCH_SIZE);
    process.stdout.write(`\r[${Math.min(i + BATCH_SIZE, emails.length)}/${emails.length}] Processing batch...`);

    // Process batch in parallel
    const batchResults = await Promise.all(
      batch.map(email => backfillEmail(email, extractionService, dryRun))
    );

    for (const result of batchResults) {
      results.push(result);
      if (result.error) {
        if (result.error === 'No stakeholder info found in document') {
          skippedCount++;
        } else {
          errorCount++;
        }
      } else if (result.updated || dryRun) {
        successCount++;
      }
    }

    // Small delay between batches to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }

  console.log('\n\n' + '='.repeat(60));
  console.log('RESULTS');
  console.log('='.repeat(60));
  console.log(`Total processed: ${emails.length}`);
  console.log(`Successfully extracted: ${successCount}`);
  console.log(`No stakeholders found: ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log('');

  // Show successful extractions
  const successResults = results.filter(r =>
    r.extracted.shipper_name || r.extracted.consignee_name || r.extracted.notify_party
  );

  if (successResults.length > 0) {
    console.log('Extracted Stakeholders:');
    console.log('-'.repeat(60));
    for (const r of successResults.slice(0, 20)) {  // Show first 20
      console.log(`  Email: ${r.emailId.substring(0, 8)}... (${r.documentType})`);
      if (r.extracted.shipper_name) {
        console.log(`    Shipper: ${r.extracted.shipper_name}`);
      }
      if (r.extracted.consignee_name) {
        console.log(`    Consignee: ${r.extracted.consignee_name}`);
      }
      if (r.extracted.notify_party) {
        console.log(`    Notify Party: ${r.extracted.notify_party}`);
      }
      if (r.shipmentId) {
        console.log(`    → Shipment: ${r.shipmentId.substring(0, 8)}... ${dryRun ? '(would update)' : '(updated)'}`);
      }
      console.log('');
    }
    if (successResults.length > 20) {
      console.log(`  ... and ${successResults.length - 20} more\n`);
    }
  }

  // Show errors
  const errorResults = results.filter(r => r.error && r.error !== 'No stakeholder info found in document');
  if (errorResults.length > 0) {
    console.log('\nErrors:');
    console.log('-'.repeat(60));
    for (const r of errorResults.slice(0, 10)) {
      console.log(`  ${r.emailId.substring(0, 8)}...: ${r.error}`);
    }
    if (errorResults.length > 10) {
      console.log(`  ... and ${errorResults.length - 10} more errors`);
    }
  }

  if (dryRun) {
    console.log('\n⚠️  DRY RUN - No changes were made.');
    console.log('   Run without --dry-run to apply changes.');
  }
}

main().catch(console.error);
