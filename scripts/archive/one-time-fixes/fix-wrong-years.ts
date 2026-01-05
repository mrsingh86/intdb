import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function fixWrongYears() {
  console.log('=== CHECKING AND FIXING WRONG YEARS IN DATES ===\n');

  // Get shipments with dates that might have wrong year (2026 for December 2025)
  const { data: shipments } = await supabase
    .from('shipments')
    .select('id, booking_number, etd, eta')
    .or('etd.gte.2026-01-01,eta.gte.2026-01-01')
    .not('etd', 'is', null);

  if (!shipments || shipments.length === 0) {
    console.log('No shipments found with potentially wrong years');
    return;
  }

  console.log(`Found ${shipments.length} shipments with dates in 2026 or later:\n`);

  for (const shipment of shipments) {
    console.log(`Shipment ${shipment.booking_number}:`);
    console.log(`  Current ETD: ${shipment.etd}, ETA: ${shipment.eta}`);

    // Check if this is likely wrong (e.g., ETD in Dec 2026 is probably Dec 2025)
    const updates: any = {};

    if (shipment.etd) {
      const etdDate = new Date(shipment.etd);
      // If ETD is in December 2026, it's probably supposed to be December 2025
      if (etdDate.getFullYear() === 2026 && etdDate.getMonth() === 11) { // December
        const correctedDate = new Date(etdDate);
        correctedDate.setFullYear(2025);
        updates.etd = correctedDate.toISOString().split('T')[0];
        console.log(`  -> Fixing ETD from ${shipment.etd} to ${updates.etd}`);
      }
    }

    if (Object.keys(updates).length > 0) {
      await supabase
        .from('shipments')
        .update(updates)
        .eq('id', shipment.id);
      console.log('  ✓ Fixed');
    } else {
      console.log('  - Date seems correct (Jan 2026 is plausible)');
    }
  }

  console.log('\nDone!');
}

fixWrongYears().then(() => process.exit(0)).catch(console.error);
