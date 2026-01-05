# Scripts Index

> Last updated: 2026-01-05
> Total scripts: 461

## Overview

This directory contains development/operations scripts for the INTDB freight intelligence platform. Scripts are categorized by their function and whether they READ or WRITE to the database.

**Important:** These are development scripts, NOT production code. Production logic is in `/lib/services/`.

---

## Quick Reference

### Reports (READ-ONLY)

Reports generate statistics and summaries without modifying data.

| Script | Purpose | Run Command |
|--------|---------|-------------|
| `workflow-report.js` | Workflow state distribution report | `node scripts/workflow-report.js` |
| `complete-stats.ts` | Complete database statistics overview | `npx tsx scripts/complete-stats.ts` |
| `complete-workflow-report.js` | Comprehensive workflow analysis | `node scripts/complete-workflow-report.js` |
| `detailed-workflow-report.js` | Detailed workflow state breakdown | `node scripts/detailed-workflow-report.js` |
| `classification-summary.ts` | Document classification statistics | `npx tsx scripts/classification-summary.ts` |
| `data-audit.ts` | Comprehensive data audit report | `npx tsx scripts/data-audit.ts` |
| `data-quality-summary.ts` | Data quality metrics summary | `npx tsx scripts/data-quality-summary.ts` |
| `shipment-completeness.ts` | Shipment data completeness report | `npx tsx scripts/shipment-completeness.ts` |
| `final-coverage-report.ts` | Final extraction coverage report | `npx tsx scripts/final-coverage-report.ts` |
| `final-coverage-summary.ts` | Coverage summary statistics | `npx tsx scripts/final-coverage-summary.ts` |
| `final-data-quality-report.ts` | Data quality final report | `npx tsx scripts/final-data-quality-report.ts` |
| `final-extraction-report.ts` | Entity extraction final report | `npx tsx scripts/final-extraction-report.ts` |
| `final-accurate-coverage.ts` | Accurate coverage analysis | `npx tsx scripts/final-accurate-coverage.ts` |
| `bc_counts.js` | Booking confirmation counts by direction | `node scripts/bc_counts.js` |
| `broker-processing-summary.js` | Customs broker email processing summary | `node scripts/broker-processing-summary.js` |
| `event-history-analysis.js` | Workflow event history analysis | `node scripts/event-history-analysis.js` |
| `weekly-cohort-v3.ts` | Weekly cohort analysis v3 | `npx tsx scripts/weekly-cohort-v3.ts` |
| `weekly-cohort-v4.ts` | Weekly cohort analysis v4 | `npx tsx scripts/weekly-cohort-v4.ts` |
| `weekly-event-history.js` | Weekly event history report | `node scripts/weekly-event-history.js` |
| `workstate-docs-report.js` | Workstate documents report | `node scripts/workstate-docs-report.js` |
| `full-workstate-docs.js` | Full workstate documentation | `node scripts/full-workstate-docs.js` |
| `workflow-state-report.ts` | Workflow state breakdown | `npx tsx scripts/workflow-state-report.ts` |
| `coverage-by-source.ts` | Coverage analysis by email source | `npx tsx scripts/coverage-by-source.ts` |
| `coverage-shipping-line-bc-only.ts` | Shipping line BC coverage | `npx tsx scripts/coverage-shipping-line-bc-only.ts` |
| `coverage-with-bc-only.ts` | Coverage with booking confirmations | `npx tsx scripts/coverage-with-bc-only.ts` |
| `count-bc-deterministic.ts` | Deterministic BC counting | `npx tsx scripts/count-bc-deterministic.ts` |
| `count-missing-extractions.ts` | Missing extractions count | `npx tsx scripts/count-missing-extractions.ts` |
| `count-real-shipments.ts` | Real shipment count analysis | `npx tsx scripts/count-real-shipments.ts` |

---

### Analysis Scripts (READ-ONLY)

Deep analysis of data patterns, gaps, and quality issues.

