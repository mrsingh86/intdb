# Utils Module

**Stateless business utility functions.**

These are pure functions with no side effects, used across multiple modules.

## Key Utilities

| File | Purpose |
|------|---------|
| `date-parser.ts` | Date parsing and normalization |
| `container-validator.ts` | Container number validation |
| `supabase-pagination.ts` | Pagination helpers |
| `document-grouping.ts` | Document deduplication & grouping |
| `direction-detector.ts` | Email direction detection |

## Usage

```typescript
import {
  parseEntityDate,
  isValidContainerNumber,
  getAllRows,
  deduplicateByMessageId,
} from '@/lib/utils';

const date = parseEntityDate('2025-01-29');
const valid = isValidContainerNumber('MSCU1234567');
```

## Note

**This is different from `/utils/`** which contains stateful infrastructure clients
(Supabase, Gmail, Logger). This folder contains pure utility functions only.
