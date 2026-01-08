# Validated Extraction Patterns

Generated: 2026-01-06T17:02:30.179Z

## Overview

| Document Type | Valid Samples | Confidence | Critical Entities | Patterns Found |
|--------------|---------------|------------|-------------------|----------------|
| booking_confirmation | 5/10 | 45% | 2/3 | 6 |
| arrival_notice | 5/5 | 78% | 3/3 | 8 |
| payment_receipt | 5/10 | 70% | 2/2 | 6 |
| invoice | 5/5 | 60% | 2/2 | 5 |
| shipping_instruction | 5/5 | 65% | 3/3 | 10 |
| bill_of_lading | 5/7 | 65% | 3/3 | 12 |
| work_order | 5/5 | 65% | 2/2 | 8 |
| sob_confirmation | 0/10 | 0% | 0/3 | 0 |
| booking_amendment | 0/10 | 0% | 0/2 | 0 |
| entry_summary | 3/10 | 25% | 2/2 | 6 |
| delivery_order | 1/10 | 65% | 2/2 | 7 |
| hbl | 3/10 | 65% | 3/3 | 9 |
| hbl_draft | 5/6 | 45% | 3/3 | 8 |
| shipping_bill | 3/10 | 90% | 2/2 | 5 |

## Entity Patterns by Document Type

### booking_confirmation

**Description:** Carrier confirmation of cargo booking with vessel/voyage details

**⚠️ Classification Issues:** HL-14089549 USNYC PANORA; HL-25823956 MAPTM GOKUL; HL-30260275 USNYC PEARL

| Entity | Priority | Subject Pattern | Body Pattern | Confidence |
|--------|----------|-----------------|--------------|------------|
| booking_number | critical | `Booking confirmation available` | `booking has been confirmed` | 75% |
| pol | important | `([A-Z]{5}) to [A-Z]{5}` | `-` | 75% |
| pod | important | `[A-Z]{5} to ([A-Z]{5})` | `-` | 75% |
| voyage_number | critical | `([A-Z0-9]{9})_[A-Z]{5}_[A-Z]{5` | `-` | 75% |
| carrier | optional | `CMA CGM` | `Hapag-Lloyd AG` | 75% |
| customer_reference | optional | `Your rate confirmation ([A-Z0-` | `-` | 75% |

**Notes:** Missing pattern for vessel_name (critical); Missing patterns for etd, eta, container_type, si_cutoff, vgm_cutoff (important); pol and pod only have subject patterns, need body patterns for reliability; voyage_number only has subject patterns, need body patterns; Critical entity vessel_name completely missing

---

### arrival_notice

**Description:** Notification that shipment has arrived or is arriving at destination

| Entity | Priority | Subject Pattern | Body Pattern | Confidence |
|--------|----------|-----------------|--------------|------------|
| mbl_number | critical | `MBL#\s*-\s*([A-Z]{4}\d{9})` | `MBL #\s*([A-Z]{4}\d{9})` | 95% |
| container_number | critical | `Container#\s*-\s*([A-Z]{4}\d{7` | `Container #\s*([A-Z]{4}\d{7})` | 95% |
| eta | critical | `-` | `ETA:\s*(\d{1,2}\s+[A-Za-z]{3},` | 90% |
| hbl_number | important | `HBL#\s*-\s*([A-Z0-9]+)` | `HBL #\s*([A-Z0-9]+)` | 95% |
| port_of_discharge | important | `-` | `Port of Discharge\s*([A-Za-z]+` | 90% |
| lfd | important | `-` | `LFD is (\d{2}/\d{2})` | 95% |
| consignee | optional | `\|\s*([A-Z][A-Z\s,\.]+?)\s*\|` | `Dear ([A-Z][A-Z\s,\.]+?),` | 85% |
| it_number | important | `Deal Id:\s*([A-Z0-9_]+)` | `Inlops ID\s*([A-Z0-9_]+)` | 90% |

