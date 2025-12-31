/**
 * Logger configuration for freight intelligence agents
 * Uses Winston for structured logging with multiple transports
 */

import winston from 'winston';
import path from 'path';
import fs from 'fs';

const logDir = process.env.LOG_FILE_PATH || './logs';

// Create log directory if it doesn't exist
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? JSON.stringify(meta, null, 2) : '';
    return `${timestamp} [${level}]: ${message} ${metaStr}`;
  })
);

class Logger {
  private logger: winston.Logger;

  constructor(service: string) {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      defaultMeta: { service },
      format: logFormat,
      transports: [
        // Console transport
        new winston.transports.Console({
          format: consoleFormat
        }),
        // File transport for all logs
        new winston.transports.File({
          filename: path.join(logDir, 'combined.log'),
          maxsize: 10485760, // 10MB
          maxFiles: 5
        }),
        // File transport for errors only
        new winston.transports.File({
          filename: path.join(logDir, 'error.log'),
          level: 'error',
          maxsize: 10485760, // 10MB
          maxFiles: 5
        })
      ]
    });

    // If production, remove console transport
    if (process.env.NODE_ENV === 'production') {
      this.logger.remove(this.logger.transports[0]);
    }
  }

  info(message: string, meta?: any): void {
    this.logger.info(message, meta);
  }

  error(message: string, error?: Error | any): void {
    if (error instanceof Error) {
      this.logger.error(message, {
        error: error.message,
        stack: error.stack,
        ...error
      });
    } else {
      this.logger.error(message, error);
    }
  }

  warn(message: string, meta?: any): void {
    this.logger.warn(message, meta);
  }

  debug(message: string, meta?: any): void {
    this.logger.debug(message, meta);
  }

  verbose(message: string, meta?: any): void {
    this.logger.verbose(message, meta);
  }

  // Log performance metrics
  performance(operation: string, duration: number, meta?: any): void {
    this.logger.info(`Performance: ${operation}`, {
      duration_ms: duration,
      ...meta
    });
  }

  // Log database operations
  database(operation: string, table: string, result: any): void {
    this.logger.debug(`Database: ${operation} on ${table}`, {
      operation,
      table,
      result
    });
  }

  // Log API calls
  api(method: string, endpoint: string, status: number, duration?: number): void {
    this.logger.info(`API: ${method} ${endpoint}`, {
      method,
      endpoint,
      status,
      duration_ms: duration
    });
  }
}

export default Logger;