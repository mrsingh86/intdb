-- Migration 024: Add bl_number and container_number to link_method constraint
-- These are legitimate linking methods that should be tracked accurately

-- Drop the existing constraint
ALTER TABLE shipment_documents
DROP CONSTRAINT IF EXISTS shipment_documents_link_method_check;

-- Add new constraint with additional values
ALTER TABLE shipment_documents
ADD CONSTRAINT shipment_documents_link_method_check
CHECK (link_method IN ('regex', 'ai', 'bl_number', 'container_number', 'booking_number', 'manual'));

-- Verify
SELECT 'Migration 024 complete: link_method constraint updated' as status;
