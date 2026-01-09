import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// Constants from orchestrator
const MINIMUM_CONFIDENCE_FOR_SHIPMENT_CREATION = 70;

// Copy methods from orchestrator
function detectCarrier(senderEmail: string, content: string): string {
  const combined = `${senderEmail} ${content}`.toLowerCase();
  if (combined.includes('hapag') || combined.includes('hlag') || combined.includes('hlcu')) return 'hapag-lloyd';
  if (combined.includes('maersk') || combined.includes('maeu') || combined.includes('msku')) return 'maersk';
  if (combined.includes('cma-cgm') || combined.includes('cma cgm') || combined.includes('cmau')) return 'cma-cgm';
  if (combined.includes('msc') && !combined.includes('misc')) return 'msc';
  if (combined.includes('cosco') || combined.includes('cosu')) return 'cosco';
  return 'default';
}

function isDirectCarrierEmail(trueSenderEmail: string | null, senderEmail: string): boolean {
  const carrierDomains = [
    'maersk.com', 'sealandmaersk.com',
    'hlag.com', 'service.hlag.com', 'csd.hlag.com',
    'cma-cgm.com', 'usa.cma-cgm.com',
    'msc.com', 'medlog.com',
    'cosco.com', 'coscon.com',
    'evergreen-marine.com',
    'one-line.com',
  ];

  const emailToCheck = (trueSenderEmail || senderEmail || '').toLowerCase();
  return carrierDomains.some(domain => emailToCheck.includes(domain));
}

function isKnownCarrierDisplayName(senderEmail: string): boolean {
  const senderLower = senderEmail.toLowerCase();
  const patterns = ['in.export', 'maersk line export', 'donotreply.*maersk'];
  return patterns.some(p => new RegExp(p, 'i').test(senderLower));
}

function isCarrierContentBasedEmail(content: string, detectedCarrier: string, subject?: string): boolean {
  if (detectedCarrier !== 'default') {
    const hasBookingConfirmation = /BOOKING CONFIRMATION/i.test(content);
    const hasCarrierBranding = /CMA CGM|MAERSK|HAPAG|MSC|COSCO|EVERGREEN|ONE|YANG MING/i.test(content);
    if (hasBookingConfirmation && hasCarrierBranding) {
      return true;
    }
  }
  return false;
}

async function debug() {
  const emailId = 'b452d434-da84-44c2-b486-fd4e4838c409';

  // Get email data
  const { data: email } = await supabase
    .from('raw_emails')
    .select('subject, sender_email, sender_name, true_sender_email, body_text, processing_status')
    .eq('id', emailId)
    .single();

  // Get attachment classifications
  const { data: attClasses } = await supabase
    .from('attachment_classifications')
    .select('document_type, confidence')
    .eq('email_id', emailId);

  // Get PDF content
  const { data: att } = await supabase
    .from('raw_attachments')
    .select('extracted_text, filename')
    .eq('email_id', emailId)
    .not('extracted_text', 'is', null);

  const pdfContent = att?.map(a => `--- ${a.filename} ---\n${a.extracted_text}`).join('\n') || '';
  const content = `Subject: ${email?.subject || ''}\n\nBody:\n${email?.body_text || ''}\n\n${pdfContent}`;

  console.log('=== COSCO EMAIL PROCESSING TRACE ===\n');
  console.log('Email ID:', emailId);
  console.log('Processing Status:', email?.processing_status);
  console.log('Subject:', email?.subject?.substring(0, 60));

  // Check classification
  const documentType = attClasses?.[0]?.document_type || null;
  const rawConfidence = attClasses?.[0]?.confidence || 0;
  const classificationConfidence = rawConfidence * 100;

  console.log('\n--- STEP 1: Classification ---');
  console.log('document_type:', documentType);
  console.log('raw confidence (from DB):', rawConfidence);
  console.log('classificationConfidence (* 100):', classificationConfidence);

  // Check if enters booking_confirmation block
  console.log('\n--- STEP 2: Document Type Check ---');
  console.log('documentType === "booking_confirmation":', documentType === 'booking_confirmation');

  if (documentType === 'booking_confirmation') {
    // Check confidence threshold
    console.log('\n--- STEP 3: Confidence Threshold ---');
    console.log('classificationConfidence:', classificationConfidence);
    console.log('MINIMUM_CONFIDENCE_FOR_SHIPMENT_CREATION:', MINIMUM_CONFIDENCE_FOR_SHIPMENT_CREATION);
    console.log('classificationConfidence < threshold:', classificationConfidence < MINIMUM_CONFIDENCE_FOR_SHIPMENT_CREATION);

    if (classificationConfidence < MINIMUM_CONFIDENCE_FOR_SHIPMENT_CREATION) {
      console.log('>>> WOULD SKIP: Confidence too low');
      return;
    }

    // Check carrier detection
    console.log('\n--- STEP 4: Carrier Detection ---');
    const carrierFromContent = detectCarrier(email?.true_sender_email || email?.sender_email || '', content);
    console.log('carrierFromContent:', carrierFromContent);

    const isDirectCarrier = isDirectCarrierEmail(email?.true_sender_email, email?.sender_email || '');
    console.log('isDirectCarrierEmail:', isDirectCarrier);

    const isKnownDisplayName = isKnownCarrierDisplayName(email?.sender_email || '');
    console.log('isKnownCarrierDisplayName:', isKnownDisplayName);

    const isContentBased = isCarrierContentBasedEmail(content, carrierFromContent, email?.subject);
    console.log('isCarrierContentBasedEmail:', isContentBased);

    const isCarrierEmail = isDirectCarrier || isKnownDisplayName || isContentBased;
    console.log('\nFINAL isCarrierEmail:', isCarrierEmail);

    if (!isCarrierEmail) {
      console.log('>>> WOULD SKIP: Not a carrier email');
      return;
    }

    // Check for existing shipment
    console.log('\n--- STEP 5: Existing Shipment Check ---');
    const { data: extractions } = await supabase
      .from('email_extractions')
      .select('entity_value')
      .eq('email_id', emailId)
      .eq('entity_type', 'booking_number');

    const bookingNumber = extractions?.[0]?.entity_value;
    console.log('booking_number:', bookingNumber);

    if (!bookingNumber) {
      console.log('>>> WOULD SKIP: No booking number extracted');
      return;
    }

    const { data: existingShipment } = await supabase
      .from('shipments')
      .select('id')
      .eq('booking_number', bookingNumber)
      .single();

    console.log('existing shipment:', existingShipment?.id || 'NONE');

    if (existingShipment) {
      console.log('>>> WOULD UPDATE: Existing shipment found');
    } else if (isCarrierEmail) {
      console.log('>>> SHOULD CREATE: New shipment');
    } else {
      console.log('>>> WOULD SKIP: Not direct carrier and no existing');
    }
  } else {
    console.log('>>> NOT booking_confirmation - different flow');
  }
}

debug().catch(console.error);
