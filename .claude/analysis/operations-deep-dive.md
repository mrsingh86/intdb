# Deep Dive: Intoglo Operations Management

## Executive Summary

After analyzing the Origin Management (Shipment Tracker) and Destination Management (Voyager US Command Hive) sheets, I've identified the complete operational workflow, key data points, and gaps that Chronicle can address.

---

## PART 1: ORIGIN MANAGEMENT (Shipment Tracker)

### Sheet Structure
| Sheet | Purpose | Records |
|-------|---------|---------|
| SHIPMENT TRACKER | Active shipments in origin process | 702 |
| SI SHEET | Shipments pending SI submission | 65 |
| Delivered | Completed origin handoffs | 402 |
| CANCELLED | Cancelled bookings | 356 |
| NOV CANCELLED | Recent cancellations | 112 |
| MERGED | Merged bookings | 7 |

### Key Data Fields Tracked

#### 1. Booking Identity
- **Booking No.** - Carrier booking number (e.g., `257493470`, `MUMF65891400`)
- **MBL NO** - Master Bill of Lading
- **HBL NO.** - House Bill of Lading
- **Container no** - Container number(s)
- **SEAL NO.** - Seal number
- **INTOGLO DEAL ID** - Internal deal reference (e.g., `SEINUS31052501888_C`)

#### 2. Parties
- **Shipper** - Customer/exporter (e.g., BAFNA, RESILIENT, GLOBBIZ)
- **BKG PARTY** - Booking party (often INTOGLO)
- **F/W** - Forwarder reference

#### 3. Routing
- **POR** - Place of Receipt (e.g., AHMEDGARH, LUDHIANA)
- **POL** - Port of Loading (MUNDRA, NHV)
- **POD** - Port of Discharge (NEW YORK, MEMPHIS, LOS ANGELES)
- **RAMP POD** - Rail ramp destination
- **Rail Out** - Rail out date/status

#### 4. Vessel & Dates
- **Vessel Name** - Vessel (e.g., MAERSK KENTUCKY, WIKING 524S)
- **ETD** - Estimated Time of Departure
- **ETA** - Estimated Time of Arrival
- **Month** - ETD month for grouping

#### 5. Cargo Details
- **CARGO** - Cargo description (AUTO PARTS, TEXTILES)
- **CONT. NO.** - Container count
- **TEU/FEU** - 20/40 ft equivalent
- **GW (MT)** - Gross weight in metric tons
- **SPOT/Contract** - Rate type

#### 6. Cutoffs & Milestones (CRITICAL)
- **SI Cut off/AMS** - SI/AMS submission deadline
- **SI DATE** - Actual SI submission date
- **TR/VGM/SB Confirmed** - Status of TR/VGM/SB (YES, FORM 13, FW/TR, YES & LOADED)
- **Arrival at Load port-ATA** - Actual arrival at port
- **ROLL OVER** - Rollover status/date

#### 7. Documentation Status
- **AMS /ISF status** - AMS/ISF filing status (1Y/3Z, 1Y/ISF SHARED, T/S-1Y/3Z)
- **ISF TRANSACTION NO.** - ISF transaction reference
- **No of Houses** - Number of house BLs

#### 8. Financial & Closure
- **LINER ORIGIN INV** - Liner invoice status
- **Payment Status** - Payment processing status
- **OriginClearance** - Origin clearance status
- **MBL released/Pre Alert sent** - Seaway BL RCVD, iQAX BL RCVD
- **Origin scope closure** - Final handoff status
- **Invoice no Client** - Client invoice number

### Operational Workflow (Origin)

```
BOOKING CREATED
    ↓
1. SI SHEET (Active work)
   - Waiting for SI submission
   - TR/VGM/SB to be confirmed
   ↓
2. SHIPMENT TRACKER
   - SI submitted
   - AMS/ISF filed
   - Cargo loaded
   - MBL released
   ↓
3. PRE-ALERT SENT
   - Seaway BL received
   - Pre-alert to destination team
   ↓
4. DELIVERED (Archive)
   - Origin scope complete
```

### Status Progression Values

