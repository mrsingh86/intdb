# Email Extraction Coverage Analysis Report

**Date:** December 27, 2025
**Database:** intdb (Supabase)
**Total Emails:** 1,994 (1,000 analyzed in detail)

---

## Executive Summary

**CURRENT STATE:**
- Total emails in database: **1,994**
- Emails WITH extractions: **114** (5.7% of 1,994, or 11.4% of 1,000 analyzed)
- Emails WITHOUT extractions: **1,880** (94.3%)
- Total entity extractions created: **5,018**
- Shipments created: **204**

**EXTRACTION COVERAGE: 5.7%** ❌
**TARGET: 50%+** 🎯
**GAP: 44.3% (886 more emails needed)**

---

## 1. Root Cause Analysis: Why Only 5.7% Coverage?

### Finding 1: The "Classified but Not Extracted" Pipeline Gap

**CRITICAL ISSUE:** 882 emails (88.2%) are marked as `processing_status='classified'` but NO extractions have been run.

**Processing Status Breakdown:**
```
classified     882 emails (88.2%) ← PROBLEM: No extraction triggered
processed       30 emails ( 3.0%) ← Only these get extracted
pending          1 email  ( 0.1%)
```

**Root Cause:**
The current architecture appears to have TWO separate steps:
1. **Classification Step** → Sets `processing_status='classified'`
2. **Extraction Step** → Only runs on `processing_status='processed'`

**Evidence from Codebase:**
- File: `/scripts/run-entity-extraction.ts` exists
- Only extracts from emails with specific `document_type` classifications
- No automatic trigger after classification completes
- Manual script execution required

**Impact:** 882 emails classified but never processed = **44% missed opportunity**

---

### Finding 2: PDF Attachments Not Being Extracted

**PROBLEM:** 699 classified emails (78.9%) have attachments but NO extractions.

**Attachment Statistics:**
```
Emails WITH attachments but NO extraction:     699 (78.9%)
Emails WITHOUT attachments and NO extraction:  187 (21.1%)
```

**Evidence from Codebase:**
- ✅ PDF extraction service EXISTS: `/lib/services/attachment-extraction-service.ts`
- ✅ Supports: PDF, Excel, Word, Images (OCR)
- ❌ NOT integrated into automated extraction pipeline
- ❌ Runs only via manual scripts: `/scripts/extract-all-attachments.ts`

