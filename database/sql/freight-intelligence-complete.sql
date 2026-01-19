-- ============================================================================
-- FREIGHT FORWARDING DOCUMENT INTELLIGENCE DATABASE SCHEMA
-- ============================================================================
-- Version: 1.0.0
-- Created: 2025-12-24
-- Architecture: 4-Layer (Raw Data → Intelligence → Decision Support → Config)
-- Lifecycle: Raw data purged after shipment completion, structured data permanent
-- ============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable JSONB indexing
CREATE EXTENSION IF NOT EXISTS "btree_gin";


-- ============================================================================
-- LAYER 1: RAW DATA CAPTURE (Immutable Source of Truth)
-- ============================================================================

-- Stores complete email data from Gmail/Outlook
CREATE TABLE raw_emails (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Gmail/Email Provider IDs
  gmail_message_id VARCHAR(200) UNIQUE NOT NULL,
  thread_id VARCHAR(200),

  -- Email Metadata
  sender_email VARCHAR(500) NOT NULL,
  sender_name VARCHAR(500),
  true_sender_email VARCHAR(500),
  recipient_emails TEXT[],
  subject TEXT NOT NULL,

  -- Email Content
  body_text TEXT,
  body_html TEXT,
  snippet TEXT,

  -- Email Headers (JSONB for flexibility)
  headers JSONB,

  -- Gmail Labels/Categories
  labels TEXT[],

  -- Timestamps
  received_at TIMESTAMP NOT NULL,
  fetched_at TIMESTAMP DEFAULT NOW(),

  -- Attachments
  has_attachments BOOLEAN DEFAULT false,
  attachment_count INTEGER DEFAULT 0,

  -- Processing Status
  processing_status VARCHAR(50) DEFAULT 'pending',
  processing_error TEXT,
  processed_at TIMESTAMP,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_raw_emails_gmail_id ON raw_emails(gmail_message_id);
CREATE INDEX idx_raw_emails_thread ON raw_emails(thread_id);
CREATE INDEX idx_raw_emails_sender ON raw_emails(sender_email);
CREATE INDEX idx_raw_emails_true_sender ON raw_emails(true_sender_email);
CREATE INDEX idx_raw_emails_received ON raw_emails(received_at DESC);
CREATE INDEX idx_raw_emails_status ON raw_emails(processing_status) WHERE processing_status = 'pending';

COMMENT ON TABLE raw_emails IS 'Immutable storage of all incoming emails. Body purged after shipment completion.';


-- Stores complete attachment data
CREATE TABLE raw_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id UUID NOT NULL REFERENCES raw_emails(id) ON DELETE CASCADE,

  -- Attachment Metadata
  filename VARCHAR(500) NOT NULL,
  mime_type VARCHAR(200) NOT NULL,
  size_bytes BIGINT NOT NULL,

  -- Storage
  storage_path TEXT NOT NULL,
  attachment_id VARCHAR(200),

  -- Content Extraction
  extracted_text TEXT,
  extraction_status VARCHAR(50) DEFAULT 'pending',
  extraction_error TEXT,
  extracted_at TIMESTAMP,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_raw_attachments_email ON raw_attachments(email_id);
CREATE INDEX idx_raw_attachments_mime ON raw_attachments(mime_type);
CREATE INDEX idx_raw_attachments_status ON raw_attachments(extraction_status) WHERE extraction_status = 'pending';

COMMENT ON TABLE raw_attachments IS 'Complete attachment storage. Purged after shipment completion.';


-- Stores email metadata for advanced search
CREATE TABLE raw_email_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id UUID NOT NULL REFERENCES raw_emails(id) ON DELETE CASCADE,

  -- Threading Information
  in_reply_to VARCHAR(200),
  email_references TEXT[],

  -- Email Client Info
  user_agent VARCHAR(500),

  -- Delivery Info
  received_headers JSONB,
  spf_result VARCHAR(50),
  dkim_result VARCHAR(50),

  -- Custom Headers
  custom_headers JSONB,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_email_metadata_email ON raw_email_metadata(email_id);


-- ============================================================================
-- LAYER 2: INTELLIGENCE LAYER (AI Extractions & Linking)
-- ============================================================================

-- Stores AI classification of document type
CREATE TABLE document_classifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source Reference
  email_id UUID REFERENCES raw_emails(id) ON DELETE CASCADE,
  attachment_id UUID REFERENCES raw_attachments(id) ON DELETE CASCADE,

  -- Classification Result
  document_type VARCHAR(100) NOT NULL,
  confidence_score DECIMAL(5,2) NOT NULL,

  -- AI Model Info
  model_name VARCHAR(100) NOT NULL,
  model_version VARCHAR(50) NOT NULL,

  -- Classification Details
  classification_reason TEXT,
  matched_patterns JSONB,

  -- Human Feedback
  is_correct BOOLEAN,
  corrected_type VARCHAR(100),
  feedback_by UUID,
  feedback_at TIMESTAMP,

  -- Metadata
  classified_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),

  CHECK (confidence_score >= 0 AND confidence_score <= 100),
  CHECK (email_id IS NOT NULL OR attachment_id IS NOT NULL)
);

CREATE INDEX idx_doc_class_email ON document_classifications(email_id);
CREATE INDEX idx_doc_class_attach ON document_classifications(attachment_id);
CREATE INDEX idx_doc_class_type ON document_classifications(document_type);
CREATE INDEX idx_doc_class_confidence ON document_classifications(confidence_score DESC);
CREATE INDEX idx_doc_class_needs_review ON document_classifications(is_correct) WHERE is_correct IS NULL;

COMMENT ON TABLE document_classifications IS 'AI classification results with confidence scores. Used for model training.';


-- Stores extracted entities
CREATE TABLE entity_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source Reference
  email_id UUID REFERENCES raw_emails(id) ON DELETE CASCADE,
  attachment_id UUID REFERENCES raw_attachments(id) ON DELETE CASCADE,
  classification_id UUID REFERENCES document_classifications(id) ON DELETE CASCADE,

  -- Entity Details
  entity_type VARCHAR(100) NOT NULL,
  entity_value TEXT NOT NULL,
  entity_normalized TEXT,

  -- Extraction Context
  confidence_score DECIMAL(5,2) NOT NULL,
  extraction_method VARCHAR(100) NOT NULL,
  context_snippet TEXT,
  position_start INTEGER,
  position_end INTEGER,

  -- Validation
  is_valid BOOLEAN DEFAULT true,
  validation_errors JSONB,

  -- Human Feedback
  is_correct BOOLEAN,
  corrected_value TEXT,
  feedback_by UUID,
  feedback_at TIMESTAMP,

  -- Metadata
  extracted_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),

  CHECK (confidence_score >= 0 AND confidence_score <= 100)
);

CREATE INDEX idx_entity_email ON entity_extractions(email_id);
CREATE INDEX idx_entity_attach ON entity_extractions(attachment_id);
CREATE INDEX idx_entity_type ON entity_extractions(entity_type);
CREATE INDEX idx_entity_value ON entity_extractions(entity_value);
CREATE INDEX idx_entity_normalized ON entity_extractions(entity_normalized);

COMMENT ON TABLE entity_extractions IS 'Extracted entities (booking #, container #, BL #) with validation.';


-- Stores AI-suggested shipment links
CREATE TABLE shipment_link_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source Reference
  email_id UUID REFERENCES raw_emails(id) ON DELETE CASCADE,
  attachment_id UUID REFERENCES raw_attachments(id) ON DELETE CASCADE,

  -- Linking Result
  shipment_id UUID,
  confidence_score DECIMAL(5,2) NOT NULL,

  -- Linking Evidence
  matching_entities JSONB NOT NULL,
  linking_reason TEXT,
  similarity_score DECIMAL(5,2),

  -- Link Status
  link_status VARCHAR(50) DEFAULT 'candidate',
  link_quality VARCHAR(50),

  -- Human Review
  reviewed_by UUID,
  reviewed_at TIMESTAMP,
  review_notes TEXT,

  -- Metadata
  suggested_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),

  CHECK (confidence_score >= 0 AND confidence_score <= 100)
);