**TR/VGM/SB Confirmed:**
```
BKG NT SHARE → MAIL SEND → FW/TR → VGM/TR → YES → YES & LOADED → DONE
```

**AMS/ISF Status:**
```
Pending → 1Y/ISF SHARED → 1Y/3Z → 1Y/S1/3Z → T/S-1Y/3Z (Complete)
```

**MBL Release:**
```
Pending → Seaway BL RCVD → iQAX BL RCVD → Pre-alert sent
```

### Issues Tracked in Remarks
- "ETD 28 TO 3 AUG VESSEL DELAYED/ROLL OVER DUE LATE SI"
- "ROLLOVER BY CARRIER - SPACE CONSTRAINTS"
- "REBUS BKG" (Rebooking required)

---

## PART 2: DESTINATION MANAGEMENT (Voyager US Command Hive)

### Sheet Structure
| Sheet | Purpose | Records |
|-------|---------|---------|
| Pre-alert | Incoming shipments from origin | 16 |
| Delivered Shipments | Completed deliveries | 1,080 |
| CIF tracker | CIF shipments (customer clearance) | 203 |
| Highway Industries | Specific customer tracking | 47 |
| Contingency | Problem shipments | 333 |
| Only Delivery | Delivery-only jobs | 145 |
| DP-SOP | Standard Operating Procedures | 20 |
| Console Planning | Consolidated shipments | 110 |
| INCIDENTALS | Additional charges tracking | 39 |

### Key Data Fields Tracked

#### 1. Arrival & Timing
- **POD ETA** - Port of Discharge ETA
- **FPOD ETA** - Final Port of Delivery ETA
- **LFD to pick** - Last Free Day to pick up
- **LFD to return** - Last Free Day to return empty

#### 2. Identity
- **Inlops ID** - Internal operations ID (e.g., SEINUS24122502931_I)
- **MBL Number / Container** - MBL with container
- **HBL Number** - House BL
- **HAWB Number / BL** - Air waybill or BL

#### 3. Cargo
- **Weight / (Kgs)** - Shipment weight
- **No. of pieces / boxes** - Piece count
- **Expectec (Pallet Information / Count)** - Pallet count

#### 4. Delivery Details
- **Shipment Type** - FBA, Non-FBA
- **Final Port of Delivery** - Final destination
- **Delivery Address** - Full delivery address
- **Delivery Agent** - Trucking partner (Transjet Cargo, CIFA, Pace)

#### 5. Status Tracking (CRITICAL)
- **Custom Status** - Pre Alert shared, Custom Bonded, Under Client Scope
- **DO Status** - Delivery Order status
- **AN status** - Arrival Notice status (Sent, Awaited, Received)
- **Appointment** - Delivery appointment status
- **Appointment Details** - Specific appointment info

#### 6. Financial
- **D&D charges** - Detention & Demurrage
- **Invoice Amount (USD)** - Shipment value
- **FDA required or not** - FDA clearance needed

### Standard Operating Procedure (DP-SOP)

This is the **countdown-based workflow** from arrival:

| Days | POA Setup | Custom Clearance | Appointment | Freight Release | Delivery |
|------|-----------|------------------|-------------|-----------------|----------|
| -15 | Initiate POA & Bond | Pre-screening to CHA | - | - | - |
| -13 | - | - | - | - | Check PO Status |
| -12 | - | HS Code rectification | - | - | - |
| -10 | Check POA Completion | - | - | - | PO Validation |
| -8 | - | Check for AN | - | - | - |
| -7 | - | Initiate Custom Clearance | - | - | - |
| -6 | - | Duty Approval & Payment | - | Invoice Processing | - |
| -5 | - | - | - | Payment to Liner | - |
| -4 | - | Duty Payment Confirmation | - | - | - |
| -3 | - | - | Get appointment dates | - | - |
| -2 | - | Final Customs Clearance | - | Final Freight Release | Book appointment |
| -1 | - | - | - | Follow-up if not done | - |
| 0 | ARRIVAL | - | - | - | - |
| 2 | - | - | - | Discharge from Liner | Align delivery |
| 4 | - | - | - | - | Deliver & get POD |

