/**
 * Zod Validation Schemas
 *
 * Input validation for API routes and service methods.
 * Prevents mass assignment and injection vulnerabilities.
 */

import { z } from 'zod';

// ============================================================================
// COMMON SCHEMAS
// ============================================================================

export const uuidSchema = z.string().uuid();

export const dateStringSchema = z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ============================================================================
// TASK SCHEMAS
// ============================================================================

export const taskCategorySchema = z.enum([
  'deadline',
  'document',
  'notification',
  'compliance',
  'manual',
]);

export const taskPrioritySchema = z.enum(['critical', 'high', 'medium', 'low']);

export const taskStatusSchema = z.enum([
  'pending',
  'in_progress',
  'completed',
  'dismissed',
  'blocked',
]);

export const createTaskSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  category: taskCategorySchema,
  priority: taskPrioritySchema.optional(),
  due_date: dateStringSchema.optional(),
  shipment_id: uuidSchema.optional(),
  notification_id: uuidSchema.optional(),
  document_lifecycle_id: uuidSchema.optional(),
  stakeholder_id: uuidSchema.optional(),
});

export const updateTaskSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  priority: taskPrioritySchema.optional(),
  status: taskStatusSchema.optional(),
  due_date: dateStringSchema.optional(),
  assigned_to: uuidSchema.optional(),
  status_notes: z.string().max(500).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

// ============================================================================
// NOTIFICATION SCHEMAS
// ============================================================================

export const notificationStatusSchema = z.enum([
  'unread',
  'read',
  'acknowledged',
  'actioned',
  'dismissed',
]);

export const notificationPrioritySchema = z.enum(['critical', 'high', 'medium', 'low']);

export const updateNotificationSchema = z.object({
  status: notificationStatusSchema.optional(),
  priority: notificationPrioritySchema.optional(),
});

export type UpdateNotificationInput = z.infer<typeof updateNotificationSchema>;

// ============================================================================
// DOCUMENT SCHEMAS
// ============================================================================

export const documentTypeSchema = z.enum([
  'booking_confirmation',
  'booking_amendment',
  'shipping_instruction',
  'si_draft',
  'bill_of_lading',
  'arrival_notice',
  'commercial_invoice',
  'packing_list',
  'customs_clearance',
  'vgm_confirmation',
]);

export const lifecycleStatusSchema = z.enum([
  'draft',
  'pending',
  'review',
  'approved',
  'sent',
  'received',
  'acknowledged',
  'superseded',
]);

export const updateDocumentLifecycleSchema = z.object({
  lifecycle_status: lifecycleStatusSchema.optional(),
  quality_score: z.number().min(0).max(100).optional(),
  missing_fields: z.array(z.string()).optional(),
});

export type UpdateDocumentLifecycleInput = z.infer<typeof updateDocumentLifecycleSchema>;

// ============================================================================
// STAKEHOLDER SCHEMAS
// ============================================================================

export const partyTypeSchema = z.enum([
  'shipper',
  'consignee',
  'notify_party',
  'shipping_line',
  'agent',
  'customs_broker',
  'trucker',
]);

export const customerRelationshipSchema = z.enum([
  'paying_customer',
  'shipper_customer',
  'consignee_customer',
]);

export const createStakeholderSchema = z.object({
  party_name: z.string().min(1).max(200),
  party_type: partyTypeSchema,
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  contact_email: z.string().email().optional(),
  contact_phone: z.string().max(50).optional(),
  is_customer: z.boolean().optional(),
  customer_relationship: customerRelationshipSchema.optional(),
});

export const updateStakeholderSchema = z.object({
  party_name: z.string().min(1).max(200).optional(),
  address: z.string().max(500).optional(),
  city: z.string().max(100).optional(),
  country: z.string().max(100).optional(),
  contact_email: z.string().email().optional(),
  contact_phone: z.string().max(50).optional(),
  is_customer: z.boolean().optional(),
  customer_relationship: customerRelationshipSchema.optional(),
  reliability_score: z.number().min(0).max(100).optional(),
});

export type CreateStakeholderInput = z.infer<typeof createStakeholderSchema>;
export type UpdateStakeholderInput = z.infer<typeof updateStakeholderSchema>;

// ============================================================================
// SHIPMENT SCHEMAS
// ============================================================================

export const shipmentStatusSchema = z.enum([
  'draft',
  'confirmed',
  'in_transit',
  'arrived',
  'delivered',
  'cancelled',
]);

export const workflowStateSchema = z.enum([
  'pre_departure',
  'in_transit',
  'arrival',
  'delivery',
]);

export const updateShipmentSchema = z.object({
  booking_number: z.string().max(50).optional(),
  bl_number: z.string().max(50).optional(),
  vessel_name: z.string().max(100).optional(),
  voyage_number: z.string().max(50).optional(),
  port_of_loading: z.string().max(100).optional(),
  port_of_discharge: z.string().max(100).optional(),
  etd: dateStringSchema.optional(),
  eta: dateStringSchema.optional(),
  si_cutoff: dateStringSchema.optional(),
  vgm_cutoff: dateStringSchema.optional(),
  cargo_cutoff: dateStringSchema.optional(),
  gate_cutoff: dateStringSchema.optional(),
  status: shipmentStatusSchema.optional(),
  workflow_state: workflowStateSchema.optional(),
});

export type UpdateShipmentInput = z.infer<typeof updateShipmentSchema>;

// ============================================================================
// COMMUNICATION SCHEMAS
// ============================================================================

export const sendEmailSchema = z.object({
  to: z.array(z.string().email()).min(1),
  cc: z.array(z.string().email()).optional(),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(50000),
  task_id: uuidSchema.optional(),
  shipment_id: uuidSchema.optional(),
});

export type SendEmailInput = z.infer<typeof sendEmailSchema>;

// ============================================================================
// QUERY PARAMETER SCHEMAS
// ============================================================================

export const tasksQuerySchema = paginationSchema.extend({
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  category: taskCategorySchema.optional(),
  shipment_id: uuidSchema.optional(),
});

export const notificationsQuerySchema = paginationSchema.extend({
  status: notificationStatusSchema.optional(),
  priority: notificationPrioritySchema.optional(),
});

export const documentsQuerySchema = paginationSchema.extend({
  shipment_id: uuidSchema.optional(),
  document_type: documentTypeSchema.optional(),
  lifecycle_status: lifecycleStatusSchema.optional(),
});

export type TasksQueryParams = z.infer<typeof tasksQuerySchema>;
export type NotificationsQueryParams = z.infer<typeof notificationsQuerySchema>;
export type DocumentsQueryParams = z.infer<typeof documentsQuerySchema>;