CREATE INDEX idx_link_email ON shipment_link_candidates(email_id);
CREATE INDEX idx_link_shipment ON shipment_link_candidates(shipment_id);
CREATE INDEX idx_link_status ON shipment_link_candidates(link_status);
CREATE INDEX idx_link_quality ON shipment_link_candidates(link_quality);
CREATE INDEX idx_link_needs_review ON shipment_link_candidates(link_status) WHERE link_status = 'candidate';

COMMENT ON TABLE shipment_link_candidates IS 'AI-suggested document-to-shipment links for review.';


-- Stores AI-extracted structured data
CREATE TABLE structured_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source Reference
  email_id UUID REFERENCES raw_emails(id) ON DELETE CASCADE,
  attachment_id UUID REFERENCES raw_attachments(id) ON DELETE CASCADE,
  classification_id UUID REFERENCES document_classifications(id),

  -- Extracted Data
  extracted_data JSONB NOT NULL,

  -- Extraction Quality
  confidence_score DECIMAL(5,2) NOT NULL,
  extraction_completeness DECIMAL(5,2),
  missing_fields TEXT[],

  -- Model Info
  model_name VARCHAR(100) NOT NULL,
  model_version VARCHAR(50) NOT NULL,
  extraction_prompt_version VARCHAR(50),

  -- Validation
  validation_errors JSONB,

  -- Human Feedback
  is_correct BOOLEAN,
  corrected_data JSONB,
  feedback_by UUID,
  feedback_at TIMESTAMP,

  -- Metadata
  extracted_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),

  CHECK (confidence_score >= 0 AND confidence_score <= 100)
);

CREATE INDEX idx_struct_email ON structured_extractions(email_id);
CREATE INDEX idx_struct_attach ON structured_extractions(attachment_id);
CREATE INDEX idx_struct_classification ON structured_extractions(classification_id);
CREATE INDEX idx_struct_data ON structured_extractions USING GIN(extracted_data);

COMMENT ON TABLE structured_extractions IS 'Flexible JSONB storage of all extracted data from documents.';


-- ============================================================================
-- LAYER 3: DECISION SUPPORT (Shipment-Centric, Normalized)
-- ============================================================================

-- Core shipment record
CREATE TABLE shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Shipment Identifiers
  shipment_number VARCHAR(100) UNIQUE NOT NULL,
  booking_number VARCHAR(100),
  house_bl_number VARCHAR(100),
  master_bl_number VARCHAR(100),

  -- Shipment Type
  shipment_mode VARCHAR(50) NOT NULL,
  shipment_type VARCHAR(50) NOT NULL,
  service_type VARCHAR(50),

  -- Shipment Status
  status VARCHAR(50) NOT NULL DEFAULT 'draft',
  milestone VARCHAR(100),

  -- Customer
  customer_id UUID,
  customer_name VARCHAR(500),
  customer_reference VARCHAR(200),

  -- Carrier
  carrier_id VARCHAR(100),
  carrier_name VARCHAR(500),
  vessel_name VARCHAR(500),
  voyage_number VARCHAR(100),

  -- Locations
  port_of_loading_code VARCHAR(10),
  port_of_loading_name VARCHAR(500),
  port_of_discharge_code VARCHAR(10),
  port_of_discharge_name VARCHAR(500),
  place_of_delivery VARCHAR(500),
  final_destination VARCHAR(500),

  -- Key Dates
  etd DATE,
  atd DATE,
  eta DATE,
  ata DATE,
  delivery_date DATE,

  -- Cargo Details
  commodity VARCHAR(500),
  gross_weight_kg DECIMAL(12,2),
  volume_cbm DECIMAL(12,2),
  number_of_packages INTEGER,
  container_count INTEGER,

  -- Financial
  total_cost DECIMAL(12,2),
  total_revenue DECIMAL(12,2),
  currency VARCHAR(10) DEFAULT 'INR',

  -- Source Tracking
  created_from_email_id UUID REFERENCES raw_emails(id),
  created_from_attachment_id UUID REFERENCES raw_attachments(id),

  -- Lifecycle
  lifecycle_stage VARCHAR(50) DEFAULT 'active',
  completed_at TIMESTAMP,
  archived_at TIMESTAMP,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID,
  updated_by UUID
);

CREATE INDEX idx_shipments_number ON shipments(shipment_number);
CREATE INDEX idx_shipments_booking ON shipments(booking_number);
CREATE INDEX idx_shipments_hbl ON shipments(house_bl_number);
CREATE INDEX idx_shipments_status ON shipments(status);
CREATE INDEX idx_shipments_lifecycle ON shipments(lifecycle_stage);
CREATE INDEX idx_shipments_customer ON shipments(customer_id);
CREATE INDEX idx_shipments_carrier ON shipments(carrier_id);
CREATE INDEX idx_shipments_etd ON shipments(etd);
CREATE INDEX idx_shipments_eta ON shipments(eta);

COMMENT ON TABLE shipments IS 'Master shipment record. Retained permanently.';

-- Add foreign key from shipment_link_candidates
ALTER TABLE shipment_link_candidates
  ADD CONSTRAINT fk_link_shipment FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE;


-- Document register per shipment
CREATE TABLE shipment_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  -- Document Type & Classification
  document_type VARCHAR(100) NOT NULL,
  document_category VARCHAR(50) NOT NULL,
  document_direction VARCHAR(20) NOT NULL,

  -- Document Details
  document_number VARCHAR(200),
  document_date DATE,
  document_title VARCHAR(500),

  -- Source Reference
  source_email_id UUID REFERENCES raw_emails(id),
  source_attachment_id UUID REFERENCES raw_attachments(id),
  source_classification_id UUID REFERENCES document_classifications(id),

  -- Storage
  file_path TEXT,
  file_size_bytes BIGINT,
  mime_type VARCHAR(200),

  -- Parties
  sender VARCHAR(500),
  recipient VARCHAR(500),

  -- Status
  status VARCHAR(50) DEFAULT 'received',
  reviewed_by UUID,
  reviewed_at TIMESTAMP,

  -- Versions
  version_number INTEGER DEFAULT 1,
  is_latest_version BOOLEAN DEFAULT true,
  superseded_by UUID REFERENCES shipment_documents(id),

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE (shipment_id, document_type, version_number)
);

CREATE INDEX idx_ship_docs_shipment ON shipment_documents(shipment_id);
CREATE INDEX idx_ship_docs_type ON shipment_documents(document_type);
CREATE INDEX idx_ship_docs_category ON shipment_documents(document_category);
CREATE INDEX idx_ship_docs_source_email ON shipment_documents(source_email_id);
CREATE INDEX idx_ship_docs_latest ON shipment_documents(is_latest_version) WHERE is_latest_version = true;

COMMENT ON TABLE shipment_documents IS 'Document register per shipment. Metadata retained, files purged.';


-- Event timeline per shipment
CREATE TABLE shipment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  -- Event Details
  event_type VARCHAR(100) NOT NULL,
  event_category VARCHAR(50) NOT NULL,
  event_description TEXT NOT NULL,

  -- Event Data
  event_data JSONB,

  -- Event Source
  source_type VARCHAR(50) NOT NULL,
  source_email_id UUID REFERENCES raw_emails(id),
  source_user_id UUID,

  -- Location & Date
  event_location VARCHAR(500),
  event_date DATE,
  event_timestamp TIMESTAMP DEFAULT NOW(),

  -- Severity
  severity VARCHAR(20),

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX idx_ship_events_shipment ON shipment_events(shipment_id);
CREATE INDEX idx_ship_events_type ON shipment_events(event_type);
CREATE INDEX idx_ship_events_category ON shipment_events(event_category);
CREATE INDEX idx_ship_events_timestamp ON shipment_events(event_timestamp DESC);
CREATE INDEX idx_ship_events_severity ON shipment_events(severity) WHERE severity IN ('warning', 'critical');

COMMENT ON TABLE shipment_events IS 'Complete event timeline per shipment. Retained permanently.';


