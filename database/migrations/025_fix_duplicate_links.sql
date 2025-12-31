-- Migration 025: Fix duplicate email-shipment links and add unique constraint
-- CRITICAL: Prevents duplicate links that cause data integrity issues

-- Step 1: Identify and keep only the most recent link for each email-shipment pair
-- Delete duplicates, keeping the one with the highest ID (most recent)
WITH duplicates AS (
  SELECT id,
         email_id,
         shipment_id,
         ROW_NUMBER() OVER (
           PARTITION BY email_id, shipment_id
           ORDER BY created_at DESC NULLS LAST, id DESC
         ) as rn
  FROM shipment_documents
)
DELETE FROM shipment_documents
WHERE id IN (
  SELECT id FROM duplicates WHERE rn > 1
);

-- Step 2: Add unique constraint to prevent future duplicates
-- This ensures each email can only be linked to a shipment ONCE
ALTER TABLE shipment_documents
DROP CONSTRAINT IF EXISTS shipment_documents_email_shipment_unique;

ALTER TABLE shipment_documents
ADD CONSTRAINT shipment_documents_email_shipment_unique
UNIQUE (email_id, shipment_id);

-- Step 3: Add index for faster lookups by email_id (if not exists)
CREATE INDEX IF NOT EXISTS idx_shipment_documents_email_id
ON shipment_documents(email_id);

-- Step 4: Add index for faster lookups by shipment_id (if not exists)
CREATE INDEX IF NOT EXISTS idx_shipment_documents_shipment_id
ON shipment_documents(shipment_id);

-- Verify
SELECT 'Migration 025 complete: ' || COUNT(*) || ' links remain, unique constraint added' as status
FROM shipment_documents;
