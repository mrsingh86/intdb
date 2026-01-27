/**
 * Unified Intelligence Module
 *
 * Combines INTDB (email intelligence) with Carrier APIs (Maersk, Hapag-Lloyd)
 * to provide complete shipment visibility for the internal ops team WhatsApp bot.
 *
 * Usage:
 * ```typescript
 * import { getUnifiedIntelligenceService, getBotCommandHandler } from '@/lib/unified-intelligence';
 *
 * // For direct service access
 * const service = getUnifiedIntelligenceService(supabaseClient);
 * const status = await service.getUnifiedStatus('262226938');
 *
 * // For WhatsApp bot integration
 * const bot = getBotCommandHandler(supabaseClient);
 * const result = await bot.handleCommand('status 262226938');
 * console.log(result.message); // Formatted WhatsApp message
 * ```
 */

// Types
export type {
  // Core Types
  CarrierCode,
  ShipmentStatus,
  AlertSeverity,
  DataSource,

  // API Response
  ApiResponse,

  // Carrier API Types
  CarrierTrackingData,
  CarrierEvent,
  CarrierDeadlines,
  DeadlineItem,
  CarrierCharges,

  // INTDB Types
  IntdbShipmentData,
  DocumentStatus,
  PendingAction,

  // Validation Types
  ValidationResult,
  ValidationAlert,
  MergedShipmentData,

  // Unified Types
  UnifiedShipmentStatus,

  // Bot Types
  CommandResult,
  CommandButton,
} from './types';

// Services
export { UnifiedIntelligenceService, getUnifiedIntelligenceService } from './unified-intelligence-service';
export { IntdbQueryService, getIntdbQueryService } from './intdb-query-service';
export { CarrierApiService, getCarrierApiService, detectCarrier } from './carrier-api-service';
export { CrossValidationService, getCrossValidationService } from './cross-validation-service';

// Bot Handler
export { BotCommandHandler, getBotCommandHandler } from './bot-command-handlers';

// Bot Notifications
export {
  BotNotificationService,
  getBotNotificationService,
  type NotificationPayload,
  type NotificationResult,
  type AlertType,
  type AlertConfig,
} from './bot-notification-service';
