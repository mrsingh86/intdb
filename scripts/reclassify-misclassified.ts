/**
 * Reclassify misclassified emails using enhanced classification
 *
 * Targets emails where subject pattern clearly indicates a type
 * but AI previously misclassified them.
 */
import { createClient } from '@supabase/supabase-js';
import { UnifiedClassificationService } from '../lib/services/unified-classification-service';
import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const PAGE_SIZE = 1000;

async function fetchAll<T>(table: string, select: string): Promise<T[]> {
  let all: T[] = [];
  let page = 0;
  let hasMore = true;
  while (hasMore) {
    const { data } = await supabase
      .from(table)
      .select(select)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (data && data.length > 0) {
      all = all.concat(data as T[]);
      hasMore = data.length === PAGE_SIZE;
      page++;
    } else {
      hasMore = false;
    }
  }
  return all;
}

async function main() {
  const classifier = new UnifiedClassificationService(supabase, {
    useAiFallback: false, // Use deterministic only for reclassification
  });

  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('              RECLASSIFY MISCLASSIFIED EMAILS');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Get all emails with pagination
  console.log('Fetching all emails...');
  const emails = await fetchAll<{ id: string; subject: string; sender_email: string; true_sender_email: string }>(
    'raw_emails',
    'id, subject, sender_email, true_sender_email'
  );

  if (!emails || emails.length === 0) {
    console.log('No emails found');
    return;
  }

  console.log('Total emails:', emails.length);

  // Get all current classifications with pagination
  console.log('Fetching classifications...');
  const classifications = await fetchAll<{ email_id: string; document_type: string; confidence_score: number }>(
    'document_classifications',
    'email_id, document_type, confidence_score'
  );

  const classificationMap = new Map(
    classifications?.map(c => [c.email_id, c]) || []
  );
  console.log('Classifications found:', classifications.length);

  let reclassified = 0;
  let unchanged = 0;
  let noChange = 0;
  const changes: Array<{ subject: string; from: string; to: string }> = [];

  for (const email of emails) {
    // Try new classification
    const newResult = await classifier.classify({
      emailId: email.id,
      subject: email.subject || '',
      senderEmail: email.sender_email || '',
      trueSenderEmail: email.true_sender_email || undefined,
      hasAttachments: false,
    });

    // Only reclassify if deterministic pattern matched with high confidence
    if (newResult.method === 'deterministic' && newResult.confidence >= 85) {
      const currentClassification = classificationMap.get(email.id);
      const currentType = currentClassification?.document_type;

      // Check if classification changed
      if (currentType && currentType !== newResult.documentType) {
        // Update classification
        const { error } = await supabase
          .from('document_classifications')
          .update({
            document_type: newResult.documentType,
            confidence_score: newResult.confidence,
            model_name: 'deterministic',
            model_version: 'v3|subject_patterns',
            classification_reason: newResult.classificationReason,
            classified_at: new Date().toISOString(),
          })
          .eq('email_id', email.id);

        if (!error) {
          reclassified++;
          changes.push({
            subject: (email.subject || '').substring(0, 50),
            from: currentType,
            to: newResult.documentType,
          });

          // Also update shipment_documents if linked
          await supabase
            .from('shipment_documents')
            .update({ document_type: newResult.documentType })
            .eq('email_id', email.id);
        }
      } else {
        noChange++;
      }
    } else {
      unchanged++;
    }
  }

  console.log('');
  console.log('Results:');
  console.log('─'.repeat(60));
  console.log('  Reclassified:', reclassified);
  console.log('  No change needed:', noChange);
  console.log('  No pattern match (unchanged):', unchanged);
  console.log('');

  if (changes.length > 0) {
    console.log('Changes made:');
    console.log('─'.repeat(60));

    // Group by change type
    const byChange: Record<string, number> = {};
    for (const c of changes) {
      const key = `${c.from} → ${c.to}`;
      byChange[key] = (byChange[key] || 0) + 1;
    }

    for (const [change, count] of Object.entries(byChange).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${change}: ${count}`);
    }

    console.log('');
    console.log('Sample changes:');
    console.log('─'.repeat(60));
    for (const c of changes.slice(0, 10)) {
      console.log(`  "${c.subject}..."`);
      console.log(`    ${c.from} → ${c.to}`);
    }
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

main().catch(console.error);
