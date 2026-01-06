/**
 * Process broker emails using the PRODUCTION EmailProcessingOrchestrator
 *
 * This ensures:
 * - Full classification (attachment → body → subject)
 * - AI + regex entity extraction
 * - Direction detection (inbound/outbound)
 * - Workflow state assignment
 * - Proper linking logic
 */

import { createClient } from '@supabase/supabase-js';
import { EmailProcessingOrchestrator } from '../lib/services/email-processing-orchestrator';
import * as dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function main() {
  console.log('='.repeat(100));
  console.log('PROCESSING BROKER EMAILS (PRODUCTION ORCHESTRATOR)');
  console.log('='.repeat(100));

  // Initialize production orchestrator with proper constructor args
  const orchestrator = new EmailProcessingOrchestrator(
    SUPABASE_URL,
    SUPABASE_KEY,
    ANTHROPIC_KEY
  );

  // Get pending broker emails
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email')
    .eq('processing_status', 'pending')
    .or('sender_email.ilike.%portside%,sender_email.ilike.%artemus%,sender_email.ilike.%sssusainc%,sender_email.ilike.%CHBentries%')
    .order('received_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Error fetching emails:', error);
    return;
  }

  console.log(`\nFound ${emails?.length || 0} pending broker emails\n`);

  if (!emails || emails.length === 0) {
    console.log('No pending emails to process');
    return;
  }

  let processed = 0;
  let failed = 0;
  let linked = 0;
  let orphaned = 0;

  for (const email of emails) {
    console.log('─'.repeat(70));
    console.log('Processing:', email.id.substring(0, 8));
    console.log('Subject:', (email.subject || '').substring(0, 60));

    try {
      // Use production orchestrator - handles everything:
      // - Classification (attachment → body → subject → AI fallback)
      // - Entity extraction (AI + regex fallback)
      // - Direction detection
      // - Workflow state
      // - Linking to shipment OR creating orphan document
      const result = await orchestrator.processEmail(email.id);

      if (result.success) {
        processed++;
        if (result.shipmentId) {
          linked++;
          console.log(`  ✅ Linked to shipment: ${result.shipmentId.substring(0, 8)}...`);
        } else {
          orphaned++;
          console.log(`  📋 Processed (orphan document created)`);
        }
        if (result.fieldsExtracted) {
          console.log(`  📦 Extracted ${result.fieldsExtracted} fields`);
        }
      } else {
        failed++;
        console.log(`  ❌ Failed at stage: ${result.stage}`);
        if (result.error) {
          console.log(`     Error: ${result.error}`);
        }
      }
    } catch (err: any) {
      failed++;
      console.log(`  ❌ Error:`, err.message);

      // Mark as failed
      await supabase
        .from('raw_emails')
        .update({
          processing_status: 'failed',
          processing_error: err.message
        })
        .eq('id', email.id);
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log('PROCESSING COMPLETE');
  console.log('='.repeat(100));
  console.log(`\nSummary:`);
  console.log(`  Processed: ${processed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Linked to shipments: ${linked}`);
  console.log(`  Orphan documents: ${orphaned}`);
}

main().catch(console.error);
