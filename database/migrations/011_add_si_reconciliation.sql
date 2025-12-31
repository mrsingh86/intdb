-- ============================================================================
-- MIGRATION 011: ADD SI RECONCILIATION RECORDS
-- ============================================================================
-- Purpose: Track reconciliation between SI Draft and other documents
-- SI Draft is the MASTER SOURCE for all cargo/party reconciliation
-- ============================================================================

-- SI Reconciliation Records Table
CREATE TABLE IF NOT EXISTS si_reconciliation_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  -- Source Documents
  si_draft_email_id UUID REFERENCES raw_emails(id),
  comparison_document_type VARCHAR(100) NOT NULL,  -- 'checklist', 'house_bl'
  comparison_email_id UUID REFERENCES raw_emails(id),

  -- Reconciliation Status
  reconciliation_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  -- Values: pending, in_progress, matches, discrepancies_found, resolved, blocked

  -- Field-by-Field Comparison Results
  field_comparisons JSONB NOT NULL DEFAULT '{}',
  -- Structure: {
  --   "shipper_name": {"si_value": "...", "comp_value": "...", "matches": true/false, "severity": "critical"},
  --   "consignee_name": {...},
  --   ...
  -- }

  -- Summary
  total_fields_compared INTEGER DEFAULT 0,
  matching_fields INTEGER DEFAULT 0,
  discrepancy_count INTEGER DEFAULT 0,
  critical_discrepancies INTEGER DEFAULT 0,

  -- Resolution
  can_submit_si BOOLEAN DEFAULT false,
  block_reason TEXT,
  resolved_by UUID,
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolution_notes TEXT,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_si_recon_shipment ON si_reconciliation_records(shipment_id);
CREATE INDEX IF NOT EXISTS idx_si_recon_status ON si_reconciliation_records(reconciliation_status);
CREATE INDEX IF NOT EXISTS idx_si_recon_si_email ON si_reconciliation_records(si_draft_email_id);
CREATE INDEX IF NOT EXISTS idx_si_recon_comp_type ON si_reconciliation_records(comparison_document_type);
CREATE INDEX IF NOT EXISTS idx_si_recon_can_submit ON si_reconciliation_records(can_submit_si);

-- Comments
COMMENT ON TABLE si_reconciliation_records IS 'Tracks reconciliation between SI Draft (master) and other documents';
COMMENT ON COLUMN si_reconciliation_records.si_draft_email_id IS 'Email containing the SI Draft (MASTER SOURCE)';
COMMENT ON COLUMN si_reconciliation_records.comparison_document_type IS 'Type of document being compared: checklist or house_bl';
COMMENT ON COLUMN si_reconciliation_records.field_comparisons IS 'Field-by-field comparison with values, match status, and severity';
COMMENT ON COLUMN si_reconciliation_records.can_submit_si IS 'Whether SI can be submitted (false if critical discrepancies)';

-- ============================================================================
-- SI Reconciliation Fields Definition Table
-- ============================================================================
-- Defines which fields to compare and their criticality
CREATE TABLE IF NOT EXISTS si_reconciliation_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  field_name VARCHAR(100) NOT NULL,
  field_label VARCHAR(200) NOT NULL,
  comparison_type VARCHAR(50) NOT NULL DEFAULT 'exact',
  -- Values: exact, contains, numeric, date, fuzzy
  severity VARCHAR(20) NOT NULL DEFAULT 'critical',
  -- Values: critical, warning, info
  applies_to_checklist BOOLEAN DEFAULT true,
  applies_to_hbl BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  field_order INTEGER DEFAULT 0,
  description TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS idx_si_recon_field_name ON si_reconciliation_fields(field_name);

-- Comments
COMMENT ON TABLE si_reconciliation_fields IS 'Defines fields to compare during SI reconciliation';
COMMENT ON COLUMN si_reconciliation_fields.comparison_type IS 'How to compare: exact, contains, numeric, date, fuzzy';
COMMENT ON COLUMN si_reconciliation_fields.severity IS 'Severity level: critical (blocks), warning, info';