| Script | Purpose |
|--------|---------|
| `analyze-100-emails.ts` | Analyze first 100 emails for linking gaps |
| `analyze-bc-volumes.ts` | BC-type email volume analysis |
| `analyze-broker-trucking-emails.js` | Customs broker and trucking email patterns |
| `analyze-carrier-formats.ts` | Carrier-specific email format analysis |
| `analyze-customs-gaps.js` | Customs documentation gaps |
| `analyze-cutoff-sources.ts` | Cutoff date source analysis |
| `analyze-direct-carrier-emails.ts` | Direct carrier email analysis |
| `analyze-email-parties.ts` | Email party (sender/recipient) analysis |
| `analyze-email-thread.ts` | Email thread structure analysis |
| `analyze-entity-types.ts` | Entity type distribution |
| `analyze-extraction-coverage.ts` | Extraction coverage analysis |
| `analyze-extraction-gaps.ts` | Extraction gap analysis |
| `analyze-extraction-quality.ts` | Extraction quality metrics |
| `analyze-gap-types.ts` | Gap type categorization |
| `analyze-incomplete-shipments.ts` | Incomplete shipment analysis |
| `analyze-inland-vs-seaport.ts` | Inland vs seaport location analysis |
| `analyze-large-thread.ts` | Large email thread analysis |
| `analyze-linkable-emails.ts` | Linkable email identification |
| `analyze-linkable-entity-types.ts` | Linkable entity type analysis |
| `analyze-maersk-msc-emails.ts` | Maersk and MSC email patterns |
| `analyze-missing-cutoffs.ts` | Missing cutoff date analysis |
| `analyze-missing-shipment-data.ts` | Missing shipment data analysis |
| `analyze-no-booking-emails.ts` | Emails without booking numbers |
| `analyze-orphaned-emails.ts` | Orphaned/unlinked email analysis |
| `analyze-processing-gaps.ts` | Processing gap analysis |
| `analyze-remaining-gaps.ts` | Remaining data gaps |
| `analyze-shipment-sources.ts` | Shipment data source analysis |
| `analyze-shipping-line-subjects.ts` | Shipping line subject patterns |
| `analyze-si-sources.ts` | SI document source analysis |
| `analyze-state-journey.ts` | Workflow state journey analysis |
| `analyze-subject-patterns.ts` | Email subject pattern analysis |
| `analyze-task-coverage.ts` | Task generation coverage |
| `analyze-unlinked-arrival-notices.ts` | Unlinked arrival notice analysis |
| `analyze-unlinked-emails.ts` | Unlinked email analysis |
| `corrected-linking-analysis.ts` | Corrected linking gap analysis |
| `full-bc-analysis.ts` | Full booking confirmation analysis |
| `full-document-analysis.ts` | Full document analysis |
| `full-linkage-audit.ts` | Full linkage audit |
| `deep-dive-direct-shipments.ts` | Deep dive into direct shipments |
| `deep-dive-document-linking.ts` | Deep dive into document linking |
| `deep-dive-minimal.ts` | Minimal deep dive analysis |
| `deep-dive-missing-patterns.ts` | Missing pattern deep dive |
| `deep-dive-shipments.ts` | Shipment deep dive |
| `deep-pattern-analysis.js` | Deep pattern analysis |
| `missing-doc-analysis.ts` | Missing document analysis |

---

### Check Scripts (READ-ONLY)

Validation and status checking scripts.

