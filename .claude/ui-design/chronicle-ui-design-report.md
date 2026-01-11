# Chronicle Intelligence System - UI Design Report

**Version:** 1.0
**Date:** 2026-01-11
**Design Mode:** RESEARCH + GENERATE
**Target:** World-Class Freight Forwarding Dashboard

---

## Executive Summary

This document presents a comprehensive UI design strategy for the Chronicle Intelligence System - a freight forwarding dashboard that tells the "story" of shipments through their document trail. The design philosophy centers on **Progressive Disclosure**, **Storytelling**, and **Action-Oriented** interfaces.

### Research Sources
- [Flexport Platform 2.0](https://medium.com/flexport-ux/the-flexport-dashboard-2-0-2524f8e92245) - "Watchtower" concept
- [project44 Movement Platform](https://www.project44.com/platform/visibility/) - Configurable workspaces
- [Nielsen Norman Group - Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)
- [Baymard Institute - Order Tracking](https://baymard.com/ecommerce-design-examples/63-order-tracking-page)
- [UXPin Dashboard Principles](https://www.uxpin.com/studio/blog/dashboard-design-principles/)

---

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [User Personas & Journeys](#2-user-personas--journeys)
3. [Information Architecture](#3-information-architecture)
4. [Level 1: Command Center Dashboard](#4-level-1-command-center-dashboard)
5. [Level 2: Shipment List](#5-level-2-shipment-list)
6. [Level 3: Shipment Detail - The Story](#6-level-3-shipment-detail---the-story)
7. [Level 4: Document/Chronicle Detail](#7-level-4-documentchronicle-detail)
8. [Visual Language & Design System](#8-visual-language--design-system)
9. [Component Hierarchy](#9-component-hierarchy)
10. [Mobile Considerations](#10-mobile-considerations)
11. [Key Interactions](#11-key-interactions)
12. [Implementation Recommendations](#12-implementation-recommendations)

---

## 1. Design Philosophy

### Core Principles

#### 1.1 Progressive Disclosure
**Macro to Micro:** Users should flow naturally from high-level overview to granular details.

```
Command Center (Bird's Eye View)
    |
    v
Shipment List (Fleet View)
    |
    v
Shipment Detail (Single Journey)
    |
    v
Document/Chronicle (Evidence/Proof)
```

**Why:** Freight forwarders managing 100+ shipments need to quickly identify exceptions, then drill down only when necessary. Don't overwhelm with details upfront.

#### 1.2 Storytelling Interface
Every shipment is a **journey with chapters**:
- **Chapter 1:** Booking - The Beginning
- **Chapter 2:** Documentation - Preparation
- **Chapter 3:** Departure - The Launch
- **Chapter 4:** Transit - The Voyage
- **Chapter 5:** Arrival - Landfall
- **Chapter 6:** Delivery - The Destination

Each chapter has:
- **Events:** What happened
- **Documents:** Evidence/proof
- **Actors:** Who was involved
- **Actions:** What needs to happen next

#### 1.3 Action-Oriented Design
Every view should answer: **"What needs my attention NOW?"**

Priority hierarchy:
1. **Critical Alerts** (Red) - Overdue cutoffs, missed milestones
2. **Time-Sensitive** (Amber) - Approaching cutoffs, pending actions
3. **Informational** (Blue) - Status updates, completions
4. **Neutral** (Gray) - Archived, no action needed

#### 1.4 Intelligent Defaults
- Show departures/arrivals for TODAY by default
- Pre-filter to user's role (Departure Team vs. Arrival Team)
- Remember user preferences (column widths, sort orders)
- Smart groupings (by vessel, customer, urgency)

---

## 2. User Personas & Journeys

### 2.1 Freight Forwarder Operations Manager
**Goal:** Monitor entire operation, identify exceptions, delegate
**Primary Views:** Command Center, Alerts
**Key Actions:**
- "Show me what's going wrong"
- "Which shipments need escalation?"
- "Performance overview for the week"

### 2.2 Departure Team Operator
**Goal:** Ensure shipments depart on time with correct documentation
**Primary Views:** Pre-Departure Shipments, Cutoff Dashboard
**Key Actions:**
- "Which cutoffs are expiring TODAY?"
- "Has SI been submitted for booking X?"
- "What documents are missing before departure?"

**Critical Cutoff Focus:**
- SI Cutoff (Shipping Instructions)
- VGM Cutoff (Verified Gross Mass)
- Cargo/CY Cutoff
- Documentation Cutoff

### 2.3 Arrival Team Operator
**Goal:** Coordinate arrivals, customs clearance, delivery
**Primary Views:** Arrival Shipments, Inland Destination Tracking
**Key Actions:**
- "Which vessels are arriving this week?"
- "Has customs clearance started for vessel X?"
- "Where is cargo at inland destination?"

### 2.4 Shipper (External)
**Goal:** Track export progress, see document status
**Primary Views:** My Shipments, Document Gallery
**Key Actions:**
- "When will my goods depart?"
- "Is my BL ready?"
- "Track my container"

### 2.5 Consignee (External)
**Goal:** Know arrival timing, customs status
**Primary Views:** Arrival Tracking, Customs Status
**Key Actions:**
- "When will goods arrive?"
- "Has customs clearance started?"
- "What duties are payable?"

---

## 3. Information Architecture

### 3.1 Navigation Structure

```
Chronicle Intelligence System
|
+-- Command Center (Level 1)
|   |-- Today's Overview
|   |-- Critical Alerts
|   |-- Cutoff Countdown
|   |-- Journey Progress Distribution
|   |-- Weekly Cohort Analysis
|   +-- Insights Queue
|
+-- Shipments (Level 2)
|   |-- List View (Default)
|   |   |-- Phase Tabs (Pre-Departure, In Transit, Arrival, Delivered)
|   |   |-- Search & Filter
|   |   |-- Quick Actions
|   |   +-- Bulk Operations
|   |-- Analytics View
|   |   |-- Performance Metrics
|   |   |-- Carrier Comparison
|   |   +-- Route Analysis
|   +-- Calendar View (Future)
|       |-- Departure Calendar
|       +-- Arrival Calendar
|
+-- Shipment Detail (Level 3)
|   |-- Journey Progress Card
|   |-- Routing Visualization
|   |   |-- Origin ICD -> POL -> POD -> Dest ICD
|   |-- Timeline Story
|   |   |-- Chronicle Events
|   |   |-- Document Flow
|   |   +-- Action History
|   |-- Cutoff Dashboard
|   |-- Document Gallery
|   |-- Stakeholder View
|   +-- Revision History
|
+-- Document Detail (Level 4)
    |-- Chronicle Data (AI Extracted)
    |-- Source Email Reference
    |-- Confidence Indicators
    |-- Before/After (Amendments)
    +-- Related Documents
```

### 3.2 Data Flow

```
Email Arrives
    |
    v
AI Extraction (Chronicle)
    |
    +---> Entity Extraction (Booking #, BL #, Dates)
    +---> Document Classification
    +---> Action Detection
    +---> Issue Flagging
    |
    v
Shipment Linking
    |
    v
Dashboard Updates
    |
    +---> Alerts (if deadline/issue)
    +---> Insights (if pattern detected)
    +---> Timeline (event added)
    +---> Document Gallery (doc added)
```

---

## 4. Level 1: Command Center Dashboard

### 4.1 Design Philosophy
The Command Center is the **"Mission Control"** for freight operations. Like Flexport's "Watchtower" concept, it provides a bird's eye view of the entire operation.

**Primary Question:** "What needs my attention right now?"

### 4.2 Layout Structure

```
+-----------------------------------------------------------------------+
|  Chronicle Command Center                    [Today's Date] [Refresh] |
+-----------------------------------------------------------------------+
|                                                                       |
|  +------------------+  +------------------+  +------------------+     |
|  | CRITICAL ALERTS  |  | TODAY'S CUTOFFS  |  | DEPARTURES TODAY |     |
|  |     [3] RED      |  |     [7] AMBER    |  |      [12]        |     |
|  +------------------+  +------------------+  +------------------+     |
|                                                                       |
|  +------------------+  +------------------+  +------------------+     |
|  | ARRIVALS TODAY   |  | AWAITING REPLY   |  | ACTIVE SHIPMENTS |     |
|  |      [5]         |  |     [8]          |  |      [156]       |     |
|  +------------------+  +------------------+  +------------------+     |
|                                                                       |
+-----------------------------------------------------------------------+
|                       JOURNEY PROGRESS DISTRIBUTION                    |
|  +------------------------------------------------------------------+ |
|  | [RED|EARLY 12] [AMBER|MIDWAY 34] [BLUE|ADVANCED 67] [GREEN|89]   | |
|  +------------------------------------------------------------------+ |
|                                                                       |
|  NEEDS ATTENTION (Low Progress + ETD < 14 days)                       |
|  +------------------------------------------------------------------+ |
|  | 23%  | MSKU1234567 | booking_confirmed | 5d to ETD | [View]       | |
|  | 18%  | HLCU7654321 | si_pending        | 8d to ETD | [View]       | |
|  +------------------------------------------------------------------+ |
|                                                                       |
+-----------------------------------------------------------------------+
|                        WEEKLY COHORT ANALYSIS                          |
|  +------------------------------------------------------------------+ |
|  | Week     | Departing | Pre-Dep | Transit | Arriving | Delivered  | |
|  |----------|-----------|---------|---------|----------|------------| |
|  | Jan 6-12 |    12     |    3    |    5    |    2     |     2      | |
|  | Jan 13-19|    18     |    8    |    6    |    3     |     1      | |
|  +------------------------------------------------------------------+ |
|                                                                       |
+-----------------------------------------------------------------------+
|                          INSIGHTS QUEUE                                |
|  +------------------------------------------------------------------+ |
|  | [+35] CRITICAL | SI Cutoff Tomorrow       | MSKU123 | [Actions] | |
|  | [+28] HIGH     | Vessel Delay Detected    | HLCU456 | [Actions] | |
|  | [+22] MEDIUM   | Document Mismatch        | OOLU789 | [Actions] | |
|  +------------------------------------------------------------------+ |
|                                                                       |
+-----------------------------------------------------------------------+
```

### 4.3 Metric Cards (Compact)

Each metric card follows the terminal/homebrew aesthetic:

```tsx
interface MetricCardProps {
  label: string;
  value: number;
  icon: LucideIcon;
  color: 'red' | 'amber' | 'blue' | 'green' | 'purple';
  href?: string;
  badge?: string; // e.g., "URGENT"
}
```

**Design:**
- Colored dot indicator (h-2 w-2 rounded-full)
- Icon in matching color
- Large monospace number
- Label in muted uppercase
- Clickable for drill-down

### 4.4 Journey Progress Distribution

A horizontal segmented bar showing shipment distribution by journey stage:

```
[EARLY 0-25%] [MIDWAY 25-50%] [ADVANCED 50-75%] [COMPLETE 75-100%]
     RED            AMBER           BLUE            GREEN
```

This immediately shows if there's a "bulge" at a particular stage indicating bottlenecks.

### 4.5 Cutoff Countdown Widget

**Critical for Departure Team:**

```
+---------------------------------------+
| CUTOFF COUNTDOWN            [Expand]  |
+---------------------------------------+
| SI CUTOFF                             |
| [======----] 6/10 submitted           |
|   MSKU123 - 2h remaining [URGENT]     |
|   HLCU456 - 6h remaining              |
+---------------------------------------+
| VGM CUTOFF                            |
| [========--] 8/10 submitted           |
|   MSKU789 - 4h remaining              |
+---------------------------------------+
| CARGO CUTOFF                          |
| [====------] 4/10 confirmed           |
|   (3 awaiting carrier confirmation)   |
+---------------------------------------+
```

### 4.6 Insights Queue

AI-generated insights with priority boost scoring:

```tsx
interface Insight {
  id: string;
  priority_boost: number;  // +40 = critical, +25 = high, etc.
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  recommended_action: string;
  shipment: ShipmentReference;
  generated_at: string;
  status: 'active' | 'acknowledged' | 'resolved';
}
```

Display shows boost score, severity indicator, title, action buttons.

---

## 5. Level 2: Shipment List

### 5.1 Design Philosophy
The Shipment List is the **"Fleet View"** - see all active shipments with filtering, sorting, and quick actions. Inspired by project44's configurable workspaces.

### 5.2 Layout Structure

```
+-----------------------------------------------------------------------+
|  Shipments                                    [156] confirmed  [+New] |
+-----------------------------------------------------------------------+
|                                                                       |
|  Phase Tabs:                                                          |
|  [* All (156)] [Pre-Departure (67)] [In Transit (45)] [Arrival (32)] |
|  [Delivered (12)]                                                     |
|                                                                       |
+-----------------------------------------------------------------------+
|  Search: [__________________] | Filters: [Carrier v] [Route v] [Date] |
+-----------------------------------------------------------------------+
|                                                                       |
|  +------------------------------------------------------------------+ |
|  | Shipment        | Parties          | Route        | Dates        | |
|  |-----------------|------------------|--------------|---------------| |
|  | MSKU1234567     | Acme Corp        | INNSA -> LAX | ETD: Jan 15  | |
|  | MOL TREASURE    | -> Widget Inc    |              | ETA: Feb 02  | |
|  |                 |                  | [ICD] -> [P] | SI: 2d [!]   | |
|  | [BOOKING_CONF]  |                  |              |              | |
|  |-----------------|------------------|--------------|---------------| |
|  | Status          | Cutoffs          | Docs         | Actions      | |
|  |-----------------|------------------|--------------|---------------| |
|  | * si_draft_rcvd | SI: Jan 12 [2d]  | [5] docs     | [...] [>]    | |
|  |                 | VGM: Jan 13 [3d] |              |              | |
|  +------------------------------------------------------------------+ |
|                                                                       |
+-----------------------------------------------------------------------+
```

### 5.3 Phase Tabs

Tabs with colored indicators matching journey phases:

```tsx
const PHASE_TABS = [
  { id: 'all', label: 'All', icon: Ship, color: 'green' },
  { id: 'pre_departure', label: 'Pre-Departure', icon: Package, color: 'blue' },
  { id: 'in_transit', label: 'In Transit', icon: Ship, color: 'purple' },
  { id: 'arrival', label: 'Arrival', icon: Anchor, color: 'amber' },
  { id: 'delivered', label: 'Delivered', icon: Truck, color: 'green' },
];
```

### 5.4 Shipment Row Design

Each row contains:

**Left Column - Identity:**
- Booking/BL number (primary identifier)
- Vessel name + voyage
- Document type badges (mini-pills)

**Middle Column - Parties & Route:**
- Shipper -> Consignee (with colored dots)
- Route: POL -> POD
- Inland: [Origin ICD] -> [Dest ICD] (if applicable)

**Right Column - Dates & Status:**
- ETD/ETA with countdown
- Cutoff indicators with urgency colors
- Workflow state badge

**Actions Column:**
- Quick actions dropdown
- Navigate arrow

### 5.5 Cutoff Countdown Indicators

Visual urgency system:

```
[SI: 2d] - Green (>3 days)
[SI: 2d] - Amber (1-3 days)
[SI: 2d!] - Red pulsing (<24h)
[SI: OVERDUE] - Red solid (past)
```

### 5.6 Smart Groupings

Allow grouping by:
- **Customer** - All shipments for one shipper
- **Vessel** - All cargo on same vessel
- **Route** - Same origin/destination
- **Urgency** - Group critical together

```tsx
interface GroupedView {
  groupBy: 'customer' | 'vessel' | 'route' | 'urgency';
  groups: Array<{
    label: string;
    count: number;
    shipments: Shipment[];
    summary: {
      criticalAlerts: number;
      approachingCutoffs: number;
    };
  }>;
}
```

---

## 6. Level 3: Shipment Detail - The Story

### 6.1 Design Philosophy
This is where the **"Chronicle"** concept shines. The shipment detail page tells the complete story of a shipment's journey through its document trail.

### 6.2 Layout Structure

```
+-----------------------------------------------------------------------+
| <- Back to Shipments                                                  |
+-----------------------------------------------------------------------+
|                                                                       |
|  [Ship Icon] MSKU1234567                    [Copy] [Resync] [Actions] |
|  * IN_TRANSIT | MOL TREASURE V.0123 | Created Jan 5, 2026             |
|  [Shipper] Acme Corp  ->  [Consignee] Widget Inc                      |
|                                                                       |
+-----------------------------------------------------------------------+
|  Jump to: [overview] [journey] [documents] [timeline] [containers]    |
|          [revisions] [stakeholders]                                   |
+-----------------------------------------------------------------------+
|                                                                       |
|  SECTION: JOURNEY PROGRESS                                            |
|  +------------------------------------------------------------------+ |
|  |  Journey Progress                     [In Transit]    55%        | |
|  |  +------------------------------------------------------------+  | |
|  |  |  [====BLUE====][===PURPLE===][----AMBER----][----GREEN----]|  | |
|  |  +------------------------------------------------------------+  | |
|  |  Booking -> Documentation -> In Transit -> Arrival -> Delivered  | |
|  |                                                                   | |
|  |  +------------------+  +------------------+                       | |
|  |  | ETD              |  | ETA              |                       | |
|  |  | Jan 15 (4d)      |  | Feb 02 (22d)     |                       | |
|  |  +------------------+  +------------------+                       | |
|  +------------------------------------------------------------------+ |
|                                                                       |
|  SECTION: ROUTING VISUALIZATION                                       |
|  +------------------------------------------------------------------+ |
|  |  Full Route                                                       | |
|  |                                                                   | |
|  |  [Truck] ICD Ahmedabad  --->  [Anchor] INNSA Nhava Sheva         | |
|  |                                    |                              | |
|  |                                    v                              | |
|  |                              [Ship] MOL TREASURE                  | |
|  |                                    |                              | |
|  |                                    v                              | |
|  |  [Anchor] LAX Los Angeles  --->  [Truck] ICD Ontario, CA         | |
|  |                                                                   | |
|  |  Transit Time: 18 days (estimated)                                | |
|  +------------------------------------------------------------------+ |
|                                                                       |
|  SECTION: CUTOFF DASHBOARD                                            |
|  +------------------------------------------------------------------+ |
|  |  [!] Cutoff Dates                                                 | |
|  |  +------------------+  +------------------+  +------------------+ | |
|  |  | SI Cutoff        |  | VGM Cutoff       |  | Cargo Cutoff     | | |
|  |  | Jan 12           |  | Jan 13           |  | Jan 14           | | |
|  |  | [2d remaining]   |  | [3d remaining]   |  | [4d remaining]   | | |
|  |  | * SUBMITTED      |  | * PENDING        |  | * PENDING        | | |
|  |  +------------------+  +------------------+  +------------------+ | |
|  +------------------------------------------------------------------+ |
|                                                                       |
+-----------------------------------------------------------------------+
```

### 6.3 Journey Progress Card

**The "Hero" component** at the top of shipment detail:

```tsx
interface JourneyProgressCardProps {
  workflowPhase: string;
  workflowState: string;
  etd: string;
  eta: string;
  status: string;
}

// Progress calculation based on workflow state
const STATE_PROGRESS: Record<string, number> = {
  'booking_confirmation_received': 10,
  'booking_confirmation_shared': 15,
  'si_draft_received': 25,
  'si_confirmed': 35,
  'mbl_draft_received': 45,
  'sob_received': 50,
  'invoice_sent': 55,
  'hbl_released': 60,
  'arrival_notice_received': 75,
  'duty_invoice_received': 85,
  'cargo_released': 90,
  'pod_received': 100,
};
```

Visual: Gradient progress bar from blue (booking) -> amber (docs) -> purple (transit) -> green (delivered)

### 6.4 Routing Visualization

**Full door-to-door routing:**

```
Origin ICD --[truck]--> POL --[vessel]--> POD --[truck]--> Dest ICD
```

Each node shows:
- Location name + code
- Icon (truck for inland, anchor for port, ship for vessel)
- Status indicator if known

### 6.5 Cutoff Dashboard

**Critical for Departure Team:**

Each cutoff shown as a card:
- Cutoff type (SI, VGM, Cargo, Doc)
- Date and time
- Countdown (days/hours remaining)
- Status indicator (SUBMITTED, PENDING, OVERDUE)
- Color coding based on urgency

```tsx
interface CutoffCardProps {
  type: 'si' | 'vgm' | 'cargo' | 'gate' | 'doc';
  cutoffDate: string;
  status: 'submitted' | 'pending' | 'overdue';
}

// Color mapping
const CUTOFF_URGENCY = {
  overdue: { bg: 'bg-red-100', border: 'border-red-500', text: 'text-red-700' },
  urgent: { bg: 'bg-amber-100', border: 'border-amber-500', text: 'text-amber-700' },
  warning: { bg: 'bg-yellow-100', border: 'border-yellow-500', text: 'text-yellow-700' },
  safe: { bg: 'bg-green-100', border: 'border-green-500', text: 'text-green-700' },
};
```

### 6.6 Journey Timeline (The Story)

**The narrative of the shipment:**

```
+-----------------------------------------------------------------------+
|  JOURNEY TIMELINE                                                      |
+-----------------------------------------------------------------------+
|                                                                       |
|  [Chapter: Pre-Departure]                                 [Expand All]|
|  +------------------------------------------------------------------+ |
|  |                                                                   | |
|  |  [*] Booking Confirmation Received         Jan 5, 2026           | |
|  |      "Booking confirmed by Maersk"                                | |
|  |      From: Maersk Booking Desk                                    | |
|  |      [View Document]                                              | |
|  |                                                                   | |
|  |  [*] Booking Confirmation Shared           Jan 5, 2026           | |
|  |      "Shared with shipper Acme Corp"                              | |
|  |      To: shipping@acmecorp.com                                    | |
|  |                                                                   | |
|  |  [*] SI Draft Received                     Jan 8, 2026           | |
|  |      "Shipping instructions received from shipper"                | |
|  |      From: shipping@acmecorp.com                                  | |
|  |      [View Document] [Compare with Previous]                      | |
|  |                                                                   | |
|  |  [ ] VGM Submitted                         Expected: Jan 13      | |
|  |      (Awaiting shipper submission)                                | |
|  |                                                                   | |
|  +------------------------------------------------------------------+ |
|                                                                       |
|  [Chapter: In Transit] - Current                                      |
|  +------------------------------------------------------------------+ |
|  |  [*] Shipped on Board                      Jan 15, 2026          | |
|  |      "Container loaded on MOL TREASURE"                           | |
|  |      Port: INNSA Nhava Sheva                                      | |
|  |                                                                   | |
|  |  [ ] Vessel Arrival                        Expected: Feb 02      | |
|  |      Port: LAX Los Angeles                                        | |
|  |                                                                   | |
|  +------------------------------------------------------------------+ |
|                                                                       |
+-----------------------------------------------------------------------+
```

### 6.7 Document Gallery

Show all linked documents with:
- Document type badge
- Sender information
- Date received
- Version count (for amendments)
- Quick preview / full view

```tsx
interface DocumentGalleryProps {
  documents: DocumentWithFlow[];
  groupBy: 'type' | 'sender' | 'date';
}
```

---

## 7. Level 4: Document/Chronicle Detail

### 7.1 Design Philosophy
This is where AI transparency is crucial. Show exactly what was extracted and how confident the system is.

### 7.2 Layout Structure

```
+-----------------------------------------------------------------------+
| <- Back to Shipment                                                   |
+-----------------------------------------------------------------------+
|                                                                       |
|  [Doc Icon] BOOKING_CONFIRMATION                                      |
|  From: Maersk Booking Desk <booking@maersk.com>                       |
|  Received: Jan 5, 2026 at 14:32                                       |
|                                                                       |
|  +------------------------------------------------------------------+ |
|  |  DOCUMENT FLOW                                                    | |
|  |  [Carrier] Maersk  --->  [Internal] Intoglo  --->  [Shipper]     | |
|  |           (Original)        (Forwarded)       Acme Corp          | |
|  +------------------------------------------------------------------+ |
|                                                                       |
+-----------------------------------------------------------------------+
|                                                                       |
|  CHRONICLE EXTRACTION (AI Analysis)                                   |
|  +------------------------------------------------------------------+ |
|  |  Confidence: 94%  [High Confidence]                               | |
|  |                                                                   | |
|  |  +------------------------+  +------------------------+          | |
|  |  | BOOKING NUMBER         |  | VESSEL                 |          | |
|  |  | MSKU1234567            |  | MOL TREASURE           |          | |
|  |  | [99% confidence]       |  | [95% confidence]       |          | |
|  |  +------------------------+  +------------------------+          | |
|  |                                                                   | |
|  |  +------------------------+  +------------------------+          | |
|  |  | ETD                    |  | ETA                    |          | |
|  |  | 2026-01-15             |  | 2026-02-02             |          | |
|  |  | [92% confidence]       |  | [88% confidence]       |          | |
|  |  +------------------------+  +------------------------+          | |
|  |                                                                   | |
|  |  +------------------------+  +------------------------+          | |
|  |  | PORT OF LOADING        |  | PORT OF DISCHARGE      |          | |
|  |  | INNSA (Nhava Sheva)    |  | USLAX (Los Angeles)    |          | |
|  |  | [97% confidence]       |  | [97% confidence]       |          | |
|  |  +------------------------+  +------------------------+          | |
|  |                                                                   | |
|  |  +------------------------+                                       | |
|  |  | SI CUTOFF              |                                       | |
|  |  | 2026-01-12 17:00       |                                       | |
|  |  | [85% confidence]       |                                       | |
|  |  +------------------------+                                       | |
|  +------------------------------------------------------------------+ |
|                                                                       |
|  ACTIONS DETECTED                                                     |
|  +------------------------------------------------------------------+ |
|  |  [!] SI Submission Required by Jan 12                             | |
|  |      Priority: High                                               | |
|  |      [Create Task] [Dismiss]                                      | |
|  +------------------------------------------------------------------+ |
|                                                                       |
|  AMENDMENT COMPARISON (if revision)                                   |
|  +------------------------------------------------------------------+ |
|  |  Changes from Previous Version:                                   | |
|  |                                                                   | |
|  |  ETD: Jan 12 -> Jan 15 [CHANGED]                                  | |
|  |  Vessel: EVER GIVEN -> MOL TREASURE [CHANGED]                     | |
|  +------------------------------------------------------------------+ |
|                                                                       |
|  SOURCE EMAIL                                                         |
|  +------------------------------------------------------------------+ |
|  |  Subject: Booking Confirmation - MSKU1234567                      | |
|  |  [View Full Email] [Download Attachments]                         | |
|  +------------------------------------------------------------------+ |
|                                                                       |
+-----------------------------------------------------------------------+
```

### 7.3 Confidence Indicators

Visual confidence system:

```tsx
interface ConfidenceBadgeProps {
  confidence: number;
  label?: string;
}

const CONFIDENCE_LEVELS = {
  high: { min: 90, color: 'green', label: 'High Confidence' },
  medium: { min: 75, color: 'amber', label: 'Medium Confidence' },
  low: { min: 0, color: 'red', label: 'Low Confidence - Review Recommended' },
};
```

### 7.4 Amendment Comparison

For revised documents, show before/after:

```tsx
interface AmendmentComparisonProps {
  previousVersion: ChronicleData;
  currentVersion: ChronicleData;
  changedFields: string[];
}
```

Visual: Red strikethrough for old value, green highlight for new value

---

## 8. Visual Language & Design System

### 8.1 Color Palette (Terminal/Homebrew Theme)

The existing codebase uses a terminal-inspired theme. Extend and formalize:

```css
:root {
  /* Background */
  --terminal-bg: #0a0a0f;
  --terminal-surface: #12121a;
  --terminal-elevated: #1a1a24;

  /* Text */
  --terminal-text: #e4e4e7;
  --terminal-muted: #71717a;

  /* Borders */
  --terminal-border: #27272a;

  /* Semantic Colors */
  --terminal-green: #22c55e;   /* Success, Completed */
  --terminal-blue: #3b82f6;    /* Primary, Information */
  --terminal-amber: #f59e0b;   /* Warning, Approaching */
  --terminal-red: #ef4444;     /* Critical, Overdue */
  --terminal-purple: #a855f7;  /* In Transit, Special */
}
```

### 8.2 Typography

```css
/* Monospace for data/numbers */
.font-mono {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
}

/* Sans-serif for labels/text */
.font-sans {
  font-family: 'Inter', -apple-system, sans-serif;
}

/* Size Scale */
.text-xs: 0.75rem;   /* Labels, metadata */
.text-sm: 0.875rem;  /* Body text */
.text-base: 1rem;    /* Default */
.text-lg: 1.125rem;  /* Section headers */
.text-xl: 1.25rem;   /* Page titles */
.text-2xl: 1.5rem;   /* Hero numbers */
```

### 8.3 Status Indicators

Consistent status dot + text pattern:

```tsx
// Dot indicator before text
<span className="flex items-center gap-1.5">
  <span className={`h-2 w-2 rounded-full ${dotColor}`} />
  <span className={`font-mono text-xs uppercase ${textColor}`}>
    {label}
  </span>
</span>
```

### 8.4 Card Design

Standard card structure:

```tsx
<div className="rounded-lg border border-terminal-border bg-terminal-surface overflow-hidden">
  {/* Header */}
  <div className="px-4 py-2.5 bg-terminal-elevated border-b border-terminal-border flex items-center gap-2">
    <span className="h-2 w-2 rounded-full bg-terminal-{color}" />
    <Icon className="h-4 w-4 text-terminal-{color}" />
    <span className="font-medium text-terminal-text text-sm">Title</span>
  </div>

  {/* Content */}
  <div className="p-4">
    {/* ... */}
  </div>
</div>
```

### 8.5 Phase Colors

Consistent across all views:

```tsx
const PHASE_COLORS = {
  pre_departure: {
    dot: 'bg-terminal-blue',
    text: 'text-terminal-blue',
    bg: 'bg-terminal-blue/10',
  },
  in_transit: {
    dot: 'bg-terminal-purple',
    text: 'text-terminal-purple',
    bg: 'bg-terminal-purple/10',
  },
  arrival: {
    dot: 'bg-terminal-amber',
    text: 'text-terminal-amber',
    bg: 'bg-terminal-amber/10',
  },
  delivered: {
    dot: 'bg-terminal-green',
    text: 'text-terminal-green',
    bg: 'bg-terminal-green/10',
  },
};
```

---

## 9. Component Hierarchy

### 9.1 Directory Structure

```
/components/
  /chronicle/
    |-- index.ts                    # Barrel export
    |
    |-- /command-center/
    |   |-- CommandCenterDashboard.tsx
    |   |-- MetricCard.tsx
    |   |-- CutoffCountdown.tsx
    |   |-- JourneyDistribution.tsx
    |   |-- InsightsQueue.tsx
    |   |-- InsightCard.tsx
    |   +-- WeeklyCohort.tsx
    |
    |-- /shipment-list/
    |   |-- ShipmentListPage.tsx
    |   |-- ShipmentTable.tsx
    |   |-- ShipmentRow.tsx
    |   |-- PhaseTabs.tsx
    |   |-- FilterBar.tsx
    |   |-- GroupedView.tsx
    |   +-- QuickActions.tsx
    |
    |-- /shipment-detail/
    |   |-- ShipmentDetailPage.tsx
    |   |-- JourneyProgressCard.tsx
    |   |-- RoutingVisualization.tsx
    |   |-- CutoffDashboard.tsx
    |   |-- JourneyTimeline.tsx
    |   |-- DocumentGallery.tsx
    |   |-- ContainerList.tsx
    |   |-- RevisionHistory.tsx
    |   +-- StakeholderCards.tsx
    |
    |-- /document-detail/
    |   |-- DocumentDetailPage.tsx
    |   |-- ChronicleExtraction.tsx
    |   |-- ConfidenceBadge.tsx
    |   |-- AmendmentComparison.tsx
    |   |-- ActionDetection.tsx
    |   +-- SourceEmailPreview.tsx
    |
    |-- /shared/
    |   |-- StatusBadge.tsx
    |   |-- DateCountdown.tsx
    |   |-- DocumentTypeBadge.tsx
    |   |-- PartyIndicator.tsx
    |   |-- ProgressBar.tsx
    |   +-- TimelineConnector.tsx
    |
    +-- /ui/
        |-- Card.tsx
        |-- Badge.tsx
        |-- Button.tsx
        |-- Input.tsx
        |-- Select.tsx
        |-- Tabs.tsx
        |-- Table.tsx
        +-- Sheet.tsx
```

### 9.2 Key Component Props

```tsx
// JourneyProgressCard
interface JourneyProgressCardProps {
  shipmentId: string;
  workflowPhase?: string;
  workflowState?: string;
  etd?: string;
  eta?: string;
  status?: string;
}

// CutoffDashboard
interface CutoffDashboardProps {
  siCutoff?: string;
  vgmCutoff?: string;
  cargoCutoff?: string;
  gateCutoff?: string;
  docCutoff?: string;
  submissionStatus?: Record<string, 'submitted' | 'pending'>;
}

// JourneyTimeline
interface JourneyTimelineProps {
  shipmentId: string;
  compact?: boolean;
  expandedPhases?: string[];
}

// RoutingVisualization
interface RoutingVisualizationProps {
  placeOfReceipt?: string;
  portOfLoading: string;
  portOfDischarge: string;
  placeOfDelivery?: string;
  vesselName?: string;
  currentLocation?: string;
}

// ChronicleExtraction
interface ChronicleExtractionProps {
  chronicleId: string;
  entities: EntityExtraction[];
  overallConfidence: number;
  actionsDetected?: ActionItem[];
}
```

---

## 10. Mobile Considerations

### 10.1 Responsive Breakpoints

```css
/* Mobile First */
sm: 640px   /* Mobile landscape */
md: 768px   /* Tablet */
lg: 1024px  /* Desktop */
xl: 1280px  /* Large desktop */
```

### 10.2 Mobile-Specific Adaptations

**Command Center:**
- Stack metric cards vertically (2 columns on tablet)
- Collapse insights queue to show only count
- Journey distribution as simplified list

**Shipment List:**
- Single column card view instead of table
- Swipe actions for quick operations
- Sticky phase tabs

**Shipment Detail:**
- Collapsible sections
- Fixed bottom action bar
- Journey timeline as vertical stepper

**Document Detail:**
- Single column layout
- Confidence as inline badges
- Amendment comparison as stacked cards

### 10.3 Touch Targets

All interactive elements: minimum 44x44px touch target

```css
.touch-target {
  min-width: 44px;
  min-height: 44px;
}
```

---

## 11. Key Interactions

### 11.1 Command Palette (Cmd+K)

Global search and navigation:

```tsx
interface CommandPaletteItem {
  type: 'shipment' | 'document' | 'action' | 'navigation';
  label: string;
  description?: string;
  shortcut?: string;
  action: () => void;
}

// Recent searches
// Suggested shipments
// Quick actions
// Navigation shortcuts
```

### 11.2 Quick Actions

Context-sensitive actions available throughout:

**From Shipment Row:**
- View Details
- Copy Booking Number
- Open in New Tab
- Create Task

**From Shipment Detail:**
- Resync Data
- Export (CSV/Excel)
- Print
- Link Documents
- View Related Emails

### 11.3 Keyboard Navigation

```
Tab         - Move between interactive elements
Enter       - Select/activate
Escape      - Close modal/sheet
Cmd+K       - Open command palette
Arrow Keys  - Navigate lists
J/K         - Next/Previous item (Vim-style)
```

### 11.4 Loading States

Skeleton loading for all data-driven components:

```tsx
// Shipment row skeleton
<div className="animate-pulse">
  <div className="h-4 bg-terminal-elevated rounded w-1/3 mb-2" />
  <div className="h-4 bg-terminal-elevated rounded w-2/3" />
</div>
```

### 11.5 Error States

Friendly error handling with recovery actions:

```tsx
<div className="flex flex-col items-center justify-center p-8 text-center">
  <AlertCircle className="h-12 w-12 text-terminal-red mb-4" />
  <h3 className="text-lg font-medium text-terminal-text">Failed to load data</h3>
  <p className="text-sm text-terminal-muted mt-1">{errorMessage}</p>
  <Button onClick={retry} className="mt-4">Try Again</Button>
</div>
```

### 11.6 Empty States

Helpful guidance when no data:

```tsx
<div className="flex flex-col items-center justify-center p-12 text-center">
  <Ship className="h-12 w-12 text-terminal-muted mb-4" />
  <h3 className="text-lg font-medium text-terminal-text">No shipments found</h3>
  <p className="text-sm text-terminal-muted mt-1">
    Try adjusting your filters or creating a new shipment
  </p>
  <Button onClick={clearFilters} variant="outline" className="mt-4">
    Clear Filters
  </Button>
</div>
```

---

## 12. Implementation Recommendations

### 12.1 Priority Order

**Phase 1: Command Center Enhancements**
1. Journey Progress Distribution bar
2. Cutoff Countdown widget
3. Needs Attention list
4. Enhanced insights queue

**Phase 2: Shipment List Improvements**
5. Cutoff countdown indicators in rows
6. Inline port codes display
7. Smart grouping options
8. Enhanced mobile view

**Phase 3: Shipment Detail Story**
9. Routing visualization component
10. Cutoff dashboard card
11. Enhanced journey timeline
12. Amendment comparison view

**Phase 4: Document/Chronicle Detail**
13. Chronicle extraction display
14. Confidence visualization
15. Action detection UI
16. Source email integration

### 12.2 Component Library

Leverage existing shadcn/ui components:
- Button, Input, Select
- Card, Badge, Tabs
- Sheet (slide-over panels)
- Table (data display)
- Dialog (modals)
- Tooltip (help text)

### 12.3 Data Fetching

Use React Query / SWR for:
- Automatic caching
- Background refetching
- Optimistic updates
- Error handling

```tsx
const { data, isLoading, error, refetch } = useQuery({
  queryKey: ['shipment', shipmentId],
  queryFn: () => fetchShipment(shipmentId),
  staleTime: 30000, // 30 seconds
});
```

### 12.4 Performance

- Virtualize long lists (TanStack Virtual)
- Lazy load detail sections
- Prefetch on hover
- Debounce search input
- Memoize expensive calculations

### 12.5 Accessibility

- WCAG 2.1 AA compliance
- Semantic HTML
- ARIA labels
- Focus management
- Color contrast (4.5:1 minimum)
- Screen reader testing

---

## Appendix A: API Endpoints

### Required Endpoints

```
GET  /api/mission-control           # Command center data
GET  /api/mission-control/cutoffs   # Cutoff countdown data
GET  /api/insights                  # Insights queue
GET  /api/shipments                 # Shipment list
GET  /api/shipments/:id             # Shipment detail
GET  /api/shipments/:id/journey     # Journey timeline
GET  /api/shipments/:id/cutoffs     # Cutoff status
GET  /api/shipments/:id/documents   # Document gallery
GET  /api/documents/:id             # Document detail
GET  /api/documents/:id/chronicle   # Chronicle extraction
```

---

## Appendix B: Database Schema Additions

### Suggested Views

```sql
-- Journey progress view
CREATE VIEW shipment_journey_progress AS
SELECT
  s.id,
  s.booking_number,
  s.workflow_state,
  s.workflow_phase,
  CASE
    WHEN s.workflow_state = 'pod_received' THEN 100
    WHEN s.workflow_state = 'cargo_released' THEN 90
    -- ... etc
  END as journey_progress_percent,
  s.etd,
  s.eta,
  EXTRACT(DAY FROM s.etd - NOW()) as days_to_etd
FROM shipments s;

-- Cutoff status view
CREATE VIEW shipment_cutoff_status AS
SELECT
  s.id,
  s.booking_number,
  s.si_cutoff,
  s.vgm_cutoff,
  s.cargo_cutoff,
  CASE WHEN si_submitted THEN 'submitted' ELSE 'pending' END as si_status,
  -- ... etc
FROM shipments s;
```

---

## Appendix C: Wireframe Gallery

[ASCII art wireframes included in sections above]

---

**Document Version:** 1.0
**Last Updated:** 2026-01-11
**Author:** UI Designer Agent
**Review Status:** Ready for Implementation
