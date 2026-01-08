# Discovered Extraction Patterns

Generated: 2026-01-06T16:42:17.911Z

## Overview

| Document Type | Sender Category | Email Type | Confidence | Key Fields |
|--------------|-----------------|------------|------------|------------|
| booking_confirmation | unknown | inbound | 90% | booking_number, customer_reference, vessel_name |
| payment_receipt | unknown | inbound | 88% | booking_number, bl_number, invoice_number |
| sob_confirmation | unknown | outbound | 88% | hbl_number, booking_number, vessel_name |
| invoice | unknown | inbound | 87% | container_number, booking_number, invoice_number |
| sob_confirmation | unknown | inbound | 88% | booking_number, vessel_name, container_number |
| shipping_bill | unknown | inbound | 88% | booking_number, shipping_bill_number, container_number |
| shipping_instruction | unknown | inbound | 88% | booking_number, transport_document, bl_number |
| arrival_notice | unknown | inbound | 88% | job_number, mbl_number, hbl_number |
| work_order | unknown | inbound | 88% | work_order_number, container_number, booking_number |
| work_order | unknown | outbound | 88% | work_order_id, container_numbers, lfd |
| booking_amendment | unknown | inbound | 88% | booking_number, vessel_name, voyage_number |
| hbl | unknown | outbound | 92% | booking_number, shipment_reference, vessel_name |
| entry_summary | unknown | outbound | 92% | entry_number, custom_duty, container_number |
| bill_of_lading | unknown | outbound | 88% | mbl_number, container_number, booking_number |
| invoice | unknown | outbound | 88% | invoice_number, booking_number, total_amount |
| bill_of_lading | unknown | inbound | 88% | mbl_number, container_number, hbl_number |
| payment_receipt | unknown | outbound | 90% | payment_amount, invoice_numbers, transaction_id |
| arrival_notice | unknown | outbound | 88% | container_number, bl_number, hbl_number |
| hbl_draft | unknown | inbound | 88% | booking_number, container_number, vessel_name |
| delivery_order | unknown | inbound | 85% | bl_number, document_number, booking_number |

## Pattern Details

### booking_confirmation (unknown)

**Email Type:** inbound
**Confidence:** 90%
**Extraction Priority:** pdf_first

#### Subject Patterns

- **booking_number**: `HL-(\d{8})` (95%)
- **destination_port_code**: `HL-\d{8}\s+(US[A-Z]{3})` (90%)
- **customer_reference**: `US[A-Z]{3}\s+([A-Z]+)` (85%)
- **rate_confirmation_number**: `(V\d{12})` (90%)

#### Body Patterns

- **booking_reference**: Labels: Your reference :, Our reference : (90%)
- **update_type**: Labels: UPDATE (85%)

#### Notes

- All samples are from Hapag-Lloyd shipping line
- Customer is consistently INTOGLO PRIVATE LIMITED
- Booking numbers follow HL-XXXXXXXX pattern
- Container types are consistently 45GP
- Rate confirmation emails have different sender (pricing@intoglo.com vs India@service.hlag.com)
- PDF contains more detailed information than email body

---

### payment_receipt (unknown)

**Email Type:** inbound
**Confidence:** 88%
**Extraction Priority:** pdf_first

#### Subject Patterns

- **booking_number**: `\d{8,10}\s+[A-Z0-9]+` (85%)
- **bl_number**: `B/L\s+(\d{10})` (90%)
- **document_number**: `Doc#([A-Z0-9]+)` (85%)
- **shipment_number**: `Sh#(\d{8})` (85%)

#### Body Patterns

- **reference_number**: Labels: Our reference\s*:, Your reference\s*: (90%)
- **container_number**: Labels: Container no\. (95%)
- **vgm_cutoff**: Labels: VGM cut-off: (95%)
- **etd**: Labels: Estimated time of departure: (90%)
- **eta**: Labels: Estimated time of arrival: (90%)
- **vessel**: Labels: First vessel:, Vessel: (85%)
- **voyage**: Labels: Voyage number: (85%)

#### Notes

- VGM reminders are operational documents, not payment receipts
- Government trade notices contain policy information, not transactional data
- Sea waybills and invoices contain core shipping and financial data
- Payment receipts have structured financial information with amounts and currencies

---

### sob_confirmation (unknown)

**Email Type:** outbound
**Confidence:** 88%
**Extraction Priority:** email_first

#### Subject Patterns

