/**
 * EmailIngestionAgent - Production-ready email ingestion agent
 *
 * Responsibilities:
 * 1. Connect to Gmail API
 * 2. Fetch emails from configured carriers
 * 3. Store emails in raw_emails table (idempotent)
 * 4. Store attachments in raw_attachments table
 *
 * Following CLAUDE.md principles:
 * - Idempotent operations (safe to run multiple times)
 * - Database-driven configuration
 * - Deep module with simple interface
 * - Comprehensive error handling
 * - Audit trail for all operations
 */

import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import pLimit from 'p-limit';
import Logger from '../utils/logger';
import GmailClient from '../utils/gmail-client';
import SupabaseService, { supabase } from '../utils/supabase-client';
import {
  RawEmail,
  RawAttachment,
  CarrierConfig,
  ProcessingLog
} from '../types/database.types';
import { EmailData, AttachmentData, GmailCredentials } from '../types/gmail.types';

dotenv.config();

interface ProcessingStats {
  totalEmails: number;
  processedEmails: number;
  failedEmails: number;
  duplicateEmails: number;
  attachmentsSaved: number;
  startTime: Date;
  endTime?: Date;
}

interface EmailIngestionConfig {
  maxEmailsPerRun: number;
  batchSize: number;
  maxConcurrent: number;
  lookbackDays: number;
}

export class EmailIngestionAgent {
  private gmailClient: GmailClient;
  private logger: Logger;
  private config: EmailIngestionConfig;
  private stats: ProcessingStats;
  private runId: string;
  private concurrencyLimiter: ReturnType<typeof pLimit>;

  constructor(gmailCredentials?: GmailCredentials) {
    this.logger = new Logger('EmailIngestionAgent');
    this.runId = uuidv4();

    // Load configuration
    this.config = {
      maxEmailsPerRun: parseInt(process.env.MAX_EMAILS_PER_RUN || '50'),
      batchSize: parseInt(process.env.BATCH_SIZE || '10'),
      maxConcurrent: parseInt(process.env.MAX_CONCURRENT_PROCESSING || '5'),
      lookbackDays: parseInt(process.env.LOOKBACK_DAYS || '7')
    };

    // Initialize Gmail client
    const credentials = gmailCredentials || {
      client_id: process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      redirect_uri: process.env.GMAIL_REDIRECT_URI!,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN!
    };

    this.gmailClient = new GmailClient(credentials);

    // Initialize concurrency limiter
    this.concurrencyLimiter = pLimit(this.config.maxConcurrent);

    // Initialize stats
    this.stats = {
      totalEmails: 0,
      processedEmails: 0,
      failedEmails: 0,
      duplicateEmails: 0,
      attachmentsSaved: 0,
      startTime: new Date()
    };

    this.logger.info('EmailIngestionAgent initialized', {
      runId: this.runId,
      config: this.config
    });
  }

  /**
   * Main entry point - Process new emails
   */
  public async processNewEmails(): Promise<ProcessingStats> {
    this.logger.info('Starting email ingestion', { runId: this.runId });

    try {
      // Record processing start
      await this.recordProcessingStart();

      // Get active carrier configurations
      const carriers = await this.getActiveCarriers();
      if (carriers.length === 0) {
        this.logger.warn('No active carriers found');
        return this.stats;
      }

      // Build Gmail query
      const query = this.buildGmailQuery(carriers);
      this.logger.info('Gmail query built', { query });

      // Fetch emails from Gmail
      const messageIds = await this.fetchMessageIds(query);
      this.stats.totalEmails = messageIds.length;

      if (messageIds.length === 0) {
        this.logger.info('No new emails found');
        return this.stats;
      }

      this.logger.info(`Found ${messageIds.length} emails to process`);

      // Process emails in batches with concurrency control
      await this.processEmailBatch(messageIds);

      // Update processing stats
      this.stats.endTime = new Date();
      await this.recordProcessingComplete();

      this.logger.info('Email ingestion completed', this.stats);

      return this.stats;

    } catch (error) {
      this.logger.error('Email ingestion failed', error);
      await this.recordProcessingError(error as Error);
      throw error;
    }
  }

  /**
   * Get active carrier configurations from database
   */
  private async getActiveCarriers(): Promise<CarrierConfig[]> {
    const { data, error } = await supabase
      .from('carrier_configs')
      .select('*')
      .eq('enabled', true);

    if (error) {
      throw new Error(`Failed to fetch carrier configs: ${error.message}`);
    }

    return data || [];
  }

