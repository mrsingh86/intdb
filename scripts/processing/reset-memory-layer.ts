/**
 * Reset Memory Layer to Clean State
 *
 * Deletes ALL memories and re-initializes with only error patterns.
 * Use this to reset to a clean state after testing.
 */
import * as dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { createMemoryService, MemoryScope } from '../../lib/memory';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Only error patterns - everything else is learned organically
const ERROR_PATTERNS = [
  {
    errorType: 'date-format-ambiguous',
    content: `Date format ambiguity:
Problem: "02/03/2025" could be Feb 3 (US) or Mar 2 (EU/Asia)
Solution: Check sender region/carrier conventions
- US carriers (Maersk US): MM/DD/YYYY
- EU/Asia carriers: DD/MM/YYYY
- Maersk typically uses DD-MMM-YYYY (unambiguous)
Best practice: Look for other dates in email to establish pattern`,
  },
  {
    errorType: 'date-missing-year',
    content: `Missing year in dates:
Problem: "15-Jan" or "January 15" without year
Solution: Use email date as anchor
- If date > 30 days before email date → assume next year
- If date is in past and makes sense → use email year
- Always validate: result within 2 years of email date`,
  },
  {
    errorType: 'booking-vs-container',
    content: `Booking number vs container number confusion:
CONTAINER: EXACTLY 4 letters + 7 digits (MRKU1234567, BMOU5630848)
BOOKING: Various formats - often pure numeric (2038256270)
Rule: 4 letters + 7 digits = ALWAYS container, goes in container_numbers array
Common mistake: Putting container number in booking_number field`,
  },
  {
    errorType: 'booking-vs-mbl',
    content: `Booking number vs MBL confusion:
MBL: Carrier prefix + long digits (MAEU261683714, HLCUCM2251119160)
BOOKING: Often pure numeric (2038256270, 262187584)
Rule: If from carrier booking confirmation, numeric value = booking_number
MBL appears on Bill of Lading documents, not booking confirmations`,
  },
  {
    errorType: 'work-order-as-booking',
    content: `Work order misidentified as booking:
Problem: SEINUS17112502710_I looks like booking number
SEINUS prefix = Intoglo internal work order (trucking)
NEVER use as booking_number field
Store in work_order_number or internal_reference`,
  },
  {
    errorType: 'thread-subject-mismatch',
    content: `Thread subject doesn't match email content:
Problem: Subject says "Re: Draft BL" but body is just "Approved"
Solution: For thread replies (position > 1), classify by CONTENT not subject
Short replies (<100 chars) with "OK/Approved/Confirmed" = approval type
Always look at latest message, not original thread subject`,
  },
  {
    errorType: 'pdf-required-missing',
    content: `Major document type without PDF attachment:
Problem: Subject says "Booking Confirmation" but no PDF attached
Without PDF attachment, CANNOT classify as major document type:
- booking_confirmation, draft_bl, final_bl, invoice, arrival_notice
Instead classify as: notification, approval, or acknowledgement
Text-only exceptions: telex_release, tracking_update, schedule_update`,
  },
  {
    errorType: 'location-field-confusion',
    content: `Location field confusion (POR vs POL vs POD vs POFD):
POR (Place of Receipt): Shipper warehouse/factory - ADDRESS
POL (Port of Loading): Seaport code like INNSA, USHOU - PORT CODE
POD (Port of Discharge): Destination seaport code - PORT CODE
POFD (Place of Final Delivery): Consignee address - ADDRESS
Rule: Port codes (INNSA, USNYC) → POL/POD, City addresses → POR/POFD`,
  },
  {
    errorType: 'transshipment-dates',
    content: `Extracting wrong dates from transshipment info:
Problem: Email shows T/S Colombo dates, AI extracts those instead of final
Rule: ONLY extract origin POL ETD and final POD ETA
IGNORE: Transshipment ETDs/ETAs, intermediate port dates
Look for: "POL ETD", "Final ETA", "Destination ETA"`,
  },
  {
    errorType: 'internal-notification-misclass',
    content: `Internal notification misclassified as carrier document:
Problem: Email from @intoglo.com with "Go Green" or "Deal id"
These are internal deal approvals, NOT carrier booking confirmations
Classify as: internal_notification
Check sender domain before assuming carrier document`,
  },
];

async function resetMemoryLayer() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║  RESETTING MEMORY LAYER TO CLEAN STATE                         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Step 1: Delete ALL memories
  console.log('Step 1: Deleting ALL existing memories...');
  const { data: deleted, error: deleteError } = await supabase
    .from('ai_memories')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000') // Match all rows
    .select('id');

  if (deleteError) {
    console.error('Delete error:', deleteError.message);
  } else {
    console.log(`  ✓ Deleted ${deleted?.length || 0} memories`);
  }

  // Step 2: Initialize error patterns
  console.log('\nStep 2: Initializing error patterns...');
  const memoryService = createMemoryService(supabase);

  let added = 0;
  for (const p of ERROR_PATTERNS) {
    try {
      await memoryService.add({
        scope: MemoryScope.ERROR,
        scopeId: `error-pattern-${p.errorType}`,
        content: p.content,
        tags: [p.errorType, 'error-prevention', 'initialization'],
        source: 'initialization',
      });
      console.log(`  ✓ ${p.errorType}`);
      added++;
    } catch (error) {
      console.log(`  ✗ ${p.errorType}: ${(error as Error).message}`);
    }
  }

  // Step 3: Verify final state
  console.log('\nStep 3: Verifying final state...');
  const { data: final, count } = await supabase
    .from('ai_memories')
    .select('scope, scope_id', { count: 'exact' });

  const byScope: Record<string, number> = {};
  for (const m of final || []) {
    byScope[m.scope] = (byScope[m.scope] || 0) + 1;
  }

  console.log('\n' + '═'.repeat(60));
  console.log('FINAL STATE:');
  console.log('═'.repeat(60));
  console.log(`  Total memories: ${count}`);
  for (const [scope, num] of Object.entries(byScope)) {
    console.log(`  - ${scope}: ${num}`);
  }
  console.log('\n  Memory layer is now ready to LEARN from processing:');
  console.log('  • Sender profiles - accumulated per domain');
  console.log('  • Shipment context - built per booking number');
  console.log('  • Thread context - cached per Gmail thread');
  console.log('  • New error patterns - learned from failures');
  console.log('═'.repeat(60));
}

resetMemoryLayer().catch(console.error);
