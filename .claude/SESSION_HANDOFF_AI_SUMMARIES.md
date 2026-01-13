# Session Handoff: AI Summary Investigation

**Date:** 2026-01-13
**Next Focus:** AI Summary Pipeline - Script vs Production, Logic Review, Intelligence Quality

---

## Current State

### AI Summaries Progress
- **Total shipments:** ~1,449
- **With V2 summaries:** ~725 (504 before session + 221 processed this session)
- **Remaining:** ~724 need summaries

### Key Files to Investigate

#### 1. Manual Script (for backfill)
```
/Users/dineshtarachandani/intdb/scripts/run-ai-summaries.ts
```
- Runs standalone to generate V2 summaries for shipments without them
- Uses `generateShipmentSummary()` from lib
- Supports `--offset` and `--batch` args for parallel execution
- Cost: ~$0.0017 per shipment

#### 2. Production Backfill/Catchup
```
/Users/dineshtarachandani/intdb/lib/chronicle/backfill.ts
```
- Look for catchup logic that runs on new emails
- Check if it triggers AI summary generation

#### 3. AI Analyzer (Core Intelligence)
```
/Users/dineshtarachandani/intdb/lib/chronicle/ai-analyzer.ts
```
- Main AI extraction pipeline
- Uses Anthropic Claude for analysis
- Recently updated with date validation
- Key method: `analyze(email, attachmentText)`

#### 4. AI Summary Generator
```
/Users/dineshtarachandani/intdb/lib/chronicle/ai-summary.ts
```
- Generates narrative summaries for shipments
- Uses intelligence profiles (shipper/carrier/customer knowledge)
- Outputs: narrative, owner, ownerType, riskLevel, keyDeadline, keyInsight

#### 5. Freight Forwarder Prompt
```
/Users/dineshtarachandani/intdb/lib/chronicle/prompts/freight-forwarder.prompt.ts
```
- Contains the AI prompt for email analysis
- Has `buildAnalysisPrompt()` and `validateExtractedDates()`
- This is where "chronicle reader intelligence" would be defined

---

## Questions to Explore

### 1. Script vs Production Flow
- Is `run-ai-summaries.ts` the only way summaries get generated?
- Does production backfill automatically generate summaries for new shipments?
- Is there a cron job or trigger that should be running this?

### 2. Production Backfill Logic Review
- Check `/lib/chronicle/backfill.ts` for summary generation
- Look for any cron jobs in `/app/api/cron/`
- Verify the catchup flow includes AI summary step

### 3. AI Analyzer Intelligence
- Does the prompt have "chronicle reader perspective"?
- Is it analyzing emails like a freight forwarder would?
- Does it understand:
  - Shipment lifecycle (booking → SI → BL → delivery)
  - What's urgent vs routine
  - Red flags and patterns
  - Shipper/carrier behavior patterns

### 4. Intelligence Profiles
- Located in summary generation, not analysis
- Profiles: [S]hipper, [C]arrier, [K]nowledge base
- Check if these are being used effectively

---

## Recent Fixes Applied

1. **Date Validation** - Cutoffs must be before ETD, ETA after ETD
2. **Bad Dates Cleaned** - Fixed all cargo_cutoff/vgm_cutoff > ETD in DB
3. **Document Classification** - Fixed SOB misclassification issues

---

## Commands to Run

```bash
# Check how many still need summaries
# (Run SQL in Supabase or via script)

# Resume AI summaries generation
npx tsx scripts/run-ai-summaries.ts

# With offset for parallel batches
npx tsx scripts/run-ai-summaries.ts --offset=0 --batch=500
npx tsx scripts/run-ai-summaries.ts --offset=500 --batch=500
```

---

## Chronicle V2 UI Status
- Working at `/v2`
- Displays AI narratives nicely
- Shows intelligence badges, risk levels, key insights
- Screenshot in previous session showed good rendering

---

## Database Tables
- `shipments.ai_summary_v2` - JSONB column for V2 summaries
- `chronicle` - Individual email/document records
- Intelligence profiles stored in summary JSON

---

## Start Here
1. Read `run-ai-summaries.ts` to understand current flow
2. Search for where `generateShipmentSummary` is called in production
3. Review `ai-analyzer.ts` prompt for "chronicle reader" perspective
4. Check cron jobs for automated summary generation
