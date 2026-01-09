/**
 * Logging Service
 *
 * Centralized logging for the email processing pipeline.
 * Stores structured logs in the processing_logs table.
 *
 * Features:
 * - Structured logging with section/action/level
 * - Context binding (threadId, emailId, shipmentId)
 * - Timer support for duration tracking
 * - Batch insert for performance
 * - Console output for development
 *
 * Usage:
 *   const logger = new LoggingService(supabase);
 *   const emailLogger = logger.withContext({ emailId: 'xxx', threadId: 'yyy' });
 *   emailLogger.info('classification', 'start', 'Starting document classification');
 *   emailLogger.error('classification', 'failed', 'Classification failed', error);
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'critical';

export type LogSection =
  | 'email_fetch'
  | 'email_ingestion'
  | 'classification'
  | 'extraction'
  | 'linking'
  | 'registry'
  | 'flagging'
  | 'workflow'
  | 'insights'
  | 'tasks'
  | 'cron'
  | 'api'
  | 'system';

export type LogAction =
  | 'start'
  | 'complete'
  | 'error'
  | 'skip'
  | 'retry'
  | 'timeout'
  | 'validate'
  | 'transform'
  | 'save'
  | 'fetch'
  | 'match'
  | 'create'
  | 'update'
  | 'delete';

export interface LogContext {
  threadId?: string;
  emailId?: string;
  shipmentId?: string;
}

export interface LogEntry {
  section: string;
  action: string;
  level: LogLevel;
  message: string;
  thread_id?: string;
  email_id?: string;
  shipment_id?: string;
  metadata?: Record<string, unknown>;
  error_code?: string;
  error_stack?: string;
  duration_ms?: number;
  created_at?: string;
}

interface LogBuffer {
  entries: LogEntry[];
  maxSize: number;
  flushInterval: NodeJS.Timeout | null;
}

// ============================================================================
// Logging Service
// ============================================================================

export class LoggingService {
  private supabase: SupabaseClient;
  private context: LogContext;
  private buffer: LogBuffer;
  private enableConsole: boolean;
  private enableDatabase: boolean;
  private minLevel: LogLevel;

  private static readonly LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
    critical: 4,
  };

  constructor(
    supabase: SupabaseClient,
    options: {
      context?: LogContext;
      enableConsole?: boolean;
      enableDatabase?: boolean;
      minLevel?: LogLevel;
      bufferSize?: number;
      flushIntervalMs?: number;
    } = {}
  ) {
    this.supabase = supabase;
    this.context = options.context || {};
    this.enableConsole = options.enableConsole ?? true;
    this.enableDatabase = options.enableDatabase ?? true;
    this.minLevel = options.minLevel ?? 'info';

    this.buffer = {
      entries: [],
      maxSize: options.bufferSize ?? 50,
      flushInterval: null,
    };

    // Auto-flush every 5 seconds if buffering
    if (this.enableDatabase && options.flushIntervalMs) {
      this.buffer.flushInterval = setInterval(
        () => this.flush(),
        options.flushIntervalMs
      );
    }
  }

  // ==========================================================================
  // Context Methods
  // ==========================================================================

  /**
   * Create a new logger with additional context
   */
  withContext(context: LogContext): LoggingService {
    return new LoggingService(this.supabase, {
      context: { ...this.context, ...context },
      enableConsole: this.enableConsole,
      enableDatabase: this.enableDatabase,
      minLevel: this.minLevel,
    });
  }

  /**
   * Create a timer that returns duration_ms when called
   */
  startTimer(): () => number {
    const start = Date.now();
    return () => Date.now() - start;
  }

  // ==========================================================================
  // Core Logging Methods
  // ==========================================================================

  /**
   * Log a message at the specified level
   */
  async log(
    level: LogLevel,
    section: string,
    action: string,
    message: string,
    options?: {
      metadata?: Record<string, unknown>;
      error?: Error;
      durationMs?: number;
    }
  ): Promise<void> {
    // Check minimum level
    if (LoggingService.LEVEL_PRIORITY[level] < LoggingService.LEVEL_PRIORITY[this.minLevel]) {
      return;
    }

    const entry: LogEntry = {
      section,
      action,
      level,
      message,
      thread_id: this.context.threadId,
      email_id: this.context.emailId,
      shipment_id: this.context.shipmentId,
      metadata: options?.metadata,
      duration_ms: options?.durationMs,
      created_at: new Date().toISOString(),
    };

    // Add error details if present
    if (options?.error) {
      entry.error_code = options.error.name || 'Error';
      entry.error_stack = options.error.stack;
      if (!entry.metadata) entry.metadata = {};
      entry.metadata.errorMessage = options.error.message;
    }

    // Console output
    if (this.enableConsole) {
      this.logToConsole(entry);
    }

    // Database storage
    if (this.enableDatabase) {
      this.buffer.entries.push(entry);
      if (this.buffer.entries.length >= this.buffer.maxSize) {
        await this.flush();
      }
    }
  }

  /**
   * Log at DEBUG level
   */
  debug(
    section: string,
    action: string,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    return this.log('debug', section, action, message, { metadata });
  }

  /**
   * Log at INFO level
   */
  info(
    section: string,
    action: string,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    return this.log('info', section, action, message, { metadata });
  }

  /**
   * Log at WARN level
   */
  warn(
    section: string,
    action: string,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    return this.log('warn', section, action, message, { metadata });
  }

  /**
   * Log at ERROR level
   */
  error(
    section: string,
    action: string,
    message: string,
    error?: Error,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    return this.log('error', section, action, message, { error, metadata });
  }

  /**
   * Log at CRITICAL level
   */
  critical(
    section: string,
    action: string,
    message: string,
    error?: Error,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    return this.log('critical', section, action, message, { error, metadata });
  }

  // ==========================================================================
  // Convenience Methods
  // ==========================================================================

  /**
   * Log start of an operation with timer
   */
  async start(
    section: string,
    message: string,
    metadata?: Record<string, unknown>
  ): Promise<() => Promise<void>> {
    const timer = this.startTimer();
    await this.info(section, 'start', message, metadata);

    return async () => {
      const durationMs = timer();
      await this.log('info', section, 'complete', `${message} completed`, {
        durationMs,
        metadata: { ...metadata, duration_ms: durationMs },
      });
    };
  }

  /**
   * Log an operation with automatic timing
   */
  async timed<T>(
    section: string,
    message: string,
    operation: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    const timer = this.startTimer();
    await this.info(section, 'start', message, metadata);

    try {
      const result = await operation();
      const durationMs = timer();
      await this.log('info', section, 'complete', `${message} completed`, {
        durationMs,
        metadata: { ...metadata, duration_ms: durationMs },
      });
      return result;
    } catch (err) {
      const durationMs = timer();
      await this.log('error', section, 'error', `${message} failed`, {
        error: err instanceof Error ? err : new Error(String(err)),
        durationMs,
        metadata,
      });
      throw err;
    }
  }

  // ==========================================================================
  // Buffer Management
  // ==========================================================================

  /**
   * Flush buffered logs to database
   */
  async flush(): Promise<void> {
    if (this.buffer.entries.length === 0) return;

    const entries = [...this.buffer.entries];
    this.buffer.entries = [];

    try {
      const { error } = await this.supabase
        .from('processing_logs')
        .insert(entries);

      if (error) {
        // Log to console if DB insert fails
        console.error('[LoggingService] Failed to flush logs:', error);
        // Re-add entries to buffer (with limit to prevent memory issues)
        if (this.buffer.entries.length < this.buffer.maxSize * 2) {
          this.buffer.entries.unshift(...entries);
        }
      }
    } catch (err) {
      console.error('[LoggingService] Flush error:', err);
    }
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    if (this.buffer.flushInterval) {
      clearInterval(this.buffer.flushInterval);
    }
    await this.flush();
  }

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private logToConsole(entry: LogEntry): void {
    const prefix = `[${entry.section}:${entry.action}]`;
    const contextStr = [
      entry.thread_id ? `thread:${entry.thread_id.substring(0, 8)}` : null,
      entry.email_id ? `email:${entry.email_id.substring(0, 8)}` : null,
      entry.duration_ms ? `${entry.duration_ms}ms` : null,
    ]
      .filter(Boolean)
      .join(' ');

    const fullMessage = contextStr
      ? `${prefix} ${entry.message} (${contextStr})`
      : `${prefix} ${entry.message}`;

    switch (entry.level) {
      case 'debug':
        console.debug(fullMessage);
        break;
      case 'info':
        console.log(fullMessage);
        break;
      case 'warn':
        console.warn(fullMessage);
        break;
      case 'error':
      case 'critical':
        console.error(fullMessage);
        if (entry.error_stack) {
          console.error(entry.error_stack);
        }
        break;
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a logging service with default configuration
 */
export function createLoggingService(
  supabase: SupabaseClient,
  context?: LogContext
): LoggingService {
  return new LoggingService(supabase, {
    context,
    enableConsole: true,
    enableDatabase: true,
    minLevel: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    bufferSize: 50,
    flushIntervalMs: 5000,
  });
}

export default LoggingService;
