import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { createDocumentContentClassificationService } from '../lib/services/classification/document-content-classification-service';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function test() {
  // Get COSCO PDF text
  const { data: att } = await supabase
    .from('raw_attachments')
    .select('filename, extracted_text')
    .ilike('filename', '%6441569540.pdf%')
    .limit(1)
    .single();

  if (!att?.extracted_text) {
    console.log('No PDF content found');
    return;
  }

  console.log('=== COSCO PDF CONTENT TEST ===\n');
  console.log('Filename:', att.filename);
  console.log('Content length:', att.extracted_text.length);
  console.log('\nFull content:\n', att.extracted_text.substring(0, 1000));
  console.log('\n...');

  // Check for "BOOKING CONFIRMATION" (case-insensitive)
  const textUpper = att.extracted_text.toUpperCase();
  console.log('\n=== PATTERN CHECKS ===');
  console.log('Contains "BOOKING CONFIRMATION":', textUpper.includes('BOOKING CONFIRMATION'));
  console.log('Contains "BOOKING":', textUpper.includes('BOOKING'));
  console.log('Contains "CONFIRMATION":', textUpper.includes('CONFIRMATION'));
  console.log('Contains "COSCO":', textUpper.includes('COSCO'));

  // Run classification
  console.log('\n=== CLASSIFICATION RESULT ===');
  const service = createDocumentContentClassificationService();
  const result = service.classify({ pdfContent: att.extracted_text });

  if (result) {
    console.log('Document Type:', result.documentType);
    console.log('Confidence:', result.confidence);
    console.log('Category:', result.category);
    console.log('Matched Markers:', result.matchedMarkers);
  } else {
    console.log('Classification returned NULL - no confident match');
  }
}

test().catch(console.error);
