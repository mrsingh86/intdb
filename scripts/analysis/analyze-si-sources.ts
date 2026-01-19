import { createClient } from '@supabase/supabase-js';
import { getAllRows } from '../lib/utils/supabase-pagination';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

interface Doc { email_id: string; document_type: string }
interface Email { id: string; sender_email: string; subject: string; email_direction: string }

async function analyzeSI() {
  const docs = await getAllRows<Doc>(supabase, 'document_classifications', 'email_id, document_type');
  const emails = await getAllRows<Email>(supabase, 'raw_emails', 'id, sender_email, subject, email_direction');

  const emailMap = new Map(emails.map(e => [e.id, e]));

  // Find SI-related documents
  const siDocs = docs.filter(d =>
    d.document_type === 'shipping_instruction' ||
    d.document_type === 'si_draft' ||
    d.document_type === 'si_submission'
  );

  console.log('='.repeat(80));
  console.log('SI DOCUMENTS ANALYSIS - BY SOURCE');
  console.log('='.repeat(80));
  console.log('Total SI-related documents:', siDocs.length);
  console.log('');

  // Categorize by sender type
  const fromShipper: any[] = [];
  const fromCarrier: any[] = [];
  const fromIntoglo: any[] = [];

  const carrierPatterns = [
    /maersk/i, /hlag/i, /hapag/i, /cosco/i, /cma.?cgm/i,
    /one-line/i, /evergreen/i, /msc/i, /yang.?ming/i, /zim/i,
    /noreply@hlag/i, /donotreply@maersk/i, /do_not_reply/i, /donotreply/i
  ];

  const intogloPatterns = [/@intoglo\.com/i, /@intoglo\.in/i];

  for (const doc of siDocs) {
    const email = emailMap.get(doc.email_id);
    if (!email) continue;

    const sender = email.sender_email || '';
    const isCarrier = carrierPatterns.some(p => p.test(sender));
    const isIntoglo = intogloPatterns.some(p => p.test(sender)) && !sender.includes(' via ');

    const item = {
      docType: doc.document_type,
      sender: sender.substring(0, 70),
      subject: (email.subject || '').substring(0, 80),
      direction: email.email_direction
    };

    if (isCarrier) {
      fromCarrier.push(item);
    } else if (isIntoglo) {
      fromIntoglo.push(item);
    } else {
      fromShipper.push(item);
    }
  }

  console.log('#'.repeat(80));
  console.log('FROM SHIPPER/CLIENT (' + fromShipper.length + ')');
  console.log('>>> These should trigger: SI_DRAFT_RECEIVED');
  console.log('#'.repeat(80));
  console.log('');
  fromShipper.forEach((item, i) => {
    console.log((i + 1) + '. ' + item.docType);
    console.log('   Sender:', item.sender);
    console.log('   Subject:', item.subject);
    console.log('   Direction:', item.direction);
    console.log('');
  });

  console.log('');
  console.log('#'.repeat(80));
  console.log('FROM SHIPPING LINE (' + fromCarrier.length + ')');
  console.log('>>> These should trigger: SI_CONFIRMED');
  console.log('#'.repeat(80));
  console.log('');
  fromCarrier.forEach((item, i) => {
    console.log((i + 1) + '. ' + item.docType);
    console.log('   Sender:', item.sender);
    console.log('   Subject:', item.subject);
    console.log('   Direction:', item.direction);
    console.log('');
  });

  console.log('');
  console.log('#'.repeat(80));
  console.log('FROM INTOGLO - OUTBOUND (' + fromIntoglo.length + ')');
  console.log('>>> These are SI submissions BY Intoglo to carrier');
  console.log('#'.repeat(80));
  console.log('');
  fromIntoglo.forEach((item, i) => {
    console.log((i + 1) + '. ' + item.docType);
    console.log('   Sender:', item.sender);
    console.log('   Subject:', item.subject);
    console.log('   Direction:', item.direction);
    console.log('');
  });

  // Summary
  console.log('');
  console.log('='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log('From Shipper/Client:', fromShipper.length, '→ should trigger si_draft_received');
  console.log('From Shipping Line:', fromCarrier.length, '→ should trigger si_confirmed');
  console.log('From Intoglo (outbound):', fromIntoglo.length, '→ si_submitted (by Intoglo)');
}

analyzeSI();