**Notes:** Missing ETA patterns in subject lines - critical entity only found in body; ATA patterns missing entirely - should be present for arrival notices; Vessel name patterns not discovered but commonly present in arrival notices

---

### payment_receipt

**Description:** Confirmation of payment received or payment transaction details

**⚠️ Classification Issues:** Guidelines for Collateral Support for Export Credi; Guidelines for Interest Subvention Support for Pre; Re: Statement of Account 22. december 2025- INTOGL

| Entity | Priority | Subject Pattern | Body Pattern | Confidence |
|--------|----------|-----------------|--------------|------------|
| payment_amount | critical | `-` | `\$([0-9,]+\.\d{2})` | 95% |
| invoice_number | critical | `INV#\s*(\d{10})` | `(\d{10})\s+[0-9,]+\.\d{2}` | 95% |
| payment_date | important | `(\d{1,2}\.?\s+\w+\s+\d{4})` | `Date:\s+(\d{2}-\d{2}-\d{2})` | 85% |
| payer_name | important | `(INTOGLO\s+[A-Z\s]+)\s+\(` | `TO:\s+([A-Z\s]+)\s+\(` | 90% |
| currency | optional | `-` | `\$[0-9,]+\.\d{2}` | 95% |
| payment_method | optional | `-` | `(credit card|check|wire|ACH tr` | 85% |

**Notes:** Missing transaction_id patterns (important entity); Payment amount has no subject patterns which is unusual for payment receipts; Sample subjects show statements rather than payment receipts - may indicate document type confusion

---

### invoice

**Description:** Commercial or freight invoice requesting payment

| Entity | Priority | Subject Pattern | Body Pattern | Confidence |
|--------|----------|-----------------|--------------|------------|
| invoice_number | critical | `Invoice #\s*([A-Z0-9|]+)` | `-` | 95% |
| total_amount | critical | `-` | `BALANCE DUE\$([0-9,]+\.\d{2})` | 100% |
| due_date | important | `-` | `due on (\d{2}/\d{2}/\d{4})` | 100% |
| booking_reference | optional | `^(\d{8})\s*\|` | `booking copy\s+(\d{9})` | 90% |
| currency | optional | `-` | `freight as (USD)\s+\d+` | 95% |

**Notes:** Missing body patterns for critical entity invoice_number; Missing patterns for critical entity invoice_date; Missing patterns for important entity charges_breakdown; All discovered patterns appear appropriate for freight invoices

---

### shipping_instruction

**Description:** SI submission with shipper/consignee details for BL preparation