### Contingency Issues Tracked

Common problems:
1. **Container not returned** - "2 containers picked - non returned, 1 at port"
2. **Detention applicable** - "Detention applicable after LFD"
3. **Chassis fees** - "Chassis fee will be charged until returned"
4. **Appointment delays** - "Container picked by JV as appt is on 4 Oct"

---

## PART 3: DATA COMPARISON - Sheets vs Chronicle

### What We Have in Chronicle
| Field | Chronicle | Origin Sheet | Destination Sheet |
|-------|-----------|--------------|-------------------|
| Booking Number | ✅ | ✅ | ✅ |
| MBL | ✅ | ✅ | ✅ |
| HBL | ✅ | ✅ | ✅ |
| Container | ✅ | ✅ | ✅ |
| ETD | ✅ | ✅ | - |
| ETA | ✅ | ✅ | ✅ |
| POL | ✅ | ✅ | - |
| POD | ✅ | ✅ | ✅ |
| Vessel | ✅ | ✅ | - |
| Carrier | ✅ | ✅ | - |
| Shipper | ✅ | ✅ | ✅ |
| Consignee | ✅ | - | ✅ (Delivery Address) |
| SI Cutoff | ✅ | ✅ | - |
| VGM Cutoff | ✅ | - | - |
| Cargo Cutoff | ✅ | - | - |

### What's MISSING from Chronicle (Critical Gaps)

| Field | Need | Source |
|-------|------|--------|
| **SI Submitted Date** | When SI was actually filed | Origin sheet |
| **TR/VGM Status** | TR/VGM/SB confirmation status | Origin sheet |
| **AMS/ISF Status** | 1Y/3Z filing status | Origin sheet |
| **MBL Release Status** | Seaway BL / iQAX status | Origin sheet |
| **Pre-Alert Sent** | Handoff to destination | Origin sheet |
| **LFD to Pick** | Last free day at destination | Destination sheet |
| **LFD to Return** | Last free day for empty return | Destination sheet |
| **AN Status** | Arrival Notice received/sent | Destination sheet |
| **DO Status** | Delivery Order issued | Destination sheet |
| **Custom Status** | Clearance status | Destination sheet |
| **Appointment Date** | Delivery appointment | Destination sheet |
| **D&D Charges** | Detention/Demurrage exposure | Destination sheet |
| **Rollover Status** | If booking was rolled | Origin sheet |
| **Inlops ID** | Internal operations ID | Both sheets |

---

## PART 4: PROPOSED OPERATIONS TABLE

Based on this analysis, here's the crystallized operations table:

