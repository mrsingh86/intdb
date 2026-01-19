require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function createTable() {
  console.log('Creating shipment_workflow_events table...\n');

  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      -- Drop if exists (for clean recreation)
      DROP TABLE IF EXISTS shipment_workflow_events;

      -- Create the table
      CREATE TABLE shipment_workflow_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
        workflow_state VARCHAR(50) NOT NULL,
        document_id UUID REFERENCES shipment_documents(id) ON DELETE SET NULL,
        email_id VARCHAR(200),
        occurred_at TIMESTAMP WITH TIME ZONE,
        document_type VARCHAR(50),
        email_direction VARCHAR(20),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(shipment_id, workflow_state, document_id)
      );

      -- Create indexes
      CREATE INDEX idx_workflow_events_shipment ON shipment_workflow_events(shipment_id);
      CREATE INDEX idx_workflow_events_state ON shipment_workflow_events(workflow_state);
      CREATE INDEX idx_workflow_events_occurred ON shipment_workflow_events(occurred_at);
      CREATE INDEX idx_workflow_events_doc ON shipment_workflow_events(document_id);

      -- Add comment
      COMMENT ON TABLE shipment_workflow_events IS 'Tracks all workflow state transitions for each shipment based on document evidence';
    `
  });

  if (error) {
    console.log('RPC not available, trying direct SQL via REST...');
    // Try alternative approach - check if table exists
    const { data: existing } = await supabase
      .from('shipment_workflow_events')
      .select('id')
      .limit(1);

    if (existing !== null) {
      console.log('Table already exists!');
      return true;
    }

    console.log('Error:', error.message);
    console.log('\nPlease run this SQL in Supabase SQL Editor:');
    console.log(`
CREATE TABLE IF NOT EXISTS shipment_workflow_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  workflow_state VARCHAR(50) NOT NULL,
  document_id UUID REFERENCES shipment_documents(id) ON DELETE SET NULL,
  email_id VARCHAR(200),
  occurred_at TIMESTAMP WITH TIME ZONE,
  document_type VARCHAR(50),
  email_direction VARCHAR(20),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(shipment_id, workflow_state, document_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_events_shipment ON shipment_workflow_events(shipment_id);
CREATE INDEX IF NOT EXISTS idx_workflow_events_state ON shipment_workflow_events(workflow_state);
CREATE INDEX IF NOT EXISTS idx_workflow_events_occurred ON shipment_workflow_events(occurred_at);
CREATE INDEX IF NOT EXISTS idx_workflow_events_doc ON shipment_workflow_events(document_id);
    `);
    return false;
  }

  console.log('Table created successfully!');
  return true;
}

createTable().catch(console.error);
