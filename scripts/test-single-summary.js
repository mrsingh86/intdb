#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const bookingNumber = process.argv[2] || '29970951';

  const { HaikuSummaryService } = require('../lib/chronicle-v2/services/haiku-summary-service.ts');
  const service = new HaikuSummaryService(supabase);

  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, booking_number, stage')
    .eq('booking_number', bookingNumber)
    .single();

  if (!shipment) {
    console.log('Shipment not found:', bookingNumber);
    return;
  }

  console.log('='.repeat(60));
  console.log('Regenerating summary for:', shipment.booking_number);
  console.log('Stage:', shipment.stage);
  console.log('='.repeat(60));
  console.log('');

  const result = await service.processShipment(shipment.id);

  if (result) {
    console.log('NARRATIVE:');
    console.log(result.summary.narrative);
    console.log('');
    console.log('STORY:');
    console.log(result.summary.story);
    console.log('');
    console.log('BLOCKER:', result.summary.currentBlocker || '(none)');
    console.log('BLOCKER OWNER:', result.summary.blockerOwner || '(none)');
    console.log('');
    console.log('PREDICTED RISKS:', JSON.stringify(result.summary.predictedRisks, null, 2));
    console.log('');
    console.log('RECOMMENDATIONS:', JSON.stringify(result.summary.proactiveRecommendations, null, 2));
    console.log('');
    console.log('RISK LEVEL:', result.summary.riskLevel);
    console.log('RISK REASON:', result.summary.riskReason);
  }
}

main().catch(console.error);
