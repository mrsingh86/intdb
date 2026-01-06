/**
 * Direction Detection Types
 */

export type EmailDirection = 'inbound' | 'outbound';

export type DetectionMethod =
  | 'x_original_sender_header'
  | 'via_pattern'
  | 'reply_to_header'
  | 'return_path_header'
  | 'carrier_domain'
  | 'intoglo_domain'
  | 'carrier_subject_pattern'
  | 'thread_analysis'
  | 'external_domain';

export interface DirectionResult {
  direction: EmailDirection;
  trueSender: string;
  trueSenderDomain: string;
  confidence: number; // 0.0 - 1.0
  reasoning: string;
  method: DetectionMethod;
}

export interface EmailInput {
  id?: string;
  senderEmail: string;
  senderName?: string;
  trueSenderEmail?: string | null;
  subject: string;
  headers?: Record<string, string>;
  inReplyToMessageId?: string | null;
  threadId?: string;
}

export interface ThreadEmail extends EmailInput {
  messageId: string;
  direction?: EmailDirection;
}

export interface ThreadAnalysis {
  threadId: string;
  emails: Array<{
    messageId: string;
    direction: DirectionResult;
  }>;
  summary: {
    inboundCount: number;
    outboundCount: number;
    initiator: 'intoglo' | 'external';
  };
}

export interface ReprocessResult {
  processed: number;
  updated: number;
  errors: number;
  samples: Array<{
    emailId: string;
    oldDirection: EmailDirection | null;
    newDirection: EmailDirection;
    reasoning: string;
  }>;
}
