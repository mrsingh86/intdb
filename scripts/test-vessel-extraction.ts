import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { createDocumentTypeExtractor } from '../lib/services/extraction/document-type-extractor';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function test() {
  // Get CMA CGM attachment text
  const { data: att } = await supabase
    .from('raw_attachments')
    .select('extracted_text, filename, raw_emails!inner(subject)')
    .ilike('raw_emails.subject', '%CMA CGM%CAD0850918%')
    .not('extracted_text', 'is', null)
    .single();

  if (!att) {
    console.log('No attachment found');
    return;
  }

  console.log('Testing:', att.filename);
  console.log('Subject:', (att.raw_emails as any)?.subject);
  console.log('');

  // Extract using the document type extractor
  const extractor = createDocumentTypeExtractor();
  const result = extractor.extract('booking_confirmation', att.extracted_text || '');

  if (!result) {
    console.log('No extraction result');
    return;
  }

  console.log('=== EXTRACTION RESULT ===');
  console.log('vessel_name:', result.fields.vessel_name?.value);
  console.log('voyage_number:', result.fields.voyage_number?.value);
  console.log('booking_number:', result.fields.booking_number?.value);
  console.log('etd:', result.fields.etd?.value);
  console.log('port_of_loading:', result.fields.port_of_loading?.value);
  console.log('port_of_discharge:', result.fields.port_of_discharge?.value);

  console.log('');
  console.log('Raw vessel field:', JSON.stringify(result.fields.vessel_name, null, 2));
  console.log('Raw voyage field:', JSON.stringify(result.fields.voyage_number, null, 2));
}

test().catch(console.error);
