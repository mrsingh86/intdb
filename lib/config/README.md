# Config Module

**Configuration patterns for email classification and workflow management.**

This module contains pattern definitions, document type configs, and workflow rules.

## Key Configs

| File | Purpose |
|------|---------|
| `shipping-line-patterns.ts` | Carrier-specific email patterns (Maersk, Hapag, etc.) |
| `content-classification-config.ts` | Document type definitions |
| `email-type-config.ts` | Email categorization rules |
| `email-parties.ts` | Party identification (carrier, customer, etc.) |
| `attachment-patterns.ts` | Filename → document type mapping |
| `workflow-states.ts` | Shipment lifecycle states |
| `workflow-transition-rules.ts` | State machine transitions |

## Usage

```typescript
import {
  classifyEmail,
  getCarrierConfig,
  DOCUMENT_TYPE_CONFIGS,
  identifyParty,
} from '@/lib/config';

const carrier = getCarrierConfig('maersk');
const result = classifyEmail(subject, sender, body);
const party = identifyParty(senderEmail);
```

## Philosophy

**Configuration over Code** - Business rules live in config, not hardcoded.

Adding a new carrier or document type should require:
1. Update config in this module
2. Optionally add to `detection_patterns` table in database

NOT modifying business logic code.