| Script | Purpose |
|--------|---------|
| `check-attachment-entities.ts` | Check attachment entity extractions |
| `check-attachment-status.ts` | Check attachment processing status |
| `check-attachments.ts` | Check attachment records |
| `check-authority-rules.ts` | Check authority rules configuration |
| `check-backfill-results.ts` | Check backfill operation results |
| `check-bad-shipments.ts` | Identify problematic shipments |
| `check-bc-pdf.ts` | Check booking confirmation PDFs |
| `check-bc-states.ts` | Check BC workflow states |
| `check-booking-coverage.ts` | Check booking number coverage |
| `check-brokers.js` | Check broker email patterns |
| `check-candidate-groups.ts` | Check link candidate groups |
| `check-carrier-ids.ts` | Check carrier ID assignments |
| `check-cei-email.ts` | Check specific CEI email |
| `check-classification-status.ts` | Check classification status |
| `check-cma-body.ts` | Check CMA CGM email bodies |
| `check-cma-html.ts` | Check CMA CGM HTML content |
| `check-cma-pdfs.ts` | Check CMA CGM PDFs |
| `check-confirmed.ts` | Check confirmed documents |
| `check-correct-project.ts` | Verify correct Supabase project |
| `check-cosco-pdfs.ts` | Check COSCO PDFs |
| `check-coverage.ts` | Check overall coverage |
| `check-cutoff-coverage.ts` | Check cutoff date coverage |
| `check-dashboard.ts` | Check dashboard data |
| `check-data-quality.ts` | Check data quality metrics |
| `check-data-quality-all.ts` | Check all data quality metrics |
| `check-data-quality-detailed.ts` | Detailed data quality check |
| `check-date-entities.ts` | Check date entity extractions |
| `check-doc-types.ts` | Check document types |
| `check-duplicate-bookings.ts` | Check for duplicate bookings |
| `check-email-bodies.ts` | Check email body content |
| `check-email-types.ts` | Check email type distribution |
| `check-entities.ts` | Check entity records |
| `check-entity-extractions.ts` | Check entity extraction records |
| `check-entity-links.ts` | Check entity linkage |
| `check-entity-types.ts` | Check entity type distribution |
| `check-etd-eta.ts` | Check ETD/ETA fields |
| `check-extracted-text.ts` | Check extracted text content |
| `check-extraction-stats.ts` | Check extraction statistics |
| `check-full-pdf.ts` | Check full PDF extraction |
| `check-hapag-entities.ts` | Check Hapag-Lloyd entities |
| `check-hapag-info-mail.ts` | Check Hapag info emails |
| `check-hapag-subjects.ts` | Check Hapag subject patterns |
| `check-hbl-linkage.ts` | Check HBL linkage |
| `check-hbl-matching.js` | Check HBL matching |
| `check-inland-vs-pol.ts` | Check inland vs POL |
| `check-layer2-quality.ts` | Check Layer 2 data quality |
| `check-linkage-status.ts` | Check document linkage status |
| `check-linking-coverage.ts` | Check linking coverage |
| `check-linking-opportunity.ts` | Check linking opportunities |
| `check-milestones.ts` | Check shipment milestones |
| `check-missing-shipment.ts` | Check missing shipments |
| `check-non-hapag-shipments.ts` | Check non-Hapag shipments |
| `check-orphaned-booking-confirmations.ts` | Check orphaned BCs |
| `check-pdf-content.ts` | Check PDF content |
| `check-pdf-distribution.ts` | Check PDF distribution |
| `check-pdf-status.ts` | Check PDF processing status |
| `check-portside-extractions.js` | Check Portside extractions |
| `check-postgrest-schema.ts` | Check PostgREST schema |
| `check-processing-status.ts` | Check processing status |
| `check-real-bc.ts` | Check real booking confirmations |
| `check-real-shipments.ts` | Check real shipment records |
| `check-recent-shipments.ts` | Check recently created shipments |
| `check-schema.ts` | Check database schema |
| `check-senders.ts` | Check email senders |
| `check-senders-unlinked.ts` | Check unlinked email senders |
| `check-shipment-columns.ts` | Check shipment columns |
| `check-shipment-data.ts` | Check shipment data |
| `check-shipment-docs.ts` | Check shipment documents |
| `check-shipment-entities.ts` | Check shipment entities |
| `check-shipment-model.ts` | Check shipment model |
| `check-shipments-count.ts` | Check shipment count |
| `check-source-email.ts` | Check source email |
| `check-specific-shipment.ts` | Check specific shipment |
| `check-state-order.ts` | Check workflow state order |
| `check-tables.ts` | Check database tables |
| `check-unclassified.ts` | Check unclassified emails |
| `check-unextracted-emails.ts` | Check unextracted emails |
| `check-unlinked.ts` | Check unlinked documents |
| `check-unlinked-with-matches.ts` | Check unlinked with potential matches |
| `check-unprocessed.ts` | Check unprocessed emails |
| `check-via-api.ts` | Check via API |
| `check-via-directions.ts` | Check email directions |
| `check-workflow-states.ts` | Check workflow states |
| `check_diff.js` | Check differences |
| `check_outbound.js` | Check outbound emails |

---

### Investigation Scripts (READ-ONLY)

Debugging and root cause analysis scripts.

| Script | Purpose |
|--------|---------|
| `investigate-attachment-gap.ts` | Investigate attachment gaps |
| `investigate-attachment-issue.ts` | Investigate attachment issues |
| `investigate-bad-classifications.ts` | Investigate bad classifications |
| `investigate-bl-inbound.ts` | Investigate inbound BL documents |
| `investigate-counts.ts` | Investigate count discrepancies |
| `investigate-empty-shipments.ts` | Investigate empty shipments |
| `investigate-failures.ts` | Investigate processing failures |
| `investigate-gap.ts` | Investigate data gaps |
| `investigate-general-correspondence.ts` | Investigate general correspondence |
| `investigate-hapag-arrivals.ts` | Investigate Hapag arrival notices |
| `investigate-hbl-draft.ts` | Investigate HBL drafts |
| `investigate-invoice-amendment.ts` | Investigate invoice amendments |
| `investigate-linking.ts` | Investigate document linking |
| `investigate-linking-gaps.ts` | Investigate linking gaps |
| `investigate-linking-gaps-v2.ts` | Investigate linking gaps v2 |
| `investigate-minimal-data.ts` | Investigate minimal data shipments |
| `investigate-missing-10.ts` | Investigate missing items |
| `investigate-missing-bc-cutoffs.ts` | Investigate missing BC cutoffs |
| `investigate-missing-cutoffs.ts` | Investigate missing cutoffs |
| `investigate-missing-data.ts` | Investigate missing data |
| `investigate-missing-received.ts` | Investigate missing received docs |
| `investigate-orphan-cutoffs.ts` | Investigate orphan cutoffs |
| `investigate-pdf-content.ts` | Investigate PDF content |
| `investigate-shipment-data.ts` | Investigate shipment data |
| `investigate-shipment-state.ts` | Investigate shipment state |
| `investigate-si-bl.ts` | Investigate SI and BL |
| `investigate-unlinked-bookings.ts` | Investigate unlinked bookings |
| `investigate-workflow-states.ts` | Investigate workflow states |

