-- ============================================================================
-- MIGRATION 003: CLASSIFICATION FEEDBACK & AI LEARNING SYSTEM
-- ============================================================================
-- Description: Adds comprehensive feedback system with AI learning capabilities
-- Author: Claude
-- Date: 2024-12-25
-- Dependencies: Requires freight-intelligence-schema.sql
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. CLASSIFICATION FEEDBACK TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS classification_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email_id UUID NOT NULL REFERENCES raw_emails(id) ON DELETE CASCADE,

    -- Feedback Type
    feedback_type VARCHAR(50) NOT NULL CHECK (feedback_type IN (
        'classification_correction',
        'entity_feedback',
        'pattern_description',
        'general_feedback'
    )),

    -- Classification Correction Fields
    original_classification VARCHAR(100),
    corrected_classification VARCHAR(100),
    classification_explanation TEXT,

    -- Pattern Description Fields
    pattern_description TEXT,
    pattern_examples TEXT[],

    -- Metadata
    submitted_by VARCHAR(255) NOT NULL DEFAULT 'manual_review',
    submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Processing Status
    is_processed BOOLEAN DEFAULT FALSE,
    processed_at TIMESTAMP,
    processing_status VARCHAR(50) CHECK (processing_status IN (
        'pending', 'processing', 'applied', 'rejected', 'needs_review'
    )) DEFAULT 'pending',

    -- Audit Trail
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    -- Ensure one feedback per email per user per type
    UNIQUE(email_id, submitted_by, feedback_type)
);

CREATE INDEX idx_feedback_email ON classification_feedback(email_id);
CREATE INDEX idx_feedback_status ON classification_feedback(processing_status);
CREATE INDEX idx_feedback_submitted ON classification_feedback(submitted_at DESC);
CREATE INDEX idx_feedback_type ON classification_feedback(feedback_type);

COMMENT ON TABLE classification_feedback IS 'User feedback on classifications with explanations and pattern descriptions for AI learning';

-- ============================================================================
-- 2. ENTITY FEEDBACK TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS entity_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feedback_id UUID NOT NULL REFERENCES classification_feedback(id) ON DELETE CASCADE,
    entity_id UUID REFERENCES entity_extractions(id) ON DELETE CASCADE,

    -- Entity Details
    entity_type VARCHAR(100) NOT NULL,
    original_value TEXT,
    corrected_value TEXT,

    -- Feedback Type
    is_missing BOOLEAN DEFAULT FALSE,  -- True if entity was missing
    is_incorrect BOOLEAN DEFAULT FALSE, -- True if entity was wrong
    should_remove BOOLEAN DEFAULT FALSE, -- True if entity shouldn't exist

    -- Confidence Adjustment
    confidence_adjustment INTEGER, -- How much to adjust confidence (-100 to +100)

    -- Explanation
    explanation TEXT,

    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_entity_feedback_feedback ON entity_feedback(feedback_id);
CREATE INDEX idx_entity_feedback_entity ON entity_feedback(entity_id);
CREATE INDEX idx_entity_feedback_type ON entity_feedback(entity_type);

COMMENT ON TABLE entity_feedback IS 'Detailed entity-level corrections and additions from user feedback';

-- ============================================================================
-- 3. CLASSIFICATION RULES (AI LEARNED PATTERNS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS classification_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Rule Details
    rule_name VARCHAR(255) NOT NULL,
    rule_type VARCHAR(50) CHECK (rule_type IN (
        'sender_pattern', 'subject_pattern', 'body_pattern',
        'entity_pattern', 'combined_pattern'
    )),

    -- Pattern Matching Fields
    sender_patterns TEXT[],
    subject_patterns TEXT[],
    body_keywords TEXT[],
    required_entities VARCHAR(50)[],

    -- Classification Output
    target_document_type VARCHAR(100) NOT NULL,
    confidence_boost INTEGER DEFAULT 0,

    -- Source and Impact
    source_feedback_ids UUID[],
    learned_from_count INTEGER DEFAULT 1,

    -- Application Statistics
    affected_email_count INTEGER DEFAULT 0,
    successful_applications INTEGER DEFAULT 0,
    failed_applications INTEGER DEFAULT 0,

    -- Approval Workflow
    is_active BOOLEAN DEFAULT FALSE,
    needs_approval BOOLEAN DEFAULT TRUE,
    approved_by VARCHAR(255),
    approved_at TIMESTAMP,
    rejection_reason TEXT,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    UNIQUE(rule_name)
);

