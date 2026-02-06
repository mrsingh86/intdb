# INTDB Pipeline Audit - Master Synthesis

> **Date:** 2026-02-06
> **Scope:** 40,595 chronicle records, 15,792 lines of code, 29 files
> **Method:** 9 specialized agents working in parallel with cross-validation
> **Reports:** 9 detailed reports in `/intdb/scripts/reports/`

---

## The Big Picture

**Extraction accuracy is 78.7% when data IS extracted. The problem is coverage: only 45.7% of fields get populated.** Everything downstream (linking, actions, confidence) fails because the extraction layer doesn't produce enough data.

```
Root Cause: Low extraction coverage (45.7% field rate)
  |
  |-- PDF attachments not parsed (booking confirmations = empty bodies)
  |-- AI misses fields present in text (especially dates, cutoffs)
  |-- 3,237 valid extractions rejected by enum gaps
  |-- Pattern matching does classification only, zero field extraction
  |
  +-- Downstream Impact:
        |-- 29.2% emails unlinked (no identifiers)
        |-- 34.3% actions fall to "fallback" (wrong doc type)
        |-- 520 carrier name variants (no normalization)
        |-- 11,400 unnormalized port locations
        |-- 64.4% of action rules have no description
        |-- Learning loop dead (100% "correct", zero corrections)
        |-- ObjectiveConfidenceService not running (0 calculations)
```

---

## Scores

| Dimension | Score | Source Agent |
|-----------|-------|-------------|
| Architecture Quality | 143/200 (71.5%) | architecture-reviewer |
| Extraction Accuracy (when extracted) | 78.7% | gmail-validator |
| Field Extraction Rate | 45.7% | gmail-validator |
| Database Schema | 7.5/10 | database-auditor |
| Action Completion Rate | 40.3% | action-auditor |
| Shipment Linking Rate | 70.8% | linking-auditor |
| Pattern Coverage | 3.9% | classification-auditor |
| Error Rate (unique emails) | 9.2% (3,726/40,595) | error-perf-auditor |
| Cost per Email | $0.004 | error-perf-auditor |

---

## Priority Fixes

### P0 - Critical (This Week)

| # | Fix | Impact | Effort | Source |
|---|-----|--------|--------|--------|
| 1 | **Fix SQL injection** in chronicle-service.ts:1079-1082 | Security vulnerability | 1 hour | architecture-reviewer |
| 2 | **Add ~50 ENUM_MAPPINGS** (ramp->icd, customs_broker->broker, etc.) | Eliminates 3,237 errors | 2 hours | error-perf + extraction |
| 3 | **Add unicode sanitization** (strip \u0000 before DB save) | Fixes 507 DB errors | 1 hour | error-perf-auditor |
| 4 | **Delete 3 garbage shipments** ("confirmation", "Stuffing", "Cancellation" as booking_number) | Fixes hundreds of wrong links | 30 min | linking-auditor |
| 5 | **Add max-retry cap** (3 per email) | 40.4% of errors are retries | 1 hour | error-perf-auditor |
| 6 | **Fix calendar date validation** (2026-02-29 = not a leap year) | 97 date errors | 30 min | error-perf-auditor |

### P1 - High Impact Backfills (This Sprint)

| # | Fix | Impact | Effort | Source |
|---|-----|--------|--------|--------|
| 7 | **MBL prefix -> carrier_name backfill** (MAEU=Maersk, HLCU=Hapag, etc.) | carrier_name 29%->48% (+7,629 records) | 2 hours | joint: extraction + date-location |
| 8 | **Add CARRIER_NORMALIZATIONS map** (520 variants -> ~15 canonical names) | Clean carrier data | 3 hours | date-location-auditor |
| 9 | **POL/POD backfill** (normalize ~11,400 raw city names via PORT_NORMALIZATIONS) | POL UN/LOCODE 59%->90% | 2 hours | date-location-auditor |
| 10 | **Fill 120 null action_descriptions** in action_rules table | Fixes 3,721 useless "Action Required" | 3 hours | action-auditor |
| 11 | **Add wildcard from_party rules** for top 10 doc types | Reduces fallback from 34.3% | 2 hours | action-auditor |
| 12 | **Container type normalization** (127 variants -> ~10 standard: 40HC, 20GP, etc.) | Clean cargo data | 1 hour | date-location-auditor |
| 13 | **Move 553 SE-prefixed values** from mbl_number to work_order_number | Fixes misplaced identifiers | 1 hour | joint: extraction + date-location |
| 14 | **Create 5 missing DB indexes** (document_type, created_at, from_address, needs_reanalysis, has_issue) | Query performance | 30 min | database-auditor |

### P2 - Architecture (Next Sprint)

