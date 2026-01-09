-- ============================================================================
-- MIGRATION 045: EXHAUSTIVE DETECTION PATTERNS
-- ============================================================================
-- Purpose: Populate comprehensive patterns for ALL shipping lines and document types
-- Based on: Industry standards (EDIFACT), carrier documentation, email analysis
-- Author: Classification System Enhancement
-- Date: 2025-01-09
-- ============================================================================

-- First, enhance the detection_patterns table if needed
ALTER TABLE detection_patterns ADD COLUMN IF NOT EXISTS pattern_flags VARCHAR(10) DEFAULT 'i';
ALTER TABLE detection_patterns ADD COLUMN IF NOT EXISTS confidence_base INT DEFAULT 75;
ALTER TABLE detection_patterns ADD COLUMN IF NOT EXISTS requires_pdf BOOLEAN DEFAULT false;
ALTER TABLE detection_patterns ADD COLUMN IF NOT EXISTS requires_carrier_match BOOLEAN DEFAULT false;
ALTER TABLE detection_patterns ADD COLUMN IF NOT EXISTS exclude_patterns TEXT[] DEFAULT '{}';
ALTER TABLE detection_patterns ADD COLUMN IF NOT EXISTS require_all_patterns TEXT[] DEFAULT '{}';
ALTER TABLE detection_patterns ADD COLUMN IF NOT EXISTS example_matches TEXT[] DEFAULT '{}';
ALTER TABLE detection_patterns ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE detection_patterns ADD COLUMN IF NOT EXISTS source VARCHAR(50) DEFAULT 'manual';
ALTER TABLE detection_patterns ADD COLUMN IF NOT EXISTS hit_count INT DEFAULT 0;
ALTER TABLE detection_patterns ADD COLUMN IF NOT EXISTS false_positive_count INT DEFAULT 0;
ALTER TABLE detection_patterns ADD COLUMN IF NOT EXISTS last_matched_at TIMESTAMPTZ;

-- ============================================================================
-- MAERSK PATTERNS (Domain: maersk.com, sealandmaersk.com)
-- ============================================================================

INSERT INTO detection_patterns (carrier_id, pattern_type, document_type, pattern, priority, confidence_base, requires_pdf, example_matches, notes, source) VALUES

-- Maersk Booking Confirmation
('maersk', 'subject', 'booking_confirmation', '^Booking Confirmation\s*:\s*\d{9}', 100, 96, true,
 ARRAY['Booking Confirmation : 263522431', 'Booking Confirmation : 262175704'],
 'Maersk BC with 9-digit booking number. PDF must contain BOOKING CONFIRMATION heading.', 'carrier_docs'),

('maersk', 'subject', 'booking_confirmation', '^Booking Confirmation\s*-\s*MAEU\d+', 98, 95, true,
 ARRAY['Booking Confirmation - MAEU9876543210'],
 'Alternate BC format with MAEU prefix', 'email_analysis'),

-- Maersk Booking Amendment
('maersk', 'subject', 'booking_amendment', '^Booking Amendment\s*:\s*\d{9}', 95, 93, false,
 ARRAY['Booking Amendment : 262266445'],
 'Booking changes/amendments', 'carrier_docs'),

('maersk', 'subject', 'booking_amendment', '^Amendment submitted\s+\d{9}', 94, 92, false,
 ARRAY['Amendment submitted 263022847-26Dec2025 15:54:30 UTC'],
 'SI amendment confirmation', 'email_analysis'),

-- Maersk Booking Cancellation
('maersk', 'subject', 'booking_cancellation', '^Booking Cancellation\s*:\s*\d{9}', 94, 95, false,
 ARRAY['Booking Cancellation : 263625133'],
 'Booking cancelled notification', 'carrier_docs'),

-- Maersk Arrival Notice
('maersk', 'subject', 'arrival_notice', '^Arrival notice\s+\d{9}', 92, 95, false,
 ARRAY['Arrival notice 261736030'],
 'Arrival notice with booking number in subject', 'carrier_docs'),

('maersk', 'subject', 'arrival_notice', '^Arrival Notice\s*:', 91, 93, false,
 ARRAY['Arrival Notice : Container# MRKU7230190', 'Arrival Notice : Shipper : Matangi'],
 'Arrival notice with container or shipper reference', 'email_analysis'),

-- Maersk SI Confirmation
('maersk', 'subject', 'si_confirmation', '^SI submitted\s+\d{9}', 93, 94, false,
 ARRAY['SI submitted 262874542-27Dec2025 20:48:34 UTC'],
 'Maersk SI submitted confirmation with timestamp', 'carrier_docs'),

-- Maersk Invoice
('maersk', 'subject', 'invoice', '^New invoice\s+[A-Z]{2}\d{2}IN\d+', 88, 92, false,
 ARRAY['New invoice GJ26IN2500375201 (BL 262175704)', 'New invoice MH26IN2501234567'],
 'Maersk freight invoice with BL reference', 'carrier_docs'),

-- Maersk Bill of Lading
('maersk', 'subject', 'bill_of_lading', 'TPDoc.*sea\s?waybill', 85, 90, false,
 ARRAY['maersk TPDoc, sea waybill, shipped on board 263522003'],
 'Sea waybill notification', 'email_analysis'),

('maersk', 'subject', 'bill_of_lading', 'draft sea\s?way\s?bill', 84, 88, false,
 ARRAY['draft seaway bill notification'],
 'Draft seaway bill', 'email_analysis'),

