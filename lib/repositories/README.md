# Repositories Module

**Data access layer for INTDB.**

Repositories handle all database operations, providing a clean interface
between business logic and the database.

## Pattern

```
Service Layer → Repository → Supabase → Database
```

## Key Repositories

| Repository | Purpose |
|------------|---------|
| `chronicle-repository.ts` | Chronicle table operations |
| `shipment-repository.ts` | Shipment CRUD |
| `email-repository.ts` | Email storage |
| `attachment-repository.ts` | Attachment handling |
| `classification-repository.ts` | Classification data |
| `pattern-repository.ts` | Detection patterns |
| `learning-repository.ts` | Learning system |

## Usage

```typescript
import { createChronicleRepository, createShipmentRepository } from '@/lib/repositories';

const chronicleRepo = createChronicleRepository(supabase);
const existing = await chronicleRepo.findByGmailMessageId(messageId);

const shipmentRepo = createShipmentRepository(supabase);
const shipment = await shipmentRepo.findByBookingNumber(bookingNumber);
```

## Conventions

- **Return empty arrays, not null** for list queries
- **Throw exceptions** for missing required items
- **Use typed parameters** via Zod schemas
- **All writes go through repository**, never direct SQL in services