| # | Fix | Impact | Effort | Source |
|---|-----|--------|--------|--------|
| 15 | **God class decomposition** (chronicle-service.ts 1,906L -> 8 focused services) | Maintainability | 2-3 days | architecture-reviewer |
| 16 | **Remove 3,458 lines dead code** (3 legacy action services, deprecated crons) | -22% codebase | 1 day | architecture-reviewer |
| 17 | **Merge 8 vague doc types** (request, response, acknowledgement -> mapped types) | Cleaner classification | 1 day | classification-auditor |
| 18 | **Escalation policy fix** - skip Sonnet for non-shipping types | 50% wasted escalations | 2 hours | classification-auditor |
| 19 | **Investigate ObjectiveConfidenceService** (0 calculations in DB, ai_confidence always null) | Confidence system may be dead | 4 hours | classification-auditor |
| 20 | **Remove carrier_scac from schema** (100% null, never populated) | Saves ~10 tokens/call | 30 min | joint: extraction + date-location |
| 21 | **Remove/archive 8 empty tables** (pattern_audit, pending_patterns, etc.) | Schema cleanup | 1 hour | database-auditor |
| 22 | **Add cleanup cron** for chronicle_runs (4,622 rows, +288/day) and chronicle_errors | Prevent table bloat | 2 hours | database-auditor |
| 23 | **Move 172 hardcoded values to database** (port normalizations, enum mappings, carrier domains) | Configuration over code | 2 days | architecture-reviewer |

### P3 - Strategic (Future Sprints)

| # | Fix | Impact | Effort | Source |
|---|-----|--------|--------|--------|
| 24 | **Improve PDF attachment parsing** (booking confirmations = empty bodies, all data in PDFs) | Massive extraction boost | 1 week | gmail-validator |
| 25 | **Add 10+ high-value sender patterns** (jump from 3.9% -> ~10% pattern coverage) | Less AI cost | 1 day | classification-auditor |
| 26 | **Build human review UI** for learning episodes | Revive dead learning loop | 1 week | classification-auditor |
| 27 | **Escalate critical doc types to Sonnet** (booking_confirmation, arrival_notice) | 43-170% more extraction | 2 hours | extraction + date-location |
| 28 | **Cap thread linking** for mega-threads (132 shipments with 50+ entries) | Prevent over-matching | 4 hours | linking-auditor |
| 29 | **Handle multi-booking emails** (203 records have JSON arrays as booking_number) | Edge case fix | 3 hours | date-location-auditor |
| 30 | **Add booking_number validation** before shipment creation | Prevent garbage shipments | 2 hours | linking-auditor |

---

## Cross-Agent Validated Findings

These findings were independently discovered and confirmed by 2+ agents:

| Finding | Agents Who Found It | Confidence |
|---------|-------------------|------------|
| 998 general_correspondence with booking_number (misclassified) | extraction + classification | HIGH |
| Sonnet extracts 43-170% more fields than Haiku | extraction + date-location + gmail-validator | HIGH |
| MBL prefix can derive carrier_name for 7,629 records | extraction + date-location (joint rec) | HIGH |
| carrier_scac is 100% null (remove from schema) | extraction + date-location | HIGH |
| ENUM_MAPPINGS "bug" debunked - was retry noise, not code path issue | extraction flagged -> error-perf corrected | RESOLVED |
| from_party=carrier is valid enum, not unmapped | error-perf corrected extraction | RESOLVED |
| Learning loop is dead (100% correct, 0 corrections) | classification + database | HIGH |
| 40.4% of errors are duplicate retries | error-perf-auditor | HIGH |
| Dead code: ActionRulesService (819L) still exported but unused | architecture + action | HIGH |

---

## Individual Reports

| Report | Size | Location |
|--------|------|----------|
| Extraction Quality | 27KB | `extraction-quality-report.md` |
| Date/Location/Fields | 28KB | `date-location-field-extraction-report.md` |
| Classification & Confidence | 27KB | `classification-confidence-report.md` |
| Action System | 27KB | `action-system-report.md` |
| Error & Performance | 27KB | `error-performance-report.md` |
| Shipment Linking | 19KB | `linking-flow-report.md` |
| Architecture Quality | 27KB | `architecture-quality-report.md` |
| Gmail Cross-Validation | 27KB | `gmail-cross-validation-report.md` |
| Database Integrity | 21KB | `database-integrity-report.md` |

---

## Quick Wins Summary

If you only do 5 things this week:

1. **Add ~50 ENUM_MAPPINGS** -> eliminates 3,237 errors
2. **Fix SQL injection** -> security
3. **MBL prefix -> carrier_name backfill** -> +7,629 records enriched
4. **POL/POD normalization backfill** -> 11,400 locations cleaned
5. **Fill 120 null action_descriptions** -> fixes useless actions

**Estimated time: 1 day of focused work. Estimated impact: 25-30% improvement in overall pipeline quality.**
