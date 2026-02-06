-- Migration 074: Drop empty tables with zero production code references
-- All 5 tables have 0 rows and are never read/written by production code
-- Verified: No imports in lib/chronicle/ or lib/repositories/ reference these

-- pattern_audit: Pattern change history (created migration 048, never used)
DROP TABLE IF EXISTS pattern_audit CASCADE;

-- pending_patterns: Patterns awaiting approval (created migration 048, no approval workflow exists)
DROP TABLE IF EXISTS pending_patterns CASCADE;

-- pattern_memory: Aggregated learning (created migration 047, never computed)
DROP TABLE IF EXISTS pattern_memory CASCADE;

-- action_trigger_log: V2 action audit trail (created supabase migration 20250118, never populated)
DROP TABLE IF EXISTS action_trigger_log CASCADE;

-- shipment_financials: Financial tracking (created migration 004, never populated, 0 code refs)
DROP TABLE IF EXISTS shipment_financials CASCADE;

-- Note: NOT dropping these tables (empty but still referenced in code):
-- chronicle_sync_state - used by chronicle-repository.ts (lines 230, 281)
-- shipment_link_candidates - used by shipment-link-candidate-repository.ts
-- shipment_containers - used by shipment-repository.ts (line 178)
