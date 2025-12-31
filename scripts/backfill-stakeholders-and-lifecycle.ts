#!/usr/bin/env npx tsx
/**
 * Backfill Stakeholders and Document Lifecycle for Existing Shipments
 *
 * Runs through all existing shipments and:
 * 1. Extracts stakeholders from entity extractions (shipper/consignee)
 * 2. Links stakeholders to shipments (shipper_id, consignee_id)
 * 3. Creates document lifecycle entries for all linked documents
 *
 * Safe to run multiple times (idempotent)
 */

import { createClient } from '@supabase/supabase-js';
import { StakeholderExtractionService, DocumentEntity, ShipmentDirection } from '../lib/services/stakeholder-extraction-service';
import { DocumentLifecycleService } from '../lib/services/document-lifecycle-service';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const stakeholderService = new StakeholderExtractionService(supabase);
const lifecycleService = new DocumentLifecycleService(supabase);

interface ShipmentWithData {
  id: string;
  booking_number: string | null;
  shipper_id: string | null;
  consignee_id: string | null;
  port_of_loading_code: string | null;
}

interface EntityExtraction {
  entity_type: string;
  entity_value: string;
  shipment_id: string;
}

interface ShipmentDocument {
  shipment_id: string;
  document_type: string;
  email_id: string;
}

async function backfillStakeholdersAndLifecycle() {
  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('BACKFILL STAKEHOLDERS & DOCUMENT LIFECYCLE');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // 1. Get all shipments
  const { data: shipments, error: shipmentError } = await supabase
    .from('shipments')
    .select('id, booking_number, shipper_id, consignee_id, port_of_loading_code')
    .order('created_at', { ascending: false });

  if (shipmentError) {
    console.error('Failed to fetch shipments:', shipmentError.message);
    process.exit(1);
  }

  console.log(`Found ${shipments?.length || 0} shipments to process`);
  console.log('');

  // Stats tracking
  const stats = {
    shipmentsProcessed: 0,
    stakeholdersCreated: 0,
    stakeholdersMatched: 0,
    shipmentsLinkedToShipper: 0,
    shipmentsLinkedToConsignee: 0,
    lifecycleEntriesCreated: 0,
    errors: 0,
  };

  // 2. Process each shipment
  for (const shipment of shipments || []) {
    stats.shipmentsProcessed++;

    try {
      // 2a. Extract stakeholders if not already linked
      if (!shipment.shipper_id || !shipment.consignee_id) {
        const stakeholderResult = await backfillStakeholdersForShipment(
          shipment as ShipmentWithData
        );
        stats.stakeholdersCreated += stakeholderResult.created;
        stats.stakeholdersMatched += stakeholderResult.matched;
        if (stakeholderResult.linkedShipper) stats.shipmentsLinkedToShipper++;
        if (stakeholderResult.linkedConsignee) stats.shipmentsLinkedToConsignee++;
      }

      // 2b. Create document lifecycle entries
      const lifecycleResult = await backfillLifecycleForShipment(shipment.id);
      stats.lifecycleEntriesCreated += lifecycleResult.created;

      // Progress indicator
      if (stats.shipmentsProcessed % 20 === 0) {
        console.log(`  Processed ${stats.shipmentsProcessed}/${shipments?.length} shipments...`);
      }
    } catch (error: any) {
      stats.errors++;
      console.warn(`  Error processing shipment ${shipment.booking_number}: ${error.message}`);
    }
  }

  // 3. Print results
  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('RESULTS');
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('STAKEHOLDERS:');
  console.log(`  Shipments processed:        ${stats.shipmentsProcessed}`);
  console.log(`  New stakeholders created:   ${stats.stakeholdersCreated}`);
  console.log(`  Existing stakeholders matched: ${stats.stakeholdersMatched}`);
  console.log(`  Shipments linked to shipper:   ${stats.shipmentsLinkedToShipper}`);
  console.log(`  Shipments linked to consignee: ${stats.shipmentsLinkedToConsignee}`);
  console.log('');
  console.log('DOCUMENT LIFECYCLE:');
  console.log(`  Lifecycle entries created:  ${stats.lifecycleEntriesCreated}`);
  console.log('');
  console.log(`Errors: ${stats.errors}`);
  console.log('════════════════════════════════════════════════════════════════════════════════');

  // 4. Show current database state
  await showDatabaseState();
}

