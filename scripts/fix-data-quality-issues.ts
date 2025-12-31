/**
 * Fix Data Quality Issues
 *
 * 1. Reclassify MTD Info Mail emails (wrongly classified as booking_confirmation)
 * 2. Merge duplicate shipments
 */

import { supabase } from '../utils/supabase-client';
import dotenv from 'dotenv';

dotenv.config();

async function fixDataQualityIssues() {
  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║         FIX DATA QUALITY ISSUES                                   ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  // 1. Fix MTD Info Mail classifications
  console.log('1. FIXING MTD INFO MAIL CLASSIFICATIONS\n');

  const { data: mtdEmails } = await supabase
    .from('raw_emails')
    .select('id, subject')
    .eq('subject', 'Hapag-Lloyd Info Mail');

  if (mtdEmails && mtdEmails.length > 0) {
    console.log(`Found ${mtdEmails.length} MTD emails to reclassify`);

    for (const email of mtdEmails) {
      const { error } = await supabase
        .from('document_classifications')
        .update({
          document_type: 'bill_of_lading',
          classification_reason: 'MTD (Maritime Transport Document) notification - not a booking confirmation'
        })
        .eq('email_id', email.id);

      if (!error) {
        console.log(`  ✅ Reclassified ${email.id.substring(0, 8)}... → bill_of_lading`);
      } else {
        console.error(`  ❌ Error: ${error.message}`);
      }
    }
  }

  // 2. Merge duplicate shipments
  console.log('\n2. MERGING DUPLICATE SHIPMENTS\n');

  const { data: allShipments } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff, port_of_loading, port_of_discharge, vessel_name');

  if (allShipments) {
    // Find duplicates by similar booking numbers
    const byNumber: Record<string, any[]> = {};
    allShipments.forEach(s => {
      const cleanNum = (s.booking_number || '').replace(/^HL-/, '');
      if (cleanNum) {
        if (!byNumber[cleanNum]) byNumber[cleanNum] = [];
        byNumber[cleanNum].push(s);
      }
    });

    const duplicates = Object.entries(byNumber).filter(([_, ships]) => ships.length > 1);

    for (const [num, ships] of duplicates) {
      console.log(`\nMerging duplicate: ${num} (${ships.length} shipments)`);

      // Find the one with most data
      const withData = ships.sort((a, b) => {
        const countA = [a.etd, a.eta, a.si_cutoff, a.vgm_cutoff, a.cargo_cutoff].filter(Boolean).length;
        const countB = [b.etd, b.eta, b.si_cutoff, b.vgm_cutoff, b.cargo_cutoff].filter(Boolean).length;
        return countB - countA;
      });

      const keeper = withData[0];
      const toDelete = withData.slice(1);

      console.log(`  Keeping: ${keeper.booking_number} (ETD=${keeper.etd || 'NULL'}, ${keeper.si_cutoff ? 'has cutoffs' : 'no cutoffs'})`);

      for (const dup of toDelete) {
        console.log(`  Deleting: ${dup.booking_number} (ETD=${dup.etd || 'NULL'})`);

        // Move linked documents to keeper
        const { data: linkedDocs } = await supabase
          .from('shipment_documents')
          .select('email_id')
          .eq('shipment_id', dup.id);

        if (linkedDocs && linkedDocs.length > 0) {
          for (const doc of linkedDocs) {
            // Check if already linked to keeper
            const { data: existing } = await supabase
              .from('shipment_documents')
              .select('id')
              .eq('shipment_id', keeper.id)
              .eq('email_id', doc.email_id)
              .single();

            if (!existing) {
              await supabase
                .from('shipment_documents')
                .update({ shipment_id: keeper.id })
                .eq('shipment_id', dup.id)
                .eq('email_id', doc.email_id);
              console.log(`    Moved doc ${doc.email_id.substring(0, 8)}... to keeper`);
            } else {
              await supabase
                .from('shipment_documents')
                .delete()
                .eq('shipment_id', dup.id)
                .eq('email_id', doc.email_id);
              console.log(`    Deleted duplicate doc link ${doc.email_id.substring(0, 8)}...`);
            }
          }
        }

        // Delete the duplicate shipment
        const { error: delError } = await supabase
          .from('shipments')
          .delete()
          .eq('id', dup.id);

        if (!delError) {
          console.log(`    ✅ Deleted duplicate shipment`);
        } else {
          console.error(`    ❌ Error deleting: ${delError.message}`);
        }
      }
    }
  }

  // 3. Show updated stats
  console.log('\n' + '═'.repeat(70));
  console.log('UPDATED STATISTICS');
  console.log('═'.repeat(70));

  const { data: classStats } = await supabase
    .from('document_classifications')
    .select('document_type');

  if (classStats) {
    const counts: Record<string, number> = {};
    classStats.forEach(c => {
      counts[c.document_type] = (counts[c.document_type] || 0) + 1;
    });
    console.log('\nDocument Classifications:');
    Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        console.log(`  ${type}: ${count}`);
      });
  }

  const { data: shipStats } = await supabase
    .from('shipments')
    .select('etd, eta, si_cutoff, vgm_cutoff, cargo_cutoff');

  if (shipStats) {
    console.log(`\nShipment Data Completeness (${shipStats.length} total):`);
    console.log(`  ETD:          ${shipStats.filter(s => s.etd).length}`);
    console.log(`  ETA:          ${shipStats.filter(s => s.eta).length}`);
    console.log(`  SI Cutoff:    ${shipStats.filter(s => s.si_cutoff).length}`);
    console.log(`  VGM Cutoff:   ${shipStats.filter(s => s.vgm_cutoff).length}`);
    console.log(`  Cargo Cutoff: ${shipStats.filter(s => s.cargo_cutoff).length}`);
  }

  console.log('\n🎉 Done!\n');
}

fixDataQualityIssues().catch(console.error);
