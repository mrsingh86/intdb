-- ============================================================================
-- Migration 037: Sender-Specific Extraction Configurations
-- ============================================================================
--
-- Creates comprehensive entity type definitions and sender-specific extraction
-- configurations for targeted extraction based on email source category.
--
-- Entity Categories:
-- 1. Identifiers (booking, container, BL, entry numbers)
-- 2. Dates & Cutoffs (ETD, ETA, SI/VGM/cargo cutoffs, free time)
-- 3. Ports & Locations (POL, POD, inland destinations, terminals)
-- 4. Parties (shipper, consignee, agents, customs brokers)
-- 5. Cargo Details (commodity, HS code, weight, dimensions)
-- 6. Financial (freight, duties, demurrage, detention)
-- 7. Customs & Compliance (IT#, ISF#, AMS#, exam dates)
-- 8. Container Details (seal, type, tare weight)
-- 9. Transport (vessel, voyage, rail, trucking)
-- ============================================================================

-- ============================================================================
-- 1. Master Entity Types Table (50+ entity types)
-- ============================================================================

DROP TABLE IF EXISTS extraction_entity_types CASCADE;

CREATE TABLE extraction_entity_types (
  id VARCHAR(50) PRIMARY KEY,
  display_name VARCHAR(100) NOT NULL,
  category VARCHAR(30) NOT NULL,
  description TEXT,
  data_type VARCHAR(20) NOT NULL DEFAULT 'string',
  validation_regex TEXT,
  normalization_rule VARCHAR(50),
  is_critical BOOLEAN DEFAULT false,
  is_linkable BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 100,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on category for filtering
CREATE INDEX idx_entity_types_category ON extraction_entity_types(category);

-- ============================================================================
-- Insert Entity Types by Category
-- ============================================================================

-- IDENTIFIERS (Primary linking fields)
INSERT INTO extraction_entity_types (id, display_name, category, description, data_type, is_critical, is_linkable, sort_order) VALUES
('booking_number', 'Booking Number', 'identifier', 'Carrier booking confirmation number', 'string', true, true, 1),
('container_number', 'Container Number', 'identifier', 'ISO 6346 container ID (4 letters + 7 digits)', 'string', true, true, 2),
('bl_number', 'Bill of Lading Number', 'identifier', 'Master or House BL number', 'string', true, true, 3),
('hbl_number', 'House BL Number', 'identifier', 'Forwarder-issued House BL', 'string', true, true, 4),
('mbl_number', 'Master BL Number', 'identifier', 'Carrier-issued Master BL', 'string', true, true, 5),
('entry_number', 'Customs Entry Number', 'identifier', 'US Customs entry (XXX-XXXXXXX-X)', 'string', true, true, 6),
('job_number', 'Job/File Number', 'identifier', 'Forwarder internal reference', 'string', false, true, 7),
('po_number', 'Purchase Order Number', 'identifier', 'Customer PO reference', 'string', false, true, 8),
('invoice_number', 'Invoice Number', 'identifier', 'Commercial or freight invoice number', 'string', false, true, 9),
('reference_number', 'Reference Number', 'identifier', 'Generic customer reference', 'string', false, true, 10);

-- DATES (Sailing & Arrival)
INSERT INTO extraction_entity_types (id, display_name, category, description, data_type, is_critical, sort_order) VALUES
('etd', 'ETD', 'date', 'Estimated Time of Departure', 'datetime', true, 20),
('eta', 'ETA', 'date', 'Estimated Time of Arrival', 'datetime', true, 21),
('atd', 'ATD', 'date', 'Actual Time of Departure', 'datetime', false, 22),
('ata', 'ATA', 'date', 'Actual Time of Arrival', 'datetime', false, 23),
('sailing_date', 'Sailing Date', 'date', 'Vessel departure date', 'datetime', false, 24),
('arrival_date', 'Arrival Date', 'date', 'Vessel arrival date', 'datetime', false, 25);

-- CUTOFFS (Critical operational deadlines)
INSERT INTO extraction_entity_types (id, display_name, category, description, data_type, is_critical, sort_order) VALUES
('si_cutoff', 'SI Cutoff', 'cutoff', 'Shipping Instructions submission deadline', 'datetime', true, 30),
('vgm_cutoff', 'VGM Cutoff', 'cutoff', 'Verified Gross Mass submission deadline', 'datetime', true, 31),
('cargo_cutoff', 'Cargo Cutoff', 'cutoff', 'Container delivery to terminal deadline', 'datetime', true, 32),
('gate_cutoff', 'Gate Cutoff', 'cutoff', 'Terminal gate closing time', 'datetime', true, 33),
('doc_cutoff', 'Documentation Cutoff', 'cutoff', 'Document submission deadline', 'datetime', false, 34),
('port_cutoff', 'Port Cutoff', 'cutoff', 'Port-specific closing time', 'datetime', false, 35),
('amendment_cutoff', 'Amendment Cutoff', 'cutoff', 'Last date to amend booking/SI', 'datetime', false, 36),
('isf_cutoff', 'ISF Cutoff', 'cutoff', 'ISF 10+2 filing deadline (24h before loading)', 'datetime', false, 37),
('ams_cutoff', 'AMS Cutoff', 'cutoff', 'AMS manifest filing deadline', 'datetime', false, 38);

-- PORTS & LOCATIONS
INSERT INTO extraction_entity_types (id, display_name, category, description, data_type, is_critical, sort_order) VALUES
('port_of_loading', 'Port of Loading', 'location', 'Origin port (POL)', 'string', true, 40),
('port_of_discharge', 'Port of Discharge', 'location', 'Destination port (POD)', 'string', true, 41),
('place_of_receipt', 'Place of Receipt', 'location', 'Inland origin/pickup location', 'string', false, 42),
('place_of_delivery', 'Place of Delivery', 'location', 'Inland final destination', 'string', false, 43),
('transshipment_port', 'Transshipment Port', 'location', 'Intermediate port(s)', 'string', false, 44),
('terminal_name', 'Terminal Name', 'location', 'Origin/destination terminal', 'string', false, 45),
('depot_location', 'Depot Location', 'location', 'Empty container pickup/return', 'string', false, 46),
('warehouse_location', 'Warehouse Location', 'location', 'CFS/warehouse address', 'string', false, 47),
('pickup_location', 'Pickup Location', 'location', 'Cargo/container pickup address', 'string', false, 48),
('delivery_location', 'Delivery Location', 'location', 'Final delivery address', 'string', false, 49),
('inland_destination', 'Inland Destination', 'location', 'IPI inland point', 'string', false, 50),
('ramp_location', 'Ramp Location', 'location', 'Rail ramp/intermodal facility', 'string', false, 51);

-- PARTIES
INSERT INTO extraction_entity_types (id, display_name, category, description, data_type, sort_order) VALUES
('shipper_name', 'Shipper', 'party', 'Exporter/shipper name', 'string', 60),
('consignee_name', 'Consignee', 'party', 'Importer/consignee name', 'string', 61),
('notify_party', 'Notify Party', 'party', 'Party to notify on arrival', 'string', 62),
('carrier_name', 'Carrier', 'party', 'Shipping line/carrier name', 'string', 63),
('freight_forwarder', 'Freight Forwarder', 'party', 'NVOCC/forwarder name', 'string', 64),
('customs_broker', 'Customs Broker', 'party', 'Licensed customs broker', 'string', 65),
('trucking_company', 'Trucking Company', 'party', 'Drayage/trucking provider', 'string', 66),
('contact_name', 'Contact Name', 'party', 'Contact person name', 'string', 67),
('contact_email', 'Contact Email', 'party', 'Contact email address', 'email', 68),
('contact_phone', 'Contact Phone', 'party', 'Contact phone number', 'phone', 69);

-- CARGO DETAILS
INSERT INTO extraction_entity_types (id, display_name, category, description, data_type, sort_order) VALUES
('commodity', 'Commodity', 'cargo', 'Cargo description', 'string', 70),
('hs_code', 'HS Code', 'cargo', 'Harmonized System tariff code', 'string', 71),
('gross_weight_kg', 'Gross Weight (KG)', 'cargo', 'Total weight including packaging', 'number', 72),
('net_weight_kg', 'Net Weight (KG)', 'cargo', 'Weight of goods only', 'number', 73),
('volume_cbm', 'Volume (CBM)', 'cargo', 'Cubic meter measurement', 'number', 74),
('package_count', 'Package Count', 'cargo', 'Number of packages/pieces', 'number', 75),
('package_type', 'Package Type', 'cargo', 'Cartons, pallets, drums, etc.', 'string', 76),
('cargo_value', 'Cargo Value', 'cargo', 'Declared commercial value', 'money', 77),
('incoterms', 'Incoterms', 'cargo', 'Trade terms (FOB, CIF, etc.)', 'string', 78),
('hazmat_class', 'Hazmat Class', 'cargo', 'UN hazard class if applicable', 'string', 79),
('temperature_setting', 'Temperature', 'cargo', 'Reefer temperature setting', 'string', 80);

-- CONTAINER DETAILS
INSERT INTO extraction_entity_types (id, display_name, category, description, data_type, sort_order) VALUES
('seal_number', 'Seal Number', 'container', 'Container seal ID', 'string', 85),
('container_type', 'Container Type', 'container', '20DC, 40HC, 40RF, etc.', 'string', 86),
('container_size', 'Container Size', 'container', '20, 40, 45 foot', 'string', 87),
('tare_weight_kg', 'Tare Weight (KG)', 'container', 'Empty container weight', 'number', 88),
('vgm_weight_kg', 'VGM Weight (KG)', 'container', 'Verified gross mass', 'number', 89),
('container_status', 'Container Status', 'container', 'Empty, loaded, etc.', 'string', 90);

-- TRANSPORT
INSERT INTO extraction_entity_types (id, display_name, category, description, data_type, sort_order) VALUES
('vessel_name', 'Vessel Name', 'transport', 'Ship/vessel name', 'string', 100),
('voyage_number', 'Voyage Number', 'transport', 'Voyage/rotation number', 'string', 101),
('imo_number', 'IMO Number', 'transport', 'Vessel IMO identifier', 'string', 102),
('service_name', 'Service Name', 'transport', 'Carrier service route name', 'string', 103),
('feeder_vessel', 'Feeder Vessel', 'transport', 'Feeder vessel name', 'string', 104),
('mother_vessel', 'Mother Vessel', 'transport', 'Mother/main vessel name', 'string', 105),
('rail_carrier', 'Rail Carrier', 'transport', 'Rail company name', 'string', 106),
('train_number', 'Train Number', 'transport', 'Rail car/train ID', 'string', 107),
('truck_number', 'Truck Number', 'transport', 'Truck/trailer ID', 'string', 108),
('driver_name', 'Driver Name', 'transport', 'Truck driver name', 'string', 109);

-- CUSTOMS & COMPLIANCE
INSERT INTO extraction_entity_types (id, display_name, category, description, data_type, is_critical, sort_order) VALUES
('it_number', 'IT Number', 'customs', 'In-Transit/Immediate Transportation number', 'string', true, 110),
('isf_number', 'ISF Number', 'customs', 'Importer Security Filing number', 'string', false, 111),
('ams_number', 'AMS Number', 'customs', 'Automated Manifest System number', 'string', false, 112),
('bond_number', 'Bond Number', 'customs', 'Customs bond number', 'string', false, 113),
('customs_entry_date', 'Entry Date', 'customs', 'Customs entry filing date', 'datetime', false, 114),
('exam_date', 'Exam Date', 'customs', 'Customs examination date', 'datetime', false, 115),
('release_date', 'Release Date', 'customs', 'Customs release date', 'datetime', false, 116),
('hold_type', 'Hold Type', 'customs', 'Type of customs hold', 'string', false, 117),
('duty_rate', 'Duty Rate', 'customs', 'Applied duty percentage', 'number', false, 118);

-- FINANCIAL
INSERT INTO extraction_entity_types (id, display_name, category, description, data_type, sort_order) VALUES
('freight_amount', 'Ocean Freight', 'financial', 'Ocean freight charges', 'money', 120),
('duty_amount', 'Duty Amount', 'financial', 'Customs duties payable', 'money', 121),
('demurrage_amount', 'Demurrage', 'financial', 'Port demurrage charges', 'money', 122),
('detention_amount', 'Detention', 'financial', 'Container detention charges', 'money', 123),
('handling_charges', 'Handling Charges', 'financial', 'Terminal handling fees', 'money', 124),
('documentation_fee', 'Documentation Fee', 'financial', 'BL/documentation charges', 'money', 125),
('total_amount', 'Total Amount', 'financial', 'Total invoice amount', 'money', 126),
('currency', 'Currency', 'financial', 'Currency code (USD, EUR, etc.)', 'string', 127),
('payment_terms', 'Payment Terms', 'financial', 'Prepaid, collect, etc.', 'string', 128);

-- FREE TIME & DEMURRAGE
INSERT INTO extraction_entity_types (id, display_name, category, description, data_type, sort_order) VALUES
('free_time_days', 'Free Time (Days)', 'demurrage', 'Number of free days', 'number', 130),
('free_time_expiry', 'Free Time Expiry', 'demurrage', 'Last free day date', 'datetime', 131),
('last_free_day', 'Last Free Day', 'demurrage', 'LFD for container pickup', 'datetime', 132),
('demurrage_start', 'Demurrage Start', 'demurrage', 'Demurrage start date', 'datetime', 133),
('detention_start', 'Detention Start', 'demurrage', 'Detention start date', 'datetime', 134),
('per_diem_rate', 'Per Diem Rate', 'demurrage', 'Daily demurrage/detention rate', 'money', 135),
('cargo_available_date', 'Cargo Available', 'demurrage', 'Date cargo available for pickup', 'datetime', 136),
('empty_return_date', 'Empty Return By', 'demurrage', 'Deadline to return empty container', 'datetime', 137);

-- OPERATIONAL
INSERT INTO extraction_entity_types (id, display_name, category, description, data_type, sort_order) VALUES
('pickup_date', 'Pickup Date', 'operational', 'Scheduled cargo pickup', 'datetime', 140),
('delivery_date', 'Delivery Date', 'operational', 'Scheduled delivery date', 'datetime', 141),
('empty_pickup_date', 'Empty Pickup Date', 'operational', 'Date to pick up empty container', 'datetime', 142),
('empty_return_location', 'Empty Return Location', 'operational', 'Where to return empty container', 'string', 143),
('appointment_number', 'Appointment Number', 'operational', 'Terminal/delivery appointment', 'string', 144),
('appointment_date', 'Appointment Date', 'operational', 'Scheduled appointment datetime', 'datetime', 145),
('gate_in_date', 'Gate In Date', 'operational', 'Container gate-in at terminal', 'datetime', 146),
('gate_out_date', 'Gate Out Date', 'operational', 'Container gate-out from terminal', 'datetime', 147);

-- ============================================================================
-- 2. Sender Extraction Configs Table
-- ============================================================================

CREATE TABLE sender_extraction_configs (
  id SERIAL PRIMARY KEY,
  sender_category VARCHAR(50) NOT NULL,
  source_type VARCHAR(20) NOT NULL CHECK (source_type IN ('email', 'document', 'both')),
  entity_type_id VARCHAR(50) NOT NULL REFERENCES extraction_entity_types(id),
  priority INTEGER NOT NULL DEFAULT 50,
  is_required BOOLEAN DEFAULT false,
  confidence_threshold INTEGER DEFAULT 75,
  extraction_hints JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(sender_category, source_type, entity_type_id)
);

-- Create indexes
CREATE INDEX idx_sender_config_category ON sender_extraction_configs(sender_category);
CREATE INDEX idx_sender_config_source ON sender_extraction_configs(source_type);
CREATE INDEX idx_sender_config_entity ON sender_extraction_configs(entity_type_id);

-- ============================================================================
-- 3. Insert Sender-Specific Extraction Priorities
-- ============================================================================

-- MAERSK (Carrier - Focus on booking/operational data)
INSERT INTO sender_extraction_configs (sender_category, source_type, entity_type_id, priority, is_required, confidence_threshold) VALUES
-- Email extractions
('maersk', 'email', 'booking_number', 100, true, 85),
('maersk', 'email', 'container_number', 95, true, 90),
('maersk', 'email', 'vessel_name', 90, true, 80),
('maersk', 'email', 'voyage_number', 85, true, 80),
('maersk', 'email', 'etd', 90, true, 80),
('maersk', 'email', 'eta', 90, true, 80),
('maersk', 'email', 'si_cutoff', 85, false, 75),
('maersk', 'email', 'vgm_cutoff', 85, false, 75),
('maersk', 'email', 'cargo_cutoff', 85, false, 75),
('maersk', 'email', 'gate_cutoff', 80, false, 75),
('maersk', 'email', 'port_of_loading', 80, true, 80),
('maersk', 'email', 'port_of_discharge', 80, true, 80),
('maersk', 'email', 'terminal_name', 70, false, 70),
-- Document extractions
('maersk', 'document', 'booking_number', 100, true, 90),
('maersk', 'document', 'bl_number', 100, true, 90),
('maersk', 'document', 'container_number', 95, true, 90),
('maersk', 'document', 'shipper_name', 80, false, 75),
('maersk', 'document', 'consignee_name', 80, false, 75),
('maersk', 'document', 'port_of_loading', 90, true, 85),
('maersk', 'document', 'port_of_discharge', 90, true, 85),
('maersk', 'document', 'place_of_receipt', 70, false, 70),
('maersk', 'document', 'place_of_delivery', 70, false, 70),
('maersk', 'document', 'gross_weight_kg', 75, false, 80),
('maersk', 'document', 'volume_cbm', 70, false, 75),
('maersk', 'document', 'package_count', 65, false, 70),
('maersk', 'document', 'commodity', 60, false, 65),
('maersk', 'document', 'seal_number', 60, false, 75),
('maersk', 'document', 'container_type', 65, false, 80);

-- HAPAG-LLOYD (Carrier - Similar to Maersk)
INSERT INTO sender_extraction_configs (sender_category, source_type, entity_type_id, priority, is_required, confidence_threshold) VALUES
('hapag', 'email', 'booking_number', 100, true, 85),
('hapag', 'email', 'container_number', 95, true, 90),
('hapag', 'email', 'vessel_name', 90, true, 80),
('hapag', 'email', 'voyage_number', 85, true, 80),
('hapag', 'email', 'etd', 90, true, 80),
('hapag', 'email', 'eta', 85, false, 75),
('hapag', 'email', 'si_cutoff', 85, false, 75),
('hapag', 'email', 'vgm_cutoff', 85, false, 75),
('hapag', 'email', 'port_of_loading', 80, true, 80),
('hapag', 'email', 'port_of_discharge', 80, true, 80),
('hapag', 'document', 'booking_number', 100, true, 90),
('hapag', 'document', 'bl_number', 100, true, 90),
('hapag', 'document', 'container_number', 95, true, 90),
('hapag', 'document', 'shipper_name', 80, false, 75),
('hapag', 'document', 'consignee_name', 80, false, 75),
('hapag', 'document', 'port_of_loading', 90, true, 85),
('hapag', 'document', 'port_of_discharge', 90, true, 85),
('hapag', 'document', 'gross_weight_kg', 75, false, 80),
('hapag', 'document', 'seal_number', 60, false, 75);

-- CMA CGM (Carrier)
INSERT INTO sender_extraction_configs (sender_category, source_type, entity_type_id, priority, is_required, confidence_threshold) VALUES
('cma_cgm', 'email', 'booking_number', 100, true, 85),
('cma_cgm', 'email', 'container_number', 95, true, 90),
('cma_cgm', 'email', 'vessel_name', 90, true, 80),
('cma_cgm', 'email', 'etd', 90, true, 80),
('cma_cgm', 'email', 'eta', 85, true, 75),
('cma_cgm', 'email', 'si_cutoff', 80, false, 75),
('cma_cgm', 'email', 'vgm_cutoff', 80, false, 75),
('cma_cgm', 'document', 'booking_number', 100, true, 90),
('cma_cgm', 'document', 'bl_number', 100, true, 90),
('cma_cgm', 'document', 'container_number', 95, true, 90),
('cma_cgm', 'document', 'gross_weight_kg', 75, false, 80),
('cma_cgm', 'document', 'volume_cbm', 70, false, 75);

-- COSCO (Carrier)
INSERT INTO sender_extraction_configs (sender_category, source_type, entity_type_id, priority, is_required, confidence_threshold) VALUES
('cosco', 'email', 'booking_number', 100, true, 85),
('cosco', 'email', 'container_number', 95, true, 90),
('cosco', 'email', 'bl_number', 90, true, 85),
('cosco', 'email', 'vessel_name', 85, true, 80),
('cosco', 'email', 'etd', 85, true, 80),
('cosco', 'email', 'eta', 85, true, 75),
('cosco', 'document', 'booking_number', 100, true, 90),
('cosco', 'document', 'bl_number', 100, true, 90),
('cosco', 'document', 'container_number', 95, true, 90);

-- ONE LINE (Carrier)
INSERT INTO sender_extraction_configs (sender_category, source_type, entity_type_id, priority, is_required, confidence_threshold) VALUES
('one_line', 'email', 'booking_number', 100, true, 85),
('one_line', 'email', 'container_number', 95, true, 90),
('one_line', 'email', 'bl_number', 90, true, 85),
('one_line', 'email', 'eta', 90, true, 80),
('one_line', 'email', 'last_free_day', 85, false, 75),
('one_line', 'email', 'demurrage_amount', 70, false, 70),
('one_line', 'document', 'booking_number', 100, true, 90),
('one_line', 'document', 'bl_number', 100, true, 90),
('one_line', 'document', 'container_number', 95, true, 90);

-- CUSTOMS BROKER (Focus on customs/compliance data)
INSERT INTO sender_extraction_configs (sender_category, source_type, entity_type_id, priority, is_required, confidence_threshold) VALUES
-- Email extractions - customs focus
('customs_broker', 'email', 'entry_number', 100, true, 90),
('customs_broker', 'email', 'bl_number', 95, true, 85),
('customs_broker', 'email', 'container_number', 90, true, 85),
('customs_broker', 'email', 'it_number', 95, false, 85),
('customs_broker', 'email', 'isf_number', 80, false, 80),
('customs_broker', 'email', 'ams_number', 75, false, 80),
('customs_broker', 'email', 'eta', 85, true, 80),
('customs_broker', 'email', 'ata', 85, false, 80),
('customs_broker', 'email', 'release_date', 90, false, 80),
('customs_broker', 'email', 'exam_date', 85, false, 75),
('customs_broker', 'email', 'hold_type', 80, false, 70),
('customs_broker', 'email', 'last_free_day', 85, false, 75),
('customs_broker', 'email', 'cargo_available_date', 80, false, 75),
-- Document extractions - entry summary, duty invoices
('customs_broker', 'document', 'entry_number', 100, true, 95),
('customs_broker', 'document', 'bl_number', 95, true, 90),
('customs_broker', 'document', 'hs_code', 90, false, 85),
('customs_broker', 'document', 'duty_amount', 90, false, 85),
('customs_broker', 'document', 'duty_rate', 75, false, 80),
('customs_broker', 'document', 'cargo_value', 80, false, 80),
('customs_broker', 'document', 'commodity', 85, false, 80),
('customs_broker', 'document', 'consignee_name', 80, false, 75),
('customs_broker', 'document', 'total_amount', 85, false, 85),
('customs_broker', 'document', 'currency', 70, false, 80),
('customs_broker', 'document', 'customs_entry_date', 85, false, 85);

-- FREIGHT FORWARDER (Focus on operational/logistics data)
INSERT INTO sender_extraction_configs (sender_category, source_type, entity_type_id, priority, is_required, confidence_threshold) VALUES
-- Email extractions - operational focus
('freight_forwarder', 'email', 'booking_number', 100, true, 85),
('freight_forwarder', 'email', 'job_number', 95, true, 80),
('freight_forwarder', 'email', 'bl_number', 90, true, 80),
('freight_forwarder', 'email', 'hbl_number', 90, false, 80),
('freight_forwarder', 'email', 'container_number', 90, true, 85),
('freight_forwarder', 'email', 'vessel_name', 80, false, 75),
('freight_forwarder', 'email', 'voyage_number', 75, false, 75),
('freight_forwarder', 'email', 'etd', 85, true, 80),
('freight_forwarder', 'email', 'eta', 85, true, 80),
('freight_forwarder', 'email', 'pickup_date', 85, false, 75),
('freight_forwarder', 'email', 'delivery_date', 85, false, 75),
('freight_forwarder', 'email', 'pickup_location', 80, false, 70),
('freight_forwarder', 'email', 'delivery_location', 80, false, 70),
('freight_forwarder', 'email', 'port_of_loading', 80, true, 80),
('freight_forwarder', 'email', 'port_of_discharge', 80, true, 80),
('freight_forwarder', 'email', 'place_of_receipt', 75, false, 70),
('freight_forwarder', 'email', 'place_of_delivery', 75, false, 70),
('freight_forwarder', 'email', 'inland_destination', 70, false, 70),
-- Document extractions - HBL, invoices, work orders
('freight_forwarder', 'document', 'booking_number', 100, true, 90),
('freight_forwarder', 'document', 'bl_number', 100, true, 90),
('freight_forwarder', 'document', 'hbl_number', 95, false, 85),
('freight_forwarder', 'document', 'container_number', 95, true, 90),
('freight_forwarder', 'document', 'shipper_name', 85, false, 80),
('freight_forwarder', 'document', 'consignee_name', 85, false, 80),
('freight_forwarder', 'document', 'notify_party', 70, false, 70),
('freight_forwarder', 'document', 'commodity', 80, false, 75),
('freight_forwarder', 'document', 'gross_weight_kg', 80, false, 80),
('freight_forwarder', 'document', 'volume_cbm', 75, false, 75),
('freight_forwarder', 'document', 'package_count', 75, false, 75),
('freight_forwarder', 'document', 'package_type', 65, false, 70),
('freight_forwarder', 'document', 'freight_amount', 80, false, 80),
('freight_forwarder', 'document', 'invoice_number', 85, false, 85),
('freight_forwarder', 'document', 'total_amount', 80, false, 80),
('freight_forwarder', 'document', 'incoterms', 60, false, 70);

-- TERMINAL (Focus on gate operations, availability)
INSERT INTO sender_extraction_configs (sender_category, source_type, entity_type_id, priority, is_required, confidence_threshold) VALUES
('terminal', 'email', 'container_number', 100, true, 90),
('terminal', 'email', 'bl_number', 90, true, 85),
('terminal', 'email', 'vessel_name', 85, true, 80),
('terminal', 'email', 'eta', 90, true, 80),
('terminal', 'email', 'ata', 90, false, 80),
('terminal', 'email', 'cargo_available_date', 95, false, 80),
('terminal', 'email', 'last_free_day', 95, false, 80),
('terminal', 'email', 'free_time_expiry', 90, false, 80),
('terminal', 'email', 'demurrage_start', 85, false, 75),
('terminal', 'email', 'gate_in_date', 80, false, 75),
('terminal', 'email', 'gate_out_date', 80, false, 75),
('terminal', 'email', 'appointment_number', 75, false, 75),
('terminal', 'email', 'appointment_date', 75, false, 75),
('terminal', 'document', 'container_number', 100, true, 90),
('terminal', 'document', 'demurrage_amount', 90, false, 85),
('terminal', 'document', 'detention_amount', 90, false, 85),
('terminal', 'document', 'free_time_days', 80, false, 80),
('terminal', 'document', 'per_diem_rate', 75, false, 80);

-- TRUCKING (Focus on pickup/delivery)
INSERT INTO sender_extraction_configs (sender_category, source_type, entity_type_id, priority, is_required, confidence_threshold) VALUES
('trucking', 'email', 'container_number', 100, true, 90),
('trucking', 'email', 'booking_number', 85, false, 80),
('trucking', 'email', 'pickup_date', 95, true, 80),
('trucking', 'email', 'delivery_date', 95, true, 80),
('trucking', 'email', 'pickup_location', 95, true, 75),
('trucking', 'email', 'delivery_location', 95, true, 75),
('trucking', 'email', 'appointment_number', 80, false, 75),
('trucking', 'email', 'appointment_date', 85, false, 75),
('trucking', 'email', 'driver_name', 70, false, 70),
('trucking', 'email', 'truck_number', 70, false, 70),
('trucking', 'email', 'seal_number', 75, false, 75),
('trucking', 'document', 'container_number', 100, true, 90),
('trucking', 'document', 'seal_number', 90, false, 85),
('trucking', 'document', 'gross_weight_kg', 85, false, 80);

-- RAIL CARRIER (Focus on intermodal/IPI)
INSERT INTO sender_extraction_configs (sender_category, source_type, entity_type_id, priority, is_required, confidence_threshold) VALUES
('rail', 'email', 'container_number', 100, true, 90),
('rail', 'email', 'booking_number', 85, false, 80),
('rail', 'email', 'bl_number', 85, false, 80),
('rail', 'email', 'train_number', 90, false, 80),
('rail', 'email', 'ramp_location', 90, false, 75),
('rail', 'email', 'inland_destination', 90, false, 75),
('rail', 'email', 'etd', 85, false, 75),
('rail', 'email', 'eta', 85, false, 75),
('rail', 'document', 'container_number', 100, true, 90),
('rail', 'document', 'train_number', 90, false, 85);

-- OTHER CARRIER (Generic carrier patterns)
INSERT INTO sender_extraction_configs (sender_category, source_type, entity_type_id, priority, is_required, confidence_threshold) VALUES
('other_carrier', 'email', 'booking_number', 100, true, 80),
('other_carrier', 'email', 'container_number', 95, true, 85),
('other_carrier', 'email', 'bl_number', 90, true, 80),
('other_carrier', 'email', 'vessel_name', 85, false, 75),
('other_carrier', 'email', 'etd', 85, false, 75),
('other_carrier', 'email', 'eta', 85, false, 75),
('other_carrier', 'document', 'booking_number', 100, true, 85),
('other_carrier', 'document', 'bl_number', 100, true, 85),
('other_carrier', 'document', 'container_number', 95, true, 85);

-- OTHER (Catch-all for unknown senders)
INSERT INTO sender_extraction_configs (sender_category, source_type, entity_type_id, priority, is_required, confidence_threshold) VALUES
('other', 'email', 'booking_number', 90, false, 75),
('other', 'email', 'container_number', 90, false, 80),
('other', 'email', 'bl_number', 85, false, 75),
('other', 'email', 'job_number', 80, false, 70),
('other', 'email', 'reference_number', 75, false, 70),
('other', 'email', 'etd', 75, false, 70),
('other', 'email', 'eta', 75, false, 70),
('other', 'document', 'booking_number', 90, false, 80),
('other', 'document', 'bl_number', 90, false, 80),
('other', 'document', 'container_number', 90, false, 80),
('other', 'document', 'invoice_number', 80, false, 75);

-- ============================================================================
-- 4. Helper View for Active Extraction Priorities
-- ============================================================================

CREATE OR REPLACE VIEW v_extraction_priorities AS
SELECT
  sec.sender_category,
  sec.source_type,
  sec.entity_type_id,
  eet.display_name,
  eet.category AS entity_category,
  eet.data_type,
  sec.priority,
  sec.is_required,
  sec.confidence_threshold,
  eet.is_critical,
  eet.is_linkable
FROM sender_extraction_configs sec
JOIN extraction_entity_types eet ON sec.entity_type_id = eet.id
ORDER BY sec.sender_category, sec.source_type, sec.priority DESC;

-- ============================================================================
-- 5. Function to Get Extraction Config for Sender
-- ============================================================================

CREATE OR REPLACE FUNCTION get_extraction_config(
  p_sender_category VARCHAR,
  p_source_type VARCHAR DEFAULT 'both'
) RETURNS TABLE (
  entity_type_id VARCHAR,
  display_name VARCHAR,
  category VARCHAR,
  data_type VARCHAR,
  priority INTEGER,
  is_required BOOLEAN,
  confidence_threshold INTEGER,
  is_critical BOOLEAN,
  is_linkable BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    eet.id,
    eet.display_name,
    eet.category,
    eet.data_type,
    sec.priority,
    sec.is_required,
    sec.confidence_threshold,
    eet.is_critical,
    eet.is_linkable
  FROM sender_extraction_configs sec
  JOIN extraction_entity_types eet ON sec.entity_type_id = eet.id
  WHERE sec.sender_category = p_sender_category
    AND (p_source_type = 'both' OR sec.source_type = p_source_type OR sec.source_type = 'both')
  ORDER BY sec.priority DESC;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 6. Grant Permissions
-- ============================================================================

GRANT SELECT ON extraction_entity_types TO authenticated;
GRANT SELECT ON sender_extraction_configs TO authenticated;
GRANT SELECT ON v_extraction_priorities TO authenticated;

COMMENT ON TABLE extraction_entity_types IS 'Master list of all extractable entity types with metadata';
COMMENT ON TABLE sender_extraction_configs IS 'Sender-specific extraction priorities and requirements';
COMMENT ON VIEW v_extraction_priorities IS 'Joined view of sender configs with entity type details';
