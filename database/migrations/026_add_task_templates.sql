-- ============================================================================
-- MIGRATION 026: ADD MISSING TASK TEMPLATES
-- ============================================================================
-- Purpose: Add 12 additional task templates for comprehensive operational coverage
-- Author: AI Pipeline Implementation
-- Date: 2025-12-31
-- Dependencies: Migration 019 (Action Center)
-- ============================================================================

-- Insert new task templates (ON CONFLICT DO NOTHING to be idempotent)
INSERT INTO task_templates
  (template_code, template_name, template_category, default_title_template, trigger_type, trigger_conditions, has_email_template, email_subject_template, email_body_template, base_priority)
VALUES
  -- Notification response tasks
  ('address_detention', 'Address Detention Alert', 'notification',
   'URGENT: Detention Alert for {container_number}',
   'notification_received',
   '{"notification_type": "detention_alert"}'::jsonb,
   true,
   'Detention Alert - Container {container_number}',
   'Dear Team,\n\nA detention alert has been raised for container {container_number}.\n\nBooking: {booking_number}\nFree days remaining: {free_days}\n\nPlease arrange pickup/return to avoid charges.\n\nBest regards',
   'high'),

  ('notify_delay', 'Notify Vessel Delay', 'notification',
   'Vessel Delay Notification - {booking_number}',
   'notification_received',
   '{"notification_type": "vessel_delay"}'::jsonb,
   true,
   'Vessel Delay Notice - {vessel_name}',
   'Dear {shipper_name},\n\nWe would like to inform you of a delay affecting your shipment.\n\nBooking: {booking_number}\nVessel: {vessel_name}\nOriginal ETA: {original_eta}\nRevised ETA: {new_eta}\n\nWe apologize for any inconvenience.\n\nBest regards',
   'medium'),

  -- Deadline tasks
  ('prevent_demurrage', 'Prevent Demurrage Charges', 'deadline',
   'Prevent Demurrage - Container {container_number}',
   'deadline_approaching',
   '{"days_before_deadline": 2, "deadline_type": "free_time_expiry"}'::jsonb,
   true,
   'URGENT: Demurrage Prevention - {container_number}',
   'Dear Team,\n\nContainer {container_number} free time is expiring soon.\n\nBooking: {booking_number}\nFree time expires: {deadline_date}\n\nPlease arrange immediate action to avoid demurrage charges.\n\nBest regards',
   'high'),

  ('submit_cargo', 'Submit Cargo Details', 'deadline',
   'Submit Cargo Details for {booking_number}',
   'deadline_approaching',
   '{"days_before_deadline": 3, "deadline_type": "cargo_cutoff"}'::jsonb,
   true,
   'Cargo Details Required - Booking {booking_number}',
   'Dear {shipper_name},\n\nPlease submit cargo details for booking {booking_number}.\n\nCargo Cutoff: {deadline_date}\n\nRequired information:\n- Cargo weight\n- Package count\n- Commodity description\n\nBest regards',
   'high'),

  -- Compliance tasks
  ('escalate_customs_hold', 'Escalate Customs Hold', 'compliance',
   'ESCALATE: Customs Hold for {booking_number}',
   'notification_received',
   '{"notification_type": "customs_hold", "age_hours": 48}'::jsonb,
   true,
   'ESCALATION: Customs Hold - {booking_number}',
   'Dear Management,\n\nCustoms hold for booking {booking_number} has not been resolved after 48 hours.\n\nContainer: {container_number}\nHold Reason: {hold_reason}\n\nImmediate escalation required.\n\nBest regards',
   'critical'),

  ('obtain_customs_clearance', 'Obtain Customs Clearance', 'compliance',
   'Obtain Customs Clearance - {booking_number}',
   'milestone_reached',
   '{"milestone": "vessel_arrived"}'::jsonb,
   true,
   'Customs Clearance Required - {booking_number}',
   'Dear Customs Broker,\n\nPlease initiate customs clearance for:\n\nBooking: {booking_number}\nContainer: {container_number}\nVessel: {vessel_name}\nArrival: {eta}\n\nAll original documents have been forwarded.\n\nBest regards',
   'high'),

  -- Communication tasks
  ('follow_up_shipper', 'Follow Up with Shipper', 'communication',
   'Follow Up: {shipper_name} - {booking_number}',
   'milestone_missed',
   '{"expected_response_days": 2}'::jsonb,
   true,
   'Follow Up - Booking {booking_number}',
   'Dear {shipper_name},\n\nWe are following up on our previous communication regarding booking {booking_number}.\n\nPlease provide the requested information at your earliest convenience.\n\nBest regards',
   'medium'),

  ('send_payment_reminder', 'Send Payment Reminder', 'communication',
   'Payment Reminder - Invoice {invoice_number}',
   'deadline_approaching',
   '{"days_before_deadline": 3, "deadline_type": "payment_due"}'::jsonb,
   true,
   'Payment Reminder - Invoice {invoice_number}',
   'Dear {customer_name},\n\nThis is a friendly reminder that payment for invoice {invoice_number} is due on {due_date}.\n\nAmount: {amount}\nBooking: {booking_number}\n\nPlease remit payment to avoid service interruptions.\n\nBest regards',
   'medium'),

  -- Document tasks
  ('request_missing_docs', 'Request Missing Documents', 'document',
   'Request Missing Documents - {booking_number}',
   'document_missing',
   '{"expected_within_days": 3}'::jsonb,
   true,
   'Missing Documents Required - {booking_number}',
   'Dear {shipper_name},\n\nWe are missing required documents for booking {booking_number}.\n\nMissing documents:\n{missing_documents_list}\n\nPlease provide these at your earliest convenience.\n\nBest regards',
   'high'),

  ('review_invoice', 'Review Invoice Discrepancies', 'document',
   'Review Invoice - {booking_number}',
   'document_received',
   '{"document_type": "invoice", "requires_review": true}'::jsonb,
   false, NULL, NULL,
   'medium'),

  -- Operational tasks
  ('arrange_transport', 'Arrange Local Transport', 'operational',
   'Arrange Transport - Container {container_number}',
   'milestone_reached',
   '{"milestone": "container_available"}'::jsonb,
   true,
   'Transport Arrangement Required - {container_number}',
   'Dear Transport Team,\n\nPlease arrange local transport for:\n\nContainer: {container_number}\nPickup Location: {pickup_location}\nDelivery Address: {delivery_address}\nAvailable from: {available_date}\n\nBest regards',
   'high'),

  ('confirm_delivery', 'Confirm Delivery', 'operational',
   'Confirm Delivery - {booking_number}',
   'milestone_reached',
   '{"milestone": "out_for_delivery"}'::jsonb,
   true,
   'Delivery Confirmation Request - {booking_number}',
   'Dear {consignee_name},\n\nPlease confirm receipt of goods for booking {booking_number}.\n\nContainer: {container_number}\nDelivery Date: {delivery_date}\n\nKindly sign and return the attached POD.\n\nBest regards',
   'medium')
ON CONFLICT (template_code) DO NOTHING;

-- ============================================================================
-- END OF MIGRATION 026
-- ============================================================================