-- Stakeholders per shipment
CREATE TABLE shipment_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  -- Party Type
  party_role VARCHAR(50) NOT NULL,

  -- Party Details
  party_name VARCHAR(500) NOT NULL,
  party_contact_person VARCHAR(500),
  party_email VARCHAR(500),
  party_phone VARCHAR(100),
  party_address TEXT,

  -- Additional Info
  tax_id VARCHAR(100),
  license_number VARCHAR(100),

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE (shipment_id, party_role, party_name)
);

CREATE INDEX idx_ship_parties_shipment ON shipment_parties(shipment_id);
CREATE INDEX idx_ship_parties_role ON shipment_parties(party_role);

COMMENT ON TABLE shipment_parties IS 'Stakeholders per shipment (shipper, consignee, CHA, etc.).';


-- Financial records per shipment
CREATE TABLE shipment_financials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  -- Transaction Type
  transaction_type VARCHAR(50) NOT NULL,
  transaction_category VARCHAR(50) NOT NULL,

  -- Financial Details
  vendor_name VARCHAR(500),
  invoice_number VARCHAR(200),
  invoice_date DATE,

  -- Amounts
  amount DECIMAL(12,2) NOT NULL,
  currency VARCHAR(10) NOT NULL DEFAULT 'INR',
  amount_inr DECIMAL(12,2),
  exchange_rate DECIMAL(10,4),

  -- Payment Status
  payment_status VARCHAR(50) DEFAULT 'pending',
  payment_date DATE,
  payment_reference VARCHAR(200),

  -- Source Document
  source_email_id UUID REFERENCES raw_emails(id),
  source_attachment_id UUID REFERENCES raw_attachments(id),

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_ship_fin_shipment ON shipment_financials(shipment_id);
CREATE INDEX idx_ship_fin_type ON shipment_financials(transaction_type);
CREATE INDEX idx_ship_fin_category ON shipment_financials(transaction_category);
CREATE INDEX idx_ship_fin_status ON shipment_financials(payment_status);
CREATE INDEX idx_ship_fin_invoice ON shipment_financials(invoice_number);

COMMENT ON TABLE shipment_financials IS 'All costs, invoices, payments per shipment. Retained permanently.';


-- Container-level tracking
CREATE TABLE shipment_containers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,

  -- Container Details
  container_number VARCHAR(20) NOT NULL,
  container_type VARCHAR(20) NOT NULL,
  container_size INTEGER NOT NULL,
  container_condition VARCHAR(20),

  -- Seal Information
  seal_number VARCHAR(100),
  vgm_weight_kg DECIMAL(12,2),

  -- Container Status
  status VARCHAR(50) DEFAULT 'booked',

  -- Key Dates
  pickup_date DATE,
  gate_in_date DATE,
  loading_date DATE,
  discharge_date DATE,
  gate_out_date DATE,
  return_date DATE,

  -- Detention/Demurrage
  free_days INTEGER,
  detention_days INTEGER,
  demurrage_days INTEGER,
  detention_charges DECIMAL(12,2),
  demurrage_charges DECIMAL(12,2),

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_ship_cont_shipment ON shipment_containers(shipment_id);
CREATE INDEX idx_ship_cont_number ON shipment_containers(container_number);
CREATE INDEX idx_ship_cont_status ON shipment_containers(status);

COMMENT ON TABLE shipment_containers IS 'Container-level tracking with detention/demurrage calculation.';


-- ============================================================================
-- LAYER 4: CONFIGURATION (Rules, Patterns, Metadata)
-- ============================================================================

-- Document type definitions and patterns
CREATE TABLE document_type_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Document Type
  document_type VARCHAR(100) UNIQUE NOT NULL,
  display_name VARCHAR(200) NOT NULL,
  document_category VARCHAR(50) NOT NULL,

  -- Classification Patterns
  email_subject_patterns TEXT[],
  email_sender_patterns TEXT[],
  attachment_filename_patterns TEXT[],
  content_keywords TEXT[],

  -- Classification Rules
  classification_rules JSONB,

  -- Extraction Rules
  entity_patterns JSONB,
  extraction_template JSONB,

  -- Confidence Thresholds
  min_confidence_auto_classify DECIMAL(5,2) DEFAULT 85.00,
  min_confidence_auto_link DECIMAL(5,2) DEFAULT 90.00,

  -- Processing Instructions
  requires_attachment BOOLEAN DEFAULT false,
  requires_manual_review BOOLEAN DEFAULT false,
  processing_priority INTEGER DEFAULT 5,

  -- Metadata
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by UUID
);

CREATE INDEX idx_doc_config_type ON document_type_configs(document_type);
CREATE INDEX idx_doc_config_enabled ON document_type_configs(enabled) WHERE enabled = true;

COMMENT ON TABLE document_type_configs IS 'Document type patterns and rules. Change behavior WITHOUT code deployment.';


-- Extraction rules
CREATE TABLE extraction_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type VARCHAR(100) NOT NULL REFERENCES document_type_configs(document_type),

  -- Field Details
  field_name VARCHAR(100) NOT NULL,
  field_type VARCHAR(50) NOT NULL,
  display_name VARCHAR(200) NOT NULL,

  -- Extraction Patterns
  extraction_patterns JSONB NOT NULL,
  extraction_methods TEXT[],

  -- Validation Rules
  validation_rules JSONB,
  is_required BOOLEAN DEFAULT false,

  -- Default Values & Transformations
  default_value TEXT,
  transformation_rules JSONB,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),

  UNIQUE (document_type, field_name)
);

CREATE INDEX idx_extract_rules_doc_type ON extraction_rules(document_type);

COMMENT ON TABLE extraction_rules IS 'Field-level extraction rules per document type.';


-- Linking rules
CREATE TABLE linking_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Rule Details
  rule_name VARCHAR(200) UNIQUE NOT NULL,
  rule_description TEXT,
  rule_priority INTEGER DEFAULT 5,

  -- Matching Criteria
  matching_entity_types TEXT[] NOT NULL,
  match_strategy VARCHAR(50) NOT NULL,
  min_matches_required INTEGER DEFAULT 1,

  -- Confidence Calculation
  base_confidence DECIMAL(5,2) DEFAULT 70.00,
  confidence_boost_per_match DECIMAL(5,2) DEFAULT 10.00,

  -- Additional Filters
  date_range_days INTEGER,
  must_match_carrier BOOLEAN DEFAULT false,
  must_match_customer BOOLEAN DEFAULT false,

  -- Rule Logic
  rule_logic JSONB,

  -- Metadata
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_linking_rules_priority ON linking_rules(rule_priority DESC);
CREATE INDEX idx_linking_rules_enabled ON linking_rules(enabled) WHERE enabled = true;

COMMENT ON TABLE linking_rules IS 'Rules for linking documents to shipments with confidence scoring.';


-- AI model configurations
CREATE TABLE ai_model_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Model Details
  model_name VARCHAR(100) UNIQUE NOT NULL,
  model_version VARCHAR(50) NOT NULL,
  model_type VARCHAR(50) NOT NULL,

  -- Model Parameters
  temperature DECIMAL(3,2),
  max_tokens INTEGER,
  system_prompt TEXT,

  -- Usage
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,

  -- Performance Metrics
  accuracy_rate DECIMAL(5,2),
  avg_confidence DECIMAL(5,2),
  total_predictions INTEGER DEFAULT 0,
  correct_predictions INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_ai_model_active ON ai_model_configs(is_active) WHERE is_active = true;
CREATE INDEX idx_ai_model_default ON ai_model_configs(is_default) WHERE is_default = true;

COMMENT ON TABLE ai_model_configs IS 'AI model configurations with performance tracking.';


