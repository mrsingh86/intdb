import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// Copy of detectCarrier from orchestrator
function detectCarrier(senderEmail: string, content: string): string {
  const combined = `${senderEmail} ${content}`.toLowerCase();
  if (combined.includes('hapag') || combined.includes('hlag') || combined.includes('hlcu')) return 'hapag-lloyd';
  if (combined.includes('maersk') || combined.includes('maeu') || combined.includes('msku')) return 'maersk';
  if (combined.includes('cma-cgm') || combined.includes('cma cgm') || combined.includes('cmau')) return 'cma-cgm';
  if (combined.includes('msc') && !combined.includes('misc')) return 'msc';
  if (combined.includes('cosco') || combined.includes('cosu')) return 'cosco';
  return 'default';
}

// Copy of isCarrierContentBasedEmail from orchestrator
function isCarrierContentBasedEmail(content: string, detectedCarrier: string, subject?: string): boolean {
  if (detectedCarrier !== 'default') {
    const hasBookingConfirmation = /BOOKING CONFIRMATION/i.test(content);
    const hasCarrierBranding = /CMA CGM|MAERSK|HAPAG|MSC|COSCO|EVERGREEN|ONE|YANG MING/i.test(content);
    console.log('  hasBookingConfirmation:', hasBookingConfirmation);
    console.log('  hasCarrierBranding:', hasCarrierBranding);
    if (hasBookingConfirmation && hasCarrierBranding) {
      return true;
    }
  }

  // Subject-based detection
  if (subject) {
    if (/^Booking Confirmation\s*:\s*26\d{7}$/i.test(subject.trim())) return true;
    if (/HLCU\d{7}|HL-?\d{8}/i.test(subject)) return true;
    if (/CMA CGM.*Booking confirmation/i.test(subject)) return true;
  }

  return false;
}

async function test() {
  const emailId = 'b452d434-da84-44c2-b486-fd4e4838c409';

  // Get email
  const { data: email } = await supabase
    .from('raw_emails')
    .select('subject, sender_email, true_sender_email, body_text')
    .eq('id', emailId)
    .single();

  // Get PDF content
  const { data: att } = await supabase
    .from('raw_attachments')
    .select('extracted_text')
    .eq('email_id', emailId)
    .not('extracted_text', 'is', null)
    .limit(1)
    .single();

  const content = (email?.body_text || '') + '\n' + (att?.extracted_text || '');

  console.log('=== CARRIER DETECTION TEST ===\n');
  console.log('Subject:', email?.subject?.substring(0, 70));
  console.log('sender_email:', email?.sender_email);
  console.log('true_sender_email:', email?.true_sender_email);
  console.log('content length:', content.length);

  const senderForDetection = email?.true_sender_email || email?.sender_email || '';
  console.log('\n1. detectCarrier input:', senderForDetection.substring(0, 50));

  const carrierFromContent = detectCarrier(senderForDetection, content);
  console.log('   detectCarrier result:', carrierFromContent);

  console.log('\n2. isCarrierContentBasedEmail check:');
  console.log('   detectedCarrier:', carrierFromContent);
  console.log('   detectedCarrier !== "default":', carrierFromContent !== 'default');

  const isCarrierEmail = isCarrierContentBasedEmail(content, carrierFromContent, email?.subject);
  console.log('   isCarrierContentBasedEmail result:', isCarrierEmail);

  // Additional debug: check actual content
  console.log('\n3. Content patterns:');
  console.log('   "BOOKING CONFIRMATION" in content:', content.toUpperCase().includes('BOOKING CONFIRMATION'));
  console.log('   "COSCO" in content:', content.toUpperCase().includes('COSCO'));
}

test().catch(console.error);
