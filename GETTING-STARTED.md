# 🚀 Getting Started - Your First 30 Minutes

**Goal:** Customize INTDB with YOUR real data and see it in action

---

## ✅ Step 1: Add Your Real Customers (5 minutes)

Run this in Supabase SQL Editor:

```sql
-- Add your first real customer
INSERT INTO customers (
  customer_code,
  customer_name,
  customer_type,
  customer_segment,
  industry,
  primary_contact_email,
  primary_contact_phone,
  credit_limit,
  credit_days,
  status
) VALUES (
  'CUST001',                    -- Your customer code
  'Your Customer Name',         -- Customer name
  'direct',                     -- direct, freight_forwarder, nvocc
  'enterprise',                 -- enterprise, sme, startup
  'electronics',                -- Industry
  'contact@customer.com',       -- Email
  '+91-1234567890',            -- Phone
  1000000.00,                  -- Credit limit (INR)
  30,                          -- Payment terms (days)
  'active'                     -- Status
) RETURNING customer_code, customer_name, '✅ Customer added!' as status;

-- Add more customers (repeat with different codes)
```

---

## ✅ Step 2: Add Your Real Vendors (5 minutes)

```sql
-- Add your CHA (Custom House Agent)
INSERT INTO vendors (
  vendor_code,
  vendor_name,
  vendor_type,
  vendor_category,
  primary_contact_email,
  primary_contact_phone,
  payment_terms,
  credit_days,
  status
) VALUES (
  'VEN-CHA-001',
  'Your CHA Name',
  'cha',                       -- cha, trucker, carrier, warehouse
  'customs',                   -- customs, ocean_freight, road_transport
  'contact@cha.com',
  '+91-1234567890',
  'Net 30',
  30,
  'active'
) RETURNING vendor_code, vendor_name, '✅ Vendor added!' as status;

-- Add your trucker
INSERT INTO vendors (
  vendor_code, vendor_name, vendor_type, vendor_category,
  primary_contact_email, status
) VALUES (
  'VEN-TRUCK-001',
  'Your Trucking Company',
  'trucker',
  'road_transport',
  'contact@trucker.com',
  'active'
) RETURNING vendor_code, vendor_name, '✅ Vendor added!' as status;
```

---

## ✅ Step 3: Add Your Shippers & Consignees (5 minutes)

```sql
-- Add a shipper (exporter)
INSERT INTO parties (
  party_code,
  party_name,
  party_type,
  contact_email,
  contact_phone,
  address_line1,
  city,
  state,
  country,
  postal_code,
  tax_id,
  iec_code,
  status
) VALUES (
  'SHIP-001',
  'Your Shipper Company Name',
  'shipper',                   -- shipper, consignee, notify_party, both
  'export@shipper.com',
  '+91-1234567890',
  '123 Industrial Area',
  'Mumbai',
  'Maharashtra',
  'India',
  '400001',
  'GST1234567890',
  'IEC1234567890',
  'active'
) RETURNING party_code, party_name, party_type, '✅ Party added!' as status;

-- Add a consignee (importer)
INSERT INTO parties (
  party_code, party_name, party_type,
  contact_email, city, country, status
) VALUES (
  'CONS-001',
  'Your Consignee Company Name',
  'consignee',
  'import@consignee.com',
  'Los Angeles',
  'USA',
  'active'
) RETURNING party_code, party_name, party_type, '✅ Party added!' as status;
```

---

## ✅ Step 4: Add Your Carriers (If Not Already Configured) (3 minutes)

```sql
-- Check existing carriers
SELECT id, carrier_name, enabled FROM carrier_configs;

-- Add a new carrier if needed
INSERT INTO carrier_configs (
  id,
  carrier_name,
  email_sender_patterns,
  booking_number_regex,
  container_number_prefix,
  enabled
) VALUES (
  'one',                                    -- Carrier ID (lowercase, no spaces)
  'Ocean Network Express (ONE)',
  ARRAY['@one-line.com'],
  '^[A-Z]{3}[0-9]{10}$',                   -- Adjust to carrier's format
  ARRAY['ONEU'],                           -- Container prefix
  true
) RETURNING id, carrier_name, '✅ Carrier added!' as status;
```

---

## ✅ Step 5: Add Your Document Types (3 minutes)

