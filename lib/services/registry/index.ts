/**
 * Registry Services Index
 *
 * Central export point for all registry services.
 *
 * Architecture:
 * - Email Registry: Tracks senders, threads, email types
 * - Document Registry: Tracks unique docs, versions (in parent dir)
 * - Stakeholder Registry: Tracks parties from docs + emails
 * - Shipment Registry: Convergence point, links everything
 * - Workstate Registry: State transitions, journey history
 */

// Email Registry
export {
  EmailRegistryService,
  createEmailRegistryService,
} from './email-registry-service';
export type {
  EmailRegistryInput,
  EmailRegistryResult,
  EmailSender,
} from './email-registry-service';

// Stakeholder Registry
export {
  StakeholderRegistryService,
  createStakeholderRegistryService,
} from './stakeholder-registry-service';
export type {
  PartyInfo,
  StakeholderRegistryInput,
  StakeholderRegistryResult,
} from './stakeholder-registry-service';

// Shipment Registry
export {
  ShipmentRegistryService,
  createShipmentRegistryService,
} from './shipment-registry-service';
export type {
  ShipmentRegistryInput,
  ShipmentRegistryResult,
} from './shipment-registry-service';

// Workstate Registry
export {
  WorkstateRegistryService,
  createWorkstateRegistryService,
  STATE_ORDER,
  DOCUMENT_TO_STATE_MAP,
} from './workstate-registry-service';
export type {
  WorkstateRegistryInput,
  WorkstateRegistryResult,
  StateHistoryEntry,
} from './workstate-registry-service';
