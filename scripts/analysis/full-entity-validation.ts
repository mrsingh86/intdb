/**
 * Full Entity Validation Test
 *
 * Validates ALL entity types extracted by the system:
 * - Identifiers: booking#, container#, BL#, entry#
 * - Dates: ETD, ETA, cutoffs (SI, VGM, cargo, gate)
 * - Places: POL, POD, place of receipt, place of delivery, inland
 * - Financial: amounts, demurrage, detention
 * - Operational: vessel, voyage, seal#, weights
 *
 * Also identifies gaps for:
 * - Sentiment analysis
 * - Conversation summary
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

import {
  createSenderAwareExtractor,
} from '../../lib/services/extraction';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// ============================================================================
// Types
// ============================================================================

interface EntityStats {
  entityType: string;
  category: string;
  totalExtracted: number;
  inSource: number;
  validFormat: number;
  avgConfidence: number;
  sampleValues: string[];
}

// ============================================================================
// Validation Functions
// ============================================================================

function valueInSource(value: string, source: string): boolean {
  if (!value || !source) return true;
  const normalizedValue = value.toLowerCase().replace(/[\s\-_]/g, '');
  const normalizedSource = source.toLowerCase().replace(/[\s\-_]/g, '');
  return normalizedSource.includes(normalizedValue);
}

function isValidDate(value: string): boolean {
  // ISO format
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return true;
  // DD-MMM-YYYY
  if (/^\d{1,2}-[A-Za-z]{3}-\d{4}/.test(value)) return true;
  // DD/MM/YYYY or MM/DD/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}/.test(value)) return true;
  // MMM DD, YYYY
  if (/^[A-Za-z]{3}\s+\d{1,2},?\s+\d{4}/.test(value)) return true;
  return false;
}

function isValidPort(value: string): boolean {
  // UN/LOCODE (5 chars)
  if (/^[A-Z]{2}[A-Z0-9]{3}$/i.test(value)) return true;
  // City name (3+ chars, capitalized)
  if (/^[A-Z][a-z]{2,}/.test(value)) return true;
  return false;
}

function isValidWeight(value: string): boolean {
  // Numeric with optional decimals
  return /^[\d,]+(\.\d+)?$/.test(value.replace(/,/g, ''));
}

function isValidAmount(value: string): boolean {
  // Numeric with optional decimals
  return /^[\d,]+(\.\d{2})?$/.test(value.replace(/,/g, ''));
}

// ============================================================================
// Main Test
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  FULL ENTITY VALIDATION TEST');
  console.log('  All Entity Types Across All Categories');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const extractor = createSenderAwareExtractor(supabase);

  // Get diverse sample of emails
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, sender_email, true_sender_email, subject, body_text')
    .not('body_text', 'is', null)
    .order('received_at', { ascending: false })
    .limit(100);

  if (error || !emails?.length) {
    console.error('Failed to fetch emails:', error);
    return;
  }

  console.log(`Testing on ${emails.length} emails...\n`);

  // Track stats per entity type
  const entityStats: Map<string, EntityStats> = new Map();

  // Process each email
  for (const email of emails) {
    const sourceText = `${email.subject}\n${email.body_text}`;

    const result = await extractor.extract({
      emailId: email.id,
      senderEmail: email.sender_email || '',
      trueSenderEmail: email.true_sender_email,
      subject: email.subject || '',
      bodyText: (email.body_text || '').slice(0, 10000),
      sourceType: 'email',
    });

    // Categorize each extraction
    for (const ext of result.extractions) {
      if (!entityStats.has(ext.entityType)) {
        entityStats.set(ext.entityType, {
          entityType: ext.entityType,
          category: getCategory(ext.entityType),
          totalExtracted: 0,
          inSource: 0,
          validFormat: 0,
          avgConfidence: 0,
          sampleValues: [],
        });
      }

      const stats = entityStats.get(ext.entityType)!;
      stats.totalExtracted++;
      stats.avgConfidence += ext.confidence;

      if (valueInSource(ext.entityValue, sourceText)) {
        stats.inSource++;
      }

      if (isValidForType(ext.entityType, ext.entityValue)) {
        stats.validFormat++;
      }

      if (stats.sampleValues.length < 3) {
        stats.sampleValues.push(ext.entityValue.slice(0, 30));
      }
    }
  }

  // Calculate averages
  for (const stats of entityStats.values()) {
    if (stats.totalExtracted > 0) {
      stats.avgConfidence = Math.round(stats.avgConfidence / stats.totalExtracted);
    }
  }

  // Group by category
  const categories: Record<string, EntityStats[]> = {};
  for (const stats of entityStats.values()) {
    if (!categories[stats.category]) {
      categories[stats.category] = [];
    }
    categories[stats.category].push(stats);
  }

  // Print results by category
  for (const [category, statsList] of Object.entries(categories).sort()) {
    console.log(`\n─── ${category.toUpperCase()} ───\n`);
    console.log('Entity Type              Total  InSrc  Valid  Conf   Samples');
    console.log('────────────────────────────────────────────────────────────────');

    for (const stats of statsList.sort((a, b) => b.totalExtracted - a.totalExtracted)) {
      const srcPct = stats.totalExtracted > 0
        ? Math.round(stats.inSource / stats.totalExtracted * 100) + '%'
        : '-';
      const validPct = stats.totalExtracted > 0
        ? Math.round(stats.validFormat / stats.totalExtracted * 100) + '%'
        : '-';
      const samples = stats.sampleValues.slice(0, 2).join(', ');

      console.log(
        `${stats.entityType.padEnd(24)} ${stats.totalExtracted.toString().padStart(4)}  ` +
        `${srcPct.padStart(5)}  ${validPct.padStart(5)}  ${(stats.avgConfidence + '%').padStart(4)}   ${samples.slice(0, 35)}`
      );
    }
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  SUMMARY BY CATEGORY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const categorySummary: Record<string, { total: number; inSource: number; valid: number }> = {};

  for (const stats of entityStats.values()) {
    if (!categorySummary[stats.category]) {
      categorySummary[stats.category] = { total: 0, inSource: 0, valid: 0 };
    }
    categorySummary[stats.category].total += stats.totalExtracted;
    categorySummary[stats.category].inSource += stats.inSource;
    categorySummary[stats.category].valid += stats.validFormat;
  }

  console.log('Category         Total  In Source  Valid Format');
  console.log('────────────────────────────────────────────────');

  let grandTotal = 0, grandInSource = 0, grandValid = 0;

  for (const [cat, summary] of Object.entries(categorySummary).sort()) {
    const srcPct = summary.total > 0
      ? Math.round(summary.inSource / summary.total * 100) + '%'
      : '-';
    const validPct = summary.total > 0
      ? Math.round(summary.valid / summary.total * 100) + '%'
      : '-';

    console.log(
      `${cat.padEnd(16)} ${summary.total.toString().padStart(5)}  ` +
      `${srcPct.padStart(9)}  ${validPct.padStart(12)}`
    );

    grandTotal += summary.total;
    grandInSource += summary.inSource;
    grandValid += summary.valid;
  }

  console.log('────────────────────────────────────────────────');
  console.log(
    `${'TOTAL'.padEnd(16)} ${grandTotal.toString().padStart(5)}  ` +
    `${Math.round(grandInSource/grandTotal*100) + '%'.padStart(9)}  ` +
    `${Math.round(grandValid/grandTotal*100) + '%'.padStart(12)}`
  );

  // Identify gaps
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  CAPABILITY GAPS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const expectedTypes = [
    // Identifiers
    'booking_number', 'container_number', 'bl_number', 'entry_number', 'seal_number',
    // Dates
    'etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff',
    // Places
    'port_of_loading', 'port_of_discharge', 'place_of_receipt', 'place_of_delivery', 'inland_destination',
    // Transport
    'vessel_name', 'voyage_number',
    // Cargo
    'gross_weight_kg', 'volume_cbm', 'package_count',
    // Financial
    'freight_amount', 'demurrage_amount',
    // Demurrage
    'last_free_day', 'free_time_days',
    // Not yet implemented
    'sentiment', 'urgency_level', 'conversation_summary', 'action_items',
  ];

  const foundTypes = new Set(entityStats.keys());
  const missingTypes = expectedTypes.filter(t => !foundTypes.has(t));

  if (missingTypes.length > 0) {
    console.log('Missing/Low-Volume Entity Types:');
    for (const t of missingTypes) {
      const category = getCategory(t);
      console.log(`  ⚠ ${t.padEnd(25)} (${category})`);
    }
  }

  // Critical gaps
  console.log('\n📌 NOT YET IMPLEMENTED:');
  console.log('  - sentiment: Email tone analysis (positive/negative/neutral)');
  console.log('  - urgency_level: Deadline proximity and action urgency');
  console.log('  - conversation_summary: Thread context summarization');
  console.log('  - action_items: Required actions extracted from email');
}

function getCategory(entityType: string): string {
  if (['booking_number', 'container_number', 'bl_number', 'entry_number', 'seal_number', 'job_number', 'po_number', 'invoice_number'].includes(entityType)) {
    return 'identifier';
  }
  if (['etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff', 'doc_cutoff', 'port_cutoff'].includes(entityType)) {
    return 'date';
  }
  if (['port_of_loading', 'port_of_discharge', 'place_of_receipt', 'place_of_delivery', 'inland_destination', 'ramp_location', 'warehouse_location'].includes(entityType)) {
    return 'location';
  }
  if (['vessel_name', 'voyage_number'].includes(entityType)) {
    return 'transport';
  }
  if (['gross_weight_kg', 'net_weight_kg', 'tare_weight_kg', 'vgm_weight_kg', 'volume_cbm', 'package_count'].includes(entityType)) {
    return 'cargo';
  }
  if (['freight_amount', 'demurrage_amount', 'detention_amount', 'total_amount'].includes(entityType)) {
    return 'financial';
  }
  if (['last_free_day', 'free_time_days', 'cargo_available_date', 'empty_return_date'].includes(entityType)) {
    return 'demurrage';
  }
  if (['sentiment', 'urgency_level', 'conversation_summary', 'action_items'].includes(entityType)) {
    return 'ai_analysis';
  }
  return 'other';
}

function isValidForType(entityType: string, value: string): boolean {
  const category = getCategory(entityType);

  switch (category) {
    case 'identifier':
      return /^[A-Z0-9\-]{5,}$/i.test(value);
    case 'date':
      return isValidDate(value);
    case 'location':
      return isValidPort(value) || value.length >= 3;
    case 'cargo':
      return isValidWeight(value);
    case 'financial':
      return isValidAmount(value);
    default:
      return value.length >= 2;
  }
}

main().catch(console.error);