-- Maersk HBL Draft
('maersk', 'subject', 'hbl_draft', 'Draft BL|Draft House B/L|HBL Draft', 86, 90, true,
 ARRAY['Draft BL for review', 'Draft House B/L'],
 'Draft BL for review - requires PDF', 'carrier_docs'),

-- Maersk VGM
('maersk', 'subject', 'vgm_confirmation', 'VGM.*(confirm|received)|Verified Gross Mass', 78, 88, false,
 ARRAY['VGM confirmation received', 'Verified Gross Mass submitted'],
 'VGM confirmation', 'carrier_docs'),

-- Maersk Cutoff Advisory
('maersk', 'subject', 'cutoff_advisory', 'Maersk Customer Advisory.*Cut Off', 75, 85, false,
 ARRAY['Maersk Customer Advisory Revised Cut Off'],
 'Cutoff/schedule change advisory', 'email_analysis'),

('maersk', 'subject', 'cutoff_advisory', 'Maersk Last Free Day Notification', 76, 88, false,
 ARRAY['Maersk Last Free Day Notification'],
 'Last free day for container pickup - demurrage deadline', 'carrier_docs'),

('maersk', 'subject', 'cutoff_advisory', 'Your Transport Plan has Changed', 74, 82, false,
 ARRAY['Your Transport Plan has Changed'],
 'Transport plan change notification', 'email_analysis'),

-- Maersk Pickup Notification
('maersk', 'subject', 'pickup_notification', 'Maersk.*Pickup Number', 70, 85, false,
 ARRAY['CA - Maersk Line Pickup Number'],
 'Container pickup notification', 'carrier_docs'),

('maersk', 'subject', 'pickup_notification', 'Container Off-Rail Location Update', 69, 83, false,
 ARRAY['Container Off-Rail Location Update'],
 'Container off-rail notification', 'email_analysis'),

-- Maersk Shipment Notice
('maersk', 'subject', 'shipment_notice', '^Shipment Number\s+\d+-FMC Filing', 65, 82, false,
 ARRAY['Shipment Number 262707011-FMC Filing reference Number'],
 'FMC filing notification', 'carrier_docs'),

('maersk', 'subject', 'shipment_notice', 'Post-Arrival Maersk Exception Report', 89, 85, false,
 ARRAY['Post-Arrival Maersk Exception Report'],
 'Post-arrival exception report - NOT arrival notice, container status updates', 'email_analysis'),

('maersk', 'subject', 'shipment_notice', 'Pre-Arrival Maersk Exception Report', 89, 85, false,
 ARRAY['Pre-Arrival Maersk Exception Report'],
 'Pre-arrival exception report', 'email_analysis'),

('maersk', 'subject', 'shipment_notice', '^Daily summary of Containers', 60, 78, false,
 ARRAY['Daily summary of Containers Gated-In'],
 'Daily operational summary', 'email_analysis'),

('maersk', 'subject', 'shipment_notice', 'Maersk Container Off-Rail', 61, 80, false,
 ARRAY['Maersk Container Off-Rail Notification'],
 'Container rail operations notification', 'email_analysis'),

-- Maersk General Correspondence
('maersk', 'subject', 'general_correspondence', '^Your Case Number\s*:', 45, 60, false,
 ARRAY['Your Case Number : 2512-344221792'],
 'Customer support case emails', 'email_analysis'),

-- ============================================================================
-- HAPAG-LLOYD PATTERNS (Domain: hapag-lloyd.com, hlag.com, service.hlag.com)
-- ============================================================================

-- Hapag-Lloyd Booking Confirmation
('hapag', 'subject', 'booking_confirmation', '^HL-\d{8}\s+[A-Z]{5}\s+[A-Z]', 100, 95, false,
 ARRAY['HL-22970937 USNYC NORTHP', 'HL-21635244 USORF HIGHW'],
 'HL-XXXXXXXX format with port code. BC must have PDF with BOOKING CONFIRMATION heading.', 'carrier_docs'),

-- Hapag-Lloyd Booking Amendment
('hapag', 'subject', 'booking_amendment', '^\[Update\]\s+Booking\s+\d{8}', 95, 93, false,
 ARRAY['[Update] Booking 22970937 [isQQSpot=YES] - Change Empty Pick-up'],
 'Booking update notification', 'carrier_docs'),

-- Hapag-Lloyd SI Confirmation
('hapag', 'subject', 'si_confirmation', '^Shipping Instruction Submitted\s*Sh#\d+', 92, 94, false,
 ARRAY['Shipping Instruction Submitted Sh#19207547'],
 'SI submitted confirmation', 'carrier_docs'),

-- Hapag-Lloyd SI Notification (different from submitted)
('hapag', 'subject', 'shipping_instruction', '^Shipping Instruction Notification\s*\|\|', 90, 90, false,
 ARRAY['Shipping Instruction Notification || Hapag Lloyd 56909569/TOLTEN'],
 'SI notification (different from SI Submitted)', 'email_analysis'),

-- Hapag-Lloyd Bill of Lading
('hapag', 'subject', 'bill_of_lading', '^BL HLCL Sh#\s*\d+\s*Doc#\s*HL[A-Z0-9]+', 88, 92, false,
 ARRAY['BL HLCL Sh#19207547 Doc#HLCUDE1251233590'],
 'BL with document reference', 'carrier_docs'),

