# INTDB - Freight Intelligence Database

AI-powered freight forwarding document intelligence system for Intoglo.

## Quick Reference

### Key Entry Points
| What | Where |
|------|-------|
| Email Processing | `lib/chronicle/chronicle-service.ts` |
| AI Analysis | `lib/chronicle/ai-analyzer.ts` |
| Pattern Matching | `lib/chronicle/pattern-matcher.ts` |
| Action Rules | `lib/chronicle/action-rules-service.ts` |
| Gmail Fetching | `lib/chronicle/gmail-service.ts` |
| Data Access | `lib/chronicle/chronicle-repository.ts` |

### Database (Supabase)
**Project:** `fdmcdbvkfdmrdowfjrcz`

### Database Tables

**Core Intelligence**
| Table | Purpose |
|-------|---------|
| `chronicle` | Main email intelligence (100+ fields, all extracted data) |
| `chronicle_sync_state` | Gmail sync state for hybrid fetching |
| `chronicle_runs` | Processing run logs |
| `chronicle_errors` | Error tracking |

**Action System**
| Table | Purpose |
|-------|---------|
| `action_lookup` | Direct document type → action mapping |
| `document_type_action_rules` | Configurable action rules |
| `action_templates` | Reusable action templates |
| `action_completion_keywords` | Keywords that auto-resolve actions |

**Pattern & Learning**
| Table | Purpose |
|-------|---------|
| `detection_patterns` | Sender/subject patterns for classification |
| `enum_mappings` | AI output normalization (e.g., 'vgm' → 'vgm_confirmation') |
| `learning_episodes` | Feedback for pattern improvement |
| `pending_patterns` | Patterns awaiting approval |
| `pattern_audit` | Pattern change history |

**Shipment Layer**
| Table | Purpose |
|-------|---------|
| `shipments` | Master shipment records |
| `shipment_events` | Timeline/milestone tracking |
| `shipment_ai_summaries` | AI-generated shipment summaries |
| `chronicle_shipment_health` | Health scores per shipment |

**Profiles**
| Table | Purpose |
|-------|---------|
| `carrier_profiles` | Carrier metadata |
| `shipper_profiles` | Shipper information |
| `consignee_profiles` | Consignee information |
| `route_profiles` | Common trade routes |

---

## Architecture

```
/lib/chronicle/                  # Main production system
  chronicle-service.ts           # Orchestrator (fetch → classify → extract → store)
  ai-analyzer.ts                 # Anthropic tool_use with Haiku
  pattern-matcher.ts             # Pattern-first classification
  action-rules-service.ts        # Document type → action mapping
  precise-action-service.ts      # Action extraction logic
  gmail-service.ts               # Gmail API integration
  chronicle-repository.ts        # Data access layer
  types.ts                       # Type definitions
  interfaces.ts                  # Service interfaces
  prompts/
    freight-forwarder.prompt.ts  # AI prompt + tool schema

/app/
  /api/                          # REST API Routes
    /chronicle/                  # Chronicle endpoints
    /shipments/                  # Shipment CRUD
    /cron/                       # Scheduled jobs
  /shipments/                    # UI Pages
    /dashboard/                  # Main dashboard
    /[id]/                       # Shipment detail

/archive/dead-code/              # Archived legacy code (do not use)
```

---

## Hybrid Classification System

INTDB uses a **pattern-first, AI-fallback** approach:

```
Email arrives
    ↓
Pattern Matcher (85%+ confidence?)
    ├── YES → Use pattern result (fast, cheap)
    └── NO  → AI Analyzer (Haiku with tool_use)
                  ↓
              Enum Normalization
                  ↓
              Store in chronicle
```

### Pattern Matching
- Sender patterns in `detection_patterns` table
- Subject keyword matching
- Confidence scoring (0-100)
- Thread position affects confidence

### AI Analysis
- Model: `claude-3-5-haiku-latest`
- Uses Anthropic `tool_use` for structured extraction
- 30+ enum normalizations before Zod validation
- Thread context passed for reply/forward emails

---

## Common Patterns

### Import from Index Files
```typescript
// Chronicle system
import { ChronicleService, createChronicleService } from '@/lib/chronicle';
import { AiAnalyzer, createAiAnalyzer } from '@/lib/chronicle';
```

### Service Composition
```typescript
const chronicle = createChronicleService(supabase);
const result = await chronicle.processEmail(messageId);
// Internally: fetch → pattern match → AI fallback → extract → link → store
```

### Repository Pattern
```typescript
const repo = createChronicleRepository(supabase);
const existing = await repo.findByGmailMessageId(messageId);
```

---

## Key Type Definitions

### Document Types (from AI or pattern matching)
- `booking_confirmation` - Initial booking
- `booking_amendment` - Booking changes
- `shipping_instructions` - SI submission
- `si_confirmation` - SI confirmed
- `vgm_confirmation` - VGM submitted
- `draft_bl` - Draft Bill of Lading
- `final_bl` - Final BL issued
- `telex_release` - Telex release confirmation
- `arrival_notice` - Arrival notification
- `customs_entry` - Customs documentation
- `invoice` - Commercial/freight invoice

### Action Types
- `submit` - Submit document (SI, VGM)
- `review` - Review and approve
- `respond` - Reply required
- `verify` - Check/confirm
- `follow_up` - Chase for response

### Message Types
- `notification` - FYI, no action
- `action_required` - Needs response
- `approval` - Draft for approval
- `confirmation` - Confirmation of prior action
- `update` - Status update

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
```

---

## Common Operations

### Debug Email Processing
1. Check `chronicle_runs` for run status
2. Check `chronicle_errors` for specific failures
3. Query `chronicle` table for processed emails:
```sql
SELECT gmail_message_id, document_type, ai_confidence, created_at
FROM chronicle
ORDER BY created_at DESC
LIMIT 20;
```

### Force Re-analyze Email
```sql
UPDATE chronicle
SET needs_reanalysis = true
WHERE gmail_message_id = 'xxx';
```

### Check Action System
```sql
-- Pending actions
SELECT * FROM chronicle
WHERE has_action = true
AND action_completed_at IS NULL
ORDER BY action_deadline;
```

---

## Code Quality Rules

1. **Services < 50 lines per method** - Extract to helpers
2. **Repositories return empty arrays, not null** - Throw exceptions for missing items
3. **Use TypeScript strict mode** - No `any` types
4. **Enum normalization** - Fix AI outputs before Zod validation
5. **Pattern-first** - Only use AI when patterns fail
6. **Thread context** - Pass previous emails for context in threads
7. **Idempotent** - Check `findByGmailMessageId` before processing

---

## AI Model Configuration

Located in `lib/chronicle/prompts/freight-forwarder.prompt.ts`:

```typescript
export const AI_CONFIG = {
  model: 'claude-3-5-haiku-latest',
  maxTokens: 4096,
  maxBodyChars: 8000,
};
```

### Enum Normalization (in ai-analyzer.ts)
Common AI mistakes are fixed before validation:
- `'vgm'` → `'vgm_confirmation'`
- `'mbl'` → `'final_bl'`
- `'hbl'` → `'house_bl'`
- `'draft'` → `'approval'`

---

## Archived Code

Legacy code that should NOT be used is in `/archive/dead-code/`:
- `email-ingestion-agent.ts` - Old agent that used non-existent `raw_emails` table
- `run-email-ingestion-cron.ts` - Cron for dead agent
- `test-email-agent.ts` - Tests for dead agent

The Chronicle system (`/lib/chronicle/`) is the current production system.