---

### Diagnostic/Debug Scripts (READ-ONLY)

Debugging and tracing scripts.

| Script | Purpose |
|--------|---------|
| `debug-attachment-link.ts` | Debug attachment linking |
| `debug-attachments.ts` | Debug attachment processing |
| `debug-cohort.ts` | Debug cohort analysis |
| `debug-distribution.ts` | Debug state distribution |
| `debug-entity-flow.ts` | Debug entity flow |
| `debug-not-linked.ts` | Debug unlinked documents |
| `debug-regex.ts` | Debug regex patterns |
| `diagnose-broker-classification.js` | Diagnose broker classification |
| `diagnose-entity-gaps.ts` | Diagnose entity gaps |
| `diagnose-gaps.ts` | Diagnose data gaps |
| `diagnose-shipment-data.ts` | Diagnose shipment data issues |
| `trace-entity-mapping.ts` | Trace entity mapping |
| `trace-identifier-relationships.ts` | Trace identifier relationships |
| `trace-missing-data.ts` | Trace missing data |
| `trace-pipeline.ts` | Trace pipeline flow |
| `trace-pipeline-2.ts` | Trace pipeline v2 |
| `trace-pipeline-hbl.ts` | Trace HBL pipeline |

---

### Verification Scripts (READ-ONLY)

Verify operations and data integrity.

| Script | Purpose |
|--------|---------|
| `verify-all-states.ts` | Verify all workflow states |
| `verify-attachment-counts.ts` | Verify attachment counts |
| `verify-attachment-status.ts` | Verify attachment status |
| `verify-attachments-by-doctype.ts` | Verify attachments by doc type |
| `verify-carrier-extraction-success.ts` | Verify carrier extraction success |
| `verify-cma.ts` | Verify CMA data |
| `verify-direct-carrier-fix.ts` | Verify direct carrier fix |
| `verify-extraction-coverage.ts` | Verify extraction coverage |
| `verify-final.ts` | Final verification |
| `verify-no-hallucinated.ts` | Verify no hallucinated dates |
| `verify-pagination.ts` | Verify pagination |
| `verify-shipment-data-quality.ts` | Verify shipment data quality |
| `verify-shipment-model.ts` | Verify shipment model |
| `verify_outbound.js` | Verify outbound emails |
| `validate-deterministic-classification.ts` | Validate deterministic classification |

---

### View/Show Scripts (READ-ONLY)

Display data in readable format.

| Script | Purpose |
|--------|---------|
| `show-alerts.ts` | Show missing document alerts |
| `show-booking-confirmations.ts` | Show booking confirmations |
| `show-booking-shared-details.ts` | Show booking shared details |
| `show-booking-timeline-detail.ts` | Show booking timeline |
| `show-cosco-extractions.ts` | Show COSCO extractions |
| `show-cutoffs-raw.ts` | Show raw cutoff data |
| `show-distribution.ts` | Show state distribution |
| `show-doc-samples.ts` | Show document samples |
| `show-email-samples.ts` | Show email samples |
| `show-hapag-with-pdf.ts` | Show Hapag emails with PDFs |
| `show-journey-sample.ts` | Show journey sample |
| `show-maersk-raw.ts` | Show Maersk raw data |
| `show-pipeline-status.ts` | Show pipeline status |
| `show-recent-shipments.ts` | Show recent shipments |
| `show-sample-emails.ts` | Show sample emails |
| `show-sample-extractions.ts` | Show sample extractions |
| `show-shipment-timeline.ts` | Show shipment timeline |
| `show-unlinked-patterns.ts` | Show unlinked patterns |
| `show-unmatched-patterns.ts` | Show unmatched patterns |
| `show-workflow-samples.ts` | Show workflow samples |
| `view-all-emails-detailed.ts` | View detailed email list |
| `view-booking-emails.ts` | View booking emails |
| `view-clean-pipeline.ts` | View clean pipeline |
| `view-hapag-emails.ts` | View Hapag emails |
| `view-outgoing-emails.ts` | View outgoing emails |
| `view-pipeline-results.ts` | View pipeline results |
| `view-sent-emails-detailed.ts` | View sent emails detailed |
| `view-sent-emails-pipeline.ts` | View sent emails pipeline |

---

### Audit Scripts (READ-ONLY)

Audit data and operations.

| Script | Purpose |
|--------|---------|
| `audit-booking-confirmations.ts` | Audit booking confirmations to shipments |
| `audit-orion-data.ts` | Audit Orion data pipeline |

---

