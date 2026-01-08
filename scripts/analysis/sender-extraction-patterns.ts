/**
 * Analyze Entity Extraction Patterns by Sender
 *
 * Discovers which entities are typically found in emails/documents
 * from different sender categories (carriers, forwarders, customs, etc.)
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// Sender domain categorization
const SENDER_CATEGORIES: Record<string, string[]> = {
  'maersk': ['maersk.com'],
  'hapag': ['hapag-lloyd.com', 'hlag.com'],
  'cma_cgm': ['cma-cgm.com'],
  'msc': ['msc.com'],
  'one_line': ['one-line.com'],
  'evergreen': ['evergreen-marine.com', 'evergreen-line.com'],
  'cosco': ['cosco.com', 'coscoshipping.com'],
  'yang_ming': ['yangming.com'],
  'customs_broker': ['abordeaux.com', 'expeditors.com', 'chrobinson.com', 'dhl.com', 'ups.com', 'fedex.com'],
  'freight_forwarder': ['intoglo.com', 'flexport.com', 'kuehne-nagel.com'],
  'terminal': ['apm-terminals.com', 'dpworld.com'],
};

function getSenderCategory(email: string): string {
  const domain = email.split('@')[1]?.toLowerCase() || '';

  for (const [category, domains] of Object.entries(SENDER_CATEGORIES)) {
    if (domains.some(d => domain.includes(d.replace('.com', '')))) {
      return category;
    }
  }

  // Check if it's a carrier by common patterns
  if (domain.includes('line') || domain.includes('shipping')) return 'other_carrier';
  if (domain.includes('customs') || domain.includes('broker')) return 'customs_broker';
  if (domain.includes('logistics') || domain.includes('freight')) return 'freight_forwarder';

  return 'other';
}

async function getAllData() {
  const allData: any[] = [];
  let offset = 0;
  const batchSize = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('document_classifications')
      .select(`
        document_type,
        email_type,
        raw_emails!inner (
          sender_email,
          true_sender_email,
          subject,
          has_attachments
        )
      `)
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error('Error:', error);
      break;
    }
    if (!data || data.length === 0) break;

    allData.push(...data);
    offset += batchSize;
    if (data.length < batchSize) break;
  }

  return allData;
}

async function getEntityExtractions() {
  const { data, error } = await supabase
    .from('entity_extractions')
    .select(`
      entity_type,
      entity_value,
      confidence_score,
      extraction_method,
      email_id,
      attachment_id,
      raw_emails!inner (
        sender_email,
        true_sender_email
      )
    `)
    .limit(5000);

  return data || [];
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  ENTITY EXTRACTION PATTERNS BY SENDER');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('Fetching classification data...');
  const classifications = await getAllData();
  console.log(`Total classifications: ${classifications.length}\n`);

  // Analyze by sender category
  const senderStats: Record<string, {
    total: number;
    withAttachments: number;
    documentTypes: Record<string, number>;
    emailTypes: Record<string, number>;
  }> = {};

  for (const row of classifications) {
    const email = row.raw_emails;
    const sender = email.true_sender_email || email.sender_email || '';
    const category = getSenderCategory(sender);

    if (!senderStats[category]) {
      senderStats[category] = {
        total: 0,
        withAttachments: 0,
        documentTypes: {},
        emailTypes: {},
      };
    }

    const stats = senderStats[category];
    stats.total++;
    if (email.has_attachments) stats.withAttachments++;

    const docType = row.document_type || 'unknown';
    stats.documentTypes[docType] = (stats.documentTypes[docType] || 0) + 1;

    if (row.email_type) {
      stats.emailTypes[row.email_type] = (stats.emailTypes[row.email_type] || 0) + 1;
    }
  }

  // Print results by sender category
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  DOCUMENT TYPES BY SENDER CATEGORY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const sortedCategories = Object.entries(senderStats)
    .sort((a, b) => b[1].total - a[1].total);

  for (const [category, stats] of sortedCategories) {
    const attachPct = ((stats.withAttachments / stats.total) * 100).toFixed(0);

    console.log(`\n┌─ ${category.toUpperCase()} (${stats.total} emails, ${attachPct}% with attachments)`);
    console.log('│');
    console.log('│  Document Types:');

    const topDocTypes = Object.entries(stats.documentTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    for (const [type, count] of topDocTypes) {
      const pct = ((count / stats.total) * 100).toFixed(1);
      console.log(`│    ${type.padEnd(25)} ${count.toString().padStart(4)} (${pct}%)`);
    }

    console.log('│');
    console.log('│  Email Types (top 5):');

    const topEmailTypes = Object.entries(stats.emailTypes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    for (const [type, count] of topEmailTypes) {
      const pct = ((count / stats.total) * 100).toFixed(1);
      console.log(`│    ${type.padEnd(25)} ${count.toString().padStart(4)} (${pct}%)`);
    }

    console.log('└─');
  }

  // Now analyze entity extractions if they exist
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  ENTITY TYPES BY SENDER CATEGORY');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const extractions = await getEntityExtractions();

  if (extractions.length === 0) {
    console.log('No entity extractions found in entity_extractions table.');
    console.log('Run extraction pipeline first to populate this data.\n');
  } else {
    const entityBySender: Record<string, Record<string, number>> = {};

    for (const ext of extractions) {
      const email = ext.raw_emails;
      const sender = email?.true_sender_email || email?.sender_email || '';
      const category = getSenderCategory(sender);

      if (!entityBySender[category]) {
        entityBySender[category] = {};
      }

      const entityType = ext.entity_type;
      entityBySender[category][entityType] = (entityBySender[category][entityType] || 0) + 1;
    }

    for (const [category, entities] of Object.entries(entityBySender).sort((a, b) =>
      Object.values(b[1]).reduce((s, v) => s + v, 0) - Object.values(a[1]).reduce((s, v) => s + v, 0)
    )) {
      console.log(`\n${category.toUpperCase()}:`);

      const sortedEntities = Object.entries(entities)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);

      for (const [entityType, count] of sortedEntities) {
        console.log(`  ${entityType.padEnd(25)} ${count}`);
      }
    }
  }

  // Recommended patterns summary
  console.log('\n\n═══════════════════════════════════════════════════════════════');
  console.log('  RECOMMENDED EXTRACTION FOCUS BY SENDER');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const recommendations: Record<string, { emailEntities: string[]; documentEntities: string[] }> = {
    'maersk': {
      emailEntities: ['booking_number', 'vessel_name', 'voyage_number', 'etd', 'eta', 'container_number'],
      documentEntities: ['booking_number', 'bl_number', 'container_number', 'port_of_loading', 'port_of_discharge', 'shipper', 'consignee', 'si_cutoff', 'vgm_cutoff'],
    },
    'hapag': {
      emailEntities: ['booking_number', 'vessel_name', 'voyage_number', 'etd', 'container_number'],
      documentEntities: ['booking_number', 'bl_number', 'container_number', 'port_of_loading', 'port_of_discharge', 'shipper', 'consignee'],
    },
    'cma_cgm': {
      emailEntities: ['booking_number', 'vessel_name', 'etd', 'eta'],
      documentEntities: ['booking_number', 'bl_number', 'container_number', 'weight_kg', 'volume_cbm'],
    },
    'customs_broker': {
      emailEntities: ['entry_number', 'bl_number', 'eta', 'ata'],
      documentEntities: ['entry_number', 'invoice_number', 'total_amount', 'currency', 'commodity'],
    },
    'freight_forwarder': {
      emailEntities: ['booking_number', 'job_number', 'bl_number', 'container_number'],
      documentEntities: ['booking_number', 'bl_number', 'shipper', 'consignee', 'commodity', 'weight_kg'],
    },
  };

  for (const [category, rec] of Object.entries(recommendations)) {
    console.log(`${category.toUpperCase()}:`);
    console.log(`  Email Focus:    ${rec.emailEntities.join(', ')}`);
    console.log(`  Document Focus: ${rec.documentEntities.join(', ')}`);
    console.log('');
  }
}

main().catch(console.error);
