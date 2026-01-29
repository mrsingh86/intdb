# Validation Module

**Zod schemas for runtime type validation.**

This module provides type-safe validation for API inputs, database operations,
and AI extraction outputs.

## Usage

```typescript
import { chronicleInsertSchema, shipmentSchema } from '@/lib/validation';

// Validate AI extraction output
const validated = chronicleInsertSchema.parse(aiOutput);

// Validate API input
const shipment = shipmentSchema.parse(requestBody);
```

## Philosophy

- **Fail fast** - Invalid data throws immediately
- **Type safety** - Schemas generate TypeScript types
- **Enum normalization** - AI outputs are normalized before validation
