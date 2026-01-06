# Document Classification Framework

## Analysis Summary

**Analysis Date:** January 2026
**Sample Size:** 5,600+ classified documents
**Current Accuracy:** ~20% (validated against content)

### Key Finding: Current System is Broken

The current subject/body-based classification produces:
- `general_correspondence`: Contains BL, Arrival Notice, Booking Confirmation, Wire Receipts
- `invoice`: Contains Entry Summary (7501), Booking Confirmations, Packing Lists
- `sob_confirmation`: Contains Tax Invoices, Pro Forma Invoices
- **80% misclassification rate** on sampled documents

---

## Shipment Lifecycle Phases

A freight shipment flows through these phases. Documents align to phases:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           SHIPMENT LIFECYCLE                                  │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────┐   ┌──────────┐   ┌────────────┐   ┌─────────┐   ┌───────────┐  │
│  │  PRE-   │──▶│  EXPORT  │──▶│ DOCUMENTA- │──▶│   IN-   │──▶│  IMPORT   │  │
│  │ BOOKING │   │ CUSTOMS  │   │    TION    │   │ TRANSIT │   │  CUSTOMS  │  │
│  └────┬────┘   └────┬─────┘   └─────┬──────┘   └────┬────┘   └─────┬─────┘  │
│       │             │               │               │               │        │
│       ▼             ▼               ▼               ▼               ▼        │
│  ┌─────────┐   ┌──────────┐   ┌────────────┐   ┌─────────┐   ┌───────────┐  │
│  │ ARRIVAL │──▶│ DELIVERY │──▶│  FINANCIAL │──▶│  FINAL  │──▶│  ARCHIVE  │  │
│  │         │   │          │   │            │   │         │   │           │  │
│  └─────────┘   └──────────┘   └────────────┘   └─────────┘   └───────────┘  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Document Taxonomy (Final)

### Phase 1: PRE-SHIPMENT (Booking Stage)

| Type | Content Markers | Senders | Filename Patterns |
|------|-----------------|---------|-------------------|
| `booking_confirmation` | "BOOKING CONFIRMATION", Booking No. | Shipping Lines | `*BC*.pdf`, `*booking*confirm*` |
| `booking_amendment` | "BOOKING AMENDMENT" | Shipping Lines | `*amendment*`, `*update*` |
| `booking_cancellation` | "BOOKING CANCEL" | Shipping Lines | `*cancel*` |
| `rate_quote` | Rate, Quote, Quotation | Forwarders, Carriers | `*quote*`, `*rate*` |
| `vgm_submission` | "VGM", "Verified Gross Mass", PreGateCntDetails | Shipper, Carrier | `VGM*`, `PreGate*` |
| `vgm_reminder` | "Submit your VGM" | Carriers | `*VGM*REMINDER*` |
| `cutoff_advisory` | "CUTOFF", SI/VGM/Cargo cutoff | Carriers | `*cutoff*` |
| `vessel_schedule` | "SCHEDULE", ETD, ETA, Rotation | Carriers | `*schedule*` |

### Phase 2: EXPORT CUSTOMS (Origin Country)

| Type | Content Markers | Senders | Filename Patterns |
|------|-----------------|---------|-------------------|
| `commercial_invoice` | "COMMERCIAL INVOICE", "EXPORTER", HS Code | Shipper | `*CI*`, `*commercial*invoice*` |
| `packing_list` | "PACKING LIST", Packages, Weight | Shipper | `*PL*`, `*packing*list*` |
| `shipping_bill` | "SHIPPING BILL FOR EXPORT", SB No | India CHA | `*SB*`, `*shipping*bill*` |
| `leo_copy` | "LET EXPORT ORDER", LEO | India CHA | `*LEO*`, `*gate*pass*` |
| `cha_checklist` | "CHECK LIST", "Shipping Bill", CHA | India CHA | `*checklist*` |
| `annexure` | "ANNEXURE", Export Declaration | India CHA | `*annexure*` |

### Phase 3: DOCUMENTATION (Bill of Lading Stage)

| Type | Content Markers | Senders | Filename Patterns |
|------|-----------------|---------|-------------------|
| `shipping_instruction` | "Shipping instruction", "Submitted on" | Forwarder, Carrier | `*SI*`, `*shipping*instruction*` |
| `draft_hbl` | "BILL OF LADING" + "DRAFT" or draft filename | Forwarder | `*DRAFT*.pdf`, `*-DRAFT.pdf` |
| `draft_mbl` | "BILL OF LADING" + "DRAFT" + carrier origin | Carrier | `*DRAFT*.pdf` |
| `hbl` | "BILL OF LADING", no DRAFT | Forwarder | `*FINAL*.pdf`, `*HBL*` |
| `mbl` | "Bill of Lading", carrier format, no DRAFT | Carrier | `*MBL*`, Hapag/Maersk format |
| `sob_confirmation` | "SHIPPED ON BOARD", SOB Date | Carrier | `*SOB*` |
| `sea_waybill` | "Sea Waybill" | Carrier | `*waybill*` |