-- Carrier-specific configurations
CREATE TABLE carrier_configs (
  id VARCHAR(100) PRIMARY KEY,
  carrier_name VARCHAR(500) NOT NULL,

  -- Email Patterns
  email_sender_patterns TEXT[],
  email_subject_patterns TEXT[],

  -- Document Patterns
  booking_number_regex TEXT,
  bl_number_regex TEXT,
  container_number_prefix TEXT[],

  -- Processing Rules
  requires_true_sender_extraction BOOLEAN DEFAULT false,
  default_confidence_adjustment DECIMAL(5,2) DEFAULT 0.00,

  -- Metadata
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_carrier_enabled ON carrier_configs(enabled) WHERE enabled = true;

COMMENT ON TABLE carrier_configs IS 'Carrier-specific patterns (Maersk, Hapag, MSC, etc.).';


-- Email routing rules
CREATE TABLE email_routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Rule Details
  rule_name VARCHAR(200) UNIQUE NOT NULL,
  rule_priority INTEGER DEFAULT 5,

  -- Matching Criteria
  sender_patterns TEXT[],
  subject_patterns TEXT[],
  label_patterns TEXT[],

  -- Action
  action VARCHAR(50) NOT NULL,
  assign_to_document_type VARCHAR(100),

  -- Metadata
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_routing_priority ON email_routing_rules(rule_priority DESC);
CREATE INDEX idx_routing_enabled ON email_routing_rules(enabled) WHERE enabled = true;

COMMENT ON TABLE email_routing_rules IS 'Email routing rules for pre-classification.';


-- ============================================================================
-- DATA LIFECYCLE MANAGEMENT
-- ============================================================================

-- Audit log for data purges
CREATE TABLE data_lifecycle_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Lifecycle Action
  action VARCHAR(50) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id UUID NOT NULL,

  -- Action Details
  action_reason TEXT,
  records_affected INTEGER,
  data_size_bytes BIGINT,

  -- Action Result
  status VARCHAR(50) DEFAULT 'success',
  error_message TEXT,

  -- Metadata
  executed_at TIMESTAMP DEFAULT NOW(),
  executed_by UUID
);

CREATE INDEX idx_lifecycle_log_entity ON data_lifecycle_log(entity_type, entity_id);
CREATE INDEX idx_lifecycle_log_action ON data_lifecycle_log(action);
CREATE INDEX idx_lifecycle_log_executed ON data_lifecycle_log(executed_at DESC);

COMMENT ON TABLE data_lifecycle_log IS 'Audit trail of all data archival/purge operations.';


-- Archival policies
CREATE TABLE archival_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Policy Details
  policy_name VARCHAR(200) UNIQUE NOT NULL,
  entity_type VARCHAR(50) NOT NULL,

  -- Retention Rules
  retention_days INTEGER NOT NULL,
  retention_condition VARCHAR(100),

  -- Archival Action
  archive_action VARCHAR(50) NOT NULL,
  archive_storage_path TEXT,

  -- Safety Rules
  require_manual_approval BOOLEAN DEFAULT false,
  min_shipment_age_days INTEGER DEFAULT 90,

  -- Metadata
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_archival_enabled ON archival_policies(enabled) WHERE enabled = true;

COMMENT ON TABLE archival_policies IS 'Configurable archival policies for data lifecycle management.';


-- ============================================================================
-- VIEWS & HELPER FUNCTIONS
-- ============================================================================

-- View: Shipments ready for archival
CREATE OR REPLACE VIEW shipments_ready_for_archival AS
SELECT
  s.id,
  s.shipment_number,
  s.completed_at,
  s.status,
  COUNT(DISTINCT sd.source_email_id) as email_count,
  COUNT(DISTINCT sd.source_attachment_id) as attachment_count
FROM shipments s
LEFT JOIN shipment_documents sd ON sd.shipment_id = s.id
WHERE s.lifecycle_stage = 'completed'
  AND s.completed_at < NOW() - INTERVAL '30 days'
  AND s.archived_at IS NULL
GROUP BY s.id, s.shipment_number, s.completed_at, s.status;

COMMENT ON VIEW shipments_ready_for_archival IS 'Shipments ready for archival (completed > 30 days ago).';


