/**
 * Intelligence Services
 *
 * Email Intelligence: Extracts structured facts per email
 * Shipment Intelligence: Aggregates facts into shipment-level rollup
 */

export {
  EmailIntelligenceService,
  createEmailIntelligenceService,
  type EmailIntelligence,
  type ExtractionOptions,
  type Sentiment,
  type Urgency,
  type EventType,
} from './email-intelligence-service';

export {
  ShipmentIntelligenceService,
  createShipmentIntelligenceService,
  type ShipmentIntelligence,
  type SentimentTrend,
} from './shipment-intelligence-service';