- **invoice_number**: `Invoice # ([A-Z0-9\-/]+)` (95%)
- **booking_number**: `BKG : (\d+)` (90%)
- **route**: `FCL from ([A-Za-z\s]+) to ([A-Za-z\s]+)` (85%)
- **shipment_id**: `([A-Z0-9]+_[A-Z0-9]+)` (80%)
- **quote_number**: `SP(\d+)` (75%)

#### Body Patterns

- **hbl_number**: Labels: HBL NO.:?\s*, HBL NO\s* (95%)
- **vessel_name**: Labels: Vessel\s* (90%)
- **voyage**: Labels: Voyage\s* (90%)
- **container_number**: Labels: Container No\s* (85%)
- **etd**: Labels: ETD PORT\s*-?\s*[A-Z\s]+ (80%)
- **eta**: Labels: ETA PORT\s*-?\s*[A-Z\s,]+ (80%)
- **additional_cost**: Labels: additional.*cost, additional.*bill (85%)
- **delivery_address**: Labels: delivery address.*changed to, changed to (80%)
- **consignee_email**: Labels: consignee email (75%)

#### Notes

- SOB confirmations contain shipping status updates and cost approvals
- HBL numbers follow SE prefix pattern consistently
- Additional costs require approval workflow
- Delivery address changes trigger cost adjustments
- ISF details provided in structured format for US imports

---

### invoice (unknown)

**Email Type:** inbound
**Confidence:** 87%
**Extraction Priority:** email_first

#### Subject Patterns

- **po_number**: `PO\s+([A-Z0-9]+)` (85%)
- **container_number**: `Container:\s*([A-Z]{4}\d{7})` (90%)
- **invoice_number**: `Invoice\s+#?\s*(\d+)` (85%)
- **booking_number**: `BOOKING\s+NO\.?\s*(\d+)` (90%)
- **sb_number**: `SB\s+No\s*:?\s*(\d+)` (85%)

#### Body Patterns

- **container_number**: Labels: Container, Container No (90%)
- **vessel_name**: Labels: Vessel, Load on (85%)
- **port**: Labels: HOUSTON, PIPAVAV (80%)
- **delivery_date**: Labels: handover, arrange delivery (75%)

#### Notes

- Container numbers follow MRKU/CAIU/HAMU format with 7 digits
- Multiple invoice formats present - some with # symbol, some without
- VGM documents contain detailed container weight information
- Email threads contain operational updates and delivery coordination
- Canadian and Indian freight forwarders represented

---

### sob_confirmation (unknown)

**Email Type:** inbound
**Confidence:** 88%
**Extraction Priority:** email_first

#### Subject Patterns

- **booking_number**: `\d{9,12}` (95%)
- **vessel_name**: `MAERSK [A-Z]+` (90%)
- **container_type**: `1X20'?FT|FCL ​1X20` (85%)
- **container_number**: `[A-Z]{4}\d{7}` (90%)
- **origin_port**: `MUNDRA|LUDHIANA` (80%)
- **destination_port**: `NEWARK|DETROIT|Charleston SC|LA` (80%)
- **invoice_number**: `\d{2,3}/25-26|RAB\d+-INV\d+` (85%)
- **sb_number**: `SB No :\d{7}` (90%)

#### Body Patterns

- **approval_status**: Labels: Approved, ok (95%)
- **total_charges**: Labels: total Rs\., total (90%)
- **consol_number**: Labels: consol number, under consol (85%)
- **hbl_number**: Labels: HBL NO\.: (90%)
- **document_request**: Labels: share, Kindly share (85%)

#### Notes

- SOB confirmation emails primarily contain approval responses and document requests
- Booking numbers are consistently 9-12 digits in subject lines
- Multiple similar shipments from same clients (Pankaj Dhiman has 2 similar shipments)
- Intoglo appears to be the freight forwarder sending proforma invoices for approval
- Common workflow: Proforma invoice → Approval → Tax invoice → Document requests

---

### shipping_bill (unknown)

**Email Type:** inbound
**Confidence:** 88%
**Extraction Priority:** email_first

#### Subject Patterns

- **booking_number**: `BKG\s*(?:NO\.?|#)?:?\s*([A-Z0-9]+)` (95%)
- **shipping_bill_number**: `SB\s*No\.?\s*[-:]?\s*([0-9]+)` (90%)
- **container_type**: `(1X?40HC?|1\s*x\s*40\s*HC)` (85%)
- **invoice_number**: `INV\.?\s*#?\s*([A-Z0-9]+)` (80%)

#### Body Patterns

