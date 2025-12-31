-- ============================================================================
-- MIGRATION 007: ADD DOCUMENT FLOW TRACKING
-- ============================================================================
-- Purpose: Track document direction, sender/receiver party types, workflow state
-- Enables: Full document lifecycle tracking (Intoglo workflow)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PART 1: Add document flow columns to document_classifications
-- ----------------------------------------------------------------------------

-- Document direction: Is this email coming IN to Intoglo or going OUT?
ALTER TABLE document_classifications
ADD COLUMN IF NOT EXISTS document_direction VARCHAR(20);
-- Values: 'inbound' (received), 'outbound' (sent), 'internal'

-- Sender party type: Who sent this document?
ALTER TABLE document_classifications
ADD COLUMN IF NOT EXISTS sender_party_type VARCHAR(50);
-- Values: 'shipping_line', 'cha', 'custom_broker', 'consignee', 'shipper',
--         'forwarder', 'intoglo', 'agent', 'unknown'

-- Receiver party type: Who is the intended recipient?
ALTER TABLE document_classifications
ADD COLUMN IF NOT EXISTS receiver_party_type VARCHAR(50);

-- Workflow state: Where is this document in the approval flow?
ALTER TABLE document_classifications
ADD COLUMN IF NOT EXISTS workflow_state VARCHAR(50);
-- Values: 'received', 'pending_review', 'pending_approval', 'approved',
--         'rejected', 'released', 'forwarded', 'completed'

-- Approval required from party
ALTER TABLE document_classifications
ADD COLUMN IF NOT EXISTS requires_approval_from VARCHAR(50);
-- Values: 'shipper', 'consignee', 'cha', 'intoglo', 'none'

-- Comments for documentation
COMMENT ON COLUMN document_classifications.document_direction IS
  'Direction of document flow: inbound (received by Intoglo), outbound (sent by Intoglo)';
COMMENT ON COLUMN document_classifications.sender_party_type IS
  'Type of party that sent the document: shipping_line, cha, custom_broker, consignee, shipper, forwarder, intoglo';
COMMENT ON COLUMN document_classifications.receiver_party_type IS
  'Type of party that receives/should receive the document';
COMMENT ON COLUMN document_classifications.workflow_state IS
  'Current state in approval workflow: received, pending_approval, approved, released, etc.';

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_class_direction ON document_classifications(document_direction);
CREATE INDEX IF NOT EXISTS idx_class_sender_party ON document_classifications(sender_party_type);
CREATE INDEX IF NOT EXISTS idx_class_workflow ON document_classifications(workflow_state);

-- ----------------------------------------------------------------------------
-- PART 2: Create party_domain_mappings table for sender detection
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS party_domain_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_domain VARCHAR(200) NOT NULL,
  email_pattern VARCHAR(200), -- Optional regex pattern for specific addresses
  party_type VARCHAR(50) NOT NULL,
  party_name VARCHAR(200),
  carrier_code VARCHAR(20), -- For shipping lines (MAEU, HLCU, etc.)
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(email_domain, email_pattern)
);

CREATE INDEX IF NOT EXISTS idx_party_domain ON party_domain_mappings(email_domain);
CREATE INDEX IF NOT EXISTS idx_party_type ON party_domain_mappings(party_type);

COMMENT ON TABLE party_domain_mappings IS
  'Maps email domains/patterns to party types for automatic sender classification';

-- ----------------------------------------------------------------------------
-- PART 3: Seed common shipping line domains
-- ----------------------------------------------------------------------------
INSERT INTO party_domain_mappings (email_domain, party_type, party_name, carrier_code) VALUES
-- Maersk
('maersk.com', 'shipping_line', 'Maersk', 'MAEU'),
('apmterminals.com', 'shipping_line', 'APM Terminals (Maersk)', 'MAEU'),
-- Hapag-Lloyd
('hlag.com', 'shipping_line', 'Hapag-Lloyd', 'HLCU'),
('service.hlag.com', 'shipping_line', 'Hapag-Lloyd', 'HLCU'),
-- MSC
('msc.com', 'shipping_line', 'MSC', 'MSCU'),
('medlog.com', 'shipping_line', 'MEDLOG (MSC)', 'MSCU'),
-- CMA CGM
('cma-cgm.com', 'shipping_line', 'CMA CGM', 'CMAU'),
-- COSCO
('cosco.com', 'shipping_line', 'COSCO', 'COSU'),
('oocl.com', 'shipping_line', 'OOCL (COSCO)', 'OOLU'),
-- Evergreen
('evergreen-line.com', 'shipping_line', 'Evergreen', 'EGLV'),
-- ONE
('one-line.com', 'shipping_line', 'ONE', 'ONEY'),
-- Yang Ming
('yml.com.tw', 'shipping_line', 'Yang Ming', 'YMLU'),
-- ZIM
('zim.com', 'shipping_line', 'ZIM', 'ZIMU'),
-- Intoglo (self)
('intoglo.com', 'intoglo', 'Intoglo', NULL)
ON CONFLICT (email_domain, email_pattern) DO NOTHING;

-- ----------------------------------------------------------------------------
-- PART 4: Create document_flow_rules table for workflow automation
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS document_flow_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type VARCHAR(100) NOT NULL,
  sender_party_type VARCHAR(50) NOT NULL,
  default_receiver_party VARCHAR(50),
  default_workflow_state VARCHAR(50),
  requires_approval BOOLEAN DEFAULT false,
  approval_party VARCHAR(50),
  next_action TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

COMMENT ON TABLE document_flow_rules IS
  'Rules for automatic workflow assignment based on document type and sender';

-- Seed common document flow rules
INSERT INTO document_flow_rules
(document_type, sender_party_type, default_receiver_party, default_workflow_state, requires_approval, approval_party, next_action) VALUES
-- Arrival Notice flow
('arrival_notice', 'shipping_line', 'consignee', 'received', false, NULL, 'Forward to consignee'),
-- Booking Confirmation flow
('booking_confirmation', 'shipping_line', 'shipper', 'received', false, NULL, 'Acknowledge and file'),
('booking_amendment', 'shipping_line', 'shipper', 'received', true, 'shipper', 'Get shipper approval'),
-- Bill of Lading flow
('bill_of_lading', 'shipping_line', 'shipper', 'received', false, NULL, 'Release to shipper'),
-- Customs documents flow
('customs_document', 'custom_broker', 'shipper', 'pending_approval', true, 'shipper', 'Get shipper approval'),
-- Checklist flow
('cargo_manifest', 'cha', 'shipper', 'pending_approval', true, 'shipper', 'Get shipper approval'),
-- Invoice flow
('invoice', 'shipping_line', 'shipper', 'received', true, 'shipper', 'Get payment approval'),
('freight_invoice', 'shipping_line', 'shipper', 'received', true, 'shipper', 'Get payment approval')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- END MIGRATION 007
-- ============================================================================