async function backfillStakeholdersForShipment(shipment: ShipmentWithData): Promise<{
  created: number;
  matched: number;
  linkedShipper: boolean;
  linkedConsignee: boolean;
}> {
  const result = { created: 0, matched: 0, linkedShipper: false, linkedConsignee: false };

  // Get entity extractions for this shipment
  const { data: entities } = await supabase
    .from('entity_extractions')
    .select('entity_type, entity_value, shipment_id')
    .eq('shipment_id', shipment.id);

  // Build document entities from extractions
  const docEntities: DocumentEntity = {};

  for (const entity of entities || []) {
    if (entity.entity_type === 'shipper' || entity.entity_type === 'shipper_name') {
      docEntities.shipper = { name: entity.entity_value };
    }
    if (entity.entity_type === 'consignee' || entity.entity_type === 'consignee_name') {
      docEntities.consignee = { name: entity.entity_value };
    }
  }

  // Skip if no stakeholder info
  if (!docEntities.shipper && !docEntities.consignee) {
    return result;
  }

  // Determine direction
  const direction: ShipmentDirection =
    shipment.port_of_loading_code?.startsWith('IN') ? 'export' : 'import';

  // Extract stakeholders
  const extractionResult = await stakeholderService.extractFromDocument(
    docEntities,
    'booking_confirmation',
    direction,
    shipment.id
  );

  result.created = extractionResult.created.length;
  result.matched = extractionResult.matched.length;

  // Link to shipment
  const allParties = [...extractionResult.created, ...extractionResult.matched];
  const updates: Record<string, string> = {};

  for (const party of allParties) {
    if (party.party_type === 'shipper' && !shipment.shipper_id) {
      updates.shipper_id = party.id;
      result.linkedShipper = true;
    }
    if (party.party_type === 'consignee' && !shipment.consignee_id) {
      updates.consignee_id = party.id;
      result.linkedConsignee = true;
    }
  }

  if (Object.keys(updates).length > 0) {
    await supabase
      .from('shipments')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', shipment.id);
  }

  return result;
}

async function backfillLifecycleForShipment(shipmentId: string): Promise<{ created: number }> {
  let created = 0;

  // Get all documents linked to this shipment
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select('shipment_id, document_type, email_id')
    .eq('shipment_id', shipmentId);

  // Get entity extractions for quality scoring
  const { data: entities } = await supabase
    .from('entity_extractions')
    .select('entity_type, entity_value')
    .eq('shipment_id', shipmentId);

  // Build extracted fields map
  const extractedFields: Record<string, unknown> = {};
  for (const entity of entities || []) {
    extractedFields[entity.entity_type] = entity.entity_value;
  }

  // Create lifecycle entry for each unique document type
  const processedTypes = new Set<string>();

  for (const doc of docs || []) {
    if (processedTypes.has(doc.document_type)) continue;
    processedTypes.add(doc.document_type);

    try {
      await lifecycleService.createLifecycleForDocument(
        shipmentId,
        doc.document_type,
        { extractedFields }
      );
      created++;
    } catch (error) {
      // Likely already exists (idempotent)
    }
  }

  return { created };
}

async function showDatabaseState() {
  console.log('');
  console.log('CURRENT DATABASE STATE:');
  console.log('─'.repeat(60));

  // Shipments with stakeholders
  const { data: shipments } = await supabase
    .from('shipments')
    .select('shipper_id, consignee_id');

  const withShipper = shipments?.filter(s => s.shipper_id).length || 0;
  const withConsignee = shipments?.filter(s => s.consignee_id).length || 0;
  const total = shipments?.length || 0;

  console.log(`  Shipments total:           ${total}`);
  console.log(`  Shipments with shipper:    ${withShipper} (${Math.round(withShipper / total * 100)}%)`);
  console.log(`  Shipments with consignee:  ${withConsignee} (${Math.round(withConsignee / total * 100)}%)`);

  // Parties count
  const { count: partyCount } = await supabase
    .from('parties')
    .select('*', { count: 'exact', head: true });

  console.log(`  Parties in database:       ${partyCount}`);

  // Document lifecycle count
  const { count: lifecycleCount } = await supabase
    .from('document_lifecycle')
    .select('*', { count: 'exact', head: true });

  console.log(`  Document lifecycle entries: ${lifecycleCount}`);

  // By document type
  const { data: lifecycles } = await supabase
    .from('document_lifecycle')
    .select('document_type');

  const byType: Record<string, number> = {};
  for (const lc of lifecycles || []) {
    byType[lc.document_type] = (byType[lc.document_type] || 0) + 1;
  }

  console.log('');
  console.log('  Document lifecycle by type:');
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.log(`    ${type.padEnd(30)} ${count}`);
  }

  console.log('');
  console.log('════════════════════════════════════════════════════════════════════════════════');
}

// Run the backfill
backfillStakeholdersAndLifecycle().catch(console.error);
