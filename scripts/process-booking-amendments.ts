/**
 * Process Booking Amendments
 *
 * Handles booking confirmation updates/amendments from carriers.
 * Updates shipment with latest values and tracks changes.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const DIRECT_CARRIER_DOMAINS = [
  'maersk', 'hlag', 'hapag', 'cma-cgm', 'cmacgm', 'msc.com',
  'coscon', 'cosco', 'oocl', 'one-line', 'evergreen', 'yangming',
  'hmm21', 'zim.com', 'paborlines', 'namsung', 'sinokor',
  'heung-a', 'kmtc', 'wanhai', 'tslines', 'sitc'
];

// Fields that can be updated by amendments
const UPDATABLE_FIELDS = [
  'etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff',
  'vessel_name', 'voyage_number',
  'port_of_loading', 'port_of_loading_code',
  'port_of_discharge', 'port_of_discharge_code',
  'bl_number', 'container_number_primary'
];

const TIMESTAMP_FIELDS = ['etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff'];

interface AmendmentResult {
  bookingNumber: string;
  amendmentsProcessed: number;
  fieldsUpdated: number;
  auditLogsCreated: number;
  documentsLinked: number;
}

function isDirectCarrier(trueSenderEmail: string | null, senderEmail: string | null): boolean {
  const emailToCheck = trueSenderEmail || senderEmail || '';
  const domain = emailToCheck.toLowerCase().split('@')[1] || '';
  return DIRECT_CARRIER_DOMAINS.some(d => domain.includes(d));
}

function isValidTimestamp(value: string): boolean {
  if (!value) return false;
  const date = new Date(value);
  return !isNaN(date.getTime());
}

function sanitizeTimestamp(value: string): string | null {
  if (!value) return null;
  const direct = new Date(value);
  if (!isNaN(direct.getTime())) {
    return direct.toISOString();
  }
  return null;
}

function extractUpdateNumber(subject: string): number | null {
  // Match patterns like "3RD UPDATE", "4TH UPDATE", "1ST UPDATE"
  const match = subject.match(/(\d+)(?:ST|ND|RD|TH)\s+UPDATE/i);
  if (match) return parseInt(match[1], 10);

  // Also check for just "UPDATE" without number (treat as 1)
  if (/\bUPDATE\b/i.test(subject) && !/\d+.*UPDATE/i.test(subject)) {
    return 1;
  }

  return null;
}

async function processAmendments() {
  console.log('='.repeat(70));
  console.log('PROCESSING BOOKING AMENDMENTS');
  console.log('='.repeat(70));

  const stats = {
    bookingsWithAmendments: 0,
    totalAmendments: 0,
    shipmentsUpdated: 0,
    fieldsUpdated: 0,
    auditLogs: 0,
    documentsLinked: 0,
    errors: [] as string[],
  };

  // Step 1: Get all direct carrier booking confirmations
  const { data: bookingEmails } = await supabase
    .from('document_classifications')
    .select(`
      email_id,
      raw_emails!inner (
        id,
        sender_email,
        true_sender_email,
        subject,
        received_at
      )
    `)
    .eq('document_type', 'booking_confirmation');

  // Filter to direct carrier only
  const directCarrierEmails = (bookingEmails || []).filter(email => {
    const rawEmail = email.raw_emails as any;
    return isDirectCarrier(rawEmail.true_sender_email, rawEmail.sender_email);
  });

  console.log(`\nTotal direct carrier booking emails: ${directCarrierEmails.length}`);

  // Step 2: Group by booking number
  const emailsByBooking: Record<string, any[]> = {};

  for (const email of directCarrierEmails) {
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', email.email_id)
      .eq('entity_type', 'booking_number');

    const bookingNumber = entities?.[0]?.entity_value;
    if (!bookingNumber) continue;

    if (!emailsByBooking[bookingNumber]) {
      emailsByBooking[bookingNumber] = [];
    }
    emailsByBooking[bookingNumber].push({
      ...email,
      rawEmail: email.raw_emails as any,
    });
  }

  // Step 3: Sort each booking's emails by date and process amendments
  const bookingsWithMultiple = Object.entries(emailsByBooking).filter(([_, emails]) => emails.length > 1);
  console.log(`Bookings with multiple emails (amendments): ${bookingsWithMultiple.length}`);

  for (const [bookingNumber, emails] of bookingsWithMultiple) {
    // Sort by received_at (oldest first)
    emails.sort((a, b) =>
      new Date(a.rawEmail.received_at).getTime() - new Date(b.rawEmail.received_at).getTime()
    );

    // Find the shipment
    const { data: shipment } = await supabase
      .from('shipments')
      .select('*')
      .eq('booking_number', bookingNumber)
      .single();

    if (!shipment) {
      stats.errors.push(`${bookingNumber}: No shipment found`);
      continue;
    }

    stats.bookingsWithAmendments++;

    // Process amendments (skip the first email - it's the original)
    for (let i = 1; i < emails.length; i++) {
      const amendment = emails[i];
      stats.totalAmendments++;

      try {
        const result = await processOneAmendment(shipment, amendment, i);

        if (result.fieldsUpdated > 0) {
          stats.shipmentsUpdated++;
          stats.fieldsUpdated += result.fieldsUpdated;
        }
        stats.auditLogs += result.auditLogsCreated;
        stats.documentsLinked += result.documentsLinked;

      } catch (err: any) {
        stats.errors.push(`${bookingNumber} amendment ${i}: ${err.message}`);
      }
    }
  }

  // Also link all first emails that aren't linked yet
  console.log('\nLinking original booking emails...');
  let originalLinked = 0;

  for (const [bookingNumber, emails] of Object.entries(emailsByBooking)) {
    const firstEmail = emails[0];

    const { data: shipment } = await supabase
      .from('shipments')
      .select('id')
      .eq('booking_number', bookingNumber)
      .single();

    if (!shipment) continue;

    // Check if already linked
    const { data: existing } = await supabase
      .from('shipment_documents')
      .select('id')
      .eq('email_id', firstEmail.email_id)
      .eq('shipment_id', shipment.id)
      .single();

    if (!existing) {
      await supabase.from('shipment_documents').insert({
        email_id: firstEmail.email_id,
        shipment_id: shipment.id,
        document_type: 'booking_confirmation',
        link_method: 'ai',
        link_confidence_score: 100,
      });
      originalLinked++;
    }
  }

  console.log(`Original emails linked: ${originalLinked}`);

  // Print results
  console.log('\n' + '='.repeat(70));
  console.log('AMENDMENT PROCESSING COMPLETE');
  console.log('='.repeat(70));
  console.log(`Bookings with amendments: ${stats.bookingsWithAmendments}`);
  console.log(`Total amendments processed: ${stats.totalAmendments}`);
  console.log(`Shipments updated: ${stats.shipmentsUpdated}`);
  console.log(`Fields updated: ${stats.fieldsUpdated}`);
  console.log(`Audit logs created: ${stats.auditLogs}`);
  console.log(`Documents linked: ${stats.documentsLinked + originalLinked}`);

  if (stats.errors.length > 0) {
    console.log(`\nErrors (${stats.errors.length}):`);
    stats.errors.slice(0, 10).forEach(e => console.log(`  - ${e}`));
  }

  // Verify final counts
  const { count: docCount } = await supabase
    .from('shipment_documents')
    .select('*', { count: 'exact', head: true });
  const { count: auditCount } = await supabase
    .from('shipment_audit_log')
    .select('*', { count: 'exact', head: true });

  console.log('\nDatabase totals:');
  console.log(`  shipment_documents: ${docCount}`);
  console.log(`  shipment_audit_log: ${auditCount}`);
}

async function processOneAmendment(
  shipment: any,
  amendment: any,
  amendmentIndex: number
): Promise<{ fieldsUpdated: number; auditLogsCreated: number; documentsLinked: number }> {

  const result = { fieldsUpdated: 0, auditLogsCreated: 0, documentsLinked: 0 };

  // Get entities from amendment email
  const { data: entities } = await supabase
    .from('entity_extractions')
    .select('entity_type, entity_value')
    .eq('email_id', amendment.email_id);

  // Build update object and track changes
  const updates: Record<string, any> = {};
  const changedFields: Record<string, { old: any; new: any }> = {};

  for (const entity of entities || []) {
    const fieldName = mapEntityToField(entity.entity_type);
    if (!fieldName || !UPDATABLE_FIELDS.includes(fieldName)) continue;

    let newValue = entity.entity_value;

    // Sanitize timestamps
    if (TIMESTAMP_FIELDS.includes(fieldName)) {
      const sanitized = sanitizeTimestamp(newValue);
      if (!sanitized) continue; // Skip invalid timestamps
      newValue = sanitized;
    }

    const oldValue = shipment[fieldName];

    // Only update if value changed and new value is non-empty
    if (newValue && newValue !== oldValue) {
      updates[fieldName] = newValue;
      changedFields[fieldName] = { old: oldValue, new: newValue };
    }
  }

  // Update shipment if there are changes
  if (Object.keys(updates).length > 0) {
    updates.updated_at = new Date().toISOString();

    const { error: updateError } = await supabase
      .from('shipments')
      .update(updates)
      .eq('id', shipment.id);

    if (!updateError) {
      result.fieldsUpdated = Object.keys(changedFields).length;

      // Create audit log
      const updateNumber = extractUpdateNumber(amendment.rawEmail.subject);
      const changeSummary = Object.keys(changedFields)
        .map(f => `${f}: ${changedFields[f].old || 'null'} → ${changedFields[f].new}`)
        .join(', ');

      const { error: auditError } = await supabase
        .from('shipment_audit_log')
        .insert({
          shipment_id: shipment.id,
          action: 'updated',
          changed_fields: changedFields,
          change_summary: updateNumber
            ? `${updateNumber}${getOrdinalSuffix(updateNumber)} UPDATE: ${changeSummary}`
            : `Amendment: ${changeSummary}`,
          source: 'carrier_update',
          source_email_id: amendment.email_id,
        });

      if (!auditError) {
        result.auditLogsCreated = 1;
      }
    }
  }

  // Link document to shipment
  const { data: existingLink } = await supabase
    .from('shipment_documents')
    .select('id')
    .eq('email_id', amendment.email_id)
    .eq('shipment_id', shipment.id)
    .single();

  if (!existingLink) {
    const { error: linkError } = await supabase
      .from('shipment_documents')
      .insert({
        email_id: amendment.email_id,
        shipment_id: shipment.id,
        document_type: 'booking_amendment',
        link_method: 'ai',
        link_confidence_score: 100,
      });

    if (!linkError) {
      result.documentsLinked = 1;
    }
  }

  return result;
}

function mapEntityToField(entityType: string): string | null {
  const mapping: Record<string, string> = {
    'etd': 'etd',
    'eta': 'eta',
    'si_cutoff': 'si_cutoff',
    'vgm_cutoff': 'vgm_cutoff',
    'cargo_cutoff': 'cargo_cutoff',
    'gate_cutoff': 'gate_cutoff',
    'vessel_name': 'vessel_name',
    'voyage_number': 'voyage_number',
    'port_of_loading': 'port_of_loading',
    'port_of_loading_code': 'port_of_loading_code',
    'port_of_discharge': 'port_of_discharge',
    'port_of_discharge_code': 'port_of_discharge_code',
    'bl_number': 'bl_number',
    'container_number': 'container_number_primary',
  };
  return mapping[entityType] || null;
}

function getOrdinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

processAmendments().catch(console.error);