```sql
CREATE TABLE shipment_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID REFERENCES shipments(id),

  -- Identity (crystallized)
  inlops_id VARCHAR(50),           -- SEINUS24122502931_I
  booking_number VARCHAR(50),
  mbl_number VARCHAR(50),
  hbl_number VARCHAR(50),
  container_numbers TEXT[],
  seal_numbers TEXT[],

  -- Routing (crystallized)
  por VARCHAR(50),                  -- Place of Receipt
  pol VARCHAR(10),                  -- Port of Loading
  pod VARCHAR(10),                  -- Port of Discharge
  fpod VARCHAR(100),                -- Final Port of Delivery
  ramp_pod VARCHAR(50),             -- Rail ramp
  delivery_address TEXT,

  -- Vessel & Schedule (crystallized)
  vessel_name VARCHAR(100),
  voyage_number VARCHAR(20),
  carrier VARCHAR(20),
  etd DATE,
  eta DATE,
  fpod_eta DATE,                    -- Final delivery ETA

  -- Cutoffs (crystallized)
  si_cutoff TIMESTAMP,
  vgm_cutoff TIMESTAMP,
  cargo_cutoff TIMESTAMP,
  ams_cutoff TIMESTAMP,

  -- Origin Milestones
  si_submitted_at TIMESTAMP,
  si_confirmed_at TIMESTAMP,
  tr_vgm_status VARCHAR(50),        -- YES, FORM 13, FW/TR, YES & LOADED
  ams_isf_status VARCHAR(50),       -- 1Y/3Z, 1Y/ISF SHARED
  cargo_loaded_at TIMESTAMP,
  mbl_released_at TIMESTAMP,
  mbl_release_type VARCHAR(50),     -- Seaway BL, iQAX, E-BL
  pre_alert_sent_at TIMESTAMP,
  origin_scope_closed_at TIMESTAMP,

  -- Destination Milestones
  arrival_notice_received_at TIMESTAMP,
  arrival_notice_sent_at TIMESTAMP,  -- Sent to consignee
  customs_entry_filed_at TIMESTAMP,
  duty_approved_at TIMESTAMP,
  duty_paid_at TIMESTAMP,
  customs_cleared_at TIMESTAMP,
  freight_released_at TIMESTAMP,
  delivery_order_issued_at TIMESTAMP,
  container_picked_at TIMESTAMP,
  appointment_date DATE,
  delivered_at TIMESTAMP,
  pod_received_at TIMESTAMP,
  container_returned_at TIMESTAMP,

  -- Free Time & Charges
  lfd_to_pick DATE,                 -- Last Free Day to pick
  lfd_to_return DATE,               -- Last Free Day to return
  free_time_expiry DATE,
  detention_charges DECIMAL(10,2),
  demurrage_charges DECIMAL(10,2),

  -- Issues & Flags
  is_rolled_over BOOLEAN DEFAULT FALSE,
  rollover_reason TEXT,
  rollover_new_etd DATE,
  has_contingency BOOLEAN DEFAULT FALSE,
  contingency_reason TEXT,

  -- Computed Flags (for proactive alerts)
  needs_si BOOLEAN GENERATED ALWAYS AS (
    si_submitted_at IS NULL
    AND si_cutoff IS NOT NULL
    AND si_cutoff <= NOW() + INTERVAL '48 hours'
  ) STORED,

  needs_arrival_notice BOOLEAN GENERATED ALWAYS AS (
    eta IS NOT NULL
    AND eta <= NOW() + INTERVAL '7 days'
    AND arrival_notice_received_at IS NULL
  ) STORED,

  needs_customs_clearance BOOLEAN GENERATED ALWAYS AS (
    arrival_notice_received_at IS NOT NULL
    AND customs_cleared_at IS NULL
    AND eta <= NOW() + INTERVAL '3 days'
  ) STORED,

  at_detention_risk BOOLEAN GENERATED ALWAYS AS (
    lfd_to_pick IS NOT NULL
    AND container_picked_at IS NULL
    AND lfd_to_pick <= NOW() + INTERVAL '2 days'
  ) STORED,

  at_demurrage_risk BOOLEAN GENERATED ALWAYS AS (
    lfd_to_return IS NOT NULL
    AND container_returned_at IS NULL
    AND lfd_to_return <= NOW() + INTERVAL '2 days'
  ) STORED,

  -- AI Summary Cache
  ai_summary JSONB,
  ai_summary_updated_at TIMESTAMP,

  -- Audit
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_synced_from_email_at TIMESTAMP,
  last_synced_from_sheet_at TIMESTAMP
);

-- Indexes for common queries
CREATE INDEX idx_ops_needs_si ON shipment_operations(needs_si) WHERE needs_si = TRUE;
CREATE INDEX idx_ops_needs_an ON shipment_operations(needs_arrival_notice) WHERE needs_arrival_notice = TRUE;
CREATE INDEX idx_ops_detention ON shipment_operations(at_detention_risk) WHERE at_detention_risk = TRUE;
CREATE INDEX idx_ops_eta ON shipment_operations(eta);
CREATE INDEX idx_ops_inlops ON shipment_operations(inlops_id);
```

---

## PART 5: PROACTIVE ALERTS ENABLED

With this operations table, Chronicle can generate:

### Origin Team Alerts
1. **SI Cutoff Warning**: "3 shipments have SI cutoff tomorrow - no SI submitted"
2. **VGM Pending**: "5 bookings departing in 3 days - VGM not confirmed"
3. **Rollover Detected**: "Booking 257493470 rolled from Jan 4 to Jan 5 - vessel delay"
4. **Pre-Alert Due**: "8 shipments with MBL released - pre-alert not sent"