CREATE INDEX idx_rules_active ON classification_rules(is_active) WHERE is_active = true;
CREATE INDEX idx_rules_type ON classification_rules(rule_type);
CREATE INDEX idx_rules_target_type ON classification_rules(target_document_type);
CREATE INDEX idx_rules_needs_approval ON classification_rules(needs_approval) WHERE needs_approval = true;

COMMENT ON TABLE classification_rules IS 'AI-learned classification rules from user feedback patterns';

-- ============================================================================
-- 4. FEEDBACK APPLICATIONS (TRACK AI ACTIONS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS feedback_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feedback_id UUID NOT NULL REFERENCES classification_feedback(id) ON DELETE CASCADE,
    rule_id UUID REFERENCES classification_rules(id) ON DELETE SET NULL,

    -- Action Type
    action_type VARCHAR(50) CHECK (action_type IN (
        'reclassified', 'entity_updated', 'confidence_adjusted',
        'rule_created', 'rule_updated', 'bulk_reclassified'
    )),

    -- What Was Changed
    affected_emails UUID[],
    affected_count INTEGER DEFAULT 0,
    changes_summary JSONB,

    -- Before/After Snapshots
    before_state JSONB,
    after_state JSONB,

    -- Approval Workflow
    is_approved BOOLEAN DEFAULT FALSE,
    approved_by VARCHAR(255),
    approved_at TIMESTAMP,
    rejection_reason TEXT,

    -- Metadata
    created_at TIMESTAMP DEFAULT NOW(),
    applied_at TIMESTAMP
);

CREATE INDEX idx_applications_feedback ON feedback_applications(feedback_id);
CREATE INDEX idx_applications_rule ON feedback_applications(rule_id);
CREATE INDEX idx_applications_type ON feedback_applications(action_type);
CREATE INDEX idx_applications_approval ON feedback_applications(is_approved);

COMMENT ON TABLE feedback_applications IS 'Track all AI actions taken based on user feedback for transparency and approval';

-- ============================================================================
-- 5. FEEDBACK IMPACT METRICS
-- ============================================================================

CREATE TABLE IF NOT EXISTS feedback_impact_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    feedback_id UUID NOT NULL REFERENCES classification_feedback(id) ON DELETE CASCADE,

    -- Impact Statistics
    emails_affected INTEGER DEFAULT 0,
    classifications_corrected INTEGER DEFAULT 0,
    entities_corrected INTEGER DEFAULT 0,
    rules_created INTEGER DEFAULT 0,

    -- Accuracy Metrics
    accuracy_improvement DECIMAL(5,2), -- Percentage improvement
    confidence_avg_before DECIMAL(5,2),
    confidence_avg_after DECIMAL(5,2),

    -- Before/After Metrics (JSONB for flexibility)
    before_metrics JSONB,
    after_metrics JSONB,

    -- Similar Emails Found
    similar_emails_found INTEGER DEFAULT 0,
    similar_emails_processed INTEGER DEFAULT 0,

    -- Metadata
    calculated_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_impact_feedback ON feedback_impact_metrics(feedback_id);
CREATE INDEX idx_impact_calculated ON feedback_impact_metrics(calculated_at DESC);

COMMENT ON TABLE feedback_impact_metrics IS 'Track the impact of each user feedback on classification accuracy and email processing';

-- ============================================================================
-- 6. UPDATE EXISTING TABLES (ADD FIELDS)
-- ============================================================================

-- Add manual review flag and explanation to document_classifications
ALTER TABLE document_classifications
ADD COLUMN IF NOT EXISTS is_manual_review BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS reviewed_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP,
ADD COLUMN IF NOT EXISTS review_explanation TEXT;

