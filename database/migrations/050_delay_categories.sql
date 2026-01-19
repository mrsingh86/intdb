-- Migration 050: Categorized Delay Calculation
-- Implements stage-aware delay categories:
--   - PRE_DEPARTURE: SI, VGM, Doc, Cargo cutoff delays
--   - DEPARTURE: ETD-based delays
--   - ARRIVAL: ETA-based delays
--   - DELIVERY: Last free day / delivery delays

-- ============================================================================
-- 1. VIEW: Aggregate cutoff dates from chronicle per shipment
-- ============================================================================

CREATE OR REPLACE VIEW v_shipment_cutoff_dates AS
SELECT
  shipment_id,
  -- Get most recent non-null cutoff dates
  MAX(si_cutoff) AS si_cutoff,
  MAX(vgm_cutoff) AS vgm_cutoff,
  MAX(doc_cutoff) AS doc_cutoff,
  MAX(cargo_cutoff) AS cargo_cutoff,
  -- Get ETD/ETA from chronicle (fallback if not in shipments)
  MAX(etd) AS chronicle_etd,
  MAX(eta) AS chronicle_eta,
  -- Get actual dates
  MAX(atd) AS actual_departure,
  MAX(ata) AS actual_arrival,
  -- Get delivery dates
  MAX(delivery_date) AS delivery_date,
  MAX(last_free_day) AS last_free_day,
  MAX(pod_delivery_date) AS pod_delivery_date,
  -- Track sources
  MAX(CASE WHEN etd IS NOT NULL THEN document_type END) AS etd_source,
  MAX(CASE WHEN eta IS NOT NULL THEN document_type END) AS eta_source
FROM chronicle
WHERE shipment_id IS NOT NULL
GROUP BY shipment_id;

-- ============================================================================
-- 2. VIEW: Main delay breakdown with categories
-- ============================================================================

