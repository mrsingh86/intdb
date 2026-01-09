import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

async function check() {
  // Get a COSCO booking confirmation email (original, not reply)
  const { data: email } = await supabase
    .from('raw_emails')
    .select('id, subject, body_text, body_html')
    .ilike('subject', 'Cosco Shipping Line Booking Confirmation%')
    .not('subject', 'ilike', 'Re:%')
    .limit(1)
    .single();

  if (!email) {
    console.log('No COSCO original found');
    return;
  }

  console.log('Email ID:', email.id);
  console.log('Subject:', email.subject);
  console.log('body_text length:', email.body_text?.length || 0);
  console.log('body_html length:', email.body_html?.length || 0);

  // Check attachment
  const { data: att } = await supabase
    .from('raw_attachments')
    .select('id, filename, extracted_text, mime_type')
    .eq('email_id', email.id);

  console.log('\nAttachments:');
  att?.forEach(a => {
    console.log('  -', a.filename, '| text length:', a.extracted_text?.length || 0);
    if (a.extracted_text) {
      console.log('    Sample:', a.extracted_text.substring(0, 300));
    }
  });

  // Check if PDF text contains COSCO branding
  const pdfAtt = att?.find(a => a.filename.endsWith('.pdf'));
  const pdfText = pdfAtt?.extracted_text || '';
  console.log('\nPDF Analysis:');
  console.log('  COSCO in PDF:', pdfText.toLowerCase().includes('cosco'));
  console.log('  BOOKING CONFIRMATION in PDF:', /booking.*confirmation/i.test(pdfText));
  console.log('  COSU in PDF:', pdfText.includes('COSU'));
}

check().catch(console.error);
