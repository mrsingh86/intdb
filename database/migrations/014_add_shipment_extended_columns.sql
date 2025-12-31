-- ============================================================================
-- MIGRATION 014: ADD EXTENDED SHIPMENT COLUMNS
-- ============================================================================
-- Purpose: Add additional columns needed for document hierarchy system
-- These columns complement the workflow/reconciliation/milestone columns
-- ============================================================================

-- ============================================================================
-- Route & Location Details
-- ============================================================================

-- Terminal at POL
ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS terminal VARCHAR(200);
COMMENT ON COLUMN shipments.terminal IS 'Container terminal at port of loading';

-- Final Place of Delivery (inland destination)
ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS final_destination VARCHAR(200);
COMMENT ON COLUMN shipments.final_destination IS 'Final place of delivery (may differ from POD)';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS final_destination_code VARCHAR(10);
COMMENT ON COLUMN shipments.final_destination_code IS 'UN/LOCODE for final destination';

-- ============================================================================
-- Vessel & Voyage Details
-- ============================================================================

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS vessel_name VARCHAR(200);
COMMENT ON COLUMN shipments.vessel_name IS 'Mother vessel name';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS voyage_number VARCHAR(50);
COMMENT ON COLUMN shipments.voyage_number IS 'Voyage number';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS feeder_vessel VARCHAR(200);
COMMENT ON COLUMN shipments.feeder_vessel IS 'Feeder vessel name (if applicable)';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS feeder_voyage VARCHAR(50);
COMMENT ON COLUMN shipments.feeder_voyage IS 'Feeder voyage number';

-- ============================================================================
-- Customs & Arrival Details
-- ============================================================================

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS it_number VARCHAR(100);
COMMENT ON COLUMN shipments.it_number IS 'In-Transit/Immediate Transportation number (US Customs)';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS entry_number VARCHAR(100);
COMMENT ON COLUMN shipments.entry_number IS 'Customs entry number';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS entry_date DATE;
COMMENT ON COLUMN shipments.entry_date IS 'Customs entry date';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS discharge_terminal VARCHAR(200);
COMMENT ON COLUMN shipments.discharge_terminal IS 'Discharge terminal at POD';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS free_time_expires TIMESTAMP WITH TIME ZONE;
COMMENT ON COLUMN shipments.free_time_expires IS 'When free time expires (demurrage starts)';

-- ============================================================================
-- Cutoff Deadlines
-- ============================================================================

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS si_cutoff TIMESTAMP WITH TIME ZONE;
COMMENT ON COLUMN shipments.si_cutoff IS 'Shipping Instructions cutoff deadline';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS vgm_cutoff TIMESTAMP WITH TIME ZONE;
COMMENT ON COLUMN shipments.vgm_cutoff IS 'VGM submission cutoff deadline';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS cargo_cutoff TIMESTAMP WITH TIME ZONE;
COMMENT ON COLUMN shipments.cargo_cutoff IS 'Cargo/Gate cutoff deadline';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS doc_cutoff TIMESTAMP WITH TIME ZONE;
COMMENT ON COLUMN shipments.doc_cutoff IS 'Documentation cutoff deadline';

-- ============================================================================
-- Financial Details
-- ============================================================================

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS duty_amount DECIMAL(15,2);
COMMENT ON COLUMN shipments.duty_amount IS 'Customs duty amount';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS duty_currency VARCHAR(3);
COMMENT ON COLUMN shipments.duty_currency IS 'Duty currency code (USD, EUR, etc.)';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS freight_terms VARCHAR(20);
COMMENT ON COLUMN shipments.freight_terms IS 'Freight terms: PREPAID or COLLECT';

-- ============================================================================
-- Cargo Details
-- ============================================================================

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS hs_code_shipper VARCHAR(20);
COMMENT ON COLUMN shipments.hs_code_shipper IS 'HS code provided by shipper';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS hs_code_customs VARCHAR(20);
COMMENT ON COLUMN shipments.hs_code_customs IS 'HS code confirmed by customs';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS cargo_description TEXT;
COMMENT ON COLUMN shipments.cargo_description IS 'Description of goods';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS total_packages INTEGER;
COMMENT ON COLUMN shipments.total_packages IS 'Total number of packages';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS package_type VARCHAR(50);
COMMENT ON COLUMN shipments.package_type IS 'Package type (CTNS, PLTS, etc.)';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS gross_weight DECIMAL(15,3);
COMMENT ON COLUMN shipments.gross_weight IS 'Gross weight';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS weight_unit VARCHAR(10);
COMMENT ON COLUMN shipments.weight_unit IS 'Weight unit (KG, MT, LBS)';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS total_volume DECIMAL(15,3);
COMMENT ON COLUMN shipments.total_volume IS 'Total volume in CBM';

-- ============================================================================
-- Party Details (from SI Draft - Master Source)
-- ============================================================================

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS shipper_name VARCHAR(500);
COMMENT ON COLUMN shipments.shipper_name IS 'Shipper/exporter name';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS shipper_address TEXT;
COMMENT ON COLUMN shipments.shipper_address IS 'Shipper complete address';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS consignee_name VARCHAR(500);
COMMENT ON COLUMN shipments.consignee_name IS 'Consignee/buyer name';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS consignee_address TEXT;
COMMENT ON COLUMN shipments.consignee_address IS 'Consignee complete address';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS notify_party_name VARCHAR(500);
COMMENT ON COLUMN shipments.notify_party_name IS 'Notify party name';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS notify_party_address TEXT;
COMMENT ON COLUMN shipments.notify_party_address IS 'Notify party address';

-- ============================================================================
-- Document Reference Numbers
-- ============================================================================

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS hbl_number VARCHAR(100);
COMMENT ON COLUMN shipments.hbl_number IS 'House Bill of Lading number';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS mbl_number VARCHAR(100);
COMMENT ON COLUMN shipments.mbl_number IS 'Master Bill of Lading number';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS invoice_number VARCHAR(100);
COMMENT ON COLUMN shipments.invoice_number IS 'Commercial invoice number';

-- ============================================================================
-- Container & Seal Numbers (stored as arrays)
-- ============================================================================

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS container_numbers TEXT[];
COMMENT ON COLUMN shipments.container_numbers IS 'Array of container numbers';

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS seal_numbers TEXT[];
COMMENT ON COLUMN shipments.seal_numbers IS 'Array of seal numbers';

-- ============================================================================
-- Indexes for New Columns
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_shipments_terminal ON shipments(terminal);
CREATE INDEX IF NOT EXISTS idx_shipments_vessel ON shipments(vessel_name);
CREATE INDEX IF NOT EXISTS idx_shipments_it_number ON shipments(it_number);
CREATE INDEX IF NOT EXISTS idx_shipments_entry_number ON shipments(entry_number);
CREATE INDEX IF NOT EXISTS idx_shipments_si_cutoff ON shipments(si_cutoff);
CREATE INDEX IF NOT EXISTS idx_shipments_vgm_cutoff ON shipments(vgm_cutoff);
CREATE INDEX IF NOT EXISTS idx_shipments_cargo_cutoff ON shipments(cargo_cutoff);
CREATE INDEX IF NOT EXISTS idx_shipments_free_time ON shipments(free_time_expires);
CREATE INDEX IF NOT EXISTS idx_shipments_hbl ON shipments(hbl_number);
CREATE INDEX IF NOT EXISTS idx_shipments_shipper ON shipments(shipper_name);
CREATE INDEX IF NOT EXISTS idx_shipments_consignee ON shipments(consignee_name);

-- ============================================================================
-- END MIGRATION 014
-- ============================================================================