  /**
   * Build Gmail query targeting Intoglo group inboxes
   *
   * WHY: Shipping lines send to ops@intoglo.com (Google Group) which forwards to team.
   * Gmail indexes forwarded emails with from:ops@intoglo.com, not from:@maersk.com.
   * The original sender is preserved in X-Original-Sender header (extracted as true_sender_email).
   *
   * Query strategy: Fetch all emails TO intoglo groups, then classify by true_sender_email.
   */
  private buildGmailQuery(carriers: CarrierConfig[]): string {
    // Intoglo group addresses that receive shipping line emails
    const intogloGroups = [
      'ops@intoglo.com',
      'nam@intoglo.com',
      'pricing@intoglo.com',
      'invoicing@intoglo.com'
    ];

    // Build TO query for all intoglo groups
    const groupQueries = intogloGroups.map(group => `to:${group}`);

    // Add date filter (lookback period)
    const afterDate = new Date();
    afterDate.setDate(afterDate.getDate() - this.config.lookbackDays);
    const dateFilter = `after:${afterDate.toISOString().split('T')[0]}`;

    // Combine queries with OR operator and add date filter
    const toQuery = `(${groupQueries.join(' OR ')})`;
    return `${toQuery} ${dateFilter}`.trim();
  }

  /**
   * Fetch message IDs from Gmail
   *
   * DEDUPLICATION: Emails sent to multiple groups (ops@ AND pricing@) appear once in Gmail
   * but query might return them multiple times. Use Set to deduplicate.
   */
  private async fetchMessageIds(query: string): Promise<string[]> {
    const messageIdSet = new Set<string>();
    let pageToken: string | undefined;

    do {
      const result = await this.gmailClient.listMessages(
        query,
        this.config.maxEmailsPerRun - messageIdSet.size,
        pageToken
      );

      // Add to Set for automatic deduplication
      for (const msgId of result.messages) {
        messageIdSet.add(msgId);
      }
      pageToken = result.nextPageToken;

      // Stop if we've reached the max
      if (messageIdSet.size >= this.config.maxEmailsPerRun) {
        break;
      }
    } while (pageToken);

    const uniqueIds = Array.from(messageIdSet).slice(0, this.config.maxEmailsPerRun);
    this.logger.info(`Fetched ${uniqueIds.length} unique message IDs`);
    return uniqueIds;
  }

  /**
   * Process emails in batches
   */
  private async processEmailBatch(messageIds: string[]): Promise<void> {
    const promises = messageIds.map(messageId =>
      this.concurrencyLimiter(() => this.processSingleEmail(messageId))
    );

    await Promise.allSettled(promises);
  }

  /**
   * Process a single email
   */
  private async processSingleEmail(gmailMessageId: string): Promise<void> {
    const startTime = Date.now();

    try {
      // Check if email already exists (idempotent)
      const existing = await this.checkExistingEmail(gmailMessageId);
      if (existing) {
        this.stats.duplicateEmails++;
        this.logger.debug(`Email already processed: ${gmailMessageId}`);
        return;
      }

      // Fetch email from Gmail
      const emailData = await this.gmailClient.getMessage(gmailMessageId);

      // Save email to database (carrier identification happens in ClassificationAgent)
      const emailId = await this.saveEmail(emailData);

      // Save attachments if any
      if (emailData.attachments && emailData.attachments.length > 0) {
        await this.saveAttachments(emailId, gmailMessageId, emailData.attachments);
      }

      this.stats.processedEmails++;

      const duration = Date.now() - startTime;
      this.logger.info(`Email processed successfully`, {
        gmailMessageId,
        emailId,
        duration,
        hasAttachments: emailData.hasAttachments
      });

    } catch (error) {
      this.stats.failedEmails++;
      this.logger.error(`Failed to process email: ${gmailMessageId}`, error);

      // Record error in database
      await this.recordEmailError(gmailMessageId, error as Error);
    }
  }

