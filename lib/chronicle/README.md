# Chronicle Module

**The core email intelligence engine for INTDB.**

Chronicle processes freight forwarding emails and extracts structured intelligence.

## Architecture

```
Email arrives → Pattern Matcher → AI Analyzer → Store in DB → Link to Shipment
                    ↓                  ↓
              (85%+ match?)        (fallback)
```

## Key Files

| File | Purpose |
|------|---------|
| `chronicle-service.ts` | Main orchestrator (entry point) |
| `ai-analyzer.ts` | Claude AI extraction |
| `pattern-matcher.ts` | Fast pattern-based classification |
| `action-rules-service.ts` | Action determination |
| `gmail-service.ts` | Gmail API client |
| `chronicle-repository.ts` | Database operations |
| `prompts/` | AI prompt configurations |

## Usage

```typescript
import { createChronicleService } from '@/lib/chronicle';

const chronicle = createChronicleService(supabase);
const result = await chronicle.processEmail(messageId);
```

## Database Tables

- `chronicle` - Main email intelligence (100+ fields)
- `chronicle_runs` - Processing run logs
- `chronicle_errors` - Error tracking
- `chronicle_sync_state` - Gmail sync state

## See Also

- `/docs/CHRONICLE_ARCHITECTURE.md` - Detailed architecture
- `/app/api/cron/process-emails/` - Cron job that uses this module
