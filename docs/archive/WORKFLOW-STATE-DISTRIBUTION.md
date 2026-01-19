# Workflow State Distribution Report

**Generated:** January 2026
**Total Shipments:** 128
**Total Documents:** 1,000
**Total Emails:** 1,000+

---

## Executive Summary

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         SHIPMENT LIFECYCLE                                   │
│                                                                              │
│  PRE_DEPARTURE ──────► IN_TRANSIT ──────► ARRIVAL ──────► DELIVERY          │
│      70 (55%)            37 (29%)          19 (15%)        2 (1%)           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Key Metrics

| Metric | Count |
|--------|-------|
| **BC Received** (from carriers) | 81 shipments |
| **BC Shared** (to customers) | 34 shipments |
| Only BC Received (not shared yet) | 53 shipments |
| Only BC Shared (no inbound BC) | 6 shipments |
| Both BC states | 28 shipments |

---

## Phase Distribution

```
┌─────────────────────────────────────────────────────────────────┐
│ PRE_DEPARTURE                                                   │
│ ████████████████████████████████████████████████████████  70    │
│ (55%)                                                           │
├─────────────────────────────────────────────────────────────────┤
│ IN_TRANSIT                                                      │
│ ██████████████████████████████                           37     │
│ (29%)                                                           │
├─────────────────────────────────────────────────────────────────┤
│ ARRIVAL                                                         │
│ ███████████████                                          19     │
│ (15%)                                                           │
├─────────────────────────────────────────────────────────────────┤
│ DELIVERY                                                        │
│ ██                                                        2     │
│ (1%)                                                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Workflow State Distribution

### PRE_DEPARTURE Phase (70 shipments)

| Workflow State | Count | Description |
|----------------|-------|-------------|
| `booking_confirmation_shared` | 37 | BC forwarded to customer |
| `booking_confirmation_received` | 14 | BC received from carrier |
| `si_draft_sent` | 5 | SI draft sent to shipper |
| `sob_received` | 4 | Shipped on board confirmation |
| `shipping_bill_received` | 2 | Export clearance (India) |
| `si_confirmed` | 2 | SI confirmed by carrier |
| `checklist_received` | 1 | CHA checklist received |
| `vgm_submitted` | 1 | VGM submitted to carrier |

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PRE_DEPARTURE FLOW                                                           │
│                                                                              │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐          │
│  │ BC Received (14)│───►│ BC Shared (37)  │───►│ SI Draft (5)    │          │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘          │
│          │                                              │                    │
│          │                                              ▼                    │
│          │                                     ┌─────────────────┐          │
│          │                                     │ SI Confirmed (2)│          │
│          │                                     └─────────────────┘          │
│          │                                              │                    │
│          ▼                                              ▼                    │
│  ┌─────────────────┐                          ┌─────────────────┐          │
│  │ VGM Submitted(1)│─────────────────────────►│ SOB Received (4)│          │
│  └─────────────────┘                          └─────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### IN_TRANSIT Phase (37 shipments)

| Workflow State | Count | Description |
|----------------|-------|-------------|
| `invoice_sent` | 21 | Invoice sent to customer |
| `hbl_shared` | 9 | House BL shared with customer |
| `bl_received` | 2 | BL received from carrier |

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ IN_TRANSIT FLOW                                                              │
│                                                                              │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐          │
│  │ BL Received (2) │───►│ HBL Shared (9)  │───►│Invoice Sent (21)│          │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### ARRIVAL Phase (19 shipments)

| Workflow State | Count | Description |
|----------------|-------|-------------|
| `arrival_notice_shared` | 9 | Arrival notice shared with customer |
| `arrival_notice_received` | 4 | Arrival notice from carrier |
| `container_released` | 6 | Container released for pickup |
| `delivery_order_shared` | 5 | DO shared with customer |
| `duty_summary_shared` | 3 | Duty summary shared |
| `duty_invoice_received` | 1 | Duty invoice from broker |
| `cargo_released` | 1 | Cargo cleared and released |
| `delivery_order_received` | 1 | DO received from carrier |

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ARRIVAL FLOW                                                                 │
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │AN Received(4)│───►│AN Shared (9) │───►│Duty Inv (1)  │                   │
│  └──────────────┘    └──────────────┘    └──────────────┘                   │
│                                                 │                            │
│                                                 ▼                            │
│                                         ┌──────────────┐                    │
│                                         │Duty Shared(3)│                    │
│                                         └──────────────┘                    │
│                                                 │                            │
│                                                 ▼                            │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                   │
│  │DO Received(1)│───►│DO Shared (5) │───►│Released (6)  │                   │
│  └──────────────┘    └──────────────┘    └──────────────┘                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### DELIVERY Phase (2 shipments)

| Workflow State | Count | Description |
|----------------|-------|-------------|
| `container_released` | - | Ready for delivery |
| `pod_received` | - | Proof of delivery received |

---

## Document Type Distribution

### By Volume

| Document Type | Count | % of Total |
|---------------|-------|------------|
| booking_confirmation | 237 | 23.7% |
| booking_amendment | 178 | 17.8% |
| general_correspondence | 168 | 16.8% |
| bill_of_lading | 129 | 12.9% |
| hbl_draft | 74 | 7.4% |
| shipping_instruction | 49 | 4.9% |
| invoice | 41 | 4.1% |
| sob_confirmation | 17 | 1.7% |
| rate_quote | 15 | 1.5% |
| Others | 92 | 9.2% |

### By Direction

| Document Type | Inbound | Outbound | No Direction |
|---------------|---------|----------|--------------|
| booking_confirmation | 82 | 19 | 136 |
| booking_amendment | 24 | 40 | 114 |
| general_correspondence | 17 | 0 | 151 |
| bill_of_lading | 11 | 18 | 100 |
| hbl_draft | 4 | 15 | 55 |
| shipping_instruction | 0 | 9 | 40 |
| invoice | 0 | 10 | 31 |
| sob_confirmation | 3 | 3 | 11 |
| rate_quote | 0 | 13 | 2 |

---

## Booking Confirmation Analysis

### Visual Distribution

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    BOOKING CONFIRMATION STATES                               │
│                                                                              │
│  ┌───────────────────────────────────────┐                                  │
│  │ BC RECEIVED (Inbound from Carrier)    │                                  │
│  │ █████████████████████████████████ 81  │                                  │
│  └───────────────────────────────────────┘                                  │
│                                                                              │
│  ┌───────────────────────────────────────┐                                  │
│  │ BC SHARED (Outbound to Customer)      │                                  │
│  │ █████████████ 34                      │                                  │
│  └───────────────────────────────────────┘                                  │
│                                                                              │
│  Venn Diagram:                                                               │
│                                                                              │
│    ┌─────────────────────────────┐                                          │
│    │    ONLY RECEIVED: 53       │                                           │
│    │   ┌─────────────────┐      │                                           │
│    │   │  BOTH: 28       │──────┼──── ONLY SHARED: 6                        │
│    │   └─────────────────┘      │                                           │
│    └─────────────────────────────┘                                          │
│                                                                              │
│  Interpretation:                                                             │
│  • 53 shipments have BC from carrier but NOT shared to customer yet         │
│  • 28 shipments have BC received AND shared to customer                     │
│  • 6 shipments have BC shared but no inbound BC (manual entry?)             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### BC Flow

```
    CARRIER                    INTOGLO                    CUSTOMER
       │                          │                          │
       │   Booking Confirmation   │                          │
       ├─────────────────────────►│                          │
       │                          │                          │
       │                          │   BC RECEIVED (81)       │
       │                          │   ────────────────       │
       │                          │                          │
       │                          │   Forward BC to          │
       │                          ├─────────────────────────►│
       │                          │                          │
       │                          │   BC SHARED (34)         │
       │                          │   ──────────────         │
       │                          │                          │
