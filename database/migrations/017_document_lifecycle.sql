-- ============================================================================
-- MIGRATION 017: DOCUMENT LIFECYCLE MANAGEMENT
-- ============================================================================
-- Purpose: Track document lifecycle states, enable document comparisons,
--          and manage missing document alerts
-- Author: AI Intelligence System
-- Date: 2025-12-26
-- Dependencies: Migration 004, 015 (shipments, document_revisions)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ENUM: Document lifecycle states
-- ----------------------------------------------------------------------------
-- Lifecycle: DRAFT -> REVIEW -> APPROVED -> SENT -> ACKNOWLEDGED -> SUPERSEDED

-- ----------------------------------------------------------------------------
-- TABLE: document_lifecycle
-- Track the lifecycle state of each document type per shipment
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_lifecycle (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  document_type VARCHAR(100) NOT NULL,
  -- Types: 'booking_confirmation', 'si_draft', 'si_final', 'hbl', 'mbl',
  --        'arrival_notice', 'delivery_order', 'invoice', 'packing_list'

  -- Lifecycle state
  lifecycle_status VARCHAR(50) NOT NULL DEFAULT 'draft'
    CHECK (lifecycle_status IN (
      'draft',        -- Initial version received
      'review',       -- Under review by team
      'approved',     -- Approved and ready to use
      'sent',         -- Sent to counterparty
      'acknowledged', -- Counterparty confirmed receipt
      'superseded'    -- Replaced by newer version
    )),

  -- Status history for audit trail
  status_history JSONB DEFAULT '[]',
  -- Structure: [{"status": "draft", "changed_at": "...", "changed_by": "..."}]

  -- Quality assessment
  quality_score DECIMAL(5,2),  -- 0-100
  missing_fields TEXT[],       -- Fields that are missing or incomplete
  validation_errors TEXT[],    -- Validation issues found

  -- Timeline
  due_date DATE,               -- When this document is due
  received_at TIMESTAMP WITH TIME ZONE,
  approved_at TIMESTAMP WITH TIME ZONE,
  sent_at TIMESTAMP WITH TIME ZONE,

  -- Current revision link
  current_revision_id UUID REFERENCES document_revisions(id),
  revision_count INTEGER DEFAULT 1,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- One lifecycle record per document type per shipment
  UNIQUE(shipment_id, document_type)
);

CREATE INDEX IF NOT EXISTS idx_doc_lifecycle_shipment ON document_lifecycle(shipment_id);
CREATE INDEX IF NOT EXISTS idx_doc_lifecycle_status ON document_lifecycle(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_doc_lifecycle_due ON document_lifecycle(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doc_lifecycle_type ON document_lifecycle(document_type);

COMMENT ON TABLE document_lifecycle IS 'Tracks lifecycle state of each document type per shipment';
COMMENT ON COLUMN document_lifecycle.status_history IS 'Complete history of status changes';
COMMENT ON COLUMN document_lifecycle.quality_score IS 'Document completeness/quality score 0-100';

-- ----------------------------------------------------------------------------
-- TABLE: document_comparison_fields
-- Configuration for which fields to compare between document types
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_comparison_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Comparison pair
  source_document_type VARCHAR(100) NOT NULL,  -- e.g., 'si_draft'
  target_document_type VARCHAR(100) NOT NULL,  -- e.g., 'checklist', 'hbl'

  -- Field configuration
  field_name VARCHAR(100) NOT NULL,
  field_display_name VARCHAR(200),

  -- Comparison settings
  comparison_type VARCHAR(50) NOT NULL DEFAULT 'exact'
    CHECK (comparison_type IN (
      'exact',           -- Must match exactly
      'fuzzy',           -- Allow minor differences
      'numeric',         -- Compare as numbers
      'date',            -- Compare as dates
      'contains',        -- Target contains source
      'case_insensitive' -- Case-insensitive match
    )),

  -- Severity when mismatch found
  severity VARCHAR(20) NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('critical', 'warning', 'info')),

  -- Active flag
  is_active BOOLEAN DEFAULT true,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Unique per field per comparison pair
  UNIQUE(source_document_type, target_document_type, field_name)
);

CREATE INDEX IF NOT EXISTS idx_comparison_fields_pair ON document_comparison_fields(source_document_type, target_document_type);

COMMENT ON TABLE document_comparison_fields IS 'Configuration for document comparison rules';
COMMENT ON COLUMN document_comparison_fields.severity IS 'How critical a mismatch is: critical, warning, info';

