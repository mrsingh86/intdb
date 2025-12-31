# 🚀 Next Steps - Building Your AI Agents

**Congratulations!** Your freight intelligence database is fully operational with:

✅ 7 customers
✅ 7 vendors (carriers, CHAs, truckers)
✅ 4 parties (shippers, consignees)
✅ 1 complete shipment with containers and timeline
✅ 8 document types configured
✅ 4 carriers with email patterns
✅ AI models ready to process

---

## 🎯 Your Roadmap (Next 2 Weeks)

### **Week 1: Test & Build Foundation**

#### **Day 1-2: Test Email Processing Manually**
Before building AI agents, test the flow manually to understand it.

**Run this in Supabase SQL Editor:**

```sql
-- ============================================================================
-- MANUAL EMAIL PROCESSING TEST
-- ============================================================================

-- STEP 1: Simulate receiving a booking confirmation email
INSERT INTO raw_emails (
  gmail_message_id,
  sender_email,
  sender_name,
  subject,
  body_text,
  received_at,
  processing_status
) VALUES (
  'manual-test-' || EXTRACT(EPOCH FROM NOW())::text,
  'booking@maersk.com',
  'Maersk Line',
  'Booking Confirmation - MAEU9876543210',
  E'Dear Customer,\n\nYour booking has been confirmed.\n\nBooking Number: MAEU9876543210\nVessel: MAERSK ESSEX\nVoyage: 225W\nETD: 2025-02-15\nETA: 2025-03-20\nPort of Loading: INNSA (Nhava Sheva)\nPort of Discharge: USLAX (Los Angeles)\nContainer: MAEU1234567 (40HC)\n\nBest regards,\nMaersk Line',
  NOW(),
  'pending'
) RETURNING id, subject, '✅ Step 1: Email captured!' as status;

-- STEP 2: Classify the document (manual, before AI)
INSERT INTO document_classifications (
  email_id,
  document_type,
  confidence_score,
  model_name,
  model_version,
  classification_reason,
  matched_patterns
)
SELECT
  re.id,
  'booking_confirmation',
  95.00,
  'manual',
  '1.0',
  'Subject contains "Booking Confirmation", sender is @maersk.com',
  '{"subject": ["booking", "confirmation"], "sender": ["maersk.com"]}'::jsonb
FROM raw_emails re
WHERE re.gmail_message_id LIKE 'manual-test-%'
ORDER BY re.created_at DESC
LIMIT 1
RETURNING document_type, confidence_score, '✅ Step 2: Classified!' as status;

-- STEP 3: Extract entities
INSERT INTO entity_extractions (
  email_id,
  entity_type,
  entity_value,
  entity_normalized,
  confidence_score,
  extraction_method
)
SELECT
  re.id,
  entity_type,
  entity_value,
  entity_normalized,
  confidence,
  'manual'
FROM raw_emails re
CROSS JOIN (VALUES
  ('booking_number', 'MAEU9876543210', 'MAEU9876543210', 98.00),
  ('container_number', 'MAEU1234567', 'MAEU1234567', 95.00),
  ('vessel_name', 'MAERSK ESSEX', 'MAERSK ESSEX', 99.00),
  ('voyage_number', '225W', '225W', 99.00),
  ('etd', '2025-02-15', '2025-02-15', 90.00),
  ('eta', '2025-03-20', '2025-03-20', 90.00),
  ('port_of_loading', 'INNSA', 'INNSA', 95.00),
  ('port_of_discharge', 'USLAX', 'USLAX', 95.00)
) AS entities(entity_type, entity_value, entity_normalized, confidence)
WHERE re.gmail_message_id LIKE 'manual-test-%'
ORDER BY re.created_at DESC
LIMIT 1
RETURNING entity_type, entity_value, '✅ Step 3: Entity extracted!' as status;

-- STEP 4: Extract complete structured data
INSERT INTO structured_extractions (
  email_id,
  extracted_data,
  confidence_score,
  model_name,
  model_version
)
SELECT
  re.id,
  '{
    "booking_number": "MAEU9876543210",
    "vessel_name": "MAERSK ESSEX",
    "voyage_number": "225W",
    "etd": "2025-02-15",
    "eta": "2025-03-20",
    "port_of_loading": "INNSA",
    "port_of_loading_name": "Nhava Sheva",
    "port_of_discharge": "USLAX",
    "port_of_discharge_name": "Los Angeles",
    "container_number": "MAEU1234567",
    "container_type": "40HC"
  }'::jsonb,
  88.50,
  'manual',
  '1.0'
FROM raw_emails re
WHERE re.gmail_message_id LIKE 'manual-test-%'
ORDER BY re.created_at DESC
LIMIT 1
RETURNING confidence_score, '✅ Step 4: Structured data extracted!' as status;

-- STEP 5: Find matching shipment and link
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
  95.00,
  '{"booking_number": "MAEU9876543210"}'::jsonb,
  'Exact booking number match',
  'confirmed'
FROM raw_emails re
CROSS JOIN shipments s
WHERE re.gmail_message_id LIKE 'manual-test-%'
  AND s.shipment_number = 'SHP-2025-001'
ORDER BY re.created_at DESC
LIMIT 1
RETURNING confidence_score, link_status, '✅ Step 5: Linked to shipment!' as status;

-- STEP 6: Create shipment document record
INSERT INTO shipment_documents (
  shipment_id,
  document_type,
  document_category,
  document_direction,
  document_date,
  source_email_id,
  source_classification_id,
  sender,
  status,
  is_latest_version
)
SELECT
  s.id,
  'booking_confirmation',
  'shipping',
  'received',
  CURRENT_DATE,
  re.id,
  dc.id,
  re.sender_email,
  'received',
  true
FROM shipments s
CROSS JOIN raw_emails re
LEFT JOIN document_classifications dc ON dc.email_id = re.id
WHERE s.shipment_number = 'SHP-2025-001'
  AND re.gmail_message_id LIKE 'manual-test-%'
ORDER BY re.created_at DESC
LIMIT 1
RETURNING document_type, status, '✅ Step 6: Document registered!' as status;

-- STEP 7: Create shipment event
INSERT INTO shipment_events (
  shipment_id,
  event_type,
  event_category,
  event_description,
  source_type,
  source_email_id,
  event_timestamp
)
SELECT
  s.id,
  'booking_updated',
  'milestone',
  'Booking confirmation received from Maersk',
  'email',
  re.id,
  NOW()
FROM shipments s
CROSS JOIN raw_emails re
WHERE s.shipment_number = 'SHP-2025-001'
  AND re.gmail_message_id LIKE 'manual-test-%'
ORDER BY re.created_at DESC
LIMIT 1
RETURNING event_type, event_description, '✅ Step 7: Event created!' as status;

-- STEP 8: Update email status
UPDATE raw_emails
SET processing_status = 'processed',
    processed_at = NOW()
WHERE gmail_message_id LIKE 'manual-test-%'
RETURNING '✅ Step 8: Email marked as processed!' as status;

-- ============================================================================
-- VIEW THE COMPLETE RESULT
-- ============================================================================

SELECT '🎉 EMAIL PROCESSING COMPLETE!' as result;

-- View the email with all its linked data
SELECT
  re.subject as "Email Subject",
  dc.document_type as "Classified As",
  dc.confidence_score as "Confidence",
  COUNT(DISTINCT ee.id) as "Entities Extracted",
  slc.link_status as "Link Status",
  s.shipment_number as "Linked to Shipment"
FROM raw_emails re
LEFT JOIN document_classifications dc ON dc.email_id = re.id
LEFT JOIN entity_extractions ee ON ee.email_id = re.id
LEFT JOIN shipment_link_candidates slc ON slc.email_id = re.id
LEFT JOIN shipments s ON s.id = slc.shipment_id
WHERE re.gmail_message_id LIKE 'manual-test-%'
GROUP BY re.id, re.subject, dc.document_type, dc.confidence_score, slc.link_status, s.shipment_number;

-- View extracted entities
SELECT
  entity_type,
  entity_value,
  confidence_score
FROM entity_extractions
WHERE email_id = (SELECT id FROM raw_emails WHERE gmail_message_id LIKE 'manual-test-%' LIMIT 1)
ORDER BY entity_type;

-- View shipment timeline
SELECT
  event_type,
  event_description,
  event_timestamp
FROM shipment_events
WHERE shipment_id = (SELECT id FROM shipments WHERE shipment_number = 'SHP-2025-001')
ORDER BY event_timestamp DESC;
```