-- Function: Archive completed shipment
CREATE OR REPLACE FUNCTION archive_completed_shipment(p_shipment_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_emails_purged INTEGER;
  v_attachments_purged INTEGER;
BEGIN
  -- 1. Mark shipment as archived
  UPDATE shipments
  SET lifecycle_stage = 'archived', archived_at = NOW()
  WHERE id = p_shipment_id AND lifecycle_stage = 'completed'
    AND completed_at < NOW() - INTERVAL '30 days';

  -- 2. Purge email bodies (keep metadata)
  UPDATE raw_emails
  SET body_text = NULL, body_html = NULL
  WHERE id IN (
    SELECT DISTINCT source_email_id
    FROM shipment_documents
    WHERE shipment_id = p_shipment_id
  );

  GET DIAGNOSTICS v_emails_purged = ROW_COUNT;

  -- 3. Delete attachment records
  DELETE FROM raw_attachments
  WHERE id IN (
    SELECT DISTINCT source_attachment_id
    FROM shipment_documents
    WHERE shipment_id = p_shipment_id
  );

  GET DIAGNOSTICS v_attachments_purged = ROW_COUNT;

  -- 4. Log archival action
  INSERT INTO data_lifecycle_log (action, entity_type, entity_id, records_affected, action_reason)
  VALUES ('archive_shipment', 'shipment', p_shipment_id,
          v_emails_purged + v_attachments_purged,
          'Shipment completed > 30 days ago');

  -- 5. Return summary
  v_result := jsonb_build_object(
    'shipment_id', p_shipment_id,
    'emails_purged', v_emails_purged,
    'attachments_purged', v_attachments_purged,
    'archived_at', NOW()
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION archive_completed_shipment IS 'Archives shipment by purging raw email/attachment data.';


-- Function: Calculate linking confidence score
CREATE OR REPLACE FUNCTION calculate_link_confidence(
  p_matching_entities JSONB,
  p_shipment_id UUID,
  p_email_received_at TIMESTAMP
)
RETURNS DECIMAL(5,2) AS $$
DECLARE
  v_confidence DECIMAL(5,2);
  v_match_count INTEGER;
  v_shipment_etd DATE;
  v_date_diff_days INTEGER;
BEGIN
  -- Base confidence
  v_confidence := 70.00;

  -- Count matching entities
  v_match_count := jsonb_array_length(jsonb_array_elements(p_matching_entities));

  -- Boost confidence per match
  v_confidence := v_confidence + (v_match_count * 10.00);

  -- Date proximity boost (emails close to ETD more likely related)
  SELECT etd INTO v_shipment_etd FROM shipments WHERE id = p_shipment_id;
  IF v_shipment_etd IS NOT NULL THEN
    v_date_diff_days := ABS(EXTRACT(DAY FROM (v_shipment_etd - p_email_received_at::DATE)));
    IF v_date_diff_days <= 7 THEN
      v_confidence := v_confidence + 5.00;
    ELSIF v_date_diff_days <= 30 THEN
      v_confidence := v_confidence + 2.00;
    END IF;
  END IF;

  -- Cap at 100
  IF v_confidence > 100 THEN
    v_confidence := 100.00;
  END IF;

  RETURN v_confidence;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_link_confidence IS 'Calculates confidence score for shipment linking based on entity matches and date proximity.';


-- ============================================================================
-- SEED DATA (Example Configurations)
-- ============================================================================

-- Seed: Document type configurations
INSERT INTO document_type_configs (document_type, display_name, document_category, email_subject_patterns, content_keywords, min_confidence_auto_classify, processing_priority)
VALUES
  ('booking_confirmation', 'Booking Confirmation', 'shipping',
   ARRAY['booking confirmation', 'booking conf', 'bkg conf', 'booking no'],
   ARRAY['booking number', 'vessel name', 'ETD', 'port of loading'],
   85.00, 10),

  ('commercial_invoice', 'Commercial Invoice', 'financial',
   ARRAY['commercial invoice', 'invoice', 'shipper invoice'],
   ARRAY['invoice number', 'shipper', 'consignee', 'total value'],
   80.00, 8),

  ('si_draft', 'Shipping Instruction (SI) Draft', 'shipping',
   ARRAY['SI draft', 'shipping instruction', 'VGM declaration'],
   ARRAY['shipper', 'consignee', 'notify party', 'cargo description'],
   85.00, 9),

  ('house_bl', 'House Bill of Lading (HBL)', 'shipping',
   ARRAY['HBL', 'house bill of lading', 'bill of lading'],
   ARRAY['B/L number', 'shipper', 'consignee', 'port of discharge'],
   90.00, 10),

  ('arrival_notice', 'Arrival Notice', 'operational',
   ARRAY['arrival notice', 'AN', 'container arrival', 'vessel arrived'],
   ARRAY['ETA', 'vessel', 'free time', 'demurrage'],
   85.00, 9),

  ('duty_entry', 'Duty Entry', 'customs',
   ARRAY['duty entry', 'customs entry', 'bill of entry'],
   ARRAY['customs', 'duty', 'IGM', 'CHA'],
   80.00, 7),

  ('pod', 'Proof of Delivery', 'operational',
   ARRAY['POD', 'proof of delivery', 'delivery confirmation'],
   ARRAY['delivered', 'received by', 'delivery date'],
   85.00, 8),

  ('vendor_invoice', 'Vendor Invoice', 'financial',
   ARRAY['invoice', 'bill', 'payment due', 'detention', 'demurrage'],
   ARRAY['invoice number', 'amount', 'due date', 'payment'],
   75.00, 6);


-- Seed: Carrier configurations
INSERT INTO carrier_configs (id, carrier_name, email_sender_patterns, booking_number_regex, container_number_prefix, enabled)
VALUES
  ('maersk', 'Maersk',
   ARRAY['@maersk.com', 'in.export@maersk.com'],
   '^[0-9]{11}$',
   ARRAY['MAEU', 'MSKU'],
   true),

  ('hapag', 'Hapag-Lloyd',
   ARRAY['@hlag.com', '@hapag-lloyd.com'],
   '^[A-Z]{3}[0-9]{10}$',
   ARRAY['HLCU', 'HPLU'],
   true),

  ('msc', 'MSC',
   ARRAY['@msc.com', '@mscgva.ch'],
   '^[A-Z]{3}[0-9]{9}$',
   ARRAY['MSCU'],
   true),

  ('cma_cgm', 'CMA CGM',
   ARRAY['@cma-cgm.com'],
   '^[A-Z]{3}[0-9]{10}$',
   ARRAY['CMAU', 'CGMU'],
   true);


-- Seed: Linking rules
INSERT INTO linking_rules (rule_name, rule_description, rule_priority, matching_entity_types, match_strategy, min_matches_required, base_confidence, confidence_boost_per_match, enabled)
VALUES
  ('link_by_booking_number', 'Link documents by exact booking number match', 10,
   ARRAY['booking_number'], 'exact', 1, 90.00, 0.00, true),

  ('link_by_bl_number', 'Link documents by BL number match', 9,
   ARRAY['bl_number', 'house_bl_number'], 'exact', 1, 90.00, 5.00, true),

  ('link_by_container_number', 'Link documents by container number match', 8,
   ARRAY['container_number'], 'exact', 1, 80.00, 10.00, true),

  ('link_by_multiple_entities', 'Link by multiple matching entities', 7,
   ARRAY['booking_number', 'container_number', 'bl_number'], 'exact', 2, 70.00, 15.00, true);


-- Seed: AI model configurations
INSERT INTO ai_model_configs (model_name, model_version, model_type, temperature, max_tokens, is_active, is_default)
VALUES
  ('claude-opus-3', '2025-01-15', 'extraction', 0.3, 4000, true, true),
  ('gpt-4-turbo', '2024-11-20', 'classification', 0.2, 2000, true, false),
  ('claude-sonnet-3.5', '2025-01-15', 'general', 0.5, 8000, true, false);


-- ============================================================================
-- PERFORMANCE OPTIMIZATIONS
-- ============================================================================

-- Enable auto-vacuum for high-churn tables
ALTER TABLE raw_emails SET (autovacuum_enabled = true, autovacuum_vacuum_scale_factor = 0.05);
ALTER TABLE document_classifications SET (autovacuum_enabled = true);
ALTER TABLE entity_extractions SET (autovacuum_enabled = true);

-- Update statistics for query planner
ANALYZE raw_emails;
ANALYZE document_classifications;
ANALYZE entity_extractions;
ANALYZE shipments;


-- ============================================================================
-- COMPLETION
-- ============================================================================

COMMENT ON SCHEMA public IS 'Freight Forwarding Document Intelligence Schema v1.0.0';

-- Schema deployment complete
SELECT 'Schema deployment complete! 🚀' as status,
       COUNT(*) FILTER (WHERE table_type = 'BASE TABLE') as tables_created,
       COUNT(*) FILTER (WHERE table_type = 'VIEW') as views_created
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name NOT LIKE 'pg_%';
-- ============================================================================
-- STAKEHOLDER INTELLIGENCE EXTENSION
-- ============================================================================
-- Extends freight intelligence schema with customer, shipper, and stakeholder data
-- Includes AI-powered relationship intelligence and performance tracking
-- ============================================================================

-- ============================================================================
-- MASTER DATA: Customers, Shippers, Vendors
-- ============================================================================

-- Customer master data
CREATE TABLE customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Customer Identifiers
  customer_code VARCHAR(50) UNIQUE NOT NULL,        -- Your internal customer code
  customer_name VARCHAR(500) NOT NULL,
  customer_legal_name VARCHAR(500),

  -- Customer Type
  customer_type VARCHAR(50) NOT NULL,               -- direct, freight_forwarder, nvocc, shipper
  customer_segment VARCHAR(50),                     -- enterprise, sme, startup
  industry VARCHAR(200),                            -- electronics, automotive, pharma, etc.

  -- Contact Information
  primary_contact_name VARCHAR(500),
  primary_contact_email VARCHAR(500),
  primary_contact_phone VARCHAR(100),

  -- Company Details
  company_website VARCHAR(500),
  company_address TEXT,
  company_city VARCHAR(200),
  company_state VARCHAR(200),
  company_country VARCHAR(100),
  company_postal_code VARCHAR(20),

  -- Tax & Legal
  tax_id VARCHAR(100),                              -- GST, PAN, VAT
  iec_code VARCHAR(100),                            -- Import Export Code
  company_registration_number VARCHAR(100),

  -- Banking (for payments)
  bank_name VARCHAR(200),
  bank_account_number VARCHAR(100),
  bank_ifsc_code VARCHAR(20),

  -- Business Details
  credit_limit DECIMAL(12,2),
  credit_days INTEGER DEFAULT 30,
  payment_terms VARCHAR(100),
  preferred_currency VARCHAR(10) DEFAULT 'INR',

  -- Status
  status VARCHAR(50) DEFAULT 'active',              -- active, inactive, suspended, blacklisted
  risk_level VARCHAR(20) DEFAULT 'low',             -- low, medium, high

  -- Performance Metrics (updated by AI)
  total_shipments INTEGER DEFAULT 0,
  total_revenue DECIMAL(12,2) DEFAULT 0,
  average_shipment_value DECIMAL(12,2),
  on_time_payment_rate DECIMAL(5,2),                -- Percentage

  -- AI-Generated Insights
  customer_preferences JSONB,                       -- {"preferred_carriers": ["maersk"], "avg_lead_time": 7}
  communication_style JSONB,                        -- {"response_time_hours": 2, "preferred_channel": "email"}

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID,
  updated_by UUID,

  -- Source tracking (if created from email)
  created_from_email_id UUID REFERENCES raw_emails(id)
);

CREATE INDEX idx_customers_code ON customers(customer_code);
CREATE INDEX idx_customers_name ON customers(customer_name);
CREATE INDEX idx_customers_status ON customers(status);
CREATE INDEX idx_customers_type ON customers(customer_type);
CREATE INDEX idx_customers_segment ON customers(customer_segment);
CREATE INDEX idx_customers_preferences ON customers USING GIN(customer_preferences);

COMMENT ON TABLE customers IS 'Customer master data with AI-powered intelligence and performance tracking.';


-- Shipper/Consignee/Notify Party master data
CREATE TABLE parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Party Identifiers
  party_code VARCHAR(50) UNIQUE,                    -- Auto-generated or manual
  party_name VARCHAR(500) NOT NULL,
  party_legal_name VARCHAR(500),

  -- Party Type
  party_type VARCHAR(50) NOT NULL,                  -- shipper, consignee, notify_party, both

  -- Contact Information
  contact_person VARCHAR(500),
  contact_email VARCHAR(500),
  contact_phone VARCHAR(100),
  contact_mobile VARCHAR(100),

  -- Address
  address_line1 TEXT,
  address_line2 TEXT,
  city VARCHAR(200),
  state VARCHAR(200),
  country VARCHAR(100),
  postal_code VARCHAR(20),

  -- Tax & Legal
  tax_id VARCHAR(100),
  iec_code VARCHAR(100),

  -- Linked Customer
  customer_id UUID REFERENCES customers(id),        -- Which customer does this party belong to?

  -- Status
  status VARCHAR(50) DEFAULT 'active',

  -- Usage Statistics (AI-updated)
  times_used_as_shipper INTEGER DEFAULT 0,
  times_used_as_consignee INTEGER DEFAULT 0,
  last_used_at TIMESTAMP,

  -- AI-Generated Insights
  common_commodities TEXT[],                        -- ["electronics", "automotive parts"]
  average_shipment_size DECIMAL(12,2),              -- CBM
  typical_destinations TEXT[],                      -- ["USLAX", "DEHAM"]

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID,

  -- Source tracking
  created_from_email_id UUID REFERENCES raw_emails(id)
);

