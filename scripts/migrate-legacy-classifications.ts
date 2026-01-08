/**
 * Migrate Legacy Document Classifications to Content Classification Types
 *
 * Maps old document types from deprecated classification system to
 * new content-classification-config.ts types.
 *
 * Usage:
 *   npx tsx scripts/migrate-legacy-classifications.ts              # Dry run
 *   npx tsx scripts/migrate-legacy-classifications.ts --execute    # Apply
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { DOCUMENT_TYPE_CONFIGS } from '../lib/config/content-classification-config';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const DRY_RUN = !process.argv.includes('--execute');

// Valid content classification types
const VALID_TYPES = new Set(DOCUMENT_TYPE_CONFIGS.map(c => c.type));

// Legacy type to new type mapping
const LEGACY_TYPE_MAPPING: Record<string, string> = {
  // BL types
  'bill_of_lading': 'mbl',
  'hbl_draft': 'draft_hbl',
  'house_bl': 'hbl',
  'mbl_draft': 'draft_mbl',

  // SI types
  'si_submission': 'si_confirmation',

  // ISF types
  'isf_submission': 'isf_filing',

  // VGM types
  'vgm_submission': 'vgm_confirmation',

  // Catch-all types
  'unknown': 'general_correspondence',
  'acknowledgement': 'general_correspondence',
  'certificate': 'general_correspondence',
  'cost_approval': 'general_correspondence',

  // Status/notice types - need subject analysis
  'shipment_notice': 'NEEDS_ANALYSIS',  // Could be arrival_notice or shipment_status
  'customs_clearance': 'general_correspondence',
  'customs_document': 'general_correspondence',

  // Delivery types
  'delivery_appointment': 'general_correspondence',
  'delivery_notification': 'general_correspondence',
  'pickup_notification': 'general_correspondence',
  'pickup_confirmation': 'general_correspondence',

  // Railment
  'railment_status': 'shipment_status',

  // Rate quote - not a shipment document
  'rate_quote': 'DELETE',  // These shouldn't be linked to shipments

  // VGM reminder
  'vgm_reminder': 'vgm_confirmation',
};

// Patterns to determine what shipment_notice should become
const SHIPMENT_NOTICE_PATTERNS = [
  { pattern: /arrival|arrived|discharge/i, newType: 'arrival_notice' },
  { pattern: /FMC\s+filing/i, newType: 'shipment_status' },
  { pattern: /railment|rail/i, newType: 'shipment_status' },
  { pattern: /status|update/i, newType: 'shipment_status' },
  { pattern: /exception|report/i, newType: 'shipment_status' },
];

interface MigrationAction {
  docId: string;
  emailId: string;
  oldType: string;
  newType: string;
  subject: string;
  action: 'update' | 'delete' | 'skip';
  reason?: string;
}

async function main() {
  console.log('MIGRATE LEGACY CLASSIFICATIONS');
  console.log('='.repeat(70));
  console.log('Mode:', DRY_RUN ? 'DRY RUN (use --execute to apply)' : 'EXECUTING');
  console.log('');

  // Step 1: Get all shipment_documents with legacy types
  console.log('Step 1: Finding legacy document types...');
  const { data: docs } = await supabase
    .from('shipment_documents')
    .select(`
      id,
      document_type,
      email_id,
      raw_emails!shipment_documents_email_id_fkey(subject)
    `)
    .not('document_type', 'in', `(${[...VALID_TYPES].join(',')})`);

  if (!docs || docs.length === 0) {
    console.log('  No legacy document types found!');
    return;
  }

  console.log(`  Found ${docs.length} documents with legacy types`);
  console.log('');

  // Step 2: Plan migrations
  console.log('Step 2: Planning migrations...');
  const actions: MigrationAction[] = [];

  for (const doc of docs) {
    const email = (doc as any).raw_emails;
    const subject = email?.subject || '';
    const oldType = doc.document_type;

    let mapping = LEGACY_TYPE_MAPPING[oldType];

    // Special handling for shipment_notice
    if (mapping === 'NEEDS_ANALYSIS') {
      mapping = analyzeShipmentNotice(subject);
    }

    if (!mapping) {
      actions.push({
        docId: doc.id,
        emailId: doc.email_id,
        oldType,
        newType: 'general_correspondence',
        subject: subject.substring(0, 50),
        action: 'update',
        reason: 'No mapping found - defaulting to general_correspondence',
      });
    } else if (mapping === 'DELETE') {
      actions.push({
        docId: doc.id,
        emailId: doc.email_id,
        oldType,
        newType: '',
        subject: subject.substring(0, 50),
        action: 'delete',
        reason: 'Rate quotes should not be linked to shipments',
      });
    } else {
      actions.push({
        docId: doc.id,
        emailId: doc.email_id,
        oldType,
        newType: mapping,
        subject: subject.substring(0, 50),
        action: 'update',
      });
    }
  }

  // Step 3: Show summary by type change
  console.log('Step 3: Migration summary');
  console.log('-'.repeat(70));

  const byChange = new Map<string, MigrationAction[]>();
  for (const action of actions) {
    const key = action.action === 'delete'
      ? `DELETE: ${action.oldType}`
      : `${action.oldType} → ${action.newType}`;
    const existing = byChange.get(key) || [];
    existing.push(action);
    byChange.set(key, existing);
  }

  for (const [change, items] of [...byChange.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${change} (${items.length} docs):`);
    for (const item of items.slice(0, 3)) {
      console.log(`  "${item.subject}..."`);
    }
    if (items.length > 3) {
      console.log(`  ... and ${items.length - 3} more`);
    }
  }
  console.log('');

  // Step 4: Execute if not dry run
  if (!DRY_RUN) {
    console.log('Step 4: Executing migrations...');

    let updated = 0;
    let deleted = 0;
    let errors = 0;

    for (const action of actions) {
      if (action.action === 'update') {
        // Update shipment_documents
        const { error: docError } = await supabase
          .from('shipment_documents')
          .update({ document_type: action.newType })
          .eq('id', action.docId);

        // Also update document_classifications
        const { error: classError } = await supabase
          .from('document_classifications')
          .update({ document_type: action.newType })
          .eq('email_id', action.emailId);

        if (docError || classError) {
          errors++;
        } else {
          updated++;
        }
      } else if (action.action === 'delete') {
        // Delete the shipment_document link (rate_quote shouldn't be linked)
        const { error } = await supabase
          .from('shipment_documents')
          .delete()
          .eq('id', action.docId);

        if (error) {
          errors++;
        } else {
          deleted++;
        }
      }
    }

    console.log(`  Updated: ${updated}`);
    console.log(`  Deleted: ${deleted}`);
    console.log(`  Errors: ${errors}`);
  }

  // Summary
  console.log('');
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  const updateCount = actions.filter(a => a.action === 'update').length;
  const deleteCount = actions.filter(a => a.action === 'delete').length;

  console.log(`Total legacy documents: ${docs.length}`);
  console.log(`  To update: ${updateCount}`);
  console.log(`  To delete: ${deleteCount}`);

  if (DRY_RUN) {
    console.log('');
    console.log('DRY RUN - No changes made. Run with --execute to apply.');
  }
}

function analyzeShipmentNotice(subject: string): string {
  for (const { pattern, newType } of SHIPMENT_NOTICE_PATTERNS) {
    if (pattern.test(subject)) {
      return newType;
    }
  }
  // Default for shipment_notice without clear pattern
  return 'shipment_status';
}

main().catch(console.error);