**Expected Result:** You'll see the complete email processing flow from capture → classify → extract → link → document → event!

---

#### **Day 3-4: Set Up Gmail API**

**Follow this guide to get Gmail API credentials:**

1. Go to: https://console.cloud.google.com/
2. Create new project: "Freight Intelligence"
3. Enable Gmail API
4. Create OAuth 2.0 credentials
5. Download credentials.json
6. Store in `~/intdb/gmail-credentials.json`

**Test Gmail connection:**

```javascript
// test-gmail.js
const { google } = require('googleapis');
const fs = require('fs');

const credentials = JSON.parse(fs.readFileSync('./gmail-credentials.json'));
const { client_secret, client_id, redirect_uris } = credentials.installed;
const oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uris[0]);

// Get auth URL
const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: ['https://www.googleapis.com/auth/gmail.readonly']
});

console.log('Authorize this app by visiting:', authUrl);
```

---

#### **Day 5-7: Build First AI Agent (Email Ingestion)**

**Create:** `~/intdb/agents/email-ingestion-agent.ts`

```typescript
import { createClient } from '@supabase/supabase-js';
import { google } from 'googleapis';

const supabase = createClient(
  'https://fdmcdbvkfdmrdowfjrcz.supabase.com',
  'YOUR_SUPABASE_KEY'
);

class EmailIngestionAgent {
  private gmail: any;

  constructor(gmailAuth: any) {
    this.gmail = google.gmail({ version: 'v1', auth: gmailAuth });
  }

  async ingestNewEmails() {
    // 1. Get carrier patterns from database
    const { data: carriers } = await supabase
      .from('carrier_configs')
      .select('email_sender_patterns')
      .eq('enabled', true);

    // 2. Build Gmail query
    const senderPatterns = carriers
      .flatMap(c => c.email_sender_patterns)
      .map(p => `from:${p}`)
      .join(' OR ');

    // 3. Fetch emails from Gmail
    const response = await this.gmail.users.messages.list({
      userId: 'me',
      q: senderPatterns,
      maxResults: 10
    });

    // 4. Store each email
    for (const message of response.data.messages || []) {
      await this.storeEmail(message.id);
    }
  }

  async storeEmail(messageId: string) {
    // Fetch full email
    const email = await this.gmail.users.messages.get({
      userId: 'me',
      id: messageId,
      format: 'full'
    });

    // Extract headers
    const headers = email.data.payload.headers;
    const getHeader = (name: string) =>
      headers.find((h: any) => h.name === name)?.value || '';

    // Insert into database (idempotent)
    const { data, error } = await supabase
      .from('raw_emails')
      .insert({
        gmail_message_id: messageId,
        sender_email: getHeader('From'),
        sender_name: getHeader('From').split('<')[0].trim(),
        subject: getHeader('Subject'),
        body_text: this.extractBody(email.data.payload),
        received_at: new Date(parseInt(email.data.internalDate)),
        has_attachments: email.data.payload.parts?.some((p: any) =>
          p.filename && p.body.attachmentId
        ) || false
      })
      .select()
      .single();

    if (error && error.code !== '23505') { // Ignore duplicates
      console.error('Failed to insert email:', error);
    } else {
      console.log('Email stored:', data?.id);
    }
  }

  private extractBody(payload: any): string {
    // Extract text from email payload
    if (payload.body?.data) {
      return Buffer.from(payload.body.data, 'base64').toString('utf-8');
    }
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          return Buffer.from(part.body.data, 'base64').toString('utf-8');
        }
      }
    }
    return '';
  }
}

// Run agent
async function main() {
  const agent = new EmailIngestionAgent(/* gmail auth */);
  await agent.ingestNewEmails();
}

main();
```