CREATE INDEX idx_parties_code ON parties(party_code);
CREATE INDEX idx_parties_name ON parties(party_name);
CREATE INDEX idx_parties_type ON parties(party_type);
CREATE INDEX idx_parties_customer ON parties(customer_id);
CREATE INDEX idx_parties_status ON parties(status);

COMMENT ON TABLE parties IS 'Shipper, consignee, notify party master data with usage intelligence.';


-- Vendor master data (carriers, truckers, CHA, etc.)
CREATE TABLE vendors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Vendor Identifiers
  vendor_code VARCHAR(50) UNIQUE NOT NULL,
  vendor_name VARCHAR(500) NOT NULL,
  vendor_legal_name VARCHAR(500),

  -- Vendor Type
  vendor_type VARCHAR(50) NOT NULL,                 -- carrier, trucker, cha, warehouse, freight_forwarder
  vendor_category VARCHAR(50),                      -- ocean_freight, air_freight, road_transport, customs

  -- Contact Information
  primary_contact_name VARCHAR(500),
  primary_contact_email VARCHAR(500),
  primary_contact_phone VARCHAR(100),

  -- Address
  address TEXT,
  city VARCHAR(200),
  country VARCHAR(100),

  -- Tax & Legal
  tax_id VARCHAR(100),
  pan_number VARCHAR(20),

  -- Banking
  bank_name VARCHAR(200),
  bank_account_number VARCHAR(100),
  bank_ifsc_code VARCHAR(20),

  -- Payment Terms
  payment_terms VARCHAR(100),
  credit_days INTEGER DEFAULT 30,

  -- Status
  status VARCHAR(50) DEFAULT 'active',
  performance_rating DECIMAL(3,2),                  -- 1.00 to 5.00

  -- Performance Metrics (AI-updated)
  total_transactions INTEGER DEFAULT 0,
  total_amount_paid DECIMAL(12,2) DEFAULT 0,
  average_invoice_value DECIMAL(12,2),
  on_time_delivery_rate DECIMAL(5,2),               -- Percentage
  average_response_time_hours DECIMAL(5,2),

  -- AI-Generated Insights
  service_quality_score DECIMAL(5,2),               -- AI-calculated from communications
  common_issues TEXT[],                             -- ["detention charges", "delayed delivery"]
  preferred_for_services TEXT[],                    -- ["FCL to USA", "LCL to Europe"]

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX idx_vendors_code ON vendors(vendor_code);
CREATE INDEX idx_vendors_name ON vendors(vendor_name);
CREATE INDEX idx_vendors_type ON vendors(vendor_type);
CREATE INDEX idx_vendors_status ON vendors(status);
CREATE INDEX idx_vendors_rating ON vendors(performance_rating DESC);

COMMENT ON TABLE vendors IS 'Vendor master data with performance tracking and quality scoring.';


-- ============================================================================
-- STAKEHOLDER INTELLIGENCE: Communication & Relationship Tracking
-- ============================================================================

-- Communication history per customer/party
CREATE TABLE stakeholder_communications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stakeholder Reference
  customer_id UUID REFERENCES customers(id),
  party_id UUID REFERENCES parties(id),
  vendor_id UUID REFERENCES vendors(id),

  -- Communication Details
  communication_type VARCHAR(50) NOT NULL,          -- email, phone, whatsapp, meeting, issue
  communication_direction VARCHAR(20) NOT NULL,     -- inbound, outbound

  -- Communication Content
  subject TEXT,
  summary TEXT,
  full_content TEXT,

  -- Sentiment Analysis (AI-powered)
  sentiment VARCHAR(20),                            -- positive, neutral, negative, urgent
  sentiment_score DECIMAL(5,2),                     -- -1.00 to 1.00
  urgency_level VARCHAR(20),                        -- low, medium, high, critical

  -- Classification (AI-powered)
  topic_category VARCHAR(100),                      -- quote_request, booking, issue, payment, documentation
  key_topics TEXT[],                                -- ["ETD delay", "rate negotiation"]
  action_items JSONB,                               -- [{"action": "Send rate quote", "due_date": "2025-01-15"}]

  -- Source Reference
  source_email_id UUID REFERENCES raw_emails(id),
  shipment_id UUID REFERENCES shipments(id),        -- Linked shipment if applicable

  -- Response Tracking
  requires_response BOOLEAN DEFAULT false,
  response_deadline TIMESTAMP,
  responded_at TIMESTAMP,
  response_time_hours DECIMAL(5,2),

  -- Metadata
  communication_timestamp TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  created_by UUID,

  CHECK (customer_id IS NOT NULL OR party_id IS NOT NULL OR vendor_id IS NOT NULL)
);

CREATE INDEX idx_comm_customer ON stakeholder_communications(customer_id);
CREATE INDEX idx_comm_party ON stakeholder_communications(party_id);
CREATE INDEX idx_comm_vendor ON stakeholder_communications(vendor_id);
CREATE INDEX idx_comm_type ON stakeholder_communications(communication_type);
CREATE INDEX idx_comm_sentiment ON stakeholder_communications(sentiment);
CREATE INDEX idx_comm_timestamp ON stakeholder_communications(communication_timestamp DESC);
CREATE INDEX idx_comm_needs_response ON stakeholder_communications(requires_response) WHERE requires_response = true;

COMMENT ON TABLE stakeholder_communications IS 'Complete communication history with AI sentiment analysis and topic classification.';


-- Customer preferences and intelligence
CREATE TABLE customer_intelligence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,

  -- Preference Type
  preference_category VARCHAR(100) NOT NULL,        -- carrier, routing, documentation, communication, pricing

  -- Preference Data
  preference_data JSONB NOT NULL,                   -- {"preferred_carriers": ["maersk", "msc"], "reasons": ["better rates", "reliable schedule"]}

  -- Confidence & Source
  confidence_score DECIMAL(5,2) NOT NULL,           -- How confident is AI about this preference?
  learned_from VARCHAR(50) NOT NULL,                -- email_analysis, manual_input, shipment_history
  evidence_count INTEGER DEFAULT 1,                 -- How many times observed?

  -- AI Model Info
  model_name VARCHAR(100),
  detected_at TIMESTAMP DEFAULT NOW(),

  -- Status
  is_active BOOLEAN DEFAULT true,
  verified_by_human BOOLEAN DEFAULT false,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_cust_intel_customer ON customer_intelligence(customer_id);
CREATE INDEX idx_cust_intel_category ON customer_intelligence(preference_category);
CREATE INDEX idx_cust_intel_active ON customer_intelligence(is_active) WHERE is_active = true;

