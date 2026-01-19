/**
 * ENHANCED EMAIL PROCESSING WITH DOCUMENT HIERARCHY
 *
 * Integrates all new services:
 * 1. Classification → document_classifications
 * 2. Document Revision Tracking → document_revisions
 * 3. Authority-based Entity Extraction → entity_extractions
 * 4. Shipment Linking → shipments
 * 5. Workflow State Transitions → shipment_workflow_history
 * 6. Milestone Recording → shipment_milestones
 *
 * Run with: NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npx tsx scripts/process-with-hierarchy.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';

// Services
import { DocumentAuthorityService } from '../lib/services/document-authority-service';
import { DocumentRevisionService } from '../lib/services/document-revision-service';
import { WorkflowStateService } from '../lib/services/workflow-state-service';
import { MilestoneTrackingService } from '../lib/services/milestone-tracking-service';

// Initialize clients
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Initialize services
const authorityService = new DocumentAuthorityService(supabase);
const revisionService = new DocumentRevisionService(supabase);
const workflowService = new WorkflowStateService(supabase);
const milestoneService = new MilestoneTrackingService(supabase);

const HAIKU_MODEL = 'claude-3-5-haiku-20241022';

interface ProcessingStats {
  emails_processed: number;
  emails_skipped: number;
  classifications_created: number;
  revisions_tracked: number;
  entities_extracted: number;
  shipments_created: number;
  shipments_updated: number;
  workflow_transitions: number;
  milestones_recorded: number;
  errors: string[];
}

async function processWithHierarchy() {
  console.log('\n╔══════════════════════════════════════════════════════════════════════════════╗');
  console.log('║          DOCUMENT HIERARCHY ENHANCED EMAIL PROCESSING                        ║');
  console.log('╚══════════════════════════════════════════════════════════════════════════════╝\n');

  const stats: ProcessingStats = {
    emails_processed: 0,
    emails_skipped: 0,
    classifications_created: 0,
    revisions_tracked: 0,
    entities_extracted: 0,
    shipments_created: 0,
    shipments_updated: 0,
    workflow_transitions: 0,
    milestones_recorded: 0,
    errors: [],
  };

  try {
    // Get unprocessed emails (processed but not hierarchy-processed)
    const { data: emails, error } = await supabase
      .from('raw_emails')
      .select(`
        id,
        gmail_message_id,
        thread_id,
        subject,
        sender_email,
        body_text,
        received_at,
        document_classifications (
          id,
          document_type,
          confidence_score
        )
      `)
      .eq('processing_status', 'processed')
      .order('received_at', { ascending: true })
      .limit(50);

    if (error) throw error;

    console.log(`📧 Found ${emails?.length || 0} emails to process\n`);

    for (const email of emails || []) {
      try {
        await processEmail(email, stats);
        stats.emails_processed++;

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (err: any) {
        console.error(`❌ Error processing ${email.id}: ${err.message}`);
        stats.errors.push(`${email.id}: ${err.message}`);
      }
    }

  } catch (err: any) {
    console.error('Fatal error:', err);
  } finally {
    printSummary(stats);
  }
}

async function processEmail(email: any, stats: ProcessingStats) {
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`📧 Processing: ${email.subject?.substring(0, 60)}...`);
  console.log(`   ID: ${email.id}`);

  // STEP 1: Get or create classification
  let classification = email.document_classifications?.[0];

  if (!classification) {
    console.log('   → Classifying...');
    classification = await classifyEmail(email);
    stats.classifications_created++;
  }

  const documentType = classification.document_type;
  console.log(`   ✓ Type: ${documentType} (${classification.confidence_score}%)`);

  // Skip non-shipping documents
  if (documentType === 'other' || documentType === 'spam') {
    console.log('   ⏭️  Skipping non-shipping document');
    stats.emails_skipped++;
    return;
  }

  // STEP 2: Extract entities with document authority
  console.log('   → Extracting entities...');
  const entities = await extractEntitiesWithAuthority(email, documentType);
  stats.entities_extracted += entities.length;
  console.log(`   ✓ Extracted ${entities.length} entities`);

  // STEP 3: Find or create shipment
  const bookingNumber = entities.find(e => e.entity_type === 'booking_number')?.entity_value;
  const blNumber = entities.find(e => e.entity_type === 'bl_number')?.entity_value;

  if (!bookingNumber && !blNumber) {
    console.log('   ⚠️  No booking/BL number found - cannot link to shipment');
    return;
  }

  let shipment = await findOrCreateShipment(bookingNumber, blNumber, entities, email);

  if (shipment.is_new) {
    stats.shipments_created++;
    console.log(`   ✓ Created shipment: ${shipment.id}`);
  } else {
    stats.shipments_updated++;
    console.log(`   ✓ Updated shipment: ${shipment.id}`);
  }

  // STEP 4: Track document revision
  console.log('   → Tracking document revision...');
  const revisionResult = await revisionService.registerRevision(
    shipment.id,
    documentType,
    email.id,
    {
      subject: email.subject,
      body_text: email.body_text,
      classification_id: classification.id,
      received_at: email.received_at,
      extracted_entities: Object.fromEntries(
        entities.map(e => [e.entity_type, e.entity_value])
      ),
    }
  );

  if (revisionResult.is_new_revision) {
    stats.revisions_tracked++;
    console.log(`   ✓ Revision ${revisionResult.revision.revision_number} tracked`);

    if (Object.keys(revisionResult.changed_fields).length > 0) {
      console.log(`   → Changes: ${Object.keys(revisionResult.changed_fields).join(', ')}`);
    }
  } else if (revisionResult.is_duplicate) {
    console.log('   ⏭️  Duplicate content - skipped');
  }

  // STEP 5: Update workflow state
  console.log('   → Updating workflow...');
  const workflowResult = await workflowService.autoTransitionFromDocument(
    shipment.id,
    documentType,
    email.id
  );

  if (workflowResult?.success) {
    stats.workflow_transitions++;
    console.log(`   ✓ Workflow: ${workflowResult.from_state || 'none'} → ${workflowResult.to_state}`);
  }

  // STEP 6: Record milestone
  console.log('   → Recording milestone...');
  const milestone = await milestoneService.autoRecordFromDocument(
    shipment.id,
    documentType,
    email.id
  );

  if (milestone) {
    stats.milestones_recorded++;
    console.log(`   ✓ Milestone: ${milestone.milestone_code}`);
  }

  console.log('   ✅ Complete');
}

async function classifyEmail(email: any): Promise<any> {
  const content = email.body_text || email.subject || '';

  const prompt = `Classify this shipping email:

Subject: ${email.subject}
From: ${email.sender_email}
Content: ${content.substring(0, 3000)}

Document Types:
- booking_confirmation: Booking accepted by shipping line
- si_draft: Shipping Instructions draft from shipper
- si_confirmation: SI confirmed by shipping line
- house_bl: House Bill of Lading
- arrival_notice: Arrival notification at destination
- commercial_invoice: Commercial invoice
- packing_list: Packing list
- duty_summary: Customs duty summary
- vgm_confirmation: VGM submission confirmation
- container_release: Container release notice
- deadline_advisory: Cutoff/deadline notification
- rollover_notice: Vessel rollover notification
- delivery_order: Delivery order
- other: Not a shipping document

Respond in JSON:
{"document_type": "type", "confidence_score": 0-100, "reasoning": "brief reason"}`;

  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in classification response');

  const result = JSON.parse(jsonMatch[0].replace(/[\u0000-\u001F]/g, ''));

  // Save classification
  const { data, error } = await supabase
    .from('document_classifications')
    .insert({
      email_id: email.id,
      document_type: result.document_type,
      confidence_score: result.confidence_score,
      model_name: HAIKU_MODEL,
      classification_reason: result.reasoning,
    })
    .select()
    .single();

  if (error) throw error;

  return data;
}

async function extractEntitiesWithAuthority(email: any, documentType: string): Promise<any[]> {
  // Get what entities this document type is authoritative for
  const authorityRules = await authorityService.getRulesForDocument(documentType);
  const entityTypes = authorityRules.map(r => r.entity_type);

  if (entityTypes.length === 0) {
    // Fallback to basic extraction
    return extractBasicEntities(email);
  }

  const content = email.body_text || email.subject || '';

  const prompt = `Extract these specific entities from this shipping document:

Document Type: ${documentType}
Entities to extract: ${entityTypes.join(', ')}

Subject: ${email.subject}
Content: ${content.substring(0, 4000)}

Return JSON array:
[
  {"entity_type": "booking_number", "entity_value": "ABC123", "confidence_score": 95},
  ...
]

Only extract the entities listed above. Return [] if none found.`;

  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);

  if (!jsonMatch) return [];

  const entities = JSON.parse(jsonMatch[0].replace(/[\u0000-\u001F]/g, ''));

  // Add authority level to each entity
  for (const entity of entities) {
    const rule = authorityRules.find(r => r.entity_type === entity.entity_type);
    entity.authority_level = rule?.authority_level || 999;
    entity.source_document_type = documentType;
  }

  // Save entities
  if (entities.length > 0) {
    await supabase.from('entity_extractions').insert(
      entities.map((e: any) => ({
        email_id: email.id,
        entity_type: e.entity_type,
        entity_value: e.entity_value,
        confidence_score: e.confidence_score,
        extraction_method: 'ai_with_authority',
        source_document_type: documentType,
        authority_level: e.authority_level,
      }))
    );
  }

  return entities;
}

async function extractBasicEntities(email: any): Promise<any[]> {
  const content = email.body_text || email.subject || '';

  const prompt = `Extract shipping entities from:

Subject: ${email.subject}
Content: ${content.substring(0, 3000)}

Extract if present:
- booking_number, bl_number, container_number
- vessel_name, voyage_number
- port_of_loading, port_of_discharge
- etd (YYYY-MM-DD format), eta (YYYY-MM-DD format)

Return JSON array: [{"entity_type": "...", "entity_value": "...", "confidence_score": 0-100}]`;

  const response = await anthropic.messages.create({
    model: HAIKU_MODEL,
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\[[\s\S]*\]/);

  if (!jsonMatch) return [];

  const entities = JSON.parse(jsonMatch[0].replace(/[\u0000-\u001F]/g, ''));

  // Save entities
  if (entities.length > 0) {
    await supabase.from('entity_extractions').insert(
      entities.map((e: any) => ({
        email_id: email.id,
        entity_type: e.entity_type,
        entity_value: e.entity_value,
        confidence_score: e.confidence_score,
        extraction_method: 'ai_basic',
      }))
    );
  }

  return entities;
}

async function findOrCreateShipment(
  bookingNumber: string | undefined,
  blNumber: string | undefined,
  entities: any[],
  email: any
): Promise<{ id: string; is_new: boolean }> {
  // Try to find existing shipment
  let shipment = null;

  if (bookingNumber) {
    const { data } = await supabase
      .from('shipments')
      .select('id')
      .eq('booking_number', bookingNumber)
      .single();
    shipment = data;
  }

  if (!shipment && blNumber) {
    const { data } = await supabase
      .from('shipments')
      .select('id')
      .eq('bl_number', blNumber)
      .single();
    shipment = data;
  }

  if (shipment) {
    // Update existing shipment with new entities (respecting authority)
    await updateShipmentWithAuthority(shipment.id, entities);
    return { id: shipment.id, is_new: false };
  }

  // Create new shipment
  const getEntity = (type: string) => entities.find(e => e.entity_type === type)?.entity_value;

  const { data: newShipment, error } = await supabase
    .from('shipments')
    .insert({
      booking_number: bookingNumber,
      bl_number: blNumber,
      vessel_name: getEntity('vessel_name'),
      voyage_number: getEntity('voyage_number'),
      port_of_loading: getEntity('port_of_loading'),
      port_of_discharge: getEntity('port_of_discharge'),
      etd: getEntity('etd'),
      eta: getEntity('eta'),
      status: 'booked',
      created_from_email_id: email.id,
    })
    .select('id')
    .single();

  if (error) throw error;

  // Initialize workflow and milestones for new shipment
  await workflowService.initializeWorkflow(newShipment.id);
  await milestoneService.initializeMilestones(
    newShipment.id,
    getEntity('etd'),
    getEntity('eta')
  );

  return { id: newShipment.id, is_new: true };
}

async function updateShipmentWithAuthority(shipmentId: string, entities: any[]) {
  // Get current shipment
  const { data: shipment } = await supabase
    .from('shipments')
    .select('*')
    .eq('id', shipmentId)
    .single();

  if (!shipment) return;

  const updates: Record<string, any> = {};

  // Map entity types to shipment columns
  const fieldMapping: Record<string, string> = {
    vessel_name: 'vessel_name',
    voyage_number: 'voyage_number',
    port_of_loading: 'port_of_loading',
    port_of_discharge: 'port_of_discharge',
    etd: 'etd',
    eta: 'eta',
    shipper_name: 'shipper_name',
    consignee_name: 'consignee_name',
  };

  for (const entity of entities) {
    const column = fieldMapping[entity.entity_type];
    if (!column) continue;

    // Check if we should update based on authority
    const resolution = await authorityService.resolveAuthority(
      entity.entity_type,
      entity.source_document_type,
      shipment[`${column}_source`] // Would need to track source per field
    );

    if (resolution.should_update) {
      updates[column] = entity.entity_value;
    }
  }

  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();
    await supabase
      .from('shipments')
      .update(updates)
      .eq('id', shipmentId);
  }
}

function printSummary(stats: ProcessingStats) {
  console.log('\n\n' + '═'.repeat(80));
  console.log('                           PROCESSING SUMMARY');
  console.log('═'.repeat(80));
  console.log(`  Emails Processed:       ${stats.emails_processed}`);
  console.log(`  Emails Skipped:         ${stats.emails_skipped}`);
  console.log(`  Classifications:        ${stats.classifications_created}`);
  console.log(`  Revisions Tracked:      ${stats.revisions_tracked}`);
  console.log(`  Entities Extracted:     ${stats.entities_extracted}`);
  console.log(`  Shipments Created:      ${stats.shipments_created}`);
  console.log(`  Shipments Updated:      ${stats.shipments_updated}`);
  console.log(`  Workflow Transitions:   ${stats.workflow_transitions}`);
  console.log(`  Milestones Recorded:    ${stats.milestones_recorded}`);

  if (stats.errors.length > 0) {
    console.log(`\n  Errors (${stats.errors.length}):`);
    stats.errors.slice(0, 5).forEach(e => console.log(`    - ${e}`));
    if (stats.errors.length > 5) {
      console.log(`    ... and ${stats.errors.length - 5} more`);
    }
  }

  console.log('═'.repeat(80));
  console.log('✅ Processing complete!\n');
}

// Run
processWithHierarchy().catch(console.error);