| Entity | Priority | Subject Pattern | Body Pattern | Confidence |
|--------|----------|-----------------|--------------|------------|
| booking_number | critical | `Sh#(\d{8})` | `Booking No:?\s*(\d{8})` | 20% |
| shipper_name | critical | `-` | `Shipper\s*\n([A-Z\s]+(?:PRIVAT` | 20% |
| consignee_name | critical | `-` | `Consignee\s*\n([A-Z\s]+(?:INC\` | 20% |
| bl_number | important | `-` | `BL Number:?\s*([A-Z0-9]{15})` | 20% |
| notify_party | important | `-` | `Notify Address\s*\n([A-Z\s]+(?` | 20% |
| container_number | important | `-` | `Container No\.\s*\n([A-Z]{4}\d` | 20% |
| port_of_loading | optional | `-` | `Port of Loading\s*\n([A-Z]+)` | 20% |
| port_of_discharge | optional | `-` | `Port of Discharge\s*\n([A-Z,\s` | 20% |
| cargo_description | optional | `-` | `Cargo Description\s*\n([A-Z\s\` | 20% |
| hs_code | optional | `-` | `HS Code\s*\n(\d{6})` | 20% |

**Notes:** Missing pattern for vessel_name (critical entity); All critical entities should have multiple patterns for reliability; shipper_name and consignee_name only have 1 body pattern each - insufficient for critical entities; booking_number has good coverage with subject patterns

---

### bill_of_lading

**Description:** BL document or draft for review/approval

**⚠️ Classification Issues:** Re: Request for Bill of Lading – Invoice No. RAI/2; Re: Request for Bill of Lading – Invoice No. RAI/2

| Entity | Priority | Subject Pattern | Body Pattern | Confidence |
|--------|----------|-----------------|--------------|------------|
| bl_number | critical | `HBL:\s*([A-Z0-9]+)` | `HBL Number\s+([A-Z0-9]+)` | 95% |
| shipper_name | critical | `Shipper\s*-([^/]+?)\s*//` | `Shipper\s+([A-Z\s\.]+?)\s+\d` | 95% |
| consignee_name | critical | `-` | `Delivery Address\s+([^\d]+?)\s` | 80% |
| container_number | important | `Container#\s*([A-Z]{4}\d{7})` | `Container Number:\s*([A-Z]{4}\` | 95% |
| pol | important | `-` | `-` | 0% |
| pod | important | `POD\s+([A-Z]+)` | `Final Port of Delivery\s+([A-Z` | 80% |
| vessel_name | important | `SSY\s+([A-Z]+)` | `-` | 70% |
| voyage_number | important | `-` | `-` | 0% |
| weight | optional | `-` | `Weight / \(Kgs\)\s+MBL Number.` | 85% |
| cargo_description | optional | `-` | `-` | 0% |
| notify_party | optional | `-` | `-` | 0% |
| measurement | optional | `-` | `-` | 0% |

**Notes:** Missing patterns for pol (port of loading); Missing patterns for voyage_number; consignee_name has no subject patterns; vessel_name has no body patterns; Critical entity pol has zero patterns discovered

---

### work_order

**Description:** Delivery/trucking work order with container pickup details

| Entity | Priority | Subject Pattern | Body Pattern | Confidence |
|--------|----------|-----------------|--------------|------------|
| container_number | critical | `//\s*([A-Z]{4}\d{7,10})` | `([A-Z]{4}\d{7,10})\s*:` | 95% |
| pickup_location | critical | `-` | `Meiborg warehouse` | 80% |
| work_order_number | important | `Work [Oo]rder\s*:?\s*([A-Z0-9_` | `work order` | 90% |
| lfd | important | `-` | `LFD is (\d{1,2}/\d{1,2}|tomorr` | 95% |
| delivery_address | important | `//.*?//.*?//\s*([^/]+,\s*\d+[^` | `Matcom Warehouse` | 85% |
| pickup_date | important | `-` | `pickup.*?(today)` | 85% |
| trucker_name | optional | `-` | `Blake Horvath` | 90% |
| terminal | optional | `//\s*(M&B)` | `-` | 80% |

**Notes:** pickup_location has insufficient coverage (0 subject, 1 body pattern); Critical entity pickup_location severely under-represented; terminal has subject pattern but no body patterns - inconsistent coverage; pickup_date only has body patterns, may miss subject-line dates

---

### sob_confirmation

**Description:** Shipped on Board confirmation that cargo is loaded on vessel

**⚠️ Classification Issues:** RE: SOB CONFIRMATION // BL DRAFT // RABPL // MUNDR; RE: SOB CONFIRMATION // Invoice for USA Skyway - 2; Re: SOB CONFIRMATION //Re: FCL ​1X20 the subject s

| Entity | Priority | Subject Pattern | Body Pattern | Confidence |
|--------|----------|-----------------|--------------|------------|

**Notes:** No valid samples - classification quality issue

---

### booking_amendment

**Description:** Change/update to existing booking details

**⚠️ Classification Issues:** TPDoc, sea waybill, shipped on board 263375571; TPDoc, sea waybill, shipped on board 262874542; TPDoc, sea waybill, shipped on board 263375571

| Entity | Priority | Subject Pattern | Body Pattern | Confidence |
|--------|----------|-----------------|--------------|------------|

**Notes:** No valid samples - classification quality issue

---

### entry_summary

**Description:** US Customs entry summary (CBP Form 7501)

**⚠️ Classification Issues:** Re: SOB CONFIRMATION // 261948373 // 40'HC NHAVA S; Re: Intoglo || Order Confirmation on Custom Bonded; Fwd: Shipping Instruction for Strut Channel==Booki

| Entity | Priority | Subject Pattern | Body Pattern | Confidence |
|--------|----------|-----------------|--------------|------------|
| entry_number | critical | `-` | `9JW\s+(\d{8})` | 85% |
| entry_type | critical | `-` | `Entry Type.*?\n.*?(\d{2})` | 75% |
| duty_amount | important | `-` | `Custom duty\s*:\s*\$([\d,]+\.\` | 90% |
| entry_date | important | `-` | `Entry Date.*?\n.*?(\d{2}/\d{2}` | 80% |
| port_of_entry | important | `NHAVA SHEVA TO (\w+)` | `Port Code.*?\n.*?(\d{4})` | 75% |
| importer_of_record | optional | `duty bill - ([A-Z]+)` | `raise the duty bill to ([A-Z]+` | 90% |

**Notes:** Critical entity entry_number has 0 subject patterns; Critical entity entry_type has 0 subject patterns; Sample subjects appear to be shipping/booking related, not CBP Form 7501; Subject patterns don't match US Customs entry summary format; importer_of_record should be critical for CBP forms, not optional

---

### delivery_order

**Description:** Authorization to release/deliver cargo

**⚠️ Classification Issues:** Please file E-Manifest || BL# 261708626 || Shipper; Re: Please file E-Manifest || 261308924 || SONA BL; Please file E-Manifest || 261308924 || SONA BLW ||

| Entity | Priority | Subject Pattern | Body Pattern | Confidence |
|--------|----------|-----------------|--------------|------------|
| bl_number | critical | `-` | `MBL Number.*?([A-Z]{4}\d{9})` | 85% |
| container_number | critical | `Container#\s*([A-Z]{4}\d{7})` | `/\s*([A-Z]{4}\d{7})` | 90% |
| consignee_name | important | `IOR:\s*([A-Z\s]+)\s*//` | `Shipper\s+([A-Z\s]+)\s+\d` | 80% |
| delivery_location | important | `-` | `Delivery Address\s+([^\n]+)` | 85% |
| release_date | important | `ETA:\s*(\d{1,2}\s+[A-Za-z]{3})` | `ETA is\s+(\d{1,2}\s+[A-Za-z]{3` | 85% |
| do_number | optional | `([A-Z]{6}\d{11}_I)` | `Inlops ID\s+([A-Z]{6}\d{11}_I)` | 80% |
| terminal | optional | `-` | `Final Port of Delivery\s+([A-Z` | 70% |

**Notes:** Missing bl_number patterns in subject line; bl_number is critical but only has 1 body pattern; Sample subject shows pre-alert format rather than delivery order authorization; Missing vessel/voyage information typical for delivery orders

---

### hbl

**Description:** House Bill of Lading from freight forwarder

**⚠️ Classification Issues:** DO // SSE1225003098; Re: 261166820 // 5X20'GP // MUNDRA TO MEMPHIS // C; Re: 261166820 // 5X20'GP // MUNDRA TO MEMPHIS // C

| Entity | Priority | Subject Pattern | Body Pattern | Confidence |
|--------|----------|-----------------|--------------|------------|
| hbl_number | critical | `HBL#\s*(SE\d{10})` | `HOUSE BILL OF LADING\s*\n.*?(S` | 95% |
| shipper_name | critical | `-` | `SHIPPER\s*\n([A-Z\s&]+(?:PRIVA` | 90% |
| consignee_name | critical | `-` | `CONSIGNEE\s*\n([A-Z\s&]+(?:INC` | 90% |
| mbl_number | important | `-` | `OCEAN BILL OF LADING\s*\n([A-Z` | 95% |
| vessel_name | important | `-` | `VESSEL.*?\n([A-Z\s]+)\s*/` | 90% |
| container_number | important | `Container#\s*(TCLU\d{7})` | `CONTAINERS\s*\n(TCLU\d{7})` | 95% |
| notify_party | optional | `-` | `-` | 0% |
| cargo_description | optional | `-` | `GOODS DESCRIPTION\s*\n([A-Z\s]` | 80% |
| freight_charges | optional | `-` | `Custom Duty\s*[:\$]?\s*\$?\s*(` | 95% |

**Notes:** Missing shipper_name patterns in subject line; Missing vessel_name patterns in subject line; Only 1 body pattern for shipper_name is insufficient for critical entity; Missing notify_party patterns entirely - should have at least 1 body pattern for HBL documents

---

### hbl_draft

**Description:** Draft House BL for review before final issuance

**⚠️ Classification Issues:** RE: Re: BKG NO.: SZPM95470100//Re: RE: 2ND SHIPMEN

| Entity | Priority | Subject Pattern | Body Pattern | Confidence |
|--------|----------|-----------------|--------------|------------|
| hbl_number | critical | `BL (EID\d{7})` | `BL number-(SE\d{10})` | 95% |
| shipper_name | critical | `-` | `Company ([A-Z\s]+) - ([A-Z\s]+` | 75% |
| consignee_name | critical | `-` | `Ship-to:([A-Z\s\.]+) TAX ID` | 80% |
| vessel_name | important | `VSL\.([A-Z\s]+)/` | `Vessel ([A-Z]+)` | 90% |
| voyage_number | important | `VSL\.[A-Z\s]+/(\w+)` | `Voyage ([A-Z0-9]+)` | 90% |
| container_number | important | `CON\.NO\.([A-Z]{4}\d{7})/([A-Z` | `([A-Z]{4}\d{7})\s+1x40HC` | 95% |
| corrections_needed | optional | `Modification requested` | `Please change as per below` | 95% |
| approval_deadline | optional | `-` | `for your approval` | 70% |

**Notes:** Missing patterns for shipper_name (0 total patterns); Missing patterns for consignee_name (0 total patterns); Critical entities shipper_name and consignee_name have no extraction patterns; Only 1 of 3 critical entities properly covered

---

### shipping_bill

**Description:** Export customs declaration document (India specific)

**⚠️ Classification Issues:** RE: BKG #36055216 | ANAND NVH | 1X40HC | ICD TKD T; PTFC Meetings conducted by Commissioner of Customs; Re: RL/SE/3648/25-26 || SVM-2454 || MSKU5710280 //

| Entity | Priority | Subject Pattern | Body Pattern | Confidence |
|--------|----------|-----------------|--------------|------------|
| shipping_bill_number | critical | `SB No\s*:?\s*(\d{7})` | `shipping bill no\.?\s*([\d,]+)` | 95% |
| exporter_name | critical | `([A-Z][A-Z\s&]+)\s*\|` | `M/s\s+([A-Za-z\s&]+?)\s+for` | 85% |
| booking_number | important | `BOOKING NO\.?\s*(\d{8})` | `Booking No\.?\s*(\d{8})` | 90% |
| container_number | important | `-` | `Container No\.?\s*([A-Z]{4}\d{` | 95% |
| let_export_date | important | `SB Date\s*:?\s*(\d{2}/\d{2}/\d` | `DT\.\s*(\d{2}\.\d{2}\.\d{4})` | 95% |

**Notes:** container_number has 0 subject patterns - may miss extractions from email subjects; let_export_date only has 1 subject pattern - consider adding more body patterns for better coverage

---

