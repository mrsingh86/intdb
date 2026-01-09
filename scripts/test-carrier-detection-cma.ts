import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// Carrier domains from orchestrator
const FALLBACK_CARRIER_DOMAINS = [
  'service.hlag.com', 'hapag-lloyd.com',
  'maersk.com',
  'msc.com',
  'cma-cgm.com',
  'evergreen-line.com', 'evergreen-marine.com',
  'oocl.com',
  'cosco.com', 'coscoshipping.com',
  'yangming.com',
  'one-line.com',
  'zim.com',
  'hmm21.com',
  'pilship.com',
  'wanhai.com',
  'sitc.com',
];

function isDirectCarrierEmail(trueSenderEmail: string | null, senderEmail: string): boolean {
  const emailToCheck = trueSenderEmail || senderEmail || '';
  const emailLower = emailToCheck.toLowerCase();
  return FALLBACK_CARRIER_DOMAINS.some(domain => emailLower.includes(domain));
}

function isKnownCarrierDisplayName(senderEmail: string): boolean {
  const senderLower = senderEmail.toLowerCase();

  // Known Maersk display name patterns
  const maerskPatterns = [
    'in.export',
    'maersk line export',
    'donotreply.*maersk',
    'customer service.*maersk',
  ];
  for (const pattern of maerskPatterns) {
    if (new RegExp(pattern, 'i').test(senderLower)) {
      return true;
    }
  }

  // Known Hapag-Lloyd patterns
  if (/india@service\.hlag|hapag|hlcu/i.test(senderLower)) {
    return true;
  }

  // Known CMA CGM patterns (display name only, no domain)
  if (/cma cgm website|cma cgm.*noreply|cma.cgm/i.test(senderLower)) {
    return true;
  }

  // Known COSCO patterns
  if (/coscon|cosco/i.test(senderLower)) {
    return true;
  }

  return false;
}

function isCarrierContentBasedEmail(content: string, detectedCarrier: string, subject?: string): boolean {
  // If we detected a carrier from content, and the content has booking confirmation markers
  if (detectedCarrier !== 'default') {
    const hasBookingConfirmation = /BOOKING CONFIRMATION/i.test(content);
    const hasCarrierBranding = /CMA CGM|MAERSK|HAPAG|MSC|COSCO|EVERGREEN|ONE|YANG MING/i.test(content);
    if (hasBookingConfirmation && hasCarrierBranding) {
      return true;
    }
  }

  // Subject-based detection for known carrier patterns
  if (subject) {
    // CMA CGM: "CMA CGM - Booking confirmation available"
    if (/CMA CGM.*Booking confirmation/i.test(subject)) {
      return true;
    }
  }

  return false;
}

function detectCarrier(senderEmail: string, content: string): string {
  const senderLower = senderEmail.toLowerCase();
  const contentLower = content.toLowerCase();

  if (senderLower.includes('cma-cgm.com') || contentLower.includes('cma cgm')) return 'cma-cgm';
  if (senderLower.includes('maersk.com') || contentLower.includes('maersk')) return 'maersk';
  // etc...
  return 'default';
}

async function test() {
  const { data: email } = await supabase
    .from('raw_emails')
    .select('sender_email, sender_name, true_sender_email, subject, body_text')
    .eq('id', 'cf4f8650-89d2-4a8a-90cb-6c11d27de757')
    .single();

  if (!email) {
    console.log('Email not found');
    return;
  }

  // Get PDF content
  const { data: att } = await supabase
    .from('raw_attachments')
    .select('extracted_text')
    .eq('email_id', 'cf4f8650-89d2-4a8a-90cb-6c11d27de757')
    .ilike('filename', '%.pdf')
    .single();

  const content = att?.extracted_text || '';

  console.log('Email:', email.sender_email);
  console.log('True sender:', email.true_sender_email);
  console.log('Subject:', email.subject);
  console.log('Content length:', content.length);
  console.log('');

  const carrierFromContent = detectCarrier(email.true_sender_email || email.sender_email, content);

  console.log('=== CARRIER DETECTION ===');
  console.log('isDirectCarrierEmail:', isDirectCarrierEmail(email.true_sender_email, email.sender_email));
  console.log('isKnownCarrierDisplayName:', isKnownCarrierDisplayName(email.sender_email));
  console.log('isCarrierContentBasedEmail:', isCarrierContentBasedEmail(content, carrierFromContent, email.subject));
  console.log('');

  const isCarrierEmail = isDirectCarrierEmail(email.true_sender_email, email.sender_email) ||
                         isKnownCarrierDisplayName(email.sender_email) ||
                         isCarrierContentBasedEmail(content, carrierFromContent, email.subject);

  console.log('FINAL isCarrierEmail:', isCarrierEmail);
}

test().catch(console.error);
