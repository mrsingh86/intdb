#!/usr/bin/env npx tsx
/**
 * Extract PDF Text from Email Body
 *
 * Many emails have PDF text already embedded in body_text
 * Format: === filename.pdf ===\n{PDF text content}
 *
 * This script extracts that text and stores it in raw_attachments
 */

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Pattern to find embedded PDF sections
// === filename.pdf ===
// {content}
// === next section or end ===
function extractEmbeddedPdfText(bodyText: string): Map<string, string> {
  const pdfTexts = new Map<string, string>();

  // Find all PDF sections - match "=== something.pdf ===" or "=== something.PDF ==="
  const pdfPattern = /===\s*([^=\n]+\.pdf)\s*===/gi;
  let match;
  const markers: { filename: string; start: number; end: number }[] = [];

  while ((match = pdfPattern.exec(bodyText)) !== null) {
    markers.push({
      filename: match[1].trim().toLowerCase(),
      start: match.index,
      end: match.index + match[0].length
    });
  }

  // Find all section markers for determining boundaries
  const sectionPattern = /===\s*[^=\n]+\s*===/g;
  const allMarkerPositions: number[] = [];
  let sectionMatch;
  while ((sectionMatch = sectionPattern.exec(bodyText)) !== null) {
    allMarkerPositions.push(sectionMatch.index);
  }
  allMarkerPositions.push(bodyText.length); // Add end of text

  // Extract text between PDF marker and next marker
  for (const marker of markers) {
    // Find the next marker after this PDF section ends
    const nextMarkerIndex = allMarkerPositions.find(idx => idx > marker.end);
    if (nextMarkerIndex) {
      const text = bodyText.substring(marker.end, nextMarkerIndex).trim();
      if (text.length > 50) { // Only keep substantial text
        pdfTexts.set(marker.filename, text);
      }
    }
  }

  return pdfTexts;
}

async function main() {
  console.log('=== EXTRACTING EMBEDDED PDF TEXT ===\n');

  // Get emails with potential embedded PDF text
  // Pattern: === filename.pdf ===
  const { data: emails, error } = await supabase
    .from('raw_emails')
    .select('id, body_text')
    .ilike('body_text', '%=== %.pdf ===%');

  if (error) {
    console.error('Database error:', error.message);
    process.exit(1);
  }

  console.log('Emails with embedded PDFs:', emails?.length || 0);

  // Get all attachments for updating
  const { data: allAttachments } = await supabase
    .from('raw_attachments')
    .select('id, email_id, filename, extracted_text')
    .ilike('mime_type', '%pdf%');

  // Create lookup by email_id + filename (lowercase)
  const attachmentLookup = new Map<string, any>();
  allAttachments?.forEach(att => {
    const key = `${att.email_id}:${att.filename.toLowerCase()}`;
    attachmentLookup.set(key, att);
  });

  console.log('PDF attachments in database:', allAttachments?.length);

  // Stats
  const stats = {
    processed: 0,
    pdfSectionsFound: 0,
    matched: 0,
    updated: 0,
    alreadyHasText: 0,
  };

  // Process each email
  for (const email of emails || []) {
    stats.processed++;

    if (stats.processed % 50 === 0) {
      console.log(`Progress: ${stats.processed}/${emails?.length} (updated: ${stats.updated})`);
    }

    const bodyText = email.body_text || '';
    const pdfTexts = extractEmbeddedPdfText(bodyText);

    for (const [filename, text] of pdfTexts) {
      stats.pdfSectionsFound++;

      // Find matching attachment
      const key = `${email.id}:${filename}`;
      const attachment = attachmentLookup.get(key);

      if (!attachment) {
        // Try partial match
        for (const [k, att] of attachmentLookup) {
          if (k.startsWith(email.id + ':') && k.includes(filename.split('.')[0])) {
            // Found partial match
            if (att.extracted_text) {
              stats.alreadyHasText++;
              continue;
            }
            stats.matched++;

            // Update attachment with extracted text
            const { error: updateError } = await supabase
              .from('raw_attachments')
              .update({
                extracted_text: text,
                extraction_status: 'completed',
                extracted_at: new Date().toISOString()
              })
              .eq('id', att.id);

            if (!updateError) {
              stats.updated++;
            }
            break;
          }
        }
        continue;
      }

      if (attachment.extracted_text) {
        stats.alreadyHasText++;
        continue;
      }

      stats.matched++;

      // Update attachment with extracted text
      const { error: updateError } = await supabase
        .from('raw_attachments')
        .update({
          extracted_text: text,
          extraction_status: 'completed',
          extracted_at: new Date().toISOString()
        })
        .eq('id', attachment.id);

      if (!updateError) {
        stats.updated++;
      }
    }
  }

  console.log('\n=== RESULTS ===');
  console.log('Emails processed:', stats.processed);
  console.log('PDF sections found:', stats.pdfSectionsFound);
  console.log('Matched to attachments:', stats.matched);
  console.log('Updated:', stats.updated);
  console.log('Already had text:', stats.alreadyHasText);

  // Show updated counts
  const { count: totalPdfs } = await supabase
    .from('raw_attachments')
    .select('id', { count: 'exact', head: true })
    .ilike('mime_type', '%pdf%');

  const { count: withText } = await supabase
    .from('raw_attachments')
    .select('id', { count: 'exact', head: true })
    .ilike('mime_type', '%pdf%')
    .not('extracted_text', 'is', null);

  console.log('\n=== PDF STATUS ===');
  console.log('Total PDFs:', totalPdfs);
  console.log('With extracted text:', withText);
  console.log('Still pending:', (totalPdfs || 0) - (withText || 0));
}

main().catch(console.error);