COMMENT ON COLUMN document_classifications.is_manual_review IS 'True if classification was manually reviewed/corrected';
COMMENT ON COLUMN document_classifications.review_explanation IS 'User explanation for classification decision';

-- Add manual review tracking to entity_extractions
ALTER TABLE entity_extractions
ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS verified_by VARCHAR(255),
ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP;

COMMENT ON COLUMN entity_extractions.is_verified IS 'True if entity was manually verified by user';

-- ============================================================================
-- 7. VIEWS FOR FEEDBACK ANALYTICS
-- ============================================================================

-- View: Pending feedback for review
CREATE OR REPLACE VIEW pending_feedback_queue AS
SELECT
    cf.id,
    cf.email_id,
    cf.feedback_type,
    cf.corrected_classification,
    cf.classification_explanation,
    cf.submitted_by,
    cf.submitted_at,
    re.subject as email_subject,
    re.sender_email,
    re.received_at as email_received_at,
    dc.document_type as current_classification,
    dc.confidence_score as current_confidence
FROM classification_feedback cf
JOIN raw_emails re ON re.id = cf.email_id
LEFT JOIN document_classifications dc ON dc.email_id = cf.email_id
WHERE cf.processing_status = 'pending'
ORDER BY cf.submitted_at DESC;

COMMENT ON VIEW pending_feedback_queue IS 'All pending feedback waiting for AI processing and approval';

-- View: Feedback impact summary
CREATE OR REPLACE VIEW feedback_impact_summary AS
SELECT
    cf.id as feedback_id,
    cf.feedback_type,
    cf.corrected_classification,
    cf.submitted_by,
    cf.submitted_at,
    cf.processing_status,
    fim.emails_affected,
    fim.classifications_corrected,
    fim.accuracy_improvement,
    fa.action_type,
    fa.is_approved,
    cr.rule_name,
    cr.is_active
FROM classification_feedback cf
LEFT JOIN feedback_impact_metrics fim ON fim.feedback_id = cf.id
LEFT JOIN feedback_applications fa ON fa.feedback_id = cf.id
LEFT JOIN classification_rules cr ON cr.id = fa.rule_id
WHERE cf.is_processed = TRUE
ORDER BY cf.submitted_at DESC;

COMMENT ON VIEW feedback_impact_summary IS 'Summary of all processed feedback and their impact on the system';

-- View: Classification accuracy over time
CREATE OR REPLACE VIEW classification_accuracy_trends AS
SELECT
    DATE(cf.submitted_at) as feedback_date,
    COUNT(*) as feedback_count,
    AVG(fim.accuracy_improvement) as avg_accuracy_improvement,
    SUM(fim.emails_affected) as total_emails_affected,
    COUNT(DISTINCT cf.submitted_by) as active_reviewers
FROM classification_feedback cf
LEFT JOIN feedback_impact_metrics fim ON fim.feedback_id = cf.id
WHERE cf.is_processed = TRUE
GROUP BY DATE(cf.submitted_at)
ORDER BY feedback_date DESC;

COMMENT ON VIEW classification_accuracy_trends IS 'Daily trends of classification accuracy improvements from feedback';

-- ============================================================================
-- 8. FUNCTIONS FOR FEEDBACK PROCESSING
-- ============================================================================

-- Function: Submit classification feedback
CREATE OR REPLACE FUNCTION submit_classification_feedback(
    p_email_id UUID,
    p_corrected_classification VARCHAR(100),
    p_explanation TEXT,
    p_pattern_description TEXT DEFAULT NULL,
    p_submitted_by VARCHAR(255) DEFAULT 'manual_review'
)
RETURNS UUID AS $$
DECLARE
    v_feedback_id UUID;
    v_original_classification VARCHAR(100);
