-- Migration 069: Backfill carrier_name from MBL prefix
-- MBL numbers have standard carrier prefixes (4 letters)
-- This enriches carrier_name for 7,629+ records where it's currently null
-- Joint recommendation from extraction + date-location auditors

-- Carrier prefix → canonical carrier name mapping
-- Based on SCAC codes used in Master BL numbers
UPDATE chronicle
SET carrier_name = CASE
  WHEN mbl_number LIKE 'MAEU%' OR mbl_number LIKE 'MSKU%' OR mbl_number LIKE 'MRKU%' THEN 'Maersk'
  WHEN mbl_number LIKE 'HLCU%' OR mbl_number LIKE 'HLXU%' THEN 'Hapag-Lloyd'
  WHEN mbl_number LIKE 'COSU%' OR mbl_number LIKE 'CCLU%' OR mbl_number LIKE 'CSLU%' THEN 'COSCO'
  WHEN mbl_number LIKE 'MEDU%' OR mbl_number LIKE 'MSCU%' OR mbl_number LIKE 'MSKU%' THEN 'MSC'
  WHEN mbl_number LIKE 'OOLU%' OR mbl_number LIKE 'OOCL%' THEN 'OOCL'
  WHEN mbl_number LIKE 'EGLV%' OR mbl_number LIKE 'EGHU%' THEN 'Evergreen'
  WHEN mbl_number LIKE 'YMLU%' OR mbl_number LIKE 'YMJA%' THEN 'Yang Ming'
  WHEN mbl_number LIKE 'HDMU%' THEN 'HMM'
  WHEN mbl_number LIKE 'ONEY%' OR mbl_number LIKE 'ONEU%' THEN 'ONE'
  WHEN mbl_number LIKE 'CMDU%' OR mbl_number LIKE 'CMAU%' OR mbl_number LIKE 'ANNU%' THEN 'CMA CGM'
  WHEN mbl_number LIKE 'ZIMU%' OR mbl_number LIKE 'ZCSU%' THEN 'ZIM'
  WHEN mbl_number LIKE 'SUDU%' THEN 'Hamburg Sud'
  WHEN mbl_number LIKE 'SMLU%' THEN 'SM Line'
  WHEN mbl_number LIKE 'WHLC%' THEN 'Wan Hai Lines'
  WHEN mbl_number LIKE 'PILU%' THEN 'PIL'
  ELSE carrier_name
END
WHERE carrier_name IS NULL
  AND mbl_number IS NOT NULL
  AND length(mbl_number) >= 4
  AND mbl_number ~ '^[A-Z]{4}';