-- ----------------------------------------------------------------------------
-- TABLE: document_comparisons
-- Results of comparing documents (e.g., SI vs Checklist, SI vs HBL)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_comparisons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  -- Document pair being compared
  source_document_type VARCHAR(100) NOT NULL,  -- e.g., 'si_draft'
  target_document_type VARCHAR(100) NOT NULL,  -- e.g., 'checklist'

  -- Source references
  source_revision_id UUID REFERENCES document_revisions(id),
  target_revision_id UUID REFERENCES document_revisions(id),

  -- Comparison result
  comparison_status VARCHAR(50) NOT NULL
    CHECK (comparison_status IN (
      'matches',              -- All fields match
      'discrepancies_found',  -- Some fields don't match
      'pending',              -- Waiting for target document
      'not_applicable'        -- Comparison not needed
    )),

  -- Field-level comparison results
  field_comparisons JSONB DEFAULT '{}',
  -- Structure: {
  --   "shipper_name": {"source": "ABC Corp", "target": "ABC Corporation", "matches": false, "severity": "warning"},
  --   "etd": {"source": "2025-01-15", "target": "2025-01-15", "matches": true, "severity": "critical"}
  -- }

  -- Summary counts
  total_fields_compared INTEGER DEFAULT 0,
  matching_fields INTEGER DEFAULT 0,
  discrepancy_count INTEGER DEFAULT 0,
  critical_discrepancies INTEGER DEFAULT 0,

  -- Resolution tracking
  is_resolved BOOLEAN DEFAULT false,
  resolved_by UUID,
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolution_notes TEXT,

  -- Metadata
  compared_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comparisons_shipment ON document_comparisons(shipment_id);
CREATE INDEX IF NOT EXISTS idx_comparisons_status ON document_comparisons(comparison_status);
CREATE INDEX IF NOT EXISTS idx_comparisons_unresolved ON document_comparisons(shipment_id)
  WHERE is_resolved = false AND comparison_status = 'discrepancies_found';
CREATE INDEX IF NOT EXISTS idx_comparisons_critical ON document_comparisons(critical_discrepancies DESC)
  WHERE critical_discrepancies > 0;

COMMENT ON TABLE document_comparisons IS 'Results of comparing documents for discrepancies';
COMMENT ON COLUMN document_comparisons.field_comparisons IS 'Field-by-field comparison results';

-- ----------------------------------------------------------------------------
-- TABLE: missing_document_alerts
-- Track missing documents and generate reminders
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS missing_document_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  -- Document details
  document_type VARCHAR(100) NOT NULL,
  document_description VARCHAR(500),

  -- Timeline
  expected_by DATE NOT NULL,
  -- days_overdue calculated at query time: CURRENT_DATE - expected_by

  -- Alert status
  alert_status VARCHAR(50) NOT NULL DEFAULT 'pending'
    CHECK (alert_status IN (
      'pending',    -- Not yet due
      'due_soon',   -- Due within threshold
      'overdue',    -- Past due date
      'reminded',   -- Reminder sent
      'resolved',   -- Document received
      'waived'      -- Not required after all
    )),

  -- Reminder tracking
  reminder_count INTEGER DEFAULT 0,
  last_reminder_at TIMESTAMP WITH TIME ZONE,
  next_reminder_at TIMESTAMP WITH TIME ZONE,

  -- Resolution
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by UUID,
  resolution_notes TEXT,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- One alert per document type per shipment
  UNIQUE(shipment_id, document_type)
);

CREATE INDEX IF NOT EXISTS idx_missing_docs_shipment ON missing_document_alerts(shipment_id);
CREATE INDEX IF NOT EXISTS idx_missing_docs_status ON missing_document_alerts(alert_status);
CREATE INDEX IF NOT EXISTS idx_missing_docs_due ON missing_document_alerts(expected_by)
  WHERE alert_status NOT IN ('resolved', 'waived');
CREATE INDEX IF NOT EXISTS idx_missing_docs_overdue ON missing_document_alerts(expected_by)
  WHERE alert_status = 'overdue';

COMMENT ON TABLE missing_document_alerts IS 'Track and alert on missing documents';

-- ----------------------------------------------------------------------------
-- TABLE: document_type_requirements
-- Configuration for which documents are required at each workflow stage
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_type_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Document type
  document_type VARCHAR(100) NOT NULL UNIQUE,
  document_description VARCHAR(500),

  -- When required
  required_at_stage VARCHAR(100),  -- workflow_state when this becomes required
  due_days_offset INTEGER,          -- Days before/after ETD when due (negative = before)

  -- Source expectations
  expected_from VARCHAR(100),       -- 'shipper', 'consignee', 'carrier', 'agent'
  expected_sender_patterns TEXT[],  -- Email patterns to detect

  -- Importance
  is_critical BOOLEAN DEFAULT false,
  blocking_downstream TEXT[],       -- Document types this blocks: ['hbl', 'mbl']

  -- Active flag
  is_active BOOLEAN DEFAULT true,

  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE document_type_requirements IS 'Configuration for document requirements per shipment';
