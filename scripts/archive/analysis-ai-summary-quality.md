# Deep Analysis: AI Summary Quality Comparison

## Side-by-Side Comparison

### OUTPUT 1: Without Cross-Shipment Profiles (Hapag-Lloyd)

```
Story: Hapag-Lloyd shipment of steel nuts and bolts from Mundra to Houston
for Pankaj International is severely delayed. Container SEKU1376948 has been
stuck at Houston port since December 12 due to persistent chassis shortage,
causing multiple movement blockages and potential demurrage risks.

Blocker: Chassis shortage preventing container movement from Houston to Dallas
         (stuck since Dec 12)
Blocker Owner: TransJet Cargo
Next Action: Call TransJet Cargo to confirm chassis availability by Jan 15
Action Owner: intoglo
Priority: critical
Risk: RED - Extended port detention, multiple movement failures,
      approaching financial penalty window
Financial: $150-300/day potential demurrage starting Dec 22
Customer: Shipment delayed 32 days, no delivery to Dallas
```

### OUTPUT 2: With Cross-Shipment Profiles (Idea Fasteners)

```
Story: Maersk booking 263522096 for Idea Fasteners from Salalah to Houston
is issued Bill of Lading. The shipment is currently tracking toward a Jan 20
ETD on Maersk Hartford vessel 602W, with final arrival expected Feb 26.

Blocker: SI document not yet submitted (high probability of late submission
         based on shipper history)
Blocker Owner: IDEA FASTENERS PRIVATE LIMITED
Next Action: Call Idea Fasteners to confirm SI submission by Jan 18
Action Owner: intoglo
Priority: high
Risk: AMBER - 47% historical rate of late SI submission, no current critical blockers
Financial: None
Customer: Potential shipping document delays likely
```

---

## Quality Assessment Matrix

| Dimension | Output 1 (No Profiles) | Output 2 (With Profiles) |
|-----------|------------------------|--------------------------|
| **Logical Coherence** | ✅ EXCELLENT | ❌ CONTRADICTORY |
| **Cause-Effect Chain** | ✅ Clear | ❌ Broken |
| **Specificity** | ✅ Container#, dates, amounts | ⚠️ Generic |
| **Actionability** | ✅ Specific party + action | ⚠️ Vague |
| **Stage Awareness** | ✅ Understands current state | ❌ Misses stage context |
| **Profile Usage** | N/A | ⚠️ Misapplied |

---

## Critical Issues in Output 2

### Issue 1: LOGICAL CONTRADICTION

**Story says:** "is issued Bill of Lading" (BL_ISSUED stage)
**Blocker says:** "SI document not yet submitted"

**Problem:** SI submission happens BEFORE BL issuance in shipment lifecycle:
```
Booking → SI Submitted → SI Confirmed → Draft BL → Final BL (BL_ISSUED)
                ↑
        This is PAST if BL is issued!
```

**Root Cause:** AI sees shipper's "47% SI late rate" profile and assumes SI is pending, ignoring the actual stage (BL_ISSUED).

### Issue 2: PROFILE INTELLIGENCE OVERRIDES REALITY

The AI is so focused on the cross-shipment intelligence that it:
- Ignores actual shipment stage
- Creates a blocker that doesn't exist
- Suggests action for already-completed milestone

**This is worse than no intelligence at all.**

### Issue 3: VAGUE OUTPUTS

| Field | Output 1 | Output 2 |
|-------|----------|----------|
| Financial | "$150-300/day starting Dec 22" | "None" |
| Customer | "32 days delayed, no delivery" | "Potential delays likely" |
| Blocker | "chassis shortage since Dec 12" | "SI not submitted" (wrong) |

Output 1 has **specific, quantified** information.
Output 2 has **vague, generic** statements.

---

## Root Cause Analysis

### Why Output 1 is Better

1. **Chronicle-Driven**: AI derives insights FROM the actual chronicle data
   - Real issue: chassis shortage
   - Real timeline: stuck since Dec 12
   - Real parties: TransJet Cargo

2. **No Profile Distraction**: Without profiles, AI focuses on WHAT'S HAPPENING NOW