('hapag', 'subject', 'bill_of_lading', '^HLCL Sh#\s*\d+\s*Doc#\s*HL[A-Z0-9]+', 87, 91, false,
 ARRAY['HLCL Sh# 28505550 Doc# HLCUDE1251114189'],
 'HLCL BL format', 'email_analysis'),

('hapag', 'subject', 'bill_of_lading', '^SW HLCL Sh#\s*\d+\s*Doc#\s*HL[A-Z0-9]+', 86, 90, false,
 ARRAY['SW HLCL Sh#21822663 Doc#HLCUBO12512BAXW7'],
 'Seaway Bill format', 'carrier_docs'),

('hapag', 'subject', 'bill_of_lading', '^Shipment:\s*\d+\s*/\s*BL:\s*HL[A-Z0-9]+', 85, 89, false,
 ARRAY['Shipment: 93963751 / BL: HLCUBO12511BHKF1 - HB Filling Missing'],
 'BL status notification', 'email_analysis'),

-- Hapag-Lloyd Invoice
('hapag', 'subject', 'invoice', '^\d+\s+INTOG[LO]\s+001\s+HL[A-Z0-9]+', 82, 90, false,
 ARRAY['2078405937 INTOGO 001 HLCUDE1251208192'],
 'Hapag invoice format', 'carrier_docs'),

-- Hapag-Lloyd VGM
('hapag', 'subject', 'vgm_confirmation', '^VGM ACC\s+[A-Z]{4}\d+', 78, 90, false,
 ARRAY['VGM ACC BMOU5630848 94075162'],
 'VGM acceptance confirmation', 'carrier_docs'),

('hapag', 'subject', 'vgm_reminder', '^\d+\s+.*VGM REMINDER', 77, 85, false,
 ARRAY['93908595 BS EX VGM REMINDER', '17891102 KYRA - NYK VGM REMINDER'],
 'VGM submission reminder', 'email_analysis'),

-- Hapag-Lloyd Arrival Notice
('hapag', 'subject', 'arrival_notice', '^ALERT\s*-\s*Bill of lading.*POD', 91, 93, false,
 ARRAY['ALERT - Bill of lading HLCUBO12509ARSP4 DP 670651 POD USPEF'],
 'Hapag arrival notice - containers arriving at port of discharge', 'carrier_docs'),

('hapag', 'subject', 'arrival_notice', '^ALERT\s*-\s*Bill of lading.*discharge', 90, 92, false,
 ARRAY['ALERT - Bill of lading ... Estimated date of discharge'],
 'Arrival notice with discharge info', 'email_analysis'),

-- Hapag-Lloyd Pickup Notification
('hapag', 'subject', 'pickup_notification', 'Hapag Lloyd Container Pick up Notification', 70, 85, false,
 ARRAY['Hapag Lloyd Container Pick up Notification 29982815/BREMEN EXPRESS'],
 'Container pickup notification', 'carrier_docs'),

-- Hapag-Lloyd Cutoff Advisory
('hapag', 'subject', 'cutoff_advisory', 'Hapag Lloyd Advisory\s*\|\|.*CUT OFF', 75, 85, false,
 ARRAY['Hapag Lloyd Advisory || VESSEL CUT OFF DETAILS'],
 'Vessel cutoff advisory', 'email_analysis'),

-- ============================================================================
-- CMA CGM PATTERNS (Domain: cma-cgm.com, apl.com)
-- ============================================================================

-- CMA CGM Booking Confirmation
('cma-cgm', 'subject', 'booking_confirmation', '^CMA CGM - Booking confirmation available', 100, 96, true,
 ARRAY['CMA CGM - Booking confirmation available – CEI0329370 -  - 0INLLW1MA'],
 'CMA CGM BC with CEI/AMC prefix. PDF must contain BOOKING CONFIRMATION heading.', 'carrier_docs'),

-- CMA CGM SI Confirmation
('cma-cgm', 'subject', 'si_confirmation', '^CMA CGM - Shipping instruction submitted', 92, 94, false,
 ARRAY['CMA CGM - Shipping instruction submitted - AMC2475643'],
 'SI submitted confirmation', 'carrier_docs'),

-- CMA CGM Arrival Notice
('cma-cgm', 'subject', 'arrival_notice', '^CMA CGM - Arrival notice available', 95, 95, false,
 ARRAY['CMA CGM - Arrival notice available - AMC2459902'],
 'Arrival notification - critical for consignee', 'carrier_docs'),

-- CMA CGM Bill of Lading
('cma-cgm', 'subject', 'bill_of_lading', '^My Customer Service.*BL Request.*BL [A-Z0-9]+', 88, 90, false,
 ARRAY['My Customer Service - My Export BL Request - BL CAD0845048'],
 'BL request/confirmation', 'email_analysis'),

-- CMA CGM Invoice
('cma-cgm', 'subject', 'invoice', '^CMA-CGM Freight Invoice', 85, 92, false,
 ARRAY['CMA-CGM Freight Invoice'],
 'Freight invoice', 'carrier_docs'),

('cma-cgm', 'subject', 'invoice', '^CMA CGM - Export Invoice available', 84, 91, false,
 ARRAY['CMA CGM - Export Invoice available - INEMHC26113448'],
 'Export invoice available', 'email_analysis'),

