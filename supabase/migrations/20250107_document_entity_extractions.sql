-- Document Entity Extractions Table
-- Stores structured data extracted from classified documents using schema-based extraction

CREATE TABLE IF NOT EXISTS document_entity_extractions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_attachment_id UUID NOT NULL REFERENCES raw_attachments(id) ON DELETE CASCADE,
  document_type VARCHAR(100) NOT NULL,
  extraction_confidence DECIMAL(3,2) DEFAULT 0,

  -- Extracted structured data (JSONB for flexibility)
  fields JSONB NOT NULL DEFAULT '{}',      -- All extracted fields (bl_number, booking_number, etd, etc.)
  parties JSONB NOT NULL DEFAULT '{}',     -- Extracted party information (shipper, consignee, notify_party)
  tables JSONB NOT NULL DEFAULT '[]',      -- Extracted tables (line_items, charges, etc.)

  -- Metadata
  extracted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  -- Ensure one extraction per attachment
  CONSTRAINT unique_attachment_extraction UNIQUE (raw_attachment_id)
);

-- Indexes for common queries
CREATE INDEX idx_doc_extractions_document_type ON document_entity_extractions(document_type);
CREATE INDEX idx_doc_extractions_confidence ON document_entity_extractions(extraction_confidence);
CREATE INDEX idx_doc_extractions_created_at ON document_entity_extractions(created_at);

-- GIN indexes for JSONB queries
CREATE INDEX idx_doc_extractions_fields ON document_entity_extractions USING GIN (fields);
CREATE INDEX idx_doc_extractions_parties ON document_entity_extractions USING GIN (parties);

-- Update trigger for updated_at
CREATE OR REPLACE FUNCTION update_doc_extractions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_doc_extractions_updated_at
  BEFORE UPDATE ON document_entity_extractions
  FOR EACH ROW
  EXECUTE FUNCTION update_doc_extractions_updated_at();

-- Comments
COMMENT ON TABLE document_entity_extractions IS 'Stores structured entities extracted from classified documents';
COMMENT ON COLUMN document_entity_extractions.fields IS 'Extracted field values (bl_number, booking_number, dates, amounts, etc.)';
COMMENT ON COLUMN document_entity_extractions.parties IS 'Extracted party information (shipper, consignee, notify_party with addresses)';
COMMENT ON COLUMN document_entity_extractions.tables IS 'Extracted table data (line_items, charges, container_details)';