- **etd**: Labels: ETD\s*: (85%)
- **container_number**: Labels: CONTAINER\s*NO\.? (90%)
- **seal_number**: Labels: SEAL\s*NO\.?, L\.\s*SEAL\s*NO\.? (80%)
- **forwarding_note**: Labels: forwarding\s*note, find\s*attached\s*forwarding (75%)

#### Notes

- Shipping bill numbers appear in both subject and body with various formats
- Container types consistently use 40HC format variations
- PDF forwarding notes contain detailed container and cargo information
- Multiple invoice numbers may appear in single shipment
- Seal numbers have different prefixes (HLG, BOLT, etc.)

---

### shipping_instruction (unknown)

**Email Type:** inbound
**Confidence:** 88%
**Extraction Priority:** email_first

#### Subject Patterns

- **booking_number**: `Shipping Instruction Submitted Sh#(\d+)` (95%)
- **transport_document**: `SI submitted (\d+)-` (90%)
- **transport_document**: `Amendment submitted (\d+)-` (90%)
- **submission_date**: `-(\d{2}[A-Z][a-z]{2}\d{4}) \d{2}:\d{2}:\d{2}` (85%)

#### Body Patterns

- **bl_number**: Labels: BL Number: (95%)
- **booking_number**: Labels: Booking No: (95%)
- **transport_document**: Labels: Transport document (90%)
- **submission_date**: Labels: Date of Submission:, Submitted on (90%)
- **vessel_name**: Labels: Vessel name (85%)
- **port_loading**: Labels: Port of loading, Port of Loading (85%)
- **port_discharge**: Labels: Port of discharge, Port of Discharge (85%)
- **shipper**: Labels: Shipper (80%)
- **consignee**: Labels: Consignee (80%)
- **container_number**: Labels: Container No. (85%)
- **seal_number**: Labels: Seal\(s\) (80%)

#### Notes

- Two different carriers detected: Hapag-Lloyd (HLAG) and Maersk
- Sample 3 is an amendment with old/new value comparisons
- Customer code masked with asterisks in Maersk documents
- Samples 4 and 5 have same shipper/consignee (internal transfer)
- Date formats vary between carriers

---

### arrival_notice (unknown)

**Email Type:** inbound
**Confidence:** 88%
**Extraction Priority:** email_first

#### Subject Patterns

- **job_number**: `Job#\s*-\s*([A-Z0-9]+)` (95%)
- **mbl_number**: `MBL#\s*-\s*([A-Z0-9]+)` (95%)
- **hbl_number**: `HBL#\s*-\s*([A-Z0-9]+)` (95%)
- **container_number**: `Container#\s*-\s*([A-Z0-9]+)` (95%)
- **booking_number**: `//\s*([0-9]+)\s*//` (90%)
- **container_number**: `([A-Z]{4}[0-9]{7})` (85%)

#### Body Patterns

- **shipper**: Labels: Shipper (90%)
- **shipment_number**: Labels: Shipment # (90%)
- **mbl_number**: Labels: MBL # (95%)
- **hbl_number**: Labels: HBL # (95%)
- **port_of_discharge**: Labels: Port of Discharge (85%)
- **eta**: Labels: ETA: (90%)
- **ata**: Labels: ATA: (85%)
- **place_of_delivery**: Labels: Place of Carrier Delivery, Final Place of Delivery (85%)
- **container_type**: Labels: Container Type (80%)
- **vgm_weight**: Labels: VGM Weight (85%)

#### Notes

- Multiple container numbers can appear in subject line separated by commas
- Booking numbers appear in different formats across samples
- Email threads contain replies and forwards - extract from original arrival notice
- Some samples are incomplete email threads
- PDF contains more detailed information when available

---

### work_order (unknown)

**Email Type:** inbound
**Confidence:** 88%
**Extraction Priority:** email_first

#### Subject Patterns

- **work_order_number**: `Work Order[:\s]+([A-Z0-9]+)` (95%)
- **container_number**: `Containers#\s*([A-Z]{4}\d{7}(?:,\s*[A-Z]{4}\d{7})*)` (90%)
- **booking_number**: `//\s*([A-Z0-9]+)\s*//` (85%)
- **container_size**: `(\d+)\s*X\s*(\d+)\s*(HC|GP)` (90%)
- **route**: `//\s*([A-Z]+)\s+to\s+([^/]+)\s*//` (85%)

#### Body Patterns

