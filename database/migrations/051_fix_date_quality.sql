-- Migration 051: Fix Date Quality Issues
-- Implements data cleanup for date extraction errors identified in quality report:
--   1. Remove LFD from wrong document types (booking_confirmation, sea_waybill, etc.)
--   2. Remove dates with year < 2024 (likely 2023 → should be 2025)
--   3. Remove LFD that is before ETA (impossible)
--   4. Remove LFD that is before ETD (impossible)

-- ============================================================================
-- 1. NULL out last_free_day from wrong document types
-- These documents are pre-departure and should NEVER have LFD
-- ============================================================================

UPDATE chronicle
SET last_free_day = NULL
WHERE last_free_day IS NOT NULL
AND document_type IN (
  'booking_confirmation',
  'booking_amendment',
  'booking_request',
  'sea_waybill',
  'draft_bl',
  'final_bl',
  'house_bl',
  'shipping_instructions',
  'si_confirmation',
  'vgm_confirmation',
  'invoice',
  'quotation',
  'rate_request',
  'schedule_update',
  'notification',
  'general_correspondence'
);

-- ============================================================================
-- 2. NULL out dates with year < 2024 (these are extraction errors)
-- AI misread 2023 when it should have been 2025
-- ============================================================================

-- Fix ETD with year < 2024
UPDATE chronicle
SET etd = NULL
WHERE etd IS NOT NULL
AND EXTRACT(YEAR FROM etd) < 2024;

-- Fix ETA with year < 2024
UPDATE chronicle
SET eta = NULL
WHERE eta IS NOT NULL
AND EXTRACT(YEAR FROM eta) < 2024;

-- Fix last_free_day with year < 2024
UPDATE chronicle
SET last_free_day = NULL
WHERE last_free_day IS NOT NULL
AND EXTRACT(YEAR FROM last_free_day) < 2024;

-- Fix cutoff dates with year < 2024
UPDATE chronicle
SET si_cutoff = NULL
WHERE si_cutoff IS NOT NULL
AND EXTRACT(YEAR FROM si_cutoff) < 2024;

UPDATE chronicle
SET vgm_cutoff = NULL
WHERE vgm_cutoff IS NOT NULL
AND EXTRACT(YEAR FROM vgm_cutoff) < 2024;

UPDATE chronicle
SET cargo_cutoff = NULL
WHERE cargo_cutoff IS NOT NULL
AND EXTRACT(YEAR FROM cargo_cutoff) < 2024;

UPDATE chronicle
SET doc_cutoff = NULL
WHERE doc_cutoff IS NOT NULL
AND EXTRACT(YEAR FROM doc_cutoff) < 2024;

-- ============================================================================
-- 3. NULL out LFD that is before ETA (contextual validation)
-- This requires joining with shipments to get the authoritative ETA
-- ============================================================================

-- First, clean chronicle LFD that is before the shipment's ETA
UPDATE chronicle c
SET last_free_day = NULL
FROM shipments s
WHERE c.shipment_id = s.id
AND c.last_free_day IS NOT NULL
AND s.eta IS NOT NULL
AND c.last_free_day < s.eta;

-- ============================================================================
-- 4. Recreate the v_shipment_cutoff_dates view with cleaner logic
-- ============================================================================

CREATE OR REPLACE VIEW v_shipment_cutoff_dates AS
SELECT
  shipment_id,
  -- Get most recent non-null cutoff dates from VALID document types only
  MAX(CASE WHEN document_type IN ('booking_confirmation', 'booking_amendment', 'schedule_update')
      THEN si_cutoff END) AS si_cutoff,
  MAX(CASE WHEN document_type IN ('booking_confirmation', 'booking_amendment', 'schedule_update')
      THEN vgm_cutoff END) AS vgm_cutoff,
  MAX(CASE WHEN document_type IN ('booking_confirmation', 'booking_amendment', 'schedule_update')
      THEN doc_cutoff END) AS doc_cutoff,
  MAX(CASE WHEN document_type IN ('booking_confirmation', 'booking_amendment', 'schedule_update')
      THEN cargo_cutoff END) AS cargo_cutoff,
  -- Get ETD/ETA from chronicle (fallback if not in shipments)
  MAX(etd) AS chronicle_etd,
  MAX(eta) AS chronicle_eta,
  -- Get actual dates
  MAX(atd) AS actual_departure,
  MAX(ata) AS actual_arrival,
  -- Get delivery dates from ARRIVAL documents only
  MAX(CASE WHEN document_type IN ('arrival_notice', 'delivery_order', 'container_release', 'customs_entry', 'work_order', 'pod_proof_of_delivery')
      THEN delivery_date END) AS delivery_date,
  MAX(CASE WHEN document_type IN ('arrival_notice', 'delivery_order', 'container_release', 'customs_entry', 'work_order')
      THEN last_free_day END) AS last_free_day,
  MAX(pod_delivery_date) AS pod_delivery_date,
  -- Track sources
  MAX(CASE WHEN etd IS NOT NULL THEN document_type END) AS etd_source,
  MAX(CASE WHEN eta IS NOT NULL THEN document_type END) AS eta_source
FROM chronicle
WHERE shipment_id IS NOT NULL
GROUP BY shipment_id;

-- ============================================================================
-- 5. Add comments for documentation
-- ============================================================================

COMMENT ON VIEW v_shipment_cutoff_dates IS
'Aggregates cutoff and delivery dates from chronicle per shipment.
Field-specific rules enforced:
- Cutoff dates (SI, VGM, Doc, Cargo): Only from booking_confirmation, booking_amendment, schedule_update
- Last Free Day: Only from arrival_notice, delivery_order, container_release, customs_entry, work_order
This prevents extraction errors where dates are taken from wrong document types.';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
