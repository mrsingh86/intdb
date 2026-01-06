/**
 * Direction Detection Service
 *
 * Standalone service for determining email direction (inbound/outbound)
 */

export * from './types';
export * from './domain-classifier';
export * from './true-sender-extractor';
export {
  DirectionDetectionService,
  directionDetectionService,
} from './direction-detection-service';