```

---

## Direction Detection Logic

### Decision Flow

```
                           ┌──────────────┐
                           │ sender_email │
                           └──────┬───────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │ Contains " via "?         │
                    └─────────────┬─────────────┘
                         YES      │      NO
                          │       │       │
                          ▼       │       ▼
                    ┌─────────┐   │  ┌────────────────────┐
                    │ INBOUND │   │  │ Is @intoglo.com?   │
                    │ (group) │   │  └─────────┬──────────┘
                    └─────────┘   │       YES  │    NO
                                  │            │     │
                                  │            ▼     ▼
                                  │  ┌────────────┐ ┌─────────┐
                                  │  │ Is Reply?  │ │ INBOUND │
                                  │  │ (Re:/Fwd:) │ │(carrier)│
                                  │  └─────┬──────┘ └─────────┘
                                  │   YES  │   NO
                                  │        ▼    │
                                  │  ┌──────────┐│
                                  │  │ OUTBOUND ││
                                  │  │ (reply)  ││
                                  │  └──────────┘│
                                  │              ▼
                                  │  ┌───────────────────────┐
                                  │  │ Carrier BC Pattern?   │
                                  │  │ ops@/pricing@ sender  │
                                  │  └──────────┬────────────┘
                                  │        YES  │    NO
                                  │             │     │
                                  │             ▼     ▼
                                  │       ┌─────────┐ ┌──────────┐
                                  │       │ INBOUND │ │ OUTBOUND │
                                  │       │(carrier)│ │ (intoglo)│
                                  │       └─────────┘ └──────────┘