COMMENT ON TABLE customer_intelligence IS 'AI-learned customer preferences and intelligence.';


-- Vendor performance tracking
CREATE TABLE vendor_performance_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE CASCADE,

  -- Performance Event
  event_type VARCHAR(100) NOT NULL,                 -- on_time_delivery, delayed_delivery, invoice_accuracy, issue_resolution
  event_category VARCHAR(50) NOT NULL,              -- service_quality, pricing, reliability, communication

  -- Performance Data
  performance_rating DECIMAL(3,2),                  -- 1.00 to 5.00
  expected_value TEXT,                              -- "2025-01-15 delivery"
  actual_value TEXT,                                -- "2025-01-18 delivery"
  variance_value TEXT,                              -- "3 days late"

  -- Context
  shipment_id UUID REFERENCES shipments(id),
  source_email_id UUID REFERENCES raw_emails(id),
  description TEXT,

  -- Financial Impact
  cost_impact DECIMAL(12,2),                        -- Detention charges, etc.

  -- Metadata
  event_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by UUID
);

CREATE INDEX idx_vendor_perf_vendor ON vendor_performance_log(vendor_id);
CREATE INDEX idx_vendor_perf_type ON vendor_performance_log(event_type);
CREATE INDEX idx_vendor_perf_date ON vendor_performance_log(event_date DESC);
CREATE INDEX idx_vendor_perf_rating ON vendor_performance_log(performance_rating);

COMMENT ON TABLE vendor_performance_log IS 'Vendor performance tracking for quality scoring.';


-- ============================================================================
-- STAKEHOLDER RELATIONSHIPS & NETWORK INTELLIGENCE
-- ============================================================================

-- Track relationships between customers and parties
CREATE TABLE customer_party_relationships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,

  -- Relationship Type
  relationship_type VARCHAR(50) NOT NULL,           -- regular_shipper, regular_consignee, occasional

  -- Usage Statistics
  times_used_together INTEGER DEFAULT 1,
  first_used_at TIMESTAMP DEFAULT NOW(),
  last_used_at TIMESTAMP DEFAULT NOW(),

  -- AI Insights
  typical_trade_lane VARCHAR(200),                  -- "India to USA"
  typical_commodity VARCHAR(200),
  average_shipment_frequency_days INTEGER,          -- Ships every X days

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE (customer_id, party_id)
);

CREATE INDEX idx_rel_customer ON customer_party_relationships(customer_id);
CREATE INDEX idx_rel_party ON customer_party_relationships(party_id);
CREATE INDEX idx_rel_type ON customer_party_relationships(relationship_type);

COMMENT ON TABLE customer_party_relationships IS 'Track customer-party relationships and usage patterns.';


-- Contact persons per customer/vendor
CREATE TABLE contact_persons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Linked Entity
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  vendor_id UUID REFERENCES vendors(id) ON DELETE CASCADE,
  party_id UUID REFERENCES parties(id) ON DELETE CASCADE,

  -- Contact Details
  full_name VARCHAR(500) NOT NULL,
  job_title VARCHAR(200),
  department VARCHAR(100),

  -- Contact Information
  email VARCHAR(500),
  phone VARCHAR(100),
  mobile VARCHAR(100),
  whatsapp VARCHAR(100),

  -- Communication Preferences
  preferred_channel VARCHAR(50),                    -- email, phone, whatsapp
  best_time_to_contact VARCHAR(100),                -- "9am-5pm IST"
  language_preference VARCHAR(50),

  -- Status
  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  -- Communication Stats (AI-updated)
  total_communications INTEGER DEFAULT 0,
  average_response_time_hours DECIMAL(5,2),
  last_contacted_at TIMESTAMP,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  CHECK (customer_id IS NOT NULL OR vendor_id IS NOT NULL OR party_id IS NOT NULL)
);

CREATE INDEX idx_contact_customer ON contact_persons(customer_id);
CREATE INDEX idx_contact_vendor ON contact_persons(vendor_id);
CREATE INDEX idx_contact_party ON contact_persons(party_id);
CREATE INDEX idx_contact_email ON contact_persons(email);
CREATE INDEX idx_contact_primary ON contact_persons(is_primary) WHERE is_primary = true;

COMMENT ON TABLE contact_persons IS 'Contact persons for customers, vendors, and parties.';


-- ============================================================================
-- EXTEND EXISTING TABLES WITH STAKEHOLDER LINKS
-- ============================================================================

-- Add customer/vendor foreign keys to shipments table
ALTER TABLE shipments
  ADD COLUMN customer_id_fk UUID REFERENCES customers(id),
  ADD COLUMN primary_vendor_id UUID REFERENCES vendors(id);

CREATE INDEX idx_shipments_customer_fk ON shipments(customer_id_fk);
CREATE INDEX idx_shipments_vendor_fk ON shipments(primary_vendor_id);

COMMENT ON COLUMN shipments.customer_id_fk IS 'Foreign key to customers master table';
COMMENT ON COLUMN shipments.primary_vendor_id IS 'Primary carrier/vendor for this shipment';


-- Add vendor foreign key to shipment_financials
ALTER TABLE shipment_financials
  ADD COLUMN vendor_id UUID REFERENCES vendors(id);

CREATE INDEX idx_ship_fin_vendor_fk ON shipment_financials(vendor_id);


-- Update shipment_parties to use party master data
ALTER TABLE shipment_parties
  ADD COLUMN party_id_fk UUID REFERENCES parties(id);

CREATE INDEX idx_ship_parties_fk ON shipment_parties(party_id_fk);

COMMENT ON COLUMN shipment_parties.party_id_fk IS 'Foreign key to parties master table';


-- ============================================================================
-- AI INTELLIGENCE FUNCTIONS
-- ============================================================================

