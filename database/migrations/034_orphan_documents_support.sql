-- Migration: Add support for orphan documents in shipment_documents
-- This allows storing documents (entry_summary, duty_invoice, POD, etc.) from brokers/truckers
-- before they're linked to a shipment. They can be linked later via backfill.
--
-- Date: 2025-01-04

-- 1. Make shipment_id nullable to support orphan documents
ALTER TABLE shipment_documents
ALTER COLUMN shipment_id DROP NOT NULL;

-- 2. Add booking_number_extracted for later linking
ALTER TABLE shipment_documents
ADD COLUMN IF NOT EXISTS booking_number_extracted TEXT;

-- 3. Update status column with new values if needed
-- First check if status column exists, if not add it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shipment_documents' AND column_name = 'status'
  ) THEN
    ALTER TABLE shipment_documents ADD COLUMN status VARCHAR(50) DEFAULT 'linked';
  END IF;
END $$;

-- 4. Create index for finding orphan documents (unlinked)
CREATE INDEX IF NOT EXISTS idx_shipment_documents_orphan
ON shipment_documents(booking_number_extracted)
WHERE shipment_id IS NULL;

-- 5. Create index for finding documents by status
CREATE INDEX IF NOT EXISTS idx_shipment_documents_status
ON shipment_documents(status)
WHERE status = 'pending_link';

-- 6. Add comments for documentation
COMMENT ON COLUMN shipment_documents.booking_number_extracted IS 'Booking reference extracted from email for later linking to shipment';
COMMENT ON COLUMN shipment_documents.status IS 'Document status: linked (to shipment), pending_link (orphan awaiting shipment), superseded';

-- 7. Summary of changes
-- BEFORE: shipment_documents required shipment_id (NOT NULL)
-- AFTER: shipment_documents can store orphan documents (shipment_id NULL)
--        with booking_number_extracted for later backfill linking
