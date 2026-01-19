import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// Simulate detectCarrier
function detectCarrier(senderEmail: string, content: string): string {
  const combined = `${senderEmail} ${content}`.toLowerCase();

  if (combined.includes('hapag') || combined.includes('hlag') || combined.includes('hlcu')) {
    return 'hapag-lloyd';
  }
  if (combined.includes('maersk') || combined.includes('maeu') || combined.includes('msku')) {
    return 'maersk';
  }
  if (combined.includes('cma-cgm') || combined.includes('cma cgm') || combined.includes('cmau')) {
    return 'cma-cgm';
  }
  if (combined.includes('msc') && !combined.includes('misc')) {
    return 'msc';
  }
  if (combined.includes('cosco') || combined.includes('cosu')) {
    return 'cosco';
  }
  return 'default';
}

// Simulate isCarrierContentBasedEmail
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

async function test() {
  const emailId = '1712c66b-4dd5-4129-8f48-c49918101671';

  const { data: email } = await supabase
    .from('raw_emails')
    .select('body_text, sender_email, true_sender_email, subject')
    .eq('id', emailId)
    .single();

  const { data: attachments } = await supabase
    .from('raw_attachments')
    .select('extracted_text')
    .eq('email_id', emailId);

  // Build content like orchestrator
  let content = email?.body_text || '';
  attachments?.forEach(a => {
    if (a.extracted_text) {
      content += '\n' + a.extracted_text;
    }
  });

  const senderForDetection = email?.true_sender_email || email?.sender_email || '';

  console.log('=== Carrier Detection Simulation ===');
  console.log('Sender for detection:', senderForDetection);
  console.log('Content length:', content.length);

  const carrier = detectCarrier(senderForDetection, content);
  console.log('\nDetected carrier:', carrier);

  const isContentBased = isCarrierContentBasedEmail(content, carrier, email?.subject);
  console.log('isCarrierContentBasedEmail:', isContentBased);

  // Full check like line 539-541
  const isDirectCarrier = false; // We know domain check fails
  const isKnownDisplay = false; // Let's assume this also fails

  const finalIsCarrierEmail = isDirectCarrier || isKnownDisplay || isContentBased;
  console.log('\nFinal isCarrierEmail:', finalIsCarrierEmail);
  console.log('  - isDirectCarrier:', isDirectCarrier);
  console.log('  - isKnownDisplayName:', isKnownDisplay);
  console.log('  - isContentBased:', isContentBased);
}

test().catch(console.error);