**Test it:**
```bash
npm install @supabase/supabase-js googleapis
ts-node agents/email-ingestion-agent.ts
```

---

### **Week 2: Build AI Agents**

#### **Day 8-10: Classification Agent**

```typescript
import Anthropic from '@anthropic-ai/sdk';

class ClassificationAgent {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  async classifyPendingEmails() {
    // 1. Get unclassified emails
    const { data: emails } = await supabase
      .from('raw_emails')
      .select('id, subject, sender_email, body_text')
      .eq('processing_status', 'pending')
      .is('document_classifications.email_id', null)
      .limit(10);

    // 2. Get document types from DB
    const { data: docTypes } = await supabase
      .from('document_type_configs')
      .select('document_type, display_name, email_subject_patterns, content_keywords')
      .eq('enabled', true);

    // 3. Classify each email
    for (const email of emails || []) {
      const classification = await this.classifyEmail(email, docTypes);
      await this.storeClassification(email.id, classification);
    }
  }

  async classifyEmail(email: any, docTypes: any[]) {
    const prompt = `
You are a freight forwarding document classifier.

Classify this email into ONE of these document types:
${docTypes.map(dt => `- ${dt.document_type}: ${dt.display_name}`).join('\n')}

Email:
Subject: ${email.subject}
From: ${email.sender_email}
Body: ${email.body_text.substring(0, 1000)}