- **lfd**: Labels: LFD is (80%)
- **pickup_date**: Labels: pickup, will pickup (85%)
- **appointment_time**: Labels: Appointment, take.*Appointment (80%)
- **storage_fee**: Labels: storage, Storage Due (85%)
- **afterhours_fee**: Labels: afterhours fee (90%)
- **contact_phone**: Labels: PH\s*:, Phone: (85%)
- **contact_name**: Labels: Name\s*: (80%)

#### Notes

- Work orders contain multiple container operations
- Storage fees and clearance status are critical
- Contact information for scheduling appointments
- Afterhours fees may apply

---

### work_order (unknown)

**Email Type:** outbound
**Confidence:** 88%
**Extraction Priority:** email_first

#### Subject Patterns

- **work_order_id**: `Work [Oo]rder\s*:?\s*([A-Z0-9_]+)` (95%)
- **container_numbers**: `([A-Z]{4}\d{7,10})` (90%)
- **container_count_type**: `(\d+\s*[Xx]\s*\d+\s*HC)` (85%)
- **reference_number**: `//\s*([A-Z0-9]+)\s*//` (80%)

#### Body Patterns

- **lfd**: Labels: LFD is, LFD: (90%)
- **eta**: Labels: ETA is, ETA: (85%)
- **delivery_status**: Labels: delivered, unloading, pickup (80%)
- **prepull_status**: Labels: prepulled, pre pulled (85%)
- **storage_clearance**: Labels: storage cleared, clear the storage (75%)

#### Notes

- Work orders contain multiple container numbers in subject line
- LFD (Last Free Day) is critical for avoiding demurrage charges
- Delivery confirmations and prepull status are key operational updates
- Storage clearance requests indicate pending demurrage issues

---

### booking_amendment (unknown)

**Email Type:** inbound
**Confidence:** 88%
**Extraction Priority:** email_first

#### Subject Patterns

- **booking_number**: `TPDoc, sea waybill, shipped on board (\d+)` (95%)
- **container_number**: `Booking (\d+) / ([A-Z]{4}\d{7})` (90%)

#### Body Patterns

- **amendment_request**: Labels: Requesting you to submit the amendment online (90%)
- **consignee_name**: Labels: CNEE :, CNEE: (85%)
- **consignee_address**: Labels: CNEE : (80%)
- **amendment_fee_warning**: Labels: Note that any request to change (95%)

#### Notes

- Two distinct email types: TPDoc notifications (samples 1,2,3,5) and amendment requests (sample 4)
- TPDoc emails contain sea waybill PDFs with vessel and voyage details
- Amendment emails contain consignee change requests with address details
- All emails from intoglo.com acting as Maersk agent
- Amendment fee warnings present in TPDoc emails

---

### hbl (unknown)

**Email Type:** outbound
**Confidence:** 92%
**Extraction Priority:** email_first

#### Subject Patterns

- **booking_number**: `\b\d{11}\b` (95%)
- **container_size**: `\d+[xX]?\d*'?(?:GP|HC)` (90%)
- **vessel_name**: `(?:MAERSK|CMA CGM|OOCL)\s+[A-Z]+` (85%)
- **voyage**: `\d{3,4}W?` (80%)
- **route**: `[A-Z]+\s+TO\s+[A-Z]+` (90%)
- **shipment_reference**: `SSE\d{10}` (95%)

#### Body Patterns

- **custom_duty_amount**: Labels: Custom Duty\s*:\s*\$?, Custom Duty\s*USD (95%)
- **demurrage_charges**: Labels: Demurrage Charges\s*:\s*\$? (90%)
- **container_numbers**: Labels: containers?\s*:? (85%)

#### Notes

- Custom duty invoices are common - amounts in USD typically
- Demurrage charges appear for late container returns
- Container numbers follow XXXX1234567 format
- Shipment references follow SSE1025002XXX pattern
- Ocean BL numbers vary by carrier (numeric for Maersk, alphanumeric for CMA CGM)
- GST invoices include GSTIN and state codes for Indian operations

---

### entry_summary (unknown)

**Email Type:** outbound
**Confidence:** 92%
**Extraction Priority:** email_first

#### Subject Patterns

- **entry_number**: `SSE\d{10}` (95%)
- **container_number**: `[A-Z]{4}\d{7}` (90%)
- **booking_number**: `\d{11}` (85%)
- **invoice_number**: `Invoice no\. \d+` (80%)
- **shipment_reference**: `SEINUS\d{11}_I` (85%)

#### Body Patterns

