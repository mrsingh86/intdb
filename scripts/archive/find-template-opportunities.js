require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function findOpportunities() {
  // Get fallback documents that NEED ACTION (not confirmations)
  const { data: actionNeeded } = await supabase
    .from('chronicle')
    .select('document_type, from_party, subject')
    .eq('action_source', 'fallback')
    .eq('has_action', true)  // These need action but using generic 'review'
    .limit(5000);

  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
  console.log('║     TEMPLATE OPPORTUNITIES: Fallback docs that NEED ACTION               ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('  These are using generic "Review" action but could have PRECISE templates:');
  console.log('');

  // Count by combo
  const comboCounts = {};
  const samples = {};
  actionNeeded.forEach(r => {
    const key = r.document_type + ' | ' + r.from_party;
    comboCounts[key] = (comboCounts[key] || 0) + 1;
    if (samples[key] === undefined) samples[key] = r.subject;
  });

  const sorted = Object.entries(comboCounts).sort((a, b) => b[1] - a[1]);
  const total = actionNeeded.length;

  console.log('  Total needing action but on fallback:', total);
  console.log('');
  console.log('  ┌──────────────────────────────────────────────────────────────────────────┐');
  console.log('  │ RECOMMENDED NEW TEMPLATES (sorted by volume)                            │');
  console.log('  └──────────────────────────────────────────────────────────────────────────┘');

  sorted.slice(0, 25).forEach(([combo, count], i) => {
    const pct = (count / total * 100).toFixed(1);
    const [docType, fromParty] = combo.split(' | ');
    console.log('');
    console.log('  ' + (i+1).toString().padStart(2) + '. ' + combo);
    console.log('      Count:', count, '(' + pct + '% of fallback actions)');
    console.log('      Sample:', (samples[combo] || '').substring(0, 65));

    // Suggest template based on document type
    let suggestion = getSuggestion(docType, fromParty);
    if (suggestion) {
      console.log('      ✓ SUGGESTED TEMPLATE:', suggestion);
    }
  });

  console.log('');
  console.log('');

  // Summary of high-value templates
  console.log('  ╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('  ║ HIGH-VALUE TEMPLATE RECOMMENDATIONS                                   ║');
  console.log('  ╚═══════════════════════════════════════════════════════════════════════╝');
  console.log('');

  const highValue = sorted.filter(([combo, count]) => count >= 20);
  console.log('  Templates with 20+ occurrences (highest ROI):');
  console.log('');

  highValue.forEach(([combo, count]) => {
    const [docType, fromParty] = combo.split(' | ');
    const suggestion = getSuggestion(docType, fromParty);
    console.log('  INSERT INTO action_templates (document_type, from_party, direction, action_type, action_verb, action_template, default_owner, deadline_type, deadline_days, base_priority, enabled)');
    console.log('  VALUES (\'' + docType + '\', \'' + fromParty + '\', \'inbound\', ' + (suggestion || '...') + ');');
    console.log('  -- Would affect ' + count + ' chronicles');
    console.log('');
  });
}

function getSuggestion(docType, fromParty) {
  const suggestions = {
    'general_correspondence': "'respond', 'Reply', 'Review and respond to {from_party}', 'operations', 'fixed_days', 2, 50",
    'quote_request': "'respond', 'Send Quote', 'Prepare and send quote to {from_party}', 'sales', 'fixed_days', 1, 70",
    'booking_request': "'process', 'Create Booking', 'Process booking request from {from_party}', 'operations', 'fixed_days', 1, 75",
    'amendment_request': "'process', 'Process Amendment', 'Process amendment request from {from_party}', 'operations', 'fixed_days', 1, 70",
    'escalation': "'investigate', 'Investigate', 'Investigate escalation from {from_party}', 'operations', 'urgent', NULL, 85",
    'hold_notice': "'investigate', 'Resolve Hold', 'Investigate and resolve hold from {from_party}', 'operations', 'urgent', NULL, 90",
    'demurrage_notice': "'pay', 'Resolve D&D', 'Review demurrage charges and arrange resolution', 'finance', 'fixed_days', 3, 80",
    'detention_notice': "'pay', 'Resolve Detention', 'Review detention charges and arrange resolution', 'finance', 'fixed_days', 3, 80",
    'cargo_ready_notice': "'process', 'Arrange Pickup', 'Arrange cargo pickup from {from_party}', 'operations', 'fixed_days', 1, 75",
    'delivery_order': "'share', 'Release DO', 'Process and release delivery order to customer', 'operations', 'fixed_days', 1, 70",
    'freight_release': "'share', 'Share Release', 'Share freight release with customer', 'operations', 'fixed_days', 1, 65",
    'customs_hold': "'investigate', 'Resolve Customs', 'Investigate customs hold from {from_party}', 'customs', 'urgent', NULL, 90",
    'inspection_notice': "'respond', 'Handle Inspection', 'Coordinate inspection with {from_party}', 'operations', 'fixed_days', 1, 80",
    'rate_request': "'respond', 'Provide Rate', 'Prepare rate quotation for {from_party}', 'sales', 'fixed_days', 1, 65",
    'document_request': "'respond', 'Provide Docs', 'Prepare and send requested documents to {from_party}', 'operations', 'fixed_days', 2, 60",
  };

  // Check for partial matches
  for (const [key, value] of Object.entries(suggestions)) {
    if (docType.includes(key) || key.includes(docType)) {
      return value;
    }
  }

  // Generic suggestion based on type pattern
  if (docType.includes('request')) {
    return "'respond', 'Respond', 'Respond to request from {from_party}', 'operations', 'fixed_days', 2, 60";
  }
  if (docType.includes('notice')) {
    return "'review', 'Review Notice', 'Review notice from {from_party}', 'operations', 'fixed_days', 2, 60";
  }
  if (docType.includes('amendment')) {
    return "'review', 'Review Amendment', 'Review amendment from {from_party}', 'operations', 'fixed_days', 1, 65";
  }

  return null;
}

findOpportunities().catch(console.error);
