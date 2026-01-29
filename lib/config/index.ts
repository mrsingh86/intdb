/**
 * Configuration Module
 *
 * Central export point for all configuration patterns and utilities.
 * Use these imports instead of direct file imports:
 *
 * @example
 * import { CARRIER_CONFIGS, classifyEmail } from '@/lib/config';
 * import { ATTACHMENT_PATTERNS, matchAttachmentPattern } from '@/lib/config';
 */

// =============================================================================
// EMAIL PARTIES - Party identification and classification
// =============================================================================
export {
  type PartyType,
  type Direction,
  type PartyInfo,
  type EmailPartyResult,
  identifyParty,
  classifyEmailParty,
  getPartyDisplay,
} from './email-parties';

// =============================================================================
// ATTACHMENT PATTERNS - Document type detection from filenames
// =============================================================================
export {
  type AttachmentPattern,
  ATTACHMENT_PATTERNS,
  matchAttachmentPattern,
  matchAttachmentPatterns,
} from './attachment-patterns';

// =============================================================================
// BODY INDICATORS - Document type detection from email body
// =============================================================================
export {
  type BodyIndicator,
  BODY_INDICATORS,
  matchBodyIndicator,
} from './body-indicators';

// =============================================================================
// SHIPPING LINE PATTERNS - Carrier-specific email classification
// =============================================================================
export {
  type DocumentType,
  type CarrierPattern,
  type CarrierConfig,
  type ClassificationResult,
  MAERSK_CONFIG,
  HAPAG_LLOYD_CONFIG,
  CMA_CGM_CONFIG,
  COSCO_CONFIG,
  MSC_CONFIG,
  ALL_CARRIER_CONFIGS,
  classifyEmail,
  getCarrierConfig,
  isShippingLineEmail,
} from './shipping-line-patterns';

// =============================================================================
// CONTENT CLASSIFICATION - Sender and document type configuration
// =============================================================================
export {
  type SenderType,
  type SenderPattern,
  type DocumentCategory,
  type ContentMarker,
  type DocumentTypeConfig,
  SENDER_PATTERNS,
  DOCUMENT_TYPE_CONFIGS,
  identifySenderType,
  getDocumentConfig,
  getDocumentTypesByCategory,
  getExpectedDocumentTypes,
  identifySenderTypeByName,
  identifySenderTypeFull,
  validateSenderForDocumentType,
} from './content-classification-config';

// =============================================================================
// EMAIL TYPE CONFIG - Email categorization and sentiment
// =============================================================================
export {
  type SenderCategory,
  type EmailType,
  type EmailSentiment,
  type SentimentConfig,
  type EmailCategory,
  type EmailTypeConfig,
  SENDER_CATEGORY_PATTERNS,
  SENTIMENT_CONFIGS,
  EMAIL_TYPE_CONFIGS,
  getSenderCategory,
  matchesSenderCategory,
  detectSentiment,
} from './email-type-config';

// =============================================================================
// PARTNER PATTERNS - CHA, Trucker, Client identification
// =============================================================================
export {
  type PartnerPattern,
  INDIA_CHA_PATTERNS,
  US_CUSTOMS_BROKER_PATTERNS,
  TRUCKER_PATTERNS,
  CLIENT_PATTERNS,
  AGENT_PATTERNS,
  ALL_PARTNER_PATTERNS,
  matchPartnerPattern,
} from './partner-patterns';

// =============================================================================
// INTOGLO PATTERNS - Internal team email patterns
// =============================================================================
export {
  type IntogloPattern,
  BOOKING_PATTERNS,
  SI_BL_PATTERNS,
  ARRIVAL_CUSTOMS_PATTERNS,
  INVOICE_PATTERNS,
  CUSTOMS_SHARE_PATTERNS,
  COMMUNICATION_PATTERNS,
  ALL_INTOGLO_PATTERNS,
  matchIntogloPattern,
} from './intoglo-patterns';

// =============================================================================
// WORKFLOW STATES - Shipment lifecycle state definitions
// =============================================================================
export {
  type WorkflowPhase,
  type WorkflowStateDefinition,
  type PhaseDefinition,
  WORKFLOW_PHASES,
  WORKFLOW_STATES,
  getWorkflowStateFromDocument,
  getStatesForPhase,
  getPhaseDefinition,
  getStateByKey,
  MAX_WORKFLOW_ORDER,
} from './workflow-states';

// =============================================================================
// WORKFLOW TRANSITION RULES - State machine transitions
// =============================================================================
export {
  type WorkflowTransitionRule,
  WORKFLOW_TRANSITION_RULES,
  getStateByCode,
  getStatesForDocumentType,
  getStatesForEmailType,
  isSenderAuthorized,
  getStateOrder,
  isStateAfter,
} from './workflow-transition-rules';
