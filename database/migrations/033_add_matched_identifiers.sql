-- Migration: Add matched identifier columns to shipment_documents
-- Purpose: Store the identifiers used to link documents to shipments for traceability
-- Date: 2025-01-04

-- Add columns to store the matched identifiers used for linking
ALTER TABLE shipment_documents
ADD COLUMN IF NOT EXISTS matched_booking_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS matched_bl_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS matched_container_number VARCHAR(50);

-- Add indexes for querying by matched identifiers
CREATE INDEX IF NOT EXISTS idx_shipment_documents_matched_booking
ON shipment_documents(matched_booking_number) WHERE matched_booking_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shipment_documents_matched_bl
ON shipment_documents(matched_bl_number) WHERE matched_bl_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shipment_documents_matched_container
ON shipment_documents(matched_container_number) WHERE matched_container_number IS NOT NULL;

-- Add comment explaining the columns
COMMENT ON COLUMN shipment_documents.matched_booking_number IS 'The booking number used to link this document to the shipment';
COMMENT ON COLUMN shipment_documents.matched_bl_number IS 'The BL number used to link this document to the shipment';
COMMENT ON COLUMN shipment_documents.matched_container_number IS 'The container number used to link this document to the shipment';
