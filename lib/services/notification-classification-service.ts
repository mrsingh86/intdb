/**
 * Notification Classification Service
 *
 * Classifies emails as specific notification types based on patterns.
 * Calculates urgency scores and extracts type-specific data.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { NotificationRepository } from '@/lib/repositories/notification-repository';
import {
  Notification,
  NotificationTypeConfig,
  NotificationPriority,
  NotificationCategory,
} from '@/types/intelligence-platform';

export interface EmailForClassification {
  id: string;
  gmail_message_id: string;
  sender_email: string;
  sender_name?: string;
  subject: string;
  body_text?: string;
  received_at: string;
  shipment_id?: string;
  carrier_id?: string;
}

export interface ClassificationResult {
  isNotification: boolean;
  notificationType?: string;
  confidence: number;
  priority: NotificationPriority;
  urgencyScore: number;
  title: string;
  summary?: string;
  extractedData: Record<string, unknown>;
  deadlineDate?: string;
  matchedPatterns: string[];
}

// Regex patterns for data extraction
const DATE_PATTERNS = [
  /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/g,  // DD/MM/YYYY or DD-MM-YYYY
  /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/g,     // YYYY/MM/DD or YYYY-MM-DD
  /(\w+)\s+(\d{1,2}),?\s+(\d{4})/gi,             // Month DD, YYYY
];

const BOOKING_NUMBER_PATTERN = /\b([A-Z]{3,4}\d{6,12})\b/gi;
const CONTAINER_PATTERN = /\b([A-Z]{4}\d{7})\b/gi;
const VESSEL_PATTERN = /(?:vessel|v\/v|mv|m\.v\.)\s*[:\s]*([A-Z][A-Z0-9\s\-]{3,30})/gi;

export class NotificationClassificationService {
  private repository: NotificationRepository;
  private typeConfigs: NotificationTypeConfig[] | null = null;

  constructor(private supabase: SupabaseClient) {
    this.repository = new NotificationRepository(supabase);
  }

  // ============================================================================
  // CLASSIFICATION
  // ============================================================================

  async classifyEmail(email: EmailForClassification): Promise<ClassificationResult> {
    // Load type configs if not cached
    if (!this.typeConfigs) {
      this.typeConfigs = await this.repository.getNotificationTypeConfigs(true);
    }

    const subject = email.subject?.toUpperCase() || '';
    const body = email.body_text?.toUpperCase() || '';
    const sender = email.sender_email?.toLowerCase() || '';

    let bestMatch: {
      config: NotificationTypeConfig;
      score: number;
      matchedPatterns: string[];
    } | null = null;

    for (const config of this.typeConfigs) {
      const { score, matchedPatterns } = this.calculateMatchScore(
        config,
        subject,
        body,
        sender
      );

      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { config, score, matchedPatterns };
      }
    }

    if (!bestMatch || bestMatch.score < 55) {
      // Not a recognizable notification - threshold raised from 30 to 55
      // This requires 2+ pattern matches to reduce false positives
      return {
        isNotification: false,
        confidence: 0,
        priority: 'low',
        urgencyScore: 0,
        title: email.subject || 'Unknown',
        extractedData: {},
        matchedPatterns: [],
      };
    }

    const { config, score, matchedPatterns } = bestMatch;

    // Extract type-specific data
    const extractedData = this.extractData(
      config.notification_type,
      email.subject,
      email.body_text || ''
    );

    // Calculate deadline if applicable
    const deadlineDate = this.extractDeadline(
      config.notification_type,
      email.subject,
      email.body_text || '',
      extractedData
    );

    // Calculate urgency score
    const urgencyScore = this.calculateUrgencyScore(
      config.default_priority as NotificationPriority,
      deadlineDate,
      config.notification_type
    );

    // Determine priority (may be elevated based on urgency)
    const priority = this.determinePriority(
      config.default_priority as NotificationPriority,
      urgencyScore
    );

    // Generate title and summary
    const { title, summary } = this.generateTitleAndSummary(
      config,
      email.subject,
      extractedData
    );

    return {
      isNotification: true,
      notificationType: config.notification_type,
      confidence: Math.min(score, 100),
      priority,
      urgencyScore,
      title,
      summary,
      extractedData,
      deadlineDate,
      matchedPatterns,
    };
  }

  private calculateMatchScore(
    config: NotificationTypeConfig,
    subject: string,
    body: string,
    sender: string
  ): { score: number; matchedPatterns: string[] } {
    let score = 0;
    const matchedPatterns: string[] = [];

    // Subject pattern matching (highest weight)
    const subjectPatterns = config.subject_patterns || [];
    for (const pattern of subjectPatterns) {
      if (subject.includes(pattern.toUpperCase())) {
        score += 40;
        matchedPatterns.push(`subject:${pattern}`);
      }
    }

    // Body keyword matching
    const bodyKeywords = config.body_keywords || [];
    for (const keyword of bodyKeywords) {
      if (body.includes(keyword.toUpperCase())) {
        score += 20;
        matchedPatterns.push(`body:${keyword}`);
      }
    }

    // Sender pattern matching
    const senderPatterns = config.sender_patterns || [];
    for (const pattern of senderPatterns) {
      if (sender.includes(pattern.toLowerCase())) {
        score += 15;
        matchedPatterns.push(`sender:${pattern}`);
      }
    }

    return { score, matchedPatterns };
  }

  private extractData(
    notificationType: string,
    subject: string,
    body: string
  ): Record<string, unknown> {
    const data: Record<string, unknown> = {};
    const fullText = `${subject} ${body}`;

    // Extract booking numbers
    const bookingMatches = fullText.match(BOOKING_NUMBER_PATTERN);
    if (bookingMatches && bookingMatches.length > 0) {
      data.booking_numbers = [...new Set(bookingMatches)];
    }

    // Extract container numbers
    const containerMatches = fullText.match(CONTAINER_PATTERN);
    if (containerMatches && containerMatches.length > 0) {
      data.container_numbers = [...new Set(containerMatches)];
    }

    // Extract vessels
    const vesselMatches = fullText.match(VESSEL_PATTERN);
    if (vesselMatches && vesselMatches.length > 0) {
      data.vessels = vesselMatches.map(v => v.replace(/vessel|v\/v|mv|m\.v\./gi, '').trim());
    }

    // Type-specific extraction
    switch (notificationType) {
      case 'rollover':
        this.extractRolloverData(data, subject, body);
        break;
      case 'vessel_delay':
        this.extractDelayData(data, subject, body);
        break;
      case 'si_cutoff':
      case 'vgm_cutoff':
      case 'cargo_cutoff':
        this.extractCutoffData(data, subject, body, notificationType);
        break;
      case 'rate_increase':
      case 'rate_restoration':
        this.extractRateData(data, subject, body);
        break;
    }

    return data;
  }

  private extractRolloverData(
    data: Record<string, unknown>,
    subject: string,
    body: string
  ): void {
    // Try to extract original and new vessel
    const vesselChangePattern = /from\s+([A-Z][A-Z0-9\s\-]+)\s+to\s+([A-Z][A-Z0-9\s\-]+)/i;
    const match = `${subject} ${body}`.match(vesselChangePattern);
    if (match) {
      data.original_vessel = match[1].trim();
      data.new_vessel = match[2].trim();
    }
  }

  private extractDelayData(
    data: Record<string, unknown>,
    subject: string,
    body: string
  ): void {
    // Extract delay duration
    const delayPattern = /delay(?:ed)?\s+(?:by\s+)?(\d+)\s*(hour|day|week)/i;
    const match = `${subject} ${body}`.match(delayPattern);
    if (match) {
      data.delay_amount = parseInt(match[1]);
      data.delay_unit = match[2].toLowerCase();
    }
  }

  private extractCutoffData(
    data: Record<string, unknown>,
    subject: string,
    body: string,
    notificationType: string
  ): void {
    data.cutoff_type = notificationType.replace('_cutoff', '').toUpperCase();

    // Extract cutoff date
    for (const pattern of DATE_PATTERNS) {
      const matches = `${subject} ${body}`.match(pattern);
      if (matches) {
        data.cutoff_date = matches[0];
        break;
      }
    }
  }

  private extractRateData(
    data: Record<string, unknown>,
    subject: string,
    body: string
  ): void {
    // Extract rate amounts
    const ratePattern = /\$?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g;
    const matches = `${subject} ${body}`.match(ratePattern);
    if (matches && matches.length >= 1) {
      const rates = matches.map(r => parseFloat(r.replace(/[$,]/g, '')));
      data.rates = rates;
    }
  }

  private extractDeadline(
    notificationType: string,
    subject: string,
    body: string,
    extractedData: Record<string, unknown>
  ): string | undefined {
    // Use extracted cutoff date if available
    if (extractedData.cutoff_date) {
      return this.parseDate(extractedData.cutoff_date as string);
    }

    // Try to find dates in text
    const fullText = `${subject} ${body}`;
    for (const pattern of DATE_PATTERNS) {
      const match = fullText.match(pattern);
      if (match) {
        const parsed = this.parseDate(match[0]);
        if (parsed) return parsed;
      }
    }

    return undefined;
  }

  private parseDate(dateStr: string): string | undefined {
    try {
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    } catch {
      // Ignore parse errors
    }
    return undefined;
  }

  private calculateUrgencyScore(
    basePriority: NotificationPriority,
    deadlineDate: string | undefined,
    notificationType: string
  ): number {
    // Base score from priority
    const baseScores: Record<NotificationPriority, number> = {
      critical: 80,
      high: 60,
      medium: 40,
      low: 20,
    };
    let score = baseScores[basePriority] || 40;

    // Deadline factor
    if (deadlineDate) {
      const deadline = new Date(deadlineDate);
      const now = new Date();
      const hoursUntilDeadline = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);

      if (hoursUntilDeadline < 0) {
        score += 20; // Already overdue
      } else if (hoursUntilDeadline < 24) {
        score += 15; // Due within 24h
      } else if (hoursUntilDeadline < 48) {
        score += 10; // Due within 48h
      } else if (hoursUntilDeadline < 168) {
        score += 5; // Due within week
      }
    }

    // Type factor for critical types
    const criticalTypes = ['rollover', 'customs_hold', 'vessel_omission', 'cargo_cutoff'];
    if (criticalTypes.includes(notificationType)) {
      score += 10;
    }

    return Math.min(score, 100);
  }

  private determinePriority(
    basePriority: NotificationPriority,
    urgencyScore: number
  ): NotificationPriority {
    // Elevate priority if urgency is high
    if (urgencyScore >= 90 && basePriority !== 'critical') {
      return 'critical';
    }
    if (urgencyScore >= 75 && !['critical', 'high'].includes(basePriority)) {
      return 'high';
    }
    return basePriority;
  }

  private generateTitleAndSummary(
    config: NotificationTypeConfig,
    originalSubject: string,
    extractedData: Record<string, unknown>
  ): { title: string; summary?: string } {
    let title = config.display_name;

    // Customize based on extracted data
    if (extractedData.booking_numbers && (extractedData.booking_numbers as string[]).length > 0) {
      const bookings = extractedData.booking_numbers as string[];
      title = `${config.display_name}: ${bookings[0]}`;
    }

    // Generate summary from extracted data
    const summaryParts: string[] = [];

    if (extractedData.cutoff_date) {
      summaryParts.push(`Cutoff: ${extractedData.cutoff_date}`);
    }
    if (extractedData.original_vessel && extractedData.new_vessel) {
      summaryParts.push(`${extractedData.original_vessel} → ${extractedData.new_vessel}`);
    }
    if (extractedData.delay_amount && extractedData.delay_unit) {
      summaryParts.push(`Delayed by ${extractedData.delay_amount} ${extractedData.delay_unit}(s)`);
    }

    const summary = summaryParts.length > 0 ? summaryParts.join('. ') : undefined;

    return { title, summary };
  }

  // ============================================================================
  // BATCH PROCESSING
  // ============================================================================

  async classifyAndCreateNotification(
    email: EmailForClassification
  ): Promise<Notification | null> {
    // Check if notification already exists for this email
    const existing = await this.repository.findByEmailId(email.id);
    if (existing) {
      return existing;
    }

    // Classify
    const result = await this.classifyEmail(email);

    if (!result.isNotification) {
      return null;
    }

    // Create notification
    return this.repository.create({
      email_id: email.id,
      sender_email: email.sender_email,
      sender_name: email.sender_name,
      notification_type: result.notificationType!,
      classification_confidence: result.confidence,
      shipment_id: email.shipment_id,
      carrier_id: email.carrier_id,
      title: result.title,
      summary: result.summary,
      original_subject: email.subject,
      extracted_data: result.extractedData,
      priority: result.priority,
      urgency_score: result.urgencyScore,
      deadline_date: result.deadlineDate,
      status: 'unread',
      received_at: email.received_at,
    });
  }

  async processUnclassifiedEmails(limit: number = 100): Promise<{
    processed: number;
    notificationsCreated: number;
    errors: string[];
  }> {
    // Get emails that haven't been classified yet
    const { data: emails, error } = await this.supabase
      .from('raw_emails')
      .select('id, gmail_message_id, sender_email, sender_name, subject, body_text, received_at')
      .not('id', 'in', this.supabase.from('notifications').select('email_id'))
      .order('received_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(`Failed to fetch unclassified emails: ${error.message}`);
    }

    let processed = 0;
    let notificationsCreated = 0;
    const errors: string[] = [];

    for (const email of emails || []) {
      try {
        const notification = await this.classifyAndCreateNotification(email);
        processed++;
        if (notification) {
          notificationsCreated++;
        }
      } catch (err) {
        errors.push(`Email ${email.id}: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }

    return { processed, notificationsCreated, errors };
  }
}
