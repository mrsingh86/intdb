import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function trace() {
  const emailId = '1712c66b-4dd5-4129-8f48-c49918101671';

  console.log('=== ORCHESTRATOR FLOW TRACE ===\n');

  // 1. Check email
  const { data: email } = await supabase
    .from('raw_emails')
    .select('id, subject, sender_email, true_sender_email, body_text, processing_status')
    .eq('id', emailId)
    .single();

  console.log('1. EMAIL:');
  console.log('   ID:', email?.id);
  console.log('   Subject:', email?.subject?.substring(0, 60));
  console.log('   Status:', email?.processing_status);

  // 2. Check attachment classifications
  const { data: attClasses } = await supabase
    .from('attachment_classifications')
    .select('document_type, confidence')
    .eq('email_id', emailId);

  console.log('\n2. ATTACHMENT CLASSIFICATION:');
  if (attClasses && attClasses.length > 0) {
    const bc = attClasses.find(a => a.document_type === 'booking_confirmation');
    console.log('   document_type:', bc?.document_type);
    console.log('   confidence:', bc?.confidence, '→', (bc?.confidence || 0) * 100 + '%');
  }

  // 3. Get extraction entities
  const { data: emailExtractions } = await supabase
    .from('email_extractions')
    .select('entity_type, entity_value')
    .eq('email_id', emailId);

  console.log('\n3. EMAIL EXTRACTIONS:');
  const entities: Record<string, string> = {};
  emailExtractions?.forEach(e => {
    console.log('   ', e.entity_type, '=', e.entity_value);
    entities[e.entity_type] = e.entity_value;
  });

  // 4. Check what extractedData would be
  console.log('\n4. EXTRACTED_DATA (mapped):');
  const extractedData = {
    booking_number: entities.booking_number || undefined,
    carrier: entities.carrier || 'maersk',
  };
  console.log('   booking_number:', extractedData.booking_number);
  console.log('   carrier:', extractedData.carrier);

  // 5. Check processBookingConfirmation conditions
  console.log('\n5. PROCESS_BOOKING_CONFIRMATION CONDITIONS:');
  console.log('   documentType === booking_confirmation:', true);
  console.log('   confidence >= 70:', (attClasses?.[0]?.confidence || 0) * 100 >= 70);
  console.log('   booking_number exists:', !!extractedData.booking_number);

  // 6. Simulate carrier detection
  const content = email?.body_text || '';
  const { data: atts } = await supabase
    .from('raw_attachments')
    .select('extracted_text')
    .eq('email_id', emailId);

  let fullContent = content;
  atts?.forEach(a => {
    if (a.extracted_text) fullContent += '\n' + a.extracted_text;
  });

  function detectCarrier(senderEmail: string, content: string): string {
    const combined = `${senderEmail} ${content}`.toLowerCase();
    if (combined.includes('maersk')) return 'maersk';
    if (combined.includes('hapag')) return 'hapag-lloyd';
    return 'default';
  }

  const carrier = detectCarrier(email?.true_sender_email || email?.sender_email || '', fullContent);
  console.log('\n6. CARRIER DETECTION:');
  console.log('   detected carrier:', carrier);

  // Check content-based detection
  const hasBookingConfirmation = /BOOKING CONFIRMATION/i.test(fullContent);
  const hasCarrierBranding = /MAERSK/i.test(fullContent);
  const isContentBased = carrier !== 'default' && hasBookingConfirmation && hasCarrierBranding;

  console.log('   hasBookingConfirmation in content:', hasBookingConfirmation);
  console.log('   hasCarrierBranding:', hasCarrierBranding);
  console.log('   isCarrierContentBasedEmail:', isContentBased);

  // 7. Check if shipment should be created
  console.log('\n7. SHIPMENT CREATION CHECK:');
  console.log('   All conditions met for creation:',
    extractedData.booking_number && isContentBased ? 'YES' : 'NO');

  // 8. Check existing shipments
  const { data: existing } = await supabase
    .from('shipments')
    .select('id, booking_number')
    .eq('booking_number', extractedData.booking_number || '')
    .single();

  console.log('   Existing shipment for this booking#:', existing ? existing.id : 'NONE');

  // 9. Check email_shipment_links
  const { data: links } = await supabase
    .from('email_shipment_links')
    .select('id, shipment_id')
    .eq('email_id', emailId);

  console.log('\n8. EMAIL_SHIPMENT_LINKS:');
  console.log('   Links for this email:', links?.length || 0);

  console.log('\n=== END TRACE ===');
}

trace().catch(console.error);
