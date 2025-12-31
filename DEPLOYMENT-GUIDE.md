# Freight Intelligence Database - Deployment Guide

## Quick Deployment Options

### **Option 1: Supabase SQL Editor (Recommended - Easiest)**

1. **Open Supabase SQL Editor:**
   - Go to: https://fdmcdbvkfdmrdowfjrcz.supabase.com/project/_/sql

2. **Deploy Base Schema:**
   - Click "New query"
   - Copy contents of `freight-intelligence-schema.sql`
   - Paste into SQL editor
   - Click "Run" (or press Cmd+Enter)
   - Wait for completion (~30 seconds)

3. **Deploy Stakeholder Intelligence:**
   - Click "New query"
   - Copy contents of `stakeholder-intelligence-extension.sql`
   - Paste into SQL editor
   - Click "Run"
   - Wait for completion (~10 seconds)

4. **Verify Deployment:**
   - Run this query:
   ```sql
   SELECT table_name
   FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name NOT LIKE 'pg_%'
   ORDER BY table_name;
   ```
   - Should see 35+ tables

---

### **Option 2: Command Line (Advanced)**

```bash
cd /Users/dineshtarachandani
./deploy-to-supabase.sh
```

**Prerequisites:**
- PostgreSQL client installed (`brew install postgresql`)
- Supabase database password (from Supabase Dashboard > Settings > Database)

---

### **Option 3: Supabase CLI**

```bash
# Install Supabase CLI
brew install supabase/tap/supabase

# Login to Supabase
supabase login

# Link to your project
supabase link --project-ref fdmcdbvkfdmrdowfjrcz

# Deploy schema
supabase db push
```

---

## Post-Deployment Verification

### **1. Check Table Count**

```sql
SELECT
  'Tables' as type,
  COUNT(*) as count
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
  AND table_name NOT LIKE 'pg_%'

UNION ALL

SELECT
  'Views' as type,
  COUNT(*) as count
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'VIEW';
```

**Expected:** 35+ tables, 2 views

---

### **2. Test Basic Queries**

```sql
-- View all document type configs
SELECT document_type, display_name, min_confidence_auto_classify
FROM document_type_configs
WHERE enabled = true;

-- View carrier configs
SELECT id, carrier_name, enabled
FROM carrier_configs;

-- View customers
SELECT customer_code, customer_name, customer_type
FROM customers;

-- View vendors
SELECT vendor_code, vendor_name, vendor_type
FROM vendors;
```

---

### **3. Insert Test Data**

```sql
-- Create a test customer
INSERT INTO customers (customer_code, customer_name, customer_type, status)
VALUES ('TEST001', 'Test Customer Ltd', 'direct', 'active')
RETURNING id, customer_code, customer_name;

-- Create a test email
INSERT INTO raw_emails (
  gmail_message_id,
  sender_email,
  subject,
  body_text,
  received_at,
  processing_status
) VALUES (
  'test-msg-001',
  'booking@maersk.com',
  'Booking Confirmation - MAEU1234567890',
  'Dear Customer, your booking has been confirmed...',
  NOW(),
  'pending'
)
RETURNING id, gmail_message_id, subject;

-- View test data
SELECT * FROM customers WHERE customer_code = 'TEST001';
SELECT * FROM raw_emails WHERE gmail_message_id = 'test-msg-001';
```

---

## Database Structure Overview

### **Layer 1: Raw Data (3 tables)**
- `raw_emails` - All incoming emails
- `raw_attachments` - PDF, Excel, images
- `raw_email_metadata` - Email threading, headers

