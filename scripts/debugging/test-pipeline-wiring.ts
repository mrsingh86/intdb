/**
 * Pipeline Wiring Test Script
 *
 * Tests the full flow: Classification → Entity Extraction → Shipment → Journey → Action Center
 * Uses real data from the database to trace an email through all stages.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

interface WiringTestResult {
  stage: string;
  status: 'pass' | 'fail' | 'partial';
  details: Record<string, any>;
  issues: string[];
}

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                      PIPELINE WIRING TEST');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  const results: WiringTestResult[] = [];

  // Test 1: Classification → Entity Extraction
  console.log('TEST 1: Classification → Entity Extraction');
  console.log('─'.repeat(70));
  results.push(await testClassificationToEntity());

  // Test 2: Entity Extraction → Shipment
  console.log('\nTEST 2: Entity Extraction → Shipment');
  console.log('─'.repeat(70));
  results.push(await testEntityToShipment());

  // Test 3: Shipment → Journey Events
  console.log('\nTEST 3: Shipment → Journey Events');
  console.log('─'.repeat(70));
  results.push(await testShipmentToJourney());

  // Test 4: Journey → Action Center (Blockers → Tasks)
  console.log('\nTEST 4: Journey → Action Center');
  console.log('─'.repeat(70));
  results.push(await testJourneyToActionCenter());

  // Test 5: End-to-End Trace (Pick one email and trace through all)
  console.log('\nTEST 5: End-to-End Trace');
  console.log('─'.repeat(70));
  results.push(await testEndToEndTrace());

  // Summary
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                           TEST SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  for (const result of results) {
    const icon = result.status === 'pass' ? '✅' : result.status === 'partial' ? '⚠️' : '❌';
    console.log(`${icon} ${result.stage}: ${result.status.toUpperCase()}`);
    if (result.issues.length > 0) {
      result.issues.forEach(issue => console.log(`   └─ ${issue}`));
    }
  }

  const passed = results.filter(r => r.status === 'pass').length;
  const partial = results.filter(r => r.status === 'partial').length;
  const failed = results.filter(r => r.status === 'fail').length;

  console.log('');
  console.log(`Results: ${passed} passed, ${partial} partial, ${failed} failed`);
  console.log('');
}

async function testClassificationToEntity(): Promise<WiringTestResult> {
  const issues: string[] = [];

  // Get emails with classifications
  const { count: classifiedCount } = await supabase
    .from('document_classifications')
    .select('*', { count: 'exact', head: true });

  // Get emails with entity extractions
  const { count: extractedCount } = await supabase
    .from('entity_extractions')
    .select('*', { count: 'exact', head: true });

  // Get emails with BOTH classification AND entities
  const { data: classifiedEmails } = await supabase
    .from('document_classifications')
    .select('email_id')
    .limit(1000);

  const classifiedIds = new Set(classifiedEmails?.map(c => c.email_id) || []);

  const { data: extractedEmails } = await supabase
    .from('entity_extractions')
    .select('email_id')
    .limit(5000);

  const extractedIds = new Set(extractedEmails?.map(e => e.email_id) || []);

  // How many classified emails have entities?
  let withBoth = 0;
  for (const id of classifiedIds) {
    if (extractedIds.has(id)) withBoth++;
  }

  const coverageRate = classifiedIds.size > 0 ? Math.round(withBoth / classifiedIds.size * 100) : 0;

  console.log(`  Classified emails: ${classifiedCount}`);
  console.log(`  Entity extractions: ${extractedCount}`);
  console.log(`  Coverage: ${withBoth}/${classifiedIds.size} (${coverageRate}%)`);

  // Sample a classified email with entities
  const { data: sample } = await supabase
    .from('document_classifications')
    .select(`
      email_id,
      document_type,
      confidence_score,
      raw_emails!inner(subject)
    `)
    .limit(1)
    .single();

  if (sample) {
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', sample.email_id)
      .limit(5);

    console.log(`  Sample: "${(sample.raw_emails as any)?.subject?.substring(0, 40)}..."`);
    console.log(`    Type: ${sample.document_type} (${sample.confidence_score}% confidence)`);
    console.log(`    Entities: ${entities?.length || 0}`);
    entities?.slice(0, 3).forEach(e => {
      console.log(`      - ${e.entity_type}: ${e.entity_value?.substring(0, 30)}`);
    });
  }

  if (coverageRate < 50) {
    issues.push(`Low coverage: Only ${coverageRate}% of classified emails have entities`);
  }

  return {
    stage: 'Classification → Entity Extraction',
    status: coverageRate >= 80 ? 'pass' : coverageRate >= 50 ? 'partial' : 'fail',
    details: { classifiedCount, extractedCount, coverageRate },
    issues
  };
}

async function testEntityToShipment(): Promise<WiringTestResult> {
  const issues: string[] = [];

  // Get shipments count
  const { count: shipmentCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  // Get email-shipment links
  const { count: linkCount } = await supabase
    .from('shipment_documents')
    .select('*', { count: 'exact', head: true });

  // Get emails with booking_number entities
  const { data: bookingEntities } = await supabase
    .from('entity_extractions')
    .select('email_id, entity_value')
    .eq('entity_type', 'booking_number')
    .limit(500);

  // How many of those emails are linked to shipments?
  const bookingEmailIds = bookingEntities?.map(e => e.email_id) || [];

  const { data: linkedEmails } = await supabase
    .from('shipment_documents')
    .select('email_id')
    .in('email_id', bookingEmailIds.slice(0, 100));

  const linkRate = bookingEmailIds.length > 0
    ? Math.round((linkedEmails?.length || 0) / Math.min(bookingEmailIds.length, 100) * 100)
    : 0;

  console.log(`  Total shipments: ${shipmentCount}`);
  console.log(`  Email-shipment links: ${linkCount}`);
  console.log(`  Emails with booking#: ${bookingEntities?.length || 0}`);
  console.log(`  Link rate: ${linkRate}%`);

  // Sample a shipment with linked emails
  const { data: sampleShipment } = await supabase
    .from('shipments')
    .select(`
      id,
      booking_number,
      status,
      shipper_id,
      consignee_id
    `)
    .not('booking_number', 'is', null)
    .limit(1)
    .single();

  if (sampleShipment) {
    const { data: linkedDocs } = await supabase
      .from('shipment_documents')
      .select('email_id, document_type')
      .eq('shipment_id', sampleShipment.id)
      .limit(5);

    console.log(`  Sample shipment: ${sampleShipment.booking_number}`);
    console.log(`    Status: ${sampleShipment.status}`);
    console.log(`    Has shipper: ${sampleShipment.shipper_id ? 'Yes' : 'No'}`);
    console.log(`    Has consignee: ${sampleShipment.consignee_id ? 'Yes' : 'No'}`);
    console.log(`    Linked emails: ${linkedDocs?.length || 0}`);
  }

  if (linkRate < 50) {
    issues.push(`Low link rate: Only ${linkRate}% of emails with booking# are linked to shipments`);
  }

  return {
    stage: 'Entity Extraction → Shipment',
    status: linkRate >= 70 ? 'pass' : linkRate >= 40 ? 'partial' : 'fail',
    details: { shipmentCount, linkCount, linkRate },
    issues
  };
}

async function testShipmentToJourney(): Promise<WiringTestResult> {
  const issues: string[] = [];

  // Get journey events count
  const { count: eventCount } = await supabase
    .from('shipment_journey_events')
    .select('*', { count: 'exact', head: true });

  // Get blockers count
  const { count: blockerCount } = await supabase
    .from('shipment_blockers')
    .select('*', { count: 'exact', head: true });

  // Get timeline count
  const { count: timelineCount } = await supabase
    .from('stakeholder_communication_timeline')
    .select('*', { count: 'exact', head: true });

  // How many shipments have journey events?
  const { data: shipmentsWithEvents } = await supabase
    .from('shipment_journey_events')
    .select('shipment_id')
    .limit(1000);

  const uniqueShipments = new Set(shipmentsWithEvents?.map(e => e.shipment_id) || []);

  const { count: totalShipments } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true });

  const journeyCoverage = totalShipments ? Math.round(uniqueShipments.size / totalShipments * 100) : 0;

  console.log(`  Journey events: ${eventCount}`);
  console.log(`  Active blockers: ${blockerCount}`);
  console.log(`  Timeline entries: ${timelineCount}`);
  console.log(`  Shipments with events: ${uniqueShipments.size}/${totalShipments} (${journeyCoverage}%)`);

  // Sample a shipment's journey
  const { data: sampleJourney } = await supabase
    .from('shipment_journey_events')
    .select(`
      shipment_id,
      event_type,
      event_description,
      occurred_at,
      shipments!inner(booking_number)
    `)
    .limit(1)
    .single();

  if (sampleJourney) {
    const { data: allEvents } = await supabase
      .from('shipment_journey_events')
      .select('event_type')
      .eq('shipment_id', sampleJourney.shipment_id);

    const eventTypes = [...new Set(allEvents?.map(e => e.event_type) || [])];

    console.log(`  Sample: ${(sampleJourney.shipments as any)?.booking_number}`);
    console.log(`    Events: ${allEvents?.length || 0}`);
    console.log(`    Types: ${eventTypes.slice(0, 4).join(', ')}`);
  }

  // Check blocker distribution
  const { data: blockerTypes } = await supabase
    .from('shipment_blockers')
    .select('blocker_type, is_resolved');

  const activeBlockers = blockerTypes?.filter(b => !b.is_resolved) || [];
  const byType: Record<string, number> = {};
  for (const b of activeBlockers) {
    byType[b.blocker_type] = (byType[b.blocker_type] || 0) + 1;
  }

  console.log(`  Active blockers by type:`);
  Object.entries(byType).slice(0, 5).forEach(([type, count]) => {
    console.log(`    - ${type}: ${count}`);
  });

  if (journeyCoverage < 20) {
    issues.push(`Low journey coverage: Only ${journeyCoverage}% of shipments have journey events`);
  }

  return {
    stage: 'Shipment → Journey Events',
    status: journeyCoverage >= 50 ? 'pass' : journeyCoverage >= 20 ? 'partial' : 'fail',
    details: { eventCount, blockerCount, timelineCount, journeyCoverage },
    issues
  };
}

async function testJourneyToActionCenter(): Promise<WiringTestResult> {
  const issues: string[] = [];

  // Get tasks count
  const { count: taskCount } = await supabase
    .from('action_tasks')
    .select('*', { count: 'exact', head: true });

  // Get tasks by status
  const { data: tasksByStatus } = await supabase
    .from('action_tasks')
    .select('status');

  const statusCounts: Record<string, number> = {};
  for (const t of tasksByStatus || []) {
    statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
  }

  // Get tasks linked to shipments
  const { data: tasksWithShipment } = await supabase
    .from('action_tasks')
    .select('shipment_id')
    .not('shipment_id', 'is', null)
    .limit(500);

  const tasksLinkedRate = taskCount ? Math.round((tasksWithShipment?.length || 0) / Math.min(taskCount, 500) * 100) : 0;

  // Get notifications count (source of tasks)
  const { count: notificationCount } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true });

  // Get document alerts (another source)
  const { count: alertCount } = await supabase
    .from('missing_document_alerts')
    .select('*', { count: 'exact', head: true });

  console.log(`  Total tasks: ${taskCount}`);
  console.log(`  Task status breakdown:`);
  Object.entries(statusCounts).forEach(([status, count]) => {
    console.log(`    - ${status}: ${count}`);
  });
  console.log(`  Tasks linked to shipments: ${tasksLinkedRate}%`);
  console.log(`  Notifications: ${notificationCount}`);
  console.log(`  Document alerts: ${alertCount}`);

  // Sample a task
  const { data: sampleTask } = await supabase
    .from('action_tasks')
    .select(`
      id,
      title,
      category,
      priority,
      status,
      shipment_id
    `)
    .not('shipment_id', 'is', null)
    .limit(1)
    .single();

  if (sampleTask) {
    // Check if this shipment has blockers
    const { data: blockers } = await supabase
      .from('shipment_blockers')
      .select('blocker_type, is_resolved')
      .eq('shipment_id', sampleTask.shipment_id);

    console.log(`  Sample task: "${sampleTask.title?.substring(0, 40)}..."`);
    console.log(`    Category: ${sampleTask.category}, Priority: ${sampleTask.priority}`);
    console.log(`    Shipment blockers: ${blockers?.length || 0}`);
  }

  if (taskCount === 0) {
    issues.push('No tasks in action center');
  }
  if (tasksLinkedRate < 50) {
    issues.push(`Low shipment linkage: Only ${tasksLinkedRate}% of tasks linked to shipments`);
  }

  return {
    stage: 'Journey → Action Center',
    status: taskCount > 0 && tasksLinkedRate >= 50 ? 'pass' : taskCount > 0 ? 'partial' : 'fail',
    details: { taskCount, notificationCount, alertCount, tasksLinkedRate },
    issues
  };
}

async function testEndToEndTrace(): Promise<WiringTestResult> {
  const issues: string[] = [];

  // Find an email that has made it through all stages
  // Start with emails that have classifications
  const { data: recentClassified } = await supabase
    .from('document_classifications')
    .select('email_id, document_type')
    .in('document_type', ['booking_confirmation', 'bill_of_lading', 'arrival_notice'])
    .limit(50);

  let tracedEmail = null;
  let traceResult: any = null;

  for (const classified of recentClassified || []) {
    // Check entity extractions
    const { data: entities } = await supabase
      .from('entity_extractions')
      .select('entity_type, entity_value')
      .eq('email_id', classified.email_id);

    if (!entities || entities.length === 0) continue;

    const bookingNum = entities.find(e => e.entity_type === 'booking_number')?.entity_value;
    if (!bookingNum) continue;

    // Check shipment link
    const { data: shipmentDoc } = await supabase
      .from('shipment_documents')
      .select('shipment_id')
      .eq('email_id', classified.email_id)
      .single();

    if (!shipmentDoc) continue;

    // Check journey events
    const { data: journeyEvents } = await supabase
      .from('shipment_journey_events')
      .select('event_type')
      .eq('shipment_id', shipmentDoc.shipment_id);

    // Check blockers
    const { data: blockers } = await supabase
      .from('shipment_blockers')
      .select('blocker_type')
      .eq('shipment_id', shipmentDoc.shipment_id);

    // Get email subject
    const { data: email } = await supabase
      .from('raw_emails')
      .select('subject')
      .eq('id', classified.email_id)
      .single();

    tracedEmail = classified.email_id;
    traceResult = {
      email: email?.subject?.substring(0, 50),
      classification: classified.document_type,
      entities: entities.length,
      bookingNumber: bookingNum,
      shipmentId: shipmentDoc.shipment_id,
      journeyEvents: journeyEvents?.length || 0,
      blockers: blockers?.length || 0
    };

    break;
  }

  if (traceResult) {
    console.log('  FULL TRACE FOUND:');
    console.log(`    Email: "${traceResult.email}..."`);
    console.log(`    ↓`);
    console.log(`    Classification: ${traceResult.classification}`);
    console.log(`    ↓`);
    console.log(`    Entities: ${traceResult.entities} (booking: ${traceResult.bookingNumber})`);
    console.log(`    ↓`);
    console.log(`    Shipment: ${traceResult.shipmentId.substring(0, 8)}...`);
    console.log(`    ↓`);
    console.log(`    Journey: ${traceResult.journeyEvents} events, ${traceResult.blockers} blockers`);

    // Check for tasks
    const { data: tasks } = await supabase
      .from('action_tasks')
      .select('title, status')
      .eq('shipment_id', traceResult.shipmentId);

    console.log(`    ↓`);
    console.log(`    Action Center: ${tasks?.length || 0} tasks`);

    if (tasks && tasks.length > 0) {
      traceResult.tasks = tasks.length;
    }
  } else {
    console.log('  No email found with complete pipeline trace');
    issues.push('Could not find email with complete end-to-end trace');
  }

  const hasFullTrace = traceResult && traceResult.journeyEvents > 0;

  return {
    stage: 'End-to-End Trace',
    status: hasFullTrace ? 'pass' : traceResult ? 'partial' : 'fail',
    details: traceResult || {},
    issues
  };
}

main().catch(console.error);