### Destination Team Alerts
1. **No Arrival Notice**: "Shipment arriving Jan 15 - no AN received from Maersk"
2. **Customs Deadline**: "ETA in 3 days - customs clearance not initiated"
3. **LFD Warning**: "Container MSKU7685421 - LFD to pick is tomorrow"
4. **Detention Risk**: "2 containers past LFD - $150/day detention accruing"
5. **Appointment Missing**: "Vessel arrived - no delivery appointment scheduled"

### Management Alerts
1. **Financial Exposure**: "Total D&D exposure this week: $2,400"
2. **Blocked Shipments**: "5 shipments blocked on customs duty approval"
3. **SLA Breach Risk**: "3 Amazon deliveries at risk of missing appointment"

---

## PART 6: INTEGRATION STRATEGY

### Data Sources → Operations Table

```
┌─────────────────┐
│   EMAIL/DOCS    │───→ Chronicle extracts → UPDATE operations
│  (via Chronicle)│
└─────────────────┘

┌─────────────────┐
│  GOOGLE SHEETS  │───→ Sheet sync job → UPDATE operations
│ (Origin/Dest)   │
└─────────────────┘

┌─────────────────┐
│  CARGOWISE API  │───→ CW integration → UPDATE operations
│  (if available) │
└─────────────────┘

┌─────────────────┐
│  MANUAL ENTRY   │───→ Dashboard UI → UPDATE operations
│  (corrections)  │
└─────────────────┘

                            ↓
                  ┌───────────────────┐
                  │ shipment_operations│
                  │  (Single Source)   │
                  └───────────────────┘
                            ↓
        ┌───────────────────┼───────────────────┐
        ↓                   ↓                   ↓
   Chronicle UI      Proactive Alerts     AI Summaries
  (split view)       (Slack/Email)        (context-aware)
```

### Phase 1: Email → Operations
- Extract milestones from booking confirmations
- Extract cutoffs from carrier emails
- Detect rollovers from amendment emails
- Extract AN/DO from destination documents

### Phase 2: Sheet Sync (Optional)
- Daily sync from Google Sheets
- Reconcile differences
- Flag discrepancies for review

### Phase 3: Proactive AI
- AI references operations table
- Generates alerts for missing milestones
- Predicts issues based on patterns

---

## PART 7: KEY INSIGHTS

### 1. The "Remarks" Column is Gold
The free-text Remarks in origin sheet captures:
- Rollover reasons
- Carrier-specific issues
- Temporary blockers

**AI should parse these into structured fields.**

### 2. Status Values are Semi-Structured
Status fields like `TR/VGM/SB Confirmed` have progression:
```
BKG NT SHARE → MAIL SEND → FW/TR → VGM/TR → YES → YES & LOADED
```

**Chronicle should understand this progression.**

### 3. Inlops ID is the Key
The `Inlops ID` (e.g., SEINUS24122502931_I) links origin to destination.

**This should be extracted and used as primary linking key.**

### 4. Countdown-Based Ops
Destination team works on a countdown from ETA.

**Chronicle should adopt this mental model:**
- "T-15: POA needed"
- "T-7: Customs entry"
- "T-3: Appointment"
- "T-0: Arrival"
- "T+2: Delivery"

### 5. LFD is Critical
Last Free Day (to pick, to return) determines:
- When detention starts ($150-200/day)
- When demurrage starts ($75-100/day)

**This is the most urgent financial metric.**

---

## Recommendations

1. **Create `shipment_operations` table** with all fields identified above
2. **Build sync from Chronicle** - extract milestones from emails
3. **Add countdown view** in UI - "What needs attention today?"
4. **Track LFD specifically** - highest financial impact
5. **Parse Remarks with AI** - extract structured issues
6. **Use Inlops ID** as primary key for linking

This operations table becomes the **single source of truth** that:
- Emails update
- Sheets can reconcile against
- AI summarizes
- Dashboard displays
- Alerts generate from

