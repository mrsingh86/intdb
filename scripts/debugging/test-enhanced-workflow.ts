/**
 * Test script for EnhancedWorkflowStateService
 *
 * Runs a manual test to verify the enhanced workflow service
 * creates workflow history with email_type, sender_category, etc.
 */

import { createClient } from '@supabase/supabase-js';
import { EnhancedWorkflowStateService, WorkflowTransitionInput } from '../lib/services/enhanced-workflow-state-service';
import { EmailType, SenderCategory } from '../lib/config/email-type-config';

async function testEnhancedWorkflow() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const enhancedWorkflowService = new EnhancedWorkflowStateService(supabase);

  // Find an email with email_type that's linked to a shipment
  const { data: classification } = await supabase
    .from('document_classifications')
    .select(`
      email_id,
      document_type,
      email_type,
      email_category,
      sender_category,
      sentiment
    `)
    .not('email_type', 'is', null)
    .not('email_type', 'eq', 'unknown')
    .limit(1)
    .single();

  if (!classification) {
    console.log('No classified emails with email_type found');
    return;
  }

  console.log('\n=== Test Email Classification ===');
  console.log('Email ID:', classification.email_id);
  console.log('Document Type:', classification.document_type);
  console.log('Email Type:', classification.email_type);
  console.log('Sender Category:', classification.sender_category);

  // Get email details
  const { data: email } = await supabase
    .from('raw_emails')
    .select('subject, sender_email')
    .eq('id', classification.email_id)
    .single();

  console.log('Subject:', email?.subject);
  console.log('Sender:', email?.sender_email);

  // Find a shipment to test with (use one we know exists)
  const { data: shipment } = await supabase
    .from('shipments')
    .select('id, booking_number, workflow_state')
    .eq('booking_number', '263606660')
    .single();

  if (!shipment) {
    console.log('Test shipment 263606660 not found');
    return;
  }

  console.log('\n=== Test Shipment ===');
  console.log('Shipment ID:', shipment.id);
  console.log('Booking:', shipment.booking_number);
  console.log('Current State:', shipment.workflow_state);

  // Build transition input
  const transitionInput: WorkflowTransitionInput = {
    shipmentId: shipment.id,
    documentType: classification.document_type || 'unknown',
    emailType: (classification.email_type as EmailType) || 'general_notification',
    direction: 'inbound', // Test with inbound
    senderCategory: (classification.sender_category as SenderCategory) || 'unknown',
    emailId: classification.email_id,
    subject: email?.subject || '',
  };

  console.log('\n=== Transition Input ===');
  console.log(JSON.stringify(transitionInput, null, 2));

  // Execute transition
  console.log('\n=== Executing Enhanced Workflow Transition ===');
  const result = await enhancedWorkflowService.transitionFromClassification(transitionInput);

  console.log('\n=== Transition Result ===');
  console.log(JSON.stringify(result, null, 2));

  // Check workflow history for the new entry
  if (result.success) {
    const { data: history } = await supabase
      .from('shipment_workflow_history')
      .select('*')
      .eq('shipment_id', shipment.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    console.log('\n=== Latest Workflow History Entry ===');
    console.log('From State:', history?.from_state);
    console.log('To State:', history?.to_state);
    console.log('Document Type:', history?.triggered_by_document_type);
    console.log('Email Type:', history?.email_type);
    console.log('Sender Category:', history?.sender_category);
    console.log('Trigger Type:', history?.trigger_type);
    console.log('Email Direction:', history?.email_direction);
    console.log('Notes:', history?.transition_notes);
  }
}

testEnhancedWorkflow()
  .then(() => {
    console.log('\n✅ Test complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });
