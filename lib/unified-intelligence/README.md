# Unified Intelligence Module

**Combines INTDB data with external carrier APIs for complete shipment visibility.**

This module powers the Pulse dashboard by assembling comprehensive shipment dossiers.

## Key Services

| Service | Purpose |
|---------|---------|
| `shipment-dossier-service.ts` | Builds complete shipment view |
| `carrier-api-service.ts` | Maersk/Hapag API integration |
| `ops-intelligence-service.ts` | Health scoring & issue detection |
| `bot-command-handlers.ts` | WhatsApp bot commands |
| `bot-notification-service.ts` | Alert notifications |

## Usage

```typescript
import { ShipmentDossierService } from '@/lib/unified-intelligence';

const dossier = await ShipmentDossierService.getShipmentDossier(bookingNumber);
// Returns: identity, route, dates, documents, actions, tracking, discrepancies
```

## Data Sources

1. **Chronicle table** - Email extractions
2. **Carrier APIs** - Live tracking (Maersk, Hapag)
3. **Cross-validation** - INTDB vs Carrier discrepancies

## See Also

- `/app/pulse/` - Dashboard that uses this module
- `/app/api/pulse/` - API endpoints
