-- Chronicle Schema V2: 4-Point Routing & Multi-Cutoff
-- Run this in Supabase SQL Editor
-- This migration adds new columns while keeping existing data intact

-- ============================================================================
-- ADD 4-POINT ROUTING COLUMNS
-- POR (Place of Receipt) → POL (Port of Loading) → POD (Port of Discharge) → POFD (Place of Final Delivery)
-- ============================================================================

-- Place of Receipt (shipper's warehouse/factory)
ALTER TABLE chronicle ADD COLUMN IF NOT EXISTS por_location TEXT;
ALTER TABLE chronicle ADD COLUMN IF NOT EXISTS por_type TEXT
  CHECK (por_type IN ('warehouse', 'factory', 'cfs', 'icd', 'address', 'unknown'));

-- Port of Loading (ocean port or airport)
ALTER TABLE chronicle ADD COLUMN IF NOT EXISTS pol_location TEXT;
ALTER TABLE chronicle ADD COLUMN IF NOT EXISTS pol_type TEXT
  CHECK (pol_type IN ('port', 'airport', 'rail_terminal', 'unknown'));

-- Port of Discharge (ocean port or airport)
ALTER TABLE chronicle ADD COLUMN IF NOT EXISTS pod_location TEXT;
ALTER TABLE chronicle ADD COLUMN IF NOT EXISTS pod_type TEXT
  CHECK (pod_type IN ('port', 'airport', 'rail_terminal', 'unknown'));

-- Place of Final Delivery (consignee's warehouse)
ALTER TABLE chronicle ADD COLUMN IF NOT EXISTS pofd_location TEXT;
ALTER TABLE chronicle ADD COLUMN IF NOT EXISTS pofd_type TEXT
  CHECK (pofd_type IN ('warehouse', 'factory', 'cfs', 'icd', 'address', 'unknown'));

-- ============================================================================
-- ADD ACTUAL DATE COLUMNS (vs Estimated)
-- ============================================================================

ALTER TABLE chronicle ADD COLUMN IF NOT EXISTS atd DATE;  -- Actual Time of Departure
ALTER TABLE chronicle ADD COLUMN IF NOT EXISTS ata DATE;  -- Actual Time of Arrival

-- ============================================================================
-- ADD MULTI-CUTOFF COLUMNS
-- ============================================================================

ALTER TABLE chronicle ADD COLUMN IF NOT EXISTS si_cutoff DATE;    -- Shipping Instructions cutoff
ALTER TABLE chronicle ADD COLUMN IF NOT EXISTS vgm_cutoff DATE;   -- Verified Gross Mass cutoff
ALTER TABLE chronicle ADD COLUMN IF NOT EXISTS cargo_cutoff DATE; -- Cargo gate-in cutoff
ALTER TABLE chronicle ADD COLUMN IF NOT EXISTS doc_cutoff DATE;   -- Documentation cutoff

-- ============================================================================
-- ADD EMPTY RETURN DATE
-- ============================================================================

ALTER TABLE chronicle ADD COLUMN IF NOT EXISTS empty_return_date DATE;

-- ============================================================================
-- ADD INDEXES FOR NEW COLUMNS
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_chronicle_pol_location ON chronicle(pol_location);
CREATE INDEX IF NOT EXISTS idx_chronicle_pod_location ON chronicle(pod_location);
CREATE INDEX IF NOT EXISTS idx_chronicle_si_cutoff ON chronicle(si_cutoff);
CREATE INDEX IF NOT EXISTS idx_chronicle_vgm_cutoff ON chronicle(vgm_cutoff);
CREATE INDEX IF NOT EXISTS idx_chronicle_cargo_cutoff ON chronicle(cargo_cutoff);
CREATE INDEX IF NOT EXISTS idx_chronicle_last_free_day ON chronicle(last_free_day);

-- ============================================================================
-- UPDATE VIEWS TO INCLUDE NEW COLUMNS
-- ============================================================================

-- Drop and recreate timeline view with new columns
DROP VIEW IF EXISTS chronicle_timeline;
CREATE VIEW chronicle_timeline AS
SELECT
  c.id,
  c.shipment_id,
  c.occurred_at,
  c.direction,
  c.from_party,
  c.document_type,
  c.transport_mode,
  c.message_type,
  c.sentiment,
  c.summary,
  c.has_action,
  c.action_description,
  c.action_owner,
  c.action_deadline,
  c.action_completed_at,
  c.booking_number,
  c.mbl_number,
  c.hbl_number,
  c.container_numbers,
  c.vessel_name,
  -- 4-Point Routing
  c.por_location,
  c.pol_location,
  c.pod_location,
  c.pofd_location,
  -- Dates
  c.etd,
  c.atd,
  c.eta,
  c.ata,
  -- Cutoffs
  c.si_cutoff,
  c.vgm_cutoff,
  c.cargo_cutoff,
  c.doc_cutoff,
  c.last_free_day,
  c.empty_return_date
FROM chronicle c
ORDER BY c.occurred_at DESC;

-- Drop and recreate shipment health view with cutoffs
DROP VIEW IF EXISTS chronicle_shipment_health;
CREATE VIEW chronicle_shipment_health AS
SELECT
  c.shipment_id,
  COUNT(*) as total_communications,
  COUNT(*) FILTER (WHERE c.direction = 'inbound') as inbound_count,
  COUNT(*) FILTER (WHERE c.direction = 'outbound') as outbound_count,
  COUNT(*) FILTER (WHERE c.sentiment = 'negative') as negative_count,
  COUNT(*) FILTER (WHERE c.sentiment = 'urgent') as urgent_count,
  COUNT(*) FILTER (WHERE c.has_action AND c.action_completed_at IS NULL) as pending_actions,
  MAX(c.occurred_at) as last_communication,
  -- Latest dates (use MAX to get most recent values)
  MAX(c.etd) as latest_etd,
  MAX(c.eta) as latest_eta,
  MAX(c.atd) as latest_atd,
  MAX(c.ata) as latest_ata,
  -- Earliest cutoffs (use MIN to get most urgent)
  MIN(c.si_cutoff) FILTER (WHERE c.si_cutoff >= CURRENT_DATE) as next_si_cutoff,
  MIN(c.vgm_cutoff) FILTER (WHERE c.vgm_cutoff >= CURRENT_DATE) as next_vgm_cutoff,
  MIN(c.cargo_cutoff) FILTER (WHERE c.cargo_cutoff >= CURRENT_DATE) as next_cargo_cutoff,
  MIN(c.last_free_day) FILTER (WHERE c.last_free_day >= CURRENT_DATE) as next_lfd
FROM chronicle c
WHERE c.shipment_id IS NOT NULL
GROUP BY c.shipment_id;

-- ============================================================================
-- CREATE CUTOFF ALERTS VIEW
-- ============================================================================

CREATE OR REPLACE VIEW chronicle_cutoff_alerts AS
SELECT
  c.id,
  c.shipment_id,
  c.booking_number,
  c.mbl_number,
  c.pol_location,
  c.pod_location,
  c.vessel_name,
  c.etd,
  -- SI Cutoff Alert
  CASE
    WHEN c.si_cutoff < CURRENT_DATE THEN 'MISSED'
    WHEN c.si_cutoff = CURRENT_DATE THEN 'TODAY'
    WHEN c.si_cutoff <= CURRENT_DATE + INTERVAL '1 day' THEN 'TOMORROW'
    WHEN c.si_cutoff <= CURRENT_DATE + INTERVAL '3 days' THEN 'UPCOMING'
    ELSE NULL
  END as si_cutoff_status,
  c.si_cutoff,
  -- VGM Cutoff Alert
  CASE
    WHEN c.vgm_cutoff < CURRENT_DATE THEN 'MISSED'
    WHEN c.vgm_cutoff = CURRENT_DATE THEN 'TODAY'
    WHEN c.vgm_cutoff <= CURRENT_DATE + INTERVAL '1 day' THEN 'TOMORROW'
    WHEN c.vgm_cutoff <= CURRENT_DATE + INTERVAL '3 days' THEN 'UPCOMING'
    ELSE NULL
  END as vgm_cutoff_status,
  c.vgm_cutoff,
  -- Cargo Cutoff Alert
  CASE
    WHEN c.cargo_cutoff < CURRENT_DATE THEN 'MISSED'
    WHEN c.cargo_cutoff = CURRENT_DATE THEN 'TODAY'
    WHEN c.cargo_cutoff <= CURRENT_DATE + INTERVAL '1 day' THEN 'TOMORROW'
    WHEN c.cargo_cutoff <= CURRENT_DATE + INTERVAL '3 days' THEN 'UPCOMING'
    ELSE NULL
  END as cargo_cutoff_status,
  c.cargo_cutoff,
  -- LFD Alert
  CASE
    WHEN c.last_free_day < CURRENT_DATE THEN 'DEMURRAGE'
    WHEN c.last_free_day = CURRENT_DATE THEN 'TODAY'
    WHEN c.last_free_day <= CURRENT_DATE + INTERVAL '1 day' THEN 'TOMORROW'
    WHEN c.last_free_day <= CURRENT_DATE + INTERVAL '3 days' THEN 'UPCOMING'
    ELSE NULL
  END as lfd_status,
  c.last_free_day
FROM chronicle c
WHERE c.si_cutoff IS NOT NULL
   OR c.vgm_cutoff IS NOT NULL
   OR c.cargo_cutoff IS NOT NULL
   OR c.last_free_day IS NOT NULL
ORDER BY
  COALESCE(c.si_cutoff, c.vgm_cutoff, c.cargo_cutoff, c.last_free_day) ASC;

-- ============================================================================
-- ADD COMMENTS
-- ============================================================================

COMMENT ON COLUMN chronicle.por_location IS 'Place of Receipt - shipper warehouse/factory (inland origin)';
COMMENT ON COLUMN chronicle.pol_location IS 'Port of Loading - UN/LOCODE or airport code';
COMMENT ON COLUMN chronicle.pod_location IS 'Port of Discharge - UN/LOCODE or airport code';
COMMENT ON COLUMN chronicle.pofd_location IS 'Place of Final Delivery - consignee warehouse (inland destination)';
COMMENT ON COLUMN chronicle.atd IS 'Actual Time of Departure';
COMMENT ON COLUMN chronicle.ata IS 'Actual Time of Arrival';
COMMENT ON COLUMN chronicle.si_cutoff IS 'Shipping Instructions submission deadline';
COMMENT ON COLUMN chronicle.vgm_cutoff IS 'Verified Gross Mass submission deadline';
COMMENT ON COLUMN chronicle.cargo_cutoff IS 'Cargo/container gate-in deadline';
COMMENT ON COLUMN chronicle.doc_cutoff IS 'Documentation submission deadline';
COMMENT ON COLUMN chronicle.empty_return_date IS 'Empty container return deadline';

-- ============================================================================
-- VERIFICATION QUERY
-- ============================================================================

-- Run this to verify the new columns were added:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'chronicle' AND column_name LIKE '%_location' OR column_name LIKE '%_cutoff';