3. **Issue-Focused**: Has actual issues in chronicle → AI summarizes them accurately

### Why Output 2 Fails

1. **Profile Dominates Reality**: AI sees "47% SI late" and assumes SI is the issue
   - Ignores: Stage is BL_ISSUED (SI is done!)
   - Ignores: What does chronicle actually say?

2. **No Real Issues**: Shipment is on track (BL issued, sailing scheduled)
   - AI has nothing concrete to report
   - Falls back on profile intelligence inappropriately

3. **Stage Blindness**: The prompt doesn't emphasize stage-aware reasoning
   ```
   If stage = BL_ISSUED:
     - SI is DONE (don't flag SI late rate)
     - Focus on: vessel tracking, arrival, customs prep
   ```

---

## The Core Problem

**Cross-shipment profiles are being used WITHOUT stage context.**

Current behavior:
```
Shipper has 47% SI late rate
  → AI thinks: "Flag SI risk!"
  → Ignores: SI is already submitted (BL_ISSUED)
```

Correct behavior:
```
Shipper has 47% SI late rate
  + Stage is BL_ISSUED
  → AI thinks: "SI already done, profile not relevant for THIS shipment"
  → Focus on: Current stage concerns (BL accuracy, vessel tracking)
```

---

## Proposed Fixes

### Fix 1: Stage-Aware Profile Application

Add logic to filter profile intelligence by relevance to current stage:

```typescript
function getRelevantProfileIntelligence(stage: string, profiles: Profiles) {
  const intel: string[] = [];

  // Shipper SI patterns only relevant BEFORE BL_ISSUED
  if (['PENDING', 'BOOKED', 'SI_PENDING'].includes(stage)) {
    if (profiles.shipper?.siLateRate > 30) {
      intel.push(`Shipper SI late rate: ${profiles.shipper.siLateRate}%`);
    }
  }

  // Consignee detention only relevant AFTER ARRIVED
  if (['ARRIVED', 'CUSTOMS', 'DELIVERY'].includes(stage)) {
    if (profiles.consignee?.detentionRate > 10) {
      intel.push(`Consignee detention risk: ${profiles.consignee.detentionRate}%`);
    }
  }

  // Carrier rollover only relevant BEFORE DEPARTED
  if (['PENDING', 'BOOKED', 'SI_PENDING', 'BL_ISSUED'].includes(stage)) {
    if (profiles.carrier?.rolloverRate > 10) {
      intel.push(`Carrier rollover risk: ${profiles.carrier.rolloverRate}%`);
    }
  }

  return intel;
}
```

### Fix 2: Enhanced Prompt with Stage Emphasis

Add to system prompt:
```
CRITICAL: Profile intelligence must be STAGE-APPROPRIATE.

Stage Context Rules:
- PENDING/BOOKED: Shipper SI patterns ARE relevant
- BL_ISSUED: SI is DONE - focus on vessel/departure
- IN_TRANSIT: Focus on arrival, ETA accuracy
- ARRIVED: Consignee detention patterns ARE relevant
- DELIVERED: Historical only, no action needed

DO NOT flag profile risks for milestones that are ALREADY COMPLETED.
```

### Fix 3: Validate Output Against Stage

Post-process AI output to catch contradictions:
```typescript
function validateOutputCoherence(stage: string, output: AISummary): string[] {
  const issues: string[] = [];

  if (stage === 'BL_ISSUED' && output.currentBlocker?.toLowerCase().includes('si')) {
    issues.push('Blocker mentions SI but stage is BL_ISSUED (SI already done)');
  }

  if (stage === 'DELIVERED' && output.riskLevel === 'red') {
    issues.push('Risk is RED but shipment is already delivered');
  }

  return issues;
}
```

---

## Summary

| Aspect | Current State | Target State |
|--------|---------------|--------------|
| Profile usage | Always applied | Stage-filtered |
| Coherence check | None | Validate against stage |
| Prompt guidance | Generic | Stage-aware rules |
| Output quality | Variable | Consistently logical |

**The profiles add value, but only when applied with stage awareness.**