```sql
-- Check existing document types
SELECT document_type, display_name FROM document_type_configs;

-- Add a custom document type
INSERT INTO document_type_configs (
  document_type,
  display_name,
  document_category,
  email_subject_patterns,
  content_keywords,
  min_confidence_auto_classify,
  processing_priority,
  enabled
) VALUES (
  'shipping_bill',                         -- Unique ID
  'Shipping Bill',                         -- Display name
  'customs',                               -- shipping, customs, financial, operational
  ARRAY['shipping bill', 'SB no', 'customs declaration'],
  ARRAY['shipping bill number', 'customs', 'export declaration', 'let export order'],
  85.00,                                   -- Auto-classify if 85%+ confidence
  8,                                       -- Priority 1-10 (10 = highest)
  true
) RETURNING document_type, display_name, '✅ Document type added!' as status;
```

---

## ✅ Step 6: Create Your First Real Shipment (5 minutes)

```sql
-- Create a real shipment
INSERT INTO shipments (
  shipment_number,
  booking_number,
  house_bl_number,
  shipment_mode,
  shipment_type,
  service_type,
  status,
  customer_id_fk,
  carrier_id,
  carrier_name,
  vessel_name,
  voyage_number,
  etd,
  eta,
  port_of_loading_code,
  port_of_loading_name,
  port_of_discharge_code,
  port_of_discharge_name,
  commodity,
  container_count,
  lifecycle_stage
)
SELECT
  'SHP-2025-001',                          -- Your shipment number
  'MAEU1234567890',                        -- Carrier booking number
  'INTGL001234',                           -- Your HBL number
  'sea',                                   -- sea, air, land
  'FCL',                                   -- FCL, LCL, AIR, FTL, LTL
  'export',                                -- export, import, cross_trade
  'booked',                                -- draft, booked, in_transit, arrived, delivered
  c.id,                                    -- Link to customer
  'maersk',
  'Maersk',
  'MAERSK ESSEX',
  '225W',
  '2025-02-15'::date,                      -- ETD
  '2025-03-20'::date,                      -- ETA
  'INNSA',
  'Nhava Sheva',
  'USLAX',
  'Los Angeles',
  'Electronics',
  2,                                       -- Number of containers
  'active'
FROM customers c
WHERE c.customer_code = 'CUST001'          -- Use your customer code
LIMIT 1
RETURNING shipment_number, booking_number, status, '✅ Shipment created!' as status;
```

---

## ✅ Step 7: Add Container Details (3 minutes)

```sql
-- Add containers to your shipment
INSERT INTO shipment_containers (
  shipment_id,
  container_number,
  container_type,
  container_size,
  seal_number,
  vgm_weight_kg,
  status,
  free_days
)
SELECT
  s.id,
  'MAEU1234567',                           -- Container number
  '40HC',                                  -- 20GP, 40GP, 40HC, 40RF
  40,
  'SEAL123456',
  25000.00,                                -- VGM weight
  'booked',
  14                                       -- Free days
FROM shipments s
WHERE s.shipment_number = 'SHP-2025-001'
LIMIT 1
RETURNING container_number, container_type, status, '✅ Container added!' as status;
```

---

## ✅ Step 8: View Your Data (2 minutes)

```sql
-- View your complete shipment
SELECT
  s.shipment_number,
  s.booking_number,
  s.house_bl_number,
  c.customer_name,
  s.carrier_name,
  s.etd,
  s.eta,
  s.status,
  s.port_of_loading_code || ' → ' || s.port_of_discharge_code as route,
  s.container_count
FROM shipments s
LEFT JOIN customers c ON c.id = s.customer_id_fk
WHERE s.shipment_number = 'SHP-2025-001';

-- View containers
SELECT
  container_number,
  container_type,
  seal_number,
  status
FROM shipment_containers sc
JOIN shipments s ON s.id = sc.shipment_id
WHERE s.shipment_number = 'SHP-2025-001';

-- View your customers
SELECT customer_code, customer_name, customer_type, industry
FROM customers
ORDER BY created_at DESC;

-- View your vendors
SELECT vendor_code, vendor_name, vendor_type, vendor_category
FROM vendors
ORDER BY created_at DESC;
```

---

## 🎉 Congratulations!

You've just:
✅ Added your real customers
✅ Added your real vendors (CHA, truckers)
✅ Added shippers and consignees
✅ Created your first shipment
✅ Added container details

---

## 🚀 What's Next?

### **Option A: Test Email Processing (Manual)**

