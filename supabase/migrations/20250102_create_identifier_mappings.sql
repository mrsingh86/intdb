-- Create identifier_mappings table
-- Maps relationships between booking numbers, containers, BLs, MBLs, HBLs
-- Enables fallback linking when only secondary identifiers are available

CREATE TABLE IF NOT EXISTS identifier_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Core identifiers (at least one must be non-null)
  booking_number VARCHAR(50),
  container_number VARCHAR(20),
  bl_number VARCHAR(50),
  mbl_number VARCHAR(50),
  hbl_number VARCHAR(50),

  -- Metadata
  source VARCHAR(30) NOT NULL, -- 'email_extraction', 'carrier_api', 'manual'
  source_email_id UUID REFERENCES raw_emails(id),
  confidence_score INTEGER DEFAULT 80,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Ensure at least booking + one other identifier
  CONSTRAINT at_least_two_identifiers CHECK (
    booking_number IS NOT NULL AND (
      container_number IS NOT NULL OR
      bl_number IS NOT NULL OR
      mbl_number IS NOT NULL OR
      hbl_number IS NOT NULL
    )
  )
);

-- Indexes for fast lookups
CREATE INDEX idx_identifier_mappings_booking ON identifier_mappings(booking_number);
CREATE INDEX idx_identifier_mappings_container ON identifier_mappings(container_number);
CREATE INDEX idx_identifier_mappings_bl ON identifier_mappings(bl_number);
CREATE INDEX idx_identifier_mappings_mbl ON identifier_mappings(mbl_number);
CREATE INDEX idx_identifier_mappings_hbl ON identifier_mappings(hbl_number);

-- Unique constraint to prevent duplicate mappings
CREATE UNIQUE INDEX idx_identifier_mappings_unique ON identifier_mappings(
  COALESCE(booking_number, ''),
  COALESCE(container_number, ''),
  COALESCE(bl_number, ''),
  COALESCE(mbl_number, ''),
  COALESCE(hbl_number, '')
);

COMMENT ON TABLE identifier_mappings IS 'Maps relationships between shipping identifiers extracted from emails';
COMMENT ON COLUMN identifier_mappings.booking_number IS 'Carrier booking number (primary identifier)';
COMMENT ON COLUMN identifier_mappings.container_number IS 'Container number (ISO 6346 format)';
COMMENT ON COLUMN identifier_mappings.bl_number IS 'Bill of Lading number';
COMMENT ON COLUMN identifier_mappings.mbl_number IS 'Master Bill of Lading number';
COMMENT ON COLUMN identifier_mappings.hbl_number IS 'House Bill of Lading number';
COMMENT ON COLUMN identifier_mappings.source IS 'How this mapping was discovered';