### Workflow Journey Scripts (READ-ONLY)

Track and analyze workflow state progression.

| Script | Purpose |
|--------|---------|
| `all-workstates-detailed.ts` | All workflow states with details |
| `cumulative.ts` | Cumulative workflow analysis |
| `document-journey.ts` | Document journey tracking |
| `document-journey-grid.ts` | Document journey grid view |
| `journey-simulation-demo.ts` | Journey simulation demo (no DB) |
| `workflow-email-samples.ts` | Workflow email samples |
| `workflow-event-history.ts` | Workflow event history |
| `workflow-event-history.js` | Workflow event history (JS) |
| `workflow-journey.ts` | Workflow journey tracking |
| `workflow-journey-named.ts` | Workflow journey with names |
| `workflow-verify.ts` | Verify workflow states |

---

## WRITE Operations (Modify Database)

**CAUTION:** These scripts modify data. Always backup or test first.

### Extraction Scripts (WRITES to DB)

| Script | Purpose | Caution |
|--------|---------|---------|
| `aggressive-cutoff-extraction.ts` | Extract cutoffs from all emails | Updates entity_extractions |
| `ai-extract-booking-data.ts` | AI-powered booking data extraction | Uses Claude API, updates entities |
| `comprehensive-cutoff-extraction.ts` | Comprehensive cutoff extraction | Updates entity_extractions |
| `comprehensive-entity-sync.ts` | Sync entities comprehensively | Updates multiple tables |
| `comprehensive-shipment-extraction.ts` | Full shipment extraction | Creates shipments |
| `extract-all-attachments.ts` | Extract all email attachments | Updates raw_attachments |
| `extract-all-carrier-cutoffs.ts` | Extract carrier cutoffs | Updates entity_extractions |
| `extract-all-document-types.ts` | Extract all document types | Updates classifications |
| `extract-all-emails-full.ts` | Full email extraction | Updates multiple tables |
| `extract-all-entities.ts` | Extract all entities | Updates entity_extractions |
| `extract-all-missing-pdfs.ts` | Extract missing PDFs | Updates raw_attachments |
| `extract-all-parallel.ts` | Parallel extraction | Updates multiple tables |
| `extract-all-pdfs.ts` | Extract all PDFs | Updates raw_attachments |
| `extract-and-link-orphans.ts` | Extract and link orphan emails | Creates links |
| `extract-cutoffs.ts` | Extract cutoff dates | Updates entity_extractions |
| `extract-embedded-cutoffs.ts` | Extract embedded cutoffs | Updates entities |
| `extract-embedded-pdf-text.ts` | Extract embedded PDF text | Updates raw_attachments |
| `extract-entities-always.ts` | Always extract entities | Updates entity_extractions |
| `extract-etd-from-vessel.ts` | Extract ETD from vessel | Updates shipments |
| `extract-from-embedded-pdfs.ts` | Extract from embedded PDFs | Updates attachments |
| `extract-from-pdf-attachments.ts` | Extract from PDF attachments | Updates attachments |
| `extract-hapag-bookings.ts` | Extract Hapag bookings | Updates entities |
| `extract-hapag-cutoffs.ts` | Extract Hapag cutoffs | Updates entities |
| `extract-hbl-parties.ts` | Extract HBL parties | Updates entities |
| `extract-hbl-parties-v2.ts` | Extract HBL parties v2 | Updates entities |
| `extract-hbl-parties-v3.ts` | Extract HBL parties v3 | Updates entities |
| `extract-html-cutoffs.ts` | Extract HTML cutoffs | Updates entities |
| `extract-missing-entities.ts` | Extract missing entities | Updates entities |
| `extract-missing-pdfs.ts` | Extract missing PDFs | Updates attachments |
| `extract-pdf-content.ts` | Extract PDF content | Updates attachments |
| `extract-pdf-text.ts` | Extract PDF text | Updates attachments |
| `extract-targeted-pdf-cutoffs.ts` | Extract targeted PDF cutoffs | Updates entities |
| `extract-vessel-eta.ts` | Extract vessel ETA | Updates entities |
| `extract-vessel-eta-v2.ts` | Extract vessel ETA v2 | Updates entities |
| `final-cutoff-extraction.ts` | Final cutoff extraction | Updates entities |
| `insert-missing-extractions.ts` | Insert missing extractions | Inserts entities |

### Classification Scripts (WRITES to DB)