-- Function: Update customer performance metrics
CREATE OR REPLACE FUNCTION update_customer_metrics(p_customer_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_total_shipments INTEGER;
  v_total_revenue DECIMAL(12,2);
  v_avg_shipment_value DECIMAL(12,2);
  v_on_time_payment_rate DECIMAL(5,2);
BEGIN
  -- Calculate total shipments
  SELECT COUNT(*) INTO v_total_shipments
  FROM shipments
  WHERE customer_id_fk = p_customer_id;

  -- Calculate total revenue
  SELECT COALESCE(SUM(total_revenue), 0) INTO v_total_revenue
  FROM shipments
  WHERE customer_id_fk = p_customer_id;

  -- Calculate average shipment value
  v_avg_shipment_value := CASE
    WHEN v_total_shipments > 0 THEN v_total_revenue / v_total_shipments
    ELSE 0
  END;

  -- Calculate on-time payment rate
  SELECT
    COALESCE(
      COUNT(*) FILTER (WHERE payment_status = 'paid' AND payment_date <= invoice_date + INTERVAL '30 days')::DECIMAL
      / NULLIF(COUNT(*) FILTER (WHERE payment_status = 'paid'), 0) * 100,
      0
    ) INTO v_on_time_payment_rate
  FROM shipment_financials sf
  JOIN shipments s ON s.id = sf.shipment_id
  WHERE s.customer_id_fk = p_customer_id
    AND sf.transaction_type = 'revenue';

  -- Update customer metrics
  UPDATE customers
  SET
    total_shipments = v_total_shipments,
    total_revenue = v_total_revenue,
    average_shipment_value = v_avg_shipment_value,
    on_time_payment_rate = v_on_time_payment_rate,
    updated_at = NOW()
  WHERE id = p_customer_id;

  -- Return summary
  v_result := jsonb_build_object(
    'customer_id', p_customer_id,
    'total_shipments', v_total_shipments,
    'total_revenue', v_total_revenue,
    'avg_shipment_value', v_avg_shipment_value,
    'on_time_payment_rate', v_on_time_payment_rate
  );

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_customer_metrics IS 'Updates customer performance metrics based on shipment data.';


-- Function: Calculate vendor performance score
CREATE OR REPLACE FUNCTION calculate_vendor_performance(p_vendor_id UUID)
RETURNS DECIMAL(3,2) AS $$
DECLARE
  v_score DECIMAL(3,2);
  v_on_time_rate DECIMAL(5,2);
  v_avg_rating DECIMAL(3,2);
BEGIN
  -- Calculate on-time delivery rate
  SELECT
    COALESCE(
      COUNT(*) FILTER (WHERE event_type = 'on_time_delivery')::DECIMAL
      / NULLIF(COUNT(*), 0) * 100,
      0
    ) INTO v_on_time_rate
  FROM vendor_performance_log
  WHERE vendor_id = p_vendor_id
    AND event_date > NOW() - INTERVAL '6 months';

  -- Calculate average performance rating
  SELECT COALESCE(AVG(performance_rating), 3.0) INTO v_avg_rating
  FROM vendor_performance_log
  WHERE vendor_id = p_vendor_id
    AND performance_rating IS NOT NULL
    AND event_date > NOW() - INTERVAL '6 months';

  -- Weighted score: 60% rating + 40% on-time
  v_score := (v_avg_rating * 0.6) + ((v_on_time_rate / 100 * 5) * 0.4);

  -- Update vendor record
  UPDATE vendors
  SET
    performance_rating = v_score,
    on_time_delivery_rate = v_on_time_rate,
    updated_at = NOW()
  WHERE id = p_vendor_id;

  RETURN v_score;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_vendor_performance IS 'Calculates vendor performance score from performance log.';


-- Function: Detect customer preferences from shipment history
CREATE OR REPLACE FUNCTION detect_customer_preferences(p_customer_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_preferences JSONB;
  v_preferred_carriers TEXT[];
  v_preferred_routes TEXT[];
  v_avg_lead_time INTEGER;
BEGIN
  -- Detect preferred carriers (top 3 most used)
  SELECT ARRAY_AGG(carrier_id ORDER BY cnt DESC)
  INTO v_preferred_carriers
  FROM (
    SELECT carrier_id, COUNT(*) as cnt
    FROM shipments
    WHERE customer_id_fk = p_customer_id
      AND carrier_id IS NOT NULL
    GROUP BY carrier_id
    ORDER BY cnt DESC
    LIMIT 3
  ) t;

  -- Detect preferred routes
  SELECT ARRAY_AGG(DISTINCT port_of_loading_code || '-' || port_of_discharge_code)
  INTO v_preferred_routes
  FROM shipments
  WHERE customer_id_fk = p_customer_id
    AND port_of_loading_code IS NOT NULL
    AND port_of_discharge_code IS NOT NULL;

  -- Calculate average lead time (booking to ETD)
  SELECT COALESCE(AVG(EXTRACT(DAY FROM (etd - created_at::date))), 7)::INTEGER
  INTO v_avg_lead_time
  FROM shipments
  WHERE customer_id_fk = p_customer_id
    AND etd IS NOT NULL;

  -- Build preferences JSON
  v_preferences := jsonb_build_object(
    'preferred_carriers', v_preferred_carriers,
    'preferred_routes', v_preferred_routes,
    'avg_lead_time_days', v_avg_lead_time,
    'total_shipments', (SELECT COUNT(*) FROM shipments WHERE customer_id_fk = p_customer_id)
  );

  -- Update customer record
  UPDATE customers
  SET customer_preferences = v_preferences,
      updated_at = NOW()
  WHERE id = p_customer_id;

  RETURN v_preferences;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION detect_customer_preferences IS 'AI-powered detection of customer preferences from shipment history.';


-- ============================================================================
-- VIEWS FOR STAKEHOLDER INTELLIGENCE
-- ============================================================================

-- View: Customer 360 (complete customer profile)
CREATE OR REPLACE VIEW customer_360 AS
SELECT
  c.id,
  c.customer_code,
  c.customer_name,
  c.customer_type,
  c.status,
  c.total_shipments,
  c.total_revenue,
  c.average_shipment_value,
  c.on_time_payment_rate,
  c.customer_preferences,

  -- Recent activity
  (SELECT MAX(created_at) FROM shipments WHERE customer_id_fk = c.id) as last_shipment_date,
  (SELECT COUNT(*) FROM shipments WHERE customer_id_fk = c.id AND created_at > NOW() - INTERVAL '30 days') as shipments_last_30_days,

  -- Communication stats
  (SELECT COUNT(*) FROM stakeholder_communications WHERE customer_id = c.id) as total_communications,
  (SELECT AVG(response_time_hours) FROM stakeholder_communications WHERE customer_id = c.id AND response_time_hours IS NOT NULL) as avg_response_time_hours,
  (SELECT COUNT(*) FROM stakeholder_communications WHERE customer_id = c.id AND sentiment = 'negative') as negative_interactions,

  -- Active shipments
  (SELECT COUNT(*) FROM shipments WHERE customer_id_fk = c.id AND lifecycle_stage = 'active') as active_shipments,

  -- Outstanding payments
  (SELECT COUNT(*) FROM shipment_financials sf JOIN shipments s ON s.id = sf.shipment_id WHERE s.customer_id_fk = c.id AND sf.payment_status = 'pending') as pending_invoices
FROM customers c;

COMMENT ON VIEW customer_360 IS 'Complete 360-degree customer profile with intelligence.';


-- View: Vendor scorecard
CREATE OR REPLACE VIEW vendor_scorecard AS
SELECT
  v.id,
  v.vendor_code,
  v.vendor_name,
  v.vendor_type,
  v.performance_rating,
  v.on_time_delivery_rate,
  v.total_transactions,
  v.total_amount_paid,
  v.average_invoice_value,

  -- Recent performance
  (SELECT COUNT(*) FROM vendor_performance_log WHERE vendor_id = v.id AND event_date > NOW() - INTERVAL '30 days') as events_last_30_days,
  (SELECT AVG(performance_rating) FROM vendor_performance_log WHERE vendor_id = v.id AND event_date > NOW() - INTERVAL '90 days') as rating_last_90_days,
  (SELECT COUNT(*) FROM vendor_performance_log WHERE vendor_id = v.id AND event_type = 'delayed_delivery' AND event_date > NOW() - INTERVAL '90 days') as delays_last_90_days,

  -- Financial
  (SELECT SUM(amount) FROM shipment_financials WHERE vendor_id = v.id AND payment_status = 'pending') as outstanding_amount,
  (SELECT COUNT(*) FROM shipment_financials WHERE vendor_id = v.id AND payment_status = 'overdue') as overdue_invoices
FROM vendors v;

COMMENT ON VIEW vendor_scorecard IS 'Vendor performance scorecard with recent metrics.';


-- ============================================================================
-- SEED DATA FOR STAKEHOLDERS
-- ============================================================================

-- Seed: Sample customers
INSERT INTO customers (customer_code, customer_name, customer_type, customer_segment, industry, status)
VALUES
  ('CUST001', 'ABC Electronics Pvt Ltd', 'direct', 'enterprise', 'electronics', 'active'),
  ('CUST002', 'XYZ Automotive Inc', 'direct', 'sme', 'automotive', 'active'),
  ('CUST003', 'Global Freight Services', 'freight_forwarder', 'enterprise', 'logistics', 'active');


-- Seed: Sample vendors
INSERT INTO vendors (vendor_code, vendor_name, vendor_type, vendor_category, status, performance_rating)
VALUES
  ('VEN-MAERSK', 'Maersk Line', 'carrier', 'ocean_freight', 'active', 4.50),
  ('VEN-HAPAG', 'Hapag-Lloyd', 'carrier', 'ocean_freight', 'active', 4.20),
  ('VEN-ABC-TRUCK', 'ABC Trucking Services', 'trucker', 'road_transport', 'active', 3.80),
  ('VEN-QUICK-CHA', 'Quick Customs House Agent', 'cha', 'customs', 'active', 4.00);


-- ============================================================================
-- COMPLETION
-- ============================================================================

COMMENT ON SCHEMA public IS 'Freight Intelligence with Stakeholder Intelligence v1.1.0';

SELECT 'Stakeholder Intelligence Extension deployed! 🎯' as status,
       'Added 9 new tables, 3 AI functions, 2 views, seed data' as summary;