-- CMA CGM HBL Draft
('cma-cgm', 'subject', 'hbl_draft', '^Modification requested on draft BL', 87, 90, false,
 ARRAY['Modification requested on draft BL EID0918049'],
 'Draft BL modification request', 'email_analysis'),

('cma-cgm', 'subject', 'hbl_draft', '^B/L Draft:', 86, 89, false,
 ARRAY['B/L Draft: EID0918049 - Booking: EID0918049'],
 'Draft BL for review', 'carrier_docs'),

-- CMA CGM VGM
('cma-cgm', 'subject', 'vgm_reminder', 'VGM declaration Missing', 77, 85, false,
 ARRAY['VGM declaration Missing'],
 'VGM declaration missing notification', 'carrier_docs'),

-- ============================================================================
-- COSCO PATTERNS (Domain: coscon.com, cosco.com)
-- ============================================================================

-- COSCO Booking Confirmation
('cosco', 'subject', 'booking_confirmation', '^Cosco Shipping Line Booking Confirmation\s*-\s*COSU\d{10}', 100, 96, true,
 ARRAY['Cosco Shipping Line Booking Confirmation - COSU6439083630 / Booking Office: MRA'],
 'COSCO BC with 10-digit COSU booking number. PDF must have BOOKING CONFIRMATION.', 'carrier_docs'),

-- COSCO Shipment Notice
('cosco', 'subject', 'shipment_notice', '^Cosco Shipping Line\s*-Shipment Notice:', 93, 92, true,
 ARRAY['Cosco Shipping Line -Shipment Notice: XIN LOS ANGELES 176 East -Booking: COSU643'],
 'Shipment/discharge notification', 'carrier_docs'),

-- COSCO Arrival Notice
('cosco', 'subject', 'arrival_notice', '^COSCO Arrival Notice', 95, 95, false,
 ARRAY['COSCO Arrival Notice with Freight COSU6435548630'],
 'Arrival notification with freight details', 'carrier_docs'),

-- COSCO MBL Draft (Proforma)
('cosco', 'subject', 'mbl_draft', '^COSCON\s*-\s*Proforma Bill of Lading', 89, 92, true,
 ARRAY['COSCON - Proforma Bill of Lading for COSU6436834960/Vessel: CMA CGM PHOENIX'],
 'Proforma/Draft MBL for review', 'carrier_docs'),

-- COSCO Bill of Lading (Copy/Final)
('cosco', 'subject', 'bill_of_lading', '^COSCON\s*-\s*Copy Bill of Lading', 88, 91, true,
 ARRAY['COSCON - Copy Bill of Lading for COSU6434944110'],
 'Copy/Final BL', 'carrier_docs'),

-- COSCO Invoice
('cosco', 'subject', 'invoice', '^PROD_Invoice\s+INTOGLO', 82, 90, true,
 ARRAY['PROD_Invoice INTOGLO PRIVATE LIMITED SAP 7085061000 B/L COSU6439083510'],
 'Invoice with PROD_Invoice prefix', 'carrier_docs'),

('cosco', 'subject', 'invoice', '^PROD_VERF\s+INTOGLO', 80, 85, false,
 ARRAY['PROD_VERF INTOGLO PRIVATE LIMITED B/L 6435682540'],
 'Invoice verification notification', 'email_analysis'),

-- COSCO SI Confirmation
('cosco', 'subject', 'si_confirmation', '^COSCO SHIPPING LINES\s*-\s*\d+\s*-\s*Document Shipping Instruction', 92, 93, false,
 ARRAY['COSCO SHIPPING LINES - 6439083510 - Document Shipping Instruction'],
 'SI document uploaded notification', 'carrier_docs'),

-- ============================================================================
-- MSC PATTERNS (Domain: msc.com)
-- ============================================================================

-- MSC Booking Amendment
('msc', 'subject', 'booking_amendment', 'INTOGLO.*\/.*AMM\s*#\s*\d+', 95, 93, false,
 ARRAY['INTOGLO PRIVATE LIMITED / 25-342OTEW / AMM # 11'],
 'Amendment notification (AMM #)', 'email_analysis'),

-- MSC Booking Confirmation (needs verification with more samples)
('msc', 'subject', 'booking_confirmation', 'MSC.*Booking Confirm', 100, 90, true,
 ARRAY['MSC Booking Confirmation'],
 'Standard BC format (needs verification with more samples)', 'carrier_docs'),

-- MSC Bill of Lading
('msc', 'subject', 'bill_of_lading', 'MSC.*B/L|Bill of Lading.*MSC', 88, 88, false,
 ARRAY['MSC B/L Release', 'Bill of Lading MSC'],
 'MSC BL notification', 'carrier_docs'),

-- ============================================================================
-- ONE (Ocean Network Express) PATTERNS (Domain: one-line.com)
-- ============================================================================

-- ONE Booking Confirmation
('one', 'subject', 'booking_confirmation', 'ONE.*Booking Confirmation|Ocean Network Express.*Booking', 100, 92, true,
 ARRAY['ONE Booking Confirmation', 'Ocean Network Express Booking'],
 'ONE BC notification', 'carrier_docs'),

-- ONE Arrival Notice
('one', 'subject', 'arrival_notice', '^Arrival Notice\s*\(BL#:', 98, 96, false,
 ARRAY['Arrival Notice (BL#: ONEY123456789)'],
 'ONE arrival notice format with BL reference', 'carrier_docs'),

