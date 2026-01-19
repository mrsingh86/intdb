import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://fdmcdbvkfdmrdowfjrcz.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZkbWNkYnZrZmRtcmRvd2ZqcmN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzQ5Mjk5NTEsImV4cCI6MjA1MDUwNTk1MX0.sb_publishable_v9RFIqbeitIgL4y6MXPLNg_CyC2YwRm';

const supabase = createClient(supabaseUrl, supabaseKey);

async function auditDatabase() {
  console.log('=== ORION DATA PIPELINE AUDIT ===\n');

  // 1. Raw Emails
  console.log('📧 RAW EMAILS');
  const { data: emails, count: emailCount } = await supabase
    .from('raw_emails')
    .select('*', { count: 'exact', head: false });
  console.log(`Total raw_emails: ${emailCount}`);
  const sampleIds = emails?.slice(0, 3).map(e => e.id).join(', ') || 'none';
  console.log(`Sample email IDs: ${sampleIds}\n`);

  // 2. Document Classifications
  console.log('📋 DOCUMENT CLASSIFICATIONS');
  const { count: classificationCount } = await supabase
    .from('document_classifications')
    .select('*', { count: 'exact', head: true });
  console.log(`Total classifications: ${classificationCount}`);

  const { data: classificationTypes } = await supabase
    .from('document_classifications')
    .select('document_type, confidence_score');

  const typeBreakdown: Record<string, number> = {};
  const confidenceStats: number[] = [];
  classificationTypes?.forEach(c => {
    typeBreakdown[c.document_type] = (typeBreakdown[c.document_type] || 0) + 1;
    confidenceStats.push(c.confidence_score);
  });

  console.log('Classification breakdown:');
  Object.entries(typeBreakdown).forEach(([type, count]) => {
    console.log(`  - ${type}: ${count}`);
  });

  if (confidenceStats.length > 0) {
    const avgConfidence = confidenceStats.reduce((a, b) => a + b, 0) / confidenceStats.length;
    const lowConfidence = confidenceStats.filter(s => s < 70).length;
    console.log(`Average confidence: ${avgConfidence.toFixed(2)}%`);
    console.log(`Low confidence (<70%): ${lowConfidence} (${(lowConfidence/confidenceStats.length*100).toFixed(1)}%)\n`);
  }

  // 3. Entity Extractions
  console.log('🔍 ENTITY EXTRACTIONS');
  const { count: extractionCount } = await supabase
    .from('entity_extractions')
    .select('*', { count: 'exact', head: true });
  console.log(`Total extractions: ${extractionCount}`);

  const { data: extractionTypes } = await supabase
    .from('entity_extractions')
    .select('entity_type');

  const entityBreakdown: Record<string, number> = {};
  extractionTypes?.forEach(e => {
    entityBreakdown[e.entity_type] = (entityBreakdown[e.entity_type] || 0) + 1;
  });

  console.log('Entity type breakdown:');
  Object.entries(entityBreakdown).forEach(([type, count]) => {
    console.log(`  - ${type}: ${count}`);
  });
  console.log();

  // 4. Shipments
  console.log('🚢 SHIPMENTS');
  const { data: shipments, count: shipmentCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: false });
  console.log(`Total shipments: ${shipmentCount}`);

  if (shipments && shipments.length > 0) {
    const withBooking = shipments.filter(s => s.booking_number).length;
    const withBL = shipments.filter(s => s.bl_number).length;
    const withVessel = shipments.filter(s => s.vessel_name).length;
    const withPOL = shipments.filter(s => s.port_of_loading).length;
    const withPOD = shipments.filter(s => s.port_of_discharge).length;
    const withETD = shipments.filter(s => s.etd).length;
    const withETA = shipments.filter(s => s.eta).length;

    console.log(`Field population:`);
    console.log(`  - booking_number: ${withBooking} (${(withBooking/shipments.length*100).toFixed(1)}%)`);
    console.log(`  - bl_number: ${withBL} (${(withBL/shipments.length*100).toFixed(1)}%)`);
    console.log(`  - vessel_name: ${withVessel} (${(withVessel/shipments.length*100).toFixed(1)}%)`);
    console.log(`  - port_of_loading: ${withPOL} (${(withPOL/shipments.length*100).toFixed(1)}%)`);
    console.log(`  - port_of_discharge: ${withPOD} (${(withPOD/shipments.length*100).toFixed(1)}%)`);
    console.log(`  - etd: ${withETD} (${(withETD/shipments.length*100).toFixed(1)}%)`);
    console.log(`  - eta: ${withETA} (${(withETA/shipments.length*100).toFixed(1)}%)`);

    const workflowBreakdown: Record<string, number> = {};
    shipments.forEach(s => {
      const state = s.workflow_state || 'null';
      workflowBreakdown[state] = (workflowBreakdown[state] || 0) + 1;
    });
    console.log('\nWorkflow state breakdown:');
    Object.entries(workflowBreakdown).forEach(([state, count]) => {
      console.log(`  - ${state}: ${count}`);
    });
  }
  console.log();

  // 5. Document Lifecycle
  console.log('📄 DOCUMENT LIFECYCLE');
  const { count: lifecycleCount } = await supabase
    .from('document_lifecycle')
    .select('*', { count: 'exact', head: true });
  console.log(`Total lifecycle entries: ${lifecycleCount}`);

  const { data: lifecycleData } = await supabase
    .from('document_lifecycle')
    .select('document_type, lifecycle_status');

  const lifecycleBreakdown: Record<string, number> = {};
  lifecycleData?.forEach(l => {
    const key = `${l.document_type} (${l.lifecycle_status})`;
    lifecycleBreakdown[key] = (lifecycleBreakdown[key] || 0) + 1;
  });

  console.log('Document lifecycle breakdown:');
  Object.entries(lifecycleBreakdown).forEach(([key, count]) => {
    console.log(`  - ${key}: ${count}`);
  });
  console.log();

  // 6. Parties (Stakeholders)
  console.log('👥 PARTIES (STAKEHOLDERS)');
  const { count: partyCount } = await supabase
    .from('parties')
    .select('*', { count: 'exact', head: true });
  console.log(`Total parties: ${partyCount}`);

  const { data: partyTypes } = await supabase
    .from('parties')
    .select('party_type, is_customer');

  const partyBreakdown: Record<string, number> = {};
  let customerCount = 0;
  partyTypes?.forEach(p => {
    partyBreakdown[p.party_type || 'unknown'] = (partyBreakdown[p.party_type || 'unknown'] || 0) + 1;
    if (p.is_customer) customerCount++;
  });

  console.log('Party type breakdown:');
  Object.entries(partyBreakdown).forEach(([type, count]) => {
    console.log(`  - ${type}: ${count}`);
  });
  console.log(`Customers: ${customerCount}\n`);

  // 7. Action Tasks
  console.log('✅ ACTION TASKS');
  const { count: taskCount } = await supabase
    .from('action_tasks')
    .select('*', { count: 'exact', head: true });
  console.log(`Total tasks: ${taskCount}`);

  const { data: taskData } = await supabase
    .from('action_tasks')
    .select('category, priority, status');

  const categoryBreakdown: Record<string, number> = {};
  const priorityBreakdown: Record<string, number> = {};
  const statusBreakdown: Record<string, number> = {};

  taskData?.forEach(t => {
    categoryBreakdown[t.category || 'unknown'] = (categoryBreakdown[t.category || 'unknown'] || 0) + 1;
    priorityBreakdown[t.priority || 'unknown'] = (priorityBreakdown[t.priority || 'unknown'] || 0) + 1;
    statusBreakdown[t.status || 'unknown'] = (statusBreakdown[t.status || 'unknown'] || 0) + 1;
  });

  console.log('Category breakdown:');
  Object.entries(categoryBreakdown).forEach(([cat, count]) => {
    console.log(`  - ${cat}: ${count}`);
  });
  console.log('Status breakdown:');
  Object.entries(statusBreakdown).forEach(([stat, count]) => {
    console.log(`  - ${stat}: ${count}`);
  });
  console.log();

  // 8. Notifications
  console.log('🔔 NOTIFICATIONS');
  const { count: notificationCount } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true });
  console.log(`Total notifications: ${notificationCount}`);

  const { data: notificationData } = await supabase
    .from('notifications')
    .select('notification_type, priority, status');

  const notifTypeBreakdown: Record<string, number> = {};
  const notifStatusBreakdown: Record<string, number> = {};

  notificationData?.forEach(n => {
    notifTypeBreakdown[n.notification_type || 'unknown'] = (notifTypeBreakdown[n.notification_type || 'unknown'] || 0) + 1;
    notifStatusBreakdown[n.status || 'unknown'] = (notifStatusBreakdown[n.status || 'unknown'] || 0) + 1;
  });

  console.log('Notification type breakdown:');
  Object.entries(notifTypeBreakdown).forEach(([type, count]) => {
    console.log(`  - ${type}: ${count}`);
  });
  console.log('Notification status breakdown:');
  Object.entries(notifStatusBreakdown).forEach(([stat, count]) => {
    console.log(`  - ${stat}: ${count}`);
  });
  console.log();

  // 9. Data Quality Issues
  console.log('⚠️  DATA QUALITY ISSUES');

  // Check emails without classifications
  const { data: allEmails } = await supabase
    .from('raw_emails')
    .select('id');
  const { data: classifiedEmails } = await supabase
    .from('document_classifications')
    .select('email_id');
  const classifiedIds = new Set(classifiedEmails?.map(c => c.email_id) || []);
  const unclassifiedCount = allEmails?.filter(e => !classifiedIds.has(e.id)).length || 0;
  console.log(`Emails without classifications: ${unclassifiedCount}`);

  // Check emails without extractions
  const { data: extractedEmails } = await supabase
    .from('entity_extractions')
    .select('email_id');
  const extractedIds = new Set(extractedEmails?.map(e => e.email_id) || []);
  const unextractedCount = allEmails?.filter(e => !extractedIds.has(e.id)).length || 0;
  console.log(`Emails without extractions: ${unextractedCount}`);

  // Booking numbers in extractions but not in shipments
  const { data: bookingExtractions } = await supabase
    .from('entity_extractions')
    .select('entity_value')
    .eq('entity_type', 'booking_number');

  const bookingNumbers = new Set(bookingExtractions?.map(e => e.entity_value) || []);
  const { data: shipmentsData } = await supabase
    .from('shipments')
    .select('booking_number');
  const shipmentBookings = new Set(shipmentsData?.map(s => s.booking_number).filter(Boolean) || []);

  const missingShipments = Array.from(bookingNumbers).filter(b => !shipmentBookings.has(b));
  console.log(`Booking numbers without shipments: ${missingShipments.length}`);
  if (missingShipments.length > 0 && missingShipments.length <= 10) {
    console.log(`  Missing: ${missingShipments.join(', ')}`);
  }

  // Shipments without document lifecycle
  const { data: shipmentsWithDocs } = await supabase
    .from('document_lifecycle')
    .select('shipment_id');
  const shipmentIdsWithDocs = new Set(shipmentsWithDocs?.map(d => d.shipment_id).filter(Boolean) || []);
  const shipmentsWithoutDocsCount = shipments?.filter(s => !shipmentIdsWithDocs.has(s.id)).length || 0;
  console.log(`Shipments without document lifecycle: ${shipmentsWithoutDocsCount}`);

  console.log('\n=== AUDIT COMPLETE ===');
}

auditDatabase().catch(console.error);
