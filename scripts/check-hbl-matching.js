require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  console.log('CHECKING SHIPMENTS WITH HBL NUMBERS');
  console.log('='.repeat(80));

  // Get shipments with HBL numbers
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, hbl_number, shipper_name')
    .not('hbl_number', 'is', null)
    .order('created_at', { ascending: false })
    .limit(15);

  console.log('Found:', shipments?.length || 0, 'shipments with HBL#\n');

  for (const s of shipments || []) {
    console.log('HBL:', s.hbl_number);
    console.log('  Booking:', s.booking_number || '-');
    console.log('  Shipper:', (s.shipper_name || '-').substring(0, 40));
    console.log();
  }

  // Check if any emails have these HBL numbers
  console.log('\nMATCHING EMAILS TO SHIPMENTS BY HBL\n');
  console.log('='.repeat(80));

  for (const s of (shipments || []).slice(0, 5)) {
    if (!s.hbl_number) continue;

    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, subject')
      .ilike('subject', '%' + s.hbl_number + '%')
      .limit(3);

    console.log('HBL:', s.hbl_number);
    if (emails && emails.length > 0) {
      console.log('  ✅ Matching emails:', emails.length);
      for (const e of emails) {
        console.log('    -', (e.subject || '').substring(0, 60));
      }
    } else {
      console.log('  ⚠️  No matching emails found');
    }
    console.log();
  }
}

check().catch(console.error);
