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
