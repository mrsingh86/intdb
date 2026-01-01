import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const bookingNumber = '263375454';

  const { data: shipment } = await supabase
    .from('shipments')
    .select('created_from_email_id')
    .eq('booking_number', bookingNumber)
    .single();

  const { data: att } = await supabase
    .from('raw_attachments')
    .select('extracted_text')
    .eq('email_id', shipment?.created_from_email_id)
    .single();

  const content = att?.extracted_text || '';

  // Test different regex patterns
  console.log('=== Testing Regex Patterns ===\n');

  // Pattern 1: Current pattern
  const polMatch1 = content.match(/From:\s*([^,\n]+)/i);
  console.log('Pattern 1 (From:\\s*([^,\\n]+)):', polMatch1?.[1]);

  // Pattern 2: Look for specific format
  const polMatch2 = content.match(/\nFrom:\s*\n?([^,]+)/i);
  console.log('Pattern 2 (\\nFrom:\\s*\\n?([^,]+)):', polMatch2?.[1]);

  // Pattern 3: Multi-line aware
  const polMatch3 = content.match(/From:\s*([\w\s]+),/i);
  console.log('Pattern 3 (From:\\s*([\\w\\s]+),):', polMatch3?.[1]);

  // Pattern 4: Line-based
  const lines = content.split('\n');
  let fromLine = lines.find(l => l.trim().startsWith('From:'));
  console.log('Line-based From:', fromLine);

  let toLine = lines.find(l => l.trim().startsWith('To:'));
  console.log('Line-based To:', toLine);

  // Show context around "From:" and "To:"
  const fromIndex = content.indexOf('From:');
  const toIndex = content.indexOf('To:');

  console.log('\n=== Context around From: ===');
  console.log(content.substring(fromIndex - 50, fromIndex + 100));

  console.log('\n=== Context around To: ===');
  console.log(content.substring(toIndex - 50, toIndex + 100));

  // Pattern for Maersk specific format
  // "From:\nMundra,GUJARAT,India"
  const polMatch4 = content.match(/From:\s*\n?([A-Za-z\s]+)/);
  console.log('\nPattern 4:', polMatch4?.[1]);

  const podMatch4 = content.match(/To:\s*\n?([A-Za-z\s]+)/);
  console.log('Pattern 4 POD:', podMatch4?.[1]);
}
main().catch(console.error);