| Script | Purpose | Caution |
|--------|---------|---------|
| `classify-all-74-emails.ts` | Classify 74 emails | Updates document_classifications |
| `classify-new-thread.ts` | Classify new email threads | Updates classifications |
| `classify-outgoing-emails.ts` | Classify outgoing emails | Updates classifications |
| `classify-pending-emails.ts` | Classify pending emails | Updates classifications |
| `classify-via-postgres.ts` | Classify via PostgreSQL | Updates classifications |
| `classify-with-thread-context.ts` | Classify with thread context | Updates classifications |
| `detect-duplicates-and-revisions.ts` | Detect duplicates/revisions | Updates classifications |
| `detect-misclassifications.ts` | Detect and fix misclassifications | May update classifications |
| `reclassify-documents.ts` | Reclassify documents | Updates classifications |
| `reclassify-misclassified.ts` | Reclassify misclassified docs | Updates classifications |
| `reclassify-via-postgres.ts` | Reclassify via PostgreSQL | Updates classifications |
| `reclassify-with-patterns.ts` | Reclassify with patterns | Updates classifications |

### Linking Scripts (WRITES to DB)

| Script | Purpose | Caution |
|--------|---------|---------|
| `link-all-related-emails.ts` | Link all related emails | Creates shipment_documents |
| `link-by-reference.ts` | Link by reference number | Creates links |
| `link-by-thread.ts` | Link by email thread | Creates links |
| `link-carriers-simple.ts` | Simple carrier linking | Updates carrier_id |
| `link-carriers-to-shipments.ts` | Link carriers to shipments | Updates carrier links |
| `link-carriers-via-email.ts` | Link carriers via email | Updates carrier links |
| `link-documents-to-shipments.ts` | Link documents to shipments | Creates shipment_documents |
| `link-internal-forwards.ts` | Link internal forwards | Creates links |
| `link-notifications-to-shipments.ts` | Link notifications | Creates notification links |
| `link-orphan-bookings.ts` | Link orphan bookings | Creates links |
| `link-shipment-documents.ts` | Link shipment documents | Creates links |
| `link-shipments-to-carrier-emails.ts` | Link to carrier emails | Creates links |
| `link-shipments-to-parties.ts` | Link to parties | Updates party references |
| `link-to-carriers-table.ts` | Link to carriers table | Updates links |
| `link-via-identifier-mappings.ts` | Link via identifier maps | Creates links |
| `relink-unlinked-emails.ts` | Re-link unlinked emails | Creates links |
| `run-comprehensive-backfill.ts` | Comprehensive backfill | Creates many links |
| `run-linking-process.ts` | Run linking process | Creates links |
| `smart-booking-linker.ts` | Smart booking linking | Creates links |

### Processing Scripts (WRITES to DB)

| Script | Purpose | Caution |
|--------|---------|---------|
| `process-booking-amendments.ts` | Process booking amendments | Updates bookings |
| `process-booking-confirmations.ts` | Process booking confirmations | Creates shipments |
| `process-broker-emails-production.ts` | Process broker emails | Updates emails |
| `process-emails-production.ts` | Production email processing | Updates all tables |
| `process-pending-emails.js` | Process pending emails | Updates all tables |
| `process-with-hierarchy.ts` | Process with hierarchy | Updates multiple tables |

### Reprocessing Scripts (WRITES to DB)

| Script | Purpose | Caution |
|--------|---------|---------|
| `reprocess-all-emails.ts` | Reprocess all emails | Full reprocess |
| `reprocess-all-hapag-emails.ts` | Reprocess Hapag emails | Updates Hapag data |
| `reprocess-bad-shipments.ts` | Reprocess bad shipments | Updates shipments |
| `reprocess-broker-emails.js` | Reprocess broker emails | Updates broker data |
| `reprocess-cma-shipments.ts` | Reprocess CMA shipments | Updates CMA data |
| `reprocess-cma.ts` | Reprocess CMA | Updates CMA data |
| `reprocess-entities-comprehensive.ts` | Comprehensive entity reprocess | Updates entities |
| `reprocess-hallucinated-shipments.ts` | Fix hallucinated data | Updates shipments |
| `reprocess-incomplete-shipments.ts` | Reprocess incomplete | Updates shipments |
| `reprocess-one-shipment.ts` | Reprocess single shipment | Updates one shipment |
| `reprocess-unclassified-emails.ts` | Reprocess unclassified | Updates classifications |
| `reprocess-with-attachments.ts` | Reprocess with attachments | Updates attachments |
| `rerun-extraction-missing-bookings.ts` | Re-run extraction | Updates extractions |

### Sync/Update Scripts (WRITES to DB)