CREATE OR REPLACE VIEW v_shipment_delay_breakdown AS
WITH shipment_dates AS (
  SELECT
    s.id AS shipment_id,
    s.stage,
    s.intoglo_reference,
    -- ETD: prefer shipments table, fallback to chronicle
    COALESCE(s.etd, c.chronicle_etd) AS etd,
    CASE WHEN s.etd IS NOT NULL THEN 'shipments' ELSE c.etd_source END AS etd_source,
    -- ETA: prefer shipments table, fallback to chronicle
    COALESCE(s.eta, c.chronicle_eta) AS eta,
    CASE WHEN s.eta IS NOT NULL THEN 'shipments' ELSE c.eta_source END AS eta_source,
    -- Cutoff dates from chronicle
    COALESCE(s.si_cutoff, c.si_cutoff) AS si_cutoff,
    COALESCE(s.vgm_cutoff, c.vgm_cutoff) AS vgm_cutoff,
    COALESCE(s.doc_cutoff, c.doc_cutoff) AS doc_cutoff,
    COALESCE(s.cargo_cutoff, c.cargo_cutoff) AS cargo_cutoff,
    -- Actual dates
    c.actual_departure,
    c.actual_arrival,
    -- Delivery tracking
    c.delivery_date,
    c.last_free_day,
    c.pod_delivery_date
  FROM shipments s
  LEFT JOIN v_shipment_cutoff_dates c ON c.shipment_id = s.id
),
delay_calculations AS (
  SELECT
    sd.*,
    -- Calculate days past each cutoff (negative = future, positive = overdue)
    CASE WHEN si_cutoff IS NOT NULL
      THEN EXTRACT(DAY FROM (NOW() - si_cutoff::timestamp))::INTEGER
    END AS si_delay_days,
    CASE WHEN vgm_cutoff IS NOT NULL
      THEN EXTRACT(DAY FROM (NOW() - vgm_cutoff::timestamp))::INTEGER
    END AS vgm_delay_days,
    CASE WHEN doc_cutoff IS NOT NULL
      THEN EXTRACT(DAY FROM (NOW() - doc_cutoff::timestamp))::INTEGER
    END AS doc_delay_days,
    CASE WHEN cargo_cutoff IS NOT NULL
      THEN EXTRACT(DAY FROM (NOW() - cargo_cutoff::timestamp))::INTEGER
    END AS cargo_delay_days,
    -- Departure delay
    CASE WHEN etd IS NOT NULL
      THEN EXTRACT(DAY FROM (NOW() - etd::timestamp))::INTEGER
    END AS departure_delay_days,
    -- Arrival delay
    CASE WHEN eta IS NOT NULL
      THEN EXTRACT(DAY FROM (NOW() - eta::timestamp))::INTEGER
    END AS arrival_delay_days,
    -- Delivery delay (from last free day or ETA)
    CASE
      WHEN last_free_day IS NOT NULL THEN
        EXTRACT(DAY FROM (NOW() - last_free_day::timestamp))::INTEGER
      WHEN eta IS NOT NULL AND sd.stage = 'ARRIVED' THEN
        EXTRACT(DAY FROM (NOW() - eta::timestamp))::INTEGER
    END AS delivery_delay_days
  FROM shipment_dates sd
)
SELECT
  dc.shipment_id,
  dc.intoglo_reference,
  dc.stage,

  -- Cutoff dates
  dc.si_cutoff,
  dc.vgm_cutoff,
  dc.doc_cutoff,
  dc.cargo_cutoff,

  -- Key dates
  dc.etd,
  dc.etd_source,
  dc.eta,
  dc.eta_source,
  dc.last_free_day,
  dc.delivery_date,

  -- Delay calculations (only positive values = actually overdue)
  GREATEST(dc.si_delay_days, 0) AS si_delay_days,
  GREATEST(dc.vgm_delay_days, 0) AS vgm_delay_days,
  GREATEST(dc.doc_delay_days, 0) AS doc_delay_days,
  GREATEST(dc.cargo_delay_days, 0) AS cargo_delay_days,
  GREATEST(dc.departure_delay_days, 0) AS departure_delay_days,
  GREATEST(dc.arrival_delay_days, 0) AS arrival_delay_days,
  GREATEST(dc.delivery_delay_days, 0) AS delivery_delay_days,

  -- Cutoff status flags
  CASE WHEN dc.si_delay_days > 0 THEN 'OVERDUE'
       WHEN dc.si_delay_days IS NULL THEN 'NO_DATE'
       WHEN dc.si_delay_days <= 0 AND dc.si_delay_days > -2 THEN 'DUE_SOON'
       ELSE 'OK' END AS si_status,
  CASE WHEN dc.vgm_delay_days > 0 THEN 'OVERDUE'
       WHEN dc.vgm_delay_days IS NULL THEN 'NO_DATE'
       WHEN dc.vgm_delay_days <= 0 AND dc.vgm_delay_days > -2 THEN 'DUE_SOON'
       ELSE 'OK' END AS vgm_status,
  CASE WHEN dc.doc_delay_days > 0 THEN 'OVERDUE'
       WHEN dc.doc_delay_days IS NULL THEN 'NO_DATE'
       WHEN dc.doc_delay_days <= 0 AND dc.doc_delay_days > -2 THEN 'DUE_SOON'
       ELSE 'OK' END AS doc_status,
  CASE WHEN dc.cargo_delay_days > 0 THEN 'OVERDUE'
       WHEN dc.cargo_delay_days IS NULL THEN 'NO_DATE'
       WHEN dc.cargo_delay_days <= 0 AND dc.cargo_delay_days > -2 THEN 'DUE_SOON'
       ELSE 'OK' END AS cargo_status,

  -- Determine delay category based on stage
  CASE
    WHEN dc.stage IN ('PENDING', 'BOOKED', 'REQUESTED') THEN 'PRE_DEPARTURE'
    WHEN dc.stage IN ('SI_SUBMITTED', 'SI_STAGE', 'BL_ISSUED', 'DRAFT_BL') THEN 'DEPARTURE'
    WHEN dc.stage = 'DEPARTED' THEN 'TRANSIT'
    WHEN dc.stage = 'ARRIVED' THEN 'DELIVERY'
    ELSE 'UNKNOWN'
  END AS delay_category,

  -- Primary delay for this stage
  CASE
    -- Pre-departure: worst of cutoff delays
    WHEN dc.stage IN ('PENDING', 'BOOKED', 'REQUESTED') THEN
      GREATEST(
        COALESCE(GREATEST(dc.si_delay_days, 0), 0),
        COALESCE(GREATEST(dc.vgm_delay_days, 0), 0),
        COALESCE(GREATEST(dc.doc_delay_days, 0), 0),
        COALESCE(GREATEST(dc.cargo_delay_days, 0), 0)
      )
    -- Departure stage: ETD delay
    WHEN dc.stage IN ('SI_SUBMITTED', 'SI_STAGE', 'BL_ISSUED', 'DRAFT_BL') THEN
      GREATEST(COALESCE(dc.departure_delay_days, 0), 0)
    -- Transit: ETA delay
    WHEN dc.stage = 'DEPARTED' THEN
      GREATEST(COALESCE(dc.arrival_delay_days, 0), 0)
    -- Arrived: delivery delay
    WHEN dc.stage = 'ARRIVED' THEN
      GREATEST(COALESCE(dc.delivery_delay_days, 0), 0)
    ELSE 0
  END AS primary_delay_days,

  -- Primary delay type
  CASE
    WHEN dc.stage IN ('PENDING', 'BOOKED', 'REQUESTED') THEN
      CASE
        WHEN GREATEST(dc.si_delay_days, 0) >= GREATEST(dc.vgm_delay_days, dc.doc_delay_days, dc.cargo_delay_days, 0)
             AND dc.si_delay_days > 0 THEN 'SI_DELAY'
        WHEN GREATEST(dc.vgm_delay_days, 0) >= GREATEST(dc.si_delay_days, dc.doc_delay_days, dc.cargo_delay_days, 0)
             AND dc.vgm_delay_days > 0 THEN 'VGM_DELAY'
        WHEN GREATEST(dc.cargo_delay_days, 0) >= GREATEST(dc.si_delay_days, dc.vgm_delay_days, dc.doc_delay_days, 0)
             AND dc.cargo_delay_days > 0 THEN 'CARGO_DELAY'
        WHEN dc.doc_delay_days > 0 THEN 'DOC_DELAY'
        ELSE 'NO_DELAY'
      END
    WHEN dc.stage IN ('SI_SUBMITTED', 'SI_STAGE', 'BL_ISSUED', 'DRAFT_BL') THEN
      CASE WHEN dc.departure_delay_days > 0 THEN 'DEPARTURE_DELAY' ELSE 'NO_DELAY' END
    WHEN dc.stage = 'DEPARTED' THEN
      CASE WHEN dc.arrival_delay_days > 0 THEN 'ARRIVAL_DELAY' ELSE 'NO_DELAY' END
    WHEN dc.stage = 'ARRIVED' THEN
      CASE WHEN dc.delivery_delay_days > 0 THEN 'DELIVERY_DELAY' ELSE 'NO_DELAY' END
    ELSE 'UNKNOWN'
  END AS primary_delay_type,

  -- Human readable delay summary
  CASE
    WHEN dc.stage IN ('PENDING', 'BOOKED', 'REQUESTED') THEN
      CASE
        WHEN GREATEST(COALESCE(dc.si_delay_days,0), COALESCE(dc.vgm_delay_days,0),
                      COALESCE(dc.doc_delay_days,0), COALESCE(dc.cargo_delay_days,0)) <= 0
        THEN 'On track for cutoffs'
        ELSE CONCAT(
          GREATEST(COALESCE(dc.si_delay_days,0), COALESCE(dc.vgm_delay_days,0),
                   COALESCE(dc.doc_delay_days,0), COALESCE(dc.cargo_delay_days,0)),
          ' days past cutoff'
        )
      END
    WHEN dc.stage IN ('SI_SUBMITTED', 'SI_STAGE', 'BL_ISSUED', 'DRAFT_BL') THEN
      CASE
        WHEN dc.departure_delay_days IS NULL THEN 'No ETD set'
        WHEN dc.departure_delay_days <= 0 THEN 'On track for departure'
        ELSE CONCAT(dc.departure_delay_days, ' days past ETD')
      END
    WHEN dc.stage = 'DEPARTED' THEN
      CASE
        WHEN dc.arrival_delay_days IS NULL THEN 'No ETA set'
        WHEN dc.arrival_delay_days <= 0 THEN 'On track for arrival'
        ELSE CONCAT(dc.arrival_delay_days, ' days past ETA')
      END
    WHEN dc.stage = 'ARRIVED' THEN
      CASE
        WHEN dc.delivery_delay_days IS NULL THEN 'Awaiting delivery'
        WHEN dc.delivery_delay_days <= 0 THEN 'Within free time'
        ELSE CONCAT(dc.delivery_delay_days, ' days past free time')
      END
    ELSE 'Status unknown'
  END AS delay_summary

FROM delay_calculations dc;

-- ============================================================================
-- 3. INDEX for performance
-- ============================================================================

-- Index on shipment_id for v_shipment_cutoff_dates base query
CREATE INDEX IF NOT EXISTS idx_chronicle_shipment_cutoffs
ON chronicle(shipment_id)
WHERE shipment_id IS NOT NULL
  AND (si_cutoff IS NOT NULL OR vgm_cutoff IS NOT NULL OR etd IS NOT NULL OR eta IS NOT NULL);

-- ============================================================================
-- 4. COMMENTS
-- ============================================================================

COMMENT ON VIEW v_shipment_cutoff_dates IS 'Aggregates cutoff dates and key dates from chronicle per shipment';

COMMENT ON VIEW v_shipment_delay_breakdown IS 'Categorized delay calculations based on shipment stage.
Categories:
- PRE_DEPARTURE: SI, VGM, Doc, Cargo cutoff delays (stages: PENDING, BOOKED)
- DEPARTURE: ETD-based delays (stages: SI_SUBMITTED, BL_ISSUED)
- TRANSIT: ETA-based delays (stage: DEPARTED)
- DELIVERY: Last free day / delivery delays (stage: ARRIVED)';

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