-- ============================================================================
-- EVERGREEN PATTERNS (Domain: evergreen-line.com, evergreen-marine.com)
-- ============================================================================

-- Evergreen Booking Confirmation
('evergreen', 'subject', 'booking_confirmation', 'Evergreen.*Booking Confirmation', 100, 92, true,
 ARRAY['Evergreen Booking Confirmation'],
 'Evergreen BC notification', 'carrier_docs'),

-- ============================================================================
-- YANG MING PATTERNS (Domain: yangming.com)
-- ============================================================================

-- Yang Ming Booking Confirmation
('yangming', 'subject', 'booking_confirmation', 'Yang Ming.*Booking|YM.*Booking Confirm', 100, 92, true,
 ARRAY['Yang Ming Booking Confirmation', 'YM Booking Confirmation'],
 'Yang Ming BC notification', 'carrier_docs'),

-- ============================================================================
-- GENERIC PATTERNS (Carrier-Agnostic)
-- ============================================================================

-- Generic Booking Confirmation
(NULL, 'subject', 'booking_confirmation', 'Booking Confirmation', 50, 75, false,
 ARRAY['Booking Confirmation', 'Booking Confirmed'],
 'Generic BC pattern - lower confidence', 'generic'),

-- Generic Arrival Notice
(NULL, 'subject', 'arrival_notice', '\bArrival Notice\b', 50, 80, false,
 ARRAY['Arrival Notice', 'Notice of Arrival'],
 'Generic arrival notice pattern', 'generic'),

-- Generic Bill of Lading
(NULL, 'subject', 'bill_of_lading', '\bBill of Lading\b|\bB/L\b', 50, 75, false,
 ARRAY['Bill of Lading', 'B/L Copy'],
 'Generic BL pattern', 'generic'),

-- Generic SI
(NULL, 'subject', 'shipping_instruction', 'Shipping Instruction|SI Draft', 50, 75, false,
 ARRAY['Shipping Instruction', 'SI Draft for Review'],
 'Generic SI pattern', 'generic'),

-- Generic Invoice
(NULL, 'subject', 'invoice', '\bInvoice\b', 50, 70, false,
 ARRAY['Invoice', 'Freight Invoice'],
 'Generic invoice pattern - needs body/attachment analysis', 'generic'),

-- Generic VGM
(NULL, 'subject', 'vgm_confirmation', '\bVGM\b', 50, 75, false,
 ARRAY['VGM Confirmation', 'VGM Submitted'],
 'Generic VGM pattern', 'generic'),

-- Generic SOB Confirmation
(NULL, 'subject', 'sob_confirmation', '\bSOB\s+CONFIRM|\bshipped\s+on\s+board', 85, 92, false,
 ARRAY['SOB CONFIRMATION', 'Shipped on Board Confirmation'],
 'Shipped on Board confirmation - critical for export', 'generic'),

(NULL, 'subject', 'sob_confirmation', '\bSOB\s+for\b', 84, 90, false,
 ARRAY['SOB for BL# 123456'],
 'SOB with BL reference', 'generic'),

-- Generic Proof of Delivery
(NULL, 'subject', 'proof_of_delivery', '\bPOD\b|\bProof of Delivery\b', 80, 88, false,
 ARRAY['POD Attached', 'Proof of Delivery'],
 'Proof of Delivery notification', 'generic'),

-- Generic Delivery Order
(NULL, 'subject', 'delivery_order', '\bDelivery Order\b|\bD/O\b', 75, 85, false,
 ARRAY['Delivery Order', 'D/O Release'],
 'Delivery order release', 'generic')

ON CONFLICT DO NOTHING;

-- ============================================================================
-- ATTACHMENT FILENAME PATTERNS
-- ============================================================================

INSERT INTO detection_patterns (carrier_id, pattern_type, document_type, pattern, priority, confidence_base, example_matches, notes, source) VALUES

-- Booking Confirmation Attachments
(NULL, 'attachment', 'booking_confirmation', 'BKGCONF_[A-Z0-9]+\.pdf$', 98, 96,
 ARRAY['BKGCONF_CEI0329370.pdf'],
 'CMA CGM booking confirmation PDF', 'carrier_docs'),

(NULL, 'attachment', 'booking_confirmation', 'HL-\d+.*BC.*\.PDF$', 97, 95,
 ARRAY['HL-22970937 USSAV RESILIENT BC 3RD UPDATE.PDF'],
 'Hapag-Lloyd BC PDF', 'carrier_docs'),

(NULL, 'attachment', 'booking_confirmation', '^\d{10}\.pdf$', 96, 94,
 ARRAY['6439083630.pdf'],
 'COSCO booking confirmation (10-digit filename)', 'carrier_docs'),

-- SI/HBL Draft Attachments
(NULL, 'attachment', 'si_draft', '^SI[_-]', 100, 95,
 ARRAY['SI_Draft.pdf', 'SI-123456.pdf'],
 'Shipping instruction draft', 'generic'),

(NULL, 'attachment', 'hbl_draft', 'Draft[_-]?BL|HBL[_-]?Draft', 92, 92,
 ARRAY['Draft_BL.pdf', 'HBL-Draft.pdf'],
 'House BL draft', 'generic'),

-- Invoice Attachments
(NULL, 'attachment', 'invoice', '^invoice_[A-Z0-9]+\.pdf$', 95, 93,
 ARRAY['invoice_GJ26IN2500375201.pdf'],
 'Maersk invoice PDF', 'carrier_docs'),

