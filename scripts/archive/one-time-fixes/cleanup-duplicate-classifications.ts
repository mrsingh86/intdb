/**
 * Cleanup Duplicate Classifications
 *
 * Removes duplicate classifications per email, keeping only the most authoritative one.
 * Priority: booking_confirmation > booking_amendment > bill_of_lading > shipping_instruction > invoice > other
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

// Priority order (higher = more authoritative)
const DOC_TYPE_PRIORITY: Record<string, number> = {
  'booking_confirmation': 100,
  'booking_amendment': 90,
  'amendment': 85,
  'bill_of_lading': 80,
  'arrival_notice': 75,
  'delivery_order': 70,
  'shipping_instruction': 60,
  'invoice': 50,
  'detention_notice': 40,
  'customs_document': 30,
  'other': 10
};

async function cleanupDuplicates() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         CLEANUP DUPLICATE CLASSIFICATIONS                         ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // Find emails with multiple classifications
  const { data: duplicates, error } = await supabase
    .from('document_classifications')
    .select('email_id')
    .then(async ({ data }) => {
      if (!data) return { data: null, error: 'No data' };

      // Group by email_id and find duplicates
      const emailCounts: Record<string, number> = {};
      data.forEach(d => {
        emailCounts[d.email_id] = (emailCounts[d.email_id] || 0) + 1;
      });

      const duplicateEmails = Object.entries(emailCounts)
        .filter(([_, count]) => count > 1)
        .map(([emailId, _]) => emailId);

      return { data: duplicateEmails, error: null };
    });

  if (error || !duplicates) {
    console.error('Error finding duplicates:', error);
    return;
  }

  console.log(`Found ${duplicates.length} emails with duplicate classifications\n`);

  let cleaned = 0;
  let deleted = 0;

  for (const emailId of duplicates) {
    // Get all classifications for this email
    const { data: classifications } = await supabase
      .from('document_classifications')
      .select('id, document_type, confidence_score, created_at')
      .eq('email_id', emailId)
      .order('created_at', { ascending: true });

    if (!classifications || classifications.length <= 1) continue;

    // Sort by priority (highest first), then by confidence score
    const sorted = classifications.sort((a, b) => {
      const priorityA = DOC_TYPE_PRIORITY[a.document_type] || 0;
      const priorityB = DOC_TYPE_PRIORITY[b.document_type] || 0;

      if (priorityA !== priorityB) return priorityB - priorityA;
      return (b.confidence_score || 0) - (a.confidence_score || 0);
    });

    // Keep the first (highest priority), delete the rest
    const toKeep = sorted[0];
    const toDelete = sorted.slice(1);

    console.log(`Email ${emailId.substring(0, 8)}...:`);
    console.log(`  Keep: ${toKeep.document_type} (priority: ${DOC_TYPE_PRIORITY[toKeep.document_type] || 0})`);
    console.log(`  Delete: ${toDelete.map(d => d.document_type).join(', ')}`);

    // Delete duplicates
    for (const dup of toDelete) {
      const { error: delError } = await supabase
        .from('document_classifications')
        .delete()
        .eq('id', dup.id);

      if (!delError) {
        deleted++;
      } else {
        console.error(`  Error deleting ${dup.id}:`, delError.message);
      }
    }

    cleaned++;
  }

  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║                         SUMMARY                                    ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');
  console.log(`✅ Emails cleaned:         ${cleaned}`);
  console.log(`✅ Duplicates deleted:     ${deleted}`);
  console.log('\n🎉 Done!\n');
}

cleanupDuplicates().catch(console.error);