```

### Carrier BC Patterns

| Pattern | Example | Detection |
|---------|---------|-----------|
| `^Booking Confirmation :` | "Booking Confirmation : 263825330" | INBOUND |
| `^Cosco Shipping Line Booking Confirmation` | "Cosco Shipping Line..." | INBOUND |
| `^CMA CGM - Booking confirmation available` | "CMA CGM - Booking..." | INBOUND |
| `Price overview - booking` | "Price overview - booking confirmation" | **NOT BC** (rate_quote) |

---

## Workflow State Mapping Reference

### Complete Mapping Table

| Document Type | Inbound → State | Outbound → State |
|---------------|-----------------|------------------|
| **Booking** | | |
| booking_confirmation | `booking_confirmation_received` | `booking_confirmation_shared` |
| booking_amendment | `booking_confirmation_received` | `booking_confirmation_shared` |
| booking_cancellation | `booking_cancelled` | `booking_cancelled` |
| **SI** | | |
| si_draft | `si_draft_received` | `si_draft_sent` |
| shipping_instruction | `si_draft_received` | `si_draft_sent` |
| si_confirmation | `si_confirmed` | `si_confirmed` |
| si_submission | `si_confirmed` | `si_confirmed` |
| **VGM** | | |
| vgm_confirmation | `vgm_confirmed` | `vgm_confirmed` |
| vgm_submission | `vgm_confirmed` | `vgm_submitted` |
| vgm_reminder | `vgm_pending` | - |
| **BL** | | |
| bill_of_lading | `bl_received` | `hbl_shared` |
| hbl_draft | `hbl_draft_sent` | `hbl_draft_sent` |
| hbl_release | - | `hbl_released` |
| house_bl | - | `hbl_released` |
| **Invoice** | | |
| invoice | `commercial_invoice_received` | `invoice_sent` |
| freight_invoice | `commercial_invoice_received` | `invoice_sent` |
| duty_invoice | `duty_invoice_received` | `duty_summary_shared` |
| **Arrival** | | |
| arrival_notice | `arrival_notice_received` | `arrival_notice_shared` |
| shipment_notice | `arrival_notice_received` | `arrival_notice_shared` |
| **Customs** | | |
| customs_clearance | `customs_cleared` | `customs_cleared` |
| customs_document | `duty_invoice_received` | `duty_summary_shared` |
| exam_notice | `customs_hold` | - |
| **Delivery** | | |
| delivery_order | `delivery_order_received` | `delivery_order_shared` |
| container_release | `container_released` | `container_released` |
| pod | `pod_received` | `pod_received` |
| proof_of_delivery | `pod_received` | `pod_received` |

---

## Data Quality Issues

### Documents Without Direction

**Issue:** 500+ documents have no `email_direction` set on linked emails.

| Document Type | No Direction Count |
|---------------|-------------------|
| general_correspondence | 151 |
| booking_confirmation | 136 |
| booking_amendment | 114 |
| bill_of_lading | 100 |
| hbl_draft | 55 |
| shipping_instruction | 40 |
| invoice | 31 |

**Impact:** These documents cannot trigger accurate workflow state transitions.

**Fix:** Run direction backfill on emails where `email_direction IS NULL`.

---

## Shipment Status vs Workflow State

| Status | Count | Common Workflow States |
|--------|-------|----------------------|
| in_transit | 70 | booking_confirmation_shared, invoice_sent |
| booked | 50 | booking_confirmation_received, si_draft_sent |
| cancelled | 6 | booking_cancelled |
| draft | 2 | (no workflow state) |

---

## Recommendations

1. **Backfill Missing Directions:** ~500 documents have no direction on linked emails
2. **Monitor BC Gap:** 53 shipments have BC received but not shared yet
3. **Track Stale States:** 14 shipments still at `booking_confirmation_received`
4. **Arrival Follow-up:** 19 shipments in arrival phase need delivery completion

---

*Last Updated: January 2026*