### Phase 4: IN-TRANSIT

| Type | Content Markers | Senders | Filename Patterns |
|------|-----------------|---------|-------------------|
| `shipment_tracking` | Status, Milestone, Tracking | Carrier | - |
| `delay_notice` | "DELAY", "ROLLOVER", Schedule change | Carrier | - |
| `vessel_change` | Vessel change, Transshipment | Carrier | - |

### Phase 5: IMPORT CUSTOMS (Destination Country)

| Type | Content Markers | Senders | Filename Patterns |
|------|-----------------|---------|-------------------|
| `isf_filing` | "ISF", "Importer Security Filing", "10+2" | US Broker | `*ISF*` |
| `draft_entry` | "DRAFT" + "ENTRY", preliminary entry for review | US Broker | `*draft*entry*` |
| `entry_immediate_delivery` | "ENTRY/IMMEDIATE DELIVERY", CBP 3461 | US Broker | `*3461*` |
| `entry_summary` | "ENTRY SUMMARY", CBP 7501, "DEPARTMENT OF HOMELAND SECURITY" | US Broker | `*7501*` |
| `customs_bond` | "CUSTOMS BOND", CBP | US Broker | `*bond*` |
| `cbsa_cargo_control` | CBSA, Canadian customs | Canada Broker | - |

### Phase 6: ARRIVAL & DELIVERY

| Type | Content Markers | Senders | Filename Patterns |
|------|-----------------|---------|-------------------|
| `arrival_notice` | "ARRIVAL NOTICE" | Carrier, Forwarder | `*AN*`, `*arrival*` |
| `delivery_order` | "DELIVERY ORDER", D/O | Carrier, Forwarder | `*DO*`, `*delivery*order*` |
| `container_release` | "CONTAINER RELEASE", Release | Carrier | `*release*` |
| `gate_in` | "GATE IN", Terminal | Terminal, Trucker | `*gate*in*` |
| `proof_of_delivery` | "PROOF OF DELIVERY", POD, Signature | Trucker | `*POD*` |
| `empty_return` | "EMPTY RETURN", MTY | Trucker, Depot | `*empty*`, `*MTY*` |

### Phase 7: FINANCIAL

| Type | Content Markers | Senders | Filename Patterns |
|------|-----------------|---------|-------------------|
| `freight_invoice` | Carrier invoice, Ocean freight charges | Carrier | `INV*`, carrier format |
| `duty_invoice` | Duty, MPF, HMF, Customs charges | US Broker | `*duty*` |
| `service_invoice` | Service charges, Forwarder fee | Forwarder | `Invoice*` |
| `tax_invoice` | "TAX INVOICE", GSTIN, India GST | India Forwarder | `TAX INVOICE*` |
| `proforma_invoice` | "PRO FORMA", Quotation | Forwarder | `Pro Forma*` |
| `payment_receipt` | "Your receipt from Mercury", Wire/ACH | Intoglo | `Wire Receipt*`, `mercury-*` |
| `detention_invoice` | "DETENTION", Per diem charges | Carrier | `*detention*` |
| `demurrage_invoice` | "DEMURRAGE", Port storage | Terminal, Carrier | `*demurrage*` |

### Phase 8: OTHER

| Type | Content Markers | Senders | Filename Patterns |
|------|-----------------|---------|-------------------|
| `certificate` | Certificate of Origin, Insurance, etc. | Various | `*COO*`, `*COI*` |
| `rate_confirmation` | "RATE CONFIRMATION", Trucking rate | Trucker | `*rate*confirm*` |
| `work_order` | "WORK ORDER", Dispatch | Trucker | `*WO*`, `*work*order*` |
| `general_correspondence` | No specific markers (fallback) | Any | - |
| `not_shipping` | Marketing, Newsletter, Unrelated | Any | - |

---

## Sender Types (Definitive)

| Sender Type | Domains | What They Send |
|-------------|---------|----------------|
| `shipping_line` | maersk.com, hlag.com, cma-cgm.com, coscon.com, one-line.com | Booking, BL, Arrival Notice, Freight Invoice |
| `customs_broker_us` | portsidecustoms.com, sssusainc.com, jmdcustoms.com, artemusnetwork.com | ISF, 3461, 7501, Duty Invoice |
| `customs_broker_in` | anscargo.in, aarishkalogistics.com, tulsilogistics.com, vccfa.in | Shipping Bill, LEO, Checklist |
| `freight_forwarder` | odexservices.com, flexport.com, highwayroop.com, jasliner.com | HBL, SI, Arrival Notice |
| `trucker_us` | transjetcargo.com, carmeltransport.com, triwaystransport.com | Work Order, POD, Rate Confirmation |
| `shipper` | tradepartners.us, matangiindustries.com, pearlglobal.com, Various manufacturers | Commercial Invoice, Packing List |
| `consignee` | Customer domains | PO, Delivery confirmation |
| `intoglo` | intoglo.com | Wire Receipt, Pro Forma, Internal docs |

