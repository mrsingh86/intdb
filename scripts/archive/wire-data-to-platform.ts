#!/usr/bin/env npx tsx
/**
 * Wire Data to Platform Script
 *
 * Takes extracted entities from emails and wires them to:
 * 1. Shipments - Create/update from booking_number, bl_number, ports, dates
 * 2. Document Lifecycle - Track document status from classifications
 * 3. Stakeholders (Parties) - Create from shipper_name, consignee_name
 * 4. Action Tasks - Generate from deadlines (si_cutoff, vgm_cutoff, etc.)
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Stats tracking
const stats = {
  shipmentsCreated: 0,
  shipmentsUpdated: 0,
  documentLifecycleCreated: 0,
  partiesCreated: 0,
  actionTasksCreated: 0,
  errors: [] as string[]
};

interface EmailEntities {
  email_id: string;
  classification_id?: string;
  document_type?: string;
  entities: Record<string, string | string[]>;
}

async function fetchAllWithPagination<T>(
  table: string,
  select: string,
  filter?: { column: string; values: string[] }
): Promise<T[]> {
  const results: T[] = [];
  let offset = 0;
  const pageSize = 1000;

  while (true) {
    let query = supabase.from(table).select(select).range(offset, offset + pageSize - 1);

    if (filter) {
      query = query.in(filter.column, filter.values);
    }

    const { data, error } = await query;
    if (error || !data || data.length === 0) break;
    results.push(...(data as T[]));
    if (data.length < pageSize) break;
    offset += pageSize;
  }

  return results;
}

async function groupEntitiesByEmail(): Promise<Map<string, EmailEntities>> {
  console.log('Grouping entities by email...');

  // Fetch all classifications
  const classifications = await fetchAllWithPagination<any>('document_classifications', 'id, email_id, document_type');
  const classificationByEmail = new Map(classifications.map(c => [c.email_id, c]));

  // Fetch all entities
  const entities = await fetchAllWithPagination<any>('entity_extractions', 'email_id, entity_type, entity_value');

  // Group by email
  const emailEntities = new Map<string, EmailEntities>();

  for (const entity of entities) {
    if (!emailEntities.has(entity.email_id)) {
      const classification = classificationByEmail.get(entity.email_id);
      emailEntities.set(entity.email_id, {
        email_id: entity.email_id,
        classification_id: classification?.id,
        document_type: classification?.document_type,
        entities: {}
      });
    }

    const current = emailEntities.get(entity.email_id)!;
    const existing = current.entities[entity.entity_type];

    // Handle multiple values (e.g., multiple container numbers)
    if (existing) {
      if (Array.isArray(existing)) {
        existing.push(entity.entity_value);
      } else {
        current.entities[entity.entity_type] = [existing, entity.entity_value];
      }
    } else {
      current.entities[entity.entity_type] = entity.entity_value;
    }
  }

  console.log(`Grouped entities for ${emailEntities.size} emails`);
  return emailEntities;
}

async function createOrUpdateShipments(emailEntitiesMap: Map<string, EmailEntities>) {
  console.log('\n=== WIRING SHIPMENTS ===');

  // Get emails with booking numbers
  const emailsWithBookings: EmailEntities[] = [];

  for (const entities of emailEntitiesMap.values()) {
    const bookingNumber = entities.entities.booking_number;
    if (bookingNumber && typeof bookingNumber === 'string') {
      emailsWithBookings.push(entities);
    }
  }

  console.log(`Found ${emailsWithBookings.length} emails with booking numbers`);

  // Get existing shipments
  const existingShipments = await fetchAllWithPagination<any>('shipments', 'id, booking_number, bl_number');
  const shipmentByBooking = new Map(existingShipments.filter(s => s.booking_number).map(s => [s.booking_number, s]));
  const shipmentByBL = new Map(existingShipments.filter(s => s.bl_number).map(s => [s.bl_number, s]));

  console.log(`Existing shipments: ${existingShipments.length}`);

  // Process emails to create/update shipments
  for (const emailData of emailsWithBookings) {
    const e = emailData.entities;
    const bookingNumber = e.booking_number as string;
    const blNumber = e.bl_number as string | undefined;

    // Check if shipment exists
    let existingShipment = shipmentByBooking.get(bookingNumber);
    if (!existingShipment && blNumber) {
      existingShipment = shipmentByBL.get(blNumber);
    }

    // Parse dates safely
    const parseDate = (val: string | string[] | undefined): string | null => {
      if (!val) return null;
      const dateStr = Array.isArray(val) ? val[0] : val;
      try {
        const date = new Date(dateStr);
        return isNaN(date.getTime()) ? null : date.toISOString();
      } catch {
        return null;
      }
    };

    // Get container numbers as array
    const containerNumbers = Array.isArray(e.container_numbers)
      ? e.container_numbers
      : e.container_numbers
        ? [e.container_numbers]
        : null;

    const shipmentData = {
      booking_number: bookingNumber,
      bl_number: blNumber || null,
      vessel_name: (Array.isArray(e.vessel_name) ? e.vessel_name[0] : e.vessel_name) || null,
      voyage_number: (Array.isArray(e.voyage_number) ? e.voyage_number[0] : e.voyage_number) || null,
      port_of_loading: (Array.isArray(e.port_of_loading) ? e.port_of_loading[0] : e.port_of_loading) || null,
      port_of_discharge: (Array.isArray(e.port_of_discharge) ? e.port_of_discharge[0] : e.port_of_discharge) || null,
      etd: parseDate(e.etd as string | string[]),
      eta: parseDate(e.eta as string | string[]),
      si_cutoff: parseDate(e.si_cutoff as string | string[]),
      vgm_cutoff: parseDate(e.vgm_cutoff as string | string[]),
      cargo_cutoff: parseDate(e.cargo_cutoff as string | string[]),
      commodity_description: (Array.isArray(e.commodity) ? e.commodity[0] : e.commodity) || null,
      container_numbers: containerNumbers,
      shipper_name: (Array.isArray(e.shipper_name) ? e.shipper_name[0] : e.shipper_name) || null,
      consignee_name: (Array.isArray(e.consignee_name) ? e.consignee_name[0] : e.consignee_name) || null,
      created_from_email_id: emailData.email_id,
      workflow_state: 'booking_confirmation_received',
      workflow_phase: 'pre_shipment',
      status: 'booked'
    };

    try {
      if (existingShipment) {
        // Update existing shipment with new data (only non-null values)
        const updateData: Record<string, any> = {};
        for (const [key, value] of Object.entries(shipmentData)) {
          if (value !== null && key !== 'booking_number' && key !== 'created_from_email_id') {
            // Only update if existing value is null
            if (!existingShipment[key]) {
              updateData[key] = value;
            }
          }
        }

        if (Object.keys(updateData).length > 0) {
          const { error } = await supabase
            .from('shipments')
            .update(updateData)
            .eq('id', existingShipment.id);

          if (error) {
            stats.errors.push(`Update shipment ${bookingNumber}: ${error.message}`);
          } else {
            stats.shipmentsUpdated++;
          }
        }
      } else {
        // Create new shipment
        const { data, error } = await supabase
          .from('shipments')
          .insert(shipmentData)
          .select('id')
          .single();

        if (error) {
          if (!error.message.includes('duplicate')) {
            stats.errors.push(`Create shipment ${bookingNumber}: ${error.message}`);
          }
        } else {
          stats.shipmentsCreated++;
          shipmentByBooking.set(bookingNumber, { id: data.id, booking_number: bookingNumber });
        }
      }
    } catch (err: any) {
      stats.errors.push(`Shipment ${bookingNumber}: ${err.message}`);
    }
  }

  console.log(`Shipments created: ${stats.shipmentsCreated}, updated: ${stats.shipmentsUpdated}`);
}

async function populateDocumentLifecycle(emailEntitiesMap: Map<string, EmailEntities>) {
  console.log('\n=== WIRING DOCUMENT LIFECYCLE ===');

  // Get all shipments with booking numbers
  const shipments = await fetchAllWithPagination<any>('shipments', 'id, booking_number, bl_number');
  const shipmentByBooking = new Map(shipments.filter(s => s.booking_number).map(s => [s.booking_number, s]));

  // Get existing document lifecycle entries
  const existingDocs = await fetchAllWithPagination<any>('document_lifecycle', 'id, shipment_id, document_type');
  const existingDocsSet = new Set(existingDocs.map(d => `${d.shipment_id}:${d.document_type}`));

  console.log(`Existing document lifecycle entries: ${existingDocs.length}`);

  // Document type mapping from classification to lifecycle
  const docTypeMapping: Record<string, string> = {
    'booking_confirmation': 'booking_confirmation',
    'booking_amendment': 'booking_amendment',
    'shipping_instruction': 'shipping_instruction',
    'si_draft': 'si_draft',
    'bill_of_lading': 'bill_of_lading',
    'arrival_notice': 'arrival_notice',
    'vgm_confirmation': 'vgm_confirmation',
    'packing_list': 'packing_list',
    'commercial_invoice': 'commercial_invoice',
    'delivery_order': 'delivery_order',
    'customs_clearance': 'customs_clearance'
  };

  // Process emails with classifications
  for (const entities of emailEntitiesMap.values()) {
    const bookingNumber = entities.entities.booking_number as string;
    const docType = entities.document_type;

    if (!bookingNumber || !docType) continue;

    const mappedDocType = docTypeMapping[docType];
    if (!mappedDocType) continue;

    const shipment = shipmentByBooking.get(bookingNumber);
    if (!shipment) continue;

    const key = `${shipment.id}:${mappedDocType}`;
    if (existingDocsSet.has(key)) continue;

    try {
      const { error } = await supabase
        .from('document_lifecycle')
        .insert({
          shipment_id: shipment.id,
          document_type: mappedDocType,
          lifecycle_status: 'draft',
          quality_score: 85,
          status_history: [{ status: 'draft', changed_at: new Date().toISOString() }]
        });

      if (error) {
        if (!error.message.includes('duplicate')) {
          stats.errors.push(`Doc lifecycle ${bookingNumber}/${mappedDocType}: ${error.message}`);
        }
      } else {
        stats.documentLifecycleCreated++;
        existingDocsSet.add(key);
      }
    } catch (err: any) {
      stats.errors.push(`Doc lifecycle: ${err.message}`);
    }
  }

  console.log(`Document lifecycle entries created: ${stats.documentLifecycleCreated}`);
}

async function createStakeholders(emailEntitiesMap: Map<string, EmailEntities>) {
  console.log('\n=== WIRING STAKEHOLDERS (PARTIES) ===');

  // Get existing parties
  const existingParties = await fetchAllWithPagination<any>('parties', 'id, party_name, party_type');
  const existingPartyNames = new Set(existingParties.map(p => p.party_name?.toLowerCase()));

  console.log(`Existing parties: ${existingParties.length}`);

  // Collect unique shipper and consignee names
  const shippers = new Set<string>();
  const consignees = new Set<string>();

  for (const entities of emailEntitiesMap.values()) {
    const shipperName = entities.entities.shipper_name;
    const consigneeName = entities.entities.consignee_name;

    if (shipperName) {
      const name = (Array.isArray(shipperName) ? shipperName[0] : shipperName).trim();
      if (name && name.length > 2 && !existingPartyNames.has(name.toLowerCase())) {
        shippers.add(name);
      }
    }

    if (consigneeName) {
      const name = (Array.isArray(consigneeName) ? consigneeName[0] : consigneeName).trim();
      if (name && name.length > 2 && !existingPartyNames.has(name.toLowerCase())) {
        consignees.add(name);
      }
    }
  }

  console.log(`Unique shippers to create: ${shippers.size}, consignees: ${consignees.size}`);

  // Create shippers
  for (const name of shippers) {
    try {
      const { error } = await supabase
        .from('parties')
        .insert({
          party_name: name,
          party_type: 'shipper',
          is_customer: true,
          total_shipments: 0
        });

      if (!error) {
        stats.partiesCreated++;
        existingPartyNames.add(name.toLowerCase());
      }
    } catch (err: any) {
      // Ignore duplicates
    }
  }

  // Create consignees
  for (const name of consignees) {
    if (existingPartyNames.has(name.toLowerCase())) continue;

    try {
      const { error } = await supabase
        .from('parties')
        .insert({
          party_name: name,
          party_type: 'consignee',
          is_customer: false,
          total_shipments: 0
        });

      if (!error) {
        stats.partiesCreated++;
        existingPartyNames.add(name.toLowerCase());
      }
    } catch (err: any) {
      // Ignore duplicates
    }
  }

  console.log(`Parties created: ${stats.partiesCreated}`);
}

async function generateActionTasks(emailEntitiesMap: Map<string, EmailEntities>) {
  console.log('\n=== GENERATING ACTION TASKS ===');

  // Get shipments with deadlines
  const shipments = await fetchAllWithPagination<any>(
    'shipments',
    'id, booking_number, si_cutoff, vgm_cutoff, cargo_cutoff, etd'
  );

  // Get existing tasks
  const existingTasks = await fetchAllWithPagination<any>('action_tasks', 'id, shipment_id, title');
  const existingTaskKeys = new Set(existingTasks.map(t => `${t.shipment_id}:${t.title}`));

  console.log(`Shipments with potential deadlines: ${shipments.length}`);
  console.log(`Existing tasks: ${existingTasks.length}`);

  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  console.log(`Current time: ${now.toISOString()}`);
  console.log(`7 days from now: ${sevenDaysFromNow.toISOString()}`);

  let cutoffsChecked = 0;
  let cutoffsInRange = 0;

  for (const shipment of shipments) {
    // Check SI cutoff
    if (shipment.si_cutoff) {
      cutoffsChecked++;
      const cutoffDate = new Date(shipment.si_cutoff);
      if (cutoffDate > now && cutoffDate <= sevenDaysFromNow) {
        cutoffsInRange++;
        const title = `Submit SI for ${shipment.booking_number}`;
        const key = `${shipment.id}:${title}`;

        if (!existingTaskKeys.has(key)) {
          try {
            const { error } = await supabase
              .from('action_tasks')
              .insert({
                shipment_id: shipment.id,
                title,
                description: `SI cutoff deadline approaching: ${cutoffDate.toISOString()}`,
                category: 'deadline',
                priority: 'high',
                priority_score: 85,
                due_date: shipment.si_cutoff,
                urgency_level: 'this_week',
                status: 'pending'
              });

            if (!error) {
              stats.actionTasksCreated++;
              existingTaskKeys.add(key);
            }
          } catch (err) {
            // Ignore
          }
        }
      }
    }

    // Check VGM cutoff
    if (shipment.vgm_cutoff) {
      const cutoffDate = new Date(shipment.vgm_cutoff);
      if (cutoffDate > now && cutoffDate <= sevenDaysFromNow) {
        const title = `Submit VGM for ${shipment.booking_number}`;
        const key = `${shipment.id}:${title}`;

        if (!existingTaskKeys.has(key)) {
          try {
            const { error } = await supabase
              .from('action_tasks')
              .insert({
                shipment_id: shipment.id,
                title,
                description: `VGM cutoff deadline approaching: ${cutoffDate.toISOString()}`,
                category: 'deadline',
                priority: 'high',
                priority_score: 80,
                due_date: shipment.vgm_cutoff,
                urgency_level: 'this_week',
                status: 'pending'
              });

            if (!error) {
              stats.actionTasksCreated++;
              existingTaskKeys.add(key);
            }
          } catch (err) {
            // Ignore
          }
        }
      }
    }
  }

  console.log(`SI cutoffs checked: ${cutoffsChecked}, in range: ${cutoffsInRange}`);
  console.log(`Action tasks created: ${stats.actionTasksCreated}`);
}

async function main() {
  console.log('============================================================');
  console.log('WIRE DATA TO PLATFORM - INTDB');
  console.log('============================================================');
  console.log('Using:', supabaseUrl);
  console.log('');

  // Step 1: Group entities by email
  const emailEntitiesMap = await groupEntitiesByEmail();

  // Step 2: Create/update shipments
  await createOrUpdateShipments(emailEntitiesMap);

  // Step 3: Populate document lifecycle
  await populateDocumentLifecycle(emailEntitiesMap);

  // Step 4: Create stakeholders
  await createStakeholders(emailEntitiesMap);

  // Step 5: Generate action tasks
  await generateActionTasks(emailEntitiesMap);

  // Summary
  console.log('\n============================================================');
  console.log('WIRING COMPLETE');
  console.log('============================================================');
  console.log(`Shipments created: ${stats.shipmentsCreated}`);
  console.log(`Shipments updated: ${stats.shipmentsUpdated}`);
  console.log(`Document lifecycle entries: ${stats.documentLifecycleCreated}`);
  console.log(`Parties (stakeholders) created: ${stats.partiesCreated}`);
  console.log(`Action tasks created: ${stats.actionTasksCreated}`);
  console.log(`Errors: ${stats.errors.length}`);

  if (stats.errors.length > 0) {
    console.log('\nFirst 10 errors:');
    stats.errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
  }
}

main().catch(console.error);