COMMENT ON COLUMN document_type_requirements.due_days_offset IS 'Days relative to ETD (negative = before ETD)';

-- ----------------------------------------------------------------------------
-- SEED DATA: Document comparison field configurations
-- ----------------------------------------------------------------------------
INSERT INTO document_comparison_fields
  (source_document_type, target_document_type, field_name, field_display_name, comparison_type, severity)
VALUES
  -- SI Draft vs Checklist comparisons
  ('si_draft', 'checklist', 'shipper_name', 'Shipper Name', 'fuzzy', 'critical'),
  ('si_draft', 'checklist', 'consignee_name', 'Consignee Name', 'fuzzy', 'critical'),
  ('si_draft', 'checklist', 'commodity_description', 'Commodity', 'fuzzy', 'warning'),
  ('si_draft', 'checklist', 'gross_weight', 'Gross Weight', 'numeric', 'critical'),
  ('si_draft', 'checklist', 'container_count', 'Container Count', 'exact', 'critical'),
  ('si_draft', 'checklist', 'port_of_loading', 'Port of Loading', 'fuzzy', 'warning'),
  ('si_draft', 'checklist', 'port_of_discharge', 'Port of Discharge', 'fuzzy', 'warning'),

  -- SI Draft vs HBL comparisons
  ('si_draft', 'hbl', 'shipper_name', 'Shipper Name', 'fuzzy', 'critical'),
  ('si_draft', 'hbl', 'consignee_name', 'Consignee Name', 'fuzzy', 'critical'),
  ('si_draft', 'hbl', 'notify_party', 'Notify Party', 'fuzzy', 'warning'),
  ('si_draft', 'hbl', 'gross_weight', 'Gross Weight', 'numeric', 'critical'),
  ('si_draft', 'hbl', 'container_numbers', 'Container Numbers', 'exact', 'critical'),
  ('si_draft', 'hbl', 'seal_numbers', 'Seal Numbers', 'exact', 'warning'),

  -- Booking vs SI comparisons
  ('booking_confirmation', 'si_draft', 'vessel_name', 'Vessel Name', 'fuzzy', 'warning'),
  ('booking_confirmation', 'si_draft', 'voyage_number', 'Voyage Number', 'exact', 'warning'),
  ('booking_confirmation', 'si_draft', 'etd', 'ETD', 'date', 'critical'),
  ('booking_confirmation', 'si_draft', 'container_type', 'Container Type', 'exact', 'warning')
ON CONFLICT (source_document_type, target_document_type, field_name) DO NOTHING;

-- ----------------------------------------------------------------------------
-- SEED DATA: Document type requirements
-- ----------------------------------------------------------------------------
INSERT INTO document_type_requirements
  (document_type, document_description, required_at_stage, due_days_offset, expected_from, is_critical)
VALUES
  ('booking_confirmation', 'Booking Confirmation from carrier', 'booking_received', 0, 'carrier', true),
  ('si_draft', 'Shipping Instructions Draft', 'booking_received', -5, 'shipper', true),
  ('vgm', 'Verified Gross Mass certificate', 'si_submitted', -3, 'shipper', true),
  ('hbl', 'House Bill of Lading', 'vessel_departed', 2, 'freight_forwarder', true),
  ('mbl', 'Master Bill of Lading', 'vessel_departed', 3, 'carrier', true),
  ('arrival_notice', 'Arrival Notice', 'vessel_arrived', 0, 'carrier', false),
  ('delivery_order', 'Delivery Order', 'vessel_arrived', 1, 'carrier', false),
  ('commercial_invoice', 'Commercial Invoice', 'booking_received', -7, 'shipper', false),
  ('packing_list', 'Packing List', 'booking_received', -7, 'shipper', false)
ON CONFLICT (document_type) DO NOTHING;

-- ----------------------------------------------------------------------------
-- FUNCTION: Update document_lifecycle timestamp
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_document_lifecycle_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_document_lifecycle_updated
  BEFORE UPDATE ON document_lifecycle
  FOR EACH ROW
  EXECUTE FUNCTION update_document_lifecycle_timestamp();

CREATE TRIGGER trigger_document_comparisons_updated
  BEFORE UPDATE ON document_comparisons
  FOR EACH ROW
  EXECUTE FUNCTION update_document_lifecycle_timestamp();

CREATE TRIGGER trigger_missing_docs_updated
  BEFORE UPDATE ON missing_document_alerts
  FOR EACH ROW
  EXECUTE FUNCTION update_document_lifecycle_timestamp();

-- ----------------------------------------------------------------------------
-- GRANT PERMISSIONS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON document_lifecycle TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON document_comparison_fields TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON document_comparisons TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON missing_document_alerts TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON document_type_requirements TO anon, authenticated, service_role;

-- ============================================================================
-- END OF MIGRATION 017
-- ============================================================================
