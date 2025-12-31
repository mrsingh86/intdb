# INTDB - Freight Intelligence Database

AI-powered freight forwarding document intelligence system for Intoglo.

## Quick Reference

### Key Entry Points
| What | Where |
|------|-------|
| Email Processing | `lib/services/email-processing-orchestrator.ts` |
| Classification | `lib/services/enhanced-classification-service.ts` |
| Extraction | `lib/services/shipment-extraction-service.ts` |
| Shipment Linking | `lib/services/shipment-linking-service.ts` |
| PDF Extraction | `lib/services/enhanced-pdf-extractor.ts` |

### Database (Supabase)
**Project:** `fdmcdbvkfdmrdowfjrcz`

### Key Tables by Layer

**Layer 1 - Raw Data (Immutable)**
| Table | Purpose |
|-------|---------|
| `raw_emails` | Gmail messages with headers, body, threading |
| `raw_attachments` | PDFs, Excel files with OCR text |

**Layer 2 - AI Intelligence**
| Table | Purpose |
|-------|---------|
| `document_classifications` | AI document type detection (95%+ confidence) |
| `entity_extractions` | Booking #, container #, BL #, dates |
| `shipment_link_candidates` | AI-suggested document-to-shipment links |

**Layer 3 - Decision Support**
| Table | Purpose |
|-------|---------|
| `shipments` | Master shipment records |
| `shipment_documents` | Documents linked to shipments |
| `shipment_events` | Timeline/milestone tracking |
| `shipment_containers` | Container details |
| `action_tasks` | Action Center tasks |
| `notifications` | Classified notifications |

**Layer 4 - Configuration**
| Table | Purpose |
|-------|---------|
| `carrier_configs` | Carrier detection patterns |
| `document_type_configs` | Document type definitions |
| `linking_rules` | Auto-linking strategies |

---

## Architecture

```
/app/
  /api/                    # REST API Routes
    /shipments/            # Shipment CRUD + linking
    /emails/               # Email fetching + processing
    /tasks/                # Action Center
    /insights/             # AI-generated insights
    /cron/                 # Scheduled jobs
  /shipments/              # UI Pages
    /dashboard/            # Main dashboard
    /[id]/                 # Shipment detail
    /link-review/          # Manual link review

/lib/
  /services/               # Business logic (USE index.ts)
  /repositories/           # Data access (USE index.ts)
  /types/                  # Shared types (USE index.ts)
  /utils/                  # Utilities (USE index.ts)
  /validation/             # Zod schemas (USE index.ts)
  /config/                 # Carrier patterns, email parties

/scripts/                  # Development scripts (NOT production)
  /analysis/               # Data analysis scripts
  /debugging/              # Debug & verification scripts
  /reports/                # Report generation

/types/                    # Domain type definitions
  email-intelligence.ts    # Layer 1-2 types
  shipment.ts              # Layer 3 types
  intelligence-platform.ts # Tasks, notifications, insights
  insight.ts               # Insight-specific types

/components/
  /ui/                     # Shadcn components
  /tracking/               # Shipment tracking UI
  /shipments/              # Shipment-specific components
  /action-center/          # Task management UI
```

---

## Common Patterns

### Import from Index Files
```typescript
// DO THIS
import { EmailRepository, ShipmentRepository } from '@/lib/repositories';
import { parseEntityDate, getAllRows } from '@/lib/utils';
import { EmailIntelligenceService, ShipmentLinkingService } from '@/lib/services';
import { ValidationError, validateRequestBody } from '@/lib/validation';

// NOT THIS
import { EmailRepository } from '@/lib/repositories/email-repository';
```

### Repository Pattern
```typescript
const repo = new ShipmentRepository(supabase);
const shipments = await repo.findAll(filters, { page: 1, limit: 50 });
```

### Service Composition
```typescript
const orchestrator = new EmailProcessingOrchestrator(supabase);
const result = await orchestrator.processEmail(messageId);
// Internally: fetch -> classify -> extract -> link -> store
```

---

## Carrier Configuration

Carriers are configured in `lib/config/shipping-line-patterns.ts`:
- Maersk, Hapag-Lloyd, CMA CGM, MSC, Evergreen, COSCO, ONE, Yang Ming

Each carrier has:
- Email sender patterns
- Subject line patterns
- Booking number regex
- Document type detection rules

---

## Key Type Definitions

### Shipment Status Flow
```
draft -> booked -> in_transit -> arrived -> delivered
                                         -> cancelled
```

### Document Types
- `booking_confirmation` - Initial booking
- `shipping_instructions` - SI submission
- `draft_bl` - Draft Bill of Lading
- `final_bl` - Final BL
- `arrival_notice` - Arrival notification
- `invoice` - Commercial/freight invoice
- `packing_list` - Cargo details
- `certificate` - Various certificates

### Task Categories
- `document_action` - Document-related tasks
- `deadline_action` - Cutoff/deadline tasks
- `communication` - Follow-up communications
- `compliance` - Regulatory compliance

---

## API Endpoints

### Shipments
- `GET /api/shipments` - List with filters
- `POST /api/shipments` - Create new
- `GET /api/shipments/[id]` - Get details
- `PUT /api/shipments/[id]` - Update
- `GET /api/shipments/[id]/documents` - Linked documents
- `POST /api/shipments/process-linking` - Run auto-linking

### Emails
- `GET /api/emails` - List processed emails
- `GET /api/emails/[emailId]` - Email details
- `POST /api/emails/process` - Process new emails

### Tasks
- `GET /api/tasks` - List action tasks
- `PUT /api/tasks/[id]` - Update task status

---

## Testing

```bash
npm test                    # Run all tests
npm test -- --watch         # Watch mode
npm test -- path/to/file    # Specific file
```

Tests location: `lib/repositories/__tests__/`

---

## Environment Variables

Required in `.env.local`:
```
SUPABASE_URL=https://fdmcdbvkfdmrdowfjrcz.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
GOOGLE_CLIENT_EMAIL=...
GOOGLE_PRIVATE_KEY=...
GOOGLE_ACCOUNT_EMAIL=...
ANTHROPIC_API_KEY=...
OPENAI_API_KEY=...
```

---

## Common Operations

### Add New Carrier
1. Add patterns to `lib/config/shipping-line-patterns.ts`
2. Insert into `carrier_configs` table
3. Test with sample emails

### Debug Email Processing
1. Check `processing_logs` table for run status
2. Check `raw_emails.processing_status` for individual emails
3. Use `/api/debug/` endpoints for detailed inspection

### Force Re-process Email
```sql
UPDATE raw_emails
SET processing_status = 'pending'
WHERE gmail_message_id = 'xxx';
```

---

## Code Quality Rules

1. **Services < 50 lines per method** - Extract to helpers
2. **Repositories return empty arrays, not null** - Throw exceptions for missing items
3. **Use TypeScript strict mode** - No `any` types
4. **Index imports only** - Import from `@/lib/services`, not individual files
5. **Database-driven config** - Patterns in DB, not hardcoded