  /**
   * Check if email already exists in database
   */
  private async checkExistingEmail(gmailMessageId: string): Promise<boolean> {
    const { data, error } = await supabase
      .from('raw_emails')
      .select('id')
      .eq('gmail_message_id', gmailMessageId)
      .single();

    // If error is not "no rows", then it's a real error
    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to check existing email: ${error.message}`);
    }

    return !!data;
  }

  /**
   * Save email to database
   */
  private async saveEmail(email: EmailData): Promise<string> {
    const rawEmail: RawEmail = {
      gmail_message_id: email.gmailMessageId,
      thread_id: email.threadId,
      sender_email: email.senderEmail,
      sender_name: email.senderName,
      true_sender_email: email.trueSenderEmail,
      recipient_emails: email.recipientEmails,
      subject: email.subject,
      body_text: email.bodyText,
      body_html: email.bodyHtml,
      snippet: email.snippet,
      headers: email.headers,
      has_attachments: email.hasAttachments,
      attachment_count: email.attachmentCount,
      labels: email.labels,
      received_at: email.receivedAt.toISOString(),
      processing_status: 'pending'
    };

    const { data, error } = await supabase
      .from('raw_emails')
      .insert(rawEmail)
      .select('id')
      .single();

    if (error) {
      throw new Error(`Failed to save email: ${error.message}`);
    }

    return data.id;
  }

  /**
   * Save attachments to database
   */
  private async saveAttachments(
    emailId: string,
    gmailMessageId: string,
    attachments: AttachmentData[]
  ): Promise<void> {
    for (const attachment of attachments) {
      try {
        // For now, we store the path reference
        // In production, you'd download and store in S3/GCS
        const rawAttachment: RawAttachment = {
          email_id: emailId,
          filename: attachment.filename,
          mime_type: attachment.mimeType,
          size_bytes: attachment.sizeBytes,
          storage_path: `gmail://${gmailMessageId}/${attachment.attachmentId}`,
          attachment_id: attachment.attachmentId,
          extraction_status: 'pending'
        };

        const { error } = await supabase
          .from('raw_attachments')
          .insert(rawAttachment);

        if (error) {
          this.logger.error(`Failed to save attachment: ${attachment.filename}`, error);
        } else {
          this.stats.attachmentsSaved++;
        }

      } catch (error) {
        this.logger.error(`Failed to process attachment: ${attachment.filename}`, error);
      }
    }
  }

  /**
   * Record email processing error
   */
  private async recordEmailError(gmailMessageId: string, error: Error): Promise<void> {
    try {
      // Try to create a minimal record for failed emails
      await supabase
        .from('raw_emails')
        .upsert({
          gmail_message_id: gmailMessageId,
          sender_email: 'unknown',
          subject: 'Failed to fetch',
          received_at: new Date().toISOString(),
          processing_status: 'failed',
          processing_error: error.message
        }, {
          onConflict: 'gmail_message_id'
        });
    } catch (dbError) {
      this.logger.error('Failed to record email error', dbError);
    }
  }

  /**
   * Record processing start in logs table
   */
  private async recordProcessingStart(): Promise<void> {
    const log: ProcessingLog = {
      agent_name: 'EmailIngestionAgent',
      run_id: this.runId,
      started_at: this.stats.startTime.toISOString(),
      status: 'running',
      metadata: {
        config: this.config
      }
    };

    await supabase
      .from('processing_logs')
      .insert(log);
  }

  /**
   * Record processing completion
   */
  private async recordProcessingComplete(): Promise<void> {
    await supabase
      .from('processing_logs')
      .update({
        completed_at: new Date().toISOString(),
        status: 'completed',
        emails_processed: this.stats.processedEmails,
        emails_failed: this.stats.failedEmails,
        metadata: {
          stats: this.stats
        }
      })
      .eq('run_id', this.runId);
  }

  /**
   * Record processing error
   */
  private async recordProcessingError(error: Error): Promise<void> {
    await supabase
      .from('processing_logs')
      .update({
        completed_at: new Date().toISOString(),
        status: 'failed',
        emails_processed: this.stats.processedEmails,
        emails_failed: this.stats.failedEmails,
        error_details: {
          message: error.message,
          stack: error.stack
        }
      })
      .eq('run_id', this.runId);
  }

  /**
   * Test agent connectivity
   */
  public async testConnections(): Promise<{ gmail: boolean; database: boolean }> {
    const gmailConnected = await this.gmailClient.testConnection();
    const dbConnected = await SupabaseService.getInstance().testConnection();

    return {
      gmail: gmailConnected,
      database: dbConnected
    };
  }
}

// Export for direct execution
if (require.main === module) {
  (async () => {
    try {
      const agent = new EmailIngestionAgent();

      // Test connections first
      const connections = await agent.testConnections();
      console.log('Connection test:', connections);

      if (!connections.gmail || !connections.database) {
        throw new Error('Connection test failed');
      }

      // Process emails
      const stats = await agent.processNewEmails();
      console.log('Processing complete:', stats);

      process.exit(0);
    } catch (error) {
      console.error('Agent failed:', error);
      process.exit(1);
    }
  })();
}

export default EmailIngestionAgent;