(NULL, 'attachment', 'invoice', '^INVP\d+\.pdf$', 94, 92,
 ARRAY['INVP123456.pdf'],
 'Hapag-Lloyd invoice PDF', 'carrier_docs'),

(NULL, 'attachment', 'invoice', '^IN\d+-\d+-\d+-\d+-[A-Z0-9]+-invoice\.pdf$', 93, 91,
 ARRAY['IN20250109-1234-5678-90AB-CDEF1234-invoice.pdf'],
 'COSCO invoice PDF format', 'carrier_docs'),

-- Entry Summary (US Customs)
(NULL, 'attachment', 'entry_summary', '7501', 96, 95,
 ARRAY['7501_entry.pdf', 'CBP_7501.pdf'],
 'CBP Form 7501 - Entry Summary', 'generic'),

-- Proof of Delivery
(NULL, 'attachment', 'proof_of_delivery', '^POD', 100, 94,
 ARRAY['POD_signed.pdf', 'POD-123456.pdf'],
 'Proof of delivery document', 'generic'),

-- LEO Copy (India Export)
(NULL, 'attachment', 'leo_copy', 'LEO', 95, 94,
 ARRAY['LEO_Copy.pdf', 'LEO123456.pdf'],
 'Let Export Order copy', 'generic'),

-- Shipping Bill (India Export)
(NULL, 'attachment', 'shipping_bill', 'Shipping[_-]?Bill', 94, 93,
 ARRAY['Shipping_Bill.pdf', 'ShippingBill123.pdf'],
 'India shipping bill document', 'generic'),

-- Bill of Lading Attachments
(NULL, 'attachment', 'bill_of_lading', 'ANMA\d+_\d+\.pdf$', 88, 90,
 ARRAY['ANMA0101_960787589.pdf'],
 'Hapag-Lloyd BL PDF', 'carrier_docs'),

(NULL, 'attachment', 'bill_of_lading', '^\d+-\d+\.PDF$', 87, 89,
 ARRAY['6436834960-20251205095515.PDF'],
 'COSCO BL PDF format', 'carrier_docs')

ON CONFLICT DO NOTHING;

-- ============================================================================
-- BODY INDICATOR PATTERNS
-- ============================================================================

INSERT INTO detection_patterns (carrier_id, pattern_type, document_type, pattern, priority, confidence_base, notes, source) VALUES

-- SOB Confirmation (Body)
(NULL, 'body', 'sob_confirmation', 'container.*loaded.*aboard', 94, 92,
 'Container loaded on board vessel', 'generic'),

(NULL, 'body', 'sob_confirmation', 'shipped on board', 95, 93,
 'Shipped on board confirmation', 'generic'),

(NULL, 'body', 'sob_confirmation', 'on board date', 93, 90,
 'On board date reference', 'generic'),

-- Proof of Delivery (Body)
(NULL, 'body', 'proof_of_delivery', 'PFA.*POD', 92, 90,
 'Please find attached POD', 'generic'),

(NULL, 'body', 'proof_of_delivery', 'proof of delivery.*attached', 91, 89,
 'POD attachment reference', 'generic'),

(NULL, 'body', 'proof_of_delivery', 'successfully delivered', 88, 85,
 'Successful delivery confirmation', 'generic'),

-- Invoice (Body)
(NULL, 'body', 'invoice', 'total.*amount.*\$', 92, 88,
 'Total amount with dollar sign', 'generic'),

(NULL, 'body', 'invoice', 'please pay', 90, 85,
 'Payment request indicator', 'generic'),

(NULL, 'body', 'invoice', 'amount due', 89, 84,
 'Amount due reference', 'generic'),

-- Customs Clearance (Body)
(NULL, 'body', 'customs_clearance', 'customs.*cleared', 92, 90,
 'Customs cleared notification', 'generic'),

(NULL, 'body', 'customs_clearance', 'out of charge', 93, 91,
 'Out of charge notification', 'generic'),

-- Delivery Confirmation (Body)
(NULL, 'body', 'delivery_complete', 'cargo delivered', 87, 85,
 'Cargo delivery confirmation', 'generic'),

(NULL, 'body', 'delivery_complete', 'delivery completed', 88, 86,
 'Delivery completed notification', 'generic'),

-- Document Share (Body)
(NULL, 'body', 'document_share', 'please find attached', 60, 50,
 'Generic document share indicator - needs document type analysis', 'generic'),

(NULL, 'body', 'document_share', 'PFA.*for your reference', 62, 55,
 'PFA for reference', 'generic')

ON CONFLICT DO NOTHING;

-- ============================================================================
-- PDF CONTENT MARKERS
-- ============================================================================

INSERT INTO detection_patterns (carrier_id, pattern_type, document_type, pattern, priority, confidence_base, notes, source) VALUES

-- Booking Confirmation (PDF Content)
(NULL, 'pdf_content', 'booking_confirmation', 'BOOKING CONFIRMATION', 100, 98,
 'Primary BC indicator in PDF header', 'carrier_docs'),

(NULL, 'pdf_content', 'booking_confirmation', 'BOOKING CONFIRMED', 99, 96,
 'Alternate BC indicator', 'carrier_docs'),