---

## Content-Based Classification Rules

### Priority Order:
1. **Exact Header Match** (95%+ confidence)
   - "DEPARTMENT OF HOMELAND SECURITY...ENTRY SUMMARY" → `entry_summary`
   - "BOOKING CONFIRMATION" at document start → `booking_confirmation`

2. **Strong Pattern Match** (85-94% confidence)
   - "BILL OF LADING" + "DRAFT" in content → `draft_hbl`
   - "ARRIVAL NOTICE" in content → `arrival_notice`

3. **Filename Hint + Content Validation** (75-84% confidence)
   - Filename `*7501*` + contains "ENTRY" → `entry_summary`
   - Filename `*DRAFT*` + contains "BILL OF LADING" → draft BL type

4. **AI Fallback** (Haiku) - When deterministic fails
   - Use for ambiguous documents
   - Always validate with content

5. **Judge Validation** (Haiku)
   - Cross-check email context vs document content
   - Flag mismatches for review

---

## Key Content Patterns (For Deterministic Classification)

```typescript
// Entry Summary (CBP 7501)
required: ["DEPARTMENT OF HOMELAND SECURITY", "ENTRY SUMMARY"]
optional: ["CBP Form 7501", "OMB APPROVAL"]
confidence: 98

// Entry/Immediate Delivery (CBP 3461)
required: ["ENTRY/IMMEDIATE DELIVERY"]
optional: ["CBP Form 3461", "DEPARTMENT OF HOMELAND SECURITY"]
confidence: 98

// Booking Confirmation
required: ["BOOKING CONFIRMATION"]
optional: ["Booking No.", "ETD", "Vessel"]
exclude: ["AMENDMENT", "CANCEL"]
confidence: 95

// Bill of Lading (Final)
required: ["BILL OF LADING"]
exclude: ["DRAFT"]
optional: ["Bill/Lading Number", "SHIPPER", "CONSIGNEE"]
confidence: 92

// Draft Bill of Lading
required: ["BILL OF LADING"]
filename_must_contain: ["DRAFT"]
confidence: 90

// Shipping Instruction
required: ["Shipping instruction", "Submitted on"]
optional: ["SI Sub Type", "Transport document"]
confidence: 95

// Wire Receipt (Mercury)
required: ["Your receipt from Mercury"]
optional: ["Status: Sent", "Wire", "ACH Payment"]
confidence: 96

// Shipping Bill (India Export)
required: ["SHIPPING BILL FOR EXPORT"]
optional: ["SB No", "IEC"]
confidence: 95

// LEO (Let Export Order)
required: ["LEO Date", "LEO No"]
optional: ["Port Code", "SB No"]
confidence: 95

// Arrival Notice
required: ["ARRIVAL NOTICE"]
exclude: ["PRE-ARRIVAL", "EXCEPTION"]
optional: ["B/L No", "ETA"]
confidence: 95
```

---

## Document Categories Summary

| Category | Document Types | Phase |
|----------|---------------|-------|
| `booking` | booking_confirmation, booking_amendment, booking_cancellation | Pre-Shipment |
| `vgm` | vgm_submission, vgm_reminder, vgm_confirmation | Pre-Shipment |
| `schedule` | vessel_schedule, cutoff_advisory, delay_notice | Pre-Shipment / Transit |
| `export_docs` | commercial_invoice, packing_list | Export |
| `india_customs` | shipping_bill, leo_copy, cha_checklist, annexure | Export Customs |
| `documentation` | shipping_instruction, draft_hbl, draft_mbl, hbl, mbl, sea_waybill | Documentation |
| `sob` | sob_confirmation | Documentation |
| `us_customs` | isf_filing, draft_entry, entry_immediate_delivery, entry_summary, customs_bond | Import Customs |
| `arrival_delivery` | arrival_notice, delivery_order, container_release | Arrival |
| `trucking` | gate_in, proof_of_delivery, empty_return, rate_confirmation, work_order | Delivery |
| `financial` | freight_invoice, duty_invoice, service_invoice, tax_invoice, payment_receipt | Financial |
| `other` | certificate, general_correspondence, not_shipping | Other |

---

## Total Document Types: 38

Organized into 12 categories aligned with 8 shipment lifecycle phases.

**Contrast with current system:** 53 overlapping, inconsistent types with 80% misclassification rate.

---

## Implementation Notes

1. **Content-first, always**: Read PDF text, match patterns
2. **Sender type aids disambiguation**: Same content from different senders may be different docs
3. **Filename is secondary**: Validate against content
4. **Subject/body are unreliable**: Thread replies reuse subjects with different attachments
5. **Thread position matters**: Position 5+ in thread often has different docs than subject suggests