-- ============================================================================
-- SEED DATA: Reconciliation Fields
-- ============================================================================

INSERT INTO si_reconciliation_fields (field_name, field_label, comparison_type, severity, applies_to_checklist, applies_to_hbl, field_order, description) VALUES

-- Party Information (CRITICAL - must match exactly)
('shipper_name', 'Shipper Name', 'fuzzy', 'critical', true, true, 10,
 'Full legal name of the shipper - must match for customs clearance'),

('shipper_address', 'Shipper Address', 'fuzzy', 'critical', true, true, 20,
 'Complete shipper address including city, country'),

('consignee_name', 'Consignee Name', 'fuzzy', 'critical', true, true, 30,
 'Full legal name of the consignee'),

('consignee_address', 'Consignee Address', 'fuzzy', 'critical', true, true, 40,
 'Complete consignee address'),

('notify_party_name', 'Notify Party Name', 'fuzzy', 'critical', true, true, 50,
 'Notify party name (usually same as consignee)'),

('notify_party_address', 'Notify Party Address', 'fuzzy', 'critical', true, true, 60,
 'Notify party complete address'),

-- Cargo Information (CRITICAL)
('cargo_description', 'Cargo Description', 'fuzzy', 'critical', true, true, 70,
 'Description of goods being shipped'),

('hs_code', 'HS Code', 'exact', 'critical', true, true, 80,
 'Harmonized System code for customs classification'),

('marks_numbers', 'Marks & Numbers', 'fuzzy', 'critical', true, true, 90,
 'Shipping marks and reference numbers on cargo'),

-- Container & Weight (CRITICAL)
('container_numbers', 'Container Numbers', 'exact', 'critical', true, true, 100,
 'Container numbers must match exactly'),

('seal_numbers', 'Seal Numbers', 'exact', 'critical', true, true, 110,
 'Seal numbers for security verification'),

('total_weight', 'Total Weight', 'numeric', 'critical', true, true, 120,
 'Gross weight in specified unit'),

('weight_unit', 'Weight Unit', 'exact', 'critical', true, true, 130,
 'Weight unit (KG/MT/LBS)'),

('total_packages', 'Total Packages', 'numeric', 'critical', true, true, 140,
 'Total number of packages'),

('package_type', 'Package Type', 'fuzzy', 'critical', true, true, 150,
 'Type of packaging (CTNS, PLTS, etc.)'),

-- Volume & Dimensions (WARNING - less critical)
('total_volume', 'Total Volume', 'numeric', 'warning', true, true, 160,
 'Total volume in CBM'),

('dimensions', 'Dimensions', 'fuzzy', 'warning', true, false, 170,
 'Cargo dimensions')

ON CONFLICT (field_name) DO UPDATE SET
  field_label = EXCLUDED.field_label,
  comparison_type = EXCLUDED.comparison_type,
  severity = EXCLUDED.severity,
  applies_to_checklist = EXCLUDED.applies_to_checklist,
  applies_to_hbl = EXCLUDED.applies_to_hbl,
  description = EXCLUDED.description;

-- ============================================================================
-- Add SI reconciliation status to shipments
-- ============================================================================
ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS si_reconciliation_status VARCHAR(50);

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS si_can_submit BOOLEAN DEFAULT false;

ALTER TABLE shipments
ADD COLUMN IF NOT EXISTS si_block_reason TEXT;

COMMENT ON COLUMN shipments.si_reconciliation_status IS 'Current SI reconciliation status';
COMMENT ON COLUMN shipments.si_can_submit IS 'Whether SI is ready for submission';
COMMENT ON COLUMN shipments.si_block_reason IS 'Reason SI submission is blocked';

-- ============================================================================
-- END MIGRATION 011
-- ============================================================================