-- Arrival Notice (PDF Content)
(NULL, 'pdf_content', 'arrival_notice', 'ARRIVAL NOTICE', 100, 97,
 'Arrival notice heading', 'carrier_docs'),

(NULL, 'pdf_content', 'arrival_notice', 'NOTICE OF ARRIVAL', 99, 96,
 'Alternate arrival notice heading', 'carrier_docs'),

-- Bill of Lading (PDF Content)
(NULL, 'pdf_content', 'bill_of_lading', 'BILL OF LADING', 100, 97,
 'BL document heading', 'carrier_docs'),

(NULL, 'pdf_content', 'bill_of_lading', 'SHIPPED ON BOARD', 98, 95,
 'Shipped on board clause in BL', 'carrier_docs'),

-- Shipping Instruction (PDF Content)
(NULL, 'pdf_content', 'shipping_instruction', 'SHIPPING INSTRUCTION', 100, 95,
 'SI document heading', 'carrier_docs'),

(NULL, 'pdf_content', 'shipping_instruction', 'SI SUB TYPE', 98, 92,
 'SI sub type indicator', 'carrier_docs'),

-- Invoice (PDF Content)
(NULL, 'pdf_content', 'invoice', 'COMMERCIAL INVOICE', 100, 95,
 'Commercial invoice heading', 'carrier_docs'),

(NULL, 'pdf_content', 'invoice', 'FREIGHT INVOICE', 99, 94,
 'Freight invoice heading', 'carrier_docs'),

(NULL, 'pdf_content', 'invoice', 'INVOICE.*TOTAL', 95, 90,
 'Invoice with total amount', 'generic'),

-- Entry Summary (PDF Content)
(NULL, 'pdf_content', 'entry_summary', 'ENTRY SUMMARY', 100, 98,
 'CBP Entry Summary heading', 'carrier_docs'),

(NULL, 'pdf_content', 'entry_summary', 'CBP FORM 7501', 99, 97,
 'CBP Form 7501 identifier', 'carrier_docs'),

(NULL, 'pdf_content', 'entry_summary', 'DEPARTMENT OF HOMELAND SECURITY', 98, 95,
 'DHS header in customs document', 'carrier_docs'),

-- Packing List (PDF Content)
(NULL, 'pdf_content', 'packing_list', 'PACKING LIST', 100, 95,
 'Packing list heading', 'carrier_docs'),

-- Delivery Order (PDF Content)
(NULL, 'pdf_content', 'delivery_order', 'DELIVERY ORDER', 100, 95,
 'Delivery order heading', 'carrier_docs'),

-- VGM Certificate (PDF Content)
(NULL, 'pdf_content', 'vgm_confirmation', 'VERIFIED GROSS MASS', 100, 95,
 'VGM certificate heading', 'carrier_docs'),

(NULL, 'pdf_content', 'vgm_confirmation', 'VGM CERTIFICATE', 99, 94,
 'VGM certificate alternate heading', 'carrier_docs')

ON CONFLICT DO NOTHING;

-- ============================================================================
-- SENDER PATTERN UPDATES (Enhanced)
-- ============================================================================

-- Update sender_patterns with comprehensive domains
INSERT INTO sender_patterns (sender_type, domains, name_patterns, description, enabled) VALUES
(
  'cha_india',
  ARRAY['anscargo.in', 'aarishkalogistics.com', 'arglltd.com', 'aksharalogistics.com',
        'bluedartexim.com', 'calcuttacargo.com', 'deltafreight.in', 'elogisww.com',
        'ganeshiccd.com', 'icegate.gov.in', 'indialogisticsnet.com', 'jeenaandcompany.com',
        'kaizenlogistics.in', 'ktvlogistics.com', 'lakshmishipping.com', 'm2rcargo.com',
        'navasshipping.com', 'orientfreight.in', 'pranavcargo.com', 'quantumcfs.com',
        'rapidcargo.in', 'samudralogistics.com', 'seabornefreight.in', 'tricontainer.in',
        'unilogistics.in', 'varunlogistics.in', 'worldstarlogistics.com', 'xpeditegroup.com',
        'zestlogistics.in'],
  ARRAY['cha', 'customs house agent', 'clearing agent', 'shipping bill', 'leo', 'dgft'],
  'Indian Customs House Agents (CHA) and clearing agents',
  true
),
(
  'customs_broker_us',
  ARRAY['livingston.com', 'usacustomsclearance.com', 'abordeaux.com', 'expeditors.com',
        'chrobinson.com', 'flexport.com', 'geodis.com', 'portalternatives.com',
        'jmdcustoms.com', 'artemuscustoms.com', 'portsideics.com', 'customsbroker.com',
        'nvocc.com', 'vanantwerp.com', 'cbcbrokers.com', 'farrowbrokers.com',
        'cbsacustomsbrokers.com', 'atcustoms.com', 'albcustoms.com'],
  ARRAY['customs broker', 'customs clearance', 'cbp', 'entry', 'isf', '7501', 'hts'],
  'US Customs Brokers and licensed customs house brokers',
  true
),
(
  'trucker_us',
  ARRAY['carmeltransport.com', 'meiborg.com', 'xpologistics.com', 'hubgroup.com',
        'schneider.com', 'jbhunt.com', 'wernerenterprises.com', 'landstar.com',
        'olddominionfreight.com', 'yrcfreight.com', 'fedexfreight.com', 'upsfreight.com',
        'saiamotorfreight.com', 'estes-express.com', 'abf.com', 'reddaway.com'],
  ARRAY['trucking', 'drayage', 'container transport', 'chassis', 'pickup', 'delivery'],
  'US Trucking and drayage companies',
  true
),
(
  'terminal',
  ARRAY['apm-terminals.com', 'dpworld.com', 'psa.com', 'hutchison-ports.com',
        'ssaterminals.com', 'tradewindsla.com', 'oict.com', 'ttilgb.com',
        'globalterminals.com', 'portoflosangeles.org', 'portofnewark.com',
        'portnynj.gov', 'porthouston.com', 'portofvirginia.com', 'portofseattle.org'],
  ARRAY['terminal', 'port', 'gateway', 'container terminal', 'gate', 'yard'],
  'Port terminals and terminal operators',
  true
),
(
  'platform',
  ARRAY['cbp.dhs.gov', 'odexservices.com', 'inttra.com', 'cargowise.com',
        'portrix.com', 'cargosmart.com', 'bluejaycloud.com', 'descartes.com',
        'gt-nexus.com', 'chain.io', 'flexport.com', 'project44.com'],
  ARRAY['platform', 'api', 'notification', 'system', 'automated'],
  'Shipping platforms and B2B notification services',
  true
),
(
  'warehouse',
  ARRAY['nfiindustries.com', 'wh-logistics.com', 'saddle-creek.com', 'kenco.com',
        'americancoldchain.com', 'burrislogistics.com', 'lineagelogistics.com',
        'cjlogistics.com', 'dhlogistics.com'],
  ARRAY['warehouse', 'distribution center', 'cold storage', 'fulfillment'],
  'Warehouses and distribution centers',
  true
)
ON CONFLICT (sender_type) DO UPDATE SET
  domains = EXCLUDED.domains,
  name_patterns = EXCLUDED.name_patterns,
  description = EXCLUDED.description;