**Typical Shipping Documents in PDFs:**
- Booking Confirmations (booking#, vessel, ETD, port info)
- Bills of Lading (BL#, container numbers, shipper, consignee)
- Shipping Instructions (cargo details, special instructions)
- Commercial Invoices (invoice#, amounts, SKUs)

**Impact:** 699 PDF emails not extracted = **35% missed opportunity**

---

### Finding 3: High-Volume Sender Emails Not Processed

**Top Senders of Unextracted Emails:**

| Sender | Unextracted | Total | Coverage |
|--------|-------------|-------|----------|
| ops@intoglo.com | 222 | 246 | 9.8% |
| nam@intoglo.com | 62 | 65 | 4.6% |
| pricing@intoglo.com | 45 | 53 | 15.1% |
| rajdeep.dey@intoglo.com | 42 | 48 | 12.5% |
| india@service.hlag.com | 27 | 29 | 6.9% |
| India@service.hlag.com | 26 | 59 | 55.9% ⚠️ |
| noreply@hlag.cloud | 26 | 26 | 0.0% ❌ |
| ankita.jethuri@intoglo.com | 22 | 22 | 0.0% ❌ |

**Key Insights:**
1. **ops@intoglo.com** (222 emails) - Likely forwarded shipping line emails
2. **Hapag Lloyd** (`india@service.hlag.com`, `noreply@hlag.cloud`) - 53 unextracted
3. **Case sensitivity issue**: `India@service.hlag.com` (55.9% coverage) vs `india@service.hlag.com` (6.9%)

**Impact:** Top 3 senders = **337 emails** = **16.9% opportunity**

---

## 2. What IS Being Extracted Currently?

### Extraction Methods Used:
```
ai_extraction                  517 extractions (51.7%)
ai_claude_haiku               408 extractions (40.8%)
claude-haiku-vessel-eta-v2     27 extractions ( 2.7%)
ai_backfill                    24 extractions ( 2.4%)
pattern_extraction             24 extractions ( 2.4%)
```

### Entity Types Successfully Extracted:
```
booking_number         165   ← Most common
bl_number             109
port_of_discharge     106
port_of_loading        89
shipper_name           73
etd/eta                53/52
container_count        52
container_numbers      52
vessel_name            48
voyage_number          32
si_cutoff              28
vgm_cutoff             27
consignee_name         26
cargo_cutoff           24
[... 16 more entity types]
```

**Analysis:** Extraction logic EXISTS and WORKS when triggered. Problem is it's NOT being triggered for 94% of emails.

---

## 3. Specific Recommendations to Reach 50%+

### RECOMMENDATION 1: Fix Classification → Extraction Pipeline (HIGHEST PRIORITY)

**PROBLEM:** Classified emails don't automatically trigger extraction.

**ACTION ITEMS:**
1. **Check Current Pipeline:**
   ```bash
   # Files to investigate:
   /scripts/run-entity-extraction.ts
   /scripts/classify-via-postgres.ts
   /scripts/reclassify-all-emails.ts
   ```

2. **Modify Extraction Trigger:**
   - Current: Only extracts from `processing_status='processed'`
   - Change to: Extract from `processing_status='classified'`
   - OR: Add automatic trigger when status changes to 'classified'

3. **Backfill Strategy:**
   ```sql
   -- Emails ready for extraction
   SELECT COUNT(*) FROM raw_emails
   WHERE processing_status = 'classified'
   AND id NOT IN (SELECT DISTINCT email_id FROM entity_extractions);
   -- Result: 882 emails
   ```

4. **Implementation:**
   ```typescript
   // Modify /scripts/run-entity-extraction.ts
   const { data: emails } = await supabase
     .from('raw_emails')
     .select('*')
     .eq('processing_status', 'classified')  // ← Change from 'processed'
     .is('id', 'not.in.entity_extractions.email_id');
   ```

**EXPECTED IMPACT:** +200-400 emails (20-40% coverage gain)
**TIMELINE:** 1-2 days
**DIFFICULTY:** Low (code change + backfill)

---

### RECOMMENDATION 2: Integrate PDF Extraction into Pipeline

**PROBLEM:** PDF extraction service exists but not used automatically.

**ACTION ITEMS:**
1. **Modify Entity Extraction Script:**
   ```typescript
   // In /scripts/run-entity-extraction.ts
   import { attachmentExtractionService } from '@/lib/services/attachment-extraction-service';
   
   async function extractEntities(email) {
     let fullText = email.body_text || '';
     
     // NEW: Extract PDF attachments
     if (email.has_attachments) {
       const attachments = await getEmailAttachments(email.id);
       for (const attachment of attachments) {
         if (attachment.mime_type === 'application/pdf') {
           const buffer = await downloadAttachment(attachment);
           const result = await attachmentExtractionService.extractFromBuffer(
             buffer,
             attachment.mime_type,
             attachment.filename
           );
           if (result.success) {
             fullText += '\n\n' + result.extractedText;
           }
         }
       }
     }
     
     // Continue with existing Claude extraction on fullText
     return await claudeExtract(fullText);
   }
   ```

2. **Test on High-Value Carriers:**
   - Hapag Lloyd booking confirmations
   - Maersk BLs
   - MSC shipping instructions

3. **Monitor Extraction Quality:**
   - Track: How many PDFs successfully extracted
   - Track: How many entities found per PDF
   - Track: Confidence scores from PDF vs email body

**EXPECTED IMPACT:** +150-300 emails (15-30% coverage gain)
**TIMELINE:** 3-5 days
**DIFFICULTY:** Medium (integration + testing)

---

### RECOMMENDATION 3: Fix Case-Sensitive Sender Matching

**PROBLEM:** `India@service.hlag.com` has 55.9% coverage but `india@service.hlag.com` has only 6.9%.

**ACTION ITEMS:**
1. **Normalize Sender Emails:**
   ```sql
   -- Find case variations
   SELECT sender_email, COUNT(*) 
   FROM raw_emails 
   WHERE LOWER(sender_email) LIKE '%hlag.com%'
   GROUP BY sender_email;
   ```

2. **Fix Classification Logic:**
   ```typescript
   // Ensure case-insensitive matching
   const senderLower = email.sender_email.toLowerCase();
   const trueSenderLower = email.true_sender_email?.toLowerCase();
   ```

3. **Backfill Affected Emails:**
   ```sql
   UPDATE raw_emails 
   SET sender_email = LOWER(sender_email),
       true_sender_email = LOWER(true_sender_email)
   WHERE sender_email != LOWER(sender_email);
   ```

**EXPECTED IMPACT:** +10-20 emails (1-2% coverage gain)
**TIMELINE:** 1 day
**DIFFICULTY:** Low

---

### RECOMMENDATION 4: Analyze ops@intoglo.com Forwarded Emails

**PROBLEM:** 222 emails from ops@intoglo.com (likely forwarded) not extracted.

**HYPOTHESIS:** These are forwarded shipping line emails with original sender in headers.

**ACTION ITEMS:**
1. **Sample Analysis:**
   ```sql
   SELECT id, subject, headers->'X-Original-Sender' as original_sender
   FROM raw_emails
   WHERE sender_email = 'ops@intoglo.com'
   LIMIT 10;
   ```

2. **Check if True Sender Extraction Works:**
   - File: Look for `X-Original-Sender` header extraction
   - Verify: `true_sender_email` column populated correctly

3. **If Broken, Fix Forwarding Detection:**
   ```typescript
   // Ensure X-Original-Sender extraction
   const trueSender = 
     email.headers['X-Original-Sender'] ||
     email.headers['X-Forwarded-For'] ||
     email.sender_email;
   ```

**EXPECTED IMPACT:** +100-200 emails (10-20% coverage gain)
**TIMELINE:** 2-3 days
**DIFFICULTY:** Medium (depends on header extraction state)

---

## 4. Immediate Action Plan (Prioritized)

### PHASE 1: Quick Wins (Week 1)
**Goal:** Reach 30% coverage

1. **Fix Classification → Extraction Pipeline** (Priority 1)
   - Modify extraction script to process 'classified' emails
   - Test on 10 sample emails
   - Backfill all 882 classified emails
   - **Expected:** +200-400 emails

2. **Fix Case-Sensitive Sender Bug** (Priority 3)
   - Normalize sender emails to lowercase
   - Re-run classification on affected emails
   - **Expected:** +10-20 emails

**Total Phase 1 Impact:** ~25-40% coverage

---

### PHASE 2: Medium-Term Improvements (Week 2-3)
**Goal:** Reach 50% coverage

3. **Integrate PDF Extraction** (Priority 2)
   - Add PDF extraction to entity extraction script
   - Test on Hapag/Maersk emails with attachments
   - Deploy to all emails with `has_attachments=true`
   - **Expected:** +150-300 emails

4. **Analyze ops@intoglo.com Forwarding** (Priority 4)
   - Sample 10 emails to understand pattern
   - Fix X-Original-Sender extraction if broken
   - Backfill 222 ops@intoglo.com emails
   - **Expected:** +100-200 emails

**Total Phase 2 Impact:** ~50-70% coverage

---

### PHASE 3: Optimization (Week 4+)
**Goal:** Reach 70%+ coverage

5. **Carrier-Specific Extraction Patterns**
   - Hapag Lloyd-specific entity extraction
   - Maersk booking number format detection
   - MSC document type classification

6. **Automated Extraction Pipeline**
   - Create cron job: `/app/api/cron/extract-entities/route.ts`
   - Trigger extraction on new classified emails
   - Monitor extraction success rates

7. **Quality Monitoring Dashboard**
   - Track extraction coverage by carrier
   - Monitor confidence scores
   - Alert on low-quality extractions

---

## 5. Database Queries for Investigation

### Check Extraction Pipeline Status
```sql
-- How many emails are ready for extraction?
SELECT 
  processing_status,
  COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 2) as pct
FROM raw_emails
GROUP BY processing_status
ORDER BY count DESC;
```

### Find Emails with Attachments But No Extractions
```sql
SELECT 
  e.id,
  e.subject,
  e.sender_email,
  e.has_attachments,
  e.attachment_count,
  COUNT(ex.id) as extraction_count
FROM raw_emails e
LEFT JOIN entity_extractions ex ON ex.email_id = e.id
WHERE e.has_attachments = true
  AND e.processing_status = 'classified'
GROUP BY e.id
HAVING COUNT(ex.id) = 0
ORDER BY e.received_at DESC
LIMIT 100;
```

### Analyze Extraction Success by Sender
```sql
SELECT 
  sender_email,
  COUNT(DISTINCT e.id) as total_emails,
  COUNT(DISTINCT ex.email_id) as extracted_emails,
  ROUND(COUNT(DISTINCT ex.email_id) * 100.0 / COUNT(DISTINCT e.id), 2) as coverage_pct
FROM raw_emails e
LEFT JOIN entity_extractions ex ON ex.email_id = e.id
GROUP BY sender_email
HAVING COUNT(DISTINCT e.id) >= 10
ORDER BY total_emails DESC, coverage_pct ASC
LIMIT 20;
```

---

## 6. Files to Modify

### Priority 1: Extraction Pipeline
- [ ] `/scripts/run-entity-extraction.ts` - Change trigger condition
- [ ] `/scripts/classify-via-postgres.ts` - Check classification logic
- [ ] Create: `/app/api/cron/extract-entities/route.ts` (automated extraction)

### Priority 2: PDF Integration
- [ ] `/scripts/run-entity-extraction.ts` - Add PDF attachment extraction
- [ ] `/lib/services/attachment-extraction-service.ts` - Already exists ✅
- [ ] Test: `/scripts/extract-all-attachments.ts` - Use for testing

### Priority 3: Monitoring
- [ ] Create: `/scripts/monitor-extraction-coverage.ts`
- [ ] Create: `/app/api/extraction-stats/route.ts` (dashboard API)

---

## 7. Success Metrics

### Current Baseline
- Extraction Coverage: **5.7%**
- Emails with extractions: **114**
- Entity extractions: **5,018**
- Avg entities per email: **44**

### Target Metrics (After Phase 2)
- Extraction Coverage: **50%+**
- Emails with extractions: **1,000+**
- Entity extractions: **20,000+**
- Avg entities per email: **20+**

### Quality Metrics to Track
- Confidence score distribution (target: >70% have confidence >80)
- PDF extraction success rate (target: >90%)
- Entity accuracy (manual validation sample)
- Processing time per email (target: <10 seconds)

---

## 8. Conclusion

**ROOT CAUSE:** Pipeline gap between classification and extraction. Emails are classified but extraction is not triggered automatically.

**QUICK FIX:** Modify `/scripts/run-entity-extraction.ts` to process emails with `processing_status='classified'` instead of waiting for `processing_status='processed'`.

**IMMEDIATE NEXT STEP:**
1. Understand why only 30 emails (3%) have status='processed'
2. Either: Trigger extraction on 'classified' status
3. Or: Fix whatever should be setting status to 'processed'
4. Backfill 882 classified emails

**EXPECTED TIMELINE TO 50% COVERAGE:** 2-3 weeks

**RISK:** Low. Extraction logic already works, just needs to run on more emails.

---

**Generated:** December 27, 2025
**Analysis Scripts:** 
- `/Users/dineshtarachandani/intdb/analyze-emails.ts`
- `/Users/dineshtarachandani/intdb/analyze-extractions.ts`
- `/Users/dineshtarachandani/intdb/analyze-entity-extractions.ts`
- `/Users/dineshtarachandani/intdb/generate-extraction-report.ts`