Return JSON only:
{
  "document_type": "booking_confirmation",
  "confidence": 95.5,
  "reason": "Subject contains 'Booking Confirmation', sender is carrier, body contains booking number"
}
`;

    const message = await this.anthropic.messages.create({
      model: 'claude-opus-3-20240229',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }]
    });

    return JSON.parse(message.content[0].text);
  }

  async storeClassification(emailId: string, classification: any) {
    await supabase.from('document_classifications').insert({
      email_id: emailId,
      document_type: classification.document_type,
      confidence_score: classification.confidence,
      model_name: 'claude-opus-3',
      model_version: '2024-02-29',
      classification_reason: classification.reason
    });
  }
}
```

#### **Day 11-12: Extraction Agent**

#### **Day 13-14: Linking Agent**

---

## 📚 Documentation References

| File | Purpose |
|------|---------|
| **FREIGHT-INTELLIGENCE-README.md** | Complete technical documentation with all TypeScript examples |
| **quick-start-queries.sql** | 100+ SQL queries for testing and learning |
| **GETTING-STARTED.md** | 30-minute customization guide |
| **DEPLOYMENT-SUCCESS.md** | Complete overview of what was deployed |

---

## 🎯 Success Criteria

**Week 1 Complete:**
- ✅ Manual email processing test works
- ✅ Gmail API connected
- ✅ EmailIngestionAgent fetching emails

**Week 2 Complete:**
- ✅ ClassificationAgent classifying with 90%+ accuracy
- ✅ ExtractionAgent extracting entities
- ✅ LinkingAgent auto-linking to shipments
- ✅ Dashboard showing live data

**Production Ready:**
- ✅ All agents running on cron schedule
- ✅ Processing 20-30 documents per shipment
- ✅ 60-70 emails per shipment handled
- ✅ 90%+ auto-linking success rate
- ✅ Team trained on dashboard

---

## 💡 Pro Tips

### **Start Small:**
- Test with 10 emails first
- Verify accuracy before scaling
- Adjust confidence thresholds based on results

### **Monitor Performance:**
```sql
-- Check classification accuracy
SELECT
  is_correct,
  COUNT(*) as total,
  AVG(confidence_score) as avg_confidence
FROM document_classifications
WHERE is_correct IS NOT NULL
GROUP BY is_correct;

-- Check auto-link success
SELECT
  link_status,
  COUNT(*) as total,
  AVG(confidence_score) as avg_confidence
FROM shipment_link_candidates
GROUP BY link_status;
```

### **Iterate:**
- Week 1: Get 80% accuracy
- Week 2: Get to 90%
- Week 3: Get to 95%
- Week 4: Production deployment

---

## 🚀 You're Ready!

Your database is **production-ready**. Now it's time to build the AI agents that will:

1. **Fetch emails** from Gmail automatically
2. **Classify** documents with 95%+ accuracy
3. **Extract** all key data (booking #, dates, parties)
4. **Link** to shipments intelligently
5. **Update** dashboards in real-time

**Start with the manual test above, then build EmailIngestionAgent!**

---

**Good luck! You're building something amazing.** 🚢📦
