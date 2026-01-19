#!/usr/bin/env npx tsx
/**
 * Run Insight Engine Migration
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
);

async function runMigration() {
  console.log('Running Insight Engine Migration...\n');

  // Create tables one by one
  const statements = [
    // 1. Create insight_patterns table
    `CREATE TABLE IF NOT EXISTS insight_patterns (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pattern_code VARCHAR(100) UNIQUE NOT NULL,
      category VARCHAR(50) NOT NULL,
      name VARCHAR(200) NOT NULL,
      description TEXT,
      severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
      check_function TEXT,
      priority_boost INTEGER DEFAULT 0,
      enabled BOOLEAN DEFAULT true,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )`,

    // 2. Create shipment_insights table
    `CREATE TABLE IF NOT EXISTS shipment_insights (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
      task_id UUID REFERENCES action_tasks(id) ON DELETE SET NULL,
      insight_type VARCHAR(50) NOT NULL,
      severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
      title VARCHAR(200) NOT NULL,
      description TEXT NOT NULL,
      recommended_action TEXT,
      source VARCHAR(20) NOT NULL CHECK (source IN ('rules', 'ai', 'hybrid')),
      pattern_id UUID REFERENCES insight_patterns(id) ON DELETE SET NULL,
      confidence DECIMAL(3,2) CHECK (confidence >= 0 AND confidence <= 1),
      supporting_data JSONB DEFAULT '{}',
      priority_boost INTEGER DEFAULT 0,
      boost_reason TEXT,
      status VARCHAR(30) DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'resolved', 'dismissed', 'expired')),
      acknowledged_at TIMESTAMP WITH TIME ZONE,
      acknowledged_by UUID,
      resolved_at TIMESTAMP WITH TIME ZONE,
      generated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      expires_at TIMESTAMP WITH TIME ZONE
    )`,

    // 3. Create insight_feedback table
    `CREATE TABLE IF NOT EXISTS insight_feedback (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      insight_id UUID REFERENCES shipment_insights(id) ON DELETE CASCADE,
      feedback_type VARCHAR(30) NOT NULL CHECK (feedback_type IN (
        'helpful', 'not_helpful', 'false_positive', 'saved_money', 'saved_time', 'prevented_issue'
      )),
      feedback_value JSONB DEFAULT '{}',
      notes TEXT,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      created_by UUID
    )`,

    // 4. Create insight_generation_log table
    `CREATE TABLE IF NOT EXISTS insight_generation_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shipment_id UUID REFERENCES shipments(id) ON DELETE CASCADE,
      generation_type VARCHAR(30) NOT NULL,
      rules_patterns_checked INTEGER,
      rules_patterns_matched INTEGER,
      ai_analysis_ran BOOLEAN DEFAULT false,
      ai_insights_generated INTEGER DEFAULT 0,
      started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      completed_at TIMESTAMP WITH TIME ZONE,
      duration_ms INTEGER,
      total_insights_generated INTEGER DEFAULT 0,
      priority_boost_applied INTEGER DEFAULT 0,
      error_message TEXT
    )`,

    // 5. Create indexes
    `CREATE INDEX IF NOT EXISTS idx_insights_shipment ON shipment_insights(shipment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_insights_task ON shipment_insights(task_id)`,
    `CREATE INDEX IF NOT EXISTS idx_insights_severity_status ON shipment_insights(severity, status)`,
    `CREATE INDEX IF NOT EXISTS idx_insights_generated_at ON shipment_insights(generated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_insights_source ON shipment_insights(source)`,
    `CREATE INDEX IF NOT EXISTS idx_patterns_category ON insight_patterns(category)`,
    `CREATE INDEX IF NOT EXISTS idx_feedback_insight ON insight_feedback(insight_id)`,
    `CREATE INDEX IF NOT EXISTS idx_feedback_type ON insight_feedback(feedback_type)`,
    `CREATE INDEX IF NOT EXISTS idx_generation_log_shipment ON insight_generation_log(shipment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_generation_log_date ON insight_generation_log(started_at DESC)`,
  ];

  for (const sql of statements) {
    try {
      const { error } = await supabase.rpc('exec_sql', { sql });
      if (error) {
        // Try using from() as fallback - this won't work but let's see the error
        console.log('Statement might need direct execution:', sql.substring(0, 50) + '...');
      }
    } catch (e) {
      // Continue - we'll seed the data which will tell us if tables exist
    }
  }

  // Seed patterns using upsert
  console.log('\nSeeding pattern definitions...');

  const patterns = [
    // Timeline Conflicts
    { pattern_code: 'vgm_after_cargo_cutoff', category: 'timeline', name: 'VGM After Cargo Cutoff', description: 'VGM cutoff date is after cargo cutoff - impossible timeline', severity: 'critical', priority_boost: 20 },
    { pattern_code: 'multiple_cutoffs_same_day', category: 'timeline', name: 'Multiple Cutoffs Same Day', description: '3+ cutoffs on the same day - high workload risk', severity: 'high', priority_boost: 10 },
    { pattern_code: 'si_cutoff_passed_no_si', category: 'timeline', name: 'SI Cutoff Passed Without SI', description: 'SI cutoff has passed but no SI document submitted', severity: 'critical', priority_boost: 25 },
    { pattern_code: 'cutoff_within_24h', category: 'timeline', name: 'Cutoff Within 24 Hours', description: 'A cutoff deadline is within 24 hours', severity: 'critical', priority_boost: 15 },
    { pattern_code: 'etd_before_cutoffs', category: 'timeline', name: 'ETD Before Cutoffs', description: 'ETD is before one or more cutoff dates - impossible timeline', severity: 'critical', priority_boost: 20 },

    // Stakeholder Signals
    { pattern_code: 'shipper_reliability_low', category: 'stakeholder', name: 'Low Shipper Reliability', description: 'Shipper reliability score below 60%', severity: 'high', priority_boost: 12 },
    { pattern_code: 'shipper_no_response_3d', category: 'stakeholder', name: 'Shipper No Response', description: 'No response from shipper in 3+ days', severity: 'medium', priority_boost: 8 },
    { pattern_code: 'carrier_high_rollover', category: 'stakeholder', name: 'High Carrier Rollover Rate', description: 'Carrier rolled over >25% of bookings on this route', severity: 'high', priority_boost: 15 },
    { pattern_code: 'consignee_low_reliability', category: 'stakeholder', name: 'Low Consignee Reliability', description: 'Consignee reliability score below 60%', severity: 'medium', priority_boost: 8 },
    { pattern_code: 'new_shipper_first_shipment', category: 'stakeholder', name: 'New Shipper First Shipment', description: 'First shipment with this shipper - extra attention needed', severity: 'medium', priority_boost: 5 },

    // Cross-Shipment Risks
    { pattern_code: 'consignee_capacity_risk', category: 'cross_shipment', name: 'Consignee Capacity Risk', description: 'Multiple shipments arriving to same consignee within 3 days', severity: 'high', priority_boost: 12 },
    { pattern_code: 'high_customer_exposure', category: 'cross_shipment', name: 'High Customer Exposure', description: 'Total exposure to customer exceeds $500K across active shipments', severity: 'high', priority_boost: 10 },
    { pattern_code: 'route_congestion', category: 'cross_shipment', name: 'Route Congestion', description: '10+ shipments arriving at same port this week', severity: 'medium', priority_boost: 5 },
    { pattern_code: 'shared_deadline_pressure', category: 'cross_shipment', name: 'Shared Deadline Pressure', description: 'Multiple shipments from same shipper with cutoffs on same day', severity: 'high', priority_boost: 10 },

    // Document Intelligence
    { pattern_code: 'missing_critical_doc', category: 'document', name: 'Missing Critical Document', description: 'Critical document missing for workflow stage', severity: 'critical', priority_boost: 20 },
    { pattern_code: 'high_amendment_frequency', category: 'document', name: 'High Amendment Frequency', description: '3+ amendments in last 7 days - unusual churn', severity: 'medium', priority_boost: 8 },
    { pattern_code: 'document_quality_critical', category: 'document', name: 'Critical Document Quality Issues', description: 'Document has critical quality issues or missing required fields', severity: 'high', priority_boost: 12 },
    { pattern_code: 'bl_not_released_near_eta', category: 'document', name: 'BL Not Released Near ETA', description: 'ETA within 3 days but BL not yet released', severity: 'critical', priority_boost: 18 },
    { pattern_code: 'si_draft_pending_review', category: 'document', name: 'SI Draft Pending Review', description: 'SI draft received but not reviewed within 24 hours', severity: 'high', priority_boost: 10 },

    // Financial Signals
    { pattern_code: 'payment_overdue_other', category: 'financial', name: 'Payment Overdue Other Shipment', description: 'Customer has overdue invoices on other shipments', severity: 'high', priority_boost: 12 },
    { pattern_code: 'demurrage_risk', category: 'financial', name: 'Demurrage Risk', description: 'Container at port 3+ days without delivery order', severity: 'critical', priority_boost: 20 },
    { pattern_code: 'detention_accruing', category: 'financial', name: 'Detention Accruing', description: 'Container held beyond free days', severity: 'high', priority_boost: 15 },
  ];

  const { data, error } = await supabase
    .from('insight_patterns')
    .upsert(patterns.map(p => ({ ...p, enabled: true })), { onConflict: 'pattern_code' })
    .select();

  if (error) {
    console.log('Error seeding patterns:', error.message);
    console.log('Tables might not exist. Please run migration via Supabase dashboard.');
    console.log('\nCopy this SQL to Supabase SQL Editor:');
    console.log('────────────────────────────────────');
    console.log('File: /database/migrations/020_insight_engine.sql');
  } else {
    console.log(`✅ Seeded ${data?.length || 0} patterns`);
  }
}

runMigration().catch(console.error);
