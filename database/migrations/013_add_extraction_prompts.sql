-- ============================================================================
-- MIGRATION 013: ADD EXTRACTION PROMPTS
-- ============================================================================
-- Purpose: Store document-specific and carrier-specific extraction prompts
-- Enables targeted entity extraction based on document type
-- ============================================================================

-- Extraction Prompts Table
CREATE TABLE IF NOT EXISTS extraction_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_key VARCHAR(100) NOT NULL,
  document_type VARCHAR(100) NOT NULL,
  carrier_id VARCHAR(100),  -- NULL for generic prompts

  -- Prompt Configuration
  system_prompt TEXT NOT NULL,
  extraction_instructions TEXT NOT NULL,
  expected_fields JSONB NOT NULL DEFAULT '[]',
  -- Array of: {field_name, field_type, is_required, validation_pattern}

  -- Model Settings
  model_name VARCHAR(100) DEFAULT 'claude-3-5-haiku-20241022',
  temperature DECIMAL(2,1) DEFAULT 0.0,
  max_tokens INTEGER DEFAULT 2000,

  -- Metadata
  is_active BOOLEAN DEFAULT true,
  version INTEGER DEFAULT 1,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Constraints
  UNIQUE(prompt_key, carrier_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_extract_prompt_key ON extraction_prompts(prompt_key);
CREATE INDEX IF NOT EXISTS idx_extract_prompt_doc ON extraction_prompts(document_type);
CREATE INDEX IF NOT EXISTS idx_extract_prompt_carrier ON extraction_prompts(carrier_id);
CREATE INDEX IF NOT EXISTS idx_extract_prompt_active ON extraction_prompts(is_active);

-- Comments
COMMENT ON TABLE extraction_prompts IS 'Document-specific and carrier-specific extraction prompts';
COMMENT ON COLUMN extraction_prompts.prompt_key IS 'Unique key to lookup prompt (maps to document_authority_rules)';
COMMENT ON COLUMN extraction_prompts.carrier_id IS 'Carrier-specific prompt, NULL for generic';
COMMENT ON COLUMN extraction_prompts.expected_fields IS 'Array of expected fields with types and validation';

-- ============================================================================
-- SEED DATA: Generic Extraction Prompts
-- ============================================================================

-- Booking Confirmation Extraction Prompts
INSERT INTO extraction_prompts (prompt_key, document_type, carrier_id, system_prompt, extraction_instructions, expected_fields) VALUES

-- Booking Number
('booking_number', 'booking_confirmation', NULL,
'You are a shipping document data extraction expert. Extract the booking number from this booking confirmation email.',
'Extract the booking/reference number from this email. Look for:
- Booking Number, Booking Ref, BKG No
- Reference Number, Ref No
- Carrier-specific formats (e.g., Hapag: 10 digits, Maersk: alphanumeric)

Return ONLY the booking number value, nothing else.',
'[{"field_name": "booking_number", "field_type": "string", "is_required": true, "validation_pattern": "^[A-Z0-9-]{6,20}$"}]'),

-- Port of Loading
('booking_pol', 'booking_confirmation', NULL,
'You are a shipping document data extraction expert. Extract port information from shipping documents.',
'Extract the Port of Loading (POL) from this booking confirmation.
Look for:
- Port of Loading, POL, Load Port
- Origin Port, Departure Port
- Usually the FIRST port mentioned in routing

Return the port name in UPPERCASE (e.g., MUNDRA, NHAVA SHEVA, CHENNAI).',
'[{"field_name": "port_of_loading", "field_type": "string", "is_required": true}]'),

-- Port of Loading Code
('booking_pol_code', 'booking_confirmation', NULL,
'You are a shipping document data extraction expert. Extract UN/LOCODE port codes.',
'Extract the Port of Loading UN/LOCODE from this booking confirmation.
Look for 5-character codes like:
- INMUN (Mundra), INNSA (Nhava Sheva), INMAA (Chennai)
- USNYC (New York), USLAX (Los Angeles), USSAV (Savannah)

Return ONLY the 5-character code in UPPERCASE.',
'[{"field_name": "port_of_loading_code", "field_type": "string", "is_required": false, "validation_pattern": "^[A-Z]{5}$"}]'),

-- Port of Discharge
('booking_pod', 'booking_confirmation', NULL,
'You are a shipping document data extraction expert. Extract port information from shipping documents.',
'Extract the Port of Discharge (POD) from this booking confirmation.
Look for:
- Port of Discharge, POD, Discharge Port
- Destination Port, Arrival Port
- Usually the OCEAN port where vessel arrives (not inland destinations)

Return the port name in UPPERCASE.',
'[{"field_name": "port_of_discharge", "field_type": "string", "is_required": true}]'),

-- Port of Discharge Code
('booking_pod_code', 'booking_confirmation', NULL,
'You are a shipping document data extraction expert. Extract UN/LOCODE port codes.',
'Extract the Port of Discharge UN/LOCODE from this booking confirmation.
Look for 5-character codes.

Return ONLY the 5-character code in UPPERCASE.',
'[{"field_name": "port_of_discharge_code", "field_type": "string", "is_required": false, "validation_pattern": "^[A-Z]{5}$"}]'),

-- Final Destination
('booking_fpod', 'booking_confirmation', NULL,
'You are a shipping document data extraction expert.',
'Extract the Final Place of Delivery (FPOD) from this booking confirmation.
This is the INLAND destination, which may differ from the port of discharge.
Look for:
- Final Destination, Place of Delivery, Final POD
- Inland Container Depot (ICD), Dry Port

Return the location name in UPPERCASE. If same as POD, return the POD value.',
'[{"field_name": "final_destination", "field_type": "string", "is_required": false}]'),

-- Terminal
('booking_terminal', 'booking_confirmation', NULL,
'You are a shipping document data extraction expert.',
'Extract the Terminal name from this booking confirmation.
Look for:
- Terminal, Container Terminal
- CFS (Container Freight Station)
- Specific terminal names like APM, DP World, PSA

Return the terminal name.',
'[{"field_name": "terminal", "field_type": "string", "is_required": false}]'),

-- Vessel Name
('booking_vessel', 'booking_confirmation', NULL,
'You are a shipping document data extraction expert.',
'Extract the Vessel Name from this booking confirmation.
Look for:
- Vessel, Mother Vessel, M/V
- Ship Name, Vessel Name
- Usually followed by voyage number

Return ONLY the vessel name (not voyage number).',
'[{"field_name": "vessel_name", "field_type": "string", "is_required": false}]'),

-- Voyage Number
('booking_voyage', 'booking_confirmation', NULL,
'You are a shipping document data extraction expert.',
'Extract the Voyage Number from this booking confirmation.
Look for:
- Voyage, Voy No, V.
- Usually alphanumeric (e.g., 301S, 452E)

Return ONLY the voyage number.',
'[{"field_name": "voyage_number", "field_type": "string", "is_required": false}]'),

-- ETD (Estimated Time of Departure)
('booking_etd', 'booking_confirmation', NULL,
'You are a shipping document data extraction expert.',
'Extract the ETD (Estimated Time of Departure) from this booking confirmation.
This is when the VESSEL departs from the port of loading.
Look for:
- ETD, Estimated Departure, Departure Date
- Vessel ETD, Sailing Date

Return in ISO format: YYYY-MM-DD',
'[{"field_name": "etd", "field_type": "date", "is_required": true, "validation_pattern": "^\\d{4}-\\d{2}-\\d{2}$"}]'),

-- ETA (Estimated Time of Arrival)
('booking_eta', 'booking_confirmation', NULL,
'You are a shipping document data extraction expert.',
'Extract the ETA (Estimated Time of Arrival) from this booking confirmation.
This is when the VESSEL arrives at the port of discharge.
Look for:
- ETA, Estimated Arrival, Arrival Date
- Vessel ETA

Return in ISO format: YYYY-MM-DD',
'[{"field_name": "eta", "field_type": "date", "is_required": false, "validation_pattern": "^\\d{4}-\\d{2}-\\d{2}$"}]'),

-- SI Cutoff
('booking_si_cutoff', 'booking_confirmation', NULL,
'You are a shipping document data extraction expert.',
'Extract the SI (Shipping Instructions) Cutoff from this booking confirmation.
Look for:
- SI Cutoff, SI Cut-off
- Documentation Deadline, Doc Cutoff

Return in ISO format: YYYY-MM-DDTHH:MM:SS',
'[{"field_name": "si_cutoff", "field_type": "datetime", "is_required": false}]'),

-- VGM Cutoff
('booking_vgm_cutoff', 'booking_confirmation', NULL,
'You are a shipping document data extraction expert.',
'Extract the VGM (Verified Gross Mass) Cutoff from this booking confirmation.
Look for:
- VGM Cutoff, VGM Cut-off
- Weight Declaration Deadline

Return in ISO format: YYYY-MM-DDTHH:MM:SS',
'[{"field_name": "vgm_cutoff", "field_type": "datetime", "is_required": false}]'),

-- Cargo Cutoff
('booking_cargo_cutoff', 'booking_confirmation', NULL,
'You are a shipping document data extraction expert.',
'Extract the Cargo/Gate Cutoff from this booking confirmation.
Look for:
- Cargo Cutoff, Gate Cutoff
- Port Cutoff, CY Cutoff
- Container Yard Deadline

Return in ISO format: YYYY-MM-DDTHH:MM:SS',
'[{"field_name": "cargo_cutoff", "field_type": "datetime", "is_required": false}]')

ON CONFLICT (prompt_key, carrier_id) DO UPDATE SET
  system_prompt = EXCLUDED.system_prompt,
  extraction_instructions = EXCLUDED.extraction_instructions,
  expected_fields = EXCLUDED.expected_fields,
  updated_at = NOW();

-- ============================================================================
-- SI Draft Extraction Prompts (MASTER SOURCE)
-- ============================================================================

INSERT INTO extraction_prompts (prompt_key, document_type, carrier_id, system_prompt, extraction_instructions, expected_fields) VALUES

('si_shipper_name', 'si_draft', NULL,
'You are a shipping document expert extracting party information from Shipping Instructions.',
'Extract the SHIPPER name from this SI Draft.
The shipper is the party sending the goods.
Look for:
- Shipper, Exporter, Seller
- Company name under "Shipper" section

Return the FULL legal company name.',
'[{"field_name": "shipper_name", "field_type": "string", "is_required": true}]'),

('si_shipper_address', 'si_draft', NULL,
'You are a shipping document expert.',
'Extract the complete SHIPPER ADDRESS from this SI Draft.
Include: Street, City, State/Province, Country, Postal Code

Return the full formatted address.',
'[{"field_name": "shipper_address", "field_type": "string", "is_required": true}]'),

('si_consignee_name', 'si_draft', NULL,
'You are a shipping document expert.',
'Extract the CONSIGNEE name from this SI Draft.
The consignee is the party receiving the goods.
Look for:
- Consignee, Buyer, Receiver
- Company name under "Consignee" section

Return the FULL legal company name.',
'[{"field_name": "consignee_name", "field_type": "string", "is_required": true}]'),

('si_consignee_address', 'si_draft', NULL,
'You are a shipping document expert.',
'Extract the complete CONSIGNEE ADDRESS from this SI Draft.
Include: Street, City, State/Province, Country, Postal Code

Return the full formatted address.',
'[{"field_name": "consignee_address", "field_type": "string", "is_required": true}]'),

('si_notify_name', 'si_draft', NULL,
'You are a shipping document expert.',
'Extract the NOTIFY PARTY name from this SI Draft.
Look for:
- Notify Party, Notify
- Often same as consignee

Return the FULL company name.',
'[{"field_name": "notify_party_name", "field_type": "string", "is_required": false}]'),

('si_notify_address', 'si_draft', NULL,
'You are a shipping document expert.',
'Extract the complete NOTIFY PARTY ADDRESS from this SI Draft.

Return the full formatted address.',
'[{"field_name": "notify_party_address", "field_type": "string", "is_required": false}]'),

('si_cargo_desc', 'si_draft', NULL,
'You are a shipping document expert.',
'Extract the CARGO DESCRIPTION from this SI Draft.
Look for:
- Description of Goods, Cargo Description
- Commodity, Product Description

Return the complete description as written.',
'[{"field_name": "cargo_description", "field_type": "string", "is_required": true}]'),

('si_hs_code', 'si_draft', NULL,
'You are a shipping document expert.',
'Extract the HS CODE from this SI Draft.
Look for:
- HS Code, Harmonized Code
- Tariff Code, Commodity Code
- Usually 6-10 digits

Return the HS code(s).',
'[{"field_name": "hs_code", "field_type": "string", "is_required": false, "validation_pattern": "^[0-9.]{6,}$"}]'),

('si_marks', 'si_draft', NULL,
'You are a shipping document expert.',
'Extract the MARKS & NUMBERS from this SI Draft.
Look for:
- Shipping Marks, Marks & Numbers
- Container Marks

Return as written.',
'[{"field_name": "marks_numbers", "field_type": "string", "is_required": false}]'),

('si_containers', 'si_draft', NULL,
'You are a shipping document expert.',
'Extract all CONTAINER NUMBERS from this SI Draft.
Container numbers are 11 characters: 4 letters + 7 digits (e.g., HLXU1234567)

Return as comma-separated list.',
'[{"field_name": "container_numbers", "field_type": "string", "is_required": false, "validation_pattern": "^[A-Z]{4}\\d{7}$"}]'),

('si_seals', 'si_draft', NULL,
'You are a shipping document expert.',
'Extract all SEAL NUMBERS from this SI Draft.
Look for:
- Seal No, Seal Number
- Usually alphanumeric

Return as comma-separated list.',
'[{"field_name": "seal_numbers", "field_type": "string", "is_required": false}]'),

('si_weight', 'si_draft', NULL,
'You are a shipping document expert.',
'Extract the TOTAL GROSS WEIGHT from this SI Draft.
Look for:
- Gross Weight, Total Weight
- Usually in KG or MT

Return the numeric value only.',
'[{"field_name": "total_weight", "field_type": "number", "is_required": true}]'),

('si_weight_unit', 'si_draft', NULL,
'You are a shipping document expert.',
'Extract the WEIGHT UNIT from this SI Draft.
Common units:
- KG, KGS (Kilograms)
- MT, MTS (Metric Tons)
- LBS (Pounds)

Return the unit abbreviation.',
'[{"field_name": "weight_unit", "field_type": "string", "is_required": false}]')

ON CONFLICT (prompt_key, carrier_id) DO UPDATE SET
  system_prompt = EXCLUDED.system_prompt,
  extraction_instructions = EXCLUDED.extraction_instructions,
  expected_fields = EXCLUDED.expected_fields,
  updated_at = NOW();

-- ============================================================================
-- House BL Extraction Prompts
-- ============================================================================

INSERT INTO extraction_prompts (prompt_key, document_type, carrier_id, system_prompt, extraction_instructions, expected_fields) VALUES

('hbl_number', 'house_bl', NULL,
'You are a shipping document expert.',
'Extract the HOUSE B/L NUMBER from this document.
Look for:
- B/L No, BL Number, Bill of Lading Number
- House B/L, HBL Number

Return the B/L number.',
'[{"field_name": "bl_number", "field_type": "string", "is_required": true}]'),

('hbl_delivery_address', 'house_bl', NULL,
'You are a shipping document expert.',
'Extract the PLACE OF DELIVERY / DELIVERY ADDRESS from this House B/L.
Look for:
- Place of Delivery, Final Destination
- Delivery Address

Return the full address.',
'[{"field_name": "delivery_address", "field_type": "string", "is_required": false}]'),

('hbl_freight_terms', 'house_bl', NULL,
'You are a shipping document expert.',
'Extract the FREIGHT TERMS from this House B/L.
Look for:
- Freight Prepaid, Freight Collect
- Payment Terms

Return: PREPAID or COLLECT.',
'[{"field_name": "freight_terms", "field_type": "string", "is_required": false}]')

ON CONFLICT (prompt_key, carrier_id) DO UPDATE SET
  system_prompt = EXCLUDED.system_prompt,
  extraction_instructions = EXCLUDED.extraction_instructions,
  expected_fields = EXCLUDED.expected_fields,
  updated_at = NOW();

-- ============================================================================
-- Arrival Notice Extraction Prompts
-- ============================================================================

INSERT INTO extraction_prompts (prompt_key, document_type, carrier_id, system_prompt, extraction_instructions, expected_fields) VALUES

('an_eta', 'arrival_notice', NULL,
'You are a shipping document expert.',
'Extract the FINAL ETA from this Arrival Notice.
This may be updated from the original booking ETA.
Look for:
- ETA, Expected Arrival
- Vessel Arrival Date

Return in ISO format: YYYY-MM-DD',
'[{"field_name": "eta", "field_type": "date", "is_required": true}]'),

('an_it_number', 'arrival_notice', NULL,
'You are a shipping document expert.',
'Extract the IT NUMBER (In-Transit/Immediate Transportation Number) from this Arrival Notice.
Look for:
- IT Number, IT#
- In-Transit Number
- US Customs IT

Return the IT number.',
'[{"field_name": "it_number", "field_type": "string", "is_required": false}]'),

('an_arrival_date', 'arrival_notice', NULL,
'You are a shipping document expert.',
'Extract the ACTUAL ARRIVAL DATE from this Arrival Notice.
Look for:
- Arrival Date, Vessel Arrived
- Actual Arrival

Return in ISO format: YYYY-MM-DD',
'[{"field_name": "arrival_date", "field_type": "date", "is_required": false}]'),

('an_terminal', 'arrival_notice', NULL,
'You are a shipping document expert.',
'Extract the DISCHARGE TERMINAL from this Arrival Notice.
Look for:
- Discharge Terminal, Port Terminal
- Container Terminal

Return the terminal name.',
'[{"field_name": "discharge_terminal", "field_type": "string", "is_required": false}]'),

('an_free_time', 'arrival_notice', NULL,
'You are a shipping document expert.',
'Extract the FREE TIME EXPIRY DATE from this Arrival Notice.
Look for:
- Free Time Expires, Last Free Day
- Demurrage Starts

Return in ISO format: YYYY-MM-DD',
'[{"field_name": "free_time_expires", "field_type": "date", "is_required": false}]')

ON CONFLICT (prompt_key, carrier_id) DO UPDATE SET
  system_prompt = EXCLUDED.system_prompt,
  extraction_instructions = EXCLUDED.extraction_instructions,
  expected_fields = EXCLUDED.expected_fields,
  updated_at = NOW();

-- ============================================================================
-- Duty Summary Extraction Prompts
-- ============================================================================

INSERT INTO extraction_prompts (prompt_key, document_type, carrier_id, system_prompt, extraction_instructions, expected_fields) VALUES

('duty_amount', 'duty_summary', NULL,
'You are a customs document expert.',
'Extract the TOTAL DUTY AMOUNT from this Duty Summary.
Look for:
- Total Duty, Duty Amount
- Customs Duty, Import Duty

Return the numeric value only.',
'[{"field_name": "duty_amount", "field_type": "number", "is_required": true}]'),

('duty_currency', 'duty_summary', NULL,
'You are a customs document expert.',
'Extract the DUTY CURRENCY from this Duty Summary.
Look for:
- USD, EUR, INR, etc.
- Currency symbol or code

Return the 3-letter currency code.',
'[{"field_name": "duty_currency", "field_type": "string", "is_required": true, "validation_pattern": "^[A-Z]{3}$"}]'),

('duty_hs_code', 'duty_summary', NULL,
'You are a customs document expert.',
'Extract the CUSTOMS-CONFIRMED HS CODE from this Duty Summary.
This is the official HS code used by customs, which may differ from shipper-provided.
Look for:
- HS Code, Tariff Classification
- HTS Code (US)

Return the HS code.',
'[{"field_name": "hs_code_customs", "field_type": "string", "is_required": false}]'),

('duty_entry_number', 'duty_summary', NULL,
'You are a customs document expert.',
'Extract the ENTRY NUMBER from this Duty Summary.
Look for:
- Entry Number, Entry No
- Customs Entry, Import Entry

Return the entry number.',
'[{"field_name": "entry_number", "field_type": "string", "is_required": false}]'),

('duty_entry_date', 'duty_summary', NULL,
'You are a customs document expert.',
'Extract the ENTRY DATE from this Duty Summary.
Look for:
- Entry Date, Filing Date
- Customs Entry Date

Return in ISO format: YYYY-MM-DD',
'[{"field_name": "entry_date", "field_type": "date", "is_required": false}]')

ON CONFLICT (prompt_key, carrier_id) DO UPDATE SET
  system_prompt = EXCLUDED.system_prompt,
  extraction_instructions = EXCLUDED.extraction_instructions,
  expected_fields = EXCLUDED.expected_fields,
  updated_at = NOW();

-- ============================================================================
-- END MIGRATION 013
-- ============================================================================