| Script | Purpose | Caution |
|--------|---------|---------|
| `sync-entities-to-shipments.ts` | Sync entities to shipments | Updates shipments |
| `sync-maersk-entities.ts` | Sync Maersk entities | Updates Maersk data |
| `sync-shipment-doc-types.ts` | Sync document types | Updates doc types |
| `update-workflow-states.ts` | Update workflow states | Updates workflow |
| `fill-shipment-data.ts` | Fill shipment data | Updates shipments |
| `fill-shipment-gaps.ts` | Fill data gaps | Updates shipments |
| `enrich-shipments-from-documents.ts` | Enrich shipment data | Updates shipments |
| `refresh-shipments.ts` | Refresh shipment data | Updates shipments |
| `refresh-shipments-from-linked-docs.ts` | Refresh from linked docs | Updates shipments |
| `refresh-shipments-with-entities.ts` | Refresh with entities | Updates shipments |
| `refresh-pdf-extraction.ts` | Refresh PDF extraction | Updates attachments |
| `refetch-and-extract-pdfs.ts` | Refetch and extract PDFs | Updates attachments |
| `refetch-extract-pdfs.ts` | Refetch extract PDFs | Updates attachments |
| `resync-missing-data.ts` | Resync missing data | Updates multiple |
| `force-update-shipment-entities.ts` | Force update entities | Updates shipments |
| `recommend-status-updates.ts` | Recommend status updates | May update status |
| `reextract-shipment-hbl.ts` | Re-extract HBL data | Updates HBL fields |

### Data Correction Scripts (WRITES to DB)

| Script | Purpose | Caution |
|--------|---------|---------|
| `null-hallucinated-dates.ts` | Null hallucinated dates | Sets dates to null |
| `homogenize-port-names.ts` | Standardize port names | Updates port fields |
| `fix_price_overview.js` | Fix price overview | Updates prices |

### Task/Notification Generation (WRITES to DB)

| Script | Purpose | Caution |
|--------|---------|---------|
| `generate-all-tasks.ts` | Generate all tasks | Creates action_tasks |
| `generate-deadline-tasks.ts` | Generate deadline tasks | Creates tasks |
| `generate-document-tasks.ts` | Generate document tasks | Creates tasks |
| `generate-exception-notifications.ts` | Generate exception notifications | Creates notifications |
| `generate-missing-document-tasks.ts` | Generate missing doc tasks | Creates tasks |
| `generate-notification-tasks.ts` | Generate notification tasks | Creates tasks |
| `generate-notifications-fixed.ts` | Generate notifications (fixed) | Creates notifications |
| `generate-notifications-from-emails.ts` | Generate from emails | Creates notifications |
| `generate-overdue-deadline-tasks.ts` | Generate overdue tasks | Creates tasks |
| `generate-workflow-tasks.ts` | Generate workflow tasks | Creates tasks |

### Migration Scripts (WRITES to DB)

| Script | Purpose | Caution |
|--------|---------|---------|
| `run-migration.ts` | Run migration | Schema changes |
| `run-migration-003.ts` | Migration 003 | Schema changes |
| `run-migration-005.ts` | Migration 005 | Schema changes |
| `run-migration-006.ts` | Migration 006 | Schema changes |
| `run-migration-020.ts` | Migration 020 - Idempotency | Adds constraints |
| `run-migration-020-pg.ts` | Migration 020 (PostgreSQL) | Adds constraints |
| `run-migration-020-supabase.ts` | Migration 020 (Supabase) | Adds constraints |
| `run-migration-021.ts` | Migration 021 | Schema changes |
| `run-migration-022.ts` | Migration 022 | Schema changes |
| `run-migration-023.ts` | Migration 023 | Schema changes |
| `run-migration-030.ts` | Migration 030 | Schema changes |
| `run-migrations-009-014.ts` | Migrations 009-014 | Multiple migrations |
| `run-insight-migration.ts` | Insight migration | Insight schema |
| `check-and-run-migration-020.ts` | Check and run migration | May run migration |
| `create-workflow-events-table.js` | Create workflow events table | Creates table |
| `create-and-populate-identifier-mappings.ts` | Create identifier mappings | Creates table + data |

### Pipeline Scripts (WRITES to DB)

| Script | Purpose | Caution |
|--------|---------|---------|
| `run-unified-pipeline.ts` | Run unified pipeline | Full pipeline |
| `run-entity-extraction.ts` | Run entity extraction | Updates entities |
| `run-extraction-fast.ts` | Fast extraction | Updates entities |
| `run-comprehensive-extraction.ts` | Comprehensive extraction | Updates all |
| `run-shipment-backfill.ts` | Run shipment backfill | Creates shipments |
| `wire-data-to-platform.ts` | Wire data to platform | Updates all tables |
| `populate-document-lifecycle.ts` | Populate document lifecycle | Creates lifecycle records |
| `populate-inland-ports.ts` | Populate inland ports | Updates port data |

### Setup/Seed Scripts (WRITES to DB)

| Script | Purpose | Caution |
|--------|---------|---------|
| `seed-stakeholders.ts` | Seed stakeholder data | Creates stakeholders |
| `save-all-attachments.ts` | Save all attachments | Updates attachments |
| `download-large-thread.ts` | Download large email thread | Creates raw_emails |

---

## Testing Scripts