-- ============================================================================
-- BOOKING NUMBER PATTERNS (Entity Extraction)
-- ============================================================================

-- Add carrier-specific booking number patterns to entity_type_config
UPDATE entity_type_config
SET extraction_hints =
  'MAERSK: 26XXXXXXX (9 digits starting with 26), 262123456. ' ||
  'HAPAG-LLOYD: HL-XXXXXXXX (8 digits), HL-22970937. ' ||
  'CMA CGM: CEI/AMC/CAD + 7 digits, CEI0329370, AMC2475643. ' ||
  'COSCO: COSU + 10 digits, COSU6439083630. ' ||
  'MSC: MSCAXXXXXXX, 25-342OTEW. ' ||
  'ONE: ONEY + alphanumeric. ' ||
  'Generic: Alphanumeric 6-15 characters.'
WHERE type_name = 'booking_number';

-- Add BL number patterns
UPDATE entity_type_config
SET extraction_hints =
  'MAERSK: MAEUXXXXXXXXXXXX (MAEU + 10-14 alphanumeric). ' ||
  'HAPAG-LLOYD: HLCUXXXXXXXXXXXX (HLCU + 10-14 alphanumeric). ' ||
  'COSCO: COAUXXXXXXXXXXXX (COAU + 10-14 alphanumeric). ' ||
  'CMA CGM: CMAUXXXXXXXXXXXX (CMAU + 10-14 alphanumeric). ' ||
  'Generic: 4-letter prefix + 10-14 alphanumeric characters. ' ||
  'Intoglo HBL: SE + 10+ alphanumeric.'
WHERE type_name = 'bl_number';

-- Add container number validation hint
UPDATE entity_type_config
SET extraction_hints =
  'ISO 6346 Format: 4 letters + 7 digits with check digit. ' ||
  'Owner codes: MAEU/MSKU (Maersk), HLCU/HLXU (Hapag), CMAU (CMA CGM), ' ||
  'COSU (COSCO), MSCU (MSC), TCLU/TRLU (Leasing). ' ||
  'Validate check digit using ISO 6346 algorithm.'
WHERE type_name = 'container_number';

-- ============================================================================
-- CREATE INDEXES FOR FAST PATTERN LOOKUP
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_patterns_lookup
ON detection_patterns(carrier_id, pattern_type, document_type, enabled, priority DESC)
WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_patterns_carrier_type
ON detection_patterns(carrier_id, pattern_type)
WHERE enabled = true;

-- ============================================================================
-- ADD PATTERN MATCH TRACKING FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION track_pattern_match(pattern_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE detection_patterns
  SET
    hit_count = hit_count + 1,
    last_matched_at = NOW()
  WHERE id = pattern_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION report_false_positive(pattern_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE detection_patterns
  SET false_positive_count = false_positive_count + 1
  WHERE id = pattern_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE detection_patterns IS 'Comprehensive pattern database for email/document classification. Priority: higher = checked first. Confidence: base score when matched.';
COMMENT ON COLUMN detection_patterns.pattern_type IS 'subject, sender, attachment, body, pdf_content';
COMMENT ON COLUMN detection_patterns.source IS 'carrier_docs = from carrier documentation, email_analysis = mined from emails, generic = industry standard';
COMMENT ON COLUMN detection_patterns.hit_count IS 'Number of times this pattern matched - for optimization';
COMMENT ON COLUMN detection_patterns.false_positive_count IS 'Number of reported misclassifications - for quality control';

-- ============================================================================
-- END MIGRATION 045
-- ============================================================================
