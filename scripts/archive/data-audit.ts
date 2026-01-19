import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_KEY || ''
);

async function auditData() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                         COMPREHENSIVE DATA AUDIT                               ');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // 1. EMAILS
  const { count: totalEmails } = await supabase.from('raw_emails').select('*', { count: 'exact', head: true });
  console.log('1. EMAILS');
  console.log('─'.repeat(60));
  console.log('   Total emails:', totalEmails);

  const { data: emailStatuses } = await supabase.from('raw_emails').select('processing_status');
  const statusCount: Record<string, number> = {};
  for (const e of emailStatuses || []) {
    statusCount[e.processing_status || 'null'] = (statusCount[e.processing_status || 'null'] || 0) + 1;
  }
  console.log('   By processing status:');
  for (const [status, count] of Object.entries(statusCount).sort((a, b) => (b[1] as number) - (a[1] as number))) {
    console.log('     ' + status.padEnd(20) + count);
  }
  console.log('');

  // 2. ATTACHMENTS
  const { count: totalAttachments } = await supabase.from('raw_attachments').select('*', { count: 'exact', head: true });
  const { count: pdfAttachments } = await supabase.from('raw_attachments').select('*', { count: 'exact', head: true }).ilike('filename', '%.pdf');
  const { count: extractedPdfs } = await supabase.from('raw_attachments').select('*', { count: 'exact', head: true }).ilike('filename', '%.pdf').not('extracted_text', 'is', null);

  console.log('2. ATTACHMENTS');
  console.log('─'.repeat(60));
  console.log('   Total attachments:', totalAttachments);
  console.log('   PDF attachments:', pdfAttachments);
  console.log('   PDFs with extracted text:', extractedPdfs, '(' + Math.round((extractedPdfs || 0) / (pdfAttachments || 1) * 100) + '%)');
  console.log('');

  // 3. CLASSIFICATIONS
  const { count: totalClassifications } = await supabase.from('document_classifications').select('*', { count: 'exact', head: true });
  const { data: classTypes } = await supabase.from('document_classifications').select('document_type');
  const typeCount: Record<string, number> = {};
  for (const c of classTypes || []) {
    typeCount[c.document_type] = (typeCount[c.document_type] || 0) + 1;
  }

  console.log('3. CLASSIFICATIONS');
  console.log('─'.repeat(60));
  console.log('   Total classifications:', totalClassifications);
  console.log('   By document type (top 15):');
  const sortedTypes = Object.entries(typeCount).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 15);
  for (const [type, count] of sortedTypes) {
    const pct = Math.round((count as number) / (totalClassifications || 1) * 100);
    console.log('     ' + type.padEnd(35) + String(count).padStart(5) + ' (' + pct + '%)');
  }
  console.log('');

  // 4. EXTRACTED ENTITIES
  const { count: totalEntities } = await supabase.from('entity_extractions').select('*', { count: 'exact', head: true });
  const { data: entityTypes } = await supabase.from('entity_extractions').select('entity_type');
  const entCount: Record<string, number> = {};
  for (const e of entityTypes || []) {
    entCount[e.entity_type] = (entCount[e.entity_type] || 0) + 1;
  }

  console.log('4. EXTRACTED ENTITIES');
  console.log('─'.repeat(60));
  console.log('   Total entities:', totalEntities);
  console.log('   By entity type:');
  for (const [type, count] of Object.entries(entCount).sort((a, b) => (b[1] as number) - (a[1] as number))) {
    console.log('     ' + type.padEnd(30) + String(count).padStart(6));
  }
  console.log('');

  // 5. SHIPMENTS
  const { count: totalShipments } = await supabase.from('shipments').select('*', { count: 'exact', head: true });
  const { data: shipData } = await supabase.from('shipments').select('status, workflow_state, shipper_id, consignee_id, carrier_id, etd, eta');

  const statusCounts: Record<string, number> = {};
  const workflowCounts: Record<string, number> = {};
  let withShipper = 0, withConsignee = 0, withCarrier = 0, withEtd = 0, withEta = 0;

  for (const s of shipData || []) {
    statusCounts[s.status || 'null'] = (statusCounts[s.status || 'null'] || 0) + 1;
    workflowCounts[s.workflow_state || 'null'] = (workflowCounts[s.workflow_state || 'null'] || 0) + 1;
    if (s.shipper_id) withShipper++;
    if (s.consignee_id) withConsignee++;
    if (s.carrier_id) withCarrier++;
    if (s.etd) withEtd++;
    if (s.eta) withEta++;
  }

  console.log('5. SHIPMENTS');
  console.log('─'.repeat(60));
  console.log('   Total shipments:', totalShipments);
  console.log('');
  console.log('   By status:');
  for (const [status, count] of Object.entries(statusCounts).sort((a, b) => (b[1] as number) - (a[1] as number))) {
    console.log('     ' + status.padEnd(25) + count);
  }
  console.log('');
  console.log('   By workflow_state (top 10):');
  for (const [state, count] of Object.entries(workflowCounts).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 10)) {
    console.log('     ' + state.padEnd(35) + count);
  }
  console.log('');
  console.log('   Data completeness:');
  console.log('     With shipper_id:    ' + withShipper + ' (' + Math.round(withShipper / (totalShipments || 1) * 100) + '%)');
  console.log('     With consignee_id:  ' + withConsignee + ' (' + Math.round(withConsignee / (totalShipments || 1) * 100) + '%)');
  console.log('     With carrier_id:    ' + withCarrier + ' (' + Math.round(withCarrier / (totalShipments || 1) * 100) + '%)');
  console.log('     With ETD:           ' + withEtd + ' (' + Math.round(withEtd / (totalShipments || 1) * 100) + '%)');
  console.log('     With ETA:           ' + withEta + ' (' + Math.round(withEta / (totalShipments || 1) * 100) + '%)');
  console.log('');

  // 6. EMAIL-SHIPMENT LINKING
  const { count: totalLinks } = await supabase.from('shipment_documents').select('*', { count: 'exact', head: true });
  const { data: linkData } = await supabase.from('shipment_documents').select('email_id, shipment_id, document_type');

  const linkedEmailIds = new Set(linkData?.map(l => l.email_id) || []);
  const linkedShipmentIds = new Set(linkData?.map(l => l.shipment_id) || []);

  const linkTypeCount: Record<string, number> = {};
  for (const l of linkData || []) {
    linkTypeCount[l.document_type] = (linkTypeCount[l.document_type] || 0) + 1;
  }

  console.log('6. EMAIL-SHIPMENT LINKING');
  console.log('─'.repeat(60));
  console.log('   Total links:', totalLinks);
  console.log('   Unique emails linked:', linkedEmailIds.size);
  console.log('   Unique shipments with emails:', linkedShipmentIds.size);
  console.log('');
  console.log('   Links by document type (top 10):');
  for (const [type, count] of Object.entries(linkTypeCount).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 10)) {
    console.log('     ' + type.padEnd(35) + count);
  }
  console.log('');

  // 7. UNLINKED DATA
  const unlinkedEmails = (totalEmails || 0) - linkedEmailIds.size;
  const unlinkedShipments = (totalShipments || 0) - linkedShipmentIds.size;

  console.log('7. UNLINKED DATA');
  console.log('─'.repeat(60));
  console.log('   Unlinked emails:', unlinkedEmails, '(' + Math.round(unlinkedEmails / (totalEmails || 1) * 100) + '% of total)');
  console.log('   Unlinked shipments:', unlinkedShipments, '(' + Math.round(unlinkedShipments / (totalShipments || 1) * 100) + '% of total)');

  const { data: allClassData } = await supabase.from('document_classifications').select('email_id, document_type');
  const unlinkedByType: Record<string, number> = {};
  for (const c of allClassData || []) {
    if (!linkedEmailIds.has(c.email_id)) {
      unlinkedByType[c.document_type] = (unlinkedByType[c.document_type] || 0) + 1;
    }
  }
  console.log('');
  console.log('   Unlinked emails by document type (top 10):');
  for (const [type, count] of Object.entries(unlinkedByType).sort((a, b) => (b[1] as number) - (a[1] as number)).slice(0, 10)) {
    console.log('     ' + type.padEnd(35) + count);
  }
  console.log('');

  // 8. PARTIES/STAKEHOLDERS
  const { count: totalParties } = await supabase.from('parties').select('*', { count: 'exact', head: true });
  const { data: partyData } = await supabase.from('parties').select('party_type, is_customer');
  const partyTypes: Record<string, number> = {};
  let customers = 0;
  for (const p of partyData || []) {
    partyTypes[p.party_type || 'unknown'] = (partyTypes[p.party_type || 'unknown'] || 0) + 1;
    if (p.is_customer) customers++;
  }

  console.log('8. PARTIES/STAKEHOLDERS');
  console.log('─'.repeat(60));
  console.log('   Total parties:', totalParties);
  console.log('   Customers:', customers);
  console.log('   By type:');
  for (const [type, count] of Object.entries(partyTypes).sort((a, b) => (b[1] as number) - (a[1] as number))) {
    console.log('     ' + type.padEnd(20) + count);
  }
  console.log('');

  // 9. CARRIERS
  const { count: totalCarriers } = await supabase.from('carriers').select('*', { count: 'exact', head: true });
  const { data: carrierData } = await supabase.from('carriers').select('carrier_name, carrier_type');

  console.log('9. CARRIERS');
  console.log('─'.repeat(60));
  console.log('   Total carriers:', totalCarriers);
  for (const c of carrierData || []) {
    console.log('     ' + (c.carrier_name || 'Unknown').padEnd(30) + (c.carrier_type || ''));
  }
  console.log('');

  // 10. DOCUMENT LIFECYCLE
  const { count: totalLifecycle } = await supabase.from('document_lifecycle').select('*', { count: 'exact', head: true });
  const { data: lifecycleData } = await supabase.from('document_lifecycle').select('lifecycle_status, document_type');

  const lifecycleStatus: Record<string, number> = {};
  for (const d of lifecycleData || []) {
    lifecycleStatus[d.lifecycle_status || 'null'] = (lifecycleStatus[d.lifecycle_status || 'null'] || 0) + 1;
  }

  console.log('10. DOCUMENT LIFECYCLE');
  console.log('─'.repeat(60));
  console.log('    Total records:', totalLifecycle);
  console.log('    By status:');
  for (const [status, count] of Object.entries(lifecycleStatus).sort((a, b) => (b[1] as number) - (a[1] as number))) {
    console.log('      ' + status.padEnd(25) + count);
  }
  console.log('');

  // 11. NOTIFICATIONS
  const { count: totalNotifications } = await supabase.from('notifications').select('*', { count: 'exact', head: true });
  const { data: notifData } = await supabase.from('notifications').select('notification_type, status, priority');

  const notifTypes: Record<string, number> = {};
  const notifStatuses: Record<string, number> = {};
  const notifPriorities: Record<string, number> = {};
  for (const n of notifData || []) {
    notifTypes[n.notification_type || 'null'] = (notifTypes[n.notification_type || 'null'] || 0) + 1;
    notifStatuses[n.status || 'null'] = (notifStatuses[n.status || 'null'] || 0) + 1;
    notifPriorities[n.priority || 'null'] = (notifPriorities[n.priority || 'null'] || 0) + 1;
  }

  console.log('11. NOTIFICATIONS (Deadline Notices)');
  console.log('─'.repeat(60));
  console.log('    Total notifications:', totalNotifications);
  console.log('    By type:');
  for (const [type, count] of Object.entries(notifTypes).sort((a, b) => (b[1] as number) - (a[1] as number))) {
    console.log('      ' + type.padEnd(30) + count);
  }
  console.log('    By status:');
  for (const [status, count] of Object.entries(notifStatuses).sort((a, b) => (b[1] as number) - (a[1] as number))) {
    console.log('      ' + status.padEnd(20) + count);
  }
  console.log('    By priority:');
  for (const [priority, count] of Object.entries(notifPriorities).sort((a, b) => (b[1] as number) - (a[1] as number))) {
    console.log('      ' + priority.padEnd(20) + count);
  }
  console.log('');

  // 12. INSIGHTS
  const { count: totalInsights } = await supabase.from('shipment_insights').select('*', { count: 'exact', head: true });
  const { data: insightData } = await supabase.from('shipment_insights').select('insight_type, severity, status, source');

  const insightTypes: Record<string, number> = {};
  const insightSeverities: Record<string, number> = {};
  const insightSources: Record<string, number> = {};
  for (const i of insightData || []) {
    insightTypes[i.insight_type || 'null'] = (insightTypes[i.insight_type || 'null'] || 0) + 1;
    insightSeverities[i.severity || 'null'] = (insightSeverities[i.severity || 'null'] || 0) + 1;
    insightSources[i.source || 'null'] = (insightSources[i.source || 'null'] || 0) + 1;
  }

  console.log('12. INSIGHTS');
  console.log('─'.repeat(60));
  console.log('    Total insights:', totalInsights);
  console.log('    By type:');
  for (const [type, count] of Object.entries(insightTypes).sort((a, b) => (b[1] as number) - (a[1] as number))) {
    console.log('      ' + type.padEnd(25) + count);
  }
  console.log('    By severity:');
  for (const [sev, count] of Object.entries(insightSeverities).sort((a, b) => (b[1] as number) - (a[1] as number))) {
    console.log('      ' + sev.padEnd(20) + count);
  }
  console.log('    By source:');
  for (const [src, count] of Object.entries(insightSources).sort((a, b) => (b[1] as number) - (a[1] as number))) {
    console.log('      ' + src.padEnd(20) + count);
  }
  console.log('');

  // 13. ACTION TASKS
  const { count: totalTasks } = await supabase.from('action_tasks').select('*', { count: 'exact', head: true });
  const { data: taskData } = await supabase.from('action_tasks').select('task_type, status, priority');

  const taskTypes: Record<string, number> = {};
  const taskStatuses: Record<string, number> = {};
  const taskPriorities: Record<string, number> = {};
  for (const t of taskData || []) {
    taskTypes[t.task_type || 'null'] = (taskTypes[t.task_type || 'null'] || 0) + 1;
    taskStatuses[t.status || 'null'] = (taskStatuses[t.status || 'null'] || 0) + 1;
    taskPriorities[t.priority || 'null'] = (taskPriorities[t.priority || 'null'] || 0) + 1;
  }

  console.log('13. ACTION TASKS');
  console.log('─'.repeat(60));
  console.log('    Total tasks:', totalTasks);
  console.log('    By type:');
  for (const [type, count] of Object.entries(taskTypes).sort((a, b) => (b[1] as number) - (a[1] as number))) {
    console.log('      ' + type.padEnd(30) + count);
  }
  console.log('    By status:');
  for (const [status, count] of Object.entries(taskStatuses).sort((a, b) => (b[1] as number) - (a[1] as number))) {
    console.log('      ' + status.padEnd(20) + count);
  }
  console.log('    By priority:');
  for (const [priority, count] of Object.entries(taskPriorities).sort((a, b) => (b[1] as number) - (a[1] as number))) {
    console.log('      ' + priority.padEnd(20) + count);
  }
  console.log('');

  // 14. PATTERNS
  const { count: totalPatterns } = await supabase.from('insight_patterns').select('*', { count: 'exact', head: true });
  const { data: patternData } = await supabase.from('insight_patterns').select('category, severity, enabled');

  console.log('14. INSIGHT PATTERNS (Configured)');
  console.log('─'.repeat(60));
  console.log('    Total patterns defined:', totalPatterns);
  if (patternData && patternData.length > 0) {
    const byCategory: Record<string, number> = {};
    let enabled = 0;
    for (const p of patternData) {
      byCategory[p.category || 'null'] = (byCategory[p.category || 'null'] || 0) + 1;
      if (p.enabled) enabled++;
    }
    console.log('    Enabled:', enabled);
    console.log('    By category:');
    for (const [cat, count] of Object.entries(byCategory)) {
      console.log('      ' + cat.padEnd(20) + count);
    }
  }
  console.log('');

  // SUMMARY
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                              SUMMARY                                           ');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('');
  const linkRate = Math.round(linkedEmailIds.size / (totalEmails || 1) * 100);
  const shipmentLinkRate = Math.round(linkedShipmentIds.size / (totalShipments || 1) * 100);

  console.log('  DATA VOLUME:');
  console.log('    Emails:           ' + totalEmails);
  console.log('    Attachments:      ' + totalAttachments + ' (' + pdfAttachments + ' PDFs)');
  console.log('    Classifications:  ' + totalClassifications);
  console.log('    Entities:         ' + totalEntities);
  console.log('    Shipments:        ' + totalShipments);
  console.log('    Parties:          ' + totalParties);
  console.log('');
  console.log('  LINKING METRICS:');
  console.log('    Email→Shipment links:  ' + totalLinks);
  console.log('    Emails linked:         ' + linkedEmailIds.size + '/' + totalEmails + ' (' + linkRate + '%)');
  console.log('    Shipments with emails: ' + linkedShipmentIds.size + '/' + totalShipments + ' (' + shipmentLinkRate + '%)');
  console.log('');
  console.log('  INTELLIGENCE:');
  console.log('    Notifications:    ' + totalNotifications);
  console.log('    Insights:         ' + totalInsights);
  console.log('    Action Tasks:     ' + totalTasks);
  console.log('    Patterns:         ' + totalPatterns);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════');
}

auditData().catch(console.error);
