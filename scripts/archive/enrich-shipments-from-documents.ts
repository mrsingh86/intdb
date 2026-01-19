/**
 * Enrich Shipments from Linked Documents
 *
 * Populates shipment fields (mbl_number, hbl_number, container_numbers)
 * from entity extractions in linked documents.
 *
 * This enables linking by MBL/HBL/container instead of just booking number.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

const PAGE_SIZE = 1000;

async function fetchAll<T = any>(table: string, select: string = '*'): Promise<T[]> {
  let allData: T[] = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const { data } = await supabase.from(table).select(select).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (data && data.length > 0) {
      allData = allData.concat(data as T[]);
      hasMore = data.length === PAGE_SIZE;
      page++;
    } else {
      hasMore = false;
    }
  }
  return allData;
}

interface ShipmentDocument {
  shipment_id: string;
  email_id: string;
  document_type: string;
}

interface EntityExtraction {
  email_id: string;
  entity_type: string;
  entity_value: string;
}

interface Shipment {
  id: string;
  booking_number: string;
  mbl_number: string | null;
  hbl_number: string | null;
}

async function enrichShipments() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('              ENRICH SHIPMENTS FROM LINKED DOCUMENTS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // 1. Fetch all data
  console.log('Fetching data...');
  const [shipmentDocs, entities, shipments] = await Promise.all([
    fetchAll<ShipmentDocument>('shipment_documents', 'shipment_id,email_id,document_type'),
    fetchAll<EntityExtraction>('entity_extractions', 'email_id,entity_type,entity_value'),
    fetchAll<Shipment>('shipments', 'id,booking_number,mbl_number,hbl_number'),
  ]);

  console.log(`  Shipment documents: ${shipmentDocs.length}`);
  console.log(`  Entities: ${entities.length}`);
  console.log(`  Shipments: ${shipments.length}`);
  console.log('');

  // 2. Create entity lookup by email
  const entitiesByEmail = new Map<string, EntityExtraction[]>();
  for (const e of entities) {
    const existing = entitiesByEmail.get(e.email_id) || [];
    existing.push(e);
    entitiesByEmail.set(e.email_id, existing);
  }

  // 3. Group documents by shipment
  const docsByShipment = new Map<string, ShipmentDocument[]>();
  for (const doc of shipmentDocs) {
    const existing = docsByShipment.get(doc.shipment_id) || [];
    existing.push(doc);
    docsByShipment.set(doc.shipment_id, existing);
  }

  // 4. Create shipment lookup
  const shipmentMap = new Map<string, Shipment>();
  for (const s of shipments) {
    shipmentMap.set(s.id, s);
  }

  // 5. Process each shipment
  console.log('Enriching shipments...');

  let enrichedCount = 0;
  let mblCount = 0;
  let hblCount = 0;
  let containerCount = 0;

  for (const shipment of shipments) {
    const docs = docsByShipment.get(shipment.id) || [];
    if (docs.length === 0) continue;

    // Collect entities from all linked documents
    const allMbls = new Set<string>();
    const allHbls = new Set<string>();
    const allContainers = new Set<string>();

    for (const doc of docs) {
      const docEntities = entitiesByEmail.get(doc.email_id) || [];

      for (const e of docEntities) {
        const value = e.entity_value?.trim();
        if (!value) continue;

        switch (e.entity_type) {
          case 'mbl_number':
          case 'bl_number':
            // MBL patterns: HLCU..., MAEU..., COSU..., MEDU...
            if (/^[A-Z]{4}[A-Z0-9]{8,}$/i.test(value) || /^[A-Z0-9]{10,}$/i.test(value)) {
              allMbls.add(value.toUpperCase());
            }
            break;
          case 'hbl_number':
            // HBL patterns: SE..., SWLLUD...
            if (/^SE\d+$/i.test(value) || /^SWL[A-Z]{3}\d+$/i.test(value) || value.length >= 8) {
              allHbls.add(value.toUpperCase());
            }
            break;
          case 'container_number':
            // Container patterns: 4 letters + 7 digits
            if (/^[A-Z]{4}\d{7}$/i.test(value)) {
              allContainers.add(value.toUpperCase());
            }
            break;
        }
      }
    }

    // Build update
    const updateData: Record<string, any> = {};

    // Set MBL if not already set
    if (!shipment.mbl_number && allMbls.size > 0) {
      updateData.mbl_number = Array.from(allMbls)[0];
      mblCount++;
    }

    // Set HBL if not already set
    if (!shipment.hbl_number && allHbls.size > 0) {
      updateData.hbl_number = Array.from(allHbls)[0];
      hblCount++;
    }

    // Update container_numbers array
    if (allContainers.size > 0) {
      updateData.container_numbers = Array.from(allContainers);
      containerCount++;
    }

    // Apply update if anything to update
    if (Object.keys(updateData).length > 0) {
      updateData.updated_at = new Date().toISOString();

      const { error } = await supabase
        .from('shipments')
        .update(updateData)
        .eq('id', shipment.id);

      if (error) {
        console.error(`  Error updating ${shipment.booking_number}: ${error.message}`);
      } else {
        enrichedCount++;
        if (updateData.mbl_number || updateData.hbl_number) {
          console.log(`  [${shipment.booking_number}] MBL: ${updateData.mbl_number || 'N/A'}, HBL: ${updateData.hbl_number || 'N/A'}`);
        }
      }
    }
  }

  // 6. Summary
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                              ENRICHMENT COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`Shipments enriched: ${enrichedCount}`);
  console.log(`  MBL numbers added: ${mblCount}`);
  console.log(`  HBL numbers added: ${hblCount}`);
  console.log(`  Container numbers added: ${containerCount}`);
}

enrichShipments().catch(console.error);
