/**
 * Cron job runner for EmailIngestionAgent
 * Schedule this to run periodically (e.g., every 15 minutes)
 */

import dotenv from 'dotenv';
import cron from 'node-cron';
import EmailIngestionAgent from '../agents/email-ingestion-agent';
import Logger from '../utils/logger';

dotenv.config();

const logger = new Logger('EmailIngestionCron');

// Configuration
const CRON_SCHEDULE = process.env.EMAIL_CRON_SCHEDULE || '*/15 * * * *'; // Every 15 minutes
const RUN_IMMEDIATELY = process.env.RUN_IMMEDIATELY === 'true';

async function runEmailIngestion() {
  const startTime = Date.now();
  logger.info('Starting scheduled email ingestion');

  try {
    const agent = new EmailIngestionAgent();

    // Test connections first
    const connections = await agent.testConnections();

    if (!connections.gmail || !connections.database) {
      throw new Error('Connection test failed');
    }

    // Process emails
    const stats = await agent.processNewEmails();

    const duration = Date.now() - startTime;

    logger.info('Email ingestion completed', {
      duration_ms: duration,
      stats
    });

    // Alert if too many failures
    if (stats.failedEmails > stats.processedEmails * 0.5 && stats.totalEmails > 0) {
      logger.error('High failure rate detected', {
        failureRate: (stats.failedEmails / stats.totalEmails * 100).toFixed(2) + '%',
        stats
      });
    }

  } catch (error) {
    logger.error('Email ingestion cron job failed', error);

    // In production, you might want to send alerts here
    // await sendSlackAlert('Email ingestion failed', error);
  }
}

// Graceful shutdown
let isShuttingDown = false;

async function gracefulShutdown() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info('Graceful shutdown initiated');

  // Give current job 30 seconds to complete
  setTimeout(() => {
    logger.info('Shutdown complete');
    process.exit(0);
  }, 30000);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Main execution
async function main() {
  logger.info('Email Ingestion Cron Job Started', {
    schedule: CRON_SCHEDULE,
    runImmediately: RUN_IMMEDIATELY
  });

  // Run immediately if configured
  if (RUN_IMMEDIATELY) {
    logger.info('Running immediate ingestion');
    await runEmailIngestion();
  }

  // Schedule cron job
  const task = cron.schedule(CRON_SCHEDULE, async () => {
    if (isShuttingDown) {
      logger.info('Skipping run due to shutdown');
      return;
    }

    await runEmailIngestion();
  });

  task.start();

  logger.info(`Cron job scheduled: ${CRON_SCHEDULE}`);
  logger.info('Press Ctrl+C to stop');

  // Keep process alive
  process.stdin.resume();
}

// Start the cron job
main().catch((error) => {
  logger.error('Failed to start cron job', error);
  process.exit(1);
});