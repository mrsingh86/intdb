-- Migration 072: Move SE-prefixed values from mbl_number to work_order_number
-- 553 records have SEINUS* pattern in mbl_number field
-- These are work order numbers (Intoglo internal), not Master BLs
-- Joint recommendation from extraction + date-location auditors

-- Step 1: Move SE-prefixed values to work_order_number (only if work_order is null)
UPDATE chronicle
SET
  work_order_number = mbl_number,
  mbl_number = NULL
WHERE mbl_number ~ '^SE[A-Z]{2,}'
  AND work_order_number IS NULL;

-- Step 2: For records where work_order already exists, just clear the mbl
UPDATE chronicle
SET mbl_number = NULL
WHERE mbl_number ~ '^SE[A-Z]{2,}'
  AND work_order_number IS NOT NULL;