BEGIN
    -- Get current classification
    SELECT document_type INTO v_original_classification
    FROM document_classifications
    WHERE email_id = p_email_id
    ORDER BY classified_at DESC
    LIMIT 1;

    -- Insert feedback
    INSERT INTO classification_feedback (
        email_id,
        feedback_type,
        original_classification,
        corrected_classification,
        classification_explanation,
        pattern_description,
        submitted_by,
        processing_status
    ) VALUES (
        p_email_id,
        'classification_correction',
        v_original_classification,
        p_corrected_classification,
        p_explanation,
        p_pattern_description,
        p_submitted_by,
        'pending'
    )
    ON CONFLICT (email_id, submitted_by, feedback_type)
    DO UPDATE SET
        corrected_classification = EXCLUDED.corrected_classification,
        classification_explanation = EXCLUDED.classification_explanation,
        pattern_description = EXCLUDED.pattern_description,
        updated_at = NOW()
    RETURNING id INTO v_feedback_id;

    -- Update the classification with manual review flag
    UPDATE document_classifications
    SET
        is_manual_review = TRUE,
        reviewed_by = p_submitted_by,
        reviewed_at = NOW(),
        review_explanation = p_explanation,
        document_type = p_corrected_classification,
        confidence_score = 100.00
    WHERE email_id = p_email_id;

    RETURN v_feedback_id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION submit_classification_feedback IS 'Submit user feedback for classification correction with explanation';

-- Function: Get feedback statistics
CREATE OR REPLACE FUNCTION get_feedback_statistics()
RETURNS TABLE (
    total_feedback_count BIGINT,
    pending_count BIGINT,
    processed_count BIGINT,
    total_emails_affected BIGINT,
    avg_accuracy_improvement DECIMAL(5,2),
    active_rules_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COUNT(*)::BIGINT as total_feedback_count,
        COUNT(*) FILTER (WHERE processing_status = 'pending')::BIGINT as pending_count,
        COUNT(*) FILTER (WHERE is_processed = TRUE)::BIGINT as processed_count,
        COALESCE(SUM(fim.emails_affected), 0)::BIGINT as total_emails_affected,
        COALESCE(AVG(fim.accuracy_improvement), 0)::DECIMAL(5,2) as avg_accuracy_improvement,
        (SELECT COUNT(*)::BIGINT FROM classification_rules WHERE is_active = TRUE) as active_rules_count
    FROM classification_feedback cf
    LEFT JOIN feedback_impact_metrics fim ON fim.feedback_id = cf.id;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_feedback_statistics IS 'Get comprehensive statistics about feedback system performance';

-- ============================================================================
-- 9. TRIGGERS FOR AUTO-UPDATING TIMESTAMPS
-- ============================================================================

-- Trigger function for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Add triggers to relevant tables
CREATE TRIGGER update_classification_feedback_updated_at
    BEFORE UPDATE ON classification_feedback
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_classification_rules_updated_at
    BEFORE UPDATE ON classification_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_feedback_impact_metrics_updated_at
    BEFORE UPDATE ON feedback_impact_metrics
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- 10. SAMPLE DATA (OPTIONAL - FOR TESTING)
-- ============================================================================

-- Insert sample feedback (commented out - uncomment for testing)
-- INSERT INTO classification_feedback (email_id, feedback_type, original_classification, corrected_classification, classification_explanation, submitted_by)
-- SELECT
--     id,
--     'classification_correction',
--     'unknown',
--     'booking_confirmation',
--     'Email contains booking number and ETD, clearly a booking confirmation',
--     'admin'
-- FROM raw_emails
-- WHERE processing_status = 'processed'
-- LIMIT 1;

-- ============================================================================
-- COMPLETION
-- ============================================================================

COMMIT;

-- Verify migration
SELECT
    'Migration 003 completed successfully!' as status,
    COUNT(*) FILTER (WHERE table_name = 'classification_feedback') as feedback_table_created,
    COUNT(*) FILTER (WHERE table_name = 'entity_feedback') as entity_feedback_table_created,
    COUNT(*) FILTER (WHERE table_name = 'classification_rules') as rules_table_created,
    COUNT(*) FILTER (WHERE table_name = 'feedback_applications') as applications_table_created,
    COUNT(*) FILTER (WHERE table_name = 'feedback_impact_metrics') as metrics_table_created
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('classification_feedback', 'entity_feedback', 'classification_rules', 'feedback_applications', 'feedback_impact_metrics');
