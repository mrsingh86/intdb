import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

import { UnifiedExtractionService } from '../lib/services/extraction';

async function trace() {
  const emailId = 'b452d434-da84-44c2-b486-fd4e4838c409';

  // Get email
  const { data: email } = await supabase
    .from('raw_emails')
    .select('subject, body_text')
    .eq('id', emailId)
    .single();

  // Get PDF
  const { data: att } = await supabase
    .from('raw_attachments')
    .select('id, extracted_text')
    .eq('email_id', emailId)
    .not('extracted_text', 'is', null)
    .limit(1)
    .single();

  console.log('=== UNIFIED EXTRACTION TRACE ===\n');

  // Run extraction
  const service = new UnifiedExtractionService(supabase);
  const result = await service.extract({
    emailId,
    attachmentId: att?.id,
    documentType: 'booking_confirmation',
    emailSubject: email?.subject || '',
    emailBody: email?.body_text || '',
    pdfContent: att?.extracted_text || '',
    carrier: 'cosco',
  });

  console.log('Schema confidence:', result.schemaConfidence);
  console.log('Email extractions:', result.emailExtractions);
  console.log('Document extractions:', result.documentExtractions);

  console.log('\n=== EXTRACTED ENTITIES ===');
  for (const [key, value] of Object.entries(result.entities)) {
    console.log(`${key}: "${value}"`);
  }

  // Check for date fields
  console.log('\n=== DATE FIELD VALUES ===');
  const dateFields = ['etd', 'eta', 'si_cutoff', 'vgm_cutoff', 'cargo_cutoff', 'gate_cutoff', 'doc_cutoff', 'departure_date', 'arrival_date'];
  for (const field of dateFields) {
    if (result.entities[field]) {
      console.log(`${field}: "${result.entities[field]}"`);
    }
  }
}

trace().catch(console.error);