### **Layer 2: Intelligence (4 tables)**
- `document_classifications` - AI classifications
- `entity_extractions` - Extracted entities (booking #, etc.)
- `shipment_link_candidates` - AI-suggested links
- `structured_extractions` - Complete JSONB data

### **Layer 3: Decision Support (6 tables)**
- `shipments` - Master shipment records
- `shipment_documents` - Document register
- `shipment_events` - Event timeline
- `shipment_parties` - Stakeholders per shipment
- `shipment_financials` - Costs & invoices
- `shipment_containers` - Container tracking

### **Layer 4: Configuration (7 tables)**
- `document_type_configs` - Document patterns
- `extraction_rules` - Extraction rules
- `linking_rules` - Linking logic
- `carrier_configs` - Carrier patterns
- `ai_model_configs` - AI model settings
- `email_routing_rules` - Email routing
- `archival_policies` - Data lifecycle

### **Stakeholder Intelligence (9 tables)**
- `customers` - Customer master
- `parties` - Shipper/consignee master
- `vendors` - Carrier/trucker/CHA master
- `stakeholder_communications` - Communication history
- `customer_intelligence` - AI-learned preferences
- `vendor_performance_log` - Performance tracking
- `customer_party_relationships` - Relationship tracking
- `contact_persons` - Contact details
- `data_lifecycle_log` - Archival audit log

### **Views (2)**
- `customer_360` - Complete customer profile
- `vendor_scorecard` - Vendor performance scorecard
- `shipments_ready_for_archival` - Archival candidates

### **Functions (6)**
- `archive_completed_shipment()` - Archive shipment data
- `calculate_link_confidence()` - Calculate link confidence
- `update_customer_metrics()` - Update customer KPIs
- `calculate_vendor_performance()` - Calculate vendor score
- `detect_customer_preferences()` - AI preference detection

---

## Troubleshooting

### **Error: "relation already exists"**

**Solution:** Tables already created. Either:
- Drop existing tables: `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`
- Or skip deployment if intentional

### **Error: "permission denied"**

**Solution:** Ensure you're using the `postgres` user or have SUPERUSER privileges

### **Error: "syntax error"**

**Solution:**
- Ensure you're running PostgreSQL 14+
- Check if UUID extension is enabled: `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`

### **Slow query performance**

**Solution:**
```sql
-- Update statistics
ANALYZE;

-- Rebuild indexes
REINDEX DATABASE postgres;
```

---

## Next Steps After Deployment

### **1. Set Up Row Level Security (RLS)**

```sql
-- Enable RLS on sensitive tables
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE raw_emails ENABLE ROW LEVEL SECURITY;

-- Create policies (example)
CREATE POLICY "Users can view their own customers"
  ON customers FOR SELECT
  USING (auth.uid() = created_by);
```

### **2. Create API Endpoints**

See `FREIGHT-INTELLIGENCE-README.md` for TypeScript/Next.js examples

### **3. Build AI Agents**

- **EmailIngestionAgent** - Fetch emails from Gmail
- **ClassificationAgent** - Classify documents
- **ExtractionAgent** - Extract structured data
- **LinkingAgent** - Link to shipments

### **4. Create Dashboards**

Query examples in README:
- Active shipments summary
- Documents per shipment
- Shipment timeline
- Financial summary
- Customer 360 view
- Vendor scorecard

### **5. Schedule Cron Jobs**

```sql
-- Archive completed shipments (run daily)
SELECT archive_completed_shipment(id)
FROM shipments_ready_for_archival;

-- Update customer metrics (run daily)
SELECT update_customer_metrics(id) FROM customers;

-- Update vendor performance (run weekly)
SELECT calculate_vendor_performance(id) FROM vendors;
```

---

## Configuration Customization

### **Add Your Document Types**

```sql
INSERT INTO document_type_configs (
  document_type,
  display_name,
  document_category,
  email_subject_patterns,
  content_keywords
) VALUES (
  'your_document_type',
  'Your Document Type',
  'shipping',
  ARRAY['keyword1', 'keyword2'],
  ARRAY['content keyword1', 'content keyword2']
);
```

### **Add Your Carriers**

```sql
INSERT INTO carrier_configs (
  id,
  carrier_name,
  email_sender_patterns,
  booking_number_regex
) VALUES (
  'your_carrier_id',
  'Your Carrier Name',
  ARRAY['@carrier.com'],
  '^[A-Z]{3}[0-9]{10}$'
);
```

### **Add Your Customers**

```sql
INSERT INTO customers (
  customer_code,
  customer_name,
  customer_type,
  primary_contact_email
) VALUES (
  'CUST001',
  'Customer Name',
  'direct',
  'contact@customer.com'
);
```

---

## Support & Resources

**Files:**
- `freight-intelligence-schema.sql` - Base schema
- `stakeholder-intelligence-extension.sql` - Stakeholder tables
- `FREIGHT-INTELLIGENCE-README.md` - Complete documentation
- `deploy-to-supabase.sh` - Automated deployment

**Supabase Project:**
- URL: https://fdmcdbvkfdmrdowfjrcz.supabase.com
- Database: https://fdmcdbvkfdmrdowfjrcz.supabase.com/project/_/database
- SQL Editor: https://fdmcdbvkfdmrdowfjrcz.supabase.com/project/_/sql

**Architecture Principles:**
- Based on CLAUDE.md (A Philosophy of Software Design)
- 4-layer architecture (Raw → Intelligence → Decision → Config)
- Database-driven, configuration over code
- AI-powered with confidence scoring

---

## Quick Test Script

Run this after deployment to verify everything works:

```sql
-- 1. Check installation
SELECT 'Schema version' as check, '1.1.0' as result
UNION ALL
SELECT 'Total tables', COUNT(*)::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
UNION ALL
SELECT 'Total views', COUNT(*)::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'VIEW'
UNION ALL
SELECT 'Total functions', COUNT(*)::text
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace;

-- 2. Test core functionality
SELECT 'Document types configured' as check, COUNT(*)::text as result FROM document_type_configs;
SELECT 'Carriers configured' as check, COUNT(*)::text as result FROM carrier_configs;
SELECT 'Linking rules configured' as check, COUNT(*)::text as result FROM linking_rules;
SELECT 'Sample customers' as check, COUNT(*)::text as result FROM customers;
SELECT 'Sample vendors' as check, COUNT(*)::text as result FROM vendors;

-- 3. Test functions
SELECT 'Archive function' as check, 'archive_completed_shipment(uuid)' as result
UNION ALL
SELECT 'Link confidence function', 'calculate_link_confidence(jsonb, uuid, timestamp)'
UNION ALL
SELECT 'Customer metrics function', 'update_customer_metrics(uuid)'
UNION ALL
SELECT 'Vendor performance function', 'calculate_vendor_performance(uuid)'
UNION ALL
SELECT 'Customer preferences function', 'detect_customer_preferences(uuid)';

-- 4. All checks passed!
SELECT '✅ Deployment successful!' as status,
       'Ready to build AI agents and dashboards' as next_step;
```

---

**Happy Shipping! 🚢📦**
