/**
 * Shipment Linking Module
 *
 * Bi-directional linking between emails and shipments.
 * Includes thread-aware linking to handle RE:/FW: cross-linking correctly.
 */

export * from './types';
export * from './link-confidence-calculator';
export * from './backfill-service';
export * from './thread-summary-service';
export * from './thread-aware-linking-service';
