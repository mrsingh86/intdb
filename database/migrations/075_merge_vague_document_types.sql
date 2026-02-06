-- Migration 075: Merge vague/duplicate document types
-- Consolidates 3 redundant document types into their canonical equivalents
-- Total affected: ~624 records (1.5% of 40,676)

-- 1. acknowledgement (161 records) → approval
-- Both mean "OK, noted, confirmed" - no actionable distinction
UPDATE chronicle
SET document_type = 'approval'
WHERE document_type = 'acknowledgement';

-- 2. internal_communication (109 records) → internal_notification
-- Both mean "Intoglo internal email" - exact duplicate concept
UPDATE chronicle
SET document_type = 'internal_notification'
WHERE document_type = 'internal_communication';

-- 3. system_notification (351 records) → internal_notification
-- Auto-emails from ODeX, carrier systems - same as internal notifications
UPDATE chronicle
SET document_type = 'internal_notification'
WHERE document_type = 'system_notification';

-- 4. tr_submission (4 records) → customs_entry
-- Transport Release is a customs document type
UPDATE chronicle
SET document_type = 'customs_entry'
WHERE document_type = 'tr_submission';

-- Also update learning_episodes to keep consistency
UPDATE learning_episodes
SET predicted_value = 'approval'
WHERE prediction_field = 'document_type' AND predicted_value = 'acknowledgement';

UPDATE learning_episodes
SET predicted_value = 'internal_notification'
WHERE prediction_field = 'document_type' AND predicted_value IN ('internal_communication', 'system_notification');

UPDATE learning_episodes
SET predicted_value = 'customs_entry'
WHERE prediction_field = 'document_type' AND predicted_value = 'tr_submission';
