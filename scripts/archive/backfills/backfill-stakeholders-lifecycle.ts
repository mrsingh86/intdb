/**
 * Backfill Stakeholders and Document Lifecycle
 *
 * This script:
 * 1. Finds all shipments missing shipper_id or consignee_id
 * 2. Extracts stakeholder names from entity_extractions table
 * 3. Creates/links parties and updates shipment with IDs
 * 4. Creates document lifecycle records for all linked documents
 *
 * Run with:
 * SUPABASE_URL=... SUPABASE_SERVICE_KEY=... npx tsx scripts/backfill-stakeholders-lifecycle.ts
 */

import { createClient } from '@supabase/supabase-js';
import { StakeholderExtractionService, DocumentEntity, ShipmentDirection } from '../lib/services/stakeholder-extraction-service';
import { DocumentLifecycleService } from '../lib/services/document-lifecycle-service';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

const stakeholderService = new StakeholderExtractionService(supabase);
const lifecycleService = new DocumentLifecycleService(supabase);

interface Stats {
  totalShipments: number;
  shipmentsProcessed: number;
  shippersLinked: number;
  consigneesLinked: number;
  lifecyclesCreated: number;
  errors: number;
}

async function backfillShipment(
  shipment: any,
  stats: Stats
): Promise<void> {
  try {
    // Get entity extractions for this shipment to find shipper/consignee names
    const { data: extractions } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('shipment_id', shipment.id);

    // Build entity map
    let shipperName: string | undefined;
    let consigneeName: string | undefined;

    for (const ext of extractions || []) {
      if (ext.entity_type === 'shipper' || ext.entity_type === 'shipper_name') {
        shipperName = ext.entity_value;
      }
      if (ext.entity_type === 'consignee' || ext.entity_type === 'consignee_name') {
        consigneeName = ext.entity_value;
      }
    }

    // Also check shipment table itself
    if (!shipperName && shipment.shipper_name) {
      shipperName = shipment.shipper_name;
    }
    if (!consigneeName && shipment.consignee_name) {
      consigneeName = shipment.consignee_name;
    }

    // Build document entities
    const entities: DocumentEntity = {};
    if (shipperName && !shipment.shipper_id) {
      entities.shipper = { name: shipperName };
    }
    if (consigneeName && !shipment.consignee_id) {
      entities.consignee = { name: consigneeName };
    }

    // Process stakeholders if any to add
    if (entities.shipper || entities.consignee) {
      // Determine direction from port code
      const direction: ShipmentDirection =
        shipment.port_of_loading_code?.startsWith('IN') ? 'export' : 'import';

      const result = await stakeholderService.extractFromDocument(
        entities,
        'booking_confirmation',
        direction,
        shipment.id
      );

      // Link parties to shipment
      const allParties = [...result.created, ...result.matched];
      for (const party of allParties) {
        if (party.party_type === 'shipper' && !shipment.shipper_id) {
          await supabase
            .from('shipments')
            .update({ shipper_id: party.id })
            .eq('id', shipment.id);
          stats.shippersLinked++;
        } else if (party.party_type === 'consignee' && !shipment.consignee_id) {
          await supabase
            .from('shipments')
            .update({ consignee_id: party.id })
            .eq('id', shipment.id);
          stats.consigneesLinked++;
        }
      }
    }

    // Get linked documents for lifecycle creation
    const { data: docs } = await supabase
      .from('shipment_documents')
      .select('document_type')
      .eq('shipment_id', shipment.id);

    // Also check document_classifications linked via emails
    const { data: classifications } = await supabase
      .from('document_classifications')
      .select('document_type')
      .eq('email_id', shipment.created_from_email_id);

    // Collect unique document types
    const docTypes = new Set<string>();
    for (const doc of docs || []) {
      if (doc.document_type) docTypes.add(doc.document_type);
    }
    for (const cls of classifications || []) {
      if (cls.document_type) docTypes.add(cls.document_type);
    }

    // Create lifecycle for each document type if not exists
    for (const docType of docTypes) {
      try {
        // Check if lifecycle exists
        const { data: existing } = await supabase
          .from('document_lifecycle')
          .select('id')
          .eq('shipment_id', shipment.id)
          .eq('document_type', docType)
          .single();

        if (!existing) {
          // Build extracted fields from shipment
          const extractedFields: Record<string, unknown> = {
            booking_number: shipment.booking_number,
            vessel_name: shipment.vessel_name,
            voyage_number: shipment.voyage_number,
            port_of_loading: shipment.port_of_loading,
            port_of_discharge: shipment.port_of_discharge,
            etd: shipment.etd,
            eta: shipment.eta,
            shipper_name: shipment.shipper_name,
            consignee_name: shipment.consignee_name,
          };

          await lifecycleService.createLifecycleForDocument(
            shipment.id,
            docType,
            { extractedFields }
          );
          stats.lifecyclesCreated++;
        }
      } catch {
        // Lifecycle may already exist, continue
      }
    }

    stats.shipmentsProcessed++;

  } catch (error: any) {
    console.error(`Error processing shipment ${shipment.booking_number}:`, error.message);
    stats.errors++;
  }
}

async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║     BACKFILL STAKEHOLDERS AND DOCUMENT LIFECYCLE                  ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Get current stats
  const { count: totalShipments } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  const { count: missingShipper } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .is('shipper_id', null);

  const { count: missingConsignee } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .is('consignee_id', null);

  console.log('CURRENT STATE:');
  console.log(`  Total shipments: ${totalShipments}`);
  console.log(`  Missing shipper_id: ${missingShipper}`);
  console.log(`  Missing consignee_id: ${missingConsignee}`);
  console.log('');

  // Get all shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('*')
    .order('created_at', { ascending: false });

  if (!shipments || shipments.length === 0) {
    console.log('No shipments found');
    return;
  }

  const stats: Stats = {
    totalShipments: shipments.length,
    shipmentsProcessed: 0,
    shippersLinked: 0,
    consigneesLinked: 0,
    lifecyclesCreated: 0,
    errors: 0,
  };

  console.log(`Processing ${shipments.length} shipments...\n`);

  for (let i = 0; i < shipments.length; i++) {
    const shipment = shipments[i];
    await backfillShipment(shipment, stats);

    // Progress update every 20 shipments
    if ((i + 1) % 20 === 0) {
      const pct = Math.round(((i + 1) / shipments.length) * 100);
      console.log(`[${pct}%] Processed ${i + 1}/${shipments.length} - Shippers: ${stats.shippersLinked}, Consignees: ${stats.consigneesLinked}, Lifecycles: ${stats.lifecyclesCreated}`);
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 50));
  }

  console.log('\n' + '═'.repeat(70));
  console.log('BACKFILL COMPLETE');
  console.log('═'.repeat(70));
  console.log(`\nTotal Shipments: ${stats.totalShipments}`);
  console.log(`Processed: ${stats.shipmentsProcessed}`);
  console.log(`Shippers Linked: ${stats.shippersLinked}`);
  console.log(`Consignees Linked: ${stats.consigneesLinked}`);
  console.log(`Lifecycles Created: ${stats.lifecyclesCreated}`);
  console.log(`Errors: ${stats.errors}`);

  // Get final stats
  const { count: finalMissingShipper } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .is('shipper_id', null);

  const { count: finalMissingConsignee } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .is('consignee_id', null);

  console.log('\nFINAL STATE:');
  console.log(`  Missing shipper_id: ${finalMissingShipper} (was ${missingShipper})`);
  console.log(`  Missing consignee_id: ${finalMissingConsignee} (was ${missingConsignee})`);
  console.log('═'.repeat(70));
}

main().catch(console.error);
