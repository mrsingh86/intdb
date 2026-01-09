/**
 * Classification Services
 *
 * Exports all classification-related services.
 * Import from '@/lib/services/classification' not individual files.
 */

export {
  DocumentContentClassificationService,
  createDocumentContentClassificationService,
  type DocumentContentInput,
  type DocumentContentResult,
} from './document-content-classification-service';

export {
  ThreadContextService,
  createThreadContextService,
  type ThreadContextInput,
  type ThreadContext,
  type ForwardInfo,
} from './thread-context-service';

export {
  EmailContentClassificationService,
  createEmailContentClassificationService,
  type EmailContentInput,
  type EmailContentResult,
} from './email-content-classification-service';

export {
  ClassificationOrchestrator,
  createClassificationOrchestrator,
  type ClassificationInput,
  type ClassificationOutput,
} from './classification-orchestrator';

export {
  EmailTypeClassificationService,
  createEmailTypeClassificationService,
  type EmailTypeInput,
  type EmailTypeResult,
} from './email-type-classification-service';

export {
  AIClassificationService,
  getAIClassificationService,
  createAIClassificationService,
  type AIClassificationInput,
  type AIClassificationResult,
} from './ai-classification-service';

export {
  DatabaseClassificationService,
  createDatabaseClassificationService,
  getDatabaseClassificationService,
  type SenderClassificationResult,
  type ContentClassificationResult,
} from './database-classification-service';