```sql
-- Simulate receiving an email
INSERT INTO raw_emails (
  gmail_message_id,
  sender_email,
  subject,
  body_text,
  received_at,
  processing_status
) VALUES (
  'real-email-' || EXTRACT(EPOCH FROM NOW())::text,
  'booking@maersk.com',
  'Booking Confirmation - ' || 'MAEU1234567890',  -- Your booking number
  'Your booking has been confirmed...',
  NOW(),
  'pending'
) RETURNING id, subject, '✅ Test email created!' as status;

-- Manually classify it (before AI agent is built)
INSERT INTO document_classifications (
  email_id,
  document_type,
  confidence_score,
  model_name,
  model_version,
  classification_reason
)
SELECT
  re.id,
  'booking_confirmation',
  100.00,
  'manual',
  '1.0',
  'Manually classified for testing'
FROM raw_emails re
WHERE re.gmail_message_id LIKE 'real-email-%'
ORDER BY re.created_at DESC
LIMIT 1
RETURNING document_type, confidence_score, '✅ Email classified!' as status;

-- Extract entities (manual for now)
INSERT INTO entity_extractions (
  email_id,
  entity_type,
  entity_value,
  confidence_score,
  extraction_method
)
SELECT
  re.id,
  'booking_number',
  'MAEU1234567890',                        -- Your booking number
  100.00,
  'manual'
FROM raw_emails re
WHERE re.gmail_message_id LIKE 'real-email-%'
ORDER BY re.created_at DESC
LIMIT 1
RETURNING entity_type, entity_value, '✅ Entity extracted!' as status;

-- Link to shipment (manual for now)
INSERT INTO shipment_link_candidates (
  email_id,
  shipment_id,
  confidence_score,
  matching_entities,
  linking_reason,
  link_status
)
SELECT
  re.id,
  s.id,
  100.00,
  '{"booking_number": "MAEU1234567890"}'::jsonb,
  'Manual link for testing',
  'confirmed'
FROM raw_emails re
CROSS JOIN shipments s
WHERE re.gmail_message_id LIKE 'real-email-%'
  AND s.shipment_number = 'SHP-2025-001'
ORDER BY re.created_at DESC
LIMIT 1
RETURNING confidence_score, link_status, '✅ Email linked to shipment!' as status;
```

### **Option B: Build AI Agents (Recommended)**

**Next file to read:** `~/intdb/FREIGHT-INTELLIGENCE-README.md`

This has complete TypeScript examples for:
1. EmailIngestionAgent (fetch from Gmail)
2. ClassificationAgent (AI classification)
3. ExtractionAgent (AI data extraction)
4. LinkingAgent (intelligent shipment linking)

---

## 📊 Quick Dashboard Queries

```sql
-- Active shipments summary
SELECT
  COUNT(*) as total_active,
  COUNT(*) FILTER (WHERE status = 'booked') as booked,
  COUNT(*) FILTER (WHERE status = 'in_transit') as in_transit,
  COUNT(*) FILTER (WHERE etd < CURRENT_DATE) as sailed,
  COUNT(*) FILTER (WHERE eta < CURRENT_DATE) as arrived
FROM shipments
WHERE lifecycle_stage = 'active';

-- Customer summary
SELECT
  COUNT(*) as total_customers,
  COUNT(*) FILTER (WHERE status = 'active') as active,
  SUM(total_shipments) as total_shipments,
  SUM(total_revenue) as total_revenue
FROM customers;

-- Vendor summary by type
SELECT
  vendor_type,
  COUNT(*) as count,
  AVG(performance_rating) as avg_rating
FROM vendors
WHERE status = 'active'
GROUP BY vendor_type;
```

---

## 💡 Pro Tips

### **Batch Add Data:**

Use this template to add multiple records at once:

```sql
INSERT INTO customers (customer_code, customer_name, customer_type, status)
VALUES
  ('CUST001', 'Customer One', 'direct', 'active'),
  ('CUST002', 'Customer Two', 'direct', 'active'),
  ('CUST003', 'Customer Three', 'freight_forwarder', 'active');
```

### **Import from CSV:**

If you have customer data in Excel/CSV:

1. Export CSV from Excel
2. In Supabase Table Editor: https://fdmcdbvkfdmrdowfjrcz.supabase.com/project/_/editor
3. Select `customers` table
4. Click "Insert" → "Insert from CSV"
5. Upload your CSV

---

## 🎯 Your Roadmap

**Week 1:** Add all real data (customers, vendors, parties)
**Week 2:** Build EmailIngestionAgent (fetch emails from Gmail)
**Week 3:** Build ClassificationAgent (AI classification)
**Week 4:** Build ExtractionAgent & LinkingAgent
**Week 5:** Create dashboards
**Week 6:** Deploy to production, train team

---

**You're ready to customize! Start adding your real data now.** 🚀