- **custom_duty**: Labels: Custom duty :, Custom Duty : (95%)
- **entry_summary_status**: Labels: Entry Summary (90%)
- **payment_deadline**: Labels: maximum by (85%)
- **approval_status**: Labels:  (90%)

#### Notes

- All samples are from Intoglo freight forwarding company handling US customs entries
- Entry numbers follow CBP format with filer code 9JW
- Custom duty amounts are consistently requested in USD
- Entry summaries require client approval before submission
- PDF forms are CBP Form 7501 (Entry Summary)

---

### bill_of_lading (unknown)

**Email Type:** outbound
**Confidence:** 88%
**Extraction Priority:** email_first

#### Subject Patterns

- **container_number**: `Cntr#\s*([A-Z]{4}\d{7})` (95%)
- **mbl_number**: `MBL#?:?\s*([A-Z0-9]{11,15})` (95%)
- **booking_number**: `C(\d{8})` (90%)
- **cto_code**: `CTO:\s*([A-Z]{4})` (85%)
- **cfs_code**: `CFS:\s*([A-Z]+)` (80%)

#### Body Patterns

- **pickup_number**: Labels: PU#, PU # (90%)
- **last_free_date**: Labels: LFD:, LFD  (85%)
- **eta**: Labels: ETA to US is, ETA: (80%)
- **turn_in_reference**: Labels: Turn-In-Reference (85%)
- **transport_id**: Labels: transport ID (90%)
- **container_number**: Labels: container#, Cntr# (95%)
- **client_name**: Labels: client is shown as, Invoice has to be raised to (75%)

#### Notes

- Emails show container delivery coordination workflow
- Multiple date formats used (MM/DD and DD.MM.YYYY)
- Custom hold and delivery order processes evident
- Transport ID format follows T followed by 8 digits
- Client billing information discussed in email threads

---

### invoice (unknown)

**Email Type:** outbound
**Confidence:** 88%
**Extraction Priority:** pdf_first

#### Subject Patterns

- **invoice_number**: `Invoice\s+(\d+)` (85%)
- **booking_number**: `BKG\s+NO\.:\s+(\d+)` (90%)
- **container_type**: `(\d+[Xx]\d+[A-Z]*)` (85%)
- **route**: `([A-Z]+)\s+TO\s+([A-Z]+)` (80%)
- **job_id**: `JOB\s+ID:\s*([A-Z0-9]+)` (90%)

#### Body Patterns

- **exchange_rate**: Labels: Ex rate, USD Ex rate (85%)
- **freight_amount**: Labels: freight as USD (80%)
- **bond_charges**: Labels: Custom Bond charges:, Bond charges: (85%)
- **mobile**: Labels: Mobile -, Mobile: (90%)

#### Notes

- Warehouse invoices from Meiborg Brothers have consistent PDF structure
- Shipping operations emails contain booking numbers and route information
- Bond charges and customs-related invoices include GSTIN and tax details
- Exchange rates are frequently mentioned in export operations

---

### bill_of_lading (unknown)

**Email Type:** inbound
**Confidence:** 88%
**Extraction Priority:** email_first

#### Subject Patterns

- **container_number**: `Cntr#\s*([A-Z]{4}\d{7})` (95%)
- **mbl_number**: `MBL#?\s*([A-Z0-9]{10,12})` (95%)
- **hbl_number**: `HBL\s*-?\s*([A-Z0-9]{10,12})` (90%)
- **invoice_number**: `Invoice No\.\s*([A-Z0-9/\-]+)` (85%)

#### Body Patterns

- **container_number**: Labels: Container:, Cntr#, MRKU (90%)
- **mbl_number**: Labels: MBL#, MBL:, shipment (90%)
- **hbl_number**: Labels: HBL, HBL NO, HBL: (85%)
- **customs_status**: Labels: customs status, CUSTOM HOLD, customs (80%)
- **ams_error**: Labels: AMS ERROR, ams error (85%)
- **invoice_number**: Labels: Invoice No, invoice number (80%)
- **terminal_hold**: Labels: Hold on request, container is in Hold (75%)

#### Notes

- Emails primarily contain operational issues and status updates
- Container and MBL numbers are consistently formatted
- Customs holds and AMS errors are common issues
- Multiple stakeholders involved in resolution chains

---

### payment_receipt (unknown)

**Email Type:** outbound
**Confidence:** 90%
**Extraction Priority:** both_sources

#### Subject Patterns