| Script | Purpose |
|--------|---------|
| `test-all-brokers.js` | Test all broker patterns |
| `test-api-access.ts` | Test API access |
| `test-artemus-patterns.js` | Test Artemus patterns |
| `test-attachment-classification.ts` | Test attachment classification |
| `test-backfill-small.ts` | Test small backfill |
| `test-broker-trucking-changes.js` | Test broker trucking changes |
| `test-classification-immutability.ts` | Test classification immutability |
| `test-classification-quality.ts` | Test classification quality |
| `test-classifier.ts` | Test document classifier |
| `test-content-classification.ts` | Test content classification |
| `test-date-parser.ts` | Test date parser |
| `test-db-connection.ts` | Test database connection |
| `test-document-linking.ts` | Test document linking |
| `test-email-agent.ts` | Test email agent |
| `test-extraction.ts` | Test extraction |
| `test-extraction-patterns.js` | Test extraction patterns |
| `test-full-pipeline.ts` | Test full pipeline |
| `test-gmail-attachment.ts` | Test Gmail attachment |
| `test-hbl-extraction.js` | Test HBL extraction |
| `test-insight-actions.ts` | Test insight actions |
| `test-insight-engine.ts` | Test insight engine |
| `test-linking-service.ts` | Test linking service |
| `test-linking-via-api.ts` | Test linking via API |
| `test-model-comparison.ts` | Test model comparison |
| `test-new-extraction.ts` | Test new extraction |
| `test-new-gmail-query.ts` | Test new Gmail query |
| `test-patterns.ts` | Test patterns |
| `test-pipeline-extracted-pdfs.ts` | Test pipeline PDFs |
| `test-pipeline-wiring.ts` | Test pipeline wiring |
| `test-pipeline-with-attachments.ts` | Test pipeline with attachments |
| `test-query.ts` | Test queries |
| `test-reprocess-booking.ts` | Test reprocess booking |
| `test-reprocess-one.ts` | Test reprocess one |
| `test-sent-emails.ts` | Test sent emails |
| `test-specific-dates.ts` | Test specific dates |
| `test-update.ts` | Test update operations |

---

## Utility Scripts

| Script | Purpose |
|--------|---------|
| `setup-gmail-auth.ts` | Setup Gmail OAuth authentication |
| `list-all-tables.ts` | List all database tables |
| `query-booking-intelligence.ts` | Query booking intelligence |
| `recheck-counts.ts` | Recheck various counts |
| `compare-views.ts` | Compare database views |
| `evaluate-all-patterns.ts` | Evaluate all patterns |
| `get-carrier-names.ts` | Get carrier names |
| `parse-cma-cutoffs.ts` | Parse CMA cutoffs |
| `parse-cma-cutoffs-v2.ts` | Parse CMA cutoffs v2 |
| `explain-linkage.ts` | Explain document linkage |
| `explore-hbl-draft-shared.ts` | Explore HBL draft shared |
| `find-booking-details.ts` | Find booking details |
| `find-missing.ts` | Find missing data |
| `find-missing-inbound.ts` | Find missing inbound |
| `find-non-shipments.ts` | Find non-shipments |
| `find-unlinked-critical-docs.ts` | Find unlinked critical docs |
| `find-with-pdf.ts` | Find emails with PDFs |
| `booking-shared-with-content.ts` | Booking shared with content |
| `run-email-ingestion-cron.ts` | Run email ingestion cron |
| `examine.js` | Examine data |
| `examine2.js` | Examine data v2 |
| `examine3.js` | Examine data v3 |
| `examine4.js` | Examine data v4 |

---

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `analysis/` | Analysis scripts |
| `debugging/` | Debug scripts |
| `reports/` | Report templates |
| `archive/` | Archived/deprecated scripts |
| `lib/` | Shared library code |

---

## Usage Guidelines

### Running Scripts

```bash
# TypeScript scripts
npx tsx scripts/<script-name>.ts

# JavaScript scripts
node scripts/<script-name>.js
```

### Environment Variables

Scripts require these environment variables in `.env`:

```
SUPABASE_URL=https://fdmcdbvkfdmrdowfjrcz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
ANTHROPIC_API_KEY=<your-anthropic-key>
GMAIL_CLIENT_ID=<your-gmail-client-id>
GMAIL_CLIENT_SECRET=<your-gmail-client-secret>
GMAIL_REFRESH_TOKEN=<your-gmail-refresh-token>
```

### Safety Guidelines

1. **READ-ONLY scripts** are safe to run anytime
2. **WRITE scripts** should be run with caution:
   - Test on small batches first
   - Use `DRY_RUN=true` if supported
   - Check script output before confirming
3. **Migration scripts** should be reviewed before running
4. **Production scripts** like `process-emails-production.ts` are idempotent

---

*Generated by Claude Code*