- **booking_number**: `Booking No\.: (\d+)` (85%)
- **container_number**: `Container# ([A-Z]{4}\d{7})` (90%)
- **mbl_number**: `MBL# ([A-Z]{4}\d{9})` (90%)
- **bill_of_lading**: `(\d{9})` (80%)
- **invoice_number**: `INV# (\d{10})` (85%)

#### Body Patterns

- **payment_amount**: Labels: Payment done against, Paid Amount :, Amount (95%)
- **invoice_numbers**: Labels: Maersk Invoice Number, Invoice Number (90%)
- **transaction_id**: Labels: Transaction ID:, payment receipt (85%)
- **excess_amount**: Labels: Excess Amount : (90%)

#### Notes

- Payment receipts typically contain Mercury bank transaction details
- Multiple invoice numbers often listed in email body tables
- PDF invoices contain detailed charge breakdowns and vessel information
- Excess payments and adjustments are common scenarios

---

### arrival_notice (unknown)

**Email Type:** outbound
**Confidence:** 88%
**Extraction Priority:** email_first

#### Subject Patterns

- **container_number**: `Container#?\s*([A-Z]{4}\d{7})` (95%)
- **booking_number**: `Deal Id:\s*([A-Z0-9_]+)` (90%)
- **hbl_number**: `BL No\.\s*(SE\d{10})` (90%)
- **consignee**: `Consignee\s*:\s*([A-Z\s&\.]+)` (85%)

#### Body Patterns

- **lfd**: Labels: LFD is, LFD:, LFD (90%)
- **eta**: Labels: ETA to, ETA (85%)
- **pickup_number**: Labels: PU#, P/U # (90%)
- **container_number**: Labels: Container #, Container# (95%)
- **port**: Labels: SAVANNAH, Chicago, New York (80%)

#### Notes

- Container numbers follow XXXX1234567 format consistently
- HBL numbers follow SE1125002XXX pattern
- LFD dates appear in various formats (MM/DD, DD MMM)
- Multiple BL number formats exist (OOLU, MAEU prefixes vs numeric)
- Pickup numbers are 8-digit numeric codes

---

### hbl_draft (unknown)

**Email Type:** inbound
**Confidence:** 88%
**Extraction Priority:** email_first

#### Subject Patterns

- **booking_number**: `BKG\s*#?\s*([A-Z0-9]+)` (95%)
- **container_number**: `CON\.NO\.([A-Z]{4}\d{7}(?:/[A-Z]{4}\d{7})*)` (90%)
- **vessel_name**: `VSL\.([A-Z\s]+)/` (85%)
- **pod**: `POD:([A-Z\s]+)` (90%)
- **container_type**: `(\d+X\d+(?:HC|GP|FT)?)` (85%)
- **invoice_number**: `INV\s*NO[\.:]*\s*([A-Z0-9,/\s]+)` (80%)

#### Body Patterns

- **etd**: Labels: ETD\s*:?\s*, ETD\s*is (90%)
- **eta**: Labels: ETA\s*to\s*[A-Z\s]+\s*is, ETA\s*:?\s* (85%)
- **delivery_address**: Labels: final place of delivery, delivery address (80%)
- **container_status**: Labels: containers stand, status (75%)
- **draft_approval**: Labels: Draft is, HBL draft (85%)
- **case_number**: Labels: case number (80%)

#### Notes

- Multiple container numbers separated by forward slash
- Dates appear in DD-MMM-YYYY format
- Container types use format like 1X40HC, 2X40, 2x20GP
- POD and vessel info often in subject line
- Draft approval confirmations common in body
- Case numbers for carrier communications

---

### delivery_order (unknown)

**Email Type:** inbound
**Confidence:** 85%
**Extraction Priority:** email_first

#### Subject Patterns

- **bl_number**: `BL HLCL Sh#(\d+)` (95%)
- **document_number**: `Doc#(HLCU[A-Z0-9]+)` (95%)
- **booking_number**: `Booking-(\d+)` (90%)

#### Body Patterns

- **etd**: Labels: ETD (85%)
- **eta**: Labels: ETA (85%)
- **vessel_voyage**: Labels: VESSEL / VOYAGE / IMO (80%)
- **container_number**: Labels: CONTAINERS (85%)
- **origin_port**: Labels: ORIGIN (80%)
- **destination_port**: Labels: DESTINATION (80%)

#### Notes

- Samples 1-3 and 5 are Hapag-Lloyd Bill of Lading drafts with empty field values
- Sample 4 contains actual shipment data with proforma invoice
- Subject patterns distinguish between BL drafts and booking confirmations
- PDF content appears to be template forms with minimal filled data

---

